import { all, get, run } from "../db.js";
import { padSlot, parseItemLabel } from "./borrowUtils.js";
import { registeredUsersByName, normalizeEmployeeId } from "./registeredUsers.js";
import { requestCodeOf } from "./requestCode.js";
import { nowKst } from "./time.js";

/**
 * 페널티가 "어느 대여·반납 기록의 어느 물품 때문에" 생겼는지를 남긴다.
 *
 * 자동(무인 모드) 페널티는 unattended_penalty_events로 원인이 이미 연결되지만, 관리자가 텍스트로
 * 등록하는 페널티는 사유 글만 있어서 근거를 따로 찾아야 했다. 여기서는 대여 기록의 한 줄(= 물품 하나)을
 * 골라 원인(대여 때문 / 반납 때문)과 함께 연결한다.
 *
 * 연결하는 줄은 대여·반납 로그를 이루는 sid_rentals(시나리오)·general_rentals(일반)이다.
 */
export const LINK_CAUSES = ["rental", "return"];
const MAX_LINKS = 30;
const SHEETS = { scenario: "sid_rentals", general: "general_rentals" };

function stateOf(row) {
  if (row.returned !== "O") return row.picked_up_at ? "대여 중" : "대여 확인 전";
  if (row.return_source === "cancel") return "미수령 자동 취소";
  if (row.return_source === "damage") return "파손 신고 반납";
  if (row.return_source === "unattended") return "무인 반납";
  return "반납 완료";
}

/** 대여 기록 한 줄을 화면·저장에 쓰는 모양으로 푼다. */
function describeRental(sheetType, row) {
  const scenario = sheetType === "scenario";
  const parsed = scenario
    ? parseItemLabel(row.item_label)
    : { id: row.item_id, name: row.item_label, quantity: Number(row.qty) || 1 };
  const itemId = padSlot(parsed.id || "");
  const object = itemId ? get("SELECT name FROM scenario_items WHERE id = ?", [itemId]) : null;
  const variantName = row.variant_id ? get("SELECT name FROM scenario_item_variants WHERE id = ?", [row.variant_id])?.name || "" : "";
  return {
    sheetType,
    rowId: row.id,
    itemId,
    itemName: String(parsed.name || object?.name || row.item_label || "물품").trim(),
    variantName,
    qty: Number(parsed.quantity) || 1,
    requestNo: row.request_no || null,
    requestCode: row.request_no ? requestCodeOf(row.request_no) : "",
    appliedAt: row.applied_at || row.borrow_date || "",
    pickedUpAt: row.picked_up_at || "",
    returnedAt: row.returned === "O" ? row.return_date || "" : "",
    state: stateOf(row),
  };
}

/**
 * 이 사람의 대여·반납 기록 줄(최근순). 이름 또는 4자리 사번으로 찾고, 이름이면 명부의 같은 이름 사번의
 * 줄도 함께 본다(예전 기록은 이름만 남아 있고 사번이 비어 있기도 하다). 반납된 줄도 로그라서 포함한다.
 */
export function rentalCandidates(nameOrId, limit = 100) {
  const text = String(nameOrId ?? "").trim();
  if (!text) return [];
  const id = normalizeEmployeeId(text);
  const ids = id ? [id] : registeredUsersByName(text).map((u) => u.employee_id);
  const rows = [];
  for (const [sheetType, table] of Object.entries(SHEETS)) {
    const where = ["LOWER(TRIM(borrower_name)) = ?"];
    const params = [text.toLowerCase()];
    if (ids.length) {
      where.push(`employee_id IN (${ids.map(() => "?").join(",")})`);
      params.push(...ids);
    }
    for (const row of all(`SELECT * FROM ${table} WHERE ${where.join(" OR ")} ORDER BY id DESC LIMIT ?`, [...params, limit])) {
      rows.push(describeRental(sheetType, row));
    }
  }
  return rows
    .sort((a, b) => (a.appliedAt < b.appliedAt ? 1 : a.appliedAt > b.appliedAt ? -1 : b.rowId - a.rowId))
    .slice(0, limit);
}

