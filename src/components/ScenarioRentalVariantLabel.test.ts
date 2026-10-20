import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const compiled = await build({entryPoints:['src/components/ScenarioRentalVariantLabel.tsx'],bundle:true,platform:'node',format:'cjs',packages:'external',write:false});
const labelModule = {exports:{} as any};
new Function('require','module','exports',compiled.outputFiles[0].text)(createRequire(import.meta.url),labelModule,labelModule.exports);
const Label = labelModule.exports.default;
const C = {accentText:'#2563eb',accentSoft:'#eff6ff'};
const render = (item: any) => renderToStaticMarkup(React.createElement(Label,{item,C}));

test("대여 카드마다 실제 선택된 Blue/Gray 종류와 미정/미확인을 명확히 표시한다", () => {
  assert.match(render({variantName:'Blue'}), /종류: Blue/);
  assert.match(render({variantName:'Gray'}), /종류: Gray/);
  assert.match(render({variantPending:true}), /종류: 미정/);
  assert.match(render({variantUnassigned:true}), /종류: 미확인/);
  assert.equal(render({}), '');
});

test("긴 종류 이름은 별도 줄에서 줄바꿈하며 HTML을 실행하지 않는다", () => {
  const html = render({variantName:'Blue <script>ignored</script> long variant name'});
  assert.ok(html.includes('overflow-wrap:anywhere') && !html.includes('text-overflow:ellipsis'));
  assert.ok(html.includes('&lt;script&gt;') && !html.includes('<script>'));
});

test("관리자 대여 현황·전체 이력·신청 묶음 상세에 모두 연결한다", async () => {
  const source = await readFile('src/components/ScenarioAdminPage.tsx','utf8');
  for (const record of ['u','l','x']) assert.ok(source.includes(`<ScenarioRentalVariantLabel item={${record}} C={C} />`));
});
