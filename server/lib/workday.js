// QR 위치 안내와 내 대여 조회가 같은 작업일을 사용한다.
// 서울 시각 오전 1시 전까지는 전날의 야간 작업에 포함한다.
export function workdayDateKey(value = new Date()) {
  const raw = String(value ?? "").trim();
  const local = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
  const date = local
    ? new Date(`${local[1]}T${local[2]}:${local[3]}:${local[4] || "00"}+09:00`)
    : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return raw.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(date.getTime() - 60 * 60 * 1000));
}

export function isRentalCancelled(row) {
  return row.return_source === "cancel" || (row.returned === "O" && !row.return_source && !row.picked_up_at);
}

export function returnedThisWorkday(row, workday = workdayDateKey()) {
  return row.returned === "O" && !!row.return_date && workdayDateKey(row.return_date) === workday;
}
