import { all } from "../db.js";
import { padSlot, parseItemLabel } from "./borrowUtils.js";
import { employeeIdForRentalRow, registeredUser } from "./registeredUsers.js";
import { rentalTypeLimitPolicy } from "./rentalTypeLimitPolicy.js";

/** QR에는 한도 안에서 받을 수 있는 예약 신청만 표시한다. 재고와 신청은 변경하지 않는다. */
export function hiddenReservationQrRows(employeeId, { scenarioRows, generalRows }) {
  const user = registeredUser(employeeId);
  const hidden = new Set();
  if (!user) return hidden;
  const ownedActive = rows => rows.filter(row=>row.returned !== 'O' && employeeIdForRentalRow(row) === employeeId);
  const entries = [
    ...ownedActive(scenarioRows).map(row=>{const parsed=parseItemLabel(row.item_label);return {key:`scenario:${row.id}`,row,itemId:parsed.id,name:row.item_label || "(물품 미등록)"};}),
    ...ownedActive(generalRows).map(row=>({key:`general:${row.id}`,row,itemId:padSlot(row.item_id),name:row.item_label || ""})),
  ];
  const pendingRequests = [...new Set(entries.filter(entry=>!entry.row.picked_up_at && entry.row.request_no).map(entry=>entry.row.request_no))];
  if (!pendingRequests.length) return hidden;
  const bookings = all(`SELECT * FROM item_reservations WHERE employee_id=? AND status='fulfilled'
    AND request_no IN (${pendingRequests.map(()=>'?').join(',')})`,[employeeId,...pendingRequests]);
  if (!bookings.length) return hidden;
  const reservedLines = new Map(bookings.map(row=>[`${row.request_no}:${row.item_id}:${row.variant_id}`,row]));
  // 현재 대여와 이미 전환된 예약을 한 번만 합산한다. 수량·색상이 달라도 같은 ID는 한 종이다.
  const countedTypes = new Set(entries.filter(entry=>entry.row.type_limit_exempt !== 'Y').map(entry=>entry.itemId || entry.name));
  const requests = new Map();
  for (const entry of entries) {
    if (entry.row.picked_up_at) continue;
    const booking = reservedLines.get(`${entry.row.request_no}:${entry.itemId}:${Number(entry.row.variant_id) || 0}`);
    if (!booking) continue;
    if (!requests.has(booking.request_no)) requests.set(booking.request_no,{booking,entries:[]});
    requests.get(booking.request_no).entries.push(entry);
  }
  for (const group of requests.values()) {
    // Request만 받는 신청은 일반 대여와 마찬가지로 종류 한도를 추가로 사용하지 않는다.
    if (group.entries.every(entry=>entry.row.type_limit_exempt === 'Y')) continue;
    const limit = rentalTypeLimitPolicy({name:user.name,floor:group.booking.floor,unit:group.booking.unit});
    if (!limit.exempt && countedTypes.size > limit.max) {
      for (const entry of group.entries) hidden.add(entry.key);
    }
  }
  return hidden;
}
