/**
 * Scenario Manager(SM) 재고 동기화.
 *
 * WMS(창고 실물 장부)를 기준으로 SM의 오브젝트 수량과 대여 상태를 맞춘다.
 * 대여 확인·반납으로 달라진 물품만 골라 처리하므로 한 회차가 몇 초면 끝난다.
 *
 * 왜 서버에서 도는가:
 *   예전에는 관리자 PC마다 에이전트를 깔아야 했다. 미니PC가 테일넷에서 빠져 있어
 *   SM에 닿지 못했기 때문이다. 2026-09-07에 서버를 회사 테일넷(tailb971f6)에 넣으면서
 *   서버가 직접 SM을 부를 수 있게 됐고, PC마다 설치할 이유가 사라졌다.
 *
 * 누구 이름으로 기록되나:
 *   SM은 사람 로그인 세션으로만 쓰기가 되고, 대여자(borrower)는 요청에 실어 보낼 수 있다.
 *   그래서 관리자가 WMS에 로그인할 때 같은 자격증명으로 SM에도 로그인해 세션을 확보하고,
 *   그 세션으로 처리한다 — SM에는 actor(처리자)=그 관리자, borrower=WMS의 실제 대여자로 남는다.
 *   WMS 관리자 계정과 SM 계정이 같다는 전제를 쓴다.
 *
 * 비밀번호는 로그인 요청에만 쓰고 버린다. 세션 쿠키만 이 프로세스의 메모리에 있다.
 * 그래서 서버를 재시작하면 관리자가 다시 로그인할 때까지 동기화가 멈춘다 —
 * 자격증명을 디스크에 두지 않기 위해 감수하는 부분이다. 그동안의 변화는 사라지지 않고
 * 기준 상태를 갱신하지 않은 채 미뤄뒀다가, 세션이 생기면 한꺼번에 처리한다.
 */
import fs from "node:fs";
import path from "node:path";
import { all, get, run } from "../db.js";
import { padSlot, parseItemLabel } from "./borrowUtils.js";
import { employeeIdForRentalRow, registeredUser } from "./registeredUsers.js";

// 테일넷 IP를 기본으로 쓴다. 이름(scenario-manager)은 MagicDNS에 기대는데,
// 서버는 --accept-dns=false로 붙어 있어 이름 해석이 언제든 바뀔 수 있다.
const SM = process.env.SM_URL || "http://100.92.161.29";
// 정기 회차. 재고를 바꾸는 동작마다 nudge()로 곧바로 맞추므로, 이쪽은 그물망 역할만 한다 —
// 즉시 반영이 어떤 이유로 빠졌거나(세션 없음 등) 서버 밖에서 데이터가 바뀐 경우를 주워 담는다.
// 예전에는 20초였는데, 그때는 이게 유일한 경로라 짧아야 했다.
const INTERVAL_SEC = Number(process.env.SM_SYNC_INTERVAL || 300);
// 변화 알림을 놓쳤거나 외부에서 SM 상태를 수정한 경우를 복구하는 전체 대조 주기.
// 전체 대조도 실제 차이가 있는 항목만 SM에 쓰므로 반복 실행해도 안전하다.
const FULL_RECONCILE_SEC = Number(process.env.SM_SYNC_FULL_INTERVAL || 1800);
const ENABLED = process.env.SM_SYNC !== "off";

// 관리자별 SM 세션. 값은 쿠키뿐이고 비밀번호는 담지 않는다.
const sessions = new Map(); // loginId -> { cookie, at }
let lastRun = null;
let running = false;
let lastFullReconcileAt = 0;

const log = (msg) => console.log(`[sm-sync] ${msg}`);

/* ── 전용 계정 ───────────────────────────────────────────────
 *
 * 동기화가 사람의 로그인에 매달려 있었다. 관리자가 며칠 들어오지 않으면 그동안의 변화가
 * 계속 쌓이고, 나중에 한꺼번에 나가면서 SM에 찍히는 시각이 실제와 벌어졌다.
 *
 * 그래서 이 서버만 쓰는 계정을 따로 두고, 서버가 뜰 때 스스로 로그인한다. 세션이 만료돼도
 * 다시 로그인한다. 이제 사람이 로그인하지 않아도 동기화가 돈다.
 *
 * 자격증명은 저장소에 넣지 않는다. 서버의 파일에만 두고 주인만 읽을 수 있게 한다.
 * (원래는 비밀번호를 디스크에 두지 않는 설계였다 — 그 대신 치르는 값이다.
 *  SM이 서비스 토큰을 발급해주면 이 파일은 필요 없어진다.)
 */
