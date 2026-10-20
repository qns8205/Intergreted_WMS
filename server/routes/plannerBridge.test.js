import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

process.env.WMS_DB_PATH = ":memory:";
process.env.SM_SYNC = "off";
process.env.PLANNER_BRIDGE_KEY = "test-bridge-key-0123456789abcdef";
const { run, get, all } = await import("../db.js");
const { recordBorrow, getActiveItemTypeCount } = await import("./gas.js");
const { createPlannerBridgeRouter } = await import("./plannerBridge.js");

const app = express();
app.use(express.json());
app.use("/api", createPlannerBridgeRouter({ recordBorrow, getActiveItemTypeCount }));
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

run("INSERT INTO registered_users (employee_id,name,active) VALUES ('1001','김철수',1)");
run("INSERT INTO scenario_items (id,name,stock,rented,sector,root_slot) VALUES ('000001','Apple',10,0,'Seoul-Root','000100'),('000002','Plate',6,0,'Seoul-Root','000101')");
run("INSERT INTO scenario_item_variants (item_id,name,stock,rented,sort_order) VALUES ('000002','Pink',3,0,1),('000002','White',3,0,2)");
run(`INSERT INTO settings (key,value) VALUES ('floor_plan','{"floors":[{"id":"2F","name":"2F","units":[{"label":"Unit 1"},{"label":"Human Unit 1","exempt":true}]}]}')`);
const pink = get("SELECT id FROM scenario_item_variants WHERE name='Pink'").id;
const call = (path, { key = process.env.PLANNER_BRIDGE_KEY, body } = {}) => fetch(origin + "/api" + path, {
  method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(key ? { "x-planner-key": key } : {}) }, body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, body: await r.json() }));

test("키가 없거나 틀리면 막는다", async () => {
  assert.equal((await call("/planner-bridge/items", { key: "" })).status, 401);
  assert.equal((await call("/planner-bridge/items", { key: "wrong" })).status, 401);
});

test("재고·종류·명부·좌석을 읽는다", async () => {
  const items = (await call("/planner-bridge/items?ids=1,000002")).body.items;
  assert.deepEqual(Object.keys(items).sort(), ["000001", "000002"]);
  assert.deepEqual(items["000002"].variants.map((v) => [v.name, v.stock]), [["Pink", 3], ["White", 3]]);
  assert.equal(items["000001"].location, "Seoul-Root · 000100");
  assert.deepEqual((await call("/planner-bridge/people")).body.people, [{ employeeId: "1001", name: "김철수" }]);
  const seats = (await call("/planner-bridge/seats")).body;
  assert.deepEqual(seats.floors[0].units, [{ label: "Unit 1", exempt: false }, { label: "Human Unit 1", exempt: true }]);
});

test("루틴 대여 신청은 WMS 일반 대여로 들어가고 종류 재고를 뺀다", async () => {
  const r = await call("/planner-bridge/rentals", { body: { employeeId: "1001", floor: "2F", unit: "Unit 1", purpose: "촬영 계획 #1 · 루틴 1", items: [{ id: "000002", name: "Plate", variantId: pink, quantity: 2 }, { id: "1", name: "Apple", quantity: 1 }] } });
  assert.equal(r.body.success, true, r.body.error);
  assert.ok(Number(r.body.pickupTimeoutMinutes) > 0);
  const rows = all("SELECT * FROM general_rentals WHERE request_no = ?", [r.body.requestNo]);
  assert.equal(rows.length, 2);
  assert.equal(get('SELECT rental_mode FROM rental_requests WHERE id=?',[r.body.requestNo]).rental_mode,'planner');
  assert.ok(rows.every((x) => x.employee_id === "1001" && x.category === "촬영 계획"));
  assert.equal(get("SELECT stock FROM scenario_item_variants WHERE id=?", [pink]).stock, 1);
  const status = (await call(`/planner-bridge/rentals?requestNos=${r.body.requestNo}`)).body.rentals[r.body.requestNo];
  assert.equal(status.state, "requested");
  run("UPDATE general_rentals SET confirmed_at='x' WHERE request_no=?", [r.body.requestNo]);
  assert.equal((await call(`/planner-bridge/rentals?requestNos=${r.body.requestNo}`)).body.rentals[r.body.requestNo].state, "confirmed");
});

