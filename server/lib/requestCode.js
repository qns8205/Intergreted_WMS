import { get, run } from "../db.js";

function datePart(createdAt) {
  return String(createdAt || "").slice(0, 10).replace(/-/g, "").slice(2) || "000000";
}

/** 새 신청에 YYMMDD-일일순번 형식의 외부 표시 번호를 확정한다. */
export function assignRequestCode(id, createdAt) {
  const date = datePart(createdAt);
  const dayPrefix = String(createdAt || "").slice(0, 10);
  const row = get(
    "SELECT COUNT(*) AS n FROM rental_requests WHERE substr(created_at, 1, 10) = ? AND id <= ?",
    [dayPrefix, id],
  );
  const code = `${date}-${String(Number(row?.n) || 1).padStart(3, "0")}`;
  run("UPDATE rental_requests SET request_code = ? WHERE id = ?", [code, id]);
  return code;
}

export function requestCodeOf(id) {
  return get("SELECT request_code FROM rental_requests WHERE id = ?", [id])?.request_code || "";
}

/** 새 표시 번호 또는 예전 내부 숫자 번호를 실제 신청 행으로 해석한다. */
export function resolveRentalRequest(value) {
  const raw = String(value ?? "").trim().replace(/^#/, "");
  const compact = raw.replace(/\s/g, "");
  if (/^\d{6}-\d{3,}$/.test(compact)) {
    return get("SELECT * FROM rental_requests WHERE request_code = ?", [compact]);
  }
  if (/^\d{9,}$/.test(compact)) {
    const code = `${compact.slice(0, 6)}-${compact.slice(6)}`;
    const found = get("SELECT * FROM rental_requests WHERE request_code = ?", [code]);
    if (found) return found;
  }
  return /^\d+$/.test(compact) ? get("SELECT * FROM rental_requests WHERE id = ?", [Number(compact)]) : null;
}
