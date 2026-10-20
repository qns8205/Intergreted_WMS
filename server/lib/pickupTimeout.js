import { all, transaction } from "../db.js";
import { parseItemLabel } from "./borrowUtils.js";
import { nowKst, parseKstMs } from "./time.js";
import { recoveryHoldChecker } from "./unattendedOperationRecovery.js";
import { registerUnattendedViolation, unattendedEnabled } from "./unattendedPenalties.js";
import { cancelUnclaimedRental } from "./pickupCancellation.js";
import { expireReservations } from "./reservationExpiry.js";

// 신청 후 이 시간 안에 "대여 확인"(실물 픽업)이 안 되면 안 가져간 것으로 보고 되돌린다.
const configuredTimeout = Number(process.env.WMS_PICKUP_TIMEOUT_MIN);
const TIMEOUT_MIN = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 20;
const UNATTENDED_TIMEOUT_MIN = 4 * 60;

/** 자동 취소 작업과 신청 완료 안내가 동일한 제한시간을 사용한다. */
export function getPickupTimeoutMinutes() {
  return unattendedEnabled() ? UNATTENDED_TIMEOUT_MIN : TIMEOUT_MIN;
}

/** DB의 시각 문자열("YYYY-MM-DD HH:mm:ss", 서울 로컬)과 그대로 비교할 기준 시각. */
function cutoffKst(minutes) {
  const d = new Date(Date.now() - minutes * 60 * 1000);
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * 신청만 해두고 실물을 안 가져간 대여를 자동으로 되돌린다.
 *
 * 대여 신청 시점에 재고는 이미 빠진다. 그런데 신청해놓고 안 가져가는 일이 생기면 그 재고가
 * 계속 묶여 있어 다른 사람이 못 빌린다. 담당자가 "대여 확인"을 눌러야 실물이 나간 것으로
 * 보므로, 확인이 안 된 채 일정 시간이 지난 건은 안 가져간 것으로 보고 재고를 돌려놓는다.
 *
 * 대상: 확인 전(picked_up_at IS NULL) + 아직 안 닫힌(active, 미반납) + 신청한 지 오래된 줄.
 * 이미 확인된 건은 실물이 나갔다는 뜻이라 절대 건드리지 않는다.
 */
export function cancelUnclaimedPickups() {
  const expiredReservations = expireReservations();
  const isUnattended = unattendedEnabled();
  const timeoutMin = getPickupTimeoutMinutes();
  const cutoff = cutoffKst(timeoutMin);
  const now = nowKst();
  const cancelled = [];

  const pick = (table) =>
    all(
      `SELECT * FROM ${table}
        WHERE picked_up_at IS NULL
          AND status = 'active'
          AND (returned IS NULL OR returned != 'O')
          AND applied_at IS NOT NULL AND applied_at <= ?
          AND NOT EXISTS (SELECT 1 FROM item_reservations r WHERE r.status='fulfilled'
            AND r.request_no = ${table}.request_no)`,
      [cutoff]
    );

  const held = recoveryHoldChecker('pickup');
  const sid = pick("sid_rentals").filter(row=>!held(row,'scenario',parseKstMs(row.applied_at)+4*60*60*1000));
  const gen = pick("general_rentals").filter(row=>!held(row,'general',parseKstMs(row.applied_at)+4*60*60*1000));
  if (!sid.length && !gen.length) return { cancelled: expiredReservations.cancelled };

  transaction(() => {
    if (isUnattended) {
      const grouped = new Map();
      for (const row of [...sid.map((r) => ({ ...r, sheet_type: "scenario" })), ...gen.map((r) => ({ ...r, sheet_type: "general" }))]) {
        const key = row.request_no ? `pickup:request:${row.request_no}` : `pickup:${row.sheet_type}:${row.id}`;
        if (!grouped.has(key)) grouped.set(key, row);
      }
      for (const [eventKey, row] of grouped) {
        registerUnattendedViolation({ eventKey, eventType: "pickup_unconfirmed_4h", row, sourceAt: row.applied_at });
      }
    }
    for (const row of sid) {
      const parsed = parseItemLabel(row.item_label);
      if (!parsed.id && !parsed.name) continue; // 물품이 안 붙은 빈 SID 줄은 그냥 닫는다
      if (cancelUnclaimedRental("sid_rentals", row, now)) cancelled.push({ name: parsed.name || row.item_label, qty: parsed.quantity || 1, who: row.borrower_name });
    }
    for (const row of gen) {
      if (cancelUnclaimedRental("general_rentals", row, now)) cancelled.push({ name: row.item_label, qty: row.qty || 1, who: row.borrower_name });
    }
  });

  console.log(`[pickup-timeout] 미수령 ${cancelled.length}건 자동 취소 (${timeoutMin}분 경과, 기준 ${cutoff})`);

  return { cancelled: cancelled.length + expiredReservations.cancelled };
}
