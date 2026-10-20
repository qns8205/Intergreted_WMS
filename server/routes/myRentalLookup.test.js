import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import vm from "node:vm";
import { workdayDateKey } from "../lib/workday.js";

process.env.WMS_DB_PATH = ":memory:";
const { db, run } = await import("../db.js");
const { gasRouter } = await import("./gas.js");
const { requestLookupRouter, REQUEST_LOOKUP_PATH } = await import("./requestLookup.js");
const app = express();
app.use('/api', gasRouter);
app.use(requestLookupRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const today = `${workdayDateKey()} 12:00:00`;

test("내 대여 조회 API는 현재 대여와 작업일 반납을 분리하고 동일한 읽기 전용 상세 정보를 제공한다", async () => {
  run("INSERT INTO registered_users (employee_id,name,active) VALUES ('1234','테스트',1),('5678','테스트',1)");
  run("INSERT INTO scenario_items (id,name,stock,root_slot,sm_size,sm_property,category,subcategory,width_mm,depth_mm,height_mm) VALUES ('000001','Box (Small)',3,'000202','S','Hard','Props','Box',100,200,300)");
  for (const [employee, returned, source, qty] of [['1234','X',null,3],['1234','O','admin',2],['1234','O','cancel',1],['5678','O','admin',4]]) {
    run("INSERT INTO general_rentals (employee_id,borrower_name,item_id,item_label,qty,returned,return_date,return_source,picked_up_at) VALUES (?,?,?,?,?,?,?,?,?)", [employee,'테스트','000001','Box (Small)',qty,returned,returned === 'O' ? today : null,source,source === 'cancel' ? null : today]);
  }
  const query = 'name=' + encodeURIComponent('테스트') + '&employeeId=1234&affiliation=cfgw';
  const active = await (await fetch(`${origin}/api/gas?action=getMyBorrowedItems&${query}`)).json();
  const history = await (await fetch(`${origin}/api/gas?action=getMyBorrowedItems&scope=workday&${query}`)).json();
  assert.equal(active.success, true);
  assert.equal(history.success, true);
  assert.equal(active.items.length, 1);
  assert.equal(active.items[0].quantity, 3);
  assert.equal(history.items.length, 2);
  assert.equal(history.items.filter((row) => row.cancelled).length, 1);
  for (const item of [...active.items, ...history.items]) {
    assert.equal(item.location, '');
    assert.equal(item.itemName, 'Box (Small)');
    assert.equal(item.details.stock, 3);
    assert.equal(item.details.widthMm, 100);
    assert.equal(item.details.category, 'Props');
    assert.ok(!('rootSlot' in item.details) && !('memo' in item.details) && !('purchaseLink' in item.details));
  }
});

test("QR의 처리 내역 버튼은 목록 대신 내 대여 조회 안내를 보여주고 공통 안내와 대여/반납 동선을 유지한다", async () => {
  const html = await (await fetch(origin + REQUEST_LOOKUP_PATH)).text();
  // 버튼은 남기되(눌렀을 때 '내 대여 조회' 안내), 옛 처리 내역 목록 화면은 되살리지 않는다.
  assert.ok(html.includes('id="status"') && html.includes('내 대여 조회') && html.includes('http://192.168.100.152:3000/'));
  assert.ok(!html.includes('실제 반납과 대여 확인 전 취소를 구분한 내역입니다') && !html.includes('history-section-title">'));
  assert.ok(html.includes('일방통행으로 이동해주세요') && html.includes('이 물품을 가져갔어요') && html.includes('이 물품을 제자리에 반납했어요'));
  new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
  const qr = await (await fetch(`${origin}${REQUEST_LOOKUP_PATH}/api?employeeId=1234`)).json();
  assert.equal(qr.success, true);
  assert.equal(qr.items.length, 3);
  assert.ok(qr.items.some((item) => item.returnSource === 'admin' && item.location === '000202'));
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
});
