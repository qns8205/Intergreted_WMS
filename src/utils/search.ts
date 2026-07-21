/**
 * 검색 유틸리티
 * - 단순 부분일치 기반 (대소문자·공백·하이픈·괄호 무시)
 * - 검색어를 공백으로 쪼갠 다중 단어 검색 지원 (모든 단어가 포함되어야 매칭)
 *
 * (이전에는 한글↔영어 동의어 사전 + 초성 검색까지 지원했으나, 의도치 않은 항목까지
 *  같이 걸리는 문제가 있어 단순 부분일치로 단순화했다.)
 */

// 정규화: 소문자, 공백/하이픈/괄호 등 제거
function norm(s: string): string {
  return String(s || "").toLowerCase().replace(/[\s\-_()[\].,/]+/g, "");
}

/**
 * 품목이 검색어와 매칭되는지 판단.
 * @param haystackParts 품목의 검색 대상 문자열들 (이름, 위치, 규격 등)
 * @param query 사용자 검색어
 */
export function smartMatch(haystackParts: (string | null | undefined)[], query: string): boolean {
  const q = String(query || "").trim();
  if (!q) return true;

  const combined = haystackParts.map((p) => norm(String(p || ""))).filter(Boolean).join(" ");

  // 1) 검색어 전체를 그대로 부분일치
  const nq = norm(q);
  if (nq && combined.includes(nq)) return true;

  // 2) 공백으로 구분된 다중 단어 검색 (모든 단어가 포함되어야 매칭)
  const words = q.trim().split(/\s+/).map(norm).filter(Boolean);
  if (words.length > 1 && words.every((w) => combined.includes(w))) return true;

  return false;
}
