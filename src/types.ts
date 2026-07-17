export interface InventoryItem {
  rowIndex: number;
  location: string;
  spec: string;
  name: string;
  link: string;
  stock: number | string | null;
  updatedAt: string;
  manager: string;
  note: string;
  photo: string;
}

export interface DefectLog {
  rowIndex?: number;
  name: string;
  qty: number | string | null;
  timestamp: string;
  defectType: string;
  note: string;
  actionTaken: string;
  photo?: string;
}

export interface RentLog {
  rowIndex?: number;
  timestamp: string;
  type: "대여" | "반납";
  location: string;
  name: string;
  qty: number | string;
  user: string;
  note: string;
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
}

export interface ScenarioDefinitionItem {
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
  items: ScenarioDefinitionItem[];
}

export interface CartItem {
  id: string;
  name: string;
  quantity: number;
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
  borrowPurpose?: string;
  email?: string;
  batchId?: string;
  generalOption?: string;
  image?: string;
  stock?: number;
  rented?: number;
}

export type Affiliation = "cfgw" | "configds" | "other";

export interface ToastMsg {
  msg: string;
  type: "ok" | "error" | "warn" | "info";
}
