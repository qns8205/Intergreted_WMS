/**
 * 다국어/유연 검색 유틸리티
 * - 한글 검색어로 영어 품목명 매칭 (물병 → bottled water/bottle)
 * - 영어 검색어로 한글 품목명 매칭 (cable → 케이블)
 * - 대소문자·공백·하이픈 무시 (부분일치)
 * - 초성 검색 (ㅋㅇㅂ → 키보드)
 */

// 한글 ↔ 영어 동의어 사전 (실제 창고/시나리오 품목 기반)
// 각 그룹의 단어들은 서로 매칭됨. 확장하려면 배열에 단어만 추가하면 됨.
const SYNONYM_GROUPS: string[][] = [
  // ── 음료·컵·식기 ──
  ["물병", "물통", "병", "bottle", "bottled water", "water bottle", "물", "pet bottle", "petbottle", "fat bottle", "wine bottle", "beer bottle"],
  ["컵", "잔", "cup", "mug", "머그", "머그컵", "종이컵", "paper cup", "plastic cup", "ice cup", "tumbler", "텀블러", "샷글라스", "shot glass", "party cup"],
  ["맥주잔", "맥주", "beer", "beer bottle", "beer cap"],
  ["와인잔", "와인", "wine", "wine glass", "wine bottle"],
  ["유리잔", "유리", "glass", "glasses", "stainless steel cup"],
  ["빨대", "straw", "paper straw", "muddler", "머들러"],
  ["컵홀더", "컵캐리어", "캐리어", "cup carrier", "cup sleeve", "슬리브", "coaster", "코스터", "받침"],
  ["그릇", "볼", "bowl", "rice bowl", "soup bowl", "mixing bowl", "picnic bowl", "밥그릇", "국그릇"],
  ["접시", "그릇", "plate", "dish", "sauce dish", "dipping dish", "petri dish", "샐러드", "matte plate"],
  ["숟가락", "스푼", "spoon", "scoop", "스쿱", "measuring spoon", "ladle", "국자", "dipper"],
  ["젓가락", "chopstick", "chopsticks"],
  ["포크", "fork"],
  ["나이프", "칼", "knife", "box cutter", "cutter", "커터"],
  ["수저", "커트러리", "cutlery", "utensil", "cutlery organizer", "utensil holder"],
  ["집게", "tongs", "그리퍼", "gripper", "grip"],
  ["계량컵", "measuring cup", "계량", "measuring", "measuring spoon", "measuring tape"],
  ["주전자", "포트", "pot", "drip pot", "kettle", "syrup pump", "시럽"],
  ["믹서", "블렌더", "blender", "믹싱볼", "mixing bowl", "whisk", "휘퍼", "거품기"],
  ["뚜껑", "lid", "lid holder", "cap", "캡", "opener", "오프너", "따개", "capper"],
  ["쟁반", "트레이", "tray", "aluminum tray", "flat tray", "donut tray", "food tray"],
  ["냄비", "팬", "프라이팬", "pan", "frying pan", "frying-pan", "dish pan"],
  ["채반", "콜랜더", "colander", "drying rack", "건조대", "dish drying rack"],
  ["주걱", "스패튤라", "spatula", "silicone spatula", "metal spatula"],
  // ── 음식 ──
  ["빵", "bread", "sliced bread", "butter roll", "toast", "토스트", "waffle", "와플", "bakery"],
  ["도넛", "donut", "도너츠"],
  ["피자", "pizza"],
  ["햄버거", "hamburger", "버거", "burger"],
  ["과자", "스낵", "snack", "candy", "사탕", "쿠키", "cookie", "popcorn", "팝콘", "macaroon", "마카롱", "confetti"],
  ["커피", "coffee", "espresso", "에스프레소", "instant coffee", "capsule", "캡슐", "브루잉", "brewing"],
  ["콜라", "coke", "coke", "pepsi", "펩시", "사이다", "sprite", "스프라이트", "음료", "drink", "beverage", "ionic drink"],
  ["과일", "fruit", "strawberry", "딸기", "kiwi", "키위", "banana"],
  ["계란", "달걀", "egg", "egg tray"],
  ["고기", "pork", "belly", "roasted pork"],
  ["얼음", "ice", "ice maker", "ice cup", "제빙기"],
  ["차", "tea", "earl grey", "얼그레이"],
  // ── 의류 ──
  ["티셔츠", "티", "t-shirt", "tshirt", "shirt", "셔츠", "dress shirt", "crop", "sleeveless", "long sleeve", "short sleeve", "polo"],
  ["바지", "팬츠", "pants", "shorts", "반바지", "denim", "청바지", "training pants", "skirt", "치마", "스커트"],
  ["양말", "socks", "sock"],
  ["신발", "shoes", "슈즈", "슬리퍼", "slipper", "슬리퍼", "house slippers"],
  ["넥타이", "타이", "tie", "neck tie", "necktie"],
  ["가방", "bag", "sling bag", "백", "basket", "바구니", "laundry basket", "market basket", "shopping basket"],
  ["모자", "cap", "hat", "안전모", "헬멧", "helmet", "hard hat", "hardhat"],
  ["수건", "타월", "towel", "napkin", "냅킨", "행주", "cloth"],
  // ── 전자·케이블 ──
  ["케이블", "선", "cable", "cord", "wire", "와이어", "코드", "extension cable", "usb", "hdmi", "sata", "atx", "flat cable", "power cable"],
  ["카메라", "camera", "cam", "캠", "웹캠", "webcam"],
  ["키보드", "keyboard", "키패드"],
  ["마우스", "mouse"],
  ["모니터", "monitor", "디스플레이", "display", "화면", "screen"],
  ["허브", "hub", "usb hub"],
  ["어댑터", "아답터", "adapter", "adaptor", "converter", "컨버터"],
  ["스위치", "switch", "kvm"],
  ["배터리", "건전지", "battery", "밧데리", "보조배터리", "coin", "코인", "충전"],
  ["전구", "램프", "라이트", "조명", "light", "lamp", "bulb", "led", "무드등", "mirror ball", "미러볼"],
  ["컴퓨터", "pc", "본체", "desktop", "데스크탑", "메인보드", "mainboard", "motherboard"],
  ["보드", "board", "pcb", "breadboard", "브레드보드", "아두이노", "arduino", "기판"],
  ["스마트폰", "폰", "핸드폰", "smartphone", "smart phone", "phone", "태블릿", "tablet"],
  ["이어폰", "earphone", "헤드폰", "headphone", "무선이어폰", "wireless earphone", "이어셋"],
  ["스캐너", "scanner", "바코드", "barcode", "reader", "리더", "캡쳐카드", "capture"],
  ["계산기", "calculator", "저울", "scale", "electronic scale", "전자저울"],
  ["타이머", "timer", "시계", "clock", "digital clock"],
  ["피아노", "piano", "electric piano", "건반"],
  ["vr", "meta quest", "메타퀘스트", "퀘스트", "quest"],
  // ── 나사·부품 ──
  ["나사", "볼트", "스크류", "screw", "bolt", "나사못", "screwdriver", "드라이버"],
  ["너트", "nut", "육각너트", "스프링너트"],
  ["와셔", "washer", "워셔", "평와셔", "스프링와셔"],
  ["드라이버", "driver", "screwdriver", "스크류드라이버", "mini driver", "전동드라이버"],
  ["드릴", "drill", "전동드릴", "그라인더", "grinder"],
  ["렌치", "wrench", "육각렌치", "hex", "육각"],
  ["펜치", "니퍼", "플라이어", "plier", "pliers", "nipper", "가위", "scissors"],
  ["클램프", "고정", "clamp", "클립", "clip", "binder clip", "clothespin", "집게"],
  ["베어링", "bearing", "볼베어링", "ball bearing"],
  ["밸브", "valve", "ball valve", "t-valve"],
  ["호스", "hose", "water hose", "튜브", "tube"],
  ["인서트", "insert", "리벳", "rivet", "황동", "brass"],
  // ── 로봇 (사업 특화) ──
  ["그리퍼", "gripper", "grip", "robotiq", "로보틱", "franka", "프랑카", "vega", "베가", "핸드", "hand", "휴먼그리퍼"],
  ["핑거", "손가락", "finger", "finger holder", "핑거홀더"],
  ["기어", "톱니", "gear", "elbow", "엘보"],
  ["마운트", "거치대", "홀더", "mount", "holder", "받침대", "스탠드", "stand", "neck holder", "넥홀더", "platform"],
  ["하우징", "housing", "케이스", "case", "몸통", "body"],
  ["비상정지", "emergency", "emergency stop", "estop", "정지"],
  ["플레이트", "plate", "판", "보강판", "받침"],
  // ── 문구·사무 ──
  ["펜", "pen", "볼펜", "마커", "marker", "형광펜", "highlighter", "네임펜", "name pen", "매직", "sharpie"],
  ["연필", "pencil", "샤프", "mechanical pencil", "샤프펜"],
  ["지우개", "eraser", "화이트보드지우개", "whiteboard eraser"],
  ["테이프", "tape", "scotch", "스카치", "masking", "마스킹", "절연테이프", "correction tape", "수정테이프"],
  ["종이", "paper", "a4", "a4 paper", "baking paper", "크래프트", "kraft", "parchment"],
  ["노트", "공책", "note", "spring note", "포스트잇", "sticky note", "메모지"],
  ["화이트보드", "whiteboard", "칠판", "board marker", "보드마카"],
  ["클립보드", "clipboard", "바인더", "binder"],
  ["스테이플러", "stapler", "호치키스", "스템플러"],
  ["라벨", "label", "스티커", "sticker", "barcode sticker"],
  ["봉투", "가방", "bag", "paper bag", "지퍼백", "zipper bag", "poly bag", "폴리백", "mailer", "봉지"],
  ["박스", "상자", "box", "케이스", "case", "package box", "gift box", "wooden box", "living box", "리빙박스"],
  // ── 청소·생활 ──
  ["빗자루", "broom", "쓰레받기", "dustpan", "청소", "cleaning"],
  ["걸레", "mop", "dust mop", "밀대", "먼지"],
  ["스펀지", "sponge", "스폰지", "esd sponge", "dish sponge", "수세미"],
  ["쓰레기통", "trash", "trash can", "휴지통", "recycling", "재활용", "bin"],
  ["휴지", "티슈", "tissue", "냅킨", "napkin", "물티슈", "wipes", "alcohol wipes"],
  ["옷걸이", "hanger", "행거", "hook", "후크", "걸이"],
  ["서랍", "drawer", "정리함", "organizer", "선반", "shelf", "정리", "storage"],
  ["칫솔", "toothbrush", "brush", "솔", "shoe brush"],
  ["장갑", "골무", "glove", "손가락골무", "finger"],
  // ── 화학·기타 ──
  ["접착제", "본드", "글루", "풀", "glue", "adhesive", "에폭시", "epoxy", "글루건", "glue gun"],
  ["스프레이", "spray", "방향제", "에프킬라", "colorant", "착색"],
  ["윤활유", "구리스", "그리스", "grease", "오일", "oil", "lubricant", "wd", "wd-40", "wd40"],
  ["실리콘", "silicone", "silicon"],
  ["멀티탭", "power strip", "파워스트립", "콘센트", "멀티"],
  ["자석", "마그넷", "magnet", "magnetic", "자석홀더"],
  ["찍찍이", "벨크로", "velcro", "매직테이프", "케이블타이", "cable tie", "타이"],
  ["레고", "블록", "lego", "block", "wooden cube", "큐브", "jenga", "젠가", "장난감", "toy", "plush", "인형", "doll"],
  ["실험", "lab", "laboratory", "튜브", "tube", "피펫", "pipette", "시린지", "syringe", "주사기", "funnel", "깔때기"],
  // ── 기존 그룹 유지 ──
  ["프레임", "frame", "틀"],
  ["로봇", "robot"],
  ["렌즈", "lens", "클리너", "cleaner"],
  ["플러그", "plug", "랜", "lan"],
  ["팬", "선풍기", "fan", "열풍기", "히터", "grill", "그릴", "toaster", "토스터", "sealing machine", "실링"],
  ["안마기", "마사지", "massager"],
  ["무선", "wireless"],
];

