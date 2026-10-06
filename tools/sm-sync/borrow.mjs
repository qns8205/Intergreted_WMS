/**
 * WMS에서 대여 중인 수량만큼 Scenario Manager에도 대여(Borrow) 이벤트를 남긴다.
 *
 * 화면의 Borrow 버튼이 부르는 것과 같은 요청이다:
 *   POST /object_inventory_event  {oid, action:"borrow", quantity, borrower, note}
 *
 * 주의: SM 화면은 borrower 입력칸을 로그인 계정으로 고정(readonly)해 둔다.
 * 서버도 그렇게 강제하는지는 실제로 넣어봐야 알 수 있어서, 여기서는 WMS의 실제
 * 대여자(사번)를 실어 보내고 결과를 확인한다. 서버가 무시하고 로그인 계정으로
 * 적더라도 note에 실제 대여자가 남으므로 추적은 가능하다.
 *
 *   node borrow.mjs 000008            # 무엇을 보낼지만 보여준다
 *   node borrow.mjs 000008 --apply    # 실제로 대여 이벤트를 만든다
 *   node borrow.mjs --from-report     # 보고서의 대여 불일치 건 전체를 대상으로
 *   node borrow.mjs 000008 --reset --apply
 *       SM에 이미 잡혀 있는 대여를 전부 반납 처리한 뒤 WMS 기준으로 다시 넣는다.
 *       (대여자를 이름으로 잘못 넣었다가 사번으로 고쳐 넣을 때처럼, 다시 맞출 때 쓴다)
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SM = process.env.SM_URL || "http://scenario-manager";
const WMS = process.env.WMS_URL || "http://192.168.100.152:3000";
const PROFILE = process.env.SM_PROFILE || path.join(__dirname, ".browser-profile");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const RESET = args.includes("--reset");
const FROM_REPORT = args.includes("--from-report");
let ids = args.filter((a) => !a.startsWith("--"));

if (FROM_REPORT) {
  const rep = JSON.parse(fs.readFileSync(path.join(__dirname, "last-report.json"), "utf-8"));
  ids = rep.mismatched.filter((m) => m.wmsRented > 0).map((m) => m.id);
}
if (!ids.length) { console.log("대상 oid를 지정하거나 --from-report 를 쓰세요."); process.exit(1); }

/**
 * 사번. WMS가 이미 계산해서 내려준다 — cfgw 인원은 이메일("3673@cfgw-kr.com")에서,
 * ConfigDS 인원은 직원 명부에 적어둔 사번에서 온다. SM의 borrower도 사번 형태다.
 * 사번을 모르면 이름으로 보내지만, SM은 사번을 키로 쓰므로 그 사람의 "내 대여" 목록에
 * 잡히지 않는다 — 그래서 아래에서 따로 경고한다.
 */
const empIdOf = (row) => {
  const given = String(row.employeeId || "").trim();
  if (given) return given;
  const m = String(row.email || "").match(/^(\d+)@/);
  return m ? m[1] : "";
};

const res = await fetch(`${WMS}/api/gas?action=getUnreturnedItems`);
const data = await res.json();

// 오브젝트 → 대여자별 수량. 같은 사람이 여러 번 빌렸으면 합쳐 한 번에 처리한다.
const plan = new Map();
for (const r of data.items || []) {
  const oid = String(r.itemId || "").trim();
  if (!ids.includes(oid)) continue;
  const key = `${r.borrowerName || "이름 없음"}|${empIdOf(r)}`;
  if (!plan.has(oid)) plan.set(oid, new Map());
  const m = plan.get(oid);
  m.set(key, (m.get(key) || 0) + (Number(r.quantity) || 0));
}

const today = new Date().toISOString().slice(0, 10);
const jobs = [];
for (const [oid, people] of plan) {
  for (const [key, qty] of people) {
    const [name, empId] = key.split("|");
    if (qty <= 0) continue;
    jobs.push({
      oid, quantity: qty,
      borrower: empId || name,
      note: `WMS 동기화 ${today} · 실제 대여자 ${name}${empId ? `(${empId})` : ""}`,
      who: name,
    });
  }
}

console.log(`· 대상 ${plan.size}종 · 대여 이벤트 ${jobs.length}건`);
for (const j of jobs) console.log(`  ${j.oid}  ${j.who} ${j.quantity}개  borrower=${j.borrower}`);

