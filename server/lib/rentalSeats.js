const seatKey = (row) => row.batch_id ? JSON.stringify([row.batch_id, row.borrower_name]) : "";

/** 과거 부분 반납 행에서 누락된 좌석을 같은 신청·명의의 원래 행으로 보완한다. */
export function rentalSeatIndex(rows) {
  const index = new Map();
  for (const row of rows) {
    const key = seatKey(row);
    if (!key || !row.floor || !row.unit) continue;
    if (!index.has(key)) index.set(key, new Map());
    index.get(key).set(JSON.stringify([row.floor, row.unit]), { floor: row.floor, unit: row.unit });
  }
  return index;
}

export function rentalSeatOf(row, index) {
  if (row.floor && row.unit) return { floor: row.floor, unit: row.unit };
  const seats = [...(index.get(seatKey(row))?.values() || [])].filter((seat) =>
    (!row.floor || seat.floor === row.floor) && (!row.unit || seat.unit === row.unit));
  // 여러 자리가 후보면 임의로 선택하지 않고 관리자에게 새 좌석을 요청한다.
  return seats.length === 1 ? seats[0] : { floor: row.floor || "", unit: row.unit || "" };
}
