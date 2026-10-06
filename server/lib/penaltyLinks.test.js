import test from "node:test";
import assert from "node:assert/strict";

// 운영 장부는 사용하지 않는다.
process.env.WMS_DB_PATH = ":memory:";
const { db, run, get, all, transaction } = await import("../db.js");
const { rentalCandidates, saveLinks, linksFor, publicLinks, deleteLinks } = await import("./penaltyLinks.js");
const { penaltyDetails } = await import("./unattendedPenalties.js");

function reset() {
  for (const t of ["scenario_items", "scenario_item_variants", "sid_rentals", "general_rentals", "penalties", "penalty_links", "rental_requests", "registered_users"]) db.exec(`DELETE FROM ${t}`);
  run("INSERT INTO registered_users (employee_id,name,active) VALUES ('1234','홍길동',1),('5678','홍길동',1)");
  run("INSERT INTO scenario_items (id,name,stock,rented) VALUES ('000045','원형 접시',5,1),('000046','스탠드 조명',5,1)");
  run("INSERT INTO rental_requests (id,created_at,borrower_name,employee_id,request_code) VALUES (7,'2026-10-04 09:00:00','홍길동','1234','261004-001')");
}
const sid = (o = {}) => Number(run(
  "INSERT INTO sid_rentals (borrower_name,employee_id,sid,item_label,borrow_date,applied_at,status,returned,return_date,picked_up_at,request_no,return_source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
  [o.name ?? "홍길동", o.emp ?? "1234", "SID1", o.label ?? "[000045] 원형 접시 x 2", "2026-10-04", o.applied ?? "2026-10-04 09:00:00", o.status ?? "active", o.returned ?? null, o.returnedAt ?? null, o.picked ?? "2026-10-04 10:00:00", o.req ?? 7, o.src ?? null],
).lastInsertRowid);
const general = (o = {}) => Number(run(
  "INSERT INTO general_rentals (borrower_name,employee_id,item_id,item_label,qty,borrow_date,applied_at,status,returned,return_date,picked_up_at,request_no) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
  [o.name ?? "홍길동", o.emp ?? "1234", "000046", "스탠드 조명", o.qty ?? 3, "2026-10-05", o.applied ?? "2026-10-05 09:00:00", "active", null, null, "2026-10-05 10:00:00", null],
).lastInsertRowid);
const penalty = () => Number(run("INSERT INTO penalties (name,max_types,reason,expires_at) VALUES ('홍길동',5,'장비 분실','2026-10-20')").lastInsertRowid);

test("후보: 시나리오·일반 기록을 최근순으로, 반납된 줄도 함께 준다", () => {
  reset();
  const a = sid({ applied: "2026-10-01 09:00:00", status: "archived", returned: "O", returnedAt: "2026-10-02 12:00:00" });
  const b = general({ applied: "2026-10-05 09:00:00" });
  const rows = rentalCandidates("홍길동");
  assert.deepEqual(rows.map((r) => `${r.sheetType}:${r.rowId}`), [`general:${b}`, `scenario:${a}`]);
  const returned = rows[1];
  assert.equal(returned.itemName, "원형 접시");
  assert.equal(returned.qty, 2);
  assert.equal(returned.state, "반납 완료");
  assert.equal(returned.returnedAt, "2026-10-02 12:00:00");
  assert.equal(returned.requestCode, "261004-001");
});

test("후보: 사번으로도 찾고, 이름으로 찾으면 같은 이름 사번의 기록도 본다(이름이 비어 있는 옛 줄)", () => {
  reset();
  const byName = sid({ name: "홍길동", emp: "" });
  const byId = sid({ name: "다른표기", emp: "1234" });
  sid({ name: "김민수", emp: "9999" });
  assert.deepEqual(rentalCandidates("1234").map((r) => r.rowId), [byId]);
  assert.deepEqual(rentalCandidates("홍길동").map((r) => r.rowId).sort(), [byName, byId].sort());
  assert.deepEqual(rentalCandidates("   "), []);
});

