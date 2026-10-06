/**
 * Scenario Manager(SM)에 오브젝트를 새로 등록한다.
 *
 * 왜 SM이 먼저인가:
 *   오브젝트 번호(ID)는 SM이 부여한다. WMS가 임의로 번호를 지어내면 SM의 2800여 종과
 *   부딪히고, 나중에 진짜 번호로 바꾸려면 대여 기록까지 전부 따라가야 한다.
 *   그래서 SM에 먼저 만들어 번호를 받고, 그 번호로 WMS 행을 넣는다.
 *
 * 왜 재고 동기화(smSync.js)와 다른 창구를 쓰는가:
 *   재고 동기화는 화면용 엔드포인트(/object_inventory_*)를 관리자 로그인 세션으로 부른다.
 *   등록은 그 세션 쪽에 JSON으로 번호를 돌려주는 경로가 없다(/save_object는 번호를
 *   이미 알고 있다고 전제하고, 번호를 배정하는 /new_object/... 는 HTML만 준다).
 *   SM에는 외부 시스템용 창구가 따로 있고(/api/internal/v1/cos/...), 이쪽은 201과 함께
 *   오브젝트 전체를 JSON으로 돌려준다. 등록은 되돌리기 어려운 작업이라 중복 방지 키까지
 *   갖춘 이쪽을 쓴다.
 *
 * 이 창구는 사람 세션이 아니라 서비스 토큰으로 인증한다(SM_COS_TOKEN).
 * 토큰이 없으면 이 모듈은 통째로 꺼진 것처럼 동작하고, 등록은 지금까지처럼
 * 관리자가 번호를 직접 적는 방식으로 남는다.
 */
import crypto from "node:crypto";

const SM = process.env.SM_URL || "http://100.92.161.29";
const TOKEN = process.env.SM_COS_TOKEN || "";
// 어느 계정 이름으로 SM에 기록될지. 관리자별로 다르게 남기고 싶으면 호출부에서 actorId를 넘긴다.
const ACTOR_ID = process.env.SM_COS_ACTOR || "wms";
const ACTOR_ROLE = process.env.SM_COS_ROLE || "cos_admin";
const COUNTRY = process.env.SM_COS_COUNTRY || "KR";
const REGIONS = (process.env.SM_COS_REGIONS || "KR").split(",").map((s) => s.trim()).filter(Boolean);
// SM은 sector가 필수다. WMS 물품에 구역이 비어 있을 때 쓸 기본값.
const DEFAULT_SECTOR = process.env.SM_COS_SECTOR || "warehouse";

const BASE = "/api/internal/v1/cos";
const log = (msg) => console.log(`[sm-objects] ${msg}`);

export const enabled = () => !!TOKEN;

/** 토큰이 없으면 왜 못 하는지 화면에 그대로 보여줄 수 있게 문장으로 돌려준다. */
export function disabledReason() {
  if (!TOKEN) return "SM 연동 토큰(SM_COS_TOKEN)이 설정되지 않았습니다. ID를 직접 입력해 주세요.";
  return "";
}

function actorContext(actorId) {
  return {
    actor_id: String(actorId || ACTOR_ID).slice(0, 100) || "wms",
    country_code: COUNTRY,
    role: ACTOR_ROLE,
    scope_regions: REGIONS.length ? REGIONS : ["KR"],
  };
}

