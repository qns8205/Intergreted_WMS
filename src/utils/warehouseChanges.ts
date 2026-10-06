/** COS 물품 "최근 변동"을 보여주는 두 화면(목록 상단 패널, 전체 보기 페이지)이 같이 쓰는 표시 규칙. */

export const KIND_LABEL: Record<string, string> = {
  stock: "재고 조정", created: "신규 등록", updated: "정보 수정", deleted: "삭제",
  borrow: "대여", return: "반납", consume: "소모",
};

/** DB 시각("YYYY-MM-DD HH:mm:ss", 서울)을 "3시간 전" / "어제 15:06" 식으로 보여준다. */
export function relativeTime(at: string): string {
  const t = new Date(String(at || "").replace(" ", "T")).getTime();
  if (Number.isNaN(t)) return at || "";
  const diffMin = Math.floor((Date.now() - t) / 60000);
  if (diffMin < 1) return "방금";
  if (diffMin < 60) return `${diffMin}분 전`;
  if (diffMin < 6 * 60) return `${Math.floor(diffMin / 60)}시간 전`;
  const d = new Date(t), now = new Date();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const dayDiff = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000);
  if (dayDiff === 0) return `오늘 ${hm}`;
  if (dayDiff === 1) return `어제 ${hm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}
