import { get, all, run } from "../db.js";
import { toScenarioObject } from "./serialize.js";

export function padSlot(raw) {
  const s = String(raw ?? "").trim().replace(/\D/g, "");
  if (!s) return String(raw ?? "").trim();
  return s.length < 6 ? s.padStart(6, "0") : s;
}

export function normalizeSid(sid) {
  return String(sid || "").trim().toUpperCase().replace(/\s+/g, "");
}

export function parseSidParts(sid) {
  const m = /^([A-Z]+)0*(\d+)$/.exec(sid);
  if (!m) return null;
  return { prefix: m[1], num: Number(m[2]) };
}

export function parseItemLabel(label) {
  const l = String(label || "").trim();
  const m = /^\[(\d+)\]\s*(.*)$/.exec(l);
  let id = "", rest = l;
  if (m) { id = m[1]; rest = m[2]; }
  const qm = /\s*[x×]\s*(\d+)\s*$/i.exec(rest);
  let qty = 1, name = rest;
  if (qm) { qty = parseInt(qm[1], 10) || 1; name = rest.slice(0, qm.index); }
  return { id, name: name.trim(), quantity: qty };
}

export function scenarioItemLabel(item) {
  const id = item?.id ? padSlot(String(item.id).trim()) : "";
  const qty = item?.quantity || 1;
  return (id ? `[${id}] ` : "") + (item?.name || "") + (qty > 1 ? ` x ${qty}` : "");
}

/**
 * 대여 장부에서 테이블보에 쓰는 ID 대역. 테이블보는 자체 장부(tablecloth_rentals)를 쓰지만,
 * 화면과 API에서 물품을 가리킬 때는 시나리오 물품과 같은 6자리 ID 모양을 쓴다.
 * "TC3" 같은 접두사는 쓸 수 없다 — padSlot()이 숫자가 아닌 문자를 전부 지워
 * 000003으로 뭉개지고 기존 물품과 충돌한다. 그래서 숫자 대역을 갈라 쓴다.
 */
const TC_ID_BASE = 900000;

export function tableclothRentalId(id) {
  return String(TC_ID_BASE + Number(id));
}
export function isTableclothId(id) {
  const n = Number(padSlot(id));
  return Number.isFinite(n) && n > TC_ID_BASE;
}
export function tableclothIdFromRental(id) {
  return Number(padSlot(id)) - TC_ID_BASE;
}

export function objectMap() {
  const map = {};
  for (const row of all("SELECT * FROM scenario_items")) map[row.id] = toScenarioObject(row);
  return map;
}

/** 테이블보 재고 증감. 자체 장부에서만 쓴다(시나리오 대여 경로와 섞이지 않는다). */
export function updateTableclothInventory(tcId, qtyChange) {
  const row = get("SELECT stock, rented FROM tablecloth_items WHERE id = ?", [tcId]);
  if (!row) return;
  run("UPDATE tablecloth_items SET stock = ?, rented = ? WHERE id = ?", [
    (Number(row.stock) || 0) - qtyChange,
    (Number(row.rented) || 0) + qtyChange,
    tcId,
  ]);
}

/** Applies stock/rented deltas to scenario_items on borrow (qtyChange > 0) or return (qtyChange < 0). */
export function updateInventory(itemId, qtyChange) {
  const id = padSlot(itemId);
  const row = get("SELECT stock, rented FROM scenario_items WHERE id = ?", [id]);
  if (!row) return;
  run("UPDATE scenario_items SET stock = ?, rented = ? WHERE id = ?", [
    (Number(row.stock) || 0) - qtyChange,
    (Number(row.rented) || 0) + qtyChange,
    id,
  ]);
}

// 이름 하나에 등록된 ConfigDS 계정이 여러 개면(동명이인) 어느 쪽인지 알 수 없다 —
// 이럴 땐 아무거나 골라 쓰지 않고 ambiguous:true를 돌려줘서 호출한 쪽이 "구분 불가"로
  // 취급하게 한다 (엉뚱한 사람의 식별 정보로 처리되는 것보다 안전).
