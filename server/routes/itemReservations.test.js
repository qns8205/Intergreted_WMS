import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { fileURLToPath } from "node:url";
import { reservationDay } from "../../shared/reservationTime.js";
process.env.WMS_DB_PATH = ":memory:";
process.env.SM_SYNC = "off";
process.env.WMS_HTTPS_CONFIG = fileURLToPath(new URL("../fixtures/https-auth-test.json", import.meta.url));
const { db, run, all, get } = await import("../db.js");
const { createBorrowerAuthRouter } = await import("./borrowerAuth.js");
const { gasRouter } = await import("./gas.js");
const app = express();
app.use((req, _res, next) => { req.socket.encrypted = true; next(); });
app.use("/api", createBorrowerAuthRouter({ verify: async () => ({ ok: true }) }));
app.use("/api", gasRouter);
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
run("INSERT INTO registered_users (employee_id,name,active) VALUES ('1234','예약자 A',1),('5678','대여자 B',1)");
run("INSERT INTO scenario_items (id,name,stock,rented) VALUES ('000001','예약 물품',1,0),('000002','종류 물품',3,0)");
run("INSERT INTO scenario_item_variants (id,item_id,name,stock) VALUES (1,'000002','빨강',1),(2,'000002','파랑',2)");
async function login(employeeId) {
  const res = await fetch(origin + "/api/borrower-auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeId, password: "test" }) });
  return res.headers.get("set-cookie").split(";")[0];
}
const a = await login("1234"), b = await login("5678");
const post = async (action, payload, cookie = a) => (await fetch(origin + "/api/gas", { method: "POST", headers: { "Content-Type": "text/plain", Cookie: cookie }, body: JSON.stringify({ action, payload }) })).json();
const query = async (action, cookie = a, params = "") => (await fetch(`${origin}/api/gas?action=${action}${params}`, { headers: { Cookie: cookie } })).json();
const reservePayload = { clientId: "reservation-test-1", floor: "B2", unit: "Unit 1", startsAt: new Date(reservationDay().end).toISOString(), items: [{ id: "1", quantity: 1 }] };
let reservationId;
const borrow = (employeeId, reservationId) => ({ borrowList: [{ employeeId, borrowerName: employeeId === "1234" ? "예약자 A" : "대여자 B", affiliation: "cfgw", itemType: "general", borrowPurpose: "", floor: "B1", unit: "Unit 2", borrowedItems: [{ id: "000001", name: "예약 물품", quantity: 1, reservationId }] }] });

test("재고 1개 예약은 재고를 유지하고 중복 요청도 한 번만 저장한다", async () => {
  const result = await post("reserveItems", reservePayload);
  assert.equal(result.success, true);
  reservationId = result.ids[0];
  assert.deepEqual((await post("reserveItems", reservePayload)).ids, [reservationId]);
  assert.equal(get("SELECT stock FROM scenario_items WHERE id='000001'").stock, 1);
  assert.equal(all("SELECT * FROM general_rentals").length, 0);
  const theirs = await query("getReservations", b);
  assert.equal(theirs.items[0].mine, false);
  assert.equal(theirs.items[0].borrowerName, "예약자 A");
  assert.ok(!("employeeId" in theirs.items[0]) && !("floor" in theirs.items[0]));
});
test("예정 시간·현재 재고·종류별 수량 검증은 전체 예약을 원자적으로 막는다", async () => {
  for (const patch of [
    { startsAt: new Date(Date.now()-1000).toISOString() },
    { startsAt: new Date(reservationDay().end + 60_000).toISOString() },
    { startsAt: "2026-10-20T12:00" },
    { items: [{ id: "1", quantity: 2 }] },
    { items: [{ id: "2", quantity: 1 }] },
    { items: [{ id: "2", variantId: 1, quantity: 2 }] },
    { items: [{ id: "1", quantity: 1 }, { id: "999", quantity: 1 }] },
  ]) assert.equal((await post("reserveItems", { ...reservePayload, clientId: "invalid-test", ...patch })).success, false);
  assert.equal(all("SELECT * FROM item_reservations").length, 1);
});
test("다른 대여자는 예약 안내 미확인만으로 막히지 않고 재고가 있으면 정상적으로 빌릴 수 있다", async () => {
  assert.equal((await post("recordBorrow", borrow("5678"), b)).success, true);
  assert.equal((await post("acknowledgeReservationNotice", { reservationIds: [reservationId] }, b)).success, true);
  assert.equal((await post("recordBorrow", borrow("5678"), b)).success, false, "실제 재고 부족은 여전히 차단한다");
  assert.equal(get("SELECT stock FROM scenario_items WHERE id='000001'").stock, 0);
  const mine = (await query("getMyReservations")).items[0];
  assert.equal(mine.available, false);
  assert.equal(mine.stock, 0);
  const borrowers = (await query("getReservationBorrowers", a, `&reservationId=${reservationId}`)).borrowers;
  assert.equal(borrowers[0].borrowerName, "대여자 B");
  assert.equal(borrowers[0].floor, "B1");
  assert.equal(borrowers[0].unit, "Unit 2");
  assert.equal(borrowers[0].reservationNoticeSeen, true);
});
test("예약 정보·취소는 본인만 허용하고 일반 대여자 조회에는 좌석을 노출하지 않는다", async () => {
  assert.equal((await query("getMyReservations", b)).items.length, 0);
  assert.equal((await query("getReservationBorrowers", b, `&reservationId=${reservationId}`)).success, false);
  assert.equal((await post("cancelItemReservation", { reservationId }, b)).success, false);
  const rows = (await query("getItemBorrowers", b, `&itemId=1&reservationId=${reservationId}`)).borrowers;
  assert.ok(!("floor" in rows[0]));
});
test("실제 대여 성공 시에만 예약을 완료하고 중복 대여를 막는다", async () => {
  assert.equal((await post("recordBorrow", borrow("1234", reservationId))).success, false);
  assert.equal(get("SELECT status FROM item_reservations WHERE id=?", [reservationId]).status, "reserved");
  run("UPDATE item_reservations SET starts_at_ms=? WHERE id=?", [Date.now()-1000,reservationId]);
  assert.equal((await post("recordBorrow", borrow("1234", reservationId))).success, false);
  run("UPDATE general_rentals SET returned='O', status='archived'");
  run("UPDATE scenario_items SET stock=1,rented=0 WHERE id='000001'");
  assert.equal((await query("getMyReservations")).items.length, 1, "전환된 미수령 예약은 본인 목록에도 유지한다");
  assert.ok(get("SELECT request_no FROM item_reservations WHERE id=?", [reservationId]).request_no);
  assert.equal(get("SELECT status FROM item_reservations WHERE id=?", [reservationId]).status, "fulfilled");
  assert.equal((await query("getMyReservations")).items[0].status, "fulfilled");
  assert.equal((await post("recordBorrow", borrow("1234", reservationId))).success, false);
});
test("예약 취소는 재고를 변경하지 않고 그리드 안내에서도 사라진다", async () => {
  const result = await post("reserveItems", { ...reservePayload, clientId: "reservation-cancel", items: [{ id: "2", quantity: 1, variantId: 1 }] });
  assert.equal(result.success, true);
  const before = get("SELECT stock FROM scenario_items WHERE id='000002'").stock;
  assert.equal((await post("cancelItemReservation", { reservationId: result.ids[0] })).success, true);
  assert.equal(get("SELECT stock FROM scenario_items WHERE id='000002'").stock, before);
  assert.equal((await query("getReservations")).items.length, 0);
});
test.after(async () => { await new Promise((resolve) => server.close(resolve)); db.close(); });