const SERVICE_LOGIN_FILE = process.env.SM_LOGIN_FILE
  || path.join(process.env.WMS_DATA_DIR || path.join(process.cwd(), "server", "data"), "sm-login.json");

function serviceCredentials() {
  // 환경변수로 준 값이 우선이다. 없으면 파일에서 읽는다.
  if (process.env.SM_LOGIN_ID && process.env.SM_LOGIN_PW) {
    return { loginId: process.env.SM_LOGIN_ID, password: process.env.SM_LOGIN_PW };
  }
  try {
    const raw = fs.readFileSync(SERVICE_LOGIN_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed?.loginId && parsed?.password) return { loginId: String(parsed.loginId), password: String(parsed.password) };
  } catch { /* 파일이 없으면 예전처럼 사람 로그인만으로 돈다 */ }
  return null;
}

/** 전용 계정으로 로그인한다. 세션이 없거나 만료됐을 때 부른다. */
let serviceLoginAt = 0;
async function loginAsService({ force = false } = {}) {
  const cred = serviceCredentials();
  if (!cred) return false;
  // 비밀번호가 틀렸을 때 매 회차마다 두드리지 않는다.
  if (!force && Date.now() - serviceLoginAt < 60000) return false;
  serviceLoginAt = Date.now();
  await attachSession(cred.loginId, cred.password);
  return sessions.has(cred.loginId);
}

// ── 세션 ───────────────────────────────────────────────────

/**
 * WMS 관리자 로그인이 성공한 직후에 불린다. 같은 자격증명으로 SM에 로그인해 둔다.
 * 실패해도 WMS 로그인 자체는 그대로 진행된다 — 두 시스템의 비밀번호가 갈렸을 뿐일 수 있고,
 * 그것 때문에 관리자가 WMS를 못 쓰게 만들 이유는 없다.
 */
