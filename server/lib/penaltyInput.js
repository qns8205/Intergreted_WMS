/**
 * 관리자가 보내는 페널티 입력을 검증·정리한다(등록·수정 공통).
 *
 * 예전에는 아무 검증 없이 저장해서 해제일에 "내일쯤" 같은 글자도, 최대 종류에 음수도 들어갈 수 있었다.
 * 해제일이 날짜가 아니면 만료 비교(문자열 비교)가 어긋나 페널티가 풀리지 않거나 바로 풀린다.
 */

function isCalendarDate(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/**
 * @param body            { name, maxTypes, reason, expiresAt }
 * @param keepExpiresAt   수정할 때 지금 저장된 해제일. 예전에 다른 형식으로 저장된 값이라도
 *                        그대로 두는 것(= 안 건드림)은 허용한다 — 다른 항목만 고치려는데 막히면 안 된다.
 * @returns { name, maxTypes: number|null, reason: string|null, expiresAt: string|null }
 */
export function parsePenaltyInput(body, { keepExpiresAt } = {}) {
  const name = String(body?.name ?? "").trim();
  if (!name) throw new Error("이름을 입력해 주세요.");
  if (name.length > 50) throw new Error("이름은 50자 이내로 입력해 주세요.");

  let maxTypes = null;
  const rawMax = body?.maxTypes;
  if (rawMax !== null && rawMax !== undefined && String(rawMax).trim() !== "") {
    const n = Number(rawMax);
    if (!Number.isInteger(n) || n < 0 || n > 999) throw new Error("최대 종류는 0 이상 999 이하의 정수로 입력해 주세요.");
    maxTypes = n;
  }

  const reason = String(body?.reason ?? "").trim();
  if (reason.length > 500) throw new Error("사유는 500자 이내로 입력해 주세요.");

  const rawExpires = String(body?.expiresAt ?? "").trim();
  let expiresAt = null;
  if (rawExpires) {
    const unchanged = keepExpiresAt != null && rawExpires === String(keepExpiresAt).trim();
    if (!unchanged && !isCalendarDate(rawExpires)) throw new Error("해제일은 달력에서 고르거나 YYYY-MM-DD 형식의 올바른 날짜로 입력해 주세요.");
    expiresAt = rawExpires;
  }

  return { name, maxTypes, reason: reason || null, expiresAt };
}