export function lookupConfigDsContact(name) {
  const target = String(name || "").trim().toLowerCase();
  if (!target) return null;
  const rows = all("SELECT * FROM staff_accounts WHERE LOWER(TRIM(name)) = ?", [target]);
  if (rows.length === 0) return null;
  if (rows.length > 1) return { ambiguous: true };
  const row = rows[0];
  return { email: row.email || null };
}

export function resolveBorrowerContact(info) {
  const affiliation = info.affiliation || "";
  let email = null;
  if (affiliation === "cfgw") {
    const empId = String(info.employeeId || "").trim();
    if (/^\d+$/.test(empId)) email = `${empId}@cfgw-kr.com`;
  } else if (affiliation === "configds") {
    const found = lookupConfigDsContact(info.borrowerName);
    if (found && !found.ambiguous) email = found.email;
  }
  // 반납 후 재대여처럼 소속 정보 없이 "원래 대여 기록에서 가져온 이메일"만 있는 경우
  // (payload.knownEmail) — 원래 대여자 식별 정보를 유지하는 데 사용한다.
  if (!email && info.knownEmail) email = String(info.knownEmail);
  return { affiliation, email };
}

// 사번(cfgw)이나 등록된 계정 이메일(configds)로 이 사람만의 고유한 이메일을 계산한다.
// 있으면 대여 기록을 이름만이 아니라 이 이메일로도 같이 대조해서, 동명이인이 서로의
// 대여 현황·연체·페널티를 보거나 섞이지 않게 한다. ("기타" 소속은 애초에 이름 말고는
// 등록된 식별 정보가 없어 여기서는 손댈 수 없다.)
export function expectedEmailFor({ affiliation, employeeId, name }) {
  if (affiliation === "cfgw") {
    const empId = String(employeeId || "").trim();
    return /^\d+$/.test(empId) ? `${empId}@cfgw-kr.com`.toLowerCase() : "";
  }
  if (affiliation === "configds") {
    const found = lookupConfigDsContact(name);
    return found && !found.ambiguous && found.email ? String(found.email).trim().toLowerCase() : "";
  }
  return "";
}

// 이름이 같아도 expectedEmail이 있으면 그 이메일까지 일치해야 같은 사람으로 본다.
// (기록에 이메일이 비어있는 옛 데이터는 이름만으로 통과시킨다 — 알 수 없는 걸 틀렸다고
// 단정하지 않는다.)
export function matchesBorrowerIdentity(item, name, expectedEmail) {
  if (String(item.borrowerName || "").trim() !== name) return false;
  if (!expectedEmail) return true;
  const itemEmail = String(item.email || "").trim().toLowerCase();
  return !itemEmail || itemEmail === expectedEmail;
}

// 대여/반납 기록 두 건을 "같은 사람" 것으로 묶어도 되는지 판단한다 — 반납 알림·연체 독촉
// 등에서 여러 기록을 대여자별로 그룹핑할 때 쓴다. cfgw 소속은 이메일이 곧 "{사번}@cfgw-kr.com"
// 형태라 사번까지 자동으로 구분되고, ConfigDS 소속은 등록된 계정 이메일로 구분된다.
// 이메일이 둘 다 있으면 같아야 같은 사람 — 이걸로 동명이인이 서로 섞이지 않는다.
// 한쪽이라도 비어 있으면(소속 "기타"이거나 옛 기록) 이름만으로 같은 사람으로 본다 —
// 알 수 없는 걸 다른 사람이라고 단정하지 않는다.
export function sameBorrowerIdentity(nameA, emailA, nameB, emailB) {
  if (String(nameA || "").trim() !== String(nameB || "").trim()) return false;
  const a = String(emailA || "").trim().toLowerCase();
  const b = String(emailB || "").trim().toLowerCase();
  if (!a || !b) return true;
  return a === b;
}

// ── 시나리오 물품의 "종류" ────────────────────────────────────────────────
// 종류가 하나도 없는 물품은 지금까지와 완전히 동일하게 동작한다 — 아래 함수들은 전부
// "종류가 있을 때만" 개입하고, 없으면 아무것도 하지 않는다.