export async function attachSession(loginId, password) {
  if (!ENABLED || !loginId || !password) return;
  try {
    const res = await fetch(`${SM}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Host: "scenario-manager" },
      body: new URLSearchParams({ username: loginId, password }).toString(),
      redirect: "manual",
      // SM이 바쁜 날에는 로그인 한 번이 10~40초 걸린다. 10초에 끊으면 세션을 못 잡아 동기화가 통째로 멈춘다.
      signal: AbortSignal.timeout(Number(process.env.SM_LOGIN_TIMEOUT_MS ?? 45000)),
    });
    const cookie = (res.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
    if (!cookie) { log(`${loginId} SM 로그인 실패 (HTTP ${res.status}) — 계정이 다르거나 비밀번호가 갈렸을 수 있습니다.`); return; }
    sessions.set(loginId, { cookie, at: Date.now() });
    log(`${loginId} SM 세션 확보 — 이후 동기화는 이 계정으로 기록됩니다.`);
    tick().catch(() => {});     // 로그인하자마자 밀린 것을 처리한다
  } catch (e) {
    log(`${loginId} SM 로그인 실패: ${e.message}`);
  }
}

/**
 * 이 아이디·비밀번호가 SM 계정으로 실제 로그인되는지만 확인한다. 세션은 저장하지 않는다.
 * 관리자 가입 신청이 "SM 계정과 같은 자격증명"인지 걸러내는 데 쓴다.
 * 반환: { ok } 일치 / { ok:false, unavailable:true } SM에 닿지 못해 판단 불가 / { ok:false } 불일치.
 */
export async function verifySmCredentials(loginId, password) {
  if (!ENABLED) return { ok: false, unavailable: true };
  try {
    const res = await fetch(`${SM}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Host: "scenario-manager" },
      body: new URLSearchParams({ username: loginId, password }).toString(),
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    const cookie = (res.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
    if (cookie) return { ok: true };
    // 5xx는 비밀번호가 틀린 게 아니라 SM이 아픈 것이다.
    return res.status >= 500 ? { ok: false, unavailable: true } : { ok: false };
  } catch (e) {
    log(`가입 신청 SM 확인 실패: ${e.message}`);
    return { ok: false, unavailable: true };
  }
}

/** 가장 최근에 로그인한 관리자의 세션을 쓴다. */
function currentSession() {
  let best = null;
  for (const [loginId, s] of sessions) if (!best || s.at > best.s.at) best = { loginId, s };
  return best;
}

/** 지금 쓸 수 있는 SM 세션이 있는지. 오브젝트 등록 화면이 "지금 등록 가능한가"를 판단할 때 쓴다. */
export function hasSession() {
  return !!currentSession();
}

/** 세션을 확보한 관리자의 로그인 ID. SM에 "누가 했는지"로 남길 때 참고한다. */
export function sessionAccount() {
  return currentSession()?.loginId || null;
}

/**
 * 로그인한 관리자 세션으로 SM에 요청한다. 오브젝트 등록(smObjectsSession.js)도 이 창구를 쓴다 —
 * SM에는 사람 화면용 경로밖에 없는 기능이 있고, 그건 이 쿠키로만 닿는다.
 *
 * 요청마다 기다리는 시간은 기본 20초다. 오브젝트 등록처럼 SM이 느리게 응답하는 호출은
 * `timeoutMs`로 늘려 부른다(이미 SM에 만들어진 뒤 시간이 초과되면 되돌릴 수 없기 때문이다).
 */
export async function smFetch(pathname, { timeoutMs = 20000, ...init } = {}) {
  const cur = currentSession();
  if (!cur) { const e = new Error("SM 세션 없음"); e.noSession = true; throw e; }
  const res = await fetch(`${SM}${pathname}`, {
    ...init,
    headers: { Cookie: cur.s.cookie, Accept: "application/json", Host: "scenario-manager", ...(init.headers || {}) },
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 302 || res.status === 401) {
    sessions.delete(cur.loginId);           // 만료된 세션은 버린다
    // 전용 계정이 있으면 그 자리에서 다시 로그인하고 같은 요청을 한 번 더 보낸다.
    // 만료는 예고 없이 오므로, 이걸 안 하면 한 회차가 통째로 버려진다.
    if (await loginAsService({ force: true })) {
      const again = currentSession();
      if (again) {
        return fetch(`${SM}${pathname}`, {
          ...init,
          headers: { Cookie: again.s.cookie, Accept: "application/json", Host: "scenario-manager", ...(init.headers || {}) },
          redirect: "manual",
          signal: AbortSignal.timeout(timeoutMs),
        });
      }
    }
    const e = new Error("SM 세션 만료");
    e.noSession = true;
    throw e;
  }
  return res;
}

// ── 양쪽 장부 읽기 ──────────────────────────────────────────

/** 내부 작업은 HTTP 관리자 API를 호출하지 않는다. 인증·페이지 제한과 무관하게 장부 전체를 읽는다. */
export function readWmsSyncState() {
  const objects = all("SELECT id, name, stock, rented FROM scenario_items ORDER BY id")
    .map((it) => ({ id: String(it.id || "").trim(), name: it.name || "", stock: Number(it.stock) || 0, rented: Number(it.rented) || 0 }))
    .filter((it) => it.id);
  const itemIds = new Set(objects.map((o) => o.id));
  const byItem = new Map();
  for (const table of ["sid_rentals", "general_rentals"]) {
    // 종류 미확정은 아직 재고를 차감하지 않았다. 파손 확인 대기는 관리자가 확정할 때까지
    // rented에 남으므로 SM에서도 가용 재고로 풀지 않는다.
    const rows = all(`SELECT * FROM ${table} WHERE (returned != 'O' OR returned IS NULL OR status = 'damage_pending') AND COALESCE(variant_pending, '') != 'Y'`);
    for (const row of rows) {
      const parsed = table === "sid_rentals" ? parseItemLabel(row.item_label) : { id: row.item_id, quantity: row.qty || 1 };
      const id = padSlot(parsed.id);
      if (!itemIds.has(id)) continue; // 공구·테이블보·물품 없는 SID 줄은 시나리오 재고에 포함하지 않는다.
      const employeeId = employeeIdForRentalRow(row);
      const name = String(registeredUser(employeeId)?.name || row.borrower_name || "").trim() || "이름 없음";
      const key = employeeId || (String(row.email || "").match(/^(\d+)@/) || [])[1] || name;
      if (!byItem.has(id)) byItem.set(id, new Map());
      const people = byItem.get(id);
      const person = people.get(key) || { name, qty: 0 };
      person.qty += Number(parsed.quantity) || 1;
      people.set(key, person);
    }
  }
  const snapshot = {};
  for (const o of objects) {
    const people = [...(byItem.get(o.id)?.entries() || [])]
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      .map(([key, value]) => `${key}:${value.qty}`).join(",");
    snapshot[o.id] = `${o.stock}|${o.rented}|${people}`;
  }
  return { objects, borrows: byItem, snapshot };
}

/** 진짜 재고는 _inventory 안에 있다. 최상위 quantity는 수량 미등록일 때 -1이라 쓰면 안 된다. */
/**
 * SM 오브젝트 목록. 한 종만 바뀌어도 3천여 개를 받아야 해서 가볍지 않다.
 *
 * SM에는 번호 하나로 재고를 조회하는 길이 없다(검색·활성도 조회는 재고를 주지 않는다).
 * 그래서 받아둔 것을 얼마간 재사용한다. 대신 우리가 SM에 쓴 값은 그 자리에서 목록에도
 * 반영한다 — 그러지 않으면 다음 회차에 옛 값과 견줘 같은 대여를 두 번 보내게 된다.
 */
let objCache = { at: 0, map: null };
const OBJ_CACHE_MS = Number(process.env.SM_OBJECT_CACHE_MS || 600000); // 10분
// 받아 둔 목록에 없는 번호(방금 등록한 물품)가 있으면 목록을 새로 받는다. 단, 받은 지 이 시간이 안 됐으면 건너뛴다.
const MISSING_REFRESH_MS = Number(process.env.SM_MISSING_REFRESH_MS ?? 20000);
// 동기화가 SM에 쓸 때(수량·대여) / 목록을 받을 때 한 번에 기다리는 시간.
const SM_WRITE_TIMEOUT_MS = Number(process.env.SM_SYNC_WRITE_TIMEOUT_MS ?? 30000);
const SM_LIST_TIMEOUT_MS = Number(process.env.SM_SYNC_LIST_TIMEOUT_MS ?? 60000);
// 쓰기가 이만큼 연달아 응답이 없으면 SM이 멎은 것이므로 이번 회차를 접는다(물품마다 기다리며 몇 분을 쓰지 않도록).
const MAX_CONSECUTIVE_WRITE_TIMEOUTS = 3;
let consecutiveWriteTimeouts = 0;
// SM이 멎었다고 판단해 회차를 접은 뒤 이 시각까지는 새 회차를 시작하지 않는다. 쉬지 않고 다시 돌면 3천여 개
// 목록을 매번 새로 받느라 이미 힘든 SM에 부담만 더한다. 관리자가 직접 누른 동기화(manual)는 쉬지 않는다.
let cooldownUntil = 0;
/** 테스트용: 쉬는 시간을 지운다. */
export function resetSmCooldown() { cooldownUntil = 0; }

async function smObjectMap() {
  if (objCache.map && Date.now() - objCache.at < OBJ_CACHE_MS) return objCache.map;
  const map = await loadSmObjects();
  objCache = { at: Date.now(), map };
  log(`오브젝트 목록 ${map.size}종을 받았습니다.`);
  return map;
}

async function loadSmObjects() {
  const map = new Map();
  for (let p = 1; p <= 200; p++) {
    const res = await smFetch(`/api/objects?page=${p}`, { timeoutMs: SM_LIST_TIMEOUT_MS });
    if (!res.ok) throw new Error(`SM 목록 조회 실패 (HTTP ${res.status})`);
    const d = await res.json();
    if (d?.success === false || d?.ok === false) throw new Error(d.error || d.message || "SM 목록 조회 실패");
    const rows = Array.isArray(d) ? d : d.objects || d.items || d.data;
    if (!Array.isArray(rows)) throw new Error("SM 물품 목록 응답 형식이 올바르지 않습니다.");
    if (!rows.length) break;
    for (const r of rows) {
      const id = padSlot(r.id ?? "");
      if (id) map.set(id, r);
    }
    if (d.has_next === false || d.has_more === false || (d.total_pages && p >= d.total_pages)) break;
  }
  return map;
}

// ── 맞추기 ─────────────────────────────────────────────────

const inv = (r) => r?._inventory || {};
const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));

