import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const result=await build({entryPoints:['src/utils/adminRentalNotifications.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',write:false,define:{'import.meta.env':JSON.stringify({MODE:'test'})}});
const module={exports:{}};
new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
const {rentalBadge}=module.exports;
test('건수는 별도로 유지하고 상위 메뉴는 대여 확인+예약 순서',()=>{
  assert.equal(rentalBadge({pickup:1,reservations:2},'rental'),'1+2');
  assert.equal(rentalBadge({pickup:1,reservations:2},'adminReturn'),'1');
  assert.equal(rentalBadge({pickup:1,reservations:2},'adminReservations'),'2');
  assert.equal(rentalBadge({pickup:0,reservations:2},'rental'),'0+2');
  assert.equal(rentalBadge({pickup:3,reservations:0},'rental'),'3+0');
  assert.equal(rentalBadge({pickup:0,reservations:0},'rental'),'');
  assert.equal(rentalBadge({pickup:0,reservations:2},'adminReturn'),'');
  assert.equal(rentalBadge({pickup:1,reservations:2},'scenario'),'');
});
test('화면 이동과 전체 메뉴 접힘에도 알림 표시, 인증·정기 조회·작업 후 갱신 연결',async()=>{
  const app=await readFile('src/App.tsx','utf8'), hook=await readFile('src/utils/adminRentalNotifications.ts','utf8'), api=await readFile('src/utils/borrowApi.ts','utf8');
  assert.ok(app.includes('useAdminRentalNotifications(isAdmin && connected && !!scriptUrl'));
  assert.ok(app.includes('(key === "rental" || key === "items") && (!active || sidebarCollapsed)'));
  assert.ok(app.includes('rentalBadge(adminRentalCounts, view)'));
  assert.ok(hook.includes('15_000') && hook.includes("document.addEventListener('visibilitychange', refresh)"));
  assert.ok(hook.includes('if (inFlight) { again = true; return; }'));
  assert.ok(hook.includes('alive = false; window.clearInterval(timer)'));
  assert.ok(api.includes("window.dispatchEvent(new Event('wms:rental-notifications-changed'))"));
});
test('사진 확인 대기는 사진 메뉴·접힌 물품 관리에 표시하고 대여 건수와 구분',()=>{
  const counts={pickup:1,reservations:2,photoReviews:7};
  assert.equal(rentalBadge(counts,'returnPhotos'),'7');
  assert.equal(rentalBadge(counts,'items'),'7');
  assert.equal(rentalBadge(counts,'rental'),'1+2');
  assert.equal(rentalBadge({...counts,photoReviews:0},'returnPhotos'),'');
  assert.equal(rentalBadge({...counts,photoReviews:0},'items'),'');
});

test('변형 및 파손 대기는 물품 관리 합계와 전용 메뉴에 표시한다',()=>{
 const counts={pickup:1,reservations:2,photoReviews:3,objectReports:4};
 assert.equal(rentalBadge(counts,'items'),'7');
 assert.equal(rentalBadge(counts,'objectReports'),'4');
 assert.equal(rentalBadge(counts,'returnPhotos'),'3');
 assert.equal(rentalBadge({...counts,photoReviews:0},'items'),'4');
 assert.equal(rentalBadge({...counts,objectReports:0},'objectReports'),'');
});
