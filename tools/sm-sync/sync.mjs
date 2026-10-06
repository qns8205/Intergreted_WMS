/**
 * WMS → Scenario Manager 재고 동기화.
 *
 * ID가 같은 오브젝트끼리 짝지어, WMS(창고 실물 장부)의 재고/대여 수량과
 * Scenario Manager(이하 SM)의 값이 어긋난 것을 찾아낸다.
 *
 * 왜 브라우저(Playwright)인가:
 *   - SM은 테일넷 안에서만 열리고, WMS 서버(미니PC)는 테일넷에서 빠져 있다.
 *     그래서 동기화는 "테일넷에 붙어 있는 PC"에서 돌아야 한다.
 *   - SM의 서버 간 API(/api/internal/v1/cos/*)는 별도 서비스 토큰이 필요하다.
 *     반면 화면이 쓰는 엔드포인트(/api/objects, /object_inventory_quantity)는
 *     사람 로그인 세션이면 그대로 호출된다 — 그래서 로그인한 브라우저 안에서 부른다.
 *   - 다만 버튼을 좌표로 클릭하지는 않는다. 화면이 바뀌면 깨지고 느리기 때문에,
 *     로그인된 세션으로 같은 API를 부르는 데까지만 브라우저를 쓴다.
 *
 * 기본은 확인용(dry-run)이다. 실제로 SM 값을 고치려면 --apply 를 붙여야 한다.
 *
 *   node sync.mjs                 # 차이만 뽑아 보여준다 (아무것도 안 고침)
 *   node sync.mjs --apply         # 차이를 SM에 반영한다
 *   node sync.mjs --apply --max 20  # 한 번에 고칠 최대 건수 (사고 방지)
 *   node sync.mjs --login         # 로그인 창만 띄운다 (처음 한 번)
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SM = process.env.SM_URL || "http://scenario-manager";
const WMS = process.env.WMS_URL || "http://192.168.100.152:3000";
// 로그인 상태를 여기 저장해 다음 실행부터는 그냥 돈다. 계정 정보는 담지 않는다(쿠키만).
const PROFILE = process.env.SM_PROFILE || path.join(__dirname, ".browser-profile");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const LOGIN_ONLY = args.includes("--login");
// 특정 물품만 처리한다(감시기가 "방금 바뀐 것"만 넘길 때 쓴다). 비면 전체.
const ONLY = (args.find((a) => a.startsWith("--ids=")) || "").split("=")[1];
const ONLY_IDS = ONLY ? new Set(ONLY.split(",").map((x) => x.trim()).filter(Boolean)) : null;
const MAX = Number((args.find((a) => a.startsWith("--max=")) || "").split("=")[1] || 0)
  || Number(args[args.indexOf("--max") + 1]) || 50;

const log = (...a) => console.log(...a);

/** WMS 쪽 장부. 여기서는 읽기만 한다. */
async function loadWms() {
  const res = await fetch(`${WMS}/api/gas?action=getScenarioObjectsForAdmin`);
  if (!res.ok) throw new Error(`WMS 조회 실패: HTTP ${res.status}`);
  const data = await res.json();
  const items = (data.items || []).filter((it) => !ONLY_IDS || ONLY_IDS.has(String(it.id || "").trim()));
  return items.map((it) => ({
    id: String(it.id || "").trim(),
    name: it.name || "",
    stock: Number(it.stock) || 0,
    rented: Number(it.rented) || 0,
    archived: !!it.archived,
  }));
}

/**
 * WMS에서 지금 나가 있는 대여 줄. 오브젝트별로 "누가 몇 개"를 모아둔다.
 *
 * SM은 대여자를 로그인 계정으로 고정해서(borrower 입력칸이 읽기 전용) 남의 대여를
 * 대신 만들 수 없다. 그래서 대여자 정보는 이벤트가 아니라 수량 조정의 note에 남긴다 —
 * 숫자만 맞추고 끝내면 "왜 이 수량이 됐는지"를 SM 쪽에서 알 길이 없기 때문이다.
 */
