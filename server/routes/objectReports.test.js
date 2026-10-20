import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

let smCreates=0, smFail=false, smImageFail=false, smLast=null;
const smApp=express();smApp.use(express.json({limit:'20mb'}));
smApp.post('/api/internal/v1/cos/objects',(req,res)=>{if(smFail)return res.status(503).json({detail:'교육용 SM 연결 오류'});smCreates++;smLast=req.body;res.status(201).json({id:String(900000+smCreates)});});
smApp.put('/api/internal/v1/cos/objects/:id/image',(_req,res)=>res.status(smImageFail?503:200).json({}));
const smServer=smApp.listen(0,'127.0.0.1');await new Promise(r=>smServer.once('listening',r));
process.env.SM_URL=`http://127.0.0.1:${smServer.address().port}`;process.env.SM_COS_TOKEN='local-test-only';
process.env.WMS_DB_PATH=':memory:';
process.env.SM_SYNC='off';
process.env.WMS_HTTPS_CONFIG=fileURLToPath(new URL('../fixtures/https-auth-test.json',import.meta.url));
const uploadRoot=path.resolve('tmp');fs.mkdirSync(uploadRoot,{recursive:true});
const uploads=fs.mkdtempSync(path.join(uploadRoot,'object-reports-test-'));
process.env.WMS_UPLOADS_DIR=uploads;
const { db,run,get,all }=await import('../db.js');
const { gasRouter }=await import('./gas.js');
const { notificationsRouter }=await import('./notifications.js');
const { unattendedRouter }=await import('./unattended.js');
const { issueAdminSession }=await import('../lib/auth.js');
const { issueBorrower }=await import('../lib/borrowerAuth.js');
const { nowKst }=await import('../lib/time.js');
run("INSERT INTO admin_users (id,login_id,name,password_hash) VALUES (1,'test','관리자','unused')");
run("INSERT INTO registered_users (employee_id,name) VALUES ('1234','사용자'),('5678','다른 사용자')");
const admin={'x-admin-token':issueAdminSession(1)};
const app=express();
app.use((req,_res,next)=>{req.socket.encrypted=true;next();});
app.get('/test-session/:id',(req,res)=>{issueBorrower(req,res,req.params.id);res.end();});
app.use('/api',gasRouter);app.use('/api',notificationsRouter);app.use('/api',express.json(),unattendedRouter);
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const cookie=(await fetch(base+'/test-session/1234')).headers.get('set-cookie').split(';')[0];
const otherCookie=(await fetch(base+'/test-session/5678')).headers.get('set-cookie').split(';')[0];
const photo='data:image/png;base64,'+(await sharp({create:{width:10,height:10,channels:3,background:'#ffffff'}}).png().toBuffer()).toString('base64');
let serial=0;
async function post(action,payload,headers={Cookie:cookie}){return (await fetch(base+'/api/gas',{method:'POST',headers:{...headers,'Content-Type':'text/plain'},body:JSON.stringify({action,payload})})).json();}
async function list(action,headers={Cookie:cookie}){return (await fetch(base+'/api/gas?action='+action,{headers})).json();}
function reset(){for(const t of ['object_reports','object_report_events','damage_return_decisions','damage_return_operations','scenario_items','scenario_item_variants','general_rentals','sid_rentals','penalties','penalty_links','defect_logs','inventory_history','unattended_damage_pending','settings'])run('DELETE FROM '+t);run("INSERT INTO settings (key,value) VALUES ('max_item_types_default','15')");run("INSERT INTO scenario_items (id,name,stock,rented,image_path) VALUES ('000001','컵',10,3,'/registered.webp')");}
function loan(qty=3,employee='1234'){return Number(run("INSERT INTO general_rentals (employee_id,borrower_name,item_id,item_label,qty,returned,status,picked_up_at,borrow_date) VALUES (?,?,'000001','컵',?,'X','active',?,?)",[employee,employee==='1234'?'사용자':'다른 사용자',qty,nowKst(),nowKst()]).lastInsertRowid);}
function report(rowIndex,extra={}){return {clientId:`report-test-${++serial}`,kind:'damage',sheetType:'general',rowIndex,quantity:1,reason:'사용 중 균열 발견',photo,...extra};}
function damage(rowIndex,extra={}){return {clientId:`damage-test-${++serial}`,returnRequests:[{sheetType:'general',rowIndex,quantity:1,damaged:true}],damage:{defectType:'파손',photo,note:'균열',items:[{itemId:'000001',itemName:'컵',qty:1,rentalSheetType:'general',rentalRowIndex:rowIndex,...extra}]}};}
test('사진 필수, 본인 소유 확인, 관리자 API 권한과 사진 디코딩 검증',async()=>{
 reset();const id=loan();
 for(const badPhoto of ['', '/uploads/forged.webp','data:image/png;base64,bm90LWFuLWltYWdl'])assert.equal((await post('createObjectReport',report(id,{photo:badPhoto}))).success,false);
 assert.equal((await post('createObjectReport',report(id),{Cookie:otherCookie})).success,false);
 assert.equal((await list('getObjectReports')).success,false);
 assert.equal(all('SELECT * FROM object_reports').length,0);
});
test('즉시 신고는 재고를 바꾸지 않고 중복 제출은 같은 보고로 복구하며 다른 사용자에게 보이지 않는다',async()=>{
 reset();const id=loan(),payload=report(id),a=await post('createObjectReport',payload),b=await post('createObjectReport',payload);
 assert.equal(a.success,true);assert.equal(a.id,b.id);assert.equal(all('SELECT * FROM object_reports').length,1);
 assert.deepEqual({...get('SELECT stock,rented FROM scenario_items')},{stock:10,rented:3});
 assert.equal((await list('getMyObjectReports',{Cookie:otherCookie})).items.length,0);
 const notification=await(await fetch(base+'/api/admin/notifications',{headers:admin})).json();assert.equal(Object.hasOwn(notification,'objectReports'),false);
 assert.equal((await list('getAdminRentalNotifications',admin)).objectReports,1);
 assert.ok(fs.existsSync(path.join(uploads,get('SELECT image_path FROM object_reports').image_path.replace('/uploads/',''))));
});
test('변형 사전 승인과 완료 사진 및 별도 오브젝트 등록 연결을 순서대로 검증한다',async()=>{
 reset();const id=loan();const submitted=await post('createObjectReport',report(id,{kind:'modification',plan:'손잡이를 분리하여 사용 후 원상복구 불가'}));
 assert.equal((await post('completeObjectReport',{id:submitted.id,note:'작업 완료',photo})).success,false);
 assert.equal((await post('reviewObjectReport',{id:submitted.id,status:'approved',note:'손잡이만 분리 승인'},admin)).success,true);
 assert.equal((await post('processReturn',{returnRequests:[{sheetType:'general',rowIndex:id,quantity:1}]},admin)).success,false);
 assert.equal((await post('completeObjectReport',{id:submitted.id,note:'승인 범위 작업 완료'})).success,false);
 assert.equal((await post('completeObjectReport',{id:submitted.id,note:'승인 범위 작업 완료',photo})).success,true);
 const close={id:submitted.id,status:'closed',note:'실물과 재고 확인',registrationKind:'new_object',targetItemId:'000002',registrationConfirmed:true};
 assert.equal((await post('reviewObjectReport',close,admin)).success,false);
 run("INSERT INTO scenario_items (id,name,stock,image_path) VALUES ('000002','손잡이 없는 컵',1,'/new.webp')");
 assert.equal((await post('reviewObjectReport',close,admin)).success,true);
 assert.equal(get('SELECT target_item_id FROM object_reports').target_item_id,'000002');
 assert.equal(all('SELECT * FROM object_report_events').length,4);
});
test('사전 신고 수량만 한 번 면제하고 이후 파손 반납은 5종 차감 14일 적용하며 재시도는 중복 처리하지 않는다',async()=>{
 reset();const id=loan();await post('createObjectReport',report(id));
 const first=damage(id);assert.equal((await post('processDamagedReturn',first,admin)).success,true);
 assert.equal(all('SELECT * FROM penalties').length,0);assert.equal(get('SELECT consumed_qty FROM object_reports').consumed_qty,1);
 const second=damage(id);const result=await post('processDamagedReturn',second,admin);assert.equal(result.success,true);assert.equal(result.penalties,1);
 const penalty=get('SELECT * FROM penalties');assert.equal(penalty.max_types,10);
 const days=(new Date(penalty.expires_at.replace(' ','T')+'+09:00').getTime()-Date.now())/86400000;assert.ok(days>13.99&&days<=14);
 await post('processDamagedReturn',second,admin);assert.equal(all('SELECT * FROM penalties').length,1);assert.equal(all('SELECT * FROM defect_logs').length,2);
 assert.equal(get('SELECT stock FROM scenario_items').stock,10);assert.equal(get('SELECT qty FROM general_rentals WHERE id=?',[id]).qty,1);
});
test('파손 신고된 수량은 정상 반납으로 우회할 수 없고 관리자 면제 사유가 이력에 남는다',async()=>{
 reset();const id=loan(1);await post('createObjectReport',report(id));
 assert.equal((await post('processReturn',{returnRequests:[{sheetType:'general',rowIndex:id,quantity:1}]},admin)).success,false);
 reset();const next=loan(1),payload=damage(next,{penaltyExempt:true});
 assert.equal((await post('processDamagedReturn',payload,admin)).success,false);
 payload.damage.items[0].exemptionReason='정상 마모 확인';
 assert.equal((await post('processDamagedReturn',payload,admin)).success,true);
 assert.equal(all('SELECT * FROM penalties').length,0);assert.equal(get('SELECT exemption_reason FROM damage_return_decisions').exemption_reason,'정상 마모 확인');
});
test('사진 또는 저장 실패 시 반납 재고와 페널티를 전부 되돌린다',async()=>{
 reset();const id=loan(1),payload=damage(id);payload.damage.photo='';
 assert.equal((await post('processDamagedReturn',payload,admin)).success,false);
 assert.equal(get('SELECT returned FROM general_rentals').returned,'X');
 payload.damage.photo=photo;
 db.exec("CREATE TRIGGER fail_object_defect BEFORE INSERT ON defect_logs BEGIN SELECT RAISE(ABORT,'test defect failure'); END");
 try {assert.equal((await post('processDamagedReturn',payload,admin)).success,false);}finally{db.exec('DROP TRIGGER fail_object_defect');}
 assert.equal(get('SELECT returned FROM general_rentals').returned,'X');assert.equal(get('SELECT stock FROM scenario_items').stock,10);
 assert.equal(all('SELECT * FROM penalties').length,0);assert.equal(all('SELECT * FROM damage_return_decisions').length,0);
 assert.equal((await post('processDamagedReturn',payload,admin)).success,true);
});
test('기존 페널티에서 추가 차감하되 0종 미만으로 내려가지 않는다',async()=>{
 reset();const id=loan(1);run("INSERT INTO penalties (name,max_types,reason) VALUES ('사용자',3,'기존 제한')");
 assert.equal((await post('processDamagedReturn',damage(id),admin)).success,true);
 assert.equal(get('SELECT max_types FROM penalties ORDER BY id DESC LIMIT 1').max_types,0);
});
test('같은 오브젝트라도 다른 대여 건의 신고로 면제하지 않는다',async()=>{
 reset();const reported=loan(1),unreported=loan(1);await post('createObjectReport',report(reported));
 const result=await post('processDamagedReturn',damage(unreported),admin);
 assert.equal(result.success,true);assert.equal(result.penalties,1);assert.equal(get('SELECT consumed_qty FROM object_reports').consumed_qty,0);
});
test('동시 재전송도 파손 반납과 페널티를 정확히 한 번 처리한다',async()=>{
 reset();const id=loan(1),payload=damage(id);
 const results=await Promise.all([post('processDamagedReturn',payload,admin),post('processDamagedReturn',payload,admin)]);
 assert.ok(results.every(r=>r.success));assert.equal(all('SELECT * FROM penalties').length,1);assert.equal(all('SELECT * FROM defect_logs').length,1);
 assert.equal(all('SELECT * FROM damage_return_operations').length,1);assert.equal(get('SELECT stock FROM scenario_items').stock,10);
});
test('서로 다른 처리 번호가 동시에 같은 물품을 반납해도 한 건만 완료한다',async()=>{
 reset();const id=loan(1);
 const results=await Promise.all([post('processDamagedReturn',damage(id),admin),post('processDamagedReturn',damage(id),admin)]);
 assert.equal(results.filter(r=>r.success).length,1);assert.equal(all('SELECT * FROM penalties').length,1);assert.equal(all('SELECT * FROM defect_logs').length,1);
});
test('다른 종류로 등록한 변형은 해당 종류의 사진과 연결을 확인한다',async()=>{
 reset();const id=loan(),created=await post('createObjectReport',report(id,{kind:'modification',plan:'다른 형태로 변형'}));
 await post('reviewObjectReport',{id:created.id,status:'approved',note:'변형 승인'},admin);await post('completeObjectReport',{id:created.id,note:'변형 완료',photo});
 const variant=Number(run("INSERT INTO scenario_item_variants (item_id,name,stock) VALUES ('000001','변형된 컵',1)").lastInsertRowid);
 const payload={id:created.id,status:'closed',note:'등록 확인',registrationKind:'variant',targetVariantId:variant,registrationConfirmed:true};
 assert.equal((await post('reviewObjectReport',payload,admin)).success,false);
 run("UPDATE scenario_item_variants SET image_path='/variant.webp' WHERE id=?",[variant]);
 assert.equal((await post('reviewObjectReport',payload,admin)).success,true);assert.equal(get('SELECT target_variant_id FROM object_reports').target_variant_id,variant);
});
test('파손 후 새 오브젝트 연결은 실제 등록 사진과 수량 확인이 필요하며 페널티 증빙을 유지한다',async()=>{
 reset();const id=loan(),created=await post('createObjectReport',report(id));
 await post('reviewObjectReport',{id:created.id,status:'acknowledged',note:'파손 확인'},admin);
 const close={id:created.id,status:'closed',note:'별도 오브젝트로 사용 가능하여 등록',registrationKind:'new_object',targetItemId:'000002',registrationConfirmed:true};
 assert.equal((await post('reviewObjectReport',close,admin)).success,false);
 run("INSERT INTO scenario_items (id,name,stock,image_path) VALUES ('000002','변형 컵',1,'/sm-imported.webp')");
 assert.equal((await post('reviewObjectReport',{...close,registrationConfirmed:false},admin)).success,false);
 assert.equal((await post('reviewObjectReport',close,admin)).success,true);
 assert.equal(get('SELECT target_item_id FROM object_reports').target_item_id,'000002');
 const returned=await post('processDamagedReturn',damage(id),admin);
 assert.equal(returned.success,true);assert.equal(returned.penalties,0);assert.equal(get('SELECT consumed_qty FROM object_reports').consumed_qty,1);
});

