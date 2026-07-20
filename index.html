import { InventoryItem, Rack } from "../types";

/**
 * Converts a Google Drive share link (or file ID) into a direct preview image URL
 * that works directly in HTML <img> tags.
 */
export function getGoogleDriveImageUrl(url: string | undefined | null): string {
  if (!url) return "";
  const trimmed = url.trim();
  if (!trimmed) return "";

  // If it's a raw Drive file ID (usually ~33 characters long)
  if (/^[a-zA-Z0-9_-]{25,100}$/.test(trimmed)) {
    return `https://drive.google.com/thumbnail?sz=w600&id=${trimmed}`;
  }

  // If it is a Drive or Docs URL, let's extract the ID
  if (trimmed.includes("drive.google.com") || trimmed.includes("docs.google.com")) {
    // 1. Check for /d/ID
    const dMatch = trimmed.match(/\/d\/([a-zA-Z0-9_-]{25,100})/);
    if (dMatch && dMatch[1]) {
      return `https://drive.google.com/thumbnail?sz=w600&id=${dMatch[1]}`;
    }
    // 2. Check for id=ID query param
    const idMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]{25,100})/);
    if (idMatch && idMatch[1]) {
      return `https://drive.google.com/thumbnail?sz=w600&id=${idMatch[1]}`;
    }
    // 3. Fallback: search for any 25-100 character ID in the URL path
    const parts = trimmed.split(/[\/?&]/);
    for (const part of parts) {
      if (/^[a-zA-Z0-9_-]{25,100}$/.test(part) && !part.includes("google") && part !== "open" && part !== "view") {
        return `https://drive.google.com/thumbnail?sz=w600&id=${part}`;
      }
    }
  }

  // If it's already a direct non-Drive image URL, return it
  if (trimmed.startsWith("http")) {
    return trimmed;
  }

  return trimmed;
}

/**
 * Parses location code (e.g. "A-01" -> { rack: "A", shelf: "01" })
 */
export function parseLocation(loc: string | undefined | null) {
  const trimmed = (loc || "").trim().toUpperCase();
  const parts = trimmed.split("-");
  if (parts.length < 2) return { rack: trimmed, shelf: null };
  return { rack: parts[0], shelf: parts.slice(1).join("-") };
}

/**
 * Snaps a coordinate value to grid size
 */
export const GRID_SIZE = 20;
export function snap(v: number): number {
  return Math.round(v / GRID_SIZE) * GRID_SIZE;
}

/**
 * Calculates current time in local format YYYY-MM-DD HH:MM:SS
 */
export function formatTimestampLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const PALETTE = ["#9CAF97", "#8FA3B8", "#D4A98C", "#AFA3C4", "#C9A0A0", "#C4B89C", "#7FB0AC", "#B8A88F"];

export function colorForIndex(idx: number): string {
  return PALETTE[idx % PALETTE.length];
}

export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Automatically layout racks based on the locations in the inventory
 */
export function autoLayoutRacks(inventory: InventoryItem[], existingRacks: Rack[]): Rack[] {
  const rackShelves: { [key: string]: Set<string> } = {};
  inventory.forEach((item) => {
    const { rack } = parseLocation(item.location);
    if (!rack) return;
    if (!rackShelves[rack]) rackShelves[rack] = new Set<string>();
    rackShelves[rack].add(item.location.trim());
  });

  const rackIds = Object.keys(rackShelves).sort();
  const existingMap: { [key: string]: Rack } = {};
  (existingRacks || []).forEach((r) => (existingMap[r.id] = r));

  const racks: Rack[] = [];
  const cols = Math.ceil(Math.sqrt(rackIds.length)) || 1;
  rackIds.forEach((rackId, i) => {
    const shelves = Array.from(rackShelves[rackId]).sort();
    if (existingMap[rackId]) {
      racks.push({ ...existingMap[rackId], shelves });
      return;
    }
    const col = i % cols;
    const row = Math.floor(i / cols);
    racks.push({
      id: rackId,
      name: `${rackId} 랙`,
      x: col * 260 + 60,
      y: row * 260 + 60,
      width: 200,
      height: 200,
      rotation: 0,
      color: colorForIndex(i),
      shelves,
    });
  });
  return racks;
}

export function getApproximateSubstringDistance(text: string, query: string): number {
  const m = query.length;
  const n = text.length;
  if (m === 0) return 0;
  if (n === 0) return m;

  let dp = Array(m + 1).fill(0);
  for (let i = 0; i <= m; i++) {
    dp[i] = i;
  }

  for (let j = 1; j <= n; j++) {
    const nextDp = Array(m + 1).fill(0);
    nextDp[0] = 0; 
    for (let i = 1; i <= m; i++) {
      const cost = query[i - 1] === text[j - 1] ? 0 : 1;
      nextDp[i] = Math.min(
        dp[i] + 1,          // deletion from text
        nextDp[i - 1] + 1,   // insertion into text
        dp[i - 1] + cost    // substitution
      );
    }
    dp = nextDp;
  }

  return dp[m];
}

