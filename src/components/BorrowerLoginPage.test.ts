import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Bundle TSX in memory so this test does not need a browser, credentials or generated files.
const compiled = await build({
  entryPoints: ["src/components/BorrowerLoginPage.tsx"], bundle: true,
  platform: "node", format: "cjs", packages: "external", write: false,
  define: { "import.meta.env": JSON.stringify({ MODE: "test" }) },
});
const { createRequire } = await import("node:module");
const require = createRequire(import.meta.url);
const compiledModule = { exports: {} as { default?: React.ComponentType<any> } };
new Function("require", "module", "exports", compiled.outputFiles[0].text)(require, compiledModule, compiledModule.exports);
const BorrowerLoginPage = compiledModule.exports.default!;
const props = { scriptUrl: "/api/gas", connected: true, isLightMode: true, showToast() {}, onBack() {}, onDone() {} };

// 로그인과 좌석 선택은 두 단계다. 처음에는 사번·비밀번호만 받고, 로그인이 끝난 다음 화면에서 좌석을 고른다.
test("처음 화면은 사번·비밀번호만 입력받고 좌석 선택은 다음 단계로 미룬다", () => {
  const html = renderToStaticMarkup(React.createElement(BorrowerLoginPage, props));
  for (const value of ['id="borrower-employee-id"', 'id="sm-password"']) assert.ok(html.includes(value), value);
  for (const value of ['id="borrower-seat-floor"', 'aria-label="본인 좌석 유닛"', "좌석 위치", "좌석 배치도 보기"]) assert.ok(!html.includes(value), `1단계에 좌석 입력이 없어야 한다: ${value}`);
  assert.ok(html.includes("사번과 비밀번호로 로그인"), "안내 문구는 로그인만 말한다");
  assert.ok(!html.includes("본인 좌석을 입력한 뒤 로그인해주세요"), "좌석을 같이 입력하라는 옛 안내는 없어야 한다");
  assert.ok(html.includes('for="sm-password">비밀번호</label>'));
  assert.ok(html.includes('placeholder="비밀번호"'));
  assert.ok(!html.includes("SM 비밀번호") && !html.includes("Scenario Manager 비밀번호"));
  assert.ok(!html.includes("SM 로그인 성공 여부만 확인하며"));
  assert.ok(!html.includes("인증 설정 확인 중"));
  assert.ok(!html.includes("인증한 후 좌석을 선택"));
  assert.ok(!html.includes("자주 사용하는 유닛"), "개인 추천 이력은 인증 전에 조회하지 않는다");
});

test("좌석 변경 화면은 사번·비밀번호를 다시 입력받지 않는다", () => {
  const html = renderToStaticMarkup(React.createElement(BorrowerLoginPage, { ...props, seatOnly: { name: "테스트", employeeId: "1234", affiliation: "cfgw", floor: "18F", unit: "Unit 1" } }));
  assert.ok(html.includes("borrower-seat-floor"));
  assert.ok(!html.includes('id="sm-password"') && !html.includes('id="borrower-employee-id"'));
});
