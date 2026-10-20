import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { fileURLToPath } from "node:url";

process.env.WMS_DB_PATH=":memory:";
process.env.SM_SYNC="off";
process.env.TZ="Asia/Seoul";
process.env.WMS_HTTPS_CONFIG=fileURLToPath(new URL("../fixtures/https-auth-test.json",import.meta.url));
const {db,run,get,all}=await import("../db.js");
const {recordBorrow,gasRouter}=await import("../routes/gas.js");
const {promoteDueReservations,startReservationPromotion}=await import("./reservationPromotion.js");
const {cancelUnclaimedPickups}=await import("./pickupTimeout.js");
const {issueAdminSession}=await import("./auth.js");
const {reservations,createReservations}=await import("./itemReservations.js");
const originalNow=Date.now;
let clock=originalNow();
Date.now=()=>clock;
function reset(){
  clock=originalNow();
  for(const table of ["item_reservations","reservation_notice_views","general_rentals","sid_rentals","rental_requests","scenario_items","scenario_item_variants","registered_users","settings","admin_sessions","admin_users","penalties"])db.exec("DELETE FROM "+table);
  run("INSERT INTO registered_users (employee_id,name,active) VALUES ('1234','테스트 예약자',1)");
  run("INSERT INTO scenario_items (id,name,stock,rented) VALUES ('000001','예약 박스',5,0),('000002','예약 컵',5,0)");
}
function reserve({id=1,itemId='000001',variantId=0,quantity=1,startsAt=clock+600000,clientId='promotion-test',status='reserved'}={}){
  run(`INSERT INTO item_reservations (id,employee_id,borrower_name,floor,unit,item_id,variant_id,quantity,starts_at_ms,created_at_ms,client_id,status)
    VALUES (?,'1234','테스트 예약자','B1','Human Unit 7',?,?,?,?,?,?,?)`,[id,itemId,variantId,quantity,startsAt,clock,clientId,status]);
}
const count=table=>get("SELECT COUNT(*) AS count FROM "+table).count;
const kst=ms=>new Date(ms+9*3600000).toISOString().slice(0,19).replace('T',' ');
const tick=()=>promoteDueReservations(recordBorrow,clock);