const TRANSLATION_DICTIONARY: { [key: string]: string[] } = {
  // English key to Korean translations
  "gripper": ["그리퍼"],
  "box": ["박스", "상자"],
  "sensor": ["센서"],
  "jig": ["지그"],
  "cylinder": ["실린더"],
  "cable": ["케이블", "선"],
  "motor": ["모터"],
  "connector": ["커넥터"],
  "adapter": ["어댑터", "아답터"],
  "living": ["리빙"],
  "livingbox": ["리빙박스"],
  "frame": ["프레임"],
  "valve": ["밸브"],
  "switch": ["스위치"],
  "bracket": ["브라켓", "브래킷"],
  "bolt": ["볼트"],
  "nut": ["너트"],
  "washer": ["와셔"],
  "screw": ["스크류", "스크루"],
  "bearing": ["베어링"],
  "coupling": ["커플링"],
  "plate": ["플레이트", "판"],
  "shaft": ["샤프트", "축"],
  "guide": ["가이드"],
  "filter": ["필터"],
  "fitting": ["피팅"],
  "hose": ["호스"],
  "tube": ["튜브"],
  "wrench": ["렌치"],
  "driver": ["드라이버"],
  "tool": ["공구"],
  "tape": ["테이프"],
  "magnet": ["자석"],
  "spring": ["스프링"],
  "pin": ["핀"],
  "ring": ["링"],
  "clamp": ["클램프"],
  "multitap": ["멀티탭"],
  "powerstrip": ["멀티탭"],
  "led": ["엘이디"],
  "camera": ["카메라"],
  "module": ["모듈"],
  "battery": ["배터리", "밧데리"],
  "charger": ["충전기"],
  "drive": ["드라이브"],
  "inverter": ["인버터"],
  "shield": ["실드"],
  "switching": ["스위칭"],
  "power": ["파워"],
  "supply": ["서플라이"],
  "encoder": ["엔코더"],
  "solenoid": ["솔레노이드"],
  "elbow": ["엘보"],
  "speed": ["스피드"],
  "controller": ["컨트롤러"],
  "regulator": ["레귤레이터"],
  "relay": ["릴레이"],
  "socket": ["소켓"],
  "terminal": ["터미널"],
  "block": ["블록", "블럭"],
  "cabletie": ["케이블타이"],
  "tie": ["타이"],
  "spacer": ["스페이서"],
  "support": ["서포트"],
  "coupler": ["커플러"],
  "joint": ["조인트"],
  "bushing": ["부싱"],
  "gear": ["기어"],
  "pulley": ["풀리"],
  "belt": ["벨트"],
  "chain": ["체인"],
  "wheel": ["휠"],
  "roller": ["롤러"],
  "hinge": ["힌지"],
  "handle": ["핸들"],
  "knob": ["노브"],
  "latch": ["래치"],
  "sensorbracket": ["센서브라켓"],
  "transparent": ["투명"],
  "clear": ["투명"],
  "opaque": ["불투명"],

  // Korean key to English translations
  "그리퍼": ["gripper"],
  "박스": ["box"],
  "상자": ["box"],
  "센서": ["sensor"],
  "지그": ["jig"],
  "실린더": ["cylinder"],
  "케이블": ["cable"],
  "모터": ["motor"],
  "커넥터": ["connector"],
  "어댑터": ["adapter"],
  "아답터": ["adapter"],
  "리빙": ["living"],
  "리빙박스": ["livingbox", "living box"],
  "프레임": ["frame"],
  "밸브": ["valve"],
  "스위치": ["switch"],
  "브라켓": ["bracket"],
  "브래킷": ["bracket"],
  "볼트": ["bolt"],
  "너트": ["nut"],
  "와셔": ["washer"],
  "스크류": ["screw"],
  "스크루": ["screw"],
  "베어링": ["bearing"],
  "커플링": ["coupling"],
  "플레이트": ["plate"],
  "샤프트": ["shaft"],
  "가이드": ["guide"],
  "필터": ["filter"],
  "피팅": ["fitting"],
  "호스": ["hose"],
  "튜브": ["tube"],
  "렌치": ["wrench"],
  "드라이버": ["driver"],
  "공구": ["tool"],
  "테이프": ["tape"],
  "자석": ["magnet"],
  "스프링": ["spring"],
  "핀": ["pin"],
  "링": ["ring"],
  "클램프": ["clamp"],
  "멀티탭": ["multitap", "powerstrip", "power strip"],
  "엘이디": ["led"],
  "카메라": ["camera"],
  "모듈": ["module"],
  "배터리": ["battery"],
  "밧데리": ["battery"],
  "충전기": ["charger"],
  "드라이브": ["drive"],
  "인버터": ["inverter"],
  "실드": ["shield"],
  "스위칭": ["switching"],
  "파워": ["power"],
  "서플라이": ["supply"],
  "엔코더": ["encoder"],
  "솔레노이드": ["solenoid"],
  "엘보": ["elbow"],
  "스피드": ["speed"],
  "컨트롤러": ["controller"],
  "레귤레이터": ["regulator"],
  "릴레이": ["relay"],
  "소켓": ["socket"],
  "터미널": ["terminal"],
  "블록": ["block"],
  "블럭": ["block"],
  "케이블타이": ["cabletie", "cable tie"],
  "타이": ["tie"],
  "스페이서": ["spacer"],
  "서포트": ["support"],
  "커플러": ["coupler"],
  "조인트": ["joint"],
  "부싱": ["bushing"],
  "기어": ["gear"],
  "풀리": ["pulley"],
  "벨트": ["belt"],
  "체인": ["chain"],
  "휠": ["wheel"],
  "롤러": ["roller"],
  "힌지": ["hinge"],
  "핸들": ["handle"],
  "노브": ["knob"],
  "래치": ["latch"],
  "센서브라켓": ["sensorbracket", "sensor bracket"],
  "투명": ["transparent", "clear"],
  "불투명": ["opaque"]
};