test("연결 저장: 물품 정보를 남기고, 다시 저장하면 통째로 바뀐다", () => {
  reset();
  const rid = sid();
  const gid = general();
  const pid = penalty();
  assert.equal(saveLinks(pid, [
    { sheetType: "scenario", rowId: rid, cause: "return" },
    { sheetType: "general", rowId: gid, cause: "rental" },
    { sheetType: "scenario", rowId: rid, cause: "rental" }, // 같은 줄 중복은 무시
  ], "관리자"), 2);
  const links = linksFor(pid);
  assert.equal(links.length, 2);
  assert.deepEqual(links.map((l) => [l.cause, l.itemName, l.qty]), [["return", "원형 접시", 2], ["rental", "스탠드 조명", 3]]);
  assert.equal(get("SELECT created_by FROM penalty_links LIMIT 1").created_by, "관리자");

  saveLinks(pid, [{ sheetType: "general", rowId: gid, cause: "return" }]);
  assert.deepEqual(linksFor(pid).map((l) => [l.itemName, l.cause]), [["스탠드 조명", "return"]]);
  saveLinks(pid, []);
  assert.deepEqual(linksFor(pid), []);
});

test("연결 검증: 원인·시트·기록이 잘못되면 거절하고 아무것도 바꾸지 않는다", () => {
  reset();
  const rid = sid();
  const pid = penalty();
  saveLinks(pid, [{ sheetType: "scenario", rowId: rid, cause: "rental" }]);
  for (const bad of [
    [{ sheetType: "scenario", rowId: rid, cause: "weird" }],
    [{ sheetType: "tablecloth", rowId: rid, cause: "rental" }],
    [{ sheetType: "scenario", rowId: 99999, cause: "rental" }],
    [{ sheetType: "scenario", rowId: "abc", cause: "rental" }],
    [{ sheetType: "scenario", rowId: rid, cause: "return" }, { sheetType: "scenario", rowId: 99999, cause: "return" }],
  ]) {
    assert.throws(() => saveLinks(pid, bad));
    assert.deepEqual(linksFor(pid).map((l) => l.cause), ["rental"], "실패하면 기존 연결이 그대로여야 한다");
  }
  assert.throws(() => saveLinks(pid, Array.from({ length: 31 }, () => ({ sheetType: "scenario", rowId: rid, cause: "rental" }))), /30건/);
});

test("페널티 등록과 연결은 한 번에: 연결이 틀리면 페널티도 만들어지지 않는다", () => {
  reset();
  const before = all("SELECT id FROM penalties").length;
  assert.throws(() => transaction(() => {
    const id = Number(run("INSERT INTO penalties (name,max_types,reason) VALUES ('홍길동',5,'x')").lastInsertRowid);
    saveLinks(id, [{ sheetType: "scenario", rowId: 99999, cause: "rental" }]);
  }));
  assert.equal(all("SELECT id FROM penalties").length, before);
});

test("상태는 지금 기록에서 읽는다: 연결 뒤에 반납되거나 기록이 사라져도 반영된다", () => {
  reset();
  const rid = sid();
  const pid = penalty();
  saveLinks(pid, [{ sheetType: "scenario", rowId: rid, cause: "return" }]);
  assert.equal(linksFor(pid)[0].state, "대여 중");
  run("UPDATE sid_rentals SET returned='O', return_date='2026-10-06 10:00:00', status='archived', return_source='damage' WHERE id=?", [rid]);
  const [done] = linksFor(pid);
  assert.equal(done.state, "파손 신고 반납");
  assert.equal(done.returnedAt, "2026-10-06 10:00:00");
  run("DELETE FROM sid_rentals WHERE id=?", [rid]);
  const [gone] = linksFor(pid);
  assert.equal(gone.state, "기록 없음");
  assert.equal(gone.itemName, "원형 접시", "물품명은 연결한 시점의 값이 남는다");
});

test("공개용은 물품·시각만 남기고 내부 행 번호와 사번 정보를 뺀다", () => {
  reset();
  const rid = sid();
  const pid = penalty();
  saveLinks(pid, [{ sheetType: "scenario", rowId: rid, cause: "rental" }]);
  const [pub] = publicLinks(linksFor(pid));
  assert.deepEqual(Object.keys(pub).sort(), ["appliedAt", "cause", "itemName", "pickedUpAt", "qty", "requestCode", "returnedAt", "state", "variantName"]);
  assert.equal(JSON.stringify(pub).includes("1234"), false);
});

test("관리자 상세(penaltyDetails)에 연결이 실리고, 해제하면 사라진다", () => {
  reset();
  const rid = sid();
  const pid = penalty();
  saveLinks(pid, [{ sheetType: "scenario", rowId: rid, cause: "return" }]);
  const details = penaltyDetails(pid);
  assert.equal(details.links.length, 1);
  assert.equal(details.links[0].rowId, rid, "관리자용에는 행 번호가 있다(수정할 때 필요)");
  assert.deepEqual(details.events, [], "직접 등록한 페널티는 자동 이벤트가 없다");
  deleteLinks(pid);
  assert.deepEqual(penaltyDetails(pid).links, []);
});
