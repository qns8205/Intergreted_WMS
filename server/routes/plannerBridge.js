import { Router, json } from "express";
import crypto from "node:crypto";
import { plannerBridgeKey } from "../lib/plannerConnection.js";
import { all, get } from "../db.js";
import { padSlot, parseItemLabel, variantMap } from "../lib/borrowUtils.js";
import { employeeIdForRentalRow, registeredUser } from "../lib/registeredUsers.js";
import { createReservations, cancelReservation } from "../lib/itemReservations.js";
import { expireReservations } from "../lib/reservationExpiry.js";

// 촬영 플래너(별도 앱)가 WMS에 들어오는 좁은 문.
// - 재고·종류·명부·좌석을 읽고,
// - 플래너 앱이 SM 비밀번호로 본인 확인을 마친 촬영자의 루틴 대여 신청을 일반 대여로 넣고, 그 상태를 읽는다.
// - 같은 루틴을 정한 시각에 빌리도록 WMS 예약 대여로 넣고(시각이 되면 WMS가 대여로 바꾼다), 그 상태를 읽거나 취소한다.
// 서버끼리만 쓰는 키가 맞아야 하며, 키가 설정되지 않으면 전부 닫힌다.
// 키는 환경 변수 PLANNER_BRIDGE_KEY, 없으면 server/data/planner-bridge.key 파일(서비스 설정을 고치지 않고 넣을 수 있다)에서 읽는다.

const PLAN_OPTION = "촬영 계획";

function requireBridgeKey(req, res, next) {
  const expected = plannerBridgeKey();
  if (expected.length < 24) return res.status(503).json({ success: false, error: "WMS에 PLANNER_BRIDGE_KEY가 설정되어 있지 않습니다." });
  const given = String(req.header("x-planner-key") || "");
  const a = crypto.createHash("sha256").update(given).digest(), b = crypto.createHash("sha256").update(expected).digest();
  if (!crypto.timingSafeEqual(a, b)) return res.status(401).json({ success: false, error: "플래너 연결 키가 맞지 않습니다." });
  next();
}

function lineState(row) {
  if (row.return_source === "cancel") return "cancelled";
  if (row.returned === "O") return "returned";
  if (row.picked_up_at) return "pickedUp";
  if (row.confirmed_at) return "confirmed";
  return "requested";
}
export function rentalSummary(requestNo) {
  const rows = all("SELECT returned, return_source, confirmed_at, picked_up_at FROM general_rentals WHERE request_no = ?", [requestNo]);
  const counts = { requested: 0, confirmed: 0, pickedUp: 0, returned: 0, cancelled: 0 };
  for (const r of rows) counts[lineState(r)]++;
  const live = rows.length - counts.cancelled;
  const state = !rows.length || !live ? "cancelled"
    : counts.returned === live ? "returned"
    : counts.pickedUp + counts.returned === live ? "pickedUp"
    : counts.confirmed + counts.pickedUp + counts.returned === live ? "confirmed" : "requested";
  return { requestNo, state, counts, lines: rows.length };
}