/**
 * 페널티의 연결을 통째로 바꾼다(빈 배열이면 모두 해제). 쓰기 전에 전부 검증하고, 호출자가
 * transaction 안에서 부른다 — 하나라도 잘못되면 아무것도 바뀌지 않는다.
 */
export function saveLinks(penaltyId, rawLinks, actor = "") {
  const links = Array.isArray(rawLinks) ? rawLinks : [];
  if (links.length > MAX_LINKS) throw new Error(`연결은 ${MAX_LINKS}건까지 할 수 있습니다.`);
  const seen = new Set();
  const prepared = [];
  for (const raw of links) {
    const table = SHEETS[String(raw?.sheetType || "")];
    const cause = String(raw?.cause || "");
    const rowId = Number(raw?.rowId);
    if (!table || !LINK_CAUSES.includes(cause) || !Number.isInteger(rowId) || rowId <= 0) {
      throw new Error("연결할 기록 정보가 올바르지 않습니다.");
    }
    const key = `${raw.sheetType}:${rowId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = get(`SELECT * FROM ${table} WHERE id = ?`, [rowId]);
    if (!row) throw new Error("연결하려는 대여 기록을 찾을 수 없습니다. 목록을 새로고침한 뒤 다시 골라 주세요.");
    prepared.push({ ...describeRental(raw.sheetType, row), cause });
  }
  const now = nowKst();
  run("DELETE FROM penalty_links WHERE penalty_id = ?", [penaltyId]);
  for (const l of prepared) {
    run(
      `INSERT INTO penalty_links (penalty_id, sheet_type, row_id, cause, item_id, item_name, variant_name, qty, request_no, applied_at, created_at, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [penaltyId, l.sheetType, l.rowId, l.cause, l.itemId, l.itemName, l.variantName, l.qty, l.requestNo, l.appliedAt, now, actor || null],
    );
  }
  return prepared.length;
}

export function deleteLinks(penaltyId) {
  run("DELETE FROM penalty_links WHERE penalty_id = ?", [penaltyId]);
}

/**
 * 페널티에 연결된 기록. 물품·신청 정보는 연결한 때의 값을 쓰고, 대여·반납 상태는 지금 기록에서 읽는다
 * (연결 뒤에 반납될 수 있다). 기록이 사라졌으면 상태를 "기록 없음"으로 둔다.
 */
export function linksFor(penaltyId) {
  return all("SELECT * FROM penalty_links WHERE penalty_id = ? ORDER BY id", [penaltyId]).map((l) => {
    const table = SHEETS[l.sheet_type];
    const row = table ? get(`SELECT * FROM ${table} WHERE id = ?`, [l.row_id]) : null;
    const live = row ? describeRental(l.sheet_type, row) : null;
    return {
      cause: l.cause,
      sheetType: l.sheet_type,
      rowId: l.row_id,
      itemId: l.item_id || "",
      itemName: l.item_name || "",
      variantName: l.variant_name || "",
      qty: Number(l.qty) || 1,
      requestNo: l.request_no || null,
      requestCode: l.request_no ? requestCodeOf(l.request_no) : "",
      appliedAt: live?.appliedAt || l.applied_at || "",
      pickedUpAt: live?.pickedUpAt || "",
      returnedAt: live?.returnedAt || "",
      state: live ? live.state : "기록 없음",
    };
  });
}

/**
 * 로그인 없이 읽는 랜딩 상세용. 관리자가 원인으로 지정한 물품·시각만 남기고 내부 행 번호는 뺀다.
 * (사유 글은 이미 모두에게 보이는 값이라, 같은 내용을 물품 단위로 구조화한 것이다.)
 */
export function publicLinks(links) {
  return links.map((l) => ({
    cause: l.cause,
    itemName: l.itemName,
    variantName: l.variantName,
    qty: l.qty,
    requestCode: l.requestCode,
    appliedAt: l.appliedAt,
    pickedUpAt: l.pickedUpAt,
    returnedAt: l.returnedAt,
    state: l.state,
  }));
}
