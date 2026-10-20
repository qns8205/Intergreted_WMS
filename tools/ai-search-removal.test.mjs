import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
test('시나리오와 공구 UI에서 AI 경로 제거, 일반 검색과 장바구니·사진 신청 유지',async()=>{
  for(const file of ['src/components/BrowsePage.tsx','src/components/UnattendedToolBorrowForm.tsx','src/utils/warehouseManualApi.ts']){
    const source=await readFile(file,'utf8');
    assert.doesNotMatch(source,/AI 검색|searchScenarioAi|sciAi|runScenarioAi|searchTools|ToolSearchResult|warehouse-requests\/search/);
  }
  const browse=await readFile('src/components/BrowsePage.tsx','utf8');
  assert.ok(browse.includes('scenarioRegularScore(it, q, hideLocation)'));
  assert.ok(browse.includes('sciRequestFilter') && browse.includes('예약 신청하기') && browse.includes('장바구니'));
  const result=await build({entryPoints:['src/components/UnattendedToolBorrowForm.tsx'],bundle:true,platform:'node',format:'cjs',packages:'external',write:false,define:{'import.meta.env':JSON.stringify({MODE:'test'})}});
  const module={exports:{}};
  new Function('require','module','exports',result.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
  const html=renderToStaticMarkup(React.createElement(module.exports.default,{active:true,enabled:true,employeeId:'1234',name:'테스트',floors:[],floorsLoaded:true,isLightMode:true}));
  assert.ok(html.includes('물품 이름 직접 입력') && html.includes('사진 찍기') && html.includes('공구 신청 완료'));
  assert.ok(!html.includes('AI 검색'));
});
test('서버에서 AI 라우터·자동 인덱싱 제거, 일반 후보 API는 별도 경량 모듈 사용',async()=>{
  const index=await readFile('server/index.js','utf8'), route=await readFile('server/routes/warehouseRequests.js','utf8');
  assert.doesNotMatch(index,/scenarioAiSearch|warehouseSearchService|warmAllAiSearch|toolAiConfigured/);
  assert.doesNotMatch(route,/searchWarehouseTools|warehouse-requests\/search/);
  assert.ok(route.includes('warehouseToolSuggestions.js') && route.includes('warehouse-requests/suggest'));
});
