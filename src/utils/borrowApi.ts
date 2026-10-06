// 대여 시스템(구 BorrowForm) API 헬퍼 및 공용 타입/유틸
// 서버의 `/api/gas` 액션 디스패처(server/routes/gas.js)로 대여 액션들을 호출합니다.

import { hasVersionWorkInProgress } from "./versionWorkGuard";
import { compareToolLocation } from "./toolLocation";
import { adminHeaders } from "./adminAuth";
import { buildReborrowEntries } from "./reborrowPlan";
import { createRequestCache } from "./requestCache";

// 물품 하나 안에서 구분되는 "종류"(예: 같은 의자의 색상/모델 차이).
// 목록이 비어 있으면 종류 구분을 쓰지 않는 물품 — 지금까지와 동일하게 총재고만으로 동작한다.
export interface ItemVariant {
  id: number;
  name: string;
  stock: number;
  rented: number;
  image?: string; // 종류별 사진 — 신청자가 눈으로 보고 고를 수 있게
  /** 종류별 실측 치수(mm). 종류마다 크기가 다른 물품(대·중·소 같은)에만 넣는다.
   *  비어 있으면 물품 자체의 치수를 쓴다 — 종류를 나눠도 크기는 같은 경우가 대부분이다. */
  widthMm?: number;
  depthMm?: number;
  heightMm?: number;
  shape?: "box" | "cylinder" | "pyramid";
}

export interface ObjectItem {
  id: string;
  name: string;
  sector: string;
  rootSlot: string;
  category: string;
  subcategory: string;
  image: string;
  stock: number;
  rented: number;
  excludeFromRanking?: boolean; // "가장 적게 대여된 물품" 랭킹에서 제외
  /** 실측 치수(mm). 선택 입력이라 셋 다 있을 때만 "실제 크기 보기"가 뜬다. */
  widthMm?: number;
  depthMm?: number;
  heightMm?: number;
  /** 그 치수를 어떤 형태로 그릴지. 안 고르면 육면체. */
  shape?: "box" | "cylinder" | "pyramid";
  fragile?: boolean;   // 깨질 위험 (M열)
  fireRisk?: boolean;  // 화재 위험 (N열)
  requestFor?: string; // 특정 업체 request용 물품 — 업체명 (O열, 빈 값이면 해당 없음)
  personalOwner?: string; // 개인 물품 — 소유자명 (P열, 빈 값이면 개인 물품 아님)
  archived?: boolean; // 보관 처리 — 파손/오브젝트로 사용 불가 등으로 목록·대여 카탈로그에서 치워둠 (Q열)
  variants?: ItemVariant[];   // 종류별 재고 (있으면 stock/rented는 이 값 + 미확인의 합계)
  unassignedStock?: number;   // 아직 어느 종류인지 모르는 선반 재고
  unassignedRented?: number;  // 종류 도입 전에 나가서 아직 안 돌아온 수량
}

export interface ScenarioItem {
  id: string;
  name: string;
  quantity: number;
  rootSlot?: string;
  category?: string;
  subcategory?: string;
  image?: string;
  stock?: number;
  rented?: number;
  variants?: ItemVariant[];  // 이 물품이 가진 종류 목록 (신청 화면의 선택지)
  variantId?: number;        // 신청자가 고른 종류 — 종류가 나뉜 물품은 필수
  variantName?: string;      // 표시용 이름 (서버는 variantId만 신뢰한다)
}

export interface ScenarioDefinition {
  sid: string;
  found: boolean;
  syncNeeded: boolean;
  blocked: boolean;
  blockReason: string;
  highLevelEn: string;
  highLevelKo: string;
  items: ScenarioItem[];
  errorMessage?: string; // 진단용: 서버 처리 중 문제가 있었다면 이유가 담긴다.
  rowsScanned?: number;  // 진단용: scenarios 테이블에서 실제로 읽은 행 수
  fetchError?: string;   // 프론트 전용: 네트워크/파싱 등 요청 자체가 실패했을 때의 이유
}

export interface UnreturnedItem {
  sheetType: "scenario" | "general";
  rowIndex: number;
  borrowerName: string;
  scenarioId?: string;
  itemLabel: string;
  itemKind?: string;
  itemId?: string; // 물품 카탈로그(Sheet3) ID — 관리자 화면에서 오브젝트별 대여자 조회에 사용
  location: string;
  quantity: number;
  borrowDate: string;
  borrowPurpose: string;
  email: string;
  borrowDateTime?: string; // 시간까지 포함한 대여 시각 (묶음 정렬용)
  shift?: "day" | "night"; // 대여 시각 기준 주간/야간
  batchId: string;
  /** 한 번의 대여 신청 전체에 공통으로 붙는 사람이 읽기 쉬운 연속 번호. */
  requestNo?: number;
  /** 구버전 서버 응답 호환용. 화면에는 표시하지 않는다. */
  requestCode?: string;
  floor?: string; // 대여 시 입력한 층수 (대여위치기록에서 배치ID로 조회)
  unit?: string;  // 대여 시 입력한 유닛
  generalOption?: string;
  image: string;
  stock: number;
  rented: number;
  pickedUp?: string; // 대여 실물 확인(체크) 완료 시각 — 없으면 아직 미확인 (SID=M열, 일반=N열)
  requestFor?: string;     // 특정 업체 request용 물품 — 업체명 (빈 문자열이면 업체명 없이 request)
  personalOwner?: string;  // 개인 물품 — 소유자명
  fragile?: boolean;       // 깨질 위험
  fireRisk?: boolean;      // 화재 위험
  variants?: ItemVariant[];  // 이 물품이 가진 종류 목록 (대여 확인 때 고를 후보)
  variantId?: number | null; // 확정된 종류
  variantName?: string;      // 확정된 종류 이름 (표시용)
  variantPending?: boolean;  // "종류 상관없음"으로 신청되어 아직 안 정해진 줄 — 재고가 아직 안 빠졌다
  variantUnassigned?: boolean; // 종류가 생기기 전에 나간 대여 건 — 반납할 때 어느 종류가 돌아오는지 골라야 한다
  /** 대여/반납 처리 화면에서 건별로 지정 — 켜져 있으면 이 대여 줄은 종류 수 한도 계산에서 빠진다. */
  typeLimitExempt?: boolean;
  /** 한도 제외를 지정한 이유. 제외 항목과 함께 관리자 화면에 표시한다. */
  typeLimitExemptReason?: string;
  /** 내 대여 조회에서만 제공되는 읽기 전용 카탈로그 정보. 보관 위치·구매 정보는 포함하지 않는다. */
  details?: {
    size: string;
    property: string;
    category: string;
    subcategory: string;
    widthMm?: number | null;
    depthMm?: number | null;
    heightMm?: number | null;
    shape?: "box" | "cylinder" | "pyramid";
    stock: number;
    variantName?: string;
  } | null;
}

export interface BorrowEntry {
  itemType: "scenario" | "general";
  borrowerName: string;
  affiliation: string;
  employeeId: string;
  knownEmail?: string; // 재대여 등 이미 확인된 이메일이 있을 때 (affiliation/employeeId 재추정 불필요)
  borrowDate: string;
  borrowPurpose: string;
  scenarioId?: string;
  requiredObjects?: ScenarioItem[];
  additionalItems?: ScenarioItem[];
  syncNeeded?: boolean;
  borrowedItems?: { id: string; name: string; quantity: number; variantId?: number }[];
  generalOption?: string;
  floor?: string; // 층수 (예: "B2") — 좌석 위치 기록용
  unit?: string;  // 유닛 (예: "Unit 1") — 좌석 위치 기록용
  // 관리자가 반납 처리 화면에서 "추가 대여"로 직접 처리하는 경우: 실물을 관리자가 바로
  // 건네주므로 별도의 "대여 확인" 단계 없이 이 요청만으로 바로 확인 완료 처리한다.
  autoConfirmPickup?: boolean;
}

export interface ReturnRequest {
  sheetType: "scenario" | "general";
  rowIndex: number;
  quantity: number;
  // 종류가 생기기 전에 나간 대여 건을 반납할 때만 필요하다 — 담당자가 고른 종류의
  // 재고로 되돌린다. 종류를 안 쓰는 물품이나 이미 종류가 정해진 건에는 필요 없다.
  variantId?: number;
  /** 파손 반납 줄. 선반으로 돌아가지 않으므로 종류를 묻지 않고 재고도 되돌리지 않는다. */
  damaged?: boolean;
  /** 누가 어떤 성격으로 반납했는지. QR 위치 확인의 "미확인 반납"은 admin/self/unattended만 보여준다.
   *  서버는 파손 줄과 대여 확인 전 줄은 이 값과 상관없이 damage/cancel로 기록한다. */
  source?: "admin" | "self" | "transfer";
}

export interface BorrowResult {
  success: boolean;
  message: string;
  /** 대여 신청이 실제로 저장된 뒤 위치 확인 QR에 사용할 서버 경로와 확인된 사번. */
  lookupPath?: string;
  employeeId?: string;
  /** 미수령 자동 취소까지의 시간. 신청 완료 QR 안내에 사용한다. */
  pickupTimeoutMinutes?: number;
  /** 재고가 없어 이번 대여에서 빠진 물품들. `skipOutOfStock`으로 신청했을 때만 온다. */
  skipped?: { id: string; name: string; requested: number; available: number }[];
}

/* ---------------- 위치 정렬 (창고를 실제로 걸어 도는 순서) ----------------
   1) 186 → 251 오름차순
   2) 185 → 120 과 119 → 60 : 마주 보는 선반이라 한 줄(6칸)씩 번갈아
      (185~180 → 119~114 → 179~174 → 113~108 → ...)
   3) 0 → 59 오름차순
   4) 100000번대, 그 외는 뒤에 번호순으로

   ※ server/lib/locationSort.js의 locationSortIndex와 반드시 같은 순서를 내야 한다. */
const ROW_SLOTS = 6;                        // 선반 한 줄에 들어가는 슬롯 수
const FACING_A = { start: 120, end: 185 };  // 185 → 120 방향
const FACING_B = { start: 60, end: 119 };   // 119 → 60 방향

export function computeLocationSortIndex(rootSlot: string | null | undefined): number {
  const n = parseInt(String(rootSlot ?? "").replace(/\D/g, ""), 10);
  if (isNaN(n)) return Number.MAX_SAFE_INTEGER;

  if (n >= 186 && n <= 251) return n;

  // 한 사이클 = A쪽 6칸 + B쪽 6칸 = 12칸. 같은 줄이면 A가 먼저, B가 그다음.
  if (n >= FACING_A.start && n <= FACING_A.end) {
    const d = FACING_A.end - n;
    return 1000 + Math.floor(d / ROW_SLOTS) * (ROW_SLOTS * 2) + (d % ROW_SLOTS);
  }
  if (n >= FACING_B.start && n <= FACING_B.end) {
    const d = FACING_B.end - n;
    return 1000 + Math.floor(d / ROW_SLOTS) * (ROW_SLOTS * 2) + ROW_SLOTS + (d % ROW_SLOTS);
  }

  if (n >= 0 && n <= 59) return 3000 + n; // 0 → 59 오름차순
  if (n >= 100000 && n <= 100025) return 4000 + (n - 100000);
  return 5000 + n;
}

export function padSlot(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim().replace(/\D/g, "");
  if (!s) return String(raw ?? "").trim();
  return s.length < 6 ? s.padStart(6, "0") : s;
}

export function isKoreanName(v: string): boolean {
  return /^[\uAC00-\uD7A3\u3131-\u318E\s]+$/.test(v);
}

