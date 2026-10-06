import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import QRCode from "qrcode";
import {
  ArrowLeft, Search, User, Building2, MoreHorizontal, Fingerprint, Boxes,
  HandHelping, PackageOpen, Package, ShoppingCart, Undo2, MapPin, ChevronRight, Plus, Minus, X, Check,
  CheckCircle2, AlertCircle, Bookmark, RotateCcw, Flame, PlusCircle, IdCard,
  Trash2, RefreshCw, AlertTriangle, Layers, Clock3} from "lucide-react";
import ImageZoomModal from "./ImageZoomModal";
import TableclothPanel from "./TableclothPanel";
import { SizeViewerModal, hasDims } from "./SizeViewer";
import {
  ObjectItem, ScenarioDefinition, UnreturnedItem, BorrowEntry, ReturnRequest,
  computeLocationSortIndex, padSlot, isKoreanName, nowString,
  fetchBorrowAppVersion, fetchObjectItems, fetchScenarioDefinition, fetchUnreturnedItems,
  fetchMyBorrowedItems, checkConfigDsRegistered, postRecordBorrow, postProcessReturn,
  DEMO_OBJECT_ITEMS, loadBrowseCart, clearBrowseCart, saveIdentity, loadIdentity,
  SeatFloor, fetchSeatMap,
  ActiveItemTypeInfo, fetchActiveItemTypeCount,
  ensureUpToDate, isVersionMismatchMessage, signalVersionOutdated,
} from "../utils/borrowApi";
import { getGoogleDriveImageUrl, getThumbImageUrl } from "../utils/drive";
import { smartMatch } from "../utils/search";
import HazardConfirmModal, { collectHazardItems } from "./HazardConfirmModal";
import { useVersionWorkGuard } from "../utils/versionWorkGuard";
import { useNoticeCountdown } from "../utils/useNoticeCountdown";

/* ══════════════════════════════ 타입 ══════════════════════════════ */

type Mode =
  | "mode"
  | "pickBorrowKind" | "pickReturnKind" | "tc"
  | "b1" | "b2" | "b3g" | "b4g" | "b3s" | "b4s"
  | "return"
  | "result";

type ItemSortKey = "id_desc" | "id_asc" | "location_desc" | "location_asc" | "name_asc";

interface CartItem {
  id: string;
  name: string;
  quantity: number;
  rootSlot?: string;
  // 종류가 나뉜 물품은 반드시 종류 하나를 골라야 담을 수 있다.
  variantId?: number;
  variantName?: string;
}

// 같은 물품이라도 종류가 다르면 장바구니에서 서로 다른 줄로 관리한다
// (A 2개 + B 1개처럼 나눠 담을 수 있어야 하므로 id만으로는 부족하다).
/** 장바구니가 몇 "종"인지 — 줄 수가 아니라 물품 수로 센다. 같은 물품의 색상 종류를
 * 여러 줄 담아도 한 종이다(한도도 같은 기준으로 센다). */
function cartTypeCount(list: { id: string }[]) {
  return new Set(list.map((c) => c.id)).size;
}

function cartLineKey(c: { id: string; variantId?: number }) {
  return `${c.id}::${c.variantId ?? ""}`;
}

// 종류는 물품명이 아니라 선택한 옵션이라, 이름 뒤에 붙이지 않고 작은 칩으로 떼어 보여준다.
function VariantChip({ C, text }: { C: any; text: string }) {
  return (
    <span style={{
      flexShrink: 0, fontSize: "10.5px", fontWeight: 700, lineHeight: 1.5,
      padding: "1px 7px", borderRadius: "999px", marginLeft: "5px",
      background: C.accentSoft, color: C.accentText, border: `1px solid ${C.accent}33`,
      whiteSpace: "nowrap",
    }}>{text}</span>
  );
}

/** 장바구니 한 줄의 이름 + 종류 칩. */
function cartLineLabel(c: { name: string; variantId?: number; variantName?: string }, C?: any) {
  if (!c.variantId) return c.name;
  return (<>{c.name}<VariantChip C={C} text={c.variantName || "종류 지정"} /></>);
}
interface SidEntry { sid: string; loading: boolean; scenario: ScenarioDefinition | null }

interface BorrowSystemPageProps {
  key?: string;
  scriptUrl: string;
  connected: boolean;
  isLightMode: boolean;
  onBack: () => void;
  showToast: (msg: string, type: "ok" | "error" | "info" | "warn") => void;
  /** "borrow" = 대여(종류 선택부터), "return" = 반납(종류 선택부터) */
  entry?: "borrow" | "return";
  /** 열람 조회에서 넘어온 신원 (사번/성함 자동 입력 + 장바구니 연동) */
  initialIdentity?: { name: string; employeeId: string; affiliation?: "cfgw" | "configds" | "other" } | null;
  /** 열람에서 바로 넘어온 경우: "scenario"면 일반대여 흐름, "tablecloth"면 테이블보 흐름으로 직행 */
  initialKind?: "scenario" | "tablecloth" | null;
  /** 물품 열람에서 이미 받아둔 좌석. 있으면 이 화면에서 다시 묻지 않는다. */
  initialSeat?: { floor: string; unit: string } | null;
  /** 물품 열람에서 SID 대여로 담았을 때 그 시나리오 번호. 있으면 SID 대여로, 없으면 일반 대여로 본다. */
  initialSid?: string;
  /** SID 화면의 '추가 물품 담기'에서 고른 물품. */
  initialAdditionalItems?: CartItem[];
  /** 시나리오 물품은 이 화면에서 고르지 않는다 — 물품을 담는 화면으로 보낸다. */
  onGoPickItems?: (target?: "sid") => void;
  // COS 물품 대여/반납/소모 성공 시, "물품 관리" 화면이 쓰는 앱 전체 재고
  // 상태도 즉시 갱신되도록 알려준다.
  onInventoryChanged?: () => void;
  isAdmin?: boolean;
  /** 무인 모드 중에는 관리자가 아니면 물품 카드에서 보관 위치를 숨긴다. */
  unattendedEnabled?: boolean;
}

/* ══════════════════════════════ 컴포넌트 ══════════════════════════════ */

