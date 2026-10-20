import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const output=await build({entryPoints:['src/utils/borrowApi.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',write:false,define:{'import.meta.env':JSON.stringify({MODE:'test'})}});
const module={exports:{}};new Function('require','module','exports',output.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
const {setPhotoReview}=module.exports;
test('메모의 상태와 내용이 서버 저장 응답과 일치해야 성공',async()=>{
 const before=globalThis.fetch;
 try{
  globalThis.fetch=async(_url,options)=>{
   assert.deepEqual(JSON.parse(options.body).payload,{kind:'return',id:1,status:'issue',note:' 한글 사유 '});
   return new Response(JSON.stringify({success:true,review:{status:'issue',note:'한글 사유'}}));
  };
  assert.equal((await setPhotoReview('/api/gas','return',1,'issue',' 한글 사유 ')).note,'한글 사유');
  for(const result of [{},{success:false,error:'권한 없음'},{success:true},{success:true,review:{status:'ok',note:'한글 사유'}},{success:true,review:{status:'issue',note:''}}]){
   globalThis.fetch=async()=>new Response(JSON.stringify(result));
   await assert.rejects(setPhotoReview('/api/gas','return',1,'issue','한글 사유'));
  }
 }finally{globalThis.fetch=before;}
});
test('사진 재열람 시 저장한 메모 복원·수정 버튼·저장 피드백·문제 사진 유지',async()=>{
 const source=await readFile('src/components/ReturnPhotosPage.tsx','utf8');
 assert.ok(source.includes('setIssueNote(it.review?.note || "")'));
 assert.ok(source.includes('advance = status === "ok"'));
 assert.ok(source.includes('setDetail(updated)'));
 assert.ok(source.includes('사진 확인 상태와 메모를 저장했습니다.'));
 assert.ok(source.includes('markReview(detail, detail.review!.status, issueNote, false)'));
 assert.ok(source.includes('문제 있음 · 저장') && source.includes('메모 저장'));
 assert.ok(source.includes('<textarea disabled={reviewBusy}'));
});