function reservationStates(ids) {
  if (!ids.length) return {};
  const rows = all(`SELECT id, status, request_no, starts_at_ms, promotion_error FROM item_reservations WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
  return Object.fromEntries(rows.map((r) => [r.id, { id: r.id, status: r.status, requestNo: r.request_no || null, startsAt: new Date(r.starts_at_ms).toISOString(), error: r.promotion_error || "" }]));
}

export function createPlannerBridgeRouter({ recordBorrow, getActiveItemTypeCount }) {
  const router = Router();
  router.use("/planner-bridge", requireBridgeKey, (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

  // 물품과 종류별 선반 재고. ids를 비우면 전체.
  // image: WMS에 올린 사진 경로(/uploads/...). 플래너가 서버에서 받아 종류 고르기 화면에 보여 준다.
  router.get("/planner-bridge/items", (req, res) => {
    const ids = String(req.query.ids || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 2000).map(padSlot);
    const rows = ids.length
      ? all(`SELECT id, name, stock, rented, sector, root_slot, image_path FROM scenario_items WHERE id IN (${ids.map(() => "?").join(",")})`, ids)
      : all("SELECT id, name, stock, rented, sector, root_slot, image_path FROM scenario_items");
    const variants = variantMap();
    const items = {};
    const uploaded = (p) => (String(p || "").startsWith("/uploads/") ? p : "");
    for (const r of rows) {
      items[r.id] = {
        id: r.id, name: r.name || "", stock: Number(r.stock) || 0, rented: Number(r.rented) || 0,
        location: [r.sector, r.root_slot].filter(Boolean).join(" · "), image: uploaded(r.image_path),
        variants: (variants[r.id] || []).map((v) => ({ id: v.id, name: v.name, stock: v.stock, rented: v.rented, image: uploaded(v.image) })),
      };
    }
    res.json({ success: true, items, at: new Date().toISOString() });
  });

  // 대여 명부(사번·이름). 플래너의 담당자 고르기와 이름 표시에 쓴다.
  router.get("/planner-bridge/people", (_req, res) => {
    res.json({ success: true, people: all("SELECT employee_id AS employeeId, name FROM registered_users WHERE active = 1 ORDER BY name") });
  });

  // 좌석 배치도(층·유닛, 종류 한도 제외 여부).
  router.get("/planner-bridge/seats", (_req, res) => {
    let floors = [];
    try { floors = JSON.parse(get("SELECT value FROM settings WHERE key='floor_plan'")?.value || "{}").floors || []; } catch { floors = []; }
    res.json({ success: true, floors: floors.map((f) => ({ id: f.id, name: f.name || f.id, units: (f.units || []).map((u) => ({ label: u.label, exempt: !!u.exempt })) })), typeLimit: Number(get("SELECT value FROM settings WHERE key='max_item_types_default'")?.value) || 0 });
  });

  // 루틴 대여 신청. 사번은 플래너 앱이 SM으로 확인한 본인이다.
  router.post("/planner-bridge/rentals", json({ limit: "64kb" }), async (req, res) => {
    try {
      const b = req.body || {};
      const user = registeredUser(String(b.employeeId || ""));
      if (!user) return res.status(400).json({ success: false, error: "WMS 명부에 없는 사번입니다." });
      const floor = String(b.floor || "").trim(), unit = String(b.unit || "").trim();
      if (!floor || !unit) return res.status(400).json({ success: false, error: "좌석(층·유닛)을 먼저 정해주세요." });
      const borrowedItems = (Array.isArray(b.items) ? b.items : []).map((i) => ({
        id: padSlot(i.id), name: String(i.name || ""), quantity: Math.max(1, Math.min(999, Math.round(Number(i.quantity) || 1))),
        variantId: Number(i.variantId) || undefined,
      })).filter((i) => /^\d{6}$/.test(i.id));
      if (!borrowedItems.length) return res.status(400).json({ success: false, error: "대여할 물품이 없습니다." });
      // 종류 수 한도는 WMS 대여 화면과 같은 기준이다.
      // 플래너가 '이 신청과 함께 반납할 물품'(returning)을 알려 주면 그 종류는 빼고 센다 — 신청을 먼저 넣고 반납은 곧 하되,
      // 반납한 뒤에도 한도를 넘으면 막는다. 플래너는 반납이 WMS에서 확인되기 전에는 촬영 단계로 넘기지 않는다.
      const active = getActiveItemTypeCount({ query: { name: user.name, employeeId: user.employee_id, affiliation: "cfgw", floor, unit } });
      const returning = new Set((Array.isArray(b.returning) ? b.returning : []).slice(0, 100).map((id) => padSlot(String(id || ""))).filter((id) => /^\d{6}$/.test(id)));
      const types = new Set([...active.items.map((i) => padSlot(i.id || "")).filter((id) => id && !returning.has(id)), ...borrowedItems.map((i) => i.id)]);
      if (!active.exempt && Number.isFinite(active.max) && types.size > active.max) {
        return res.status(409).json({ success: false, error: `대여 종류 한도(${active.max}종)를 넘습니다. 지금 ${active.count}종을 빌려 두었으니, 이전 루틴 물품을 먼저 반납해주세요.` });
      }
      const result = await recordBorrow({
        planner: true,
        admin: false,
        payload: { borrowList: [{
          itemType: "general", borrowerName: user.name, employeeId: user.employee_id, affiliation: "cfgw",
          borrowedItems, generalOption: PLAN_OPTION, borrowPurpose: String(b.purpose || PLAN_OPTION).slice(0, 200),
          floor, unit, requestRental: { mode: "general" },
        }] },
      });
      if (result.success === false || !result.requestNo) return res.status(409).json({ success: false, error: result.message || "대여 신청에 실패했습니다." });
      res.json({ success: true, requestNo: result.requestNo, message: result.message, pickupTimeoutMinutes: result.pickupTimeoutMinutes, rental: rentalSummary(result.requestNo) });
    } catch (e) {
      res.status(400).json({ success: false, error: e.message || "대여 신청에 실패했습니다." });
    }
  });

  // 루틴 예약 대여. 시각·재고·종류 확인은 WMS 예약과 같다(오늘부터 다음날 01:00까지, 분 단위).
  router.post("/planner-bridge/reservations", json({ limit: "64kb" }), (req, res) => {
    try {
      const b = req.body || {};
      const user = registeredUser(String(b.employeeId || ""));
      if (!user) return res.status(400).json({ success: false, error: "WMS 명부에 없는 사번입니다." });
      const floor = String(b.floor || "").trim(), unit = String(b.unit || "").trim();
      if (!floor || !unit) return res.status(400).json({ success: false, error: "좌석(층·유닛)을 먼저 정해주세요." });
      const items = (Array.isArray(b.items) ? b.items : []).map((i) => ({
        id: padSlot(i.id), variantId: Number(i.variantId) || 0, quantity: Math.max(1, Math.min(999, Math.round(Number(i.quantity) || 1))),
      })).filter((i) => /^\d{6}$/.test(i.id));
      if (!items.length) return res.status(400).json({ success: false, error: "예약할 물품이 없습니다." });
      const { ids } = createReservations(user.employee_id, { floor, unit, clientId: String(b.clientId || ""), startsAt: String(b.startsAt || ""), items, requestRental: { mode: "general" } }, Date.now(), {planner:true});
      res.json({ success: true, ids, reservations: reservationStates(ids) });
    } catch (e) {
      res.status(409).json({ success: false, error: e.message || "예약 대여 신청에 실패했습니다." });
    }
  });
  // 예약 번호들의 상태. 시각이 되어 대여로 바뀌면 requestNo가 생긴다.
  router.get("/planner-bridge/reservations", (req, res) => {
    const ids = String(req.query.ids || "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 500);
    expireReservations();
    res.json({ success: true, reservations: reservationStates(ids) });
  });
  // 본인 예약 취소(아직 받지 않은 것만).
  router.post("/planner-bridge/reservations/cancel", json({ limit: "16kb" }), (req, res) => {
    const b = req.body || {};
    const user = registeredUser(String(b.employeeId || ""));
    if (!user) return res.status(400).json({ success: false, error: "WMS 명부에 없는 사번입니다." });
    const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 100);
    const errors = [];
    for (const id of ids) { try { cancelReservation(user.employee_id, id); } catch (e) { errors.push(e.message); } }
    const states = reservationStates(ids);
    // 이미 취소·만료된 줄은 실패로 치지 않는다.
    const live = Object.values(states).filter((r) => r.status === "reserved");
    if (live.length) return res.status(409).json({ success: false, error: errors[0] || "예약을 취소하지 못했습니다.", reservations: states });
    res.json({ success: true, reservations: states });
  });

  // 물품을 지금 누가 들고 있는지(아직 반납하지 않은 대여 줄). 플래너가 양도를 부탁할 사람을 고를 때 쓴다.
  router.get("/planner-bridge/holdings", (req, res) => {
    const ids = new Set(String(req.query.ids || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 200).map(padSlot));
    if (!ids.size) return res.json({ success: true, holdings: [] });
    const vMap = variantMap();
    const open = "(returned != 'O' OR returned IS NULL) AND (return_source IS NULL OR return_source != 'cancel')";
    const rows = [
      ...all(`SELECT * FROM general_rentals WHERE ${open} AND item_id IN (${[...ids].map(() => "?").join(",")})`, [...ids])
        .map((r) => ({ r, itemId: padSlot(r.item_id), quantity: Number(r.qty) || 1 })),
      ...all(`SELECT * FROM sid_rentals WHERE ${open}`)
        .map((r) => { const p = parseItemLabel(r.item_label); return { r, itemId: p.id ? padSlot(p.id) : "", quantity: p.quantity || 1 }; })
        .filter((x) => ids.has(x.itemId)),
    ];
    res.json({ success: true, holdings: rows.map(({ r, itemId, quantity }) => ({
      employeeId: employeeIdForRentalRow(r) || "", name: r.borrower_name || "", floor: r.floor || "", unit: r.unit || "",
      itemId, variantId: Number(r.variant_id) || 0, variantName: (vMap[itemId] || []).find((v) => v.id === Number(r.variant_id))?.name || "",
      quantity, requestNo: Number(r.request_no) || 0, pickedUp: !!r.picked_up_at, borrowDate: r.borrow_date || "",
    })) });
  });

  // 한 사람이 지금 들고 있는 것 전부(물품·종류·수량)와 WMS 대여 종류 한도(대여 화면과 같은 계산).
  // 플래너가 대여 신청 전에 '먼저 반납할 것'과 한도 안에서 빌릴 수 있는지를 미리 계산할 때 쓴다.
  router.get("/planner-bridge/my-items", (req, res) => {
    const user = registeredUser(String(req.query.employeeId || ""));
    if (!user) return res.status(400).json({ success: false, error: "WMS 명부에 없는 사번입니다." });
    const floor = String(req.query.floor || "").trim(), unit = String(req.query.unit || "").trim();
    const t = getActiveItemTypeCount({ query: { name: user.name, employeeId: user.employee_id, affiliation: "cfgw", floor, unit } });
    const vMap = variantMap();
    const open = "(returned != 'O' OR returned IS NULL) AND (return_source IS NULL OR return_source != 'cancel')";
    const rows = [
      ...all(`SELECT * FROM general_rentals WHERE ${open}`).map((r) => ({ r, itemId: padSlot(r.item_id || ""), quantity: Number(r.qty) || 1 })),
      ...all(`SELECT * FROM sid_rentals WHERE ${open}`).map((r) => { const p = parseItemLabel(r.item_label); return { r, itemId: p.id ? padSlot(p.id) : "", quantity: p.quantity || 1 }; }),
    ].filter((x) => x.itemId && employeeIdForRentalRow(x.r) === user.employee_id);
    res.json({
      success: true,
      typeCount: t.count, typeMax: Number.isFinite(t.max) ? t.max : null, exempt: !!t.exempt,
      typeItems: [...new Set(t.items.map((i) => padSlot(i.id || "")).filter((id) => /^\d{6}$/.test(id)))],
      holdings: rows.map(({ r, itemId, quantity }) => ({
        itemId, variantId: Number(r.variant_id) || 0, variantName: (vMap[itemId] || []).find((v) => v.id === Number(r.variant_id))?.name || "",
        quantity, requestNo: Number(r.request_no) || 0, pickedUp: !!r.picked_up_at,
      })),
    });
  });

  // 신청 번호들의 현재 상태(신청됨 → 대여 확인 → 수령 → 반납, 또는 취소).
  router.get("/planner-bridge/rentals", (req, res) => {
    const nos = String(req.query.requestNos || "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 500);
    res.json({ success: true, rentals: Object.fromEntries(nos.map((n) => [n, rentalSummary(n)])) });
  });

  return router;
}
