import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
process.env.WMS_DB_PATH=':memory:';
process.env.SM_SYNC='off';
const {db,run,get}=await import('../db.js');
const {gasRouter}=await import('./gas.js');
const {issueAdminSession}=await import('../lib/auth.js');
run("INSERT INTO admin_users (id,login_id,name,password_hash) VALUES (1,'test','테스트 관리자','unused')");
run("INSERT INTO return_photos (id,image_path,source) VALUES (1,'/return.jpg','unattended')");
run("INSERT INTO unattended_pickup_photos (id,client_id,created_at,image_path) VALUES (1,'photo-test','2026-10-14','/pickup.jpg')");
run("INSERT INTO warehouse_manual_requests (id,client_id,employee_id,borrower_name,floor,occurred_at,image_path) VALUES (1,'tool-test','1234','테스트','B1','2026-10-14','/tool.jpg')");
const app=express();app.use(express.json());app.use('/api',gasRouter);
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base=`http://127.0.0.1:${server.address().port}/api/gas`;
const headers={'Content-Type':'text/plain;charset=utf-8','x-admin-token':issueAdminSession(1)};
const save=async(payload,h=headers)=>await(await fetch(base,{method:'POST',headers:h,body:JSON.stringify({action:'setPhotoReview',payload})})).json();
for(const [kind,action] of [['return','getUnattendedReturnPhotos'],['pickup','getPickupPhotos'],['tool','getToolRequestPhotos']]){
  test(`${kind}: 문제 사유 저장·재조회·수정 및 알림 집계`,async()=>{
    const note='  케이블 연결부 확인 필요\n파손 여부 재확인  ';
    const result=await save({kind,id:1,status:'issue',note});
    assert.equal(result.success,true);assert.equal(result.review.note,note.trim());
    const reload=await(await fetch(`${base}?action=${action}`,{headers})).json();
    assert.equal(reload.items[0].review.note,note.trim());
    const edited=await save({kind,id:1,status:'issue',note:'실물 확인 후 관리자에게 전달함'});
    assert.equal(edited.review.status,'issue');assert.equal(edited.review.note,'실물 확인 후 관리자에게 전달함');
    const counts=await(await fetch(`${base}?action=getUnattendedPhotoReviewCounts`,{headers})).json();
    assert.equal(counts.counts[kind],0);
    assert.equal(get('SELECT note FROM photo_reviews WHERE kind=? AND photo_id=1',[kind]).note,edited.review.note);
  });
}
test('관리자 인증 없이 메모를 덮어쓸 수 없음',async()=>{
  const result=await save({kind:'return',id:1,status:'issue',note:'unauthorized'},{'Content-Type':'text/plain'});
  assert.equal(result.success,false);
  assert.notEqual(get("SELECT note FROM photo_reviews WHERE kind='return' AND photo_id=1").note,'unauthorized');
});
test.after(async()=>{await new Promise(r=>server.close(r));db.close();});