/** { [itemId]: [{ id, name, stock, rented }] } — 정렬 순서대로. */
export function variantMap() {
  const map = {};
  for (const r of all("SELECT * FROM scenario_item_variants ORDER BY item_id, sort_order, id")) {
    (map[r.item_id] ||= []).push({
      id: r.id,
      name: r.name,
      stock: Number(r.stock) || 0,
      rented: Number(r.rented) || 0,
      image: r.image_path || "",
      // 종류별 실측 치수. 안 재둔 종류는 undefined로 두어, 화면이 물품 치수로 되돌아갈 수 있게 한다.
      widthMm: r.width_mm ?? undefined,
      depthMm: r.depth_mm ?? undefined,
      heightMm: r.height_mm ?? undefined,
      shape: r.shape ?? undefined,
    });
  }
  return map;
}

/** 목록 조회용: toScenarioObject 결과 배열에 variants와 미확인 수량을 붙여준다. */
export function withVariants(objs) {
  const map = variantMap();
  for (const o of objs) {
    o.variants = map[o.id] || [];
    // 미확인 = 종류를 아직 모르는 물량. 선반에 있는 건 unassignedStock,
    // 나가 있는 건 unassignedRented(종류 도입 전 대여분).
    o.unassignedStock = o.variants.length ? Number(o.unassignedStock) || 0 : 0;
    o.unassignedRented = o.variants.length ? legacyOutstanding(o.id) : 0;
  }
  return objs;
}

export function variantsOf(itemId) {
  return variantMap()[padSlot(itemId)] || [];
}

/** 종류 한 줄의 재고/대여중을 옮기고, 물품 총재고를 종류 합계로 다시 맞춘다. */
export function updateVariantInventory(variantId, qtyChange) {
  const row = get("SELECT * FROM scenario_item_variants WHERE id = ?", [variantId]);
  if (!row) return;
  run("UPDATE scenario_item_variants SET stock = ?, rented = ? WHERE id = ?", [
    (Number(row.stock) || 0) - qtyChange,
    (Number(row.rented) || 0) + qtyChange,
    variantId,
  ]);
  syncItemStockFromVariants(row.item_id);
}

// 종류가 생기기 *전에* 나가서 아직 안 돌아온 대여 수량.
// 이 건들은 어느 종류인지 기록이 없어 종류별 rented에 잡히지 않는다. 그렇다고 없는 셈
// 치면(예전 구현) 반납될 때 재고가 붕 떠서 다음 동기화에 통째로 증발한다 — 그래서
// 물품의 "대여 중"을 계산할 때 이 수량을 따로 세어 더한다.
// (variant_pending='Y'인 줄은 애초에 재고를 뺀 적이 없으므로 여기 포함하지 않는다.)
export function legacyOutstanding(itemId) {
  const id = padSlot(itemId);
  let total = 0;
  for (const r of all(
    `SELECT qty FROM general_rentals
      WHERE item_id = ? AND (returned IS NULL OR returned != 'O')
        AND variant_id IS NULL AND (variant_pending IS NULL OR variant_pending != 'Y')`,
    [id]
  )) {
    total += Number(r.qty) || 1;
  }
  // sid_rentals는 물품 ID·수량이 item_label 문자열("[000003] 의자 x 3")에 들어 있어 SQL로
  // 거를 수 없다 — 미반납 건만 읽어와서 라벨을 파싱한다.
  for (const r of all(
    `SELECT item_label FROM sid_rentals
      WHERE (returned IS NULL OR returned != 'O')
        AND variant_id IS NULL AND (variant_pending IS NULL OR variant_pending != 'Y')`
  )) {
    const parsed = parseItemLabel(r.item_label);
    if (parsed.id && padSlot(parsed.id) === id) total += parsed.quantity || 1;
  }
  return total;
}

/** 종류가 있는 물품의 scenario_items.stock/rented를 종류 + 미확인 합계로 다시 계산한다.
 *  총재고 = 종류별 재고 합 + 미확인 재고
 *  대여 중 = 종류별 대여중 합 + 종류 도입 전 미반납분(미확인 대여중) */
