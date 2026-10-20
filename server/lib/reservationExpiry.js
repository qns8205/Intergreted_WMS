import { all, run, transaction } from "../db.js";
import { nowKst } from "./time.js";
import { cancelUnclaimedRental } from "./pickupCancellation.js";
import { RESERVATION_PICKUP_TIMEOUT_MS } from "../../shared/reservationTime.js";
import { nudge } from "./smSync.js";
import { padSlot, parseItemLabel } from "./borrowUtils.js";
import { recoveryHoldChecker } from "./unattendedOperationRecovery.js";

const MESSAGE = "예약 예정 시각부터 20분 내 수령 확인이 없어 자동 취소되었습니다.";

/** 예약 예정 시각 +20분. 전환이 늦거나 무인 모드여도 기한을 연장하지 않는다. */
export function expireReservations(now = Date.now()) {
  const due = all(`SELECT * FROM item_reservations WHERE starts_at_ms <= ? AND
    (status='reserved' OR (status='fulfilled' AND request_no IN (
      SELECT request_no FROM general_rentals WHERE status='active' AND picked_up_at IS NULL AND COALESCE(returned,'X')!='O'
      UNION SELECT request_no FROM sid_rentals WHERE status='active' AND picked_up_at IS NULL AND COALESCE(returned,'X')!='O'
    ))) ORDER BY id`,[now-RESERVATION_PICKUP_TIMEOUT_MS]);
  if (!due.length) return {cancelled:0,reservationsCancelled:0};
  let cancelled=0,reservationsCancelled=0;
  const held=recoveryHoldChecker('pickup');
  transaction(()=>{
    const timestamp=nowKst();
    for (const reservation of due) {
      if (reservation.status === "reserved") {
        reservationsCancelled += run("UPDATE item_reservations SET status='cancelled',promotion_error=? WHERE id=? AND status='reserved'",[MESSAGE,reservation.id]).changes;
        continue; // 예약만 등록된 줄은 재고를 차감하지 않았으므로 복구하지 않는다.
      }
      const rows=all(`SELECT * FROM general_rentals WHERE request_no=? AND item_id=? AND COALESCE(variant_id,0)=?
        AND status='active' AND picked_up_at IS NULL AND COALESCE(returned,'X')!='O'`,[reservation.request_no,reservation.item_id,reservation.variant_id]);
      let closed=0;
      const heldGeneral=rows.some(row=>held(row,'general',reservation.starts_at_ms+RESERVATION_PICKUP_TIMEOUT_MS));
      const scenarioRows=all(`SELECT * FROM sid_rentals WHERE request_no=? AND COALESCE(variant_id,0)=?
        AND status='active' AND picked_up_at IS NULL AND COALESCE(returned,'X')!='O'`,[reservation.request_no,reservation.variant_id]);
      if(heldGeneral || scenarioRows.some(row=>padSlot(parseItemLabel(row.item_label).id)===reservation.item_id && held(row,'scenario',reservation.starts_at_ms+RESERVATION_PICKUP_TIMEOUT_MS))) continue;
      for (const row of rows) if(cancelUnclaimedRental("general_rentals",row,timestamp,"[예약 미수령 자동 취소]")){closed++;cancelled++;}
      for (const row of scenarioRows) {
        if (padSlot(parseItemLabel(row.item_label).id) !== reservation.item_id) continue;
        if(cancelUnclaimedRental("sid_rentals",row,timestamp,"[예약 미수령 자동 취소]")){closed++;cancelled++;}
      }
      if (closed) reservationsCancelled += run("UPDATE item_reservations SET status='cancelled',promotion_error=? WHERE id=? AND status='fulfilled'",[MESSAGE,reservation.id]).changes;
    }
  });
  if (cancelled) nudge();
  if (reservationsCancelled || cancelled) console.log(`[reservation-expiry] 예약 ${reservationsCancelled}건 / 미수령 대여 ${cancelled}건 자동 취소 (예정 시각 +20분)`);
  return {cancelled,reservationsCancelled};
}