async function postJson(pathname, body) {
  // 쓰기 하나가 응답하지 않아도 그 물품만 실패로 돌리고 나머지는 이어간다. 예전에는 예외가 회차 전체를
  // 중단시켜서, 물품 하나가 SM에서 멈추면 다른 물품의 수량·대여 반영까지 계속 막혔다.
  // (시간이 초과돼도 SM에는 반영됐을 수 있으므로, 실패한 물품이 있으면 다음 회차는 SM 목록을 새로 받아 대조한다.)
  let res;
  try {
    res = await smFetch(pathname, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      timeoutMs: SM_WRITE_TIMEOUT_MS,
    });
  } catch (e) {
    if (e.noSession) throw e;
    const timedOut = e?.name === "TimeoutError" || /timeout|aborted/i.test(String(e?.message || ""));
    if (timedOut && ++consecutiveWriteTimeouts >= MAX_CONSECUTIVE_WRITE_TIMEOUTS) {
      consecutiveWriteTimeouts = 0;
      const err = new Error(`SM이 쓰기에 ${MAX_CONSECUTIVE_WRITE_TIMEOUTS}번 연속 응답하지 않아 이번 회차를 멈춥니다.`);
      err.smUnresponsive = true;
      throw err;
    }
    return { ok: false, status: 0, reason: timedOut ? `SM이 ${SM_WRITE_TIMEOUT_MS / 1000}초 안에 응답하지 않았습니다.` : e.message };
  }
  consecutiveWriteTimeouts = 0;
  let data;
  try { data = await res.json(); } catch { return { ok: false, status: res.status, reason: "SM 응답이 JSON이 아닙니다." }; }
  // SM이 error를 객체로 줄 때가 있다. 그대로 문자열로 만들면 "[object Object]"만 남아 원인을 알 수 없다.
  const detail = data?.error || data?.message || "";
  return { ok: res.ok && data?.success !== false && data?.ok !== false && !data?.error, status: res.status,
    reason: typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 300) };
}

