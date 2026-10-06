import test from "node:test";
import assert from "node:assert/strict";

// 운영 DB와 SM을 절대 사용하지 않는다. 실제 DB 조회와 동기화 회차를 메모리 장부/가짜 SM으로 검증한다.
process.env.WMS_DB_PATH = ":memory:";
process.env.SM_URL = "http://sm-test.invalid";
process.env.SM_LOGIN_FILE = "__no_sm_test_credentials__";
delete process.env.SM_LOGIN_ID;
delete process.env.SM_LOGIN_PW;
delete process.env.SM_SYNC;
process.env.SM_MISSING_REFRESH_MS = "0";
process.env.SM_SYNC_COOLDOWN_MS = "0";
const { db, run, get } = await import("../db.js");
const { readWmsSyncState, attachSession, tick, status, resetSmCooldown } = await import("./smSync.js");

let smRows = [], writes = [], failQuantity = false, failList = false, afterWrite = null, hangOids = new Set();
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  assert.equal(u.origin, "http://sm-test.invalid", "내부 HTTP 물품 API를 호출하면 안 된다");
  if (u.pathname === "/login") return new Response(null, { status: 302, headers: { "set-cookie": "test=session; HttpOnly" } });
  if (u.pathname === "/api/objects") {
    if (failList) return Response.json({ success: false, error: "test list failure" });
    return Response.json({ objects: smRows, has_next: false });
  }
  if (u.pathname === "/retrieve_object") return Response.json({ results: smRows.filter((r) => r.id === u.searchParams.get("query")) });
  const body = JSON.parse(init.body);
  const row = smRows.find((r) => r.id === body.oid);
  writes.push({ path: u.pathname, ...body });
  if (u.pathname === "/object_inventory_quantity") {
    if (hangOids.has(body.oid)) throw new DOMException("The operation was aborted due to timeout", "TimeoutError");   // SM이 응답하지 않음
    if (failQuantity) return Response.json({ success: false, error: "test quantity failure" });
    row._inventory.available = body.quantity;
    row._inventory.total = body.quantity + row._inventory.borrowed;
    row._inventory.is_tracked = true;   // 처음 수량을 넣으면 SM이 추적을 시작한다
  } else if (u.pathname === "/object_inventory_event") {
    if (body.action === "borrow" && body.quantity > row._inventory.available) return Response.json({ success: false, error: "insufficient available stock" }, { status: 400 });
    const old = Number(row._inventory.borrowers[body.borrower]) || 0;
    const next = old + (body.action === "borrow" ? 1 : -1) * body.quantity;
    if (next) row._inventory.borrowers[body.borrower] = next;
    else delete row._inventory.borrowers[body.borrower];
    row._inventory.available += (body.action === "borrow" ? -1 : 1) * body.quantity;
    row._inventory.borrowed = Object.values(row._inventory.borrowers).reduce((sum, n) => sum + n, 0);
  } else assert.fail("Unexpected endpoint " + u.pathname);
  if (afterWrite) afterWrite(body);
  return Response.json({ success: true });
};

function reset() {
  for (const table of ["scenario_items", "sid_rentals", "general_rentals", "registered_users", "rental_requests", "settings"]) db.exec(`DELETE FROM ${table}`);
  writes = []; smRows = []; failQuantity = false; failList = false; afterWrite = null; hangOids = new Set();
}
function item(id, stock, rented, total, borrowers = {}) {
  run("INSERT INTO scenario_items (id,name,stock,rented) VALUES (?,?,?,?)", [id, "Item " + id, stock, rented]);
  const borrowed = Object.values(borrowers).reduce((sum, n) => sum + n, 0);
  smRows.push({ id, _inventory: { is_tracked: true, total, available: total - borrowed, borrowed, borrowers: { ...borrowers } } });
}
function user() { run("INSERT INTO registered_users (employee_id,name) VALUES ('1234','Test user')"); }
function borrow(id, qty, extra = {}) {
  run("INSERT INTO general_rentals (borrower_name,employee_id,item_id,item_label,qty,returned,variant_pending,status) VALUES (?,?,?,?,?,?,?,?)",
    ["Test user", "1234", id, "Item", qty, extra.returned || "X", extra.pending || null, extra.status || "active"]);
}
function baseline() { return JSON.parse(get("SELECT value FROM settings WHERE key='sm_sync_baseline'")?.value || "null"); }
function assertInventory(id = "000001") {
  const wms = get("SELECT stock,rented FROM scenario_items WHERE id=?", [id]);
  const inv = smRows.find((r) => r.id === id)._inventory;
  assert.equal(inv.available, wms.stock);
  assert.equal(inv.borrowed, wms.rented);
  assert.equal(inv.total, wms.stock + wms.rented);
}