// 초성 추출 (한글 검색 보조)
const CHO = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
function toChoseong(str: string): string {
  let out = "";
  for (const ch of str) {
    const code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) {
      out += CHO[Math.floor((code - 0xac00) / 588)];
    } else {
      out += ch;
    }
  }
  return out;
}

// 정규화: 소문자, 공백/하이픈/괄호 제거
function norm(s: string): string {
  return String(s || "").toLowerCase().replace(/[\s\-_()[\].,/]+/g, "");
}

// 검색어를 확장: 동의어 그룹에 걸리면 관련 단어들을 함께 반환
function expandQuery(q: string): string[] {
  const nq = norm(q);
  const expansions = new Set<string>([nq]);
  for (const group of SYNONYM_GROUPS) {
    const normed = group.map(norm).filter(Boolean);
    // 매칭 규칙: 짧은 단어(<=2자)는 완전일치, 긴 단어는 부분일치.
    // (짧은 단어가 부분일치로 과도하게 퍼지는 것을 방지: 예 "티"가 "멀티"에 걸리는 문제)
    const hit = normed.some((w) => {
      if (w.length <= 2 || nq.length <= 2) return w === nq;
      return w.includes(nq) || nq.includes(w);
    });
    if (hit) normed.forEach((w) => expansions.add(w));
  }
  return Array.from(expansions).filter(Boolean);
}