export function syncItemStockFromVariants(itemId) {
  const id = padSlot(itemId);
  const sum = get(
    "SELECT COALESCE(SUM(stock), 0) AS stock, COALESCE(SUM(rented), 0) AS rented, COUNT(*) AS n FROM scenario_item_variants WHERE item_id = ?",
    [id]
  );
  if (!sum || !sum.n) return; // 종류가 없으면 총재고는 손대지 않는다
  const item = get("SELECT unassigned_stock FROM scenario_items WHERE id = ?", [id]);
  const unassigned = Number(item?.unassigned_stock) || 0;
  run("UPDATE scenario_items SET stock = ?, rented = ? WHERE id = ?", [
    sum.stock + unassigned,
    sum.rented + legacyOutstanding(id),
    id,
  ]);
}

// 종류 도입 전에 나간 물건이 돌아왔을 때 쓴다. 그 종류의 "선반 재고"만 늘리고 rented는
// 건드리지 않는다 — 그 수량은 종류별 rented에 잡힌 적이 없고 legacyOutstanding으로만
// 세어졌으므로, 반납으로 줄이 닫히면 그쪽이 알아서 줄어든다.
// (updateVariantInventory를 쓰면 rented가 음수로 내려간다.)
export function creditVariantStock(variantId, qty) {
  const row = get("SELECT * FROM scenario_item_variants WHERE id = ?", [variantId]);
  if (!row) return;
  run("UPDATE scenario_item_variants SET stock = ? WHERE id = ?", [(Number(row.stock) || 0) + qty, variantId]);
  syncItemStockFromVariants(row.item_id);
}

/** 대여 한 줄이 돌아올 때 재고를 되돌린다.
 *
 *  종류·미확정·파손이 얽혀 규칙이 미묘해서 한 곳에 모아둔다 — 반납(processReturn)과
 *  미수령 자동 취소가 같은 함수를 쓴다. 따로 두면 한쪽만 고쳐져 장부가 어긋난다.
 *
 *  opts.variantId : 종류 도입 전 대여 건을 반납할 때 담당자가 고른 종류
 */
export function restoreRentalStock(row, itemId, qty, opts = {}) {
  const id = padSlot(itemId || "");
  const hasVariants = (variantMap()[id] || []).length > 0;

  // 종류가 정해진 대여 — 그 종류로 되돌린다(총재고는 합계로 자동 갱신).
  if (row.variant_id) { updateVariantInventory(row.variant_id, -qty); return; }
  // 대여 확인 전이라 재고가 빠진 적이 없는 줄 — 되돌릴 것도 없다.
  if (row.variant_pending === "Y") return;
  // 종류 도입 전 건인데 담당자가 종류를 골라준 경우 — 그 종류 선반으로 되돌린다.
  if (opts.variantId && hasVariants) { creditVariantStock(Number(opts.variantId), qty); return; }
  // 종류가 나뉜 물품인데 어느 종류인지 모르는 경우(파손 반납 등) — 되돌릴 선반을 특정할 수
  // 없다. 총재고를 직접 건드리면 다음 동기화에 덮어써지므로 재계산만 한다.
  if (hasVariants) { syncItemStockFromVariants(id); return; }
  if (id) updateInventory(id, -qty);
}

/** 파손으로 폐기된 대여 줄 — 선반에는 돌아오지 않으므로 "대여 중"에서만 빼고 재고는 그대로 둔다.
 *  (관리자 반납의 "반납 후 파손 차감"과 같은 순 효과) */
export function releaseRentedWithoutRestock(row, itemId, qty) {
  const id = padSlot(itemId || "");
  if (row.variant_pending === "Y") return; // 대여 확인 전 줄은 대여 중에 잡힌 적이 없다
  if (row.variant_id) {
    const v = get("SELECT rented, item_id FROM scenario_item_variants WHERE id = ?", [row.variant_id]);
    if (!v) return;
    run("UPDATE scenario_item_variants SET rented = ? WHERE id = ?", [Math.max(0, (Number(v.rented) || 0) - qty), row.variant_id]);
    syncItemStockFromVariants(v.item_id);
    return;
  }
  // 종류 도입 전 대여 건은 물품의 대여 중이 미반납 줄 수로 다시 계산된다.
  if ((variantMap()[id] || []).length > 0) { syncItemStockFromVariants(id); return; }
  const item = id ? get("SELECT rented FROM scenario_items WHERE id = ?", [id]) : null;
  if (item) run("UPDATE scenario_items SET rented = ? WHERE id = ?", [Math.max(0, (Number(item.rented) || 0) - qty), id]);
}