/**
 * SM 수량 API는 총 보유 수량이 아니라 가용(선반) 수량을 설정한다.
 * 반납 → 추가 대여 직전 가용 수량 → 대여 순서로 맞춰야 대여 중 수량이 이중 가산되지 않는다.
 * 이미 맞는 건은 아무것도 보내지 않으므로 몇 번을 돌려도 결과가 같다.
 */
async function reconcile(ids, state, { refresh = false, onProgress } = {}) {
  const only = new Set(ids);
  const { objects: wms, borrows } = state;
  // 검색 API는 _inventory가 빠질 때가 있어 수량 대조에 쓰지 않는다.
  if (refresh) objCache = { at: 0, map: null };
  let sm = await smObjectMap();
  const today = new Date().toISOString().slice(0, 10);
  const out = { quantity: 0, borrow: 0, failed: 0, failedIds: [], missing: 0, untracked: 0 };
  const failedIds = new Set();

  const targets = wms.filter((w) => only.has(w.id));
  // 방금 SM에 등록한 물품은 받아 둔 목록(최대 10분 전)에 아직 없다. 그대로 "SM에 없음"으로 넘기면
  // 처리한 것으로 기록돼 수량이 다음 전체 대조(30분)까지 -1로 남는다. 모르는 번호가 있으면 한 번 새로 받는다.
  if (targets.some((w) => !sm.has(w.id)) && Date.now() - objCache.at >= MISSING_REFRESH_MS) {
    objCache = { at: 0, map: null };
    sm = await smObjectMap();
  }
  for (let index = 0; index < targets.length; index++) {
    const w = targets[index];
    if (onProgress) onProgress({ id: w.id, name: w.name || "", processed: index, total: targets.length });
    const s = sm.get(w.id);
    if (!s) { out.missing++; continue; }                // SM에 없는 물품은 건드리지 않는다
    // 수량이 한 번도 등록되지 않은 오브젝트(is_tracked=false, quantity=-1)다. 예전에는 건너뛰었는데,
    // 그러면 -1이 영영 남고 대여/반납도 SM에 닿지 않는다. 아래에서 WMS 수량으로 처음 등록한다.
    const untracked = inv(s).is_tracked !== true;

    const want = borrows.get(w.id) || new Map();
    // 목록에 그대로 이어진 객체를 잡는다 — 사본을 고치면 갱신이 캐시에 남지 않는다.
    if (!s._inventory) s._inventory = {};
    if (!s._inventory.borrowers) s._inventory.borrowers = {};
    const have = s._inventory.borrowers;
    if (!untracked && !Number.isFinite(num(inv(s).available))) throw new Error(`SM ${w.id} 가용 재고 정보가 없습니다.`);
    const diffs = [...new Set([...Object.keys(have), ...want.keys()])].map((key) => ({
      key, delta: (want.get(key)?.qty || 0) - (Number(have[key]) || 0),
    })).filter((d) => d.delta);
    const sendEvent = async ({ key, delta }) => {
      const who = want.get(key)?.name || key;
      const action = delta > 0 ? "borrow" : "return";
      const note = `WMS 동기화 ${today} · 실제 대여자 ${who}${key !== who ? `(${key})` : ""}`;
      const r = await postJson("/object_inventory_event", { oid: w.id, action, quantity: Math.abs(delta), borrower: key, note });
      if (r.ok) {
        out.borrow++;
        // 방금 보낸 만큼을 목록에도 반영한다. 다음 회차가 옛 값을 읽고 같은 대여를
        // 또 보내지 않도록 하는 것이다.
        const want2 = want.get(key)?.qty || 0;
        if (want2 > 0) have[key] = want2; else delete have[key];
        s._inventory.available -= delta;
        s.quantity = s._inventory.available;
        s._inventory.borrowed = Object.values(have).reduce((sum, qty) => sum + (Number(qty) || 0), 0);
        s._inventory.total = s._inventory.available + s._inventory.borrowed;
      } else { out.failed++; failedIds.add(w.id); log(`  ✗ ${w.id} ${who} ${action} HTTP ${r.status} ${r.reason}`); }
    };
    const toBorrow = diffs.filter((d) => d.delta > 0);
    const beforeBorrow = w.stock + toBorrow.reduce((sum, d) => sum + d.delta, 0);
    // 등록할 수량이 0이면 등록할 것이 없다. 0을 보내 추적을 켜는 동작은 확인된 적이 없어 건드리지 않는다.
    if (untracked && beforeBorrow <= 0) { out.untracked++; continue; }

    // 먼저 이전 대여자를 반납 처리해 가용 재고를 확보한다. (미등록 물품은 이전 대여자가 없다.)
    if (!untracked) {
      for (const diff of diffs.filter((d) => d.delta < 0)) await sendEvent(diff);
      if (failedIds.has(w.id)) continue;
    }

    if (untracked || num(inv(s).available) !== beforeBorrow) {
      const people = [...want.values()].map((b) => `${b.name} ${b.qty}`).join(", ");
      const note = [`WMS 동기화 ${today}`, `선반 ${w.stock} + 대여 ${w.rented}`, `대여 반영 전 가용 ${beforeBorrow}`]
        .concat(people ? [`대여자: ${people}`] : []).join(" · ").slice(0, 300);
      const r = await postJson("/object_inventory_quantity", { oid: w.id, quantity: beforeBorrow, note });
      if (r.ok) {
        out.quantity++; s.quantity = beforeBorrow; s._inventory.available = beforeBorrow;
        s._inventory.total = beforeBorrow + (Number(s._inventory.borrowed) || 0);
        if (untracked) s._inventory.is_tracked = true;   // 목록 캐시도 등록된 것으로 맞춘다
      } else { out.failed++; failedIds.add(w.id); log(`  ✗ ${w.id} 수량 HTTP ${r.status} ${r.reason}`); continue; }
    }
    for (const diff of toBorrow) await sendEvent(diff);
  }
  out.failedIds = [...failedIds];
  return out;
}

