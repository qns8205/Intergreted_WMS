export const RENTAL_HOURS = 4;
export function kstTimestamp(ms) {
  return new Date(ms + 9 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
}
export function rentalTimeMs(value) {
  const raw = String(value || '').trim();
  return raw ? Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(raw) ? raw : raw.replace(' ', 'T') + '+09:00') : NaN;
}
// 점심시간(한국 시각 12:00~13:00)에는 반납 기한 시계가 멈춘다.
const HOUR_MS = 3600000, DAY_MS = 24 * HOUR_MS, KST_MS = 9 * HOUR_MS;
const LUNCH_START = 12 * HOUR_MS, LUNCH_END = 13 * HOUR_MS;
const kstDayStart = (ms) => Math.floor((ms + KST_MS) / DAY_MS) * DAY_MS - KST_MS;
/** start부터 점심시간을 빼고 duration만큼 흐른 시각. duration이 음수면 거꾸로 센다. */
export function addRentalTimeMs(start, duration) {
  let t = start, left = Math.abs(duration);
  const forward = duration >= 0;
  while (left > 0) {
    const day = kstDayStart(forward ? t : t - 1);
    const ls = day + LUNCH_START, le = day + LUNCH_END;
    if (forward) {
      if (t >= ls && t < le) { t = le; continue; }
      const stop = t < ls ? ls : day + DAY_MS + LUNCH_START;
      const step = Math.min(left, stop - t); t += step; left -= step;
    } else {
      if (t > ls && t <= le) { t = ls; continue; }
      const stop = t > le ? le : day - DAY_MS + LUNCH_END;
      const step = Math.min(left, t - stop); t -= step; left -= step;
    }
  }
  return t;
}
/** 지금이 점심시간(한국 시각 12:00~13:00)인지. 이 동안 반납 기한 타이머가 멈춘다. */
export function isRentalLunchBreak(nowMs) {
  const t = nowMs - kstDayStart(nowMs);
  return t >= LUNCH_START && t < LUNCH_END;
}
/** 반납 기한까지 남은 시간(점심시간 제외). 기한이 지났으면 지난 만큼의 음수를 돌려준다. */
export function rentalTimeLeftMs(nowMs, deadlineMs) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(deadlineMs)) return NaN;
  if (nowMs >= deadlineMs) return deadlineMs - nowMs;
  let lunch = 0;
  for (let day = kstDayStart(nowMs); day < deadlineMs; day += DAY_MS) {
    const ls = Math.max(nowMs, day + LUNCH_START), le = Math.min(deadlineMs, day + LUNCH_END);
    if (le > ls) lunch += le - ls;
  }
  return deadlineMs - nowMs - lunch;
}
export function rentalDeadlineMs(pickedUpAt, generalSince) {
  const pickup = rentalTimeMs(pickedUpAt);
  if (!Number.isFinite(pickup)) return NaN;
  const changed = rentalTimeMs(generalSince);
  return addRentalTimeMs(Math.max(pickup,Number.isFinite(changed) ? changed : pickup), RENTAL_HOURS * HOUR_MS);
}
export function validateRentalTerms(value, { planner = false, now = Date.now() } = {}) {
  if (planner) return { mode: 'planner', reason: '', dueDate: '' };
  const mode = value?.mode || 'general';
  if (!['general', 'reason', 'long_term'].includes(mode)) throw Error('대여 방식이 올바르지 않습니다.');
  const reason = mode === 'general' ? '' : String(value?.reason || '').trim();
  if (mode !== 'general' && !reason) throw Error('대여 사유를 입력해주세요.');
  if (reason.length > 2000) throw Error('대여 사유는 2,000자 이내로 입력해주세요.');
  const dueDate = mode === 'long_term' ? String(value?.dueDate || '') : '';
  if (mode === 'long_term' && (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !Number.isFinite(Date.parse(dueDate)) || new Date(dueDate).toISOString().slice(0,10) !== dueDate || dueDate < kstTimestamp(now).slice(0,10))) {
    throw Error('장기대여 반납 예정일을 오늘 이후의 유효한 날짜로 선택해주세요.');
  }
  return { mode, reason, dueDate };
}
export function rentalTermsLabel(terms) {
  if (!terms) return '';
  if (terms.mode === 'planner') return 'Shoot Planner · 루틴 종료 시 반납 · 시간 제한 면제';
  if (terms.mode === 'long_term') return `장기대여 · ${terms.dueDate}까지 반납${terms.reason ? ` · ${terms.reason}` : ''}`;
  if (terms.mode === 'reason') return `사유 대여 · 4시간 제한 면제 · ${terms.reason}`;
  const label = terms.deadlineAt ? `일반 대여 · ${terms.deadlineAt}까지 반납` : '일반 대여 · 수령 확인 후 4시간 내 반납 (점심시간 12:00~13:00 제외)';
  return terms.reviewReason ? `${label} · 관리자 변경 사유: ${terms.reviewReason}` : label;
}