export default function BorrowSystemPage({ scriptUrl, connected, isLightMode, onBack, showToast: showToastRaw, entry = "borrow", initialIdentity = null, initialKind = null, initialSeat = null, initialSid = "", initialAdditionalItems = [], onGoPickItems, onInventoryChanged, isAdmin = false, unattendedEnabled = false }: BorrowSystemPageProps) {
  // 무인 모드 중에는 비관리자에게 보관 위치를 숨긴다. 대여 신청 후에는
  // 서버가 확인한 사번으로 위치 확인 사이트 QR을 보여준다.
  const hideLocation = unattendedEnabled && !isAdmin;
  // 열람에서 시나리오 물품을 담아 넘어오면 일반대여로 직행
  // 테이블보로 들어오면 곧바로 천 목록을 연다 — 분야를 방금 골라놓고 또 고르게 할 이유가 없다.
  // 테이블보 반납으로 곧장 들어왔고 신원·좌석이 이미 있으면 묻는 단계를 건너뛴다 —
  // 로그인할 때 받은 것을 또 받을 이유가 없다.
  const tcReturnDirect = initialKind === "tablecloth" && entry === "return" && !!initialIdentity?.name && !!initialSeat?.floor;
  const rootMode: Mode = tcReturnDirect ? "tc"
    : initialKind === "scenario" || initialKind === "tablecloth" ? "b1"
    : entry === "return" ? "pickReturnKind" : "pickBorrowKind";
  // 테이블보는 아직 임시로 여는 기능이라, 이 화면의 모드 흐름(b1/wbname/return…)에
  // 끼워 넣지 않고 자체 완결형 패널로 띄운다. 기존 대여 흐름을 건드리지 않기 위해서다.
  // COS 물품 대여·반납은 사용자 화면에서 없앴다 — 관리자 직접 대여(AdminDirectBorrowModal)와
  // 관리자 반납(AdminReturnPage)으로만 한다.

  /* 알림은 몇 초 뒤 사라진다. 자동 신청이 이유를 알리고 멈춘 경우 그 이유까지 함께 사라져
   * "아무 일도 안 일어났다"로 보였다. 마지막 알림을 남겨 화면에서 다시 읽을 수 있게 한다. */
  const [lastNotice, setLastNotice] = useState("");
  const showToast = useCallback((msg: string, type: "ok" | "error" | "info" | "warn") => {
    setLastNotice(msg);
    showToastRaw(msg, type);
  }, [showToastRaw]);

  /* ---------- 팔레트 (WMS 디자인 시스템) ---------- */
  const C = {
    bg: isLightMode ? "#f7f8fa" : "#0b1120",
    card: isLightMode ? "#ffffff" : "#161f30",
    cardSub: isLightMode ? "#f4f6f9" : "#0f172a",
    border: isLightMode ? "#e6e9ef" : "#26324a",
    text: isLightMode ? "#111827" : "#f1f5f9",
    label: isLightMode ? "#2563eb" : "#94a3b8",
    accent: "#2563eb",
    accentSoft: isLightMode ? "rgba(37,99,235,0.09)" : "rgba(148,163,184,0.14)",
    accentText: isLightMode ? "#111827" : "#f1f5f9",
    success: isLightMode ? "#047857" : "#34d399",
    successSoft: "rgba(16, 185, 129, 0.12)",
    warn: isLightMode ? "#b45309" : "#fbbf24",
    warnSoft: "rgba(245, 158, 11, 0.12)",
    error: isLightMode ? "#dc2626" : "#f87171",
    errorSoft: "rgba(239, 68, 68, 0.12)",
  };

  /* ---------- 공용 상태 ---------- */
  const [mode, setMode] = useState<Mode>(rootMode);
  // 단계(mode)가 바뀔 때 이전 화면의 스크롤 위치가 그대로 남아있지 않도록 맨 위로 초기화한다.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [mode]);
  const [appVersion, setAppVersion] = useState<string>("");
  // 상단 헤더 높이 (대여자 상태 바를 헤더 바로 아래에 고정하기 위해 실측한다)
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerH, setHeaderH] = useState(53);
  useEffect(() => {
    const el = headerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => setHeaderH(el.getBoundingClientRect().height || 53);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [objectItems, setObjectItems] = useState<ObjectItem[]>([]);
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [itemsLoading, setItemsLoading] = useState(false);
  // 재고 검증에 필요한 물품 목록이 로딩 중일 때 "신청하기"를 누른 경우,
  // 로딩 완료 후 자동으로 이어서 제출하기 위한 대기 플래그.
  const [pendingSubmit, setPendingSubmit] = useState(false);
  // 물품 목록을 기다리느라 미뤄진 신청이 어느 쪽이었는지. 상태로 두면 다시 불릴 때 이미 늦다.
  const pendingTypeRef = useRef<"scenario" | "general" | null>(null);
  const [imageModalUrl, setImageModalUrl] = useState<string>("");
  // SID 필요 물품의 종류 배정 모달 — 어느 SID의 몇 번째 물품인지만 들고 있는다.
  const [sidVariantPick, setSidVariantPick] = useState<{ sidIdx: number; itemIdx: number } | null>(null);
  // 종류를 고르는 자리에서 그 종류의 실측 크기를 열어 보는 용도.
  // (물품 목록 쪽 뷰어는 다른 컴포넌트에 있어서 여기서는 따로 하나 둔다)
  const [sizeItem, setSizeItem] = useState<any | null>(null);
  // 재고 부족 경고를 크게 띄우는 모달 (null이면 안 뜸)
  const [stockShortfallModal, setStockShortfallModal] = useState<{ id: string; name: string; requested: number; stock: number }[] | null>(null);
  // SID 대여에서 "재고 없는 물품만 빼고 나머지는 빌리는" 흐름.
  // 시나리오 하나에 물품이 여러 개인데 그중 하나가 품절이라고 전부 못 빌리면 곤란해서,
  // 막는 대신 무엇이 빠지는지 분명히 보여주고 두 번 확인받는다(담을 때 한 번, 신청할 때 한 번).
  //  - phase: 지금 어느 관문인지 (담기 / 최종 신청)
  //  - stage: "warn"은 재고 없음을 알리는 경고, "confirm"은 빼고 진행할지 묻는 단계
  const [sidExcludeModal, setSidExcludeModal] = useState<{
    phase: "cart" | "submit";
    stage: "warn" | "confirm";
    items: { id: string; name: string; requested: number; stock: number }[];
  } | null>(null);
  // 기타 소속인데 성함을 안 적고 다음으로 넘어가려 할 때 — 토스트로는 놓치기 쉬워 큰 팝업으로 확실히 막는다.
  const [nameRequiredModal, setNameRequiredModal] = useState(false);
  const otherNameInputRef = useRef<HTMLInputElement>(null);
  const [resultInfo, setResultInfo] = useState<{ ok: boolean; isSyncing?: boolean; title: string; sub: string; pickupTimeoutMinutes?: number; borrowQr?: { image: string; url: string; expiresAt: number } }>({ ok: true, isSyncing: false, title: "", sub: "" });
  const [borrowQrSeconds, setBorrowQrSeconds] = useState(30);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  useEffect(() => {
    const expiresAt = mode === "result" && resultInfo.ok && !resultInfo.isSyncing ? resultInfo.borrowQr?.expiresAt : undefined;
    if (!expiresAt) return;
    let closed = false;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setBorrowQrSeconds(remaining);
      if (remaining === 0 && !closed) { closed = true; window.clearInterval(timer); onBackRef.current(); }
    };
    const timer = window.setInterval(tick, 250);
    tick();
    return () => window.clearInterval(timer);
  }, [mode, resultInfo.borrowQr?.expiresAt, resultInfo.isSyncing, resultInfo.ok]);

  /* ---------- 대여 신청 상태 ---------- */
  /* 대여 신청이 신원을 잃고 옛 단계 화면으로 떨어지는 일이 있었다.
   * 로그인 화면이 남겨둔 값으로 되살린다 — 화면 사이에서 값이 끊겨도 이어진다. */
  const savedIdentity = loadIdentity();
  const effectiveIdentity = initialIdentity?.name
    ? initialIdentity
    : (savedIdentity?.name
        ? { name: savedIdentity.name, employeeId: savedIdentity.employeeId || "", affiliation: savedIdentity.affiliation }
        : null);
  const effectiveSeat = initialSeat?.floor
    ? initialSeat
    : (savedIdentity?.floor ? { floor: savedIdentity.floor, unit: savedIdentity.unit || "" } : null);

  const [borrowerName, setBorrowerName] = useState(effectiveIdentity?.affiliation === "other" ? "" : (effectiveIdentity?.name || ""));
  const [affiliation, setAffiliation] = useState<"cfgw" | "configds" | "other">(effectiveIdentity?.affiliation || "cfgw");
  const [employeeId, setEmployeeId] = useState(effectiveIdentity?.employeeId || "");
  const [otherName, setOtherName] = useState(effectiveIdentity?.affiliation === "other" ? (effectiveIdentity?.name || "") : "");
  // 좌석 위치 (관리자 좌석맵 연동 — 대여 시 층수/유닛 입력)
  // 좌석 배치도는 거의 바뀌지 않으므로, 지난번에 받은 값을 먼저 그려 선택 UI가 바로 뜨게 한다.
  // (서버 응답이 오면 최신 값으로 교체한다)
  const SEAT_MAP_CACHE_KEY = "wms_seat_map_v1";
  const [seatMap, setSeatMap] = useState<SeatFloor[]>(() => {
    try {
      const raw = sessionStorage.getItem(SEAT_MAP_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed as SeatFloor[];
      }
    } catch (e) { /* 캐시 없거나 깨졌으면 빈 값으로 시작 */ }
    return [];
  });
  const [seatMapLoaded, setSeatMapLoaded] = useState(false);
  // 테이블보는 담당자를 거치지 않는 셀프 대여라 단계 기계를 타지 않는다.
  // 신원(1단계)만 같이 받고, 나머지는 전용 패널이 알아서 한다.
  const [tcFlow, setTcFlow] = useState(initialKind === "tablecloth");
  // 테이블보 화면을 대여로 열었는지 반납으로 열었는지 — 반납이면 곧바로 내 기록에서 시작한다.
  // 반납하러 들어왔으면 곧바로 "내 기록"에서 시작한다 — 천은 본인이 직접 돌려놓는다.
  const [tcTab, setTcTab] = useState<"list" | "mine">(initialKind === "tablecloth" && entry === "return" ? "mine" : "list");
  const [tcDetailId, setTcDetailId] = useState<number | null>(null);
  const [selFloor, setSelFloor] = useState(effectiveSeat?.floor || "");
  const [selUnit, setSelUnit] = useState(effectiveSeat?.unit || "");
  // 물품 종류 최대 보유 개수 제한 관련 상태
  const [activeTypeInfo, setActiveTypeInfo] = useState<ActiveItemTypeInfo | null>(null);
  const [typeLimitModal, setTypeLimitModal] = useState<ActiveItemTypeInfo | null>(null);
  // 이름 입력을 마치고 대여를 시작할 때 한 번 띄우는 안내 팝업
  const [qtyNoticeOpen, setQtyNoticeOpen] = useState(false);
  const qtyNoticeShownRef = useRef(false); // 이미 한도 이상 보유 시 (이름 입력 직후 차단)
  const [typeOverflowModal, setTypeOverflowModal] = useState<{ current: number; adding: number; max: number } | null>(null); // 장바구니 담다가 한도 초과 시 (제출 직전 차단)
  // 깨질 위험 / 화재 위험 / 특정 업체 request용으로 표시된 물품이 장바구니에 있을 때,
  // 마지막(확인) 단계로 넘어가기 직전 한 번 더 확인시키는 팝업.
  const [hazardModal, setHazardModal] = useState<{ items: { id: string; name: string; fragile?: boolean; fireRisk?: boolean; requestFor?: string; personalOwner?: string }[]; proceedMode: Mode } | null>(null);

  // 마지막 확인 단계(targetMode)로 넘어가기 전에 위험/request 물품이 있는지 검사하고,
  // 있으면 모달을 띄워 확인을 받은 뒤에만 진행한다.
  function goToFinalStep(targetMode: Mode, picked: { id: string; name: string }[]) {
    const hazards = collectHazardItems(objectItems, picked);
    if (hazards.length > 0) { setHazardModal({ items: hazards, proceedMode: targetMode }); return; }
    setMode(targetMode);
  }
  const [verifying, setVerifying] = useState(false);
  const [itemType, setItemType] = useState<"scenario" | "general">("scenario");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [reqCart, setReqCart] = useState<CartItem[]>([]);
  const [sidCart, setSidCart] = useState<SidEntry[]>([]);
  const [sidInput, setSidInput] = useState("");
  // 대여 구분은 화면에서 없앴다. 서버가 아직 이 값을 받으므로 빈 값으로 보낸다.
  // 대여 구분(추가 물품 대여 / Light Scenario / Wild Scenario)은 화면에서 없앴다.
  // 기록에 빈 칸을 남기면 옛 기록과 섞였을 때 무엇인지 알 수 없어 "일반 대여"로 적는다.
  const [generalOption] = useState<string>("일반 대여");
  const [purposeGeneral, setPurposeGeneral] = useState("");
  const [purposeScenario, setPurposeScenario] = useState("");
  const [submitting, setSubmitting] = useState(false);

  /* ---------- 반납 상태 ---------- */
  const [unreturned, setUnreturned] = useState<UnreturnedItem[]>([]);
  const [returnLoading, setReturnLoading] = useState(false);
  const [returnSearch, setReturnSearch] = useState("");
  const [selectedReturn, setSelectedReturn] = useState<Record<string, number>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [returnSubmitting, setReturnSubmitting] = useState(false);

  /* ---------- 내 대여 조회 상태 ---------- */

  /* ---------- SID 검색 상태 ---------- */

  /* ---------- 위치 검색 상태 ---------- */

  /* ---------- 물품 필터 상태 (일반/추가 물품 피커) ---------- */
  const [itemSearch, setItemSearch] = useState("");
  const [itemCat, setItemCat] = useState("");
  const [itemSub, setItemSub] = useState("");
  const [itemSort, setItemSort] = useState<ItemSortKey>("id_desc");
  const [reqSearch, setReqSearch] = useState("");
  const [reqCat, setReqCat] = useState("");
  const [reqSub, setReqSub] = useState("");
  const [reqSort, setReqSort] = useState<ItemSortKey>("id_desc");

  // 대여·반납을 한 번 하면 이 화면이 들고 있던 재고와 보유 현황은 곧바로 낡은 값이 된다.
  // 앱 전체 동기화(2분)를 기다리면, 방금 반납한 걸 바로 다시 빌릴 때 옛 숫자로 막힌다.
  // 그래서 처리 직후 이 값을 올려 재고 목록과 보유 현황을 다시 받아오게 한다.
  const [dataNonce, setDataNonce] = useState(0);
  const invalidateAfterChange = useCallback(() => {
    setItemsLoaded(false);
    setDataNonce((n) => n + 1);
    onInventoryChanged?.();
  }, [onInventoryChanged]);

  // 대여자 상태 바에 쓸 보유 현황을 이름이 정해지는 즉시 조회한다.
  // step1Next에서만 채우면, 열람 화면에서 장바구니를 들고 바로 넘어오는 등
  // 이름 입력 단계를 건너뛴 경로에서 상태 바가 뜨지 않는다.
  const effectiveBorrowerName = (affiliation === "other" ? otherName.trim() : borrowerName.trim());
  useEffect(() => {
    if (!connected || !scriptUrl) return;
    if (!effectiveBorrowerName) return;
    // cfgw는 사번으로 동명이인을 구분해야 한다 — 사번을 입력하기 전에 이름만으로 조회하면
    // 같은 이름의 다른 사람 현황을 잘못 보여줄 수 있으니, 사번이 채워지기 전엔 조회하지 않는다.
    if (affiliation === "cfgw" && !/^\d+$/.test(employeeId.trim())) { setActiveTypeInfo(null); return; }
    let cancelled = false;
    fetchActiveItemTypeCount(scriptUrl, effectiveBorrowerName, { floor: selFloor, unit: selUnit }, { employeeId: employeeId.trim(), affiliation })
      .then((info) => { if (!cancelled) setActiveTypeInfo(info); })
      .catch(() => { /* 상태 표시용이므로 실패는 무시 */ });
    return () => { cancelled = true; };
  }, [connected, scriptUrl, effectiveBorrowerName, selFloor, selUnit, employeeId, affiliation, dataNonce]);

  useVersionWorkGuard(
    "borrow-system-work",
    submitting || returnSubmitting || !!resultInfo.isSyncing || cart.length > 0 || reqCart.length > 0 || sidCart.length > 0
      || Object.values(selectedReturn).some((qty) => qty > 0),
    entry === "return" ? "반납 신청 중" : "대여 신청 중",
  );

  /* ---------- 초기 로드: 버전 ---------- */
  useEffect(() => {
    if (!connected || !scriptUrl) return;
    fetchBorrowAppVersion(scriptUrl).then(setAppVersion).catch(() => {});
  }, [connected, scriptUrl]);

  // 좌석맵 로드 (대여 시 층수/유닛 선택용)
  //
  // 이 효과는 아래 "직접 진입 시 데이터 선로드" 효과보다 먼저 선언돼 있어야 한다.
  // GAS 호출은 앱 전체에서 최대 GAS_MAX_CONCURRENT_개까지만 동시에 나가는 전역 큐를
  // 공유하는데(withGasConcurrencyLimit), 물품 카탈로그(getObjectItems)나 창고재고
  // (getWarehouseInventory) 로딩이 이 큐 자리를 먼저 차지해버리면 훨씬
  // 가볍고 캐시로 빨리 끝나야 할 좌석맵 요청이 그 뒤에서 한참을 대기하게 된다 —
  // "좌석 배치도를 불러오지 못한다"고 느껴지는 원인이 실은 이 대기시간이었다.
  // 순서를 바꿔 좌석맵이 먼저 큐에 들어가게 한다.
  useEffect(() => {
    if (seatMapLoaded || !connected || !scriptUrl) return;
    fetchSeatMap(scriptUrl)
      .then((m) => {
        const floors = m.floors || [];
        setSeatMap(floors);
        try { sessionStorage.setItem(SEAT_MAP_CACHE_KEY, JSON.stringify(floors)); } catch (e) { /* 저장 실패는 무시 */ }
      })
      .catch((e: any) => {
        // 조회에 실패하면 좌석 선택 UI가 사라져 "유닛 지정이 없어졌다"로 보인다.
        // 캐시로 이미 그려져 있으면 굳이 알리지 않는다.
        console.error("[좌석배치도 조회 실패]", e);
        if (seatMap.length === 0) {
          showToast("좌석 배치도를 불러오지 못해 층/유닛 선택이 표시되지 않습니다. 새로고침해주세요.", "warn");
        }
      })
      .finally(() => setSeatMapLoaded(true));
  }, [connected, scriptUrl, seatMapLoaded]);

  /* 물품 열람에서 신원·좌석·장바구니를 이미 받아 왔다면, 같은 것을 다시 묻지 않는다.
   * 예전에는 여기서 신원 입력 화면이 한 번 더 떠서, 담고 나서 또 이름을 적는 꼴이었다.
   *
   * 화면만 건너뛰는 게 아니라 원래의 "다음" 동작을 그대로 부른다 — 종수 한도 검사와
   * ConfigDS 명부 확인이 그 안에 있어서, 건너뛰면 한도를 넘긴 사람이 그대로 통과한다.
   * 좌석 배치도가 도착한 뒤에 불러야 한다(그전에는 좌석 검사가 통과하지 못한다). */
  const autoAdvancedRef = useRef(false);
  useEffect(() => {
    if (autoAdvancedRef.current) return;
    if (mode !== "b1" || entry !== "borrow") return;
    if (!effectiveIdentity?.name) return;
    if (!seatMapLoaded) return;
    autoAdvancedRef.current = true;
    step1Next().catch(() => { setAutoBusy(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, entry, seatMapLoaded]);

  /* 물품 열람에서 이미 고른 것을 또 고르게 하지 않는다.
   *
   * b2는 "SID 대여냐 일반 대여냐"를 묻고, b3는 물품을 고르는 화면이다. 둘 다 물품 열람에서
   * 끝낸 일이라, 열람을 거쳐 온 사람에게는 같은 질문이 두 번 나오는 꼴이었다.
   * 그래서 확인 화면(b4)까지 곧바로 보낸다.
   *
   *  - 일반 대여: 담아 온 장바구니가 그대로 신청 목록이다. b4g로 간다.
   *  - SID 대여: 그 시나리오를 먼저 등록해야 필요 물품이 붙는다. SID를 넣고 조회가
   *    끝나기를 기다렸다가 b4s로 간다.
   *
   * 위험 물품 경고 같은 확인 절차는 건너뛰지 않는다 — 원래의 이동 함수를 그대로 쓴다. */
  const autoStepRef = useRef<"none" | "waitingSid" | "done" | "submitting">("none");

  /* 물품 열람을 거쳐 들어왔는지. 이때는 신원·방식·물품이 이미 정해져 있어서 중간 화면이
   * 전부 지나가는 길일 뿐이다. 그 화면들이 잠깐씩 비치면 무엇을 해야 하는 화면인지
   * 헷갈리므로, 신청이 끝날 때까지 "처리 중" 하나만 보여준다.
   * 막아야 할 것이 나오면(한도 초과·재고 부족 등) 이 덮개를 걷고 원래 화면을 보여준다. */
  // 신원이 있다고 해서 자동 신청이 도는 것은 아니다. 자동 신청은 SID로 들어왔거나
  // 시나리오 장바구니를 들고 왔을 때만 돈다 — 그게 아닌데 덮개를 켜면, 종류를 고르는
  // 화면 위에 "신청하는 중"이 30초 동안 떠 있는다(로그인한 사람이 대여를 누른 경우).
  const cameFromBrowse = entry === "borrow" && !!effectiveIdentity?.name
    && (!!initialSid || initialKind === "scenario");
  const [autoBusy, setAutoBusy] = useState(cameFromBrowse);
  const autoCancelledRef = useRef(false);

  // 자동 신청 경로에서 결과 화면으로 넘어간 뒤에도 중간 덮개 상태가 남아 있으면,
  // 사용자는 신청이 끝났는지 알 수 없다. 결과 화면에 진입하는 순간 자동 진행 덮개는 정리한다.
  useEffect(() => {
    if (mode === "result" && autoBusy) setAutoBusy(false);
  }, [mode, autoBusy]);

  /* 자동 신청이 멈추면 덮개만 남아 무한 로딩처럼 보일 수 있다.
   * 다만 실제 SID 조회·재고 조회는 환경에 따라 30초 이상 걸릴 수 있으므로, 짧은
   * 타임아웃으로 옛 단계 화면을 노출하면 안 된다. 확인 모달이 뜬 경우에만 덮개를
   * 걷고, 그 외에는 API 자체의 오류 응답을 기다린다. */
  useEffect(() => {
    if (!autoBusy) return;
    if (hazardModal || typeLimitModal || typeOverflowModal || stockShortfallModal || sidExcludeModal) { setAutoBusy(false); return; }
    return;
  }, [autoBusy, hazardModal, typeLimitModal, typeOverflowModal, stockShortfallModal, sidExcludeModal]);

  // 결과 화면에 들어가기 전 단계에도 반드시 종료 시간이 있어야 한다. SID·좌석·물품 목록 중
  // 어느 조회가 실패하더라도 덮개가 영구히 남지 않게 하고, 늦게 끝난 자동 작업도 제출하지 않는다.
  useEffect(() => {
    if (!autoBusy) return;
    const timer = window.setTimeout(() => {
      autoCancelledRef.current = true;
      setPendingSubmit(false);
      setAutoBusy(false);
      setLastNotice("대여 준비 시간이 오래 걸려 자동 진행을 중단했습니다. 물품 목록으로 돌아가 다시 시도해주세요.");
    }, 20000);
    return () => window.clearTimeout(timer);
  }, [autoBusy]);

  /* 확인 화면의 "신청하기"가 하던 일을 그대로 한다.
   * 물품 열람에서 이미 고르고 담고 신청을 눌렀으므로, 같은 것을 한 번 더 확인받지 않는다.
   * 다만 막아야 할 것(종수 한도 초과, 재고 부족, 위험 물품)은 그대로 검사한다 —
   * 걸리면 확인 화면이 뜨고 사람이 보고 정한다. */
  function autoSubmit(kind: "general" | "sid", picked: { id: string; name: string }[]) {
    if (autoCancelledRef.current) return;
    // 위험 물품(파손·화재·request용·개인 물품) 확인은 물품을 담는 순간에 이미 받았다.
    // 여기서 또 물으면 같은 것을 두 번 확인시키는 꼴이라 하지 않는다.
    if (kind === "general") {
      if (generalTypeOverflow) { setAutoBusy(false); setTypeOverflowModal(generalTypeOverflow); return; }
      if (generalStockShortfall.length > 0) { setAutoBusy(false); setStockShortfallModal(generalStockShortfall); return; }
    } else {
      if (scenarioTypeOverflow) { setAutoBusy(false); setTypeOverflowModal(scenarioTypeOverflow); return; }
      if (scenarioStockShortfall.length > 0) { setAutoBusy(false); setSidExcludeModal({ phase: "submit", stage: "confirm", items: scenarioStockShortfall }); return; }
    }
    // 어느 쪽으로 신청할지 그대로 넘긴다. setItemType은 아직 반영되기 전이라 믿을 수 없다.
    // 던져진 오류도 화면에 남긴다 — 콘솔에만 남으면 "아무 일도 안 일어났다"로 보인다.
    Promise.resolve(handleBorrowSubmit(false, kind === "general" ? "general" : "scenario"))
      .catch((e: any) => { setLastNotice(`신청 중 오류: ${e?.message || e}`); setAutoBusy(false); });
  }
  useEffect(() => {
    if (autoCancelledRef.current) return;
    if (autoStepRef.current === "done") return;
    if (mode !== "b2" || entry !== "borrow") return;
    if (!effectiveIdentity?.name) return;

    if (initialSid) {
      const sidUpper = initialSid.toUpperCase();
      // SID를 등록하고 조회가 끝나기를 기다린다. 물품 목록이 붙어야 확인 화면이 성립한다.
      if (autoStepRef.current === "none") {
        setItemType("scenario");
        const readyEntry = sidCart.find((e) => e.sid === sidUpper && !e.loading && e.scenario);
        // SID 열람에서 이미 담아 온 장바구니가 있으면 그것을 그대로 제출한다.
        // 이 경우 다시 SID를 조회하면 사용자가 고른 종류/수량이 사라져 자동 신청이 멈출 수 있다.
        if (!readyEntry) {
          autoStepRef.current = "waitingSid";
          setSidCart([{ sid: sidUpper, loading: true, scenario: null }]);
          loadSidScenario(sidUpper);
          return;
        }
      }
      const entryRow = sidCart[0];
      if (!entryRow || entryRow.loading) return;
      autoStepRef.current = "done";
      // 조회에 실패했거나 대여가 막힌 시나리오면 자동으로 넘기지 않는다. 사람이 보고 판단한다.
      if (!entryRow.scenario || entryRow.scenario.blocked || (entryRow.scenario as any).fetchError) {
        // 물품을 고르는 화면은 없앴다. 여기서 더 진행할 수 없으니 이유를 알리고 열람으로 돌려보낸다.
        showToast(entryRow.scenario?.blockReason || `${initialSid} 조회에 실패했습니다. 다시 시도해주세요.`, "error");
        onBack();
        return;
      }
      proceedFromSidToFinal();
      // 확인 화면이 그려진 뒤에 신청한다 — 그 화면의 값(필요 물품·재고)이 세워져야 검사가 맞다.
      setTimeout(() => {
        try { autoSubmit("sid", sidPicked()); }
        catch (e: any) { setLastNotice(`자동 신청 실패: ${e?.message || e}`); setAutoBusy(false); }
      }, 0);
      return;
    }

    autoStepRef.current = "done";
    setItemType("general");
    // 담아 온 게 없으면 고를 화면으로 보낸다.
    if (cart.length === 0) {
      showToast("담아둔 물품이 없습니다. 물품을 먼저 담아주세요.", "warn");
      onBack();
      return;
    }
    goToFinalStep("b4g", cart);
    setTimeout(() => {
      try { autoSubmit("general", cart.map((c) => ({ id: c.id, name: c.name }))); }
      catch (e: any) { setLastNotice(`자동 신청 실패: ${e?.message || e}`); setAutoBusy(false); }
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, entry, initialSid, sidCart, cart.length]);

  /* 직접 진입(대여/반납) 시 필요한 데이터 선로드 */
  const bootedRef = useRef(false);
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    if (initialKind === "scenario") {
      loadItems();
      // 열람 시나리오 장바구니 → 일반대여 카트로
      if (initialIdentity && (initialIdentity.affiliation === "cfgw" || !initialIdentity.affiliation)) {
        const saved = loadBrowseCart(initialIdentity.name, initialIdentity.employeeId);
        // 열람에서 고른 종류(variantId)까지 그대로 이어받는다 — 빠뜨리면 대여 화면에서
        // "종류를 골라야 합니다"로 막혀 다시 담아야 한다.
        if (saved.length) {
          setCart(saved.map((c) => ({ id: c.id, name: c.name, quantity: c.quantity, rootSlot: c.rootSlot, variantId: c.variantId, variantName: c.variantName })));
          setItemType(initialSid ? "scenario" : "general");
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- 물품 목록 로드 ---------- */
  const loadItems = useCallback(async () => {
    if (itemsLoading) return;
    setItemsLoading(true);
    try {
      if (connected && scriptUrl) {
        const items = await fetchObjectItems(scriptUrl);
        setObjectItems(items);
      } else {
        setObjectItems(DEMO_OBJECT_ITEMS);
      }
      setItemsLoaded(true);
    } catch (e: any) {
      showToast(`물품 목록을 불러오지 못했습니다: ${e.message}`, "error");
      // 로딩 실패 시 대기 중이던 자동 제출도 함께 취소한다.
      // (그대로 두면 itemsLoaded가 영영 true가 되지 않아 "물품 정보 확인 중..." 상태로
      //  버튼이 영구히 눌리지 않는 새로운 버그가 생긴다)
      setPendingSubmit(false);
      if (cameFromBrowse) {
        autoCancelledRef.current = true;
        setAutoBusy(false);
        setLastNotice("물품 재고 정보를 불러오지 못해 자동 신청을 중단했습니다. 다시 시도해주세요.");
      }
    } finally {
      setItemsLoading(false);
    }
  }, [connected, scriptUrl, itemsLoading, showToast]);

  useEffect(() => {
    // b3s(SID 입력)에서 미리 로딩을 시작해야, 다음 화면(b4s)에 도착해 바로 "신청하기"를
    // 눌러도 재고 목록이 비어 있어 재고초과로 오판되는 경쟁 상태(race condition)를 피할 수 있다.
    // 물품 열람에서 바로 신청하는 흐름은 이 화면들을 거치지 않는다. 그래서 목록이 안 실렸고,
    // 신청이 "물품 정보 확인 중"에서 멈춘 채로 남았다(무한 로딩으로 보였다).
    // 열람을 거쳐 들어온 경우에는 들어오자마자 받아둔다.
    if ((cameFromBrowse || mode === "b3g" || mode === "b3s" || mode === "b4g" || mode === "b4s") && !itemsLoaded && !itemsLoading) {
      loadItems();
    }
  }, [mode, itemsLoaded, itemsLoading, loadItems]);

  // 로딩 중에 "신청하기"를 눌러 대기 상태가 된 경우, 로딩이 끝나면 자동으로 이어서 제출한다.
  useEffect(() => {
    if (pendingSubmit && itemsLoaded && !itemsLoading) {
      setPendingSubmit(false);
      if (autoCancelledRef.current) return;
      // 목록을 기다리느라 미뤄진 신청이 어느 쪽이었는지 그대로 이어간다.
      handleBorrowSubmit(false, pendingTypeRef.current || undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSubmit, itemsLoaded, itemsLoading]);

  /* ---------- 카테고리 맵 ---------- */
  const categoryMap = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    objectItems.forEach((it) => {
      if (!it.category) return;
      if (!map[it.category]) map[it.category] = new Set<string>();
      if (it.subcategory) map[it.category].add(it.subcategory);
    });
    return map;
  }, [objectItems]);
  const categories = useMemo(() => Object.keys(categoryMap).sort(), [categoryMap]);

  // SID(시나리오) 필요 물품 + 추가 물품을 합산해 재고 부족 여부를 미리 계산.
  // handleBorrowSubmit의 검증과 동일한 로직 — 신청 버튼을 눌렀을 때 잠깐 뜨고 사라지는
  // 토스트에만 의존하면 "눌러도 반응 없음"처럼 느껴지므로, 화면에 계속 보이는 경고로 먼저 알려준다.
  const scenarioStockShortfall = useMemo(() => {
    const totals: Record<string, { name: string; quantity: number }> = {};
    const addQty = (id: string, nm: string, q: number) => {
      if (!id) return;
      if (!totals[id]) totals[id] = { name: nm, quantity: 0 };
      totals[id].quantity += q;
    };
    sidCart.forEach((e) => (e.scenario?.items || []).forEach((it) => addQty(it.id, it.name, it.quantity || 1)));
    reqCart.forEach((c) => addQty(c.id, c.name, c.quantity));
    const shortfalls: { id: string; name: string; requested: number; stock: number }[] = [];
    for (const id in totals) {
      const req = totals[id];
      const obj = objectItems.find((o) => o.id === id);
      if (!obj) continue; // 카탈로그에 없는 항목은 검증 대상에서 제외 (제출 시 검증과 동일 정책)
      const stock = obj.stock || 0;
      if (req.quantity > stock) shortfalls.push({ id, name: req.name, requested: req.quantity, stock });
    }
    return shortfalls;
  }, [sidCart, reqCart, objectItems]);

  // 일반 대여 장바구니(cart)도 동일하게 재고 부족을 미리 계산.
  const generalStockShortfall = useMemo(() => {
    const shortfalls: { id: string; name: string; requested: number; stock: number }[] = [];
    cart.forEach((c) => {
      const obj = objectItems.find((o) => o.id === c.id);
      if (!obj) return;
      const stock = obj.stock || 0;
      if (c.quantity > stock) shortfalls.push({ id: c.id, name: c.name, requested: c.quantity, stock });
    });
    return shortfalls;
  }, [cart, objectItems]);

  // 물품 종류 최대 보유 개수(한도) 초과 여부 — 이미 보유 중인 종류 + 이번에 새로 담은(안 갖고 있던) 종류를 합산.
  // 좌석배치도에서 ∞(예외 유닛)로 지정된 유닛을 선택한 신청은 물품 종류 한도를 적용하지 않는다.
  const seatExemptLocal = useMemo(() => {
    if (!selFloor || !selUnit) return false;
    const floor = seatMap.find((f) => (f.name || f.id) === selFloor);
    if (!floor) return false;
    const unit = (floor.units || []).find((u) => u.label === selUnit);
    return !!(unit && unit.exempt);
  }, [seatMap, selFloor, selUnit]);

  // 서버 판정이 있으면 그것을 우선하고, 없으면 화면에서 계산한 값을 쓴다.
  const seatExempt = activeTypeInfo?.exempt ?? seatExemptLocal;

  function computeTypeOverflow(newIds: Set<string>) {
    if (seatExempt) return null; // 예외 유닛: 종류 제한 없음
    if (!activeTypeInfo || activeTypeInfo.max <= 0) return null;
    const heldIds = new Set(activeTypeInfo.items.map((it) => it.id));
    let addingCount = 0;
    newIds.forEach((id) => { if (!heldIds.has(id)) addingCount++; });
    const total = activeTypeInfo.count + addingCount;
    if (total <= activeTypeInfo.max) return null;
    return { current: activeTypeInfo.count, adding: addingCount, max: activeTypeInfo.max };
  }
  const scenarioTypeOverflow = useMemo(() => {
    const ids = new Set<string>();
    sidCart.forEach((e) => (e.scenario?.items || []).forEach((it: any) => ids.add(it.id)));
    reqCart.forEach((c) => ids.add(c.id));
    return computeTypeOverflow(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidCart, reqCart, activeTypeInfo]);
  const generalTypeOverflow = useMemo(() => {
    const ids = new Set<string>();
    cart.forEach((c) => ids.add(c.id));
    return computeTypeOverflow(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, activeTypeInfo]);

  function subsOf(cat: string): string[] {
    return cat && categoryMap[cat] ? Array.from<string>(categoryMap[cat]).sort() : [];
  }

  function matchesFilters(it: ObjectItem, q: string, cat: string, sub: string): boolean {
    // "전체"는 필터 미적용으로 취급 (select 옵션 값과 상태 초기값 "" 모두 허용)
    if (cat && cat !== "전체" && it.category !== cat) return false;
    if (sub && sub !== "전체" && it.subcategory !== sub) return false;
    if (!q) return true;
    const slotPad = padSlot(String(it.rootSlot ?? ""));
    return smartMatch([it.name, it.id, it.category, it.subcategory, slotPad, it.rootSlot], q);
  }

  /* ══════════════════════ 공용 스타일/서브컴포넌트 ══════════════════════ */

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "14px 16px", fontSize: "15px", borderRadius: "12px",
    border: `1px solid ${C.border}`, background: isLightMode ? "#ffffff" : "#0f172a",
    color: C.text, outline: "none", boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = { display: "block", fontSize: "14px", fontWeight: 700, color: C.text, marginBottom: "8px" };
  const primaryBtn: React.CSSProperties = {
    flex: 1, padding: "14px", borderRadius: "12px", border: "none", cursor: "pointer",
    background: C.accent, color: "#fff", fontSize: "15px", fontWeight: 700,
    display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
  };
  const secondaryBtn: React.CSSProperties = {
    flex: 1, padding: "14px", borderRadius: "12px", cursor: "pointer",
    border: `1px solid ${C.border}`, background: C.card, color: C.label, fontSize: "15px", fontWeight: 700,
    display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
  };



  /* ══════════════════════ 대여 신청 흐름 ══════════════════════ */

  function validateStep1(): boolean {
    if (affiliation === "other") {
      if (!otherName.trim()) { setNameRequiredModal(true); return false; }
      return validateSeatLocation();
    }
    const v = borrowerName.trim();
    if (!v) { showToast("성함을 입력해주세요.", "warn"); return false; }
    if (!isKoreanName(v)) { showToast("이름은 한글만 입력할 수 있습니다.", "warn"); return false; }
    if (affiliation === "cfgw" && !/^\d+$/.test(employeeId.trim())) { showToast("사번은 숫자만 입력할 수 있습니다.", "warn"); return false; }
    return validateSeatLocation();
  }

  // 관리자가 좌석맵을 하나라도 등록해뒀다면 층수/유닛 입력을 필수로 요구한다.
  // (좌석맵이 아예 설정 안 된 조직은 이 필드 자체를 안 보여주고 막지도 않는다.)
  // 주의: seatMap이 비어있는 건 "좌석맵 미설정"과 "아직 로딩 중"이 똑같이 보인다 — 로딩이 끝나기도
  // 전에 다음 단계를 눌러버리면(장바구니→대여신청처럼 이 화면이 처음 뜨자마자 누르는 경로에서 특히
  // 잘 일어남) 유닛 지정 없이 그냥 통과돼버리는 문제가 있었다. 로딩 중에는 아예 다음으로 못 넘어가게 막는다.
  function validateSeatLocation(): boolean {
    if (!seatMapLoaded) { showToast("좌석 배치도를 불러오는 중입니다. 잠시 후 다시 시도해주세요.", "warn"); return false; }
    if (seatMap.length === 0) return true;
    if (!selFloor) { showToast("층수를 선택해주세요.", "warn"); return false; }
    // 테이블보는 자리에 두고 쓰는 물건이 아니라 유닛까지 물을 이유가 없다.
    if (!tcFlow && !selUnit) { showToast("유닛을 선택해주세요.", "warn"); return false; }
    return true;
  }

  // Enter 키로 다음 단계로 넘어가기 위한 헬퍼. (한글 조합 중 Enter는 무시)
  function onEnter(fn: () => void) {
    return (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !(e.nativeEvent as any).isComposing) {
        e.preventDefault();
        fn();
      }
    };
  }

  async function step1Next() {
    if (!validateStep1()) { setAutoBusy(false); return; }
    // 테이블보는 종수 한도에서 제외된다(촬영용 천이라 수량 제한 없이 빌린다).
    // 확인할 게 없으니 신원만 받고 바로 대여 패널을 연다.
    if (tcFlow) { setTcDetailId(null); setMode("tc"); return; }
    // 이미 물품 종류 한도(15종류) 이상 보유 중이면 여기서 바로 막는다 (물품 선택 단계까지 안 가도 됨).
    if (connected && scriptUrl) {
      const nameForCheck = affiliation === "other" ? otherName.trim() : borrowerName.trim();
      setVerifying(true);
      try {
        const info = await fetchActiveItemTypeCount(scriptUrl, nameForCheck, { floor: selFloor, unit: selUnit }, { employeeId: employeeId.trim(), affiliation });
        setActiveTypeInfo(info);
        // 예외 유닛 판정은 서버 값을 우선한다 (화면과 서버가 각자 판단하면 어긋난다)
        if (!(info.exempt || seatExempt) && info.max > 0 && info.count >= info.max) {
          setAutoBusy(false);   // 막혔으면 덮개를 걷고 원래 화면을 보여준다
          setTypeLimitModal(info);
          return;
        }
        // 미반납 기한 경고는 두지 않는다 — 당일 대여는 당일 반납이라 "며칠 지났다"가 의미가 없다.
      } catch (e: any) {
        // 조회 실패해도 대여 진행 자체는 막지 않는다 (최종 제출 시 서버가 다시 검증함)
      } finally {
        setVerifying(false);
      }
    }
    await finishStep1Advance();
  }

  async function finishStep1Advance() {
    if (affiliation === "configds" && connected && scriptUrl) {
      setVerifying(true);
      try {
        const result = await checkConfigDsRegistered(scriptUrl, borrowerName.trim());
        if (result.ambiguous) {
          setAutoBusy(false);
          showToast("같은 이름으로 등록된 ConfigDS 계정이 여러 개입니다. 관리자에게 계정 정리를 요청해주세요.", "error");
          return;
        }
        if (!result.registered) {
          setAutoBusy(false);
          showToast("ConfigDS 인원 명부에 등록되지 않은 이름입니다. 관리자에게 계정 등록을 요청해주세요.", "error");
          return;
        }
      } catch (e: any) {
        setAutoBusy(false);
        showToast(`확인 중 오류: ${e.message}`, "error");
        return;
      } finally {
        setVerifying(false);
      }
    }
    // 열람에서 담아 둔 장바구니를 가져온다.
    // 예전에는 cfgw만 가져왔다. 그래서 ConfigDS·기타 소속은 담아 온 것이 사라지고
    // 물품을 고르는 화면으로 빠졌다 — 사번이 없을 뿐 담는 방식은 같다.
    {
      const nm = (affiliation === "other" ? otherName : borrowerName).trim();
      const eid = affiliation === "cfgw" ? employeeId.trim() : "";
      saveIdentity({ name: nm, employeeId: eid, affiliation });
      const saved = loadBrowseCart(nm, eid);
      if (saved.length > 0) {
        const savedCart = saved.map((c) => ({ id: c.id, name: c.name, quantity: c.quantity, rootSlot: c.rootSlot, variantId: c.variantId, variantName: c.variantName }));
        const merge = (prev: CartItem[]) => {
          const next = prev.slice();
          saved.forEach((sv) => {
            // 같은 물품이라도 종류가 다르면 별개의 줄이므로 줄 키로 비교한다.
            const i = next.findIndex((c) => cartLineKey(c) === cartLineKey(sv));
            if (i === -1) next.push({ id: sv.id, name: sv.name, quantity: sv.quantity, rootSlot: sv.rootSlot, variantId: sv.variantId, variantName: sv.variantName });
          });
          return next;
        };
        setCart(merge);
        if (initialSid) {
          setItemType("scenario");
          setSidCart([{
            sid: initialSid.toUpperCase(),
            loading: false,
            scenario: {
              sid: initialSid.toUpperCase(),
              found: true,
              syncNeeded: false,
              blocked: false,
              blockReason: "",
              highLevelEn: "",
              highLevelKo: "",
              items: savedCart,
            },
          }]);
        }
        // 물품 선택 화면에서 들고 온 장바구니는 이미 이번 신청의 본 물품이다.
        // 이것을 SID의 '추가 물품' 장바구니에도 복사하면 SID 정의 수량에 같은 수량이
        // 한 번 더 합산된다(예: Shelf 필요 1개 + 장바구니 Shelf 1개 = 필요 2개).
        // 추가 물품은 폐기된 옛 SID 단계에서만 쓰던 값이므로 여기서는 비워 둔다.
        setReqCart(initialAdditionalItems.map((c) => ({ id: c.id, name: c.name, quantity: c.quantity, rootSlot: c.rootSlot, variantId: c.variantId, variantName: c.variantName })));
        showToast(`장바구니에서 ${saved.length}개 물품을 불러왔습니다.`, "ok");
      }
    }
    setMode("b2");
    // 수량·무단사용 안내는 이제 물품을 고르기 시작할 때(물품 열람) 띄운다.
    // 여기서 띄우면 신청 단추를 누른 직후에 떠서, 다 담고 난 뒤에야 읽게 된다.
  }

  const loadSidScenario = (val: string) => {
    setSidCart((prev) => prev.map((e) => (e.sid === val ? { ...e, loading: true } : e)));
    const applyResult = (scenario: ScenarioDefinition) => {
      if (scenario.errorMessage) {
        showToast(`SID 조회 중 경고 (${val}): ${scenario.errorMessage}`, "warn");
      }
      setSidCart((prev) => prev.map((e) => (e.sid === val ? { ...e, loading: false, scenario } : e)));
    };
    if (connected && scriptUrl) {
      // 150ms 지연 후 실제 패치를 동작하게 하여 React가 loading: true 상태를 화면에 먼저 그리도록 보장합니다.
      setTimeout(() => {
        fetchScenarioDefinition(scriptUrl, val)
          .then(applyResult)
          .catch((err: any) => {
            // 이전에는 어떤 이유로 실패하든 무조건 "동기화 필요"로만 뭉뚱그려 보여줬는데,
            // 그러면 실제 원인(네트워크 오류, 서버 예외, 배포 문제 등)을 알 수가 없었다.
            // 이제는 실제 에러 메시지를 그대로 담아서 화면에 보여준다.
            const message = err?.message || "알 수 없는 오류로 조회에 실패했습니다.";
            showToast(`SID 조회 실패 (${val}): ${message}`, "error");
            applyResult({
              sid: val, found: false, syncNeeded: false, blocked: false, blockReason: "",
              highLevelEn: "", highLevelKo: "", items: [], fetchError: message,
            });
          });
      }, 150);
    } else {
      setTimeout(() => applyResult({
        sid: val, found: true, syncNeeded: false, blocked: false, blockReason: "",
        highLevelEn: "Preview instruction", highLevelKo: "미리보기 안내",
        items: [{ id: "000008", name: "fruit", quantity: 1, rootSlot: "000060", stock: 15, rented: 8 }],
      }), 400);
    }
  };

  function tryAddSid(): boolean {
    const val = sidInput.trim().toUpperCase();
    if (!val) return false;
    if (!/^[SL]\d+$/i.test(val)) {
      showToast("시나리오 ID 형식이 유효하지 않습니다. S 또는 L로 시작하고 숫자가 와야 합니다. (예: S1234)", "warn");
      return false;
    }
    if (sidCart.some((s) => s.sid === val)) { showToast(`이미 추가된 SID입니다: ${val}`, "warn"); return false; }
    setSidCart((prev) => [...prev, { sid: val, loading: true, scenario: null }]);
    setSidInput("");
    loadSidScenario(val);
    return true;
  }

  function step3ScenarioNext() {
    if (sidInput.trim() !== "" && !tryAddSid()) return;
    if (sidCart.length === 0) { showToast("시나리오 ID를 하나 이상 입력하거나 추가해주세요.", "warn"); return; }
    if (sidCart.some((e) => e.loading)) { showToast("SID 정보를 불러오는 중입니다. 잠시 후 다시 시도해주세요.", "warn"); return; }
    const blocked = sidCart.find((e) => e.scenario?.blocked);
    if (blocked && blocked.scenario) { showToast(blocked.scenario.blockReason, "error"); return; }
    // 조회 자체가 실패한 SID는 시나리오 등록 여부를 확인할 수 없으므로, 확실해질 때까지 진행을 막는다.
    const failed = sidCart.find((e) => e.scenario?.fetchError);
    if (failed) { showToast(`${failed.sid} 조회에 실패해 시나리오 등록 여부를 확인할 수 없습니다. 다시 시도해주세요.`, "error"); return; }
    // 15종류 한도를 넘기면 확인 화면으로 넘어가지 못하게 여기서 바로 막는다.
    if (scenarioTypeOverflow) { setTypeOverflowModal(scenarioTypeOverflow); return; }
    // 재고가 모자란 물품이 있으면 막지 않고, 무엇이 빠지는지 보여주고 확인을 받는다.
    if (scenarioStockShortfall.length > 0) {
      setSidExcludeModal({ phase: "cart", stage: "warn", items: scenarioStockShortfall });
      return;
    }
    proceedFromSidToFinal();
  }

  /** SID 장바구니에 붙은 필요 물품을 평평하게 편 목록. 위험 물품 확인에 쓴다. */
  function sidPicked(): { id: string; name: string }[] {
    const out: { id: string; name: string }[] = [];
    sidCart.forEach((e) => (e.scenario?.items || []).forEach((it) => out.push({ id: it.id, name: it.name })));
    return out;
  }

  /** SID 확인이 끝난 뒤 최종 단계로 넘어가는 부분. 재고 확인 모달에서도 같은 곳으로 들어온다. */
  function proceedFromSidToFinal() {
    const flatPicked: { id: string; name: string }[] = [];
    sidCart.forEach((e) => (e.scenario?.items || []).forEach((it) => flatPicked.push({ id: it.id, name: it.name })));
    goToFinalStep("b4s", flatPicked);
  }

  /** `partialConfirmed`는 "재고 없는 물품을 빼고 신청한다"는 확인을 이미 받았다는 뜻이다.
   *  확인 모달에서 다시 이 함수를 부를 때만 true가 들어온다. */
  /** `typeOverride`는 자동 신청에서 쓴다.
   *  화면을 거치지 않고 바로 신청할 때는 setItemType이 아직 반영되기 전에 이 함수가 불린다.
   *  그러면 기본값(시나리오)으로 읽혀 SID 경로로 빠지고, 목록이 비어 아무 일도 일어나지 않는다.
   *  어느 쪽으로 신청할지는 부르는 쪽이 알고 있으므로 그대로 받아 쓴다. */
  async function handleBorrowSubmit(partialConfirmed = false, typeOverride?: "scenario" | "general") {
    const submitType = typeOverride ?? itemType;
    // 재고 검증에 물품 목록(objectItems)이 필요한데 아직 로딩 중이면, 재고를 0으로 오판해
    // "재고 초과"로 잘못 막아버릴 수 있다. 이 경우 조용히 대기했다가 로딩이 끝나면 자동으로
    // 이어서 제출한다 (사용자가 다시 버튼을 누를 필요 없음).
    if (itemsLoading || !itemsLoaded) {
      pendingTypeRef.current = submitType;
      setPendingSubmit(true);
      showToast("물품 재고 정보를 불러오는 중입니다. 완료되면 자동으로 신청을 진행합니다...", "warn");
      if (!itemsLoading && !itemsLoaded) loadItems();
      return;
    }

    // 화면 재고는 빠른 사전 안내에만 쓴다. 최종 재고 판정은 recordBorrow 서버 요청 안에서
    // 기록과 함께 처리된다. 여기서 전체 목록을 한 번 더 받으면 실패 지점만 하나 늘어나고,
    // 조회 직후 다른 사람이 먼저 빌리는 경쟁 상태도 완전히 막지 못한다.
    const submitInventory = objectItems;

    const name = affiliation === "other" ? otherName.trim() : borrowerName.trim();
    const contact = { affiliation, employeeId: employeeId.trim() };
    const nowStr = nowString();
    const borrowList: BorrowEntry[] = [];
    // 이번 신청에서 재고 때문에 뺀 물품. 영수증과 완료 안내에서도 같은 것을 빼야 한다.
    let excludedItemIds = new Set<string>();
    let excludedNames: string[] = [];

    if (submitType === "general") {
      if (cart.length === 0) { setAutoBusy(false); showToast("물품을 하나 이상 선택해주세요.", "warn"); return; }
      // 대여 구분(추가 물품 대여 / Light Scenario / Wild Scenario)은 없앴다. 신청 흐름에서
      // 유일하게 남은 필수 입력이라 화면이 한 번 더 떠야 했는데, 실제로 쓰이는 곳이 없었다.
      // 예전 기록의 값은 그대로 남는다.
      for (const c of cart) {
        const obj = submitInventory.find((o) => o.id === c.id);
        // 물품 목록은 이미 로딩이 끝난 상태(위에서 보장됨)이므로, obj가 없다는 것은
        // 카탈로그에 해당 ID가 없다는 뜻 — 재고 0으로 간주해 막기보다는 검증을 건너뛴다.
        if (!obj) continue;
        const stock = obj.stock || 0;
        if (c.quantity > stock) {
          // 자동 신청 덮개를 먼저 걷어야 재고 부족 모달이 가려지지 않는다.
          setAutoBusy(false);
          setStockShortfallModal([{ id: c.id, name: c.name, requested: c.quantity, stock }]);
          return;
        }
      }
      // 열람 장바구니에서 불러온 줄은 종류 정보가 없다 — 종류가 나뉜 물품이면
      // 여기서 먼저 잡아준다(서버도 막지만, 고치는 방법을 알려줘야 한다).
      const noVariant = cart.find((c) => {
        const obj = submitInventory.find((o) => o.id === c.id);
        return obj?.variants?.length && !c.variantId;
      });
      if (noVariant) {
        setAutoBusy(false);
        showToast(`'${noVariant.name}'은(는) 종류를 골라야 합니다. 장바구니에서 뺀 뒤 아래 목록에서 다시 담아주세요.`, "warn");
        return;
      }

      borrowList.push({
        itemType: "general", borrowerName: name, ...contact,
        borrowedItems: cart.map((c) => ({ id: c.id, name: c.name, quantity: c.quantity, variantId: c.variantId })),
        generalOption, borrowDate: nowStr, borrowPurpose: purposeGeneral,
        floor: selFloor || undefined, unit: selUnit || undefined,
      });
    } else {
      if (sidCart.some((e) => e.loading)) { setAutoBusy(false); showToast("시나리오의 필요 물품을 불러오는 중입니다. 잠시 후 다시 시도해주세요.", "warn"); return; }
      // DB에 없는 SID(또는 조회 실패로 확인 못한 SID)는 최종 제출 직전에도 한 번 더 막는다.
      const blockedEntry = sidCart.find((e) => e.scenario?.blocked || e.scenario?.fetchError);
      if (blockedEntry) {
        setAutoBusy(false);
        showToast(blockedEntry.scenario?.blockReason || `${blockedEntry.sid}는 시나리오 등록 여부를 확인할 수 없어 대여할 수 없습니다.`, "error");
        return;
      }
      // 종류가 나뉜 물품은 반드시 종류를 골라야 한다 — 서버도 막지만, 여기서 먼저
      // 어느 SID의 어느 물품인지 짚어주는 편이 고치기 쉽다.
      for (const e of sidCart) {
        for (const it of (e.scenario?.items || []) as any[]) {
          if (!it.variants?.length) continue;
          const need = it.quantity || 1;
          const used = Object.values(it.variantAlloc || {}).reduce((n: number, v: any) => n + (Number(v) || 0), 0);
          if (used !== need) {
            setAutoBusy(false);
            showToast(`[${e.sid}] '${it.name}'의 종류별 수량을 ${need}개에 맞춰 배정해주세요. (현재 ${used}개)`, "warn");
            return;
          }
        }
      }

      // 재고 합산 검증 (필요 물품 + 추가 물품)
      const totals: Record<string, { name: string; quantity: number }> = {};
      const addQty = (id: string, nm: string, q: number) => {
        if (!totals[id]) totals[id] = { name: nm, quantity: 0 };
        totals[id].quantity += q;
      };
      sidCart.forEach((e) => (e.scenario?.items || []).forEach((it) => addQty(it.id, it.name, it.quantity || 1)));
      const reqNoVariant = reqCart.find((c) => {
        const obj = submitInventory.find((o) => o.id === c.id);
        return obj?.variants?.length && !c.variantId;
      });
      if (reqNoVariant) {
        setAutoBusy(false);
        showToast(`'${reqNoVariant.name}'은(는) 종류를 골라야 합니다. 추가 물품에서 뺀 뒤 아래 목록에서 다시 담아주세요.`, "warn");
        return;
      }

      const additionalItems = reqCart.map((c) => ({ id: c.id, name: c.name, quantity: c.quantity, variantId: c.variantId }));
      additionalItems.forEach((it) => addQty(it.id, it.name, it.quantity || 1));
      // 재고가 모자란 물품은 막는 대신 이번 신청에서 뺀다. 담을 때 이미 한 번 확인했더라도
      // 그 사이 남이 먼저 빌려갔을 수 있으므로, 지금 재고로 다시 계산해 한 번 더 확인받는다.
      const excluded: { id: string; name: string; requested: number; stock: number }[] = [];
      for (const id in totals) {
        const req = totals[id];
        const obj = submitInventory.find((o) => o.id === id);
        // 카탈로그(objectItems)에 없는 ID(예: 시나리오에만 존재하는 필요 물품)는
        // 재고 0으로 간주해 막지 않고 검증을 건너뛴다 — 실제 서버 처리 시 별도로 확인된다.
        if (!obj) continue;
        const stock = obj.stock || 0;
        if (req.quantity > stock) excluded.push({ id, name: req.name, requested: req.quantity, stock });
      }
      if (excluded.length && !partialConfirmed) {
        setAutoBusy(false);
        setSidExcludeModal({ phase: "submit", stage: "confirm", items: excluded });
        return;
      }
      const excludedIds = new Set(excluded.map((e) => e.id));
      excludedItemIds = excludedIds;
      excludedNames = excluded.map((e) => e.name);

      const remaining =
        sidCart.reduce((n, e) => n + (e.scenario?.items || []).filter((it: any) => !excludedIds.has(it.id)).length, 0) +
        additionalItems.filter((it) => !excludedIds.has(it.id)).length;
      if (remaining === 0) {
        setAutoBusy(false);
        showToast("재고가 있는 물품이 하나도 없어 신청할 수 없습니다. 재고가 채워진 뒤 다시 시도해주세요.", "warn");
        return;
      }

      sidCart.forEach((entry) => {
        const scenario = entry.scenario || ({ items: [], syncNeeded: true } as any);
        borrowList.push({
          itemType: "scenario", borrowerName: name, ...contact,
          scenarioId: entry.sid,
          // 종류를 나눠 배정한 물품은 종류별로 항목을 쪼개 보낸다 — 서버가 항목마다
          // 별도의 대여 행을 만들고 그 종류의 재고에서 차감하므로, 이렇게 하면
          // "A 3개 + B 2개"가 정확히 두 건으로 기록된다.
          requiredObjects: (scenario.items || []).filter((it: any) => !excludedIds.has(it.id)).flatMap((it: any) => {
            if (!it.variants?.length) return [it];
            return Object.entries(it.variantAlloc || {})
              .filter(([, q]) => (Number(q) || 0) > 0)
              .map(([vid, q]) => ({
                ...it,
                quantity: Number(q),
                variantId: Number(vid),
                variantName: (it.variants || []).find((v: any) => String(v.id) === vid)?.name,
                variantAlloc: undefined,
              }));
          }),
          additionalItems: additionalItems.filter((it) => !excludedIds.has(it.id)),
          syncNeeded: !!scenario.syncNeeded,
          borrowDate: nowStr, borrowPurpose: purposeScenario,
          floor: selFloor || undefined, unit: selUnit || undefined,
        });
      });
    }

    setSubmitting(true);
    
    // 일단 즉시 "접수 완료 및 동기화 중" 화면 표시 (사용자가 대기할 필요가 없도록 비동기 처리)
    setResultInfo({
      ok: true,
      isSyncing: true,
      title: "대여 신청 접수 중...",
      sub:
        (excludedNames.length
          ? `재고가 없어 ${excludedNames.join(", ")}은(는) 제외하고 신청했습니다. `
          : "") +
        "서버에 대여 내역을 기록하고 있습니다. 잠시만 기다려주세요.",
    });
    setMode("result");
    setAutoBusy(false);
    setSubmitting(false);

    // 실제 전송은 백그라운드 비동기로 진행
    (async () => {
      const syncWatchdog = window.setTimeout(() => {
        setResultInfo((prev) => {
          if (!prev.isSyncing) return prev;
          return {
            ...prev,
            ok: false,
            isSyncing: false,
            title: "대여 신청 확인 필요",
            sub: "서버 응답이 오래 지연되어 화면의 로딩을 중단했습니다. 신청이 이미 기록됐을 수 있으니 대여 현황을 새로고침해 확인한 뒤, 기록이 없을 때만 다시 신청해주세요.",
          };
        });
      }, 20000);
      try {
        if (connected && scriptUrl) {
          // 제출 직전 최종 버전 확인 — 구버전이면 전송하지 않고 오버레이만 띄운다.
          if (!(await ensureUpToDate(scriptUrl, appVersion))) {
            setResultInfo((prev) => ({ ...prev, ok: false, isSyncing: false, title: "새 버전이 있어요", sub: "새로고침 후 다시 신청해주세요." }));
            return;
          }
          // SID 대여는 재고가 모자란 물품만 빼고 진행한다(이미 확인을 받았다).
          // 화면이 못 보는 물품(카탈로그에 없는 시나리오 전용 물품)까지는 서버만 알 수 있어서,
          // 최종 판단과 "무엇이 빠졌는지"는 서버에 맡긴다.
          const res = await postRecordBorrow(scriptUrl, borrowList, appVersion, {
            skipOutOfStock: submitType === "scenario",
          });
          if (!res.success && isVersionMismatchMessage(res.message)) {
            // 서버가 구버전이라 거절한 경우: 빨간 실패 화면 대신 부드러운 오버레이로 안내한다.
            signalVersionOutdated();
            setResultInfo((prev) => ({ ...prev, ok: false, isSyncing: false, title: "새 버전이 있어요", sub: "새로고침 후 다시 신청해주세요." }));
            return;
          }
          let borrowQr: { image: string; url: string; expiresAt: number } | undefined;
          if (res.success && res.lookupPath && /^\d{4}$/.test(res.employeeId || "")) {
            const url = `${window.location.protocol}//${window.location.hostname}:3002${res.lookupPath}?employeeId=${encodeURIComponent(res.employeeId!)}`;
            try {
              const image = await QRCode.toDataURL(url, { width: 360, margin: 2 });
              borrowQr = { image, url, expiresAt: Date.now() + 30_000 };
            } catch (qrError) {
              console.error("[대여 위치 QR 생성 실패]", qrError);
            }
          }
          setResultInfo((prev) => ({
            ...prev,
            ok: res.success,
            isSyncing: false,
            title: res.success ? "대여 신청 완료!" : "대여 기록 실패",
            borrowQr,
            pickupTimeoutMinutes: res.pickupTimeoutMinutes ?? (unattendedEnabled ? 240 : 20),
            // 서버가 실제로 뺀 물품을 앞세워 알려준다 — 화면에서 미리 걸러낸 것과 다를 수 있다.
            sub: (res.skipped?.length
              ? `재고가 없어 ${res.skipped.map((x) => x.name).join(", ")}은(는) 제외했습니다. `
              : "") + res.message + (res.success && !borrowQr ? " 위치 확인 QR을 만들지 못했습니다. 관리자에게 문의해주세요." : "")
          }));
          if (res.success) {
            // 성공이 확인된 뒤에만 장바구니를 비운다.
            // 전송 전/진행 중에 비우면 자동 신청이 멈췄을 때 사용자가 담은 목록까지 사라진다.
            clearBrowseCart(name, affiliation === "cfgw" ? employeeId.trim() : "");
            setCart([]); setReqCart([]);
            // 성공 시 리스트 새로고침
            loadUnreturned();
            // 빌린 만큼 재고와 종수가 줄었다 — 이어서 또 빌리거나 반납할 때 옛 숫자를
            // 쓰지 않도록 여기서 무효화한다.
            invalidateAfterChange();
          }
        } else {
          // 데모 모드
          await new Promise((resolve) => setTimeout(resolve, 800)); // 자연스러운 연출
          setResultInfo((prev) => ({
            ...prev,
            ok: true,
            isSyncing: false,
            title: "대여 신청 완료!",
            sub: "성공적으로 접수되었습니다. (로컬 데모)"
          }));
          clearBrowseCart(name, affiliation === "cfgw" ? employeeId.trim() : "");
          setCart([]); setReqCart([]);
        }
      } catch (e: any) {
        setResultInfo((prev) => ({
          ...prev,
          ok: false,
          isSyncing: false,
          title: "대여 신청 오류",
          sub: e.message || "네트워크 상태를 확인하고 다시 시도해주세요."
        }));
      } finally {
        window.clearTimeout(syncWatchdog);
        setAutoBusy(false);
        setSubmitting(false);
      }
    })();
  }

  /* ══════════════════════ 반납 처리 ══════════════════════ */

  const loadUnreturned = useCallback(async () => {
    setReturnLoading(true);
    setSelectedReturn({});
    setExpanded({});
    setReturnSearch("");
    try {
      if (connected && scriptUrl) {
        setUnreturned(await fetchUnreturnedItems(scriptUrl));
      } else {
        setUnreturned([
          { sheetType: "general", rowIndex: 2, borrowerName: "홍길동", itemLabel: "[000008] fruit x 3", location: "000060", quantity: 3, generalOption: "Light Scenario", submitDisplay: "2026-06-20 09:12", borrowDate: "2026-06-20", borrowPurpose: "테스트", email: "", batchId: "batch-A", image: "", stock: 15, rented: 8 },
          { sheetType: "general", rowIndex: 3, borrowerName: "홍길동", itemLabel: "[000019] towel (정사각형 소형 행주)", location: "000098", quantity: 1, generalOption: "Light Scenario", submitDisplay: "2026-06-20 09:12", borrowDate: "2026-06-20", borrowPurpose: "테스트", email: "", batchId: "batch-A", image: "", stock: 58, rented: 3 },
        ]);
      }
    } catch (e: any) {
      showToast(`미반납 목록을 불러오지 못했습니다: ${e.message}`, "error");
    } finally {
      setReturnLoading(false);
    }
  }, [connected, scriptUrl, showToast]);

  const normalizeSearch = (s: string) => s.normalize("NFC").replace(/\s+/g, "").toLowerCase();

  function itemMatchesQuery(it: UnreturnedItem, query: string): boolean {
    if (hideLocation) return smartMatch([it.itemLabel], query);
    const slotPad = padSlot(String(it.location ?? ""));
    return smartMatch([it.itemLabel, it.location, slotPad], query);
  }

  const sumQty = (items: UnreturnedItem[]) => items.reduce((n, it) => n + (Math.max(1, parseInt(String(it.quantity), 10) || 1)), 0);
  const sortByLoc = (items: UnreturnedItem[]) => items.slice().sort((a, b) => computeLocationSortIndex(a.location) - computeLocationSortIndex(b.location));
  const borrowDateKey = (it: UnreturnedItem) => it.submitDisplay || it.borrowDate || "(날짜 없음)";
  const keyOf = (it: UnreturnedItem) => `${it.sheetType}:${it.rowIndex}`;

  function groupBy<T>(items: T[], keyFn: (it: T) => string): { key: string; items: T[] }[] {
    const map: Record<string, T[]> = {};
    const order: string[] = [];
    items.forEach((it) => {
      const k = keyFn(it);
      if (!map[k]) { map[k] = []; order.push(k); }
      map[k].push(it);
    });
    return order.map((k) => ({ key: k, items: map[k] }));
  }

  function getAvatarColor(name: string) {
    const colors = [
      { bg: "#eff6ff", text: "#1e40af" }, // Blue
      { bg: "#ecfdf5", text: "#065f46" }, // Emerald
      { bg: "#fff7ed", text: "#9a3412" }, // Orange
      { bg: "#faf5ff", text: "#6b21a8" }, // Purple
      { bg: "#fdf2f8", text: "#9d174d" }, // Pink
      { bg: "#f0fdf4", text: "#166534" }, // Green
      { bg: "#fff1f2", text: "#9f1239" }, // Rose
      { bg: "#f0fdfa", text: "#115e59" }, // Teal
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % colors.length;
    return colors[index];
  }

  const uniqueBorrowers = useMemo(() => {
    const namesMap: Record<string, number> = {};
    unreturned.forEach((item) => {
      const bName = (item.borrowerName || "(이름 없음)").trim();
      namesMap[bName] = (namesMap[bName] || 0) + (Math.max(1, parseInt(String(item.quantity), 10) || 1));
    });
    return Object.entries(namesMap)
      .map(([name, totalQty]) => ({ name, totalQty }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [unreturned]);

  const returnTree = useMemo(() => {
    const query = returnSearch.trim();
    const sorted = unreturned.slice().sort((a, b) => (a.borrowDate || "") < (b.borrowDate || "") ? -1 : (a.borrowDate || "") > (b.borrowDate || "") ? 1 : 0);
    const byBorrower = groupBy<UnreturnedItem>(sorted, (it) => it.borrowerName || "(이름 없음)");
    const visible: { borrower: string; items: UnreturnedItem[] }[] = [];
    byBorrower.forEach(({ key: borrower, items }) => {
      if (!query) { visible.push({ borrower, items }); return; }
      const borrowerMatch = smartMatch([borrower], query);
      const matched = borrowerMatch ? items : items.filter((it) => itemMatchesQuery(it, query));
      if (borrowerMatch || matched.length) visible.push({ borrower, items: matched });
    });
    return visible;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreturned, returnSearch]);

  function toggleReturnKeys(items: UnreturnedItem[], check: boolean) {
    setSelectedReturn((prev) => {
      const next = { ...prev };
      items.forEach((it) => {
        const k = keyOf(it);
        if (check) next[k] = prev[k] ?? Math.max(1, parseInt(String(it.quantity), 10) || 1);
        else delete next[k];
      });
      return next;
    });
  }



  async function handleReturnSubmit() {
    const keys = Object.keys(selectedReturn);
    if (!keys.length) return;
    const requests: ReturnRequest[] = keys.map((k) => {
      const [sheetType, rowIndex] = k.split(":");
      return { sheetType: sheetType as "scenario" | "general", rowIndex: parseInt(rowIndex, 10), quantity: selectedReturn[k], source: "self" };
    });
    setReturnSubmitting(true);

    // 먼저 "반납 처리 진행 중" 화면 표시하여 무한 스피너 대기 제거
    setResultInfo({
      ok: true,
      isSyncing: true,
      title: "반납 처리 진행 중...",
      sub: "서버에 반납 내역을 기록하고 있습니다. 잠시만 기다려주세요."
    });
    setMode("result");
    setReturnSubmitting(false);

    // 실제 반납 API 백그라운드 전송
    (async () => {
      try {
        if (connected && scriptUrl) {
          // 제출 직전 최종 버전 확인 — 구버전이면 전송하지 않고 오버레이만 띄운다.
          if (!(await ensureUpToDate(scriptUrl, appVersion))) {
            setResultInfo({ ok: false, isSyncing: false, title: "새 버전이 있어요", sub: "새로고침 후 다시 반납해주세요." });
            return;
          }
          const res = await postProcessReturn(scriptUrl, requests, appVersion);
          if (!res.success && isVersionMismatchMessage(res.message)) {
            signalVersionOutdated();
            setResultInfo({ ok: false, isSyncing: false, title: "새 버전이 있어요", sub: "새로고침 후 다시 반납해주세요." });
            return;
          }
          setResultInfo({
            ok: res.success,
            isSyncing: false,
            title: res.success ? "반납 처리 완료!" : "반납 기록 실패",
            sub: res.message
          });
          // 성공 시 반납된 수량을 UI에 반영하기 위해 목록 새로 로드
          if (res.success) {
            setSelectedReturn({});
            loadUnreturned();
            // 방금 반납한 것을 이어서 다시 빌리는 흐름이 흔하다. 재고와 종수 한도를
            // 여기서 새로 받아두지 않으면 반납 전 숫자로 판단해 대여가 막힌다.
            invalidateAfterChange();
          }
        } else {
          // 데모 모드
          await new Promise((resolve) => setTimeout(resolve, 800));
          setResultInfo({
            ok: true,
            isSyncing: false,
            title: "반납 처리 완료!",
            sub: `${keys.length}건이 반납 처리되었습니다. (로컬 데모)`
          });
          setSelectedReturn({});
        }
      } catch (e: any) {
        setResultInfo({
          ok: false,
          isSyncing: false,
          title: "반납 처리 오류",
          sub: e.message || "네트워크 상태를 확인하고 다시 시도해주세요."
        });
      }
    })();
  }

  /* ══════════════════════ 초기화 & 결과 ══════════════════════ */

  function resetAll() {
    setCart([]); setReqCart([]); setSidCart([]); setSidInput("");
    setActiveTypeInfo(null); setTypeLimitModal(null); setTypeOverflowModal(null);
    setPurposeGeneral(""); setPurposeScenario("");
    setSelectedReturn({}); setExpanded({}); setReturnSearch("");
    setItemSearch(""); setItemCat(""); setItemSub(""); setReqSearch(""); setReqCat(""); setReqSub("");
    setItemsLoaded(false); setObjectItems([]);
    setSelFloor(""); setSelUnit("");
    setMode(rootMode);
    if (rootMode === "return") loadUnreturned();
    if (rootMode === "b1") loadItems();
  }

  /* ══════════════════════ 헤더/네비 ══════════════════════ */

  const titles: Record<string, string> = {
    pickBorrowKind: "대여 신청", pickReturnKind: "반납 처리",
    // 테이블보는 같은 화면을 대여·반납 양쪽에서 열기 때문에 들어온 목적에 맞춰 제목을 바꾼다.
    b1: tcFlow ? (tcTab === "mine" ? "테이블보 반납" : "테이블보 대여") : "시나리오 대여 신청",
    tc: tcTab === "mine" ? "테이블보 반납" : "테이블보 대여", b2: "시나리오 대여 신청", b3g: "시나리오 대여 신청",
    b4g: "시나리오 대여 신청", b3s: "시나리오 대여 신청", b4s: "시나리오 대여 신청",
    return: "시나리오 반납 처리", result: "",
  };

  function goPrev() {
    if (mode === rootMode) {
      onBack(); return;
    }
    if (mode === "tc") {
      // 물품 상세를 펼쳐 본 상태면 목록으로만 한 단계 돌아간다.
      if (tcDetailId) { setTcDetailId(null); return; }
      // 반납하러 곧장 들어온 경우엔 앞 단계가 없다 — 바로 처음 화면으로 나간다.
      if (tcReturnDirect) { onBack(); return; }
      setMode("b1"); return;
    }
    if (mode === "b1") { setTcFlow(false); setMode(entry === "return" ? "pickReturnKind" : "pickBorrowKind"); }
    else if (mode === "b2") setMode("b1");
    else if (mode === "b3g" || mode === "b3s") setMode("b2");
    else if (mode === "b4g") setMode("b3g");
    else if (mode === "b4s") setMode("b3s");
    else if (mode === "return") setMode("pickReturnKind");
    else setMode(rootMode);
  }

  // 시나리오 대여의 단계 화면을 없앴으므로 그 흐름에는 진행 표시줄이 의미가 없다.
  // 공구 대여는 아직 단계가 남아 있어 그대로 둔다.

  /* ── URL 해시로 대여 단계를 세분화 (#/borrow/<단계>) — 새로고침·공유·뒤로가기 지원 ── */
  // 시나리오 대여의 단계 화면들은 지웠다. 주소에 그 단계가 남아 있어도 되살리지 않는다 —
  // 되살리면 그릴 것이 없어 빈 화면이 된다(새로고침했을 때 실제로 그랬다).
  const MODE_SLUGS: Record<string, string> = {
    pickBorrowKind: "kind", pickReturnKind: "kind",
    return: "return", result: "done", mode: "kind",
  };
  const SLUG_TO_MODE: Record<string, Mode> = {
    kind: entry === "return" ? "pickReturnKind" : "pickBorrowKind",
    return: "return", done: "result",
  };
  /* 지워진 화면에 닿으면 그릴 것이 없어 빈 화면이 된다. 주소를 직접 열었거나
   * 새로고침한 경우다. 폐기 안내 화면을 남겨두면 사용자가 이 경로를 다시 쓰는
   * 것으로 오해하므로, 항상 유효한 화면으로 즉시 내보낸다. */
  useEffect(() => {
    const gone = ["b1", "b2", "b3g", "b4g", "b3s", "b4s"];
    if (!gone.includes(mode)) return;
    // 테이블보는 b1(신원 확인)을 지금도 쓴다 — 여기서 내보내면 대여 자체가 안 된다.
    if (tcFlow) return;
    // 정상 자동 신청은 옛 단계를 내부적으로만 잠깐 지난다. 처리 중에는 내보내지 않는다.
    if (cameFromBrowse && autoBusy) return;
    // 물품 선택을 거쳐 온 자동 신청은 오류·확인 취소 뒤 장바구니로 되돌린다.
    // URL로 직접 들어온 옛 대여 주소(#/borrow/)는 초기 화면으로 돌려보낸다.
    // 확인 모달이 열린 동안에는 사용자가 먼저 내용을 읽고 닫을 수 있게 기다린다.
    if (hazardModal || typeLimitModal || typeOverflowModal || stockShortfallModal || sidExcludeModal) return;
    if (cameFromBrowse) onGoPickItems?.(initialSid ? "sid" : undefined) || onBack();
    else onBack();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, cameFromBrowse, tcFlow, autoBusy, hazardModal, typeLimitModal, typeOverflowModal, stockShortfallModal, sidExcludeModal]);

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const suppressHashSync = useRef(false);

  // 슬라이딩 방향 추적: 단계 순서를 매겨 앞으로/뒤로를 판단한다.
  // (렌더 중 동기 계산 — key가 바뀌는 순간 올바른 방향이 즉시 적용되도록)
  const MODE_ORDER: Record<string, number> = {
    pickBorrowKind: 0, pickReturnKind: 0, mode: 0,
    b1: 1, b2: 2, b3g: 3, b3s: 3, b4g: 4, b4s: 4,
    tc: 1, return: 1, result: 5,
  };
  const prevOrderRef = useRef(MODE_ORDER[mode] ?? 0);
  const slideDirRef = useRef<"forward" | "back">("forward");
  const curOrder = MODE_ORDER[mode] ?? 0;
  if (curOrder !== prevOrderRef.current) {
    slideDirRef.current = curOrder >= prevOrderRef.current ? "forward" : "back";
    prevOrderRef.current = curOrder;
  }
  const slideDir = slideDirRef.current;

  // mode 변경 → 해시 반영 (뒤로가기용 히스토리 항목 생성)
  useEffect(() => {
    if (suppressHashSync.current) { suppressHashSync.current = false; return; }
    const base = entry === "return" ? "return" : "borrow";
    const slug = MODE_SLUGS[mode] || "";
    const target = `#/${base}/${slug}`;
    if (window.location.hash !== target) {
      window.history.pushState(null, "", target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // 브라우저 뒤로/앞으로 → 해시에서 mode 복원. 흐름을 벗어나면 onBack.
  useEffect(() => {
    const onPop = () => {
      const parts = window.location.hash.split("/");
      const base = parts[1] || "";
      const slug = parts[2] || "";
      if (base !== "borrow" && base !== "return") { onBack(); return; }
      const restored = SLUG_TO_MODE[slug];
      if (restored && restored !== modeRef.current) {
        suppressHashSync.current = true; // 복원은 히스토리를 새로 쌓지 않음
        setMode(restored);
      } else if (!restored) {
        onBack();
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ══════════════════════ 렌더 ══════════════════════ */

  return (
    <div className="bsp-root" style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "inherit" }}>
      <style>{`
        @keyframes bsp-spin { to { transform: rotate(360deg); } }

        /* PC(넓은 화면)에서는 전체적으로 살짝 크게 — 모바일 폭(480px 이하)에는 영향 없음 */
        @media (min-width: 900px) {
          .bsp-root { zoom: 1.15; }
          /* 대여/반납 화면의 물품 썸네일을 PC에서 더 크게 (물건이 잘 안 보인다는 피드백 반영) */
          .bsp-thumb { width: 68px !important; height: 68px !important; flex-basis: 68px !important; }
        }
        
        .responsive-group-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 14px 16px;
          cursor: pointer;
          transition: background 0.2s;
        }
        .responsive-group-title {
          flex: 1;
          font-weight: 800;
          font-size: 15px;
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
        }
        .responsive-avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 800;
          font-size: 13px;
          box-shadow: inset 0 0 0 1px rgba(0,0,0,0.04);
          flex-shrink: 0;
        }
        .responsive-badge {
          font-size: 11px;
          font-weight: 800;
          border-radius: 14px;
          padding: 3px 10px;
          flex-shrink: 0;
          transition: all 0.2s;
        }
        .responsive-item-card {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 12px;
          border-radius: 10px;
          margin-bottom: 6px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .responsive-item-title {
          font-weight: 700;
          font-size: 13px;
          line-height: 1.35;
        }
        .responsive-control-row {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 8px;
        }
        
        @media (max-width: 480px) {
          .responsive-group-header {
            padding: 10px 10px !important;
            gap: 8px !important;
          }
          .responsive-group-title {
            font-size: 13px !important;
            gap: 4px !important;
          }
          .responsive-group-title span {
            font-size: 10px !important;
          }
          .responsive-avatar {
            width: 26px !important;
            height: 26px !important;
            font-size: 11px !important;
          }
          .responsive-badge {
            font-size: 9.5px !important;
            padding: 2px 7px !important;
          }
          .responsive-item-card {
            padding: 8px !important;
            gap: 8px !important;
          }
          .responsive-item-title {
            font-size: 12px !important;
          }
          .responsive-control-row {
            flex-wrap: wrap !important;
            gap: 6px !important;
          }
          .responsive-control-row button {
            width: 24px !important;
            height: 24px !important;
            border-radius: 5px !important;
          }
          .responsive-control-row span {
            font-size: 12px !important;
          }
        }
      `}</style>

      {/* 상단바 */}
      <div ref={headerRef} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "16px 20px", borderBottom: `1px solid ${C.border}`, background: C.card, position: "sticky", top: 0, zIndex: 20 }}>
        <button
          onClick={() => (mode === rootMode ? onBack() : goPrev())}
          style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.card, color: C.label, cursor: "pointer", fontSize: "13px", fontWeight: 600 }}
        >
          <ArrowLeft size={15} /> {mode === rootMode ? "메인으로" : "이전"}
        </button>
        <h1 style={{ fontSize: "17px", fontWeight: 800, margin: 0, flex: 1 }}>{titles[mode] || "물품 대여 시스템"}</h1>
        {!connected ? (
          <span style={{ fontSize: "11px", fontWeight: 700, color: C.warn, background: C.warnSoft, padding: "4px 10px", borderRadius: "8px" }}>데모 모드</span>
        ) : null}
      </div>

      {/* 하단 여백은 떠 있는 장바구니 버튼(높이 ~54px + bottom 22px)보다 넉넉해야 한다.
          48px일 때 모바일에서 "다음" 버튼이 장바구니에 가려졌다. */}
      <div style={{ maxWidth: "620px", margin: "0 auto", padding: "24px 16px 120px" }}>

        {/* 물품 열람을 거쳐 온 신청은 중간 화면이 전부 지나가는 길일 뿐이다.
            그 화면들이 잠깐씩 비치면 무엇을 하는 화면인지 헷갈리므로 이걸로 덮는다.
            막아야 할 것이 나오면 덮개가 걷히고 원래 화면이 나온다.
            덮개는 단계 전환 상자(key={mode}) 밖에 둔다 — 안에 두면 자동 진행이 b1→b2→b4로
            넘어갈 때마다 덮개가 다시 그려지며 오른쪽에서 미끄러져 들어오기를 반복했다. */}
        {autoBusy && mode !== "result" ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "14px", padding: "80px 0", textAlign: "center" }}>
            <Spinner size={30} C={C} />
            <div style={{ fontSize: "15px", fontWeight: 800, color: C.text }}>대여를 신청하는 중입니다</div>
            <div style={{ fontSize: "12.5px", color: C.label, lineHeight: 1.6 }}>
              담아둔 물품으로 바로 신청합니다. 잠시만 기다려주세요.
            </div>
          </div>
        ) : null}

        {/* ───────── 대여 종류 선택 (시나리오 / 창고) ───────── */}
        {/* 자동 진행 중에는 지나가는 단계라 전환 효과를 주지 않는다. 결과 화면에서 한 번만 들어온다. */}
        <div key={mode} className={autoBusy && mode !== "result" ? undefined : slideDir === "forward" ? "step-forward" : "step-back"}>
        {mode === "pickBorrowKind" || mode === "pickReturnKind" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ fontSize: "13px", color: C.label, marginBottom: "4px" }}>
              {mode === "pickBorrowKind" ? "대여할 물품 종류를 선택하세요." : "반납할 물품 종류를 선택하세요."}
            </div>
            {[
              { kind: "scenario", icon: <Fingerprint size={22} />, color: C.accentText, bg: C.accentSoft, title: "시나리오 물품", sub: "SID 기반 대여 및 일반 대여" },
              // 테이블보 대여는 새 열람 화면의 장바구니 안에서 완료한다. 이 옛 화면에는
              // 반납 진입점만 남겨, 오래된 대여 목록으로 다시 들어가지 않게 한다.
              ...(mode === "pickReturnKind" ? [{ kind: "tablecloth", icon: <Layers size={22} />, color: C.warn, bg: C.warnSoft, title: "테이블보 반납하기", sub: "내가 빌린 테이블보를 직접 반납합니다" }] : []),
            ].map((m) => (
              <div
                key={m.kind}
                onClick={() => {
                  if (mode === "pickBorrowKind") {
                    if (m.kind === "tablecloth") { setTcFlow(true); setTcTab("list"); setMode("b1"); }
                    // 시나리오 물품을 고르는 화면은 물품을 담는 쪽으로 옮겨 갔다. 여기서
                    // 옛 단계로 넘기면 "이 화면은 더 이상 쓰이지 않습니다"에 닿는다.
                    else if (m.kind === "scenario") { (onGoPickItems || onBack)(); }
                  } else {
                    if (m.kind === "tablecloth") { setTcFlow(true); setTcTab("mine"); setTcDetailId(null); setMode("b1"); }
                    else if (m.kind === "scenario") { setMode("return"); loadUnreturned(); }
                  }
                }}
                style={{ display: "flex", alignItems: "center", gap: "16px", padding: "22px 18px", border: `1px solid ${C.border}`, borderRadius: "16px", background: C.card, cursor: "pointer", transition: "all 0.2s" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.transform = "translateY(-2px)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.transform = "translateY(0)"; }}
              >
                <div style={{ flex: "0 0 48px", width: 48, height: 48, borderRadius: "13px", background: m.bg, color: m.color, display: "flex", alignItems: "center", justifyContent: "center" }}>{m.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "2px" }}>{m.title}</div>
                  <div style={{ fontSize: "12px", color: C.label }}>{m.sub}</div>
                </div>
                <ChevronRight size={16} style={{ color: C.border }} />
              </div>
            ))}
          </div>
        ) : null}

        {/* ───────── 테이블보: 목록·대여·반납 (한 페이지) ───────── */}
        {mode === "tc" ? (
          <TableclothPanel
            scriptUrl={scriptUrl}
            isLightMode={isLightMode}
            showToast={showToast}
            identity={{ name: effectiveBorrowerName, employeeId: employeeId.trim(), affiliation }}
            floor={selFloor}
            detailId={tcDetailId}
            onDetailId={setTcDetailId}
            initialTab={tcTab}
          />
        ) : null}


        {/* 시나리오 대여의 단계 화면들(신청인·유형 선택·물품 선택·제출)이 여기 있었다.
            대여를 물품 열람에서 시작하도록 바꾸면서 갈 일이 없어졌다 — 신원은 로그인에서,
            방식과 물품은 열람에서 정해져 들어온다. 남겨두면 언제 뜨는 화면인지 알 수 없어
            통째로 지웠다. 반납·공구·테이블보 화면은 그대로 쓰인다. */}

        {/* 시나리오 대여의 옛 b1~b4 단계는 더 이상 렌더링하지 않는다.
            위 효과가 Landing 또는 물품 선택 화면으로 바로 이동시킨다. */}

        {/* ───────── 반납 처리 ───────── */}
        {mode === "return" ? (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
              <label style={{ ...labelStyle, marginBottom: 0 }}>반납 처리할 물품을 선택해주세요</label>
              <button
                onClick={() => !returnLoading && loadUnreturned()}
                disabled={returnLoading}
                title="새로고침"
                style={{ display: "flex", alignItems: "center", gap: "5px", padding: "6px 10px", borderRadius: "8px", border: `1px solid ${C.border}`, background: C.card, color: C.label, fontSize: "12px", fontWeight: 700, cursor: returnLoading ? "default" : "pointer", opacity: returnLoading ? 0.6 : 1, flexShrink: 0 }}
              >
                <style>{`@keyframes spinSyncBtn { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } } .sync-icon-spin { animation: spinSyncBtn 0.9s linear infinite; }`}</style>
                <RotateCcw size={13} className={returnLoading ? "sync-icon-spin" : undefined} /> 새로고침
              </button>
            </div>
            <div style={{ position: "relative", marginBottom: "12px" }}>
              <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
              <input value={returnSearch} onChange={(e) => setReturnSearch(e.target.value)} placeholder="대여자 이름 · 물품명 · 위치로 검색..." style={{ ...inputStyle, paddingLeft: "36px", padding: "11px 12px 11px 36px", fontSize: "14px" }} />
            </div>

            {returnLoading ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", padding: "48px 0", color: C.label }}>
                <Spinner size={30} C={C} /> 미반납 목록을 불러오는 중입니다...
              </div>
            ) : unreturned.length === 0 ? (
              <div style={{ textAlign: "center", padding: "48px 0", color: C.label, fontSize: "14px" }}>
                <Check size={36} style={{ color: C.border, marginBottom: "8px" }} /><div>현재 미반납된 물품이 없습니다.</div>
              </div>
            ) : returnTree.length === 0 ? (
              <div style={{ textAlign: "center", padding: "48px 0", color: C.label, fontSize: "14px" }}>검색 결과가 없습니다.</div>
            ) : (
              <div style={{ marginBottom: "120px" }}>
                {returnTree.map(({ borrower, items }) => {
                  const all = sortByLoc(items);
                  const scenarioItems = all.filter((it) => it.sheetType === "scenario");
                  const additionalItems = all.filter((it) => it.sheetType === "general" && it.generalOption === "SID 추가 물품");
                  const generalItems = all.filter((it) => it.sheetType === "general" && it.generalOption !== "SID 추가 물품");
                  return (
                    <GroupSection
                      key={borrower}
                      gKey={borrower}
                      title={borrower}
                      items={all}
                      level={1}
                      expanded={expanded}
                      setExpanded={setExpanded}
                      returnSearch={returnSearch}
                      isLightMode={isLightMode}
                      C={C}
                      getAvatarColor={getAvatarColor}
                      sumQty={sumQty}
                      toggleReturnKeys={toggleReturnKeys}
                      selectedReturn={selectedReturn}
                      keyOf={keyOf}
                    >
                      {(scenarioItems.length || additionalItems.length) ? (
                        <GroupSection
                          gKey={`${borrower}|sid`}
                          title="SID 대여"
                          icon={<Fingerprint size={13} style={{ color: C.accentText }} />}
                          items={[...scenarioItems, ...additionalItems]}
                          level={2}
                          expanded={expanded}
                          setExpanded={setExpanded}
                          returnSearch={returnSearch}
                          isLightMode={isLightMode}
                          C={C}
                          getAvatarColor={getAvatarColor}
                          sumQty={sumQty}
                          toggleReturnKeys={toggleReturnKeys}
                          selectedReturn={selectedReturn}
                          keyOf={keyOf}
                        >
                          {groupBy(scenarioItems, (it) => it.scenarioId || "(SID 없음)").map((grp) => (
                            <GroupSection
                              key={grp.key}
                              gKey={`${borrower}|sid|${grp.key}`}
                              title={grp.key}
                              items={grp.items}
                              level={3}
                              expanded={expanded}
                              setExpanded={setExpanded}
                              returnSearch={returnSearch}
                              isLightMode={isLightMode}
                              C={C}
                              getAvatarColor={getAvatarColor}
                              sumQty={sumQty}
                              toggleReturnKeys={toggleReturnKeys}
                              selectedReturn={selectedReturn}
                              keyOf={keyOf}
                            >
                              {sortByLoc(grp.items).map((item) => (
                                <ReturnItemCard
                                  key={keyOf(item)}
                                  item={item}
                                  selectedReturn={selectedReturn}
                                  setSelectedReturn={setSelectedReturn}
                                  toggleReturnKeys={toggleReturnKeys}
                                  C={C}
                                  keyOf={keyOf}
                                  setImageModalUrl={setImageModalUrl}
                                />
                              ))}
                            </GroupSection>
                          ))}
                          {additionalItems.length ? (
                            <GroupSection
                              gKey={`${borrower}|add`}
                              title="추가 대여"
                              icon={<PlusCircle size={13} style={{ color: C.warn }} />}
                              items={additionalItems}
                              level={3}
                              expanded={expanded}
                              setExpanded={setExpanded}
                              returnSearch={returnSearch}
                              isLightMode={isLightMode}
                              C={C}
                              getAvatarColor={getAvatarColor}
                              sumQty={sumQty}
                              toggleReturnKeys={toggleReturnKeys}
                              selectedReturn={selectedReturn}
                              keyOf={keyOf}
                            >
                              {groupBy(additionalItems, borrowDateKey).map((grp) => (
                                <GroupSection
                                  key={grp.key}
                                  gKey={`${borrower}|add|${grp.key}`}
                                  title={grp.key}
                                  items={grp.items}
                                  level={4}
                                  expanded={expanded}
                                  setExpanded={setExpanded}
                                  returnSearch={returnSearch}
                                  isLightMode={isLightMode}
                                  C={C}
                                  getAvatarColor={getAvatarColor}
                                  sumQty={sumQty}
                                  toggleReturnKeys={toggleReturnKeys}
                                  selectedReturn={selectedReturn}
                                  keyOf={keyOf}
                                >
                                  {sortByLoc(grp.items).map((item) => (
                                    <ReturnItemCard
                                      key={keyOf(item)}
                                      item={item}
                                      selectedReturn={selectedReturn}
                                      setSelectedReturn={setSelectedReturn}
                                      toggleReturnKeys={toggleReturnKeys}
                                      C={C}
                                      keyOf={keyOf}
                                      setImageModalUrl={setImageModalUrl}
                                    />
                                  ))}
                                </GroupSection>
                              ))}
                            </GroupSection>
                          ) : null}
                        </GroupSection>
                      ) : null}
                      {generalItems.length ? (
                        <GroupSection
                          gKey={`${borrower}|gen`}
                          title="일반 대여"
                          icon={<Boxes size={13} style={{ color: C.accentText }} />}
                          items={generalItems}
                          level={2}
                          expanded={expanded}
                          setExpanded={setExpanded}
                          returnSearch={returnSearch}
                          isLightMode={isLightMode}
                          C={C}
                          getAvatarColor={getAvatarColor}
                          sumQty={sumQty}
                          toggleReturnKeys={toggleReturnKeys}
                          selectedReturn={selectedReturn}
                          keyOf={keyOf}
                        >
                          {groupBy(generalItems, borrowDateKey).map((grp) => (
                            <GroupSection
                              key={grp.key}
                              gKey={`${borrower}|gen|${grp.key}`}
                              title={grp.key}
                              items={grp.items}
                              level={3}
                              expanded={expanded}
                              setExpanded={setExpanded}
                              returnSearch={returnSearch}
                              isLightMode={isLightMode}
                              C={C}
                              getAvatarColor={getAvatarColor}
                              sumQty={sumQty}
                              toggleReturnKeys={toggleReturnKeys}
                              selectedReturn={selectedReturn}
                              keyOf={keyOf}
                            >
                              {sortByLoc(grp.items).map((item) => (
                                <ReturnItemCard
                                  key={keyOf(item)}
                                  item={item}
                                  selectedReturn={selectedReturn}
                                  setSelectedReturn={setSelectedReturn}
                                  toggleReturnKeys={toggleReturnKeys}
                                  C={C}
                                  keyOf={keyOf}
                                  setImageModalUrl={setImageModalUrl}
                                />
                              ))}
                            </GroupSection>
                          ))}
                        </GroupSection>
                      ) : null}
                    </GroupSection>
                  );
                })}
              </div>
            )}

            <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: C.card, borderTop: `1px solid ${C.border}`, padding: "12px 16px", zIndex: 10 }}>
              <div style={{ maxWidth: "620px", margin: "0 auto", display: "flex", gap: "10px" }}>
                <button onClick={() => (onBack())} style={secondaryBtn}>이전</button>
                <button
                  onClick={handleReturnSubmit}
                  disabled={Object.keys(selectedReturn).length === 0 || returnSubmitting}
                  style={{ ...primaryBtn, opacity: Object.keys(selectedReturn).length === 0 || returnSubmitting ? 0.5 : 1 }}
                >
                  {returnSubmitting ? <><Spinner size={16} light={true} C={C} /> 처리 중...</> : `반납 처리하기${Object.keys(selectedReturn).length ? ` (${Object.keys(selectedReturn).length}건)` : ""}`}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* ───────── 결과 화면 ───────── */}
        {mode === "result" ? (
          <div style={{ textAlign: "center", padding: "48px 20px" }}>
            {resultInfo.isSyncing ? (
              <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", marginBottom: "16px" }}>
                <Spinner size={50} />
                <span style={{ fontSize: "11px", fontWeight: 800, background: C.accentSoft, color: C.accentText, borderRadius: "10px", padding: "3px 10px", marginTop: "12px", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                  <style>{`
                    @keyframes spin-sync { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                    .sync-icon-spin { animation: spin-sync 2s linear infinite; }
                  `}</style>
                  <RefreshCw size={11} className="sync-icon-spin" />
                  실시간 동기화 중
                </span>
              </div>
            ) : resultInfo.ok ? (
              <CheckCircle2 size={64} style={{ color: C.success, marginBottom: "16px" }} />
            ) : (
              <AlertCircle size={64} style={{ color: C.error, marginBottom: "16px" }} />
            )}
            <div style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px" }}>{resultInfo.title}</div>
            <div style={{ fontSize: "13px", color: C.label, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{resultInfo.sub}</div>

            {resultInfo.ok && !resultInfo.isSyncing && resultInfo.borrowQr ? (
              <div style={{ margin: "24px auto 0", maxWidth: 380, display: "grid", justifyItems: "center", gap: 10 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>QR을 스캔해 물품 위치를 확인하세요</div>
                <div style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "1px solid #fed7aa",
                  background: "#fff7ed",
                  color: "#7c2d12",
                  textAlign: "left",
                  boxSizing: "border-box",
                }}>
                  <div style={{ width: 30, height: 30, borderRadius: 999, display: "grid", placeItems: "center", flex: "0 0 auto", background: "#ffedd5", color: "#c2410c" }}>
                    <Clock3 size={16} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 3 }}>수령 제한 시간</div>
                    <div style={{ fontSize: 14, lineHeight: 1.55, fontWeight: 700 }}>
                      신청 후 {resultInfo.pickupTimeoutMinutes ?? 20}분 안에 물품을 수령해주세요.
                    </div>
                    <div style={{ marginTop: 3, fontSize: 12, lineHeight: 1.5, color: "#9a3412" }}>
                      시간 내 대여 확인이 없으면 신청이 자동 취소됩니다.
                    </div>
                  </div>
                </div>
                <img src={resultInfo.borrowQr.image} alt="대여 물품 위치 확인 사이트 QR" style={{ width: "min(320px,75vw)", background: "#fff", padding: 10, borderRadius: 16, border: `1px solid ${C.border}` }} />
                <div aria-live="polite" style={{ color: C.label, fontSize: 13, fontWeight: 800 }}>{borrowQrSeconds}초 후 처음 화면으로 돌아갑니다</div>
              </div>
            ) : null}

            <div style={{ display: "flex", gap: "10px", marginTop: "32px", maxWidth: "320px", margin: "32px auto 0" }}>
              {/* resetAll()은 옛 b1 단계로 되돌린다. 시나리오 대여 단계는 이제
                  물품 열람 화면으로 통합됐으므로, 완료 뒤에는 항상 Landing으로 간다. */}
              <button onClick={onBack} style={secondaryBtn}>처음으로 돌아가기</button>
            </div>
          </div>
        ) : null}
        </div>
      </div>

      {/* 이미지 확대 모달 */}
      {/* SID 필요 물품 · 종류별 수량 배정 (사진을 보고 고른다) */}
      {(() => {
        if (!sidVariantPick) return null;
        const entry = sidCart[sidVariantPick.sidIdx];
        const item: any = entry?.scenario?.items?.[sidVariantPick.itemIdx];
        if (!item || !item.variants?.length) return null;
        const need = item.quantity || 1;
        const alloc: Record<number, number> = item.variantAlloc || {};
        const used = Object.values(alloc).reduce((n: number, v: any) => n + (Number(v) || 0), 0);
        const setAlloc = (vid: number, next: number) => {
          setSidCart((prev) => prev.map((en, ei) => {
            if (ei !== sidVariantPick.sidIdx || !en.scenario) return en;
            const items = en.scenario.items.map((x: any, xi: number) => {
              if (xi !== sidVariantPick.itemIdx) return x;
              const cur: Record<number, number> = { ...(x.variantAlloc || {}) };
              if (next > 0) cur[vid] = next; else delete cur[vid];
              return { ...x, variantAlloc: cur };
            });
            return { ...en, scenario: { ...en.scenario, items } };
          }));
        };
        return (
          <div
            onClick={() => setSidVariantPick(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "16px" }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: "16px", padding: "18px", width: "min(460px, 100%)", maxHeight: "82vh", overflowY: "auto" }}
            >
              <div style={{ fontSize: "15px", fontWeight: 800, color: C.text, marginBottom: "2px" }}>어떤 종류를 빌리시나요?</div>
              <div style={{ fontSize: "12px", color: C.label, marginBottom: "4px" }}>{entry.sid} · {item.name}</div>
              <div style={{ fontSize: "12px", fontWeight: 800, color: used === need ? C.accentText : C.error, marginBottom: "12px" }}>
                {used}/{need}개 배정{used === need ? "" : " — 합계를 맞춰주세요"}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {item.variants.map((v: any) => {
                  const q = Number(alloc[v.id]) || 0;
                  const canAdd = Math.min(need - used, Math.max(0, v.stock - q)) > 0;
                  const out = v.stock <= 0;
                  return (
                    <div
                      key={v.id}
                      style={{
                        display: "flex", alignItems: "center", gap: "12px", padding: "10px 12px",
                        borderRadius: "11px", border: `1.5px solid ${q > 0 ? C.accent : C.border}`,
                        background: C.cardSub, opacity: out ? 0.55 : 1,
                      }}
                    >
                      {/* 종류별 사진 — 누르면 크게 열린다 */}
                      <span
                        onClick={() => { if (v.image) setImageModalUrl(getGoogleDriveImageUrl(v.image)); }}
                        style={{ width: "52px", height: "52px", flexShrink: 0, borderRadius: "9px", overflow: "hidden", background: C.card, display: "flex", alignItems: "center", justifyContent: "center", cursor: v.image ? "zoom-in" : "default" }}
                      >
                        {v.image
                          ? <img src={getThumbImageUrl(v.image)} alt="" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                          : <Package size={18} style={{ color: C.label, opacity: 0.45 }} />}
                      </span>

                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: "13px", fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.name}</span>
                        <span style={{ display: "block", fontSize: "11.5px", color: C.label, fontWeight: 600, marginTop: "2px" }}>
                          {out ? "재고 없음" : `재고 ${v.stock}개`}
                        </span>
                        {/* 종류마다 크기가 다른 물품이 있다(대·중·소 같은). 그 종류에 따로 적힌 치수가
                            있으면 그것을, 없으면 물품 자체의 치수를 본다 — 고르기 전에 크기를 알 수 있게. */}
                        {hasDims(v) || hasDims(item) ? (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setSizeItem({ ...(hasDims(v) ? v : item), name: `${item.name} · ${v.name}` }); }}
                            title="실측 크기를 돌려봅니다"
                            style={{ marginTop: "4px", fontSize: "10.5px", fontWeight: 800, borderRadius: "6px", padding: "2px 7px", border: `1px solid ${C.border}`, background: "transparent", color: C.label, cursor: "pointer" }}
                          >
                            📐 {hasDims(v) ? "이 종류 크기" : "실제 크기"}
                          </button>
                        ) : null}
                      </span>

                      <button
                        type="button"
                        onClick={() => setAlloc(v.id, Math.max(0, q - 1))}
                        disabled={q <= 0}
                        style={{ width: 28, height: 28, borderRadius: "8px", border: `1px solid ${C.border}`, background: C.card, color: q <= 0 ? C.label : C.text, cursor: q <= 0 ? "not-allowed" : "pointer", fontSize: "14px", lineHeight: 1, flexShrink: 0, padding: 0 }}
                      >-</button>
                      <span style={{ minWidth: "24px", textAlign: "center", fontSize: "14px", fontWeight: 800, color: q > 0 ? C.accentText : C.label }}>{q}</span>
                      <button
                        type="button"
                        onClick={() => setAlloc(v.id, q + 1)}
                        disabled={!canAdd}
                        style={{ width: 28, height: 28, borderRadius: "8px", border: `1px solid ${C.border}`, background: C.card, color: canAdd ? C.text : C.label, cursor: canAdd ? "pointer" : "not-allowed", fontSize: "14px", lineHeight: 1, flexShrink: 0, padding: 0 }}
                      >+</button>
                    </div>
                  );
                })}
              </div>

              <button
                onClick={() => setSidVariantPick(null)}
                style={{
                  marginTop: "14px", width: "100%", padding: "12px", borderRadius: "10px", border: "none",
                  background: used === need ? C.accent : C.border,
                  color: used === need ? "#ffffff" : C.label,
                  cursor: "pointer", fontSize: "13px", fontWeight: 800,
                }}
              >
                {used === need ? "배정 완료" : "닫기"}
              </button>
            </div>
          </div>
        );
      })()}

      <ImageZoomModal url={imageModalUrl} onClose={() => setImageModalUrl("")} />

      {/* SID 대여 — 재고 없는 물품을 빼고 진행할지 확인.
          "경고 → 빼고 진행할까요"의 두 단계이고, 담을 때와 최종 신청 때 각각 한 번씩 거친다.
          그 사이 남이 먼저 빌려갈 수 있어서 신청 직전에 지금 재고로 다시 계산해 묻는다. */}
      {sidExcludeModal ? (
        <div
          onClick={() => setSidExcludeModal(null)}
          style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(440px, 100%)", background: C.card, borderRadius: "18px", border: `1px solid ${C.border}`, padding: "28px 24px 24px", boxShadow: "0 12px 40px rgba(0,0,0,0.35)", textAlign: "center" }}
          >
            <div style={{ width: 56, height: 56, borderRadius: "50%", background: C.warnSoft, color: C.warn, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
              <AlertCircle size={30} />
            </div>

            <div style={{ fontSize: "17px", fontWeight: 800, color: C.text, marginBottom: "6px" }}>
              {sidExcludeModal.stage === "warn" ? "재고가 없는 물품이 있습니다" : "이 물품들을 빼고 진행할까요?"}
            </div>
            <div style={{ fontSize: "13px", color: C.label, marginBottom: "18px", lineHeight: 1.6 }}>
              {sidExcludeModal.stage === "warn"
                ? "아래 물품은 지금 재고가 모자랍니다."
                : sidExcludeModal.phase === "cart"
                  ? "아래 물품을 뺀 나머지를 장바구니에 담습니다."
                  : "아래 물품을 뺀 나머지로 대여를 신청합니다."}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "18px", textAlign: "left", maxHeight: "220px", overflowY: "auto" }}>
              {sidExcludeModal.items.map((s2) => (
                <div key={s2.id} style={{ padding: "10px 12px", background: C.warnSoft, borderRadius: "10px" }}>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: C.text }}>
                    {s2.name} <span style={{ fontWeight: 400, color: C.label, fontFamily: "monospace" }}>({s2.id})</span>
                  </div>
                  <div style={{ fontSize: "12px", color: C.warn, marginTop: "2px", fontWeight: 700 }}>
                    필요 {s2.requested}개 / 현재 재고 {s2.stock}개
                  </div>
                </div>
              ))}
            </div>

            {sidExcludeModal.stage === "confirm" ? (
              <div style={{ fontSize: "11.5px", color: C.label, marginBottom: "16px", lineHeight: 1.6 }}>
                뺀 물품은 이번 신청에 포함되지 않습니다. 나중에 재고가 채워지면 따로 신청해주세요.
              </div>
            ) : null}

            <div style={{ display: "flex", gap: "9px" }}>
              <button
                onClick={() => {
                  setSidExcludeModal(null);
                  if (initialSid && onGoPickItems) onGoPickItems("sid");
                }}
                style={{ flex: 1, padding: "13px", borderRadius: "12px", border: `1px solid ${C.border}`, background: "transparent", color: C.text, fontSize: "14px", fontWeight: 700, cursor: "pointer" }}
              >
                취소
              </button>
              <button
                onClick={() => {
                  // 경고를 확인했으면 "빼고 진행할까요"로 넘어가고, 거기서 한 번 더 누르면 실제로 진행한다.
                  if (sidExcludeModal.stage === "warn") {
                    setSidExcludeModal({ ...sidExcludeModal, stage: "confirm" });
                    return;
                  }
                  const phase = sidExcludeModal.phase;
                  setSidExcludeModal(null);
                  if (phase === "cart") handleBorrowSubmit(false, "scenario");
                  else handleBorrowSubmit(true);
                }}
                style={{ flex: 2, padding: "13px", borderRadius: "12px", border: "none", background: C.accent, color: "#fff", fontSize: "14px", fontWeight: 800, cursor: "pointer" }}
              >
                {sidExcludeModal.stage === "warn"
                  ? "확인"
                  : sidExcludeModal.phase === "cart" ? "빼고 담기" : "빼고 신청하기"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 종류별 실측 크기 뷰어 — 종류 선택 모달 위에 뜬다. */}
      <SizeViewerModal open={!!sizeItem} onClose={() => setSizeItem(null)} item={sizeItem} C={C} />

      {/* 재고 부족 경고 모달 */}
      {stockShortfallModal ? (
        <div
          onClick={() => setStockShortfallModal(null)}
          style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(420px, 100%)", background: C.card, borderRadius: "18px", border: `1px solid ${C.border}`, padding: "28px 24px 24px", boxShadow: "0 12px 40px rgba(0,0,0,0.35)", textAlign: "center" }}
          >
            <div style={{ width: 56, height: 56, borderRadius: "50%", background: C.errorSoft, color: C.error, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
              <AlertCircle size={30} />
            </div>
            <div style={{ fontSize: "17px", fontWeight: 800, color: C.text, marginBottom: "6px" }}>재고가 부족합니다</div>
            <div style={{ fontSize: "13px", color: C.label, marginBottom: "18px" }}>아래 물품의 재고가 부족해 신청할 수 없습니다.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "20px", textAlign: "left" }}>
              {stockShortfallModal.map((s) => (
                <div key={s.id} style={{ padding: "10px 12px", background: C.errorSoft, borderRadius: "10px" }}>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: C.text }}>{s.name} <span style={{ fontWeight: 400, color: C.label, fontFamily: "monospace" }}>({s.id})</span></div>
                  <div style={{ fontSize: "12px", color: C.error, marginTop: "2px", fontWeight: 700 }}>필요 {s.requested}개 / 현재 재고 {s.stock}개</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: "11.5px", color: C.label, marginBottom: "18px", lineHeight: 1.6 }}>
              수량을 줄이거나, 관리자에게 재고를 확인해달라고 요청해주세요.
            </div>
            <button onClick={() => setStockShortfallModal(null)} style={{ width: "100%", padding: "13px", borderRadius: "12px", border: "none", background: C.accent, color: "#fff", fontSize: "14px", fontWeight: 700, cursor: "pointer" }}>
              닫기
            </button>
          </div>
        </div>
      ) : null}

      {/* 물품 종류 한도 초과 경고 모달 (장바구니에 담다가 초과된 경우, 제출 직전 차단) */}
      {typeOverflowModal ? (
        <div
          onClick={() => setTypeOverflowModal(null)}
          style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(420px, 100%)", background: C.card, borderRadius: "18px", border: `1px solid ${C.border}`, padding: "28px 24px 24px", boxShadow: "0 12px 40px rgba(0,0,0,0.35)", textAlign: "center" }}
          >
            <div style={{ width: 56, height: 56, borderRadius: "50%", background: C.errorSoft, color: C.error, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
              <AlertCircle size={30} />
            </div>
            <div style={{ fontSize: "17px", fontWeight: 800, color: C.text, marginBottom: "6px" }}>물품 종류 한도를 초과합니다</div>
            <div style={{ fontSize: "13px", color: C.label, marginBottom: "18px", lineHeight: 1.6 }}>
              현재 <b style={{ color: C.text }}>{typeOverflowModal.current}종류</b>를 대여 중이고, 이번에 새로운 <b style={{ color: C.text }}>{typeOverflowModal.adding}종류</b>가 담겨 있습니다.
              <br />한 사람이 동시에 대여할 수 있는 물품 종류는 최대 <b style={{ color: C.text }}>{typeOverflowModal.max}종류</b>입니다.
            </div>
            <div style={{ fontSize: "11.5px", color: C.label, marginBottom: "18px", lineHeight: 1.6 }}>
              담은 물품 종류 수를 줄이거나, 기존에 대여 중인 물품을 먼저 반납한 뒤 다시 시도해주세요.
            </div>
            <button onClick={() => setTypeOverflowModal(null)} style={{ width: "100%", padding: "13px", borderRadius: "12px", border: "none", background: C.accent, color: "#fff", fontSize: "14px", fontWeight: 700, cursor: "pointer" }}>
              닫기
            </button>
          </div>
        </div>
      ) : null}

      {/* 이미 물품 종류 한도 이상 보유 중일 때 (이름 입력 직후 차단) */}
      {/* 대여 시작 안내 팝업 */}
      {qtyNoticeOpen ? (
        <div
          onClick={() => setQtyNoticeOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 3200, background: "rgba(15,23,42,0.45)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(400px, 100%)", background: C.card, borderRadius: "18px", border: `1px solid ${C.border}`, padding: "26px 24px", textAlign: "center", boxShadow: "0 18px 50px rgba(0,0,0,0.28)" }}
          >
            <div style={{ fontSize: "34px", lineHeight: 1, marginBottom: "14px" }}>📦</div>
            <div style={{ fontSize: "15.5px", fontWeight: 800, color: C.text, marginBottom: "14px" }}>
              신청 전 확인해주세요
            </div>

            <div style={{ fontSize: "13.5px", color: C.label, lineHeight: 1.7, marginBottom: "12px" }}>
              반드시 <b style={{ color: C.text }}>가져가시는 물건의 개수</b>도<br />
              고려해서 신청해주세요.
            </div>

            <div style={{ textAlign: "left", padding: "12px 14px", borderRadius: "12px", background: C.errorSoft, border: `1px solid ${C.error}44`, marginBottom: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: 800, color: C.error, marginBottom: "6px" }}>
                <AlertTriangle size={15} /> 무단 사용 금지
              </div>
              <div style={{ fontSize: "12.5px", color: C.text, lineHeight: 1.7 }}>
                반드시 <b>본인이 대여한 물품만</b> 사용해주세요.<br />
                남의 물건을 사용하다 적발될 경우 <b>별도의 조치가 취해질 수 있습니다.</b>
              </div>
            </div>
            <button
              onClick={() => setQtyNoticeOpen(false)}
              style={{ width: "100%", padding: "13px", borderRadius: "12px", border: "none", background: C.accent, color: "#fff", cursor: "pointer", fontSize: "14px", fontWeight: 800 }}
            >
              확인했습니다
            </button>
          </div>
        </div>
      ) : null}

      {typeLimitModal ? (
        <div
          onClick={() => setTypeLimitModal(null)}
          style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(420px, 100%)", maxHeight: "80vh", overflowY: "auto", background: C.card, borderRadius: "18px", border: `1px solid ${C.border}`, padding: "28px 24px 24px", boxShadow: "0 12px 40px rgba(0,0,0,0.35)", textAlign: "center" }}
          >
            <div style={{ width: 56, height: 56, borderRadius: "50%", background: C.errorSoft, color: C.error, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
              <AlertCircle size={30} />
            </div>
            <div style={{ fontSize: "17px", fontWeight: 800, color: C.text, marginBottom: "6px" }}>이미 물품 종류 한도에 도달했습니다</div>
            <div style={{ fontSize: "13px", color: C.label, marginBottom: "18px", lineHeight: 1.6 }}>
              현재 <b style={{ color: C.text }}>{typeLimitModal.count}종류</b>를 대여 중이라, 최대 <b style={{ color: C.text }}>{typeLimitModal.max}종류</b>를 이미 넘었거나 다 찼습니다.
              <b style={{ color: C.text }}> 새 종류</b>를 빌리려면 아래 물품 중 일부를 먼저 반납해주세요.
              이미 빌린 물품의 <b style={{ color: C.text }}>수량만 늘리는 것</b>은 그대로 하실 수 있습니다.
            </div>
            {typeLimitModal.items.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "20px", textAlign: "left" }}>
                {typeLimitModal.items.map((it) => (
                  <div key={it.id} style={{ padding: "9px 12px", background: C.errorSoft, borderRadius: "10px", fontSize: "12.5px", color: C.text }}>
                    {it.name}{it.quantity > 1 ? ` x ${it.quantity}` : ""} <span style={{ color: C.label }}>· {it.borrowDate}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {/* 한도가 찼어도 "이미 빌린 물품의 수량만 늘리기"는 막을 이유가 없다 — 새 종류를
                담는 것은 제출 직전 검사에서 따로 걸러진다. 여기서 길을 막아버리면 수량 조정조차
                못 하게 된다(실제로 그런 신고가 있었다). */}
            <div style={{ display: "flex", gap: "9px" }}>
              <button onClick={() => setTypeLimitModal(null)} style={{ flex: 1, padding: "13px", borderRadius: "12px", border: `1px solid ${C.border}`, background: "none", color: C.label, fontSize: "13.5px", fontWeight: 700, cursor: "pointer" }}>
                확인
              </button>
              <button
                onClick={() => { setTypeLimitModal(null); finishStep1Advance(); }}
                style={{ flex: 2, padding: "13px", borderRadius: "12px", border: "none", background: C.accent, color: "#fff", fontSize: "13.5px", fontWeight: 700, cursor: "pointer" }}
              >
                수량만 늘리러 가기
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 깨질 위험 / 화재 위험 / 특정 업체 request용 물품 확인 (확인 후 마지막 단계로 진행) */}
      {hazardModal ? (
        <HazardConfirmModal
          items={hazardModal.items}
          C={C}
          onConfirm={() => { const target = hazardModal.proceedMode; setHazardModal(null); setMode(target); }}
        />
      ) : null}

      {/* 기타 소속 성함 미입력 경고 모달 */}
      {nameRequiredModal ? (
        <div
          onClick={() => { setNameRequiredModal(false); otherNameInputRef.current?.focus(); }}
          style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(360px, 100%)", background: C.card, borderRadius: "18px", border: `1px solid ${C.border}`, padding: "28px 24px 24px", boxShadow: "0 12px 40px rgba(0,0,0,0.35)", textAlign: "center" }}
          >
            <div style={{ width: 56, height: 56, borderRadius: "50%", background: C.warnSoft, color: C.warn, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
              <AlertCircle size={30} />
            </div>
            <div style={{ fontSize: "17px", fontWeight: 800, color: C.text, marginBottom: "6px" }}>성함을 입력해주세요</div>
            <div style={{ fontSize: "13px", color: C.label, marginBottom: "22px", lineHeight: 1.6 }}>
              기타 소속으로 대여하려면 성함 입력이 필수입니다.
            </div>
            <button
              onClick={() => { setNameRequiredModal(false); otherNameInputRef.current?.focus(); }}
              style={{ width: "100%", padding: "13px", borderRadius: "12px", border: "none", background: C.accent, color: "#fff", fontSize: "14px", fontWeight: 700, cursor: "pointer" }}
            >
              확인
            </button>
          </div>
        </div>
      ) : null}

    </div>
  );
}

// ────────────────────────────────────────────────────────
// Standalone React Subcomponents to Avoid Hook Violations
// ────────────────────────────────────────────────────────

function StockBadges({ stock, rented, C }: { stock: number; rented: number; C?: any }) {
  const successColor = C ? C.success : "#10b981";
  const successSoftBg = C ? C.successSoft : "rgba(16,185,129,0.1)";
  const accentTextColor = C ? C.accentText : "#2563eb";
  const accentSoftBg = C ? C.accentSoft : "rgba(37,99,235,0.1)";
  return (
    <div style={{ display: "flex", gap: "6px", marginTop: "4px", fontSize: "11px", fontWeight: 600 }}>
      <span style={{ color: successColor, background: successSoftBg, padding: "2px 8px", borderRadius: "6px" }}>재고 {stock ?? 0}</span>
      <span style={{ color: accentTextColor, background: accentSoftBg, padding: "2px 8px", borderRadius: "6px" }}>대여 중 {rented ?? 0}</span>
    </div>
  );
}

function LocBadge({ slot, C }: { slot?: string; C?: any }) {
  if (!slot) return null;
  const warnColor = C ? C.warn : "#f59e0b";
  const warnSoftBg = C ? C.warnSoft : "rgba(245,158,11,0.1)";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", fontWeight: 700, color: warnColor, background: warnSoftBg, borderRadius: "6px", padding: "2px 8px", fontFamily: "monospace" }}>
      <MapPin size={11} />{padSlot(slot)}
    </span>
  );
}

function Thumb({ url, size = 48, C, setImageModalUrl }: { url?: string; size?: number; C?: any; setImageModalUrl: (url: string) => void }) {
  if (!url) return null;
  const fullSrc = getGoogleDriveImageUrl(url);
  const thumbSrc = getThumbImageUrl(url);
  const borderCol = C ? C.border : "#e6e9ef";
  const cardSubBg = C ? C.cardSub : "#f7f9fa";
  return (
    <div
      className="bsp-thumb"
      onClick={(e) => { e.stopPropagation(); setImageModalUrl(fullSrc); }}
      style={{ flex: `0 0 ${size}px`, width: size, height: size, borderRadius: "8px", overflow: "hidden", border: `1px solid ${borderCol}`, cursor: "zoom-in", background: cardSubBg, display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <img src={thumbSrc} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "cover" }} />
    </div>
  );
}

function Spinner({ size = 20, light = false, C }: { size?: number; light?: boolean; C?: any }) {
  const accentText = C ? C.accentText : "#2563eb";
  const color = light ? "#ffffff" : accentText;
  return (
    <div style={{ display: "inline-block", width: size, height: size, border: `2px solid ${color}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.6s linear infinite", verticalAlign: "middle" }} />
  );
}

function TypeCard({
  active,
  icon,
  text,
  onClick,
  small = false,
  C,
}: {
  active: boolean;
  icon: React.ReactNode;
  text: string;
  onClick: () => void;
  small?: boolean;
  C?: any;
}) {
  const accent = C ? C.accent : "#2563eb";
  const textCol = C ? C.text : "#1e293b";
  const borderCol = C ? C.border : "#e6e9ef";
  const labelCol = C ? C.label : "#64748b";
  const activeBg = C ? C.accentSoft : "rgba(37,99,235,0.06)";
  
  return (
    <div
      onClick={onClick}
      style={{
        flex: 1,
        padding: small ? "12px 10px" : "20px 14px",
        borderRadius: "14px",
        border: `1.5px solid ${active ? accent : borderCol}`,
        background: active ? activeBg : "transparent",
        color: active ? accent : textCol,
        textAlign: "center",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: small ? "4px" : "10px",
        transition: "all 0.15s ease",
      }}
    >
      <div style={{ color: active ? accent : labelCol }}>{icon}</div>
      <div style={{ fontWeight: 800, fontSize: small ? "12px" : "14px" }}>{text}</div>
    </div>
  );
}

interface CartItem {
  id: string;
  name: string;
  quantity: number;
  [key: string]: any;
}

function CartBox({
  list,
  setList,
  emptyText,
  C,
  objectItems,
  showToast,
}: {
  list: CartItem[];
  setList: (val: any) => void;
  emptyText: string;
  C: any;
  objectItems: any[];
  showToast: (msg: string, type?: string) => void;
}) {
  // 같은 물품이라도 종류가 다르면 서로 다른 줄이므로, id가 아니라 줄 키로 찾는다.
  const chgQty = (key: string, delta: number) => {
    setList((prev: CartItem[]) => {
      const match = prev.find((x) => cartLineKey(x) === key);
      if (!match) return prev;
      const orig = objectItems.find((x) => x.id === match.id);
      // 종류를 지정한 줄은 그 종류의 재고가 상한이다.
      const variant = match.variantId ? (orig?.variants || []).find((v: any) => v.id === match.variantId) : null;
      const stock = variant ? Number(variant.stock || 0) : orig ? Number(orig.stock || 0) : 999;
      const target = match.quantity + delta;
      if (target <= 0) return prev.filter((x) => cartLineKey(x) !== key);
      if (target > stock) {
        showToast(`최대 재고(${stock}개)까지만 선택 가능합니다.`, "warn");
        return prev;
      }
      return prev.map((x) => (cartLineKey(x) === key ? { ...x, quantity: target } : x));
    });
  };

  const remove = (key: string) => {
    setList((prev: CartItem[]) => prev.filter((x) => cartLineKey(x) !== key));
  };

  if (list.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 16px", border: `1px dashed ${C.border}`, borderRadius: "14px", background: C.cardSub, color: C.label, fontSize: "13px", marginBottom: "18px" }}>
        {emptyText}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "18px", maxHeight: "180px", overflowY: "auto" }}>
      {list.map((it) => {
        const orig = objectItems.find((x) => x.id === it.id);
        const key = cartLineKey(it);
        return (
          <div key={key} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", background: C.cardSub, border: `1px solid ${C.border}`, borderRadius: "10px" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: "13px", color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {cartLineLabel(it, C)}
                {orig?.variants?.length && !it.variantId ? (
                  <span style={{ marginLeft: "6px", fontSize: "10px", fontWeight: 800, color: C.error, background: C.errorSoft, borderRadius: "6px", padding: "2px 6px" }}>
                    종류 선택 필요
                  </span>
                ) : null}
              </div>
              <div style={{ fontSize: "11px", color: C.label, display: "flex", gap: "6px" }}>
                <span>ID: {it.id}</span>
                {orig?.rootSlot ? <span>• {padSlot(orig.rootSlot)}</span> : null}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <button onClick={() => chgQty(key, -1)} style={{ width: 28, height: 28, borderRadius: "8px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Minus size={13} /></button>
              <span style={{ fontWeight: 800, minWidth: "20px", textAlign: "center", fontSize: "13px" }}>{it.quantity}</span>
              <button onClick={() => chgQty(key, 1)} style={{ width: 28, height: 28, borderRadius: "8px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={13} /></button>
            </div>
            <button onClick={() => remove(key)} style={{ width: 28, height: 28, borderRadius: "8px", border: "none", background: C.errorSoft, color: C.error, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={13} /></button>
          </div>
        );
      })}
    </div>
  );
}

function ItemPicker({
  list,
  setList,
  search,
  setSearch,
  cat,
  setCat,
  sub,
  setSub,
  sort,
  setSort,
  C,
  isLightMode,
  objectItems,
  itemsLoaded,
  categories,
  subsOf,
  matchesFilters,
  showToast,
  setImageModalUrl,
  onFly,
  hideLocation,
}: {
  list: CartItem[];
  setList: (val: any) => void;
  search: string;
  setSearch: (v: string) => void;
  cat: string;
  setCat: (v: string) => void;
  sub: string;
  setSub: (v: string) => void;
  sort: ItemSortKey;
  setSort: (v: ItemSortKey) => void;
  C: any;
  isLightMode: boolean;
  objectItems: any[];
  itemsLoaded: boolean;
  categories: string[];
  subsOf: (cat: string) => string[];
  matchesFilters: (it: any, query: string, c: string, s: string) => boolean;
  showToast: (msg: string, type?: string) => void;
  setImageModalUrl: (url: string) => void;
  onFly?: (rect: DOMRect) => void;
  hideLocation?: boolean;
}) {
  const inputStyle = {
    width: "100%",
    padding: "10px 12px 10px 38px",
    background: C.cardSub,
    border: `1.5px solid ${C.border}`,
    borderRadius: "12px",
    color: C.text,
    fontSize: "13px",
    outline: "none",
  };

  const selectStyle = {
    flex: 1,
    padding: "8px 10px",
    background: C.card,
    border: `1px solid ${C.border}`,
    borderRadius: "10px",
    color: C.text,
    fontSize: "12px",
    outline: "none",
  };

  const itemBtnStyle = (inCart: boolean) => ({
    padding: "6px 12px",
    borderRadius: "8px",
    border: "none",
    background: inCart ? C.errorSoft : C.accent,
    color: inCart ? "#ffffff" : "#ffffff",
    fontSize: "11px",
    fontWeight: 700,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
  });

  const byId = (a: any, b: any) => padSlot(String(a.id ?? "")).localeCompare(padSlot(String(b.id ?? "")));
  const byLocation = (a: any, b: any) => padSlot(String(a.rootSlot ?? "")).localeCompare(padSlot(String(b.rootSlot ?? "")));
  // 종류가 있는 물품을 누르면 곧바로 담지 않고, 어떤 종류를 담을지 먼저 고르게 한다.
  const [variantPick, setVariantPick] = useState<any | null>(null);
  // request/개인 물품은 담는 순간 한 번 짚어준다. 제출 직전 경고만으로는 이미 다 담은
  // 뒤라 되돌리기 번거롭다. 처음 담을 때만 뜨고, 수량을 더할 때는 뜨지 않는다.
  const [noticeItem, setNoticeItem] = useState<any | null>(null);
  const noticeRemaining = useNoticeCountdown(noticeItem?.requestFor !== undefined ? String(noticeItem.id) : null);
  // 실측 치수가 등록된 물품만 "실제 크기 보기"가 뜬다. 렌더링은 이 브라우저가 한다.
  const [sizeItem, setSizeItem] = useState<any | null>(null);

  // 장바구니에 한 줄 담거나 이미 있으면 수량을 1 늘린다. 종류가 다르면 다른 줄로 들어간다.
  const addLine = (it: any, choice: { variantId?: number; variantName?: string }, limit: number) => {
    let over = false;
    setList((prev: CartItem[]) => {
      const key = cartLineKey({ id: it.id, ...choice });
      const idx = prev.findIndex((x) => cartLineKey(x) === key);
      if (idx === -1) return [...prev, { id: it.id, name: it.name, quantity: 1, ...choice }];
      if (prev[idx].quantity >= limit) { over = true; return prev; }
      return prev.map((x, i) => (i === idx ? { ...x, quantity: x.quantity + 1 } : x));
    });
    return over;
  };

  const filtered = objectItems.filter((it) => matchesFilters(it, search, cat, sub));
  switch (sort) {
    case "id_asc": filtered.sort(byId); break;
    case "id_desc": filtered.sort((a, b) => byId(b, a)); break;
    case "location_asc": filtered.sort(byLocation); break;
    case "location_desc": filtered.sort((a, b) => byLocation(b, a)); break;
    case "name_asc": filtered.sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""), "ko")); break;
  }

  return (
    <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: "16px", padding: "14px", display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ position: "relative" }}>
        <Search size={14} style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="물품 ID 또는 물품명으로 검색..." style={inputStyle} />
      </div>

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <select value={cat} onChange={(e) => { setCat(e.target.value); setSub(""); }} style={selectStyle}>
          <option value="">대분류 (전체)</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={sub} onChange={(e) => setSub(e.target.value)} style={selectStyle} disabled={!cat || cat === "전체"}>
          <option value="">소분류 (전체)</option>
          {subsOf(cat).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as ItemSortKey)} style={selectStyle}>
          <option value="id_desc">ID 내림차순</option>
          <option value="id_asc">ID 오름차순</option>
          <option value="location_desc">위치 내림차순</option>
          <option value="location_asc">위치 오름차순</option>
          <option value="name_asc">이름 (ABC/가나다순)</option>
        </select>
      </div>

      {!itemsLoaded ? (
        <div style={{ display: "flex", justifySelf: "center", alignItems: "center", gap: "8px", padding: "32px 0", color: C.label, fontSize: "12px", justifyContent: "center" }}>
          <Spinner size={16} C={C} /> 물품 목록 로딩 중...
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "32px 0", color: C.label, fontSize: "12px" }}>조건에 맞는 물품이 없습니다.</div>
      ) : (
        // 카드 그리드: 사진을 크게 보여 물품을 알아보기 쉽게 한다
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "10px", maxHeight: "min(56vh, 560px)", overflowY: "auto", paddingRight: "2px" }}>
          {filtered.slice(0, 120).map((it) => {
            // 종류별로 여러 줄이 담길 수 있으므로, 카드에는 그 물품의 모든 줄을 합쳐 보여준다.
            const myLines = list.filter((x) => x.id === it.id);
            const inCart = myLines.length > 0;
            const inCartQty = myLines.reduce((n, x) => n + (x.quantity || 0), 0);
            const stock = Number(it.stock || 0);
            const rented = Number(it.rented || 0);
            const soldOut = stock <= 0;
            return (
              <div
                key={it.id}
                onClick={(e) => {
                  if (soldOut) { showToast("재고가 없는 물품입니다.", "warn"); return; }
                  // 담기/수량 증가를 한 번의 함수형 업데이트로 처리한다.
                  // 이전에는 바깥의 list 값을 먼저 읽고 분기했는데, 그 값이 갱신 전 상태(stale)일 수 있어
                  // 빠르게 여러 번 누르면 같은 물품이 장바구니에 중복으로 들어가는 문제가 있었다.
                  // 처음 담는 순간에만 안내한다(이미 담긴 걸 더할 때는 방해가 된다)
                  const special = it.requestFor !== undefined || it.personalOwner !== undefined;
                  if (special && !list.some((x: CartItem) => x.id === it.id)) { setNoticeItem(it); return; }
                  if (it.variants?.length) { setVariantPick(it); return; } // 종류부터 고르게 한다
                  const overStock = addLine(it, {}, stock);
                  if (overStock) { showToast(`재고(${stock}개)를 초과할 수 없습니다.`, "warn"); return; }
                  if (onFly) onFly(e.currentTarget.getBoundingClientRect());
                }}
                style={{
                  border: `${inCart ? 2 : 1}px solid ${inCart ? C.accent : C.border}`,
                  borderRadius: "14px", background: C.card, padding: "8px",
                  cursor: (!inCart && soldOut) ? "not-allowed" : "pointer",
                  opacity: (!inCart && soldOut) ? 0.5 : 1,
                  display: "flex", flexDirection: "column", gap: "6px",
                }}
              >
                <div
                  onClick={(e) => { if (it.image) { e.stopPropagation(); setImageModalUrl(getGoogleDriveImageUrl(it.image)); } }}
                  style={{ height: "104px", borderRadius: "10px", overflow: "hidden", background: C.cardSub, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                >
                  {it.image
                    ? <img src={getThumbImageUrl(it.image)} alt="" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    : <Package size={26} style={{ color: C.label, opacity: 0.45 }} />}
                </div>

                <div title={it.name} style={{ fontSize: "13px", fontWeight: 800, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</div>
                <div style={{ fontSize: "10.5px", color: C.label, fontFamily: "monospace" }}>{it.id}</div>
                <div style={{ display: "flex", alignItems: "center", gap: "5px", flexWrap: "wrap" }}>
                  <StockBadges stock={stock} rented={rented} C={C} />
                  {/* 실측 치수가 있는 물품만 — 담기 전에 크기를 가늠할 수 있게 한다 */}
                  {hasDims(it) || (it.variants || []).some((v: any) => hasDims(v)) ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); setSizeItem(it); }}
                      title="실측 크기를 육면체로 보고 돌려봅니다"
                      style={{ fontSize: "10px", fontWeight: 800, borderRadius: "6px", padding: "2px 6px", border: `1px solid ${C.border}`, background: "transparent", color: C.label, cursor: "pointer" }}
                    >
                      📐 실제 크기
                    </button>
                  ) : null}
                  {/* request/개인 물품은 담기 전에 알아야 한다 — 예전엔 제출 직전 경고에만 떴다 */}
                  {it.requestFor !== undefined ? (
                    <span title={`특정 업체 request용${it.requestFor ? `: ${it.requestFor}` : ""}`}
                      style={{ fontSize: "10px", fontWeight: 800, borderRadius: "6px", padding: "2px 6px", color: C.accentText, background: C.accentSoft }}>
                      📌 {it.requestFor || "Request"}
                    </span>
                  ) : null}
                  {it.personalOwner !== undefined ? (
                    <span title={`개인 물품${it.personalOwner ? `: ${it.personalOwner}` : ""}`}
                      style={{ fontSize: "10px", fontWeight: 800, borderRadius: "6px", padding: "2px 6px", color: C.accentText, background: C.accentSoft }}>
                      👤 {it.personalOwner || "개인"}
                    </span>
                  ) : null}
                </div>

                {inCart ? (
                  <div style={{ display: "flex", gap: "5px" }}>
                    <div style={{ flex: 1, height: "26px", borderRadius: "8px", background: C.accentSoft, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11.5px", fontWeight: 800, color: C.accentText }}>
                      담김 {inCartQty}개
                    </div>
                    {/* 취소는 이 버튼으로만 (카드 클릭은 담기 전용) */}
                    <button
                      onClick={(e) => { e.stopPropagation(); setList((prev: CartItem[]) => prev.filter((x) => x.id !== it.id)); }}
                      title="담은 물품 빼기"
                      style={{ flexShrink: 0, width: "30px", height: "26px", borderRadius: "8px", border: "none", background: C.errorSoft, color: C.error, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, fontSize: "13px", fontWeight: 800 }}
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div style={{
                    height: "26px", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "11.5px", fontWeight: 800,
                    border: `1px solid ${C.border}`,
                    color: soldOut ? C.label : C.accentText,
                  }}>
                    {soldOut ? "재고 없음" : "담기"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* request/개인 물품 안내 — 담기 전에 한 번 짚어준다 */}
      <SizeViewerModal open={!!sizeItem} onClose={() => setSizeItem(null)} item={sizeItem} variants={sizeItem?.variants} C={C} />

      {noticeItem ? (
        <div
          onClick={() => { if (noticeRemaining === 0) setNoticeItem(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100, padding: "16px" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: C.card, border: `2px solid ${C.warn}`, borderRadius: "16px", padding: "20px", width: "min(400px, 100%)" }}
          >
            <div style={{ fontSize: "16px", fontWeight: 800, color: C.warn, marginBottom: "10px" }}>
              {noticeItem.requestFor !== undefined ? "📌 Request 물품입니다" : "👤 개인 물품입니다"}
            </div>
            <div style={{ fontSize: "13.5px", fontWeight: 700, color: C.text, marginBottom: "6px" }}>{noticeItem.name}</div>
            <div style={{ fontSize: "12.5px", color: C.label, lineHeight: 1.6, marginBottom: "16px" }}>
              {noticeItem.requestFor !== undefined ? (
                <>
                  {noticeItem.requestFor
                    ? <><b style={{ color: C.text }}>{noticeItem.requestFor}</b> 업체 request용으로 지정된 물품입니다. </>
                    : "특정 업체 request용으로 지정된 물품입니다. "}
                  다른 용도로 가져가도 되는지 확인한 뒤 담아주세요.
                </>
              ) : (
                <>
                  {noticeItem.personalOwner
                    ? <><b style={{ color: C.text }}>{noticeItem.personalOwner}</b>님의 개인 물품입니다. </>
                    : "개인 물품으로 등록되어 있습니다. "}
                  소유자에게 확인한 뒤 담아주세요.
                </>
              )}
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                type="button"
                disabled={noticeRemaining > 0}
                onClick={() => { if (noticeRemaining === 0) setNoticeItem(null); }}
                style={{ flex: 1, padding: "12px", borderRadius: "10px", border: `1px solid ${C.border}`, background: "none", color: C.label, cursor: noticeRemaining > 0 ? "default" : "pointer", fontSize: "13px", fontWeight: 700, opacity: noticeRemaining > 0 ? 0.55 : 1 }}
              >
                취소
              </button>
              <button
                type="button"
                disabled={noticeRemaining > 0}
                onClick={() => {
                  if (noticeRemaining > 0) return;
                  const it = noticeItem;
                  setNoticeItem(null);
                  if (it.variants?.length) { setVariantPick(it); return; }
                  const over = addLine(it, {}, Number(it.stock || 0));
                  if (over) showToast(`재고(${it.stock}개)를 초과할 수 없습니다.`, "warn");
                }}
                style={{ flex: 2, padding: "12px", borderRadius: "10px", border: "none", background: C.warn, color: "#fff", cursor: noticeRemaining > 0 ? "default" : "pointer", fontSize: "13px", fontWeight: 800, opacity: noticeRemaining > 0 ? 0.55 : 1 }}
              >
                {noticeRemaining > 0 ? `확인해주세요 (${noticeRemaining}초)` : "확인했습니다 · 담기"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 종류 선택 — 종류가 나뉜 물품을 담을 때만 뜬다.
          "종류 상관없음"은 지금 재고를 빼지 않고, 대여 확인 때 담당자가 실물을 보고 정한다. */}
      {variantPick ? (
        <div
          onClick={() => setVariantPick(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "16px" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: "16px", padding: "18px", width: "min(420px, 100%)", maxHeight: "80vh", overflowY: "auto" }}
          >
            <div style={{ fontSize: "15px", fontWeight: 800, color: C.text, marginBottom: "2px" }}>어떤 종류를 빌리시나요?</div>
            <div style={{ fontSize: "12px", color: C.label, marginBottom: "14px" }}>{variantPick.name}</div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {(variantPick.variants || []).map((v: any) => {
                const taken = list.filter((x) => x.id === variantPick.id && x.variantId === v.id).reduce((n, x) => n + (x.quantity || 0), 0);
                const out = v.stock <= 0;
                return (
                  <button
                    key={v.id}
                    disabled={out}
                    onClick={() => {
                      const over = addLine(variantPick, { variantId: v.id, variantName: v.name }, v.stock);
                      if (over) { showToast(`'${v.name}' 종류의 재고(${v.stock}개)를 초과할 수 없습니다.`, "warn"); return; }
                      setVariantPick(null);
                    }}
                    style={{
                      display: "flex", alignItems: "center", gap: "12px",
                      padding: "10px 12px", borderRadius: "11px", border: `1.5px solid ${C.border}`,
                      background: C.cardSub, color: out ? C.label : C.text, cursor: out ? "not-allowed" : "pointer",
                      fontSize: "13px", fontWeight: 700, textAlign: "left", opacity: out ? 0.55 : 1,
                    }}
                  >
                    {/* 종류별 사진 — 이름만으로는 구분이 어려운 경우가 많아 눈으로 고를 수 있게 한다.
                        사진을 누르면 큰 이미지로 열린다. */}
                    <span
                      onClick={(e) => { if (v.image) { e.stopPropagation(); setImageModalUrl(getGoogleDriveImageUrl(v.image)); } }}
                      style={{ width: "52px", height: "52px", flexShrink: 0, borderRadius: "9px", overflow: "hidden", background: C.card, display: "flex", alignItems: "center", justifyContent: "center" }}
                    >
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
              onClick={() => setVariantPick(null)}
              style={{ marginTop: "14px", width: "100%", padding: "10px", borderRadius: "10px", border: `1px solid ${C.border}`, background: "none", color: C.label, cursor: "pointer", fontSize: "12px", fontWeight: 700 }}
            >
              닫기
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function GroupCheckbox({
  gKey,
  items,
  toggleReturnKeys,
  selectedReturn,
  keyOf,
  C,
}: {
  gKey: string;
  items: any[];
  toggleReturnKeys: (items: any[], force: boolean) => void;
  selectedReturn: Record<string, number>;
  keyOf: (it: any) => string;
  C: any;
}) {
  const itemKeys = items.map(keyOf);
  const checkedCount = itemKeys.filter((k) => selectedReturn[k] !== undefined).length;
  const isAll = checkedCount === items.length && items.length > 0;
  const isSome = checkedCount > 0 && checkedCount < items.length;

  const handleToggle = () => {
    toggleReturnKeys(items, !isAll);
  };

  return (
    <div
      onClick={(e) => { e.stopPropagation(); handleToggle(); }}
      style={{
        width: 22,
        height: 22,
        borderRadius: "6px",
        border: `2px solid ${isAll || isSome ? C.accent : C.label}`,
        background: isAll ? C.accent : isSome ? C.accentSoft : C.card,
        boxShadow: isAll || isSome ? "none" : "inset 0 1px 2px rgba(0,0,0,0.06)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        flexShrink: 0,
        position: "relative"
      }}
    >
      {isAll ? <Check size={14} strokeWidth={3.5} style={{ color: "#ffffff" }} /> : null}
      {isSome ? <div style={{ width: 10, height: 10, background: C.accent, borderRadius: "3px" }} /> : null}
    </div>
  );
}

function GroupSection({
  gKey,
  title,
  icon,
  items,
  level = 1,
  children,
  expanded,
  setExpanded,
  returnSearch,
  isLightMode,
  C,
  getAvatarColor,
  sumQty,
  toggleReturnKeys,
  selectedReturn,
  keyOf,
}: {
  key?: string | number;
  gKey: string;
  title: string;
  icon?: React.ReactNode;
  items: any[];
  level?: number;
  children: React.ReactNode;
  expanded: Record<string, boolean>;
  setExpanded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  returnSearch: string;
  isLightMode: boolean;
  C: any;
  getAvatarColor: (name: string) => { bg: string; text: string; };
  sumQty: (items: any[]) => number;
  toggleReturnKeys: (items: any[], force: boolean) => void;
  selectedReturn: Record<string, number>;
  keyOf: (it: any) => string;
}) {
  // 기본값: 접힌 상태. 검색 중일 때는 결과가 보이도록 자동 펼침.
  // 사용자가 직접 토글한 경우(expanded[gKey]에 값 존재)에는 그 값을 우선한다.
  const hasSearch = returnSearch.trim().length > 0;
  const isExp = expanded[gKey] ?? hasSearch;

  const toggleExp = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((prev) => ({ ...prev, [gKey]: !isExp }));
  };

  const itemKeys = items.map(keyOf);
  const checkedCount = itemKeys.filter((k) => selectedReturn[k] !== undefined).length;
  const isAll = checkedCount === items.length && items.length > 0;
  const totalQty = sumQty(items);

  // Styling based on level
  let headerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: level === 1 ? "12px 14px" : "10px 12px",
    background: level === 1 ? C.card : level === 2 ? C.cardSub : "transparent",
    borderBottom: level < 3 ? `1px solid ${C.border}` : "none",
    cursor: "pointer",
    userSelect: "none",
  };

  if (level === 1) {
    headerStyle = {
      ...headerStyle,
      borderRadius: "14px",
      border: `1.5px solid ${isAll ? C.accent : C.border}`,
      boxShadow: "0 2px 12px rgba(0,0,0,0.02)",
      marginBottom: "10px",
    };
  } else if (level === 2) {
    headerStyle = {
      ...headerStyle,
      borderRadius: "10px",
      border: `1px solid ${C.border}`,
      marginTop: "8px",
      marginBottom: "4px",
    };
  } else if (level === 3) {
    headerStyle = {
      ...headerStyle,
      padding: "6px 8px 4px",
      fontSize: "12px",
      fontWeight: 800,
      color: C.label,
    };
  } else {
    headerStyle = {
      ...headerStyle,
      padding: "4px 8px",
      fontSize: "11px",
      color: C.label,
    };
  }

  const avatar = level === 1 ? getAvatarColor(title) : null;
  const avatarBg = avatar ? avatar.bg : "transparent";
  const avatarText = avatar ? avatar.text : "transparent";

  return (
    <div style={{ marginBottom: level === 1 ? "14px" : "0" }}>
      <div onClick={toggleExp} style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1, minWidth: 0 }}>
          <GroupCheckbox gKey={gKey} items={items} toggleReturnKeys={toggleReturnKeys} selectedReturn={selectedReturn} keyOf={keyOf} C={C} />
          {level === 1 ? (
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: avatarBg, color: avatarText, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "12px", flexShrink: 0 }}>
              {title.slice(0, 1)}
            </div>
          ) : null}
          {icon ? <span style={{ flexShrink: 0, display: "inline-flex" }}>{icon}</span> : null}
          <span style={{ fontWeight: level === 1 ? 800 : 700, fontSize: level === 1 ? "14px" : "13px", color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {title}
          </span>
          <span style={{ fontSize: "10px", fontWeight: 700, color: C.accentText, background: C.accentSoft, borderRadius: "8px", padding: "1px 6px", flexShrink: 0 }}>
            {totalQty}개
          </span>
          {checkedCount > 0 ? (
            <span style={{ fontSize: "10px", fontWeight: 700, color: C.success, background: C.successSoft, borderRadius: "8px", padding: "1px 6px", flexShrink: 0 }}>
              {checkedCount}개 선택됨
            </span>
          ) : null}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button onClick={toggleExp} style={{ border: "none", background: "none", color: C.label, cursor: "pointer", padding: "4px", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <ChevronRight size={16} style={{ transform: isExp ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s ease" }} />
          </button>
        </div>
      </div>
      {isExp ? (
        <div style={{ paddingLeft: level === 1 ? "12px" : level === 2 ? "10px" : "8px", borderLeft: level < 3 ? `1px dashed ${C.border}` : "none", marginLeft: level === 1 ? "16px" : level === 2 ? "12px" : "4px" }}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

function ReturnItemCard({
  item,
  selectedReturn,
  setSelectedReturn,
  toggleReturnKeys,
  C,
  keyOf,
  setImageModalUrl,
}: {
  key?: string | number;
  item: any;
  selectedReturn: Record<string, number>;
  setSelectedReturn: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  toggleReturnKeys: (items: any[], force: boolean) => void;
  C: any;
  keyOf: (it: any) => string;
  setImageModalUrl: (url: string) => void;
}) {
  const k = keyOf(item);
  const isSel = selectedReturn[k] !== undefined;
  const maxQty = Math.max(1, parseInt(String(item.quantity), 10) || 1);
  const selQty = selectedReturn[k];

  const handleToggle = () => {
    // 카드 클릭 시: 체크박스와 동일하게 항상 "전체 수량"으로 선택/해제한다.
    // (수량 조절은 아래 스테퍼로 별도 처리)
    toggleReturnKeys([item], !isSel);
  };

  return (
    <div
      onClick={handleToggle}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
        padding: "10px 12px",
        background: isSel ? C.accentSoft : C.card,
        border: `1px solid ${isSel ? C.accent : C.border}`,
        borderRadius: "10px",
        cursor: "pointer",
        marginTop: "4px",
        userSelect: "none",
        transition: "all 0.15s ease",
      }}
    >
      <div style={{ flexShrink: 0, marginTop: "2px" }} onClick={(e) => e.stopPropagation()}>
        <GroupCheckbox gKey={k} items={[item]} toggleReturnKeys={toggleReturnKeys} selectedReturn={selectedReturn} keyOf={keyOf} C={C} />
      </div>
      <Thumb url={item.image} size={40} C={C} setImageModalUrl={setImageModalUrl} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: "13px", color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {item.itemLabel || item.name || "(이름 없음)"}
        </div>
        <div style={{ display: "flex", gap: "6px", fontSize: "11px", color: C.label, marginTop: "2px", alignItems: "center" }}>
          <span>{item.itemId || item.id}</span>
          <span>•</span>
          <span>{item.quantity || 1}개 대여</span>
          {item.generalOption === "SID 추가 물품" ? (
            <>
              <span>•</span>
              <span style={{ color: C.warn, fontWeight: 700 }}>추가</span>
            </>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: "4px", marginTop: "2px" }}>
          <LocBadge slot={item.location} C={C} />
        </div>
        {isSel && maxQty > 1 ? (
          <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "8px" }}>
            <span style={{ fontSize: "11px", color: C.label, fontWeight: 700 }}>반납 수량</span>
            <button
              onClick={() => setSelectedReturn((p) => ({ ...p, [k]: Math.max(1, (p[k] ?? maxQty) - 1) }))}
              style={{ width: 26, height: 26, borderRadius: "7px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
            ><Minus size={12} /></button>
            <span style={{ fontWeight: 700, minWidth: "18px", textAlign: "center", fontSize: "13px" }}>{selQty ?? maxQty}</span>
            <button
              onClick={() => setSelectedReturn((p) => ({ ...p, [k]: Math.min(maxQty, (p[k] ?? maxQty) + 1) }))}
              style={{ width: 26, height: 26, borderRadius: "7px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
            ><Plus size={12} /></button>
            <span style={{ fontSize: "11px", color: C.label }}>/ 총 {maxQty}개</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
