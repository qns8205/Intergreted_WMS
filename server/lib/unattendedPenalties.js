import { all, get, run, transaction } from "../db.js";
import { employeeIdForRentalRow } from "./registeredUsers.js";
import { padSlot, parseItemLabel } from "./borrowUtils.js";
import { nowKst, parseKstMs } from "./time.js";
import { linksFor } from "./penaltyLinks.js";

const FALLBACK_MAX_TYPES = 15;
const PENALTY_DAYS = 7;

export function unattendedEnabled() {
  return get("SELECT value FROM settings WHERE key='unattended_enabled'")?.value === "1";
}

function enabledAt() {
  return String(get("SELECT value FROM settings WHERE key='unattended_enabled_at'")?.value || "");
}

function configuredMax() {
  const value = Number(get("SELECT value FROM settings WHERE key='max_item_types_default'")?.value);
  return Number.isFinite(value) && value > 0 ? value : FALLBACK_MAX_TYPES;
}

function activePenalty(name) {
  const now = nowKst();
  return get(
    "SELECT * FROM penalties WHERE LOWER(TRIM(name))=LOWER(TRIM(?)) AND (expires_at IS NULL OR expires_at='' OR expires_at>?) ORDER BY id DESC LIMIT 1",
    [name, now],
  );
}

