import test from "node:test";
import assert from "node:assert/strict";
import { workdayDateKey, returnedThisWorkday, isRentalCancelled } from "./workday.js";

process.env.WMS_DB_PATH = ":memory:";
const { db, run } = await import("../db.js");
const { myRentalHistory } = await import("./myRentalHistory.js");

test("작업일은 서울 오전 1시 기준이며 ISO/서울 시각 모두 같은 경계를 사용한다", () => {
  assert.equal(workdayDateKey("2026-10-07 00:59:59"), "2026-10-06");
  assert.equal(workdayDateKey("2026-10-07 01:00:00"), "2026-10-07");
  assert.equal(workdayDateKey("2026-10-06T15:59:59Z"), "2026-10-06");
  assert.equal(workdayDateKey("2026-10-06T16:00:00Z"), "2026-10-07");
  assert.equal(returnedThisWorkday({ returned: "O", return_date: "2026-10-07 00:59:59" }, "2026-10-06"), true);
  assert.equal(returnedThisWorkday({ returned: "X", return_date: "2026-10-06 12:00:00" }, "2026-10-06"), false);
  assert.equal(isRentalCancelled({ returned: "O", return_source: "cancel", picked_up_at: "old" }), true);
  assert.equal(isRentalCancelled({ returned: "O", return_source: null, picked_up_at: null }), true);
  assert.equal(isRentalCancelled({ returned: "O", return_source: "admin", picked_up_at: "old" }), false);
});

test("현재 대여·다른 작업일·동명이인 기록을 제외하고 부분 반납과 취소를 보존한다", () => {
  run("INSERT INTO registered_users (employee_id,name,active) VALUES ('1234','동명이인',1),('5678','동명이인',1)");
  run("INSERT INTO scenario_items (id,name,image_path,root_slot) VALUES ('000001','Box (Small)','/uploads/example.jpg','000202')");
  run("INSERT INTO scenario_item_variants (id,item_id,name) VALUES (1,'000001','Small')");
  const insert = (employee, returned, date, source, qty = 1) => run("INSERT INTO general_rentals (employee_id,borrower_name,item_id,item_label,qty,returned,return_date,return_source,picked_up_at,status,variant_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [employee, '동명이인', '000001', 'Box (Small)', qty, returned, date, source, source === 'cancel' ? null : '2026-10-05 09:00:00', returned === 'O' ? 'archived' : 'active', 1]);
  insert('1234', 'X', null, null, 3);
  insert('1234', 'O', '2026-10-06 12:00:00', 'admin', 2);
  insert('1234', 'O', '2026-10-07 00:59:59', 'self');
  insert('1234', 'O', '2026-10-07 01:00:00', 'admin');
  insert('1234', 'O', '2026-10-06 00:59:59', 'admin');
  insert('1234', 'O', '2026-10-06 13:00:00', 'cancel');
  insert('5678', 'O', '2026-10-06 14:00:00', 'admin');
  run("INSERT INTO sid_rentals (employee_id,borrower_name,sid,item_label,returned,return_date,return_source,picked_up_at,email,variant_id) VALUES ('1234','동명이인','SID1','[000001] Box (Small) x 2','O','2026-10-06 15:00:00','damage','2026-10-05 09:00:00','1234@cfgw-kr.com',1)");
  const result = myRentalHistory({ name: '동명이인', employeeId: '1234', affiliation: 'cfgw' }, new Date('2026-10-06T13:00:00+09:00'));
  assert.equal(result.length, 4);
  assert.equal(result[0].returnDate, '2026-10-07 00:59:59');
  assert.equal(result.filter((row) => row.cancelled).length, 1);
  assert.equal(result.find((row) => row.returnSource === 'admin').quantity, 2);
  assert.equal(result.find((row) => row.sheetType === 'scenario').quantity, 2);
  assert.ok(result.every((row) => row.employeeId === '1234' && row.location === '' && !('email' in row) && !('borrowPurpose' in row)));
  assert.ok(result.every((row) => row.itemName === 'Box (Small)' && row.variantName === 'Small'));
  assert.equal(myRentalHistory({ name: '' }).length, 0);
  const other = myRentalHistory({ name: '동명이인', employeeId: '5678' }, new Date('2026-10-06T13:00:00+09:00'));
  assert.equal(other.length, 1);
});

test.after(() => db.close());
