import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { fileURLToPath } from 'node:url';
process.env.WMS_DB_PATH=':memory:';
process.env.SM_SYNC='off';
process.env.WMS_HTTPS_CONFIG=fileURLToPath(new URL('../fixtures/https-auth-test.json',import.meta.url));
const {db,run}=await import('../db.js');
const {adminRentalNotifications}=await import('../lib/adminRentalNotifications.js');
const {gasRouter}=await import('./gas.js');
const {issueAdminSession}=await import('../lib/auth.js');
run("INSERT INTO admin_users (id,login_id,name,password_hash) VALUES (1,'test','관리자','unused')");
const app=express(); app.use('/api',gasRouter);
const server=app.listen(0,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));
const origin=`http://127.0.0.1:${server.address().port}/api/gas?action=getAdminRentalNotifications`;
const headers={'x-admin-token':issueAdminSession(1)};
function reset(){for(const table of ['sid_rentals','general_rentals','item_reservations','photo_reviews','return_photos','unattended_pickup_photos','warehouse_manual_requests'])run(`DELETE FROM ${table}`);}
function loan(requestNo,picked=null,returned='X',employee='1234'){
  return Number(run(`INSERT INTO general_rentals (employee_id,borrower_name,item_id,item_label,qty,request_no,picked_up_at,returned,status)
    VALUES (?,'사용자','000001','물품',2,?,?,?,'active')`,[employee,requestNo,picked,returned]).lastInsertRowid);
}
function booking(client,status='reserved',requestNo=null,item='000001',employee='1234'){
  run(`INSERT INTO item_reservations (employee_id,borrower_name,floor,unit,item_id,variant_id,quantity,starts_at_ms,created_at_ms,client_id,status,request_no)
    VALUES (?,'사용자','B1','Human Unit',?,0,2,?,?,?, ?,?)`,[employee,item,Date.now()+3600000,Date.now(),client,status,requestNo]);
}
test('빈 대기 목록은 모두 0',()=>{reset();assert.deepEqual(adminRentalNotifications(),{pickup:0,reservations:0,photoReviews:0,objectReports:0});});
test('신청에 여러 물품·SID가 있어도 1건, 수령·취소·반납 건 제외',()=>{
  reset();loan(1);loan(1);loan(2);loan(3,'2026-10-14 10:00:00');loan(4,null,'O');
  run("INSERT INTO sid_rentals (request_no,borrower_name,item_label,returned) VALUES (1,'사용자','[000001] 물품','X')");
  assert.equal(adminRentalNotifications().pickup,2);
  run("UPDATE general_rentals SET picked_up_at='2026-10-14 10:00:00' WHERE request_no=2");
  assert.equal(adminRentalNotifications().pickup,1);
});
test('예약은 사번·신청 묶음 단위, 전환 후 미수령만 유지',()=>{
  reset();booking('booking-1');booking('booking-1','reserved',null,'000002');booking('booking-1','reserved',null,'000003','5678');
  booking('booking-2','fulfilled',7);loan(7);booking('booking-3','cancelled');booking('booking-4','fulfilled',8);loan(8,'received');
  assert.deepEqual(adminRentalNotifications(),{pickup:1,reservations:3,photoReviews:0,objectReports:0});
  run("UPDATE general_rentals SET picked_up_at='received' WHERE request_no=7");
  assert.deepEqual(adminRentalNotifications(),{pickup:0,reservations:2,photoReviews:0,objectReports:0});
});
test('종류가 다른 미수령 대여를 해당 예약으로 오인하지 않음',()=>{
  reset();booking('booking-variant','fulfilled',9);loan(9);
  run('UPDATE general_rentals SET variant_id=10');
  assert.equal(adminRentalNotifications().reservations,0);
});
test('과거 신청 번호 없는 기록은 묶음·신원·시각으로 구분',()=>{
  reset();loan(null);loan(null);run("UPDATE general_rentals SET batch_id='old-batch',employee_id='1234'");
  loan(null,null,'X','5678');run("UPDATE general_rentals SET batch_id='old-batch' WHERE employee_id='5678'");
  assert.equal(adminRentalNotifications().pickup,2);
});
test('알림 API는 관리자만 접근하며 개인·물품 상세는 반환하지 않음',async()=>{
  reset();loan(1);booking('booking-api');
  for(const bad of [{},{'x-admin-token':'invalid'}])assert.equal((await(await fetch(origin,{headers:bad})).json()).success,false);
  const result=await(await fetch(origin,{headers})).json();
  assert.deepEqual(result,{success:true,pickup:1,reservations:1,photoReviews:0,objectReports:0});
});
test('예약 마감이 지나면 알림 조회에서도 만료된 예약 제외',async()=>{
  reset();booking('booking-expired');
  run('UPDATE item_reservations SET starts_at_ms=?',[Date.now()-21*60000]);
  const result=await(await fetch(origin,{headers})).json();
  assert.deepEqual(result,{success:true,pickup:0,reservations:0,photoReviews:0,objectReports:0});
});
test('사진 확인 대기는 세 종류 합계이며 일반 반납·사진 없는 기록·확인 완료는 제외',async()=>{
  reset();
  for(const [id,path,source] of [[1,'/photo.jpg','unattended'],[2,'/admin.jpg','admin'],[3,null,'unattended'],[4,'','unattended']])
    run('INSERT INTO return_photos (id,image_path,source) VALUES (?,?,?)',[id,path,source]);
  for(const [id,path] of [[1,'/pickup.jpg'],[2,'/checked.jpg'],[3,'']])
    run("INSERT INTO unattended_pickup_photos (id,client_id,created_at,image_path) VALUES (?,?,'2026-10-14',?)",[id,`pickup-${id}`,path]);
  for(const [id,path] of [[1,'/tool.jpg'],[2,'/issue.jpg'],[3,'']])
    run("INSERT INTO warehouse_manual_requests (id,client_id,employee_id,borrower_name,floor,occurred_at,image_path) VALUES (?,?,'1234','사용자','B1','2026-10-14',?)",[id,`tool-${id}`,path]);
  run("INSERT INTO photo_reviews (kind,photo_id,status) VALUES ('pickup',2,'ok'),('tool',2,'issue'),('return',999,'ok')");
  const countUrl=origin.replace('getAdminRentalNotifications','getUnattendedPhotoReviewCounts');
  const detail=await(await fetch(countUrl,{headers})).json();
  assert.deepEqual(detail.counts,{return:1,pickup:1,tool:1});
  const result=await(await fetch(origin,{headers})).json();
  assert.deepEqual(result,{success:true,pickup:0,reservations:0,photoReviews:3,objectReports:0});
  run("INSERT INTO photo_reviews (kind,photo_id,status) VALUES ('return',1,'ok')");
  assert.equal(adminRentalNotifications().photoReviews,2);
  run("DELETE FROM photo_reviews WHERE kind='pickup' AND photo_id=2");
  assert.equal(adminRentalNotifications().photoReviews,3);
  run("UPDATE unattended_pickup_photos SET image_path='' WHERE id=2");
  assert.equal(adminRentalNotifications().photoReviews,2);
});
test.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