function expiryDate() {
  const d = new Date(Date.now() + PENALTY_DAYS * 24 * 60 * 60 * 1000);
  const pad = (value) => String(value).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function requestCode(requestNo) {
  if (!requestNo) return "";
  return get("SELECT request_code FROM rental_requests WHERE id=?", [requestNo])?.request_code || String(requestNo);
}

/** 호출자가 transaction 안에서 사용한다. event_key 중복이면 아무것도 바꾸지 않는다. */
export function registerUnattendedViolation({ eventKey, eventType, row, sourceAt }) {
  const startedAt = enabledAt();
  // 무인 모드가 켜지기 전에 이미 생긴 오래된 건을 켜는 순간 소급 처벌하지 않는다.
  const sourceTime = parseKstMs(sourceAt);
  const startedTime = parseKstMs(startedAt);
  if (Number.isFinite(startedTime) && (!Number.isFinite(sourceTime) || sourceTime < startedTime)) return false;

  const employeeId = employeeIdForRentalRow(row);
  const borrowerName = String(row.borrower_name || "").trim();
  if (!borrowerName) return false;

  const now = nowKst();
  const inserted = run(
    `INSERT OR IGNORE INTO unattended_penalty_events
       (event_key,event_type,employee_id,borrower_name,request_no,source_at,occurred_at,details)
     VALUES (?,?,?,?,?,?,?,?)`,
    [eventKey,eventType,employeeId || null,borrowerName,row.request_no || null,sourceAt || null,now,"페널티 생성 대기"],
  );
  if (!inserted.changes) return false;

  const previous = activePenalty(borrowerName);
  const previousMax = previous && Number.isFinite(Number(previous.max_types)) ? Number(previous.max_types) : configuredMax();
  const nextMax = Math.max(0, previousMax - 2);
  const label = eventType === "pickup_unconfirmed_4h" ? "4시간 내 대여 확인 미처리" : "대여 후 24시간 내 반납 미처리";
  const code = requestCode(row.request_no);
  const reason = `무인 모드 자동 페널티 · ${label}${code ? ` · ${code}` : ""} · 대여 가능 종류 ${previousMax}→${nextMax}종 (7일)`;
  const penalty = run("INSERT INTO penalties (name,max_types,reason,expires_at) VALUES (?,?,?,?)", [borrowerName,nextMax,reason,expiryDate()]);
  run("UPDATE unattended_penalty_events SET penalty_id=?, details=? WHERE event_key=?", [Number(penalty.lastInsertRowid),reason,eventKey]);
  console.log(`[unattended-penalty] ${borrowerName}(${employeeId || "사번 없음"}) · ${label} · ${previousMax}→${nextMax}종`);
  return true;
}

function cutoffKst(hours) {
  const d = new Date(Date.now() - hours * 60 * 60 * 1000);
  const pad = (value) => String(value).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// request 물품과 관리자가 "한도 제외"로 지정한 줄은 반납 없이 오래 보관하는 것이 정상이다.
// 무인 기간엔 제외를 지정해 줄 관리자도 없으므로 request 물품은 표시만으로 뺀다.
function longTermRule() {
  const requestIds = new Set(all("SELECT id FROM scenario_items WHERE request IS NOT NULL").map((r) => r.id));
  return (row) => row.type_limit_exempt === "Y"
    || requestIds.has(padSlot(row.sheet_type === "scenario" ? parseItemLabel(row.item_label).id : row.item_id));
}

/** 수령 확인 뒤 24시간이 지났지만 반납되지 않은 신청을 한 번씩 페널티 처리한다. */
export function applyUnattendedOverduePenalties() {
  if (!unattendedEnabled()) return { penalized: 0 };
  const cutoff = cutoffKst(24);
  const keptLongTerm = longTermRule();
  const rows = [
    ...all("SELECT *, 'scenario' AS sheet_type FROM sid_rentals WHERE picked_up_at IS NOT NULL AND picked_up_at<? AND status='active' AND (returned IS NULL OR returned!='O')", [cutoff]),
    ...all("SELECT *, 'general' AS sheet_type FROM general_rentals WHERE picked_up_at IS NOT NULL AND picked_up_at<? AND status='active' AND (returned IS NULL OR returned!='O')", [cutoff]),
  ].filter((row) => !keptLongTerm(row));
  const groups = new Map();
  for (const row of rows) {
    const key = row.request_no ? `return:request:${row.request_no}` : `return:${row.sheet_type}:${row.id}`;
    if (!groups.has(key)) groups.set(key, row);
  }
  let penalized = 0;
  transaction(() => {
    for (const [eventKey, row] of groups) {
      if (registerUnattendedViolation({ eventKey, eventType: "return_unconfirmed_24h", row, sourceAt: row.picked_up_at })) penalized++;
    }
  });
  return { penalized };
}

const EVENT_RULES = {
  pickup_unconfirmed_4h: { label: "4시간 내 대여 확인 미처리", hours: 4 },
  return_unconfirmed_24h: { label: "대여 후 24시간 내 반납 미처리", hours: 24 },
};

function kstAt(ms) {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const pad = (value) => String(value).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// 신청 번호로 묶인 위반은 그 신청의 모든 줄(부분 반납으로 갈라진 줄 포함)을, 아니면 그 줄 하나를 본다.
function rowsForEvent(event) {
  if (event.request_no) {
    return [
      ...all("SELECT *, 'scenario' AS sheet_type FROM sid_rentals WHERE request_no=? ORDER BY id", [event.request_no]),
      ...all("SELECT *, 'general' AS sheet_type FROM general_rentals WHERE request_no=? ORDER BY id", [event.request_no]),
    ];
  }
  const match = /^(?:pickup|return):(scenario|general):(\d+)$/.exec(event.event_key || "");
  if (!match) return [];
  const table = match[1] === "scenario" ? "sid_rentals" : "general_rentals";
  const row = get(`SELECT * FROM ${table} WHERE id=?`, [Number(match[2])]);
  return row ? [{ ...row, sheet_type: match[1] }] : [];
}

function returnState(row) {
  if (row.returned !== "O") return "대여 중";
  if (row.return_source === "cancel") return "미수령 자동 취소";
  if (row.return_source === "damage") return "파손 신고 반납";
  if (row.return_source === "unattended") return "무인 반납";
  return "반납";
}

/**
 * 페널티 하나가 어떤 대여 때문에 생겼는지: 물품, 신청·대여 확인·반납 시각, 기한, 기한을 넘긴 줄.
 * 관리자가 직접 등록한 페널티는 자동 연결 기록(events)이 비고, 대신 관리자가 고른 links가 붙는다.
 */
export function penaltyDetails(penaltyId) {
  const penalty = get("SELECT * FROM penalties WHERE id=?", [Number(penaltyId)]);
  if (!penalty) return null;
  const keptLongTerm = longTermRule();
  const now = Date.now();
  const events = all("SELECT * FROM unattended_penalty_events WHERE penalty_id=? ORDER BY id", [penalty.id]).map((event) => {
    const rule = EVENT_RULES[event.event_type] || { label: event.event_type, hours: 0 };
    const isPickup = event.event_type === "pickup_unconfirmed_4h";
    const items = rowsForEvent(event).map((row) => {
      const scenario = row.sheet_type === "scenario";
      const parsed = scenario ? parseItemLabel(row.item_label) : { id: row.item_id, name: row.item_label, quantity: Number(row.qty) || 1 };
      const itemId = padSlot(parsed.id || "");
      const name = parsed.name || get("SELECT name FROM scenario_items WHERE id=?", [itemId])?.name || row.item_label || "물품";
      const appliedAt = row.applied_at || row.borrow_date || "";
      const pickedUpAt = row.picked_up_at || "";
      const returnedAt = row.returned === "O" ? row.return_date || "" : "";
      const exempt = !isPickup && keptLongTerm(row);
      // 대여 확인은 신청 후 4시간, 반납은 대여 확인 후 24시간이 기한이다.
      const startMs = parseKstMs(isPickup ? appliedAt : pickedUpAt);
      const deadlineMs = Number.isFinite(startMs) ? startMs + rule.hours * 3600_000 : NaN;
      const doneMs = parseKstMs(isPickup ? pickedUpAt : returnedAt);
      const endMs = Number.isFinite(doneMs) ? doneMs : now;
      const missed = !exempt && Number.isFinite(deadlineMs) && endMs > deadlineMs;
      return {
        sheetType: row.sheet_type, rowId: row.id, itemId, name, qty: Number(parsed.quantity) || 1,
        appliedAt, pickedUpAt, returnedAt, state: returnState(row), exempt,
        deadlineAt: kstAt(deadlineMs), missed, overMinutes: missed ? Math.round((endMs - deadlineMs) / 60000) : 0,
      };
    });
    const sourceMs = parseKstMs(event.source_at);
    return {
      eventType: event.event_type, label: rule.label, hours: rule.hours,
      requestNo: event.request_no || null, requestCode: requestCode(event.request_no),
      borrowerName: event.borrower_name || "", employeeId: event.employee_id || "",
      sourceAt: event.source_at || "", deadlineAt: kstAt(Number.isFinite(sourceMs) ? sourceMs + rule.hours * 3600_000 : NaN),
      occurredAt: event.occurred_at || "", items,
    };
  });
  // 관리자가 원인으로 직접 연결한 대여·반납 기록(자동 페널티에도 붙일 수 있다).
  return { penalty, events, links: linksFor(penalty.id) };
}
