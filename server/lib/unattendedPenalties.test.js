import test from "node:test";
import assert from "node:assert/strict";

// 운영 장부는 사용하지 않는다. 시계와 DB를 고정해 페널티 상세(어떤 대여 때문에 생겼는지)를 검증한다.
process.env.WMS_DB_PATH = ":memory:";
delete process.env.WMS_PICKUP_TIMEOUT_MIN;
const { db, run, get } = await import("../db.js");
const { cancelUnclaimedPickups } = await import("./pickupTimeout.js");
const { applyUnattendedOverduePenalties, penaltyDetails } = await import("./unattendedPenalties.js");
const originalNow = Date.now;
const frozenNow = new Date(2026, 9, 6, 12, 0, 0).getTime();

function timestamp(secondsAgo) {
  const d = new Date(frozenNow - secondsAgo * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
const HOUR = 3600;
function reset() {
  for (const table of ["scenario_items", "sid_rentals", "general_rentals", "settings", "penalties", "unattended_penalty_events"]) db.exec(`DELETE FROM ${table}`);
  run("INSERT INTO settings (key,value) VALUES ('unattended_enabled','1')");
  run("INSERT INTO scenario_items (id,name,stock,rented) VALUES ('000001','드라이버 세트',5,0)");
  run("INSERT INTO scenario_items (id,name,stock,rented) VALUES ('000002','멀티탭',5,0)");
}
function general({ item = "000001", name = "드라이버 세트", qty = 1, appliedAgo, pickedAgo = null, returnedAgo = null, requestNo = 7, exempt = false }) {
  return Number(run(
    `INSERT INTO general_rentals (borrower_name,employee_id,item_id,item_label,qty,applied_at,picked_up_at,returned,return_date,status,request_no,type_limit_exempt,return_source)
     VALUES ('홍길동','1234',?,?,?,?,?,?,?,?,?,?,?)`,
    [item, name, qty, timestamp(appliedAgo), pickedAgo === null ? null : timestamp(pickedAgo),
      returnedAgo === null ? "X" : "O", returnedAgo === null ? null : timestamp(returnedAgo),
      returnedAgo === null ? "active" : "archived", requestNo, exempt ? "Y" : null, returnedAgo === null ? null : "unattended"],
  ).lastInsertRowid);
}

test("무인 모드 페널티 상세", async (t) => {
  Date.now = () => frozenNow;
  try {
    await t.test("4시간 대여 확인 미처리: 같은 신청 중 안 가져간 줄만 기한 초과로 표시", () => {
      reset();
      general({ appliedAgo: 5 * HOUR });                                   // 끝내 안 가져감 → 자동 취소
      general({ item: "000002", name: "멀티탭", appliedAgo: 5 * HOUR, pickedAgo: 4.5 * HOUR }); // 30분 만에 가져감
      cancelUnclaimedPickups();
      const penalty = get("SELECT id FROM penalties");
      const { events } = penaltyDetails(penalty.id);
      assert.equal(events.length, 1);
      const [event] = events;
      assert.equal(event.eventType, "pickup_unconfirmed_4h");
      assert.equal(event.label, "4시간 내 대여 확인 미처리");
      assert.equal(event.requestNo, 7);
      assert.equal(event.deadlineAt, timestamp(1 * HOUR));
      const byName = Object.fromEntries(event.items.map((i) => [i.name, i]));
      assert.equal(byName["드라이버 세트"].missed, true);
      assert.equal(byName["드라이버 세트"].pickedUpAt, "");
      assert.equal(byName["드라이버 세트"].state, "미수령 자동 취소");
      assert.equal(byName["멀티탭"].missed, false);
      assert.equal(byName["멀티탭"].pickedUpAt, timestamp(4.5 * HOUR));
    });

    await t.test("24시간 반납 미처리: 늦은 줄은 몇 분 넘었는지, 제때 반납·장기 보관 줄은 구분", () => {
      reset();
      general({ appliedAgo: 26 * HOUR, pickedAgo: 25 * HOUR });                         // 아직 안 돌려줌 → 1시간 초과
      general({ item: "000002", name: "멀티탭", appliedAgo: 26 * HOUR, pickedAgo: 25 * HOUR, returnedAgo: 2 * HOUR }); // 23시간 만에 반납
      general({ name: "장기 보관", appliedAgo: 26 * HOUR, pickedAgo: 25 * HOUR, exempt: true });
      applyUnattendedOverduePenalties();
      const penalty = get("SELECT id FROM penalties");
      const [event] = penaltyDetails(penalty.id).events;
      assert.equal(event.eventType, "return_unconfirmed_24h");
      assert.equal(event.sourceAt, timestamp(25 * HOUR));
      assert.equal(event.deadlineAt, timestamp(1 * HOUR));
      const byName = Object.fromEntries(event.items.map((i) => [i.name, i]));
      assert.equal(byName["드라이버 세트"].missed, true);
      assert.equal(byName["드라이버 세트"].overMinutes, 60);
      assert.equal(byName["드라이버 세트"].state, "대여 중");
      assert.equal(byName["멀티탭"].missed, false);
      assert.equal(byName["멀티탭"].returnedAt, timestamp(2 * HOUR));
      assert.equal(byName["장기 보관"].exempt, true);
      assert.equal(byName["장기 보관"].missed, false);
    });

    await t.test("직접 등록한 페널티는 연결된 기록이 없고, 없는 페널티는 null", () => {
      reset();
      const id = Number(run("INSERT INTO penalties (name,max_types,reason,expires_at) VALUES ('홍길동',10,'수동','2026-10-20')").lastInsertRowid);
      assert.deepEqual(penaltyDetails(id).events, []);
      assert.equal(penaltyDetails(id + 999), null);
    });
  } finally {
    Date.now = originalNow;
  }
});
