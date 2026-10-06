import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import WarehouseManualRequestsPanel from "./WarehouseManualRequestsPanel";
import { Search, RotateCcw, User, Package, X, Undo2, Check, MapPin, Repeat, Camera, AlertTriangle, Printer } from "lucide-react";
import { cameraUrl, claimCameraStream, releaseCameraStream, fallbackToSameOrigin, resetCameraBase, hardResetCameraSession, restartCameraCapture } from "../utils/cameraSource";
import {
  fetchUnreturnedItems, UnreturnedItem,
  postProcessReturn, postConfirmPickup, postSaveReturnPhoto, postRecordDamagedReturn, fetchBorrowAppVersion,
  postUpdateBorrowerSeat, fetchSeatMap, SeatMap,
  isVersionMismatchMessage, signalVersionOutdated,
  fetchScenarioObjectsForAdmin, ScenarioObjectAdmin, postRecordBorrow, nowString,
  postSwapBorrowItem, postSetTypeLimitExempt,
  fetchWarehouseBorrowedItems, postWarehouseRentBulk,
  fetchWarehouseInventory, WarehouseItem,
  postRecordBorrow as postBorrow,



} from "../utils/borrowApi";
import { smartMatch } from "../utils/search";
import { adminHeaders } from "../utils/adminAuth";
import { getThumbImageUrl } from "../utils/drive";
import { getGoogleDriveImageUrl } from "../utils/drive";
import HazardConfirmModal, { collectHazardItems } from "./HazardConfirmModal";
import { countDistinctItemTypes } from "../utils/itemTypeCount";
import { useVersionWorkGuard } from "../utils/versionWorkGuard";
import RegisteredUserPicker from "./RegisteredUserPicker";

// 대여/반납 기록 두 건을 "같은 사람" 것으로 묶어도 되는지 판단한다 — 연체 독촉·반납 후
// 재대여 등에서 여러 기록을 대여자별로 그룹핑할 때 쓴다. cfgw 소속은 이메일이 곧
// "{사번}@cfgw-kr.com" 형태라 사번까지 자동으로 구분되고, ConfigDS 소속은 등록된 계정
// 이메일로 구분된다. 이메일이 둘 다 있으면 같아야 같은 사람 — 이걸로 동명이인이 서로
// 섞이지 않는다. 한쪽이라도 비어 있으면(소속 "기타"이거나 옛 기록) 이름만으로 같은
// 사람으로 본다 — 알 수 없는 걸 다른 사람이라고 단정하지 않는다.
// (server/lib/borrowUtils.js의 sameBorrowerIdentity와 동일한 로직 — 프런트/백엔드가
// 번들을 공유하지 않아 그대로 복제했다.)
function sameBorrowerIdentity(nameA?: string, emailA?: string, nameB?: string, emailB?: string, employeeA?: string, employeeB?: string): boolean {
  const aid = String(employeeA || "").trim();
  const bid = String(employeeB || "").trim();
  if (aid && bid) return aid === bid;
  if (String(nameA || "").trim() !== String(nameB || "").trim()) return false;
  const a = String(emailA || "").trim().toLowerCase();
  const b = String(emailB || "").trim().toLowerCase();
  if (!a || !b) return true;
  return a === b;
}

// 동명이인을 화면에서 구분해주기 위한 짧은 식별 문구.
// cfgw는 이메일이 "{사번}@cfgw-kr.com" 형태라 사번을, ConfigDS는 계정 아이디를 보여준다.
function identityHint(email?: string): string {
  const e = String(email || "").trim();
  if (!e) return "";
  const m = e.match(/^(\d+)@cfgw-kr\.com$/i);
  return m ? `사번 ${m[1]}` : e.split("@")[0];
}

function escapePrintHtml(value?: string): string {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char] || char));
}

