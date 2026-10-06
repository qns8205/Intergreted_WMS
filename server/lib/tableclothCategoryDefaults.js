/** 테이블보 분류표의 초기값.
 *
 *  분류표는 이제 DB(`tablecloth_categories`)에 있고 화면에서 고칠 수 있다. 이 파일은 "처음 한 번"
 *  채워 넣는 씨앗일 뿐이라, 운영 중에 여기를 고쳐도 이미 채워진 DB는 바뀌지 않는다.
 *  (프런트의 src/utils/tableclothCategory.ts 에도 같은 목록이 로딩 전 표시용으로 있다.) */
export const DEFAULT_TABLECLOTH_CATEGORIES = [
  { key: "solid", label: "무지", emoji: "⬛", color: "#64748b", subs: [
    { key: "warm", label: "레드·핑크" }, { key: "yellow", label: "오렌지·옐로우" },
    { key: "green", label: "그린" }, { key: "blue", label: "블루" }, { key: "purple", label: "퍼플" },
    { key: "neutral", label: "화이트·베이지·브라운" }, { key: "mono", label: "블랙·그레이" },
  ]},
  { key: "check", label: "체크", emoji: "🔲", color: "#dc2626", subs: [
    { key: "gingham", label: "잔체크(깅엄)" }, { key: "buffalo", label: "큰체크" },
    { key: "windowpane", label: "격자선" },
  ]},
  { key: "stripe", label: "줄무늬", emoji: "🟰", color: "#ea580c", subs: [
    { key: "bold", label: "굵은 줄" }, { key: "fine", label: "가는 줄" },
  ]},
  { key: "dot", label: "도트", emoji: "⚪", color: "#d946ef", subs: [
    { key: "small", label: "잔도트" }, { key: "large", label: "큰도트" },
  ]},
  { key: "geometric", label: "기하학", emoji: "🔷", color: "#0891b2", subs: [
    { key: "triangle", label: "삼각형" }, { key: "diamond", label: "마름모·다이아" },
    { key: "circle", label: "원·곡선" }, { key: "chevron", label: "지그재그·헤링본" },
  ]},
  { key: "floral", label: "꽃무늬", emoji: "🌸", color: "#db2777", subs: [
    { key: "small", label: "잔꽃" }, { key: "large", label: "큰꽃" },
  ]},
  { key: "character", label: "캐릭터·동물", emoji: "🐻", color: "#16a34a", subs: [
    { key: "bear", label: "곰" }, { key: "catdog", label: "고양이·강아지" }, { key: "etc", label: "그 외 동물" },
  ]},
  { key: "object", label: "사물·과일", emoji: "🍋", color: "#ca8a04", subs: [
    { key: "food", label: "과일·음식" }, { key: "star", label: "별" },
    { key: "vehicle", label: "탈것" }, { key: "etc", label: "그 외 사물" },
  ]},
  { key: "ethnic", label: "에스닉·전통", emoji: "🧶", color: "#b45309", subs: [
    { key: "stripe", label: "스트라이프형" }, { key: "geo", label: "기하형" },
  ]},
  { key: "photo", label: "사진 프린트", emoji: "🖼️", color: "#2563eb", subs: [
    { key: "nature", label: "자연·풍경" }, { key: "object", label: "사물" },
  ]},
  { key: "abstract", label: "추상·라인", emoji: "〰️", color: "#7c3aed", subs: [
    { key: "doodle", label: "두들·라인" },
  ]},
];
