import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const app = await readFile("src/App.tsx", "utf8");
const returnPage = await readFile("src/components/AdminReturnPage.tsx", "utf8");
const pageSource = await readFile("src/components/AdminReservationsPage.tsx", "utf8");

test("예약 대여는 대여 관리의 독립 서브메뉴이고 직접 주소·관리자 표시를 지원한다", () => {
  assert.match(app, /view: "adminReservations", icon: <CalendarClock[^\n]+label: "예약 대여"/);
  assert.match(app, /path === "adminReservations"\) \{\s*setCurrentView\("adminReservations"\)/);
  assert.match(app, /path === "adminReturn"[^\n]+path === "adminReservations"[^\n]+\{\s*setAdminSection\("rental"\)/);
  assert.match(app, /currentView === "adminReservations" && !isAdmin/);
  assert.ok(!returnPage.includes("AdminReservationsPanel") && !returnPage.includes("AdminReservationsPage"));
});

test("서브메뉴 이동 때 예약 작업을 유지하고 숨겨진 화면의 자동 조회는 중단한다", () => {
  assert.match(app, /PERSISTENT_ADMIN_VIEWS = \[[^\n]+"adminReservations"/);
  assert.match(app, /mountedAdminViews.has\("adminReservations"\)/);
  assert.match(app, /<AdminReservationsPage[^\n]+isActive=\{currentView === "adminReservations"\}/);
  assert.match(pageSource, /!document.hidden && activeRef.current/);
  assert.match(pageSource, /if \(isActive\) \{ setNow\(Date.now\(\)\); void load\(true\); \}/);
});
test("예약 필터와 목록·상세 상태 표시는 공통 10분 전 판정을 사용한다",()=>{
  assert.ok(pageSource.includes("isReservationDue(item.startsAt,now)"));
  assert.ok(pageSource.includes("isReservationDue(selected.startsAt,now)"));
  assert.ok(!pageSource.includes("Date.parse(item.startsAt)<=now") && !pageSource.includes("Date.parse(selected.startsAt)<=now"));
  assert.ok(pageSource.includes("RESERVATION_DUE_LEAD_MS / 60000"));
  assert.ok(pageSource.includes('["upcoming","예정 시각 전"],["due","예약 후 미수령"]'));
  assert.ok(!pageSource.includes('["all","전체 예약"]'));
  assert.ok(pageSource.includes('selected.status === "fulfilled"'));
  assert.ok(pageSource.includes('예약 예정 시각부터 20분 내 수령 확인이 없으면 자동 취소됩니다.'));
});

test("독립 예약 화면은 펼치기 없이 제목·검색·목록을 표시한다", async () => {
  const compiled = await build({ entryPoints:["src/components/AdminReservationsPage.tsx"], bundle:true, platform:"node", format:"cjs", packages:"external", write:false,
    define:{"import.meta.env":JSON.stringify({MODE:"test"})} });
  const module = {exports:{}};
  new Function("require","module","exports",compiled.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
  const html = renderToStaticMarkup(React.createElement(module.exports.default,{scriptUrl:"",connected:false,isLightMode:true,showToast:()=>{}}));
  assert.match(html, /<h1[^>]*>[\s\S]*?예약 대여/);
  assert.ok(html.includes('aria-label="예약 대여 검색"') && html.includes('id="admin-reservations-list"'));
  assert.ok(html.includes('aria-label="예약 상세"') && html.includes('선택한 예약 취소'));
  assert.match(pageSource, /cancelAdminItemReservation\(scriptUrl, chosen.id\)/);
});
test("관리자 예약 화면은 자동 전환 후에도 취소를 허용하고 미수령 재고 복구를 안내한다",()=>{
  assert.ok(!pageSource.includes('disabled={!selected || selected.status === "fulfilled"'));
  assert.ok(!pageSource.includes('target.status === "fulfilled" || cancelling.current'));
  assert.ok(pageSource.includes('이미 수령한 물품은 유지합니다.'));
  assert.ok(pageSource.includes('result.releasedQuantity'));
});
