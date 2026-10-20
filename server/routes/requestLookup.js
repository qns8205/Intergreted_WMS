import { rentalTermsForRow } from '../lib/rentalTerms.js';
import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { get, all } from "../db.js";
import { locationSortIndex } from "../lib/locationSort.js";
import { employeeIdForRentalRow, registeredUser } from "../lib/registeredUsers.js";
import { isReturnStepAutoDone } from "../lib/lookupReturnFlow.js";
import { workdayDateKey, returnedThisWorkday } from "../lib/workday.js";
import { httpsConfig } from "../lib/httpsConfig.js";
import { scenarioVariantInfo } from "../lib/scenarioVariantDisplay.js";
import { hiddenReservationQrRows } from "../lib/reservationQrVisibility.js";
import { expireReservations } from "../lib/reservationExpiry.js";
import { lookupItemLocations } from "../lib/lookupItemLocations.js";

export const requestLookupRouter = Router();
export const REQUEST_LOOKUP_PATH = process.env.QR_LOOKUP_PATH || "/pickup/4e91c7b2a860";
// 이번 근무일 처리 내역은 메인 화면의 '내 대여 조회'로 옮겼다. QR 페이지가 그곳 주소를 안내한다.
export const MAIN_APP_URL = process.env.WMS_MAIN_URL || (httpsConfig.enabled ? `${httpsConfig.origin}/` : "http://192.168.100.152:3000/");
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

function lookupEmployee(employeeId) {
  const user = registeredUser(employeeId);
  if (!user) return { found: false, items: [] };
  const workday = workdayDateKey();
  const nowMs = Date.now();
  const items = [];
  const scenarioRows = all("SELECT * FROM sid_rentals ORDER BY id");
  const generalRows = all("SELECT * FROM general_rentals ORDER BY id");
  const hiddenReservations = hiddenReservationQrRows(user.employee_id,{scenarioRows,generalRows});
  for (const row of scenarioRows) {
    if (employeeIdForRentalRow(row) !== user.employee_id) continue;
    if (hiddenReservations.has(`scenario:${row.id}`)) continue;
    if (row.returned === "O" && !returnedThisWorkday(row, workday)) continue;
    const parsed = parseItemLabel(row.item_label);
    if (!parsed.id && !parsed.name) continue;
    const { object, variant } = itemDetails(parsed.id, row.variant_id);
    items.push({ key: `scenario:${row.id}:${parsed.quantity}:${row.variant_id || 0}`, id: parsed.id, name: parsed.name || object?.name || "물품", quantity: parsed.quantity,
      location: object?.root_slot || "", image: object?.image_path || "", ...scenarioVariantInfo(parsed.id, row),
      scenarioId: row.sid || "", pickedUp: !!row.picked_up_at, returned: row.returned === "O", cancelled: row.return_source === "cancel" || (row.returned === "O" && !row.return_source && !row.picked_up_at), borrowDate: row.applied_at || row.borrow_date || "",
      returnDate: row.return_date || "", returnSource: row.return_source || "", eventType: row.returned === "O" ? "return" : "borrow",
      returnStepAutoDone: row.returned === "O" && isReturnStepAutoDone(row.return_date, nowMs),
      eventTime: row.returned === "O" ? (row.return_date || "") : (row.applied_at || row.borrow_date || ""),
      typeLimitExempt: row.type_limit_exempt === "Y", typeLimitExemptReason: row.type_limit_exempt_reason || "", rentalTerms:rentalTermsForRow(row) });
  }
  for (const row of generalRows) {
    if (employeeIdForRentalRow(row) !== user.employee_id) continue;
    // 화면에서만 가리지 않고 응답에서도 물품·사진·위치를 제외한다.
    if (hiddenReservations.has(`general:${row.id}`)) continue;
    if (row.returned === "O" && !returnedThisWorkday(row, workday)) continue;
    const id = padId(row.item_id);
    const { object, variant } = itemDetails(id, row.variant_id);
    items.push({ key: `general:${row.id}:${Number(row.qty) || 1}:${row.variant_id || 0}`, id, name: row.item_label || object?.name || "물품", quantity: Number(row.qty) || 1,
      location: object?.root_slot || "", image: object?.image_path || "", ...scenarioVariantInfo(id, row),
      scenarioId: "", pickedUp: !!row.picked_up_at, returned: row.returned === "O", cancelled: row.return_source === "cancel" || (row.returned === "O" && !row.return_source && !row.picked_up_at), borrowDate: row.applied_at || row.borrow_date || "",
      returnDate: row.return_date || "", returnSource: row.return_source || "", eventType: row.returned === "O" ? "return" : "borrow",
      returnStepAutoDone: row.returned === "O" && isReturnStepAutoDone(row.return_date, nowMs),
      eventTime: row.returned === "O" ? (row.return_date || "") : (row.applied_at || row.borrow_date || ""),
      typeLimitExempt: row.type_limit_exempt === "Y", typeLimitExemptReason: row.type_limit_exempt_reason || "", rentalTerms:rentalTermsForRow(row) });
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
  res.type("html").send(htmlTemplate.replaceAll("__LOOKUP_PATH__", REQUEST_LOOKUP_PATH).replaceAll("__MAIN_APP_URL__", MAIN_APP_URL));
});

requestLookupRouter.get(`${REQUEST_LOOKUP_PATH}/api`, rateLimit, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const value = String(req.query.employeeId || req.query.no || "").trim();
  if (!/^\d{4}$/.test(value)) return res.status(400).json({ success: false, error: "4자리 사번을 확인해주세요." });
  try {
    expireReservations();
    res.json({ success: true, ...lookupEmployee(value) });
  } catch (error) {
    console.error("[request-lookup]", error);
    res.status(500).json({ success: false, error: "조회 중 오류가 발생했습니다." });
  }
});

requestLookupRouter.get(`${REQUEST_LOOKUP_PATH}/item-locations`, rateLimit, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const employeeId = String(req.query.employeeId || '').trim();
  if (!/^\d{4}$/.test(employeeId) || !registeredUser(employeeId)) return res.status(400).json({ success: false, error: '사번을 먼저 조회해 주세요.' });
  const query = String(req.query.q || '').trim();
  if (!query || query.length > 80) return res.status(400).json({ success: false, error: '물품 이름을 80자 이내로 입력해 주세요.' });
  try {
    const scenarioRows = all('SELECT * FROM sid_rentals'), generalRows = all('SELECT * FROM general_rentals');
    const hidden = hiddenReservationQrRows(employeeId, { scenarioRows, generalRows });
    const hiddenScenarioIds = new Set([
      ...scenarioRows.filter((row) => hidden.has(`scenario:${row.id}`)).map((row) => parseItemLabel(row.item_label).id),
      ...generalRows.filter((row) => hidden.has(`general:${row.id}`)).map((row) => padId(row.item_id)),
    ]);
    res.json({ success: true, ...lookupItemLocations(query, { hiddenScenarioIds }) });
  }
  catch (error) {
    console.error('[lookup-item-locations]', error);
    res.status(500).json({ success: false, error: '물품 위치를 찾지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  }
});
