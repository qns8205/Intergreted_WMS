import test from "node:test";
import assert from "node:assert/strict";

process.env.WMS_DB_PATH = ":memory:";
const { db, run, get, all } = await import("../db.js");
const { applyWarehouseRentBulk, warehouseLoanGroups } = await import("./warehouseRentals.js");
const { toInventoryItem } = await import("./serialize.js");

function reset() {
  for (const table of ["warehouse_rental_logs", "warehouse_items", "inventory_history", "registered_users"]) db.exec(`DELETE FROM ${table}`);
  run("INSERT INTO registered_users (employee_id,name,active) VALUES ('1111','검증 사용자',1),('2222','다른 사용자',1)");
  run("INSERT INTO warehouse_items (location,name,stock,consumable) VALUES ('A-01-1','공구','10','N'),('A-01-2','부품','5','Y')");
}
function entry(type, qty = 1, overrides = {}) {
  return { type, location: "A-01-1", name: "공구", qty, user: "검증 사용자", employeeId: "1111", note: "테스트", ...overrides };
}
function stock(name = "공구") { return Number(get("SELECT stock FROM warehouse_items WHERE name=?", [name]).stock); }
function outstanding(employeeId = "1111") { return [...warehouseLoanGroups().values()].filter((group) => group.employeeId === employeeId).reduce((sum, group) => sum + group.qty, 0); }

