import { parseKstMs } from "./time.js";

// 무인 모드 신청 QR이 보관 위치를 보여줄 수 있는 창.
// 대여 확인 전: 신청 후 30분. 대여 확인 후: 확인 후 10분. 반납 완료 후: 반납 후 15분.
// (그 외 시간대에는 "대여 중인 물품입니다"만 보여주고 위치는 숨긴다)
const PRE_CONFIRM_MS = 30 * 60 * 1000;
const POST_CONFIRM_MS = 10 * 60 * 1000;
const POST_RETURN_MS = 15 * 60 * 1000;

/** sid_rentals/general_rentals 한 행의 현재 상태로부터 위치를 보여줘도 되는지 판단한다.
 *  화면에서만 가리는 게 아니라 서버가 매 조회마다 직접 계산하는 권한 판정이다. */
export function locationVisibility(row) {
  if (row.returned === "O") {
    const t = parseKstMs(row.return_date);
    if (Number.isFinite(t) && Date.now() - t <= POST_RETURN_MS) return { visible: true };
    return { visible: false, message: "반납이 완료된 물품입니다." };
  }
  if (row.picked_up_at) {
    const t = parseKstMs(row.picked_up_at);
    if (Number.isFinite(t) && Date.now() - t <= POST_CONFIRM_MS) return { visible: true };
    return { visible: false, message: "대여 중인 물품입니다." };
  }
  const t = parseKstMs(row.applied_at);
  if (Number.isFinite(t) && Date.now() - t <= PRE_CONFIRM_MS) return { visible: true };
  return { visible: false, message: "대여 중인 물품입니다." };
}
