import type { AdminItemReservation, ItemReservation } from "./borrowApi";

export type ReservationTiming = "all" | "upcoming" | "due";
import { isReservationDue } from "../../shared/reservationTime.js";
export { isReservationDue, RESERVATION_DUE_LEAD_MS } from "../../shared/reservationTime.js";
const formatter = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
export function reservationTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? formatter.format(date) : "시각 미상";
}
/** 물품 목록의 예약 시각 배지는 재고가 없을 때만 표시한다. 예약 확인 절차와는 별개다. */
export function reservationBadgesForItem(itemId: string, stock: number | undefined, rows: ItemReservation[]): ItemReservation[] {
  return (stock || 0) < 1 ? rows.filter(row => row.itemId === itemId) : [];
}
export function filterReservations(items: AdminItemReservation[], query: string, timing: ReservationTiming, now: number): AdminItemReservation[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(item => {
    const due = item.status === "fulfilled" || isReservationDue(item.startsAt, now);
    if (timing === "upcoming" && due || timing === "due" && !due) return false;
    const text = [item.borrowerName, item.employeeId, item.itemName, item.itemId, item.variantName, item.floor, item.unit, reservationTime(item.startsAt)].join(" ").toLocaleLowerCase();
    return words.every(word => text.includes(word));
  });
}
export interface ReservationBorrowerGroup {
  key: string; name: string; employeeId: string; seats: string[]; types: number; quantity: number;
  items: AdminItemReservation[]; times: { startsAt: string; items: AdminItemReservation[] }[];
}
export function groupReservationBorrowers(items: AdminItemReservation[]): ReservationBorrowerGroup[] {
  const people = new Map<string, AdminItemReservation[]>();
  for (const item of [...items].sort((a,b) => Date.parse(a.startsAt)-Date.parse(b.startsAt) || a.id-b.id)) {
    const key = item.employeeId;
    if (!people.has(key)) people.set(key, []);
    people.get(key)!.push(item);
  }
  return [...people.entries()].map(([key, rows]) => {
    const times = new Map<string, AdminItemReservation[]>();
    for (const row of rows) {
      if (!times.has(row.startsAt)) times.set(row.startsAt, []);
      times.get(row.startsAt)!.push(row);
    }
    return { key, name: rows[0].borrowerName, employeeId: rows[0].employeeId,
      seats: [...new Set(rows.map(row => `${row.floor} / ${row.unit}`))], types: new Set(rows.map(row => row.itemId)).size,
      quantity: rows.reduce((sum,row) => sum+row.quantity,0), items: rows,
      times: [...times.entries()].map(([startsAt, lines]) => ({ startsAt, items: lines })),
    };
  });
}
