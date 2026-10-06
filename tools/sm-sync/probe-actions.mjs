/**
 * 대여/반납 버튼이 실제로 어떤 요청을 보내는지 화면 코드에서 읽어낸다.
 * 아무것도 쓰지 않는다 — 페이지와 스크립트 파일을 받아 문자열만 훑는다.
 */
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SM = process.env.SM_URL || "http://scenario-manager";
const PROFILE = process.env.SM_PROFILE || path.join(__dirname, ".browser-profile");
const OID = process.argv[2] || "000008";

const ctx = await chromium.launchPersistentContext(PROFILE, { channel: "chrome", headless: true });
const page = ctx.pages()[0] || (await ctx.newPage());

await page.goto(`${SM}/object_detail/${OID}`, { waitUntil: "domcontentloaded" });
if (page.url().includes("/login")) { console.log("로그인이 필요합니다 (node sync.mjs --login)"); await ctx.close(); process.exit(2); }

// 페이지 안의 인라인 스크립트 + 외부 js 파일을 모두 모아 본다
const sources = await page.evaluate(async () => {
  const out = [];
  for (const s of document.querySelectorAll("script")) {
    if (s.src) {
      try { out.push({ src: s.src, text: await (await fetch(s.src)).text() }); } catch { /* 무시 */ }
    } else if (s.textContent?.trim()) {
      out.push({ src: "(inline)", text: s.textContent });
    }
  }
  return out;
});

const hits = [];
for (const { src, text } of sources) {
  if (!text.includes("object_inventory")) continue;
  const lines = text.split("\n");
  lines.forEach((ln, i) => {
    if (/object_inventory|action\s*[:=]\s*["']/.test(ln)) {
      hits.push(`${path.basename(src)}:${i + 1}  ${ln.trim().slice(0, 200)}`);
    }
  });
}
console.log(`· ${OID} 상세 화면 · 스크립트 ${sources.length}개`);
console.log(hits.length ? hits.join("\n") : "  object_inventory 관련 코드를 찾지 못했습니다.");

// 화면에 실제로 보이는 대여/반납 버튼 라벨도 같이 남긴다
const buttons = await page.evaluate(() =>
  [...document.querySelectorAll("button, a.btn, input[type=submit]")]
    .map((b) => (b.textContent || b.value || "").trim())
    .filter((t) => t && t.length < 30)
);
console.log("\n· 화면 버튼:", [...new Set(buttons)].join(" | ").slice(0, 400));

await ctx.close();
