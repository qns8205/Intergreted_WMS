import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {fileURLToPath} from "node:url";

process.env.WMS_DB_PATH=":memory:";
process.env.SM_SYNC="off";
process.env.TZ="Asia/Seoul";
process.env.WMS_HTTPS_CONFIG=fileURLToPath(new URL("../fixtures/https-auth-test.json",import.meta.url));
const {db,run,get,all}=await import("../db.js");
const {gasRouter,recordBorrow}=await import("./gas.js");
const {promoteDueReservations}=await import("../lib/reservationPromotion.js");
const {requestLookupRouter,REQUEST_LOOKUP_PATH}=await import("./requestLookup.js");
const {issueAdminSession}=await import("../lib/auth.js");
const {rentalTypeLimitPolicy}=await import("../lib/rentalTypeLimitPolicy.js");
const app=express();app.use('/api',gasRouter);app.use(requestLookupRouter);
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const qr=async()=>{
  const response=await fetch(origin+REQUEST_LOOKUP_PATH+'/api?employeeId=1234');
  assert.equal(response.status,200);const result=await response.json();assert.equal(result.success,true);return result;
};
let token='';
function reset(){
  for(const table of ['general_rentals','sid_rentals','item_reservations','rental_requests','scenario_items','settings','registered_users','penalties','admin_users','admin_sessions']) db.exec('DELETE FROM '+table);
  run("INSERT INTO registered_users(employee_id,name,active) VALUES ('1234','테스트',1),('5678','테스트',1)");
  run("INSERT INTO scenario_items(id,name,stock,root_slot,image_path) VALUES ('000001','현재 물품',5,'100001','/current.png'),('000002','예약 물품',5,'200002','/reserved.png')");
  run("INSERT INTO settings(key,value) VALUES ('max_item_types_default','1')");
  run("INSERT INTO admin_users(id,login_id,name,password_hash) VALUES (1,'test-admin','관리자','unused')");token=issueAdminSession(1);
  run("INSERT INTO rental_requests(id,employee_id,borrower_name) VALUES (1,'1234','테스트'),(2,'1234','테스트')");
  run("INSERT INTO general_rentals(id,employee_id,borrower_name,email,item_id,item_label,qty,returned,status,picked_up_at,request_no,floor,unit) VALUES (1,'1234','테스트','1234@cfgw-kr.com','000001','현재 물품',2,'X','active','2026-10-13 10:00:00',1,'B1','Unit 7'),(2,'1234','테스트','1234@cfgw-kr.com','000002','예약 물품',3,'X','active',NULL,2,'B1','Unit 7')");
  run("INSERT INTO item_reservations(id,employee_id,borrower_name,floor,unit,item_id,quantity,starts_at_ms,created_at_ms,status,request_no,client_id) VALUES (1,'1234','테스트','B1','Unit 7','000002',3,?,?, 'fulfilled',2,'qr-reservation-test')",[Date.now(),Date.now()]);
}
async function post(action,payload){
  const result=await(await fetch(origin+'/api/gas',{method:'POST',headers:{'Content-Type':'text/plain','x-admin-token':token},body:JSON.stringify({action,payload})})).json();
  assert.equal(result.success,true,result.message);return result;
}
test('현재 대여와 예약 합산 한도 초과 시 QR 응답에서 예약 물품·사진·위치를 모두 숨긴다',async()=>{
  reset();const before=JSON.stringify(all('SELECT * FROM scenario_items'));
  const result=await qr();assert.equal(result.activeCount,0);
  assert.ok(!result.items.some(item=>item.id==='000002'));
  assert.ok(!JSON.stringify(result).includes('200002')&&!JSON.stringify(result).includes('/reserved.png'));
  assert.equal(JSON.stringify(all('SELECT * FROM scenario_items')),before);
  assert.equal(get('SELECT status FROM item_reservations').status,'fulfilled');
  const search=await(await fetch(origin+REQUEST_LOOKUP_PATH+'/item-locations?employeeId=1234&q='+encodeURIComponent('예약 물품'))).json();
  assert.deepEqual(search.items,[],'놓친 물품 검색에서도 아직 숨겨진 예약 위치를 공개하지 않는다');
});
test('관리자 부분 반납은 종류가 남으면 숨김을 유지하고 전체 반납 즉시 다음 조회에서 위치를 표시한다',async()=>{
  reset();await post('processReturn',{returnRequests:[{sheetType:'general',rowIndex:1,quantity:1}]});
  assert.ok(!(await qr()).items.some(item=>item.id==='000002'));
  await post('processReturn',{returnRequests:[{sheetType:'general',rowIndex:1,quantity:1}]});
  const result=await qr();const item=result.items.find(item=>item.id==='000002');
  assert.equal(item.location,'200002');assert.equal(item.quantity,3);assert.equal(result.activeCount,1);
  const search=await(await fetch(origin+REQUEST_LOOKUP_PATH+'/item-locations?employeeId=1234&q='+encodeURIComponent('예약 물품'))).json();
  assert.equal(search.items[0].location,'200002');
});
test('한도와 합산이 같으면 숨기지 않으며 설정을 올리거나 내리면 즉시 반영한다',async()=>{
  reset();run("UPDATE settings SET value='2' WHERE key='max_item_types_default'");
  assert.ok((await qr()).items.some(item=>item.id==='000002'));
  run("UPDATE settings SET value='1' WHERE key='max_item_types_default'");assert.ok(!(await qr()).items.some(item=>item.id==='000002'));
});
test('수량과 색상이 달라도 같은 물품 ID는 한 종으로만 합산한다',async()=>{
  reset();run("UPDATE general_rentals SET item_id='000002',variant_id=2 WHERE id=1");
  const result=await qr();assert.equal(result.activeCount,1);assert.ok(result.items.some(item=>item.id==='000002'&&!item.pickedUp));
});
test('다른 사번의 대여와 이미 반납한 물품은 합산에 넣지 않는다',async()=>{
  reset();run("UPDATE general_rentals SET employee_id='5678',email='5678@cfgw-kr.com' WHERE id=1");
  assert.equal((await qr()).activeCount,1);
  run("UPDATE general_rentals SET employee_id='1234',returned='O' WHERE id=1");assert.equal((await qr()).activeCount,1);
});
test('Request 한도 제외는 합산에서 빼고 Request만 있는 신청은 기존 한도 초과 상태에서도 표시한다',async()=>{
  reset();run("UPDATE general_rentals SET type_limit_exempt='Y',type_limit_exempt_reason='업체용' WHERE id=1");assert.equal((await qr()).activeCount,1);
  run("UPDATE general_rentals SET type_limit_exempt=NULL WHERE id=1");
  run("INSERT INTO general_rentals(employee_id,borrower_name,item_id,item_label,qty,returned) VALUES ('1234','테스트','000003','기존 추가 물품',1,'X')");
  run("UPDATE general_rentals SET type_limit_exempt='Y',type_limit_exempt_reason='업체용' WHERE id=2");assert.equal((await qr()).activeCount,2);
});
test('한도 제외 좌석·무제한 설정과 개인 페널티 한도는 일반 대여와 같은 정책을 사용한다',async()=>{
  reset();run("INSERT INTO settings(key,value) VALUES ('floor_plan',?)",[JSON.stringify({floors:[{id:'B1',units:[{label:'Unit 7',exempt:true}]}]})]);
  assert.equal((await qr()).activeCount,1);
  run("DELETE FROM settings WHERE key='floor_plan'");run("DELETE FROM settings WHERE key='max_item_types_default'");assert.equal((await qr()).activeCount,1);
  run("INSERT INTO penalties(name,max_types,reason) VALUES ('테스트',1,'한도 조정')");assert.equal((await qr()).activeCount,0);
  assert.equal(rentalTypeLimitPolicy({name:'테스트'}).max,1);
});
test('예약이 아닌 일반 신청과 반납 안내는 한도 초과여도 기존 표시를 유지한다',async()=>{
  reset();run("DELETE FROM item_reservations");assert.equal((await qr()).activeCount,1);
  run("UPDATE general_rentals SET returned='O',return_source='admin',return_date=? WHERE id=2",[new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date())]);
  assert.ok((await qr()).items.some(item=>item.id==='000002'&&item.returned&&item.location==='200002'));
});
test('SID 대여 물품도 합산하고 예약의 대여 확인 후에는 숨김 대상에서 제외한다',async()=>{
  reset();run("DELETE FROM general_rentals WHERE id=1");
  run("INSERT INTO sid_rentals(employee_id,borrower_name,item_label,returned,picked_up_at) VALUES ('1234','테스트','[000001] 현재 물품 x2','X','2026-10-13 10:00:00')");
  assert.equal((await qr()).activeCount,0);
  await post('confirmPickup',{items:[{sheetType:'general',rowIndex:2,quantity:3}]});
  assert.ok((await qr()).items.some(item=>item.id==='000002'&&item.pickedUp));
});
test('아직 전환되지 않은 예약도 관리자 반납으로 한도를 확보한 뒤 자동 전환하면 QR에 위치가 나타난다',async()=>{
  reset();run('DELETE FROM general_rentals WHERE id=2');run("UPDATE item_reservations SET status='reserved',request_no=NULL");
  assert.equal((await promoteDueReservations(recordBorrow)).blocked,1);
  assert.ok(!(await qr()).items.some(item=>item.id==='000002'));
  await post('processReturn',{returnRequests:[{sheetType:'general',rowIndex:1,quantity:2}]});
  assert.equal((await promoteDueReservations(recordBorrow)).promoted,1);
  const result=await qr();assert.equal(result.activeCount,1);
  assert.equal(result.items.find(item=>item.id==='000002').location,'200002');
});
test.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
