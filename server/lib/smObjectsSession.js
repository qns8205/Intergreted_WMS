/**
 * Scenario Manager(SM)에 오브젝트를 등록한다 — 관리자 로그인 세션을 쓰는 방식.
 *
 * 왜 이 방식인가:
 *   SM에는 외부 시스템용 창구(/api/internal/v1/cos/...)가 따로 있지만 서비스 토큰을 요구한다.
 *   토큰을 받기 전까지는, 사람이 화면에서 하는 것과 똑같은 요청을 서버가 대신 보낸다.
 *   서버는 이미 관리자 SM 세션 쿠키를 들고 있으므로(smSync.js) 브라우저를 띄울 필요가 없다.
 *
 * SM의 등록은 두 단계다:
 *   1) GET /new_object/{sector}/{loc_id} — 번호가 배정된 등록 화면(HTML)
 *   2) POST /save_object — 그 번호로 저장(multipart)
 *   번호를 JSON으로 주는 경로가 없어서 1)의 HTML에서 번호를 읽어내야 한다.
 *   화면이 바뀌면 여기가 먼저 깨진다 — 그래서 저장한 뒤 SM에 정말 그 번호로 생겼는지
 *   반드시 다시 확인하고, 확인되지 않으면 성공으로 치지 않는다.
 *
 * 중복 방지:
 *   토큰 창구와 달리 SM이 중복을 막아주지 않는다. SM 오브젝트는 삭제가 안 되고 폐기만 되므로,
 *   "등록 시도 하나"를 WMS에 기록해 두고 같은 시도가 다시 오면 이미 난 번호를 돌려준다.
 */
import { smFetch, hasSession, sessionAccount } from "./smSync.js";
import { setRootSlot, readSmObject } from "./smLocationSync.js";
import { get, run } from "../db.js";

const log = (msg) => console.log(`[sm-object-session] ${msg}`);

// SM 등록 화면이 요구하는 값들. WMS에는 대응하는 개념이 없어서 기본값을 쓴다.
const DEFAULT_TYPE = process.env.SM_OBJ_TYPE || "Obj";
const DEFAULT_SIZE = process.env.SM_OBJ_SIZE || "Medium";
const DEFAULT_PROPERTY = process.env.SM_OBJ_PROPERTY || "Hard";
const DEFAULT_SECTOR = process.env.SM_COS_SECTOR || "warehouse";
// 등록 모달이 고르는 건 구역(sector)이 아니라 지역(region)이다 — Hanoi / Seoul 둘 중 하나.
// WMS의 구역 값(Seoul-Root 등)을 sector로 보내면 SM이 막는다
// ("Object creation is not allowed in sector: Seoul-Root"). 사람이 화면에서 하는 것과 똑같이
// region만 보낸다.
const REGISTER_REGION = process.env.SM_OBJ_REGION || "Seoul";

