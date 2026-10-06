// Date.prototype.toISOString()은 서버 시스템 시계가 서울(KST, UTC+9)로 맞춰져 있어도 무조건 UTC로
// 변환해서 돌려주기 때문에, 그걸 그대로 저장하면 실제보다 9시간 전 시각이 남는 문제가 있었다.
// 로컬(서울) 시각을 "YYYY-MM-DD HH:mm:ss" 형식으로 돌려준다 (xlsx 임포트의 dateStr()와 동일한 형식).
export function nowKst() {
  const d = new Date();
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** DB의 시각 문자열("YYYY-MM-DD HH:mm:ss", 서울 로컬)이나 옛 ISO/UTC 문자열을 실제 시각(ms)으로 바꾼다.
 *  문자열끼리 그대로 비교하면 형식이 다른 순간 판정이 틀어질 수 있어, 항상 실제 시각으로 비교해야 한다. */
export function parseKstMs(value) {
  const raw = String(value || "").trim();
  if (!raw) return NaN;
  const normalized = /Z$|[+-]\d{2}:\d{2}$/.test(raw) ? raw : raw.replace(" ", "T");
  return new Date(normalized).getTime();
}

/** 어떤 시각이 Day/Night 어느 근무조에 속하는지 판단한다.
 *  Day: 08:50~17:45, Night: 그 외 시간(17:50~다음날 01:00 및 그 사이 자투리 시간 포함) — 실제 근무
 *  시간대(분 단위)를 기준으로 하며, 두 근무조 사이의 짧은 틈(17:45~17:50, 01:00~08:50)은 Night로 취급한다.
 *  타임스탬프가 "...Z"나 오프셋이 붙은 UTC 문자열이면(옛 데이터) 서울 시각으로 변환해서 판단하고,
 *  "YYYY-MM-DD HH:mm:ss"(로컬) 형식이면 그대로 시각을 읽는다. */
export function shiftOf(timestamp) {
  if (!timestamp) return null;
  const raw = String(timestamp).trim();
  let hour, minute;
  if (/Z$/.test(raw) || /[+-]\d{2}:\d{2}$/.test(raw)) {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    const kstTotalMin = (d.getUTCHours() * 60 + d.getUTCMinutes() + 9 * 60) % (24 * 60);
    hour = Math.floor(kstTotalMin / 60);
    minute = kstTotalMin % 60;
  } else {
    const m = raw.match(/(\d{2}):(\d{2})/);
    if (!m) return null;
    hour = Number(m[1]);
    minute = Number(m[2]);
  }
  const totalMin = hour * 60 + minute;
  const DAY_START = 8 * 60 + 50; // 08:50
  const DAY_END = 17 * 60 + 45; // 17:45
  return totalMin >= DAY_START && totalMin < DAY_END ? "day" : "night";
}