test('10분 전 경계에서 같은 예약을 한 신청으로 옮기고 수령 확인·반납은 자동 완료하지 않는다',async()=>{
  reset();const threshold=clock;
  reserve({quantity:2});reserve({id:2,itemId:'000002'});
  clock=threshold-1;assert.equal((await tick()).promoted,0);assert.equal(count('general_rentals'),0);
  clock=threshold;assert.equal((await tick()).promoted,2);
  assert.equal(count('rental_requests'),1);assert.equal(count('general_rentals'),2);
  const rows=all('SELECT * FROM general_rentals');
  assert.ok(rows.every(row=>row.picked_up_at===null&&row.confirmed_at===null&&row.returned==='X'&&row.status==='active'&&row.employee_id==='1234'));
  assert.ok(rows.every(row=>row.category==='예약 대여'&&row.floor==='B1'&&row.unit==='Human Unit 7'));
  assert.equal(new Set(rows.map(row=>row.request_no)).size,1);
  assert.deepEqual(all('SELECT stock,rented FROM scenario_items ORDER BY id').map(row=>({...row})),[{stock:3,rented:2},{stock:4,rented:1}]);
  assert.ok(all('SELECT * FROM item_reservations').every(row=>row.status==='fulfilled'&&row.request_no===rows[0].request_no));
  assert.equal((await tick()).promoted,0);assert.equal(count('general_rentals'),2);
});
test('동시에 실행해도 중복 신청·재고 이중 차감이 없다',async()=>{
  reset();reserve();
  const results=await Promise.all([tick(),tick()]);
  assert.equal(results.reduce((sum,row)=>sum+row.promoted,0),1);
  assert.equal(count('rental_requests'),1);assert.equal(get("SELECT stock FROM scenario_items WHERE id='000001'").stock,4);
});
test('종류별 재고 부족은 전체 묶음을 유지하고 재고가 회복되면 다시 전환한다',async()=>{
  reset();run("INSERT INTO scenario_item_variants (id,item_id,name,stock,rented) VALUES (1,'000001','빨강',1,0),(2,'000001','파랑',2,0)");
  run("UPDATE scenario_items SET stock=3 WHERE id='000001'");
  reserve({variantId:1,quantity:2});reserve({id:2,variantId:2});
  assert.equal((await tick()).blocked,2);assert.equal(count('general_rentals'),0);assert.equal(count('rental_requests'),0);
  assert.ok(all('SELECT * FROM item_reservations').every(row=>row.status==='reserved'&&row.promotion_error));
  assert.equal(get("SELECT stock FROM scenario_items WHERE id='000001'").stock,3);
  run("UPDATE scenario_item_variants SET stock=3 WHERE id=1");run("UPDATE scenario_items SET stock=5 WHERE id='000001'");
  assert.equal((await tick()).promoted,2);
  assert.ok(all('SELECT promotion_error FROM item_reservations').every(row=>row.promotion_error===null));
  assert.deepEqual(all('SELECT stock,rented FROM scenario_item_variants ORDER BY id').map(row=>({...row})),[{stock:1,rented:2},{stock:1,rented:1}]);
});
test('취소·탈퇴·삭제된 종류와 보관 물품은 자동으로 대여하지 않는다',async()=>{
  reset();reserve({status:'cancelled'});assert.equal((await tick()).promoted,0);
  reserve({id:2,variantId:99,clientId:'changed-reservation'});assert.equal((await tick()).blocked,1);assert.equal(count('general_rentals'),0);
  run("UPDATE item_reservations SET variant_id=0 WHERE id=2");run("UPDATE registered_users SET active=0");
  assert.equal((await tick()).blocked,1);
  run("UPDATE registered_users SET active=1");run("UPDATE scenario_items SET is_storage='Y' WHERE id='000001'");
  assert.equal((await tick()).blocked,1);assert.equal(count('rental_requests'),0);
});
test('한도와 대여 중단을 존중하고 해제 후 전환한다',async()=>{
  reset();reserve();run("INSERT INTO settings (key,value) VALUES ('borrow_lock',?)",[JSON.stringify({locked:true,units:[]})]);
  assert.equal((await tick()).blocked,1);assert.equal(count('general_rentals'),0);
  run("DELETE FROM settings WHERE key='borrow_lock'");run("INSERT INTO settings (key,value) VALUES ('max_item_types_default','1')");
  run("INSERT INTO general_rentals (employee_id,borrower_name,email,item_id,item_label,qty,returned,status,picked_up_at) VALUES ('1234','테스트 예약자','1234@cfgw-kr.com','000002','예약 컵',1,'X','active','2026-10-13 10:00:00')");
  assert.equal((await tick()).blocked,1);assert.match(get('SELECT promotion_error FROM item_reservations').promotion_error,/한도/);
  run("UPDATE settings SET value='2' WHERE key='max_item_types_default'");assert.equal((await tick()).promoted,1);
});
test('저장 중 오류가 나면 신청·재고·예약 상태를 모두 롤백한다',async()=>{
  reset();reserve();reserve({id:2,itemId:'000002'});
  db.exec("CREATE TRIGGER fail_test_promotion BEFORE INSERT ON general_rentals WHEN NEW.item_id='000002' BEGIN SELECT RAISE(ABORT,'test write failed'); END");
  try{
    assert.equal((await tick()).blocked,2);assert.equal(count('rental_requests'),0);assert.equal(count('general_rentals'),0);
    assert.ok(all('SELECT stock FROM scenario_items').every(row=>row.stock===5));
    assert.ok(all('SELECT status FROM item_reservations').every(row=>row.status==='reserved'));
  }finally{db.exec('DROP TRIGGER fail_test_promotion');}
  assert.equal((await tick()).promoted,2);
});
test('앞의 품절 묶음이 뒤의 정상 예약을 계속 막지 않는다',async()=>{
  reset();run("UPDATE scenario_items SET stock=0 WHERE id='000001'");
  for(let id=1;id<=20;id++)reserve({id,clientId:'blocked-'+id});
  reserve({id:21,itemId:'000002',clientId:'ready-last'});
  assert.equal((await tick()).promoted,0);assert.equal((await tick()).promoted,1);
  assert.equal(get('SELECT status FROM item_reservations WHERE id=21').status,'fulfilled');
});
test('클라이언트 payload의 자동 전환 플래그로 대여 시각을 우회하지 못한다',async()=>{
  reset();reserve({startsAt:clock+3600000});
  const result=await recordBorrow({admin:{name:'테스트 관리자'},payload:{autoReservation:true,borrowList:[{
    employeeId:'1234',borrowerName:'테스트 예약자',affiliation:'cfgw',itemType:'general',floor:'B1',unit:'Human Unit 7',borrowedItems:[{id:'000001',name:'예약 박스',quantity:1,reservationId:1}],
  }]}});
  assert.equal(result.success,false);assert.equal(count('general_rentals'),0);
});
test('대여 확인 조회가 도래한 예약을 실제 미수령 대여 줄로 표시한다',async()=>{
  reset();reserve();run("INSERT INTO admin_users (id,login_id,name,password_hash) VALUES (1,'test-admin','관리자','unused')");
  const token=issueAdminSession(1),app=express();app.use('/api',gasRouter);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  try{
    const result=await(await fetch('http://127.0.0.1:'+server.address().port+'/api/gas?action=getUnreturnedItems',{headers:{'x-admin-token':token}})).json();
    assert.equal(result.success,true);assert.equal(result.items.length,1);assert.equal(result.items[0].pickedUp,false);
    assert.equal(result.items[0].employeeId,'1234');assert.ok(result.items[0].requestNo);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('자동 전환 예약의 미수령 시간은 실제 예정 시각부터 계산한다',async()=>{
  reset();const applied=clock,planned=clock+600000;reserve({startsAt:planned});await tick();
  run('UPDATE general_rentals SET applied_at=?',[kst(applied)]);
  clock=planned+20*60000-1;assert.equal(cancelUnclaimedPickups().cancelled,0);
  clock=planned+20*60000;assert.equal(cancelUnclaimedPickups().cancelled,1);
  assert.equal(get("SELECT stock FROM scenario_items WHERE id='000001'").stock,5);
  assert.equal(cancelUnclaimedPickups().cancelled,0);
  assert.equal(reservations({admin:true}).length,0);
});

test('예약 관리에는 미수령만 유지하며 일부 수령은 남은 수량, 전체 수령은 해당 물품만 제거한다',async()=>{
  reset();reserve({quantity:2});reserve({id:2,itemId:'000002'});
  reserve({id:3,startsAt:clock+3600000,clientId:'upcoming-reservation'});
  await tick();
  let rows=reservations({admin:true});
  assert.deepEqual(rows.map(r=>[r.id,r.status,r.quantity]),[[1,'fulfilled',2],[2,'fulfilled',1],[3,'reserved',1]]);
  assert.deepEqual(reservations().map(r=>r.id),[3]);
  assert.deepEqual(reservations({mine:true,employeeId:'1234'}).map(r=>r.id),[1,2,3]);
  assert.equal(rows[0].requestNo,rows[1].requestNo);
  run("INSERT INTO admin_users (id,login_id,name,password_hash) VALUES (1,'test-admin','관리자','unused')");
  const token=issueAdminSession(1),app=express();app.use('/api',gasRouter);
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const origin='http://127.0.0.1:'+server.address().port+'/api/gas';
  const first=get("SELECT id FROM general_rentals WHERE item_id='000001'");
  async function pickup(rowIndex,quantity){
    const result=await(await fetch(origin,{method:'POST',headers:{'Content-Type':'text/plain','x-admin-token':token},body:JSON.stringify({action:'confirmPickup',payload:{items:[{sheetType:'general',rowIndex,quantity}]}})})).json();
    assert.equal(result.success,true);
  }
  async function list(){return (await(await fetch(origin+'?action=getAdminReservations',{headers:{'x-admin-token':token}})).json()).items;}
  try{
    await pickup(first.id,1);
    rows=await list();assert.deepEqual(rows.map(r=>[r.id,r.quantity]),[[1,1],[2,1],[3,1]]);
    await pickup(first.id,1);
    rows=await list();assert.deepEqual(rows.map(r=>r.id),[2,3]);
    await pickup(get("SELECT id FROM general_rentals WHERE item_id='000002'").id,1);
    assert.deepEqual((await list()).map(r=>r.id),[3]);
    assert.equal(get("SELECT stock FROM scenario_items WHERE id='000001'").stock,3);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('종류가 다른 미수령 대여는 수령한 예약을 다시 노출하지 않는다',async()=>{
  reset();
  run("INSERT INTO scenario_item_variants(id,item_id,name,stock,rented) VALUES (1,'000001','빨강',2,0),(2,'000001','파랑',3,0)");
  reserve({variantId:1});reserve({id:2,variantId:2});await tick();
  run("UPDATE general_rentals SET picked_up_at='2026-10-13 15:00:00' WHERE variant_id=1");
  assert.deepEqual(reservations({admin:true}).map(r=>r.id),[2]);
  run("UPDATE general_rentals SET returned='O',status='archived' WHERE variant_id=2");
  assert.equal(reservations({admin:true}).length,0);
});

function requestBooking(patch={}){
  return {clientId:'request-reservation-test',floor:'B1',unit:'Human Unit 7',startsAt:new Date(Math.ceil((clock+600000)/60000)*60000).toISOString(),
    items:[{id:'000001',quantity:1},{id:'000002',quantity:1}],...patch};
}
test('Request 예약은 방식과 공백 아닌 사유를 검증하고 일반 물품의 한도 제외 위조를 저장하지 않는다',()=>{
  reset();run("UPDATE scenario_items SET request='' WHERE id='000001'");
  for(const requestRental of [undefined,{mode:'invalid'},{mode:'request',reason:'   '}]){
    assert.throws(()=>createReservations('1234',requestBooking({requestRental})),/방식|사유/);
    assert.equal(count('item_reservations'),0);
  }
  createReservations('1234',requestBooking({requestRental:{mode:'request',reason:'  업체 전달용  '}}));
  const rows=all('SELECT item_id,request_mode,request_reason FROM item_reservations ORDER BY id');
  assert.deepEqual(rows.map(r=>[r.item_id,r.request_mode,r.request_reason]),[['000001','request','업체 전달용'],['000002',null,null]]);
  const adminRows=reservations({admin:true});
  assert.deepEqual(adminRows[0].requestRental,{mode:'request',reason:'업체 전달용'});
  assert.deepEqual(reservations({mine:true,employeeId:'1234'})[0].requestRental,adminRows[0].requestRental);
  assert.ok(reservations().every(r=>!('requestRental' in r)));
});
test('혼합 Request 예약은 자동 전환 후 Request 줄만 사유와 한도 제외를 유지한다',async()=>{
  reset();run("UPDATE scenario_items SET request='회사 A' WHERE id='000001'");
  run("INSERT INTO settings(key,value) VALUES ('max_item_types_default','1')");
  const booking=requestBooking({requestRental:{mode:'request',reason:'업체 촬영용'}});
  createReservations('1234',booking);clock=Date.parse(booking.startsAt)-600000;
  assert.equal((await tick()).promoted,2);
  const rows=all('SELECT * FROM general_rentals ORDER BY id');
  assert.equal(rows[0].type_limit_exempt,'Y');assert.equal(rows[0].type_limit_exempt_reason,'업체 촬영용');assert.equal(rows[0].purpose,'업체 촬영용');
  assert.equal(rows[1].type_limit_exempt,null);assert.equal(rows[1].type_limit_exempt_reason,null);assert.equal(rows[1].purpose,'예약 대여');
  assert.equal(rows[0].request_no,rows[1].request_no);
  assert.ok(all('SELECT stock,rented FROM scenario_items').every(r=>r.stock===4&&r.rented===1));
});
test('Request 물품을 일반 대여로 예약하면 기존 한도를 적용하고 사유와 제외를 부여하지 않는다',async()=>{
  reset();run("UPDATE scenario_items SET request='' WHERE id='000001'");run("INSERT INTO settings(key,value) VALUES ('max_item_types_default','1')");
  const booking=requestBooking({requestRental:{mode:'general',reason:'이 사유는 저장하지 않음'}});
  createReservations('1234',booking);clock=Date.parse(booking.startsAt)-600000;
  assert.equal((await tick()).blocked,2);assert.equal(count('general_rentals'),0);
  assert.equal(get("SELECT request_reason FROM item_reservations WHERE item_id='000001'").request_reason,null);
  run("UPDATE settings SET value='2' WHERE key='max_item_types_default'");assert.equal((await tick()).promoted,2);
  assert.ok(all('SELECT * FROM general_rentals').every(r=>r.type_limit_exempt===null&&r.type_limit_exempt_reason===null));
});
test('Request만 신청하면 기존 한도를 초과한 상태에서도 한도 제외지만 함께 신청한 일반 물품은 차단된다',async()=>{
  reset();run("UPDATE scenario_items SET request='' WHERE id='000001'");run("INSERT INTO settings(key,value) VALUES ('max_item_types_default','1')");
  for(const id of ['000002','000003']) run("INSERT INTO general_rentals(employee_id,borrower_name,email,item_id,item_label,qty,returned,status) VALUES ('1234','테스트 예약자','1234@cfgw-kr.com',?,'기존 물품',1,'X','active')",[id]);
  const booking=requestBooking({requestRental:{mode:'request',reason:'업체 전용'}});createReservations('1234',booking);clock=Date.parse(booking.startsAt)-600000;
  assert.equal((await tick()).blocked,2);
  run("UPDATE item_reservations SET status='cancelled' WHERE item_id='000002'");
  assert.equal((await tick()).promoted,1);
  assert.equal(get("SELECT type_limit_exempt FROM general_rentals WHERE item_id='000001'").type_limit_exempt,'Y');
});
test('기존 Request 예약과 예약 후 Request 지정된 물품은 일반 방식으로 전환해 임의로 한도 제외하지 않는다',async()=>{
  reset();reserve();run("UPDATE scenario_items SET request='' WHERE id='000001'");
  assert.equal((await tick()).promoted,1);
  assert.equal(get('SELECT type_limit_exempt FROM general_rentals').type_limit_exempt,null);
});
test('화면을 열지 않아도 시작 작업이 자동 전환을 수행한다',async()=>{
  reset();reserve();const stop=startReservationPromotion(recordBorrow);
  try{await new Promise(resolve=>setTimeout(resolve,1200));assert.equal(get('SELECT status FROM item_reservations').status,'fulfilled');}
  finally{stop();}
});
test.after(()=>{Date.now=originalNow;db.close();});
