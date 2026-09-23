import { all, get, run, transaction } from "../db.js";
import { employeeIdForRentalRow } from "./registeredUsers.js";
import { nowKst, parseKstMs } from "./time.js";

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

/** 수령 확인 뒤 24시간이 지났지만 반납되지 않은 신청을 한 번씩 페널티 처리한다. */
export function applyUnattendedOverduePenalties() {
  if (!unattendedEnabled()) return { penalized: 0 };
  const cutoff = cutoffKst(24);
  const rows = [
    ...all("SELECT *, 'scenario' AS sheet_type FROM sid_rentals WHERE picked_up_at IS NOT NULL AND picked_up_at<? AND status='active' AND (returned IS NULL OR returned!='O')", [cutoff]),
    ...all("SELECT *, 'general' AS sheet_type FROM general_rentals WHERE picked_up_at IS NOT NULL AND picked_up_at<? AND status='active' AND (returned IS NULL OR returned!='O')", [cutoff]),
  ];
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
