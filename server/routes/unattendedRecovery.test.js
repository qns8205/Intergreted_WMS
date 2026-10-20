import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
process.env.WMS_DB_PATH=':memory:';process.env.SM_SYNC='off';
const uploads=fs.mkdtempSync(path.join(os.tmpdir(),'wms-recovery-test-'));
process.env.WMS_UPLOADS_DIR=uploads;
const {db,run,get,all}=await import('../db.js');
const {unattendedRouter}=await import('./unattended.js');
const {digest,issueKioskSession}=await import('../lib/unattendedKiosk.js');
const {issueAdminSession}=await import('../lib/auth.js');
const {cleanupOldReturnPhotos}=await import('../lib/returnPhotoRetention.js');
run("INSERT INTO admin_users (id,login_id,name,password_hash) VALUES (1,'test','테스트 관리자','unused')");
const admin={'x-admin-token':issueAdminSession(1)};
run("INSERT INTO settings(key,value) VALUES ('unattended_enabled','1'),('unattended_device_hash',?)",[digest('device-test')]);
run("INSERT INTO registered_users(employee_id,name,active) VALUES ('1234','테스트',1),('5678','타인',1)");
const headers={'Content-Type':'application/json','x-unattended-device':'device-test','x-unattended-session':issueKioskSession('1234')};
const app=express();app.use(express.json({limit:'20mb'}));app.use('/api',unattendedRouter);
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const base=`http://127.0.0.1:${server.address().port}/api/unattended`;
const photo='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="blue"/></svg>').toString('base64');
const post=async(route,body,h=headers)=>{const response=await fetch(base+'/'+route,{method:'POST',headers:{'Content-Type':'application/json',...h},body:JSON.stringify(body)});return {status:response.status,...await response.json()};};
function reset(){
 for(const table of ['unattended_operations','unattended_pickup_photos','unattended_return_batches','return_photos','general_rentals','sid_rentals','scenario_items','inventory_history','unattended_damage_pending'])run('DELETE FROM '+table);
 run("INSERT INTO scenario_items(id,name,stock,rented) VALUES ('000001','박스',0,3)");
 run("INSERT INTO general_rentals(id,employee_id,borrower_name,item_id,item_label,qty,returned,status,type_limit_exempt,type_limit_exempt_reason) VALUES (1,'1234','테스트','000001','박스',3,'X','active','Y','Request 목적')");
}
const request=(clientId,quantity=3)=>({clientId,items:[{sheetType:'general',rowIndex:1,quantity}],photo});
test('수령·반납 영수증과 파일 저장, 중복 요청은 재고를 한 번만 복구',async()=>{
 reset();const pickup=await post('confirm-pickup',request('api-pickup-00001'));
 assert.equal(pickup.status,200);assert.equal(pickup.completed,true);assert.equal(pickup.photoSaved,true);assert.ok(get('SELECT picked_up_at FROM general_rentals').picked_up_at);
 const returnBody=request('api-return-00001');
 const [a,b]=await Promise.all([post('return',returnBody),post('return',returnBody)]);
 assert.equal(a.completed,true);assert.equal(b.completed,true);assert.equal(a.batchId,b.batchId);
 assert.equal(get('SELECT stock FROM scenario_items').stock,3);assert.equal(get('SELECT COUNT(*) n FROM return_photos').n,1);
 for(const row of all('SELECT image_path FROM unattended_operations'))assert.ok(fs.existsSync(path.join(uploads,row.image_path.replace('/uploads/',''))));
 const status=await(await fetch(base+'/operation-status?clientId=api-return-00001',{headers})).json();assert.equal(status.result.batchId,a.batchId);
});
test('부분 수령도 Request 제외 정보를 이어 저장',async()=>{
 reset();const result=await post('confirm-pickup',request('api-partial-0001',1));assert.equal(result.completed,true);
 const rows=all('SELECT qty,picked_up_at,type_limit_exempt,type_limit_exempt_reason FROM general_rentals ORDER BY id');
 assert.deepEqual(rows.map(row=>row.qty),[2,1]);assert.equal(rows[1].type_limit_exempt,'Y');assert.equal(rows[1].type_limit_exempt_reason,'Request 목적');
});
test('일반 물품의 부분 반납과 SID 부분 수령·반납도 Request 정보를 보존',async()=>{
 reset();run("UPDATE general_rentals SET picked_up_at='2026-10-14 08:00:00'");
 const returned=await post('return',request('api-partial-return',1));assert.equal(returned.completed,true);
 assert.equal(get("SELECT type_limit_exempt FROM general_rentals WHERE returned='O'").type_limit_exempt,'Y');
 run("INSERT INTO sid_rentals(id,employee_id,borrower_name,sid,item_label,returned,status,type_limit_exempt,type_limit_exempt_reason) VALUES (1,'1234','테스트','S123','[000001] 박스 x 2','X','active','Y','Request 목적')");
 const picked=await post('confirm-pickup',{clientId:'api-sid-partial-01',photo,items:[{sheetType:'scenario',rowIndex:1,quantity:1}]});assert.equal(picked.completed,true);
 assert.equal(get('SELECT type_limit_exempt FROM sid_rentals WHERE picked_up_at IS NOT NULL').type_limit_exempt,'Y');
 run("UPDATE sid_rentals SET picked_up_at='2026-10-14 08:00:00',item_label='[000001] 박스 x 2' WHERE id=1");
 const ret=await post('return',{clientId:'api-sid-return-01',photo,items:[{sheetType:'scenario',rowIndex:1,quantity:1}]});assert.equal(ret.completed,true);
 assert.equal(get("SELECT type_limit_exempt_reason FROM sid_rentals WHERE returned='O'").type_limit_exempt_reason,'Request 목적');
});
test('다른 요청 번호로 동시에 같은 물품을 반납해도 최신 상태를 재검증해 재고 한 번만 복구',async()=>{
 reset();run("UPDATE general_rentals SET picked_up_at='2026-10-14 08:00:00'");
 const results=await Promise.all([post('return',request('different-race-01')),post('return',request('different-race-02'))]);
 assert.equal(results.filter(result=>result.completed).length,1);assert.equal(get('SELECT stock FROM scenario_items').stock,3);
});
test('사진 저장 뒤 장부 오류는 증빙을 보존, 재시도로 복구하며 사진 중복 생성하지 않음',async()=>{
 reset();db.exec("CREATE TRIGGER reject_pickup BEFORE UPDATE OF picked_up_at ON general_rentals BEGIN SELECT RAISE(ABORT,'forced storage failure'); END");
 try{
  const result=await post('confirm-pickup',request('api-failure-0001'));assert.equal(result.status,500);assert.equal(result.success,false);assert.equal(result.adminReview,true);
  assert.equal(get('SELECT COUNT(*) n FROM unattended_pickup_photos').n,0);assert.equal(get('SELECT picked_up_at FROM general_rentals').picked_up_at,null);
  const evidence=get('SELECT * FROM unattended_operations');assert.equal(evidence.status,'failed');assert.ok(fs.existsSync(path.join(uploads,evidence.image_path.replace('/uploads/',''))));
  const reviews=await(await fetch(base+'/operation-reviews',{headers:admin})).json();assert.equal(reviews.items.length,1);
 }finally{db.exec('DROP TRIGGER reject_pickup');}
 const before=all('SELECT image_path FROM unattended_operations')[0].image_path;
 const retry=await post('confirm-pickup',request('api-failure-0001'));assert.equal(retry.completed,true);assert.equal(get('SELECT image_path FROM unattended_operations').image_path,before);
 assert.equal(get('SELECT COUNT(*) n FROM unattended_pickup_photos').n,1);
});
test('타인·중복 선택·초과 수량·다른 내용 재전송을 막고 관리자 조회 권한 유지',async()=>{
 reset();
 assert.equal((await post('confirm-pickup',{...request('api-quantity-001'),items:[{sheetType:'general',rowIndex:1,quantity:4}]})).status,400);
 const duplicated=request('api-duplicate-01');duplicated.items.push({...duplicated.items[0]});assert.equal((await post('confirm-pickup',duplicated)).status,400);
 const other={...headers,'x-unattended-session':issueKioskSession('5678')};assert.equal((await post('confirm-pickup',request('api-owner-00001'),other)).status,400);
 await post('confirm-pickup',request('api-replay-00001'));
 assert.equal((await post('confirm-pickup',request('api-replay-00001',1))).status,409);
 const status=await(await fetch(base+'/operation-status?clientId=api-replay-00001',{headers:other})).json();assert.equal(status.status,'not-found');
 assert.equal((await fetch(base+'/operation-reviews',{headers})).status,401);
});
test('관리자 검토 종료는 조치 내용을 요구하고 대여·재고를 임의 변경하지 않음',async()=>{
 reset();run(`INSERT INTO unattended_operations(client_id,operation,employee_id,fingerprint,items_json,photo_validated,status,received_at,updated_at)
 VALUES ('admin-review-0001','pickup','1234','test','[]',1,'failed','2026-10-14 10:00:00','2026-10-14 10:00:00')`);
 const id=get('SELECT id FROM unattended_operations').id;
 assert.equal((await post('operation-reviews/'+id+'/close',{note:''},admin)).status,400);
 assert.equal((await post('operation-reviews/'+id+'/close',{note:'기존 화면에서 수령 확인 처리함'},admin)).success,true);
 assert.equal(get('SELECT review_status FROM unattended_operations').review_status,'reviewed');assert.equal(get('SELECT stock FROM scenario_items').stock,0);assert.equal(get('SELECT picked_up_at FROM general_rentals').picked_up_at,null);
});
test('증빙 보관기간이 지나도 검토 대기 오류 사진은 지우지 않음',async()=>{
 reset();await post('confirm-pickup',request('api-retention-001'));
 const completed=get('SELECT * FROM unattended_operations');run("UPDATE unattended_operations SET updated_at='2020-01-01 00:00:00' WHERE id=?",[completed.id]);
 const pendingId=Number(run(`INSERT INTO unattended_operations(client_id,operation,employee_id,fingerprint,items_json,photo_validated,status,received_at,updated_at,image_path)
 VALUES ('pending-retention','return','1234','test','[]',1,'failed','2020-01-01','2020-01-01',?)`,[completed.image_path]).lastInsertRowid);
 // 완료 기록과 다른 보류 폴더를 만들어 보관기간 정리의 영향을 구분한다.
 const pendingDir=path.join(uploads,'unattended_operations',String(pendingId));fs.mkdirSync(pendingDir,{recursive:true});fs.copyFileSync(path.join(uploads,completed.image_path.replace('/uploads/','')),path.join(pendingDir,'original-1.webp'));
 run('UPDATE unattended_operations SET image_path=? WHERE id=?',['/uploads/unattended_operations/'+pendingId+'/original-1.webp',pendingId]);
 cleanupOldReturnPhotos();assert.ok(fs.existsSync(path.join(pendingDir,'original-1.webp')));assert.equal(get('SELECT image_path FROM unattended_operations WHERE id=?',[completed.id]).image_path,null);
});
test.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();
 const target=path.resolve(uploads),prefix=path.join(path.resolve(os.tmpdir()),'wms-recovery-test-');
 assert.ok(target.startsWith(prefix) && target!==path.resolve(os.tmpdir()));fs.rmSync(target,{recursive:true,force:true});});
