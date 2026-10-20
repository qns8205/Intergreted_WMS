import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { fileURLToPath } from "node:url";

process.env.WMS_DB_PATH = ":memory:";
process.env.SM_SYNC = "off";
process.env.WMS_HTTPS_CONFIG = fileURLToPath(new URL("../fixtures/https-auth-test.json", import.meta.url));
const { db, run, get } = await import("../db.js");
const { gasRouter } = await import("./gas.js");
const { issueAdminSession } = await import("../lib/auth.js");
const { issueBorrower } = await import("../lib/borrowerAuth.js");
run("INSERT INTO registered_users (employee_id,name,active) VALUES ('1234','대여 대상',1),('5678','다른 예약자',1)");
run("INSERT INTO admin_users (id,login_id,name,password_hash) VALUES (1,'test-admin','테스트 관리자','unused')");
run("INSERT INTO scenario_items (id,name,stock,rented) VALUES ('000001','직접 대여 물품',3,0)");
const addReservation = (id, employeeId, name) => run(`INSERT INTO item_reservations
  (id,employee_id,borrower_name,floor,unit,item_id,variant_id,quantity,starts_at_ms,created_at_ms,client_id)
  VALUES (?,?,?,'B1','Human Unit 7','000001',0,1,?,?,'test-reservation')`, [id,employeeId,name,Date.now()+3600000,Date.now()]);
addReservation(1,'1234','대여 대상'); addReservation(2,'5678','다른 예약자');
const adminHeaders = { 'x-admin-token': issueAdminSession(1) };
let cookie = '';
issueBorrower({ headers: {} }, { setHeader(_name, value) { cookie = value.split(';')[0]; } }, '1234');
const borrowerHeaders = { Cookie: cookie };
const app = express();
app.use((req, _res, next) => { req.socket.encrypted = true; next(); });
app.use('/api', gasRouter);
const server = app.listen(0,'127.0.0.1');
await new Promise(resolve => server.once('listening',resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const query = async (params, headers = adminHeaders) => (await fetch(`${origin}/api/gas?${new URLSearchParams(params)}`, { headers })).json();
const post = async (action, payload, headers = adminHeaders) => (await fetch(`${origin}/api/gas`, {
  method:'POST',headers:{ 'Content-Type':'text/plain',...headers },body:JSON.stringify({action,payload}),
})).json();

test('관리자 세션만으로 대상 대여자의 예약 구분을 조회한다', async () => {
  const result = await query({action:'getReservations',employeeId:'1234'});
  assert.equal(result.success,true);
  assert.equal(result.items.find(item=>item.id===1).mine,true);
  assert.equal(result.items.find(item=>item.id===2).mine,false);
  const withoutTarget = await query({action:'getReservations'});
  assert.equal(withoutTarget.success,true);
  assert.ok(withoutTarget.items.every(item=>!item.mine));
  assert.equal((await query({action:'getReservations',employeeId:'9999'})).success,false);
});

test('관리자 안내 확인 후 직접 대여를 완료하고 재고와 대여자 사번을 유지한다', async () => {
  const acknowledged = await post('acknowledgeReservationNotice',{employeeId:'1234',reservationIds:[2]});
  assert.equal(acknowledged.success,true);
  assert.ok(get("SELECT * FROM reservation_notice_views WHERE reservation_id=2 AND employee_id='1234'"));
  assert.equal((await post('acknowledgeReservationNotice',{reservationIds:[2]})).success,false);
  assert.equal((await post('acknowledgeReservationNotice',{employeeId:'9999',reservationIds:[2]})).success,false);
  const borrowed = await post('recordBorrow',{borrowList:[{
    employeeId:'1234',borrowerName:'대여 대상',affiliation:'cfgw',itemType:'general',borrowPurpose:'관리자 직접 대여',
    floor:'B1',unit:'Human Unit 7',borrowedItems:[{id:'000001',name:'직접 대여 물품',quantity:1}],
  }]});
  assert.equal(borrowed.success,true,JSON.stringify(borrowed));
  assert.equal(get("SELECT employee_id FROM general_rentals WHERE item_id='000001'").employee_id,'1234');
  assert.equal(get("SELECT stock FROM scenario_items WHERE id='000001'").stock,2);
  assert.equal(get('SELECT status FROM item_reservations WHERE id=2').status,'reserved');
});

test('비인증·위조 관리자·다른 사번 우회를 차단하고 일반 대여자 본인 확인은 유지한다', async () => {
  assert.equal((await query({action:'getReservations',employeeId:'1234'},{})).success,false);
  assert.equal((await query({action:'getReservations',employeeId:'1234'},{'x-admin-token':'invalid'})).success,false);
  assert.equal((await query({action:'getReservations',employeeId:'5678'},borrowerHeaders)).success,false);
  assert.equal((await query({action:'getReservations'},borrowerHeaders)).success,true);
  assert.equal((await post('acknowledgeReservationNotice',{employeeId:'5678',reservationIds:[2]},borrowerHeaders)).success,false);
  assert.equal((await post('acknowledgeReservationNotice',{reservationIds:[2]},borrowerHeaders)).success,true);
  assert.equal((await post('cancelItemReservation',{employeeId:'5678',reservationId:2},borrowerHeaders)).success,false);
  assert.equal(get('SELECT status FROM item_reservations WHERE id=2').status,'reserved');
});

test.after(async () => { await new Promise(resolve=>server.close(resolve)); db.close(); });
