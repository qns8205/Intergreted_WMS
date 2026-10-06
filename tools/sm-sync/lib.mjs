/**
 * WMS ↔ Scenario Manager 동기화의 공통 부분.
 *
 * SM은 사람 로그인 세션(쿠키)만 있으면 화면이 쓰는 엔드포인트를 그대로 부를 수 있다.
 * 그래서 브라우저를 띄울 필요가 없고, 여기서는 fetch + 쿠키만 쓴다.
 */

export const SM = process.env.SM_URL || "http://scenario-manager";
export const WMS = process.env.WMS_URL || "http://192.168.100.152:3000";

/** 로그인해서 세션 쿠키를 받아온다. 비밀번호는 여기서만 쓰고 어디에도 남기지 않는다. */
export async function smLogin(username, password) {
  const res = await fetch(`${SM}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password }).toString(),
    redirect: "manual",
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  const cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  if (!cookie) {
    const text = await res.text().catch(() => "");
    throw new Error(`로그인 실패 (HTTP ${res.status}) ${text.replace(/<[^>]*>/g, " ").trim().slice(0, 80)}`);
  }
  return cookie;
}

/** 세션 쿠키를 달고 SM을 호출한다. 세션이 끊기면 로그인 페이지로 돌려보내므로 그것도 잡아낸다. */
export function makeSmFetch(getCookie) {
  return async function smFetch(pathname, init = {}) {
    const res = await fetch(`${SM}${pathname}`, {
      ...init,
      headers: { Cookie: getCookie(), Accept: "application/json", ...(init.headers || {}) },
      redirect: "manual",
    });
    if (res.status === 302 || res.status === 401) {
      const err = new Error("SM 세션이 만료됐습니다.");
      err.needsLogin = true;
      throw err;
    }
    return res;
  };
}

// ── WMS 쪽 장부 ────────────────────────────────────────────

export async function loadWmsObjects(onlyIds) {
  const res = await fetch(`${WMS}/api/gas?action=getScenarioObjectsForAdmin`);
  if (!res.ok) throw new Error(`WMS 물품 조회 실패: HTTP ${res.status}`);
  const items = (await res.json()).items || [];
  return items
    .map((it) => ({
      id: String(it.id || "").trim(),
      name: it.name || "",
      stock: Number(it.stock) || 0,
      rented: Number(it.rented) || 0,
    }))
    .filter((it) => it.id && (!onlyIds || onlyIds.has(it.id)));
}

/** 지금 나가 있는 대여 줄. 사번은 WMS가 계산해서 내려준다(cfgw는 이메일, ConfigDS는 직원 명부). */
export async function loadWmsBorrows(onlyIds) {
  const res = await fetch(`${WMS}/api/gas?action=getUnreturnedItems`);
  if (!res.ok) throw new Error(`WMS 대여 조회 실패: HTTP ${res.status}`);
  const rows = (await res.json()).items || [];
  const byItem = new Map();
  for (const r of rows) {
    const id = String(r.itemId || "").trim();
    if (!id || (onlyIds && !onlyIds.has(id))) continue;
    const name = String(r.borrowerName || "").trim() || "이름 없음";
    const empId = String(r.employeeId || "").trim() || (String(r.email || "").match(/^(\d+)@/) || [])[1] || "";
    const key = empId || name;
    if (!byItem.has(id)) byItem.set(id, new Map());
    const m = byItem.get(id);
    const cur = m.get(key) || { name, empId, qty: 0 };
    cur.qty += Number(r.quantity) || 0;
    m.set(key, cur);
  }
  return byItem;
}

// ── SM 쪽 ──────────────────────────────────────────────────

/** 진짜 재고는 _inventory 안에 있다. 최상위 quantity는 미등록일 때 -1이라 쓰면 안 된다. */
export async function loadSmObjects(smFetch) {
  const all = [];
  for (let p = 1; p <= 200; p++) {
    const res = await smFetch(`/api/objects?page=${p}`);
    const d = await res.json();
    const rows = Array.isArray(d) ? d : d.objects || d.items || d.data || [];
    if (!rows.length) break;
    all.push(...rows);
  }
  const map = new Map();
  for (const r of all) {
    const id = String(r.id ?? "").trim();
    if (id) map.set(id, r);
  }
  return map;
}

const inv = (r) => r?._inventory || {};
export const smTracked = (r) => inv(r).is_tracked === true;
const n = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));
export const smTotal = (r) => n(inv(r).total);
export const smAvailable = (r) => n(inv(r).available);
export const smBorrowers = (r) => inv(r).borrowers || {};

/** 총 보유 수량을 맞춘다. 화면의 수량 조정과 같은 요청이다. */
export async function setQuantity(smFetch, oid, quantity, note) {
  const res = await smFetch("/object_inventory_quantity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ oid, quantity, note }),
  });
  return { ok: res.ok, status: res.status };
}

/** 대여/반납. 화면의 Borrow/Return 버튼과 같은 요청이다. */
export async function inventoryEvent(smFetch, { oid, action, quantity, borrower, note }) {
  const res = await smFetch("/object_inventory_event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ oid, action, quantity, borrower, note }),
  });
  return { ok: res.ok, status: res.status };
}

// ── 맞추기 ─────────────────────────────────────────────────

/**
 * 물품 몇 개를 WMS 기준으로 맞춘다. 수량 → 대여 순서로 처리한다.
 * 이미 맞는 건은 아무것도 보내지 않으므로, 몇 번을 돌려도 결과가 같다.
 */
export async function reconcile(smFetch, ids, { dryRun = false, log = () => {} } = {}) {
  const only = ids && ids.length ? new Set(ids) : null;
  const [wms, borrows, sm] = await Promise.all([
    loadWmsObjects(only),
    loadWmsBorrows(only),
    loadSmObjects(smFetch),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const result = { quantity: 0, borrow: 0, skipped: 0, failed: [], untracked: [] };

  for (const w of wms) {
    const s = sm.get(w.id);
    if (!s) continue;                       // SM에 없는 물품은 건드리지 않는다
    if (!smTracked(s)) { result.untracked.push(w.id); continue; }

    // 1) 총 보유 수량
    const wmsTotal = w.stock + w.rented;
    const total = smTotal(s);
    if (Number.isFinite(total) && total !== wmsTotal) {
      const people = [...(borrows.get(w.id)?.values() || [])].map((b) => `${b.name} ${b.qty}`).join(", ");
      const note = [`WMS 동기화 ${today}`, `총 ${total}→${wmsTotal}`, `선반 ${w.stock} + 대여 ${w.rented}`]
        .concat(people ? [`대여자: ${people}`] : []).join(" · ").slice(0, 300);
      if (dryRun) log(`  [확인] ${w.id} 총 ${total}→${wmsTotal}`);
      else {
        const r = await setQuantity(smFetch, w.id, wmsTotal, note);
        if (r.ok) { result.quantity++; log(`  ✓ ${w.id} 총 보유 ${total}→${wmsTotal}`); }
        else { result.failed.push(`${w.id} 수량 HTTP ${r.status}`); log(`  ✗ ${w.id} 수량 실패 HTTP ${r.status}`); }
      }
    }

    // 2) 사람별 대여 — SM에 이미 잡힌 만큼을 빼고 모자란 만큼만 보낸다.
    const want = borrows.get(w.id) || new Map();
    const have = smBorrowers(s);
    const keys = new Set([...Object.keys(have), ...want.keys()]);
    for (const key of keys) {
      const wantQty = want.get(key)?.qty || 0;
      const haveQty = Number(have[key]) || 0;
      const delta = wantQty - haveQty;
      if (!delta) { result.skipped++; continue; }
      const who = want.get(key)?.name || key;
      const action = delta > 0 ? "borrow" : "return";
      const qty = Math.abs(delta);
      const note = `WMS 동기화 ${today} · 실제 대여자 ${who}${key !== who ? `(${key})` : ""}`;
      if (dryRun) { log(`  [확인] ${w.id} ${who} ${action === "borrow" ? "대여" : "반납"} ${qty}개`); continue; }
      const r = await inventoryEvent(smFetch, { oid: w.id, action, quantity: qty, borrower: key, note });
      if (r.ok) { result.borrow++; log(`  ✓ ${w.id} ${who} ${action === "borrow" ? "대여" : "반납"} ${qty}개`); }
      else { result.failed.push(`${w.id} ${who} ${action} HTTP ${r.status}`); log(`  ✗ ${w.id} ${who} 실패 HTTP ${r.status}`); }
    }
  }
  return result;
}

/** 지금 WMS 상태의 지문 — 물품별 "재고|대여|대여 줄 구성". 달라진 물품만 골라내는 데 쓴다. */
export async function wmsSnapshot() {
  const [objs, borrows] = await Promise.all([loadWmsObjects(), loadWmsBorrows()]);
  const map = {};
  for (const o of objs) {
    const people = [...(borrows.get(o.id)?.entries() || [])]
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      .map(([k, v]) => `${k}:${v.qty}`).join(",");
    map[o.id] = `${o.stock}|${o.rented}|${people}`;
  }
  return map;
}
