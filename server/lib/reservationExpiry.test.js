import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {fileURLToPath} from "node:url";

process.env.WMS_DB_PATH=":memory:";
process.env.SM_SYNC="off";
process.env.TZ="Asia/Seoul";
process.env.WMS_PICKUP_TIMEOUT_MIN="90";
process.env.WMS_HTTPS_CONFIG=fileURLToPath(new URL("../fixtures/https-auth-test.json",import.meta.url));
const {db,run,get,all}=await import("../db.js");
const {expireReservations}=await import("./reservationExpiry.js");
const {promoteDueReservations,startReservationPromotion}=await import("./reservationPromotion.js");
const {cancelUnclaimedPickups}=await import("./pickupTimeout.js");
const {gasRouter,recordBorrow}=await import("../routes/gas.js");
const {requestLookupRouter,REQUEST_LOOKUP_PATH}=await import("../routes/requestLookup.js");
const {issueAdminSession}=await import("./auth.js");
const {isReservationExpired}=await import("../../shared/reservationTime.js");
const originalNow=Date.now;
const planned=Date.parse('2026-10-13T23:55:00+09:00');
let clock=planned;
Date.now=()=>clock;
const kst=ms=>new Date(ms+9*3600000).toISOString().slice(0,19).replace('T',' ');
let token='';
function reset({pending=true,pickedUp=false,appliedAt=planned-600000}={}){
  clock=planned;
  for(const table of ['item_reservations','general_rentals','sid_rentals','rental_requests','scenario_items','scenario_item_variants','registered_users','settings','penalties','unattended_penalty_events','admin_users','admin_sessions'])db.exec('DELETE FROM '+table);
  run("INSERT INTO registered_users(employee_id,name,active) VALUES ('1234','예약자',1)");
  run("INSERT INTO scenario_items(id,name,stock,rented,root_slot) VALUES ('000001','박스',3,2,'200002')");
  run("INSERT INTO admin_users(id,login_id,name,password_hash) VALUES (1,'test-admin','관리자','unused')");token=issueAdminSession(1);
  run("INSERT INTO item_reservations(id,employee_id,borrower_name,floor,unit,item_id,quantity,starts_at_ms,created_at_ms,status,request_no,client_id) VALUES (1,'1234','예약자','B1','Unit 7','000001',2,?,?,?,?,'expiry-test-booking')",[planned,planned-3600000,pending?'fulfilled':'reserved',pending?1:null]);
  if(pending){
    run("INSERT INTO rental_requests(id,employee_id,borrower_name) VALUES (1,'1234','예약자')");
    run("INSERT INTO general_rentals(id,employee_id,borrower_name,item_id,item_label,qty,applied_at,picked_up_at,returned,status,request_no) VALUES (1,'1234','예약자','000001','박스',2,?,?,'X','active',1)",[kst(appliedAt),pickedUp?kst(planned):null]);
  }
}
const app=express();app.use('/api',gasRouter);app.use(requestLookupRouter);
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
async function pickup(){return(await(await fetch(origin+'/api/gas',{method:'POST',headers:{'Content-Type':'text/plain','x-admin-token':token},body:JSON.stringify({action:'confirmPickup',payload:{items:[{sheetType:'general',rowIndex:1,quantity:2}]}})})).json());}

