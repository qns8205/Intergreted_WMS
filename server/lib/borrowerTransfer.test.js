import test from "node:test";
import assert from "node:assert/strict";

// 운영 장부는 사용하지 않는다. 메모리 DB에 넘기는 사람·받는 사람과 대여 줄을 직접 만든다.
process.env.WMS_DB_PATH = ":memory:";
const { db, run, get, all } = await import("../db.js");
const { transferableItemsFor, transferItems } = await import("./borrowerTransfer.js");

function reset() {
  for (const table of ["registered_users", "scenario_items", "sid_rentals", "general_rentals", "rental_requests", "warehouse_items", "warehouse_rental_logs", "inventory_history"]) db.exec(`DELETE FROM ${table}`);
  run("INSERT INTO registered_users (employee_id,name,active) VALUES ('1111','넘기는사람',1),('2222','받는사람',1)");
  run("INSERT INTO scenario_items (id,name,stock,rented) VALUES ('000001','Scanner',5,3)");
  run("INSERT INTO warehouse_items (location,name,stock,consumable) VALUES ('B-01','드라이버','4','')");
}
function rental({ qty = 3, pickedUp = true } = {}) {
  return Number(run(
    "INSERT INTO general_rentals (borrower_name,employee_id,item_id,item_label,qty,returned,status,picked_up_at,applied_at) VALUES ('넘기는사람','1111','000001','Scanner',?,'X','active',?,'2026-10-13 09:00:00')",
    [qty, pickedUp ? "2026-10-13 09:05:00" : null],
  ).lastInsertRowid);
}
// 테스트 대여 줄은 대부분 대여 방식이 없는 예전 대여라, 기본으로 일반 대여를 골라 둔다.
const transfer = (items, extra = {}) => transferItems({ fromEmployeeId: "1111", toEmployeeId: "2222", items, floor: "B1", unit: "Unit 5", rentalTerms: { mode: "general" }, ...extra });

