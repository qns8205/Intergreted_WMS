import test from "node:test";
import assert from "node:assert/strict";

// 운영 장부는 사용하지 않는다. 시계와 DB를 고정해 20분 경계값을 검증한다.
process.env.WMS_DB_PATH = ":memory:";
delete process.env.WMS_PICKUP_TIMEOUT_MIN;
const { db, run, get } = await import("../db.js");
const { cancelUnclaimedPickups, getPickupTimeoutMinutes } = await import("./pickupTimeout.js");
const originalNow = Date.now;
const frozenNow = new Date(2026, 8, 30, 12, 0, 0).getTime();

function timestamp(secondsAgo) {
  const d = new Date(frozenNow - secondsAgo * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function reset(unattended = false) {
  for (const table of ["scenario_items", "scenario_item_variants", "sid_rentals", "general_rentals", "settings", "penalties", "unattended_penalty_events"]) db.exec(`DELETE FROM ${table}`);
  run("INSERT INTO settings (key,value) VALUES ('unattended_enabled',?)", [unattended ? "1" : "0"]);
  run("INSERT INTO scenario_items (id,name,stock,rented) VALUES ('000001','Test item',3,2)");
}
function general(secondsAgo, extra = {}) {
  return Number(run(
    "INSERT INTO general_rentals (borrower_name,item_id,item_label,qty,applied_at,picked_up_at,returned,status,variant_pending,purpose) VALUES (?,?,?,?,?,?,?,?,?,?)",
    ["Test user", "000001", "Test item", 2, timestamp(secondsAgo), extra.pickedUp ? timestamp(10) : null, extra.returned ? "O" : "X", extra.status || "active", extra.pending ? "Y" : null, "Test purpose"],
  ).lastInsertRowid);
}

test("미수령 자동 취소와 완료 안내의 제한시간", async (t) => {
  Date.now = () => frozenNow;
  try {
    await t.test("20분 직전은 유지하고 정확히 20분에 취소, 재고를 한 번만 복구", () => {
      reset();
      assert.equal(getPickupTimeoutMinutes(), 20);
      const id = general(20 * 60 - 1);
      assert.equal(cancelUnclaimedPickups().cancelled, 0);
      run("UPDATE general_rentals SET applied_at=? WHERE id=?", [timestamp(20 * 60), id]);
      assert.equal(cancelUnclaimedPickups().cancelled, 1);
      const row = get("SELECT * FROM general_rentals WHERE id=?", [id]);
      assert.equal(row.status, "archived");
      assert.equal(row.returned, "O");
      assert.equal(row.return_source, "cancel");
      assert.equal(row.purpose, "Test purpose [미수령 자동 취소]");
      assert.deepEqual({ ...get("SELECT stock,rented FROM scenario_items") }, { stock: 5, rented: 0 });
      assert.equal(cancelUnclaimedPickups().cancelled, 0);
      assert.equal(get("SELECT stock FROM scenario_items").stock, 5);
    });
    await t.test("SID에 포함된 시나리오 물품도 20분 기준 적용", () => {
      reset();
      run("INSERT INTO sid_rentals (borrower_name,item_label,applied_at) VALUES ('Test user','[000001] Test item x 2',?)", [timestamp(21 * 60)]);
      assert.equal(cancelUnclaimedPickups().cancelled, 1);
      assert.equal(get("SELECT status FROM sid_rentals").status, "archived");
      assert.equal(get("SELECT stock FROM scenario_items").stock, 5);
    });
    await t.test("이미 수령 확인/반납/보관된 대여는 취소하지 않음", () => {
      reset();
      general(60 * 60, { pickedUp: true });
      general(60 * 60, { returned: true });
      general(60 * 60, { status: "archived" });
      assert.equal(cancelUnclaimedPickups().cancelled, 0);
      assert.equal(get("SELECT stock FROM scenario_items").stock, 3);
    });
    await t.test("종류 미확정으로 차감하지 않은 재고는 취소 시 늘리지 않음", () => {
      reset(); general(20 * 60, { pending: true });
      assert.equal(cancelUnclaimedPickups().cancelled, 1);
      assert.equal(get("SELECT stock FROM scenario_items").stock, 3);
    });
    await t.test("무인 모드의 별도 4시간 제한 및 위반 기록은 유지", () => {
      reset(true);
      assert.equal(getPickupTimeoutMinutes(), 240);
      const id = general(4 * 60 * 60 - 1);
      assert.equal(cancelUnclaimedPickups().cancelled, 0);
      run("UPDATE general_rentals SET applied_at=? WHERE id=?", [timestamp(4 * 60 * 60), id]);
      assert.equal(cancelUnclaimedPickups().cancelled, 1);
      assert.equal(get("SELECT event_type FROM unattended_penalty_events").event_type, "pickup_unconfirmed_4h");
      assert.equal(get("SELECT max_types FROM penalties").max_types, 13);
    });
  } finally {
    Date.now = originalNow;
    db.close();
  }
});