export function nowString(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/* ---------------- API 호출 (WMS callScript와 동일한 CORS 회피 패턴) ---------------- */
// 연동 URL과 쿼리스트링을 안전하게 합친다.
// scriptUrl에 이미 '?'(예: ...exec?usp=sharing)나 fragment('#'), 공백이 들어와도
// action 파라미터가 묻히지 않도록 정규화한다. (특히 모바일에서 URL이 잘못 저장된 경우 방어)
function normalizeScriptUrl(raw: string): string {
  let u = String(raw || "").trim();
  const hashIdx = u.indexOf("#");
  if (hashIdx !== -1) u = u.slice(0, hashIdx); // fragment 제거
  return u.trim();
}

// GAS로 나가는 요청 전체(이 파일의 apiGet/apiPost뿐 아니라 App.tsx의 fetchAll/callScript도
// 포함)를 대상으로 "동시에 최대 N개까지만" 허용하는 전역 큐.
//
// 왜 필요한가: 화면 하나를 열 때 여러 컴포넌트(App.tsx의 폴링, ScenarioAdminPage의 물품/미반납
// 조회 등)가 각자 독립적으로 GAS를 부른다. 각 조회 자체는 내부적으로 순차 처리되더라도,
// 서로 다른 조회끼리는 동시에 실행돼 실제로는 한 탭에서만도 여러 요청이 겹쳐 나간다.
// 여기에 사용자가 여러 명이면 GAS의 동시 실행 한도(계정 종류에 따라 보통 20~30개)에
// 걸리기 쉬운데, 이때 실패는 크기와 무관하게 "그 순간 자리를 못 잡은" 요청 전부에서
// 무작위로 발생한다 — 작은 조회(sectors, users 등)까지 같이 실패했던 게 바로 이 증상이다.
let gasActiveCount_ = 0;
const gasQueue_: (() => void)[] = [];
const gasPriorityQueue_: (() => void)[] = [];
// 2 -> 3: 좌석맵/버전 확인처럼 가볍고 빠른 요청이, 물품 카탈로그·창고재고 같은
// 무거운 요청 두 개에 슬롯을 전부 뺏겨 큐에서 오래 대기하는 일을 줄이기 위해 여유를 뒀다.
// (근본 해결은 호출 순서 조정이고, 이건 보조적인 여유분이다)
const GAS_MAX_CONCURRENT_ = 3;

export function withGasConcurrencyLimit<T>(fn: () => Promise<T>, priority = false): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      gasActiveCount_++;
      fn()
        .then(resolve, reject)
        .finally(() => {
          gasActiveCount_--;
          // 대여·반납 같은 쓰기 요청은 화면용 백그라운드 조회보다 먼저 보낸다.
          const next = gasPriorityQueue_.shift() || gasQueue_.shift();
          if (next) next();
        });
    };
    if (gasActiveCount_ < GAS_MAX_CONCURRENT_) run();
    else (priority ? gasPriorityQueue_ : gasQueue_).push(run);
  });
}