async function loadWmsBorrowers() {
  const res = await fetch(`${WMS}/api/gas?action=getUnreturnedItems`);
  if (!res.ok) throw new Error(`WMS 대여 목록 조회 실패: HTTP ${res.status}`);
  const data = await res.json();
  const byItem = new Map();
  for (const r of data.items || []) {
    const id = String(r.itemId || "").trim();
    if (!id) continue;
    const who = String(r.borrowerName || "").trim() || "이름 없음";
    const qty = Number(r.quantity) || 0;
    if (!byItem.has(id)) byItem.set(id, new Map());
    const m = byItem.get(id);
    m.set(who, (m.get(who) || 0) + qty);
  }
  return byItem;
}

/** "홍길동 3, 김철수 1" — 많으면 뒤는 줄인다(note가 한없이 길어지면 화면에서 안 읽힌다). */
function borrowerNote(byItem, id, max = 6) {
  const m = byItem.get(id);
  if (!m || !m.size) return "";
  const rows = [...m.entries()].sort((a, b) => b[1] - a[1]);
  const head = rows.slice(0, max).map(([who, n]) => `${who} ${n}`).join(", ");
  const rest = rows.length > max ? ` 외 ${rows.length - max}명` : "";
  return head + rest;
}

/**
 * SM 쪽 오브젝트. 응답 모양을 미리 단정하지 않는다 —
 * 처음 실행 때 실제 필드 이름을 찍어보고 맞춘다.
 */
async function loadSm(page) {
  const all = [];
  for (let p = 1; p <= 200; p++) {
    const chunk = await page.evaluate(async (pageNo) => {
      const r = await fetch(`/api/objects?page=${pageNo}`, { headers: { Accept: "application/json" } });
      if (!r.ok) return { error: `HTTP ${r.status}` };
      return r.json();
    }, p);
    if (chunk?.error) throw new Error(`SM 조회 실패(page ${p}): ${chunk.error}`);
    const rows = Array.isArray(chunk) ? chunk : chunk.objects || chunk.items || chunk.data || chunk.results || [];
    if (p === 1 && rows[0]) {
      log("· SM 응답 필드 확인:", Object.keys(rows[0]).join(", "));
      fs.writeFileSync(path.join(__dirname, "sm-sample.json"), JSON.stringify(rows[0], null, 2), "utf-8");
    }
    if (!rows.length) break;
    all.push(...rows);
    // 페이지 정보가 있으면 그걸 믿고, 없으면 빈 페이지가 나올 때까지 넘긴다.
    const totalPages = chunk?.total_pages || chunk?.pages || chunk?.page_count;
    if (totalPages && p >= totalPages) break;
  }
  return all;
}

/**
 * SM 행에서 id·재고·대여 수량을 꺼낸다.
 *
 * 진짜 재고는 최상위 quantity가 아니라 _inventory 안에 있다.
 * quantity는 재고를 추적하지 않는 오브젝트에서 -1로 들어와, 그대로 비교하면
 * 멀쩡한 물품이 전부 "불일치"로 잡힌다.
 *
 * 장부 대응:
 *   WMS.stock  (선반에 남은 수량)      ↔ SM._inventory.available
 *   WMS.rented (대여 중)              ↔ SM._inventory.borrowed
 *   WMS.stock + WMS.rented (총 보유)  ↔ SM._inventory.total
 */
const smId = (r) => String(r?.id ?? r?.oid ?? "").trim();
const smInv = (r) => r?._inventory || {};
/** 재고를 추적하지 않는 오브젝트는 비교 대상이 아니다 — 맞출 값 자체가 없다. */
const smTracked = (r) => smInv(r).is_tracked === true;
const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));
const smAvailable = (r) => num(smInv(r).available);
const smBorrowed = (r) => num(smInv(r).borrowed);
const smTotal = (r) => num(smInv(r).total);