test("공구 대여·소모·반납의 재고와 미반납 장부", async (t) => {
  await t.test("대여는 재고를 차감하고 실제 반납 수량만 복구", () => {
    reset();
    applyWarehouseRentBulk([entry("대여", 3)]);
    assert.equal(stock(), 7); assert.equal(outstanding(), 3);
    applyWarehouseRentBulk([entry("반납", 2)]);
    assert.equal(stock(), 9); assert.equal(outstanding(), 1);
    assert.deepEqual(all("SELECT diff FROM inventory_history ORDER BY id").map((row) => row.diff), [-3, 2]);
  });
  await t.test("직접 소모는 재고만 차감하며 기존 대여 수량을 해소하지 않음", () => {
    reset();
    applyWarehouseRentBulk([entry("대여", 2), entry("소모", 3)]);
    assert.equal(stock(), 5); assert.equal(outstanding(), 2);
    applyWarehouseRentBulk([entry("반납", 2)]);
    assert.equal(stock(), 7); assert.equal(outstanding(), 0);
  });
  await t.test("소모만 한 경우 대여·반납 목록에 들어가지 않음", () => {
    reset(); applyWarehouseRentBulk([entry("소모", 3)]);
    assert.equal(stock(), 7); assert.equal(outstanding(), 0);
    assert.equal(warehouseLoanGroups().size, 0);
    assert.throws(() => applyWarehouseRentBulk([entry("반납", 1)]), /대여 중인 수량은 0/);
    assert.equal(stock(), 7);
  });
  await t.test("먼저 소모한 뒤 대여해도 새 대여가 전부 미반납으로 잡힘", () => {
    reset(); applyWarehouseRentBulk([entry("소모", 3), entry("대여", 2)]);
    assert.equal(stock(), 5); assert.equal(outstanding(), 2);
  });
  await t.test("이미 빌린 물품의 소모 전환은 이중 차감이나 재고 복구 없이 장부만 닫음", () => {
    for (const type of ["소모", "반납"]) {
      reset(); applyWarehouseRentBulk([entry("대여", 2)]);
      applyWarehouseRentBulk([entry(type, 1, { note: "[소모완료] 관리자 반납 중 소모 처리" })]);
      assert.equal(stock(), 8); assert.equal(outstanding(), 1);
      assert.equal(get("SELECT COUNT(*) AS n FROM inventory_history").n, 1);
    }
  });
  await t.test("신규 소모 메모에 소모완료라는 태그를 써도 기존 대여와 구분", () => {
    reset(); applyWarehouseRentBulk([entry("대여", 2)]);
    applyWarehouseRentBulk([entry("소모", 3, { resolveLoan: false, note: "[소모완료] 메모" })]);
    assert.equal(stock(), 5); assert.equal(outstanding(), 2);
  });
  await t.test("반납 수량 초과·중복 반납은 재고를 늘리지 않음", () => {
    reset(); applyWarehouseRentBulk([entry("대여", 2)]);
    assert.throws(() => applyWarehouseRentBulk([entry("반납", 3)]), /대여 중인 수량은 2/);
    assert.equal(stock(), 8);
    applyWarehouseRentBulk([entry("반납", 2)]);
    assert.throws(() => applyWarehouseRentBulk([entry("반납", 2)]), /대여 중인 수량은 0/);
    assert.equal(stock(), 10);
  });
  await t.test("다른 사람의 반납이나 소모가 기존 대여자의 장부를 지우지 않음", () => {
    reset(); applyWarehouseRentBulk([entry("대여", 2)]);
    applyWarehouseRentBulk([entry("소모", 1, { employeeId: "2222", user: "다른 사용자" })]);
    assert.throws(() => applyWarehouseRentBulk([entry("반납", 1, { employeeId: "2222", user: "다른 사용자" })]), /대여 중인 수량은 0/);
    assert.equal(stock(), 7); assert.equal(outstanding(), 2); assert.equal(outstanding("2222"), 0);
  });
  await t.test("소모품 플래그를 화면에 제공하며 대여로 요청해도 소모 처리", () => {
    reset(); const item = get("SELECT * FROM warehouse_items WHERE name='부품'");
    assert.equal(toInventoryItem(item).isConsumable, true);
    assert.equal(toInventoryItem(get("SELECT * FROM warehouse_items WHERE name='공구'")).isConsumable, false);
    applyWarehouseRentBulk([entry("대여", 2, { itemId: item.id, name: "부품", location: "A-01-2" })]);
    assert.equal(stock("부품"), 3); assert.equal(outstanding(), 0);
    assert.equal(get("SELECT type FROM warehouse_rental_logs").type, "소모");
  });
  await t.test("재고 부족이면 묶음 전체를 되돌려 재시도 이중 차감을 방지", () => {
    reset();
    assert.throws(() => applyWarehouseRentBulk([entry("대여", 2), entry("소모", 9)]), /재고가 부족/);
    assert.equal(stock(), 10);
    assert.equal(get("SELECT COUNT(*) AS n FROM warehouse_rental_logs").n, 0);
    assert.equal(get("SELECT COUNT(*) AS n FROM inventory_history").n, 0);
  });
  await t.test("잘못된 수량이나 없는 물품은 기록과 재고를 바꾸지 않음", () => {
    reset();
    for (const qty of [0, -1, Infinity, "오류"]) assert.throws(() => applyWarehouseRentBulk([entry("소모", qty)]), /수량/);
    assert.throws(() => applyWarehouseRentBulk([entry("소모", 1, { itemId: 999999 })]), /찾을 수 없/);
    assert.equal(stock(), 10); assert.equal(get("SELECT COUNT(*) AS n FROM warehouse_rental_logs").n, 0);
  });
  await t.test("대여 중 위치가 바뀌어도 원래 대여를 닫고 현재 보관 재고를 복구", () => {
    reset(); applyWarehouseRentBulk([entry("대여", 2)]);
    run("UPDATE warehouse_items SET location='A-01-3' WHERE name='공구'");
    applyWarehouseRentBulk([entry("반납", 2)]);
    assert.equal(stock(), 10); assert.equal(outstanding(), 0);
  });
});

test("실제 GAS 경로에서도 소모는 대여 목록에 들어가지 않고 재고가 일치", async () => {
  process.env.SM_SYNC = "off";
  const { default: express } = await import("express");
  const { gasRouter } = await import("../routes/gas.js");
  reset();
  const app = express(); app.use("/api", gasRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/gas`;
  async function post(items) {
    return (await fetch(base, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ action: "rentInventoryItemsBulk", payload: { items } }) })).json();
  }
  try {
    assert.equal((await post([entry("대여", 2), entry("소모", 3)])).success, true);
    const loans = await (await fetch(base + "?action=getWarehouseBorrowedItems")).json();
    assert.equal(loans.success, true); assert.equal(loans.items.length, 1); assert.equal(loans.items[0].quantity, 2);
    const inventory = await (await fetch(base + "?action=getWarehouseInventoryOnly")).json();
    assert.equal(Number(inventory.inventory.find((item) => item.name === "공구").stock), 5);
    assert.equal((await post([entry("반납", 2)])).success, true);
    assert.equal(stock(), 7);
    const empty = await (await fetch(base + "?action=getWarehouseBorrowedItems")).json();
    assert.deepEqual(empty.items, []);
  } finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});
