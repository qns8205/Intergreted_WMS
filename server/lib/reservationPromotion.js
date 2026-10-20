import { all, get, run } from "../db.js";
import { toScenarioObject } from "./serialize.js";
import { RESERVATION_DUE_LEAD_MS } from "../../shared/reservationTime.js";
import { nudge } from "./smSync.js";
import { expireReservations } from "./reservationExpiry.js";

let running = false;
let groupOffset = 0;
/** 같은 예약 신청의 물품·종류를 묶어 원자적으로 대여 확인 대기로 전환한다. */
export async function promoteDueReservations(recordBorrow, now = Date.now()) {
  if (running) return { promoted: 0, blocked: 0, running: true };
  running = true;
  let promoted = 0, blocked = 0;
  try {
    expireReservations(now);
    const groups = all(`SELECT employee_id, client_id, floor, unit, starts_at_ms FROM item_reservations
      WHERE status = 'reserved' AND starts_at_ms <= ?
      GROUP BY employee_id, client_id, floor, unit, starts_at_ms ORDER BY starts_at_ms, MIN(id)`, [now + RESERVATION_DUE_LEAD_MS]);
    // 한 회차의 검증 작업을 제한하되, 앞의 품절 예약이 뒤의 정상 예약을 계속 막지 않는다.
    const offset = groups.length ? groupOffset % groups.length : 0;
    const batch = [...groups.slice(offset), ...groups.slice(0,offset)].slice(0,20);
    groupOffset = groups.length ? (offset + batch.length) % groups.length : 0;
    for (const group of batch) {
      const rows = all(`SELECT * FROM item_reservations WHERE status='reserved' AND employee_id=? AND client_id=?
        AND floor=? AND unit=? AND starts_at_ms=? ORDER BY id`, [group.employee_id,group.client_id,group.floor,group.unit,group.starts_at_ms]);
      if (!rows.length) continue;
      try {
        const entries = rows.map(row => {
          const item = get("SELECT * FROM scenario_items WHERE id=?", [row.item_id]);
          if (!item || toScenarioObject(item).archived) throw Error("예약 물품이 삭제되거나 보관 처리되어 관리자 확인이 필요합니다.");
          if (row.variant_id && !get("SELECT id FROM scenario_item_variants WHERE id=? AND item_id=?", [row.variant_id,row.item_id])) throw Error("예약한 종류가 변경되어 관리자 확인이 필요합니다.");
          return { item:{ id:row.item_id,name:item.name,quantity:row.quantity,variantId:row.variant_id || undefined,reservationId:row.id },
            // 기존 예약이나 예약 후 Request 지정된 물품에는 임의로 한도 제외를 부여하지 않는다.
            decision:row.request_mode ? {mode:row.request_mode,reason:row.request_reason || ""} : {mode:"general",reason:""},
            terms:row.rental_mode ? {mode:row.rental_mode,reason:row.rental_reason || '',dueDate:row.rental_due_date || ''} : {mode:'general',reason:'',dueDate:''} };
        });
        const batches = new Map();
        for (const entry of entries) {
          const key = JSON.stringify([entry.decision,entry.terms]);
          if (!batches.has(key)) batches.set(key,{employeeId:group.employee_id,borrowerName:rows[0].borrower_name,affiliation:"cfgw",
            itemType:"general",generalOption:"예약 대여",borrowPurpose:"예약 대여",floor:group.floor,unit:group.unit,
            requestRental:entry.decision,rentalTerms:entry.terms,borrowedItems:[]});
          batches.get(key).borrowedItems.push(entry.item);
        }
        const result = await recordBorrow({
          autoReservation: true, admin: {name:"예약 자동 전환"},
          planner: rows.every(row=>row.rental_mode==='planner'),
          payload: { borrowList:[...batches.values()] },
        });
        if (result?.success === false) throw Error(result.message || result.error || "예약 자동 전환에 실패했습니다.");
        promoted += rows.length;
      } catch (err) {
        const message = err.message || "예약 자동 전환에 실패했습니다.";
        for (const row of rows) run(`UPDATE item_reservations SET promotion_error=? WHERE id=? AND status='reserved'
          AND COALESCE(promotion_error,'') != ?`, [message,row.id,message]);
        blocked += rows.length;
      }
    }
    if (promoted) nudge();
    return { promoted, blocked };
  } finally { running = false; }
}

export function startReservationPromotion(recordBorrow) {
  const tick = () => promoteDueReservations(recordBorrow).then(result => {
    if (result.promoted) console.log("[reservation-promotion] " + result.promoted + "건 대여 확인 대기로 전환");
  }).catch(err => console.error("[reservation-promotion] 자동 전환 실패", err));
  const startup = setTimeout(tick, 1000);
  const timer = setInterval(tick, 15_000);
  startup.unref(); timer.unref();
  return () => { clearTimeout(startup); clearInterval(timer); };
}
