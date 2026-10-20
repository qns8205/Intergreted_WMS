import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
const output=await build({entryPoints:['src/utils/unattendedTransport.ts'],bundle:true,platform:'node',format:'cjs',write:false});
const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
const {kioskRequest,assertPhotoReceipt}=module.exports;
const credentials={device:'device-test',session:'session-test'};
test('HTTP 200이어도 JSON 파손·성공 플래그 누락·거짓 완료는 거부',async()=>{
 for(const body of ['<html>wrong page</html>','{}','null','{"success":false}'])await assert.rejects(kioskRequest('confirm-pickup',{},credentials,1000,async()=>new Response(body,{status:200})));
 assert.deepEqual(await kioskRequest('operation-status',undefined,credentials,1000,async()=>new Response('{"success":true,"status":"not-found"}')),{success:true,status:'not-found'});
});
test('완료 영수증은 요청 번호·업무·사진 저장·원자적 완료를 모두 검증',()=>{
 const request={clientId:'retry-test-1',kind:'pickup'}, receipt={success:true,operationId:1,clientId:request.clientId,operation:'pickup',completed:true,photoSaved:true};
 assert.deepEqual(assertPhotoReceipt(receipt,request),receipt);
 for(const change of [{completed:false},{photoSaved:false},{clientId:'other'},{operation:'return'},{operationId:0}])assert.throws(()=>assertPhotoReceipt({...receipt,...change},request));
 const returned={...receipt,operation:'return',batchId:2,lookupPath:'/pickup/test'};
 assert.deepEqual(assertPhotoReceipt(returned,{...request,kind:'return'}),returned);
 assert.throws(()=>assertPhotoReceipt({...returned,batchId:undefined},{...request,kind:'return'}));
});
test('연결 실패·세션 만료를 구분하고 요청에 제한시간·본인 인증을 유지',async()=>{
 await assert.rejects(kioskRequest('return',{},credentials,1000,async()=>{throw Error('network');}),error=>error.uncertain && error.status===0);
 await assert.rejects(kioskRequest('return',{},credentials,1000,async()=>new Response('{"success":false,"relogin":true,"error":"login"}',{status:401})),error=>error.relogin && error.status===401);
 await kioskRequest('return',{clientId:'same-id'},credentials,1000,async(_url,options)=>{assert.equal(options.headers['x-unattended-session'],'session-test');assert.ok(options.signal);return new Response('{"success":true}');});
});
test('사진과 선택은 전송 전 보존, 재로그인 복구·동일 요청 재시도·온라인 복귀·버전 보호 연결',async()=>{
 const source=await readFile('src/components/UnattendedReturnPage.tsx','utf8'), store=await readFile('src/utils/unattendedPhotoOutbox.ts','utf8');
 assert.ok(source.indexOf('await savePendingKioskPhoto(record)')<source.indexOf('await sendPendingPhoto(record)'));
 for(const text of ['loadPendingKioskPhotos(employeeId)','assertPhotoReceipt(status.result,record)','assertPhotoReceipt(result,record)',"window.addEventListener('online',retry)","useVersionWorkGuard('unattended-photo-recovery'",'session!==sessionRef.current','촬영 결과 확인'])assert.ok(source.includes(text),text);
 assert.ok(store.includes('row.employeeId===employeeId') && store.includes('indexedDB.open'));
 assert.ok(!store.includes('password') && !store.includes('sessionToken'));
 assert.ok(source.includes("catch{showToast('반납과 사진 저장은 완료됐습니다."));
});
test('PC 보관함은 재접속 후에도 촬영 스냅샷을 복구하며 사번별로 분리하고 완료 건만 삭제',async()=>{
 const compiled=await build({entryPoints:['src/utils/unattendedPhotoOutbox.ts'],bundle:true,platform:'node',format:'cjs',write:false});
 const m={exports:{}};new Function('module','exports',compiled.outputFiles[0].text)(m,m.exports);
 const rows=new Map();const previous=globalThis.indexedDB;let fail=false;
 globalThis.indexedDB={open:()=>{
  const request={result:{close(){},transaction(){
   const tx={objectStore:()=>({index:()=>({getAll:employeeId=>({result:structuredClone([...rows.values()].filter(row=>row.employeeId===employeeId))})}),
     put:value=>{if(!fail)rows.set(value.clientId,structuredClone(value));return {result:value.clientId};},delete:id=>{rows.delete(id);return {result:undefined};}})};
   queueMicrotask(()=>fail ? (tx.error=Error('quota exceeded'),tx.onabort?.()) : tx.oncomplete?.());return tx;
  }}};
  queueMicrotask(()=>request.onsuccess?.());return request;
 }};
 try{
  const record={clientId:'photo-one',employeeId:'1234',kind:'pickup',capturedAt:'2026-10-14T01:00:00Z',labels:['박스'],body:{clientId:'photo-one',items:[{rowIndex:1,quantity:2}],photo:'data:image/jpeg;base64,test'}};
  await m.exports.savePendingKioskPhoto(record);record.body.items[0].quantity=99;
  assert.equal((await m.exports.loadPendingKioskPhotos('1234'))[0].body.items[0].quantity,2);
  assert.deepEqual(await m.exports.loadPendingKioskPhotos('5678'),[]);
  fail=true;await assert.rejects(m.exports.savePendingKioskPhoto({...record,clientId:'photo-two'}),/quota/);fail=false;
  assert.equal(m.exports.memoryPendingKioskPhotos('1234').length,2);
  assert.equal((await m.exports.loadPendingKioskPhotos('1234')).length,2); // 디스크 실패 촬영도 현재 창 메모리에는 남는다.
  await m.exports.removePendingKioskPhoto('photo-one');await m.exports.removePendingKioskPhoto('photo-two');assert.deepEqual(await m.exports.loadPendingKioskPhotos('1234'),[]);
 }finally{globalThis.indexedDB=previous;}
});
