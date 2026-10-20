import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {build} from "esbuild";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";

async function compile(file){
  const result=await build({entryPoints:[file],bundle:true,platform:"node",format:"cjs",packages:"external",write:false,define:{"import.meta.env":JSON.stringify({MODE:"test"})}});
  const module={exports:{}};new Function("require","module","exports",result.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
  return module.exports;
}
const C={card:"#fff",cardSub:"#f8fafc",bg:"#fff",border:"#ddd",text:"#111",label:"#666",accent:"#2563eb",accentSoft:"#eff6ff"};
const fields=(await compile("src/components/RentalTermsFields.tsx")).default;
const reservations=await compile("src/components/ItemReservations.tsx");
const noop=()=>{};
test("세 가지 대여 방식: 일반은 사유 없이 4시간, 사유·장기대여는 필수 입력을 표시한다",()=>{
  const props={C,reason:'업체용',dueDate:'',onMode:noop,onReason:noop,onDueDate:noop};
  const reason=renderToStaticMarkup(React.createElement(fields,{...props,mode:'reason'}));
  assert.match(reason,/<textarea[^>]*required/);assert.ok(reason.includes('4시간 반납 제한에서 면제'));
  const general=renderToStaticMarkup(React.createElement(fields,{...props,mode:'general'}));
  assert.ok(!general.includes('<textarea'));assert.ok(general.includes('5종이 48시간'));
  const long=renderToStaticMarkup(React.createElement(fields,{...props,mode:'long_term'}));
  assert.match(long,/<textarea[^>]*required/);assert.match(long,/<input type="date" required="" min="\d{4}-\d{2}-\d{2}"/);
});
test("Request·일반 물품 예약 모두 대여 방식 선택 전 확정을 막는다",()=>{
  const props={C,items:[{id:"000001",name:"예약 박스",quantity:1}],scriptUrl:"/api/gas",floor:"B1",unit:"Unit 7",onClose:noop,onSaved:noop};
  const request=renderToStaticMarkup(React.createElement(reservations.ReserveItemsCard,{...props,inventory:[{id:"000001",requestFor:""}]}));
  assert.ok(request.includes('aria-label="대여 방식 선택"'));
  assert.match(request,/<button type="submit" disabled=""/);
  const general=renderToStaticMarkup(React.createElement(reservations.ReserveItemsCard,{...props,inventory:[{id:"000001"}]}));
  assert.ok(general.includes('aria-label="대여 방식 선택"'));
  assert.match(general,/<button type="submit" disabled=""/);
  assert.ok(general.includes('예약 예정 시각부터 20분 내에 수령 확인을 완료하지 않으면 자동 취소됩니다.'));
});
test("예약도 하나씩·ID로 담을 때 Request 주의를 표시하고 현재 카탈로그로 분류한다",async()=>{
  const source=await readFile("src/components/BrowsePage.tsx","utf8");
  assert.ok(source.includes('items={reservationCart} inventory={sciItems}'));
  assert.ok(source.includes('if (hazards.length) setHazardAsk({items:hazards,onConfirm:add})'));
  assert.ok(source.includes('if (hazards.length) { setHazardAsk({ items: hazards, onConfirm: apply })'));
});
test("본인 미수령 예약 취소 후 대여 목록을 갱신하고 이전 조회 결과가 취소를 되살리지 않는다",async()=>{
  const booking=await readFile('src/components/ItemReservations.tsx','utf8');
  const lookup=await readFile('src/components/MyRentalList.tsx','utf8');
  assert.ok(booking.includes('재고 확보 · 수령 확인 대기'));
  assert.ok(booking.includes('window.confirm('));
  assert.ok(booking.includes('ticket === refreshGeneration.current'));
  assert.ok(lookup.includes('onChanged={onRefresh}'));
});
