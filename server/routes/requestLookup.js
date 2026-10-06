import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { get, all } from "../db.js";
import { locationSortIndex } from "../lib/locationSort.js";
import { employeeIdForRentalRow, registeredUser } from "../lib/registeredUsers.js";
import { isReturnStepAutoDone } from "../lib/lookupReturnFlow.js";

export const requestLookupRouter = Router();
export const REQUEST_LOOKUP_PATH = process.env.QR_LOOKUP_PATH || "/pickup/4e91c7b2a860";
const here = path.dirname(fileURLToPath(import.meta.url));
const htmlTemplate = fs.readFileSync(path.resolve(here, "../../request-lookup/public/index.html"), "utf8");

const requestsByIp = new Map();
setInterval(() => requestsByIp.clear(), 60_000).unref();
function rateLimit(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const count = (requestsByIp.get(ip) || 0) + 1;
  requestsByIp.set(ip, count);
  if (count > 30) return res.status(429).json({ success: false, error: "잠시 후 다시 시도해주세요." });
  next();
}

function padId(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits ? digits.padStart(6, "0") : "";
}

function parseItemLabel(label) {
  const text = String(label || "").trim();
  const idMatch = /^\[(\d+)\]\s*(.*)$/.exec(text);
  let id = "", rest = text;
  if (idMatch) { id = idMatch[1]; rest = idMatch[2]; }
  const qtyMatch = /\s*[x×]\s*(\d+)\s*$/i.exec(rest);
  let quantity = 1, name = rest;
  if (qtyMatch) { quantity = Number(qtyMatch[1]) || 1; name = rest.slice(0, qtyMatch.index); }
  return { id: padId(id), name: name.trim(), quantity };
}

function itemDetails(id, variantId) {
  const object = id ? get("SELECT name, root_slot, image_path FROM scenario_items WHERE id = ?", [id]) : null;
  const variant = variantId ? get("SELECT name FROM scenario_item_variants WHERE id = ?", [variantId]) : null;
  return { object, variant };
}

const WORKDAY_CUTOFF_HOUR = 1;

function kstDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "").slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

/**
 * QR 조회에서 쓰는 '하루'는 달력 날짜가 아니라 근무일이다.
 * 야간 근무가 끝나는 한국 시간 오전 1시 전까지는 전날 근무분으로 묶는다.
 */
function workdayDateKey(value = new Date()) {
  const raw = String(value ?? "").trim();
  const local = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
  const date = local
    ? new Date(`${local[1]}T${local[2]}:${local[3]}:${local[4] || "00"}+09:00`)
    : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return raw.slice(0, 10);
  return kstDateKey(new Date(date.getTime() - WORKDAY_CUTOFF_HOUR * 60 * 60 * 1000));
}

function returnedThisWorkday(row, workday) {
  if (row.returned !== "O" || !row.return_date) return false;
  return workdayDateKey(row.return_date) === workday;
}

