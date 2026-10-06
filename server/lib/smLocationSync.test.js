import test from "node:test";
import assert from "node:assert/strict";

process.env.WMS_DB_PATH = ":memory:";
process.env.SM_URL = "http://sm-location-test.invalid";
process.env.SM_LOGIN_FILE = "__no_sm_test_credentials__";
delete process.env.SM_SYNC;
delete process.env.SM_LOGIN_ID;
delete process.env.SM_LOGIN_PW;
const { db, run } = await import("../db.js");
const { attachSession, status } = await import("./smSync.js");
const { pushItemChanges, setRootSlot, activenessSnapshot } = await import("./smLocationSync.js");
const originalFetch = globalThis.fetch;
let object, saves = [], hideExact = false;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  assert.equal(u.origin, "http://sm-location-test.invalid");
  if (u.pathname === "/login") return new Response(null, { status: 302, headers: { "set-cookie": "test=session" } });
  if (u.pathname === "/retrieve_object") {
    const broad = u.searchParams.get("k") === "100";
    const matches = broad && !hideExact ? [object] : [];
    return Response.json({ results: [{ id: "003935", name: "Cake Box", sector: "Hanoi-4F" }, ...matches] });
  }
  if (u.pathname === "/object_detail/003449") return new Response("test missing sector", { status: 500 });
  if (u.pathname === "/api/objects") return Response.json({ objects: [] });
  if (u.pathname === "/save_object") {
    const fields = Object.fromEntries(init.body.entries());
    saves.push(fields); object = { ...object, ...fields };
    if (fields.sector === "Seoul-Root") object.region = "Seoul";
    return Response.json({ status: "success" });
  }
  assert.fail("Unexpected endpoint " + u.pathname);
};
test("구역 없는 Cake Box 복구 및 같은 이름의 다른 물품 보호", async (t) => {
  try {
    await attachSession("test", "not-a-real-password");
    while (status().running) await new Promise((r) => setTimeout(r, 1));
    run("INSERT INTO scenario_items (id,name,sector,root_slot,stock,rented) VALUES ('003449','Cake Box (케이크와 세트)','Seoul-Root','000205',1,0)");
    object = { id: "003449", name: "Cake Box (케이크와 세트)", region: "Seoul", root_slot: "000205",
      location: "Unknown", type: "Env", size: "Small", property: "Hard", quantity: 1,
      colors: "None", grid_size: 100, image_url: "existing-image", product_memo: "existing memo" };
    await t.test("상세 500/목록 누락이어도 이름 후보에서 ID를 정확히 찾아 구역 복구", async () => {
      const result = await pushItemChanges("003449", { sector: "Seoul-Root", rootSlot: "000205" });
      assert.equal(result.ok, true); assert.equal(saves.length, 1);
      assert.equal(saves[0].id, "003449"); assert.equal(saves[0].sector, "Seoul-Root");
      assert.equal(object.region, "Seoul"); assert.equal(object.quantity, "1");
      assert.equal(object.name, "Cake Box (케이크와 세트)");
      assert.equal(object.image_url, "existing-image"); assert.equal(object.grid_size, 100);
      assert.equal(object.product_memo, "existing memo");
    });
    await t.test("Cake Box라는 이름만 같고 ID가 다르면 수정하지 않음", async () => {
      hideExact = true;
      await assert.rejects(() => pushItemChanges("003449", { sector: "Seoul-Root" }), /상세 조회 실패/);
      assert.equal(saves.length, 1); hideExact = false;
    });
    await t.test("위치 변경 시 총 보유가 아닌 가용 수량을 보존", async () => {
      object._inventory = { total: 3, available: 1, borrowed: 2 };
      const result = await setRootSlot("003449", "000206", { current: object });
      assert.equal(result.ok, true); assert.equal(saves.at(-1).quantity, "1");
    });
    await t.test("분석이 시간 초과되어 다시 요청해도 SM 전체 목록은 한 번만 받음", async () => {
      const priorFetch = globalThis.fetch;
      let release, requests = 0;
      const gate = new Promise(resolve => { release = resolve; });
      globalThis.fetch = async (url, init) => {
        const u = new URL(url);
        if (u.pathname !== "/api/objects") return priorFetch(url, init);
        requests++;
        await gate;
        return Response.json({ objects: u.searchParams.get("page") === "1" ? [{ id: "003449", _activeness_score: 50, _usage_count: 3 }] : [] });
      };
      try {
        const [a, b] = await Promise.all([activenessSnapshot({ timeoutMs: 5 }), activenessSnapshot({ timeoutMs: 5 })]);
        assert.equal(a.ok, false); assert.equal(b.ok, false); assert.equal(requests, 1);
        release();
        const ready = await activenessSnapshot({ timeoutMs: 500 });
        assert.equal(ready.ok, true); assert.equal(ready.map.get("003449").score, 50);
        await activenessSnapshot(); assert.equal(requests, 2); // two pages, not two catalog scans
      } finally { release(); globalThis.fetch = priorFetch; }
    });
  } finally { globalThis.fetch = originalFetch; db.close(); }
});