test('예약 +20분 직전은 유지하고 정각부터 취소·재고 복구를 한 번만 한다',()=>{
  reset();clock=planned+1200000-1;assert.equal(expireReservations().cancelled,0);
  assert.equal(isReservationExpired(planned,clock),false);
  clock++;assert.deepEqual(expireReservations(),{cancelled:1,reservationsCancelled:1});
  assert.equal(isReservationExpired('2026-10-13T23:55:00+09:00',clock),true);
  assert.equal(get('SELECT status FROM item_reservations').status,'cancelled');
  assert.deepEqual({...get('SELECT stock,rented FROM scenario_items')},{stock:5,rented:0});
  const row=get('SELECT * FROM general_rentals');assert.equal(row.return_source,'cancel');assert.equal(row.cancel_by,'auto');assert.match(row.purpose,/예약 미수령 자동 취소/);
  assert.equal(expireReservations().cancelled,0);assert.equal(get('SELECT stock FROM scenario_items').stock,5);
});
test('전환 대기 예약도 +20분에 취소하고 차감하지 않은 재고를 복구하지 않는다',async()=>{
  reset({pending:false});run("UPDATE scenario_items SET stock=0");clock=planned+1200000;
  assert.equal((await promoteDueReservations(recordBorrow)).promoted,0);
  assert.equal(get('SELECT status FROM item_reservations').status,'cancelled');assert.equal(get('SELECT COUNT(*) AS count FROM general_rentals').count,0);
  assert.equal(get('SELECT stock FROM scenario_items').stock,0);
  run('UPDATE scenario_items SET stock=5');assert.equal((await promoteDueReservations(recordBorrow)).promoted,0);
});
test('예정 시각 19분 뒤에 전환된 예약도 예정 시각 +20분에 끝나며 신청 시각으로 연장하지 않는다',()=>{
  reset({appliedAt:planned+19*60000});clock=planned+1200000;
  assert.equal(cancelUnclaimedPickups().cancelled,1);
  assert.equal(get('SELECT status FROM general_rentals').status,'archived');
});
test('무인 모드 예약도 20분이며 일반 대여 4시간 위반 페널티는 부과하지 않는다',()=>{
  reset();run("INSERT INTO settings(key,value) VALUES ('unattended_enabled','1')");clock=planned+1200000;
  assert.equal(cancelUnclaimedPickups().cancelled,1);
  assert.equal(get('SELECT COUNT(*) AS count FROM penalties').count,0);
  assert.equal(get('SELECT COUNT(*) AS count FROM unattended_penalty_events').count,0);
});
test('이미 수령 확인된 물품은 취소하거나 재고를 복구하지 않는다',()=>{
  reset({pickedUp:true});clock=planned+24*3600000;
  assert.deepEqual(expireReservations(),{cancelled:0,reservationsCancelled:0});
  assert.equal(get('SELECT returned FROM general_rentals').returned,'X');assert.equal(get('SELECT status FROM item_reservations').status,'fulfilled');
  assert.equal(get('SELECT stock FROM scenario_items').stock,3);
});
test('부분 수령한 예약은 미수령 수량만 취소하고 종류별 재고도 그만큼만 복구한다',()=>{
  reset();run("INSERT INTO scenario_item_variants(id,item_id,name,stock,rented) VALUES (1,'000001','빨강',3,2)");
  run('UPDATE item_reservations SET variant_id=1');run('UPDATE general_rentals SET qty=1,variant_id=1');
  run("INSERT INTO general_rentals(employee_id,borrower_name,item_id,item_label,qty,picked_up_at,returned,status,request_no,variant_id) VALUES ('1234','예약자','000001','박스',1,'2026-10-13 23:55:00','X','active',1,1)");
  clock=planned+1200000;assert.equal(expireReservations().cancelled,1);
  assert.deepEqual({...get('SELECT stock,rented FROM scenario_item_variants')},{stock:4,rented:1});
  assert.equal(get("SELECT SUM(qty) AS qty FROM general_rentals WHERE returned='X'").qty,1);
});
test('SID 장부로 신청된 예약도 연결된 미수령 물품만 취소한다',()=>{
  reset();run('DELETE FROM general_rentals');
  run("INSERT INTO sid_rentals(employee_id,borrower_name,item_label,request_no,returned,status) VALUES ('1234','예약자','[000001] 박스 x 2',1,'X','active')");
  clock=planned+1200000;assert.equal(expireReservations().cancelled,1);assert.equal(get('SELECT stock FROM scenario_items').stock,5);
});
test('복구 중 실패하면 취소 상태와 재고를 모두 롤백하고 다음 작업에서 재시도한다',()=>{
  reset();clock=planned+1200000;
  db.exec("CREATE TRIGGER fail_expiry BEFORE UPDATE OF stock ON scenario_items BEGIN SELECT RAISE(ABORT,'expiry restore failed'); END");
  try{assert.throws(()=>expireReservations(),/expiry restore failed/);assert.equal(get('SELECT status FROM general_rentals').status,'active');assert.equal(get('SELECT status FROM item_reservations').status,'fulfilled');assert.equal(get('SELECT stock FROM scenario_items').stock,3);}
  finally{db.exec('DROP TRIGGER fail_expiry');}
  assert.equal(expireReservations().cancelled,1);
});
test('기한 뒤 늦게 들어온 수령 확인은 실패하고 이미 취소한 줄을 되살리지 않는다',async()=>{
  reset();clock=planned+1200000;const result=await pickup();assert.equal(result.success,false);assert.match(result.message,/자동 취소/);
  assert.equal(get('SELECT picked_up_at FROM general_rentals').picked_up_at,null);
});
test('20분 직전 수령 확인은 성공하고 이후 만료 작업에서도 유지한다',async()=>{
  reset();clock=planned+1200000-1;assert.equal((await pickup()).success,true);clock++;
  assert.equal(expireReservations().cancelled,0);assert.equal(get('SELECT returned FROM general_rentals').returned,'X');
});
test('QR 조회 시에도 기한 지난 예약의 픽업 동선은 즉시 사라진다',async()=>{
  reset();clock=planned+1200000;
  const result=await(await fetch(origin+REQUEST_LOOKUP_PATH+'/api?employeeId=1234')).json();
  assert.equal(result.success,true);assert.equal(result.activeCount,0);assert.ok(!result.items.some(item=>!item.returned&&!item.pickedUp));
});
test('화면을 열지 않아도 예약 작업이 시작될 때 만료 예약을 자동 취소한다',async()=>{
  reset({pending:false});clock=planned+1200000;const stop=startReservationPromotion(recordBorrow);
  try{await new Promise(resolve=>setTimeout(resolve,1200));assert.equal(get('SELECT status FROM item_reservations').status,'cancelled');}finally{stop();}
});
test.after(async()=>{Date.now=originalNow;await new Promise(resolve=>server.close(resolve));db.close();});
