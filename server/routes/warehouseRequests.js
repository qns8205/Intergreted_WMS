import { Router } from "express";
import { requireAdmin } from "../lib/auth.js";
import { recordWarehouseManualRequest, pendingWarehouseManualRequests, resolveWarehouseManualRequest, outstandingWarehouseTools, returnWarehouseTools } from "../lib/warehouseManualRequests.js";
import { unattendedEnabled } from "../lib/unattendedPenalties.js";
import { registeredUser } from "../lib/registeredUsers.js";
import { searchWarehouseTools, suggestWarehouseTools } from "../lib/warehouseSearchService.js";

export const warehouseRequestsRouter = Router();
const searchLimits = new Map();
const suggestLimits = new Map();
// 타자를 칠 때마다 부르므로 AI 검색보다 넉넉하게 둔다.
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
warehouseRequestsRouter.get("/warehouse-requests/search", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (!unattendedEnabled()) throw Error("현재 무인 모드가 아닙니다.");
    const user = registeredUser(req.query.employeeId);
    if (!user) throw Error("등록된 사번을 확인해주세요.");
    const query = String(req.query.q || "").trim();
    if (!query || query.length > 150) throw Error("찾을 공구 이름을 150자 이내로 입력해주세요.");
    const now = Date.now(), key = `${req.ip}:${user.employee_id}`;
    for (const [k, value] of searchLimits) if (now - value.start > 10000) searchLimits.delete(k);
    const limit = searchLimits.get(key) || { start: now, count: 0 };
    if (++limit.count > 5) return res.status(429).json({ success: false, error: "잠시 후 AI 검색을 다시 눌러주세요." });
    searchLimits.set(key, limit);
    res.json({ success: true, ...await searchWarehouseTools(query) });
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
