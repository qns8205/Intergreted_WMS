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
// 연동 URL과 쿼리스트링을 안전하게 합친다.
// scriptUrl에 이미 '?'(예: ...exec?usp=sharing)나 fragment('#'), 공백이 들어와도
// action 파라미터가 묻히지 않도록 정규화한다. (특히 모바일에서 URL이 잘못 저장된 경우 방어)
function normalizeScriptUrl(raw: string): string {
  let u = String(raw || "").trim();
  const hashIdx = u.indexOf("#");
  if (hashIdx !== -1) u = u.slice(0, hashIdx); // fragment 제거
  return u.trim();
}

function buildUrl(scriptUrl: string, qs: string): string {
  const base = normalizeScriptUrl(scriptUrl);
  if (!qs) return base;
  return base + (base.indexOf("?") !== -1 ? "&" : "?") + qs;
}

async function apiGet(scriptUrl: string, action: string, params: Record<string, string> = {}) {
  if (!scriptUrl) throw new Error("구글 스프레드시트 연동 URL이 입력되지 않았습니다.");
  const qs = new URLSearchParams({ action, ...params }).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000); // 30초 타임아웃 (무한로딩 방지)
  const url = buildUrl(scriptUrl, qs);
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error("서버 응답이 지연되어 요청을 취소했습니다. 네트워크 상태를 확인하고 다시 시도해주세요.");
    throw new Error(e?.message || "네트워크 오류가 발생했습니다.");
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("서버가 올바르지 않은 응답을 반환했습니다. 웹앱 배포 상태를 확인하세요.");
  }
  if (!data.success) {
    // 서버가 액션을 모른다고 답한 경우, 어떤 URL로 어떤 액션을 보냈는지 함께 노출해 원인 파악을 돕는다.
    if (data.error && String(data.error).indexOf("알 수 없는") !== -1) {
      const shown = normalizeScriptUrl(scriptUrl);
      throw new Error(`${data.error} (요청 액션: '${action}'). 연동된 서버가 이 액션을 모릅니다 — 이 기기에 저장된 연동 URL이 예전 버전을 가리킬 수 있습니다. 저장된 URL: ${shown}`);
    }
    throw new Error(data.error || "요청 실패");
  }
  return data;
}