/** 두 장부를 ID로 맞춰 어긋난 것만 추린다. */
function diff(wmsRows, smRows) {
  const smById = new Map();
  for (const r of smRows) {
    const id = smId(r);
    if (id) smById.set(id, r);
  }

  const mismatched = [];
  const missingInSm = [];
  const untracked = [];
  for (const w of wmsRows) {
    if (!w.id) continue;
    const s = smById.get(w.id);
    if (!s) { missingInSm.push(w); continue; }
    if (!smTracked(s)) { untracked.push(w); continue; }

    const avail = smAvailable(s), borrowed = smBorrowed(s), total = smTotal(s);
    const wmsTotal = w.stock + w.rented;
    const stockOff = Number.isFinite(avail) && avail !== w.stock;
    const rentOff = Number.isFinite(borrowed) && borrowed !== w.rented;
    const totalOff = Number.isFinite(total) && total !== wmsTotal;
    if (stockOff || rentOff || totalOff) {
      mismatched.push({
        id: w.id, name: w.name,
        wmsStock: w.stock, smAvailable: avail,
        wmsRented: w.rented, smBorrowed: borrowed,
        wmsTotal, smTotal: total,
        stockOff, rentOff, totalOff,
      });
    }
  }
  const wmsIds = new Set(wmsRows.map((w) => w.id));
  const missingInWms = smRows.filter((r) => smId(r) && !wmsIds.has(smId(r)));
  return { mismatched, missingInSm, missingInWms, untracked };
}

/**
 * 수량 조정에 남길 설명. 숫자만 바꿔놓으면 SM에서 보는 사람이 영문을 모르므로,
 * 어디서 온 값인지와 대여 내역(누가 몇 개)을 함께 적는다.
 */
function buildNote(m, borrowersByItem) {
  const today = new Date().toISOString().slice(0, 10);
  const parts = [`WMS 동기화 ${today}`, `총 ${m.smTotal}→${m.wmsTotal}`, `선반 ${m.wmsStock} + 대여 ${m.wmsRented}`];
  const who = borrowerNote(borrowersByItem, m.id);
  if (who) parts.push(`대여자: ${who}`);
  // SM은 대여자를 로그인 계정으로만 기록할 수 있어, 실제 대여자는 이 메모로만 전달된다.
  return parts.join(" · ").slice(0, 300);
}

/** SM의 재고 수량을 WMS 값으로 맞춘다. 화면이 쓰는 것과 같은 엔드포인트다. */
async function applyQuantity(page, oid, quantity, note) {
  return page.evaluate(async ({ oid, quantity, note }) => {
    const r = await fetch("/object_inventory_quantity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oid, quantity, note }),
    });
    let body = null;
    try { body = await r.json(); } catch { /* 본문이 JSON이 아닐 수도 있다 */ }
    return { ok: r.ok, status: r.status, body };
  }, { oid, quantity, note });
}

