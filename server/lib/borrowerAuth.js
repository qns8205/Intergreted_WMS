import crypto from "node:crypto";
import { get, run } from "../db.js";
import { registeredUser, employeeIdForRentalRow } from "./registeredUsers.js";
import { borrowerAuthRequired } from "./httpsConfig.js";

const COOKIE = "__Host-wms_borrower";
const IDLE_MS = 4 * 60 * 60 * 1000;
const hash = (token) => crypto.createHash("sha256").update(token).digest("hex");
function cookieToken(req) {
  const raw = String(req.headers.cookie || "").split(";").find((part) => part.trim().startsWith(`${COOKIE}=`));
  return raw ? raw.trim().slice(COOKIE.length + 1) : "";
}
export function borrowerFromRequest(req) {
  if (borrowerAuthRequired() && !req.socket.encrypted) return null;
  const token = cookieToken(req);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = get("SELECT * FROM borrower_sessions WHERE token_hash = ?", [hash(token)]);
  if (!row) return null;
  if (Date.now() - row.last_seen_ms > IDLE_MS) {
    run("DELETE FROM borrower_sessions WHERE token_hash = ?", [hash(token)]);
    return null;
  }
  const user = registeredUser(row.employee_id);
  if (!user) return null;
  if (Date.now() - row.last_seen_ms > 60000) run("UPDATE borrower_sessions SET last_seen_ms = ? WHERE token_hash = ?", [Date.now(), hash(token)]);
  return { employeeId: user.employee_id, name: user.name, affiliation: "cfgw" };
}
export function revokeBorrower(req, res) {
  const token = cookieToken(req);
  if (token) run("DELETE FROM borrower_sessions WHERE token_hash = ?", [hash(token)]);
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}
export function issueBorrower(req, res, employeeId) {
  revokeBorrower(req, res);
  run("DELETE FROM borrower_sessions WHERE last_seen_ms < ?", [Date.now() - IDLE_MS]);
  const token = crypto.randomBytes(32).toString("base64url");
  run("INSERT INTO borrower_sessions (token_hash,employee_id,last_seen_ms) VALUES (?,?,?)", [hash(token), employeeId, Date.now()]);
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict`);
}
export function assertBorrowerOrigin(req) {
  const origin = req.headers.origin;
  if (origin && origin !== `https://${req.headers.host}`) throw Error("다른 사이트에서 보낸 요청은 허용되지 않습니다.");
}
export function requireBorrowerIdentity(req, payload, admin = false) {
  if (admin || !borrowerAuthRequired()) return null;
  assertBorrowerOrigin(req);
  const borrower = borrowerFromRequest(req);
  if (!borrower) throw Error("SM 인증 로그인이 필요합니다. 다시 로그인해주세요.");
  if (payload.employeeId && String(payload.employeeId) !== borrower.employeeId) throw Error("다른 사번으로 요청할 수 없습니다.");
  payload.employeeId = borrower.employeeId;
  if ("borrowerName" in payload) payload.borrowerName = borrower.name;
  payload.affiliation = borrower.affiliation;
  return borrower;
}
export function assertRentalOwner(borrower, sheetType, id) {
  const tables = { scenario: "sid_rentals", general: "general_rentals", tablecloth: "tablecloth_rentals" };
  const table = tables[sheetType];
  const row = table ? get(`SELECT * FROM ${table} WHERE id = ?`, [id]) : null;
  if (!row || employeeIdForRentalRow(row) !== borrower.employeeId) throw Error("본인의 대여 물품만 처리할 수 있습니다.");
}
