/** 테이블보 분류 체계.
 *
 *  테이블보는 이름이 번호(TC-0007)뿐이라 목록에서 "무엇인지"를 알려주는 정보가 사진밖에 없다.
 *  100장이 넘어가면 원하는 천을 찾으려고 사진을 전부 훑어야 해서, 촬영 담당이 실제로 고르는
 *  기준 — 무늬의 종류 — 을 대분류로, 그 안에서 다시 갈리는 결(체크의 크기, 캐릭터의 종류 등)을
 *  소분류로 둔다. 무지만은 무늬가 없으니 색 계열이 곧 소분류다.
 *
 *  분류표 자체는 서버(DB)에 있고 "분류 관리" 화면에서 고친다. 여기 있는 목록은 서버 응답이
 *  오기 전에 화면이 비지 않게 하는 기본값일 뿐이라, 이걸 고쳐도 이미 운영 중인 분류표는
 *  바뀌지 않는다(서버의 lib/tableclothCategoryDefaults.js 가 실제 씨앗이다).
 *
 *  물품에는 항상 key만 저장한다 — 라벨을 저장하면 이름을 고치는 순간 옛 이름이 물품에 남는다. */

export interface TcSubcategory {
  key: string;
  label: string;
}
export interface TcCategory {
  key: string;
  label: string;
  emoji: string;
  /** 필터 칩·배지 색. 대분류를 눈으로 구분하는 유일한 단서라 서로 충분히 떨어뜨려 둔다. */
  color: string;
  subs: TcSubcategory[];
}

export const TC_DEFAULT_CATEGORIES: TcCategory[] = [
  { key: "solid", label: "무지", emoji: "⬛", color: "#64748b", subs: [
    { key: "warm", label: "레드·핑크" },
    { key: "yellow", label: "오렌지·옐로우" },
    { key: "green", label: "그린" },
    { key: "blue", label: "블루" },
    { key: "purple", label: "퍼플" },
    { key: "neutral", label: "화이트·베이지·브라운" },
    { key: "mono", label: "블랙·그레이" },
  ]},
  { key: "check", label: "체크", emoji: "🔲", color: "#dc2626", subs: [
    { key: "gingham", label: "잔체크(깅엄)" },
    { key: "buffalo", label: "큰체크" },
    { key: "windowpane", label: "격자선" },
  ]},
  { key: "stripe", label: "줄무늬", emoji: "🟰", color: "#ea580c", subs: [
    { key: "bold", label: "굵은 줄" },
    { key: "fine", label: "가는 줄" },
  ]},
  { key: "dot", label: "도트", emoji: "⚪", color: "#d946ef", subs: [
    { key: "small", label: "잔도트" },
    { key: "large", label: "큰도트" },
  ]},
  { key: "geometric", label: "기하학", emoji: "🔷", color: "#0891b2", subs: [
    { key: "triangle", label: "삼각형" },
    { key: "diamond", label: "마름모·다이아" },
    { key: "circle", label: "원·곡선" },
    { key: "chevron", label: "지그재그·헤링본" },
  ]},
  { key: "floral", label: "꽃무늬", emoji: "🌸", color: "#db2777", subs: [
    { key: "small", label: "잔꽃" },
    { key: "large", label: "큰꽃" },
  ]},
  { key: "character", label: "캐릭터·동물", emoji: "🐻", color: "#16a34a", subs: [
    { key: "bear", label: "곰" },
    { key: "catdog", label: "고양이·강아지" },
    { key: "etc", label: "그 외 동물" },
  ]},
  { key: "object", label: "사물·과일", emoji: "🍋", color: "#ca8a04", subs: [
    { key: "food", label: "과일·음식" },
    { key: "star", label: "별" },
    { key: "vehicle", label: "탈것" },
    { key: "etc", label: "그 외 사물" },
  ]},
  { key: "ethnic", label: "에스닉·전통", emoji: "🧶", color: "#b45309", subs: [
    { key: "stripe", label: "스트라이프형" },
    { key: "geo", label: "기하형" },
  ]},
  { key: "photo", label: "사진 프린트", emoji: "🖼️", color: "#2563eb", subs: [
    { key: "nature", label: "자연·풍경" },
    { key: "object", label: "사물" },
  ]},
  { key: "abstract", label: "추상·라인", emoji: "〰️", color: "#7c3aed", subs: [
    { key: "doodle", label: "두들·라인" },
  ]},
];