const smUploadName = (name) => {
  const original = String(name ?? "").trim();
  const cleaned = original
    .replace(/\s*[\(\[\{（［｛][^()\[\]{}（）［］｛｝]*[\)\]\}）］｝]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || original;
};

// 위치는 여섯 자리 숫자만 받는다. 그 형태가 아니면 미지정 자리로 보낸다.
const UNKNOWN_SLOT = process.env.SM_UNKNOWN_SLOT || "300000";
export const normalizeSlot = (v) => (/^[0-9]{6}$/.test(String(v ?? "").trim()) ? String(v).trim() : UNKNOWN_SLOT);

export const enabled = () => hasSession();

export function disabledReason() {
  if (!hasSession()) {
    return "Scenario Manager 세션이 없습니다. 관리자 계정으로 WMS에 다시 로그인하면 연동이 살아납니다.";
  }
  return "";
}

// ── 등록 시도 기록 (중복 방지) ────────────────────────────────

function rememberAttempt(clientId, objectId) {
  if (!clientId) return;
  // 번호가 확정되면 "진행 중" 표시(pending)를 이 번호로 덮는다.
  run(
    `INSERT INTO sm_object_registrations (client_id, object_id, created_at) VALUES (?, ?, ?)
     ON CONFLICT(client_id) DO UPDATE SET object_id = excluded.object_id, created_at = excluded.created_at`,
    [clientId, objectId, new Date().toISOString()]
  );
}

function recallAttempt(clientId) {
  if (!clientId) return null;
  const v = get("SELECT object_id FROM sm_object_registrations WHERE client_id = ?", [clientId])?.object_id || "";
  return /^[0-9]+$/.test(v) ? v : null;
}

/**
 * SM에 만들기 직전에 "이 시도는 번호 N보다 큰 번호가 날 것"이라고 남겨 둔다.
 * SM에서 오브젝트가 만들어진 뒤 응답이 늦어 중간에 끊기면 번호를 모른 채 남는데, 같은 시도를
 * 다시 하면 SM에 하나 더 만들어 버린다(삭제가 안 되고 폐기만 된다). 이 표시가 있으면
 * 새로 만들지 않고 이미 생긴 오브젝트를 찾아 이어받는다.
 */
function rememberPending(clientId, maxIdBefore) {
  if (!clientId) return;
  run(
    `INSERT INTO sm_object_registrations (client_id, object_id, created_at) VALUES (?, ?, ?)
     ON CONFLICT(client_id) DO UPDATE SET object_id = excluded.object_id, created_at = excluded.created_at
     WHERE sm_object_registrations.object_id LIKE 'pending:%'`,
    [clientId, `pending:${maxIdBefore}`, new Date().toISOString()]
  );
}

function recallPending(clientId) {
  if (!clientId) return null;
  const v = get("SELECT object_id FROM sm_object_registrations WHERE client_id = ?", [clientId])?.object_id || "";
  const m = /^pending:([0-9]+)$/.exec(v);
  return m ? Number(m[1]) : null;
}

const RETRY_DELAY_MS = Number(process.env.SM_REGISTER_RETRY_MS ?? 1500);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isTimeout = (e) => e?.name === "TimeoutError" || e?.name === "AbortError" || /timeout|aborted/i.test(String(e?.message || ""));
const maxIdOf = (rows) => rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);

// ── 번호 읽어내기 ─────────────────────────────────────────────

/**
 * 등록 화면 HTML에서 배정된 번호를 찾는다.
 *
 * 화면 구조를 직접 확인하지 못한 채 만든 부분이라, 한 가지 모양만 가정하지 않고
 * 그럴듯한 자리를 차례로 본다. 어떤 패턴으로 찾았는지 함께 돌려주므로,
 * probe()로 실제 화면에서 무엇이 맞는지 확인할 수 있다.
 */
