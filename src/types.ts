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
  photo?: string;
  itemCategory?: string;
}

export interface RentLog {
  rowIndex?: number;
  timestamp: string;
  location: string;
  name: string;
  type: "대여" | "반납" | "소모";
  qty: number | string;
  user: string;
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
}

export type Affiliation = "cfgw" | "configds" | "other";

export interface CartItem {
  id: string;
  name: string;
  quantity: number;
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
}
