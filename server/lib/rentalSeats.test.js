import test from "node:test";
import assert from "node:assert/strict";
import { rentalSeatIndex, rentalSeatOf } from "./rentalSeats.js";

test("과거 부분 반납의 좌석은 동일 신청·동일 대여자에게서만 복구", () => {
  const original = { batch_id: "batch-1", borrower_name: "검증 사용자", floor: "B2", unit: "Unit 1" };
  const partial = { ...original, floor: null, unit: null };
  const index = rentalSeatIndex([original, partial]);
  assert.deepEqual(rentalSeatOf(partial, index), { floor: "B2", unit: "Unit 1" });
  assert.deepEqual(rentalSeatOf({ ...partial, borrower_name: "다른 사용자" }, index), { floor: "", unit: "" });
  assert.deepEqual(rentalSeatOf({ ...partial, batch_id: "" }, index), { floor: "", unit: "" });
  assert.deepEqual(rentalSeatOf(original, index), { floor: "B2", unit: "Unit 1" });
});
test("복구 후보가 여러 좌석이면 임의로 하나를 골라 쓰지 않음", () => {
  const row = { batch_id: "b1", borrower_name: "검증 사용자" };
  const index = rentalSeatIndex([{ ...row, floor: "B2", unit: "Unit 1" }, { ...row, floor: "2F", unit: "Unit 2" }]);
  assert.deepEqual(rentalSeatOf(row, index), { floor: "", unit: "" });
  assert.deepEqual(rentalSeatOf({ ...row, floor: "B2" }, index), { floor: "B2", unit: "Unit 1" });
});

test("부분 반납·좌석별 재대여·재고 부족을 실제 API에서 검증", async (t) => {
  process.env.WMS_DB_PATH = ":memory:";
  process.env.SM_SYNC = "off";
  const { run, get } = await import("../db.js");
  const { default: express } = await import("express");
  const { gasRouter } = await import("../routes/gas.js");
  const { issueAdminSession } = await import("./auth.js");
  const admin = run("INSERT INTO admin_users (login_id,password_hash,name) VALUES ('seat-test','test-only','테스트 관리자')");
  const token = issueAdminSession(Number(admin.lastInsertRowid));
  run("INSERT INTO registered_users (employee_id,name,active) VALUES ('1111','검증 사용자',1)");
  run("INSERT INTO scenario_items (id,name,stock,rented) VALUES ('000001','공',8,2),('000002','컵',8,2)");
  run("INSERT INTO general_rentals (borrower_name,employee_id,item_id,item_label,qty,returned,status,batch_id,floor,unit) VALUES ('검증 사용자','1111','000001','공',2,'X','active','general-batch','B2','Unit 1')");
  run("INSERT INTO sid_rentals (borrower_name,employee_id,sid,item_label,returned,status,batch_id,floor,unit) VALUES ('검증 사용자','1111','S00001','[000002] 컵 x 2','X','active','sid-batch','2F','Unit 3')");
  const app = express(); app.use("/api", gasRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/gas`;
  const post = async (action, payload) => (await fetch(base, { method: "POST", headers: { "Content-Type": "text/plain", "x-admin-token": token }, body: JSON.stringify({ action, payload }) })).json();
  const entry = (floor, unit, id, qty = 1) => ({ itemType: "general", borrowerName: "검증 사용자", employeeId: "1111", affiliation: "cfgw", borrowPurpose: "재대여 검증", floor, unit, generalOption: "재대여", borrowedItems: [{ id, name: id === "000001" ? "공" : "컵", quantity: qty }] });
  try {
    await t.test("일반·SID 부분 반납 모두 좌석과 사번 유지", async () => {
      for (const [sheetType, table] of [["general", "general_rentals"], ["scenario", "sid_rentals"]]) {
        const response = await post("processReturn", { returnRequests: [{ sheetType, rowIndex: 1, quantity: 1 }] });
        assert.equal(response.success, true, JSON.stringify(response));
        const partial = get(`SELECT * FROM ${table} WHERE returned='O'`);
        assert.equal(partial.employee_id, "1111"); assert.ok(partial.floor); assert.ok(partial.unit);
      }
    });
    await t.test("좌석이 누락된 기존 부분 반납도 조회에서 원래 좌석 복구", async () => {
      run("UPDATE general_rentals SET floor=NULL,unit=NULL WHERE returned='O'");
      const response = await (await fetch(base + "?action=getScenarioAllLogs&scope=returned", { headers: { "x-admin-token": token } })).json();
      assert.equal(response.success, true, JSON.stringify(response));
      const partial = response.items.find((row) => row.sheetType === "general");
      assert.equal(partial.floor, "B2"); assert.equal(partial.unit, "Unit 1");
    });
    await t.test("기존 좌석·새 좌석은 새 대여에 저장되고 재고 반영", async () => {
      const before = get("SELECT stock FROM scenario_items WHERE id='000001'").stock;
      const response = await post("recordBorrow", { borrowList: [entry("B2", "Unit 1", "000001"), entry("B1", "Unit 9", "000002")] });
      assert.equal(response.success, true, JSON.stringify(response));
      const created = get("SELECT * FROM general_rentals WHERE item_id='000002' ORDER BY id DESC LIMIT 1");
      assert.equal(created.floor, "B1"); assert.equal(created.unit, "Unit 9");
      assert.equal(get("SELECT stock FROM scenario_items WHERE id='000001'").stock, before - 1);
      assert.equal(get("SELECT floor FROM general_rentals WHERE returned='O'").floor, null);
    });
    await t.test("재고 부족은 새 로그를 만들지 않고 재고도 유지", async () => {
      const before = get("SELECT stock FROM scenario_items WHERE id='000001'").stock;
      const count = get("SELECT COUNT(*) AS n FROM general_rentals").n;
      const response = await post("recordBorrow", { borrowList: [entry("B2", "Unit 1", "000001", 999)] });
      assert.equal(response.success, false); assert.match(response.message, /재고 부족/);
      assert.equal(get("SELECT stock FROM scenario_items WHERE id='000001'").stock, before);
      assert.equal(get("SELECT COUNT(*) AS n FROM general_rentals").n, count);
    });
  } finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});
