const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const KST_OFFSET = 9 * 60 * MINUTE;
export const RESERVATION_DUE_LEAD_MS = 10 * MINUTE;
export const RESERVATION_PICKUP_TIMEOUT_MS = 20 * MINUTE;
export function isReservationExpired(startsAt, now = Date.now()) {
  const at = typeof startsAt === "number" ? startsAt : Date.parse(startsAt);
  return Number.isFinite(at) && now >= at + RESERVATION_PICKUP_TIMEOUT_MS;
}
export function isReservationDue(startsAt, now = Date.now()) {
  return Date.parse(startsAt) - RESERVATION_DUE_LEAD_MS <= now;
}

/** 한국 시간 기준 오늘부터 다음날 01:00까지 예약할 수 있다. */
export function reservationDay(now = Date.now()) {
  const date = new Date(now + KST_OFFSET).toISOString().slice(0, 10);
  const start = Date.parse(`${date}T00:00:00+09:00`);
  return { date, start, end: start + DAY + 60 * MINUTE, minMinutes: Math.floor((now - start) / MINUTE) + 1 };
}

export function reservationStart(date, minutes) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(minutes) || minutes < 0 || minutes > 1500) return NaN;
  return Date.parse(`${date}T00:00:00+09:00`) + minutes * MINUTE;
}

export function validReservationStart(startsAt, now = Date.now()) {
  const today = reservationDay(now);
  return Number.isFinite(startsAt) && startsAt > now && startsAt <= today.end && startsAt % MINUTE === 0;
}