function lookupEmployee(employeeId) {
  const user = registeredUser(employeeId);
  if (!user) return { found: false, items: [] };
  const workday = workdayDateKey();
  const nowMs = Date.now();
  const items = [];
  for (const row of all("SELECT * FROM sid_rentals ORDER BY id")) {
    if (employeeIdForRentalRow(row) !== user.employee_id) continue;
    if (row.returned === "O" && !returnedThisWorkday(row, workday)) continue;
    const parsed = parseItemLabel(row.item_label);
    if (!parsed.id && !parsed.name) continue;
    const { object, variant } = itemDetails(parsed.id, row.variant_id);
    items.push({ key: `scenario:${row.id}:${parsed.quantity}:${row.variant_id || 0}`, id: parsed.id, name: parsed.name || object?.name || "물품", quantity: parsed.quantity,
      location: object?.root_slot || "", image: object?.image_path || "", variantName: variant?.name || "",
      scenarioId: row.sid || "", pickedUp: !!row.picked_up_at, returned: row.returned === "O", cancelled: row.return_source === "cancel" || (row.returned === "O" && !row.return_source && !row.picked_up_at), borrowDate: row.applied_at || row.borrow_date || "",
      returnDate: row.return_date || "", returnSource: row.return_source || "", eventType: row.returned === "O" ? "return" : "borrow",
      returnStepAutoDone: row.returned === "O" && isReturnStepAutoDone(row.return_date, nowMs),
      eventTime: row.returned === "O" ? (row.return_date || "") : (row.applied_at || row.borrow_date || ""),
      typeLimitExempt: row.type_limit_exempt === "Y", typeLimitExemptReason: row.type_limit_exempt_reason || "" });
  }
  for (const row of all("SELECT * FROM general_rentals ORDER BY id")) {
    if (employeeIdForRentalRow(row) !== user.employee_id) continue;
    if (row.returned === "O" && !returnedThisWorkday(row, workday)) continue;
    const id = padId(row.item_id);
    const { object, variant } = itemDetails(id, row.variant_id);
    items.push({ key: `general:${row.id}:${Number(row.qty) || 1}:${row.variant_id || 0}`, id, name: row.item_label || object?.name || "물품", quantity: Number(row.qty) || 1,
      location: object?.root_slot || "", image: object?.image_path || "", variantName: variant?.name || "",
      scenarioId: "", pickedUp: !!row.picked_up_at, returned: row.returned === "O", cancelled: row.return_source === "cancel" || (row.returned === "O" && !row.return_source && !row.picked_up_at), borrowDate: row.applied_at || row.borrow_date || "",
      returnDate: row.return_date || "", returnSource: row.return_source || "", eventType: row.returned === "O" ? "return" : "borrow",
      returnStepAutoDone: row.returned === "O" && isReturnStepAutoDone(row.return_date, nowMs),
      eventTime: row.returned === "O" ? (row.return_date || "") : (row.applied_at || row.borrow_date || ""),
      typeLimitExempt: row.type_limit_exempt === "Y", typeLimitExemptReason: row.type_limit_exempt_reason || "" });
  }
  // 화면에서 시각별로 묶되, 같은 묶음 안에서는 창고의 실제 이동 동선 순서로 보여준다.
  items.sort((a, b) => {
    if (a.eventType !== b.eventType) return a.eventType === "borrow" ? -1 : 1;
    const byTime = String(b.eventTime || "").localeCompare(String(a.eventTime || ""));
    return byTime || locationSortIndex(a.location) - locationSortIndex(b.location);
  });
  // QR의 대여 동선에는 아직 관리자가 대여 확인하지 않은 물품만 남긴다.
  // picked_up_at이 찍히는 즉시 다음 조회/자동 새로고침에서 대여 탭에서 사라진다.
  const activeCount = items.filter((item) => !item.returned && !item.pickedUp).length;
  const returnedTodayCount = items.filter((item) => item.returned && !item.cancelled).length;
  const cancelledTodayCount = items.filter((item) => item.cancelled).length;
  return { found: true, employeeId: user.employee_id, borrowerName: user.name,
    status: activeCount ? "active" : returnedTodayCount ? "returnedToday" : cancelledTodayCount ? "cancelledToday" : "empty",
    activeCount, returnedTodayCount, cancelledTodayCount, items };
}

requestLookupRouter.get(REQUEST_LOOKUP_PATH, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'");
  res.type("html").send(htmlTemplate.replaceAll("__LOOKUP_PATH__", REQUEST_LOOKUP_PATH));
});

requestLookupRouter.get(`${REQUEST_LOOKUP_PATH}/api`, rateLimit, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const value = String(req.query.employeeId || req.query.no || "").trim();
  if (!/^\d{4}$/.test(value)) return res.status(400).json({ success: false, error: "4자리 사번을 확인해주세요." });
  try {
    res.json({ success: true, ...lookupEmployee(value) });
  } catch (error) {
    console.error("[request-lookup]", error);
    res.status(500).json({ success: false, error: "조회 중 오류가 발생했습니다." });
  }
});
