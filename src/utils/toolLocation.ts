/**
 * COS 물품 보관 위치 코드.
 *
 *   F-02        랙 F-02 (구역 미정)
 *   F-02-5      랙 F-02의 5구역
 *
 * 랙마다 구역 수(1~9)를 정한다. 구역은 한 줄에 최대 3칸(4구역만 2×2)으로 놓고,
 * 앞줄(통로 쪽)부터 왼쪽 → 오른쪽으로 번호를 매긴다. 7구역이면 앞 1·2·3, 가운데 4·5·6, 뒤 7.
 * 예전 코드(F-02-3B처럼 뒤에 글자가 붙은 값)는 앞의 숫자만 구역 번호로 읽는다.
 */

export const DEFAULT_SECTIONS = 3;
export const MAX_SECTIONS = 9;

export interface ToolLocation {
  raw: string;
  /** "F-02" — 랙 코드이자 목록의 묶음 키 */
  rack: string;
  /** "F" — 왼쪽 목록에서 랙을 모아 보여줄 때 쓰는 첫 글자 */
  rackGroup: string;
  section: number | null;
}

export function parseToolLocation(loc: string | null | undefined): ToolLocation {
  const raw = String(loc ?? "").trim().toUpperCase();
  const parts = raw.split("-").filter((p) => p !== "");
  const rack = parts.slice(0, 2).join("-");
  const m = parts.length >= 3 ? /^([1-9])/.exec(parts[2]) : null;
  return { raw, rack, rackGroup: parts[0] || "", section: m ? Number(m[1]) : null };
}

/** 랙(F)의 층 수 설정 → 층 코드 목록. 5 → ["F-00", "F-01", "F-02", "F-03", "F-04"] */
export function levelCodes(rackGroup: string, count: number): string[] {
  const g = String(rackGroup || "").trim().toUpperCase();
  const n = Math.max(0, Math.min(20, Math.round(Number(count) || 0)));
  return g ? Array.from({ length: n }, (_, i) => `${g}-${String(i).padStart(2, "0")}`) : [];
}

/** 랙 단위 묶음 키. 구역이 붙어 있어도 같은 랙이면 같은 키다. */
export function toolRackKey(loc: string | null | undefined): string {
  return parseToolLocation(loc).rack || "미지정";
}

export function buildToolLocation(rack: string, section: number | null): string {
  const r = String(rack || "").trim().toUpperCase();
  if (!r) return "";
  return section ? `${r}-${section}` : r;
}

export function clampSections(n: unknown): number {
  const v = Math.round(Number(n));
  return Number.isFinite(v) && v >= 1 ? Math.min(MAX_SECTIONS, v) : DEFAULT_SECTIONS;
}

/**
 * 구역 수 → 줄별 구역 번호. 앞줄(통로 쪽)이 첫 줄이다.
 * 1:[1] 2:[1,2] 3:[1,2,3] 4:[1,2][3,4] 5:[1,2,3][4,5] … 9:[1,2,3][4,5,6][7,8,9]
 */
export function sectionRows(count: number): number[][] {
  const n = clampSections(count);
  const perRow = n === 4 ? 2 : Math.min(3, n);
  const rows: number[][] = [];
  for (let i = 1; i <= n; i += perRow) rows.push(Array.from({ length: Math.min(perRow, n - i + 1) }, (_, k) => i + k));
  return rows;
}

/** 줄 이름 — 1줄이면 없음, 2줄이면 앞/뒤, 3줄이면 앞/가운데/뒤 */
export function rowLabels(rowCount: number): string[] {
  return rowCount === 3 ? ["앞", "가운데", "뒤"] : rowCount === 2 ? ["앞", "뒤"] : [""];
}

/** "5구역" / "구역 미정" */
export function sectionLabel(p: ToolLocation): string {
  return p.section ? `${p.section}구역` : "구역 미정";
}

/** "F-02 · 5구역" — 사람이 읽는 위치 */
export function formatToolLocation(loc: string | null | undefined): string {
  const p = parseToolLocation(loc);
  if (!p.rack) return "위치 미등록";
  return p.section ? `${p.rack} · ${p.section}구역` : p.rack;
}

/** 랙 코드(글자 → 번호) → 구역 번호 순. 구역 미정은 그 랙의 맨 앞에 둔다. */
export function compareToolLocation(a: string | null | undefined, b: string | null | undefined): number {
  const pa = parseToolLocation(a), pb = parseToolLocation(b);
  if (pa.rackGroup !== pb.rackGroup) return pa.rackGroup < pb.rackGroup ? -1 : 1;
  const na = parseInt(pa.rack.split("-")[1]?.replace(/\D/g, "") ?? "", 10);
  const nb = parseInt(pb.rack.split("-")[1]?.replace(/\D/g, "") ?? "", 10);
  const ia = Number.isNaN(na) ? 999999 : na, ib = Number.isNaN(nb) ? 999999 : nb;
  if (ia !== ib) return ia - ib;
  if (pa.rack !== pb.rack) return pa.rack < pb.rack ? -1 : 1;
  return (pa.section ?? 0) - (pb.section ?? 0);
}
