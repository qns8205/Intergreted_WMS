export interface InventoryItem {
  rowIndex: number;
  location: string;
  photo: string;
  name: string;
  link: string;
  stock: number | string | null;
  updatedAt: string;
  manager: string;
  note: string;
  spec: string; // Column I - 규격 및 추가 정보
  keywords?: string; // Column K - 한글 검색어 (검색 보조용)
  manager2?: string; // Column J - 담당자 2 (보존용)
  isConsumable?: boolean; // Column L - 소모성 물품 여부 (대여/소모 중 무엇을 누르든 항상 소모로 처리)
  archived?: boolean; // 보관 처리 — 목록·대여 카탈로그에서 치워둠
}

export interface DefectLog {
  rowIndex?: number;
  timestamp: string;
  location: string;
  name: string;
  qty: number | string | null;
  defectType: string;
  manager: string;
  note: string;
  actionTaken: string;
  culprit?: string; // 파손자 (로봇/시나리오 오브젝트 파손 시 기록)
  photo?: string;
  itemCategory?: string;
  itemId?: string; // 로봇(시나리오) 오브젝트 재고 차감 대상 특정용 — rack(공구) 항목에는 없음
}

export interface RentLog {
  rowIndex?: number;
  timestamp: string;
  location: string;
  name: string;
  type: "대여" | "반납" | "소모";
  qty: number | string;
  user: string;
  employeeId?: string;
  note: string;
}

export interface WmsUser {
  id: string;
  password?: string;
  name?: string;
}

export interface Rack {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  color: string;
  shelves: string[];
}

// 물품 하나 안에서 구분되는 "종류"(예: 같은 의자의 색상/모델 차이).
// variants가 비어 있으면 종류 구분을 쓰지 않는 물품이며, 기존과 동일하게 동작한다.
export interface ItemVariant {
  id: number;
  name: string;
  stock: number;
  rented: number;
  image?: string; // 종류별 사진 — 신청자가 눈으로 보고 고를 수 있게
}

export interface ScenarioObjectItem {
  id: string;
  name: string;
  sector: string;
  rootSlot: string;
  category: string;
  subcategory: string;
  image: string;
  stock: number;
  rented: number;
  excludeFromRanking?: boolean;
  /** 실측 치수(mm). 선택 입력이라 셋 다 있을 때만 "실제 크기 보기"가 뜬다. */
  widthMm?: number;
  depthMm?: number;
  heightMm?: number;
  fragile?: boolean;   // 깨질 위험 (M열)
  fireRisk?: boolean;  // 화재 위험 (N열)
  requestFor?: string; // 특정 업체 request용 물품 — 업체명 (O열, 빈 값이면 해당 없음)
  personalOwner?: string; // 개인 물품 — 소유자명 (P열, 빈 값이면 개인 물품 아님)
  archived?: boolean; // 보관 처리 — 파손/오브젝트로 사용 불가 등으로 목록·대여 카탈로그에서 치워둠 (Q열)
  variants?: ItemVariant[];   // 종류별 재고. 있으면 stock/rented는 이 값 + 미확인의 합계다.
  unassignedStock?: number;   // 아직 어느 종류인지 모르는 선반 재고
  unassignedRented?: number;  // 종류 도입 전에 나가서 아직 안 돌아온 수량
}

export type Affiliation = "cfgw" | "configds" | "other";

export interface CartItem {
  id: string;
  name: string;
  quantity: number;
  // 종류가 나뉜 물품은 반드시 종류 하나를 골라야 담을 수 있다.
  variantId?: number;
  variantName?: string;
  // SID 필요 물품 전용: 필요 수량을 종류별로 나눠 배정한 값 { [종류 id]: 수량 }.
  // 제출할 때 종류별로 항목이 쪼개져 나가므로 서버에는 전달되지 않는다.
  variantAlloc?: Record<number, number>;
}

export interface ScenarioItem {
  id: string;
  name: string;
  quantity: number;
  variants?: ItemVariant[];
  variantId?: number;
  variantName?: string;
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
  errorMessage?: string;
  rowsScanned?: number;
  fetchError?: string;
}

export interface SidCartEntry {
  sid: string;
  loading: boolean;
  scenario: ScenarioDefinition | null;
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
  variants?: ItemVariant[];      // 이 물품이 가진 종류 목록 (대여 확인 때 고를 후보)
  variantId?: number | null;     // 확정된 종류
  variantName?: string;          // 확정된 종류 이름 (표시용)
  variantPending?: boolean;      // "종류 상관없음"으로 신청되어 아직 안 정해진 줄
  variantUnassigned?: boolean;   // 종류 도입 전에 나간 대여 건 — 반납 때 종류를 골라야 한다
}
