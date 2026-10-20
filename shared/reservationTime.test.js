import test from "node:test";
import assert from "node:assert/strict";
import { reservationDay, reservationStart, validReservationStart } from "./reservationTime.js";

test("한국 날짜는 실행 PC 시간대와 무관하고 현재 분은 선택되지 않는다", () => {
  const now = Date.parse("2026-10-13T13:20:30+09:00");
  const day = reservationDay(now);
  assert.equal(day.date, "2026-10-13");
  assert.equal(day.minMinutes, 13 * 60 + 21);
  assert.equal(validReservationStart(reservationStart(day.date, 13 * 60 + 20), now), false);
  assert.equal(validReservationStart(reservationStart(day.date, 13 * 60 + 21), now), true);
});
test("다음날 00:00부터 01:00까지 허용하고 01:01 이후는 거부한다", () => {
  const now = Date.parse("2026-10-13T23:59:30+09:00");
  const day = reservationDay(now);
  assert.equal(day.minMinutes, 1440);
  assert.equal(validReservationStart(reservationStart(day.date, 1440), now), true);
  assert.equal(validReservationStart(reservationStart(day.date, 1441), now), true);
  assert.equal(validReservationStart(reservationStart(day.date, 1470), now), true);
  assert.equal(validReservationStart(reservationStart(day.date, 1500), now), true);
  assert.ok(Number.isNaN(reservationStart(day.date, 1501)));
  assert.equal(validReservationStart(Date.parse("2026-10-14T01:01:00+09:00"), now), false);
  assert.equal(validReservationStart(Date.parse("2026-10-12T20:00:00+09:00"), now), false);
});
test("자정이 지나면 당일 날짜와 허용 시간이 새로 바뀐다", () => {
  const now = Date.parse("2026-10-14T00:00:00+09:00");
  assert.equal(reservationDay(now).date, "2026-10-14");
  assert.equal(reservationDay(now).minMinutes, 1);
  assert.equal(validReservationStart(now, now), false);
  assert.equal(validReservationStart(now + 60_000, now), true);
  assert.equal(validReservationStart(now + 60_001, now), false);
});
