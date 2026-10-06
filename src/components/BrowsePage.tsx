import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  ArrowLeft, Search, User, IdCard, Boxes, Fingerprint, ChevronRight,
  Plus, Minus, X, ShoppingCart, Warehouse, MapPin, Trash2, HandHelping,
  Building2, MoreHorizontal, RotateCcw, Check, Layers, SlidersHorizontal, Info, Sparkles } from "lucide-react";
import ImageZoomModal from "./ImageZoomModal";
import ItemBorrowersModal, { BorrowersTarget } from "./ItemBorrowersModal";
import { BoxCanvas, SizeViewerModal, dimsLabel, hasDims, SHAPE_LABEL } from "./SizeViewer";
import {
  ObjectItem, BrowseCartItem,
  padSlot, isKoreanName,
  fetchObjectItems, checkConfigDsRegistered,
  fetchMyBorrowedItems, fetchWarehouseBorrowedItems,
  saveIdentity, loadIdentity,
  saveBrowseCart, loadBrowseCart,
  DEMO_OBJECT_ITEMS,
  fetchScenarioDefinition, ScenarioDefinition,
  fetchTableclothItems, TableclothItem, fetchTableclothCategories, TableclothCategory,
  fetchTableclothActiveBorrowers, TableclothBorrower,
  recordTableclothBorrow,
  fetchSeatMap, SeatFloor,
  fetchActiveItemTypeCount, ActiveItemTypeInfo,
} from "../utils/borrowApi";
import { locationKey, withMyFloorFirst } from "../utils/tableclothLocation";
import { getGoogleDriveImageUrl, getThumbImageUrl } from "../utils/drive";
import HazardConfirmModal, { collectHazardItems, HazardItem } from "./HazardConfirmModal";
import BorrowerSeatSuggestions from "./BorrowerSeatSuggestions";
import UnattendedToolBorrowForm from "./UnattendedToolBorrowForm";
import UnattendedToolReturnForm from "./UnattendedToolReturnForm";
import { BorrowedTool, fetchMyTools } from "../utils/warehouseManualApi";
import { useVersionWorkGuard } from "../utils/versionWorkGuard";
import { searchScenarioAi, ScenarioAiResult, filterScenarioAiResults } from "../utils/scenarioAiSearch";
import { scenarioRegularScore, scenarioAiResultActive } from "../utils/scenarioRegularSearch";

type Affiliation = "cfgw" | "configds" | "other";
// 무인 모드에서는 목록 선택 대신 직접 입력·촬영으로 공구를 신청한다.
type Step = "identity" | "menu" | "scenarioKind" | "scenario" | "tablecloth" | "warehouse" | "toolReturn" | "mylookup" | "sid";
type Kind = "scenario" | "tablecloth";

interface BrowsePageProps {
  key?: string;
  scriptUrl: string;
  connected: boolean;
  isLightMode: boolean;
  onBack: () => void;
  showToast: (msg: string, type: "ok" | "error" | "info" | "warn") => void;
  onGoBorrow: (payload: {
    identity: { name: string; employeeId: string; affiliation: Affiliation };
    kind: Kind;
    /** 신원 입력에서 받아둔 좌석. 대여 화면이 다시 묻지 않도록 그대로 넘긴다. */
    seat?: { floor: string; unit: string };
    /** SID 대여로 담았으면 그 시나리오 번호. 대여 화면이 방식과 SID를 다시 묻지 않는다. */
    sid?: string;
    /** SID 필요 물품 외에 사용자가 따로 담은 물품. */
    additionalItems?: BrowseCartItem[];
    /** 관리자 직접 대여는 저장된 사용자 장바구니 대신 현재 선택을 직접 전달한다. */
    items?: BrowseCartItem[];
  }) => void;
  /** 테이블보 반납으로 넘어간다 — 천은 담당자 없이 본인이 직접 돌려놓는다. */
  onGoTableclothReturn?: () => void;
  initialStep?: Step | "sidBorrow" | null;
  /** 로그인한 대여자. 있으면 신원 입력 단계를 건너뛴다 — 이미 받은 값을 또 묻지 않는다. */
  session?: { name: string; employeeId: string; affiliation: Affiliation; floor: string; unit: string } | null;
  onSeatChange?: (seat: { floor: string; unit: string }) => void;
  /** "browse" = 대여(기본), "mylookup" = 내 대여조회 전용 */
  purpose?: "browse" | "mylookup";
  isAdmin?: boolean;
  adminDirectBorrow?: boolean;
  adminCart?: BrowseCartItem[];
  onAdminBack?: (items: BrowseCartItem[]) => void;
  /** 무인 모드 중에는 관리자가 아니면 모든 보관 위치를 숨긴다 — 대여 신청 후 발급되는
   *  QR을 통해서만 위치를 볼 수 있게 하기 위함. */
  unattendedEnabled?: boolean;
}

/**
 * 한 번 받아온 목록을 화면이 닫혀도 들고 있는다(소프트 로드).
 *
 * 화면을 드나들 때마다 목록을 비우고 스피너를 띄우면, 600종이 도착할 때까지 몇 초간
 * 아무것도 못 본다. 대신 지난번 목록을 곧바로 그리고, 새 값은 뒤에서 받아 조용히 갈아끼운다.
 * 서버 주소가 바뀌면 다른 곳의 자료이므로 통째로 버린다.
 */
const listCache: {
  key: string;
  sci: ObjectItem[];
  tc: TableclothItem[];
  tcCats: TableclothCategory[];
  tcOut: Record<string, TableclothBorrower[]>;
} = { key: "", sci: [], tc: [], tcCats: [], tcOut: {} };

function cacheFor(scriptUrl: string) {
  if (listCache.key !== scriptUrl) {
    listCache.key = scriptUrl;
    listCache.sci = []; listCache.tc = []; listCache.tcCats = []; listCache.tcOut = {};
  }
  return listCache;
}

