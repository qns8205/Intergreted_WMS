import test from 'node:test';
import assert from 'node:assert/strict';
process.env.WMS_DB_PATH=':memory:';
process.env.SM_SYNC='off';
const {db,run,get}=await import('../db.js');
const {executePhotoOperation,operationStatus,recoveryHoldChecker,closeOperationReview}=await import('./unattendedOperationRecovery.js');
const {nowKst,parseKstMs}=await import('./time.js');
const {cancelUnclaimedPickups}=await import('./pickupTimeout.js');
const {applyUnattendedOverduePenalties}=await import('./unattendedPenalties.js');
const photo='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="blue"/></svg>').toString('base64');
const body=()=>({clientId:'recovery-helper-test-001',items:[{sheetType:'general',rowIndex:1,quantity:1}],photo});
function reset(){for(const table of ['unattended_operations','general_rentals','sid_rentals','settings','scenario_items','penalties','unattended_penalty_events','item_reservations'])run('DELETE FROM '+table);}
const prepare=()=>({evidence:[{sheetType:'general',rowIndex:1,employeeId:'1234',quantity:1}],hasDamage:false});
const args=(overrides={})=>({operation:'pickup',employeeId:'1234',borrowerName:'테스트',body:body(),prepare,commit:()=>({}),saveImage:async()=>'/uploads/fixture.webp',...overrides});
test('서버 영수증은 사진 저장과 장부 트랜잭션이 끝난 경우만 반환, 재전송은 재실행하지 않음',async()=>{
 reset();let calls=0;
 const options=args({commit:()=>{calls++;return {count:1};}});
 const receipt=await executePhotoOperation(options);
 assert.equal(receipt.completed,true);assert.equal(receipt.photoSaved,true);assert.equal(receipt.operation,'pickup');
 assert.deepEqual(await executePhotoOperation(options),receipt);assert.equal(calls,1);
 assert.equal(operationStatus(body().clientId,'1234').status,'completed');assert.equal(operationStatus(body().clientId,'5678').status,'not-found');
});
test('동시에 같은 요청이 와도 사진·장부를 한 번만 처리',async()=>{
 reset();let calls=0, release;
 const wait=new Promise(resolve=>{release=resolve;});
 const options=args({saveImage:async()=>{await wait;return '/uploads/test.webp';},commit:()=>{calls++;return {};}});
 const a=executePhotoOperation(options), b=executePhotoOperation(options);release();
 const [r1,r2]=await Promise.all([a,b]);assert.deepEqual(r1,r2);assert.equal(calls,1);
});
test('같은 clientId의 소유자·업무·물품 내용 변경 차단',async()=>{
 reset();await executePhotoOperation(args());
 await assert.rejects(executePhotoOperation(args({employeeId:'5678'})),/내용이 다릅니다/);
 await assert.rejects(executePhotoOperation(args({operation:'return'})),/내용이 다릅니다/);
 await assert.rejects(executePhotoOperation(args({body:{...body(),items:[{sheetType:'general',rowIndex:2,quantity:1}]}})),/내용이 다릅니다/);
});
test('파일 저장 실패도 사진 수신·선택 증빙을 남기며 거짓 완료하지 않음',async()=>{
 reset();await assert.rejects(executePhotoOperation(args({saveImage:async()=>{throw Error('ENOSPC');}})),/ENOSPC/);
 const row=get('SELECT * FROM unattended_operations');assert.equal(row.status,'failed');assert.equal(row.photo_validated,1);assert.equal(row.result_json,null);
 assert.equal(operationStatus(body().clientId,'1234').adminReview,true);
 const receipt=await executePhotoOperation(args());assert.equal(receipt.completed,true);
});
test('장부 실패는 롤백하고 사진을 재사용해 같은 요청으로 복구',async()=>{
 reset();run("INSERT INTO settings(key,value) VALUES ('test-count','0')");let writes=0;
 const saveImage=async()=>{writes++;return '/uploads/recovery.webp';};
 await assert.rejects(executePhotoOperation(args({saveImage,commit:()=>{run("UPDATE settings SET value='1' WHERE key='test-count'");throw Error('forced DB failure');}})),/forced/);
 assert.equal(get("SELECT value FROM settings WHERE key='test-count'").value,'0');
 assert.equal(get('SELECT image_path FROM unattended_operations').image_path,'/uploads/recovery.webp');
 await executePhotoOperation(args({saveImage,commit:()=>{run("UPDATE settings SET value='1' WHERE key='test-count'");return {};}}));
 assert.equal(writes,1);assert.equal(get("SELECT value FROM settings WHERE key='test-count'").value,'1');
});
test('잘못된 사진·권한·선택은 페널티 보류 기록을 만들지 않음',async()=>{
 reset();await assert.rejects(executePhotoOperation(args({body:{...body(),photo:'data:image/jpeg;base64,AA=='}})),/다시 촬영/);
 await assert.rejects(executePhotoOperation(args({prepare:()=>{throw Object.assign(Error('owner mismatch'),{status:400});}})),/owner/);
 assert.equal(get('SELECT COUNT(*) n FROM unattended_operations').n,0);
});
function timestamp(ms){const d=new Date(ms),p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;}
function seedFailure(operation,{received=Date.now()-60000,quantity=1,employeeId='1234',status='failed'}={}){
 run(`INSERT INTO unattended_operations (client_id,operation,employee_id,fingerprint,items_json,photo_validated,status,received_at,updated_at)
 VALUES ('hold-test',?,'1234','test',?,1,?,?,?)`,[operation,JSON.stringify([{sheetType:'general',rowIndex:1,employeeId,quantity}]),status,timestamp(received),nowKst()]);
}
function seedLoan(kind){
 run("INSERT INTO settings(key,value) VALUES ('unattended_enabled','1')");
 run("INSERT INTO scenario_items(id,name,stock,rented) VALUES ('000001','테스트',0,1)");
 const base=Date.now()-(kind==='pickup'?4:24)*3600000-60000;
 run("INSERT INTO general_rentals(id,employee_id,borrower_name,item_id,item_label,qty,applied_at,picked_up_at,returned,status,request_no) VALUES (1,'1234','테스트','000001','테스트',1,?,?,'X','active',1)",[timestamp(base),kind==='return'?timestamp(base):null]);
 return base+(kind==='pickup'?4:24)*3600000;
}
test('기한 전 검증된 사진의 기술 오류는 자동 취소·페널티 보류, 관리자 검토 종료 뒤 기존 판정 재개',()=>{
 reset();const deadline=seedLoan('pickup');seedFailure('pickup',{received:deadline-1000});
 cancelUnclaimedPickups();assert.equal(get('SELECT returned FROM general_rentals').returned,'X');assert.equal(get('SELECT COUNT(*) n FROM penalties').n,0);
 const id=get('SELECT id FROM unattended_operations').id;
 assert.throws(()=>closeOperationReview(id,'관리자',''),/3자/);closeOperationReview(id,'관리자','실물 확인 후 미수령 확인');
 cancelUnclaimedPickups();assert.equal(get('SELECT returned FROM general_rentals').returned,'O');assert.equal(get('SELECT COUNT(*) n FROM penalties').n,1);
 assert.equal(get('SELECT reviewer FROM unattended_operations').reviewer,'관리자');
});
test('반납 사진의 기술 오류도 24시간 페널티 보류',()=>{
 reset();const deadline=seedLoan('return');seedFailure('return',{received:deadline-1000});
 assert.equal(applyUnattendedOverduePenalties().penalized,0);
 run("UPDATE unattended_operations SET review_status='reviewed'");assert.equal(applyUnattendedOverduePenalties().penalized,1);
});
test('기한 후 제출·타인·부분 수량·거절된 요청은 나머지 미처리 건을 면제하지 않음',()=>{
 for(const options of [{received:Date.now()},{employeeId:'5678'},{quantity:0},{status:'rejected'}]){
  reset();const deadline=seedLoan('pickup');seedFailure('pickup',{received:deadline-1000,...options});
  const held=recoveryHoldChecker('pickup');assert.equal(held(get('SELECT * FROM general_rentals'),'general',deadline),false);
 }
});
test('예약도 촬영 수신 전의 원래 +20분 기한을 지키며 확인된 기술 오류만 일시 보류',async()=>{
 reset();seedLoan('pickup');
 const {expireReservations}=await import('./reservationExpiry.js');
 const deadline=Date.now()-60000;
 run(`INSERT INTO item_reservations(employee_id,borrower_name,floor,unit,item_id,variant_id,quantity,starts_at_ms,created_at_ms,client_id,status,request_no)
 VALUES ('1234','테스트','B1','Unit','000001',0,1,?,?, 'reservation-recovery','fulfilled',1)`,[deadline-20*60000,deadline-30*60000]);
 seedFailure('pickup',{received:deadline-1000});
 assert.equal(expireReservations().cancelled,0);assert.equal(get('SELECT status FROM item_reservations').status,'fulfilled');
 run("UPDATE unattended_operations SET review_status='reviewed'");
 assert.equal(expireReservations().cancelled,1);assert.equal(get('SELECT status FROM item_reservations').status,'cancelled');
});
test.after(()=>db.close());
