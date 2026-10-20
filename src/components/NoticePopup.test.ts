import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { createRequire } from "node:module";

const compiled = await build({ entryPoints:["src/components/NoticePopup.tsx"], bundle:true, platform:"node", format:"cjs", packages:"external", write:false, define:{"import.meta.env":JSON.stringify({MODE:"test"})} });
const compiledModule = { exports: {} as any };
new Function("require", "module", "exports", compiled.outputFiles[0].text)(createRequire(import.meta.url), compiledModule, compiledModule.exports);
const popup = compiledModule.exports;

test("팝업은 로그인 입력 화면에만 연결하고 랜딩·좌석 변경에서는 열지 않는다", async () => {
  const login = await readFile("src/components/BorrowerLoginPage.tsx", "utf8");
  const landing = await readFile("src/components/LandingPage.tsx", "utf8");
  assert.match(login, /!seatOnly \? <NoticePopup[^>]+beforeLogin/);
  assert.ok(!landing.includes("<NoticePopup"));
});
test("로그인 전 숨김은 브라우저 단위이며 새 공지·다음 날짜에는 다시 표시한다", () => {
  const storage = new Map<string,string>();
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable:true, value:{getItem:(key:string)=>storage.get(key) ?? null, setItem:(key:string,value:string)=>storage.set(key,value)} });
  try {
    const list = [{title:"테스트",text:"공지 내용",updatedAt:"2026-10-06 09:00:00"}];
    const now = new Date("2026-10-06T03:00:00Z");
    popup.hideForToday("login-entry", list, now);
    assert.equal(popup.isHiddenToday("login-entry", list, now), true);
    assert.equal(popup.isHiddenToday("1234", list, now), false, "기존 개인별 숨김과 섞지 않는다");
    assert.equal(popup.isHiddenToday("login-entry", [{...list[0],text:"수정한 공지"}], now), false);
    assert.equal(popup.isHiddenToday("login-entry", list, new Date("2026-10-07T03:00:00Z")), false);
  } finally {
    if (originalStorage) Object.defineProperty(globalThis,"localStorage",originalStorage);
    else Reflect.deleteProperty(globalThis,"localStorage");
  }
});