async function call(method, pathname, body, extraHeaders = {}) {
  const requestId = crypto.randomUUID();
  const res = await fetch(`${SM}${BASE}${pathname}`, {
    method,
    headers: {
      Host: "scenario-manager",
      Authorization: TOKEN.startsWith("Bearer ") ? TOKEN : `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Request-ID": requestId,
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* SM이 HTML을 돌려준 경우 */ }
  if (!res.ok) {
    // SM은 실패를 {error:{code,message}} 봉투로 돌려준다. 그 문장을 그대로 관리자에게 보인다.
    const detail = data?.error?.message || data?.detail || text.slice(0, 200) || `HTTP ${res.status}`;
    const err = new Error(detail);
    err.status = res.status;
    err.code = data?.error?.code || "";
    err.requestId = requestId;
    throw err;
  }
  return data;
}

const clip = (v, n) => String(v ?? "").slice(0, n);
const smUploadName = (name) => {
  const original = String(name ?? "").trim();
  const cleaned = original
    .replace(/\s*[\(\[\{（［｛][^()\[\]{}（）［］｛｝]*[\)\]\}）］｝]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || original;
};

/**
 * WMS 등록 폼의 값을 SM의 ObjectCreate 모양으로 옮긴다.
 * SM에 없는 개념(실측 치수 등)은 보내지 않는다 — 그건 WMS 쪽에만 남는다.
 */
function toObjectCreate(item) {
  return {
    name: clip(smUploadName(item.name), 300),
    country_code: COUNTRY,
    sector: clip(item.sector, 160) || DEFAULT_SECTOR,
    location: clip(item.rootSlot, 300),
    root_slot: clip(item.rootSlot, 6) || null,
    quantity: Math.max(0, Math.trunc(Number(item.stock) || 0)),
    category: clip(item.category, 100),
    subcategory: clip(item.subcategory, 100),
    product_link: clip(item.purchaseLink, 2000),
    fragile: !!item.fragile,
    fire_risk: !!item.fireRisk,
    request_for: clip(item.requestFor, 200),
    personal_owner: clip(item.personalOwner, 200),
    exclude_from_ranking: !!item.excludeFromRanking,
  };
}

/**
 * SM에 오브젝트를 만들고 부여받은 ID를 돌려준다.
 *
 * `idempotencyKey`는 같은 등록 시도가 두 번 닿아도 오브젝트가 둘 생기지 않게 한다.
 * 화면에서 저장 버튼이 두 번 눌리거나 응답만 유실되는 경우를 위한 것이다.
 * SM 오브젝트는 지울 수 없고 폐기(retire)만 되므로, 이 중복 방지가 특히 중요하다.
 */
export async function createObject(item, { actorId, idempotencyKey } = {}) {
  if (!TOKEN) throw new Error(disabledReason());
  const key = idempotencyKey || crypto.randomUUID();
  const created = await call("POST", "/objects", { actor: actorContext(actorId), object: toObjectCreate(item) }, { "Idempotency-Key": key });
  const id = String(created?.id ?? "").trim();
  if (!id) throw new Error("SM이 오브젝트 번호를 돌려주지 않았습니다.");
  log(`등록 완료 · ${id} · ${item.name || ""}`);
  return { id, object: created };
}

/**
 * 대표 사진을 올린다. 등록과 나눠 부르는 이유는 SM이 사진을 별도 엔드포인트로 받기 때문이다.
 * 사진 실패로 등록 전체를 되돌리지는 않는다 — 번호는 이미 났고, 사진은 나중에 다시 올리면 된다.
 */
export async function putImage(objectId, dataUrl, { actorId } = {}) {
  if (!TOKEN || !dataUrl) return false;
  try {
    await call("PUT", `/objects/${encodeURIComponent(objectId)}/image`, { actor: actorContext(actorId), data_url: dataUrl }, { "Idempotency-Key": crypto.randomUUID() });
    return true;
  } catch (e) {
    log(`${objectId} 사진 등록 실패: ${e.message}`);
    return false;
  }
}

/** 이름·구매 링크 등 SM과 겹치는 속성을 나중에 고칠 때. */
export async function updateObject(objectId, changes, { actorId } = {}) {
  if (!TOKEN) return { ok: false, reason: disabledReason() };
  try {
    await call("PATCH", `/objects/${encodeURIComponent(objectId)}`, { actor: actorContext(actorId), changes }, { "Idempotency-Key": crypto.randomUUID() });
    log(`${objectId} 속성 수정 · ${Object.keys(changes).join(", ")}`);
    return { ok: true, id: String(objectId), changed: Object.keys(changes) };
  } catch (e) {
    log(`${objectId} 속성 수정 실패: ${e.message}`);
    return { ok: false, reason: e.message };
  }
}

/** 연동 창구가 살아 있는지. 관리 화면의 상태 표시에 쓴다. */
export async function health() {
  if (!TOKEN) return { ok: false, reason: disabledReason() };
  try {
    await call("GET", "/health");
    return { ok: true, reason: "" };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}
