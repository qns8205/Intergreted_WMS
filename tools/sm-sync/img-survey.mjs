import { chromium } from "playwright";
const ctx = await chromium.launchPersistentContext(process.cwd()+"/.browser-profile", { channel: "chrome", headless: true });
const page = ctx.pages()[0] || await ctx.newPage();
await page.goto("http://scenario-manager/object", { waitUntil: "domcontentloaded" });
if (page.url().includes("/login")) { console.log("로그인 필요"); await ctx.close(); process.exit(2); }
const rows = await page.evaluate(async () => {
  const all = [];
  for (let p = 1; p <= 200; p++) {
    const d = await (await fetch(`/api/objects?page=${p}`, { headers: { Accept: "application/json" } })).json();
    const rs = Array.isArray(d) ? d : d.objects || d.items || [];
    if (!rs.length) break;
    all.push(...rs.map(r => ({ id: String(r.id), name: r.name, image_url: r.image_url || "", image_key: r.image_key || "" })));
  }
  return all;
});
const wms = (await (await fetch("http://192.168.100.152:3000/api/gas?action=getScenarioObjectsForAdmin")).json()).items || [];
const wmsMap = new Map(wms.map(w => [String(w.id), w]));
const matched = rows.filter(r => wmsMap.has(r.id));
const noImg = matched.filter(r => !r.image_url && !r.image_key);
const wmsHasImg = noImg.filter(r => (wmsMap.get(r.id).image || "").trim());
console.log(`SM 전체 ${rows.length}종 · WMS와 매칭 ${matched.length}종`);
console.log(`  SM에 이미지 없음: ${noImg.length}종`);
console.log(`  그중 WMS에 이미지 있음(올릴 수 있는 것): ${wmsHasImg.length}종`);
console.log(`SM 이미지 있는 예시: ${matched.filter(r=>r.image_url)[0]?.image_url || "-"}`);
for (const r of wmsHasImg.slice(0, 8)) console.log(`  ${r.id} ${r.name?.slice(0,20)} ← ${wmsMap.get(r.id).image}`);
await ctx.close();
