import { Router } from "express";
import { requireAdmin, adminFromRequest } from "../lib/auth.js";
import { kioskUserFromRequest } from "../lib/unattendedKiosk.js";
import { recordWarehouseManualRequest, pendingWarehouseManualRequests, resolveWarehouseManualRequest, outstandingWarehouseTools, returnWarehouseTools } from "../lib/warehouseManualRequests.js";
import { unattendedEnabled } from "../lib/unattendedPenalties.js";
import { registeredUser } from "../lib/registeredUsers.js";
import { suggestWarehouseTools } from "../lib/warehouseToolSuggestions.js";

export const warehouseRequestsRouter = Router();
warehouseRequestsRouter.use("/warehouse-requests", (req, res, next) => {
  const admin = adminFromRequest(req);
  try {
    // 공구 대여·반납은 무인 PC(무인 모드인 관리자 PC)에서만 한다. 휴대폰 등 다른 곳에서는 받지 않는다.
    // 무인 PC에서 사번·SM 비밀번호로 로그인한 사람이면 그 사번으로만 처리한다.
    if (admin) return next();
    const kiosk = kioskUserFromRequest(req);
    if (!kiosk) return res.status(403).json({ success: false, error: "공구 대여·반납은 무인 PC에서 사번과 SM 비밀번호로 로그인한 뒤에만 할 수 있습니다." });
    const values = req.method === "GET" ? req.query : (req.body || {});
    if (values.employeeId && String(values.employeeId).trim() !== kiosk.employeeId) throw Error("다른 사번으로 요청할 수 없습니다.");
    values.employeeId = kiosk.employeeId;
    next();
  } catch (error) { res.status(401).json({ success: false, error: error.message }); }
});
const suggestLimits = new Map();
// 타자를 칠 때마다 호출하는 일반 이름·키워드 후보 조회.
warehouseRequestsRouter.get("/warehouse-requests/suggest", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (!unattendedEnabled()) throw Error("현재 무인 모드가 아닙니다.");
    const user = registeredUser(req.query.employeeId);
    if (!user) throw Error("등록된 사번을 확인해주세요.");
    const query = String(req.query.q || "").trim();
    if (!query || query.length > 150) return res.json({ success: true, items: [] });
    const now = Date.now(), key = `${req.ip}:${user.employee_id}`;
    for (const [k, value] of suggestLimits) if (now - value.start > 10000) suggestLimits.delete(k);
    const limit = suggestLimits.get(key) || { start: now, count: 0 };
    if (++limit.count > 60) return res.status(429).json({ success: false, error: "잠시 후 다시 입력해주세요." });
    suggestLimits.set(key, limit);
    res.json({ success: true, items: suggestWarehouseTools(query) });
  } catch (error) { res.status(400).json({ success: false, error: error.message }); }
});
warehouseRequestsRouter.get("/warehouse-requests/mine", (req, res) => {
  try {
    if (!unattendedEnabled()) throw Error("현재 무인 모드가 아닙니다.");
    res.json({ success: true, ...outstandingWarehouseTools(req.query.employeeId) });
  } catch (error) { res.status(400).json({ success: false, error: error.message }); }
});
warehouseRequestsRouter.post("/warehouse-requests/return", async (req, res) => {
  try { res.json({ success: true, ...await returnWarehouseTools(req.body || {}) }); }
  catch (error) { res.status(400).json({ success: false, error: error.message }); }
});
warehouseRequestsRouter.post("/warehouse-requests", async (req, res) => {
  try { res.json({ success: true, ...await recordWarehouseManualRequest(req.body || {}) }); }
  catch (error) { res.status(400).json({ success: false, error: error.message }); }
});
warehouseRequestsRouter.get("/warehouse-requests", requireAdmin, (_req, res) => res.json({ success: true, items: pendingWarehouseManualRequests() }));
warehouseRequestsRouter.post("/warehouse-requests/:id/resolve", requireAdmin, (req, res) => {
  try { res.json({ success: true, ...resolveWarehouseManualRequest(req.params.id, req.body?.itemId, req.admin.name || req.admin.loginId) }); }
  catch (error) { res.status(400).json({ success: false, error: error.message }); }
});
