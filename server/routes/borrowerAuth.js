import { Router, json } from "express";
import { registeredUser } from "../lib/registeredUsers.js";
import { verifySmLogin } from "../lib/smLogin.js";
import { httpsConfig, borrowerAuthRequired } from "../lib/httpsConfig.js";
import { assertBorrowerOrigin, borrowerFromRequest, issueBorrower, revokeBorrower } from "../lib/borrowerAuth.js";

export function createBorrowerAuthRouter({ verify = verifySmLogin, required = borrowerAuthRequired, config = httpsConfig } = {}) {
  const router = Router();
  const attempts = new Map();
  const inFlight = new Set();
  router.use("/borrower-auth", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.get("/borrower-auth/config", (_req, res) => res.json({ success: true, required: required(), httpsOrigin: config.origin || "", qrOrigin: config.qrOrigin || "" }));
  router.get("/borrower-auth/session", (req, res) => res.json({ success: true, required: required(), user: borrowerFromRequest(req) }));
  router.post("/borrower-auth/logout", (req, res) => {
    try { assertBorrowerOrigin(req); revokeBorrower(req, res); res.json({ success: true }); }
    catch { res.status(403).json({ success: false, error: "로그아웃 요청을 확인해주세요." }); }
  });
  router.post("/borrower-auth/login", json({ limit: "4kb" }), async (req, res) => {
    // 프록시의 X-Forwarded-Proto를 믿지 않는다. 실제 TLS 연결만 허용한다.
    if (!req.socket.encrypted) return res.status(426).json({ success: false, error: "HTTPS 주소에서 로그인해주세요." });
    if (!required()) return res.status(503).json({ success: false, error: "SM 인증 설정이 완료되지 않았습니다." });
    const employeeId = String(req.body?.employeeId || "").trim();
    let password = typeof req.body?.password === "string" ? req.body.password : "";
    let ownsAttempt = false;
    if (req.body) delete req.body.password;
    try {
      assertBorrowerOrigin(req);
      if (!/^\d{4}$/.test(employeeId) || !password || password.length > 512) return res.status(400).json({ success: false, error: "사번과 SM 비밀번호를 확인해주세요." });
      const now = Date.now();
      for (const [key, value] of attempts) if (now - value.at > 10 * 60000) attempts.delete(key);
      const keys = [`ip:${req.ip}`, `id:${employeeId}`];
      if (keys.some((key) => (attempts.get(key)?.count || 0) >= (key.startsWith("id:") ? 10 : 30)) || inFlight.has(employeeId)) return res.status(429).json({ success: false, error: "인증 시도가 많습니다. 잠시 후 다시 시도해주세요." });
      for (const key of keys) { const value = attempts.get(key) || { at: now, count: 0 }; value.count++; attempts.set(key, value); }
      inFlight.add(employeeId);
      ownsAttempt = true;
      const user = registeredUser(employeeId);
      const result = await verify(employeeId, password);
      password = "";
      if (result.unavailable) return res.status(503).json({ success: false, error: "SM에 연결할 수 없습니다. 잠시 후 다시 시도해주세요." });
      if (!result.ok) return res.status(401).json({ success: false, error: "사번 또는 SM 비밀번호가 맞지 않습니다." });
      // 비밀번호는 맞았으니 본인이다. 명부에 없는 신규 사원이면 가입하도록 안내한다.
      if (!user) return res.status(403).json({ success: false, unregistered: true, error: "WMS에 아직 등록되지 않은 사번입니다. 아래 '가입하기'로 가입한 뒤 다시 로그인해주세요." });
      issueBorrower(req, res, employeeId);
      attempts.delete(`id:${employeeId}`);
      res.json({ success: true, user: { name: user.name, employeeId: user.employee_id, affiliation: "cfgw" } });
    } catch { res.status(403).json({ success: false, error: "인증 요청을 확인해주세요." }); }
    finally { password = ""; if (ownsAttempt) inFlight.delete(employeeId); }
  });
  return router;
}
export const borrowerAuthRouter = createBorrowerAuthRouter();
