import { Router } from "express";
import { registeredUser } from "../lib/registeredUsers.js";
import { adminFromRequest } from "../lib/auth.js";
import { searchScenarioItems } from "../lib/warehouseSearchService.js";

export const scenarioAiSearchRouter = Router();
const limits = new Map();
scenarioAiSearchRouter.get("/scenario-search", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const user = registeredUser(req.query.employeeId), admin = user ? null : adminFromRequest(req);
    if (!user && !admin) return res.status(401).json({ success: false, error: "대여자 또는 관리자 로그인 후 AI 검색을 사용할 수 있습니다." });
    const q = String(req.query.q || "").trim(), category = String(req.query.category || ""), subcategory = String(req.query.subcategory || ""), request = String(req.query.request || "all");
    if (!q || q.length > 150 || category.length > 200 || subcategory.length > 200 || !["all", "normal"].includes(request)) throw Error("검색어와 필터를 확인해주세요. 검색어는 150자 이내로 입력해주세요.");
    const now = Date.now(), key = `${req.ip}:${user?.employee_id || `admin:${admin.id}`}`;
    for (const [k, value] of limits) if (now - value.start > 10000) limits.delete(k);
    const limit = limits.get(key) || { start: now, count: 0 };
    if (++limit.count > 5) return res.status(429).json({ success: false, error: "잠시 후 AI 검색을 다시 눌러주세요." });
    limits.set(key, limit);
    res.json({ success: true, ...await searchScenarioItems(q, { category, subcategory, request }) });
  } catch (error) { res.status(400).json({ success: false, error: error.message }); }
});
