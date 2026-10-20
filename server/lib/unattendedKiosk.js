import crypto from "node:crypto";
import { get } from "../db.js";
import { registeredUser } from "./registeredUsers.js";

// 무인 PC는 사번만으로 들어가면 남의 사번으로 반납·수령 확인·공구 대여를 할 수 있다.
// 그래서 사번과 SM 비밀번호로 본인을 확인한 뒤, 그 한 번의 사용에만 쓰는 표(세션)를 내준다.
// 이후 무인 PC의 모든 처리는 화면이 보낸 사번이 아니라 이 표의 사번으로 한다.
// 무인 PC는 완료 15초 뒤·무입력 3분 뒤 스스로 로그아웃하므로 표는 짧게 둔다. 메모리에만 둔다 —
// 서버가 다시 뜨면 무인 PC 사용자는 다시 로그인하면 된다.
export const DEVICE_HEADER = "x-unattended-device";
export const SESSION_HEADER = "x-unattended-session";
const IDLE_MS = 15 * 60 * 1000;
const MAX_MS = 60 * 60 * 1000;
const sessions = new Map(); // 토큰 해시 → { employeeId, created, seen }

const setting = (key) => get("SELECT value FROM settings WHERE key = ?", [key])?.value || "";
export const digest = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
function safeEqual(a, b) {
  const aa = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
export function kioskEnabled() { return setting("unattended_enabled") === "1"; }
export function validDevice(req) {
  const expected = setting("unattended_device_hash");
  const token = req.header(DEVICE_HEADER) || "";
  return !!expected && !!token && safeEqual(digest(token), expected);
}

function prune(now) {
  for (const [key, s] of sessions) if (now - s.seen > IDLE_MS || now - s.created > MAX_MS) sessions.delete(key);
}
export function issueKioskSession(employeeId, now = Date.now()) {
  prune(now);
  const token = crypto.randomBytes(32).toString("base64url");
  sessions.set(digest(token), { employeeId: String(employeeId), created: now, seen: now });
  return token;
}
export function revokeKioskSession(req) {
  const token = req.header(SESSION_HEADER) || "";
  if (token) sessions.delete(digest(token));
}
/** 등록된 무인 PC에서 로그인한 사람. 아니면 null. */
export function kioskUserFromRequest(req, now = Date.now()) {
  if (!kioskEnabled() || !validDevice(req)) return null;
  const token = req.header(SESSION_HEADER) || "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const key = digest(token);
  const s = sessions.get(key);
  if (!s) return null;
  if (now - s.seen > IDLE_MS || now - s.created > MAX_MS) { sessions.delete(key); return null; }
  const user = registeredUser(s.employeeId);
  if (!user) { sessions.delete(key); return null; }
  s.seen = now;
  return { employeeId: user.employee_id, name: user.name };
}
