import { Router } from "express";
import bcrypt from "bcryptjs";
import { all, get, run, transaction } from "../db.js";
import { requireAdmin } from "../lib/auth.js";
import { verifySmCredentials } from "../lib/smSync.js";
import { normalizeEmployeeId, registeredUser, backfillRentalEmployeeIds } from "../lib/registeredUsers.js";
import { nowKst } from "../lib/time.js";

/**
 * 명부에 없는 사람의 가입 신청.
 * 누구나 신청할 수 있지만 registered_users에는 관리자가 승인해야 들어간다.
 * 이미 등록된 사번은 신청을 받지 않아서, 남의 사번 이름을 바꿔치기할 수 없다.
 */
export const signupRouter = Router();

// 대기 중 신청이 이만큼 쌓이면 더 받지 않는다(장난 신청으로 목록이 묻히지 않도록).
const MAX_PENDING = 100;

function cleanName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

signupRouter.post("/signup-requests", (req, res) => {
  const employeeId = normalizeEmployeeId(req.body?.employeeId);
  const name = cleanName(req.body?.name);
  if (!employeeId || employeeId === "0000") return res.status(400).json({ success: false, error: "사번은 4자리 숫자로 입력해주세요." });
  if (name.length < 2 || name.length > 20) return res.status(400).json({ success: false, error: "이름은 2~20자로 입력해주세요." });
  if (registeredUser(employeeId)) return res.status(409).json({ success: false, error: "이미 등록된 사번입니다. 로그인 화면에서 바로 로그인해주세요." });
  if (get("SELECT id FROM signup_requests WHERE employee_id = ? AND status = 'pending'", [employeeId])) {
    return res.status(409).json({ success: false, error: "이 사번은 이미 가입 신청이 되어 있습니다. 관리자 승인을 기다려주세요." });
  }
  if ((get("SELECT COUNT(*) AS c FROM signup_requests WHERE status = 'pending'")?.c || 0) >= MAX_PENDING) {
    return res.status(429).json({ success: false, error: "가입 신청이 밀려 있습니다. 관리자에게 직접 문의해주세요." });
  }
  run("INSERT INTO signup_requests (employee_id, name, status, created_at) VALUES (?, ?, 'pending', ?)", [employeeId, name, nowKst()]);
  res.json({ success: true });
});

// 로그인 화면이 "명부에 없음"과 "승인 대기 중"을 구분해 안내하는 데 쓴다. 이름은 돌려주지 않는다.
signupRouter.get("/signup-requests/status", (req, res) => {
  const employeeId = normalizeEmployeeId(req.query.employeeId);
  if (!employeeId) return res.json({ success: true, status: "none" });
  if (registeredUser(employeeId)) return res.json({ success: true, status: "registered" });
  const last = get("SELECT status FROM signup_requests WHERE employee_id = ? ORDER BY id DESC LIMIT 1", [employeeId]);
  res.json({ success: true, status: last?.status === "pending" || last?.status === "rejected" ? last.status : "none" });
});

signupRouter.get("/admin/signup-requests", requireAdmin, (req, res) => {
  const rows = all("SELECT id, employee_id, name, created_at FROM signup_requests WHERE status = 'pending' ORDER BY id");
  res.json({
    success: true,
    requests: rows.map((r) => {
      const existing = get("SELECT name, active FROM registered_users WHERE employee_id = ?", [r.employee_id]);
      // 예전에 지운 사번이면 관리자가 알아야 한다. 승인하면 그 사번이 되살아난다.
      return { ...r, previousName: existing && !existing.active ? existing.name : "" };
    }),
  });
});

function resolverName(req) {
  return req.admin?.name || req.admin?.loginId || String(req.admin?.id || "");
}