function getTermVariants(term: string): string[] {
  const clean = term.replace(/\s+/g, "").toLowerCase();
  const variants = [clean];

  // 1. Direct dictionary lookup
  if (TRANSLATION_DICTIONARY[clean]) {
    for (const v of TRANSLATION_DICTIONARY[clean]) {
      const cv = v.replace(/\s+/g, "").toLowerCase();
      if (!variants.includes(cv)) {
        variants.push(cv);
      }
    }
  }

  // 2. Substring substitution for suffixes/postpositions (e.g., "그리퍼용" contains "그리퍼")
  for (const key of Object.keys(TRANSLATION_DICTIONARY)) {
    if (key.length >= 2 && clean.includes(key)) {
      for (const translation of TRANSLATION_DICTIONARY[key]) {
        const substituted = clean.replace(key, translation.replace(/\s+/g, "").toLowerCase());
        if (!variants.includes(substituted)) {
          variants.push(substituted);
        }
      }
    }
  }

  return variants;
}

export function isFuzzyMatch(text: string, query: string): boolean {
  if (!query) return true;
  if (!text) return false;

  const cleanText = text.replace(/\s+/g, "").toLowerCase();
  const cleanQuery = query.replace(/\s+/g, "").toLowerCase();

  // 1. Check exact full substring match first
  if (cleanText.includes(cleanQuery)) {
    return true;
  }

  // 2. Split query into terms to support out-of-order matching or translation
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length > 0) {
    // Every term must be matched in some form
    return terms.every(term => {
      const cleanTerm = term.replace(/\s+/g, "");
      if (!cleanTerm) return true;

      // Get translation variants for this term
      const variants = getTermVariants(cleanTerm);

      // Check if any variant is a substring of the text
      const hasSubmatch = variants.some(v => cleanText.includes(v));
      if (hasSubmatch) return true;

      // Only perform approximate string distance / fuzzy matching for longer words (length >= 4)
      // This protects short, precise queries (like "m3", "box", "jig", "a3") from matching false positives.
      const tLen = cleanTerm.length;
      if (tLen >= 4) {
        const maxDist = tLen <= 5 ? 1 : 2;
        return variants.some(v => getApproximateSubstringDistance(cleanText, v) <= maxDist);
      }

      return false;
    });
  }

  return false;
}

/**
 * Resizes and compresses an image file to a max width/height and custom JPEG quality.
 * This prevents massive smartphone photos (5MB+) from triggering gateway timeouts or payload limit errors
 * on the Google Apps Script endpoint.
 */
export function resizeAndCompressImage(file: File, maxWidth = 1200, maxHeight = 1200, quality = 0.75): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        // Calculate new dimensions while maintaining aspect ratio
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxHeight) {
          if (width > height) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas context is not available"));
          return;
        }

        // Draw image onto canvas
        ctx.drawImage(img, 0, 0, width, height);

        // Export as JPEG with custom quality
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve(dataUrl);
      };
      img.onerror = (err) => reject(err);
      img.src = e.target?.result as string;
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

