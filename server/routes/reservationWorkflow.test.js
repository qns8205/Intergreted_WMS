import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {fileURLToPath} from 'node:url';
process.env.WMS_DB_PATH=':memory:';
process.env.SM_SYNC='off';
process.env.TZ='Asia/Seoul';
process.env.WMS_HTTPS_CONFIG=fileURLToPath(new URL('../fixtures/https-auth-test.json',import.meta.url));
const {db,run,get,all}=await import('../db.js');
const {gasRouter,recordBorrow}=await import('./gas.js');
const {promoteDueReservations}=await import('../lib/reservationPromotion.js');
const {issueAdminSession}=await import('../lib/auth.js');
const {issueBorrower}=await import('../lib/borrowerAuth.js');
const originalNow=Date.now;
let clock=Math.ceil(originalNow()/60000)*60000;
Date.now=()=>clock;
const app=express();app.use((req,_res,next)=>{req.socket.encrypted=true;next();});app.use('/api',gasRouter);
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const origin=`http://127.0.0.1:${server.address().port}/api/gas`;
let a={},b={},admin={};
function reset(){
  clock=Math.ceil(originalNow()/60000)*60000;
  for(const table of ['item_reservations','reservation_notice_views','general_rentals','sid_rentals','rental_requests','scenario_items','registered_users','settings','admin_users','admin_sessions'])db.exec('DELETE FROM '+table);
  run("INSERT INTO registered_users(employee_id,name,active) VALUES ('1234','예약자',1),('5678','다른 대여자',1)");
  run("INSERT INTO scenario_items(id,name,stock,rented,request) VALUES ('000001','박스',8,0,NULL),('000002','Request 컵',8,0,'')");
  run("INSERT INTO admin_users(id,login_id,name,password_hash) VALUES (1,'test-admin','예약 관리자','unused')");
  const headers=id=>{let cookie='';issueBorrower({headers:{}},{setHeader(_key,value){cookie=value.split(';')[0];}},id);return {Cookie:cookie};};
  a=headers('1234');b=headers('5678');admin={'x-admin-token':issueAdminSession(1)};
}
const post=async(action,payload,headers=a)=>(await fetch(origin,{method:'POST',headers:{'Content-Type':'text/plain',...headers},body:JSON.stringify({action,payload})})).json();
const query=async(action,headers=a)=>(await fetch(origin+'?action='+action,{headers})).json();
const booking=(patch={})=>({clientId:'workflow-test-booking',floor:'B1',unit:'Unit 7',startsAt:new Date(clock+600000).toISOString(),items:[{id:'000001',quantity:2}],...patch});
async function reserve(patch={}){const result=await post('reserveItems',booking(patch));assert.equal(result.success,true,result.message);return result.ids[0];}
async function promote(){const result=await promoteDueReservations(recordBorrow);assert.ok(result.promoted>0);}
async function pickup(rowIndex,quantity){const result=await post('confirmPickup',{items:[{sheetType:'general',rowIndex,quantity}]},admin);assert.equal(result.success,true,result.message);}

