import { all, get, run, transaction } from "../db.js";
import { padSlot, parseItemLabel } from "./borrowUtils.js";
import { registeredUser, employeeIdForRentalRow } from "./registeredUsers.js";
import { itemBorrowers } from "./itemBorrowers.js";
import { toScenarioObject } from "./serialize.js";
import { validReservationStart } from "../../shared/reservationTime.js";
import { cancelUnclaimedRental } from "./pickupCancellation.js";
import { expireReservations } from "./reservationExpiry.js";
import { nowKst } from "./time.js";
import { nudge } from "./smSync.js";
import { validateRentalTerms } from '../../shared/rentalTerms.js';

export function reservations({ employeeId, mine = false, admin = false } = {}) {
  // 관리자·본인 예약 화면에는 전환 후에도 실제 수령 전인 물품을 남긴다.
  // 신청 번호뿐 아니라 물품·종류·사번까지 연결해 부분 수령과 취소를 구분한다.
  const includePending = admin || mine;
  const pickupJoin = includePending ? `LEFT JOIN (
    SELECT request_no, employee_id, item_id, COALESCE(variant_id,0) AS variant_id, SUM(qty) AS pending_quantity
    FROM general_rentals WHERE status='active' AND COALESCE(returned,'X') != 'O' AND picked_up_at IS NULL
    GROUP BY request_no, employee_id, item_id, COALESCE(variant_id,0)
  ) p ON p.request_no=r.request_no AND p.employee_id=r.employee_id AND p.item_id=r.item_id AND p.variant_id=r.variant_id` : "";
  return all(`SELECT r.*, i.name, i.image_path AS image, i.stock, i.is_storage, i.request AS request_for, v.name AS variant_name, v.stock AS variant_stock
    ${includePending ? ", p.pending_quantity" : ""}
    FROM item_reservations r LEFT JOIN scenario_items i ON i.id = r.item_id
    LEFT JOIN scenario_item_variants v ON v.id = r.variant_id
    ${pickupJoin}
    WHERE (r.status = 'reserved' ${includePending ? "OR (r.status='fulfilled' AND p.pending_quantity > 0)" : ""})
    ${mine ? "AND r.employee_id = ?" : ""} ORDER BY r.starts_at_ms, r.id`, mine ? [employeeId] : [])
    .map((row) => ({
      id: row.id, itemId: row.item_id, itemName: row.name || row.item_id, image: row.image || "",
      variantId: row.variant_id || undefined, variantName: row.variant_name || "", quantity: includePending && row.status === "fulfilled" ? row.pending_quantity : row.quantity,
      startsAt: new Date(row.starts_at_ms).toISOString(), borrowerName: registeredUser(row.employee_id)?.name || row.borrower_name,
      mine: row.employee_id === employeeId,
      ...((mine || admin) ? { floor: row.floor, unit: row.unit, status: row.status, requestNo: row.request_no || undefined, promotionError: row.promotion_error || "", requestFor: row.request_for ?? undefined,
        requestRental: row.request_mode ? { mode: row.request_mode, reason: row.request_reason || "" } : undefined,
        rentalTerms: row.rental_mode ? {mode:row.rental_mode,reason:row.rental_reason || '',dueDate:row.rental_due_date || ''} : undefined,
        stock: Number(row.variant_id ? row.variant_stock : row.stock) || 0,
        available: row.status === 'fulfilled' || (!!row.name && !toScenarioObject(row).archived && (!row.variant_id || row.variant_name != null) && Number(row.variant_id ? row.variant_stock : row.stock) >= row.quantity) } : {}),
      ...(admin ? { employeeId: row.employee_id, createdAt: new Date(row.created_at_ms).toISOString(), status: row.status, requestNo: row.request_no || undefined } : {}),
    }));
}

