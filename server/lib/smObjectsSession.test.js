import test from "node:test";
import assert from "node:assert/strict";

// 운영 DB와 SM을 절대 사용하지 않는다. 가짜 SM과 메모리 DB로 등록 흐름을 검증한다.
process.env.WMS_DB_PATH = ":memory:";
process.env.SM_URL = "http://sm-register-test.invalid";
process.env.SM_LOGIN_FILE = "__no_sm_test_credentials__";
process.env.SM_REGISTER_RETRY_MS = "1";
delete process.env.SM_SYNC;
delete process.env.SM_LOGIN_ID;
delete process.env.SM_LOGIN_PW;
const { db } = await import("../db.js");
const { attachSession, status } = await import("./smSync.js");
const { createObject, finalizeAfterCreate } = await import("./smObjectsSession.js");

const originalFetch = globalThis.fetch;
let rows = [], inserts = 0, failFreshList = 0, ignoreSave = 0, rejectQuantity = 0, quantityCalls = 0;
const timeoutError = () => new DOMException("The operation was aborted due to timeout", "TimeoutError");
const nextId = () => String(4000 + rows.length + 1).padStart(6, "0");

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  assert.equal(u.origin, "http://sm-register-test.invalid");
  if (u.pathname === "/login") return new Response(null, { status: 302, headers: { "set-cookie": "test=session" } });
  if (u.pathname === "/api/objects") {
    // 등록 뒤 목록(_refresh=1)이 느려서 시간 초과로 끊기는 경우를 흉내 낸다.
    if (u.searchParams.get("_refresh") && failFreshList > 0) { failFreshList--; throw timeoutError(); }
    return Response.json({ objects: [...rows].sort((a, b) => Number(b.id) - Number(a.id)), has_next: false });
  }
  if (u.pathname === "/insert_tentative_object") {
    inserts++;
    const name = init.body.get("name");
    rows.push({ id: nextId(), name, root_slot: "Unknown", quantity: -1, sector: "Seoul-Root", _inventory: { is_tracked: false, borrowers: {} } });
    return Response.json({ success: true });
  }
  if (u.pathname.startsWith("/object_detail/")) return new Response("ok", { status: 200 });
  if (u.pathname === "/retrieve_object") {
    const q = u.searchParams.get("query");
    return Response.json({ results: rows.filter((r) => r.id === q) });
  }
  if (u.pathname === "/save_object") {
    const f = Object.fromEntries(init.body.entries());
    const row = rows.find((r) => r.id === f.id);
    if (ignoreSave > 0) { ignoreSave--; return Response.json({ status: "success" }); }   // 200을 주고 값은 무시
    row.root_slot = f.root_slot;
    return Response.json({ status: "success" });
  }
  if (u.pathname === "/object_inventory_quantity") {
    quantityCalls++;
    const body = JSON.parse(init.body);
    if (rejectQuantity > 0) { rejectQuantity--; return Response.json({ success: false, error: "object is not registered yet" }); }  // HTTP 200 안의 실패
    const row = rows.find((r) => r.id === body.oid);
    row._inventory = { ...row._inventory, is_tracked: true, available: body.quantity, total: body.quantity };
    return Response.json({ success: true });
  }
  assert.fail("Unexpected endpoint " + u.pathname);
};

function reset() { rows = [{ id: "004000", name: "Existing", root_slot: "000001", _inventory: {} }]; inserts = 0; failFreshList = 0; ignoreSave = 0; rejectQuantity = 0; quantityCalls = 0; }