test('보고 화면의 SM 신규 등록은 관리자 전용이며 SM ID를 자동 연결하고 재시도 중복을 막는다',async()=>{
 reset();const id=loan(),created=await post('createObjectReport',report(id,{kind:'modification',plan:'변형 작업'}));
 const payload={id:created.id,name:'손잡이 없는 컵',sector:'Seoul',smSize:'Small',smProperty:'Hard',photo};
 assert.equal((await post('registerObjectReportTarget',payload)).success,false);
 assert.equal((await post('registerObjectReportTarget',payload,admin)).success,false);
 await post('reviewObjectReport',{id:created.id,status:'approved',note:'승인'},admin);
 await post('completeObjectReport',{id:created.id,note:'완료',photo});
 assert.equal((await post('registerObjectReportTarget',{...payload,photo:''},admin)).success,false);
 const before=smCreates;
 const result=await Promise.all([post('registerObjectReportTarget',payload,admin),post('registerObjectReportTarget',payload,admin)]);
 assert.ok(result.every(r=>r.success));assert.equal(smCreates,before+1);
 const target=result[0].item.id;assert.equal(target,String(900000+smCreates));
 assert.equal(smLast.object.quantity,0);assert.equal(get('SELECT stock FROM scenario_items WHERE id=?',[target]).stock,0);
 assert.equal(get('SELECT stock FROM scenario_items WHERE id=?',['000001']).stock,10);
 assert.equal(get('SELECT target_item_id FROM object_reports').target_item_id,target);
 assert.equal((await post('registerObjectReportTarget',payload,admin)).item.id,target);assert.equal(smCreates,before+1);
 assert.equal((await post('reviewObjectReport',{id:created.id,status:'closed',note:'확인',registrationKind:'restored',registrationConfirmed:true},admin)).success,false);
 assert.equal((await post('reviewObjectReport',{id:created.id,status:'closed',note:'등록과 재고 확인',registrationKind:'new_object',targetItemId:target,registrationConfirmed:true},admin)).success,true);
});
test('SM 실패는 보고를 닫지 않으며 사진 반영 실패 후 재시도해도 새 물품을 중복 등록하지 않는다',async()=>{
 reset();const id=loan(),created=await post('createObjectReport',report(id));
 await post('reviewObjectReport',{id:created.id,status:'acknowledged',note:'확인'},admin);
 const payload={id:created.id,name:'다른 용도의 컵',sector:'Seoul',smSize:'Small',smProperty:'Hard',photo};
 smFail=true;assert.equal((await post('registerObjectReportTarget',payload,admin)).success,false);smFail=false;
 assert.equal(get('SELECT status FROM object_reports').status,'acknowledged');assert.equal(get('SELECT target_item_id FROM object_reports').target_item_id,null);
 smImageFail=true;const result=await post('registerObjectReportTarget',payload,admin);smImageFail=false;
 assert.equal(result.success,true);assert.ok(result.warning);const before=smCreates;
 assert.equal((await post('registerObjectReportTarget',payload,admin)).item.id,result.item.id);assert.equal(smCreates,before);
});

test('무인 부분 파손 반납은 원래 대여 건의 사전 신고를 확인한다',async()=>{
 reset();const source=loan(3);await post('createObjectReport',report(source));
 const returned=loan(1);run("UPDATE general_rentals SET returned='O',status='damage_pending' WHERE id=?",[returned]);
 const pending=Number(run("INSERT INTO unattended_damage_pending (batch_id,sheet_type,rental_row_id,source_rental_row_id,item_id,item_name,qty,reason,image_path,status,created_at) VALUES (1,'general',?,?,'000001','컵',1,'균열','/photo.webp','pending',?)",[returned,source,nowKst()]).lastInsertRowid);
 const response=await fetch(base+`/api/unattended/damage-pending/${pending}/resolve`,{method:'POST',headers:{...admin,'Content-Type':'application/json'},body:JSON.stringify({action:'confirm'})});
 assert.equal(response.status,200);assert.equal(all('SELECT * FROM penalties').length,0);assert.equal(get('SELECT reported_qty FROM damage_return_decisions').reported_qty,1);
});
test.after(()=>{smServer.close();server.close();db.close();const resolved=path.resolve(uploads);assert.ok(resolved.startsWith(uploadRoot+path.sep));fs.rmSync(resolved,{recursive:true,force:true});});
