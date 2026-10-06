/** 한 신청의 물품 행들을 한 번으로 세어, 자주 사용한 좌석을 추천한다. */
export function rankBorrowerSeats(rows, limit = 5, floors) {
  const seats = new Map();
  for (const row of rows) {
    let floor = String(row.floor || "").trim();
    let unit = String(row.unit || "").trim();
    if (!floor || !unit || row.return_source === "cancel") continue;
    if (Array.isArray(floors) && floors.length) {
      const normalize = (value) => String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
      const currentFloor = floors.find((f) => normalize(f.id) === normalize(floor) || normalize(f.name) === normalize(floor));
      if (!currentFloor) continue;
      const units = currentFloor.units || [];
      let currentUnit = units.find((u) => normalize(u.label) === normalize(unit));
      if (!currentUnit) {
        // 같은 층에서 설명만 추가된 옛 유닛명은 유일한 후보에만 연결한다.
        // Human Unit과 Unit, 다른 층, 후보가 여러 개인 좌석은 섞지 않는다.
        const base = (value) => normalize(String(value || "").replace(/\([^)]*\)|（[^）]*）/g, ""));
        const candidates = units.filter((u) => base(u.label) === base(unit));
        if (candidates.length === 1) currentUnit = candidates[0];
      }
      if (!currentUnit) continue;
      floor = currentFloor.id;
      unit = currentUnit.label;
    }
    const key = JSON.stringify([floor, unit]);
    if (!seats.has(key)) seats.set(key, { floor, unit, requests: new Set(), lastUsedAt: "" });
    const seat = seats.get(key);
    const request = row.request_no ? `request:${row.request_no}` : row.batch_id ? `batch:${row.batch_id}` : `${row.sheetType}:${row.id}`;
    seat.requests.add(request);
    const date = String(row.borrow_date || row.applied_at || "");
    if (date > seat.lastUsedAt) seat.lastUsedAt = date;
  }
  return [...seats.values()]
    .map(({ requests, ...seat }) => ({ ...seat, count: requests.size }))
    .sort((a, b) => b.count - a.count || b.lastUsedAt.localeCompare(a.lastUsedAt) || a.floor.localeCompare(b.floor) || a.unit.localeCompare(b.unit))
    .slice(0, limit);
}