// ── 변화 감시 ──────────────────────────────────────────────

// 기준 상태는 DB에 둔다 — 서버를 재시작해도 그 사이의 변화를 놓치지 않는다.
const loadBaseline = () => {
  try { return JSON.parse(get("SELECT value FROM settings WHERE key = 'sm_sync_baseline'")?.value || "null"); }
  catch { return null; }
};
const saveBaseline = (m) =>
  run("INSERT INTO settings (key, value) VALUES ('sm_sync_baseline', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify(m)]);

let rerunRequested = false;
export async function tick({ changedOnly = false, manual = false, forceFull = false, onProgress } = {}) {
  if (!ENABLED) return { ok: false, reason: "SM 동기화가 꺼져 있습니다." };
  // 이미 도는 중이면 그냥 버리지 않고, 끝난 뒤에 한 번 더 돌도록 표시해 둔다.
  if (running) { rerunRequested = true; return { ok: false, running: true, reason: "이미 SM 동기화가 진행 중입니다." }; }
  if (!manual && Date.now() < cooldownUntil) {
    return { ok: false, reason: `SM이 응답하지 않아 ${Math.ceil((cooldownUntil - Date.now()) / 1000)}초 뒤에 다시 시도합니다.` };
  }
  running = true;
  try {
    const state = readWmsSyncState();
    const now = state.snapshot;
    const saved = loadBaseline();
    const prev = saved || {};
    const changed = Object.keys(now).filter((id) => now[id] !== prev[id]);
    const fullReconcile = forceFull || !saved || (!changedOnly && (
      !lastFullReconcileAt || Date.now() - lastFullReconcileAt >= FULL_RECONCILE_SEC * 1000
    ));
    const targets = fullReconcile ? Object.keys(now) : changed;
    if (!targets.length) {
      if (manual) lastRun = { at: new Date().toISOString(), changed: 0, quantity: 0, borrow: 0, failed: 0, manual: true };
      return { ...(lastRun || {}), ok: true, reason: "", changed: 0, quantity: 0, borrow: 0, failed: 0, failedIds: [] };
    }

    if (!currentSession()) {
      // 전용 계정이 설정돼 있으면 스스로 로그인한다. 없으면 예전처럼 사람 로그인을 기다린다.
      await loginAsService({ force: manual });
      if (!currentSession()) {
        // 기준을 갱신하지 않는다 → 로그인되면 이 변화들이 그대로 처리된다.
        log(`${fullReconcile ? "전체 대조" : `변화 ${changed.length}종`} — SM 세션이 없어 미뤄둡니다.`);
        return { ok: false, reason: "SM 세션이 없어 변경사항 적용을 미뤘습니다." };
      }
    }

    if (fullReconcile) log(`전체 대조 ${targets.length}종${changed.length ? ` · 감지된 변화 ${changed.length}종` : ""}`);
    else log(`변화 ${changed.length}종: ${changed.slice(0, 8).join(", ")}${changed.length > 8 ? " …" : ""}`);
    // 전체 대조 때는 외부 SM 변경도 확인하므로 이전 캐시를 재사용하지 않는다.
    if (fullReconcile) objCache = { at: 0, map: null };
    const r = await reconcile(targets, state, { refresh: manual, onProgress });
    log(`  → 수량 ${r.quantity}건 · 대여 ${r.borrow}건${r.failed ? ` · 실패 ${r.failed}건` : ""}`);
    // 회차 시작 시점의 상태만 기준으로 저장한다. 처리 도중 반납/추가 대여가 들어왔을 때
    // 마지막 snapshot으로 덮어쓰면 아직 SM에 보내지 않은 변화가 사라질 수 있다.
    for (const id of r.failedIds) delete now[id]; // 실패는 다음 변경분 회차에서도 반드시 다시 처리한다.
    saveBaseline(now);
    if (r.failed) objCache = { at: 0, map: null };
    if (fullReconcile) lastFullReconcileAt = Date.now();
    lastRun = { at: new Date().toISOString(), changed: changed.length, ...r, manual,
      reason: r.failed ? `SM 수량·대여/반납 ${r.failed}건 반영에 실패했습니다. 실패한 물품은 다음 회차에 재시도합니다.` : "" };
    return { ok: r.failed === 0, ...lastRun };
  } catch (e) {
    // 타임아웃은 SM에서 반영됐으나 응답만 유실됐을 수도 있다. 재조회 후 차이만 보낸다.
    objCache = { at: 0, map: null };
    lastRun = { at: new Date().toISOString(), ok: false, reason: e.message || "SM 동기화 중 오류가 발생했습니다.", manual };
    if (e.smUnresponsive) cooldownUntil = Date.now() + Number(process.env.SM_SYNC_COOLDOWN_MS ?? 120000);
    if (e.noSession) log("SM 세션이 없거나 만료됐습니다. 관리자가 WMS에 로그인하면 이어집니다.");
    else log(`오류: ${e.message}`);
    return { ok: false, reason: e.message || "SM 동기화 중 오류가 발생했습니다." };
  } finally {
    running = false;
    if (rerunRequested) {
      rerunRequested = false;
      setTimeout(() => tick().catch(() => {}), 1000);
    }
  }
}

/** 관리자가 누르는 즉시 동기화. DB에 저장된 마지막 기준 이후 바뀐 재고·대여만 적용한다. */
export async function syncChangesNow({ onProgress } = {}) {
  if (nudgeTimer) { clearTimeout(nudgeTimer); nudgeTimer = null; }
  // 서버 시작 직후의 전체 대조와 겹치면 예전에는 "이미 진행 중"만 돌려주고 버튼 작업이
  // 사라졌다. 기존 회차가 끝날 때까지 기다린 뒤 사용자가 요청한 변경분 회차를 반드시 실행한다.
  const waitUntil = Date.now() + 180000;
  while (running && Date.now() < waitUntil) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (running) return { ok: false, running: true, reason: "기존 SM 동기화가 오래 걸리고 있습니다. 잠시 후 다시 시도해 주세요." };
  if (!currentSession()) {
    await loginAsService({ force: true });
    if (!currentSession()) return { ok: false, reason: "Scenario Manager에 연결할 수 없습니다." };
  }
  return tick({ changedOnly: true, manual: true, onProgress });
}

/** 관리자가 명시적으로 요청한 전체 대조. 기준값이나 정기 대조 시각과 관계없이 모든
 * 오브젝트의 가용 재고와 현재 대여자를 SM 장부에 다시 맞춘다. */
export async function syncAllNow({ onProgress } = {}) {
  if (nudgeTimer) { clearTimeout(nudgeTimer); nudgeTimer = null; }
  const waitUntil = Date.now() + 180000;
  while (running && Date.now() < waitUntil) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (running) return { ok: false, running: true, reason: "기존 SM 동기화가 오래 걸리고 있습니다. 잠시 후 다시 시도해 주세요." };
  if (!currentSession()) {
    await loginAsService({ force: true });
    if (!currentSession()) return { ok: false, reason: "Scenario Manager에 연결할 수 없습니다." };
  }
  return tick({ manual: true, forceFull: true, onProgress });
}

/**
 * 재고를 바꾼 직후에 부른다. 다음 정기 회차(기본 20초)를 기다리지 않고 곧바로 맞춘다.
 *
 * 바로 부르지 않고 잠깐 모으는 이유: 한 번의 작업이 여러 번의 저장으로 나뉘는 경우가 있다
 * (종류별 재고를 고치면 물품 총재고까지 다시 쓴다). 그때마다 SM 목록을 새로 받으면
 * 같은 일을 여러 번 하게 된다. 짧게 묶어 한 번만 돌린다.
 */
// 한 회차가 SM 오브젝트 3천여 개를 훑기 때문에 가볍지 않다. 대여 몇 건이 연달아 들어오면
// 그만큼 반복되어 서버가 계속 SM에 매달린다. 그래서 잠깐 모았다가 한 번만 돈다.
// 이미 도는 중이면 끝난 뒤에 한 번 더 돌도록 예약해 둔다 — 그 사이의 변화를 놓치지 않는다.
let nudgeTimer = null;
export function nudge() {
  if (!ENABLED) return;
  if (nudgeTimer) return;
  nudgeTimer = setTimeout(() => {
    nudgeTimer = null;
    tick().catch(() => {});
  }, Number(process.env.SM_SYNC_NUDGE_MS || 15000));
}

/** 관리 화면에서 상태를 확인할 때 쓴다. 쿠키 같은 건 내보내지 않는다. */
export function status() {
  const cur = currentSession();
  return {
    enabled: ENABLED,
    serviceAccount: !!serviceCredentials(),
    target: SM,
    intervalSec: INTERVAL_SEC,
    fullReconcileSec: FULL_RECONCILE_SEC,
    sessions: [...sessions.keys()],
    activeAccount: cur?.loginId || null,
    running,
    lastRun,
  };
}

export function startSmSync() {
  if (!ENABLED) { log("꺼져 있습니다 (SM_SYNC=off)"); return; }
  const hasService = !!serviceCredentials();
  log(`시작 · 대상 ${SM} · ${INTERVAL_SEC}초 간격 · ${hasService ? "전용 계정으로 스스로 로그인합니다" : "관리자가 WMS에 로그인하면 그 계정으로 처리합니다"}`);
  if (hasService) loginAsService({ force: true }).catch(() => {});
  setTimeout(() => tick().catch(() => {}), 5000);
  setInterval(() => tick().catch(() => {}), INTERVAL_SEC * 1000);
}