signupRouter.post("/admin/signup-requests/:id/approve", requireAdmin, (req, res) => {
  const request = get("SELECT * FROM signup_requests WHERE id = ? AND status = 'pending'", [Number(req.params.id)]);
  if (!request) return res.status(404).json({ success: false, error: "처리할 신청을 찾지 못했습니다. 새로고침 해주세요." });
  // 관리자가 오타를 고쳐 승인할 수 있다.
  const name = cleanName(req.body?.name) || request.name;
  if (registeredUser(request.employee_id)) return res.status(409).json({ success: false, error: "그 사이 이미 등록된 사번입니다. 신청을 거절해주세요." });
  const now = nowKst();
  transaction(() => {
    run(
      `INSERT INTO registered_users (employee_id, name, active, imported_at, source) VALUES (?, ?, 1, ?, 'signup')
       ON CONFLICT(employee_id) DO UPDATE SET name=excluded.name, active=1, imported_at=excluded.imported_at, source='signup'`,
      [request.employee_id, name, now]
    );
    run("UPDATE signup_requests SET status = 'approved', name = ?, resolved_at = ?, resolved_by = ? WHERE id = ?", [name, now, resolverName(req), request.id]);
  });
  // 이름으로만 남아 있던 예전 대여 기록에 사번을 채운다.
  try { backfillRentalEmployeeIds(); } catch (err) { console.error("[signup] backfill", err); }
  res.json({ success: true });
});

signupRouter.post("/admin/signup-requests/:id/reject", requireAdmin, (req, res) => {
  const result = run(
    "UPDATE signup_requests SET status = 'rejected', resolved_at = ?, resolved_by = ? WHERE id = ? AND status = 'pending'",
    [nowKst(), resolverName(req), Number(req.params.id)]
  );
  if (!result?.changes) return res.status(404).json({ success: false, error: "처리할 신청을 찾지 못했습니다. 새로고침 해주세요." });
  res.json({ success: true });
});

/* ── 관리자 계정 가입 신청 ─────────────────────────────────────
 *
 * 대여자와 달리 승인되면 재고 수정·계정 관리까지 되는 계정이 생긴다. 그래서 아무나 신청하지
 * 못하도록, Scenario Manager와 같은 아이디·비밀번호로 실제 로그인되는 경우에만 신청을 받는다
 * (관리자 로그인이 원래 SM 계정과 같다는 전제로 동기화가 돌아간다). 그 위에 기존 관리자의
 * 승인을 한 번 더 거친다.
 *
 * 이 경로는 SM 로그인을 대신 시도해 주는 창구이기도 해서, 남의 SM 비밀번호를 대입해 보는
 * 데 쓰이지 않게 시도 횟수를 제한한다.
 */
const ADMIN_MAX_PENDING = 20;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS_PER_IP = 10;
const MAX_ATTEMPTS_PER_ID = 5;
const attempts = new Map(); // "ip:1.2.3.4" | "id:name" -> 시각 배열

function overLimit(key, max) {
  const now = Date.now();
  const recent = (attempts.get(key) || []).filter((t) => now - t < ATTEMPT_WINDOW_MS);
  if (recent.length >= max) { attempts.set(key, recent); return true; }
  recent.push(now);
  attempts.set(key, recent);
  return false;
}
setInterval(() => {
  const now = Date.now();
  for (const [key, list] of attempts) {
    const recent = list.filter((t) => now - t < ATTEMPT_WINDOW_MS);
    if (recent.length) attempts.set(key, recent); else attempts.delete(key);
  }
}, ATTEMPT_WINDOW_MS).unref();