test("명부에 없는 사번, 좌석 없음, 종류 한도 초과는 막는다", async () => {
  assert.equal((await call("/planner-bridge/rentals", { body: { employeeId: "9999", floor: "2F", unit: "Unit 1", items: [{ id: "000001", quantity: 1 }] } })).status, 400);
  assert.equal((await call("/planner-bridge/rentals", { body: { employeeId: "1001", items: [{ id: "000001", quantity: 1 }] } })).status, 400);
  run("INSERT INTO settings (key,value) VALUES ('max_item_types_default','1')");
  const blocked = await call("/planner-bridge/rentals", { body: { employeeId: "1001", floor: "2F", unit: "Unit 1", items: [{ id: "000001", quantity: 1 }] } });
  assert.equal(blocked.status, 409);
  // 한도 제외 좌석은 통과
  const exempt = await call("/planner-bridge/rentals", { body: { employeeId: "1001", floor: "2F", unit: "Human Unit 1", items: [{ id: "000001", quantity: 1 }] } });
  assert.equal(exempt.body.success, true, exempt.body.error);
  run("DELETE FROM settings WHERE key='max_item_types_default'");
});

test("종류가 나뉜 물품을 종류 없이 신청하면 WMS가 막는다", async () => {
  const r = await call("/planner-bridge/rentals", { body: { employeeId: "1001", floor: "2F", unit: "Unit 1", items: [{ id: "000002", quantity: 1 }] } });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /종류를 선택/);
});

test("루틴 예약 대여: 예약 → 시각이 되면 대여로 바뀌고 신청 번호가 생긴다, 취소도 된다", async () => {
  const { promoteDueReservations } = await import("../lib/reservationPromotion.js");
  const startsAt = new Date(Math.ceil((Date.now() + 30 * 60000) / 60000) * 60000).toISOString();
  const r = await call("/planner-bridge/reservations", { body: { employeeId: "1001", floor: "2F", unit: "Human Unit 1", startsAt, clientId: "plan1-r0-1001-test", items: [{ id: "000002", variantId: pink, quantity: 1 }] } });
  assert.equal(r.body.success, true, r.body.error);
  const [id] = r.body.ids;
  assert.equal((await call(`/planner-bridge/reservations?ids=${id}`)).body.reservations[id].status, "reserved");
  // 시각을 10분 안쪽으로 당겨 WMS 자동 전환이 지금 처리하게 한다.
  run("UPDATE item_reservations SET starts_at_ms = ? WHERE id = ?", [Math.ceil((Date.now() + 2 * 60000) / 60000) * 60000, id]);
  await promoteDueReservations(recordBorrow);
  const after = (await call(`/planner-bridge/reservations?ids=${id}`)).body.reservations[id];
  assert.equal(after.status, "fulfilled");
  assert.ok(after.requestNo > 0);
  assert.equal(get('SELECT rental_mode FROM rental_requests WHERE id=?',[after.requestNo]).rental_mode,'planner');
  assert.equal(all("SELECT * FROM general_rentals WHERE request_no = ?", [after.requestNo]).length, 1);
  // 두 번째 예약은 취소
  const r2 = await call("/planner-bridge/reservations", { body: { employeeId: "1001", floor: "2F", unit: "Human Unit 1", startsAt, clientId: "plan1-r1-1001-test", items: [{ id: "000001", quantity: 1 }] } });
  assert.equal(r2.body.success, true, r2.body.error);
  const c = await call("/planner-bridge/reservations/cancel", { body: { employeeId: "1001", ids: r2.body.ids } });
  assert.equal(c.body.success, true, c.body.error);
  assert.equal(c.body.reservations[r2.body.ids[0]].status, "cancelled");
  // 지난 시각·남의 예약 취소는 막는다
  assert.equal((await call("/planner-bridge/reservations", { body: { employeeId: "1001", floor: "2F", unit: "Unit 1", startsAt: new Date(Date.now() - 60000).toISOString(), clientId: "plan1-r2-1001-test", items: [{ id: "000001", quantity: 1 }] } })).status, 409);
});

test("물품·종류 사진은 WMS에 올린 경로(/uploads/)만 함께 보낸다", async () => {
  run("UPDATE scenario_items SET image_path = '/uploads/scenario_items/000001/original-1.webp' WHERE id = '000001'");
  run("UPDATE scenario_item_variants SET image_path = '/uploads/scenario_variants/000002_1/original-2.webp' WHERE name = 'Pink'");
  run("UPDATE scenario_item_variants SET image_path = 'https://drive.example/old.png' WHERE name = 'White'");
  try {
    const items = (await call("/planner-bridge/items?ids=000001,000002")).body.items;
    assert.equal(items["000001"].image, "/uploads/scenario_items/000001/original-1.webp");
    assert.equal(items["000002"].image, "");
    assert.deepEqual(items["000002"].variants.map((v) => [v.name, v.image]), [["Pink", "/uploads/scenario_variants/000002_1/original-2.webp"], ["White", ""]]);
  } finally {
    run("UPDATE scenario_items SET image_path = NULL WHERE id = '000001'");
    run("UPDATE scenario_item_variants SET image_path = NULL WHERE item_id = '000002'");
  }
});
