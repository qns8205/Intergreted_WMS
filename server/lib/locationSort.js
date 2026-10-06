// 물품을 창고의 실제 이동 동선 순서로 정렬한다.
// ※ src/utils/borrowApi.ts의 computeLocationSortIndex와 같은 순서를 유지해야 한다.
const ROW_SLOTS = 6;
const FACING_A = { start: 120, end: 185 };
const FACING_B = { start: 60, end: 119 };

export function locationSortIndex(rootSlot) {
  const n = parseInt(String(rootSlot || "").replace(/\D/g, ""), 10);
  if (Number.isNaN(n)) return Number.MAX_SAFE_INTEGER;

  if (n >= 186 && n <= 251) return n;
  if (n >= FACING_A.start && n <= FACING_A.end) {
    const d = FACING_A.end - n;
    return 1000 + Math.floor(d / ROW_SLOTS) * (ROW_SLOTS * 2) + (d % ROW_SLOTS);
  }
  if (n >= FACING_B.start && n <= FACING_B.end) {
    const d = FACING_B.end - n;
    return 1000 + Math.floor(d / ROW_SLOTS) * (ROW_SLOTS * 2) + ROW_SLOTS + (d % ROW_SLOTS);
  }
  if (n >= 0 && n <= 59) return 3000 + n;
  if (n >= 100000 && n <= 100025) return 4000 + (n - 100000);
  return 5000 + n;
}