/**
 * 품목이 검색어와 매칭되는지 판단.
 * @param haystackParts 품목의 검색 대상 문자열들 (이름, 위치, 규격 등)
 * @param query 사용자 검색어
 */
export function smartMatch(haystackParts: (string | null | undefined)[], query: string): boolean {
  const q = String(query || "").trim();
  if (!q) return true;

  const targetsNorm = haystackParts.map((p) => norm(String(p || ""))).filter(Boolean);
  const targetsCho = haystackParts.map((p) => toChoseong(String(p || ""))).filter(Boolean);
  const combined = targetsNorm.join(" ");

  // 1) 동의어 확장 검색 (한글↔영어 포함)
  const terms = expandQuery(q);
  for (const t of terms) {
    if (t && combined.includes(t)) return true;
  }

  // 2) 초성 검색 (검색어가 초성으로만 이뤄진 경우: ㅋㅇㅂ → 키보드)
  const nq = norm(q);
  if (/^[ㄱ-ㅎ]+$/.test(q.replace(/\s/g, ""))) {
    const choQ = q.replace(/\s/g, "");
    if (targetsCho.some((t) => t.replace(/\s/g, "").includes(choQ))) return true;
  }

  // 3) 각 단어별 부분일치 (검색어를 공백으로 쪼개 모두 포함되는지)
  const words = nq.split(/\s+/).filter(Boolean);
  if (words.length > 1 && words.every((w) => combined.includes(w))) return true;

  return false;
}