export function tcCategory(cats: TcCategory[], key?: string): TcCategory | null {
  return (key && cats.find((c) => c.key === key)) || null;
}

export function tcSubLabel(cats: TcCategory[], catKey?: string, subKey?: string): string {
  if (!subKey) return "";
  return tcCategory(cats, catKey)?.subs.find((s) => s.key === subKey)?.label || "";
}

/** 카드 배지·검색에 쓰는 한 줄 표기. 소분류가 없으면 대분류만 나온다. */
export function tcLabel(cats: TcCategory[], catKey?: string, subKey?: string): string {
  const c = tcCategory(cats, catKey)?.label || "";
  if (!c) return "";
  const sub = tcSubLabel(cats, catKey, subKey);
  return sub ? `${c} · ${sub}` : c;
}

export function tcColor(cats: TcCategory[], key?: string): string {
  return tcCategory(cats, key)?.color || "#94a3b8";
}

/** 새 분류를 만들 때 쓸 key. 라벨은 한글이고 나중에 바뀔 수도 있어서 key로 삼지 않는다 —
 *  물품이 참조하는 값이라 한 번 정해지면 그대로 둬야 한다. */
export function tcNewKey(prefix = "c"): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** 필터 칩 후보 — 실제로 그 분류에 속한 게 있는 대분류만, 분류표에 적힌 순서대로 센다.
 *  분류가 안 된 것이 남아 있으면 마지막에 "미분류"로 모아 준다(빠뜨린 걸 찾는 통로). */
export function tcCategoryOptions<T extends { category?: string }>(
  cats: TcCategory[], items: T[]
): { key: string; label: string; emoji: string; color: string; count: number }[] {
  const out = cats
    .map((c) => ({
      key: c.key, label: c.label, emoji: c.emoji, color: c.color || "#94a3b8",
      count: items.filter((it) => it.category === c.key).length,
    }))
    .filter((o) => o.count > 0);
  const none = items.filter((it) => !tcCategory(cats, it.category)).length;
  if (none) out.push({ key: "__none__", label: "미분류", emoji: "❔", color: "#94a3b8", count: none });
  return out;
}

/** 대분류 안에서 다시 좁힐 소분류 칩. 후보가 하나뿐이면 고를 이유가 없어 비워 보낸다. */
export function tcSubOptions<T extends { category?: string; subcategory?: string }>(
  cats: TcCategory[], items: T[], catKey: string
): { key: string; label: string; count: number }[] {
  const cat = tcCategory(cats, catKey);
  if (!cat) return [];
  const inCat = items.filter((it) => it.category === catKey);
  const out = cat.subs
    .map((sub) => ({ key: sub.key, label: sub.label, count: inCat.filter((it) => it.subcategory === sub.key).length }))
    .filter((o) => o.count > 0);
  const none = inCat.filter((it) => !it.subcategory).length;
  if (none) out.push({ key: "__none__", label: "미지정", count: none });
  return out.length > 1 ? out : [];
}

/** 저장해 둔 링크 묶음을 한 줄씩 끊어 낸다. 화면에서 눌러 열 수 있는 것만 남긴다 —
 *  서버가 이미 걸러 두지만, 예전에 들어간 값이나 다른 경로로 들어온 값이 섞일 수 있어
 *  href에 넣기 직전에 한 번 더 본다(javascript: 같은 건 누르는 순간 실행이 된다). */
export function tcLinks(raw?: string): string[] {
  return String(raw || "")
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter((v) => /^https?:\/\//i.test(v));
}

/** 링크를 짧게 보여줄 때 쓰는 이름 — 도메인만 남긴다(주소 전체는 카드에서 너무 길다). */
export function tcLinkLabel(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "") + (u.pathname !== "/" ? "…" : "");
  } catch {
    return url;
  }
}