test('전환 후 미수령 예약은 본인 목록에 남고 취소 즉시 재고를 풀어 다른 사람이 빌릴 수 있다',async()=>{
  reset();const id=await reserve();await promote();
  const mine=await query('getMyReservations');assert.equal(mine.items[0].status,'fulfilled');assert.equal(mine.items[0].quantity,2);
  const result=await post('cancelItemReservation',{reservationId:id});assert.equal(result.success,true);assert.equal(result.releasedQuantity,2);
  assert.equal(get("SELECT stock FROM scenario_items WHERE id='000001'").stock,8);
  assert.equal(get('SELECT cancel_by FROM general_rentals').cancel_by,'self');
  assert.equal((await query('getMyReservations')).items.length,0);
  const borrowed=await post('recordBorrow',{borrowList:[{employeeId:'5678',itemType:'general',borrowPurpose:'일반 대여',borrowedItems:[{id:'000001',name:'박스',quantity:8}]}]},b);
  assert.equal(borrowed.success,true);assert.equal(get("SELECT stock FROM scenario_items WHERE id='000001'").stock,0);
});
test('관리자 중복 취소 요청은 한 번만 복구하고 처리자를 기록한다',async()=>{
  reset();const id=await reserve();await promote();
  const results=await Promise.all([post('cancelAdminItemReservation',{reservationId:id},admin),post('cancelAdminItemReservation',{reservationId:id},admin)]);
  assert.equal(results.filter(result=>result.success).length,1);
  assert.equal(get("SELECT stock FROM scenario_items WHERE id='000001'").stock,8);
  const row=get('SELECT * FROM general_rentals');assert.equal(row.cancel_by,'admin');assert.equal(row.cancel_actor,'예약 관리자');
});
test('타인 예약·미인증 취소는 전환 후에도 거부한다',async()=>{
  reset();const id=await reserve();await promote();
  assert.equal((await post('cancelItemReservation',{reservationId:id},b)).success,false);
  assert.equal((await post('cancelAdminItemReservation',{reservationId:id},{})).success,false);
  assert.equal(get('SELECT returned FROM general_rentals').returned,'X');
  assert.equal(get("SELECT stock FROM scenario_items WHERE id='000001'").stock,6);
});
test('일부 수령 후 취소는 남은 수량만 복구하며 받은 Request 수량의 사번과 한도 제외 사유를 유지한다',async()=>{
  reset();const id=await reserve({items:[{id:'000002',quantity:3}],requestRental:{mode:'request',reason:'업체 전달'}});await promote();
  await pickup(get('SELECT id FROM general_rentals').id,1);
  const received=get('SELECT * FROM general_rentals WHERE picked_up_at IS NOT NULL');
  assert.equal(received.employee_id,'1234');assert.equal(received.type_limit_exempt,'Y');assert.equal(received.type_limit_exempt_reason,'업체 전달');
  assert.equal((await query('getMyReservations')).items[0].quantity,2);
  assert.equal((await query('getActiveItemTypeCount')).count,0);
  const cancelled=await post('cancelItemReservation',{reservationId:id});assert.equal(cancelled.success,true);assert.equal(cancelled.releasedQuantity,2);
  assert.equal(get("SELECT stock FROM scenario_items WHERE id='000002'").stock,7);
  assert.equal(get('SELECT qty FROM general_rentals WHERE returned=\'X\'').qty,1);
});
test('모두 수령한 예약 취소는 거부하고 정상 대여를 유지한다',async()=>{
  reset();const id=await reserve();await promote();await pickup(get('SELECT id FROM general_rentals').id,2);
  assert.equal((await post('cancelAdminItemReservation',{reservationId:id},admin)).success,false);
  assert.equal(get('SELECT returned FROM general_rentals').returned,'X');assert.equal(get("SELECT stock FROM scenario_items WHERE id='000001'").stock,6);
});
test('취소 재고 복구 오류는 예약과 대여 상태를 함께 롤백한다',async()=>{
  reset();const id=await reserve();await promote();
  db.exec("CREATE TRIGGER fail_workflow_cancel BEFORE UPDATE OF stock ON scenario_items BEGIN SELECT RAISE(ABORT,'test restore failure'); END");
  try{assert.equal((await post('cancelAdminItemReservation',{reservationId:id},admin)).success,false);assert.equal(get('SELECT status FROM item_reservations').status,'fulfilled');assert.equal(get('SELECT returned FROM general_rentals').returned,'X');assert.equal(get("SELECT stock FROM scenario_items WHERE id='000001'").stock,6);}
  finally{db.exec('DROP TRIGGER fail_workflow_cancel');}
});
test('같은 요청의 재전송은 같은 예약만 반환하며 시각·좌석·수량·방식·사유 변경은 조용히 무시하지 않는다',async()=>{
  reset();const payload=booking({items:[{id:'000002',quantity:2}],requestRental:{mode:'request',reason:'업체 촬영'}});
  const first=await post('reserveItems',payload);assert.equal(first.success,true);
  const retry=await post('reserveItems',{...payload,items:[{id:'2',quantity:1},{id:'000002',quantity:1}]});assert.deepEqual(retry.ids,first.ids);
  for(const patch of [{startsAt:new Date(Date.parse(payload.startsAt)+60000).toISOString()},{unit:'Unit 8'},{items:[{id:'000002',quantity:1}]},{requestRental:{mode:'general',reason:''}},{requestRental:{mode:'request',reason:'다른 사유'}}]){
    const result=await post('reserveItems',{...payload,...patch});assert.equal(result.success,false);assert.match(result.message || result.error,/요청 내용이 다릅니다/);
  }
  assert.equal(get('SELECT COUNT(*) AS count FROM item_reservations').count,1);
});
test('취소한 요청 번호를 재전송해도 예약 성공으로 잘못 안내하지 않는다',async()=>{
  reset();const payload=booking();const result=await post('reserveItems',payload);
  assert.equal((await post('cancelItemReservation',{reservationId:result.ids[0]})).success,true);
  const retry=await post('reserveItems',payload);assert.equal(retry.success,false);assert.match(retry.message || retry.error,/이미 취소/);
});
test('새 예약 안내 확인 여부와 관계없이 일반 대여를 허용하되 실제 재고 부족은 막는다',async()=>{
  reset();await reserve({startsAt:new Date(clock+3600000).toISOString()});
  const borrow=quantity=>post('recordBorrow',{borrowList:[{employeeId:'5678',itemType:'general',borrowPurpose:'일반 대여',borrowedItems:[{id:'000001',name:'박스',quantity}]}]},b);
  assert.equal((await borrow(8)).success,true);assert.equal((await borrow(1)).success,false);
  assert.equal(get('SELECT status FROM item_reservations').status,'reserved');
});
test('SID 물품의 부분 수령도 사번과 한도 제외 정보를 보존한다',async()=>{
  reset();run("INSERT INTO sid_rentals(employee_id,borrower_name,item_label,returned,type_limit_exempt,type_limit_exempt_reason) VALUES ('1234','예약자','[000002] Request 컵 x 3','X','Y','SID 업체용')");
  const row=get('SELECT id FROM sid_rentals');
  const result=await post('confirmPickup',{items:[{sheetType:'scenario',rowIndex:row.id,quantity:1}]},admin);assert.equal(result.success,true,result.message);
  const received=get('SELECT * FROM sid_rentals WHERE picked_up_at IS NOT NULL');assert.equal(received.employee_id,'1234');assert.equal(received.type_limit_exempt,'Y');assert.equal(received.type_limit_exempt_reason,'SID 업체용');
});
test.after(async()=>{Date.now=originalNow;await new Promise(resolve=>server.close(resolve));db.close();});
