import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { fileURLToPath } from "node:url";

process.env.WMS_DB_PATH = ":memory:";
process.env.SM_SYNC = "off";
process.env.WMS_HTTPS_CONFIG = fileURLToPath(new URL("../fixtures/https-auth-test.json", import.meta.url));
const { db, run, get, all } = await import("../db.js");
const { gasRouter } = await import("./gas.js");
const { issueAdminSession } = await import("../lib/auth.js");
const { issueBorrower } = await import("../lib/borrowerAuth.js");
run("INSERT INTO registered_users (employee_id,name,active) VALUES ('1234','예약자 A',1),('5678','예약자 B',1)");
run("INSERT INTO admin_users (id,login_id,name,password_hash) VALUES (1,'test-admin','예약 관리자','unused')");
run("INSERT INTO scenario_items (id,name,stock,rented,image_path) VALUES ('000001','박스',4,1,'/uploads/test-box.png')");
run("INSERT INTO scenario_item_variants (id,item_id,name,stock,rented) VALUES (1,'000001','빨강',4,1)");
run("INSERT INTO general_rentals (employee_id,borrower_name,item_id,item_label,qty,returned) VALUES ('5678','예약자 B','000001','박스',1,'X')");
for (const [id,employeeId,name,status] of [[1,'1234','예약자 A','reserved'],[2,'5678','예약자 B','reserved'],[3,'5678','예약자 B','fulfilled'],[4,'5678','예약자 B','cancelled']]) {
  run(`INSERT INTO item_reservations
    (id,employee_id,borrower_name,floor,unit,item_id,variant_id,quantity,starts_at_ms,created_at_ms,status,client_id)
    VALUES (?,?,?,'B1','Human Unit 7','000001',1,2,?,?,?,?)`,[id,employeeId,name,Date.now()+(id+20)*60000,Date.now(),status,`admin-reservation-${id}`]);
}
const admin = { 'x-admin-token': issueAdminSession(1) };
let cookie = '';
issueBorrower({headers:{}},{setHeader(_key,value){cookie=value.split(';')[0];}},'1234');
const borrower = {Cookie:cookie};
const app = express();
app.use((req,_res,next)=>{req.socket.encrypted=true;next();});
app.use('/api',gasRouter);
const server=app.listen(0,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const query=async (action,headers=admin)=>(await fetch(`${origin}/api/gas?action=${action}`,{headers})).json();
const post=async (action,payload,headers=admin)=>(await fetch(`${origin}/api/gas`,{
  method:'POST',headers:{'Content-Type':'text/plain',...headers},body:JSON.stringify({action,payload}),
})).json();
const stockSnapshot=()=>JSON.stringify({items:all('SELECT stock,rented FROM scenario_items'),variants:all('SELECT stock,rented FROM scenario_item_variants'),rentals:all('SELECT * FROM general_rentals')});

test('관리자는 SM 대여자 세션 없이 전체 진행 예약과 사번·좌석·사진·종류를 조회한다',async()=>{
  const result=await query('getAdminReservations');
  assert.equal(result.success,true);
  assert.deepEqual(result.items.map(item=>item.id),[1,2]);
  const item=result.items[1];
  assert.equal(item.employeeId,'5678'); assert.equal(item.borrowerName,'예약자 B');
  assert.equal(item.floor,'B1'); assert.equal(item.unit,'Human Unit 7');
  assert.equal(item.image,'/uploads/test-box.png'); assert.equal(item.variantName,'빨강');
  assert.equal(item.quantity,2); assert.equal(item.stock,4); assert.equal(item.available,true);
  assert.ok(Number.isFinite(Date.parse(item.startsAt))&&Number.isFinite(Date.parse(item.createdAt)));
});

test('일반 대여자·미로그인·위조 토큰은 관리자 조회·취소를 사용할 수 없다',async()=>{
  for(const headers of [{},borrower,{'x-admin-token':'invalid'}]){
    assert.equal((await query('getAdminReservations',headers)).success,false);
    assert.equal((await post('cancelAdminItemReservation',{reservationId:2},headers)).success,false);
  }
  assert.equal(get('SELECT status FROM item_reservations WHERE id=2').status,'reserved');
  const publicRows=await query('getReservations',borrower);
  assert.equal(publicRows.success,true);
  assert.ok(publicRows.items.every(item=>!('employeeId'in item)&&!('floor'in item)&&!('unit'in item)&&!('createdAt'in item)));
});

test('관리자는 타인 예약을 취소하되 실제 대여·종류 재고는 그대로 유지한다',async()=>{
  const before=stockSnapshot();
  assert.equal((await post('cancelAdminItemReservation',{reservationId:2})).success,true);
  assert.equal(get('SELECT status FROM item_reservations WHERE id=2').status,'cancelled');
  assert.equal(stockSnapshot(),before);
  assert.deepEqual((await query('getAdminReservations')).items.map(item=>item.id),[1]);
  assert.deepEqual((await query('getReservations',borrower)).items.map(item=>item.id),[1]);
  assert.equal((await post('cancelAdminItemReservation',{reservationId:2})).success,false);
});

test('종료된 예약·없는 예약·잘못된 번호와 연결된 미수령 대여가 없는 예약 취소를 거부한다',async()=>{
  const before=stockSnapshot();
  for(const reservationId of [3,4,999,0,-1,1.5,'invalid',null]){
    assert.equal((await post('cancelAdminItemReservation',{reservationId})).success,false);
  }
  run("UPDATE item_reservations SET status='fulfilled' WHERE id=1");
  assert.equal((await post('cancelAdminItemReservation',{reservationId:1})).success,false);
  assert.equal(get('SELECT status FROM item_reservations WHERE id=1').status,'fulfilled');
  assert.equal(stockSnapshot(),before);
});

test.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
