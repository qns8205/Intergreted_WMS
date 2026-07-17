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
