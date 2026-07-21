/**
 * 창고 랙 배치 설정
 * ------------------------------------------------------------
 * 이 파일만 수정하면 배치도 모양/범위/색상을 바꿀 수 있습니다.
 *
 * - kind: "numeric"  → 시나리오 오브젝트(root_slot 6자리 숫자) 위치. 000000~000251, 100000~100026 범위.
 *         "letter"   → 공구 및 부품류(공구 및 부품류) 위치. InventoryItem.location 문자열의 접두어로 매칭.
 *         "info"     → 클릭 불가한 안내 라벨 (물품 관리자 위치, 사물함, 진열대 등)
 *         "label"    → 랙 이름만 표시하는 하단 라벨 (클릭 불가)
 *
 * - gridColumn / gridRow: CSS grid 좌표 ("시작 / 끝" 형식, 1부터 시작)
 * - rowSizes: numeric 전용. 슬롯을 몇 개씩 끊어서 한 줄로 배치할지.
 *     예) [6]        → 모든 줄이 6개씩 (000번대 랙)
 *     예) [4,4,4,3]  → 앞 3줄은 4개씩, 그 이후 줄들은 계속 3개씩 (100번대 랙)
 */

export type ZoneKind = "numeric" | "letter" | "info" | "label";

export interface RackZone {
  id: string;
  label: string;
  kind: ZoneKind;
  gridColumn: string;
  gridRow: string;
  color: string;
  // numeric 전용
  start?: number;
  end?: number;
  rowSizes?: number[];
  // letter 전용: InventoryItem.location 문자열이 이 접두어로 시작하면 매칭
  matchPrefix?: string;
}

export const GRID_COLUMNS = 8;
export const GRID_ROWS = 8;

export const RACK_ZONES: RackZone[] = [
  // 좌측 진열대 (안내용, 클릭 불가)
  { id: "shelf-info", label: "대여 물품\n진열하는 곳", kind: "info", gridColumn: "1 / 2", gridRow: "1 / 6", color: "#cfe3e0" },

  // 상단 물품 관리자 위치 안내
  { id: "mgr1", label: "물품 관리자 위치", kind: "info", gridColumn: "3 / 5", gridRow: "1 / 2", color: "#f8fafc" },
  { id: "mgr2", label: "물품 관리자 위치", kind: "info", gridColumn: "6 / 8", gridRow: "1 / 2", color: "#f8fafc" },
  { id: "locker-info", label: "사물함", kind: "info", gridColumn: "8 / 9", gridRow: "1 / 2", color: "#f8fafc" },

  // K랙 (100번대, 시나리오 물품) - 문 위/아래로 두 블록
  { id: "K-1", label: "100000~100023", kind: "numeric", gridColumn: "1 / 2", gridRow: "2 / 6", color: "#eef2ff", start: 100000, end: 100023, rowSizes: [4, 4, 4, 3] },
  { id: "door-notice", label: "< 잠긴 출입문(출입 금지) >", kind: "info", gridColumn: "1 / 2", gridRow: "6 / 7", color: "transparent" },
  { id: "K-2", label: "100024~100026", kind: "numeric", gridColumn: "1 / 2", gridRow: "7 / 8", color: "#eef2ff", start: 100024, end: 100026, rowSizes: [3] },

  // I랙 (000000~000119, 시나리오 물품)
  { id: "I-a", label: "000000~000059", kind: "numeric", gridColumn: "3 / 4", gridRow: "2 / 6", color: "#eef2ff", start: 0, end: 59, rowSizes: [6] },
  { id: "I-b", label: "000060~000119", kind: "numeric", gridColumn: "4 / 5", gridRow: "2 / 6", color: "#eef2ff", start: 60, end: 119, rowSizes: [6] },

  // G랙 (000120~000251, 시나리오 물품)
  { id: "G-a", label: "000120~000185", kind: "numeric", gridColumn: "6 / 7", gridRow: "2 / 6", color: "#eef2ff", start: 120, end: 185, rowSizes: [6] },
  { id: "G-b", label: "000186~000251", kind: "numeric", gridColumn: "7 / 8", gridRow: "2 / 6", color: "#eef2ff", start: 186, end: 251, rowSizes: [6] },

  // 사물함 A~E랙 (창고 공구 및 부품류, 위치 문자열 접두어 매칭)
  { id: "A", label: "A 랙", kind: "letter", gridColumn: "8 / 9", gridRow: "2 / 3", color: "#fef3e2", matchPrefix: "A" },
  { id: "B", label: "B 랙", kind: "letter", gridColumn: "8 / 9", gridRow: "3 / 4", color: "#fef3e2", matchPrefix: "B" },
  { id: "C", label: "C 랙", kind: "letter", gridColumn: "8 / 9", gridRow: "4 / 5", color: "#fef3e2", matchPrefix: "C" },
  { id: "D", label: "D 랙", kind: "letter", gridColumn: "8 / 9", gridRow: "5 / 6", color: "#fef3e2", matchPrefix: "D" },
  { id: "E", label: "E 랙", kind: "letter", gridColumn: "8 / 9", gridRow: "6 / 7", color: "#fef3e2", matchPrefix: "E" },

  // 하단 랙 이름 라벨 (클릭 불가, 표시 전용)
  { id: "label-K", label: "K 랙", kind: "label", gridColumn: "1 / 2", gridRow: "8 / 9", color: "#f1f5f9" },
  { id: "label-J", label: "J 랙", kind: "label", gridColumn: "2 / 3", gridRow: "8 / 9", color: "#f1f5f9" },
  { id: "label-I", label: "I 랙", kind: "label", gridColumn: "3 / 5", gridRow: "8 / 9", color: "#f1f5f9" },
  { id: "label-H", label: "H 랙", kind: "label", gridColumn: "5 / 6", gridRow: "8 / 9", color: "#f1f5f9" },
  { id: "label-G", label: "G 랙", kind: "label", gridColumn: "6 / 8", gridRow: "8 / 9", color: "#f1f5f9" },
  { id: "label-F", label: "F 랙", kind: "label", gridColumn: "8 / 9", gridRow: "8 / 9", color: "#f1f5f9" },
];

/**
 * 숫자 범위를 rowSizes 패턴대로 줄 단위로 쪼갠다.
 * 예: start=0, end=13, rowSizes=[4,4,4,3] → [[0,1,2,3],[4,5,6,7],[8,9,10,11],[12,13]]
 * rowSizes 배열보다 줄 수가 많이 필요하면 마지막 값을 계속 반복한다.
 */
export function chunkSlots(start: number, end: number, rowSizes: number[]): number[][] {
  const rows: number[][] = [];
  let cur = start;
  let rowIdx = 0;
  while (cur <= end) {
    const size = rowSizes[Math.min(rowIdx, rowSizes.length - 1)];
    const row: number[] = [];
    for (let i = 0; i < size && cur <= end; i++, cur++) row.push(cur);
    rows.push(row);
    rowIdx++;
  }
  return rows;
}

export function padSlotId(n: number): string {
  return String(n).padStart(6, "0");
}