async function main() {
  // Playwright 전용 브라우저는 사내망에서 CDN이 막혀 내려받지 못한다 —
  // 이미 깔려 있는 Chrome을 그대로 쓴다(channel). 로그인 프로필은 여기 따로 둔다.
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    channel: process.env.SM_CHANNEL || "chrome",
    headless: !LOGIN_ONLY && !process.env.SM_HEADED,
    viewport: { width: 1280, height: 900 },
  });
  const page = ctx.pages()[0] || (await ctx.newPage());

  await page.goto(`${SM}/object`, { waitUntil: "domcontentloaded" });
  if (page.url().includes("/login")) {
    if (!LOGIN_ONLY) {
      log("로그인이 필요합니다. 창을 띄워 직접 로그인해주세요:  node sync.mjs --login");
      await ctx.close();
      process.exit(2);
    }
    log("열린 창에서 로그인해주세요. 로그인이 끝나면 이 창을 닫지 말고 기다려주세요…");
    await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 5 * 60 * 1000 });
    log("로그인 상태를 저장했습니다. 이제 --login 없이 실행하면 됩니다.");
    await ctx.close();
    return;
  }
  if (LOGIN_ONLY) { log("이미 로그인돼 있습니다."); await ctx.close(); return; }

  const [wmsRows, smRows, borrowersByItem] = await Promise.all([loadWms(), loadSm(page), loadWmsBorrowers()]);
  log(`· WMS ${wmsRows.length}종 / SM ${smRows.length}종`);

  const { mismatched, missingInSm, missingInWms, untracked } = diff(wmsRows, smRows);
  for (const m of mismatched) m.note = m.totalOff ? buildNote(m, borrowersByItem) : "";
  log(`· 수량 불일치 ${mismatched.length}건 · SM에 없는 ID ${missingInSm.length}건 · WMS에 없는 ID ${missingInWms.length}건\n`);

  for (const m of mismatched.slice(0, 40)) {
    const parts = [];
    if (m.totalOff) parts.push(`총 ${m.smTotal}→${m.wmsTotal}`);
    if (m.stockOff) parts.push(`가용 ${m.smAvailable}→${m.wmsStock}`);
    if (m.rentOff) parts.push(`대여 ${m.smBorrowed}→${m.wmsRented}`);
    log(`  ${m.id}  ${String(m.name).slice(0, 22).padEnd(22)} ${parts.join(" · ")}`);
    if (m.totalOff) log(`          note: ${buildNote(m, borrowersByItem)}`);
  }
  if (mismatched.length > 40) log(`  … 외 ${mismatched.length - 40}건 (보고서 참고)`);

  const report = {
    at: new Date().toISOString(),
    mismatched, missingInSm,
    untracked: untracked.map((u) => u.id),
    missingInWms: missingInWms.map(smId),
  };
  fs.writeFileSync(path.join(__dirname, "last-report.json"), JSON.stringify(report, null, 2), "utf-8");
  log(`\n· 보고서: ${path.join(__dirname, "last-report.json")}`);

  if (!APPLY) {
    log("\n확인용 실행이라 아무것도 고치지 않았습니다. 반영하려면 --apply 를 붙이세요.");
    await ctx.close();
    return;
  }

  // 실제로 고칠 대상은 "총 보유 수량이 다른 것"뿐이다. 가용 수량만 다른 건은
  // WMS에서 대여 중이라 생기는 정상적인 차이라 건드리지 않는다.
  const targets = mismatched.filter((m) => m.totalOff);
  // --max 는 이번 실행에서 반영할 최대 건수다. 기본값을 낮게 둬서, 아무 생각 없이
  // --apply 만 붙였을 때 수백 건이 한 번에 나가지 않도록 한다.
  const batch = targets.slice(0, MAX);
  log(`
· 반영 대상 ${targets.length}건 중 ${batch.length}건을 처리합니다.`);
  if (targets.length > batch.length) log(`  (나머지 ${targets.length - batch.length}건은 --max=${targets.length} 로 이어서)`);

  let done = 0;
  for (const m of batch) {
    // 대여 수량은 이벤트로만 움직여야 해서 여기서 건드리지 않는다 — 총 보유 수량만 맞춘다.
    if (!m.totalOff) continue;
    const res = await applyQuantity(page, m.id, m.wmsTotal, buildNote(m, borrowersByItem));
    if (res.ok) { done++; log(`  ✓ ${m.id} 총 보유 ${m.smTotal}→${m.wmsTotal}`); }
    else log(`  ✗ ${m.id} 실패 HTTP ${res.status} ${JSON.stringify(res.body ?? "")}`);
  }
  log(`\n${done}건 반영했습니다.`);
  await ctx.close();
}

main().catch((e) => { console.error("실패:", e.message); process.exit(1); });