/** 휴대폰이 없는 대여자에게만 건네는 60×40mm 위치표. 브라우저 인쇄 대화상자를 연다. */
function printRequestLabelInBrowser(_requestNo: number, borrowerName: string, items: UnreturnedItem[]) {
  // 같은 물품이 여러 대여 행으로 나뉘어 있으면 라벨에는 한 줄로 합친다.
  // 사진처럼 plastic cup이 ×2, ×3으로 반복되면 공간만 낭비하므로 ×5 한 줄이 맞다.
  const merged = new Map<string, { name: string; variantName: string; location: string; quantity: number }>();
  for (const item of items.filter((entry) => entry.itemId || entry.itemLabel)) {
    const name = String(item.itemLabel || "물품")
      .replace(/^\[\d+\]\s*/, "")
      .replace(/\s*[x×]\s*\d+\s*$/i, "")
      .trim();
    const key = `${item.itemId || name}|${item.variantName || ""}|${item.location || ""}`;
    const previous = merged.get(key);
    if (previous) previous.quantity += item.quantity || 1;
    else merged.set(key, { name, variantName: item.variantName || "", location: item.location || "", quantity: item.quantity || 1 });
  }
  const printable = [...merged.values()];
  const ITEMS_PER_LABEL = 6;
  const pages = printable.length
    ? Array.from({ length: Math.ceil(printable.length / ITEMS_PER_LABEL) }, (_, index) => printable.slice(index * ITEMS_PER_LABEL, (index + 1) * ITEMS_PER_LABEL))
    : [[]];
  const pagesHtml = pages.map((pageItems, pageIndex) => {
    const fontPt = pageItems.length > 4 ? 7.6 : 9.2;
    const rows = pageItems.map((item) => {
      const variant = item.variantName ? ` · ${escapePrintHtml(item.variantName)}` : "";
      return `<div class="item"><b>${escapePrintHtml(item.name)}${variant}</b><span>×${item.quantity} · ${escapePrintHtml(item.location || "위치 미등록")}</span></div>`;
    }).join("");
    const pageMark = pages.length > 1 ? `<small>${pageIndex + 1}/${pages.length}</small>` : "";
    return `<section class="sheet"><div class="label"><div class="head"><div class="no">대여 물품 ${pageMark}</div><div class="person">${escapePrintHtml(borrowerName)}</div></div><div class="list" style="grid-template-rows:repeat(${Math.max(1, pageItems.length)},minmax(0,1fr));font-size:${fontPt}pt">${rows || '<div class="item">표시할 물품 없음</div>'}</div></div></section>`;
  }).join("");
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  if (!doc) { iframe.remove(); return; }
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>대여 물품</title><style>
    @page{size:60mm 40mm;margin:0}*{box-sizing:border-box}html,body{width:60mm;margin:0;padding:0;font-family:Arial,"Noto Sans KR",sans-serif;color:#000;writing-mode:horizontal-tb}
    @media print{html,body{width:60mm!important;margin:0!important;padding:0!important}.sheet{break-after:page}.sheet:last-child{break-after:auto}}
    .sheet{position:relative;width:60mm;height:40mm;margin:0;padding:0;overflow:hidden;break-after:page;page-break-after:always}
    .sheet:last-child{break-after:auto;page-break-after:auto}
    /* 실제 용지는 60×40mm 한 장으로 유지하고, 내용만 세로로 읽히도록 안쪽에서 회전한다.
       회전 뒤 점유 영역은 x=3~57mm, y=3~37mm라 라벨 경계를 넘지 않는다. */
    .label{position:absolute;left:3mm;top:37mm;width:34mm;height:54mm;padding:1mm;display:flex;flex-direction:column;transform-origin:top left;transform:rotate(-90deg)}
    .head{display:flex;align-items:flex-end;justify-content:space-between;border-bottom:.4mm solid #000;padding-bottom:1mm;margin-bottom:.8mm;line-height:1;flex:none}
    .no{font-size:11pt;font-weight:900;letter-spacing:.12mm}.no small{font-size:6pt;margin-left:.6mm}.person{max-width:20mm;font-size:7pt;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right}
    .list{flex:1;min-height:0;display:grid;grid-template-columns:1fr;line-height:1.08}
    .item{min-height:0;border-bottom:.15mm solid #bbb;padding:.5mm .2mm;display:flex;align-items:center;justify-content:space-between;gap:.8mm;overflow:hidden}
    .item b{min-width:0;overflow-wrap:anywhere}.item span{flex:none;white-space:nowrap;font-weight:800}
  </style></head><body>${pagesHtml}</body></html>`);
  doc.close();
  window.setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    window.setTimeout(() => iframe.remove(), 1500);
  }, 120);
}

/** 우분투 서버에 연결된 USB 라벨 프린터로 60×40mm 위치표를 직접 출력한다. */
async function printRequestLabel(requestNo: number): Promise<{ pages: number; itemTypes: number }> {
  const response = await fetch("/api/label-printer/print-request", {
    method: "POST",
    headers: adminHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ requestNo }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) throw new Error(data.error || "라벨 출력에 실패했습니다.");
  return { pages: Number(data.pages) || 1, itemTypes: Number(data.itemTypes) || 0 };
}

/** 사번 조회 전용 페이지로 연결되는 공용 QR 라벨을 출력한다. */
async function printLookupQrLabel(): Promise<void> {
  const response = await fetch("/api/label-printer/print-lookup-qr", {
    method: "POST",
    headers: adminHeaders(),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) throw new Error(data.error || "QR 라벨 출력에 실패했습니다.");
}

/** 말풍선 모양의 "SCAN ME" QR 스티커를 원하는 장수만큼 출력한다. */
async function printScanMeQrLabel(copies: number): Promise<number> {
  const response = await fetch("/api/label-printer/print-scan-me-qr", {
    method: "POST",
    headers: adminHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ copies }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) throw new Error(data.error || "SCAN ME QR 출력에 실패했습니다.");
  return Number(data.copies) || copies;
}

/** 프린터로 보낼 것과 같은 SCAN ME 라벨 이미지를 받아 화면용 object URL로 만든다. */
async function fetchScanMeQrPreview(): Promise<string> {
  const response = await fetch("/api/label-printer/scan-me-qr/preview", { headers: adminHeaders() });
  if (!response.ok) throw new Error("미리보기를 불러오지 못했습니다.");
  return URL.createObjectURL(await response.blob());
}

interface ReturnedPrintItem {
  id?: string;
  name: string;
  quantity: number;
  location: string;
  variantName?: string;
  employeeId?: string;
  borrowerName?: string;
}

async function printReturnedLocationLabel(items: ReturnedPrintItem[]): Promise<{ pages: number; itemTypes: number }> {
  const response = await fetch("/api/label-printer/print-returned-items", {
    method: "POST",
    headers: adminHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ items }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) throw new Error(data.error || "반납 위치표 출력에 실패했습니다.");
  return { pages: Number(data.pages) || 1, itemTypes: Number(data.itemTypes) || items.length };
}

interface Props {
  scriptUrl: string;
  connected: boolean;
  isLightMode: boolean;
  showToast: (msg: string, type: "ok" | "error" | "info" | "warn") => void;
  // COS 물품 처리(반납/소모/직접대여) 성공 시, "물품 관리" 화면이 쓰는 앱 전체 재고
  // 상태도 즉시 갱신되도록 알려준다. 안 주면(선택 prop) 이 화면 안의 목록만 갱신된다.
  onInventoryChanged?: () => void;
  /** 좁은 화면 여부. 좌우 두 칸을 나란히 놓을 수 없어 장바구니를 아래 시트로 돌린다. */
  isMobile?: boolean;
}

// 양도 받을 사람 — 명부에서 이름을 고르면 사번으로 동명이인을 구분한다.
interface TransferTarget {
  name: string;
  employeeId: string;
}

// 반납 장바구니 한 줄 = 특정 대여 행에서 몇 개를 반납할지
interface ReturnCartLine {
  key: string;                       // sheetType:rowIndex
  sheetType: "scenario" | "general" | "warehouse";
  rowIndex: number;                  // 창고 물품은 목록 순번(전송에는 쓰지 않는다)
  name?: string;                     // 창고 반납 전송용 품명
  borrower: string;
  email?: string;                     // 대여자 식별용(동명이인 구분) — 반납 후 재대여 그룹핑에 쓴다
  itemLabel: string;
  location: string;
  borrowDate?: string;                // 원래 대여 시각 — 반납 사진에 "누가 언제 빌렸는지" 남기는 용도
  max: number;                       // 이 행에서 반납 가능한 최대 수량
  qty: number;                       // 담은 수량
  // 시나리오/일반 물품 전용: 이 줄을 "대여 확인"으로 처리할지 "반납"으로 처리할지.
  // 담을 때 지금 보고 있는 화면(대여 확인/반납 처리)을 기본값으로 쓰지만, 줄마다 따로 바꿀 수 있다.
  action?: "확인" | "반납";
  // COS 물품 전용: 재고로 돌려놓을지(반납), 다 써서 재고에서 빼버릴지(소모).
  // 시나리오/일반 물품에는 해당 개념이 없어 항상 undefined.
  disposition?: "반납" | "소모";
  // 시나리오/일반 물품 전용: 담을 당시 실물 확인(픽업)이 이미 끝나 있었는지.
  // 없으면(대여 확인 취소) 실제로 물건이 나간 적이 없다는 뜻이라 반납 사진이 필요 없다.
  pickedUp?: string;
  // 신청자가 "종류 상관없음"으로 빌린 줄에서, 담당자가 실물을 보고 고른 종류.
  // 이 값이 서버로 넘어가는 순간 그 종류의 재고가 처음으로 차감된다.
  variantId?: number;
  // 반납은 되지만 파손되어 다시 쓸 수 없는 줄. 장바구니를 처리할 때 몇 개가 파손인지 묻고,
  // 이어서 불량 로그를 등록한다(그만큼 재고에서 다시 빠진다).
  damaged?: boolean;
  itemId?: string;   // 불량 로그에 남길 물품 ID
  employeeId?: string; // 반납 완료 뒤 위치표에 표시할 사번
  variantName?: string; // 탭을 옮긴 뒤에도 위치표에 종류를 유지한다
}

// 대여 확인 전에 "반납"으로 처리하는 줄은 실물이 나간 적이 없으므로 실제 반납이 아니라 취소다.
// 서버에는 기존 action 값을 유지해 보내되, 화면과 후속 작업에서는 명확히 구분한다.
function isCancellationLine(line: ReturnCartLine): boolean {
  return line.sheetType !== "warehouse" && line.action === "반납" && !line.pickedUp;
}

export default function AdminReturnPage({ scriptUrl, connected, isLightMode, showToast, onInventoryChanged, isMobile = false }: Props) {
  // 좁은 화면에서는 장바구니를 아래에서 올라오는 시트로 둔다. 평소에는 요약 막대만 보이고,
  // 눌러야 펼쳐진다 — 목록과 장바구니를 나란히 놓으면 둘 다 못 쓸 만큼 좁아진다.
  const [cartSheetOpen, setCartSheetOpen] = useState(false);
  const C = {
    bg: isLightMode ? "#f8fafc" : "#0b0f19",
    card: isLightMode ? "#ffffff" : "#161f30",
    cardSub: isLightMode ? "#f4f6f9" : "#0f172a",
    border: isLightMode ? "#e6e9ef" : "#26324a",
    text: isLightMode ? "#111827" : "#f1f5f9",
    label: isLightMode ? "#64748b" : "#94a3b8",
    accent: "#2563eb",
    accentSoft: isLightMode ? "rgba(37,99,235,0.09)" : "rgba(37,99,235,0.16)",
    accentText: isLightMode ? "#1d4ed8" : "#93c5fd",
    success: isLightMode ? "#047857" : "#34d399",
    successSoft: isLightMode ? "rgba(4,120,87,0.10)" : "rgba(52,211,153,0.14)",
    warn: isLightMode ? "#b45309" : "#fbbf24",
    warnSoft: isLightMode ? "rgba(180,83,9,0.10)" : "rgba(251,191,36,0.14)",
    error: isLightMode ? "#dc2626" : "#f87171",
    errorSoft: isLightMode ? "rgba(220,38,38,0.10)" : "rgba(248,113,113,0.14)",
  };

  // 지난번 목록을 먼저 그려 화면이 비어 보이지 않게 한다 (응답이 오면 교체)
  const CACHE_KEY = "wms_unreturned_v2"; // 시각·시프트 필드 추가로 버전 상향
  // 대여 확인 / 반납 처리 — 같은 장바구니·같은 A/P/O/B/C 키를 그대로 쓰고, R 키로 서로 전환한다.
  const [processMode, setProcessMode] = useState<"대여" | "반납">("대여");

  // 분야: 시나리오·일반 / COS 물품 — 반납 처리 방식이 서로 달라 탭으로 나눈다.
  // (대여 확인은 SID·일반 대여에만 해당하므로, 대여 모드에서는 "scenario"로 고정한다)
  const [category, setCategory] = useState<"scenario" | "warehouse">("scenario");
  const [whItems, setWhItems] = useState<UnreturnedItem[]>([]);
  const [whLoaded, setWhLoaded] = useState(false);
  const [whLoading, setWhLoading] = useState(false);

  const [items, setItems] = useState<UnreturnedItem[]>(() => {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed as UnreturnedItem[];
      }
    } catch (e) { /* 무시 */ }
    return [];
  });
  const [loading, setLoading] = useState(false);
  const [printingRequestNo, setPrintingRequestNo] = useState<number | null>(null);
  const [printingLookupQr, setPrintingLookupQr] = useState(false);
  // QR 인쇄 버튼 → 사번 조회 QR / SCAN ME QR 중 하나를 고르는 모달
  const [qrPickerOpen, setQrPickerOpen] = useState(false);
  const qrPickerOpenRef = useRef(false);
  qrPickerOpenRef.current = qrPickerOpen;
  const [printingScanMe, setPrintingScanMe] = useState(false);
  const [scanMeCopies, setScanMeCopies] = useState(1);
  const [scanMePreview, setScanMePreview] = useState<string | null>(null);
  const [printingReturned, setPrintingReturned] = useState(false);
  const [lastReturnedPrint, setLastReturnedPrint] = useState<ReturnedPrintItem[]>(() => {
    try {
      const saved = sessionStorage.getItem("wms_last_return_print");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  const rememberReturnedPrint = useCallback((next: ReturnedPrintItem[]) => {
    setLastReturnedPrint(next);
    try { sessionStorage.setItem("wms_last_return_print", JSON.stringify(next)); } catch { /* 저장소 접근 불가 */ }
  }, []);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  // 이름만으로는 동명이인을 구분할 수 없어 이메일까지 같이 들고 다닌다.
  const [selectedBorrower, setSelectedBorrower] = useState<{ name: string; email: string; employeeId: string } | null>(null);
  const [cart, setCart] = useState<ReturnCartLine[]>([]);
  // 현재 선택 위치(하이라이트). A는 이 위치를 담고, ↑/↓로 위치만 옮길 수 있다.
  const [cursor, setCursor] = useState(0);
  // A를 한 번 누르면 사진을 먼저 보여주고, 다시 누르면 담는다 (엉뚱한 물품을 담는 실수 방지)
  const [preview, setPreview] = useState<{ key: string; item: UnreturnedItem } | null>(null);
  // 한 번의 처리를 끝낼 때 일부러 제외해 남긴 줄. 다음 A가 목록 처음으로 돌아가 이 줄을
  // 자동 선택하면 제외 의도가 무효가 되므로, 해당 줄을 직접 클릭하기 전까지 A로 열지 않는다.
  const manualPickRequiredRef = useRef<Set<string>>(new Set());
  // 전역 키 이벤트는 한 번만 등록하므로, 지금 미리보기 모달이 열렸는지는 ref로 읽는다.
  const previewRef = useRef<typeof preview>(null);
  previewRef.current = preview;
  // 여러 건이 동시에 백그라운드로 처리될 수 있어, 단일 boolean 대신 진행 중인 작업 목록으로 관리한다.
  const [pendingJobs, setPendingJobs] = useState<{ id: number; label: string }[]>([]);
  const jobIdRef = useRef(0);
  // 반납 후 재대여 기능은 제거했다. 양도 흐름과 공용 처리 코드는 유지하되 항상 꺼진 값만 쓴다.
  const reborrowAfter = false;
  // 양도: 반납 처리한 물품을 원래 대여자가 아닌 "다른 사람" 명의로 곧바로 다시 대여한다.
  // 재대여와 처리 흐름은 같고(반납 → 재대여), 받는 사람만 달라진다. 둘은 동시에 켤 수 없다.
  // 소속·사번을 같이 받는 이유: 동명이인이 있어도 올바른 대여자로 식별하려면
  // 이름만으로는 부족하고 이메일(= 사번/등록계정)까지 확정돼야 한다.
  const [transferMode, setTransferMode] = useState(false);
  const [transferTarget, setTransferTarget] = useState<TransferTarget>({ name: "", employeeId: "" });
  // 담은 순서를 기억해 C 키로 하나씩 되돌린다
  const addHistoryRef = useRef<string[]>([]);
  // 장바구니 처리 확인 모달 상태 (window.confirm 대신 인앱 모달로 안정적 처리)
  type DamagePayload = {
    items: { itemId: string; itemName: string; qty: number; variantId?: number; noStock?: boolean; keepBorrowed?: boolean;
             rentalSheetType?: "scenario" | "general"; rentalRowIndex?: number }[];
    defectType: string; note: string; actionTaken: string; culprit: string; photo: string;
  };
  const [confirmBatch, setConfirmBatch] = useState<{ parts: string[]; batch: ReturnCartLine[]; reborrow: boolean; transfer: TransferTarget | null; damage?: DamagePayload } | null>(null);

  // 파손 반납 입력 단계. "수량 → 불량 로그" 두 단계를 거친 뒤 원래 확인 모달로 넘어간다.
  const [damageFlow, setDamageFlow] = useState<{
    batch: ReturnCartLine[]; reborrow: boolean; transfer: TransferTarget | null;
    step: "qty" | "form";
    // keepBorrowed: 파손품은 폐기하고 대체품을 그대로 들고 가는 경우 — 그 수량만 대여중으로 남는다.
    lines: {
      key: string; label: string; max: number; qty: number; itemId: string; itemName: string;
      variantId?: number; noStock?: boolean; keepBorrowed?: boolean;
      sheetType: "scenario" | "general"; rowIndex: number;
      // 교체로 새로 나가는 물건의 종류. 종류가 나뉜 물품이면 반드시 골라야 한다 —
      // 원본과 다른 종류를 내주는 일이 흔해서 대여 줄의 종류도 이걸로 갱신한다.
      variants: { id: number; name: string; stock: number }[];
      replacementVariantId?: number;
    }[];
    defectType: string; note: string; actionTaken: string; culprit: string; photo: string;
  } | null>(null);
  // "종류 상관없음"으로 신청된 줄의 종류를 담당자가 고르는 단계. 여기서 고른 종류가
  // 확인 처리와 함께 서버로 넘어가고, 그 순간 해당 종류의 재고가 차감된다.
  const [variantPrompt, setVariantPrompt] = useState<{
    batch: ReturnCartLine[];
    reborrow: boolean;
    transfer: TransferTarget | null;
    lines: { key: string; label: string; qty: number; kind: "반납" | "확인"; variants: { id: number; name: string; stock: number }[] }[];
    choice: Record<string, number>;
  } | null>(null);
  // 반납 증빙 사진 — 처리 묶음에 실제 반납(공구 소모 포함)이 섞여 있으면 필수로 한 장 찍어야 한다.
  // 반납 데스크 PC/노트북마다 웹캠을 물릴 필요 없이, 미니 PC(반납 데스크 옆)에 꽂힌 웹캠을
  // 서버가 실시간 MJPEG 스트림(/api/camera/stream)으로 내려준다 — 브라우저 로컬 카메라
  // (getUserMedia)는 쓰지 않는다. <img>가 스트림을 계속 표시하다가 "촬영"을 누르면
  // 그 순간 화면에 떠 있는 프레임을 캔버스로 그대로 캡처한다 (추가 요청 없이 즉시 잠김).
  const [confirmPhoto, setConfirmPhoto] = useState<string>("");
  const [streamUrl, setStreamUrl] = useState<string>("");
  const [cameraAttempt, setCameraAttempt] = useState(0);
  const streamImgRef = useRef<HTMLImageElement | null>(null);
  const cameraConnectSeqRef = useRef(0);
  const cameraAutoRefreshRef = useRef(0);

  const detachCameraImage = useCallback(() => {
    const img = streamImgRef.current;
    if (!img) return;
    img.src = "";
    img.removeAttribute("src");
  }, []);

  /** 현재 미리보기 요청을 완전히 무효화한다. 늦게 끝난 주소 탐색이나 이미지 이벤트도
   * 다음 촬영 세션의 상태를 덮어쓰지 못하도록 연결 순번을 함께 올린다. */
  const closeCameraStream = useCallback(() => {
    cameraConnectSeqRef.current += 1;
    detachCameraImage();
    setStreamUrl("");
    setStreamReady(false);
    releaseCameraStream();
  }, [detachCameraImage]);

  /** 카메라 미리보기를 연다. 스트림은 끝나지 않는 응답이라 브라우저 연결 한도를 잡아먹으므로,
   *  한 브라우저에 하나만 두고(다른 탭이 보고 있으면 그쪽이 놓는다) 앱과 다른 오리진에서 받는다. */
  const openCameraStream = useCallback((forceRefresh = false) => {
    const seq = ++cameraConnectSeqRef.current;
    detachCameraImage();
    releaseCameraStream();
    if (forceRefresh) resetCameraBase();
    setStreamReady(false);
    setCameraError("");
    setCameraAttempt((n) => n + 1);
    claimCameraStream(() => {
      if (cameraConnectSeqRef.current !== seq) return;
      detachCameraImage();
      setStreamUrl("");
      setStreamReady(false);
    });
    cameraUrl(`/api/camera/stream?t=${Date.now()}`)
      .then((url) => { if (cameraConnectSeqRef.current === seq) setStreamUrl(url); })
      .catch(() => {
        if (cameraConnectSeqRef.current !== seq) return;
        releaseCameraStream();
        setCameraError("카메라 서버에 연결하지 못했습니다.");
      });
  }, [detachCameraImage]);

  // 카메라 전용 포트로 못 열면 딱 한 번 예전 방식(같은 오리진)으로 되돌려 다시 시도한다.
  const camRetriedRef = useRef(false);
  const onStreamError = useCallback(() => {
    if (!camRetriedRef.current) {
      camRetriedRef.current = true;
      fallbackToSameOrigin();
      setStreamUrl(`/api/camera/stream?t=${Date.now()}`);
      return;
    }
    setCameraError("카메라 스트림을 불러오지 못했습니다. 웹캠 연결을 확인해주세요.");
  }, []);
  const [streamReady, setStreamReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [photoSaving, setPhotoSaving] = useState(false);
  // 업로드가 길어질 때 "멈춘 건지 진행 중인지"를 사람이 알 수 있게 경과 초를 센다.
  const [photoElapsed, setPhotoElapsed] = useState(0);
  // 업로드가 끝내 실패했을 때의 안내. 이 값이 있으면 확인창에 "다시 시도"가 뜬다.
  const [photoFailed, setPhotoFailed] = useState("");
  // 이 사진 한 장의 저장 시도에 붙는 이름표. 다시 시도해도 같은 값을 보내야
  // 서버가 "이미 저장된 시도"로 알아보고 사진을 두 번 남기지 않는다.
  const photoAttemptIdRef = useRef("");

  const restartCameraServerAndStream = useCallback(async () => {
    closeCameraStream();
    camRetriedRef.current = false;
    cameraAutoRefreshRef.current = 0;
    setCameraError("");
    try {
      await restartCameraCapture();
      openCameraStream(true);
    } catch (e: any) {
      setCameraError(e?.message || "카메라 프로세스를 재시작하지 못했습니다.");
    }
  }, [closeCameraStream, openCameraStream]);

  const load = useCallback(async (silent = false) => {
    if (!connected || !scriptUrl) { setLoaded(true); return; }
    if (!silent) setLoading(true);
    try {
      // 수동으로 새로고침 버튼을 눌렀을 때(silent=false)는 서버 캐시를 무시하고 DB를 다시 읽는다.
      // 자동 새로고침(silent=true)까지 매번 무시하면 DB를 너무 자주 통째로 읽게 되니,
      // 그건 기존처럼 캐시를 쓴다.
      const list = await fetchUnreturnedItems(scriptUrl, !silent);
      setItems(list);
      setLoaded(true);
      try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(list)); } catch (e) { /* 무시 */ }
    } catch (e: any) {
      // 자동 새로고침(silent)이 실패한 건 사용자가 한 일이 아니고, 화면에는 이미 직전
      // 목록이 그대로 남아 있다. 이때까지 빨간 오류를 띄우면 작업만 방해하므로 조용히 넘긴다.
      // (다음 주기에 다시 시도한다) 직접 새로고침을 눌렀을 때만 알린다.
      if (!silent) showToast(`미반납 목록을 불러오지 못했습니다: ${e.message}`, "error");
      // 실패해도 "시도는 끝났다"고 표시해야 재요청이 무한 반복되지 않는다.
      setLoaded(true);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [connected, scriptUrl]);

  useEffect(() => { load(); }, [load]);

  // COS 물품 미반납 목록 (탭을 처음 열 때 불러온다)
  const loadWarehouse = useCallback(async (silent = false) => {
    if (!connected || !scriptUrl) { setWhLoaded(true); return; }
    if (!silent) setWhLoading(true);
    try {
      const list = await fetchWarehouseBorrowedItems(scriptUrl, "");
      // 창고 목록은 행 번호가 없으므로 순번을 부여해 화면 키로만 쓴다
      setWhItems(list.map((it: any, i: number) => ({ ...it, sheetType: "warehouse", rowIndex: i + 1 })) as UnreturnedItem[]);
      setWhLoaded(true);
    } catch (e: any) {
      showToast(`COS 물품 미반납 목록을 불러오지 못했습니다: ${e.message}`, "error");
      // 실패해도 "시도는 끝났다"고 표시한다. 안 그러면 아래 useEffect가 계속 재요청해
      // 무한 로딩에 빠진다 (모바일 시나리오 목록에서 같은 문제가 있었다).
      setWhLoaded(true);
    } finally {
      if (!silent) setWhLoading(false);
    }
  }, [connected, scriptUrl]);

  useEffect(() => {
    if (category === "warehouse" && !whLoaded && !whLoading) loadWarehouse();
  }, [category, whLoaded, whLoading, loadWarehouse]);

  // COS 물품은 관리자 확인 대기 절차를 쓰지 않고 별도 "대여 신청"에서 바로
  // 대여 처리한다. 대여 확인 탭으로 바꾸면 시나리오 물품만 보이도록 고정한다.
  useEffect(() => {
    if (processMode === "대여" && category !== "scenario") setCategory("scenario");
  }, [processMode, category]);

  // 대여/반납 모드나 분야를 바꾸면 검색어·선택은 초기화하지만, 장바구니는 그대로 둔다.
  // (반납 처리 중에도 다른 물품을 대여 확인하거나 반납할 수 있어야 하므로, 모드/분야 전환이
  //  더 이상 장바구니를 막거나 비우지 않는다 — 처리 자체는 제출할 때 줄마다 따로 나뉜다)
  useEffect(() => {
    setSearch("");
    setSelectedBorrower(null);
    setCursor(0);
    setPreview(null);
  }, [category, processMode]);

  const activeSource = useMemo(() => {
    const base = category === "warehouse" ? whItems : items;
    // 목록은 탭마다 서로 겹치지 않게 나눠 보여준다 (섞여 보이면 헷갈린다는 피드백을 반영).
    // COS 물품은 "확인" 개념 자체가 없어서(대여 즉시 확정) 걸러내지 않는다.
    if (category === "warehouse") return base;
    return processMode === "대여" ? base.filter((it) => !it.pickedUp) : base.filter((it) => !!it.pickedUp);
  }, [category, processMode, whItems, items]);
  const activeLoaded = category === "warehouse" ? whLoaded : loaded;
  const activeLoading = category === "warehouse" ? whLoading : loading;
  const reloadActive = (silent = false) => (category === "warehouse" ? loadWarehouse(silent) : load(silent));

  // 15초마다 자동 새로고침.
  // (예전 GAS/구글시트 백엔드 시절엔 여러 명이 동시에 켜두면 시간당 수천 번의 무거운 조회가 나가
  //  구글이 응답 대신 오류 페이지를 돌려보내서 2분으로 늘렸었는데, 지금은 로컬 Node/SQLite
  //  백엔드라 그런 rate-limit이 없다 — 다시 짧게 되돌려도 된다)
  // 다른 관리자가 처리한 내용이 바로 반영되도록 하되, 담아둔 장바구니와 선택은 유지한다.
  const submittingRef = useRef(false);
  // 사진 업로드 중에도 건너뛴다. 업로드는 pendingJobs가 잡히기 "전" 단계라 예전에는 이 구간에
  // 15초 폴링(미반납 목록 224KB)이 그대로 끼어들었다 — 앱은 동시 요청을 3개로 제한하므로
  // 그 사이 업로드가 큐에서 밀려 "업로드 중 멈춘 것처럼" 보이는 원인이 됐다.
  submittingRef.current = pendingJobs.length > 0 || photoSaving;
  useEffect(() => {
    if (!connected || !scriptUrl) return;
    const timer = window.setInterval(() => {
      if (submittingRef.current) return;      // 처리 중에는 건너뛴다
      if (document.hidden) return;            // 다른 탭을 보고 있으면 굳이 부르지 않는다
      reloadActive(true);                     // 조용히 갱신 (로딩 표시 없음)
    }, 15000);

    // 다른 탭을 보다 돌아오면 즉시 한 번 최신화한다.
    // 이러면 주기를 길게 잡아도, 실제로 화면을 보는 순간의 최신성은 유지된다.
    const onVisible = () => {
      if (document.hidden || submittingRef.current) return;
      reloadActive(true);
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [connected, scriptUrl, load]);

  // 자동 새로고침으로 사라진 행(다른 사람이 먼저 반납한 경우)은 장바구니에서 정리한다.
  useEffect(() => {
    if (!activeLoaded || !cart.length) return;
    const alive = new Map(activeSource.map((it) => [`${it.sheetType}:${it.rowIndex}`, it.quantity || 1]));
    let changed = false;
    const next = cart
      .map((c) => {
        const max = alive.get(c.key);
        if (max === undefined) { changed = true; return null; }   // 이미 반납됨
        if (c.qty > max) { changed = true; return { ...c, qty: max, max }; }
        if (c.max !== max) { changed = true; return { ...c, max }; }
        return c;
      })
      .filter(Boolean) as ReturnCartLine[];
    if (changed) {
      setCart(next);
      addHistoryRef.current = addHistoryRef.current.filter((k) => alive.has(k));
      showToast("다른 곳에서 처리된 항목이 있어 장바구니를 갱신했습니다.", "info");
    }
  }, [activeSource, activeLoaded]);

  // 대여자별로 묶는다 — 이름만으로 묶으면 동명이인의 물품이 한 카드에 섞여, 남의 물품을
  // 반납 처리해버릴 수 있다. 이메일(= cfgw 사번 / ConfigDS 등록계정)까지 같아야 같은 사람으로 본다.
  // COS 물품 대여 로그에는 이메일이 없어서, 그쪽은 예전처럼 이름만으로 묶인다.
  const borrowers = useMemo(() => {
    const list: { name: string; email: string; employeeId: string; items: UnreturnedItem[]; qty: number; seats: string[] }[] = [];
    activeSource.forEach((it) => {
      const name = String(it.borrowerName || "").trim() || "(이름 없음)";
      const email = String(it.email || "");
      let g = list.find((x) => sameBorrowerIdentity(x.name, x.email, name, email, x.employeeId, it.employeeId));
      if (!g) { g = { name, email, employeeId: it.employeeId || "", items: [], qty: 0, seats: [] }; list.push(g); }
      if (!g.email && email) g.email = email;
      if (!g.employeeId && it.employeeId) g.employeeId = it.employeeId;
      g.items.push(it);
      g.qty += it.quantity || 1;
      const seat = [it.floor, it.unit].filter(Boolean).join(" · ");
      if (seat && !g.seats.includes(seat)) g.seats.push(seat);
    });
    const q = search.trim();
    return (q
      ? list.filter((g) => smartMatch([g.name, g.email, g.employeeId, ...g.items.map((i) => i.itemLabel)], q))
      : list
    ).sort((a, b) => {
      if (processMode === "반납" && category === "scenario") {
        const aExempt = a.items.some((item) => item.typeLimitExempt);
        const bExempt = b.items.some((item) => item.typeLimitExempt);
        if (aExempt !== bExempt) return aExempt ? 1 : -1;
      }
      return b.qty - a.qty || a.name.localeCompare(b.name);
    });
  }, [activeSource, search, processMode, category]);

  // 같은 이름이 둘 이상 잡혔을 때만 카드에 사번/계정을 함께 띄워 구분할 수 있게 한다.
  const duplicatedNames = useMemo(() => {
    const count = new Map<string, number>();
    borrowers.forEach((b) => count.set(b.name, (count.get(b.name) || 0) + 1));
    return new Set(Array.from(count.entries()).filter(([, n]) => n > 1).map(([n]) => n));
  }, [borrowers]);

  const activeItems = useMemo(() => {
    if (!selectedBorrower) return [];
    return activeSource
      .filter((it) => sameBorrowerIdentity(
        String(it.borrowerName || "").trim() || "(이름 없음)", String(it.email || ""),
        selectedBorrower.name, selectedBorrower.email, it.employeeId, selectedBorrower.employeeId
      ))
      .sort((a, b) => String(a.location || "").localeCompare(String(b.location || "")));
  }, [activeSource, selectedBorrower]);


  /* ── COS 물품 직접 대여 (관리자가 대신 처리) ── */
  const [whLendOpen, setWhLendOpen] = useState(false);
  const [whCatalog, setWhCatalog] = useState<WarehouseItem[]>([]);
  const [whLendName, setWhLendName] = useState("");
  const [whLendEmployeeId, setWhLendEmployeeId] = useState("");
  const [whLendSearch, setWhLendSearch] = useState("");
  const [whLendNote, setWhLendNote] = useState("");
  const [whLendCart, setWhLendCart] = useState<{ rowIndex: number; location: string; name: string; quantity: number; stock: number }[]>([]);
  const [whLendSubmitting, setWhLendSubmitting] = useState(false);

  async function openWhLend() {
    setWhLendOpen(true);
    setWhLendCart([]);
    setWhLendName("");
    setWhLendEmployeeId("");
    setWhLendSearch("");
    setWhLendNote("");
    if (!whCatalog.length && connected && scriptUrl) {
      try {
        setWhCatalog(await fetchWarehouseInventory(scriptUrl));
      } catch (e: any) {
        showToast(`COS 물품 목록을 불러오지 못했습니다: ${e.message}`, "error");
      }
    }
  }

  function addWhLend(it: WarehouseItem) {
    const stock = Number(it.stock);
    const cap = isNaN(stock) ? 999 : stock;
    if (cap <= 0) { showToast("재고가 없는 물품입니다.", "warn"); return; }
    setWhLendCart((prev) => {
      const i = prev.findIndex((c) => c.rowIndex === it.rowIndex);
      if (i === -1) return [...prev, { rowIndex: it.rowIndex, location: it.location, name: it.name, quantity: 1, stock: cap }];
      if (prev[i].quantity >= cap) return prev;
      return prev.map((c, idx) => (idx === i ? { ...c, quantity: c.quantity + 1 } : c));
    });
  }

  async function submitWhLend() {
    if (!/^\d{4}$/.test(whLendEmployeeId)) { showToast("등록 명부에서 대여자를 선택해주세요.", "warn"); return; }
    if (!whLendCart.length) { showToast("대여할 물품을 담아주세요.", "warn"); return; }
    setWhLendSubmitting(true);
    try {
      const res = await postWarehouseRentBulk(
        scriptUrl,
        whLendCart.map((c) => ({
          type: "대여" as const,
          location: c.location,
          name: c.name,
          qty: c.quantity,
          user: whLendName.trim(),
          employeeId: whLendEmployeeId,
          note: whLendNote.trim() || "관리자 직접 대여",
        }))
      );
      if (!res.success) { showToast(res.error || "대여 처리 실패", "error"); return; }
      showToast(`${whLendName.trim()}님에게 ${whLendCart.reduce((n, c) => n + c.quantity, 0)}개를 대여했습니다.`, "ok");
      setWhLendOpen(false);
      setWhLendCart([]);
      loadWarehouse(true);
      onInventoryChanged?.(); // 재고가 줄었으니 "물품 관리" 화면 데이터도 즉시 갱신
    } catch (e: any) {
      showToast(`대여 처리 실패: ${e.message}`, "error");
    } finally {
      setWhLendSubmitting(false);
    }
  }

  /* ── 물품 교체 (반납하면서 다른 오브젝트로 대체) ── */
  const [swapTarget, setSwapTarget] = useState<UnreturnedItem | null>(null);
  const [swapItemId, setSwapItemId] = useState("");
  // 교체할 물품이 종류로 나뉘어 있으면 어느 종류로 나갈지도 정해야 한다.
  const [swapVariant, setSwapVariant] = useState<{ id: number; name: string; stock: number } | null>(null);
  const [swapVariantPick, setSwapVariantPick] = useState<ScenarioObjectAdmin | null>(null);
  const [swapQty, setSwapQty] = useState(1);
  const [swapSearch, setSwapSearch] = useState("");
  const [swapReason, setSwapReason] = useState("");
  const [swapping, setSwapping] = useState(false);

  async function openSwap(it: UnreturnedItem) {
    setSwapTarget(it);
    setSwapItemId("");
    setSwapVariant(null);
    setSwapQty(it.quantity || 1);
    setSwapSearch("");
    setSwapReason("");
    if (!lendCatalog.length && connected && scriptUrl) {
      try {
        setLendCatalog(await fetchScenarioObjectsForAdmin(scriptUrl));
      } catch (e: any) {
        showToast(`물품 목록을 불러오지 못했습니다: ${e.message}`, "error");
      }
    }
  }

  async function submitSwap() {
    if (!swapTarget) return;
    if (!swapItemId) { showToast("교체할 물품을 선택해주세요.", "warn"); return; }
    setSwapping(true);
    try {
      const ver = await fetchBorrowAppVersion(scriptUrl).catch(() => "");
      const res = await postSwapBorrowItem(scriptUrl, {
        sheetType: swapTarget.sheetType as "scenario" | "general",
        rowIndex: swapTarget.rowIndex,
        newItemId: swapItemId,
        newQuantity: swapQty,
        reason: swapReason.trim(),
        newVariantId: swapVariant?.id,
      }, ver);
      if (!res.success && isVersionMismatchMessage(res.message)) { signalVersionOutdated(); return; }
      if (!res.success) { showToast(res.message || "물품 교체 실패", "error"); return; }
      showToast(res.message || "물품을 교체했습니다.", "ok");
      setSwapTarget(null);
      // 교체된 행은 반납 처리되므로 담아둔 장바구니에서도 정리한다
      const key = `${swapTarget.sheetType}:${swapTarget.rowIndex}`;
      setCart((prev) => prev.filter((c) => c.key !== key));
      addHistoryRef.current = addHistoryRef.current.filter((k) => k !== key);
      await load();
    } catch (e: any) {
      showToast(`물품 교체 실패: ${e.message}`, "error");
    } finally {
      setSwapping(false);
    }
  }

  /* ── 추가 대여 (반납하러 온 김에 더 빌려가는 경우) ── */
  const [lendTarget, setLendTarget] = useState<{ name: string; email: string; floor?: string; unit?: string } | null>(null);

  // ── 자리 바꾸기 ────────────────────────────────────────────
  // 대여할 때 찍힌 자리가 그 뒤 실제와 어긋나는 일이 있다(자리를 옮긴 경우).
  // 이름을 오른쪽 클릭하면 그 사람의 미반납 기록들의 자리를 한꺼번에 고칠 수 있게 한다.
  const [seatMap, setSeatMap] = useState<SeatMap>({ floors: [] });
  const [seatEdit, setSeatEdit] = useState<{
    name: string;
    rows: { sheetType: "scenario" | "general"; rowIndex: number }[];
    floor: string;
    unit: string;
  } | null>(null);
  const [seatSaving, setSeatSaving] = useState(false);

  useEffect(() => {
    if (!connected || !scriptUrl) return;
    fetchSeatMap(scriptUrl).then(setSeatMap).catch(() => { /* 좌석배치도는 보조 정보 — 실패해도 화면은 돈다 */ });
  }, [connected, scriptUrl]);

  /** 이름을 오른쪽 클릭했을 때. 그 사람의 미반납 줄 중 자리를 가진 것(시나리오/일반)만 대상이다. */
  const openSeatEdit = (g: { name: string; items: UnreturnedItem[] }) => {
    const rows = g.items
      .filter((it) => it.sheetType === "scenario" || it.sheetType === "general")
      .map((it) => ({ sheetType: it.sheetType as "scenario" | "general", rowIndex: it.rowIndex }));
    if (!rows.length) {
      showToast("이 목록에는 자리 정보를 가진 대여 기록이 없습니다.", "warn");
      return;
    }
    const first = g.items.find((it) => it.floor || it.unit);
    setSeatEdit({ name: g.name, rows, floor: first?.floor || "", unit: first?.unit || "" });
  };

  const saveSeat = async () => {
    if (!seatEdit) return;
    setSeatSaving(true);
    try {
      const res = await postUpdateBorrowerSeat(scriptUrl, seatEdit.rows, seatEdit.floor, seatEdit.unit);
      if (!res?.success) { showToast(res?.message || "자리를 바꾸지 못했습니다.", "error"); return; }
      showToast(res.message || "자리를 바꿨습니다.", "ok");
      setSeatEdit(null);
      reloadActive(true);
    } catch (e: any) {
      showToast("자리 변경 실패: " + e.message, "error");
    } finally {
      setSeatSaving(false);
    }
  };

  // 반납 없이 오래 보관되는 request 물품처럼, 종류 수 한도 계산에서 건별로 빼고 넣는다.
  const [savingTypeLimitExemptKey, setSavingTypeLimitExemptKey] = useState<string | null>(null);
  const [typeLimitExemptEdit, setTypeLimitExemptEdit] = useState<{ item: UnreturnedItem; reason: string } | null>(null);
  const saveTypeLimitExempt = async (exempt: boolean) => {
    if (!typeLimitExemptEdit) return;
    const it = typeLimitExemptEdit.item;
    const reason = typeLimitExemptEdit.reason.trim();
    if (exempt && !reason) {
      showToast("한도 제외 사유를 입력해주세요.", "warn");
      return;
    }
    const key = `${it.sheetType}-${it.rowIndex}`;
    setSavingTypeLimitExemptKey(key);
    try {
      const res = await postSetTypeLimitExempt(scriptUrl, it.sheetType as "scenario" | "general", it.rowIndex, exempt, reason);
      if (!res?.success) { showToast(res?.message || "설정을 바꾸지 못했습니다.", "error"); return; }
      showToast(res.message || "설정을 바꿨습니다.", "ok");
      setTypeLimitExemptEdit(null);
      reloadActive(true);
    } catch (e: any) {
      showToast("설정 변경 실패: " + e.message, "error");
    } finally {
      setSavingTypeLimitExemptKey(null);
    }
  };
  const [lendCatalog, setLendCatalog] = useState<ScenarioObjectAdmin[]>([]);
  const [lendSearch, setLendSearch] = useState("");
  const [lendCart, setLendCart] = useState<{ id: string; name: string; quantity: number; stock: number; variantId?: number; variantName?: string }[]>([]);
  // 종류가 나뉜 물품을 추가 대여할 때 사진을 보고 고르는 모달
  const [lendVariantPick, setLendVariantPick] = useState<ScenarioObjectAdmin | null>(null);
  const [lendSubmitting, setLendSubmitting] = useState(false);
  // 깨질 위험/화재 위험/특정 업체 request용 물품이 대여 목록에 있을 때, 제출 직전 확인 모달
  const [hazardModal, setHazardModal] = useState<{ items: { id: string; name: string; fragile?: boolean; fireRisk?: boolean; requestFor?: string; personalOwner?: string }[]; onConfirm: () => void } | null>(null);
  useVersionWorkGuard(
    "admin-return-work",
    cart.length > 0 || pendingJobs.length > 0 || photoSaving || whLendSubmitting || lendSubmitting || lendCart.length > 0
      || !!confirmBatch || !!damageFlow || !!variantPrompt,
    pendingJobs.length > 0 || photoSaving ? "대여·반납 처리 중" : "대여·반납 작업 작성 중",
  );

  async function openLend(g: { name: string; email?: string; items: UnreturnedItem[] }) {
    const first = g.items[0];
    setLendTarget({
      name: g.name,
      // 그룹이 이미 확정해둔 이메일을 우선 쓴다(첫 물품에만 비어 있는 경우 대비).
      // 동명이인이면 엉뚱한 사람으로 처리될 수 있으므로 정확히 식별한다.
      email: String(g.email || first?.email || ""),
      floor: first?.floor,
      unit: first?.unit,
    });
    setLendCart([]);
    setLendSearch("");
    if (!lendCatalog.length && connected && scriptUrl) {
      try {
        setLendCatalog(await fetchScenarioObjectsForAdmin(scriptUrl));
      } catch (e: any) {
        showToast(`물품 목록을 불러오지 못했습니다: ${e.message}`, "error");
      }
    }
  }

  const lendFiltered = useMemo(() => {
    const q = lendSearch.trim();
    const base = q ? lendCatalog.filter((it) => smartMatch([it.name, it.id, it.rootSlot], q)) : lendCatalog;
    return base.slice(0, 60);
  }, [lendCatalog, lendSearch]);

  // 같은 물품이라도 종류가 다르면 장바구니에서 다른 줄로 관리한다.
  const lendKey = (c: { id: string; variantId?: number }) => `${c.id}::${c.variantId ?? ""}`;

  function addLend(it: ScenarioObjectAdmin) {
    const stock = Number(it.stock) || 0;
    if (stock <= 0) { showToast("재고가 없는 물품입니다.", "warn"); return; }
    // 종류가 나뉜 물품은 어느 종류인지 정해야 재고를 뺄 수 있다 — 먼저 고르게 한다.
    if (it.variants?.length) { setLendVariantPick(it); return; }
    setLendCart((prev) => {
      const i = prev.findIndex((c) => lendKey(c) === lendKey({ id: it.id }));
      if (i === -1) return [...prev, { id: it.id, name: it.name, quantity: 1, stock }];
      if (prev[i].quantity >= stock) return prev;
      return prev.map((c, idx) => (idx === i ? { ...c, quantity: c.quantity + 1 } : c));
    });
  }

  // 종류를 고른 뒤 담는다. 상한은 그 종류의 재고.
  function addLendVariant(it: ScenarioObjectAdmin, v: { id: number; name: string; stock: number }) {
    if (v.stock <= 0) { showToast(`'${v.name}' 종류는 재고가 없습니다.`, "warn"); return; }
    setLendCart((prev) => {
      const key = `${it.id}::${v.id}`;
      const i = prev.findIndex((c) => lendKey(c) === key);
      if (i === -1) return [...prev, { id: it.id, name: it.name, quantity: 1, stock: v.stock, variantId: v.id, variantName: v.name }];
      if (prev[i].quantity >= v.stock) return prev;
      return prev.map((c, idx) => (idx === i ? { ...c, quantity: c.quantity + 1 } : c));
    });
    setLendVariantPick(null);
  }

  async function doSubmitLend() {
    if (!lendTarget || !lendCart.length) { showToast("대여할 물품을 담아주세요.", "warn"); return; }
    setLendSubmitting(true);
    try {
      const ver = await fetchBorrowAppVersion(scriptUrl).catch(() => "");
      // 이메일에서 소속과 사번을 되짚는다 (cfgw-kr은 사번@cfgw-kr.com)
      const email = lendTarget.email;
      const isCfgw = /@cfgw-kr\.com$/i.test(email);
      const res = await postRecordBorrow(scriptUrl, [{
        itemType: "general",
        borrowerName: lendTarget.name,
        affiliation: isCfgw ? "cfgw" : (email ? "configds" : "other"),
        employeeId: isCfgw ? email.split("@")[0] : "",
        knownEmail: email || undefined,
        borrowDate: nowString(),
        borrowPurpose: "반납 처리 중 추가 대여",
        borrowedItems: lendCart.map((c) => ({ id: c.id, name: c.name, quantity: c.quantity, variantId: c.variantId })),
        generalOption: "추가 물품 대여",
        floor: lendTarget.floor,
        unit: lendTarget.unit,
        // 관리자가 직접 처리하는 대여라 별도의 "대여 확인" 단계를 거치지 않고 바로 확인 완료 처리한다.
        autoConfirmPickup: true,
      }], ver);

      if (!res.success && isVersionMismatchMessage(res.message)) { signalVersionOutdated(); return; }
      if (!res.success) { showToast(res.message || "대여 처리 실패", "error"); return; }
      showToast(res.message || `${lendTarget.name}님에게 ${countDistinctItemTypes(lendCart)}종을 추가 대여했습니다.`, "ok");
      setLendTarget(null);
      setLendCart([]);
      load(true);
    } catch (e: any) {
      showToast(`추가 대여 실패: ${e.message}`, "error");
    } finally {
      setLendSubmitting(false);
    }
  }

  // 제출 직전에 깨질 위험/화재 위험/특정 업체 request용 물품이 있는지 확인하고,
  // 있으면 모달로 한 번 더 확인받은 뒤에만 실제로 대여 처리한다.
  function submitLend() {
    if (!lendTarget || !lendCart.length) { showToast("대여할 물품을 담아주세요.", "warn"); return; }
    const hazards = collectHazardItems(lendCatalog, lendCart);
    if (hazards.length > 0) { setHazardModal({ items: hazards, onConfirm: doSubmitLend }); return; }
    doSubmitLend();
  }

  // 반납 기한 경고는 두지 않는다 — 당일 대여는 당일 반납이라 "며칠 지났다"를 따질 일이 없다.
  // (예전에는 Day 다음날 10시 / Night 다음날 19시를 기한으로 잡아 연체 목록과 배지를 띄웠다.)

  // 선택한 대여자의 물품을 "같은 시각에 신청한 묶음"으로 나눈다.
  // 반납 도중 새 대여가 들어와도 어느 건이 언제 것인지 구분된다.
  const activeGroups = useMemo(() => {
    // 시:분이 들어 있으면 분 단위까지, 없으면 날짜만으로 묶는다.
    // (형식이 "2026-07-22 23:41:33", "7/22/2026 23:41:33" 등으로 섞여 있어 길이로 판단하지 않는다)
    const bucket = (it: UnreturnedItem) => {
      const raw = String(it.borrowDateTime || it.borrowDate || "").trim();
      if (!raw) return "(시각 미상)";
      const m = raw.match(/^(.*?)[\sT](\d{1,2}):(\d{2})/);
      if (!m) return raw;
      return `${m[1]} ${m[2].padStart(2, "0")}:${m[3]}`;
    };

    const map = new Map<string, { key: string; when: string; shift?: string; requestNo?: number; items: UnreturnedItem[]; isExemptSection?: boolean }>();
    const exemptItems: UnreturnedItem[] = [];
    activeItems.forEach((it) => {
      if (it.typeLimitExempt) { exemptItems.push(it); return; }
      const key = it.requestNo ? `request:${it.requestNo}` : `${it.batchId || ""}|${bucket(it)}`;
      if (!map.has(key)) map.set(key, { key, when: bucket(it), shift: it.shift, requestNo: it.requestNo, items: [] });
      map.get(key)!.items.push(it);
    });

    const ts = (v: string) => {
      const t = Date.parse(v.replace(" ", "T"));
      return isNaN(t) ? 0 : t;
    };
    // 최근 신청부터 위로 (가장 최근에 빌린 것이 맨 위에 보이도록)
    const regular = Array.from(map.values()).sort((a, b) => ts(b.when) - ts(a.when));
    return exemptItems.length
      ? [...regular, { key: "type-limit-exempt", when: "한도 제외 항목", items: exemptItems, isExemptSection: true }]
      : regular;
  }, [activeItems]);

  // 커서 인덱스는 묶음을 펼친 순서(= activeItems 정렬)와 맞춰야 한다
  const flatItems = useMemo(() => activeGroups.flatMap((g) => g.items), [activeGroups]);

  const cartKey = (it: UnreturnedItem) => `${it.sheetType}:${it.rowIndex}`;
  const inCartQty = (it: UnreturnedItem) => cart.find((c) => c.key === cartKey(it))?.qty || 0;
  const cartTotal = cart.reduce((n, c) => n + c.qty, 0);
  const cartTypeCount = useMemo(() => countDistinctItemTypes(cart), [cart]);

  // 수량 하나를 장바구니에 담는다 (종류가 아니라 개수 단위)
  const addOne = useCallback((it: UnreturnedItem) => {
    const key = `${it.sheetType}:${it.rowIndex}`;
    const max = it.quantity || 1;
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.key === key);
      if (idx === -1) {
        return [...prev, {
          key,
          sheetType: it.sheetType as "scenario" | "general" | "warehouse",
          rowIndex: it.rowIndex,
          name: (it as any).name || it.itemLabel,
          borrower: String(it.borrowerName || "").trim() || "(이름 없음)",
          email: (it as any).email || undefined,
          itemLabel: it.itemLabel,
          location: it.location || "",
          borrowDate: it.borrowDateTime || it.borrowDate,
          max,
          qty: 1,
          // 지금 보고 있는 화면(대여 확인/반납 처리)을 기본 동작으로 삼는다. 나중에 장바구니에서 줄마다 바꿀 수 있다.
          action: (it.sheetType as string) !== "warehouse" ? processMode : undefined,
          disposition: (it.sheetType as string) === "warehouse" ? "반납" : undefined,
          pickedUp: it.pickedUp,
          itemId: (it as any).itemId || "",       // 불량 로그 등록·재고 차감에 쓴다
          variantId: (it as any).variantId || undefined,
          employeeId: (it as any).employeeId || "",
          variantName: (it as any).variantName || "",
        }];
      }
      if (prev[idx].qty >= max) return prev; // 대여 수량을 넘길 수 없다
      return prev.map((c, i) => (i === idx ? { ...c, qty: c.qty + 1 } : c));
    });
    addHistoryRef.current.push(key);
  }, [processMode]);

  // C: 마지막으로 담은 한 개를 되돌린다
  const undoOne = useCallback(() => {
    const key = addHistoryRef.current.pop();
    if (!key) { showToast("되돌릴 항목이 없습니다.", "info"); return; }
    setCart((prev) =>
      prev
        .map((c) => (c.key === key ? { ...c, qty: c.qty - 1 } : c))
        .filter((c) => c.qty > 0)
    );
  }, []);

  // C 길게 누르기: 담은 것과 대여자 선택을 모두 해제
  const clearAll = useCallback(() => {
    addHistoryRef.current = [];
    setCart([]);
    setSelectedBorrower(null);
    showToast("선택과 장바구니를 모두 해제했습니다.", "info");
  }, []);

  // 아직 다 담지 않은 항목인지
  const isFull = useCallback(
    (it: UnreturnedItem) => inCartQty(it) >= (it.quantity || 1),
    [cart]
  );

  // A 키: 현재 커서 위치의 물품을 한 개 담는다.
  // 그 물품을 다 담았으면 커서를 "아직 안 찬 다음 항목"으로 옮기되, 끝에서 처음으로
  // 순환하지 않는다. 앞에서 건너뛴 물품은 해당 줄을 직접 클릭해야 다시 선택할 수 있다.
  const addAtCursor = useCallback(() => {
    if (!selectedBorrower) { showToast("먼저 대여자를 선택해주세요.", "warn"); return; }
    if (!flatItems.length) return;

    // 시나리오 물품은 사진 확인 단계를 한 번 거친다.
    // (미리보기가 떠 있고 그 물품이 커서와 같으면 이번 A는 "담기"로 처리)
    if (category === "scenario") {
      const cur = flatItems[Math.min(cursor, flatItems.length - 1)];
      const curKey = cur ? `${cur.sheetType}:${cur.rowIndex}` : "";
      if (!preview || preview.key !== curKey) {
        if (cur && !isFull(cur)) {
          if (manualPickRequiredRef.current.has(curKey)) {
            showToast("이전에 제외한 물품입니다. 처리하려면 해당 물품 줄을 직접 클릭해주세요.", "info");
            return;
          }
          setPreview({ key: curKey, item: cur });
          return;
        }
      }
      setPreview(null);
    }

    // 커서가 이미 다 찬 항목을 가리키면 다음 빈 항목으로 먼저 이동
    let idx = cursor;
    if (idx >= flatItems.length || isFull(flatItems[idx])) {
      const next = flatItems.findIndex((it, i) => i >= idx && !isFull(it));
      if (next === -1) {
        const skipped = flatItems.some((it, i) => i < idx && !isFull(it));
        showToast(skipped ? "끝까지 확인했습니다. 건너뛴 물품은 목록에서 직접 클릭해주세요." : "이 대여자의 물품을 모두 담았습니다.", "info");
        return;
      }
      idx = next;
      setCursor(idx);
    }

    const target = flatItems[idx];
    const targetKey = `${target.sheetType}:${target.rowIndex}`;
    if (manualPickRequiredRef.current.has(targetKey)) {
      showToast("이전에 제외한 물품입니다. 처리하려면 해당 물품 줄을 직접 클릭해주세요.", "info");
      return;
    }
    addOne(target);

    // 이번 한 개로 가득 찼다면 다음 미완료 항목으로 커서 이동
    if (inCartQty(target) + 1 >= (target.quantity || 1)) {
      const next = flatItems.findIndex((it, i) => i > idx && !isFull(it));
      if (next !== -1) setCursor(next);
      // 다음 항목이 없으면 현재(완료된) 줄에 그대로 둔다. 여기서 처음으로 돌아가면
      // 사용자가 앞에서 건너뛴 물품이 다음 A에 다시 선택된다.
      else setCursor(idx);
    }
  }, [selectedBorrower, flatItems, cursor, cart, addOne, isFull, category, preview]);

  // P / O : 담지 않고 커서만 옮긴다 (건너뛰고 싶은 물품이 있을 때)
  const moveCursor = useCallback((delta: number) => {
    if (!flatItems.length) return;
    setPreview(null); // 다른 물품으로 옮기면 미리보기는 닫는다
    setCursor((prev) => {
      // P로 다음 줄로 넘긴 미완료 물품은 '의도적으로 제외'한 것으로 기억한다.
      // O로 되돌아오거나 처리를 마친 뒤 목록이 줄어들어도 A만으로 다시 선택되지 않는다.
      if (delta > 0) {
        const skipped = flatItems[prev];
        if (skipped && !isFull(skipped)) manualPickRequiredRef.current.add(`${skipped.sheetType}:${skipped.rowIndex}`);
      }
      return Math.max(0, Math.min(flatItems.length - 1, prev + delta));
    });
  }, [flatItems, isFull]);

  // 커서가 화면 밖으로 나가지 않도록 따라간다
  const cursorElRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    cursorElRef.current?.scrollIntoView({ block: "nearest" });
  }, [cursor, selectedBorrower]);

  // 최신 핸들러를 참조로 들고 있어야 키 이벤트가 오래된 값을 잡지 않는다
  function toggleMode() {
    setProcessMode((m) => (m === "대여" ? "반납" : "대여"));
  }

  function toggleCategory() {
    setCategory((c) => (c === "scenario" ? "warehouse" : "scenario"));
  }

  const handlersRef = useRef({ addAtCursor, undoOne, clearAll, moveCursor, toggleMode, toggleCategory, submit: async () => {} });
  handlersRef.current.addAtCursor = addAtCursor;
  handlersRef.current.moveCursor = moveCursor;
  handlersRef.current.undoOne = undoOne;
  handlersRef.current.clearAll = clearAll;
  handlersRef.current.toggleMode = toggleMode;
  handlersRef.current.toggleCategory = toggleCategory;

  const [cHeld, setCHeld] = useState(false);

  useEffect(() => {
    const LONG_PRESS_MS = 650;
    let cTimer: number | null = null;
    let cLongFired = false;

    const isTyping = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase();
      return tag === "input" || tag === "textarea" || !!el?.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // QR 인쇄 모달이 떠 있는 동안에는 단축키로 장바구니가 바뀌지 않게 막고, Esc로만 닫는다.
      if (qrPickerOpenRef.current) {
        if (e.key === "Escape") setQrPickerOpen(false);
        return;
      }
      if (isTyping(e)) return;
      const k = e.key.toLowerCase();

      // Q: A로 연 사진 확인 모달 닫기. 모달이 없을 때는 아무 동작도 하지 않는다.
      if ((k === "q" || e.key === "ㅂ") && previewRef.current) { e.preventDefault(); setPreview(null); return; }

      // A: 맨 위 물품 한 개 담기
      if (k === "a" || e.key === "ㅁ") { e.preventDefault(); handlersRef.current.addAtCursor(); return; }

      // P: 담지 않고 다음 물품으로 이동 (건너뛰기)
      // O: 이전 물품으로 이동
      // 화살표 키는 페이지가 함께 스크롤되어 쓰지 않는다.
      if (k === "p" || e.key === "ㅔ") { e.preventDefault(); handlersRef.current.moveCursor(1); return; }
      if (k === "o" || e.key === "ㅐ") { e.preventDefault(); handlersRef.current.moveCursor(-1); return; }

      // R: 대여 확인 ↔ 반납 처리 모드 전환 (장바구니 담긴 게 있으면 실수 방지로 무시)
      if (k === "r" || e.key === "ㄱ") { e.preventDefault(); handlersRef.current.toggleMode(); return; }

      // T: 반납 모드에서 시나리오 물품 ↔ COS 물품 전환 (대여 확인 모드는 시나리오 고정이라 해당 없음)
      if (k === "t" || e.key === "ㅅ") { e.preventDefault(); handlersRef.current.toggleCategory(); return; }

      // B: 처리 완료 (대여 모드=대여 확인 / 반납 모드=반납 완료)
      if (k === "b" || e.key === "ㅠ") { e.preventDefault(); handlersRef.current.submit(); return; }

      // C: 짧게 누르면 하나 되돌리기 / 꾹 누르면 전체 해제
      if (k === "c" || e.key === "ㅊ") {
        e.preventDefault();
        if (e.repeat || cTimer !== null) return; // 자동 반복 무시
        cLongFired = false;
        setCHeld(true);
        cTimer = window.setTimeout(() => {
          cLongFired = true;
          cTimer = null;
          setCHeld(false);
          handlersRef.current.clearAll();
        }, LONG_PRESS_MS);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k !== "c" && e.key !== "ㅊ") return;
      if (cTimer !== null) { window.clearTimeout(cTimer); cTimer = null; }
      setCHeld(false);
      if (!cLongFired) handlersRef.current.undoOne(); // 짧게 눌렀을 때만
      cLongFired = false;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      if (cTimer !== null) window.clearTimeout(cTimer);
    };
  }, []);

  // itemLabel(예: "[000123] 드라이버 x 2")에서 ID 접두사와 수량 접미사를 떼어
  // 순수 물품명만 뽑는다. UnreturnedItem에는 itemName이라는 필드가 애초에 없어서
  // (재대여 시 item?.itemName을 참조하면 항상 undefined → 빈 이름으로 등록되는 버그가 있었다)
  function pureItemName(label?: string): string {
    return String(label || "")
      .replace(/^\[[^\]]*\]\s*/, "")     // 앞의 "[000123] " 제거
      .replace(/\s*[x×]\s*\d+\s*$/i, "") // 끝의 " x 2" 제거
      .trim();
  }

  function changeQty(key: string, delta: number) {
    setCart((prev) =>
      prev
        .map((c) => (c.key === key ? { ...c, qty: Math.max(0, Math.min(c.max, c.qty + delta)) } : c))
        .filter((c) => c.qty > 0)
    );
  }

  // COS 물품 한정: 재고로 돌려놓을지(반납) 다 써서 뺄지(소모) 전환
  function toggleDisposition(key: string) {
    setCart((prev) =>
      prev.map((c) => (c.key === key ? { ...c, disposition: c.disposition === "소모" ? "반납" : "소모" } : c))
    );
  }

  // 시나리오/일반 물품 한정: 이 줄을 "확인" 처리할지 "반납" 처리할지 전환
  function toggleAction(key: string) {
    setCart((prev) =>
      prev.map((c) => (c.key === key
        // 대여 확인으로 되돌리면 파손 표시는 의미가 없어지므로 같이 해제한다.
        ? { ...c, action: c.action === "확인" ? "반납" : "확인", damaged: c.action === "확인" ? c.damaged : false }
        : c))
    );
  }

  // 이 줄을 "파손 반납"으로 표시/해제한다. 반납 줄에만 의미가 있다.
  function toggleDamaged(key: string) {
    setCart((prev) => prev.map((c) => (c.key === key ? { ...c, damaged: !c.damaged } : c)));
  }

  const submitReturnRef = useRef<() => void>();

  // 담당자가 종류를 골라줘야 하는 줄을 모은다. 두 경우가 있고, 물어보는 이유가 다르다:
  //  1) 대여 확인 — 신청자가 "종류 상관없음"으로 빌렸다. 고르는 순간 그 종류의 재고가 빠진다.
  //  2) 반납 — 종류가 생기기 전에 나간 건이라 어느 종류가 돌아오는지 기록이 없다.
  //     고른 종류의 재고로 되돌린다.
  // 종류가 없는 물품이나 이미 종류가 정해진 줄은 이 단계를 그냥 건너뛴다.
  function pendingVariantLines(batch: ReturnCartLine[]) {
    return batch
      .filter((c) => c.sheetType !== "warehouse" && !c.variantId)
      .map((c) => ({ line: c, item: items.find((it) => `${it.sheetType}:${it.rowIndex}` === c.key) }))
      .filter((x) => {
        if (!(x.item?.variants || []).length) return false;
        // 대여 전 취소는 재고가 나간 적이 없어 종류를 고를 필요가 없다.
        if (isCancellationLine(x.line)) return false;
        // 파손 반납은 선반으로 돌아가지 않으니 어느 종류였는지 몰라도 장부가 맞는다 — 묻지 않는다.
        if (x.line.action === "반납" && x.line.damaged) return false;
        return x.line.action === "반납" ? !!x.item?.variantUnassigned : !!x.item?.variantPending;
      });
  }

  function submitReturn() {
    if (!cart.length) { showToast("담긴 물품이 없습니다.", "warn"); return; }

    const batch = [...cart];
    const batchReborrow = reborrowAfter;

    let transfer: TransferTarget | null = null;
    if (transferMode) {
      const name = transferTarget.name.trim();
      if (!name) { showToast("양도받을 사람의 이름을 입력해주세요.", "warn"); return; }
      const empId = transferTarget.employeeId.trim();
      if (!/^\d{4}$/.test(empId)) {
        showToast("등록 명부에서 양도받을 사람을 선택해주세요.", "warn");
        return;
      }
      // 양도 대상이 되는 줄이 하나도 없으면(대여 확인만 담았거나 전부 소모 처리) 헛돈다.
      const eligible = batch.filter((c) => (c.sheetType === "warehouse" ? c.disposition !== "소모" : c.action === "반납" && !!c.pickedUp));
      if (!eligible.length) { showToast("양도할 수 있는 줄이 없습니다. (대여 확인·소모 처리 줄은 양도 대상이 아닙니다)", "warn"); return; }
      transfer = { name, employeeId: empId };
    }

    // 종류가 안 정해진 줄이 있으면 확인 모달보다 먼저 종류를 고르게 한다.
    const needVariant = pendingVariantLines(batch);
    if (needVariant.length) {
      setVariantPrompt({
        batch,
        reborrow: batchReborrow,
        transfer,
        lines: needVariant.map((x) => ({
          key: x.line.key,
          label: x.line.itemLabel,
          qty: x.line.qty,
          kind: (x.line.action === "반납" ? "반납" : "확인") as "반납" | "확인",
          variants: x.item!.variants || [],
        })),
        choice: {},
      });
      return;
    }

    // 파손으로 표시된 줄이 있으면 수량 → 불량 로그 입력을 먼저 받는다.
    const dmg = batch.filter((c) => c.sheetType !== "warehouse" && c.action === "반납" && !!c.pickedUp && c.damaged);
    if (dmg.length) {
      setDamageFlow({
        batch, reborrow: batchReborrow, transfer,
        step: "qty",
        lines: dmg.map((c) => {
          const src = items.find((it) => `${it.sheetType}:${it.rowIndex}` === c.key);
          // 종류가 나뉜 물품인데 종류를 모르는 파손 건은 반납에서 재고를 되돌리지 않는다.
          // 그러니 불량 등록에서도 깎으면 안 된다(안 그러면 이중으로 사라진다).
          const noStock = !c.variantId && (src?.variants || []).length > 0;
          return {
            key: c.key,
            label: c.itemLabel,
            max: c.qty,
            qty: c.qty, // 기본값은 담은 수량 전부 — 일부만 파손이면 줄여 입력한다
            itemId: c.itemId || "",
            itemName: c.name || c.itemLabel,
            variantId: c.variantId,
            noStock,
            keepBorrowed: false,
            sheetType: c.sheetType as "scenario" | "general",
            rowIndex: c.rowIndex,
            variants: (src?.variants || []) as { id: number; name: string; stock: number }[],
            replacementVariantId: c.variantId,
          };
        }),
        defectType: "파손", note: "", actionTaken: "", culprit: "", photo: "",
      });
      return;
    }

    finalizeBatch(batch, batchReborrow, transfer);
  }

  // 확인 모달을 띄우는 마지막 단계 — 종류 선택이 끝난 뒤에도 여기로 다시 들어온다.
  function finalizeBatch(batch: ReturnCartLine[], batchReborrow: boolean, transfer: TransferTarget | null, damage?: DamagePayload) {
    const pickupLines = batch.filter((c) => c.action !== "반납" && c.sheetType !== "warehouse");
    const returnLines = batch.filter((c) => c.action === "반납" && c.sheetType !== "warehouse");
    const cancellationLines = returnLines.filter(isCancellationLine);
    const actualReturnLines = returnLines.filter((c) => !isCancellationLine(c));
    const warehouseLines = batch.filter((c) => c.sheetType === "warehouse");

    const parts: string[] = [];
    if (pickupLines.length) parts.push(`대여 확인 ${countDistinctItemTypes(pickupLines)}종`);
    if (actualReturnLines.length) parts.push(`반납 ${countDistinctItemTypes(actualReturnLines)}종`);
    if (cancellationLines.length) parts.push(`대여 취소 ${countDistinctItemTypes(cancellationLines)}종`);
    if (warehouseLines.length) {
      const warehouseN = countDistinctItemTypes(warehouseLines);
      const consumeN = countDistinctItemTypes(warehouseLines.filter((c) => c.disposition === "소모"));
      parts.push(consumeN > 0 ? `COS 물품 ${warehouseN}종 (그중 소모 ${consumeN}종)` : `COS 물품 반납 ${warehouseN}종`);
    }

    if (transfer) parts.push(`→ ${transfer.name}님에게 양도`);

    if (damage) {
      const keep = damage.items.filter((i) => i.keepBorrowed).reduce((n, i) => n + i.qty, 0);
      parts.push(`파손 ${damage.items.reduce((n, i) => n + i.qty, 0)}개 불량 등록`);
      if (keep) parts.push(`그중 ${keep}개는 교체 후 계속 대여`);
    }
    setConfirmBatch({ parts, batch, reborrow: batchReborrow, transfer, damage });
  }

  // 파손 페이로드 항목(itemId 기준)을 장바구니 줄 key로 되짚는다.
  function damageKeyOf(batch: ReturnCartLine[], it: { itemId: string; itemName: string }) {
    const hit = batch.find(
      (c) => c.action === "반납" && c.damaged && (it.itemId ? c.itemId === it.itemId : c.itemLabel === it.itemName)
    );
    return hit?.key || "";
  }

  async function executeBatch(batch: ReturnCartLine[], batchReborrow: boolean, transfer: TransferTarget | null = null, damage?: DamagePayload) {
    setConfirmBatch(null);

    // 이번 처리에서 일부러 남긴 물품(아예 안 담았거나 일부 수량만 담은 줄)은 다음 작업에서
    // A가 자동으로 집지 못하게 한다. 사용자가 그 줄을 직접 클릭하면 아래 표시가 해제된다.
    const submittedQty = new Map(batch.map((line) => [line.key, line.qty]));
    manualPickRequiredRef.current = new Set(
      flatItems
        .filter((it) => (submittedQty.get(`${it.sheetType}:${it.rowIndex}`) || 0) < (it.quantity || 1))
        .map((it) => `${it.sheetType}:${it.rowIndex}`)
    );

    // 확인을 누른 순간 장바구니를 비운다 — 이 시점부터 화면은 새 작업을 받을 준비가 된다.
    setCart([]);
    addHistoryRef.current = [];
    setTransferMode(false);
    setTransferTarget({ name: "", employeeId: "" });

    const pickupLines = batch.filter((c) => c.sheetType !== "warehouse" && c.action !== "반납");
    // 파손품을 버리고 대체품을 계속 쓰기로 한 수량은 반납하지 않는다 — 그만큼 대여중으로 남고,
    // 재고에서는 대체품이 나간 만큼만 빠진다(파손 등록 단계에서 차감).
    const keepQty = new Map<string, number>();
    for (const it of damage?.items || []) {
      if (!it.keepBorrowed) continue;
      const k = damageKeyOf(batch, it);
      if (k) keepQty.set(k, (keepQty.get(k) || 0) + it.qty);
    }
    const returnLines = batch
      .filter((c) => c.sheetType !== "warehouse" && c.action === "반납")
      .map((c) => {
        const keep = keepQty.get(c.key) || 0;
        return keep > 0 ? { ...c, qty: c.qty - keep } : c;
      })
      .filter((c) => c.qty > 0);
    const cancellationLines = returnLines.filter(isCancellationLine);
    const actualReturnLines = returnLines.filter((c) => !isCancellationLine(c));
    const warehouseLines = batch.filter((c) => c.sheetType === "warehouse");

    const jobId = ++jobIdRef.current;
    const jobQty = batch.reduce((n, c) => n + c.qty, 0);
    setPendingJobs((prev) => [...prev, { id: jobId, label: `${countDistinctItemTypes(batch)}종 · ${jobQty}개` }]);

    try {
      let anyFailed = false;

      // 1) 대여 확인 — 재고/수량 변화 없이 "실물 확인" 시각만 남긴다.
      if (pickupLines.length) {
        try {
          const uniqueRows = Array.from(
            new Map<string, { sheetType: "scenario" | "general"; rowIndex: number; quantity: number; variantId?: number }>(
              pickupLines.map((c) => [c.key, { sheetType: c.sheetType as "scenario" | "general", rowIndex: c.rowIndex, quantity: c.qty, variantId: c.variantId }])
            ).values()
          );
          const res = await postConfirmPickup(scriptUrl, uniqueRows);
          if (!res.success && isVersionMismatchMessage(res.message)) { signalVersionOutdated(); return; }
          if (!res.success) { showToast(res.message || "대여 확인 처리 실패", "error"); anyFailed = true; }
          else {
            showToast(res.message || `${countDistinctItemTypes(pickupLines)}종을 대여 확인 처리했습니다.`, "ok");
            // 부분 확인이면 같은 대여 행이 '확인 완료 수량 + 미확인 잔량'으로 나뉜다.
            // 로컬에서 원래 행 전체를 확인 처리하지 말고 서버 결과를 다시 읽어 정확히 맞춘다.
            await load(true);
          }
        } catch (e: any) {
          showToast(`대여 확인 처리 실패: ${e.message}`, "error");
          anyFailed = true;
        }
      }

      // 파손 반납은 "반납이 성공한 뒤"에만 등록해야 한다 — 반납이 실패했는데 재고만
      // 깎으면 장부가 어긋난다. 아래 반납 처리 뒤에서 호출한다.
      // 2) 시나리오/일반 반납
      let returnSucceeded = false;
      if (returnLines.length) {
        try {
          const ver = await fetchBorrowAppVersion(scriptUrl).catch(() => "");
          const res = await postProcessReturn(
            scriptUrl,
            returnLines.map((c) => ({ sheetType: c.sheetType as "scenario" | "general", rowIndex: c.rowIndex, quantity: c.qty, variantId: c.variantId, damaged: !!c.damaged, source: transfer ? "transfer" : "admin" })),
            ver
          );
          if (!res.success && isVersionMismatchMessage(res.message)) { signalVersionOutdated(); return; }
          if (!res.success) { showToast(res.message || "반납/취소 처리 실패", "error"); anyFailed = true; }
          else {
            returnSucceeded = true;
            const completed: string[] = [];
            if (actualReturnLines.length) completed.push(`${actualReturnLines.reduce((n, c) => n + c.qty, 0)}개 반납`);
            if (cancellationLines.length) completed.push(`${cancellationLines.reduce((n, c) => n + c.qty, 0)}개 대여 취소`);
            // 서버의 기존 문구가 취소 건도 "반납"으로 표시하므로 화면에서 의미에 맞게 구성한다.
            showToast(`${completed.join(" · ")} 처리했습니다.`, "ok");
            const done = new Map(returnLines.map((c) => [c.key, c.qty]));
            setItems((prev) =>
              prev
                .map((it) => {
                  const q = done.get(`${it.sheetType}:${it.rowIndex}`);
                  if (q === undefined) return it;
                  const left = (it.quantity || 1) - Number(q);
                  return left > 0 ? { ...it, quantity: left } : null;
                })
                .filter(Boolean) as UnreturnedItem[]
            );
          }
        } catch (e: any) {
          showToast(`반납 처리 실패: ${e.message}`, "error");
          anyFailed = true;
        }
      }

      // 2-1) 파손 반납 — 반납으로 재고에 되돌아온 것 중 못 쓰게 된 수량을 다시 깎고 불량 로그로 남긴다.
      //      반납이 실패했으면 건너뛴다(재고만 깎이는 상황을 만들지 않기 위해).
      if (damage && damage.items.length) {
        if (returnLines.length && !returnSucceeded) {
          showToast("반납 처리가 되지 않아 파손 등록을 건너뛰었습니다.", "warn");
          anyFailed = true;
        } else {
          try {
            const res = await postRecordDamagedReturn(scriptUrl, damage);
            if (!res.success) { showToast(res.message || "파손 등록에 실패했습니다.", "error"); anyFailed = true; }
            else {
              showToast(res.message || `파손 ${damage.items.length}건을 불량 로그에 등록했습니다.`, "ok");
              window.dispatchEvent(new Event("wms-notifications-changed"));
              (res.warnings || []).forEach((w) => showToast(w, "warn"));
            }
          } catch (e: any) {
            showToast(`파손 등록 실패: ${e.message}`, "error");
            anyFailed = true;
          }
        }
      }

      // 3) COS 물품 (반납/소모)
      let whSucceeded = false;
      if (warehouseLines.length) {
        try {
          const consumeTotal = warehouseLines.filter((c) => c.disposition === "소모").reduce((n, c) => n + c.qty, 0);
          const bulk = await postWarehouseRentBulk(
            scriptUrl,
            warehouseLines.map((c) => ({
              type: (c.disposition === "소모" ? "소모" : "반납") as "반납" | "소모",
              location: c.location,
              name: c.name || c.itemLabel,
              qty: c.qty,
              user: c.borrower,
              employeeId: c.employeeId,
              // [소모완료] 태그: 대여 시점에 이미 재고에서 빠진 물품이라, 서버가 이 태그를 보고
              // 재고를 또 차감하지 않는다 (server/routes/gas.js의 applyWarehouseRent 참고).
              note: c.disposition === "소모" ? "[소모완료] 관리자 반납 중 소모 처리" : "관리자 반납 처리",
            }))
          );
          if (!bulk.success) { showToast(bulk.error || "COS 물품 반납 처리 실패", "error"); anyFailed = true; }
          else {
            whSucceeded = true;
            const whTotal = warehouseLines.reduce((n, c) => n + c.qty, 0);
            showToast(consumeTotal > 0 ? `${whTotal}개를 처리했습니다. (소모 ${consumeTotal}개 포함)` : `${whTotal}개를 반납 처리했습니다.`, "ok");
            const done = new Map(warehouseLines.map((c) => [c.key, c.qty]));
            setWhItems((prev) =>
              prev
                .map((it) => {
                  const q = done.get(`${it.sheetType}:${it.rowIndex}`);
                  if (q === undefined) return it;
                  const left = (it.quantity || 1) - Number(q);
                  return left > 0 ? { ...it, quantity: left } : null;
                })
                .filter(Boolean) as UnreturnedItem[]
            );
            onInventoryChanged?.(); // 공구 재고가 실제로 바뀌었으니 "물품 관리" 화면 데이터도 즉시 갱신
          }
        } catch (e: any) {
          showToast(`COS 물품 반납 처리 실패: ${e.message}`, "error");
          anyFailed = true;
        }
      }

      // 실제로 이번 처리에서 반납에 성공해 선반으로 돌아갈 물품만 위치표 대상으로 기억한다.
      // 파손·소모·양도·반납 후 재대여는 선반에 둘 물건이 아니므로 제외한다.
      if (!batchReborrow && !transfer) {
        const completedLines = [
          ...(returnSucceeded ? actualReturnLines.filter((c) => !c.damaged) : []),
          ...(whSucceeded ? warehouseLines.filter((c) => c.disposition !== "소모") : []),
        ];
        if (completedLines.length) {
          rememberReturnedPrint(completedLines.map((c) => {
            const source = activeSource.find((it) => `${it.sheetType}:${it.rowIndex}` === c.key);
            const chosenVariant = (source?.variants || []).find((v) => v.id === c.variantId)?.name;
            return {
              id: c.itemId || source?.itemId || "",
              name: pureItemName(c.name || c.itemLabel),
              quantity: c.qty,
              location: c.location || source?.location || "위치 미등록",
              variantName: chosenVariant || c.variantName || source?.variantName || "",
              employeeId: c.employeeId || source?.employeeId || "",
              borrowerName: c.borrower,
            };
          }));
        }
      }

      // 반납 후 재대여 / 양도: "반납"으로 성공 처리된 줄(공구는 소모 제외)만 대상으로 한다.
      // 대여 확인 줄은 이미 대여 중이던 물품이라 대상이 아니다.
      // 둘은 "반납 처리한 뒤 곧바로 다시 대여를 남긴다"는 흐름이 완전히 같고, 받는 사람만 다르다
      // — 재대여는 원래 대여자 그대로, 양도는 새로 지정한 사람.
      if (batchReborrow || transfer) {
        const reborrowLines = [
          ...(returnSucceeded ? actualReturnLines : []),
          ...(whSucceeded ? warehouseLines.filter((c) => c.disposition !== "소모") : []),
        ];
        if (reborrowLines.length) {
          try {
            // 이름만이 아니라 sameBorrowerIdentity로 묶는다 — 동명이인이 같은 처리 묶음에
            // 섞여 있어도 서로 다른 사람의 재대여로 나뉘어 처리되도록.
            const byBorrower: { who: string; email?: string; lines: typeof batch }[] = [];
            reborrowLines.forEach((c) => {
              let g = byBorrower.find((x) => sameBorrowerIdentity(x.who, x.email, c.borrower, c.email));
              if (!g) { g = { who: c.borrower, email: c.email, lines: [] }; byBorrower.push(g); }
              if (!g.email && c.email) g.email = c.email;
              g.lines.push(c);
            });

            for (const group of byBorrower) {
              // 양도면 받는 사람이 새 대여자가 된다. 원래 대여자는 기록에 남겨 흐름을 추적할 수 있게 한다.
              const who = transfer ? transfer.name : group.who;
              const note = transfer ? `${group.who}님 → ${transfer.name}님 양도` : "반납 후 재대여 (대여일 갱신)";
              const lines = group.lines;
              const whPart = lines.filter((c) => c.sheetType === "warehouse");
              const scenarioPart = lines.filter((c) => c.sheetType !== "warehouse");

              if (whPart.length) {
                await postWarehouseRentBulk(
                  scriptUrl,
                  whPart.map((c) => ({
                    type: "대여" as const,
                    location: c.location,
                    name: c.name || c.itemLabel,
                    qty: c.qty,
                    user: who,
                    employeeId: transfer ? transfer.employeeId : (c.employeeId || ""),
                    note,
                  }))
                );
              }
              if (scenarioPart.length) {
                // 원래 대여 기록에서 이메일·위치를 가져와 사용자와 좌석 정보를 유지한다
                const src = activeSource.find((it) => `${it.sheetType}:${it.rowIndex}` === scenarioPart[0].key);
                const ver2 = await fetchBorrowAppVersion(scriptUrl).catch(() => "");
                await postBorrow(scriptUrl, [{
                  itemType: "general",
                  borrowerName: who,
                  // 양도는 받는 사람의 소속/사번으로 이메일을 새로 계산해야 사용자 식별이 맞는다.
                  // 원래 대여자의 이메일(knownEmail)을 그대로 넘기면 엉뚱한 사람이 태깅된다.
                  affiliation: "",
                  employeeId: transfer ? transfer.employeeId : "",
                  knownEmail: transfer ? undefined : (group.email || src?.email || undefined),
                  borrowDate: nowString(),
                  borrowPurpose: note,
                  generalOption: transfer ? "양도" : "재대여",
                  borrowedItems: scenarioPart.map((c) => {
                    const item = activeSource.find((it) => `${it.sheetType}:${it.rowIndex}` === c.key);
                    // itemName은 수량이 제거된 순수 물품명이다. 라벨(itemLabel)을 쓰면
                    // "Fork x 3"처럼 수량이 이미 붙어 있어 서버에서 한 번 더 붙는다.
                    // 종류가 나뉜 물품은 방금 반납된 그 종류에서 다시 나가야 한다.
                    // 빠뜨리면 서버가 "종류를 선택해야 대여할 수 있습니다"로 거부해,
                    // 반납만 되고 재대여/양도가 실패한 채로 남는다.
                    return {
                      id: item?.itemId || "",
                      name: pureItemName(item?.itemLabel),
                      quantity: c.qty,
                      variantId: c.variantId ?? (item as any)?.variantId ?? undefined,
                    };
                  }).filter((x) => x.id),
                  floor: src?.floor,
                  unit: src?.unit,
                }], ver2);
              }
            }
            const movedQty = reborrowLines.reduce((n, c) => n + c.qty, 0);
            showToast(
              transfer
                ? `${movedQty}개를 ${transfer.name}님에게 양도했습니다.`
                : `${movedQty}개를 반납 후 다시 대여했습니다. (대여일 갱신)`,
              "ok"
            );
            onInventoryChanged?.();
          } catch (reErr: any) {
            showToast(
              transfer
                ? `반납은 완료했지만 양도에 실패했습니다: ${reErr.message} — 물품이 반납 상태로 남아 있으니 다시 처리해주세요.`
                : `반납은 완료했지만 재대여에 실패했습니다: ${reErr.message}`,
              "warn"
            );
          }
        }
      }

      if (anyFailed) {
        showToast("일부 항목 처리에 실패했습니다 — 실패한 물품은 목록에서 다시 찾아 담아주세요.", "warn");
      }
      reloadActive(true); // 정합성은 백그라운드로 맞춘다
    } finally {
      setPendingJobs((prev) => prev.filter((j) => j.id !== jobId));
    }
  }

  // 반납 증빙 사진: 시나리오/일반 물품의 실물 반납이 이번 처리 묶음에 하나라도 있으면 필수.
  // COS 물품(반납/소모)는 사진 대상에서 제외 — 촬영 없이 바로 처리한다.
  // 대여 확인만 있는 묶음(아직 아무것도 돌아오지 않은 건)은 사진이 필요 없다.
  // 예외 1) 반납 후 재대여: 실물이 잠깐도 밖으로 안 나가고 그대로 다시 나가는 셈이라 사진 불필요.
  // 예외 2) 대여 확인 취소(관리자): 애초에 실물 확인(픽업)을 한 적 없는 시나리오/일반 물품 줄을
  //         "반납"으로 처리하는 경우 — 실제로는 물건이 나간 적이 없으므로 반납 사진이 필요 없다.
  // 예외 3) 양도: 실물이 창고로 돌아오지 않고 다른 사람에게 그대로 넘어가므로 반납 사진이 없다.
  // 예외 4) 파손 반납: 그 줄의 증빙 사진은 불량 로그로 들어가므로 반납 사진에서 제외한다.
  //         파손 줄만 있는 묶음이면 반납 사진을 따로 찍지 않는다.
  const batchNeedsPhoto = confirmBatch
    ? !confirmBatch.reborrow && !confirmBatch.transfer &&
      confirmBatch.batch.some((c) => c.action === "반납" && !!c.pickedUp && !c.damaged)
    : false;

  // 화면에 지금 스트리밍되고 있는 프레임을 캔버스로 그대로 캡처한다.
  // 반납 증빙 사진과 파손(불량 로그) 사진이 같은 카메라를 쓰므로 어디에 담을지만 구분한다.
  function captureFromStream(target: "return" | "damage" = "return") {
    const img = streamImgRef.current;
    if (!img || !img.naturalWidth) { showToast("아직 카메라 미리보기가 준비되지 않았습니다.", "warn"); return; }
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
    const data = canvas.toDataURL("image/jpeg", 0.9);
    if (target === "damage") setDamageFlow((p) => (p ? { ...p, photo: data } : p));
    else setConfirmPhoto(data);
  }

  function retakePhoto() {
    setConfirmPhoto("");
  }

  // 사진이 필요한 처리 묶음 모달이 열려 있고 아직 확정된 사진이 없으면 스트림을 열고,
  // 그 외(취소/처리 완료/사진 확정)에는 <img>를 걷어내 연결을 끊는다.
  // 파손 폼도 같은 카메라를 쓴다 — 둘 중 하나라도 사진이 필요하면 스트림을 연다.
  const damageNeedsPhoto = !!damageFlow && damageFlow.step === "form" && !damageFlow.photo;
  const cameraDemand: "damage" | "return" | null = damageNeedsPhoto
    ? "damage"
    : confirmBatch && batchNeedsPhoto && !confirmPhoto
      ? "return"
      : null;
  useEffect(() => {
    if (!cameraDemand) {
      closeCameraStream();
      return;
    }

    // 매 촬영/재촬영을 독립된 세션으로 시작한다. 이전 세션의 일시적인 포트 판별 실패나
    // 한 번뿐인 fallback 상태가 다음 반납까지 남아 카메라를 막지 않게 한다.
    camRetriedRef.current = false;
    cameraAutoRefreshRef.current = 0;
    openCameraStream(true);
  }, [cameraDemand, closeCameraStream, openCameraStream]);

  // MJPEG는 연결이 걸려도 onError를 내지 않는 경우가 있다. 3초 안에 첫 프레임이 오지 않으면
  // 1차로 같은 오리진을 시도하고, 다시 3초가 지나면 브라우저의 카메라 상태만 하드 리셋한다.
  useEffect(() => {
    if (!cameraDemand || streamReady) return;
    const watchedAttempt = cameraAttempt;
    const timer = window.setTimeout(() => {
      if (!cameraDemand || streamReady || cameraAttempt !== watchedAttempt) return;
      const next = cameraAutoRefreshRef.current + 1;
      cameraAutoRefreshRef.current = next;
      camRetriedRef.current = false;
      if (next === 1) {
        fallbackToSameOrigin();
        openCameraStream(false);
      } else if (next === 2) {
        hardResetCameraSession();
        openCameraStream(true);
      } else {
        setCameraError("카메라 자동 새로고침 후에도 연결되지 않았습니다. 웹캠 연결을 확인해주세요.");
      }
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [cameraDemand, streamReady, cameraAttempt, openCameraStream]);

  // 페이지 자체가 닫힐 때도 끝나지 않는 MJPEG 응답을 즉시 놓는다.
  useEffect(() => () => {
    cameraConnectSeqRef.current += 1;
    detachCameraImage();
    releaseCameraStream();
  }, [detachCameraImage]);

  // 모달이 닫히면(취소 또는 처리 완료) 사진 상태도 함께 정리한다.
  useEffect(() => {
    if (!confirmBatch) {
      setConfirmPhoto(""); setCameraError("");
      setPhotoFailed(""); photoAttemptIdRef.current = "";
    }
  }, [confirmBatch]);

  // 업로드 중 경과 초. 화면이 멎은 것처럼 보이지 않게 숫자가 계속 올라가야 한다.
  useEffect(() => {
    if (!photoSaving) { setPhotoElapsed(0); return; }
    const t0 = Date.now();
    const timer = window.setInterval(() => setPhotoElapsed(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => window.clearInterval(timer);
  }, [photoSaving]);

  async function handleConfirmSubmit() {
    if (!confirmBatch) return;
    if (batchNeedsPhoto) {
      if (!confirmPhoto) { showToast("반납 사진을 먼저 촬영해주세요.", "warn"); return; }
      setPhotoSaving(true);
      setPhotoFailed("");
      // 같은 사진에 대한 재시도는 같은 이름표를 그대로 쓴다 — 서버가 중복 저장을 막는 근거다.
      if (!photoAttemptIdRef.current) {
        photoAttemptIdRef.current = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      }
      try {
        const items = confirmBatch.batch.map((c) => ({
          itemLabel: c.itemLabel,
          borrower: c.borrower,
          location: c.location,
          borrowDate: c.borrowDate,
          qty: c.qty,
          action: c.sheetType === "warehouse"
            ? (c.disposition === "소모" ? "소모" : "반납")
            : isCancellationLine(c)
              ? "취소"
              : (c.action === "반납" ? "반납" : "확인"),
        }));
        const res = await postSaveReturnPhoto(scriptUrl, {
          photo: confirmPhoto,
          summary: confirmBatch.parts.join(" · "),
          items,
          clientId: photoAttemptIdRef.current,
        });
        if (!res.success) {
          setPhotoFailed(res.error || "사진 저장에 실패했습니다.");
          return;
        }
      } catch (e: any) {
        // 여기서 멈추지 않고 확인창에 재시도를 띄운다 — 사무실 Wi-Fi 경로에서 응답만
        // 유실되는 일이 있어서, 사람이 한 번 더 누르는 것만으로 대개 지나간다.
        setPhotoFailed(e?.message || "사진을 보내지 못했습니다.");
        return;
      } finally {
        setPhotoSaving(false);
      }
    }
    executeBatch(confirmBatch.batch, confirmBatch.reborrow, confirmBatch.transfer, confirmBatch.damage);
  }

  submitReturnRef.current = submitReturn;
  // "장바구니 처리 확인" 모달이 이미 열려 있으면 B는 그 안의 "처리하기"를 누른 것과 같게 동작한다
  // (모달이 없을 때는 기존처럼 담긴 내용으로 확인 모달을 연다).
  handlersRef.current.submit = () => {
    if (confirmBatch) { handleConfirmSubmit(); return; }
    submitReturnRef.current?.();
  };

  // QR 인쇄 모달을 열 때마다 SCAN ME 라벨 미리보기를 새로 받아 온다.
  useEffect(() => {
    if (!qrPickerOpen) return;
    let url: string | null = null;
    let cancelled = false;
    fetchScanMeQrPreview()
      .then((next) => { if (cancelled) URL.revokeObjectURL(next); else { url = next; setScanMePreview(next); } })
      .catch(() => { if (!cancelled) setScanMePreview(null); });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
      setScanMePreview(null);
    };
  }, [qrPickerOpen]);

  const handlePrintLookupQr = async () => {
    if (printingLookupQr) return;
    setPrintingLookupQr(true);
    try {
      await printLookupQrLabel();
      showToast("사번 조회 QR 라벨 1장을 출력했습니다.", "ok");
      setQrPickerOpen(false);
    } catch (error: any) {
      showToast(error?.message || "QR 라벨 출력에 실패했습니다.", "error");
    } finally {
      setPrintingLookupQr(false);
    }
  };

  const handlePrintScanMe = async () => {
    if (printingScanMe) return;
    setPrintingScanMe(true);
    try {
      const printed = await printScanMeQrLabel(scanMeCopies);
      showToast(`SCAN ME QR 라벨 ${printed}장을 출력했습니다.`, "ok");
      setQrPickerOpen(false);
    } catch (error: any) {
      showToast(error?.message || "SCAN ME QR 출력에 실패했습니다.", "error");
    } finally {
      setPrintingScanMe(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    padding: "10px 12px", borderRadius: "10px", border: `1px solid ${C.border}`,
    background: C.cardSub, color: C.text, fontSize: "13px", outline: "none",
  };

  return (
    <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", flex: 1, width: "100%", minWidth: 0, height: "100%", minHeight: 0, background: C.bg, color: C.text, position: isMobile ? "relative" : undefined }}>
      <style>{`
        @keyframes arSpin { to { transform: rotate(360deg); } }
        .ar-spin { animation: arSpin 0.8s linear infinite; }
        @keyframes arProgress { 0% { transform: translateX(-100%); } 100% { transform: translateX(250%); } }
        .ar-progress-bar { animation: arProgress 1.1s ease-in-out infinite; }
      `}</style>
      {/* ── 왼쪽: 대여자 / 물품 ── */}
      <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: isMobile ? "14px 12px 84px" : "20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
          <Undo2 size={19} style={{ color: C.accentText }} />
          <h1 style={{ fontSize: "18px", fontWeight: 800, margin: 0, flex: 1 }}>{processMode === "대여" ? "대여 확인" : "반납 처리"}</h1>
          <button
            type="button"
            title="QR 라벨 출력 (사번 조회 / SCAN ME)"
            onClick={() => setQrPickerOpen(true)}
            style={{ ...inputStyle, height: "36px", padding: isMobile ? "0 9px" : "0 12px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "6px", fontWeight: 800, color: C.accentText, whiteSpace: "nowrap" }}
          >
            <Printer size={14} /> {printingLookupQr || printingScanMe ? "출력 중" : isMobile ? "QR" : "QR 인쇄"}
          </button>
          <span style={{ fontSize: "11px", color: C.label, display: isMobile ? "none" : undefined }}>15초마다 자동 새로고침</span>
          <button onClick={() => reloadActive()} disabled={activeLoading} title="지금 새로고침" style={{ ...inputStyle, cursor: activeLoading ? "wait" : "pointer", display: "flex", alignItems: "center", gap: "5px", fontWeight: 700, color: C.accentText, opacity: activeLoading ? 0.7 : 1 }}>
            <RotateCcw size={14} className={activeLoading ? "ar-spin" : undefined} />
          </button>
        </div>

        <WarehouseManualRequestsPanel scriptUrl={scriptUrl} isLightMode={isLightMode}
          onCompleted={() => { void loadWarehouse(true); onInventoryChanged?.(); }} />

        {processMode === "반납" && lastReturnedPrint.length > 0 ? (
          <div style={{ marginBottom: "12px", padding: "10px 12px", borderRadius: "11px", border: `1px solid ${C.success}55`, background: C.successSoft, display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "12px", fontWeight: 850, color: C.success }}>마지막 반납 완료 · {countDistinctItemTypes(lastReturnedPrint as any)}종</div>
              <div style={{ marginTop: "2px", fontSize: "10.5px", color: C.label }}>이번에 반납되어 선반으로 돌아갈 물품만 출력합니다.</div>
            </div>
            <button
              type="button"
              disabled={printingReturned}
              onClick={async () => {
                if (printingReturned) return;
                setPrintingReturned(true);
                try {
                  const result = await printReturnedLocationLabel(lastReturnedPrint);
                  showToast(`방금 반납한 위치표 ${result.pages}장을 출력했습니다.`, "ok");
                } catch (error: any) {
                  showToast(error?.message || "반납 위치표 출력에 실패했습니다.", "error");
                } finally {
                  setPrintingReturned(false);
                }
              }}
              style={{ ...inputStyle, height: "36px", padding: "0 11px", background: C.card, color: C.success, cursor: printingReturned ? "wait" : "pointer", display: "inline-flex", alignItems: "center", gap: "5px", fontWeight: 850, whiteSpace: "nowrap", opacity: printingReturned ? 0.65 : 1 }}
            >
              <Printer size={14} /> {printingReturned ? "출력 중" : isMobile ? "위치표" : "방금 반납 위치표"}
            </button>
          </div>
        ) : null}

        {/* 새로 담을 물품의 기본 처리(확인/반납)를 고른다. 장바구니에 이미 담긴 줄은 안 바뀌고,
            줄마다 따로 확인/반납을 바꿀 수도 있다 — 그래서 전환해도 장바구니를 비우지 않는다. */}
        <div style={{ display: "flex", gap: "6px", marginBottom: "6px" }}>
          {([["대여", "📦 대여 확인"], ["반납", "↩️ 반납 처리"]] as const).map(([v, label]) => {
            const on = processMode === v;
            return (
              <button
                key={v}
                onClick={() => setProcessMode(v)}
                style={{
                  flex: 1, padding: "10px", borderRadius: "11px", cursor: "pointer",
                  fontSize: "13px", fontWeight: 800,
                  border: `1.5px solid ${on ? C.accent : C.border}`,
                  background: on ? C.accent : C.card,
                  color: on ? "#fff" : C.label,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: "10.5px", color: C.label, marginBottom: "10px", lineHeight: 1.5 }}>
          {isMobile
            ? "탭에 맞춰 미확인/확인된 물품만 보여줍니다. 담은 뒤엔 아래 장바구니에서 줄마다 확인/반납을 바꿀 수 있습니다."
            : "왼쪽 목록은 탭에 맞춰 미확인/확인된 물품만 따로 보여줍니다. 담은 뒤엔 오른쪽 장바구니에서 줄마다 확인/반납을 바꿀 수 있고, 처리도 각자 따로 됩니다."}
        </div>

        {/* 분야 탭 — 반납 처리 방식이 달라 분리해서 다룬다. */}
        <div style={{ display: "flex", gap: "6px", marginBottom: "12px" }}>
          {(processMode === "대여"
            ? ([["scenario", isMobile ? "🧩 시나리오" : "🧩 시나리오 물품"]] as const)
            : ([["scenario", isMobile ? "🧩 시나리오" : "🧩 시나리오 물품"], ["warehouse", isMobile ? "🔧 COS 물품" : "🔧 COS 물품"]] as const)
          ).map(([v, label]) => {
            const on = category === v;
            return (
              <button
                key={v}
                onClick={() => setCategory(v)}
                style={{
                  flex: 1, padding: "10px", borderRadius: "11px", cursor: "pointer",
                  fontSize: "13px", fontWeight: 800,
                  border: `1px solid ${on ? C.accent : C.border}`,
                  background: on ? C.accentSoft : C.card,
                  color: on ? C.accentText : C.label,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div style={{ position: "relative", marginBottom: "12px" }}>
          <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="대여자 · 사번 · 물품으로 검색..."
            style={{ ...inputStyle, width: "100%", boxSizing: "border-box", paddingLeft: "36px" }}
          />
        </div>

        <div style={{ fontSize: "11.5px", color: C.label, marginBottom: "10px", lineHeight: 1.6 }}>
          {category === "scenario" ? <><b style={{ color: C.accentText }}>우클릭</b> 다른 물품으로 교체 · </> : null}<b style={{ color: C.accentText }}>A</b> {category === "scenario" ? "사진 확인 → 한 번 더 눌러 담기" : "한 개 담기"} · <b style={{ color: C.accentText }}>P</b> 다음 물품 ·{" "}
          <b style={{ color: C.accentText }}>O</b> 이전 물품 · <b style={{ color: C.accentText }}>Q</b> 사진 확인 닫기 · <b style={{ color: C.accentText }}>B</b> 장바구니 처리 (줄마다 확인/반납 따로) ·{" "}
          <b style={{ color: C.accentText }}>C</b> 하나 되돌리기 (꾹 누르면 전체 해제) · <b style={{ color: C.accentText }}>R</b> 기본값 대여 확인 ↔ 반납 전환 · <b style={{ color: C.accentText }}>T</b> {category === "scenario" ? "COS 물품으로 전환" : "시나리오 물품으로 전환"}
        </div>

        {activeLoading && !activeLoaded ? (
          <div style={{ textAlign: "center", padding: "48px 0", color: C.label, fontSize: "13px" }}>불러오는 중...</div>
        ) : borrowers.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 0", color: C.label, fontSize: "13px" }}>
            <Check size={34} style={{ color: C.border, marginBottom: "8px" }} />
            <div>{category === "scenario" && processMode === "대여" ? "확인할 대여 물품이 없습니다." : "미반납 물품이 없습니다."}</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {borrowers.map((g) => {
              const on = !!selectedBorrower && sameBorrowerIdentity(selectedBorrower.name, selectedBorrower.email, g.name, g.email, selectedBorrower.employeeId, g.employeeId);
              const regularItems = g.items.filter((it) => !it.typeLimitExempt);
              const exemptItems = g.items.filter((it) => it.typeLimitExempt);
              const highlightExempt = processMode === "반납" && category === "scenario" && exemptItems.length > 0;
              const regularQty = regularItems.reduce((sum, it) => sum + (it.quantity || 1), 0);
              return (
                <div key={`${g.name}|${g.email}`} style={{ border: `1.5px solid ${highlightExempt ? C.warn : on ? C.accent : C.border}`, borderRadius: "12px", background: highlightExempt ? C.warnSoft : C.card, overflow: "hidden", boxShadow: highlightExempt ? `inset 4px 0 0 ${C.warn}` : undefined }}>
                  <div
                    onClick={() => { setSelectedBorrower(on ? null : { name: g.name, email: g.email, employeeId: g.employeeId }); setCursor(0); }}
                    // 오른쪽 클릭 = 자리 바꾸기. 대여 뒤 자리를 옮긴 사람 때문에 적힌 자리가
                    // 틀리는 일이 잦아서, 목록에서 바로 고칠 수 있게 했다.
                    onContextMenu={(e) => { e.preventDefault(); openSeatEdit(g); }}
                    title="오른쪽 클릭: 자리 바꾸기"
                    style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 14px", cursor: "pointer", background: on ? C.accentSoft : "transparent" }}
                  >
                    <div style={{ width: 32, height: 32, borderRadius: "9px", background: C.accentSoft, color: C.accentText, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <User size={16} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "7px", flexWrap: "wrap" }}>
                        <span style={{ fontSize: "14px", fontWeight: 800 }}>{g.name}</span>
                        {g.employeeId ? <span style={{ fontSize: "11px", fontWeight: 900, color: C.accentText, background: C.accentSoft, border: `1px solid ${C.accent}44`, borderRadius: "7px", padding: "2px 7px", fontFamily: "monospace" }}>사번 {g.employeeId}</span> : null}
                        {/* 동명이인이 실제로 두 명 이상 잡혔을 때만, 누가 누구인지 구분할 수 있게 사번/계정을 띄운다 */}
                        {duplicatedNames.has(g.name) ? (
                          <span
                            title={g.email || "식별 정보 없음 (소속 '기타'이거나 옛 기록)"}
                            style={{ fontSize: "10.5px", fontWeight: 800, color: C.error, background: C.errorSoft, borderRadius: "999px", padding: "2px 8px" }}
                          >
                            {identityHint(g.email) || "식별 정보 없음"}
                          </span>
                        ) : null}
                        {g.seats.map((sname) => (
                          <span key={sname} style={{ fontSize: "10.5px", fontWeight: 800, color: C.warn, background: C.warnSoft, borderRadius: "999px", padding: "2px 8px" }}>
                            📍 {sname}
                          </span>
                        ))}
                      </div>
                      <div style={{ fontSize: "11.5px", color: C.label, marginTop: "2px" }}>
                        {countDistinctItemTypes(regularItems)}종 · {regularQty}개 {category === "scenario" && processMode === "대여" ? "확인 대기" : "미반납"}
                        {exemptItems.length ? (
                          <span style={{ marginLeft: "7px", color: C.warn, fontWeight: 800 }}>
                            한도 제외 {countDistinctItemTypes(exemptItems)}종 · {exemptItems.reduce((sum, it) => sum + (it.quantity || 1), 0)}개
                          </span>
                        ) : null}
                      </div>
                    </div>
                    {on ? <span style={{ fontSize: "11px", fontWeight: 800, color: C.accentText, flexShrink: 0 }}>선택됨</span> : null}
                  </div>

                  {on ? (
                    <div style={{ borderTop: `1px solid ${C.border}`, padding: "8px 10px", display: "flex", flexDirection: "column", gap: "5px" }}>
                      {activeGroups.map((grp) => {
                        // 이 묶음의 첫 물품이 flatItems에서 몇 번째인지 (커서 인덱스 계산용)
                        const baseIdx = flatItems.findIndex((x) => `${x.sheetType}:${x.rowIndex}` === `${grp.items[0].sheetType}:${grp.items[0].rowIndex}`);
                        const grpQty = grp.items.reduce((n, x) => n + (x.quantity || 1), 0);
                        return (
                          <div
                            key={grp.key}
                            style={{
                              marginBottom: "10px",
                              padding: grp.isExemptSection ? "8px" : 0,
                              borderRadius: grp.isExemptSection ? "11px" : undefined,
                              border: grp.isExemptSection ? `1px solid ${C.warn}88` : undefined,
                              background: grp.isExemptSection ? C.warnSoft : undefined,
                            }}
                          >
                            {/* 신청 시각별 구분선 */}
                            <div style={{ display: "flex", alignItems: "center", gap: "7px", padding: "4px 2px 6px" }}>
                              <span style={{ fontSize: "11.5px", fontWeight: 800, color: grp.isExemptSection ? C.warn : C.accentText, flexShrink: 0 }}>
                                {grp.isExemptSection ? "🔓 한도 제외 항목" : `🕘 ${/\d{1,2}:\d{2}/.test(grp.when) ? grp.when : `${grp.when} (시각 정보 없음)`}`}
                              </span>
                              {grp.requestNo && !grp.isExemptSection ? (
                                <button
                                  type="button"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    if (printingRequestNo !== null) return;
                                    setPrintingRequestNo(grp.requestNo!);
                                    try {
                                      const result = await printRequestLabel(grp.requestNo!);
                                      showToast(`대여 물품표 ${result.pages}장을 출력했습니다.`, "ok");
                                    } catch (error: any) {
                                      showToast(error?.message || "라벨 출력에 실패했습니다.", "error");
                                    } finally {
                                      setPrintingRequestNo(null);
                                    }
                                  }}
                                  disabled={printingRequestNo !== null}
                                  title="우분투 서버의 60×40mm 라벨 프린터로 직접 출력"
                                  style={{ height: "25px", padding: "0 8px", borderRadius: "7px", border: `1px solid ${C.border}`, background: C.card, color: C.text, display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "10.5px", fontWeight: 800, cursor: printingRequestNo !== null ? "wait" : "pointer", opacity: printingRequestNo !== null && printingRequestNo !== grp.requestNo ? 0.55 : 1, flexShrink: 0 }}
                                >
                                  <Printer size={12} /> {printingRequestNo === grp.requestNo ? "출력 중" : "인쇄"}
                                </button>
                              ) : null}
                              <span style={{ fontSize: "10.5px", color: C.label, flexShrink: 0 }}>{countDistinctItemTypes(grp.items)}종 · {grpQty}개</span>
                              <div style={{ flex: 1, height: "1px", background: C.border }} />
                            </div>

                            <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                              {grp.items.map((it, j) => {
                                const idx = baseIdx + j;
                                const picked = inCartQty(it);
                                const max = it.quantity || 1;
                                const done = picked >= max;
                                const atCursor = idx === cursor;
                                return (
                                  <div
                                    key={`${it.sheetType}-${it.rowIndex}`}
                                    ref={atCursor ? cursorElRef : undefined}
                                    onClick={() => {
                                      manualPickRequiredRef.current.delete(`${it.sheetType}:${it.rowIndex}`);
                                      setPreview(null);
                                      setCursor(idx);
                                    }}
                                    onContextMenu={(e) => {
                                      if (category === "warehouse") return; // 공구는 교체 개념이 없다
                                      e.preventDefault(); setCursor(idx); openSwap(it);
                                    }}
                                    title={category === "warehouse" ? undefined : "우클릭하면 다른 물품으로 교체할 수 있습니다"}
                                    style={{
                                      display: "flex", alignItems: "center", gap: "8px", padding: "9px 10px", borderRadius: "9px",
                                      cursor: done ? "default" : "pointer",
                                      background: atCursor ? C.accentSoft : done ? C.successSoft : it.typeLimitExempt ? C.warnSoft : C.cardSub,
                                      border: `1px solid ${atCursor ? C.accent : done ? C.success + "55" : it.typeLimitExempt ? C.warn + "99" : "transparent"}`,
                                      boxShadow: atCursor ? `inset 3px 0 0 ${C.accent}` : it.typeLimitExempt ? `inset 3px 0 0 ${C.warn}` : "none",
                                    }}
                                  >
                                    <Package size={13} style={{ color: C.label, flexShrink: 0 }} />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
                                        <span style={{ flex: 1, minWidth: 0, fontSize: "12.5px", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.itemLabel}</span>
                                        {/* 업체 request용 물품은 취급이 달라서, 담기 전에 보이게 한다 */}
                                        {it.requestFor !== undefined ? (
                                          <span
                                            title={`특정 업체 request용 물품${it.requestFor ? `: ${it.requestFor}` : ""}`}
                                            style={{ flexShrink: 0, fontSize: "10px", fontWeight: 800, borderRadius: "999px", padding: "2px 7px", color: C.accentText, background: C.accentSoft, border: `1px solid ${C.accent}44` }}
                                          >
                                            📌 {it.requestFor || "Request"}
                                          </span>
                                        ) : null}
                                        {it.personalOwner !== undefined ? (
                                          <span
                                            title={`개인 물품${it.personalOwner ? `: ${it.personalOwner}` : ""}`}
                                            style={{ flexShrink: 0, fontSize: "10px", fontWeight: 800, borderRadius: "999px", padding: "2px 7px", color: C.accentText, background: C.accentSoft, border: `1px solid ${C.accent}44` }}
                                          >
                                            👤 {it.personalOwner || "개인 물품"}
                                          </span>
                                        ) : null}
                                        {/* 반납 없이 오래 보관되는 request 물품 등, 이 줄만 따로 종류 수 한도에서
                                            빼고 싶을 때 건별로 켜고 끈다(전역 설정이 아니라 이 화면에서 바로). */}
                                        <button
                                          type="button"
                                          onClick={(e) => { e.stopPropagation(); setTypeLimitExemptEdit({ item: it, reason: it.typeLimitExemptReason || "" }); }}
                                          disabled={savingTypeLimitExemptKey === `${it.sheetType}-${it.rowIndex}`}
                                          title={it.typeLimitExempt ? "한도 제외 사유를 수정하거나 제외를 해제합니다" : "이 물품을 종류 수 한도 계산에서 제외합니다"}
                                          style={{
                                            flexShrink: 0, fontSize: "10px", fontWeight: 800, borderRadius: "999px", padding: "2px 7px",
                                            border: `1px solid ${it.typeLimitExempt ? C.warn : C.border}`,
                                            background: it.typeLimitExempt ? C.warnSoft : "transparent",
                                            color: it.typeLimitExempt ? C.warn : C.label,
                                            cursor: savingTypeLimitExemptKey === `${it.sheetType}-${it.rowIndex}` ? "wait" : "pointer",
                                          }}
                                        >
                                          {it.typeLimitExempt ? "🔓 한도 제외 중" : "한도 제외"}
                                        </button>
                                        {/* 종류가 나뉜 물품 — 정해졌으면 어떤 종류인지, 아직이면 확인이 필요하다고 알린다. */}
                                        {it.variantPending ? (
                                          <span
                                            title="신청자가 '종류 상관없음'으로 신청했습니다. 대여 확인 때 실제로 가져간 종류를 골라야 재고가 차감됩니다."
                                            style={{ flexShrink: 0, fontSize: "10px", fontWeight: 800, borderRadius: "999px", padding: "2px 7px", color: C.warn, background: C.warnSoft }}
                                          >
                                            종류 미정
                                          </span>
                                        ) : it.variantUnassigned ? (
                                          <span
                                            title="종류가 생기기 전에 나간 대여 건입니다. 반납 처리할 때 어떤 종류가 돌아왔는지 골라야 합니다."
                                            style={{ flexShrink: 0, fontSize: "10px", fontWeight: 800, borderRadius: "999px", padding: "2px 7px", color: C.warn, background: C.warnSoft }}
                                          >
                                            종류 미지정
                                          </span>
                                        ) : it.variantName ? (
                                          <span style={{ flexShrink: 0, fontSize: "10px", fontWeight: 700, borderRadius: "999px", padding: "2px 7px", color: C.accentText, background: C.accentSoft }}>
                                            {it.variantName}
                                          </span>
                                        ) : null}
                                      </div>
                                      <div style={{ display: "flex", alignItems: "center", gap: "7px", marginTop: "2px", flexWrap: "wrap" }}>
                                        {it.location ? (
                                          <span style={{ fontSize: "10.5px", color: C.warn, fontFamily: "monospace", display: "flex", alignItems: "center", gap: "3px" }}>
                                            <MapPin size={9} /> {it.location}
                                          </span>
                                        ) : null}
                                        <span style={{ fontSize: "10.5px", color: C.label }}>
                                          {String(it.borrowDateTime || it.borrowDate || "").trim() || "시각 미상"}
                                        </span>
                                        {it.shift ? (
                                          <span style={{ fontSize: "9.5px", fontWeight: 800, borderRadius: "999px", padding: "1px 6px", color: it.shift === "night" ? "#6366f1" : C.warn, background: it.shift === "night" ? "rgba(99,102,241,0.14)" : C.warnSoft }}>
                                            {it.shift === "night" ? "🌙" : "☀️"}
                                          </span>
                                        ) : null}
                                        {it.typeLimitExempt ? (
                                          <span style={{ fontSize: "10.5px", color: C.warn, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: "3px" }}>
                                            <AlertTriangle size={10} /> 제외 사유: {it.typeLimitExemptReason || "사유 미등록"}
                                          </span>
                                        ) : null}
                                      </div>
                                    </div>
                                    <span style={{ fontSize: "11.5px", fontWeight: 800, color: done ? C.success : C.label, flexShrink: 0 }}>
                                      {picked} / {max}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* COS 물품 직접 대여 — 실수로 닫히지 않도록 배경 클릭으로는 닫지 않는다 */}
      {whLendOpen ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 4300, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
          <div style={{ width: "min(600px, 100%)", maxHeight: "86vh", display: "flex", flexDirection: "column", background: C.card, borderRadius: "16px", border: `1px solid ${C.border}`, padding: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
              <Package size={17} style={{ color: C.accentText }} />
              <span style={{ fontSize: "15px", fontWeight: 800, flex: 1 }}>COS 물품 직접 대여</span>
              <button onClick={() => setWhLendOpen(false)} title="닫기" style={{ background: "transparent", border: "none", color: C.label, cursor: "pointer" }}><X size={19} /></button>
            </div>

            <div style={{ marginBottom: "10px" }}>
              <RegisteredUserPicker scriptUrl={scriptUrl} name={whLendName} employeeId={whLendEmployeeId} onChange={(nextName, nextId) => { setWhLendName(nextName); setWhLendEmployeeId(nextId); }} isLightMode={isLightMode} placeholder="대여자 이름 검색 후 선택" />
            </div>

            <div style={{ position: "relative", marginBottom: "10px" }}>
              <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
              <input
                value={whLendSearch}
                onChange={(e) => setWhLendSearch(e.target.value)}
                placeholder="물품명 · 위치로 검색"
                style={{ ...inputStyle, width: "100%", boxSizing: "border-box", paddingLeft: "36px" }}
              />
            </div>

            <div style={{ flex: 1, minHeight: "160px", overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: "10px", marginBottom: "12px" }}>
              {whCatalog.length === 0 ? (
                <div style={{ padding: "24px", textAlign: "center", fontSize: "12.5px", color: C.label }}>COS 물품 목록을 불러오는 중입니다...</div>
              ) : (
                whCatalog
                  .filter((it) => !whLendSearch.trim() || smartMatch([it.name, it.location, it.spec], whLendSearch))
                  .slice(0, 60)
                  .map((it) => {
                    const stock = Number(it.stock);
                    const soldOut = !isNaN(stock) && stock <= 0;
                    const picked = whLendCart.find((c) => c.rowIndex === it.rowIndex)?.quantity || 0;
                    return (
                      <div
                        key={it.rowIndex}
                        onClick={() => addWhLend(it)}
                        style={{
                          display: "flex", alignItems: "center", gap: "9px", padding: "9px 12px",
                          borderBottom: `1px solid ${C.border}`, cursor: soldOut ? "not-allowed" : "pointer",
                          opacity: soldOut ? 0.45 : 1, background: picked > 0 ? C.accentSoft : "transparent",
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "12.5px", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</div>
                          <div style={{ fontSize: "10.5px", color: C.warn, fontFamily: "monospace" }}>{it.location}</div>
                        </div>
                        <span style={{ flexShrink: 0, fontSize: "11px", fontWeight: 700, color: soldOut ? C.error : C.success }}>
                          재고 {isNaN(stock) ? "N/A" : stock}
                        </span>
                        {picked > 0 ? <span style={{ flexShrink: 0, fontSize: "11.5px", fontWeight: 800, color: C.accentText }}>{picked}개</span> : null}
                      </div>
                    );
                  })
              )}
            </div>

            {whLendCart.length > 0 ? (
              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: "10px", marginBottom: "10px", display: "flex", flexDirection: "column", gap: "6px", maxHeight: "140px", overflowY: "auto" }}>
                {whLendCart.map((c, idx) => (
                  <div key={c.rowIndex} style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: "12.5px", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                    <button onClick={() => setWhLendCart((prev) => prev.map((x, i) => (i === idx ? { ...x, quantity: x.quantity - 1 } : x)).filter((x) => x.quantity > 0))}
                      style={{ width: 24, height: 24, borderRadius: "7px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", fontSize: "12px", lineHeight: 1 }}>−</button>
                    <span style={{ minWidth: "34px", textAlign: "center", fontSize: "12.5px", fontWeight: 800 }}>{c.quantity}<span style={{ fontSize: "10px", color: C.label }}>/{c.stock}</span></span>
                    <button onClick={() => setWhLendCart((prev) => prev.map((x, i) => (i === idx ? { ...x, quantity: Math.min(x.stock, x.quantity + 1) } : x)))}
                      style={{ width: 24, height: 24, borderRadius: "7px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", fontSize: "12px", lineHeight: 1 }}>+</button>
                  </div>
                ))}
              </div>
            ) : null}

            <input
              value={whLendNote}
              onChange={(e) => setWhLendNote(e.target.value)}
              placeholder="목적 / 메모 (선택)"
              style={{ ...inputStyle, width: "100%", boxSizing: "border-box", marginBottom: "12px" }}
            />

            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={() => setWhLendOpen(false)}
                disabled={whLendSubmitting}
                style={{ flex: 1, padding: "13px", borderRadius: "11px", border: `1px solid ${C.border}`, background: "transparent", color: C.label, cursor: "pointer", fontSize: "13px", fontWeight: 700 }}
              >
                취소
              </button>
              <button
                onClick={submitWhLend}
                disabled={whLendSubmitting || !whLendCart.length || !whLendEmployeeId}
                style={{
                  flex: 2, padding: "13px", borderRadius: "11px", border: "none",
                  background: (whLendCart.length && whLendEmployeeId) ? C.accent : C.border, color: "#fff",
                  cursor: (whLendCart.length && whLendEmployeeId && !whLendSubmitting) ? "pointer" : "not-allowed",
                  fontSize: "14px", fontWeight: 800, opacity: whLendSubmitting ? 0.7 : 1,
                }}
              >
                {whLendSubmitting ? "처리 중..." : `대여 처리하기 (${whLendCart.reduce((n, c) => n + c.quantity, 0)}개)`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* A 1회: 사진 확인 → A 한 번 더: 담기 */}
      {preview ? (
        <div
          onClick={() => setPreview(null)}
          style={{ position: "fixed", inset: 0, zIndex: 4200, background: "rgba(15,23,42,0.62)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(420px, 100%)", background: C.card, borderRadius: "18px", border: `2px solid ${C.accent}`, padding: "20px", textAlign: "center" }}
          >
            {(() => {
              // 실물을 확인하는 화면이라, 그 줄이 어떤 종류인지 알면 물품 대표 사진보다
              // 그 종류의 사진을 보여줘야 맞다. 종류 사진이 없을 때만 대표 사진으로 내려간다.
              const v = preview.item.variantId
                ? (preview.item.variants || []).find((x) => x.id === preview.item.variantId)
                : null;
              const shown = v?.image || preview.item.image;
              const fromVariant = !!v?.image;
              return (
                <>
                  <div style={{ width: "100%", height: "230px", borderRadius: "12px", overflow: "hidden", background: C.cardSub, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "14px", position: "relative" }}>
                    {shown ? (
                      <img src={getGoogleDriveImageUrl(shown)} alt="" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
                    ) : (
                      <div style={{ color: C.label, fontSize: "13px", display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
                        <Package size={34} style={{ opacity: 0.4 }} />
                        등록된 사진이 없습니다
                      </div>
                    )}
                    {v ? (
                      // 지금 보는 사진이 그 종류 사진인지, 종류 사진이 없어 대표 사진을 대신 띄운 건지 알려준다
                      <span style={{
                        position: "absolute", left: 10, top: 10,
                        fontSize: "11px", fontWeight: 800, padding: "3px 9px", borderRadius: "999px",
                        background: fromVariant ? C.accent : C.warnSoft,
                        color: fromVariant ? "#fff" : C.warn,
                        border: fromVariant ? "none" : `1px solid ${C.warn}55`,
                      }}>
                        {fromVariant ? v.name : `${v.name} · 종류 사진 없음`}
                      </span>
                    ) : null}
                  </div>

                  <div style={{ fontSize: "15px", fontWeight: 800, color: C.text, marginBottom: "4px" }}>
                    {preview.item.itemLabel}
                    {v ? (
                      <span style={{ fontSize: "10.5px", fontWeight: 700, padding: "1px 7px", borderRadius: "999px", marginLeft: "5px", background: C.accentSoft, color: C.accentText, border: `1px solid ${C.accent}33` }}>
                        {v.name}
                      </span>
                    ) : null}
                  </div>
                </>
              );
            })()}
            <div style={{ fontSize: "12px", color: C.label, marginBottom: "16px" }}>
              {preview.item.location ? `📍 ${preview.item.location} · ` : ""}
              {inCartQty(preview.item)} / {preview.item.quantity || 1}개 담김
            </div>

            <div style={{ display: "flex", gap: "9px" }}>
              <button
                onClick={() => setPreview(null)}
                style={{ flex: 1, padding: "13px", borderRadius: "11px", border: `1px solid ${C.border}`, background: "transparent", color: C.label, cursor: "pointer", fontSize: "13px", fontWeight: 700 }}
              >
                취소 (Q)
              </button>
              <button
                onClick={() => { const it = preview.item; setPreview(null); addOne(it); }}
                style={{ flex: 2, padding: "13px", borderRadius: "11px", border: "none", background: C.accent, color: "#fff", cursor: "pointer", fontSize: "14px", fontWeight: 800 }}
              >
                맞습니다 · 담기 (A)
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 한도 제외는 판단 근거를 함께 남긴다. 기존 제외 건은 여기서 사유를 보완하거나 해제할 수 있다. */}
      {typeLimitExemptEdit ? (
        <div
          onClick={() => !savingTypeLimitExemptKey && setTypeLimitExemptEdit(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", zIndex: 1100 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(460px, 100%)", background: C.card, border: `1px solid ${C.warn}88`, borderRadius: "16px", padding: "20px", boxShadow: "0 18px 50px rgba(0,0,0,0.28)" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "7px" }}>
              <AlertTriangle size={18} style={{ color: C.warn }} />
              <span style={{ fontSize: "15px", fontWeight: 800, flex: 1 }}>종류 수 한도 제외</span>
              <button onClick={() => setTypeLimitExemptEdit(null)} disabled={!!savingTypeLimitExemptKey} style={{ background: "transparent", border: "none", color: C.label, cursor: "pointer", display: "flex" }}>
                <X size={18} />
              </button>
            </div>
            <div style={{ padding: "9px 11px", borderRadius: "9px", background: C.warnSoft, color: C.warn, fontSize: "12px", fontWeight: 800, marginBottom: "14px" }}>
              {typeLimitExemptEdit.item.itemLabel}
            </div>
            <label style={{ display: "block", fontSize: "11px", fontWeight: 800, color: C.label, marginBottom: "6px" }}>한도 제외 사유 (필수)</label>
            <textarea
              autoFocus
              value={typeLimitExemptEdit.reason}
              onChange={(e) => setTypeLimitExemptEdit((prev) => prev ? { ...prev, reason: e.target.value } : prev)}
              placeholder="예: 업체 요청용 장기 보관 물품"
              maxLength={300}
              rows={4}
              disabled={!!savingTypeLimitExemptKey}
              style={{ width: "100%", boxSizing: "border-box", resize: "vertical", padding: "10px 12px", borderRadius: "9px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.text, fontSize: "13px", fontFamily: "inherit", lineHeight: 1.5 }}
            />
            <div style={{ fontSize: "10.5px", color: C.label, marginTop: "5px" }}>입력한 사유는 분리된 한도 제외 목록에 계속 표시됩니다.</div>
            <div style={{ display: "flex", gap: "9px", marginTop: "18px" }}>
              {typeLimitExemptEdit.item.typeLimitExempt ? (
                <button
                  onClick={() => saveTypeLimitExempt(false)}
                  disabled={!!savingTypeLimitExemptKey}
                  style={{ flex: 1, padding: "11px", borderRadius: "10px", border: `1px solid ${C.border}`, background: "transparent", color: C.text, fontSize: "12px", fontWeight: 800, cursor: savingTypeLimitExemptKey ? "wait" : "pointer" }}
                >
                  한도에 다시 포함
                </button>
              ) : (
                <button onClick={() => setTypeLimitExemptEdit(null)} style={{ flex: 1, padding: "11px", borderRadius: "10px", border: `1px solid ${C.border}`, background: "transparent", color: C.text, fontSize: "13px", fontWeight: 700, cursor: "pointer" }}>
                  취소
                </button>
              )}
              <button
                onClick={() => saveTypeLimitExempt(true)}
                disabled={!!savingTypeLimitExemptKey || !typeLimitExemptEdit.reason.trim()}
                style={{ flex: 2, padding: "11px", borderRadius: "10px", border: "none", background: C.warn, color: "#fff", fontSize: "13px", fontWeight: 800, cursor: savingTypeLimitExemptKey ? "wait" : "pointer", opacity: typeLimitExemptEdit.reason.trim() ? 1 : 0.55 }}
              >
                {savingTypeLimitExemptKey ? "저장 중…" : typeLimitExemptEdit.item.typeLimitExempt ? "사유 저장" : "한도 제외로 분리"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 자리 바꾸기 — 이름을 오른쪽 클릭하면 열린다.
          그 사람의 "아직 안 돌아온" 기록들의 자리만 한꺼번에 고친다(지난 기록은 그대로 둔다). */}
      {seatEdit ? (
        <div
          onClick={() => !seatSaving && setSeatEdit(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", zIndex: 1000 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(420px, 100%)", background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "20px" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
              <MapPin size={17} style={{ color: C.accent }} />
              <span style={{ fontSize: "15px", fontWeight: 800, flex: 1 }}>{seatEdit.name}님 자리 바꾸기</span>
              <button onClick={() => setSeatEdit(null)} style={{ background: "transparent", border: "none", color: C.label, cursor: "pointer", display: "flex" }}>
                <X size={18} />
              </button>
            </div>
            <div style={{ fontSize: "11.5px", color: C.label, marginBottom: "14px", lineHeight: 1.6 }}>
              아직 반납되지 않은 <b style={{ color: C.text }}>{seatEdit.rows.length}건</b>의 자리를 바꿉니다.
              이미 반납된 기록은 그대로 둡니다.
            </div>

            <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: C.label, marginBottom: "5px" }}>층</label>
            <select
              value={seatEdit.floor}
              onChange={(e) => setSeatEdit((p) => (p ? { ...p, floor: e.target.value, unit: "" } : p))}
              style={{ width: "100%", padding: "9px 11px", borderRadius: "9px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.text, fontSize: "13px", fontFamily: "inherit" }}
            >
              <option value="">층 없음</option>
              {seatMap.floors.map((f) => (
                <option key={f.id} value={f.name || f.id}>{f.name || f.id}</option>
              ))}
            </select>

            <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: C.label, margin: "12px 0 5px" }}>유닛</label>
            <select
              value={seatEdit.unit}
              onChange={(e) => setSeatEdit((p) => (p ? { ...p, unit: e.target.value } : p))}
              disabled={!seatEdit.floor}
              style={{ width: "100%", padding: "9px 11px", borderRadius: "9px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.text, fontSize: "13px", fontFamily: "inherit", opacity: seatEdit.floor ? 1 : 0.55 }}
            >
              <option value="">{seatEdit.floor ? "유닛 없음" : "먼저 층을 고르세요"}</option>
              {(seatMap.floors.find((f) => (f.name || f.id) === seatEdit.floor)?.units || []).map((u) => (
                <option key={u.label} value={u.label}>{u.label}</option>
              ))}
            </select>

            <div style={{ display: "flex", gap: "9px", marginTop: "18px" }}>
              <button
                onClick={() => setSeatEdit(null)}
                disabled={seatSaving}
                style={{ flex: 1, padding: "11px", borderRadius: "10px", border: `1px solid ${C.border}`, background: "transparent", color: C.text, fontSize: "13px", fontWeight: 700, cursor: "pointer" }}
              >
                취소
              </button>
              <button
                onClick={saveSeat}
                disabled={seatSaving}
                style={{ flex: 2, padding: "11px", borderRadius: "10px", border: "none", background: C.accent, color: "#fff", fontSize: "13px", fontWeight: 800, cursor: seatSaving ? "wait" : "pointer" }}
              >
                {seatSaving ? "바꾸는 중…" : `${seatEdit.rows.length}건 자리 바꾸기`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 물품 교체 모달 */}
      {/* 깨질 위험 / 화재 위험 / 특정 업체 request용 물품 확인 (확인 후 실제 대여 처리) */}
      {hazardModal ? (
        <HazardConfirmModal
          items={hazardModal.items}
          C={C}
          onConfirm={() => { const fn = hazardModal.onConfirm; setHazardModal(null); fn(); }}
        />
      ) : null}

      {/* ── 장바구니 일괄 처리 확인 모달 ── */}
      {/* 종류 확인 — 신청자가 "종류 상관없음"으로 빌린 줄만 여기 뜬다.
          담당자가 실물을 보고 고르면 그때 그 종류의 재고가 처음으로 차감된다. */}
      {variantPrompt ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 4600, background: "rgba(15,23,42,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", backdropFilter: "blur(2px)" }}>
          <div style={{ width: "min(520px, 100%)", maxHeight: "88vh", display: "flex", flexDirection: "column", background: C.card, borderRadius: "16px", border: `1px solid ${C.border}`, padding: "20px", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
              <Package size={19} style={{ color: C.accentText }} />
              <span style={{ fontSize: "16px", fontWeight: 800, flex: 1 }}>
                {variantPrompt.lines.every((l) => l.kind === "반납") ? "어떤 종류가 반납되나요?" : "어떤 종류인가요?"}
              </span>
              <button onClick={() => setVariantPrompt(null)} style={{ background: "transparent", border: "none", color: C.label, cursor: "pointer" }}><X size={19} /></button>
            </div>
            <div style={{ fontSize: "11.5px", color: C.label, marginBottom: "14px", lineHeight: 1.6 }}>
              실물을 확인해 종류를 골라주세요. 줄마다 이유가 다를 수 있어 아래에 따로 표시했습니다.
            </div>

            <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px" }}>
              {variantPrompt.lines.map((ln) => (
                <div key={ln.key} style={{ padding: "12px 14px", borderRadius: "10px", background: C.cardSub, border: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: "13px", fontWeight: 800, color: C.text, marginBottom: "3px" }}>
                    {ln.label} <span style={{ color: C.label, fontWeight: 600 }}>· {ln.qty}개</span>
                  </div>
                  <div style={{ fontSize: "11px", color: C.label, marginBottom: "8px", lineHeight: 1.5 }}>
                    {ln.kind === "반납"
                      ? "종류가 생기기 전에 나간 대여 건입니다. 돌아온 종류를 고르면 그 종류의 재고로 되돌립니다."
                      : "신청자가 \"종류 상관없음\"으로 신청했습니다. 고른 종류의 재고가 이 시점에 차감됩니다."}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {ln.variants.map((v) => {
                      const picked = variantPrompt.choice[ln.key] === v.id;
                      // 반납은 재고를 되돌리는 쪽이라 남은 재고가 적어도 고를 수 있어야 한다.
                      const short = ln.kind !== "반납" && v.stock < ln.qty;
                      return (
                        <button
                          key={v.id}
                          disabled={short}
                          onClick={() => setVariantPrompt((p) => (p ? { ...p, choice: { ...p.choice, [ln.key]: v.id } } : p))}
                          style={{
                            padding: "8px 12px", borderRadius: "9px", cursor: short ? "not-allowed" : "pointer",
                            border: `1.5px solid ${picked ? C.accent : C.border}`,
                            background: picked ? C.accentSoft : C.card,
                            color: short ? C.label : picked ? C.accentText : C.text,
                            fontSize: "12.5px", fontWeight: 700, opacity: short ? 0.5 : 1,
                          }}
                        >
                          {v.name} <span style={{ fontWeight: 600, color: C.label }}>(재고 {v.stock})</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
              <button
                onClick={() => setVariantPrompt(null)}
                style={{ flex: 1, padding: "12px", borderRadius: "10px", border: `1px solid ${C.border}`, background: "none", color: C.label, cursor: "pointer", fontSize: "13px", fontWeight: 700 }}
              >
                취소
              </button>
              <button
                onClick={() => {
                  const p = variantPrompt;
                  if (!p) return;
                  const missing = p.lines.find((ln) => !p.choice[ln.key]);
                  if (missing) { showToast(`'${missing.label}'의 종류를 선택해주세요.`, "warn"); return; }
                  // 고른 종류를 장바구니 줄에 박아 넣고, 원래의 확인 모달로 이어간다.
                  const merged = p.batch.map((c) => (p.choice[c.key] ? { ...c, variantId: p.choice[c.key] } : c));
                  setCart((prev) => prev.map((c) => (p.choice[c.key] ? { ...c, variantId: p.choice[c.key] } : c)));
                  setVariantPrompt(null);
                  finalizeBatch(merged, p.reborrow, p.transfer);
                }}
                style={{ flex: 2, padding: "12px", borderRadius: "10px", border: "none", background: C.accent, color: "#fff", cursor: "pointer", fontSize: "13px", fontWeight: 800 }}
              >
                종류 확정하고 계속
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 물품 교체 · 종류 선택 */}
      {swapVariantPick ? (
        <div
          onClick={() => setSwapVariantPick(null)}
          style={{ position: "fixed", inset: 0, zIndex: 4750, background: "rgba(15,23,42,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", backdropFilter: "blur(2px)" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(440px, 100%)", maxHeight: "82vh", overflowY: "auto", background: C.card, borderRadius: "16px", border: `1px solid ${C.border}`, padding: "18px" }}
          >
            <div style={{ fontSize: "15px", fontWeight: 800, color: C.text, marginBottom: "2px" }}>어떤 종류로 교체하나요?</div>
            <div style={{ fontSize: "12px", color: C.label, marginBottom: "14px" }}>{swapVariantPick.name}</div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {(swapVariantPick.variants || []).map((v) => {
                const out = v.stock <= 0;
                return (
                  <button
                    key={v.id}
                    disabled={out}
                    onClick={() => {
                      setSwapItemId(swapVariantPick.id);
                      setSwapVariant({ id: v.id, name: v.name, stock: v.stock });
                      setSwapQty((q) => Math.min(q, v.stock) || 1);
                      setSwapVariantPick(null);
                    }}
                    style={{
                      display: "flex", alignItems: "center", gap: "12px", padding: "10px 12px",
                      borderRadius: "11px", border: `1.5px solid ${C.border}`, background: C.cardSub,
                      color: out ? C.label : C.text, cursor: out ? "not-allowed" : "pointer",
                      fontSize: "13px", fontWeight: 700, textAlign: "left", opacity: out ? 0.55 : 1,
                    }}
                  >
                    <span style={{ width: "48px", height: "48px", flexShrink: 0, borderRadius: "9px", overflow: "hidden", background: C.card, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {v.image
                        ? <img src={getThumbImageUrl(v.image)} alt="" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                        : <Package size={18} style={{ color: C.label, opacity: 0.45 }} />}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block" }}>{v.name}</span>
                      <span style={{ display: "block", fontSize: "11.5px", color: C.label, fontWeight: 600, marginTop: "2px" }}>
                        {out ? "재고 없음" : `재고 ${v.stock}개`}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => setSwapVariantPick(null)}
              style={{ marginTop: "14px", width: "100%", padding: "11px", borderRadius: "10px", border: `1px solid ${C.border}`, background: "none", color: C.label, cursor: "pointer", fontSize: "12.5px", fontWeight: 700 }}
            >
              닫기
            </button>
          </div>
        </div>
      ) : null}

      {/* 관리자 추가 대여 · 종류 선택 (사진을 보고 고른다) */}
      {lendVariantPick ? (
        <div
          onClick={() => setLendVariantPick(null)}
          style={{ position: "fixed", inset: 0, zIndex: 4700, background: "rgba(15,23,42,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", backdropFilter: "blur(2px)" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(440px, 100%)", maxHeight: "82vh", overflowY: "auto", background: C.card, borderRadius: "16px", border: `1px solid ${C.border}`, padding: "18px" }}
          >
            <div style={{ fontSize: "15px", fontWeight: 800, color: C.text, marginBottom: "2px" }}>어떤 종류를 대여하나요?</div>
            <div style={{ fontSize: "12px", color: C.label, marginBottom: "14px" }}>{lendVariantPick.name}</div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {(lendVariantPick.variants || []).map((v) => {
                const taken = lendCart.filter((c) => c.id === lendVariantPick.id && c.variantId === v.id).reduce((n, c) => n + c.quantity, 0);
                const out = v.stock <= 0;
                return (
                  <button
                    key={v.id}
                    disabled={out}
                    onClick={() => addLendVariant(lendVariantPick, v)}
                    style={{
                      display: "flex", alignItems: "center", gap: "12px", padding: "10px 12px",
                      borderRadius: "11px", border: `1.5px solid ${C.border}`, background: C.cardSub,
                      color: out ? C.label : C.text, cursor: out ? "not-allowed" : "pointer",
                      fontSize: "13px", fontWeight: 700, textAlign: "left", opacity: out ? 0.55 : 1,
                    }}
                  >
                    <span style={{ width: "48px", height: "48px", flexShrink: 0, borderRadius: "9px", overflow: "hidden", background: C.card, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {v.image
                        ? <img src={getThumbImageUrl(v.image)} alt="" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                        : <Package size={18} style={{ color: C.label, opacity: 0.45 }} />}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block" }}>{v.name}{taken ? ` · 담김 ${taken}개` : ""}</span>
                      <span style={{ display: "block", fontSize: "11.5px", color: C.label, fontWeight: 600, marginTop: "2px" }}>
                        {out ? "재고 없음" : `재고 ${v.stock}개`}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => setLendVariantPick(null)}
              style={{ marginTop: "14px", width: "100%", padding: "11px", borderRadius: "10px", border: `1px solid ${C.border}`, background: "none", color: C.label, cursor: "pointer", fontSize: "12.5px", fontWeight: 700 }}
            >
              닫기
            </button>
          </div>
        </div>
      ) : null}

      {/* -- 파손 반납 1단계: 몇 개가 파손인지 --------------------------------
          담은 수량 전부가 기본값이고, 일부만 파손이면 줄여 입력한다.
          나머지 수량은 그대로 정상 반납된다. */}
      {damageFlow && damageFlow.step === "qty" ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 4650, background: "rgba(15,23,42,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", backdropFilter: "blur(2px)" }}>
          <div style={{ width: "min(480px, 100%)", maxHeight: "88vh", display: "flex", flexDirection: "column", background: C.card, borderRadius: "16px", border: `1px solid ${C.border}`, padding: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
              <AlertTriangle size={19} style={{ color: C.error }} />
              <span style={{ fontSize: "16px", fontWeight: 800, flex: 1 }}>파손 수량</span>
              <button onClick={() => setDamageFlow(null)} style={{ background: "transparent", border: "none", color: C.label, cursor: "pointer" }}><X size={19} /></button>
            </div>
            <div style={{ fontSize: "11.5px", color: C.label, marginBottom: "14px", lineHeight: 1.6 }}>
              담은 수량 중 몇 개가 파손인지 입력해주세요. 나머지는 그대로 정상 반납됩니다.
            </div>

            <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: "8px" }}>
              {damageFlow.lines.map((ln, i) => (
                <div key={ln.key} style={{ padding: "10px 12px", borderRadius: "10px", background: C.cardSub, border: `1px solid ${C.border}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "12.5px", fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ln.label}</div>
                    <div style={{ fontSize: "10.5px", color: C.label, marginTop: "2px" }}>반납 {ln.max}개 중</div>
                  </div>
                  <button
                    onClick={() => setDamageFlow((prev) => (prev ? { ...prev, lines: prev.lines.map((x, xi) => (xi === i ? { ...x, qty: Math.max(1, x.qty - 1) } : x)) } : prev))}
                    style={{ width: 28, height: 28, borderRadius: "8px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", flexShrink: 0 }}
                  >-</button>
                  <span style={{ minWidth: "34px", textAlign: "center", fontSize: "14px", fontWeight: 800, color: C.error }}>{ln.qty}</span>
                  <button
                    onClick={() => setDamageFlow((prev) => (prev ? { ...prev, lines: prev.lines.map((x, xi) => (xi === i ? { ...x, qty: Math.min(x.max, x.qty + 1) } : x)) } : prev))}
                    disabled={ln.qty >= ln.max}
                    style={{ width: 28, height: 28, borderRadius: "8px", border: `1px solid ${C.border}`, background: C.card, color: ln.qty >= ln.max ? C.label : C.text, cursor: ln.qty >= ln.max ? "not-allowed" : "pointer", flexShrink: 0 }}
                  >+</button>
                  </div>

                  {/* 파손품을 버리고 대체품을 계속 쓸지 — 재고와 대여중 수량이 갈리는 지점이라 반드시 물어본다. */}
                  <div style={{ display: "flex", gap: "6px", marginTop: "10px" }}>
                    {([false, true] as const).map((keep) => {
                      const on = !!ln.keepBorrowed === keep;
                      return (
                        <button
                          key={String(keep)}
                          onClick={() => setDamageFlow((prev) => (prev ? { ...prev, lines: prev.lines.map((x, xi) => (xi === i ? { ...x, keepBorrowed: keep } : x)) } : prev))}
                          style={{
                            // 전역 버튼 스타일이 자식을 가로로 붙여버려서 제목/설명이 한 줄로 엉켰다 —
                            // 여기서 세로 배치를 명시한다.
                            display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "3px",
                            flex: 1, padding: "9px 10px", borderRadius: "8px", cursor: "pointer", textAlign: "left",
                            border: `1px solid ${on ? C.accent : C.border}`,
                            background: on ? C.accentSoft : C.card,
                            color: C.text,
                          }}
                        >
                          <div style={{ fontSize: "11.5px", fontWeight: 800, whiteSpace: "nowrap" }}>{keep ? "교체해서 계속 사용" : "반납 종료"}</div>
                          <div style={{ fontSize: "10px", color: C.label, lineHeight: 1.45 }}>
                            {keep
                              ? `파손품 폐기 + 대체품 ${ln.qty}개 반출 · 대여중 ${ln.qty}개 유지`
                              : `파손품 폐기 · 대여 종료 (대여중 0)`}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* 대체품 종류 — 원본과 다른 종류를 내주는 경우가 잦아 교체일 때만 따로 묻는다.
                      여기서 고른 종류의 재고가 빠지고, 남는 대여 줄의 종류도 이걸로 바뀐다. */}
                  {ln.keepBorrowed && ln.variants.length ? (
                    <div style={{ marginTop: "8px" }}>
                      <div style={{ fontSize: "10.5px", color: C.label, marginBottom: "4px" }}>새로 내주는 종류</div>
                      <select
                        value={ln.replacementVariantId || ""}
                        onChange={(e) =>
                          setDamageFlow((prev) => (prev ? { ...prev, lines: prev.lines.map((x, xi) => (xi === i ? { ...x, replacementVariantId: Number(e.target.value) || undefined } : x)) } : prev))
                        }
                        style={{ ...inputStyle, width: "100%", boxSizing: "border-box", fontSize: "12px", padding: "8px 10px" }}
                      >
                        <option value="">종류를 골라주세요</option>
                        {ln.variants.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name} (재고 {v.stock}개)
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
              <button onClick={() => setDamageFlow(null)} style={{ flex: 1, padding: "12px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.text, fontSize: "13px", fontWeight: 700, cursor: "pointer" }}>취소</button>
              <button
                onClick={() => {
                  // 대체품 종류를 안 고르면 미확인 재고에서 깎여 장부가 어긋난다 — 여기서 막는다.
                  const missing = damageFlow.lines.find((ln) => ln.keepBorrowed && ln.variants.length && !ln.replacementVariantId);
                  if (missing) { showToast(`'${missing.label}'의 대체품 종류를 골라주세요.`, "warn"); return; }
                  setDamageFlow((prev) => (prev ? { ...prev, step: "form" } : prev));
                }}
                style={{ flex: 2, padding: "12px", borderRadius: "10px", border: "none", background: C.accent, color: "#fff", fontSize: "13px", fontWeight: 800, cursor: "pointer" }}
              >
                다음 - 불량 로그 작성
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* -- 파손 반납 2단계: 불량 로그 등록 (불량 로그 페이지와 같은 항목) -- */}
      {damageFlow && damageFlow.step === "form" ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 4650, background: "rgba(15,23,42,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", backdropFilter: "blur(2px)" }}>
          <div style={{ width: "min(520px, 100%)", maxHeight: "90vh", overflowY: "auto", background: C.card, borderRadius: "16px", border: `1px solid ${C.border}`, padding: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
              <AlertTriangle size={19} style={{ color: C.error }} />
              <span style={{ fontSize: "16px", fontWeight: 800, flex: 1 }}>불량 로그 등록</span>
              <button onClick={() => setDamageFlow(null)} style={{ background: "transparent", border: "none", color: C.label, cursor: "pointer" }}><X size={19} /></button>
            </div>
            <div style={{ fontSize: "11.5px", color: C.label, marginBottom: "14px", lineHeight: 1.6 }}>
              아래 내용으로 불량 로그에 등록되고, 그 수량만큼 재고에서 빠집니다.
              여기서 찍은 사진은 <b style={{ color: C.text }}>반납 사진이 아니라 불량 로그</b>에 저장됩니다.
            </div>

            <div style={{ padding: "10px 12px", borderRadius: "10px", background: C.errorSoft, border: `1px solid ${C.border}`, marginBottom: "14px" }}>
              {damageFlow.lines.map((ln) => (
                <div key={ln.key} style={{ fontSize: "12px", fontWeight: 700, color: C.text }}>{ln.label} · {ln.qty}개</div>
              ))}
            </div>

            <label style={{ fontSize: "12.5px", fontWeight: 700, display: "block", marginBottom: "6px" }}>불량 유형</label>
            <select
              value={damageFlow.defectType}
              onChange={(e) => setDamageFlow((prev) => (prev ? { ...prev, defectType: e.target.value } : prev))}
              style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.text, fontSize: "13px", marginBottom: "12px" }}
            >
              <option value="파손">파손 (Damaged)</option>
              <option value="오염">오염 (Contaminated)</option>
              <option value="기능 오작동">기능 오작동 (Malfunctioning)</option>
              <option value="기타">기타 (Others)</option>
            </select>

            <label style={{ fontSize: "12.5px", fontWeight: 700, display: "block", marginBottom: "6px" }}>파손자</label>
            <input
              value={damageFlow.culprit}
              onChange={(e) => setDamageFlow((prev) => (prev ? { ...prev, culprit: e.target.value } : prev))}
              placeholder="파손한 사람 (비워두면 기록되지 않습니다)"
              style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.text, fontSize: "13px", marginBottom: "12px", boxSizing: "border-box" }}
            />

            <label style={{ fontSize: "12.5px", fontWeight: 700, display: "block", marginBottom: "6px" }}>상세 내용</label>
            <textarea
              value={damageFlow.note}
              onChange={(e) => setDamageFlow((prev) => (prev ? { ...prev, note: e.target.value } : prev))}
              placeholder="어떻게 파손됐는지 간단히"
              style={{ width: "100%", minHeight: "64px", resize: "none", padding: "10px 12px", borderRadius: "8px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.text, fontSize: "13px", marginBottom: "12px", boxSizing: "border-box" }}
            />

            <label style={{ fontSize: "12.5px", fontWeight: 700, display: "block", marginBottom: "6px" }}>조치 사항</label>
            <input
              value={damageFlow.actionTaken}
              onChange={(e) => setDamageFlow((prev) => (prev ? { ...prev, actionTaken: e.target.value } : prev))}
              placeholder="폐기 / 수리 요청 등"
              style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.text, fontSize: "13px", marginBottom: "14px", boxSizing: "border-box" }}
            />

            <div style={{ fontSize: "12.5px", fontWeight: 700, marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
              <Camera size={14} /> 파손 사진 (필수)
            </div>
            {damageFlow.photo ? (
              <>
                <img src={damageFlow.photo} alt="파손 사진" style={{ width: "100%", maxHeight: "220px", objectFit: "cover", borderRadius: "10px", border: `1px solid ${C.border}`, display: "block" }} />
                <button
                  onClick={() => { setDamageFlow((prev) => (prev ? { ...prev, photo: "" } : prev)); setStreamReady(false); setCameraError(""); }}
                  style={{ width: "100%", marginTop: "8px", padding: "10px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.text, fontSize: "12.5px", fontWeight: 700, cursor: "pointer" }}
                >
                  다시 찍기
                </button>
              </>
            ) : (
              <div>
                <div style={{ borderRadius: "10px", overflow: "hidden", border: `1px solid ${C.border}`, background: C.cardSub, minHeight: "120px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {streamUrl ? (
                    <img
                      key={streamUrl}
                      ref={streamImgRef}
                      src={streamUrl}
                      alt="카메라 미리보기"
                      // 스트림을 다른 포트에서 받으므로 이게 없으면 캔버스가 오염돼 사진을 저장할 수 없다.
                      crossOrigin="anonymous"
                      onLoad={() => { cameraAutoRefreshRef.current = 0; setStreamReady(true); }}
                      onError={onStreamError}
                      style={{ width: "100%", maxHeight: "220px", objectFit: "cover", display: streamReady ? "block" : "none" }}
                    />
                  ) : null}
                  {!streamReady ? <span style={{ fontSize: "12px", color: C.label, padding: "24px" }}>카메라 준비 중...</span> : null}
                </div>
                <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                  <button onClick={restartCameraServerAndStream} title="브라우저 연결과 서버의 카메라 프로세스를 모두 재시작합니다" style={{ padding: "12px 13px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.accentText, fontSize: "12px", fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "5px", whiteSpace: "nowrap" }}>
                    <RotateCcw size={14} /> 다시 연결
                  </button>
                  <button
                    onClick={() => captureFromStream("damage")}
                    disabled={!streamReady}
                    style={{ flex: 1, padding: "12px", borderRadius: "10px", border: "none", background: C.accent, color: "#fff", fontSize: "13px", fontWeight: 800, cursor: streamReady ? "pointer" : "default", opacity: streamReady ? 1 : 0.5, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}
                  >
                    <Camera size={15} /> 이 화면으로 촬영
                  </button>
                </div>
                {cameraError ? <div style={{ marginTop: "6px", fontSize: "11px", color: C.error }}>{cameraError}</div> : null}
              </div>
            )}

            <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
              <button
                onClick={() => setDamageFlow((prev) => (prev ? { ...prev, step: "qty" } : prev))}
                style={{ flex: 1, padding: "12px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.text, fontSize: "13px", fontWeight: 700, cursor: "pointer" }}
              >
                이전
              </button>
              <button
                onClick={() => {
                  const f = damageFlow;
                  if (!f) return;
                  if (!f.photo) { showToast("파손 사진을 먼저 촬영해주세요.", "warn"); return; }
                  const damage: DamagePayload = {
                    items: f.lines.map((ln) => ({
                      itemId: ln.itemId,
                      itemName: ln.itemName,
                      qty: ln.qty,
                      // 교체는 "새로 나가는 물건"의 종류로 깎아야 한다.
                      variantId: ln.keepBorrowed ? ln.replacementVariantId : ln.variantId,
                      // 교체 건은 그 수량이 애초에 선반으로 돌아오지 않았다 — 되돌린 적이 없으니
                      // noStock(이중 차감 방지) 규칙 대상이 아니고, 대체품이 나간 만큼 깎는 게 맞다.
                      noStock: ln.keepBorrowed ? false : ln.noStock,
                      keepBorrowed: ln.keepBorrowed,
                      rentalSheetType: ln.sheetType,
                      rentalRowIndex: ln.rowIndex,
                    })),
                    defectType: f.defectType,
                    note: f.note.trim(),
                    actionTaken: f.actionTaken.trim(),
                    culprit: f.culprit.trim(),
                    photo: f.photo,
                  };
                  setDamageFlow(null);
                  finalizeBatch(f.batch, f.reborrow, f.transfer, damage);
                }}
                disabled={!damageFlow.photo}
                style={{
                  flex: 2, padding: "12px", borderRadius: "10px", border: "none",
                  background: damageFlow.photo ? C.error : C.border,
                  color: damageFlow.photo ? "#fff" : C.label,
                  fontSize: "13px", fontWeight: 800, cursor: damageFlow.photo ? "pointer" : "not-allowed",
                }}
              >
                확인 화면으로
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmBatch ? (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 4500, background: "rgba(15,23,42,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", backdropFilter: "blur(2px)" }}
        >
          <div
            style={{ width: "min(520px, 100%)", maxHeight: "88vh", display: "flex", flexDirection: "column", background: C.card, borderRadius: "16px", border: `1px solid ${C.border}`, padding: "20px", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.3)" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
              <Check size={19} style={{ color: C.success }} />
              <span style={{ fontSize: "16px", fontWeight: 800, flex: 1 }}>장바구니 처리 확인</span>
              <button onClick={() => setConfirmBatch(null)} style={{ background: "transparent", border: "none", color: C.label, cursor: "pointer" }}><X size={19} /></button>
            </div>

            <div style={{ padding: "12px 14px", borderRadius: "10px", background: C.accentSoft, border: `1px solid ${C.border}`, marginBottom: "12px" }}>
              <div style={{ fontSize: "13.5px", fontWeight: 800, color: C.accentText, marginBottom: "4px" }}>
                {confirmBatch.parts.join(" · ")} (총 {confirmBatch.batch.reduce((n, c) => n + c.qty, 0)}개)
              </div>
              <div style={{ fontSize: "11.5px", color: C.label }}>
                선택한 항목들을 DB에 반영하고 처리를 완료할까요?
              </div>
              {confirmBatch.reborrow ? (
                <div style={{ marginTop: "8px", fontSize: "11.5px", fontWeight: 700, color: C.warn }}>
                  🔄 반납 후 재대여 적용 (대여일 갱신)
                </div>
              ) : null}
              {confirmBatch.transfer ? (
                <div style={{ marginTop: "8px", fontSize: "11.5px", fontWeight: 700, color: C.error }}>
                  🤝 {confirmBatch.transfer.name}님에게 양도
                  <span style={{ fontWeight: 500, color: C.label, fontFamily: "monospace" }}> (사번 {confirmBatch.transfer.employeeId})</span>
                  <span style={{ display: "block", fontWeight: 500, color: C.label, marginTop: "2px" }}>
                    반납으로 표시된 줄이 이 사람 명의로 새로 대여 기록됩니다. 실물은 창고로 돌아오지 않습니다.
                  </span>
                </div>
              ) : null}
            </div>

            {batchNeedsPhoto ? (
              <div style={{ marginBottom: "14px" }}>
                <div style={{ fontSize: "12px", fontWeight: 800, color: C.text, marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
                  <Camera size={13} /> 반납 사진 (필수)
                </div>
                {confirmPhoto ? (
                  <div style={{ position: "relative" }}>
                    <img src={confirmPhoto} alt="반납 사진" style={{ width: "100%", maxHeight: "220px", objectFit: "cover", borderRadius: "10px", border: `1px solid ${C.border}`, display: "block" }} />
                    <button
                      onClick={retakePhoto}
                      style={{ position: "absolute", top: "8px", right: "8px", padding: "6px 10px", borderRadius: "8px", border: "none", background: "rgba(15,23,42,0.75)", color: "#fff", fontSize: "11.5px", fontWeight: 700, cursor: "pointer" }}
                    >
                      다시 찍기
                    </button>
                  </div>
                ) : (
                  <div>
                    <div style={{ position: "relative", borderRadius: "10px", overflow: "hidden", border: `1px solid ${C.border}`, background: C.cardSub, minHeight: "160px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {streamUrl ? (
                        <img
                          key={streamUrl}
                          ref={streamImgRef}
                          src={streamUrl}
                          alt="카메라 미리보기"
                          crossOrigin="anonymous"
                          onLoad={() => { cameraAutoRefreshRef.current = 0; setStreamReady(true); }}
                          onError={onStreamError}
                          style={{ width: "100%", maxHeight: "220px", objectFit: "cover", display: streamReady ? "block" : "none" }}
                        />
                      ) : null}
                      {!streamReady ? (
                        <div style={{ padding: "20px", fontSize: "12.5px", color: C.label, textAlign: "center" }}>
                          카메라 연결 중...
                        </div>
                      ) : null}
                      {streamReady ? (
                        <span style={{ position: "absolute", top: "8px", left: "8px", padding: "3px 8px", borderRadius: "999px", background: "rgba(15,23,42,0.7)", color: "#fff", fontSize: "10.5px", fontWeight: 700, display: "flex", alignItems: "center", gap: "4px" }}>
                          <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#f87171" }} /> 실시간
                        </span>
                      ) : null}
                    </div>
                    <div style={{ fontSize: "11px", color: C.label, marginTop: "6px" }}>
                      카메라 위치를 맞춰보고, 원하는 장면일 때 아래 버튼을 눌러 찍으세요.
                    </div>
                    <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                      <button onClick={restartCameraServerAndStream} title="브라우저 연결과 서버의 카메라 프로세스를 모두 재시작합니다" style={{ padding: "12px 13px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.accentText, fontSize: "12px", fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "5px", whiteSpace: "nowrap" }}>
                        <RotateCcw size={14} /> 다시 연결
                      </button>
                      <button
                        onClick={() => captureFromStream("return")}
                        disabled={!streamReady}
                        style={{ flex: 1, padding: "12px", borderRadius: "10px", border: "none", background: C.accent, color: "#fff", fontSize: "13px", fontWeight: 800, cursor: streamReady ? "pointer" : "default", opacity: streamReady ? 1 : 0.5, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}
                      >
                        <Camera size={15} /> 이 화면으로 촬영
                      </button>
                    </div>
                  </div>
                )}
                {cameraError ? <div style={{ marginTop: "6px", fontSize: "11px", color: C.error }}>{cameraError}</div> : null}
              </div>
            ) : null}

            <div style={{ flex: 1, minHeight: "80px", maxHeight: "240px", overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: "10px", padding: "8px", marginBottom: "16px", display: "flex", flexDirection: "column", gap: "6px" }}>
              {confirmBatch.batch.map((c) => {
                const badgeText = c.sheetType === "warehouse"
                  ? (c.disposition === "소모" ? "🔥 소모" : "반납")
                  : isCancellationLine(c)
                    ? "취소"
                    : (c.action === "반납" ? "↩️ 반납" : "📦 확인");
                const badgeColor = c.disposition === "소모" || isCancellationLine(c)
                  ? C.warn
                  : (c.action === "반납" || c.sheetType === "warehouse" ? C.success : C.accentText);
                return (
                  <div key={c.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", padding: "7px 10px", borderRadius: "8px", background: C.cardSub, fontSize: "12px" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.itemLabel}</div>
                      <div style={{ fontSize: "10.5px", color: C.label }}>{c.borrower}{c.location ? ` · ${c.location}` : ""}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                      <span style={{ fontWeight: 800, color: badgeColor, fontSize: "11px" }}>{badgeText}</span>
                      <span style={{ fontWeight: 800, color: C.text, minWidth: "28px", textAlign: "right" }}>{c.qty}개</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 사진을 못 보냈을 때. 사무실 Wi-Fi 경로에서는 저장은 됐는데 응답만 유실되기도 하는데,
                같은 이름표로 다시 보내므로 눌러도 사진이 두 장 남지 않는다. */}
            {photoFailed ? (
              <div style={{
                display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap",
                padding: "11px 13px", marginBottom: "10px", borderRadius: "10px",
                background: "rgba(239,68,68,0.10)", border: `1px solid ${C.error}`,
              }}>
                <AlertTriangle size={16} style={{ color: C.error, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: "160px", fontSize: "12px", color: C.text, lineHeight: 1.5 }}>
                  반납 사진을 보내지 못했습니다. 다시 시도해도 사진이 중복 저장되지 않습니다.
                  <div style={{ fontSize: "11px", color: C.label, marginTop: "3px" }}>{photoFailed}</div>
                </div>
                <button
                  onClick={handleConfirmSubmit}
                  disabled={photoSaving}
                  style={{
                    padding: "8px 15px", borderRadius: "9px", border: "none",
                    background: C.error, color: "#fff", fontSize: "12.5px", fontWeight: 800,
                    cursor: photoSaving ? "default" : "pointer", opacity: photoSaving ? 0.5 : 1,
                  }}
                >
                  다시 시도
                </button>
              </div>
            ) : null}

            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={() => setConfirmBatch(null)}
                style={{ flex: 1, padding: "12px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.text, fontSize: "13.5px", fontWeight: 700, cursor: "pointer" }}
              >
                취소
              </button>
              <button
                onClick={handleConfirmSubmit}
                disabled={photoSaving || (batchNeedsPhoto && !confirmPhoto)}
                style={{
                  flex: 2, padding: "12px", borderRadius: "10px", border: "none",
                  background: confirmBatch.transfer ? C.error : C.accent, color: "#fff",
                  fontSize: "13.5px", fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                  opacity: (photoSaving || (batchNeedsPhoto && !confirmPhoto)) ? 0.5 : 1,
                  cursor: (photoSaving || (batchNeedsPhoto && !confirmPhoto)) ? "default" : "pointer",
                }}
              >
                <Check size={16} />
                {photoSaving
                  ? (photoElapsed >= 3 ? `사진 저장 중... ${photoElapsed}초` : "사진 저장 중...")
                  : confirmBatch.transfer ? "양도하기 · B" : "처리하기 · B"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {swapTarget ? (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 4100, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
        >
          <div
            style={{ width: "min(560px, 100%)", maxHeight: "84vh", display: "flex", flexDirection: "column", background: C.card, borderRadius: "16px", border: `1px solid ${C.border}`, padding: "20px" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
              <Repeat size={17} style={{ color: C.accentText }} />
              <span style={{ fontSize: "15px", fontWeight: 800, flex: 1 }}>물품 교체</span>
              <button onClick={() => setSwapTarget(null)} style={{ background: "transparent", border: "none", color: C.label, cursor: "pointer" }}><X size={19} /></button>
            </div>

            <div style={{ padding: "11px 13px", borderRadius: "10px", background: C.cardSub, border: `1px solid ${C.border}`, marginBottom: "12px" }}>
              <div style={{ fontSize: "10.5px", color: C.label, marginBottom: "3px" }}>기존 물품 (반납 처리됩니다)</div>
              <div style={{ fontSize: "13px", fontWeight: 700 }}>{swapTarget.itemLabel}</div>
              <div style={{ fontSize: "11px", color: C.label, marginTop: "2px" }}>
                {swapTarget.borrowerName}{swapTarget.location ? ` · ${swapTarget.location}` : ""}
              </div>
            </div>

            <div style={{ position: "relative", marginBottom: "10px" }}>
              <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
              <input
                value={swapSearch}
                onChange={(e) => setSwapSearch(e.target.value)}
                placeholder="교체할 물품 검색 (이름 · ID · 위치)"
                style={{ ...inputStyle, width: "100%", boxSizing: "border-box", paddingLeft: "36px" }}
              />
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: "10px", marginBottom: "12px" }}>
              {lendCatalog.length === 0 ? (
                <div style={{ padding: "24px", textAlign: "center", fontSize: "12.5px", color: C.label }}>물품 목록을 불러오는 중입니다...</div>
              ) : (
                lendCatalog
                  .filter((it) => !swapSearch.trim() || smartMatch([it.name, it.id, it.rootSlot], swapSearch))
                  .slice(0, 60)
                  .map((it) => {
                    const stock = Number(it.stock) || 0;
                    const on = swapItemId === it.id;
                    return (
                      <div
                        key={it.id}
                        onClick={() => {
                          if (stock <= 0) return;
                          // 종류가 나뉜 물품은 어느 종류로 바꾸는지까지 정해야 재고를 정확히 옮길 수 있다.
                          if (it.variants?.length) { setSwapVariantPick(it); return; }
                          setSwapItemId(it.id); setSwapVariant(null);
                          setSwapQty((q) => Math.min(q, stock) || 1);
                        }}
                        style={{
                          display: "flex", alignItems: "center", gap: "9px", padding: "9px 12px",
                          borderBottom: `1px solid ${C.border}`, cursor: stock > 0 ? "pointer" : "not-allowed",
                          opacity: stock > 0 ? 1 : 0.45, background: on ? C.accentSoft : "transparent",
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "12.5px", fontWeight: 700, color: on ? C.accentText : C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {it.name}
                            {on && swapVariant ? (
                              <span style={{ fontSize: "10.5px", fontWeight: 700, padding: "1px 7px", borderRadius: "999px", marginLeft: "5px", background: C.accentSoft, color: C.accentText, border: `1px solid ${C.accent}33` }}>
                                {swapVariant.name}
                              </span>
                            ) : null}
                          </div>
                          <div style={{ fontSize: "10.5px", color: C.label, fontFamily: "monospace" }}>{it.id} · {it.rootSlot || "위치 없음"}</div>
                        </div>
                        <span style={{ flexShrink: 0, fontSize: "11px", fontWeight: 700, color: stock > 0 ? C.success : C.error }}>재고 {stock}</span>
                      </div>
                    );
                  })
              )}
            </div>

            <div style={{ display: "flex", gap: "10px", marginBottom: "12px" }}>
              <div style={{ flex: "0 0 110px" }}>
                <div style={{ fontSize: "11.5px", fontWeight: 700, color: C.label, marginBottom: "5px" }}>수량</div>
                <input type="number" min={1} value={swapQty}
                  onChange={(e) => setSwapQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "11.5px", fontWeight: 700, color: C.label, marginBottom: "5px" }}>사유 (선택)</div>
                <input value={swapReason} onChange={(e) => setSwapReason(e.target.value)} placeholder="예: 파손으로 대체"
                  style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
              </div>
            </div>

            <button
              onClick={submitSwap}
              disabled={!swapItemId || swapping}
              style={{
                width: "100%", padding: "14px", borderRadius: "12px", border: "none",
                background: swapItemId ? C.accent : C.border, color: "#fff",
                fontSize: "14.5px", fontWeight: 800,
                cursor: swapItemId && !swapping ? "pointer" : "not-allowed", opacity: swapping ? 0.7 : 1,
              }}
            >
              {swapping ? "교체 중..." : "교체하기"}
            </button>
          </div>
        </div>
      ) : null}

      {/* 추가 대여 모달 */}
      {lendTarget ? (
        <div
          // 담아둔 물품이 날아가면 곤란하므로, 다른 모달들과 달리 배경 클릭으로는 닫지 않는다.
          // 닫으려면 우측 상단 X 버튼을 눌러야 한다.
          style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
        >
          <div
            style={{ width: "min(560px, 100%)", maxHeight: "84vh", display: "flex", flexDirection: "column", background: C.card, borderRadius: "16px", border: `1px solid ${C.border}`, padding: "20px" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
              <Package size={17} style={{ color: C.accentText }} />
              <span style={{ fontSize: "15px", fontWeight: 800, flex: 1 }}>추가 대여 — {lendTarget.name}</span>
              <button onClick={() => setLendTarget(null)} style={{ background: "transparent", border: "none", color: C.label, cursor: "pointer" }}><X size={19} /></button>
            </div>
            <div style={{ fontSize: "11.5px", color: C.label, marginBottom: "12px" }}>
              {[lendTarget.floor, lendTarget.unit].filter(Boolean).join(" · ") || "위치 정보 없음"} · 대여 기록은 본인 명의로 남습니다.
            </div>

            <div style={{ position: "relative", marginBottom: "10px" }}>
              <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
              <input
                value={lendSearch}
                onChange={(e) => setLendSearch(e.target.value)}
                placeholder="물품명 · ID · 위치로 검색"
                style={{ ...inputStyle, width: "100%", boxSizing: "border-box", paddingLeft: "36px" }}
              />
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: "10px", marginBottom: "12px" }}>
              {lendFiltered.length === 0 ? (
                <div style={{ padding: "24px", textAlign: "center", fontSize: "12.5px", color: C.label }}>
                  {lendCatalog.length === 0 ? "물품 목록을 불러오는 중입니다..." : "검색 결과가 없습니다."}
                </div>
              ) : (
                lendFiltered.map((it) => {
                  const stock = Number(it.stock) || 0;
                  const picked = lendCart.filter((c) => c.id === it.id).reduce((n, c) => n + c.quantity, 0);
                  return (
                    <div
                      key={it.id}
                      onClick={() => addLend(it)}
                      style={{
                        display: "flex", alignItems: "center", gap: "9px", padding: "9px 12px",
                        borderBottom: `1px solid ${C.border}`, cursor: stock > 0 ? "pointer" : "not-allowed",
                        opacity: stock > 0 ? 1 : 0.45,
                        background: picked > 0 ? C.accentSoft : "transparent",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "12.5px", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</div>
                        <div style={{ fontSize: "10.5px", color: C.label, fontFamily: "monospace" }}>{it.id} · {it.rootSlot || "위치 없음"}</div>
                      </div>
                      <span style={{ flexShrink: 0, fontSize: "11px", fontWeight: 700, color: stock > 0 ? C.success : C.error }}>재고 {stock}</span>
                      {picked > 0 ? <span style={{ flexShrink: 0, fontSize: "11.5px", fontWeight: 800, color: C.accentText }}>{picked}개</span> : null}
                    </div>
                  );
                })
              )}
            </div>

            {lendCart.length > 0 ? (
              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: "10px", marginBottom: "12px", display: "flex", flexDirection: "column", gap: "6px", maxHeight: "150px", overflowY: "auto" }}>
                {lendCart.map((c, idx) => (
                  <div key={lendKey(c)} style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: "12.5px", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.name}
                      {c.variantName ? (
                        <span style={{
                          fontSize: "10.5px", fontWeight: 700, padding: "1px 7px", borderRadius: "999px", marginLeft: "5px",
                          background: C.accentSoft, color: C.accentText, border: `1px solid ${C.accent}33`, whiteSpace: "nowrap",
                        }}>{c.variantName}</span>
                      ) : null}
                    </span>
                    <button onClick={() => setLendCart((prev) => prev.map((x, i) => (i === idx ? { ...x, quantity: Math.max(0, x.quantity - 1) } : x)).filter((x) => x.quantity > 0))}
                      style={{ width: 24, height: 24, borderRadius: "7px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", fontSize: "12px", lineHeight: 1 }}>−</button>
                    <span style={{ minWidth: "34px", textAlign: "center", fontSize: "12.5px", fontWeight: 800 }}>{c.quantity}<span style={{ fontSize: "10px", color: C.label }}>/{c.stock}</span></span>
                    <button onClick={() => setLendCart((prev) => prev.map((x, i) => (i === idx ? { ...x, quantity: Math.min(x.stock, x.quantity + 1) } : x)))}
                      style={{ width: 24, height: 24, borderRadius: "7px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", fontSize: "12px", lineHeight: 1 }}>+</button>
                  </div>
                ))}
              </div>
            ) : null}

            <button
              onClick={submitLend}
              disabled={!lendCart.length || lendSubmitting}
              style={{
                width: "100%", padding: "14px", borderRadius: "12px", border: "none",
                background: lendCart.length ? C.accent : C.border, color: "#fff",
                fontSize: "14.5px", fontWeight: 800,
                cursor: lendCart.length && !lendSubmitting ? "pointer" : "not-allowed",
                opacity: lendSubmitting ? 0.7 : 1,
              }}
            >
              {lendSubmitting ? "처리 중..." : `대여 처리하기 (${lendCart.reduce((n, c) => n + c.quantity, 0)}개)`}
            </button>
          </div>
        </div>
      ) : null}

      {/* 모바일에서 장바구니 시트가 펼쳐졌을 때 뒤를 덮는 막. 눌러서 접는다. */}
      {isMobile && cartSheetOpen ? (
        <div onClick={() => setCartSheetOpen(false)} style={{ position: "absolute", inset: 0, background: "rgba(2,6,23,0.5)", zIndex: 40 }} />
      ) : null}

      {/* 모바일에서 장바구니가 접혀 있을 때 아래에 붙는 요약 막대.
          지금 몇 개를 담았는지 늘 보이게 해야, 담은 걸 잊고 화면을 떠나는 일이 없다. */}
      {isMobile && !cartSheetOpen ? (
        <button
          onClick={() => setCartSheetOpen(true)}
          style={{
            position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 45,
            height: "62px", borderTop: `1px solid ${C.border}`, background: C.card, color: C.text,
            display: "flex", alignItems: "center", gap: "10px", padding: "0 16px", borderRadius: 0,
          }}
        >
          <Undo2 size={17} style={{ color: C.accentText, flexShrink: 0 }} />
          <span style={{ flex: 1, textAlign: "left", fontSize: "14px", fontWeight: 800 }}>
            처리 장바구니{" "}
            <span style={{ color: cart.length ? C.accentText : C.label }}>{cartTypeCount}종 · {cartTotal}개</span>
          </span>
          <span style={{ fontSize: "12px", fontWeight: 800, color: C.accentText, flexShrink: 0 }}>펼치기 ▲</span>
        </button>
      ) : null}

      {/* ── 오른쪽: 처리 장바구니 (화면 절반) ──
          모바일에서는 오른쪽이 아니라 아래에서 올라오는 시트다. 안쪽 내용은 그대로 쓴다. */}
      <div
        style={{
          ...(isMobile
            ? {
                position: "absolute" as const, left: 0, right: 0, bottom: 0, zIndex: 50,
                height: cartSheetOpen ? "78%" : 0,
                borderTop: `1px solid ${C.border}`,
                borderTopLeftRadius: 16, borderTopRightRadius: 16,
                overflow: "hidden",
                transition: "height 0.22s ease",
                boxShadow: cartSheetOpen ? "0 -10px 30px rgba(0,0,0,0.35)" : "none",
              }
            : { width: "50%", flexShrink: 0, borderLeft: `1px solid ${C.border}` }),
          background: C.card,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "18px 20px", borderBottom: `1px solid ${C.border}` }}>
          <Undo2 size={17} style={{ color: C.accentText }} />
          <span style={{ fontSize: "15px", fontWeight: 800, flex: 1 }}>
            처리 장바구니 <span style={{ color: C.accentText }}>{cartTypeCount}종 · {cartTotal}개</span>
          </span>
          {cHeld ? (
            <span style={{ fontSize: "11.5px", fontWeight: 800, color: C.error, background: C.errorSoft, borderRadius: "999px", padding: "3px 10px" }}>
              계속 누르면 전체 해제…
            </span>
          ) : null}
          {cart.length > 0 ? (
            <button onClick={clearAll} style={{ background: "transparent", border: "none", color: C.label, cursor: "pointer", fontSize: "12px", fontWeight: 700 }}>
              비우기
            </button>
          ) : null}
          {isMobile ? (
            <button onClick={() => setCartSheetOpen(false)} style={{ background: "transparent", border: "none", color: C.label, cursor: "pointer", fontSize: "12px", fontWeight: 800 }}>
              접기 ▼
            </button>
          ) : null}
        </div>

        {/* 백그라운드로 처리 중인 건이 있으면 몇 건인지 보여준다. 장바구니는 이미 비워진 상태라 새 작업을 계속 담을 수 있다. */}
        {pendingJobs.length > 0 ? (
          <div style={{ padding: "8px 20px", background: C.accentSoft, display: "flex", alignItems: "center", gap: "8px" }}>
            <RotateCcw size={12} className="ar-spin" style={{ color: C.accentText, flexShrink: 0 }} />
            <span style={{ fontSize: "11px", color: C.accentText, fontWeight: 700 }}>
              백그라운드로 처리 중: {pendingJobs.map((j) => j.label).join(" · ")}
            </span>
          </div>
        ) : null}

        <div style={{ flex: 1, overflowY: "auto", padding: "14px 20px", minHeight: 0 }}>
          {cart.length === 0 ? (
            <div style={{ textAlign: "center", padding: "56px 0", color: C.label, fontSize: "13px", lineHeight: 1.7 }}>
              담은 물품이 없습니다.<br />
              왼쪽에서 대여자를 고르고 <b style={{ color: C.accentText }}>A</b> 키를 눌러보세요.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {cart.map((c) => (
                <div key={c.key} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "11px 12px", borderRadius: "10px", background: C.cardSub, border: `1px solid ${C.border}` }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.itemLabel}</div>
                    <div style={{ fontSize: "10.5px", color: C.label, marginTop: "2px" }}>
                      {c.borrower}{c.location ? ` · ${c.location}` : ""}
                    </div>
                  </div>
                  {c.sheetType === "warehouse" ? (
                    <button
                      onClick={() => toggleDisposition(c.key)}
                      title="반납(재고 복구) / 소모(재고에서 제외) 전환"
                      style={{
                        flexShrink: 0, padding: "5px 9px", borderRadius: "7px", cursor: "pointer",
                        border: `1px solid ${c.disposition === "소모" ? C.warn : C.border}`,
                        background: c.disposition === "소모" ? C.warnSoft : C.card,
                        color: c.disposition === "소모" ? C.warn : C.label,
                        fontSize: "11px", fontWeight: 800, whiteSpace: "nowrap",
                      }}
                    >
                      {c.disposition === "소모" ? "🔥 소모" : "반납"}
                    </button>
                  ) : (
                    <button
                      onClick={() => toggleAction(c.key)}
                      title={isCancellationLine(c) ? "이 줄의 대여를 취소하거나 다시 확인 처리로 전환" : "이 줄만 대여 확인 / 반납 처리로 전환"}
                      style={{
                        flexShrink: 0, padding: "5px 9px", borderRadius: "7px", cursor: "pointer",
                        border: `1px solid ${isCancellationLine(c) ? C.warn : c.action === "반납" ? C.success : C.accent}`,
                        background: isCancellationLine(c) ? C.warnSoft : c.action === "반납" ? C.successSoft : C.accentSoft,
                        color: isCancellationLine(c) ? C.warn : c.action === "반납" ? C.success : C.accentText,
                        fontSize: "11px", fontWeight: 800, whiteSpace: "nowrap",
                      }}
                    >
                      {c.action === "반납" ? (isCancellationLine(c) ? "취소" : "↩️ 반납") : "📦 확인"}
                    </button>
                  )}
                  {/* 파손 반납 표시 — 반납 줄에만 뜬다. 체크해두면 장바구니를 처리할 때
                      파손 수량을 묻고 불량 로그 등록으로 이어진다. */}
                  {c.sheetType !== "warehouse" && c.action === "반납" && !!c.pickedUp ? (
                    <button
                      onClick={() => toggleDamaged(c.key)}
                      title={c.damaged ? "파손 표시 해제" : "파손된 물품으로 표시 (불량 로그에 등록됩니다)"}
                      style={{
                        flexShrink: 0, padding: "5px 8px", borderRadius: "7px", cursor: "pointer",
                        border: `1px solid ${c.damaged ? C.error : C.border}`,
                        background: c.damaged ? C.errorSoft : C.card,
                        color: c.damaged ? C.error : C.label,
                        fontSize: "11px", fontWeight: 800, whiteSpace: "nowrap",
                      }}
                    >
                      {c.damaged ? "💥 파손" : "파손?"}
                    </button>
                  ) : null}
                  <button onClick={() => changeQty(c.key, -1)} style={{ width: 26, height: 26, borderRadius: "7px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", fontSize: "13px", lineHeight: 1, flexShrink: 0 }}>−</button>
                  <span style={{ minWidth: "34px", textAlign: "center", fontSize: "13px", fontWeight: 800 }}>{c.qty}<span style={{ fontSize: "10.5px", color: C.label, fontWeight: 600 }}>/{c.max}</span></span>
                  <button onClick={() => changeQty(c.key, 1)} disabled={c.qty >= c.max} style={{ width: 26, height: 26, borderRadius: "7px", border: `1px solid ${C.border}`, background: C.card, color: c.qty >= c.max ? C.label : C.text, cursor: c.qty >= c.max ? "not-allowed" : "pointer", fontSize: "13px", lineHeight: 1, flexShrink: 0 }}>+</button>
                  <button onClick={() => setCart((prev) => prev.filter((x) => x.key !== c.key))} style={{ width: 26, height: 26, borderRadius: "7px", border: "none", background: C.errorSoft, color: C.error, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ padding: "16px 20px", borderTop: `1px solid ${C.border}` }}>
          {/* 양도 — 재대여와 흐름은 같고 받는 사람만 달라진다. 둘은 동시에 켤 수 없다. */}
          {cart.some((c) => c.sheetType === "warehouse" || (c.action === "반납" && !!c.pickedUp)) ? (
          <div style={{ marginBottom: "10px" }}>
            <label
              style={{
                display: "flex", alignItems: "center", gap: "9px", padding: "10px 12px",
                borderRadius: transferMode ? "10px 10px 0 0" : "10px", cursor: "pointer",
                border: `1px solid ${transferMode ? C.error : C.border}`,
                borderBottom: transferMode ? "none" : undefined,
                background: transferMode ? C.errorSoft : "transparent",
              }}
            >
              <input
                type="checkbox"
                checked={transferMode}
                onChange={(e) => setTransferMode(e.target.checked)}
              />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: "12.5px", fontWeight: 800, color: transferMode ? C.error : C.text }}>
                  다른 사람에게 양도
                </span>
                <span style={{ display: "block", fontSize: "10.5px", color: C.label, marginTop: "2px", lineHeight: 1.5 }}>
                  반납으로 표시된 줄만 적용됩니다. 실물은 창고로 돌아오지 않고 받는 사람에게 그대로 넘어갑니다.
                </span>
              </span>
            </label>

            {transferMode ? (
              <div
                style={{
                  display: "flex", flexDirection: "column", gap: "8px", padding: "12px",
                  border: `1px solid ${C.error}`, borderTop: `1px dashed ${C.error}55`,
                  borderRadius: "0 0 10px 10px", background: C.errorSoft,
                }}
              >
                <RegisteredUserPicker scriptUrl={scriptUrl} name={transferTarget.name} employeeId={transferTarget.employeeId} onChange={(nextName, nextId) => setTransferTarget((t) => ({ ...t, name: nextName, employeeId: nextId }))} isLightMode={isLightMode} placeholder="양도받을 사람 이름 검색 후 선택" />
                <span style={{ fontSize: "10.5px", color: C.label, lineHeight: 1.5 }}>
                  이름을 입력한 뒤 명부 검색 결과를 선택하면 사번이 자동으로 연결됩니다.
                </span>
              </div>
            ) : null}
          </div>
          ) : null}

          <button
            onClick={submitReturn}
            disabled={!cart.length}
            style={{
              width: "100%", padding: "15px", borderRadius: "12px", border: "none",
              background: !cart.length ? C.border : transferMode ? C.error : C.accent, color: "#fff",
              fontSize: "15px", fontWeight: 800, cursor: cart.length ? "pointer" : "not-allowed",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
            }}
          >
            {transferMode
              ? `${transferTarget.name.trim() || "다른 사람"}님에게 양도하기 (${cartTotal}개) · B`
              : `장바구니 처리하기 (${cartTotal}개) · B`}
          </button>
        </div>
      </div>
      {qrPickerOpen ? (
        <div
          onClick={() => setQrPickerOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 4300, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
        >
          <div
            role="dialog"
            aria-label="QR 라벨 인쇄"
            onClick={(e) => e.stopPropagation()}
            style={{ width: "100%", maxWidth: "560px", maxHeight: "calc(100vh - 32px)", overflowY: "auto", background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: "16px", padding: "18px", boxShadow: "0 20px 50px rgba(0,0,0,0.3)" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
              <Printer size={17} style={{ color: C.accentText }} />
              <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 850, flex: 1 }}>QR 라벨 인쇄</h2>
              <button type="button" onClick={() => setQrPickerOpen(false)} title="닫기 (Esc)" style={{ border: "none", background: "transparent", color: C.label, cursor: "pointer", padding: "4px", display: "inline-flex" }}>
                <X size={18} />
              </button>
            </div>
            <div style={{ fontSize: "11.5px", color: C.label, marginBottom: "14px" }}>서버에 연결된 라벨 프린터(60×40mm)로 바로 출력합니다.</div>

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "10px" }}>
              <div style={{ border: `1px solid ${C.border}`, borderRadius: "12px", padding: "14px", background: C.cardSub, display: "flex", flexDirection: "column", gap: "10px" }}>
                <div>
                  <div style={{ fontSize: "14px", fontWeight: 850 }}>사번 조회 QR</div>
                  <div style={{ marginTop: "3px", fontSize: "11.5px", color: C.label, lineHeight: 1.45 }}>사번을 입력해 내 대여 내역을 확인하는 조회 페이지로 연결됩니다.</div>
                </div>
                <div style={{ flex: 1 }} />
                <button
                  type="button"
                  disabled={printingLookupQr}
                  onClick={handlePrintLookupQr}
                  style={{ ...inputStyle, width: "100%", height: "40px", background: C.card, color: C.accentText, fontWeight: 850, cursor: printingLookupQr ? "wait" : "pointer", opacity: printingLookupQr ? 0.65 : 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "6px" }}
                >
                  <Printer size={14} /> {printingLookupQr ? "출력 중" : "1장 인쇄"}
                </button>
              </div>

              <div style={{ border: `1px solid ${C.border}`, borderRadius: "12px", padding: "14px", background: C.cardSub, display: "flex", flexDirection: "column", gap: "10px" }}>
                <div>
                  <div style={{ fontSize: "14px", fontWeight: 850 }}>SCAN ME QR</div>
                  <div style={{ marginTop: "3px", fontSize: "11.5px", color: C.label, lineHeight: 1.45 }}>사내 Slack 초대 링크로 연결되는 말풍선 "SCAN ME" 스티커입니다.</div>
                </div>
                <div style={{ borderRadius: "8px", background: "#fff", border: `1px solid ${C.border}`, aspectRatio: "3 / 2", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                  {scanMePreview
                    ? <img src={scanMePreview} alt="SCAN ME QR 라벨 미리보기" style={{ width: "100%", height: "100%", objectFit: "contain", imageRendering: "pixelated" }} />
                    : <span style={{ fontSize: "11px", color: "#64748b" }}>미리보기 불러오는 중…</span>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ fontSize: "12px", fontWeight: 750, color: C.label, flex: 1 }}>장수</span>
                  <button type="button" aria-label="한 장 줄이기" onClick={() => setScanMeCopies((n) => Math.max(1, n - 1))} style={{ ...inputStyle, width: "34px", height: "34px", padding: 0, cursor: "pointer", fontWeight: 900 }}>−</button>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={scanMeCopies}
                    onChange={(e) => setScanMeCopies(Math.max(1, Math.min(50, Math.trunc(Number(e.target.value)) || 1)))}
                    style={{ ...inputStyle, width: "56px", height: "34px", padding: "0 6px", textAlign: "center", fontWeight: 800 }}
                  />
                  <button type="button" aria-label="한 장 늘리기" onClick={() => setScanMeCopies((n) => Math.min(50, n + 1))} style={{ ...inputStyle, width: "34px", height: "34px", padding: 0, cursor: "pointer", fontWeight: 900 }}>+</button>
                </div>
                <button
                  type="button"
                  disabled={printingScanMe}
                  onClick={handlePrintScanMe}
                  style={{ ...inputStyle, width: "100%", height: "40px", border: "none", background: C.accent, color: "#fff", fontWeight: 850, cursor: printingScanMe ? "wait" : "pointer", opacity: printingScanMe ? 0.65 : 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "6px" }}
                >
                  <Printer size={14} /> {printingScanMe ? "출력 중" : `${scanMeCopies}장 인쇄`}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
