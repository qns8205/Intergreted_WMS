import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { get, all } from "../db.js";
import { locationVisibility } from "../lib/locationVisibility.js";

export const locationLookupRouter = Router();
const here = path.dirname(fileURLToPath(import.meta.url));
const htmlTemplate = fs.readFileSync(path.resolve(here, "../../location-lookup/public/index.html"), "utf8");

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

/** 토큰이 가리키는 신청(request_no)에 속한 모든 대여 행(쪼개진 부분 확인/반납 행 포함)을 찾아
 *  각 행이 지금 위치를 보여줘도 되는 상태인지 판정한다. */
function itemsForToken(requestNo) {
  const items = [];
  for (const row of all("SELECT * FROM sid_rentals WHERE request_no = ? ORDER BY id", [requestNo])) {
    const parsed = parseItemLabel(row.item_label);
    if (!parsed.id && !parsed.name) continue;
    const { object, variant } = itemDetails(parsed.id, row.variant_id);
    const visibility = locationVisibility(row);
    items.push({
      name: parsed.name || object?.name || "물품", quantity: parsed.quantity,
      scenarioId: row.sid || "", variantName: variant?.name || "",
      visible: visibility.visible, location: visibility.visible ? (object?.root_slot || "") : undefined,
      message: visibility.message,
    });
  }
  for (const row of all("SELECT * FROM general_rentals WHERE request_no = ? ORDER BY id", [requestNo])) {
    const id = padId(row.item_id);
    const { object, variant } = itemDetails(id, row.variant_id);
    const visibility = locationVisibility(row);
    items.push({
      name: row.item_label || object?.name || "물품", quantity: Number(row.qty) || 1,
      scenarioId: "", variantName: variant?.name || "",
      visible: visibility.visible, location: visibility.visible ? (object?.root_slot || "") : undefined,
      message: visibility.message,
    });
  }
  return items;
}

locationLookupRouter.get("/loc/:token", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'");
  res.type("html").send(htmlTemplate);
});

locationLookupRouter.get("/loc/:token/api", rateLimit, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const token = String(req.params.token || "").trim();
  if (!token) return res.status(400).json({ success: false, error: "유효하지 않은 QR입니다." });
  try {
    const issued = get("SELECT * FROM location_tokens WHERE token = ?", [token]);
    // 존재 여부 자체를 흘리지 않는다 — 없는 토큰이든 만료된 토큰이든 같은 메시지만 준다.
    if (!issued) return res.status(404).json({ success: false, error: "유효하지 않거나 만료된 QR입니다." });
    const items = itemsForToken(issued.request_no);
    res.json({ success: true, borrowerName: issued.borrower_name || "", items });
  } catch (error) {
    console.error("[location-lookup]", error);
    res.status(500).json({ success: false, error: "조회 중 오류가 발생했습니다." });
  }
});