export default function BrowsePage({
  scriptUrl, connected, isLightMode, onBack, showToast, onGoBorrow, onGoTableclothReturn, initialStep = null, purpose = "browse", session = null,
  isAdmin = false, unattendedEnabled = false, adminDirectBorrow = false, adminCart, onAdminBack, onSeatChange,
}: BrowsePageProps) {
  // 원격 WMS 데이터를 읽는 로컬 검증 모드에서는 서버 변경 요청을 전부 막는다.
  // 버튼을 미리 비활성화해, 눌렀다가 '대여 신청 오류' 결과 화면으로 가는 일도 없게 한다.
  const remoteReadonly = import.meta.env.MODE === "remote-readonly";
  // 무인 모드 중에는 비관리자에게 보관 위치를 전부 숨긴다 — 위치는 대여 신청 후
  // 발급되는 QR(해당 신청 물품에만 유효)을 통해서만 볼 수 있다.
  const hideLocation = unattendedEnabled && !isAdmin;
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

  const [step, setStep] = useState<Step>(() => {
    if (adminDirectBorrow) return "scenario";
    // 내 대여 조회: 로그인해 있으면 그 사번으로 바로 조회하고, 아니면 신원 입력부터 받는다.
    if (purpose === "mylookup") return session ? "mylookup" : "identity";
    // 주소가 #/browse/sid 로 들어온 경우도 SID 단계로 시작한다
    const slug = (typeof window !== "undefined" ? window.location.hash.split("/")[2] : "") || "";
    if (slug === "sid") return "sid";
    if (initialStep) return initialStep;
    // 로그인해서 들어왔으면 신원을 다시 묻지 않는다. 바로 분야 선택부터 시작한다.
    return session ? "menu" : "identity";
  });
  const [affiliation, setAffiliation] = useState<Affiliation>("cfgw");
  const [name, setName] = useState("");
  const [empId, setEmpId] = useState("");
  const [otherName, setOtherName] = useState("");
  const [verifying, setVerifying] = useState(false);

  const seed = cacheFor(scriptUrl);
  const [sciItems, setSciItems] = useState<ObjectItem[]>(seed.sci);
  const [sciLoaded, setSciLoaded] = useState(seed.sci.length > 0);
  const stickyHeaderRef = useRef<HTMLDivElement>(null);
  const stickyStatusRef = useRef<HTMLDivElement>(null);
  const [stickyHeaderHeight, setStickyHeaderHeight] = useState(64);
  const [stickyStatusHeight, setStickyStatusHeight] = useState(0);
  useEffect(() => {
    const measure = () => {
      // getBoundingClientRect()는 데스크톱의 CSS zoom(1.15)이 적용된 높이를 돌려준다.
      // 그 값을 같은 zoom 영역의 sticky top에 다시 쓰면 배율이 이중 적용되어 헤더와
      // 상태 바 사이에 빈 틈이 생긴다. 레이아웃 기준 높이인 offsetHeight를 사용한다.
      if (stickyHeaderRef.current) setStickyHeaderHeight(stickyHeaderRef.current.offsetHeight);
      if (stickyStatusRef.current) setStickyStatusHeight(stickyStatusRef.current.offsetHeight);
    };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (stickyHeaderRef.current) observer?.observe(stickyHeaderRef.current);
    if (stickyStatusRef.current) observer?.observe(stickyStatusRef.current);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [step]);
  const [sciLoading, setSciLoading] = useState(false);
  // 일반 물품은 수백 건의 사진·정렬 정보를 한꺼번에 그린다. 바로 화면을 바꾸면 첫 프레임이
  // 멎은 것처럼 보이므로, 짧은 준비 화면을 먼저 보여준 뒤 목록을 연다.
  const [openingScenario, setOpeningScenario] = useState(false);
  const openingScenarioTimer = useRef<number | null>(null);
  const [sciErr, setSciErr] = useState("");

  const [sciCart, setSciCart] = useState<BrowseCartItem[]>([]);
  useEffect(() => {
    if (adminDirectBorrow && adminCart) setSciCart(adminCart);
  }, [adminDirectBorrow, adminCart]);
  const [sidAdditionalItems, setSidAdditionalItems] = useState<BrowseCartItem[]>([]);
  const [sidAddingExtra, setSidAddingExtra] = useState(false);
  const sidAddingExtraRef = useRef(false);
  sidAddingExtraRef.current = sidAddingExtra;
  // 종류가 나뉜 물품을 담을 때 사진을 보고 고르는 모달
  const [variantPick, setVariantPick] = useState<ObjectItem | null>(null);
  // "필요 물품 전부 담기"로 종류가 나뉜 물품이 여러 개 걸릴 때 차례로 물어보기 위한 대기열.
  // 예전에는 물품마다 창을 열려고 해서 마지막 하나만 남았고, 하나를 고르면 창이 닫혀
  // 나머지는 담기지 않았다.
  const [variantQueue, setVariantQueue] = useState<ObjectItem[]>([]);

  /** 지금 창을 닫고, 대기열에 남은 다음 물품을 이어서 물어본다. */
  function advanceVariantQueue() {
    setVariantQueue((prev) => {
      const [next, ...rest] = prev;
      setVariantPick(next || null);
      return rest;
    });
  }
  // 실측 치수가 등록된 물품만 "실제 크기 보기"가 뜬다. 렌더링은 이 브라우저가 한다.
  const [sizeItem, setSizeItem] = useState<any | null>(null);
  const [detailItem, setDetailItem] = useState<any | null>(null);
  // 테이블보는 이름이 번호뿐이라 사진과 분류로 고른다. 수량은 항상 1장씩 담는다.
  const [tcItems, setTcItems] = useState<TableclothItem[]>(seed.tc);
  const [tcCats, setTcCats] = useState<TableclothCategory[]>(seed.tcCats);
  const [tcLoaded, setTcLoaded] = useState(seed.tc.length > 0);
  const [tcLoading, setTcLoading] = useState(false);
  const [tcErr, setTcErr] = useState("");
  const [tcCart, setTcCart] = useState<{ id: number; name: string; image: string; location: string }[]>([]);
  const [tcSearch, setTcSearch] = useState("");
  const [tcCat, setTcCat] = useState("");
  const [tcLoc, setTcLoc] = useState("");
  // 지금 나가 있는 천 — 물품 번호별 대여자 목록. 남은 수량이 0인 카드에 이름과 자리를 적는다.
  const [tcOut, setTcOut] = useState<Record<string, TableclothBorrower[]>>(seed.tcOut);
  // 테이블보 대여는 이 목록 안에서 확인하고 바로 기록한다. 예전 전용 대여 화면으로
  // 이동시키면 현재 장바구니가 전달되지 않고, 폐기된 목록 화면이 다시 나타났다.
  const [tcConfirmOpen, setTcConfirmOpen] = useState(false);
  const [tcSubmitting, setTcSubmitting] = useState(false);

  // 좌석 위치. 예전에는 대여 화면의 첫 단계에서 물었는데, 신원 입력이 이리로 옮겨오면서
  // 같이 왔다 — 같은 화면에서 한 번에 받는 편이 오가는 단계가 준다.
  // 배치도는 거의 바뀌지 않으므로 지난번 값을 먼저 그려 선택이 바로 뜨게 한다.
  const SEAT_MAP_CACHE_KEY = "wms_seat_map_v1";
  const [seatMap, setSeatMap] = useState<SeatFloor[]>(() => {
    try {
      const raw = sessionStorage.getItem(SEAT_MAP_CACHE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) return parsed as SeatFloor[];
    } catch { /* 캐시가 없거나 깨졌으면 빈 값으로 시작 */ }
    return [];
  });
  const [seatMapLoaded, setSeatMapLoaded] = useState(false);
  const [selFloor, setSelFloor] = useState("");
  const [selUnit, setSelUnit] = useState("");

  // 지금 몇 종을 빌리고 있는지. 한도를 넘긴 뒤에야 알게 되면 담은 걸 도로 빼야 해서,
  // 담기 전에 보이도록 신원이 정해지는 즉시 불러온다.
  const [active, setActive] = useState<ActiveItemTypeInfo | null>(null);
  const [activeLoading, setActiveLoading] = useState(false);

  /* 주의가 필요한 물품(파손·화재·request용·개인 물품)은 담는 순간에 알린다.
   * 예전에는 신청 직전에야 떠서, 다 담아놓고 나서 "이건 빼야 한다"를 알게 됐다.
   * 확인을 누르면 그대로 담고, 취소하면 담지 않는다. */
  const [hazardAsk, setHazardAsk] = useState<{ items: HazardItem[]; onConfirm: () => void } | null>(null);

  /* 종수 한도를 넘기게 되는 순간에도 알린다. 숫자를 보여주고 담을지 정하게 한다. */
  const [limitAsk, setLimitAsk] = useState<{ current: number; adding: number; max: number } | null>(null);

  /* 수량·무단사용 안내. 시나리오 물품을 고르기 시작할 때 한 번 띄운다.
   * 예전에는 신청 단추를 누른 뒤에 떠서, 다 담고 난 뒤에야 읽게 됐다. */
  const [qtyNoticeOpen, setQtyNoticeOpen] = useState(false);
  const qtyNoticeShownRef = useRef(false);
  useEffect(() => {
    if (step !== "scenarioKind" || qtyNoticeShownRef.current) return;
    qtyNoticeShownRef.current = true;
    setQtyNoticeOpen(true);
  }, [step]);

  // 이름을 적는 동안 바로 뜨게 한다. 다 넣고 다음 화면으로 넘어간 뒤에야 "이미 한도를
  // 채웠다"를 알게 되면 되돌아가야 한다.
  const typedName = (affiliation === "other" ? otherName : name).trim();
  useEffect(() => {
    if (purpose !== "browse" || !connected || !scriptUrl) return;
    if (!typedName) { setActive(null); return; }
    // cfgw는 사번으로 동명이인을 가른다. 사번이 채워지기 전에 이름만으로 조회하면
    // 같은 이름을 쓰는 다른 사람의 현황이 보인다.
    if (affiliation === "cfgw" && !/^\d+$/.test(empId.trim())) { setActive(null); return; }
    let cancelled = false;
    setActiveLoading(true);
    fetchActiveItemTypeCount(scriptUrl, typedName, { floor: selFloor, unit: selUnit }, { employeeId: empId.trim(), affiliation })
      .then((info) => { if (!cancelled) setActive(info); })
      // 보여주기용이라 실패해도 담기를 막지 않는다. 한도는 신청할 때 서버가 다시 본다.
      .catch(() => { if (!cancelled) setActive(null); })
      .finally(() => { if (!cancelled) setActiveLoading(false); });
    return () => { cancelled = true; };
  }, [purpose, connected, scriptUrl, typedName, empId, affiliation, selFloor, selUnit]);

  useEffect(() => {
    if (seatMapLoaded || !connected || !scriptUrl) return;
    fetchSeatMap(scriptUrl)
      .then((m) => {
        const floors = m.floors || [];
        setSeatMap(floors);
        try { sessionStorage.setItem(SEAT_MAP_CACHE_KEY, JSON.stringify(floors)); } catch { /* 저장 실패는 무시 */ }
      })
      // 조회에 실패해도 막지 않는다. 층·유닛 없이도 신청은 된다.
      .catch((e: any) => console.error("[좌석배치도 조회 실패]", e))
      .finally(() => setSeatMapLoaded(true));
  }, [connected, scriptUrl, seatMapLoaded]);

  /** 그 층의 유닛 목록. "Unit 3"처럼 번호만 붙은 이름이 먼저, 그다음 숫자 순이다. */
  const seatUnits = useMemo(() => {
    const floor = seatMap.find((f) => (f.name || f.id) === selFloor);
    return [...(floor?.units || [])].sort((a, b) => {
      const plainA = /^unit\s*\d+$/i.test(a.label.trim());
      const plainB = /^unit\s*\d+$/i.test(b.label.trim());
      if (plainA !== plainB) return plainA ? -1 : 1;
      const nA = parseInt((a.label.match(/\d+/) || ["Infinity"])[0], 10);
      const nB = parseInt((b.label.match(/\d+/) || ["Infinity"])[0], 10);
      if (nA !== nB) return nA - nB;
      return a.label.localeCompare(b.label);
    });
  }, [seatMap, selFloor]);
  const [cartOpen, setCartOpen] = useState<Kind | null>(null);

  const [sciSearch, setSciSearch] = useState("");
  const [sciSearchMode, setSciSearchMode] = useState<"normal" | "ai">("normal");
  const [sciAi, setSciAi] = useState<{ query: string; busy: boolean; result?: ScenarioAiResult; error?: string } | null>(null);
  const sciAiController = useRef<AbortController | null>(null);
  const sciAiTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function stopScenarioAi() {
    sciAiController.current?.abort(); sciAiController.current = null;
    if (sciAiTimer.current) clearTimeout(sciAiTimer.current);
    sciAiTimer.current = null;
  }
  function clearScenarioAi() { stopScenarioAi(); setSciAi(null); setSciSearchMode("normal"); }
  useEffect(() => () => stopScenarioAi(), []);
  const [sciCat, setSciCat] = useState("");
  const [sciSub, setSciSub] = useState("");
  const [sciRequestFilter, setSciRequestFilter] = useState<"all" | "normal">(() => {
    try {
      const saved = sessionStorage.getItem("wms_scenario_request_filter");
      // 예전 'request만 표시' 값은 단일 포함 체크의 기본값으로 전환한다.
      return saved === "normal" ? "normal" : "all";
    } catch { return "all"; }
  });
  const [sciFiltersOpen, setSciFiltersOpen] = useState(false);
  const [sciSort, setSciSort] = useState<"id_desc" | "id_asc" | "location_desc" | "location_asc" | "name_asc">("id_desc");
  // 무인 모드에선 위치순 정렬도 막는다 — 정렬 순서만으로 같은 칸 물품이 드러난다.
  const effectiveSciSort = hideLocation && sciSort.startsWith("location") ? "id_desc" : sciSort;

  const [modalUrl, setModalUrl] = useState("");
  const [borrowersTarget, setBorrowersTarget] = useState<BorrowersTarget | null>(null);
  const closeBorrowers = useCallback(() => setBorrowersTarget(null), []);
  const [myLoading, setMyLoading] = useState(false);
  const [myResult, setMyResult] = useState<{ scenario: any[]; general: any[]; warehouse: any[] } | null>(null);

  useEffect(() => {
    try { sessionStorage.setItem("wms_scenario_request_filter", sciRequestFilter); } catch { /* 저장소 접근 불가 */ }
  }, [sciRequestFilter]);

  const identName = affiliation === "other" ? otherName.trim() : name.trim();
  const identEmp = affiliation === "cfgw" ? empId.trim() : "";
  useEffect(() => { clearScenarioAi(); }, [sciSearch, sciCat, sciSub, sciRequestFilter, identEmp, scriptUrl]);
  useEffect(() => {
    if (step !== "scenario") {
      stopScenarioAi();
      setSciAi(prev => prev?.busy ? (prev.result ? { ...prev, busy: false } : null) : prev);
    }
  }, [step]);
  async function runScenarioAi() {
    const query = sciSearch.trim();
    if (!query || sciAi?.busy || !connected) return;
    stopScenarioAi();
    setSciSearchMode("ai");
    const controller = new AbortController(); sciAiController.current = controller;
    sciAiTimer.current = setTimeout(() => controller.abort(), 6000);
    setSciAi(prev => ({ ...(prev?.query === query ? prev : {}), query, busy: true, error: undefined }));
    try {
      const result = await searchScenarioAi(identEmp, query, { category: sciCat, subcategory: sciSub, request: sciRequestFilter }, controller.signal);
      if (sciAiController.current === controller) setSciAi({ query, busy: false, result });
    } catch (error: any) {
      if (sciAiController.current === controller) setSciAi({ query, busy: false, error: error.name === "AbortError" ? "AI 응답이 늦어 검색을 중단했습니다. 일반 검색은 계속 사용할 수 있습니다." : error instanceof TypeError ? "AI 검색에 연결하지 못했습니다. 일반 검색으로 찾아주세요." : error.message });
    } finally {
      if (sciAiController.current === controller && sciAiTimer.current) { clearTimeout(sciAiTimer.current); sciAiTimer.current = null; }
    }
  }
  const [myTools, setMyTools] = useState<BorrowedTool[]>([]);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolsError, setToolsError] = useState("");
  const toolsChecked = useRef("");
  const toolsLookupId = useRef(0);
  const canUseTools = !!unattendedEnabled && !adminDirectBorrow && purpose === "browse";
  const refreshMyTools = useCallback(async () => {
    if (!canUseTools || !/^\d{4}$/.test(identEmp)) return;
    const id = ++toolsLookupId.current;
    setToolsLoading(true); setToolsError("");
    try { const list = await fetchMyTools(identEmp); if (id === toolsLookupId.current) setMyTools(list); }
    catch (e: any) { if (id === toolsLookupId.current) setToolsError(e.message); }
    finally { if (id === toolsLookupId.current) setToolsLoading(false); }
  }, [canUseTools, identEmp]);
  // 사번 확인 직후 한 번만 반납 화면을 우선한다. 분야를 다시 고르거나 추가 대여 중에는 강제로 이동하지 않는다.
  useEffect(() => {
    if (!canUseTools || step === "identity" || !/^\d{4}$/.test(identEmp) || toolsChecked.current === identEmp) return;
    const id = ++toolsLookupId.current;
    let alive = true;
    setMyTools([]); setToolsLoading(true); setToolsError("");
    fetchMyTools(identEmp).then(list => {
      if (!alive || id !== toolsLookupId.current) return;
      toolsChecked.current = identEmp;
      setMyTools(list);
      if (list.length) setStep(current => current === "menu" ? "toolReturn" : current);
    }).catch(e => { if (alive && id === toolsLookupId.current) { toolsChecked.current = identEmp; setToolsError(e.message); } })
      .finally(() => { if (alive && id === toolsLookupId.current) setToolsLoading(false); });
    return () => { alive = false; };
  }, [canUseTools, identEmp, step === "identity"]);

  // 지난번에 넣은 값을 그대로 되살린다. 확인 단계(계속하기)는 그대로 거치므로,
  // 다른 사람이 쓰던 자리에서 열었더라도 이름을 고쳐 넣으면 된다.
  useEffect(() => {
    // 로그인 값이 있으면 그것이 기준이다. 저장해둔 값보다 우선한다.
    if (session) {
      setAffiliation(session.affiliation);
      if (session.affiliation === "other") setOtherName(session.name);
      else setName(session.name);
      setEmpId(session.employeeId || "");
      setSelFloor(session.floor || "");
      setSelUnit(session.unit || "");
      // 신원 입력 단계를 건너뛰므로 장바구니도 여기서 불러온다 — 원래는 그 단계에서 했다.
      const eid = session.affiliation === "cfgw" ? session.employeeId : "";
      if (!adminDirectBorrow) setSciCart(loadBrowseCart(session.name, eid));
      return;
    }
    const saved = loadIdentity();
    if (!saved) return;
    if (saved.affiliation) setAffiliation(saved.affiliation);
    if (saved.affiliation === "other") setOtherName(saved.name || "");
    else setName(saved.name || "");
    setEmpId(saved.employeeId || "");
    if (saved.floor) setSelFloor(saved.floor);
    if (saved.unit) setSelUnit(saved.unit);
  }, []);

  // 되살린 좌석이 지금 배치도에 없으면(자리가 없어졌거나 이름이 바뀐 경우) 비운다 —
  // 그대로 두면 화면에는 빈 칸인데 값은 남아 있어, 고르지 않고도 통과해버린다.
  useEffect(() => {
    if (!seatMapLoaded || seatMap.length === 0) return;
    const floor = seatMap.find((f) => (f.name || f.id) === selFloor);
    if (selFloor && !floor) { setSelFloor(""); setSelUnit(""); return; }
    if (selUnit && floor && !(floor.units || []).some((u) => u.label === selUnit)) setSelUnit("");
  }, [seatMapLoaded, seatMap, selFloor, selUnit]);

  // 화면(단계)이 바뀌면 스크롤이 이전 위치에 그대로 남아있지 않도록 맨 위로 초기화한다.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [step]);

  useEffect(() => {
    if (adminDirectBorrow || step === "identity" || !identName) return;
    saveBrowseCart(identName, identEmp, sciCart);
  }, [sciCart, identName, identEmp, step, adminDirectBorrow]);

  const loadScenario = useCallback(async () => {
    // 그릴 것이 이미 있으면 화면을 비우지 않는다 — 뒤에서 조용히 갈아끼운다.
    if (!listCache.sci.length) setSciLoading(true);
    try {
      const next = connected && scriptUrl ? await fetchObjectItems(scriptUrl) : DEMO_OBJECT_ITEMS;
      cacheFor(scriptUrl).sci = next;
      setSciItems(next);
      setSciErr("");
    } catch (e: any) {
      setSciErr(e?.message || "불러오기에 실패했습니다.");
      showToast(`시나리오 물품을 불러오지 못했습니다: ${e.message}`, "error");
    }
    finally { setSciLoaded(true); setSciLoading(false); }
  }, [connected, scriptUrl, showToast]);

  const loadTablecloth = useCallback(async () => {
    if (!listCache.tc.length) setTcLoading(true);
    try {
      const [items, cats, out] = await Promise.all([
        fetchTableclothItems(scriptUrl),
        fetchTableclothCategories(scriptUrl).catch(() => [] as TableclothCategory[]),
        // 담당자를 거치지 않는 물건이라, 다 나갔을 때 누구에게 물어야 하는지가 곧 재고 정보다.
        fetchTableclothActiveBorrowers(scriptUrl).catch(() => ({} as Record<string, TableclothBorrower[]>)),
      ]);
      // 보관 처리된 천은 빌릴 수 없으니 목록에서 뺀다.
      const live = items.filter((it: any) => !it.archived);
      const c = cacheFor(scriptUrl);
      c.tc = live; c.tcCats = cats; c.tcOut = out;
      setTcItems(live);
      setTcCats(cats);
      setTcOut(out);
      setTcErr("");
    } catch (e: any) {
      setTcErr(e?.message || "불러오기에 실패했습니다.");
      showToast(`테이블보를 불러오지 못했습니다: ${e.message}`, "error");
    }
    finally { setTcLoaded(true); setTcLoading(false); }
  }, [scriptUrl, showToast]);

  // 어느 화면까지 새로 받아왔는지. 화면을 바꿀 때마다 딱 한 번만 갱신하기 위한 표시다.
  const refreshedStepRef = useRef<string>("");
  // step이 scenario/tablecloth가 되면 (아직 미로드·비로딩일 때) 자동 로드.
  // 클릭 핸들러에서 직접 호출하지 않고 effect로 처리하여 클로저/중복호출 문제를 원천 차단.
  useEffect(() => {
    // SID 열람에서도 물품 위치·사진을 붙이려면 시나리오 물품 목록이 필요하다
    // 지난번 목록이 있어도 화면에 들어올 때 한 번 더 받아온다 — 남은 수량은 남이 빌리면
    // 바로 달라진다. 화면은 비우지 않으므로(소프트 로드) 숫자만 조용히 갱신된다.
    // "들어올 때 한 번"을 지키지 않으면 로딩이 끝날 때마다 다시 불러 끝없이 돈다.
    if (refreshedStepRef.current !== step) {
      refreshedStepRef.current = step;
      if (step === "scenario" || step === "sid") loadScenario();
      if (step === "tablecloth") loadTablecloth();
    }
    // 분야를 고르는 동안 미리 받아둔다. 예전에는 고른 뒤에야 받기 시작해서, 600종이
    // 도착할 때까지 몇 초간 화면이 멎은 것처럼 보였다.
    if ((step === "menu" || step === "scenarioKind") && !sciLoaded && !sciLoading) loadScenario();
  }, [step, sciLoaded, sciLoading, tcLoaded, tcLoading, loadScenario, loadTablecloth]);

  const sciCatMap = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    sciItems.forEach((it) => {
      if (!it.category) return;
      if (!map[it.category]) map[it.category] = new Set<string>();
      if (it.subcategory) map[it.category].add(it.subcategory);
    });
    return map;
  }, [sciItems]);
  const sciCats = useMemo(() => Object.keys(sciCatMap).sort(), [sciCatMap]);
  const sciSubs = sciCat && sciCatMap[sciCat] ? Array.from<string>(sciCatMap[sciCat]).sort() : [];

  const sciFiltered = useMemo(() => {
    if (scenarioAiResultActive(sciSearchMode, sciAi?.query, sciSearch, !!sciAi?.result)) return filterScenarioAiResults(sciItems, sciAi!.result!.items.map(i => i.id), { category: sciCat, subcategory: sciSub, request: sciRequestFilter });
    const q = sciSearch.trim();
    const scores = new Map<string, number>();
    const filtered = sciItems.filter((it) => {
      if (sciCat && it.category !== sciCat) return false;
      if (sciSub && it.subcategory !== sciSub) return false;
      if (sciRequestFilter === "normal" && it.requestFor !== undefined) return false;
      if (!q) return true;
      const score = scenarioRegularScore(it, q, hideLocation);
      if (score === null) return false;
      scores.set(it.id, score); return true;
    });
    const byId = (a: ObjectItem, b: ObjectItem) => padSlot(a.id).localeCompare(padSlot(b.id));
    const byLocation = (a: ObjectItem, b: ObjectItem) => padSlot(a.rootSlot).localeCompare(padSlot(b.rootSlot));
    const tieBreak = (a: ObjectItem, b: ObjectItem) => {
      switch (effectiveSciSort) {
        case "id_asc": return byId(a, b);
        case "id_desc": return byId(b, a);
        case "location_asc": return byLocation(a, b);
        case "location_desc": return byLocation(b, a);
        case "name_asc": return (a.name || "").localeCompare(b.name || "", "ko");
        default: return 0;
      }
    };
    return filtered.sort((a, b) => (q ? (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0) : 0) || tieBreak(a, b));
  }, [sciItems, sciSearch, sciCat, sciSub, sciRequestFilter, effectiveSciSort, hideLocation, sciAi, sciSearchMode]);

  const sciCartCount = sciCart.reduce((n, c) => n + c.quantity, 0);
  const tcCartCount = tcCart.length;
  useVersionWorkGuard("borrower-browse", sciCartCount + tcCartCount > 0 || tcSubmitting, "대여 신청 작성 중");

  async function submitTableclothBorrow() {
    if (remoteReadonly) { showToast("원격 읽기 전용 테스트 모드에서는 대여 신청을 실행할 수 없습니다.", "info"); return; }
    if (!connected || !scriptUrl) { showToast("서버 연결을 확인해주세요.", "error"); return; }
    if (!identName || tcCart.length === 0) return;
    setTcSubmitting(true);
    try {
      const res = await recordTableclothBorrow(scriptUrl, {
        borrowerName: identName,
        affiliation,
        employeeId: identEmp,
        floor: selFloor || undefined,
        unit: selUnit || undefined,
        items: tcCart.map((item) => ({ id: item.id, name: item.name, qty: 1 })),
      });
      if (!res?.success) throw new Error(res?.message || "대여 신청에 실패했습니다.");
      const count = tcCart.length;
      setTcCart([]);
      setCartOpen(null);
      setTcConfirmOpen(false);
      showToast(`테이블보 ${count}장 대여가 완료되었습니다.`, "ok");
      await loadTablecloth();
    } catch (e: any) {
      showToast(e?.message || "테이블보 대여 신청에 실패했습니다.", "error");
    } finally {
      setTcSubmitting(false);
    }
  }

  /** 장바구니에서 그 줄 하나만 뺀다. 시나리오 물품은 같은 물품이라도 종류가 다르면 다른 줄이다. */
  function removeCartLine(kind: Kind, line: any) {
    if (kind === "tablecloth") { setTcCart((prev) => prev.filter((c) => c.id !== line.id)); return; }
    setSciCart((prev) => prev.filter((c) => cartKey(c) !== cartKey(line)));
  }

  /** 장바구니 줄에 붙일 사진. 장바구니에는 사진을 저장하지 않으므로 목록에서 찾아온다.
   *  테이블보만 담을 때 함께 들고 온다(목록을 다시 훑지 않아도 되게). */
  function cartLineImage(kind: Kind, line: any): string {
    if (kind === "tablecloth") return line.image || "";
    const it = sciItems.find((o) => padSlot(String(o.id)) === padSlot(String(line.id)));
    // 종류를 고른 줄은 그 종류의 사진이 있으면 그것을 먼저 쓴다 — 무엇을 담았는지가 더 분명하다.
    const variant = line.variantId ? (it?.variants || []).find((v: any) => v.id === line.variantId) : null;
    return (variant as any)?.image || it?.image || "";
  }

  /** 분류 key를 사람이 읽는 이름으로. 분류표가 아직 안 왔거나 지워진 key면 key를 그대로 보인다. */
  const tcCatLabel = (key?: string) => tcCats.find((c) => c.key === key)?.label || key || "";

  /** 보관 위치 묶음. 표기가 흔들려서(B2 / B02) 정규화 키로 묶고, 내 층을 맨 앞에 둔다. */
  const tcLocations = useMemo(() => {
    const by = new Map<string, { key: string; label: string; count: number }>();
    for (const it of tcItems) {
      const k = locationKey(it.location);
      if (!k) continue;
      const cur = by.get(k);
      if (cur) cur.count++;
      else by.set(k, { key: k, label: String(it.location || "").trim(), count: 1 });
    }
    // 내 층을 맨 앞에 세운다 — 층을 넘겨주지 않으면 정렬이 아무 일도 하지 않는다.
    return withMyFloorFirst([...by.values()].sort((a, b) => b.count - a.count), selFloor);
  }, [tcItems, selFloor]);

  // 천은 층마다 따로 보관하고 빌리는 사람은 자기 층으로 걸어간다. 그래서 열람에 들어오면
  // 로그인할 때 고른 층으로 먼저 좁혀 둔다. 한 번만 걸어주고, 그 뒤에 사용자가 다른 층이나
  // "전체 층"을 고르면 다시 끼어들지 않는다.
  const tcAutoLocRef = React.useRef(false);
  useEffect(() => {
    if (step !== "tablecloth") { tcAutoLocRef.current = false; return; }
    if (tcAutoLocRef.current || !tcItems.length) return;
    const mine = locationKey(selFloor);
    if (!mine) return;
    tcAutoLocRef.current = true;
    // 내 층에 천이 하나도 없으면 빈 화면만 남으므로 그대로 전체를 보여준다.
    if (tcItems.some((it) => locationKey(it.location) === mine)) setTcLoc(mine);
  }, [step, tcItems, selFloor]);

  const tcFiltered = useMemo(() => {
    // 검색은 번호만 받는다 — 이름이 곧 번호다. "7"과 "TC-0007" 둘 다 통하게 숫자만 본다.
    const q = tcSearch.trim().replace(/\D/g, "");
    const list = tcItems.filter((it) => {
      if (tcCat && it.category !== tcCat) return false;
      if (tcLoc && locationKey(it.location) !== tcLoc) return false;
      if (q && !String(it.name || "").replace(/\D/g, "").includes(q)) return false;
      return true;
    });
    // "전체 층"으로 보고 있어도 내 층이 먼저 오게 묶어서 정렬한다 — 층 칩과 같은 순서다.
    const order = new Map<string, number>(tcLocations.map((l, i) => [l.key, i] as [string, number]));
    const rank = (it: { location?: string }): number => order.get(locationKey(it.location)) ?? 999;
    return list.sort((a, b) => rank(a) - rank(b) || Number(a.id) - Number(b.id));
  }, [tcItems, tcSearch, tcCat, tcLoc, tcLocations]);

  /** 천은 한 장씩만 담는다. 이미 담았으면 다시 눌러 뺀다. */
  function toggleTc(it: TableclothItem) {
    setTcCart((prev) =>
      prev.some((c) => c.id === it.id)
        ? prev.filter((c) => c.id !== it.id)
        : [...prev, { id: it.id, name: it.name, image: it.image || "", location: it.location || "" }]
    );
  }

  // 같은 물품이라도 종류가 다르면 장바구니에서 서로 다른 줄로 관리한다.
  const cartKey = (c: { id: string; variantId?: number }) => `${c.id}::${c.variantId ?? ""}`;

  /** 담기 전에 물어봐야 할 것이 있으면 물어보고, 확인을 받은 뒤에 실제로 담는다.
   *  이미 담긴 물품을 하나 더 담는 경우에는 묻지 않는다 — 같은 것을 반복해 물을 이유가 없다. */
  function askThenAdd(it: ObjectItem, add: () => void) {
    const alreadyInCart = sciCart.some((c) => c.id === it.id);

    // 종수 한도. 안 갖고 있던 물품을 새로 담을 때만 종수가 는다.
    const max = active?.max ?? 0;
    const exempt = !!active?.exempt;
    if (!exempt && max > 0 && !alreadyInCart) {
      const heldIds = new Set((active?.items || []).map((x) => padSlot(String(x.id))));
      const addingIds = new Set(sciCart.map((c) => padSlot(String(c.id))));
      addingIds.add(padSlot(String(it.id)));
      let adding = 0;
      for (const id of addingIds) if (!heldIds.has(id)) adding++;
      const current = active?.count ?? 0;
      if (current + adding > max) { setLimitAsk({ current, adding, max }); return; }
    }

    const hazards = alreadyInCart ? [] : collectHazardItems(sciItems as any, [{ id: it.id, name: it.name }]);
    if (hazards.length > 0) { setHazardAsk({ items: hazards, onConfirm: add }); return; }
    add();
  }

  function addSci(it: ObjectItem) {
    // 일반 대여로 담은 것이 섞이면 특정 시나리오의 신청이라고 할 수 없다. 일반 대여로 보낸다.
    if (!sidAddingExtraRef.current) setSidBorrowId("");
    if ((it.stock || 0) < 1) { showToast("재고가 부족하여 담을 수 없습니다. (현재 재고: 0)", "warn"); return; }
    askThenAdd(it, () => {
      // 종류가 나뉜 물품은 어느 종류인지 정해야 담을 수 있다 — 안 그러면 대여 화면에서 막힌다.
      if (it.variants?.length) { setVariantPick(it); return; }
      addSciLine(it, {}, it.stock || 0);
    });
  }

  function addSciLine(it: ObjectItem, choice: { variantId?: number; variantName?: string }, max: number) {
    setSciCart((prev) => {
      const key = cartKey({ id: it.id, ...choice });
      const idx = prev.findIndex((c) => cartKey(c) === key);
      if (idx === -1) return [...prev, { id: it.id, name: it.name, quantity: 1, rootSlot: it.rootSlot, ...choice }];
      if (prev[idx].quantity >= max) { showToast(`재고가 부족합니다. (최대 ${max}개)`, "warn"); return prev; }
      return prev.map((c, i) => (i === idx ? { ...c, quantity: c.quantity + 1 } : c));
    });
    if (sidAddingExtraRef.current) {
      setSidAdditionalItems((prev) => {
        const key = cartKey({ id: it.id, ...choice });
        const idx = prev.findIndex((c) => cartKey(c) === key);
        if (idx === -1) return [...prev, { id: it.id, name: it.name, quantity: 1, rootSlot: it.rootSlot, ...choice }];
        return prev.map((c, i) => i === idx ? { ...c, quantity: c.quantity + 1 } : c);
      });
    }
  }

  /** 시나리오 장바구니에 한 줄을 필요 수량으로 맞춰 넣는다. 여러 번 넣어도 결과가 같다. */
  function putSciLine(obj: ObjectItem, qty: number) {
    setSciCart((prev) => {
      const key = cartKey({ id: obj.id });
      const idx = prev.findIndex((c) => cartKey(c) === key);
      if (idx === -1) return [...prev, { id: obj.id, name: obj.name, quantity: qty, rootSlot: obj.rootSlot }];
      return prev.map((c, i) => (i === idx ? { ...c, quantity: qty } : c));
    });
  }

  /** SID가 요구하는 물품 하나를 필요 수량만큼 장바구니에 맞춰 넣는다.
   *  이미 담긴 게 있으면 그 수량을 필요 수량으로 덮어쓴다 — 여러 번 눌러도 결과가 같다.
   *  종류가 나뉜 물품은 어느 종류인지 사람이 골라야 해서 여기서 담지 않고 알려만 준다. */
  function addSidItem(need: { id: string; name: string; quantity?: number }): "ok" | "variant" | "nostock" | "unknown" {
    // 이 화면에서 담은 것은 SID 대여다. 어느 시나리오인지 기억해 두었다가 신청할 때 함께 보낸다.
    if (sidResult?.sid) setSidBorrowId(sidResult.sid);
    const wantId = padSlot(String(need.id || "").trim());
    const obj = sciItems.find((o) => padSlot(String(o.id || "").trim()) === wantId);
    if (!obj) return "unknown";
    if (obj.variants?.length) { setVariantPick(obj); return "variant"; }
    const stock = obj.stock || 0;
    if (stock < 1) return "nostock";
    const qty = Math.min(Math.max(1, Number(need.quantity) || 1), stock);
    // 주의가 필요한 물품이면 담기 전에 알린다(이미 담긴 것은 다시 묻지 않는다).
    if (!sciCart.some((c) => c.id === obj.id)) {
      const hz = collectHazardItems(sciItems as any, [{ id: obj.id, name: obj.name }]);
      if (hz.length > 0) {
        setHazardAsk({ items: hz, onConfirm: () => putSciLine(obj, qty) });
        return "ok";
      }
    }
    putSciLine(obj, qty);
    return "ok";
  }

  /** 필요 물품을 한 번에 담는다. 담지 못한 것은 이유별로 모아서 한 번만 알린다. */
  function addAllSidItems(items: { id: string; name: string; quantity?: number }[]) {
    const fail = { nostock: [] as string[], unknown: [] as string[] };
    const needVariant: ObjectItem[] = [];
    let ok = 0;
    for (const need of items) {
      const wantId = padSlot(String(need.id || "").trim());
      const obj = sciItems.find((o) => padSlot(String(o.id || "").trim()) === wantId);
      if (!obj) { fail.unknown.push(need.name || need.id); continue; }
      // 종류가 나뉜 물품은 사람이 골라야 한다. 여기서 담지 않고 모아두었다가 차례로 물어본다.
      if (obj.variants?.length) { needVariant.push(obj); continue; }
      const r = addSidItem(need);
      if (r === "ok") ok++;
      else if (r === "nostock") fail.nostock.push(need.name || need.id);
    }
    const parts = [`${ok}종을 담았습니다`];
    if (needVariant.length) parts.push(`종류를 골라야 하는 ${needVariant.length}종은 이어서 물어봅니다`);
    if (fail.nostock.length) parts.push(`재고가 없는 ${fail.nostock.length}종은 담지 못했습니다`);
    if (fail.unknown.length) parts.push(`목록에 없는 ${fail.unknown.length}종은 건너뛰었습니다`);
    showToast(parts.join(" · "), ok || needVariant.length ? "ok" : "warn");

    if (needVariant.length) {
      const [first, ...rest] = needVariant;
      setVariantPick(first);
      setVariantQueue(rest);
    }
  }

  function chgSci(idx: number, d: number) {
    setSciCart((prev) => {
      const item = prev[idx]; if (!item) return prev;
      const orig = sciItems.find((o) => o.id === item.id);
      // 종류를 고른 줄은 그 종류의 재고가 상한이다.
      const variant = item.variantId ? (orig?.variants || []).find((v) => v.id === item.variantId) : null;
      const max = variant ? variant.stock || 0 : orig ? orig.stock || 0 : 0;
      const next = item.quantity + d;
      if (d > 0 && next > max) { showToast(`재고가 부족합니다. (최대 ${max}개)`, "warn"); return prev; }
      if (next < 1) return prev.filter((_, i) => i !== idx);
      return prev.map((c, i) => (i === idx ? { ...c, quantity: next } : c));
    });
  }
  async function submitIdentity() {
    if (affiliation === "other") {
      if (!otherName.trim()) { showToast("성함을 입력해주세요.", "warn"); return; }
    } else {
      if (!name.trim()) { showToast("성함을 입력해주세요.", "warn"); return; }
      if (!isKoreanName(name.trim())) { showToast("이름은 한글만 입력할 수 있습니다.", "warn"); return; }
      if (affiliation === "cfgw" && !/^\d+$/.test(empId.trim())) { showToast("사번은 숫자만 입력할 수 있습니다.", "warn"); return; }
    }
    // 좌석은 필수다. 자리를 모르면 물품이 어디로 갔는지 추적할 수 없고, 종수 한도도
    // 자리 기준으로 판정된다. 다만 배치도 자체를 못 불러온 경우까지 막지는 않는다 —
    // 서버 사정으로 대여를 통째로 세울 이유는 없다.
    if (seatMapLoaded && seatMap.length > 0) {
      if (!selFloor) { showToast("좌석 위치(층)를 선택해주세요.", "warn"); return; }
      if (!selUnit) { showToast("좌석 위치(유닛)를 선택해주세요.", "warn"); return; }
    } else if (!seatMapLoaded) {
      showToast("좌석 배치도를 불러오는 중입니다. 잠시 후 다시 시도해주세요.", "warn");
      return;
    }
    if (affiliation === "configds" && connected && scriptUrl) {
      setVerifying(true);
      try {
        const result = await checkConfigDsRegistered(scriptUrl, name.trim());
        if (result.ambiguous) { showToast("같은 이름으로 등록된 ConfigDS 계정이 여러 개입니다. 관리자에게 계정 정리를 요청해주세요.", "error"); return; }
        if (!result.registered) { showToast("ConfigDS 인원 명부에 등록되지 않은 이름입니다. 관리자에게 등록을 요청해주세요.", "error"); return; }
      } catch (e: any) { showToast(`확인 중 오류: ${e.message}`, "error"); return; }
      finally { setVerifying(false); }
    }
    const nm = affiliation === "other" ? otherName.trim() : name.trim();
    const eid = affiliation === "cfgw" ? empId.trim() : "";
    // 소속을 가리지 않고 저장한다 — 예전에는 cfgw만 저장해서, ConfigDS·기타 소속은
    // 올 때마다 이름을 다시 적어야 했다.
    if (!adminDirectBorrow) {
      saveIdentity({ name: nm, employeeId: eid, affiliation, floor: selFloor, unit: selUnit });
      setSciCart(loadBrowseCart(nm, eid));
    }
    if (purpose === "mylookup") { setMyResult(null); setStep("mylookup"); runMyLookup(); }
    else setStep("menu");
  }

  // 로그인해서 내 대여 조회로 들어오면 신원 칸이 채워지는 대로 한 번 조회한다.
  useEffect(() => {
    if (purpose !== "mylookup" || !session || step !== "mylookup") return;
    if (myResult || myLoading || !identName) return;
    runMyLookup();
  }, [purpose, session, step, identName]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── SID 열람: 시나리오 ID로 필요 물품 조회 ── */
  const [sidInput, setSidInput] = useState("");
  // SID 대여로 담았다면 그 번호. 대여 화면이 방식과 SID를 다시 묻지 않도록 함께 넘긴다.
  // 일반 대여로 담았으면 빈 값이고, 그때는 일반 대여로 신청된다.
  const [sidBorrowId, setSidBorrowId] = useState("");
  const [sidLoading, setSidLoading] = useState(false);
  const [sidResult, setSidResult] = useState<ScenarioDefinition | null>(null);

  async function runSidLookup() {
    const sid = sidInput.trim();
    if (!sid) { showToast("시나리오 ID를 입력해주세요.", "warn"); return; }
    if (!connected || !scriptUrl) { showToast("연동이 필요합니다.", "warn"); return; }
    setSidLoading(true);
    try {
      const def = await fetchScenarioDefinition(scriptUrl, sid);
      setSidResult(def);
      if (!def.found) showToast(`'${sid}' 시나리오를 찾지 못했습니다.`, "warn");
    } catch (e: any) {
      showToast(`SID 조회 실패: ${e.message}`, "error");
    } finally {
      setSidLoading(false);
    }
  }

  async function runMyLookup() {
    setMyLoading(true);
    try {
      if (connected && scriptUrl) {
        const [sc, wh] = await Promise.all([
          fetchMyBorrowedItems(scriptUrl, identName, identEmp, affiliation),
          fetchWarehouseBorrowedItems(scriptUrl, identName),
        ]);
        // 테이블 기준으로 분리: SID대여(scenario) vs 일반대여(general)
        const scenarioOnly = (sc || []).filter((it: any) => it.sheetType === "scenario");
        const generalOnly = (sc || []).filter((it: any) => it.sheetType === "general");
        // GAS 스크립트에서 전체 목록을 반환하는 경우를 대비해 클라이언트 사이드에서 한 번 더 필터링 보강
        const filteredWh = (wh || []).filter((it: any) => {
          const u = String(it.user || it.borrowerName || "").trim().toLowerCase();
          const target = identName.trim().toLowerCase();
          return u === target && u !== "";
        });
        setMyResult({ scenario: scenarioOnly, general: generalOnly, warehouse: filteredWh });
      } else {
        setMyResult({ scenario: [], general: [], warehouse: [] });
      }
    } catch (e: any) { showToast(`조회 중 오류: ${e.message}`, "error"); }
    finally { setMyLoading(false); }
  }

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
  function Spinner({ size = 20 }: { size?: number }) {
    return <span style={{ width: size, height: size, borderRadius: "50%", display: "inline-block", border: `3px solid ${C.border}`, borderTopColor: C.accent, animation: "bsp-spin 0.9s linear infinite" }} />;
  }
  function openGeneralBrowse() {
    if (openingScenario) return;
    setOpeningScenario(true);
    // 목록 화면에는 즉시 들어가되, 첫 렌더링·사진 처리·최신 재고 갱신이 끝날 시간 동안
    // 오버레이로 입력만 잠깐 막는다. 목록이 한꺼번에 튀어나오며 멎어 보이는 문제를 줄인다.
    setStep("scenario");
    openingScenarioTimer.current = window.setTimeout(() => {
      setOpeningScenario(false);
      openingScenarioTimer.current = null;
    }, 3000);
  }
  function AffCard({ active, icon, text, onClick }: { active: boolean; icon: React.ReactNode; text: string; onClick: () => void }) {
    return (
      <div onClick={onClick} style={{ flex: 1, cursor: "pointer", borderRadius: "14px", textAlign: "center", padding: "16px 8px", border: `1px solid ${active ? C.accent : C.border}`, background: active ? C.accentSoft : C.card, display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
        <span style={{ color: active ? C.accentText : C.label }}>{icon}</span>
        <span style={{ fontWeight: 700, fontSize: "12px", color: active ? C.accentText : C.text }}>{text}</span>
      </div>
    );
  }

  function topBack() {
    if (adminDirectBorrow) {
      if (onAdminBack) onAdminBack(sciCart);
      else onBack();
      return;
    }
    if (step === "identity") return onBack();
    if (step === "menu") return session ? onBack() : setStep("identity");
    // 시나리오 계열은 한 단계 위가 "대여 방식 고르기"다.
    if (step === "scenarioKind") return adminDirectBorrow ? onBack() : setStep("menu");
    if (step === "scenario") {
      if (sidAddingExtra) { setSidAddingExtra(false); return setStep("sid"); }
      return adminDirectBorrow ? onBack() : setStep("scenarioKind");
    }
    if (step === "sid" && initialStep !== "sid") return setStep("scenarioKind");
    if (step === "mylookup" && purpose === "mylookup") return session ? onBack() : setStep("identity");
    // SID 열람으로 바로 들어온 경우엔 메뉴가 아니라 이전 화면으로 나간다
    if (step === "sid" && initialStep === "sid") return onBack();
    setStep("menu");
  }

  const headerTitle = step === "scenarioKind" ? "시나리오 물품 대여"
    : step === "scenario" ? (sidAddingExtra ? "추가 물품 담기" : "시나리오 물품 대여")
    : step === "tablecloth" ? "테이블보 대여"
    : step === "warehouse" ? "공구 대여"
    : step === "toolReturn" ? "공구 반납"
    : step === "mylookup" ? "내 대여 조회"
    : step === "sid" ? "SID 열람" : "열람 조회";

  /* ── URL 해시로 열람 단계 세분화 (#/browse/<단계>) ── */
  const stepRef = useRef(step);
  stepRef.current = step;

  // 슬라이딩 방향 추적 (렌더 중 동기 계산)
  const STEP_ORDER: Record<string, number> = { identity: 0, menu: 1, scenarioKind: 2, scenario: 3, tablecloth: 2, warehouse: 2, toolReturn: 2, mylookup: 2, sid: 3 };
  const prevStepOrderRef = useRef(STEP_ORDER[step] ?? 0);
  const slideDirRef = useRef<"forward" | "back">("forward");
  const curStepOrder = STEP_ORDER[step] ?? 0;
  if (curStepOrder !== prevStepOrderRef.current) {
    slideDirRef.current = curStepOrder >= prevStepOrderRef.current ? "forward" : "back";
    prevStepOrderRef.current = curStepOrder;
  }
  const slideDir = slideDirRef.current;
  const suppressBrowseHash = useRef(false);
  const browseBase = purpose === "mylookup" ? "mylookup" : "browse";

  useEffect(() => {
    if (adminDirectBorrow) return;
    if (suppressBrowseHash.current) { suppressBrowseHash.current = false; return; }
    const target = `#/${browseBase}/${step}`;
    if (window.location.hash !== target) {
      window.history.pushState(null, "", target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    if (adminDirectBorrow) return;
    const onPop = () => {
      const parts = window.location.hash.split("/");
      const base = parts[1] || "";
      const slug = parts[2] || "";
      if (base !== "browse" && base !== "mylookup") { onBack(); return; }
      const valid: Step[] = ["identity", "menu", "scenarioKind", "scenario", "tablecloth", "warehouse", "toolReturn", "mylookup", "sid"];
      if (valid.includes(slug as Step) && slug !== stepRef.current) {
        suppressBrowseHash.current = true;
        setStep(slug as Step);
      } else if (!valid.includes(slug as Step)) {
        onBack();
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="brp-root" style={{ minHeight: "100vh", background: C.bg, color: C.text }}>
      <style>{`
        @keyframes bsp-spin { to { transform: rotate(360deg); } }
        /* 목록이 다 뜬 순간 화면이 툭 바뀌어 눈에 거슬렸다. 아주 짧게 떠오르듯 나타나게 해
           불러오기가 끝났다는 것이 자연스럽게 읽히도록 한다. */
        @keyframes bp-grid-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .bp-grid-in { animation: bp-grid-in 0.26s ease-out both; }
        /* 사진은 제각각 도착한다. 도착할 때마다 깜빡이지 않도록 천천히 떠오르게 둔다. */
        @keyframes bp-img-in { from { opacity: 0; } to { opacity: 1; } }
        .bp-img-in { animation: bp-img-in 0.3s ease-out both; }
        @media (prefers-reduced-motion: reduce) {
          .bp-grid-in, .bp-img-in { animation: none; }
        }
        @media (min-width: 900px) {
          .brp-root { zoom: 1.15; }
        }
        .bsp-scenario-layout {
          display: block;
        }
        .bsp-least-col {
          margin-bottom: 0;
        }
        .bsp-item-layout { display: flex; align-items: flex-start; gap: 18px; }
        .bsp-filter-sidebar { flex: 0 0 210px; width: 210px; }
        .bsp-item-results { flex: 1 1 auto; min-width: 0; }
        @media (max-width: 720px) {
          .bsp-item-layout { flex-direction: column; }
          .bsp-filter-sidebar { width: 100%; flex-basis: auto; position: static !important; }
          .bsp-item-results { width: 100%; }
        }
        @media (min-width: 900px) {
          .bsp-scenario-layout {
            display: grid;
            /* 물품 그리드가 주인공이므로 넓게, 랭킹 패널은 오른쪽 고정폭으로 */
            grid-template-columns: minmax(0, 1fr) 260px;
            gap: 20px;
            align-items: start;
          }
          /* DOM 순서는 그대로 두고(모바일에서 랭킹이 위로 오도록) 데스크톱에서만 좌우를 바꾼다 */
          .bsp-least-col {
            order: 2;
            position: sticky;
            align-self: start;
          }
          .bsp-scenario-main { order: 1; min-width: 0; }
        }
        /* 야구장 점수판처럼 한 줄씩 뒤집히며 나타난다 */
        @keyframes bsp-flip-in {
          0%   { transform: rotateX(-90deg); opacity: 0; }
          60%  { transform: rotateX(12deg);  opacity: 1; }
          100% { transform: rotateX(0deg);   opacity: 1; }
        }
        .bsp-flip-row {
          transform-origin: top center;
          backface-visibility: hidden;
          animation: bsp-flip-in 0.42s ease-out both;
        }
        /* 랭킹 목록 스크롤바를 얇게 */
        .bsp-least-list::-webkit-scrollbar { width: 6px; }
        .bsp-least-list::-webkit-scrollbar-thumb { border-radius: 999px; background: rgba(148,163,184,0.5); }
        .bsp-least-list::-webkit-scrollbar-track { background: transparent; }
      `}</style>

      <div ref={stickyHeaderRef} style={{ display: "flex", flexWrap: step === "toolReturn" ? "wrap" : undefined, alignItems: "center", gap: "12px", padding: "16px 20px", borderBottom: `1px solid ${C.border}`, background: C.card, position: "sticky", top: 0, zIndex: 20 }}>
        <button onClick={topBack} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.card, color: C.label, cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>
          <ArrowLeft size={15} /> {step === "identity" ? "메인으로" : "이전"}
        </button>
        <h1 style={{ fontSize: "17px", fontWeight: 800, margin: 0, flex: 1 }}>{headerTitle}</h1>
        {step === "toolReturn" && canUseTools && <button onClick={() => setStep("warehouse")} style={{ padding: "9px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.accent, color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>공구 추가 대여하기</button>}
        {step !== "identity" ? (
          <span style={{ fontSize: "12px", color: C.label, fontWeight: 600 }}>
            {identName}{identEmp ? ` · ${identEmp}` : ` · ${affiliation === "configds" ? "ConfigDS" : "기타"}`}
          </span>
        ) : null}
      </div>

      {/* 장바구니는 화면 오른쪽 아래에 떠 있는 단추였다. 무엇을 담았는지 보려면 눌러서
          열어야 했고, 그래서 담은 걸 잊거나 중복해서 담는 일이 잦았다.
          이제 머리 바로 아래 붙어 담긴 물품 이름까지 그대로 보여준다. */}
      {/* 대여 현황과 장바구니는 둘 다 늘 보여야 한다. 각각 고정하면 같은 자리에 겹치므로
          한 덩어리로 묶어 머리 바로 아래에 붙인다. */}
      <div ref={stickyStatusRef} style={{ position: "sticky", top: stickyHeaderHeight, zIndex: 19 }}>

      {hideLocation && step !== "identity" && step !== "warehouse" && step !== "toolReturn" ? (
        <div style={{ padding: "9px 20px", background: C.warnSoft, color: C.warn, fontSize: "12px", fontWeight: 700, textAlign: "center" }}>
          🔒 무인 모드 중에는 시나리오 물품의 보관 위치가 표시되지 않습니다. 신청 후 무인 PC에서 사번으로 로그인하면 대여 확인 목록에 위치가 나옵니다.
        </div>
      ) : null}

      {/* 지금 몇 종을 빌리고 있는지. 한도에 가까워지면 색이 바뀐다 —
          담을 만큼 담은 뒤 신청 단계에서 막히는 일을 줄이려는 것이다. */}
      {purpose === "browse" && step !== "warehouse" && step !== "toolReturn" && (active || activeLoading) ? (() => {
        const count = active?.count ?? 0;
        const max = active?.max ?? 0;
        const exempt = !!active?.exempt;
        const full = !exempt && max > 0 && count >= max;
        const near = !exempt && max > 0 && !full && count >= max - 1;
        const tone = full ? C.error : near ? C.warn : C.label;
        return (
          <div
            style={{
              // 가운데에 둔다 — 구석에 있으면 화면이 넓을 때 시선이 닿지 않는다.
              display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", flexWrap: "wrap",
              textAlign: "center",
              padding: "8px 16px", background: full ? C.errorSoft : C.bg,
              borderBottom: `1px solid ${C.border}`, fontSize: "12px", color: tone, fontWeight: 700,
            }}
          >
            {activeLoading && !active ? (
              <span style={{ color: C.label }}>현재 대여 현황을 확인하는 중입니다...</span>
            ) : (
              <>
                <span>
                  현재 대여 중 <span style={{ color: full ? C.error : C.accentText }}>{count}종</span>
                  {exempt ? " · 한도 없음" : max > 0 ? ` / ${max}종` : ""}
                </span>
                {/* 페널티는 한도만 줄이는 게 아니라 "왜 줄었는지"를 알아야 납득이 된다.
                    대여 화면과 같은 내용(한도·사유·해제일)을 그대로 보여준다.
                    예외 유닛이면 한도 자체가 없어 페널티도 의미가 없으므로 감춘다. */}
                {!exempt && active?.penalty ? (
                  <span style={{ color: "#fff", background: C.error, borderRadius: "999px", padding: "3px 10px", fontWeight: 800 }}>
                    ⚠ 페널티 {active.penalty.max}종 제한
                    {active.penalty.reason ? ` · ${active.penalty.reason}` : ""}
                    {active.penalty.until ? ` · ${active.penalty.until}까지` : ""}
                  </span>
                ) : null}
                {full ? <span>· 한도에 도달해 더 빌릴 수 없습니다. 먼저 반납해주세요.</span> : null}
              </>
            )}
          </div>
        );
      })() : null}

      {(step === "scenario" || step === "tablecloth" || (step === "sid" && initialStep !== "sid")) ? (() => {
        // SID 대여도 시나리오 장바구니에 담는다 — 일반 대여와 같은 장바구니다.
        const kind: Kind = step === "tablecloth" ? "tablecloth" : "scenario";
        const n = kind === "scenario" ? sciCartCount : tcCartCount;
        const lines: any[] = kind === "scenario" ? sciCart : tcCart;
        return (
          <div
            style={{
              display: "flex", alignItems: "center", gap: "10px",
              padding: "10px 16px", background: C.card,
              borderBottom: `1px solid ${C.border}`,
            }}
          >
            <ShoppingCart size={17} style={{ color: n > 0 ? C.accentText : C.label, flexShrink: 0 }} />
            <span style={{ fontSize: "13px", fontWeight: 800, color: C.text, flexShrink: 0 }}>
              장바구니 <span style={{ color: n > 0 ? C.accentText : C.label }}>{n}</span>
            </span>

            {/* 담긴 물품. 이름만 보여주던 알약 모양이었는데, 시나리오 물품은 이름만으로
                무엇인지 알기 어려워 사진을 왼쪽에 함께 둔다. 사진을 누르면 크게 볼 수 있다.
                많으면 옆으로 넘겨 본다 — 줄바꿈시키면 머리가 계속 커진다. */}
            <div style={{ flex: 1, minWidth: 0, display: "flex", gap: "8px", overflowX: "auto", scrollbarWidth: "none" }}>
              {lines.length === 0 ? (
                <span style={{ fontSize: "12px", color: C.label, whiteSpace: "nowrap" }}>아직 담은 물품이 없습니다</span>
              ) : (
                lines.map((c: any, i: number) => {
                  const img = cartLineImage(kind, c);
                  const label = `${c.name}${c.variantName ? ` · ${c.variantName}` : ""}`;
                  return (
                    <div
                      key={i}
                      title={`${label}${c.quantity > 1 ? ` ×${c.quantity}` : ""}`}
                      style={{
                        position: "relative",
                        flexShrink: 0, display: "flex", alignItems: "center", gap: "7px",
                        borderRadius: "10px", padding: "5px 22px 5px 5px",
                        background: C.accentSoft, border: `1px solid ${C.border}`,
                      }}
                    >
                      {/* 한 줄만 빼고 싶을 때 창을 열지 않아도 되게 한다. */}
                      <button
                        onClick={() => removeCartLine(kind, c)}
                        aria-label={`${label} 빼기`}
                        style={{
                          position: "absolute", top: 2, right: 2, width: 17, height: 17,
                          borderRadius: "999px", border: "none", cursor: "pointer", padding: 0,
                          background: C.card, color: C.label,
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}
                      >
                        <X size={11} />
                      </button>
                      <span
                        onClick={() => { if (img) setModalUrl(getGoogleDriveImageUrl(img)); }}
                        style={{
                          width: 34, height: 34, flexShrink: 0, borderRadius: "8px", overflow: "hidden",
                          background: C.cardSub, display: "flex", alignItems: "center", justifyContent: "center",
                          cursor: img ? "zoom-in" : "default",
                        }}
                      >
                        {img
                          ? <img src={getThumbImageUrl(img)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          : <Boxes size={15} style={{ color: C.label, opacity: 0.5 }} />}
                      </span>
                      <span style={{ maxWidth: "150px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "12px", fontWeight: 700, color: C.accentText }}>
                        {label}{c.quantity > 1 ? ` ×${c.quantity}` : ""}
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            <button
              onClick={() => setCartOpen(kind)}
              style={{
                flexShrink: 0, padding: "7px 14px", borderRadius: "9px", border: "none", cursor: "pointer",
                background: n > 0 ? C.accent : C.cardSub, color: n > 0 ? "#fff" : C.label,
                fontSize: "12.5px", fontWeight: 800,
              }}
            >
              열기
            </button>
            {/* 담은 걸 통째로 비운다. 열기 옆에 둔다 — 하나씩 빼려고 창을 여는 일이 잦았다. */}
            <button
              onClick={() => {
                if (n === 0) return;
                if (!window.confirm("담은 물품을 전부 비울까요?")) return;
                if (kind === "scenario") { setSciCart([]); setSidBorrowId(""); }
                else setTcCart([]);
              }}
              disabled={n === 0}
              style={{
                flexShrink: 0, padding: "7px 12px", borderRadius: "9px", cursor: n === 0 ? "default" : "pointer",
                border: `1px solid ${C.border}`, background: "transparent",
                color: n === 0 ? C.label : C.error, fontSize: "12.5px", fontWeight: 800,
                opacity: n === 0 ? 0.5 : 1,
              }}
            >
              전체 취소
            </button>
          </div>
        );
      })() : null}

      </div>

      <div style={{
        maxWidth: step === "scenario" || step === "tablecloth" ? "1560px" : step === "toolReturn" || step === "warehouse" ? "900px" : "620px",
        margin: "0 auto",
        // 물품 목록에서는 장바구니 바 바로 아래부터 필터 배경이 시작되어야 한다.
        // 공통 24px 상단 패딩이 남아 있으면 두 고정 영역 사이가 벌어진 것처럼 보인다.
        padding: step === "scenario" || step === "tablecloth"
          ? "0 16px 120px"
          : "24px 16px 120px",
      }}>

        {!adminDirectBorrow && purpose === "browse" && session && (step === "menu" || step === "scenarioKind") ? (
          <BorrowerSeatSuggestions scriptUrl={scriptUrl} connected={connected} isLightMode={isLightMode}
            employeeId={identEmp} floors={seatMap} seatsLoaded={seatMapLoaded}
            selectedFloor={selFloor} selectedUnit={selUnit}
            onSelect={(floor, unit) => {
              setSelFloor(floor); setSelUnit(unit);
              saveIdentity({ ...session, floor, unit });
              onSeatChange?.({ floor, unit });
            }} />
        ) : null}

        <UnattendedToolBorrowForm active={step === "warehouse" && !adminDirectBorrow && purpose === "browse"}
          enabled={!!unattendedEnabled} employeeId={identEmp} name={identName} floors={seatMap}
          floorsLoaded={seatMapLoaded} isLightMode={isLightMode} onSubmitted={() => void refreshMyTools()} />
        <UnattendedToolReturnForm active={step === "toolReturn" && !adminDirectBorrow && purpose === "browse"}
          enabled={!!unattendedEnabled} employeeId={identEmp} items={myTools} isLightMode={isLightMode} onRefresh={() => void refreshMyTools()} />
        {(step === "warehouse" || step === "toolReturn") && !unattendedEnabled && <p role="alert" style={{ color: C.error }}>무인 모드가 종료되었습니다. 현재 작성 내용은 유지되지만 직접 신청·반납할 수 없습니다.</p>}
        <div key={step} className={slideDir === "forward" ? "step-forward" : "step-back"}>
        {step === "identity" ? (
          <div>
            <div style={{ marginBottom: "20px", padding: "14px 16px", background: C.accentSoft, borderRadius: "12px", borderLeft: `4px solid ${C.accent}`, fontSize: "13px", lineHeight: 1.6 }}>
              {purpose === "mylookup"
                ? "내 대여 조회에는 소속과 성함이 필요합니다. 대여 시 입력한 것과 동일하게 입력해주세요."
                : "대여에는 소속과 성함이 필요합니다. 담아둔 장바구니는 대여 신청 시 같은 소속·성함으로 그대로 불러옵니다."}
            </div>
            <label style={labelStyle}>소속</label>
            <div style={{ display: "flex", gap: "10px", marginBottom: "16px" }}>
              <AffCard active={affiliation === "cfgw"} icon={<Building2 size={19} />} text="Cfgw-kr" onClick={() => setAffiliation("cfgw")} />
              <AffCard active={affiliation === "configds"} icon={<Building2 size={19} />} text="ConfigDS" onClick={() => setAffiliation("configds")} />
              <AffCard active={affiliation === "other"} icon={<MoreHorizontal size={19} />} text="기타" onClick={() => setAffiliation("other")} />
            </div>
            {affiliation !== "other" ? (
              <>
                <label style={labelStyle}>성함</label>
                <div style={{ position: "relative", marginBottom: "16px" }}>
                  <User size={16} style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
                  <input value={name} onChange={(e) => setName(e.target.value.replace(/[^\uAC00-\uD7A3\u3131-\u318E\s]/g, ""))} onKeyDown={(e) => { if (e.key === "Enter" && !(e.nativeEvent as any).isComposing) submitIdentity(); }} placeholder="성함을 입력해주세요" style={{ ...inputStyle, paddingLeft: "40px" }} />
                </div>
              </>
            ) : (
              <>
                <label style={labelStyle}>이름</label>
                <div style={{ position: "relative", marginBottom: "8px" }}>
                  <User size={16} style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
                  <input value={otherName} onChange={(e) => setOtherName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !(e.nativeEvent as any).isComposing) submitIdentity(); }} placeholder="성함을 입력해주세요" style={{ ...inputStyle, paddingLeft: "40px" }} />
                </div>
                <div style={{ fontSize: "12px", color: C.label, marginBottom: "16px", lineHeight: 1.5 }}>기타 소속은 성함만 입력합니다. (사번 입력 없음)</div>
              </>
            )}
            {affiliation === "cfgw" ? (
              <>
                <label style={labelStyle}>사번</label>
                <div style={{ position: "relative", marginBottom: "24px" }}>
                  <IdCard size={16} style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
                  <input value={empId} onChange={(e) => setEmpId(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => { if (e.key === "Enter" && !(e.nativeEvent as any).isComposing) submitIdentity(); }} placeholder="사번을 입력해주세요 (숫자만)" inputMode="numeric" style={{ ...inputStyle, paddingLeft: "40px" }} />
                </div>
              </>
            ) : <div style={{ height: "8px" }} />}

            {purpose === "browse" && affiliation === "cfgw" ? (
              <BorrowerSeatSuggestions scriptUrl={scriptUrl} connected={connected} isLightMode={isLightMode}
                employeeId={empId} floors={seatMap} seatsLoaded={seatMapLoaded}
                selectedFloor={selFloor} selectedUnit={selUnit}
                onSelect={(floor, unit) => { setSelFloor(floor); setSelUnit(unit); }} />
            ) : null}

            {/* 좌석 위치. 시나리오 물품은 층과 유닛이 모두 필요하고, 테이블보는 층만 쓴다.
                COS 물품은 쓰지 않지만, 분야를 고르기 전이라 여기서 한 번에 받는다.
                배치도를 못 불러와도 진행은 막지 않는다 — 층·유닛 없이 신청할 수 있다. */}
            <div style={{ marginBottom: "20px" }}>
              <label style={labelStyle}>좌석 위치 <span style={{ color: "#ef4444" }}>*</span></label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <select
                  value={selFloor}
                  onChange={(e) => { setSelFloor(e.target.value); setSelUnit(""); }}
                  disabled={!seatMapLoaded || seatMap.length === 0}
                  style={{ ...inputStyle, opacity: seatMapLoaded && seatMap.length ? 1 : 0.6 }}
                >
                  <option value="">층수 선택</option>
                  {seatMap.map((f) => <option key={f.id} value={f.name || f.id}>{f.name || f.id}</option>)}
                </select>
                <select
                  value={selUnit}
                  onChange={(e) => setSelUnit(e.target.value)}
                  disabled={!selFloor}
                  style={{ ...inputStyle, opacity: selFloor ? 1 : 0.6 }}
                >
                  <option value="">유닛 선택</option>
                  {seatUnits.map((u) => <option key={`${u.row}-${u.col}`} value={u.label}>{u.label}</option>)}
                </select>
              </div>
              <div style={{ fontSize: "12px", color: C.label, marginTop: "6px", lineHeight: 1.5 }}>
                {!seatMapLoaded
                  ? "좌석 배치도를 불러오는 중입니다..."
                  : seatMap.length === 0
                    ? "좌석 배치도를 불러오지 못했습니다. 층·유닛 없이 진행됩니다."
                    : "지금 계신 층과 유닛(자리)을 골라주세요. 테이블보는 층만 쓰입니다."}
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={onBack} style={secondaryBtn}>이전</button>
              <button onClick={submitIdentity} disabled={verifying} style={{ ...primaryBtn, opacity: verifying ? 0.7 : 1 }}>
                {verifying ? <><Spinner size={16} /> 확인 중...</> : <>계속하기 <ChevronRight size={15} /></>}
              </button>
            </div>
          </div>
        ) : null}

        {/* 물품 목록이 아직 안 왔으면 고르는 칸을 내보내지 않는다. 눌러도 반응이 없는 화면을
            보여주느니, 준비될 때까지 기다렸다가 한 번에 보여주는 편이 낫다. */}
        {canUseTools && (step === "menu" || step === "toolReturn") && toolsLoading && <p style={{ color: C.label, textAlign: "center" }}>공구 대여 내역 확인 중…</p>}
        {canUseTools && (step === "menu" || step === "toolReturn") && toolsError && <div role="alert" style={{ color: C.error, padding: 12 }}>{toolsError} <button onClick={() => void refreshMyTools()}>다시 확인</button></div>}

        {step === "menu" && !sciLoaded && !unattendedEnabled ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", padding: "64px 0", color: C.label }}>
            <Spinner size={30} />
            <div style={{ fontSize: "13px" }}>물품 목록을 준비하고 있습니다...</div>
          </div>
        ) : null}

        {step === "menu" && !toolsLoading && (sciLoaded || unattendedEnabled) ? (
          <div className="bp-grid-in" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {[
              ...(canUseTools && myTools.length ? [{ key: "toolReturn" as const, icon: <RotateCcw size={22} />, color: C.success, bg: C.successSoft, title: "공구 반납", sub: `대여 중인 공구 ${myTools.length}종을 선택하고 사진을 찍어 반납합니다` }] : []),
              ...(unattendedEnabled && !adminDirectBorrow && purpose === "browse" ? [{ key: "warehouse" as const, icon: <Warehouse size={22} />, color: C.success, bg: C.successSoft, title: "공구 대여", sub: "사용할 층과 물품 이름을 입력하고 사진을 찍어 신청합니다" }] : []),
              { key: "scenarioKind" as const, icon: <Boxes size={22} />, color: C.accentText, bg: C.accentSoft, title: "시나리오 물품 대여", sub: "SID 대여와 일반 대여 중 하나를 고른 뒤 물품을 담습니다" },
              { key: "tablecloth" as const, icon: <Layers size={22} />, color: C.warn, bg: C.warnSoft, title: "테이블보 대여", sub: "무늬와 보관 층으로 천을 찾아 장바구니에 담습니다" },
              // 테이블보만 반납이 여기에 있다 — 담당자를 거치지 않고 본인이 직접 돌려놓기 때문에,
              // 빌리는 자리 바로 아래가 반납을 찾는 사람에게 가장 자연스러운 위치다.
              { key: "tcreturn" as const, icon: <Check size={22} />, color: C.warn, bg: C.warnSoft, title: "테이블보 반납", sub: "내가 빌린 천을 직접 반납합니다 · 담당자 확인 없음" },
            ].map((m) => (
              <div
                key={m.key}
                onClick={() => { if (m.key === "tcreturn") onGoTableclothReturn?.(); else setStep(m.key); }}
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

        {/* ── 시나리오 대여 방식 고르기 ──
            SID 대여는 "이 시나리오에 필요한 물품"이 정해져 있어 목록을 훑을 필요가 없다.
            일반 대여는 필요한 것을 직접 찾아 담는다. 담기는 장바구니를 같이 쓴다 —
            두 방식으로 담은 것이 한 번에 신청된다. */}
        {step === "scenarioKind" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {openingScenario ? (
              <div style={{ minHeight: "260px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "14px", color: C.label }}>
                <Spinner size={30} />
                <div style={{ fontSize: "14px", fontWeight: 700 }}>물품 목록을 준비하고 있습니다...</div>
                <div style={{ fontSize: "12px" }}>잠시 후 선택 화면이 열립니다.</div>
              </div>
            ) : <>{[
              { key: "sid" as const, icon: <Fingerprint size={22} />, color: C.accentText, bg: C.accentSoft, title: "SID 대여", sub: "시나리오 ID를 넣으면 필요한 물품이 사진·재고와 함께 나옵니다" },
              { key: "scenario" as const, icon: <Boxes size={22} />, color: C.success, bg: C.successSoft, title: "일반 대여", sub: "전체 시나리오 물품을 직접 찾아 담습니다" },
            ].map((m) => (
              <div
                key={m.key}
                onClick={() => m.key === "scenario" ? openGeneralBrowse() : setStep(m.key)}
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
            {sciCartCount > 0 ? (
              <div style={{ marginTop: "4px", padding: "12px 14px", background: C.accentSoft, borderRadius: "12px", fontSize: "12.5px", color: C.text, lineHeight: 1.6 }}>
                이미 <b>{sciCartCount}개</b>를 담아두었습니다. 두 방식으로 담은 물품은 한 장바구니에 모여 함께 신청됩니다.
              </div>
            ) : null}</>}
          </div>
        ) : null}

        {step === "scenario" ? (
          <ItemGrid C={C} Spinner={Spinner} loaded={sciLoaded} loading={sciLoading} count={sciFiltered.length} total={sciItems.length} error={sciErr} onRetry={() => { setSciErr(""); loadScenario(); }} stickyTop={stickyHeaderHeight + stickyStatusHeight}
            notice={sciAi ? <div role="status" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", marginBottom: 14, borderRadius: 10, background: sciAi.error ? C.warnSoft : C.accentSoft, color: C.text, fontSize: 13, lineHeight: 1.6 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{sciAi.busy ? "AI로 관련 물품을 찾고 있습니다…" : sciAi.error ? "일반 검색을 계속 사용할 수 있습니다" : `${sciAi.result?.mode === "ai" ? "AI" : "이름·유사어"} 검색 결과 · 관련도순`}</strong>
                <div style={{ fontSize: 12 }}>{sciAi.error || (sciAi.busy ? "기존 장바구니와 입력 내용은 유지됩니다." : `${sciAi.result?.message} 현재 선택한 필터가 적용됩니다.`)}</div>
              </div>
              <button type="button" onClick={clearScenarioAi} style={{ border: 0, background: "transparent", color: C.accent, cursor: "pointer", fontSize: 12, fontWeight: 800, whiteSpace: "nowrap" }}>{sciAi.busy ? "검색 취소" : "일반 검색으로"}</button>
            </div> : sciSearch.trim() ? <div role="status" style={{ fontSize: 12, color: C.label, marginBottom: 14, lineHeight: 1.6 }}>일반 검색 · 이름·ID{hideLocation ? "" : "·위치"} 일치순 · AI 검색은 버튼을 누를 때만 사용합니다.</div> : null}
            filterRow={
              <>
                <button type="button" onClick={() => setSciFiltersOpen((v) => !v)} style={{ ...inputStyle, width: "auto", padding: "10px 14px", display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "13px", fontWeight: 800, color: C.accentText, borderColor: sciFiltersOpen || sciCat || sciSub || sciSort !== "id_desc" ? C.accent : C.border, background: sciFiltersOpen || sciCat || sciSub || sciSort !== "id_desc" ? C.accentSoft : C.card, whiteSpace: "nowrap" }}>
                  <SlidersHorizontal size={15} /> 필터{sciFiltersOpen ? " 접기" : ""}
                </button>
                <div style={{ position: "relative", flex: "2 1 260px", minWidth: 0, display: "flex", border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden", background: C.card }}>
                  <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
                  <input aria-label="시나리오 물품 검색" maxLength={150} value={sciSearch} onChange={(e) => { clearScenarioAi(); setSciSearch(e.target.value); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); clearScenarioAi(); } }} placeholder={hideLocation ? "ID · 물품명으로 검색..." : "ID · 물품명 · 위치로 검색..."} style={{ ...inputStyle, border: 0, borderRadius: 0, flex: 1, minWidth: 0, padding: "11px 12px 11px 36px", fontSize: "14px" }} />
                  <button type="button" onClick={() => void runScenarioAi()} disabled={!sciSearch.trim() || !!sciAi?.busy || !connected || (!identEmp && !isAdmin)} title="선택사항: 이름이 다르거나 비슷한 물품을 찾을 때 사용하세요" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 12px", border: 0, borderLeft: `1px solid ${C.border}`, background: C.card, color: C.accent, fontSize: 13, fontWeight: 800, whiteSpace: "nowrap", cursor: "pointer", opacity: !sciSearch.trim() || sciAi?.busy || !connected || (!identEmp && !isAdmin) ? .5 : 1 }}><Sparkles size={15} /> {sciAi?.busy ? "검색 중…" : "AI 검색"}</button>
                </div>
                <div aria-label="물품 구분" style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "42px", padding: "0 12px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.card, whiteSpace: "nowrap" }}>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer", color: sciRequestFilter !== "normal" ? C.accentText : C.label, fontSize: "12.5px", fontWeight: 800 }}>
                    <input type="checkbox" checked={sciRequestFilter === "all"} onChange={(e) => setSciRequestFilter(e.target.checked ? "all" : "normal")} style={{ width: 15, height: 15, margin: 0, accentColor: C.accent }} />
                    Request 물품 포함
                  </label>
                </div>
              </>
            }
            sidebar={sciFiltersOpen ? (
              <div style={{ padding: "16px 16px 18px", borderRadius: "14px", border: `1px solid ${C.border}`, background: C.card, boxShadow: "0 4px 14px rgba(15,23,42,0.05)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "15px" }}>
                  <strong style={{ fontSize: "15px" }}>필터</strong>
                  {(sciCat || sciSub || sciSort !== "id_desc") ? <button type="button" onClick={() => { setSciCat(""); setSciSub(""); setSciSort("id_desc"); }} style={{ padding: 0, border: 0, background: "transparent", color: C.accentText, cursor: "pointer", fontSize: "11px", fontWeight: 800 }}>초기화</button> : null}
                </div>
                <SidebarSection title="정렬" C={C}>
                  {([
                    ["id_desc", "ID 내림차순"], ["id_asc", "ID 오름차순"], ["location_desc", "위치 내림차순"], ["location_asc", "위치 오름차순"], ["name_asc", "이름순"],
                  ] as const).filter(([value]) => !(hideLocation && value.startsWith("location"))).map(([value, text]) => <label key={value} style={{ display: "flex", alignItems: "center", gap: "7px", padding: "5px 7px", cursor: "pointer", color: effectiveSciSort === value ? C.accentText : C.text, fontSize: "12px", fontWeight: effectiveSciSort === value ? 800 : 600 }}><input type="radio" name="scenario-sort" value={value} checked={effectiveSciSort === value} onChange={() => setSciSort(value)} style={{ margin: 0, accentColor: C.accent }} />{text}</label>)}
                </SidebarSection>
                <SidebarSection title="카테고리" C={C} last>
                  <SidebarLink active={!sciCat} onClick={() => { setSciCat(""); setSciSub(""); }} C={C}>전체</SidebarLink>
                  {sciCats.map((category) => (
                    <React.Fragment key={category}>
                      <SidebarLink active={sciCat === category} onClick={() => { setSciCat(category); setSciSub(""); }} C={C}>{category}</SidebarLink>
                      {sciCat === category && sciSubs.length ? (
                        <div style={{ margin: "2px 0 5px 10px", paddingLeft: "7px", borderLeft: `2px solid ${C.border}`, display: "flex", flexDirection: "column", gap: "1px" }}>
                          {sciSubs.map((subcategory) => <SidebarLink key={subcategory} active={sciSub === subcategory} onClick={() => setSciSub(subcategory)} C={C} nested>{subcategory}</SidebarLink>)}
                        </div>
                      ) : null}
                    </React.Fragment>
                  ))}
                </SidebarSection>
              </div>
            ) : null}
          >
            {sciFiltered.map((it) => {
              const myLines = sciCart.filter((c) => c.id === it.id);
              const inCart = myLines.length ? { quantity: myLines.reduce((n, c) => n + c.quantity, 0) } : undefined;
              const out = (it.stock || 0) < 1;
              return (
                <GridCard key={it.id} C={C} inCart={!!inCart} out={out} image={it.image} onImage={() => it.image && setModalUrl(getGoogleDriveImageUrl(it.image))}
                  title={it.name} idText={`ID: ${it.id}`}
                  badges={<>
                    {it.category ? <Chip C={C} text={it.category} tone="accent" /> : null}
                    {/* 특정 업체 request용 / 개인 물품인지는 담기 전에 알아야 한다 —
                        대여 신청 화면에는 이미 뜨는데 열람에는 없어서 여기서만 모르고 담게 됐다.
                        (빈 문자열도 "request 물품"이라는 뜻이라 undefined 여부로 가른다) */}
                    {it.requestFor !== undefined ? (
                      <span
                        title={`특정 업체 request용${it.requestFor ? `: ${it.requestFor}` : ""}`}
                        style={{ fontSize: "10px", fontWeight: 800, borderRadius: "6px", padding: "2px 7px", color: C.accentText, background: C.accentSoft }}
                      >
                        📌 {it.requestFor || "Request"}
                      </span>
                    ) : null}
                    {it.personalOwner !== undefined ? (
                      <span
                        title={`개인 물품${it.personalOwner ? `: ${it.personalOwner}` : ""}`}
                        style={{ fontSize: "10px", fontWeight: 800, borderRadius: "6px", padding: "2px 7px", color: C.accentText, background: C.accentSoft }}
                      >
                        👤 {it.personalOwner || "개인"}
                      </span>
                    ) : null}
                  </>}
                  stock={it.stock || 0} rented={it.rented || 0}
                  // 물품 자체에 치수가 없어도 종류에 치수가 있으면 볼 수 있어야 한다.
                  onSize={hasDims(it) || (it.variants || []).some((v) => hasDims(v)) ? () => setSizeItem(it) : undefined}
                  qty={inCart?.quantity}
                  onAdd={() => addSci(it)}
                  onBorrowers={() => setBorrowersTarget({ id: it.id, name: it.name, category: "scenario" })}
                  onMinus={() => chgSci(sciCart.findIndex((c) => c.id === it.id), -1)}
                  onPlus={() => (it.variants?.length ? setVariantPick(it) : chgSci(sciCart.findIndex((c) => c.id === it.id), 1))}
                />
              );
            })}
          </ItemGrid>
        ) : null}

        {step === "sid" ? (
          <div style={{ maxWidth: "820px", margin: "0 auto" }}>
            <div style={{ display: "flex", gap: "8px", marginBottom: "16px", alignItems: "stretch" }}>
              <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
                <Fingerprint size={16} style={{ position: "absolute", left: "13px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
                <input
                  value={sidInput}
                  onChange={(e) => setSidInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") runSidLookup(); }}
                  placeholder="시나리오 ID를 입력하세요 (예: S0001)"
                  style={{ ...inputStyle, width: "100%", boxSizing: "border-box", paddingLeft: "40px" }}
                />
              </div>
              <button
                onClick={runSidLookup}
                disabled={sidLoading}
                style={{ padding: "12px 22px", borderRadius: "12px", border: "none", background: C.accent, color: "#fff", cursor: sidLoading ? "wait" : "pointer", fontSize: "14px", fontWeight: 800, whiteSpace: "nowrap" }}
              >
                {sidLoading ? "조회 중..." : "조회"}
              </button>
            </div>

            {!sidResult ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px", padding: "64px 20px", color: C.label, fontSize: "13.5px", lineHeight: 1.7, textAlign: "center" }}>
                <Fingerprint size={38} style={{ opacity: 0.3 }} />
                <div>시나리오 ID를 입력하면<br />필요한 물품과 보관 위치를 보여드립니다.</div>
              </div>
            ) : !sidResult.found ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", padding: "56px 20px", color: C.label, fontSize: "13.5px", textAlign: "center" }}>
                <Fingerprint size={34} style={{ opacity: 0.3 }} />
                <div>'{sidResult.sid}' 시나리오를 찾지 못했습니다.</div>
              </div>
            ) : (
              <div>
                <div style={{ padding: "14px 16px", borderRadius: "12px", background: C.card, border: `1px solid ${C.border}`, marginBottom: "12px" }}>
                  <div style={{ fontSize: "15px", fontWeight: 800, color: C.text, marginBottom: "4px" }}>{sidResult.sid}</div>
                  {sidResult.highLevelKo || sidResult.highLevelEn ? (
                    <div style={{ fontSize: "12.5px", color: C.label, lineHeight: 1.6 }}>
                      {sidResult.highLevelKo || sidResult.highLevelEn}
                    </div>
                  ) : null}
                  {sidResult.blocked ? (
                    <div style={{ marginTop: "8px", fontSize: "12px", fontWeight: 700, color: C.error }}>
                      ⚠ {sidResult.blockReason || "대여가 제한된 시나리오입니다."}
                    </div>
                  ) : null}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                  <span style={{ fontSize: "12px", color: C.label, flex: 1 }}>
                    필요 물품 {sidResult.items.length}종
                  </span>
                  {/* 열람 메뉴에서 들어온 경우에만 담을 수 있다. 랜딩의 "SID 열람"으로 바로
                      들어온 사람은 신원을 넣지 않았으므로 보기만 한다. */}
                  {initialStep !== "sid" && !sidResult.blocked ? (
                    <button
                      onClick={() => addAllSidItems(sidResult.items as any)}
                      style={{ padding: "8px 14px", borderRadius: "9px", border: "none", background: C.accent, color: "#fff", fontSize: "12.5px", fontWeight: 800, cursor: "pointer" }}
                    >
                      필요 물품 전부 담기
                    </button>
                  ) : null}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "10px" }}>
                  {sidResult.items.map((it: any, i: number) => {
                    // ID 표기(앞 0 유무)가 달라도 찾도록 6자리로 맞춰 비교한다
                    const wantId = padSlot(String(it.id || "").trim());
                    const obj = sciItems.find((o) => padSlot(String(o.id || "").trim()) === wantId);
                    return (
                      <div key={`${it.id}-${i}`} style={{ border: `1px solid ${C.border}`, borderRadius: "14px", background: C.card, padding: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
                        <div
                          onClick={() => { if (obj?.image) setModalUrl(getGoogleDriveImageUrl(obj.image)); }}
                          style={{ height: "104px", borderRadius: "10px", overflow: "hidden", background: C.cardSub, display: "flex", alignItems: "center", justifyContent: "center", cursor: obj?.image ? "pointer" : "default" }}
                        >
                          {obj?.image
                            ? <img src={getThumbImageUrl(obj.image)} alt="" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                            : <Boxes size={26} style={{ color: C.label, opacity: 0.45 }} />}
                        </div>
                        <div title={it.name} style={{ fontSize: "13px", fontWeight: 800, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</div>
                        <div style={{ fontSize: "10.5px", color: C.label, fontFamily: "monospace" }}>{it.id}</div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "11px" }}>
                          <span style={{ fontFamily: "monospace", fontWeight: 700, color: C.warn }}>
                            {hideLocation ? "🔒 무인 PC에서 확인" : `📍 ${obj?.rootSlot || (sciLoading ? "조회 중..." : (it.rootSlot || "위치 없음"))}`}
                          </span>
                          <span style={{ fontWeight: 800, color: C.accentText }}>x{it.quantity || 1}</span>
                        </div>
                        {/* 재고는 SID 정의가 아니라 실제 물품에서 읽는다 — 필요 수량만큼
                            남아 있는지가 여기서 바로 보여야 한다. */}
                        {initialStep !== "sid" ? (() => {
                          const stock = obj?.stock ?? null;
                          const need = Number(it.quantity) || 1;
                          const inCart = sciCart.find((c) => padSlot(String(c.id)) === wantId);
                          const short = stock !== null && stock < need;
                          return (
                            <>
                              <div style={{ fontSize: "11px", fontWeight: 700, color: stock === null ? C.label : short ? C.error : C.success }}>
                                {stock === null ? (sciLoading ? "재고 조회 중..." : "재고 정보 없음") : short ? `재고 ${stock} · ${need}개 필요` : `재고 ${stock}`}
                              </div>
                              <button
                                onClick={() => { if (!obj) return; const r = addSidItem(it as any); if (r === "nostock") showToast("재고가 없어 담을 수 없습니다.", "warn"); }}
                                disabled={!obj || sidResult.blocked || stock === 0}
                                style={{
                                  padding: "7px 10px", borderRadius: "8px", border: "none", fontSize: "12px", fontWeight: 800,
                                  cursor: !obj || sidResult.blocked || stock === 0 ? "not-allowed" : "pointer",
                                  background: inCart ? C.accentSoft : C.accent,
                                  color: inCart ? C.accentText : "#fff",
                                  opacity: !obj || sidResult.blocked || stock === 0 ? 0.45 : 1,
                                }}
                              >
                                {inCart ? `담김 ${inCart.quantity}개` : "담기"}
                              </button>
                            </>
                          );
                        })() : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : null}

        {/* ── 테이블보 대여 ──
            천은 이름이 번호뿐이라 사진 없이는 무엇인지 알 수 없다. 그래서 목록을 큼직한
            사진 격자로 두고, 무늬(대분류)와 보관 층으로 좁혀 찾게 한다.
            수량 개념이 없다 — 한 장씩 담고 다시 누르면 뺀다. */}
        {step === "tablecloth" ? (
          <ItemGrid
            C={C} Spinner={Spinner} loaded={tcLoaded} loading={tcLoading}
            count={tcFiltered.length} total={tcItems.length}
            error={tcErr} onRetry={() => { setTcErr(""); loadTablecloth(); }}
            stickyTop={stickyHeaderHeight + stickyStatusHeight}
            filterRow={
              <>
                <div style={{ position: "relative", flex: "2 1 240px", minWidth: 0 }}>
                  <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
                  <input value={tcSearch} onChange={(e) => setTcSearch(e.target.value)} placeholder="번호로 검색 (예: 7, TC-0007)" style={{ ...inputStyle, paddingLeft: "36px", padding: "11px 12px 11px 36px", fontSize: "14px" }} />
                </div>
                <select value={tcCat} onChange={(e) => setTcCat(e.target.value)} style={{ ...inputStyle, flex: "1 1 160px", padding: "11px 12px", fontSize: "14px" }}>
                  <option value="">무늬 전체</option>
                  {tcCats.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
                {/* 층 필터 — 검색줄 아래에 한 줄로 편다(flexBasis 100%가 줄을 바꾼다).
                    지금 보고 있는 층이 무엇인지가 고를 때마다 눈에 남아야 한다. */}
                <div style={{ flexBasis: "100%", display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontSize: "12px", fontWeight: 800, color: C.label, marginRight: "2px" }}>층</span>
                  <button
                    onClick={() => setTcLoc("")}
                    style={{
                      padding: "7px 13px", borderRadius: "9px", cursor: "pointer", fontSize: "12.5px", fontWeight: 800,
                      border: `1px solid ${tcLoc === "" ? C.accent : C.border}`,
                      background: tcLoc === "" ? C.accentSoft : "transparent",
                      color: tcLoc === "" ? C.text : C.label,
                    }}
                  >
                    전체 층
                  </button>
                  {tcLocations.map((l) => {
                    const on = tcLoc === l.key;
                    const mine = locationKey(selFloor) === l.key;
                    return (
                      <button
                        key={l.key}
                        onClick={() => setTcLoc(on ? "" : l.key)}
                        style={{
                          padding: "7px 13px", borderRadius: "9px", cursor: "pointer", fontSize: "12.5px", fontWeight: 800,
                          border: `1px solid ${on ? C.accent : C.border}`,
                          background: on ? C.accentSoft : "transparent",
                          color: on ? C.text : C.label,
                        }}
                      >
                        {mine ? "★ " : ""}{l.label} {l.count}
                      </button>
                    );
                  })}
                </div>
              </>
            }
          >
            {tcFiltered.map((it) => {
              const picked = tcCart.some((c) => c.id === it.id);
              const left = (Number(it.stock) || 0) - (Number(it.rented) || 0);
              const soldOut = left <= 0;
              return (
                <div
                  key={it.id}
                  onClick={() => {
                    if (soldOut && !picked) setBorrowersTarget({ id: String(it.id), name: it.name, category: "tablecloth" });
                    else toggleTc(it);
                  }}
                  style={{
                    background: C.card, borderRadius: "14px", overflow: "hidden",
                    border: `1.5px solid ${picked ? C.accent : C.border}`,
                    cursor: "pointer",
                    opacity: soldOut && !picked ? 0.5 : 1,
                    display: "flex", flexDirection: "column",
                  }}
                >
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      if (soldOut) setBorrowersTarget({ id: String(it.id), name: it.name, category: "tablecloth" });
                      else if (it.image) setModalUrl(getGoogleDriveImageUrl(it.image));
                    }}
                    style={{ height: "150px", background: C.cardSub, display: "flex", alignItems: "center", justifyContent: "center", cursor: soldOut ? "pointer" : it.image ? "zoom-in" : "default" }}
                  >
                    {it.image
                      ? <img src={getThumbImageUrl(it.image)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      : <Layers size={34} style={{ color: C.border }} />}
                  </div>
                  <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: "6px", flex: 1 }}>
                    <div style={{ fontSize: "13.5px", fontWeight: 800, color: C.text }}>{it.name}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                      {it.category ? <span style={{ fontSize: "10px", fontWeight: 700, padding: "2px 7px", borderRadius: "6px", background: C.accentSoft, color: C.accentText }}>{tcCatLabel(it.category)}</span> : null}
                      {it.location ? <span style={{ fontSize: "10px", fontWeight: 700, padding: "2px 7px", borderRadius: "6px", background: C.cardSub, color: C.label }}>{it.location}</span> : null}
                    </div>
                    {soldOut && (tcOut[String(it.id)] || []).length ? (
                      <div style={{ fontSize: "10.5px", lineHeight: 1.5, color: C.error, background: C.errorSoft, borderRadius: "7px", padding: "5px 7px" }}>
                        {(tcOut[String(it.id)] || []).map((b, i) => (
                          <div key={i}>
                            {b.borrowerName || "(이름 없음)"}
                            {b.floor || b.unit ? ` · ${[b.floor, b.unit].filter(Boolean).join(" ")}` : ""}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "11px", fontWeight: 700, color: soldOut ? C.error : C.success }}>
                        {soldOut ? "전부 대여 중" : `남은 수량 ${left}`}
                      </span>
                      <span style={{ flex: 1 }} />
                      {soldOut ? <button type="button" onClick={(event) => { event.stopPropagation(); setBorrowersTarget({ id: String(it.id), name: it.name, category: "tablecloth" }); }} style={{ border: `1px solid ${C.border}`, borderRadius: "7px", padding: "5px 7px", background: C.cardSub, color: C.text, fontSize: "11px", fontWeight: 700, cursor: "pointer" }}>대여자 확인</button>
                        : <span style={{ fontSize: "12px", fontWeight: 800, color: picked ? C.accentText : C.label }}>{picked ? "담김 ✓" : "담기 +"}</span>}
                    </div>
                    {soldOut ? <div style={{ fontSize: "11px", lineHeight: 1.5, color: C.label }}>눌러서 현재 대여자를 확인하세요</div> : null}
                  </div>
                </div>
              );
            })}
          </ItemGrid>
        ) : null}

        {step === "mylookup" ? (
          <div>
            {myLoading || !myResult ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", padding: "64px 0", color: C.label }}><Spinner size={30} /> 대여 내역을 불러오는 중입니다...</div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                  <span style={{ fontSize: "14px", fontWeight: 700 }}>{identName}님이 대여 중인 물품</span>
                  <button onClick={runMyLookup} style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", color: C.accentText, background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}><RotateCcw size={12} /> 새로고침</button>
                </div>
                {myResult.scenario.length === 0 && myResult.general.length === 0 && myResult.warehouse.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "48px 0", color: C.label }}><Check size={36} style={{ color: C.border, marginBottom: "8px" }} /><div>현재 대여 중인 물품이 없습니다.</div></div>
                ) : (
                  <>
                    {myResult.scenario.length ? (
                      <>
                        <div style={{ fontSize: "12px", fontWeight: 700, color: C.accentText, margin: "12px 0 8px" }}>시나리오 물품 (SID 대여)</div>
                        {myResult.scenario.map((item: any, i: number) => (
                          <MyRow key={`s${i}`} C={C} icon={<Fingerprint size={17} />} tone="accent" label={item.itemLabel} sub={`대여일: ${item.borrowDate || "-"}${item.scenarioId ? ` · ${item.scenarioId}` : ""}`} image={item.image} onImage={() => item.image && setModalUrl(getGoogleDriveImageUrl(item.image))} onDetails={() => setDetailItem(item)} />
                        ))}
                      </>
                    ) : null}
                    {myResult.general.length ? (
                      <>
                        <div style={{ fontSize: "12px", fontWeight: 700, color: C.accentText, margin: "16px 0 8px" }}>일반 대여</div>
                        {myResult.general.map((item: any, i: number) => (
                          <MyRow key={`g${i}`} C={C} icon={<Boxes size={17} />} tone="accent" label={item.itemLabel} sub={`대여일: ${item.borrowDate || "-"}${item.generalOption ? ` · ${item.generalOption}` : ""}`} image={item.image} onImage={() => item.image && setModalUrl(getGoogleDriveImageUrl(item.image))} onDetails={() => setDetailItem(item)} />
                        ))}
                      </>
                    ) : null}
                    {myResult.warehouse.length ? (
                      <>
                        <div style={{ fontSize: "12px", fontWeight: 700, color: C.success, margin: "16px 0 8px" }}>COS 물품</div>
                        {myResult.warehouse.map((item: any, i: number) => (
                          <MyRow key={`w${i}`} C={C} icon={<Warehouse size={17} />} tone="success" label={item.itemLabel} sub={`대여일: ${item.borrowDate || "-"}`} image={item.image} onImage={() => item.image && setModalUrl(getGoogleDriveImageUrl(item.image))} onDetails={() => setDetailItem(item)} />
                        ))}
                      </>
                    ) : null}
                  </>
                )}
              </>
            )}
          </div>
        ) : null}
        </div>
      </div>



      {/* 일반 물품 목록은 처음에 사진·필터·재고를 함께 그려 브라우저가 잠깐 바쁠 수 있다.
          이 시간에는 이미 목록 뒤에 들어와 있고, 흐린 오버레이만 3초 보인다. */}
      {openingScenario && step === "scenario" ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,23,42,0.24)", backdropFilter: "blur(5px)", WebkitBackdropFilter: "blur(5px)" }}>
          <div style={{ minWidth: "220px", padding: "24px 28px", borderRadius: "18px", background: C.card, border: `1px solid ${C.border}`, boxShadow: "0 18px 48px rgba(0,0,0,0.28)", display: "flex", flexDirection: "column", alignItems: "center", gap: "13px", color: C.text }}>
            <Spinner size={32} />
            <div style={{ fontSize: "15px", fontWeight: 800 }}>물품 목록을 준비하고 있습니다</div>
            <div style={{ fontSize: "12px", color: C.label }}>사진과 재고 정보를 불러오는 중입니다.</div>
          </div>
        </div>
      ) : null}

      {/* 다음 단계로 넘어가는 단추. 예전에는 장바구니 창을 열어야만 보였다 —
          담고 나서 무엇을 눌러야 할지 몰라 창을 여닫는 일이 잦았다.
          화면 오른쪽 아래에 띄워 늘 보이게 한다. 담은 게 없으면 나타나지 않는다. */}
      {(step === "scenario" || step === "tablecloth" || (step === "sid" && initialStep !== "sid")) ? (() => {
        const kind: Kind = step === "tablecloth" ? "tablecloth" : "scenario";
        const n = kind === "scenario" ? sciCartCount : tcCartCount;
        if (n === 0) return null;
        return (
          <div style={{ position: "fixed", right: "20px", bottom: "20px", zIndex: 45, display: "flex", alignItems: "center", gap: "10px" }}>
          {step === "sid" && sidResult ? (
            <button onClick={() => { setSidAddingExtra(true); openGeneralBrowse(); }} style={{ display: "flex", alignItems: "center", gap: "7px", padding: "15px 18px", borderRadius: "999px", border: `1px solid ${C.accent}`, background: C.card, color: C.accent, fontSize: "14px", fontWeight: 800, cursor: "pointer", boxShadow: "0 8px 22px rgba(0,0,0,0.15)" }}>
              <Plus size={18} />추가 물품 담기
            </button>
          ) : null}
          <button
            onClick={() => {
              if (remoteReadonly) { showToast("원격 읽기 전용 테스트 모드에서는 대여 신청을 실행할 수 없습니다.", "info"); return; }
              if (kind === "tablecloth") { setTcConfirmOpen(true); return; }
              onGoBorrow({ identity: { name: identName, employeeId: identEmp, affiliation }, kind, seat: { floor: selFloor, unit: selUnit }, sid: sidBorrowId, additionalItems: sidBorrowId ? sidAdditionalItems : undefined, items: sciCart });
            }}
            disabled={remoteReadonly}
            style={{
              display: "flex", alignItems: "center", gap: "8px",
              padding: "15px 24px", borderRadius: "999px", border: "none",
              background: C.accent, color: "#fff", fontSize: "15px", fontWeight: 800,
              opacity: remoteReadonly ? 0.55 : 1, cursor: remoteReadonly ? "not-allowed" : "pointer",
              boxShadow: "0 10px 28px rgba(37, 99, 235, 0.45)",
            }}
          >
            <HandHelping size={18} />
            {remoteReadonly ? "읽기 전용 테스트" : "대여 신청하기"}
            <span style={{
              minWidth: 24, background: "#fff", color: C.accent, borderRadius: "999px",
              padding: "2px 9px", fontSize: "13px", fontWeight: 800, textAlign: "center",
            }}>{n}</span>
          </button>
          </div>
        );
      })() : null}

      {cartOpen ? (
        <div onClick={() => setCartOpen(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 50, display: "flex", justifyContent: "flex-end" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(420px, 100%)", background: C.card, borderLeft: `1px solid ${C.border}`, display: "flex", flexDirection: "column", height: "100%" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "18px 20px", borderBottom: `1px solid ${C.border}` }}>
              <ShoppingCart size={18} style={{ color: C.accentText }} />
              <h2 style={{ flex: 1, fontSize: "16px", fontWeight: 800, margin: 0 }}>
                {cartOpen === "scenario" ? "시나리오" : "테이블보"} 장바구니 ({cartOpen === "scenario" ? sciCartCount : tcCartCount}{cartOpen === "tablecloth" ? "장" : "개"})
              </h2>
              <button onClick={() => setCartOpen(null)} style={{ background: "none", border: "none", color: C.label, cursor: "pointer" }}><X size={20} /></button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
              {cartOpen === "tablecloth" ? (
                tcCart.length === 0 ? <EmptyCart C={C} /> : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {tcCart.map((c) => (
                      <div key={c.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 10px", borderRadius: "10px", border: `1px solid ${C.border}` }}>
                        <span style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 8, overflow: "hidden", background: C.cardSub, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {c.image ? <img src={getThumbImageUrl(c.image)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Layers size={18} style={{ color: C.border }} />}
                        </span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: "block", fontSize: "13px", fontWeight: 800, color: C.text }}>{c.name}</span>
                          {c.location ? <span style={{ display: "block", fontSize: "11px", color: C.label }}>{c.location}</span> : null}
                        </span>
                        <button
                          onClick={() => setTcCart((prev) => prev.filter((x) => x.id !== c.id))}
                          style={{ background: "none", border: "none", color: C.label, cursor: "pointer", flexShrink: 0 }}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                )
              ) : null}
              {cartOpen === "scenario" ? (
                sciCart.length === 0 ? <EmptyCart C={C} /> : sciCart.map((item, idx) => (
                  <CartRow
                    key={cartKey(item)}
                    C={C}
                    name={item.name}
                    variant={item.variantName}
                    sub={`ID: ${item.id}`}
                    qty={item.quantity}
                    onMinus={() => chgSci(idx, -1)}
                    onPlus={() => chgSci(idx, 1)}
                    onRemove={() => setSciCart(sciCart.filter((_, i) => i !== idx))}
                  />
                ))
              ) : null}
            </div>
            <div style={{ padding: "16px 20px", borderTop: `1px solid ${C.border}`, display: "flex", gap: "10px" }}>
              {(() => {
                const lines: any[] = cartOpen === "scenario" ? sciCart : tcCart;
                const clear = () => (cartOpen === "scenario" ? setSciCart([]) : setTcCart([]));
                const empty = lines.length === 0;
                return (
                  <>
                    <button onClick={clear} disabled={empty} style={{ ...secondaryBtn, flex: "0 0 auto", padding: "14px 16px", opacity: empty ? 0.5 : 1 }}><Trash2 size={15} /></button>
                    <button
                      onClick={() => {
                        if (remoteReadonly) { showToast("원격 읽기 전용 테스트 모드에서는 대여 신청을 실행할 수 없습니다.", "info"); return; }
                        if (cartOpen === "tablecloth") { setCartOpen(null); setTcConfirmOpen(true); return; }
                        onGoBorrow({ identity: { name: identName, employeeId: identEmp, affiliation }, kind: cartOpen, seat: { floor: selFloor, unit: selUnit }, sid: sidBorrowId, additionalItems: sidBorrowId ? sidAdditionalItems : undefined, items: sciCart });
                      }}
                      disabled={empty || remoteReadonly}
                      style={{ ...primaryBtn, opacity: empty || remoteReadonly ? 0.5 : 1 }}
                    >
                      <HandHelping size={15} /> {remoteReadonly ? "읽기 전용 테스트" : "대여 신청하기"}
                    </button>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      ) : null}

      {tcConfirmOpen ? (
        <div
          onClick={() => { if (!tcSubmitting) setTcConfirmOpen(false); }}
          style={{ position: "fixed", inset: 0, zIndex: 3300, background: "rgba(15,23,42,0.5)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(620px, 100%)", maxHeight: "min(760px, 92vh)", overflow: "hidden", background: C.card, border: `1px solid ${C.border}`, borderRadius: "20px", boxShadow: "0 24px 70px rgba(0,0,0,0.3)", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "22px 24px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "flex-start", gap: "12px" }}>
              <div style={{ flex: 1 }}>
                <h2 style={{ margin: 0, fontSize: "20px", color: C.text }}>테이블보 대여 확인</h2>
                <div style={{ marginTop: "7px", fontSize: "13px", color: C.label }}>{identName} · {selFloor} {selUnit} · 총 {tcCart.length}장</div>
              </div>
              <button onClick={() => setTcConfirmOpen(false)} disabled={tcSubmitting} style={{ border: "none", background: "none", color: C.label, cursor: "pointer", padding: 2 }}><X size={21} /></button>
            </div>
            <div style={{ padding: "18px 24px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "10px" }}>
                {tcCart.map((item) => (
                  <div key={item.id} style={{ border: `1px solid ${C.border}`, borderRadius: "12px", overflow: "hidden", background: C.cardSub }}>
                    <div style={{ height: 105, background: C.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {item.image ? <img src={getThumbImageUrl(item.image)} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Layers size={24} style={{ color: C.border }} />}
                    </div>
                    <div style={{ padding: "9px 10px" }}>
                      <div style={{ color: C.text, fontSize: "13px", fontWeight: 800 }}>{item.name}</div>
                      {item.location ? <div style={{ color: C.label, fontSize: "11px", marginTop: 3 }}>{item.location}</div> : null}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ padding: "11px 13px", borderRadius: "10px", background: C.warnSoft, color: C.text, fontSize: "12px", lineHeight: 1.55 }}>담당자 승인 없이 바로 대여 처리됩니다. 사용 후 테이블보 반납에서 직접 반납해주세요.</div>
            </div>
            <div style={{ padding: "16px 24px 22px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button onClick={() => setTcConfirmOpen(false)} disabled={tcSubmitting} style={{ ...secondaryBtn, padding: "12px 18px" }}>취소</button>
              <button onClick={submitTableclothBorrow} disabled={tcSubmitting || tcCart.length === 0} style={{ ...primaryBtn, padding: "12px 19px", opacity: tcSubmitting ? 0.6 : 1 }}>
                {tcSubmitting ? <><Spinner size={15} /> 처리 중...</> : <><HandHelping size={15} /> 대여 확정</>}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 시나리오 물품을 고르기 시작할 때 한 번 뜨는 안내. */}
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
                ⚠ 무단 사용 금지
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

      {/* 주의가 필요한 물품을 담을 때. 확인을 누르면 그대로 담고, 바깥을 누르면 담지 않는다. */}
      {hazardAsk ? (
        <HazardConfirmModal
          items={hazardAsk.items}
          C={C as any}
          onConfirm={() => { const run = hazardAsk.onConfirm; setHazardAsk(null); run(); }}
        />
      ) : null}

      {/* 종수 한도를 넘기게 될 때. 숫자를 보여주고 어떻게 할지 정하게 한다. */}
      {limitAsk ? (
        <div
          onClick={() => setLimitAsk(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "16px" }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(400px, 100%)", background: C.card, border: `1.5px solid ${C.border}`, borderRadius: "16px", padding: "24px", textAlign: "center" }}>
            <div style={{ fontSize: "16px", fontWeight: 800, color: C.error, marginBottom: "10px" }}>빌릴 수 있는 종수를 넘습니다</div>
            <div style={{ fontSize: "13px", color: C.text, lineHeight: 1.8, marginBottom: "6px" }}>
              지금 대여 중 <b>{limitAsk.current}종</b> · 담은 것 <b>{limitAsk.adding}종</b><br />
              합치면 <b style={{ color: C.error }}>{limitAsk.current + limitAsk.adding}종</b>으로 한도 <b>{limitAsk.max}종</b>을 넘습니다.
            </div>
            <div style={{ fontSize: "12px", color: C.label, lineHeight: 1.6, marginBottom: "18px" }}>
              쓰지 않는 물품을 먼저 반납하거나, 담은 것을 덜어내주세요.
            </div>
            <button
              onClick={() => setLimitAsk(null)}
              style={{ width: "100%", padding: "12px", borderRadius: "10px", border: "none", background: C.accent, color: "#fff", fontSize: "13.5px", fontWeight: 800, cursor: "pointer" }}
            >
              알겠습니다
            </button>
          </div>
        </div>
      ) : null}

      {/* 종류 선택 — 종류가 나뉜 물품을 담을 때만 뜬다.
          여기서 고른 종류가 장바구니에 그대로 저장돼 대여 화면까지 이어진다. */}
      {variantPick ? (
        <div
          onClick={() => { setVariantPick(null); setVariantQueue([]); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "16px" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: "16px", padding: "18px", width: "min(420px, 100%)", maxHeight: "80vh", overflowY: "auto" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "2px" }}>
              <div style={{ flex: 1, fontSize: "15px", fontWeight: 800, color: C.text }}>어떤 종류를 담으시나요?</div>
              {/* 이어서 물어볼 물품이 남아 있으면 몇 개가 남았는지 알려준다. */}
              {variantQueue.length > 0 ? (
                <span style={{ fontSize: "11.5px", fontWeight: 800, color: C.accentText, background: C.accentSoft, borderRadius: "999px", padding: "3px 9px" }}>
                  {variantQueue.length}개 더 남음
                </span>
              ) : null}
            </div>
            <div style={{ fontSize: "12px", color: C.label, marginBottom: "10px" }}>{variantPick.name}</div>
            {variantQueue.length > 0 ? (
              <button
                onClick={advanceVariantQueue}
                style={{ marginBottom: "12px", padding: "7px 12px", borderRadius: "9px", border: `1px solid ${C.border}`, background: "transparent", color: C.label, fontSize: "12px", fontWeight: 700, cursor: "pointer" }}
              >
                이건 건너뛰기
              </button>
            ) : null}

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {(variantPick.variants || []).map((v) => {
                const taken = sciCart
                  .filter((c) => c.id === variantPick.id && c.variantId === v.id)
                  .reduce((n, c) => n + c.quantity, 0);
                const out = v.stock <= 0;
                return (
                  <button
                    key={v.id}
                    onClick={() => {
                      if (out) { setBorrowersTarget({ id: variantPick.id, name: `${variantPick.name} · ${v.name}`, category: "scenario", variantId: v.id }); return; }
                      addSciLine(variantPick, { variantId: v.id, variantName: v.name }, v.stock); advanceVariantQueue();
                    }}
                    style={{
                      display: "flex", alignItems: "center", gap: "12px", padding: "10px 12px",
                      borderRadius: "11px", border: `1.5px solid ${C.border}`, background: C.cardSub,
                      color: out ? C.label : C.text, cursor: "pointer",
                      fontSize: "13px", fontWeight: 700, textAlign: "left", opacity: out ? 0.55 : 1,
                    }}
                  >
                    <span
                      onClick={(e) => { if (!out && v.image) { e.stopPropagation(); setModalUrl(getGoogleDriveImageUrl(v.image)); } }}
                      style={{ width: "48px", height: "48px", flexShrink: 0, borderRadius: "9px", overflow: "hidden", background: C.card, display: "flex", alignItems: "center", justifyContent: "center", cursor: v.image ? "zoom-in" : "default" }}
                    >
                      {v.image
                        ? <img src={getThumbImageUrl(v.image)} alt="" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                        : <Boxes size={18} style={{ color: C.label, opacity: 0.45 }} />}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block" }}>{v.name}{taken ? ` · 담김 ${taken}개` : ""}</span>
                      <span style={{ display: "block", fontSize: "11.5px", color: C.label, fontWeight: 600, marginTop: "2px" }}>
                        {out ? "재고 없음" : `재고 ${v.stock}개`}
                      </span>
                      {out ? <span style={{ display: "block", fontSize: "11px", lineHeight: 1.5, color: C.label, fontWeight: 500, marginTop: "3px" }}>눌러서 현재 대여자를 확인하세요</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => setVariantPick(null)}
              style={{ marginTop: "14px", width: "100%", padding: "11px", borderRadius: "10px", border: `1px solid ${C.border}`, background: "none", color: C.label, cursor: "pointer", fontSize: "12.5px", fontWeight: 700 }}
            >
              닫기
            </button>
          </div>
        </div>
      ) : null}

      <SizeViewerModal open={!!sizeItem} onClose={() => setSizeItem(null)} item={sizeItem} variants={sizeItem?.variants} C={C} />

      <ReadonlyObjectDetailsModal item={detailItem} onClose={() => setDetailItem(null)} onImage={(url) => setModalUrl(getGoogleDriveImageUrl(url))} C={C} />


      <ImageZoomModal url={modalUrl} onClose={() => setModalUrl("")} />
      {borrowersTarget ? <ItemBorrowersModal key={`${borrowersTarget.category}:${borrowersTarget.id}:${borrowersTarget.variantId ?? ""}`} target={borrowersTarget} scriptUrl={connected ? scriptUrl : ""} C={C} onClose={closeBorrowers} /> : null}

    </div>
  );
}

function Chip({ C, icon, text, tone }: { C: any; icon?: React.ReactNode; text: string; tone: "warn" | "accent" }) {
  const color = tone === "warn" ? C.warn : C.accentText;
  const bg = tone === "warn" ? C.warnSoft : C.accentSoft;
  return <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "10px", fontWeight: 700, color, background: bg, borderRadius: "6px", padding: "2px 7px", fontFamily: icon ? "monospace" : "inherit" }}>{icon}{text}</span>;
}

function SidebarSection({ title, C, children, last = false }: { title: string; C: any; children: React.ReactNode; last?: boolean }) {
  return (
    <section style={{ paddingBottom: last ? 0 : "13px", marginBottom: last ? 0 : "13px", borderBottom: last ? "none" : `1px solid ${C.border}` }}>
      <h3 style={{ margin: "0 0 7px", fontSize: "13px", fontWeight: 900 }}>{title}</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>{children}</div>
    </section>
  );
}

function SidebarLink({ active, onClick, C, children, nested = false }: { active: boolean; onClick: () => void; C: any; children: React.ReactNode; nested?: boolean }) {
  return (
    <button type="button" onClick={onClick} style={{
      width: "100%", padding: nested ? "4px 8px" : "5px 8px", border: 0, borderRadius: "7px", background: active ? C.accentSoft : "transparent",
      color: active ? C.accentText : nested ? C.label : C.text, cursor: "pointer", textAlign: "left", fontSize: nested ? "11.5px" : "12px", fontWeight: active ? 850 : nested ? 600 : 650,
    }}>
      {children}
    </button>
  );
}

function ItemGrid({ C, Spinner, loaded, loading, count, total, filterRow, sidebar, children, error, onRetry, stickyTop, notice }: any) {
  const [showManual, setShowManual] = React.useState(false);
  React.useEffect(() => {
    // 로딩도 아니고 로드도 안 된 어정쩡한 상태가 6초 이상 지속되면 수동 버튼 노출 (무한로딩 안전장치)
    if (!loaded && !loading && !error) {
      const t = setTimeout(() => setShowManual(true), 6000);
      return () => clearTimeout(t);
    }
    setShowManual(false);
  }, [loaded, loading, error]);
  return (
    <div>
      {/* boxShadow로 배경을 위쪽으로 연장해, 헤더와 검색행 사이로 카드가 비쳐 보이던 틈을 덮는다 */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap", position: "sticky", top: stickyTop ?? 0, zIndex: 16, background: C.bg, padding: "8px 0", boxShadow: `0 -16px 0 0 ${C.bg}` }}>{filterRow}</div>
      <div style={{ fontSize: "12px", color: C.label, marginBottom: "12px" }}>{loaded && !error ? `${count} / ${total}개 물품` : ""}</div>
      {notice}
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", padding: "64px 0", color: C.label }}><Spinner size={30} /> 물품을 불러오는 중입니다...</div>
      ) : error ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "14px", padding: "56px 16px", color: C.label, textAlign: "center" }}>
          <div style={{ fontSize: "14px", color: C.text, fontWeight: 700 }}>물품을 불러오지 못했습니다.</div>
          <div style={{ fontSize: "12px", maxWidth: "320px", lineHeight: 1.5 }}>{String(error)}</div>
          {onRetry ? <button onClick={onRetry} style={{ padding: "10px 20px", borderRadius: "10px", border: "none", background: C.accent, color: "#fff", cursor: "pointer", fontSize: "13px", fontWeight: 700 }}>다시 시도</button> : null}
        </div>
      ) : !loaded ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "14px", padding: "56px 0", color: C.label }}>
          <Spinner size={30} /> 물품을 불러오는 중입니다...
          {showManual && onRetry ? (
            <button onClick={onRetry} style={{ padding: "10px 20px", borderRadius: "10px", border: `1px solid ${C.border}`, background: "transparent", color: C.text, cursor: "pointer", fontSize: "13px", fontWeight: 700 }}>불러오기가 지연됩니다. 수동으로 다시 불러오기</button>
          ) : null}
        </div>
      ) : count === 0 ? (
        <div style={{ textAlign: "center", padding: "64px 0", color: C.label }}>검색 결과가 없습니다.</div>
      ) : (
        <div className="bsp-item-layout">
          {sidebar ? <aside className="bsp-filter-sidebar" style={{ position: "sticky", top: (stickyTop ?? 0) + 72, maxHeight: `calc(100vh - ${(stickyTop ?? 0) + 88}px)`, overflowY: "auto" }}>{sidebar}</aside> : null}
          <div className="bsp-item-results">
            <div className="bp-grid-in" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "16px" }}>{children}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function GridCard({ C, inCart, out, image, onImage, title, idText, badges, stock, rented, qty, onAdd, onMinus, onPlus, onSize, onBorrowers }: any) {
  return (
    <div onClick={out ? onBorrowers : undefined} style={{
      border: `1px solid ${inCart ? C.accent : C.border}`, background: C.card, borderRadius: "16px", overflow: "hidden", display: "flex", flexDirection: "column",
      boxShadow: inCart ? "0 8px 20px -8px rgba(37, 99, 235,0.4)" : "0 2px 4px rgba(0,0,0,0.04)", transition: "all 0.2s", opacity: out ? 0.6 : 1,
      // 수백 개 카드 중 화면 밖의 카드는 실제로 스크롤될 때만 레이아웃·페인트한다.
      // 첫 진입 후 오버레이가 사라질 때의 짧은 멈춤을 없애는 핵심 최적화다.
      contentVisibility: "auto", containIntrinsicSize: "0 360px", cursor: out ? "pointer" : undefined,
    }}>
      <div onClick={(event) => { event.stopPropagation(); if (out) onBorrowers?.(); else onImage?.(); }} style={{ height: "150px", background: C.cardSub, display: "flex", alignItems: "center", justifyContent: "center", cursor: out ? "pointer" : image ? "zoom-in" : "default", borderBottom: `1px solid ${C.border}` }}>
        {image ? <img className="bp-img-in" src={getThumbImageUrl(image)} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Boxes size={40} style={{ color: C.border }} />}
      </div>
      <div style={{ padding: "12px 14px", flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
        <div style={{ fontWeight: 700, fontSize: "14px", lineHeight: 1.35, wordBreak: "break-word" }}>{title}</div>
        <div style={{ fontSize: "11px", color: C.label }}>{idText}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>{badges}</div>
        <div style={{ display: "flex", gap: "6px", fontSize: "11px", fontWeight: 600 }}>
          <span style={{ color: C.success, background: C.successSoft, padding: "2px 8px", borderRadius: "6px" }}>재고 {stock}</span>
          {rented !== null ? <span style={{ color: C.accentText, background: C.accentSoft, padding: "2px 8px", borderRadius: "6px" }}>대여 중 {rented}</span> : null}
          {onSize ? (
            <button
              onClick={(e) => { e.stopPropagation(); onSize(); }}
              title="실측 크기를 육면체로 보고 돌려봅니다"
              style={{ fontSize: "10px", fontWeight: 800, borderRadius: "6px", padding: "2px 7px", border: `1px solid ${C.border}`, background: "transparent", color: C.label, cursor: "pointer" }}
            >
              📐 실제 크기 보기
            </button>
          ) : null}
        </div>
        <div style={{ marginTop: "auto", paddingTop: "8px" }}>
          {qty !== undefined ? (
            <div onClick={(event) => event.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: "8px", justifyContent: "center", background: C.accentSoft, borderRadius: "10px", padding: "6px" }}>
              <button onClick={onMinus} style={{ width: 28, height: 28, borderRadius: "8px", border: "none", background: C.card, color: C.text, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Minus size={13} /></button>
              <span style={{ fontWeight: 800, minWidth: "22px", textAlign: "center", color: C.accentText }}>{qty}</span>
              <button onClick={onPlus} style={{ width: 28, height: 28, borderRadius: "8px", border: "none", background: C.card, color: C.text, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={13} /></button>
            </div>
          ) : (
            <button type="button" onClick={(event) => { event.stopPropagation(); if (out) onBorrowers?.(); else onAdd(); }} style={{ width: "100%", padding: "9px", borderRadius: "10px", border: out ? `1px solid ${C.border}` : "none", background: out ? C.cardSub : C.accent, color: out ? C.text : "#fff", cursor: "pointer", fontSize: "13px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
              {out ? <User size={14} /> : <ShoppingCart size={14} />} {out ? "현재 대여자 확인" : "장바구니 담기"}
            </button>
          )}
          {out ? <div style={{ marginTop: "6px", fontSize: "11px", lineHeight: 1.5, color: C.label, textAlign: "center" }}>눌러서 현재 대여자를 확인하세요</div> : null}
        </div>
      </div>
    </div>
  );
}

function VariantChip({ C, text }: any) {
  return (
    <span style={{
      flexShrink: 0, fontSize: "10.5px", fontWeight: 700, lineHeight: 1.5,
      padding: "1px 7px", borderRadius: "999px",
      background: C.accentSoft, color: C.accentText, border: `1px solid ${C.accent}33`,
      whiteSpace: "nowrap",
    }}>{text}</span>
  );
}

function CartRow({ C, name, variant, sub, qty, onMinus, onPlus, onRemove }: any) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", background: C.cardSub, border: `1px solid ${C.border}`, borderRadius: "10px", marginBottom: "8px" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "5px", minWidth: 0 }}>
          <span style={{ fontWeight: 700, fontSize: "13px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
          {/* 종류는 물품명이 아니라 선택한 옵션이라, 칩으로 따로 떼어 보여준다 */}
          {variant ? <VariantChip C={C} text={variant} /> : null}
        </div>
        <div style={{ fontSize: "11px", color: C.label }}>{sub}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
        <button onClick={onMinus} style={{ width: 26, height: 26, borderRadius: "7px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Minus size={12} /></button>
        <span style={{ fontWeight: 700, minWidth: "18px", textAlign: "center", fontSize: "13px" }}>{qty}</span>
        <button onClick={onPlus} style={{ width: 26, height: 26, borderRadius: "7px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={12} /></button>
      </div>
      <button onClick={onRemove} style={{ width: 26, height: 26, borderRadius: "7px", border: "none", background: C.errorSoft, color: C.error, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><X size={12} /></button>
    </div>
  );
}

function EmptyCart({ C }: { C: any }) {
  return <div style={{ textAlign: "center", color: C.label, fontSize: "13px", padding: "48px 0" }}><ShoppingCart size={32} style={{ color: C.border, marginBottom: "8px" }} /><div>장바구니가 비어 있습니다.</div></div>;
}

function ReadonlyObjectDetailsModal({ item, onClose, onImage, C }: { item: any; onClose: () => void; onImage: (url: string) => void; C: any }) {
  useEffect(() => {
    if (!item) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item, onClose]);

  if (!item) return null;
  const details = item.details || {};
  const measured = hasDims(details);
  const shape = (details.shape || "box") as keyof typeof SHAPE_LABEL;
  const propertyLabels: Record<string, string> = {
    Soft: "Soft · 부드러움", Hard: "Hard · 단단함",
    Deformable: "Deformable · 변형 가능", Fragile: "Fragile · 파손 주의",
  };
  const value = (v: any) => String(v ?? "").trim() || "미등록";
  const fields = [
    ["크기", value(details.size)],
    ["속성", propertyLabels[details.property] || value(details.property)],
    ["카테고리", value(details.category)],
    ["서브 카테고리", value(details.subcategory)],
    ["현재 재고", `${Number(details.stock) || 0}개`],
    ...(details.variantName ? [["선택된 종류", details.variantName]] : []),
  ];

  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 1250, padding: "20px", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(8,15,28,0.68)", backdropFilter: "blur(4px)" }}>
      <div role="dialog" aria-modal="true" aria-label="물품 상세 정보" style={{ width: "min(760px, 100%)", maxHeight: "min(820px, 92vh)", overflowY: "auto", borderRadius: "20px", border: `1px solid ${C.border}`, background: C.card, color: C.text, boxShadow: "0 24px 70px rgba(0,0,0,0.28)" }}>
        <div style={{ position: "sticky", top: 0, zIndex: 2, display: "flex", alignItems: "center", gap: "12px", padding: "16px 18px", borderBottom: `1px solid ${C.border}`, background: C.card }}>
          {item.image ? (
            <button onClick={() => onImage(item.image)} title="사진 크게 보기" style={{ width: 48, height: 48, flexShrink: 0, padding: 0, overflow: "hidden", borderRadius: "11px", border: `1px solid ${C.border}`, background: C.cardSub, cursor: "zoom-in" }}>
              <img src={getThumbImageUrl(item.image)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </button>
          ) : <div style={{ width: 48, height: 48, flexShrink: 0, borderRadius: "11px", display: "flex", alignItems: "center", justifyContent: "center", background: C.cardSub }}><Boxes size={21} color={C.label} /></div>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "16px", lineHeight: 1.35, fontWeight: 900, overflowWrap: "anywhere" }}>{item.itemLabel || item.name || "물품 상세 정보"}</div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 5, padding: "3px 8px", borderRadius: 999, background: C.accentSoft, color: C.accentText, fontSize: 10.5, fontWeight: 800 }}>읽기 전용</div>
          </div>
          <button onClick={onClose} aria-label="닫기" style={{ width: 34, height: 34, borderRadius: 9, border: `1px solid ${C.border}`, background: C.cardSub, color: C.label, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={17} /></button>
        </div>

        <div style={{ padding: "18px", display: "grid", gridTemplateColumns: measured ? "repeat(auto-fit, minmax(min(100%, 280px), 1fr))" : "1fr", gap: "18px" }}>
          <section>
            <h3 style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 900 }}>등록 정보</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
              {fields.map(([label, fieldValue]) => (
                <div key={label} style={{ minHeight: 58, padding: "10px 11px", border: `1px solid ${C.border}`, borderRadius: 11, background: C.cardSub }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: C.label }}>{label}</div>
                  <div style={{ marginTop: 5, fontSize: 12.5, fontWeight: 800, overflowWrap: "anywhere" }}>{fieldValue}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, padding: "11px 12px", borderRadius: 11, background: measured ? C.successSoft : C.cardSub, border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: C.label }}>실측 크기</div>
              <div style={{ marginTop: 5, fontSize: 13, fontWeight: 900 }}>{measured ? dimsLabel(details) : "미등록"}</div>
              {measured ? <div style={{ marginTop: 3, fontSize: 10.5, color: C.label }}>가로 × 세로 × 높이 · {SHAPE_LABEL[shape] || "육면체"}</div> : null}
            </div>
          </section>

          {measured ? (
            <section style={{ minWidth: 0 }}>
              <h3 style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 900 }}>실측 기반 3D 모델</h3>
              <div style={{ overflow: "hidden", borderRadius: 14, border: `1px solid ${C.border}`, background: "rgba(0,0,0,0.22)" }}>
                <BoxCanvas widthMm={details.widthMm} depthMm={details.depthMm} heightMm={details.heightMm} shape={shape} height={330} accent={C.accent} />
              </div>
              <div style={{ marginTop: 8, fontSize: 10.5, lineHeight: 1.55, color: C.label }}>등록된 치수를 바탕으로 만든 단순화된 모형입니다. 실제 물품의 세부 모양은 사진을 확인해주세요.</div>
            </section>
          ) : (
            <div style={{ padding: "18px", borderRadius: 13, border: `1px dashed ${C.border}`, color: C.label, fontSize: 12, lineHeight: 1.6 }}>실측 가로·세로·높이가 모두 등록되면 이곳에 3D 모델이 표시됩니다.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function MyRow({ C, icon, tone, label, sub, image, onImage, onDetails }: any) {
  const color = tone === "success" ? C.success : C.accentText;
  const bg = tone === "success" ? C.successSoft : C.accentSoft;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "13px", border: `1px solid ${C.border}`, borderRadius: "12px", marginBottom: "8px", background: C.card }}>
      <div
        onClick={image ? onImage : undefined}
        style={{ flex: "0 0 40px", width: 40, height: 40, borderRadius: "10px", overflow: "hidden", background: bg, color, display: "flex", alignItems: "center", justifyContent: "center", cursor: image ? "zoom-in" : "default" }}
      >
        {image ? <img src={getThumbImageUrl(image)} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: "13px", wordBreak: "break-word" }}>{label}</div>
        <div style={{ fontSize: "11px", color: C.label, marginTop: "2px" }}>{sub}</div>
      </div>
      <button onClick={onDetails} style={{ display: "inline-flex", alignItems: "center", gap: "5px", flexShrink: 0, padding: "7px 10px", borderRadius: "8px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.accentText, cursor: "pointer", fontSize: "11px", fontWeight: 800 }}>
        <Info size={12} /> 상세 정보
      </button>
    </div>
  );
}
