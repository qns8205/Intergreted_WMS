const AUTO_COMPLETE_MS = 30 * 60 * 1000;

// DB의 시각은 주로 오프셋 없는 서울 시각이다. 서버나 QR을 연 휴대폰의
// 시간대에 영향을 받지 않도록 KST로 해석한다. 옛 ISO 시각도 지원한다.
export function isReturnStepAutoDone(returnDate, nowMs = Date.now()) {
  const raw = String(returnDate || "").trim();
  if (!raw) return false;
  const local = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/.exec(raw);
  const at = Date.parse(local ? `${local[1]}T${local[2]}+09:00` : raw);
  return Number.isFinite(at) && nowMs >= at + AUTO_COMPLETE_MS;
}