export function createReservations(employeeId, payload, now = Date.now(), {planner=false}={}) {
  const terms = validateRentalTerms(payload.rentalTerms || (payload.requestRental?.mode === 'request' ? {mode:'reason',reason:payload.requestRental.reason} : undefined),{planner,now});
  const requestDecision = payload.requestRental || (payload.rentalTerms ? {mode:terms.mode === 'general' ? 'general' : 'request',reason:terms.reason} : undefined);
  const user = registeredUser(employeeId);
  if (!user) throw Error("등록된 대여자를 확인해주세요.");
  if (!payload.floor || !payload.unit) throw Error("예약자의 좌석을 선택해주세요.");
  if (!/^[\w-]{8,100}$/.test(String(payload.clientId || ""))) throw Error("예약 요청 번호가 필요합니다.");
  if (!Array.isArray(payload.items) || !payload.items.length) throw Error("예약할 물품을 선택해주세요.");
  const startsAt = /(?:Z|[+-]\d{2}:\d{2})$/.test(String(payload.startsAt)) ? Date.parse(payload.startsAt) : NaN;
  const lines = new Map();
  for (const item of payload.items) {
    const id = padSlot(item.id), variantId = Number(item.variantId) || 0, quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0 || !Number.isInteger(variantId) || variantId < 0) throw Error("예약 수량 또는 종류가 올바르지 않습니다.");
    const key = `${id}:${variantId}`;
    const previous = lines.get(key);
    lines.set(key, { id, variantId, quantity: quantity + (previous?.quantity || 0) });
  }
  expireReservations(now);
  const existing = all("SELECT * FROM item_reservations WHERE employee_id=? AND client_id=? ORDER BY id", [employeeId,payload.clientId]);
  if (existing.length) {
    if (existing.some(row=>row.status==='cancelled')) throw Error("이미 취소된 예약 요청입니다. 목록을 확인한 뒤 새로 예약해주세요.");
    const same = existing.length === lines.size && existing.every(row=>{
      const line=lines.get(`${row.item_id}:${row.variant_id}`);
      const decision=requestDecision;
      return line?.quantity === row.quantity && startsAt === row.starts_at_ms && payload.floor === row.floor && payload.unit === row.unit
        && (!row.request_mode || (row.request_mode === decision?.mode && (row.request_reason || '') === (decision?.mode === 'request' ? String(decision.reason || '').trim() : '')))
        && (!row.rental_mode || (row.rental_mode===terms.mode && (row.rental_reason || '')===terms.reason && (row.rental_due_date || '')===terms.dueDate));
    });
    if (!same) throw Error("저장된 예약과 요청 내용이 다릅니다. 예약 목록을 확인한 뒤 새로 신청해주세요.");
    return {ids:existing.map(row=>row.id)};
  }
  if (!validReservationStart(startsAt, now)) throw Error("예약 시간은 현재 시각 이후부터 다음날 오전 1시까지 분 단위로 선택해주세요.");
  return transaction(() => {
    const totals = new Map();
    const requestIds = new Set();
    const decision = requestDecision;
    if (decision && !["request", "general"].includes(decision.mode)) throw Error("대여 방식이 올바르지 않습니다.");
    for (const line of lines.values()) {
      const item = get("SELECT * FROM scenario_items WHERE id = ?", [line.id]);
      if (!item || toScenarioObject(item).archived) throw Error("예약할 물품을 찾을 수 없습니다.");
      if (item.request != null) requestIds.add(line.id);
      totals.set(line.id, (totals.get(line.id) || 0) + line.quantity);
      if (totals.get(line.id) > Number(item.stock)) throw Error(`'${item.name}'의 현재 재고가 예약 수량보다 부족합니다.`);
      const variants = all("SELECT * FROM scenario_item_variants WHERE item_id = ?", [line.id]);
      if (variants.length && !line.variantId) throw Error(`'${item.name}'의 종류를 선택해주세요.`);
      if (line.variantId) {
        const variant = variants.find((v) => v.id === line.variantId);
        if (!variant || line.quantity > Number(variant.stock)) throw Error(`'${item.name}'의 선택한 종류 재고가 부족합니다.`);
      }
    }
    if (requestIds.size && !decision) throw Error("Request 물품의 대여 방식을 선택해주세요.");
    if (requestIds.size && decision.mode === "request" && !String(decision.reason || "").trim()) throw Error("Request 대여 사유를 입력해주세요.");
    const ids = [];
    for (const line of lines.values()) {
      ids.push(Number(run(`INSERT INTO item_reservations
        (employee_id,borrower_name,floor,unit,item_id,variant_id,quantity,starts_at_ms,created_at_ms,client_id,request_mode,request_reason,rental_mode,rental_reason,rental_due_date)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [employeeId,user.name,payload.floor,payload.unit,line.id,line.variantId,line.quantity,startsAt,now,payload.clientId,
          requestIds.has(line.id) ? decision.mode : null, requestIds.has(line.id) && decision.mode === "request" ? String(decision.reason).trim() : null,terms.mode,terms.reason,terms.dueDate]).lastInsertRowid));
    }
    return { ids };
  });
}

export function ownedReservation(employeeId, id) {
  const row = get("SELECT * FROM item_reservations WHERE id = ? AND employee_id = ? AND status = 'reserved'", [Number(id), employeeId]);
  if (!row) throw Error("본인의 진행 중인 예약만 처리할 수 있습니다.");
  return row;
}
export function cancelReservation(employeeId, id) {
  return cancelPendingReservation(id,{employeeId,cancelBy:'self',cancelActor:registeredUser(employeeId)?.name || employeeId});
}
/** 전환 전·후 모두 미수령 예약만 취소한다. 이미 받은 수량은 유지한다. */
function cancelPendingReservation(id,{employeeId,cancelBy,cancelActor}) {
  const reservationId = Number(id);
  if (!Number.isSafeInteger(reservationId) || reservationId <= 0) throw Error("취소할 예약 번호가 올바르지 않습니다.");
  expireReservations();
  let releasedQuantity=0;
  transaction(()=>{
    const reservation=get("SELECT * FROM item_reservations WHERE id=? AND status IN ('reserved','fulfilled')",[reservationId]);
    if (!reservation || (employeeId && reservation.employee_id !== employeeId)) throw Error(cancelBy==='admin'
      ? "진행 중인 미수령 예약을 찾지 못했습니다. 이미 처리됐을 수 있으니 목록을 새로고침해주세요."
      : "본인의 진행 중인 예약만 처리할 수 있습니다. 목록을 새로고침해주세요.");
    if (reservation.status==='fulfilled') {
      if (!reservation.request_no) throw Error("이미 수령했거나 종료된 예약입니다. 목록을 새로고침해주세요.");
      const timestamp=nowKst();
      for (const table of ['general_rentals','sid_rentals']) {
        const rows=all(`SELECT * FROM ${table} WHERE request_no=? AND status='active' AND picked_up_at IS NULL
          AND COALESCE(returned,'X')!='O' AND COALESCE(variant_id,0)=?`,[reservation.request_no,reservation.variant_id]);
        for (const row of rows) {
          const parsed=table==='sid_rentals' ? parseItemLabel(row.item_label) : null;
          if (padSlot(parsed ? parsed.id : row.item_id)!==reservation.item_id || employeeIdForRentalRow(row)!==reservation.employee_id) continue;
          if (cancelUnclaimedRental(table,row,timestamp,'[예약 미수령 취소]',{cancelBy,cancelActor})) releasedQuantity += parsed ? parsed.quantity || 1 : Number(row.qty) || 1;
        }
      }
      if (!releasedQuantity) throw Error("이미 수령했거나 종료된 예약입니다. 목록을 새로고침해주세요.");
    }
    const changed=run("UPDATE item_reservations SET status='cancelled',promotion_error=NULL WHERE id=? AND status=?",[reservationId,reservation.status]);
    if (!changed.changes) throw Error("예약 상태가 변경되었습니다. 목록을 새로고침해주세요.");
  });
  if (releasedQuantity) nudge();
  return {releasedQuantity};
}
export function cancelAdminReservation(id,admin={}) {
  return cancelPendingReservation(id,{cancelBy:'admin',cancelActor:admin.name || admin.loginId || '관리자'});
}
export function acknowledgeReservations(employeeId, ids) {
  if (!Array.isArray(ids) || !ids.length) throw Error("확인할 예약 정보가 없습니다.");
  transaction(() => {
    for (const id of new Set(ids)) {
      const row = get("SELECT id FROM item_reservations WHERE id = ? AND status = 'reserved'", [Number(id)]);
      if (!row) continue;
      run("INSERT INTO reservation_notice_views (reservation_id,employee_id,seen_at_ms) VALUES (?,?,?) ON CONFLICT(reservation_id,employee_id) DO NOTHING", [Number(id), employeeId, Date.now()]);
    }
  });
  return {};
}
export function reservationBorrowers(employeeId, id) {
  const reservation = ownedReservation(employeeId, id);
  return itemBorrowers({ itemId: reservation.item_id, variantId: reservation.variant_id || undefined, reservationId: reservation.id });
}