function buildUrl(scriptUrl: string, qs: string): string {
  const base = normalizeScriptUrl(scriptUrl);
  // 매 요청마다 값이 달라지는 파라미터를 붙여 브라우저가 예전 응답을 캐시에서 재사용하지 못하게 한다.
  const bust = `_ts=${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const merged = qs ? `${qs}&${bust}` : bust;
  return base + (base.indexOf("?") !== -1 ? "&" : "?") + merged;
}

// 타임아웃 기준값 — 실측(사내망 직통) 기준으로 잡았다.
// 일반 조회 0.03초, 목록 전체 조회(약 190KB) 0.05초, 전체 로그(약 6MB) 0.25초.
// 예전엔 30~60초로 잡혀 있어서, 장애가 나면 오류가 뜨기까지 1~2분씩 화면이 멈춰 있었다.
// 느린 모바일 회선까지 감안해도 아래 값이면 충분한 여유가 있다(190KB @ 256kbps ≈ 6초).
const TIMEOUT_DEFAULT_MS = 10000; // 단건 조회
const TIMEOUT_LIST_MS = 20000;    // 목록 전체 조회 (수백 KB)
const TIMEOUT_BULK_MS = 45000;    // 전체 로그 (수 MB) — 느린 회선에서 실제로 오래 걸릴 수 있다

// GET 요청은 전부 읽기 전용이므로 타임아웃 시 자동 재시도가 안전하다.
// 대용량 조회(getScenarioAllLogs 등)는 오래 걸릴 수 있어 액션별로 타임아웃/재시도 횟수를 조절할 수 있게 한다.
interface ApiGetOptions {
  timeoutMs?: number; // 1회 시도당 제한 시간 (기본 TIMEOUT_DEFAULT_MS)
  retries?: number;   // 타임아웃 시 추가 재시도 횟수 (기본 1회)
}

async function apiGetImpl_(scriptUrl: string, action: string, params: Record<string, string> = {}, opts: ApiGetOptions = {}) {
  if (!scriptUrl) throw new Error("서버 연동 URL이 입력되지 않았습니다.");
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_DEFAULT_MS;
  const retries = opts.retries ?? 1;
  const qs = new URLSearchParams({ action, ...params }).toString();

  for (let attempt = 0; attempt <= retries; attempt++) {
    const url = buildUrl(scriptUrl, qs);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs); // 무한로딩 방지
    let res: Response | null = null;
    try {
      res = await fetch(url, { signal: controller.signal, cache: "no-store", headers: adminHeaders() });
    } catch (e: any) {
      clearTimeout(timer);
      if (e?.name === "AbortError") {
        if (attempt < retries) continue; // 타임아웃 → 조용히 재시도
        throw new Error(`서버 응답이 지연되어 요청을 취소했습니다. (액션: ${action}, ${attempt + 1}회 시도, 네트워크 상태를 확인하고 다시 시도해주세요.)`);
      }
      throw new Error(`[네트워크 오류] ${e?.message || "서버와 연결할 수 없습니다."} (요청 URL: ${url.substring(0, 80)}...)`);
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      // 일시적인 서버 오류일 수 있으므로 짧게 쉬었다가 재시도한다.
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 400 + attempt * 400));
        continue;
      }
      const cleanSnippet = text.trim().replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").substring(0, 150);
      throw new Error(`서버가 올바르지 않은 응답을 반환했습니다. 다시 시도해주세요. [서버 응답 요약: ${cleanSnippet}...] (요청 액션: ${action})`);
    }
    if (!data.success) throw new Error(data.error || `요청 실패 (액션: ${action})`);
    return data;
  }
  // 이론상 도달하지 않지만(루프 내에서 항상 return/throw), 타입 체커를 위해 남겨둔다.
  throw new Error(`요청에 실패했습니다. (액션: ${action})`);
}

// POST는 사진 업로드(base64)까지 실어 보낼 수 있어 GET보다 넉넉하게 잡되, 예전처럼 무한정
// 매달리지는 않게 한다 — 타임아웃이 아예 없어서 네트워크가 끊기면 화면이 몇 분씩 멈춰 있었다.
const POST_TIMEOUT_MS = 45000;

async function apiPostImpl_(scriptUrl: string, action: string, payload: any, timeoutMs = POST_TIMEOUT_MS): Promise<any> {
  // 로컬 UI로 원격 데이터를 읽는 검증 모드다. 대여·반납·재고 변경 등 어떤 POST도
  // 원격 API까지 보내지 않는다. Vite 개발 서버도 같은 요청을 403으로 한 번 더 막는다.
  if (import.meta.env.MODE === "remote-readonly") {
    throw new Error("원격 읽기 전용 테스트 모드입니다. 조회·SID 선택·장바구니만 확인할 수 있으며 변경 요청은 전송되지 않습니다.");
  }
  if (!scriptUrl) throw new Error("서버 연동 URL이 입력되지 않았습니다.");
  const cleanUrl = normalizeScriptUrl(scriptUrl);
  let res: Response | undefined;
  // fetch()가 응답을 받기도 전에 실패하는 건(ERR_CONNECTION_CLOSED 등) 요청이 서버에 아예
  // 도달하지 못했다는 뜻이라 — 한 번은 짧게 재시도해도 이중 처리될 위험이 없다. (응답을 받은
  // 뒤의 문제는 서버가 실제로 처리를 시작했을 수 있으므로 여기서는 재시도하지 않는다.)
  const NETWORK_RETRIES = 1;
  for (let attempt = 0; attempt <= NETWORK_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      res = await fetch(cleanUrl, {
        method: "POST",
        headers: adminHeaders({ "Content-Type": "text/plain;charset=utf-8" }),
        body: JSON.stringify({ action, payload }),
        signal: controller.signal,
      });
      break;
    } catch (e: any) {
      // 타임아웃으로 우리가 끊은 경우는 재시도하지 않는다 — 대여/반납처럼 되돌릴 수 없는
      // 처리라, 서버가 이미 끝냈는데 한 번 더 보내면 이중 처리가 된다.
      if (e?.name === "AbortError") {
        throw new Error(`서버 응답이 ${Math.round(timeoutMs / 1000)}초 안에 오지 않았습니다. 처리가 이미 완료됐을 수도 있으니, 목록을 새로고침해 확인한 뒤 다시 시도해주세요. (액션: ${action})`);
      }
      if (attempt < NETWORK_RETRIES) {
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }
      throw new Error(`[네트워크 오류] POST 요청 실패: ${e?.message || "서버와 연결 불가"}`);
    } finally {
      clearTimeout(timer);
    }
  }
  const text = await res!.text();
  try {
    return JSON.parse(text);
  } catch {
    const cleanSnippet = text.trim().replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").substring(0, 150);
    throw new Error(`서버가 올바르지 않은 POST 응답을 반환했습니다. [서버 응답 요약: ${cleanSnippet}...] (요청 액션: ${action})`);
  }
}

// 실제 호출부는 이 두 함수를 쓴다 — 내부 구현(...Impl_)을 동시 실행 제한 큐로 감싸서,
// 이 파일을 통해 나가는 모든 GET/POST가 자동으로 "한 탭에서 최대 2개 동시"로 제한된다.
function apiGet(scriptUrl: string, action: string, params: Record<string, string> = {}, opts: ApiGetOptions = {}) {
  return withGasConcurrencyLimit(() => apiGetImpl_(scriptUrl, action, params, opts));
}
function apiPost(scriptUrl: string, action: string, payload: any, timeoutMs?: number): Promise<any> {
  // 변경 이력의 "누가"는 서버가 로그인 세션에서 채운다.
  return withGasConcurrencyLimit(() => apiPostImpl_(scriptUrl, action, payload, timeoutMs), true);
}

export async function fetchBorrowAppVersion(scriptUrl: string): Promise<string> {
  const data = await apiGet(scriptUrl, "getBorrowAppInfo");
  return String(data.version || "");
}

export async function fetchObjectItems(
  scriptUrl: string,
  opts: { timeoutMs?: number; retries?: number } = {}
): Promise<ObjectItem[]> {
  const data = await apiGet(scriptUrl, "getObjectItems", {}, {
    timeoutMs: opts.timeoutMs ?? TIMEOUT_LIST_MS,
    retries: opts.retries ?? 1,
  });
  return (data.items || []) as ObjectItem[];
}

export async function fetchScenarioDefinition(scriptUrl: string, sid: string): Promise<ScenarioDefinition> {
  const data = await apiGet(scriptUrl, "getScenarioDefinition", { scenarioId: sid });
  return (data.scenario || { sid, found: false, syncNeeded: true, blocked: false, blockReason: "", highLevelEn: "", highLevelKo: "", items: [] }) as ScenarioDefinition;
}

// 위와 같은 이유로 나눠 받되, 끝까지 이어 붙여 전체 목록을 돌려준다.
export async function fetchUnreturnedItems(scriptUrl: string, forceRefresh?: boolean): Promise<UnreturnedItem[]> {
  try {
    const params: Record<string, string> = {};
    if (forceRefresh) params.forceRefresh = "1";
    const data = await apiGet(scriptUrl, "getUnreturnedItems", params, { timeoutMs: TIMEOUT_LIST_MS, retries: 1 });
    if (data && data.items && !data.hasMore) {
      return data.items as UnreturnedItem[];
    }
    const all: UnreturnedItem[] = (data.items || []) as UnreturnedItem[];
    if (data.hasMore) {
      for (let offset = all.length; ; offset += PAGE_CHUNK) {
        const pageParams: Record<string, string> = { limit: String(PAGE_CHUNK), offset: String(offset) };
        const pageData = await apiGet(scriptUrl, "getUnreturnedItems", pageParams, { timeoutMs: TIMEOUT_LIST_MS, retries: 1 });
        const items = (pageData.items || []) as UnreturnedItem[];
        all.push(...items);
        if (!pageData.hasMore || items.length === 0) break;
        if (offset > 20000) break;
      }
    }
    return all;
  } catch {
    const all: UnreturnedItem[] = [];
    for (let offset = 0; ; offset += PAGE_CHUNK) {
      const params: Record<string, string> = { limit: String(PAGE_CHUNK), offset: String(offset) };
      if (forceRefresh && offset === 0) params.forceRefresh = "1";
      const data = await apiGet(scriptUrl, "getUnreturnedItems", params, { timeoutMs: TIMEOUT_LIST_MS, retries: 1 });
      const items = (data.items || []) as UnreturnedItem[];
      all.push(...items);
      if (!data.hasMore || items.length === 0) break;
      if (offset > 20000) break;
    }
    return all;
  }
}
export interface CurrentItemBorrower {
  borrowerName: string;
  quantity: number;
  pickedUp: boolean;
  variantName: string;
}

export async function fetchItemBorrowers(scriptUrl: string, itemId: string, category: "scenario" | "tablecloth" = "scenario", variantId?: number): Promise<CurrentItemBorrower[]> {
  const params: Record<string, string> = { itemId, category };
  if (variantId !== undefined) params.variantId = String(variantId);
  const data = await apiGet(scriptUrl, "getItemBorrowers", params, { timeoutMs: TIMEOUT_LIST_MS, retries: 1 });
  return (data.borrowers || []) as CurrentItemBorrower[];
}

export async function fetchMyBorrowedItems(scriptUrl: string, name: string, employeeId: string, affiliation?: string): Promise<UnreturnedItem[]> {
  const params: Record<string, string> = { name, employeeId };
  if (affiliation) params.affiliation = affiliation;
  const data = await apiGet(scriptUrl, "getMyBorrowedItems", params);
  return (data.items || []) as UnreturnedItem[];
}

/** registered: 등록됨. ambiguous: 같은 이름의 계정이 여러 개 등록돼 있어(동명이인) 어느 쪽인지 구분할 수 없음 —
 *  이 경우 registered는 항상 false이며, 관리자에게 계정 정리를 요청해야 한다. */
export async function checkConfigDsRegistered(scriptUrl: string, name: string): Promise<{ registered: boolean; ambiguous?: boolean }> {
  const data = await apiGet(scriptUrl, "isConfigDsRegistered", { name });
  return { registered: !!data.registered, ambiguous: !!data.ambiguous };
}

/**
 * `skipOutOfStock`을 켜면 재고가 모자란 물품만 빼고 나머지를 대여한다(SID 대여용).
 * 무엇이 빠졌는지는 서버가 `skipped`로 돌려준다 — 화면이 가진 카탈로그에 없는 물품도
 * 서버는 알고 있으므로, 실제로 빠진 목록은 이 값을 기준으로 보여줘야 한다.
 */
export async function postRecordBorrow(
  scriptUrl: string, borrowList: BorrowEntry[], clientVersion: string, opts?: { skipOutOfStock?: boolean }
): Promise<BorrowResult> {
  return (await apiPost(scriptUrl, "recordBorrow", {
    borrowList, clientVersion,
    ...(opts?.skipOutOfStock ? { skipOutOfStock: true } : {}),
  }, 15000)) as BorrowResult;
}

/**
 * 아직 반납되지 않은 대여 줄들의 자리(층·유닛)를 바꾼다.
 *
 * 대여한 뒤 자리를 옮긴 사람이 있으면 적힌 자리가 틀려 물건을 찾으러 헛걸음하게 된다.
 * 이미 반납된 줄은 서버가 건드리지 않는다(지난 기록이라 고치면 안 된다).
 */
export async function postUpdateBorrowerSeat(
  scriptUrl: string,
  rows: { sheetType: "scenario" | "general"; rowIndex: number }[],
  floor: string,
  unit: string
): Promise<{ success: boolean; updated?: number; message?: string }> {
  return apiPost(scriptUrl, "updateBorrowerSeat", { rows, floor, unit });
}

export async function postProcessReturn(scriptUrl: string, returnRequests: ReturnRequest[], clientVersion: string): Promise<BorrowResult> {
  return (await apiPost(scriptUrl, "processReturn", { returnRequests, clientVersion })) as BorrowResult;
}

export interface DamagedReturnItem {
  itemId: string;
  itemName: string;
  qty: number;          // 파손 수량 (빌려간 수량 중 일부일 수 있다)
  variantId?: number;   // 종류가 나뉜 물품이면 어느 종류가 파손됐는지
  /** 반납 단계에서 재고를 되돌리지 않은 건(종류를 모르는 파손). 여기서도 깎지 않는다. */
  noStock?: boolean;
  /** 파손품을 버리고 대체품을 그대로 들고 가는 건 — 그 수량은 반납하지 않고 대여중으로 남으며,
   *  재고에서는 새로 나간 대체품만큼만 빠진다. */
  keepBorrowed?: boolean;
  /** 교체 건에서 대여가 이어지는 줄 — 대체품 종류로 갱신하기 위해 어느 줄인지 알려준다. */
  rentalSheetType?: "scenario" | "general";
  rentalRowIndex?: number;
}

/** 파손 반납 — 반납 처리로 재고에 되돌아온 물건 중 못 쓰게 된 수량을 다시 깎고 불량 로그를 남긴다.
 *  사진은 묶음당 한 장이며, 등록되는 모든 불량 로그가 그 사진을 공유한다. */
export async function postRecordDamagedReturn(
  scriptUrl: string,
  payload: {
    items: DamagedReturnItem[];
    defectType: string;
    note?: string;
    actionTaken?: string;
    culprit?: string;
    photo?: string;
  }
): Promise<BorrowResult & { created?: number; warnings?: string[] }> {
  return (await apiPost(scriptUrl, "recordDamagedReturn", payload)) as BorrowResult & { created?: number; warnings?: string[] };
}

/** 대여 실물 확인(체크) 처리 — 반납의 postProcessReturn과 대칭. 재고는 안 건드리고 확인 시각만 남긴다. */
// variantId는 "종류 상관없음"으로 신청된 줄에만 필요하다 — 담당자가 실제로 나간 종류를
// 고르면 그때 처음으로 재고가 차감된다.
export async function postConfirmPickup(scriptUrl: string, items: { sheetType: "scenario" | "general"; rowIndex: number; quantity: number; variantId?: number }[]): Promise<BorrowResult> {
  return (await apiPost(scriptUrl, "confirmPickup", { items })) as BorrowResult;
}

export interface ReturnPhotoBatchItem {
  itemLabel: string;
  borrower: string;
  location?: string;
  borrowDate?: string; // 원래 대여 시각 — "누가 언제 빌렸는지" 표시용
  qty: number;
  action: string; // "확인" | "반납" | "소모" 등 사람이 읽을 배지 텍스트
}

/** 반납 처리 묶음 1건당 촬영한 증빙 사진 1장을 저장한다. */
/** 반납 사진 저장이 응답을 기다리는 시간. 전역 45초는 이 화면에서 너무 길다 —
 *  사무실 Wi-Fi 경로에서는 응답이 영영 안 오는 경우가 있어서(라우터가 연결 상태를 잃는다)
 *  일찍 끊고 사람에게 "다시 시도"를 넘기는 편이 낫다. */
const RETURN_PHOTO_TIMEOUT_MS = 20000;

/**
 * 반납 증빙 사진 저장.
 *
 * `clientId`는 "이 사진 한 장을 저장하려는 시도"의 이름표다. 저장은 됐는데 응답만 유실되는
 * 경우가 있어서, 같은 이름표로 다시 보내면 서버가 새로 저장하지 않고 성공만 돌려준다.
 * 그래서 다시 시도해도 사진이 두 장 남지 않는다 — 재시도 버튼을 붙일 수 있는 이유다.
 */
export async function postSaveReturnPhoto(
  scriptUrl: string,
  data: { photo: string; summary?: string; items?: ReturnPhotoBatchItem[]; clientId?: string }
): Promise<{ success: boolean; error?: string; duplicate?: boolean }> {
  return apiPost(scriptUrl, "saveReturnPhoto", data, RETURN_PHOTO_TIMEOUT_MS);
}

export interface ReturnPhotoEntry {
  id: number;
  occurredAt: string;
  summary: string;
  photo: string;
  thumb: string;
  items: ReturnPhotoBatchItem[];
}

/** 저장된 반납 증빙 사진 목록(최신순)을 불러온다. itemSearch를 주면 그 사진에 함께 찍힌
 *  물품 중 이름이 일치하는 게 있는 사진만 걸러서 돌려준다. */
export async function fetchReturnPhotos(scriptUrl: string, opts?: { limit?: number; offset?: number; itemSearch?: string }): Promise<{ items: ReturnPhotoEntry[]; hasMore: boolean }> {
  const params: Record<string, string> = {};
  if (opts?.limit) params.limit = String(opts.limit);
  if (opts?.offset) params.offset = String(opts.offset);
  if (opts?.itemSearch) params.itemSearch = opts.itemSearch;
  const data = await apiGet(scriptUrl, "getReturnPhotos", params);
  return { items: (data.items || []) as ReturnPhotoEntry[], hasMore: !!data.hasMore };
}

export interface ItemPhotoEntry {
  id: number;
  photo: string;
  thumb: string;
}

/** 물품(시나리오 오브젝트/COS 물품) 하나에 대표 사진 외로 등록된 추가 사진 목록을 불러온다. */
export async function fetchItemPhotos(scriptUrl: string, category: "scenario" | "warehouse", itemId: string): Promise<ItemPhotoEntry[]> {
  if (!itemId) return [];
  const data = await apiGet(scriptUrl, "getItemPhotos", { category, itemId });
  return (data.items || []) as ItemPhotoEntry[];
}

/** 카테고리 하나에 등록된 모든 물품의 추가 사진(썸네일 경로)을 물품ID별로 한 번에 불러온다.
 *  목록/그리드 화면에서 물품마다 따로 조회하지 않아도 되게 하는 용도. */
/** COS 물품 관리 화면 상단의 최근 변동(재고 조정·정보 변경·대여/반납/소모). 관리자 전용. */
/** 공구 랙별 구역 수(1~9). { "F-02": 7 } — 없는 랙은 3구역. */
export async function fetchWarehouseRackSections(scriptUrl: string): Promise<Record<string, number>> {
  const data = await apiGet(scriptUrl, "getWarehouseRackSections");
  return (data.sections || {}) as Record<string, number>;
}
export async function postSetWarehouseRackSections(scriptUrl: string, rack: string, sections: number): Promise<{ success: boolean; sections?: Record<string, number>; message?: string }> {
  return apiPost(scriptUrl, "setWarehouseRackSections", { rack, sections });
}

/** 공구 랙별 층 수. { "F": 5 } → F-00 ~ F-04. 없는 랙은 물품이 있는 층만 보인다. */
export async function fetchWarehouseRackLevels(scriptUrl: string): Promise<Record<string, number>> {
  const data = await apiGet(scriptUrl, "getWarehouseRackLevels");
  return (data.levels || {}) as Record<string, number>;
}
export async function postSetWarehouseRackLevels(scriptUrl: string, rack: string, levels: number): Promise<{ success: boolean; levels?: Record<string, number>; message?: string }> {
  return apiPost(scriptUrl, "setWarehouseRackLevels", { rack, levels });
}

export interface WarehouseRackLevelPhoto {
  photo: string;
  updatedAt?: string;
  updatedBy?: string;
}

/** 랙의 각 층에 등록된 현재 적재 상태 사진. 키는 F-00 같은 층 코드다. */
export async function fetchWarehouseRackLevelPhotos(scriptUrl: string): Promise<Record<string, WarehouseRackLevelPhoto>> {
  const data = await apiGet(scriptUrl, "getWarehouseRackLevelPhotos");
  return (data.photos || {}) as Record<string, WarehouseRackLevelPhoto>;
}

/** 해당 층의 현황 사진을 등록하거나 새 사진으로 교체한다. */
export async function postSetWarehouseRackLevelPhoto(scriptUrl: string, level: string, photo: string): Promise<{ success: boolean; entry?: WarehouseRackLevelPhoto; photos?: Record<string, WarehouseRackLevelPhoto>; message?: string }> {
  return apiPost(scriptUrl, "setWarehouseRackLevelPhoto", { level, photo });
}

export interface WarehouseRecentChange {
  key: string;
  at: string;
  kind: "stock" | "created" | "updated" | "deleted" | "borrow" | "return" | "consume" | string;
  itemId: string;
  itemName: string;
  location?: string;
  summary: string;
  diff: number;
  manager: string;
}
export async function fetchWarehouseRecentChanges(scriptUrl: string, hours = 48, limit?: number): Promise<WarehouseRecentChange[]> {
  const data = await apiGet(scriptUrl, "getWarehouseRecentChanges", { hours: String(hours), ...(limit ? { limit: String(limit) } : {}) });
  return (data.items || []) as WarehouseRecentChange[];
}

export async function fetchItemPhotosBulk(scriptUrl: string, category: "scenario" | "warehouse"): Promise<Record<string, string[]>> {
  const data = await apiGet(scriptUrl, "getItemPhotosBulk", { category });
  return (data.items || {}) as Record<string, string[]>;
}

/** 추가 사진 한 장을 등록한다(대표 사진과 별개). */
export async function postAddItemPhoto(scriptUrl: string, category: "scenario" | "warehouse", itemId: string, photo: string): Promise<{ success: boolean; id?: number; photo?: string; error?: string }> {
  return apiPost(scriptUrl, "addItemPhoto", { category, itemId, photo });
}

/** 추가 사진 한 장을 삭제한다. */
export async function postDeleteItemPhoto(scriptUrl: string, id: number): Promise<{ success: boolean }> {
  return apiPost(scriptUrl, "deleteItemPhoto", { id });
}

/* ---------------- 데모 데이터 (미연동 시) ---------------- */
export const DEMO_OBJECT_ITEMS: ObjectItem[] = [
  { id: "000008", name: "fruit", sector: "Seoul-Root", rootSlot: "000060", category: "식음료", subcategory: "간식 및 식사류", image: "", stock: 15, rented: 8 },
  { id: "000019", name: "towel (정사각형 소형 행주)", sector: "Seoul-Root", rootSlot: "000098", category: "청소 및 위생용품", subcategory: "위생 및 타월", image: "", stock: 58, rented: 3 },
  { id: "002900", name: "Water hose", sector: "Seoul-Root", rootSlot: "000184", category: "생활용품", subcategory: "기타", image: "", stock: 10, rented: 0 },
  { id: "002884", name: "Mechanical Pencil", sector: "Seoul-Root", rootSlot: "000246", category: "사무용품", subcategory: "필기구", image: "", stock: 25, rented: 5 },
  { id: "001531", name: "electronic scale", sector: "Seoul-Root", rootSlot: "000028", category: "전자기기", subcategory: "측정기기", image: "", stock: 4, rented: 1 },
];

/* ══════════ 열람 ↔ 대여 공용: 신원 & 장바구니 (localStorage) ══════════ */

/** 다음에 다시 왔을 때 그대로 채워 넣기 위해 남겨두는 값.
 *  소속과 좌석까지 함께 둔다 — 자리는 거의 바뀌지 않는데 매번 다시 고르게 하면 번거롭다.
 *  뒤에 붙은 항목들은 예전에 저장된 값에는 없으므로 전부 선택 항목이다. */
export interface BrowseIdentity {
  name: string;
  employeeId: string;
  affiliation?: "cfgw" | "configds" | "other";
  floor?: string;
  unit?: string;
}
export interface BrowseCartItem {
  id: string;
  name: string;
  quantity: number;
  rootSlot?: string;
  // 종류가 나뉜 물품은 담을 때 고른 종류를 함께 들고 간다. 이게 없으면 대여 화면에서
  // "종류를 골라야 합니다"로 막혀 다시 담아야 한다.
  variantId?: number;
  variantName?: string;
}

const IDENTITY_KEY = "wms_browse_identity";
const CART_PREFIX = "wms_browse_cart:";

export function identityKey(name: string, employeeId: string): string {
  return `${String(name || "").trim()}|${String(employeeId || "").trim()}`;
}

export function saveIdentity(identity: BrowseIdentity): void {
  try { localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity)); } catch {}
}

/**
 * 로그아웃할 때 이 브라우저에 남은 개인 정보를 전부 지운다.
 * 이름·사번·소속·좌석과, 사람별로 저장해둔 장바구니가 대상이다.
 *
 * 공용 PC를 쓰는 곳이라 다음 사람에게 앞사람 이름이 그대로 뜨면 안 된다.
 * 좌석 배치도 같은 공용 자료는 개인 정보가 아니므로 남겨둔다.
 */
export function clearIdentity(): void {
  try {
    localStorage.removeItem(IDENTITY_KEY);
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(CART_PREFIX) || k.startsWith(WH_CART_PREFIX)) localStorage.removeItem(k);
    }
  } catch { /* 저장소를 못 건드려도 세션 자체는 이미 끊긴다 */ }
}

export function loadIdentity(): BrowseIdentity | null {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY);
    return raw ? (JSON.parse(raw) as BrowseIdentity) : null;
  } catch { return null; }
}

export function saveBrowseCart(name: string, employeeId: string, items: BrowseCartItem[]): void {
  try {
    const k = CART_PREFIX + identityKey(name, employeeId);
    if (items.length === 0) localStorage.removeItem(k);
    else localStorage.setItem(k, JSON.stringify(items));
  } catch {}
}

export function loadBrowseCart(name: string, employeeId: string): BrowseCartItem[] {
  try {
    const raw = localStorage.getItem(CART_PREFIX + identityKey(name, employeeId));
    return raw ? (JSON.parse(raw) as BrowseCartItem[]) : [];
  } catch { return []; }
}

export function clearBrowseCart(name: string, employeeId: string): void {
  try { localStorage.removeItem(CART_PREFIX + identityKey(name, employeeId)); } catch {}
}

/* ══════════ COS 물품 타입 & 헬퍼 ══════════ */

export interface WarehouseItem {
  rowIndex: number;
  location: string;   // 예: "A-01", "F-02"
  name: string;
  photo: string;
  stock: number | string | null;
  spec: string;
  note: string;
  manager: string;
  keywords?: string; // 한글 검색어 (검색 보조)
  isConsumable?: boolean; // 소모성 물품 여부 — 대여/소모 중 무엇을 누르든 항상 소모로 처리
  archived?: boolean; // 보관 처리 — 목록·대여 카탈로그에서 치워둠 (시나리오 물품의 보관함과 동일 개념)
}

// 위치 문자열 "A-01" → { rack: "A", slot: "01" }
export function parseRackSlot(loc: string | null | undefined): { rack: string; slot: string } {
  const t = String(loc ?? "").trim().toUpperCase();
  const parts = t.split("-");
  if (parts.length < 2) return { rack: t, slot: "" };
  return { rack: parts[0], slot: parts.slice(1).join("-") };
}

// 예전 사용자 공구 대여 장바구니의 저장 키. 대여 화면은 없앴지만, 브라우저에 남은 값을
// 로그아웃 때 지우려고 접두어만 남긴다(clearIdentity).
const WH_CART_PREFIX = "wms_wh_cart:";

// 창고 재고 조회 (인벤토리만 읽는 경량 액션 — getAll 대비 훨씬 빠름)
export async function fetchWarehouseInventory(scriptUrl: string): Promise<WarehouseItem[]> {
  try {
    const data = await apiGet(scriptUrl, "getWarehouseInventoryOnly", {}, { timeoutMs: TIMEOUT_LIST_MS, retries: 1 });
    return (data.inventory || []) as WarehouseItem[];
  } catch (err: any) {
    if (err?.message && String(err.message).includes("알 수 없는")) {
      // 배포 버전이 이전 버전인 경우 getAll로 자동 폴백하여 재고 목록을 가져옵니다.
      const data = await apiGet(scriptUrl, "getAll", {}, { timeoutMs: TIMEOUT_LIST_MS, retries: 1 });
      return (data.inventory || []) as WarehouseItem[];
    }
    throw err;
  }
}

export async function fetchWarehouseBorrowedItems(scriptUrl: string, name: string): Promise<any[]> {
  const data = await apiGet(scriptUrl, "getWarehouseBorrowedItems", { name });
  return (data.items || []) as any[];
}

/* ══════════ 시나리오 오브젝트 관리 (WMS 관리자용) ══════════ */

export interface ScenarioObjectAdmin {
  rowIndex: number;
  id: string;
  name: string;
  sector: string;
  rootSlot: string;
  category: string;
  subcategory: string;
  image: string;
  stock: number;
  rented: number;
  excludeFromRanking?: boolean; // "가장 적게 대여된 물품" 랭킹에서 제외
  /** 실측 치수(mm). 선택 입력이라 셋 다 있을 때만 "실제 크기 보기"가 뜬다. */
  widthMm?: number;
  depthMm?: number;
  heightMm?: number;
  /** 그 치수를 어떤 형태로 그릴지. 안 고르면 육면체. */
  shape?: "box" | "cylinder" | "pyramid";
  fragile?: boolean;   // 깨질 위험 (M열)
  fireRisk?: boolean;  // 화재 위험 (N열)
  requestFor?: string; // 특정 업체 request용 물품 — 업체명 (O열, 빈 값이면 해당 없음)
  personalOwner?: string; // 개인 물품 — 소유자명 (P열, 빈 값이면 개인 물품 아님)
  archived?: boolean; // 보관 처리 — 파손/오브젝트로 사용 불가 등으로 목록·대여 카탈로그에서 치워둠 (Q열)
  variants?: ItemVariant[];  // 종류별 재고 (있으면 stock/rented는 이 값 + 미확인의 합계)
  unassignedStock?: number;  // 아직 어느 종류인지 모르는 선반 재고
  unassignedRented?: number; // 종류 도입 전에 나가서 아직 안 돌아온 수량
  /** 구매 링크. 관리 화면 전용이라 대여·조회 응답에는 아예 실려 오지 않는다.
   *  Scenario Manager 오브젝트의 product_link와 같은 값이다. */
  purchaseLink?: string;
  /** Scenario Manager 등록 화면이 받는 값들. WMS에는 대응하는 개념이 없어 여기서 입력받는다.
   *  비워두면 SM 기본값(Small / Hard)으로 등록된다. 관리 화면 전용이다. */
  smSize?: "Extra-Small" | "Small" | "Medium" | "Large" | "";
  smProperty?: "Soft" | "Hard" | "Deformable" | "Fragile" | "";
  /** SM의 product_memo — 구매처 특이사항 등 기타 메모. 관리 화면 전용이다. */
  productMemo?: string;
  /** 등록 요청에만 싣는 중복 방지 키 — "이 물품 하나를 만들려는 시도"의 이름표다.
   *  같은 키로 두 번 닿아도 Scenario Manager 오브젝트는 하나만 생긴다. 서버가 돌려주는
   *  물품에는 들어 있지 않다. */
  clientId?: string;
}

/** SM 등록 연동이 지금 쓸 수 있는지. 등록 화면이 ID를 자동으로 받아올 수 있는지 판단한다. */
export interface SmObjectStatus {
  enabled: boolean;
  ok: boolean;
  reason: string;
}

export async function fetchSmObjectStatus(scriptUrl: string): Promise<SmObjectStatus> {
  const res = await apiGet(scriptUrl, "getSmObjectStatus");
  return { enabled: !!res?.enabled, ok: !!res?.ok, reason: res?.reason || "" };
}

/** 무인 대여 확인 때 직접 촬영한 수령 증빙 사진 목록. */
export async function fetchPickupPhotos(scriptUrl: string, opts?: { limit?: number; offset?: number; itemSearch?: string }): Promise<{ items: ReturnPhotoEntry[]; hasMore: boolean }> {
  const params: Record<string, string> = {};
  if (opts?.limit) params.limit = String(opts.limit);
  if (opts?.offset) params.offset = String(opts.offset);
  if (opts?.itemSearch) params.itemSearch = opts.itemSearch;
  const data = await apiGet(scriptUrl, "getPickupPhotos", params);
  return { items: (data.items || []) as ReturnPhotoEntry[], hasMore: !!data.hasMore };
}

/** 무인 모드에서 직접 처리한 반납 사진. 일반 관리자 반납 사진과 분리해서 불러온다. */
export async function fetchUnattendedReturnPhotos(scriptUrl: string, opts?: { limit?: number; offset?: number; itemSearch?: string }): Promise<{ items: ReturnPhotoEntry[]; hasMore: boolean }> {
  const params: Record<string, string> = {};
  if (opts?.limit) params.limit = String(opts.limit);
  if (opts?.offset) params.offset = String(opts.offset);
  if (opts?.itemSearch) params.itemSearch = opts.itemSearch;
  const data = await apiGet(scriptUrl, "getUnattendedReturnPhotos", params);
  return { items: (data.items || []) as ReturnPhotoEntry[], hasMore: !!data.hasMore };
}

export async function fetchRegisteredUser(scriptUrl: string, employeeId: string, opts?: { includeSeatRecommendations?: boolean }): Promise<{ found: boolean; employeeId?: string; name?: string; seatRecommendations?: BorrowerSeatRecommendation[] }> {
  const data = await apiGet(scriptUrl, "getRegisteredUser", {
    employeeId,
    ...(opts?.includeSeatRecommendations ? { includeSeatRecommendations: "1" } : {}),
  });
  return { found: !!data.found, employeeId: data.employeeId, name: data.name, seatRecommendations: data.seatRecommendations };
}

export interface RegisteredUser { employeeId: string; name: string }

export interface BorrowerSeatRecommendation { floor: string; unit: string; count: number; lastUsedAt: string }

export async function fetchBorrowerSeatRecommendations(scriptUrl: string, employeeId: string): Promise<BorrowerSeatRecommendation[]> {
  const data = await apiGet(scriptUrl, "getBorrowerSeatRecommendations", { employeeId });
  if (data.success === false) throw new Error(data.error || "자주 사용한 유닛을 불러오지 못했습니다.");
  return (data.items || []) as BorrowerSeatRecommendation[];
}

export async function searchRegisteredUsers(scriptUrl: string, query: string): Promise<RegisteredUser[]> {
  const data = await apiGet(scriptUrl, "searchRegisteredUsers", { query });
  return (data.items || []) as RegisteredUser[];
}

export interface SmImportCandidate {
  id: string;
  name: string;
  sector: string;
  rootSlot: string;
  image: string;
  stock: number;
  rented: number;
  total: number;
  tracked: boolean;
  importable: boolean;
  blockedReason: string;
  smSize: string;
  smProperty: string;
  purchaseLink: string;
  productMemo: string;
}

export async function previewSmObjectImports(scriptUrl: string): Promise<{ smCount: number; missingCount: number; items: SmImportCandidate[] }> {
  const res = await apiGet(scriptUrl, "previewSmObjectImports", {}, { timeoutMs: 180000, retries: 0 });
  if (res?.ok === false) throw new Error(res.reason || "SM 물품 목록을 불러오지 못했습니다.");
  return { smCount: Number(res?.smCount) || 0, missingCount: Number(res?.missingCount) || 0, items: res?.items || [] };
}

export async function previewSmObjectImport(scriptUrl: string, id: string): Promise<{ found: boolean; alreadyExists: boolean; id?: string; item?: SmImportCandidate }> {
  const res = await apiGet(scriptUrl, "previewSmObjectImport", { id }, { timeoutMs: 30000, retries: 0 });
  if (res?.ok === false) throw new Error(res.reason || "SM 물품을 조회하지 못했습니다.");
  return { found: !!res?.found, alreadyExists: !!res?.alreadyExists, id: res?.id, item: res?.item };
}

export async function importSmObjects(scriptUrl: string, ids: string[], manager?: string): Promise<any> {
  const res = await apiPost(scriptUrl, "importSmObjects", { ids, manager }, 300000);
  if (res?.ok === false) throw new Error(res.reason || "SM 물품을 가져오지 못했습니다.");
  return res;
}

export interface SmSyncRunResult {
  ok: boolean;
  running?: boolean;
  reason?: string;
  at?: string;
  total?: number;
  full?: boolean;
  changed?: number;
  quantity?: number;
  borrow?: number;
  failed?: number;
  metadata?: number;
  metadataFailed?: number;
  metadataErrors?: { id?: string; name?: string; reason?: string }[];
}

export interface SmUploadJob {
  id: string;
  mode: "changes" | "all";
  fields?: SmMetadataField[];
  status: "running" | "done" | "failed";
  phase: string;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  percent: number;
  currentItemId?: string;
  currentItemName?: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  result?: SmSyncRunResult | null;
  errors?: { id?: string; name?: string; reason?: string }[];
}

export type SmMetadataField = "name" | "sector" | "rootSlot" | "quantity" | "rentalStatus" | "productLink" | "smSize" | "smProperty" | "productMemo" | "image";

export async function fetchSmSyncStatus(scriptUrl: string): Promise<{ enabled: boolean; lastRun?: SmSyncRunResult | null }> {
  return apiGet(scriptUrl, "getSmSyncStatus");
}

export async function syncSmChangesNow(scriptUrl: string): Promise<SmSyncRunResult> {
  const res = await apiPost(scriptUrl, "syncSmChangesNow", {}, 180000);
  return res as SmSyncRunResult;
}

export async function syncAllSmMetadataNow(scriptUrl: string): Promise<SmSyncRunResult> {
  const res = await apiPost(scriptUrl, "syncAllSmMetadataNow", {}, 900000);
  return res as SmSyncRunResult;
}

export async function startSmMetadataUpload(scriptUrl: string, mode: "changes" | "all", fields?: SmMetadataField[]): Promise<SmUploadJob> {
  const res = await apiPost(scriptUrl, "startSmMetadataUpload", { mode, ...(fields ? { fields } : {}) }, 30000);
  if (!res?.job) throw new Error(res?.reason || "SM 업로드를 시작하지 못했습니다.");
  return res.job as SmUploadJob;
}

export async function fetchSmUploadJob(scriptUrl: string, jobId: string): Promise<SmUploadJob | null> {
  const res = await apiGet(scriptUrl, "getSmUploadJob", { jobId }, { timeoutMs: 30000, retries: 0 });
  return (res.job || null) as SmUploadJob | null;
}

/** 미확인 재고를 실제 종류로 옮긴다 (창고에서 실물을 확인한 뒤 반영).
 *  여러 종류를 한 번에 넘기면 한 트랜잭션으로 처리된다 — 일부만 옮겨지는 일이 없다. */
export async function assignUnassignedStock(
  scriptUrl: string,
  itemId: string,
  items: { variantId: number; quantity: number }[],
  manager?: string
): Promise<any> {
  return apiPost(scriptUrl, "assignUnassignedStock", { itemId, items, manager });
}

/** 물품 하나의 종류 목록을 통째로 저장한다(추가/이름 변경/수량 변경/삭제).
 *  빈 배열을 보내면 종류 구분을 해제하고 총재고를 다시 직접 관리한다. */
export async function saveScenarioVariants(
  scriptUrl: string,
  itemId: string,
  variants: {
    id?: number; name: string; stock: number; image?: string;
    // 종류별 실측 치수. null을 보내면 지운다는 뜻이고, 아예 안 보내면 서버가 기존 값을 지킨다
    // (재고 조정 화면처럼 이름·재고만 보내는 곳에서 치수가 날아가지 않도록).
    widthMm?: number | null; depthMm?: number | null; heightMm?: number | null;
    shape?: "box" | "cylinder" | "pyramid" | null;
  }[],
  unassignedStock: number,
  manager?: string,
  options?: { stockAdjustment?: boolean; reason?: string }
): Promise<any> {
  return apiPost(scriptUrl, "saveScenarioVariants", { itemId, variants, unassignedStock, manager, ...options });
}

// 한 번에 다 받으면 응답이 커져서, 구글이 본문 대신 임시 주소(googleusercontent.com/macros/echo)로
// 리다이렉트하는데 그 주소가 404가 나는 일이 있다. 응답이 작으면 리다이렉트 자체가 생기지 않으므로,
// 100개씩 나눠 받되 끝까지 이어 붙여 결국 "전체 목록"을 돌려준다.
// 호출하는 쪽에서 보면 예전과 똑같이 전체 배열이 오므로, 검색·필터도 그대로 동작한다.
const PAGE_CHUNK = 100;

export async function fetchScenarioObjectsForAdmin(scriptUrl: string, forceRefresh?: boolean): Promise<ScenarioObjectAdmin[]> {
  try {
    const params: Record<string, string> = {};
    if (forceRefresh) params.forceRefresh = "1";
    const data = await apiGet(scriptUrl, "getScenarioObjectsForAdmin", params, { timeoutMs: TIMEOUT_LIST_MS, retries: 1 });
    if (data && data.items && !data.hasMore) {
      return data.items as ScenarioObjectAdmin[];
    }
    const all: ScenarioObjectAdmin[] = (data.items || []) as ScenarioObjectAdmin[];
    if (data.hasMore) {
      for (let offset = all.length; ; offset += PAGE_CHUNK) {
        const pageParams: Record<string, string> = { limit: String(PAGE_CHUNK), offset: String(offset) };
        const pageData = await apiGet(scriptUrl, "getScenarioObjectsForAdmin", pageParams, { timeoutMs: TIMEOUT_LIST_MS, retries: 1 });
        const items = (pageData.items || []) as ScenarioObjectAdmin[];
        all.push(...items);
        if (!pageData.hasMore || items.length === 0) break;
        if (offset > 20000) break;
      }
    }
    return all;
  } catch {
    const all: ScenarioObjectAdmin[] = [];
    for (let offset = 0; ; offset += PAGE_CHUNK) {
      const params: Record<string, string> = { limit: String(PAGE_CHUNK), offset: String(offset) };
      if (forceRefresh && offset === 0) params.forceRefresh = "1";
      const data = await apiGet(scriptUrl, "getScenarioObjectsForAdmin", params, { timeoutMs: TIMEOUT_LIST_MS, retries: 1 });
      const items = (data.items || []) as ScenarioObjectAdmin[];
      all.push(...items);
      if (!data.hasMore || items.length === 0) break;
      if (offset > 20000) break;
    }
    return all;
  }
}


export async function updateScenarioObject(scriptUrl: string, payload: Partial<ScenarioObjectAdmin> & { rowIndex: number; manager?: string }): Promise<any> {
  return apiPost(scriptUrl, "updateScenarioObject", payload);
}

/** 등록은 Scenario Manager를 여러 번 오간다(등록 → 번호 확인 → 상세 확인 → 위치 → 수량).
 *  SM 목록 조회가 느린 날에는 기본 제한 시간(45초)을 넘겨, 양쪽 다 정상 등록됐는데도
 *  화면에는 실패로 보였다. 그래서 이 요청만 넉넉하게 잡는다. */
const ADD_SCENARIO_OBJECT_TIMEOUT_MS = 300000;   // 서버가 목록 조회를 다시 시도하는 시간까지 포함한 상한

export async function addScenarioObject(scriptUrl: string, payload: Partial<ScenarioObjectAdmin>): Promise<any> {
  return apiPost(scriptUrl, "addScenarioObject", payload, ADD_SCENARIO_OBJECT_TIMEOUT_MS);
}

export async function deleteScenarioObject(scriptUrl: string, rowIndex: number): Promise<any> {
  return apiPost(scriptUrl, "deleteScenarioObject", { rowIndex });
}

/* ══════════ 테이블보 (관리자용) ══════════ */

/** 촬영용 천. 시나리오 물품과 별개로 관리하며, 두께가 없어 가로·세로만 받는다. */
export interface TableclothItem {
  id: number;
  name: string;
  location: string;
  image: string;
  stock: number;
  rented: number;
  widthMm?: number;
  depthMm?: number;
  /** 무늬 분류. key는 utils/tableclothCategory.ts 의 목록을 쓴다. 분류 전이면 "". */
  category?: string;
  subcategory?: string;
  /** 참고 링크(구매처·원단 정보 등). 여러 개면 줄바꿈으로 이어 붙인다. */
  link?: string;
  note: string;
  archived: boolean;
  updatedAt: string;
}

export async function fetchTableclothItems(scriptUrl: string): Promise<TableclothItem[]> {
  const data = await apiGet(scriptUrl, "getTableclothItems", {}, { timeoutMs: TIMEOUT_LIST_MS, retries: 1 });
  return (data.items || []) as TableclothItem[];
}

export async function addTableclothItem(scriptUrl: string, payload: Partial<TableclothItem>): Promise<any> {
  return apiPost(scriptUrl, "addTableclothItem", payload);
}

export async function updateTableclothItem(scriptUrl: string, payload: Partial<TableclothItem> & { id: number }): Promise<any> {
  return apiPost(scriptUrl, "updateTableclothItem", payload);
}

/** 여러 장의 위치를 한 번에 바꾼다 — 선반 이동, 표기 통일용. */
export async function updateTableclothLocations(
  scriptUrl: string, ids: number[], location: string
): Promise<{ success: boolean; updated?: number; message?: string }> {
  return apiPost(scriptUrl, "updateTableclothLocations", { ids, location });
}

/** 분류표 한 장(대분류 + 그 아래 소분류). 화면에서 고칠 수 있어 서버가 원본이다. */
export interface TableclothCategory {
  key: string;
  label: string;
  emoji: string;
  color: string;
  subs: { key: string; label: string }[];
}

export async function fetchTableclothCategories(scriptUrl: string): Promise<TableclothCategory[]> {
  const data = await apiGet(scriptUrl, "getTableclothCategories", {});
  return (data.categories || []) as TableclothCategory[];
}

/** 분류별로 지금 몇 장이 물려 있는지 — 분류를 지우기 전에 영향을 보여주려고 쓴다. */
export async function fetchTableclothCategoryUsage(
  scriptUrl: string
): Promise<Record<string, { total: number; subs: Record<string, number> }>> {
  const data = await apiGet(scriptUrl, "getTableclothCategoryUsage", {});
  return data.usage || {};
}

/** 분류표를 통째로 저장한다(부분 수정이 아닌 전체 교체). 사라진 분류를 쓰던 물품은 서버가 비운다. */
export async function saveTableclothCategories(
  scriptUrl: string, categories: TableclothCategory[]
): Promise<{ success: boolean; cleared?: number; categories?: TableclothCategory[]; message?: string }> {
  return apiPost(scriptUrl, "saveTableclothCategories", { categories });
}

/** 여러 장을 한 번에 보관 처리하거나 되돌린다 — 철 지난 천을 시즌 단위로 내릴 때 쓴다. */
export async function updateTableclothArchived(
  scriptUrl: string, ids: number[], archived: boolean
): Promise<{ success: boolean; updated?: number; message?: string }> {
  return apiPost(scriptUrl, "updateTableclothArchived", { ids, archived });
}

/** 여러 장의 무늬 분류를 한 번에 지정한다 — 사진을 훑으며 같은 결끼리 묶을 때 쓴다. */
export async function updateTableclothCategories(
  scriptUrl: string, ids: number[], category: string, subcategory: string
): Promise<{ success: boolean; updated?: number; message?: string }> {
  return apiPost(scriptUrl, "updateTableclothCategories", { ids, category, subcategory });
}

export async function deleteTableclothItem(scriptUrl: string, id: number): Promise<any> {
  return apiPost(scriptUrl, "deleteTableclothItem", { id });
}

/** 선택한 여러 장을 한 번에 삭제한다(되돌릴 수 없다 — 보관과 다르다). */
export async function deleteTableclothItems(
  scriptUrl: string, ids: number[]
): Promise<{ success: boolean; deleted?: number; message?: string }> {
  return apiPost(scriptUrl, "deleteTableclothItems", { ids });
}

/** 선택한 여러 장을 다른 위치로 그대로 복사한다. 사진·크기·분류·재고는 같고 번호만 새로 받는다.
 *  location 을 넘기지 않으면 원본 위치 그대로 복사한다. */
export async function duplicateTableclothItems(
  scriptUrl: string, ids: number[], location?: string
): Promise<{ success: boolean; created?: number; ids?: number[]; message?: string }> {
  return apiPost(scriptUrl, "duplicateTableclothItems", location === undefined ? { ids } : { ids, location });
}

/** 테이블보 대여 한 줄 (자체 장부). 흐름은 시나리오 물품과 같고 장부만 분리돼 있다. */
export interface TableclothRental {
  rowIndex: number;
  sheetType: "tablecloth";
  borrowerName: string;
  affiliation: string;
  employeeId: string;
  floor: string;
  unit: string;
  itemId: number;
  itemLabel: string;
  quantity: number;
  purpose: string;
  borrowDate: string;
  pickedUp: boolean;
  status?: string;
  image?: string;
  location?: string;
  stock?: number;
  rented?: number;
  /** 내 기록·대여 이력 조회에서 채워진다 — 지금 나가 있는 줄인지, 언제 돌아왔는지. */
  returned?: boolean;
  returnDate?: string;
}

/** 테이블보 한 장을 지금 빌려간 사람. 물품을 눌렀을 때 보여준다. */
export interface TableclothBorrower {
  rowIndex: number;
  borrowerName: string;
  affiliation: string;
  floor: string;
  unit: string;
  quantity: number;
  purpose: string;
  borrowDate: string;
}

export async function recordTableclothBorrow(
  scriptUrl: string,
  payload: {
    borrowerName: string; affiliation?: string; employeeId?: string; email?: string;
    floor?: string; unit?: string; purpose?: string;
    items: { id: number; name: string; qty: number }[];
  }
): Promise<{ success: boolean; message?: string }> {
  return apiPost(scriptUrl, "recordTableclothBorrow", payload);
}

export async function fetchTableclothUnreturned(scriptUrl: string): Promise<TableclothRental[]> {
  const d = await apiGet(scriptUrl, "getTableclothUnreturned", {}, { timeoutMs: TIMEOUT_LIST_MS, retries: 1 });
  return (d.items || []) as TableclothRental[];
}

/** 테이블보 대여 이력 — 담당자 확인을 거치지 않는 물건이라 "지금 어디 있나"를 이걸로 본다. */
export async function fetchTableclothRentalLogs(scriptUrl: string, limit = 300): Promise<TableclothRental[]> {
  const d = await apiGet(scriptUrl, "getTableclothRentalLogs", { limit: String(limit) }, { timeoutMs: TIMEOUT_LIST_MS, retries: 1 });
  return (d.logs || []) as TableclothRental[];
}

export async function confirmTableclothPickup(scriptUrl: string, rowIndexes: number[]): Promise<any> {
  return apiPost(scriptUrl, "confirmTableclothPickup", { rows: rowIndexes.map((rowIndex) => ({ rowIndex })) });
}

export async function swapTableclothRental(scriptUrl: string, rowIndex: number, toId: number): Promise<any> {
  return apiPost(scriptUrl, "swapTableclothRental", { rowIndex, toId });
}

export async function processTableclothReturn(
  scriptUrl: string,
  returnRequests: { rowIndex: number; quantity: number }[],
  who?: { borrowerName: string; affiliation?: string; employeeId?: string }
): Promise<any> {
  return apiPost(scriptUrl, "processTableclothReturn", { returnRequests, ...(who || {}) });
}

/** 내가 지금 빌린 것 + 지난 days일(기본 7일) 동안의 내 기록. */
export async function fetchMyTableclothRentals(
  scriptUrl: string,
  who: { name: string; affiliation?: string; employeeId?: string },
  days = 7
): Promise<{ days: number; active: TableclothRental[]; recent: TableclothRental[] }> {
  const d = await apiGet(scriptUrl, "getMyTableclothRentals", {
    name: who.name, affiliation: who.affiliation || "", employeeId: who.employeeId || "", days: String(days),
  }, { timeoutMs: TIMEOUT_LIST_MS, retries: 1 });
  return { days: d.days || days, active: d.active || [], recent: d.recent || [] };
}

/** 이 테이블보를 지금 누가 빌려갔는지. */
/** 지금 나가 있는 천 전체를 물품 번호별로 묶어 한 번에 받는다 — 목록에서 "누가 가져갔는지"를
 *  바로 보여주기 위한 것이라, 장마다 따로 묻지 않는다. */
export async function fetchTableclothActiveBorrowers(
  scriptUrl: string
): Promise<Record<string, TableclothBorrower[]>> {
  const d = await apiGet(scriptUrl, "getTableclothActiveBorrowers", {}, { timeoutMs: TIMEOUT_LIST_MS, retries: 1 });
  return (d.byItem || {}) as Record<string, TableclothBorrower[]>;
}

export async function fetchTableclothBorrowers(scriptUrl: string, itemId: number): Promise<TableclothBorrower[]> {
  const d = await apiGet(scriptUrl, "getTableclothBorrowers", { itemId: String(itemId) }, { timeoutMs: TIMEOUT_LIST_MS, retries: 1 });
  return (d.borrowers || []) as TableclothBorrower[];
}

/* ══════════ 재고 실사 기록 (관리자용) ══════════ */

export interface StockAuditRecord {
  auditedAt: string;
  itemId: string;
  itemName: string;
  systemStock: number;
  actualCount: number;
  diff: number;
  auditor: string;
  note: string;
}

// itemId를 넘기면 해당 물품만, 생략하면 전체 실사 기록을 최신순으로 반환.
export async function fetchStockAuditHistory(scriptUrl: string, itemId?: string): Promise<StockAuditRecord[]> {
  try {
    const data = await apiGet(scriptUrl, "getStockAuditHistory", itemId ? { itemId } : {});
    return (data.items || []) as StockAuditRecord[];
  } catch (err: any) {
    if (err?.message && String(err.message).includes("알 수 없는")) return [];
    throw err;
  }
}

export async function recordStockAudit(
  scriptUrl: string,
  payload: { itemId: string; itemName: string; systemStock: number; actualCount: number; auditor?: string; note?: string }
): Promise<{ success: boolean; message?: string; record?: StockAuditRecord }> {
  return apiPost(scriptUrl, "recordStockAudit", payload);
}

export interface StockFormulaStatus {
  found: boolean;
  stockIsFormula: boolean;
  rentedIsFormula: boolean;
}

// 재고/대여중 열이 수식으로 되어 있으면 자동 갱신이 적용되지 않아, 실사 불일치의 흔한 원인이 된다.
export async function fetchStockFormulaStatus(scriptUrl: string, itemId: string): Promise<StockFormulaStatus> {
  try {
    const data = await apiGet(scriptUrl, "getStockFormulaStatus", { itemId });
    return (data.status || { found: false, stockIsFormula: false, rentedIsFormula: false }) as StockFormulaStatus;
  } catch (err: any) {
    if (err?.message && String(err.message).includes("알 수 없는")) {
      return { found: false, stockIsFormula: false, rentedIsFormula: false };
    }
    throw err;
  }
}

/* ══════════ 재고 변경 (사유 기록 포함, 관리자용) ══════════ */

export interface StockChangeRecord {
  changedAt: string;
  category: string; // "COS 물품" | "시나리오 물품"
  id: string;
  itemName: string;
  oldStock: number;
  newStock: number;
  diff: number;
  reason: string;
  manager: string;
}

// COS 물품(category: "inventory") 또는 시나리오 물품(category: "scenario")의
// 현재 재고를 직접 변경. 사유(reason)는 필수이며, 변경 이력이 별도로 남는다.
export async function adjustStock(
  scriptUrl: string,
  payload: { category: "inventory" | "scenario" | "tablecloth"; rowIndex: number; newStock: number; newRented?: number; reason: string; manager?: string; id?: string }
): Promise<{ success: boolean; message?: string; warning?: string; oldStock?: number; newStock?: number; diff?: number; oldRented?: number; newRented?: number; rentedChanged?: boolean }> {
  return apiPost(scriptUrl, "adjustStock", payload);
}

// category/id를 생략하면 전체 변경 이력을 최신순으로 반환.
export async function fetchStockChangeHistory(
  scriptUrl: string,
  category?: "inventory" | "scenario" | "tablecloth",
  id?: string,
  name?: string
): Promise<StockChangeRecord[]> {
  try {
    const params: Record<string, string> = {};
    if (category) params.category = category;
    if (id) params.id = id;
    if (name) params.name = name;
    const data = await apiGet(scriptUrl, "getStockChangeHistory", params);
    return (data.items || []) as StockChangeRecord[];
  } catch (err: any) {
    if (err?.message && String(err.message).includes("알 수 없는")) {
      return [];
    }
    throw err;
  }
}

/* ══════════ 좌석 배치도 (층별 유닛 맵 + Day/Night 조회) ══════════ */

export interface SeatUnit {
  row: number;
  col: number;
  label: string; // 예: "Unit 1"
  exempt?: boolean; // 물품 종류 최대 보유 개수(10종류) 제한 예외 유닛
}

export interface SeatFloor {
  id: string;   // 예: "B2"
  name: string; // 표시용 이름 (id와 같아도 됨)
  rows: number;
  cols: number;
  units: SeatUnit[];
}

export interface SeatMap {
  floors: SeatFloor[];
}

export const DEFAULT_SEAT_MAP_DATA: SeatMap = {
  floors: [
    {
      id: "B2",
      name: "B2",
      rows: 4,
      cols: 5,
      units: [
        { row: 0, col: 0, label: "Unit 4 (Franka)" },
        { row: 0, col: 1, label: "Unit 5 (Franka)" },
        { row: 0, col: 2, label: "Unit 7 (Franka)" },
        { row: 2, col: 0, label: "Unit 3 (Franka)" },
        { row: 2, col: 1, label: "Unit 2 (Franka)" },
        { row: 0, col: 3, label: "Unit 8 (Franka)" },
        { row: 3, col: 4, label: "Unit 1 (Franka)" }
      ]
    },
    {
      id: "B1",
      name: "B1",
      rows: 4,
      cols: 4,
      units: [
        { row: 0, col: 0, label: "Unit 9 (Vega)" },
        { row: 1, col: 1, label: "Unit 10 (Vega)" },
        { row: 1, col: 3, label: "Unit 5 (Vega)" },
        { row: 2, col: 3, label: "Unit 6 (Vega)" },
        { row: 3, col: 3, label: "Unit 7 (Vega)" },
        { row: 3, col: 1, label: "Unit 8 (Vega)" }
      ]
    },
    {
      id: "2F",
      name: "2F",
      rows: 5,
      cols: 5,
      units: [
        { row: 0, col: 0, label: "Unit 4" },
        { row: 1, col: 0, label: "Unit 3" },
        { row: 1, col: 1, label: "Unit 1" },
        { row: 4, col: 0, label: "Unit 6" },
        { row: 2, col: 3, label: "Human Unit 5" },
        { row: 3, col: 3, label: "Human Unit 6" },
        { row: 0, col: 4, label: "Human Unit 1" },
        { row: 1, col: 4, label: "Human Unit 2" },
        { row: 2, col: 4, label: "Human Unit 3" },
        { row: 3, col: 4, label: "Human Unit 4" }
      ]
    }
  ]
};

export async function fetchSeatMap(scriptUrl: string): Promise<SeatMap> {
  let cachedMap: SeatMap | null = null;
  try {
    const raw = localStorage.getItem("wms_cached_seat_map");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.floors) && parsed.floors.length > 0) {
        cachedMap = parsed;
      }
    }
  } catch (e) {}

  if (!scriptUrl) {
    return cachedMap || DEFAULT_SEAT_MAP_DATA;
  }

  try {
    const data = await apiGet(scriptUrl, "getSeatMap", {});
    if (data.map && Array.isArray(data.map.floors) && data.map.floors.length > 0) {
      try {
        localStorage.setItem("wms_cached_seat_map", JSON.stringify(data.map));
      } catch (e) {}
      return data.map as SeatMap;
    }
    return cachedMap || DEFAULT_SEAT_MAP_DATA;
  } catch (err: any) {
    if (cachedMap) return cachedMap;
    return DEFAULT_SEAT_MAP_DATA;
  }
}

export async function saveSeatMap(scriptUrl: string, map: SeatMap): Promise<{ success: boolean; message?: string }> {
  try {
    localStorage.setItem("wms_cached_seat_map", JSON.stringify(map));
  } catch (e) {}
  if (!scriptUrl) {
    return { success: true, message: "로컬에 저장되었습니다." };
  }
  return apiPost(scriptUrl, "saveSeatMap", map);
}

export interface SeatOccupancyEntry {
  timestamp: string;
  borrowerName: string;
  batchId: string;
  sheetType: string;
  shift: "day" | "night";
  items: { name: string; qty: number; returned: boolean; rowIndex?: number; sheetType?: "scenario" | "general"; returnDate?: string }[];
  allReturned: boolean;
}

export async function fetchSeatOccupancy(scriptUrl: string, floor: string, unit: string, shift?: "day" | "night"): Promise<SeatOccupancyEntry[]> {
  try {
    const params: Record<string, string> = { floor, unit };
    if (shift) params.shift = shift;
    const data = await apiGet(scriptUrl, "getSeatOccupancy", params);
    return (data.items || []) as SeatOccupancyEntry[];
  } catch (err: any) {
    if (err?.message && String(err.message).includes("알 수 없는")) {
      return [];
    }
    throw err;
  }
}

/* ══════════ 물품 종류 최대 보유 개수 확인 ══════════ */

export interface ActiveItemTypeInfo {
  count: number;
  max: number;                 // 실제 적용되는 한도 (페널티가 있으면 낮아진 값)
  baseMax?: number;            // 페널티 없을 때의 기본 한도
  penalty?: { max: number; reason?: string; until?: string } | null;
  exempt?: boolean;            // 좌석배치도에서 ∞로 지정된 유닛이면 true (서버 판정)
  items: { id: string; name: string; quantity: number; borrowDate: string }[];
}

export async function fetchActiveItemTypeCount(
  scriptUrl: string,
  name: string,
  seat?: { floor?: string; unit?: string },
  identity?: { employeeId?: string; affiliation?: string }
): Promise<ActiveItemTypeInfo> {
  try {
    const params: Record<string, string> = { name };
    if (seat?.floor) params.floor = seat.floor;
    if (seat?.unit) params.unit = seat.unit;
    if (identity?.employeeId) params.employeeId = identity.employeeId;
    if (identity?.affiliation) params.affiliation = identity.affiliation;
    const data = await apiGet(scriptUrl, "getActiveItemTypeCount", params);
    return {
      count: data.count || 0,
      max: data.max || 0,
      baseMax: data.baseMax,
      penalty: data.penalty || null,
      exempt: !!data.exempt,
      items: data.items || [],
    };
  } catch (err: any) {
    // 서버가 이 액션을 모르는 구버전이면 제한 없음으로 취급해 대여를 막지 않는다.
    if (err?.message && String(err.message).includes("알 수 없는")) {
      return { count: 0, max: 15, items: [] };
    }
    throw err;
  }
}

// 창고 위치 "A-01" 랙(A~) → 슬롯 숫자 순 비교 (정렬용)
/** 공구 위치 정렬: 랙 → 층 → 구역(왼쪽→오른쪽, 앞→뒤). 규칙은 utils/toolLocation.ts 한곳에 둔다. */
export function compareRackSlot(la: string | null | undefined, lb: string | null | undefined): number {
  return compareToolLocation(la, lb);
}

/* ══════════ 시나리오 대여 대장 (반납완료 포함 전체 조회 + 재대여) ══════════ */

export interface ScenarioLogEntry {
  sheetType: "scenario" | "general";
  rowIndex: number;
  /** 이 대여가 어떤 종류였는지. 종류를 안 쓰는 물품이면 빈 값. */
  variantName?: string;
  /** 그 종류의 id. 재대여할 때 같은 종류로 다시 빌리는 데 쓴다.
   *  종류가 그 사이 삭제됐거나 지정된 적이 없으면 null. */
  variantId?: number | null;
  /** "종류 상관없음"으로 신청돼 아직 종류가 정해지지 않은 건 */
  variantPending?: boolean;
  borrowerName: string;
  employeeId?: string;
  scenarioId?: string;
  itemLabel: string;
  itemKind?: string;
  location: string;
  itemId: string;
  itemName: string;
  quantity: number;
  borrowDate: string;
  borrowDateTime?: string; // 시간까지 포함한 대여 시각 (정렬 전용, 표시는 borrowDate 사용)
  submitGroupKey?: string;
  submitDisplay?: string;
  borrowPurpose: string;
  email: string;
  batchId: string;
  floor?: string; // 대여 시 입력한 층수
  unit?: string;  // 대여 시 입력한 유닛
  generalOption?: string;
  returned: boolean;
  returnDate?: string; // 반납 처리 시각 (대장 최신 활동순 정렬에 사용)
  image: string;
  stock: number;
  rented: number;
}

// recentDays를 주면 "미반납 전체 + 최근 N일 내 반납분"만 받아온다 (관리자 화면 로딩 단축).
// 생략하면 기존처럼 전체를 받아온다 (통계 화면 등).
export interface ScenarioLogQuery {
  recentDays?: number;                             // 반납분을 최근 N일로 제한
  scope?: "all" | "unreturned" | "returned";      // 미반납만 / 반납분만 / 전체
  slim?: boolean;                                  // 화면에서 안 쓰는 필드 제외 (전송량 절감)
}

export async function fetchScenarioAllLogs(
  scriptUrl: string,
  recentDaysOrQuery?: number | ScenarioLogQuery
): Promise<ScenarioLogEntry[]> {
  const q: ScenarioLogQuery =
    typeof recentDaysOrQuery === "number" ? { recentDays: recentDaysOrQuery } : (recentDaysOrQuery || {});
  const params: Record<string, string> = {};
  if (q.recentDays && q.recentDays > 0) params.recentDays = String(q.recentDays);
  if (q.scope && q.scope !== "all") params.scope = q.scope;
  if (q.slim) params.slim = "1";
  const data = await apiGet(scriptUrl, "getScenarioAllLogs", params, { timeoutMs: TIMEOUT_BULK_MS, retries: 1 });
  return (data.items || []) as ScenarioLogEntry[];
}

export interface PagedLogResult<T> { items: T[]; hasMore: boolean; totalPeople: number }

/** "건수"가 아니라 "사람 수" 기준으로 잘라서 받아온다 — 더보기를 누르면 실제로 서버에 다시 요청한다.
 *  peopleLimit을 생략하면 (recentDays 등 다른 조건에 맞는) 전체를 한 번에 받아온다. */
export async function fetchScenarioAllLogsPaged(
  scriptUrl: string,
  query: ScenarioLogQuery & { peopleOffset?: number; peopleLimit?: number }
): Promise<PagedLogResult<ScenarioLogEntry>> {
  const params: Record<string, string> = {};
  if (query.peopleLimit) params.peopleLimit = String(query.peopleLimit);
  if (query.recentDays && query.recentDays > 0) params.recentDays = String(query.recentDays);
  if (query.scope && query.scope !== "all") params.scope = query.scope;
  if (query.slim) params.slim = "1";
  if (query.peopleOffset) params.peopleOffset = String(query.peopleOffset);
  const data = await apiGet(scriptUrl, "getScenarioAllLogs", params, { timeoutMs: TIMEOUT_BULK_MS, retries: 1 });
  return { items: (data.items || []) as ScenarioLogEntry[], hasMore: !!data.hasMore, totalPeople: Number(data.totalPeople) || 0 };
}

// 반납완료된 대여를 그대로 다시 대여 신청 (동일 물품/수량/대여자)
export async function reBorrowScenarioLogs(
  scriptUrl: string,
  logs: ScenarioLogEntry[],
  clientVersion: string,
  target?: { name: string; affiliation?: string; employeeId?: string },
  seat?: { floor: string; unit: string },
): Promise<BorrowResult> {
  const borrowList = buildReborrowEntries(logs, nowString(), target, seat);
  return postRecordBorrow(scriptUrl, borrowList, clientVersion);
}

/* ══════════ 구버전(재배포) 감지 신호 ══════════ */
// 화면 어디에서든(대여 제출 중, 반납 제출 중 등) 구버전을 감지하면 이 함수를 호출한다.
// App.tsx가 window 이벤트를 듣고 있다가 전체 화면 오버레이를 띄운다.
// prop drilling 없이 어느 컴포넌트에서든 쓸 수 있도록 window 이벤트로 처리한다.
export const VERSION_OUTDATED_EVENT = "wms:version-outdated";

export function signalVersionOutdated(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(VERSION_OUTDATED_EVENT));
}

// 서버(GAS)가 clientVersion 불일치로 거절했을 때의 메시지인지 판별한다.
// recordBorrow / processReturn 이 돌려주는 문구를 기준으로 한다.
export function isVersionMismatchMessage(message?: string): boolean {
  const m = String(message || "");
  if (!m) return false;
  return m.indexOf("구버전") !== -1 || (m.indexOf("최신 버전") !== -1 && m.indexOf("새로고침") !== -1);
}

// 제출 직전에 서버 버전을 한 번 더 확인한다.
// 폴링(주기적 확인) 사이의 빈틈에 제출이 들어가는 것을 막기 위한 최종 방어선.
// 조회 실패(네트워크 등)는 "구버전 아님"으로 취급해 정상 흐름을 막지 않는다.
export async function ensureUpToDate(scriptUrl: string, clientVersion: string): Promise<boolean> {
  if (!scriptUrl || !clientVersion) return true;
  try {
    const latest = await fetchBorrowAppVersion(scriptUrl);
    if (latest && latest !== clientVersion) {
      signalVersionOutdated();
      // 이미 작성/처리 중인 한 건은 끝낼 수 있게 한다. App은 이 동안 전체 차단 대신
      // "작업 완료 후 새로고침" 배너를 띄우고, 작업이 끝나는 순간 새로고침 화면으로 바뀐다.
      if (hasVersionWorkInProgress()) return true;
      return false;
    }
  } catch (e) { /* 조회 실패는 무시 */ }
  return true;
}

/* ══════════ 대여 물품 교체 (기존 반납 + 새 물품 대여를 한 번에) ══════════ */
export interface SwapBorrowPayload {
  sheetType: "scenario" | "general";
  rowIndex: number;
  newItemId: string;
  newQuantity: number;
  reason?: string;
  /** 종류가 나뉜 물품으로 교체할 때 어느 종류로 나가는지. 반납되는 쪽은 원래 기록의 종류로 되돌아간다. */
  newVariantId?: number;
}

export async function postSwapBorrowItem(
  scriptUrl: string,
  payload: SwapBorrowPayload,
  clientVersion: string
): Promise<BorrowResult> {
  return (await apiPost(scriptUrl, "swapBorrowItem", { ...payload, clientVersion })) as BorrowResult;
}

/** 대여/반납 처리 화면에서 건별로 "종류 수 한도 제외"를 켜고 끈다. */
export async function postSetTypeLimitExempt(
  scriptUrl: string,
  sheetType: "scenario" | "general",
  rowIndex: number,
  exempt: boolean,
  reason = ""
): Promise<{ success: boolean; exempt?: boolean; reason?: string; message?: string }> {
  return apiPost(scriptUrl, "setTypeLimitExempt", { sheetType, rowIndex, exempt, reason });
}

/* ══════════ 앱 버전 발급 (관리자 전용) ══════════ */
// 배포를 마친 뒤 이 함수를 호출하면 서버 APP_VERSION이 새 값으로 바뀌고,
// 열려 있던 구버전 화면들에 새로고침 안내가 뜬다.
export async function publishAppVersion(scriptUrl: string): Promise<{ success: boolean; version?: string; previous?: string; message?: string }> {
  return await apiPost(scriptUrl, "publishAppVersion", {});
}

/* ══════════ 창고물품 대여/반납 묶음 처리 ══════════ */
// 여러 건을 한 번의 요청으로 처리한다.
// (건수만큼 동시에 요청을 보내면 서버에서 같은 데이터 동시 쓰기가 발생해
//  잠금 충돌로 실패하거나 재고 갱신이 서로를 덮어쓴다)
export interface WarehouseRentRow {
  type: "대여" | "반납" | "소모";
  itemId?: number;
  resolveLoan?: boolean;
  location: string;
  name: string;
  qty: number;
  user: string;
  employeeId?: string;
  note: string;
}

export async function postWarehouseRentBulk(
  scriptUrl: string,
  items: WarehouseRentRow[]
): Promise<{ success: boolean; processed?: number; failed?: string[]; error?: string }> {
  return apiPost(scriptUrl, "rentInventoryItemsBulk", { items });
}

/* ══════════ 신청 묶음(배치) 상세 ══════════ */
// 한 번의 신청에 무엇이 함께 나갔는지 확인한다. 반납 완료 건도 포함된다.
export interface BatchDetailItem {
  variantName?: string;
  variantPending?: boolean;
  sheetType: "scenario" | "general";
  rowIndex: number;
  borrowerName: string;
  scenarioId?: string;
  itemId: string;
  itemName: string;
  itemLabel: string;
  quantity: number;
  location: string;
  borrowDate: string;
  borrowDateTime?: string;
  borrowPurpose?: string;
  returned: boolean;
  returnDate?: string;
  itemKind?: string;
  floor?: string;
  unit?: string;
}

export async function fetchBatchDetail(scriptUrl: string, batchId: string): Promise<BatchDetailItem[]> {
  const data = await apiGet(scriptUrl, "getBatchDetail", { batchId });
  return (data.items || []) as BatchDetailItem[];
}

/* ══════════ 물품 상태 변경 이력 (설정 > 물품 상태 변경 이력) ══════════ */

export interface ScenarioChangeEntry {
  timestamp: string;
  category?: "scenario" | "inventory" | "tablecloth";
  itemId: string;
  itemName: string;
  changeType: "created" | "updated" | "deleted" | "stock_adjust" | "defect" | "borrow" | "return";
  summary: string;
  manager: string;
}

export type ItemChangeCategory = "scenario" | "inventory" | "tablecloth";

export async function fetchItemChangeHistory(
  scriptUrl: string, category: ItemChangeCategory, since: string
): Promise<ScenarioChangeEntry[]> {
  const data = await apiGet(scriptUrl, "getItemChangeHistory", { category, since });
  return (data.items || []) as ScenarioChangeEntry[];
}

/* ══════════ 반납 로그 분석 ══════════ */
export interface InsightItem {
  id: string; name: string; image: string; rootSlot: string;
  owned: number; stock: number; rentals: number; borrowers: number;
  turnsPerUnit: number | null; stockoutPct: number | null; avgHoldHours: number | null;
  defects: number; defectRate: number | null; sidCount: number; lastRented: string;
  sm: { score: number | null; usage: number; status: string; isNew: boolean } | null;
  reason?: string; suggestAdd?: number;
}
/** 시간대 수요 격자의 한 칸(요일×시)에 대한 상세. 비어 있는 칸은 없다. */
export interface DemandCell {
  qty: number; borrowers: number; days: number;
  top: { id: string; name: string; qty: number }[]; moreTypes: number;
}
export interface RentalInsights {
  period: number; since: string; dataSince: string;
  summary: { rentals: number; quantity: number; borrowers: number; itemTypes: number; holdMedianHours: number | null; holdP90Hours: number | null; longHolds: number; open: number };
  timeDemand: {
    borrow: number[][]; return: number[][];
    /** 키는 `${요일}-${시}`(요일 0=일). */
    borrowCells?: Record<string, DemandCell>; returnCells?: Record<string, DemandCell>;
    borrowPeaks: { dow: number; hour: number; n: number }[]; returnPeaks: { dow: number; hour: number; n: number }[];
    borrowByHour: number[]; returnByHour: number[];
  };
  buy: InsightItem[];
  retire: { overuse: InsightItem[]; wear: InsightItem[]; unused: InsightItem[] };
  pairs: { a: { id: string; name: string; rootSlot: string }; b: { id: string; name: string; rootSlot: string }; count: number }[];
  sm: { ok: true; high: number; low: number } | { ok: false; reason: string };
}
const insightsCache = createRequestCache<RentalInsights>(30000);
export function fetchRentalInsights(scriptUrl: string, days: number, fresh = false): Promise<RentalInsights> {
  const key = `${scriptUrl}|${days}|${JSON.stringify(adminHeaders())}`;
  return insightsCache(key, async () => {
    const data = await apiGet(scriptUrl, "getRentalInsights", { days: String(days), ...(fresh ? { fresh: "1" } : {}) }, { timeoutMs: 20000, retries: 0 });
    return data as RentalInsights;
  }, fresh);
}

export async function fetchScenarioChanges(scriptUrl: string, since: string): Promise<ScenarioChangeEntry[]> {
  const data = await apiGet(scriptUrl, "getScenarioChanges", { since });
  return (data.items || []) as ScenarioChangeEntry[];
}

export interface ScenarioChangeSummaryEntry {
  itemId: string;
  itemName: string;
  location: string;
  stockBefore: number;
  stockAfter: number;
  stockDiff: number;
  rentedBefore: number;
  rentedAfter: number;
  rentedDiff: number;
  editCount: number;
  lastEdit: string;
  status: "created" | "deleted" | "changed";
}

export async function fetchScenarioChangeSummary(scriptUrl: string, since: string): Promise<{ items: ScenarioChangeSummaryEntry[]; notInitialized?: boolean }> {
  const data = await apiGet(scriptUrl, "getScenarioChangeSummary", { since });
  return { items: (data.items || []) as ScenarioChangeSummaryEntry[], notInitialized: !!data.notInitialized };
}

// 기준 시점을 저장하는 동시에, 그 순간의 전체 재고/대여중 값을 서버가 스냅샷으로 찍어둔다
// (그래야 이후 "몇 개 줄고 몇 개 늘었는지" 비교가 가능해진다).
export async function saveScenarioChangesCheckpoint(scriptUrl: string, checkpoint: string): Promise<{ checkpoint: string }> {
  return apiPost(scriptUrl, "setScenarioChangesCheckpoint", { checkpoint });
}

/* ══════════ 페널티 목록 ══════════ */
export interface PenaltyEntry {
  name: string;
  max: number;      // 이 사람에게 적용되는 최대 대여 종류
  reason?: string;
  until?: string;   // 비어 있으면 해제할 때까지
}

export async function fetchPenalties(scriptUrl: string): Promise<PenaltyEntry[]> {
  const data = await apiGet(scriptUrl, "getPenalties", {});
  return (data.items || []) as PenaltyEntry[];
}

// 이름 가운데를 가린다 (고성민 → 고*민, 김민 → 김*)
export function maskName(name: string): string {
  const n = String(name || "").trim();
  if (!n) return "";
  if (n.length === 1) return n;
  if (n.length === 2) return `${n[0]}*`;
  return `${n[0]}${"*".repeat(n.length - 2)}${n[n.length - 1]}`;
}

/* ══════════ 랜딩 공지 ══════════ */
export interface NoticeData { title?: string; text: string; updatedAt?: string; author?: string }
export const NOTICE_MAX = 3;

export async function fetchNotices(scriptUrl: string): Promise<NoticeData[]> {
  const data = await apiGet(scriptUrl, "getNotices", {});
  return (data.items || []) as NoticeData[];
}

export async function saveNotices(
  scriptUrl: string,
  items: NoticeData[],
  author: string
): Promise<{ success: boolean; items?: NoticeData[]; message?: string }> {
  return apiPost(scriptUrl, "saveNotices", { items, author });
}

export async function fetchNotice(scriptUrl: string): Promise<NoticeData> {
  const data = await apiGet(scriptUrl, "getNotice", {});
  return (data.notice || { text: "" }) as NoticeData;
}

export async function saveNotice(scriptUrl: string, text: string, author: string): Promise<{ success: boolean; message?: string }> {
  return apiPost(scriptUrl, "saveNotice", { text, author });
}

/* ══════════ 대여 잠금 ══════════ */
// 관리자가 대여를 일시 중단할 수 있다. 반납은 계속 가능하다.
export interface UnitLock { floor: string; unit: string; reason?: string }
export interface BorrowLock { locked: boolean; reason?: string; at?: string; units?: UnitLock[] }

// 층/유닛 비교용 정규화 (표기 차이에 흔들리지 않게)
export function unitLockKey(floor?: string, unit?: string): string {
  const norm = (v?: string) => String(v ?? "").toUpperCase().replace(/[\s()[\]{}_\-.,/]/g, "");
  return `${norm(floor)}|${norm(unit)}`;
}

export async function fetchBorrowLock(scriptUrl: string): Promise<BorrowLock> {
  const data = await apiGet(scriptUrl, "getBorrowLock", {});
  return (data.lock || { locked: false }) as BorrowLock;
}

export async function setBorrowLock(
  scriptUrl: string,
  locked: boolean,
  reason: string,
  units?: UnitLock[]
): Promise<{ success: boolean; lock?: BorrowLock; message?: string }> {
  return apiPost(scriptUrl, "setBorrowLock", units !== undefined ? { locked, reason, units } : { locked, reason });
}

/* ══════════ 창고물품(COS 물품) 대여로그 ══════════ */
export interface WarehouseLogEntry {
  rowIndex: number;
  timestamp: string;
  type: string;      // 대여 | 반납 | 소모
  location: string;
  name: string;
  quantity: number;
  user: string;
  employeeId?: string;
  note: string;
}

export async function fetchWarehouseLogs(scriptUrl: string, recentDays?: number): Promise<WarehouseLogEntry[]> {
  const params: Record<string, string> = {};
  if (recentDays && recentDays > 0) params.recentDays = String(recentDays);
  const data = await apiGet(scriptUrl, "getWarehouseLogs", params, { timeoutMs: TIMEOUT_LIST_MS, retries: 1 });
  return (data.items || []) as WarehouseLogEntry[];
}

/** "건수"가 아니라 "사람 수" 기준으로 잘라서 받아온다 — 더보기를 누르면 실제로 서버에 다시 요청한다. */
export async function fetchWarehouseLogsPaged(
  scriptUrl: string,
  opts: { recentDays?: number; peopleOffset?: number; peopleLimit: number }
): Promise<PagedLogResult<WarehouseLogEntry>> {
  const params: Record<string, string> = { peopleLimit: String(opts.peopleLimit) };
  if (opts.recentDays && opts.recentDays > 0) params.recentDays = String(opts.recentDays);
  if (opts.peopleOffset) params.peopleOffset = String(opts.peopleOffset);
  const data = await apiGet(scriptUrl, "getWarehouseLogs", params, { timeoutMs: TIMEOUT_LIST_MS, retries: 1 });
  return { items: (data.items || []) as WarehouseLogEntry[], hasMore: !!data.hasMore, totalPeople: Number(data.totalPeople) || 0 };
}