test("SM 등록 흐름 회귀 테스트", async (t) => {
  try {
    await attachSession("test", "not-a-real-password");
    while (status().running) await new Promise((r) => setTimeout(r, 1));

    await t.test("등록 뒤 목록 조회가 한두 번 시간 초과돼도 다시 시도해 한 번만 등록", async () => {
      reset(); failFreshList = 2;
      const res = await createObject({ name: "Box", rootSlot: "000123", stock: 3 }, { idempotencyKey: "k1" });
      assert.equal(res.id, "004002"); assert.equal(inserts, 1);
    });

    await t.test("목록 조회가 끝내 실패해도 같은 시도를 다시 하면 새로 만들지 않고 이어받음", async () => {
      reset(); failFreshList = 3;
      await assert.rejects(() => createObject({ name: "Box (큰 것)", rootSlot: "000123", stock: 3 }, { idempotencyKey: "k2" }), /번호를 확인하지 못했습니다/);
      assert.equal(inserts, 1); assert.equal(rows.length, 2);       // SM에는 이미 만들어졌다
      const res = await createObject({ name: "Box (큰 것)", rootSlot: "000123", stock: 3 }, { idempotencyKey: "k2" });
      assert.equal(res.id, "004002"); assert.equal(res.replayed, true);
      assert.equal(inserts, 1); assert.equal(rows.length, 2);       // 중복으로 만들지 않았다
      const again = await createObject({ name: "Box (큰 것)", rootSlot: "000123", stock: 3 }, { idempotencyKey: "k2" });
      assert.equal(again.id, "004002"); assert.equal(inserts, 1);   // 번호가 정해진 뒤에는 그대로 돌려준다
    });

    await t.test("이전 시도 확인이 불가능하면 새로 만들지 않고 실패", async () => {
      reset(); failFreshList = 3;
      await assert.rejects(() => createObject({ name: "Pen", stock: 1 }, { idempotencyKey: "k3" }), /번호를 확인하지 못했습니다/);
      failFreshList = 3;
      await assert.rejects(() => createObject({ name: "Pen", stock: 1 }, { idempotencyKey: "k3" }), /이전 등록 시도의 결과를 아직 확인하지 못했습니다/);
      assert.equal(inserts, 1);
    });

    await t.test("위치와 수량이 정상 저장되면 둘 다 ok", async () => {
      reset();
      const { id, row } = await createObject({ name: "Cup", rootSlot: "000123", stock: 5 }, { idempotencyKey: "k4" });
      const fin = await finalizeAfterCreate(id, { name: "Cup", rootSlot: "000123", stock: 5 }, { current: row });
      assert.equal(fin.rootSlot.ok, true); assert.equal(fin.quantity.ok, true);
      const sm = rows.find((r) => r.id === id);
      assert.equal(sm.root_slot, "000123"); assert.equal(sm._inventory.available, 5);
    });

    await t.test("SM이 200을 주고 위치를 무시하면 다시 시도해 반영", async () => {
      reset(); ignoreSave = 1;
      const { id, row } = await createObject({ name: "Lamp", rootSlot: "000124", stock: 2 }, { idempotencyKey: "k5" });
      const fin = await finalizeAfterCreate(id, { name: "Lamp", rootSlot: "000124", stock: 2 }, { current: row });
      assert.equal(fin.rootSlot.ok, true); assert.equal(rows.find((r) => r.id === id).root_slot, "000124");
    });

    await t.test("위치를 계속 무시하면 실패로 알린다", async () => {
      reset(); ignoreSave = 5;
      const { id, row } = await createObject({ name: "Lamp", rootSlot: "000124", stock: 2 }, { idempotencyKey: "k6" });
      const fin = await finalizeAfterCreate(id, { name: "Lamp", rootSlot: "000124", stock: 2 }, { current: row });
      assert.equal(fin.rootSlot.ok, false); assert.match(fin.rootSlot.reason, /저장하지 않았습니다/);
    });

    await t.test("수량 API가 HTTP 200 안에서 거절하면 다시 시도하고, 계속 거절하면 실패로 알린다", async () => {
      reset(); rejectQuantity = 1;
      let made = await createObject({ name: "Rope", rootSlot: "000125", stock: 4 }, { idempotencyKey: "k7" });
      let fin = await finalizeAfterCreate(made.id, { name: "Rope", rootSlot: "000125", stock: 4 }, { current: made.row });
      assert.equal(fin.quantity.ok, true); assert.equal(quantityCalls, 2);
      assert.equal(rows.find((r) => r.id === made.id)._inventory.available, 4);

      reset(); rejectQuantity = 5;
      made = await createObject({ name: "Rope", rootSlot: "000125", stock: 4 }, { idempotencyKey: "k8" });
      fin = await finalizeAfterCreate(made.id, { name: "Rope", rootSlot: "000125", stock: 4 }, { current: made.row });
      assert.equal(fin.quantity.ok, false); assert.match(fin.quantity.reason, /not registered/);
    });
  } finally { globalThis.fetch = originalFetch; db.close(); }
});
