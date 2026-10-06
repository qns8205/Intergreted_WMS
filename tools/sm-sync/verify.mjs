import { chromium } from "playwright";
const ids = process.argv.slice(2);
const ctx = await chromium.launchPersistentContext(process.cwd()+"/.browser-profile", { channel: "chrome", headless: true });
const page = ctx.pages()[0] || await ctx.newPage();
await page.goto("http://scenario-manager/object", { waitUntil: "domcontentloaded" });
const rows = await page.evaluate(async () => {
  const all = [];
  for (let p = 1; p <= 200; p++) {
    const d = await (await fetch(`/api/objects?page=${p}`, { headers: { Accept: "application/json" } })).json();
    const rs = Array.isArray(d) ? d : d.objects || d.items || [];
    if (!rs.length) break;
    all.push(...rs);
  }
  return all;
});
for (const id of ids) {
  const hit = rows.find(x => String(x.id) === id);
  console.log(id, hit ? JSON.stringify({ name: hit.name, inv: hit._inventory, last: (hit.inventory_logs||[]).slice(-1) }).slice(0, 600) : "(없음)");
}
await ctx.close();