test("SM 동기화 회귀 테스트", async (t) => {
  try {
    await attachSession("test", "not-a-real-password");
    while (status().running) await new Promise((r) => setTimeout(r, 1));

    await t.test("인증 없는 HTTP API 없이 물품 전체와 SID/일반 대여를 같은 사번으로 합산", () => {
      reset(); user(); item("000001", 5, 5, 10);
      borrow("000001", 2);
      run("INSERT INTO sid_rentals (borrower_name,employee_id,item_label,returned) VALUES ('Test user','1234','[000001] Item x 3',NULL)");
      borrow("000001", 9, { returned: "O" });
      borrow("999999", 1);
      const state = readWmsSyncState();
      assert.equal(state.objects.length, 1);
      assert.deepEqual(state.borrows.get("000001").get("1234"), { name: "Test user", qty: 5 });
      assert.equal(state.snapshot["000001"], "5|5|1234:5");
      assert.equal(state.borrows.has("999999"), false);
    });

    await t.test("종류 미확정은 제외하고 파손 확인 대기는 가용 재고로 풀지 않음", () => {
      reset(); user(); item("000001", 5, 2, 7);
      borrow("000001", 8, { pending: "Y" });
      borrow("000001", 2, { returned: "O", status: "damage_pending" });
      assert.equal(readWmsSyncState().borrows.get("000001").get("1234").qty, 2);
    });

    await t.test("신규 기준도 실제 수량/대여 동기화하고 반복 실행은 중복 대여하지 않음", async () => {
      reset(); user(); item("000001", 5, 2, 0); borrow("000001", 2);
      const result = await tick({ changedOnly: true });
      assert.equal(result.ok, true); assert.equal(result.quantity, 1); assert.equal(result.borrow, 1);
      assert.equal(smRows[0]._inventory.total, 7);
      assert.equal(smRows[0]._inventory.borrowers["1234"], 2);
      assertInventory();
      const count = writes.length;
      await tick({ changedOnly: true });
      assert.equal(writes.length, count);
    });

    await t.test("부분 반납·전체 반납·바로 추가 대여를 차이만큼 반영", async () => {
      reset(); user(); item("000001", 2, 3, 5, { "1234": 3 }); borrow("000001", 3);
      await tick({ changedOnly: true });
      run("UPDATE general_rentals SET qty=1"); run("UPDATE scenario_items SET stock=4,rented=1");
      let result = await tick({ changedOnly: true });
      assert.equal(result.borrow, 1);
      assert.equal(writes.at(-1).action, "return"); assert.equal(writes.at(-1).quantity, 2);
      run("UPDATE general_rentals SET returned='O'"); run("UPDATE scenario_items SET stock=5,rented=0");
      await tick({ changedOnly: true });
      assert.equal(smRows[0]._inventory.borrowers["1234"], undefined);
      borrow("000001", 2); run("UPDATE scenario_items SET stock=3,rented=2");
      result = await tick({ changedOnly: true, manual: true });
      assert.equal(result.borrow, 1); assert.equal(smRows[0]._inventory.borrowers["1234"], 2);
      assertInventory();
    });

    await t.test("HTTP 200 안의 실패도 실패로 표시하고 확보되지 않은 재고를 대여하지 않고 재시도", async () => {
      reset(); user(); item("000001", 5, 2, 0); borrow("000001", 2); failQuantity = true;
      let result = await tick({ changedOnly: true });
      assert.equal(result.ok, false); assert.equal(result.failed, 1);
      assert.deepEqual(result.failedIds, ["000001"]); assert.equal(baseline()["000001"], undefined);
      failQuantity = false;
      result = await tick({ changedOnly: true });
      assert.equal(result.ok, true); assert.equal(result.quantity, 1); assert.equal(result.borrow, 1);
      assert.equal(writes.filter((w) => w.action === "borrow").length, 1);
      assert.equal(baseline()["000001"], "5|2|1234:2");
      assertInventory();
    });

    await t.test("SM 목록 오류를 물품 0개로 간주하지 않고 이전 기준을 보존", async () => {
      reset(); item("000001", 5, 0, 5); failList = true;
      const result = await tick({ changedOnly: true });
      assert.equal(result.ok, false); assert.match(result.reason, /test list failure/);
      assert.equal(baseline(), null); assert.equal(writes.length, 0);
      failList = false;
      assert.equal((await tick({ changedOnly: true })).ok, true);
    });

    await t.test("동기화 도중 추가 대여가 들어와도 다음 회차에서 빠뜨리지 않음", async () => {
      reset(); user(); item("000001", 5, 2, 0); borrow("000001", 2);
      afterWrite = (body) => {
        if (body.quantity !== 7) return;
        afterWrite = null;
        borrow("000001", 1); run("UPDATE scenario_items SET stock=4,rented=3");
      };
      await tick({ changedOnly: true });
      assert.equal(baseline()["000001"], "5|2|1234:2");
      assert.equal(smRows[0]._inventory.borrowers["1234"], 2);
      await tick({ changedOnly: true });
      assert.equal(smRows[0]._inventory.borrowers["1234"], 3);
      assert.equal(writes.at(-1).quantity, 1);
      assertInventory();
    });

    await t.test("대여 반영 후 응답만 유실돼도 재조회하여 중복 대여 방지", async () => {
      reset(); user(); item("000001", 5, 2, 7); borrow("000001", 2);
      afterWrite = (body) => {
        if (body.action !== "borrow") return;
        afterWrite = null;
        throw new Error("test lost response");
      };
      const lost = await tick({ changedOnly: true });
      assert.equal(lost.ok, false); assert.equal(lost.failed, 1);
      assert.deepEqual(lost.failedIds, ["000001"]); assert.equal(baseline()["000001"], undefined);   // 실패한 물품은 기준에 넣지 않는다
      assert.equal((await tick({ changedOnly: true })).ok, true);
      assert.equal(writes.filter((w) => w.action === "borrow").length, 1);
      assert.equal(smRows[0]._inventory.borrowers["1234"], 2);
      assertInventory();
    });

    // SM에 수량이 한 번도 등록되지 않은 오브젝트는 quantity=-1, is_tracked=false로 온다.
    function untrackedItem(id, stock, rented) {
      run("INSERT INTO scenario_items (id,name,stock,rented) VALUES (?,?,?,?)", [id, "Item " + id, stock, rented]);
      smRows.push({ id, quantity: -1, _inventory: { is_tracked: false, borrowed: 0, borrowers: {} } });
    }

    await t.test("수량이 한 번도 등록되지 않은(-1) 물품은 WMS 선반 수량으로 처음 등록", async () => {
      reset(); untrackedItem("000001", 5, 0);
      const result = await tick({ changedOnly: true });
      assert.equal(result.ok, true); assert.equal(result.quantity, 1); assert.equal(result.untracked, 0);
      assert.equal(writes.length, 1); assert.equal(writes[0].quantity, 5);
      assert.equal(smRows[0]._inventory.is_tracked, true);
      assertInventory();
      const count = writes.length;
      await tick({ changedOnly: true });
      assert.equal(writes.length, count);
    });

    await t.test("미등록 물품이 대여 중이면 수량 등록 후 대여를 이어서 반영", async () => {
      reset(); user(); untrackedItem("000001", 5, 2); borrow("000001", 2);
      const result = await tick({ changedOnly: true });
      assert.equal(result.ok, true); assert.equal(result.quantity, 1); assert.equal(result.borrow, 1);
      assert.deepEqual(writes.map((w) => w.action || "quantity"), ["quantity", "borrow"]);
      assert.equal(writes[0].quantity, 7);
      assert.equal(smRows[0]._inventory.borrowers["1234"], 2);
      assertInventory();
    });

    await t.test("SM 미등록 물품은 집계만 하고 등록할 수량이 0인 미추적 물품은 건드리지 않음", async () => {
      reset(); item("000001", 5, 0, 0); untrackedItem("000002", 0, 0);
      smRows.shift();   // 000001은 SM에 없음
      const result = await tick({ changedOnly: true });
      assert.equal(result.untracked, 1); assert.equal(result.missing, 1);
      assert.equal(writes.length, 0);
    });

    await t.test("방금 SM에 등록한 물품이 받아 둔 목록에 없어도 목록을 새로 받아 수량을 등록", async () => {
      reset(); item("000001", 5, 0, 5);
      await tick({ changedOnly: true });              // 이 회차에 SM 목록을 받아 둔다(000002는 아직 없다)
      untrackedItem("000002", 7, 0);                 // 그 뒤에 등록된 물품 — 목록 캐시에는 없다
      const result = await tick({ changedOnly: true });
      assert.equal(result.missing, 0); assert.equal(result.quantity, 1);
      assert.equal(writes.at(-1).oid, "000002"); assert.equal(writes.at(-1).quantity, 7);
    });

    await t.test("SM이 한 물품에서 응답하지 않아도 그 물품만 실패로 돌리고 나머지는 계속 처리", async () => {
      reset(); untrackedItem("000001", 5, 0); untrackedItem("000002", 3, 0);
      hangOids = new Set(["000001"]);
      const result = await tick({ changedOnly: true });
      assert.equal(result.ok, false); assert.equal(result.failed, 1); assert.deepEqual(result.failedIds, ["000001"]);
      assert.equal(smRows[1]._inventory.available, 3);                          // 000002는 반영됐다
      assert.equal(baseline()["000002"], "3|0|"); assert.equal(baseline()["000001"], undefined);
      hangOids = new Set();
      const retry = await tick({ changedOnly: true });                          // 응답이 돌아오면 실패했던 물품만 다시 처리
      assert.equal(retry.ok, true); assert.equal(smRows[0]._inventory.available, 5);
    });

    await t.test("쓰기가 3번 연속 응답하지 않으면 SM이 멎은 것으로 보고 회차를 접음", async () => {
      reset(); for (const id of ["000001", "000002", "000003", "000004"]) untrackedItem(id, 2, 0);
      hangOids = new Set(["000001", "000002", "000003", "000004"]);
      const result = await tick({ changedOnly: true });
      assert.equal(result.ok, false); assert.match(result.reason, /연속 응답하지 않아/);
      assert.equal(baseline(), null);
    });

    await t.test("SM이 멎어 회차를 접은 뒤에는 잠시 새 회차를 시작하지 않고, 관리자가 직접 누르면 바로 시도", async () => {
      reset(); for (const id of ["000001", "000002", "000003"]) untrackedItem(id, 2, 0);
      hangOids = new Set(["000001", "000002", "000003"]);
      process.env.SM_SYNC_COOLDOWN_MS = "60000";
      try {
        assert.equal((await tick({ changedOnly: true })).ok, false);            // 3번 연속 무응답 → 쉬는 시간 시작
        hangOids = new Set(); const before = writes.length;
        const waiting = await tick({ changedOnly: true });
        assert.equal(waiting.ok, false); assert.match(waiting.reason, /뒤에 다시 시도/);
        assert.equal(writes.length, before);                                       // SM을 건드리지 않았다
        const manual = await tick({ changedOnly: true, manual: true });            // 직접 누른 동기화는 쉬지 않는다
        assert.equal(manual.ok, true); assert.ok(writes.length > before);
      } finally { process.env.SM_SYNC_COOLDOWN_MS = "0"; resetSmCooldown(); }
    });

    await t.test("수량 API에 총 보유 86이 아닌 선반 수량 76을 보내 실제 재고 오차를 복구", async () => {
      reset(); user(); item("000001", 76, 10, 89, { "1234": 10 }); borrow("000001", 10);
      const result = await tick({ changedOnly: true });
      assert.equal(result.quantity, 1); assert.equal(result.borrow, 0);
      assert.equal(writes[0].quantity, 76); assertInventory();
    });

    await t.test("이전 대여자 반납 → 새 대여용 가용 재고 확보 → 새 대여 순서", async () => {
      reset(); user(); item("000001", 5, 2, 5, { "old": 4 }); borrow("000001", 2);
      const result = await tick({ changedOnly: true });
      assert.equal(result.ok, true);
      assert.deepEqual(writes.map((w) => w.action || "quantity"), ["return", "quantity", "borrow"]);
      assert.equal(writes[1].quantity, 7); assertInventory();
    });
  } finally { globalThis.fetch = originalFetch; db.close(); }
});