test("대여자 양도", async (t) => {
  await t.test("일부 수량만 넘기면 원래 줄은 남고, 받는 사람은 대여 확인된 줄을 받으며 재고는 그대로다", () => {
    reset();
    const id = rental({ qty: 3 });
    const result = transfer([{ key: `general:${id}`, quantity: 2 }]);
    assert.equal(result.movedQty, 2);
    assert.equal(get("SELECT qty FROM general_rentals WHERE id=?", [id]).qty, 1);
    const closed = get("SELECT * FROM general_rentals WHERE employee_id='1111' AND return_source='transfer'");
    assert.equal(closed.qty, 2);
    assert.equal(closed.returned, "O");
    const opened = get("SELECT * FROM general_rentals WHERE employee_id='2222'");
    assert.equal(opened.qty, 2);
    assert.equal(opened.category, "양도");
    assert.ok(opened.picked_up_at);
    assert.equal(`${opened.floor}/${opened.unit}`, "B1/Unit 5");
    assert.equal(opened.request_no, result.requestNo);
    assert.deepEqual({ ...get("SELECT stock, rented FROM scenario_items WHERE id='000001'") }, { stock: 5, rented: 3 });
  });

  await t.test("대여 확인 전 물품은 목록에서 막히고 서버도 거부한다", () => {
    reset();
    const id = rental({ pickedUp: false });
    const [item] = transferableItemsFor("1111");
    assert.equal(item.transferable, false);
    assert.equal(item.reason, "대여 확인 전");
    assert.throws(() => transfer([{ key: `general:${id}`, quantity: 1 }]), /대여 확인 전/);
  });

  await t.test("남의 물품·본인 지정·한도 초과는 아무것도 바꾸지 않는다", () => {
    reset();
    const id = rental();
    assert.throws(() => transferItems({ fromEmployeeId: "2222", toEmployeeId: "1111", items: [{ key: `general:${id}`, quantity: 1 }] }), /본인이 대여 중이 아닌/);
    assert.throws(() => transfer([{ key: `general:${id}`, quantity: 1 }], { toEmployeeId: "1111" }), /본인에게는/);
    assert.throws(() => transfer([{ key: `general:${id}`, quantity: 1 }], { checkTypeLimit: () => { throw Error("한도 초과"); } }), /한도 초과/);
    assert.equal(all("SELECT * FROM general_rentals").length, 1);
    assert.equal(all("SELECT * FROM rental_requests").length, 0);
  });

  await t.test("COS 물품은 반납·대여 기록으로 옮기고 재고는 변하지 않는다", () => {
    reset();
    run("INSERT INTO warehouse_rental_logs (occurred_at,type,location,name,qty,manager,employee_id) VALUES ('2026-10-13 09:00:00','대여','B-01','드라이버',2,'넘기는사람','1111')");
    const tool = transferableItemsFor("1111").find((i) => i.kind === "warehouse");
    assert.ok(tool.key.startsWith("warehouse:"));
    transfer([{ key: tool.key, quantity: 2 }]);
    assert.equal(get("SELECT stock FROM warehouse_items WHERE name='드라이버'").stock, "4");
    assert.equal(transferableItemsFor("1111").length, 0);
    assert.equal(transferableItemsFor("2222").find((i) => i.kind === "warehouse").quantity, 2);
  });

  await t.test("사유 대여는 사유가 그대로 옮겨지고, 일반 대여는 4시간 기한이 양도 시점부터 다시 시작된다", () => {
    reset();
    const reasonReq = Number(run("INSERT INTO rental_requests (borrower_name,employee_id,rental_mode,rental_reason) VALUES ('넘기는사람','1111','reason','KTL')").lastInsertRowid);
    const generalReq = Number(run("INSERT INTO rental_requests (borrower_name,employee_id,rental_mode,rental_general_since) VALUES ('넘기는사람','1111','general','2026-10-13 10:00:00')").lastInsertRowid);
    const a = rental({ qty: 1 }), b = rental({ qty: 1 });
    run("UPDATE general_rentals SET request_no=? WHERE id=?", [reasonReq, a]);
    run("UPDATE general_rentals SET request_no=? WHERE id=?", [generalReq, b]);
    const result = transfer([{ key: `general:${a}`, quantity: 1 }, { key: `general:${b}`, quantity: 1 }]);
    assert.equal(result.requestNos.length, 2);
    const terms = all("SELECT q.rental_mode, q.rental_reason, q.rental_general_since, r.picked_up_at FROM general_rentals r JOIN rental_requests q ON q.id=r.request_no WHERE r.employee_id='2222' ORDER BY q.rental_mode");
    assert.deepEqual(terms.map((x) => [x.rental_mode, x.rental_reason]), [["general", null], ["reason", "KTL"]]);
    assert.equal(terms[0].rental_general_since, null);
    assert.notEqual(terms[0].picked_up_at, "2026-10-13 09:05:00");
  });

  await t.test("대여 방식이 없는 예전 대여는 방식을 골라야 양도되고, 고른 방식이 한 번에 적용된다", () => {
    reset();
    const legacy1 = rental({ qty: 1 }), legacy2 = rental({ qty: 1 });
    const reasonReq = Number(run("INSERT INTO rental_requests (borrower_name,employee_id,rental_mode,rental_reason) VALUES ('넘기는사람','1111','reason','KTL')").lastInsertRowid);
    const withMode = rental({ qty: 1 });
    run("UPDATE general_rentals SET request_no=? WHERE id=?", [reasonReq, withMode]);
    const list = transferableItemsFor("1111");
    assert.equal(list.find((i) => i.key === `general:${legacy1}`).needsRentalMode, true);
    assert.equal(list.find((i) => i.key === `general:${withMode}`).needsRentalMode, false);
    const keys = [legacy1, legacy2, withMode].map((id) => ({ key: `general:${id}`, quantity: 1 }));
    assert.throws(() => transfer(keys, { rentalTerms: undefined }), /대여 방식을 선택/);
    assert.throws(() => transfer(keys, { rentalTerms: { mode: "reason", reason: " " } }), /사유/);
    assert.equal(all("SELECT * FROM general_rentals WHERE employee_id='2222'").length, 0);
    const result = transfer(keys, { rentalTerms: { mode: "reason", reason: "인퍼런스" } });
    assert.equal(result.requestNos.length, 2);
    const got = all("SELECT q.rental_mode m, q.rental_reason r FROM general_rentals g JOIN rental_requests q ON q.id=g.request_no WHERE g.employee_id='2222' ORDER BY g.id");
    assert.deepEqual(got.map((x) => `${x.m}/${x.r}`), ["reason/인퍼런스", "reason/인퍼런스", "reason/KTL"]);
  });

  await t.test("방식이 모두 정해진 물품만 넘기면 선택 없이 양도된다", () => {
    reset();
    const q = Number(run("INSERT INTO rental_requests (borrower_name,employee_id,rental_mode) VALUES ('넘기는사람','1111','general')").lastInsertRowid);
    const id = rental({ qty: 1 });
    run("UPDATE general_rentals SET request_no=? WHERE id=?", [q, id]);
    assert.equal(transfer([{ key: `general:${id}`, quantity: 1 }]).movedQty, 1);
  });
});
