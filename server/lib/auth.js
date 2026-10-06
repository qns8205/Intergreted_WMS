import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { get, run } from "../db.js";

const SESSION_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export function verifyAdminLogin(loginId, password) {
  const user = get("SELECT * FROM admin_users WHERE login_id = ?", [loginId]);
  if (!user) return null;
  if (!bcrypt.compareSync(String(password), user.password_hash)) return null;
  return { id: user.id, loginId: user.login_id, name: user.name };
}

const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

/** 로그인 성공 시 세션 토큰을 발급한다. DB에는 해시만 남기고 원문은 이 한 번만 돌려준다. */
export function issueAdminSession(adminId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = new Date().toISOString();
  run("INSERT INTO admin_sessions (token_hash, admin_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)", [hashToken(token), adminId, now, now]);
  return token;
}

export function revokeAdminSession(token) {
  if (token) run("DELETE FROM admin_sessions WHERE token_hash = ?", [hashToken(token)]);
}

/** `x-admin-token` 헤더로 관리자를 확인한다. 30일 동안 쓰지 않은 세션은 무효다. */
export function adminFromRequest(req) {
  const token = req.header("x-admin-token");
  if (!token) return null;
  const hash = hashToken(token);
  const row = get(
    `SELECT s.last_seen_at, u.id, u.login_id, u.name FROM admin_sessions s
       JOIN admin_users u ON u.id = s.admin_id WHERE s.token_hash = ?`,
    [hash],
  );
  if (!row) return null;
  const lastSeen = Date.parse(row.last_seen_at);
  if (!Number.isFinite(lastSeen) || Date.now() - lastSeen > SESSION_IDLE_MS) {
    run("DELETE FROM admin_sessions WHERE token_hash = ?", [hash]);
    return null;
  }
  if (Date.now() - lastSeen > TOUCH_INTERVAL_MS) {
    run("UPDATE admin_sessions SET last_seen_at = ? WHERE token_hash = ?", [new Date().toISOString(), hash]);
  }
  return { id: row.id, loginId: row.login_id, name: row.name };
}

export function requireAdmin(req, res, next) {
  const admin = adminFromRequest(req);
  if (!admin) return res.status(401).json({ success: false, error: "관리자 로그인이 필요합니다. 다시 로그인해주세요." });
  req.admin = admin;
  next();
}

/** Express middleware: requires an `x-api-key` header matching SCRAPER_API_KEY.
 * For unattended external scripts (e.g. the scenario-manager scraper) that have no admin session
 * to authenticate with. Fails closed if the env var isn't configured. */
export function requireScraperKey(req, res, next) {
  const expected = process.env.SCRAPER_API_KEY;
  if (!expected) return res.status(503).json({ success: false, error: "서버에 SCRAPER_API_KEY가 설정되어 있지 않습니다." });
  const provided = req.header("x-api-key");
  if (!provided || provided !== expected) return res.status(401).json({ success: false, error: "API 키가 유효하지 않습니다." });
  next();
}