async function apiPost(scriptUrl: string, action: string, payload: any): Promise<any> {
  if (!scriptUrl) throw new Error("구글 스프레드시트 연동 URL이 입력되지 않았습니다.");
  const res = await fetch(normalizeScriptUrl(scriptUrl), {
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

/* ══════════ 열람 ↔ 대여 공용: 신원 & 장바구니 (localStorage) ══════════ */

export interface BrowseIdentity { name: string; employeeId: string }
export interface BrowseCartItem { id: string; name: string; quantity: number; rootSlot?: string }

const IDENTITY_KEY = "wms_browse_identity";
const CART_PREFIX = "wms_browse_cart:";

export function identityKey(name: string, employeeId: string): string {
  return `${String(name || "").trim()}|${String(employeeId || "").trim()}`;
}

export function saveIdentity(identity: BrowseIdentity): void {
  try { localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity)); } catch {}
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

/* ══════════ 창고 물품 (창고물품 시트) 타입 & 헬퍼 ══════════ */

export interface WarehouseItem {
  rowIndex: number;
  location: string;   // 예: "A-01", "F-02"
  name: string;
  photo: string;
  stock: number | string | null;
  spec: string;
  note: string;
  manager: string;
}

// 위치 문자열 "A-01" → { rack: "A", slot: "01" }
export function parseRackSlot(loc: string | null | undefined): { rack: string; slot: string } {
  const t = String(loc ?? "").trim().toUpperCase();
  const parts = t.split("-");
  if (parts.length < 2) return { rack: t, slot: "" };
  return { rack: parts[0], slot: parts.slice(1).join("-") };
}

export function warehouseStockNum(stock: number | string | null): number {
  if (stock === "" || stock === null || stock === undefined) return NaN; // N/A 취급
  const n = Number(stock);
  return isNaN(n) ? NaN : n;
}

export interface WarehouseCartItem {
  rowIndex: number;
  location: string;
  name: string;
  quantity: number;
}

const WH_CART_PREFIX = "wms_wh_cart:";

export function saveWarehouseCart(name: string, employeeId: string, items: WarehouseCartItem[]): void {
  try {
    const k = WH_CART_PREFIX + identityKey(name, employeeId);
    if (items.length === 0) localStorage.removeItem(k);
    else localStorage.setItem(k, JSON.stringify(items));
  } catch {}
}

export function loadWarehouseCart(name: string, employeeId: string): WarehouseCartItem[] {
  try {
    const raw = localStorage.getItem(WH_CART_PREFIX + identityKey(name, employeeId));
    return raw ? (JSON.parse(raw) as WarehouseCartItem[]) : [];
  } catch { return []; }
}

export function clearWarehouseCart(name: string, employeeId: string): void {
  try { localStorage.removeItem(WH_CART_PREFIX + identityKey(name, employeeId)); } catch {}
}

// 창고 재고 전체 조회 (WMS getAll의 inventory 사용)
export async function fetchWarehouseInventory(scriptUrl: string): Promise<WarehouseItem[]> {
  const data = await apiGet(scriptUrl, "getAll");
  return (data.inventory || []) as WarehouseItem[];
}

// 창고 물품 대여/반납 (WMS rentInventoryItem 재사용, Slack 미발송)
export async function postWarehouseRent(
  scriptUrl: string,
  payload: { type: "대여" | "반납" | "소모"; location: string; name: string; qty: number; user: string; note: string }
): Promise<any> {
  return apiPost(scriptUrl, "rentInventoryItem", payload);
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
}

export async function fetchScenarioObjectsForAdmin(scriptUrl: string): Promise<ScenarioObjectAdmin[]> {
  const data = await apiGet(scriptUrl, "getScenarioObjectsForAdmin");
  return (data.items || []) as ScenarioObjectAdmin[];
}

export async function updateScenarioObject(scriptUrl: string, payload: Partial<ScenarioObjectAdmin> & { rowIndex: number }): Promise<any> {
  return apiPost(scriptUrl, "updateScenarioObject", payload);
}

export async function addScenarioObject(scriptUrl: string, payload: Partial<ScenarioObjectAdmin>): Promise<any> {
  return apiPost(scriptUrl, "addScenarioObject", payload);
}

export async function deleteScenarioObject(scriptUrl: string, rowIndex: number): Promise<any> {
  return apiPost(scriptUrl, "deleteScenarioObject", { rowIndex });
}

// 창고 위치 "A-01" 랙(A~) → 슬롯 숫자 순 비교 (정렬용)
export function compareRackSlot(la: string | null | undefined, lb: string | null | undefined): number {
  const pa = String(la ?? "").toUpperCase().split("-");
  const pb = String(lb ?? "").toUpperCase().split("-");
  const ra = pa[0] || "", rb = pb[0] || "";
  if (ra !== rb) return ra < rb ? -1 : 1;
  let sa = parseInt(String(pa[1] ?? "").replace(/\D/g, ""), 10);
  let sb = parseInt(String(pb[1] ?? "").replace(/\D/g, ""), 10);
  if (isNaN(sa)) sa = 999999;
  if (isNaN(sb)) sb = 999999;
  return sa - sb;
}

/* ══════════ 시나리오 대여 대장 (반납완료 포함 전체 조회 + 재대여) ══════════ */

export interface ScenarioLogEntry {
  sheetType: "scenario" | "general";
  rowIndex: number;
  borrowerName: string;
  scenarioId?: string;
  itemLabel: string;
  itemKind?: string;
  location: string;
  itemId: string;
  itemName: string;
  quantity: number;
  borrowDate: string;
  submitGroupKey?: string;
  submitDisplay?: string;
  borrowPurpose: string;
  email: string;
  batchId: string;
  generalOption?: string;
  returned: boolean;
  image: string;
  stock: number;
  rented: number;
}

export async function fetchScenarioAllLogs(scriptUrl: string): Promise<ScenarioLogEntry[]> {
  const data = await apiGet(scriptUrl, "getScenarioAllLogs");
  return (data.items || []) as ScenarioLogEntry[];
}

// 반납완료된 대여를 그대로 다시 대여 신청 (동일 물품/수량/대여자)
export async function reBorrowScenarioLogs(
  scriptUrl: string,
  logs: ScenarioLogEntry[],
  clientVersion: string
): Promise<BorrowResult> {
  // 대여자/이메일 기준으로 일반대여 항목으로 재구성 (재대여는 일반대여로 처리)
  const first = logs[0];
  const borrowList: BorrowEntry[] = [{
    itemType: "general",
    borrowerName: first.borrowerName,
    affiliation: "",
    employeeId: "",
    borrowDate: nowString(),
    borrowPurpose: first.borrowPurpose || "재대여",
    generalOption: "재대여",
    borrowedItems: logs.map((l) => ({ id: l.itemId, name: l.itemName, quantity: l.quantity })),
  }];
  return postRecordBorrow(scriptUrl, borrowList, clientVersion);
}