export function extractAssignedId(html) {
  const tries = [
    // <input name="id" ... value="000123">
    { how: "input[name=id]의 value", re: /<input[^>]*\bname=["']id["'][^>]*\bvalue=["']([^"']+)["']/i },
    // <input value="000123" ... name="id">  (속성 순서가 반대인 경우)
    { how: "value가 먼저 온 input[name=id]", re: /<input[^>]*\bvalue=["']([^"']+)["'][^>]*\bname=["']id["']/i },
    // <input id="id" ... value="000123">
    { how: "input#id의 value", re: /<input[^>]*\bid=["']id["'][^>]*\bvalue=["']([^"']+)["']/i },
    // 스크립트에 박아둔 값: const objectId = "000123" / "object_id": "000123"
    { how: "스크립트의 object_id", re: /["']?(?:object_?id|new_?object_?id|oid)["']?\s*[:=]\s*["']([0-9]{4,6})["']/i },
  ];
  for (const t of tries) {
    const m = html.match(t.re);
    if (m && m[1] && /^[0-9]{1,6}$/.test(m[1].trim())) return { id: m[1].trim(), how: t.how };
  }
  return { id: "", how: "" };
}

/** 화면에서 눈으로 확인할 수 있게, 번호처럼 보이는 값들을 주변 문맥과 함께 모아준다. */
function idCandidates(html) {
  const out = [];
  const re = /[0-9]{6}/g;
  let m;
  while ((m = re.exec(html)) && out.length < 12) {
    out.push({ value: m[0], around: html.slice(Math.max(0, m.index - 90), m.index + 40).replace(/\s+/g, " ") });
  }
  return out;
}

// ── SM 왕복 ───────────────────────────────────────────────────

const sectorOf = (item) => String(item.sector || "").trim() || DEFAULT_SECTOR;
const locOf = (item) => String(item.rootSlot || "").trim() || "0";

async function fetchNewObjectPage(item) {
  const path = `/new_object/${encodeURIComponent(sectorOf(item))}/${encodeURIComponent(locOf(item))}`;
  const res = await smFetch(path, { headers: { Accept: "text/html" } });
  const html = await res.text();
  if (!res.ok) throw new Error(`등록 화면을 열지 못했습니다 (HTTP ${res.status}).`);
  return { path, html };
}

/** data URL로 들어온 사진을 multipart에 실을 수 있는 형태로 바꾼다. */
function imageBlob(dataUrl) {
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(String(dataUrl || ""));
  if (!m) return null;
  const ext = (m[1].split("/")[1] || "png").replace(/[^a-z0-9]/gi, "");
  return { blob: new Blob([Buffer.from(m[2], "base64")], { type: m[1] }), filename: `object.${ext}` };
}

function saveObjectForm(id, item) {
  const fd = new FormData();
  const put = (k, v) => { if (v !== undefined && v !== null && v !== "") fd.append(k, String(v)); };
  put("id", id);
  put("sector", sectorOf(item));
  put("location", locOf(item));
  put("name", smUploadName(item.name));
  put("type", item.smType || DEFAULT_TYPE);
  put("size", item.smSize || DEFAULT_SIZE);
  put("property", item.fragile ? "Fragile" : (item.smProperty || DEFAULT_PROPERTY));
  put("root_slot", item.rootSlot || "");
  put("product_link", item.purchaseLink || "");
  put("quantity", Math.max(0, Math.trunc(Number(item.stock) || 0)));
  const img = imageBlob(item.image);
  if (img) fd.append("image", img.blob, img.filename);
  return fd;
}

/** 저장한 번호가 SM에 정말 있는지 확인한다. HTML에서 잘못 읽었을 가능성을 여기서 걸러낸다. */
async function existsInSm(objectId) {
  const want = String(objectId).trim();
  // 오브젝트 하나를 보는 화면이 있다. 목록 전체를 받는 것보다 훨씬 싸다.
  try {
    const res = await smFetch(`/object_detail/${encodeURIComponent(want)}`, { headers: { Accept: "text/html" } });
    if (res.status === 200) return true;
    if (res.status === 404) return false;
    // 그 밖의 응답은 화면이 바뀌었을 수 있으니 단정하지 않고 목록으로 다시 본다.
  } catch {
    // 응답이 없거나 늦은 경우에 3천여 개 목록을 통째로 훑으면 몇 분이 더 걸린다 — 확인 불가로 둔다.
    return null;
  }

  // /api/objects에는 "번호 하나만 조회"가 없다 — sid는 시나리오 번호용이라 오브젝트 번호로
  // 걸러지지 않는다. 목록을 훑되, 찾으면 그 자리에서 멈춘다.
  try {
    for (let p = 1; p <= 200; p++) {
      const res = await smFetch(`/api/objects?page=${p}`);
      if (!res.ok) return null;                     // 확인 불가 — 판단을 미룬다
      const d = await res.json();
      const rows = Array.isArray(d) ? d : d.objects || d.items || d.data || [];
      if (!rows.length) break;
      if (rows.some((r) => String(r.id ?? "").trim() === want)) return true;
    }
    return false;
  } catch {
    return null;
  }
}

/**
 * 등록 직전/직후의 목록 첫 페이지를 비교해, 새로 생긴 번호를 찾아낸다.
 *
 * SM은 등록 화면에서 번호를 미리 주지 않고 저장할 때 정한다. 그래서 "무엇이 새로 생겼는지"로
 * 알아내는 수밖에 없다. 전체 3천여 개를 두 번 훑으면 몇 분이 걸리므로 첫 페이지만 본다 —
 * 방금 만든 것이 가장 최근이라 첫 페이지에 있다.
 */
async function listFirstPage({ refresh = false, timeoutMs } = {}) {
  const res = await smFetch(`/api/objects?page=1&sort_by=id&sort_dir=desc${refresh ? "&_refresh=1" : ""}`, timeoutMs ? { timeoutMs } : {});
  if (!res.ok) throw new Error(`목록 조회 실패 (HTTP ${res.status})`);
  const d = await res.json();
  const rows = Array.isArray(d) ? d : d.objects || d.items || d.data || [];
  // 행을 통째로 들고 있는다 — 등록 직후 위치를 넣을 때 SM을 다시 부르지 않아도 된다.
  return rows.filter((r) => String(r.id ?? "").trim());
}

/**
 * 등록 뒤에 번호를 찾는 목록 조회. SM이 느린 날에는 이 조회 하나가 10~20초 걸려 기본 제한을 넘기는데,
 * 그때는 이미 SM에 오브젝트가 만들어진 뒤라 등록 전체를 버리면 위치·수량·WMS 저장이 모두 빠진다.
 * 그래서 오래 기다리고, 그래도 안 되면 몇 번 더 시도한다.
 */
async function listFirstPageSlow({ refresh = false } = {}) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return await listFirstPage({ refresh, timeoutMs: 45000 }); }
    catch (e) {
      last = e;
      log(`목록 조회 ${attempt}/3 실패: ${e.message}`);
      if (attempt < 3) await sleep(RETRY_DELAY_MS);
    }
  }
  throw last;
}

/**
 * 등록 요청 본문. 화면의 Register Object 모달이 보내는 것과 같은 항목만 싣는다 —
 * 지역, 이름, 크기, 속성, 구매 링크, 기타 메모, 사진. 위치와 수량은 여기에 없다.
 */
function tentativeForm(item) {
  const fd = new FormData();
  const put = (k, v) => { if (v !== undefined && v !== null && v !== "") fd.append(k, String(v)); };
  put("region", REGISTER_REGION);
  put("name", smUploadName(item.name));
  put("type", item.smType || DEFAULT_TYPE);
  put("size", item.smSize || DEFAULT_SIZE);
  // 파손주의로 표시한 물품은 SM에서도 Fragile로 둔다. 그 외에는 관리자가 고른 속성을 쓴다.
  put("property", item.smProperty || (item.fragile ? "Fragile" : DEFAULT_PROPERTY));
  put("product_link", item.purchaseLink || "");
  put("product_memo", item.productMemo || "");
  const img = imageBlob(item.image);
  if (img) fd.append("image", img.blob, img.filename);
  return fd;
}

/**
 * SM에 오브젝트를 만들고 부여받은 번호를 돌려준다.
 *
 * 흐름:
 *   1) 등록 직전 목록 첫 페이지를 기억해 둔다.
 *   2) /insert_tentative_object로 만든다 — 이름·유형·크기·속성·구역·구매 링크·사진만 보낸다.
 *      위치(root_slot)와 수량은 이 단계에서 넣지 않는다. 등록이 끝난 뒤 상세 쪽에서 넣는다.
 *   3) 목록을 다시 받아 새로 생긴 번호를 찾는다. 이름까지 맞는지 함께 본다.
 *   4) 상세 페이지가 실제로 열리는지 확인한다.
 *
 * 같은 clientId로 다시 부르면 SM을 건드리지 않고 먼저 난 번호를 그대로 돌려준다.
 */
export async function createObject(item, { idempotencyKey } = {}) {
  if (!hasSession()) throw new Error(disabledReason());

  const already = recallAttempt(idempotencyKey);
  if (already) {
    log(`같은 등록 시도가 다시 왔습니다 — 먼저 난 번호 ${already}를 그대로 씁니다.`);
    return { id: already, replayed: true };
  }

  const t0 = Date.now();
  const mark = (label, since) => `${label} ${((Date.now() - since) / 1000).toFixed(1)}s`;
  const timings = [];
  const wantNames = new Set([String(item.name || "").trim(), smUploadName(item.name)]);

  // 앞선 시도가 SM에 오브젝트를 만들고도 번호를 확인하지 못한 채 끊겼다면, 새로 만들지 않고
  // 그 오브젝트를 찾아 이어받는다. 찾는 데 실패하면 새로 만들 수도 없다(중복이 되돌려지지 않는다).
  const pendingMax = recallPending(idempotencyKey);
  if (pendingMax !== null) {
    let rows;
    try { rows = await listFirstPageSlow({ refresh: true }); }
    catch (e) {
      throw new Error("이전 등록 시도의 결과를 아직 확인하지 못했습니다. 잠시 후 다시 시도해 주세요 — 이미 만들어진 오브젝트는 중복으로 만들지 않습니다.");
    }
    const mine = rows
      .filter((r) => Number(r.id) > pendingMax && wantNames.has(String(r.name ?? "").trim()))
      .sort((a, b) => Number(b.id) - Number(a.id))[0];
    if (mine) {
      const id = String(mine.id).trim();
      rememberAttempt(idempotencyKey, id);
      log(`이전 시도가 만들어 둔 ${id}를 이어받습니다 · ${item.name || ""}`);
      return { id, replayed: true, how: "이전 시도 이어받기", row: mine };
    }
  }

  let t = Date.now();
  const before = await listFirstPage({ timeoutMs: 45000 });
  timings.push(mark("목록(전)", t));
  const knownIds = new Set(before.map((r) => String(r.id).trim()));
  rememberPending(idempotencyKey, pendingMax === null ? maxIdOf(before) : Math.min(pendingMax, maxIdOf(before)));

  t = Date.now();
  let res, text;
  try {
    res = await smFetch("/insert_tentative_object", { method: "POST", body: tentativeForm(item), timeoutMs: 90000 });
    text = await res.text();
  } catch (e) {
    if (isTimeout(e)) throw new Error("Scenario Manager의 응답이 늦어 등록 결과를 확인하지 못했습니다. 같은 창에서 다시 눌러 주세요 — 이미 만들어졌다면 중복 없이 이어서 처리합니다.");
    throw e;
  }
  timings.push(mark("등록", t));
  if (!res.ok) throw new Error(`Scenario Manager 등록 실패 (HTTP ${res.status}): ${text.slice(0, 200)}`);

  // 응답이 번호를 직접 주면 그대로 쓴다. 안 주면 목록을 비교해 찾는다.
  let id = "";
  try {
    const d = JSON.parse(text);
    id = String(d?.id ?? d?.object_id ?? d?.oid ?? "").trim();
  } catch { /* JSON이 아니면 아래에서 목록으로 찾는다 */ }

  let how = id ? "등록 응답" : "";
  let createdRow = null;
  {
    const wantName = String(item.name || "").trim();
    t = Date.now();
    let after;
    try { after = await listFirstPageSlow({ refresh: true }); }
    catch (e) {
      // SM에는 이미 만들어졌다. 번호만 확인하지 못했으므로, 같은 창에서 다시 누르면 이어받는다.
      throw new Error("Scenario Manager에는 등록됐지만 부여된 번호를 확인하지 못했습니다. 같은 창에서 다시 눌러 주세요 — 중복 없이 이어서 처리합니다.");
    }
    timings.push(mark("목록(후)", t));
    if (id) {
      createdRow = after.find((r) => String(r.id).trim() === id) || null;
    } else {
      const fresh = after.filter((r) => !knownIds.has(String(r.id).trim()));
      // 이름까지 맞는 것을 고른다 — 같은 순간에 다른 사람이 등록했을 수 있다.
      const byName = fresh.filter((r) => wantNames.has(String(r.name ?? "").trim()) || String(r.name ?? "").trim() === wantName);
      const pick = (byName.length ? byName : fresh).sort((a, b) => Number(b.id) - Number(a.id))[0];
      if (!pick) {
        throw new Error("등록은 됐지만 새 오브젝트 번호를 찾지 못했습니다. Scenario Manager 목록에서 직접 확인해 주세요.");
      }
      id = String(pick.id).trim();
      createdRow = pick;
      how = byName.length ? "목록 비교(이름 일치)" : "목록 비교";
      if (fresh.length > 1) log(`새로 생긴 오브젝트가 ${fresh.length}개입니다 — 이름이 맞는 ${id}를 골랐습니다.`);
    }
  }

  // 목록에서 그 번호의 행을 이미 봤다면 실제로 있는 것이다. 목록에서 못 봤을 때만 상세 화면으로 확인한다.
  if (!createdRow) {
    t = Date.now();
    const exists = await existsInSm(id);
    timings.push(mark("상세 확인", t));
    if (exists === false) {
      throw new Error(`등록은 됐지만 ${id}번 상세 페이지를 열지 못했습니다. Scenario Manager에서 직접 확인해 주세요.`);
    }
  }

  rememberAttempt(idempotencyKey, id);
  log(`등록 완료 · ${id} · ${item.name || ""} · 번호 출처: ${how} · 처리자 ${sessionAccount() || "?"} · ${timings.join(" / ")} / 합계 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { id, replayed: false, how, row: createdRow };
}

/**
 * 등록이 끝난 뒤 위치와 수량을 넣는다.
 *
 * 이 둘은 등록 단계에서 받지 않는 값이다(/insert_tentative_object에는 칸 자체가 없다).
 * 번호가 나야 넣을 수 있으므로 등록 다음에 따로 처리한다.
 *
 * 여기서 실패해도 등록 자체를 되돌리지 않는다 — 번호는 이미 났고, 위치와 수량은
 * 나중에 다시 맞출 수 있다. 무엇이 됐고 무엇이 안 됐는지만 정확히 돌려준다.
 */
export async function finalizeAfterCreate(objectId, item, { current = null } = {}) {
  const out = { rootSlot: null, quantity: null };

  // 위치는 여섯 자리 숫자만 유효하다. 그 형태가 아니면 미지정 자리(300000)로 넣는다 —
  // 비워두면 SM 목록에서 어디 있는지 알 수 없는 오브젝트가 된다.
  //
  // SM은 HTTP 200을 주고도 값을 무시하는 일이 있어(재고 API와 같다), 저장한 뒤 다시 읽어 확인한다.
  // 한 번 실패하면 SM의 현재 행을 새로 읽어 한 번 더 시도한다.
  const slot = normalizeSlot(item.rootSlot);
  let cur = current;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      // 사진을 함께 다시 올린다. 이 저장은 오브젝트 전체를 덮어쓰기 때문에, 사진을 빼면
      // 바로 앞 등록 단계에서 올라간 사진이 지워진다.
      const r = await setRootSlot(objectId, slot, { current: cur, imageDataUrl: item.image || "" });
      if (!r.ok) {
        out.rootSlot = { ok: false, reason: r.reason };
      } else {
        const after = await readSmObject(objectId).catch(() => null);
        const got = String(after?.root_slot ?? "").trim();
        if (after && got !== String(r.rootSlot)) {
          out.rootSlot = { ok: false, reason: `SM이 위치를 저장하지 않았습니다 (SM에 남은 값: ${got || "빈 값"})` };
        } else {
          out.rootSlot = { ok: true, value: slot };
          break;
        }
      }
    } catch (e) {
      out.rootSlot = { ok: false, reason: e.message };
    }
    if (attempt < 2) {
      await sleep(RETRY_DELAY_MS);
      cur = await readSmObject(objectId).catch(() => cur);
    }
  }

  // 수량은 위치를 저장한 뒤에 넣는다 — 위치 저장이 오브젝트 전체를 다시 쓰면서 수량을 되돌릴 수 있다.
  const qty = Math.max(0, Math.trunc(Number(item.stock) || 0));
  if (qty > 0) {
    const note = `WMS 등록 ${new Date().toISOString().slice(0, 10)} · 최초 수량 ${qty}`;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await smFetch("/object_inventory_quantity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ oid: objectId, quantity: qty, note }),
          timeoutMs: 30000,
        });
        // SM은 거절해도 HTTP 200으로 {success:false}를 돌려준다 — 본문까지 봐야 한다.
        let body = null;
        try { body = await res.json(); } catch { /* JSON이 아니면 HTTP 상태로 판단 */ }
        const rejected = !res.ok || body?.success === false || body?.ok === false || !!body?.error;
        if (!rejected) { out.quantity = { ok: true, value: qty }; break; }
        const why = body?.error || body?.message;
        out.quantity = { ok: false, reason: why ? (typeof why === "string" ? why : JSON.stringify(why).slice(0, 120)) : `HTTP ${res.status}` };
      } catch (e) {
        out.quantity = { ok: false, reason: e.message };
      }
      if (attempt < 2) await sleep(RETRY_DELAY_MS);
    }
  }

  const parts = [];
  if (out.rootSlot) parts.push(`위치 ${out.rootSlot.ok ? "ok" : "실패(" + out.rootSlot.reason + ")"}`);
  if (out.quantity) parts.push(`수량 ${out.quantity.ok ? "ok" : "실패(" + out.quantity.reason + ")"}`);
  if (parts.length) log(`${objectId} 후처리 · ${parts.join(" · ")}`);
  return out;
}

/**
 * 이미 있는 오브젝트의 구매 링크를 SM에도 반영하는 것은 이 방식에서 하지 않는다.
 *
 * 세션 창구에는 "이 항목만 고친다"는 경로가 없다 — 수정도 /save_object로 전체를 다시 저장한다.
 * 그러면 WMS가 모르는 값(SM에서만 채운 사진·치수·색상 등)이 빈 값으로 덮어써질 수 있다.
 * 링크 하나 맞추자고 되돌릴 수 없는 손실을 감수할 이유가 없어서, 등록할 때만 링크를 싣고
 * 그 뒤의 수정은 WMS 안에만 남긴다. 토큰 창구가 열리면 그쪽은 항목별 수정이 되므로
 * (PATCH /objects/{id}) 자동으로 다시 반영된다.
 */
export function updateProductLink(objectId) {
  log(`${objectId} 구매 링크는 WMS에만 반영했습니다 — 세션 방식으로는 SM의 다른 값을 덮어쓸 위험이 있어 보내지 않습니다.`);
  return false;
}

/**
 * 등록 화면을 열어 무엇이 보이는지 보고한다. 아무것도 쓰지 않는다.
 * 실제 SM 화면을 확인하지 못한 채 번호 읽기를 만들었으므로, 처음 한 번은 이걸로 맞춰본다.
 */
export async function probe(sector, locId) {
  if (!hasSession()) return { ok: false, reason: disabledReason() };
  const item = { sector, rootSlot: locId };
  try {
    const { path, html } = await fetchNewObjectPage(item);
    const { id, how } = extractAssignedId(html);
    return {
      ok: true,
      path,
      account: sessionAccount(),
      htmlLength: html.length,
      foundId: id,
      foundHow: how,
      // 못 찾았을 때 어디를 봐야 할지 알 수 있게, 번호처럼 보이는 값과 주변 문맥을 같이 준다.
      candidates: id ? [] : idCandidates(html),
      formFields: [...html.matchAll(/<(?:input|select|textarea)[^>]*\bname=["']([^"']+)["']/gi)].map((m) => m[1]).slice(0, 60),
      // 번호를 못 찾았을 때 화면 원본을 그대로 받아 확인하기 위한 것. 요청할 때만 실어 보낸다.
      ...(full ? { html } : {}),
    };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}