// 사번을 못 찾은 사람은 SM에서 이름 문자열로 들어가 "내 대여"에 안 잡힌다.
const noEmpId = [...new Set(jobs.filter((j) => j.borrower === j.who).map((j) => j.who))];
if (noEmpId.length) {
  console.log(`
⚠ 사번을 모르는 대여자 ${noEmpId.length}명: ${noEmpId.join(", ")}`);
  console.log("  연결 설정 > ConfigDS 직원 명부에 사번을 적어두면 다음 실행부터 사번으로 들어갑니다.");
}

const ctx = await chromium.launchPersistentContext(PROFILE, { channel: "chrome", headless: true });
const page = ctx.pages()[0] || (await ctx.newPage());
await page.goto(`${SM}/object`, { waitUntil: "domcontentloaded" });
if (page.url().includes("/login")) { console.log("로그인이 필요합니다 (node sync.mjs --login)"); await ctx.close(); process.exit(2); }

// SM에 지금 잡혀 있는 대여 상태. 이걸 기준으로 "모자란 만큼만" 넣는다 —
// 같은 명령을 두 번 돌려도 대여가 두 배가 되지 않아야 한다.
const smBorrowers = await page.evaluate(async (oids) => {
  const all = [];
  for (let p = 1; p <= 200; p++) {
    const d = await (await fetch(`/api/objects?page=${p}`, { headers: { Accept: "application/json" } })).json();
    const rs = Array.isArray(d) ? d : d.objects || d.items || [];
    if (!rs.length) break;
    all.push(...rs);
  }
  const out = {};
  for (const oid of oids) {
    const hit = all.find((x) => String(x.id) === oid);
    out[oid] = hit?._inventory?.borrowers || {};
  }
  return out;
}, ids);

if (RESET) {
  // 대여자를 잘못 넣었을 때처럼 처음부터 다시 맞춰야 하면, 기존 대여를 전부 반납으로 되돌린다.
  const undo = [];
  for (const [oid, borrowers] of Object.entries(smBorrowers)) {
    for (const [who, qty] of Object.entries(borrowers)) if (qty > 0) undo.push({ oid, who, qty });
  }
  console.log(`\n· 되돌릴 기존 대여 ${undo.length}건`);
  for (const u of undo) {
    const r = await page.evaluate(async (job) => {
      const res = await fetch("/object_inventory_event", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oid: job.oid, action: "return", quantity: job.qty, borrower: job.who, note: job.note }),
      });
      return { ok: res.ok, status: res.status };
    }, { ...u, note: `WMS 동기화 되돌림 ${today}` });
    console.log(r.ok ? `  ↩ ${u.oid} ${u.who} ${u.qty}개 반납` : `  ✗ ${u.oid} ${u.who} 반납 실패 HTTP ${r.status}`);
    if (r.ok) smBorrowers[u.oid][u.who] = 0;
  }
}

// 사람별로 "WMS가 말하는 수량 - SM에 이미 잡힌 수량"만 처리한다.
const todo = [];
for (const j of jobs) {
  const have = Number(smBorrowers[j.oid]?.[j.borrower] || 0);
  const delta = j.quantity - have;
  if (delta > 0) todo.push({ ...j, action: "borrow", quantity: delta, have });
  else if (delta < 0) todo.push({ ...j, action: "return", quantity: -delta, have });
}
const skipped = jobs.length - todo.length;
console.log(`\n· 처리할 이벤트 ${todo.length}건${skipped ? ` (이미 맞는 ${skipped}건은 건너뜀)` : ""}`);

if (!APPLY) {
  for (const t of todo) console.log(`  ${t.action === "borrow" ? "＋" : "－"} ${t.oid} ${t.who} ${t.quantity}개 (SM 현재 ${t.have})`);
  console.log("\n확인용 실행입니다. 실제로 넣으려면 --apply 를 붙이세요.");
  await ctx.close();
  process.exit(0);
}

let done = 0;
for (const j of todo) {
  const r = await page.evaluate(async (job) => {
    const res = await fetch("/object_inventory_event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oid: job.oid, action: job.action, quantity: job.quantity, borrower: job.borrower, note: job.note }),
    });
    let body = null;
    try { body = await res.json(); } catch { /* JSON이 아닐 수도 있다 */ }
    return { ok: res.ok, status: res.status, body };
  }, j);
  if (r.ok) { done++; console.log(`  ✓ ${j.oid} ${j.who} ${j.action === "borrow" ? "대여" : "반납"} ${j.quantity}개`); }
  else console.log(`  ✗ ${j.oid} ${j.who} 실패 HTTP ${r.status} ${JSON.stringify(r.body ?? "").slice(0, 200)}`);
}
console.log(`\n${done}/${todo.length}건 반영했습니다.`);
await ctx.close();
