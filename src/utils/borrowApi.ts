// 대여 시스템(구 BorrowForm) API 헬퍼 및 공용 타입/유틸
// 통합 GAS(AppsScript_Unified.gs)의 대여 액션들을 호출합니다.

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
}

export interface UnreturnedItem {
  sheetType: "scenario" | "general";
  rowIndex: number;
  borrowerName: string;
  scenarioId?: string;
  itemLabel: string;
  itemKind?: string;
  location: string;
  quantity: number;
  borrowDate: string;
  submitGroupKey?: string;
  submitDisplay?: string;
  borrowPurpose: string;
  email: string;
  batchId: string;
  generalOption?: string;
  image: string;
  stock: number;
  rented: number;
}

export interface BorrowEntry {
  itemType: "scenario" | "general";
  borrowerName: string;
  affiliation: string;
  employeeId: string;
  borrowDate: string;
  borrowPurpose: string;
  scenarioId?: string;
  requiredObjects?: ScenarioItem[];
  additionalItems?: ScenarioItem[];
  syncNeeded?: boolean;
  borrowedItems?: { id: string; name: string; quantity: number }[];
  generalOption?: string;
}

export interface ReturnRequest {
  sheetType: "scenario" | "general";
  rowIndex: number;
  quantity: number;
}

export interface BorrowResult {
  success: boolean;
  message: string;
}

/* ---------------- 위치 정렬 밴드 (Code.gs와 동일하게 유지할 것) ---------------- */
const LOCATION_SORT_BANDS = [
  { start: 186, end: 251, dir: "asc" },
  { start: 120, end: 185, dir: "desc" },
  { start: 60, end: 119, dir: "asc" },
  { start: 0, end: 59, dir: "desc" },
  { start: 100000, end: 100025, dir: "asc" },
] as const;

export function computeLocationSortIndex(rootSlot: string | null | undefined): number {
  const n = parseInt(String(rootSlot ?? "").replace(/\D/g, ""), 10);
  if (isNaN(n)) return Number.MAX_SAFE_INTEGER;
  let offset = 0;
  for (const b of LOCATION_SORT_BANDS) {
    const size = b.end - b.start + 1;
    if (n >= b.start && n <= b.end) return offset + (b.dir === "asc" ? n - b.start : b.end - n);
    offset += size;
  }
  return offset + n;
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
async function apiGet(scriptUrl: string, action: string, params: Record<string, string> = {}) {
  if (!scriptUrl) throw new Error("구글 스프레드시트 연동 URL이 입력되지 않았습니다.");
  const qs = new URLSearchParams({ action, ...params }).toString();
  const res = await fetch(`${scriptUrl}?${qs}`);
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("서버가 올바르지 않은 응답을 반환했습니다. 웹앱 배포 상태를 확인하세요.");
  }
  if (!data.success) throw new Error(data.error || "요청 실패");
  return data;
}

async function apiPost(scriptUrl: string, action: string, payload: any): Promise<any> {
  if (!scriptUrl) throw new Error("구글 스프레드시트 연동 URL이 입력되지 않았습니다.");
  const res = await fetch(scriptUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, payload }),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("서버가 올바르지 않은 응답을 반환했습니다. 웹앱 배포 상태를 확인하세요.");
  }
}

export async function fetchBorrowAppVersion(scriptUrl: string): Promise<string> {
  const data = await apiGet(scriptUrl, "getBorrowAppInfo");
  return String(data.version || "");
}

export async function fetchObjectItems(scriptUrl: string): Promise<ObjectItem[]> {
  const data = await apiGet(scriptUrl, "getObjectItems");
  return (data.items || []) as ObjectItem[];
}

export async function fetchScenarioDefinition(scriptUrl: string, sid: string): Promise<ScenarioDefinition> {
  const data = await apiGet(scriptUrl, "getScenarioDefinition", { sid });
  return (data.scenario || { sid, found: false, syncNeeded: true, blocked: false, blockReason: "", highLevelEn: "", highLevelKo: "", items: [] }) as ScenarioDefinition;
}

export async function fetchUnreturnedItems(scriptUrl: string): Promise<UnreturnedItem[]> {
  const data = await apiGet(scriptUrl, "getUnreturnedItems");
  return (data.items || []) as UnreturnedItem[];
}

export async function fetchMyBorrowedItems(scriptUrl: string, name: string, employeeId: string): Promise<UnreturnedItem[]> {
  const data = await apiGet(scriptUrl, "getMyBorrowedItems", { name, employeeId });
  return (data.items || []) as UnreturnedItem[];
}

export async function checkConfigDsRegistered(scriptUrl: string, name: string): Promise<boolean> {
  const data = await apiGet(scriptUrl, "isConfigDsRegistered", { name });
  return !!data.registered;
}

export async function postRecordBorrow(scriptUrl: string, borrowList: BorrowEntry[], clientVersion: string): Promise<BorrowResult> {
  return (await apiPost(scriptUrl, "recordBorrow", { borrowList, clientVersion })) as BorrowResult;
}

export async function postProcessReturn(scriptUrl: string, returnRequests: ReturnRequest[], clientVersion: string): Promise<BorrowResult> {
  return (await apiPost(scriptUrl, "processReturn", { returnRequests, clientVersion })) as BorrowResult;
}

/* ---------------- 데모 데이터 (미연동 시) ---------------- */
export const DEMO_OBJECT_ITEMS: ObjectItem[] = [
  { id: "000008", name: "fruit", sector: "Seoul-Root", rootSlot: "000060", category: "식음료", subcategory: "간식 및 식사류", image: "", stock: 15, rented: 8 },
  { id: "000019", name: "towel (정사각형 소형 행주)", sector: "Seoul-Root", rootSlot: "000098", category: "청소 및 위생용품", subcategory: "위생 및 타월", image: "", stock: 58, rented: 3 },
  { id: "002900", name: "Water hose", sector: "Seoul-Root", rootSlot: "000184", category: "생활용품", subcategory: "기타", image: "", stock: 10, rented: 0 },
  { id: "002884", name: "Mechanical Pencil", sector: "Seoul-Root", rootSlot: "000246", category: "사무용품", subcategory: "필기구", image: "", stock: 25, rented: 5 },
  { id: "001531", name: "electronic scale", sector: "Seoul-Root", rootSlot: "000028", category: "전자기기", subcategory: "측정기기", image: "", stock: 4, rented: 1 },
];