signupRouter.post("/admin-signup-requests", async (req, res) => {
  try {
    const loginId = String(req.body?.loginId ?? "").trim();
    const password = String(req.body?.password ?? "");
    const name = cleanName(req.body?.name);
    if (!loginId || loginId.length > 50 || /\s/.test(loginId)) return res.status(400).json({ success: false, error: "아이디를 공백 없이 50자 이내로 입력해주세요." });
    if (!password || password.length > 200) return res.status(400).json({ success: false, error: "비밀번호를 입력해주세요." });
    if (name.length < 2 || name.length > 20) return res.status(400).json({ success: false, error: "이름은 2~20자로 입력해주세요." });

    if (overLimit(`ip:${req.ip}`, MAX_ATTEMPTS_PER_IP) || overLimit(`id:${loginId.toLowerCase()}`, MAX_ATTEMPTS_PER_ID)) {
      return res.status(429).json({ success: false, error: "시도가 너무 많습니다. 10분쯤 뒤에 다시 해주세요." });
    }
    if (get("SELECT id FROM admin_users WHERE login_id = ?", [loginId])) {
      return res.status(409).json({ success: false, error: "이미 등록된 관리자 아이디입니다. 관리자 로그인 화면에서 바로 로그인해주세요." });
    }
    if (get("SELECT id FROM admin_signup_requests WHERE login_id = ? AND status = 'pending'", [loginId])) {
      return res.status(409).json({ success: false, error: "이 아이디는 이미 가입 신청이 되어 있습니다. 기존 관리자의 승인을 기다려주세요." });
    }
    if ((get("SELECT COUNT(*) AS c FROM admin_signup_requests WHERE status = 'pending'")?.c || 0) >= ADMIN_MAX_PENDING) {
      return res.status(429).json({ success: false, error: "가입 신청이 밀려 있습니다. 기존 관리자에게 직접 문의해주세요." });
    }

    const check = await verifySmCredentials(loginId, password);
    if (check.unavailable) return res.status(503).json({ success: false, error: "Scenario Manager에 연결할 수 없어 계정을 확인하지 못했습니다. 잠시 뒤에 다시 시도해주세요." });
    if (!check.ok) return res.status(401).json({ success: false, error: "Scenario Manager 계정의 아이디·비밀번호와 일치해야 신청할 수 있습니다." });

    run(
      "INSERT INTO admin_signup_requests (login_id, name, password_hash, status, created_at) VALUES (?, ?, ?, 'pending', ?)",
      [loginId, name, bcrypt.hashSync(password, 10), nowKst()]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("[signup] admin request", err);
    res.status(500).json({ success: false, error: "가입 신청 중 오류가 발생했습니다." });
  }
});

signupRouter.get("/admin/admin-signup-requests", requireAdmin, (req, res) => {
  res.json({
    success: true,
    requests: all("SELECT id, login_id, name, created_at FROM admin_signup_requests WHERE status = 'pending' ORDER BY id"),
  });
});

signupRouter.post("/admin/admin-signup-requests/:id/approve", requireAdmin, (req, res) => {
  const request = get("SELECT * FROM admin_signup_requests WHERE id = ? AND status = 'pending'", [Number(req.params.id)]);
  if (!request) return res.status(404).json({ success: false, error: "처리할 신청을 찾지 못했습니다. 새로고침 해주세요." });
  if (get("SELECT id FROM admin_users WHERE login_id = ?", [request.login_id])) {
    return res.status(409).json({ success: false, error: "그 사이 이미 등록된 아이디입니다. 신청을 거절해주세요." });
  }
  const name = cleanName(req.body?.name) || request.name;
  const now = nowKst();
  transaction(() => {
    run("INSERT INTO admin_users (login_id, password_hash, name) VALUES (?, ?, ?)", [request.login_id, request.password_hash, name]);
    run("UPDATE admin_signup_requests SET status = 'approved', name = ?, password_hash = NULL, resolved_at = ?, resolved_by = ? WHERE id = ?", [name, now, resolverName(req), request.id]);
  });
  res.json({ success: true });
});

signupRouter.post("/admin/admin-signup-requests/:id/reject", requireAdmin, (req, res) => {
  const result = run(
    "UPDATE admin_signup_requests SET status = 'rejected', password_hash = NULL, resolved_at = ?, resolved_by = ? WHERE id = ? AND status = 'pending'",
    [nowKst(), resolverName(req), Number(req.params.id)]
  );
  if (!result?.changes) return res.status(404).json({ success: false, error: "처리할 신청을 찾지 못했습니다. 새로고침 해주세요." });
  res.json({ success: true });
});
