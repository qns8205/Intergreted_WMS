import React, { useState, useMemo, useEffect, useRef } from "react";
import { InventoryItem, RentLog, DefectLog, Rack, WmsUser } from "../types";
import {
  ArrowLeft,
  Search,
  X,
  Package,
  Sun,
  Moon,
  Minus,
  Plus,
  MapPin,
  ChevronRight,
  ChevronDown,
  Check,
  ImageOff,
  User,
  Clock,
  AlertTriangle,
  ClipboardList,
  Camera,
  Upload,
  Trash2,
  Pencil,
  RotateCcw,
} from "lucide-react";
import { getGoogleDriveImageUrl, isFuzzyMatch, formatTimestampLocal, resizeAndCompressImage, parseLocation } from "../utils/drive";
import { smartMatch } from "../utils/search";
import { parseDateString, compareDatesDescending } from "../utils/date";
import {
  compareRackSlot, ScenarioObjectAdmin, fetchScenarioObjectsForAdmin,
  addScenarioObject, updateScenarioObject, deleteScenarioObject, padSlot,
} from "../utils/borrowApi";

interface MobileViewPageProps {
  inventory: InventoryItem[];
  rentLogs: RentLog[];
  defectLogs?: DefectLog[];
  robotObjects?: any[];
  racks?: Rack[];
  isAdmin?: boolean;
  onOpenScenario?: () => void;
  currentUser?: WmsUser | null;
  onAddRentLog: (log: RentLog) => Promise<void>;
  onAddDefectLog?: (log: Omit<DefectLog, "rowIndex">) => Promise<void>;
  onSaveInventoryItem?: (item: Omit<InventoryItem, "rowIndex"> & { rowIndex?: number }) => Promise<void>;
  onDeleteInventory?: (rowIndex: number) => Promise<void>;
  onBack: () => void;
  isLightMode: boolean;
  toggleLightMode: () => void;
  connected: boolean;
  scriptUrl?: string;
  currentView?: "landing" | "login" | "rental" | "monitor" | "defect" | "rent";
  // 캐시 무시하고 시트를 다시 읽는 강제 새로고침 (공구 및 부품류 = App.tsx의 inventory와 공유)
  onRefreshInventory?: () => void;
  inventoryRefreshing?: boolean;
}

type Mode = "대여" | "반납" | "등록" | "불량" | "시나리오";
type SheetMode = "detail" | "form" | "edit-inventory" | null;

interface OutstandingRental {
  key: string;
  name: string;
  location: string;
  user: string;
  qty: number;
  lastTimestamp: string;
}

/**
 * 모바일 전용 "열람용 모드" 화면.
 * PC 화면을 그대로 축소한 것이 아니라, 맨 위의 [대여]/[반납] 두 버튼으로 모드를 고른 뒤
 * - 대여: 전체 품목을 검색/열람하며 바로 대여
 * - 반납: 지금까지 대여했지만 아직 반납되지 않은 물품만 모아서 보여주고 바로 반납
 * 흐름에만 집중한 터치 친화적 UI. 불량로그, 랙 위치도(모니터링)는 노출하지 않는다.
 */
export default function MobileViewPage({
  inventory,
  rentLogs,
  defectLogs = [],
  robotObjects = [],
  racks = [],
  isAdmin = false,
  onOpenScenario,
  currentUser = null,
  onAddRentLog,
  onAddDefectLog,
  onSaveInventoryItem,
  onDeleteInventory,
  onBack,
  isLightMode,
  toggleLightMode,
  connected,
  scriptUrl = "",
  currentView = "monitor",
  onRefreshInventory,
  inventoryRefreshing = false,
}: MobileViewPageProps) {
  const [mode, setMode] = useState<Mode>(isAdmin ? "등록" : "대여");
  const [searchQuery, setSearchQuery] = useState("");

  // 탭 전환 슬라이딩 방향 추적 (대여→반납→등록→불량 순서)
  const TAB_ORDER: Record<string, number> = { "등록": 0, "시나리오": 1, "대여": 2, "반납": 2, "불량": 3 };
  const prevTabOrderRef = useRef(TAB_ORDER[mode] ?? 0);
  const tabSlideDirRef = useRef<"forward" | "back">("forward");
  const curTabOrder = TAB_ORDER[mode] ?? 0;
  if (curTabOrder !== prevTabOrderRef.current) {
    tabSlideDirRef.current = curTabOrder >= prevTabOrderRef.current ? "forward" : "back";
    prevTabOrderRef.current = curTabOrder;
  }
  const tabSlideDir = tabSlideDirRef.current;

  // 스와이프로 탭 이동 (관리자: 등록 → 시나리오 → 대여/반납 → 불량)
  const mainRef = useRef<HTMLElement | null>(null);
  const swipeRef = useRef<{ x: number; y: number; t: number } | null>(null);

  // 관리자 탭 순서 (사이드/상단 탭과 동일) — 관리자는 대여/반납 없이 물품 관리부터 시작한다
  const swipeTabs: Mode[] = isAdmin
    ? (["등록", "시나리오", "불량"] as Mode[])
    : (["대여", "반납"] as Mode[]);

  function goTab(delta: number) {
    const cur = swipeTabs.indexOf(mode as Mode);
    if (cur === -1) return;
    const next = cur + delta;
    if (next < 0 || next >= swipeTabs.length) return;
    setMode(swipeTabs[next]);
  }

  function onSwipeStart(e: React.TouchEvent) {
    const t = e.touches[0];
    swipeRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  }

  function onSwipeEnd(e: React.TouchEvent) {
    const start = swipeRef.current;
    swipeRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    // 가로 이동이 충분히 크고, 세로 스크롤보다 확실히 우세할 때만 탭을 넘긴다
    if (Math.abs(dx) < 70) return;
    if (Math.abs(dx) < Math.abs(dy) * 1.6) return;
    if (Date.now() - start.t > 800) return;
    goTab(dx < 0 ? 1 : -1); // 왼쪽으로 밀면 다음 탭
  }

  // 탭이 바뀌면 목록을 맨 위에서 시작한다 (이전 탭의 스크롤 위치가 남지 않도록)
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [mode]);

  // 화면에 처음 들어올 때 페이지가 살짝 내려가 있는 경우가 있어 맨 위로 맞춘다.
  // (직전 화면의 스크롤 위치가 남거나, 모바일 주소창 높이 변화로 어긋나는 경우)
  useEffect(() => {
    window.scrollTo(0, 0);
    mainRef.current?.scrollTo({ top: 0 });
    // 레이아웃이 잡힌 뒤 한 번 더 (이미지·폰트 로딩으로 높이가 바뀌는 경우 대비)
    const t = window.setTimeout(() => {
      window.scrollTo(0, 0);
      mainRef.current?.scrollTo({ top: 0 });
    }, 80);
    return () => window.clearTimeout(t);
  }, []);

  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [outstandingContext, setOutstandingContext] = useState<OutstandingRental | null>(null);
  const [sheetMode, setSheetMode] = useState<SheetMode>(null);

  // 대여 / 반납 일반 폼 상태
  const [formUser, setFormUser] = useState("");
  const [formQty, setFormQty] = useState(1);
  const [formNote, setFormNote] = useState("");
  const [formDueDate, setFormDueDate] = useState("");
  const [customBorrowName, setCustomBorrowName] = useState("");
  const [customBorrowLoc, setCustomBorrowLoc] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Current logged in user name or default
  const defaultManagerName = currentUser ? (currentUser.name || currentUser.id) : "관리자";

  // --- 모바일 품목 등록(등록 탭) 폼 상태 ---
  const [regName, setRegName] = useState("");
  const [regRackId, setRegRackId] = useState(racks[0]?.id || "");
  const [regShelf, setRegShelf] = useState("");
  const [regCustomLocation, setRegCustomLocation] = useState("");
  const [regIsCustomLoc, setRegIsCustomLoc] = useState(false);
  const [regSpec, setRegSpec] = useState("");
  const [regStock, setRegStock] = useState<string>("0");
  const [regManager, setRegManager] = useState(defaultManagerName);
  const [regNote, setRegNote] = useState("");
  const [regKeywords, setRegKeywords] = useState("");
  const [regPhoto, setRegPhoto] = useState("");
  const [regLink, setRegLink] = useState("N/A");
  const [regSubmitting, setRegSubmitting] = useState(false);

  // --- 모바일 불량(불량 탭) 폼 상태 ---
  const [defectTab, setDefectTab] = useState<"list" | "register">("list");

  // 서브 탭(목록 보기 / 새 물품 등록)을 스크롤해도 고정한다.
  // <main>이 자체 스크롤 컨테이너이므로 top: 0이면 main 상단에 붙는다.
  // 좌우 -14px 마진으로 패딩을 상쇄해 폭 전체를 덮고, boxShadow로 배경을 위쪽으로 연장해
  // main의 상단 패딩(14px) 사이로 내용이 비쳐 보이던 빈 공간을 없앤다.
  const subTabBarStyle: React.CSSProperties = {
    position: "sticky",
    top: 0,
    zIndex: 18,
    margin: "0 -14px",
    padding: "0 14px 10px",
    background: isLightMode ? "#f8fafc" : "#0b0f19",
    boxShadow: `0 -14px 0 0 ${isLightMode ? "#f8fafc" : "#0b0f19"}`,
  };
  // 불량 등록: 품목 검색 목록 열림 여부 (PC DefectLogsPage와 동일한 실시간 검색 방식)
  const [defListOpen, setDefListOpen] = useState(true);
  // 파손자 (로봇/시나리오 오브젝트일 때만 기록)
  const [defCulprit, setDefCulprit] = useState("");
  const [warehouseTab, setWarehouseTab] = useState<"list" | "register">("list");

  // --- 공구 및 부품류 목록: PC RackGroupedView와 동일한 랙 내비게이터 + 슬롯 그룹 + 검색 스크롤/하이라이트 ---
  const [whExpandedRack, setWhExpandedRack] = useState<string | null>(null);
  const [whCollapsed, setWhCollapsed] = useState<Record<string, boolean>>({});
  const [whHighlightKey, setWhHighlightKey] = useState<string | null>(null);
  const whGroupRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const whHighlightTimerRef = useRef<number | null>(null);

  /* ---------- 시나리오 물품 탭 (공구 및 부품류 탭과 동일한 구조) ---------- */
  const [scenarioTab, setScenarioTab] = useState<"list" | "register">("list");
  const [sciItems, setSciItems] = useState<ScenarioObjectAdmin[]>([]);
  const [sciLoading, setSciLoading] = useState(false);
  const [sciLoaded, setSciLoaded] = useState(false);
  // 등록/수정 폼 (editing이 있으면 수정, 없으면 신규)
  const emptySciForm = { rowIndex: 0, id: "", name: "", sector: "", rootSlot: "", category: "", subcategory: "", image: "", stock: 0, rented: 0, excludeFromRanking: false };
  const [sciForm, setSciForm] = useState<ScenarioObjectAdmin>(emptySciForm as ScenarioObjectAdmin);

  // 카테고리/서브카테고리 드롭다운 옵션 (PC ScenarioAdminPage와 동일한 규칙)
  const sciCategories = useMemo(() => {
    const set = new Set<string>();
    sciItems.forEach((it) => { if (it.category) set.add(it.category); });
    return Array.from(set).sort();
  }, [sciItems]);
  const sciSectors = useMemo(() => {
    const set = new Set<string>();
    sciItems.forEach((it) => { if (it.sector) set.add(it.sector); });
    return Array.from(set).sort();
  }, [sciItems]);
  const sciAllSubcategories = useMemo(() => {
    const set = new Set<string>();
    sciItems.forEach((it) => { if (it.subcategory) set.add(it.subcategory); });
    return Array.from(set).sort();
  }, [sciItems]);
  const sciSubcategoriesForCategory = useMemo(() => {
    const cat = sciForm.category?.trim();
    if (!cat) return sciAllSubcategories;
    const set = new Set<string>();
    sciItems.forEach((it) => { if (it.category === cat && it.subcategory) set.add(it.subcategory); });
    const scoped = Array.from(set).sort();
    return scoped.length > 0 ? scoped : sciAllSubcategories;
  }, [sciItems, sciForm.category, sciAllSubcategories]);
  const [sciCatCustom, setSciCatCustom] = useState(false);
  const [sciSectorCustom, setSciSectorCustom] = useState(false);
  const [sciSubcatCustom, setSciSubcatCustom] = useState(false);
  const [sciEditing, setSciEditing] = useState(false);
  const [sciSaving, setSciSaving] = useState(false);
  const [sciUploading, setSciUploading] = useState(false);

  const loadScenarioItems = React.useCallback(async (forceRefresh = false) => {
    if (!connected || !scriptUrl) { setSciLoaded(true); return; }
    setSciLoading(true);
    try {
      setSciItems(await fetchScenarioObjectsForAdmin(scriptUrl, forceRefresh));
      setSciLoaded(true);
    } catch (e: any) {
      notify(`시나리오 물품을 불러오지 못했습니다: ${e.message}`, "error");
    } finally {
      setSciLoading(false);
    }
  }, [connected, scriptUrl]);

  useEffect(() => {
    if (mode === "시나리오" && !sciLoaded && !sciLoading) loadScenarioItems();
  }, [mode, sciLoaded, sciLoading, loadScenarioItems]);

  const filteredScenarioItems = useMemo(() => {
    const base = (!searchQuery.trim()
      ? sciItems
      : sciItems.filter((it) => smartMatch([it.name, it.id, it.rootSlot, it.category, it.subcategory], searchQuery))
    ).filter((it) => !it.archived); // 보관 처리된 물품은 목록에서 뺀다 (PC 화면과 동일)
    return [...base].sort((a, b) => {
      const na = parseInt(String(a.rootSlot || "").replace(/\D/g, ""), 10);
      const nb = parseInt(String(b.rootSlot || "").replace(/\D/g, ""), 10);
      return (isNaN(na) ? Number.MAX_SAFE_INTEGER : na) - (isNaN(nb) ? Number.MAX_SAFE_INTEGER : nb);
    });
  }, [sciItems, searchQuery]);

  function openSciNew() {
    setSciForm({ ...(emptySciForm as ScenarioObjectAdmin) });
    setSciEditing(false);
    setScenarioTab("register");
    setSciCatCustom(false);
    setSciSubcatCustom(false);
    setSciSectorCustom(false);
  }
  function openSciEdit(item: ScenarioObjectAdmin) {
    setSciForm({ ...item });
    setSciEditing(true);
    setScenarioTab("register");
    // 기존 목록에 없는 값이면(레거시 데이터) 드롭다운에 안 보이니 직접입력 모드로 연다.
    setSciCatCustom(!!item.category && !sciCategories.includes(item.category));
    setSciSubcatCustom(!!item.subcategory && !sciAllSubcategories.includes(item.subcategory));
    setSciSectorCustom(!!item.sector && !sciSectors.includes(item.sector));
  }

  async function handleSciPhoto(file: File) {
    try {
      setSciUploading(true);
      const dataUrl = await resizeAndCompressImage(file);
      setSciForm((f) => ({ ...f, image: dataUrl }));
    } catch (e: any) {
      notify(`사진 처리 실패: ${e.message}`, "error");
    } finally {
      setSciUploading(false);
    }
  }

  async function handleSciSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sciForm.name.trim()) { notify("물품명을 입력해주세요.", "error"); return; }
    if (!connected || !scriptUrl) { notify("연동이 필요합니다.", "error"); return; }
    setSciSaving(true);
    try {
      if (sciEditing) {
        await updateScenarioObject(scriptUrl, { ...sciForm, rowIndex: sciForm.rowIndex });
        notify("수정했습니다.", "ok");
      } else {
        await addScenarioObject(scriptUrl, sciForm);
        notify("등록했습니다.", "ok");
      }
      setSciLoaded(false);
      setScenarioTab("list");
      setSciForm({ ...(emptySciForm as ScenarioObjectAdmin) });
      setSciEditing(false);
    } catch (e: any) {
      notify(`저장 실패: ${e.message}`, "error");
    } finally {
      setSciSaving(false);
    }
  }

  async function handleSciDelete() {
    if (!sciEditing || !sciForm.rowIndex) return;
    if (!window.confirm(`'${sciForm.name}'을(를) 삭제할까요? 되돌릴 수 없습니다.`)) return;
    setSciSaving(true);
    try {
      await deleteScenarioObject(scriptUrl, sciForm.rowIndex);
      notify("삭제했습니다.", "ok");
      setSciLoaded(false);
      setScenarioTab("list");
      setSciEditing(false);
    } catch (e: any) {
      notify(`삭제 실패: ${e.message}`, "error");
    } finally {
      setSciSaving(false);
    }
  }
  const [defSelectedInvIndex, setDefSelectedInvIndex] = useState<number>(-1); // -1: 직접 입력
  const [defItemCategory, setDefItemCategory] = useState<"rack" | "robot">("rack"); // 공구 및 부품류 vs 로봇 오브젝트
  const [defCustomName, setDefCustomName] = useState("");
  const [defSearch, setDefSearch] = useState("");
  const [defCustomLoc, setDefCustomLoc] = useState("");
  const [defQty, setDefQty] = useState(1);
  const [defType, setDefType] = useState("파손");
  const [defManager, setDefManager] = useState(defaultManagerName);
  const [defNote, setDefNote] = useState("");
  const [defActionTaken, setDefActionTaken] = useState("폐기 대기");
  const [defPhoto, setDefPhoto] = useState("");
  const [defectSubmitting, setDefectSubmitting] = useState(false);

  // --- 이미지 업로드 상태 및 헬퍼 ---
  const [isRegUploadingImage, setIsRegUploadingImage] = useState(false);
  const [isDefUploadingImage, setIsDefUploadingImage] = useState(false);

  // 바텀시트가 열려 있는 동안 뒤쪽 본문이 스크롤되지 않도록 body 스크롤을 잠근다.
  // (모바일에서 시트/키보드가 뜰 때 배경이 아래로 밀려 내려가는 문제 방지)
  useEffect(() => {
    if (sheetMode) {
      const prevOverflow = document.body.style.overflow;
      const prevPosition = document.body.style.position;
      const prevWidth = document.body.style.width;
      const scrollY = window.scrollY;
      document.body.style.overflow = "hidden";
      document.body.style.position = "fixed";
      document.body.style.width = "100%";
      document.body.style.top = `-${scrollY}px`;
      return () => {
        document.body.style.overflow = prevOverflow;
        document.body.style.position = prevPosition;
        document.body.style.width = prevWidth;
        document.body.style.top = "";
        window.scrollTo(0, scrollY);
      };
    }
  }, [sheetMode]);

  const handleRegPhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setIsRegUploadingImage(true);
      // Automatically resize to max 1200px width/height and compress to 0.75 JPEG quality
      // This prevents payload limit or timeout errors during sync
      const compressedBase64 = await resizeAndCompressImage(file, 1200, 1200, 0.75);
      setRegPhoto(compressedBase64);
    } catch (err: any) {
      notify("이미지 로드 실패: " + err.message, "error");
    } finally {
      setIsRegUploadingImage(false);
    }
  };

  const handleDefPhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setIsDefUploadingImage(true);
      // Automatically resize to max 1200px width/height and compress to 0.75 JPEG quality
      // This prevents payload limit or timeout errors during sync
      const compressedBase64 = await resizeAndCompressImage(file, 1200, 1200, 0.75);
      setDefPhoto(compressedBase64);
    } catch (err: any) {
      notify("이미지 로드 실패: " + err.message, "error");
    } finally {
      setIsDefUploadingImage(false);
    }
  };

  // --- 인라인 품목 수정(edit-inventory) 폼 상태 (Admin 전용) ---
  const [editName, setEditName] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editLink, setEditLink] = useState("");
  const [editPhoto, setEditPhoto] = useState("");
  const [editStock, setEditStock] = useState<string>("0");
  const [editSpec, setEditSpec] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editManager, setEditManager] = useState(defaultManagerName);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [isEditUploadingImage, setIsEditUploadingImage] = useState(false);

  const handleEditPhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setIsEditUploadingImage(true);
      const compressedBase64 = await resizeAndCompressImage(file, 1200, 1200, 0.75);
      setEditPhoto(compressedBase64);
    } catch (err: any) {
      notify("이미지 로드 실패: " + err.message, "error");
    } finally {
      setIsEditUploadingImage(false);
    }
  };

  const [lightbox, setLightbox] = useState<string | null>(null);
  const [localToast, setLocalToast] = useState<{ msg: string; type: "ok" | "error" | "warn" } | null>(null);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = (msg: string, type: "ok" | "error" | "warn" = "ok") => {
    setLocalToast({ msg, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setLocalToast(null), 2400);
  };

  // Sync manager states when currentUser changes
  useEffect(() => {
    if (currentUser) {
      const name = currentUser.name || currentUser.id;
      setRegManager(name);
      setDefManager(name);
      setEditManager(name);
    }
  }, [currentUser]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  // ---------- 색상 토큰 (기존 데스크탑 배색과 동일하게 유지) ----------
  const ACCENT = "#2563eb";
  const ACCENT_LIGHT = "#60a5fa";
  const GREEN = "#10b981";
  const GREEN_LIGHT = "#34d399";
  const DANGER = "#ef4444";
  const AMBER = "#f59e0b";
  const BG = isLightMode ? "#f8fafc" : "#0b0f19";
  const HEADER_BG = isLightMode ? "#ffffff" : "#151d30";
  const CARD_BG = isLightMode ? "#ffffff" : "#151d30";
  const BORDER = isLightMode ? "#e2e8f0" : "#222f4b";
  const TEXT_MAIN = isLightMode ? "#0f172a" : "#f1f5f9";
  const TEXT_DIM = isLightMode ? "#64748b" : "#94a3b8";
  const INPUT_BG = isLightMode ? "#f8fafc" : "#0f172a";
  const MODE_COLOR = mode === "대여" ? ACCENT : mode === "반납" ? GREEN : mode === "등록" ? "#2563eb" : AMBER;
  const MODE_COLOR_LIGHT = mode === "대여" ? ACCENT_LIGHT : mode === "반납" ? GREEN_LIGHT : mode === "등록" ? "#94a3b8" : "#fbbf24";

  // ---------- 대여 가능 여부: 숫자 재고가 0 이하일 때만 차단, N/A(문자/없음)는 항상 대여 가능 ----------
  const isRentDisabled = (item: InventoryItem) =>
    typeof item.stock === "number" && item.stock <= 0;

  // ---------- 대여 탭: 전체 재고 검색 (랙 순서 정렬) ----------
  const filteredInventory = useMemo(() => {
    const base = !searchQuery.trim() ? inventory : inventory.filter(
      (item) => smartMatch([item.name, item.location, item.spec, item.keywords], searchQuery)
    );
    return [...base].sort((a, b) => compareRackSlot(a.location, b.location));
  }, [inventory, searchQuery]);

  // ---------- 등록 탭(목록 보기): PC RackGroupedView와 동일하게 슬롯 단위로 묶는다 ----------
  const whGroups = useMemo(() => {
    const map = new Map<string, InventoryItem[]>();
    inventory.forEach((item) => {
      const key = (item.location || "").trim().toUpperCase() || "미지정";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    });
    const entries = Array.from(map.entries());
    // 슬롯 "안"에서만 서브카테고리(규격)가 같은 물품끼리 나란히 붙도록 정렬한다.
    // (슬롯 자체의 순서는 절대 바꾸지 않는다 — PC RackGroupedView와 동일한 규칙)
    entries.forEach(([, items]) => {
      items.sort((a, b) => {
        const subA = (a.spec || "").trim() || "미분류";
        const subB = (b.spec || "").trim() || "미분류";
        if (subA !== subB) return subA.localeCompare(subB, "ko");
        return compareRackSlot(a.location, b.location);
      });
    });
    // 슬롯은 항상 정상적인 랙-슬롯 번호 순서 그대로 나열한다.
    entries.sort((a, b) => compareRackSlot(a[0], b[0]));
    // 검색어가 있으면 매칭되는 슬롯만 걸러서 보여준다 (전에는 스크롤+하이라이트 방식이었다).
    const q = searchQuery.trim();
    if (!q) return entries;
    return entries.filter(([, items]) => items.some((item) => smartMatch([item.name, item.location, item.spec, item.keywords], q)));
  }, [inventory, searchQuery]);

  // 어디서부터 새 (랙, 서브카테고리) 묶음이 시작되는지 미리 계산 — 구분 라벨 렌더링용
  const whGroupClusterInfo = useMemo(() => {
    let prevRack = "";
    return whGroups.map(([groupKey]) => {
      const rack = parseLocation(groupKey).rack || "미지정";
      const isNewRack = rack !== prevRack;
      prevRack = rack;
      return { rack, isNewRack };
    });
  }, [whGroups]);

  const whRacks = useMemo(() => {
    const set = new Set<string>();
    inventory.forEach((item) => {
      const { rack } = parseLocation(item.location);
      if (rack) set.add(rack);
    });
    return Array.from(set).sort();
  }, [inventory]);

  const whSlotsByRack = useMemo(() => {
    const map: Record<string, string[]> = {};
    inventory.forEach((item) => {
      const { rack } = parseLocation(item.location);
      if (!rack) return;
      const loc = (item.location || "").trim().toUpperCase();
      if (!loc) return;
      if (!map[rack]) map[rack] = [];
      if (!map[rack].includes(loc)) map[rack].push(loc);
    });
    Object.keys(map).forEach((r) => map[r].sort(compareRackSlot));
    return map;
  }, [inventory]);

  // 특정 슬롯으로 스크롤 이동 + 잠깐 하이라이트. 접혀 있으면 먼저 펼친다.
  const scrollToWhGroup = (key: string) => {
    setWhCollapsed((prev) => (prev[key] ? { ...prev, [key]: false } : prev));
    if (whHighlightTimerRef.current) window.clearTimeout(whHighlightTimerRef.current);
    window.setTimeout(() => {
      whGroupRefs.current[key]?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
    setWhHighlightKey(key);
    whHighlightTimerRef.current = window.setTimeout(() => setWhHighlightKey(null), 2300);
  };

  // 등록 탭(목록 보기) 검색은 위 whGroups useMemo에서 이미 필터링된다 (스크롤 방식에서 변경됨).

  // 목록 행에서 바로 편집 화면으로 (상세보기를 거치지 않는 빠른 편집)
  const quickEditItem = (item: InventoryItem) => {
    setSelectedItem(item);
    setEditName(item.name || "");
    setEditLocation(item.location || "");
    setEditLink(item.link || "N/A");
    setEditPhoto(item.photo || "");
    setEditStock(item.stock === null ? "" : String(item.stock));
    setEditSpec(item.spec || "");
    setEditNote(item.note || "");
    setEditManager(item.manager && item.manager !== "관리자" ? item.manager : defaultManagerName);
    const base = window.location.hash.split("/")[1] || "monitor";
    window.location.hash = `#/${base}/edit-inventory`;
  };

  // 랙 내비게이터에서 슬롯을 골라 "새 물품 등록"으로 — 위치를 미리 채워준다
  const startRegisterAtLocation = (loc: string) => {
    setRegIsCustomLoc(true);
    setRegCustomLocation(loc);
    setWarehouseTab("register");
    setWhExpandedRack(null);
  };

  // ---------- 불량 탭: 불량 로그 검색 ----------
  const filteredDefectLogs = useMemo(() => {
    if (!searchQuery.trim()) return defectLogs;
    return defectLogs.filter(
      (log) => smartMatch([log.name, log.defectType, log.note, log.actionTaken, log.manager], searchQuery)
    );
  }, [defectLogs, searchQuery]);

  // ---------- 반납 탭: 아직 반납되지 않은(미반납) 대여 내역 집계 ----------
  const outstandingRentals = useMemo(() => {
    const map = new Map<string, OutstandingRental>();
    for (const log of rentLogs) {
      const name = (log.name || "").trim();
      const location = (log.location || "").trim();
      const user = (log.user || "").trim();
      if (!name) continue;
      const key = `${name}||${location}||${user}`;
      const qtyNum = Number(log.qty) || 0;
      const note = String(log.note || "");
      const isConsumeNote = note.indexOf("[소모완료]") !== -1 || note.indexOf("[즉시반납]") !== -1;
      // 소모는 반납 대상이 아님: 대여량 집계에서 제외. 소모완료 note가 붙은 반납은 대여 차감.
      let delta = 0;
      if (log.type === "소모") delta = 0;
      else if (log.type === "반납" || isConsumeNote) delta = -qtyNum;
      else delta = qtyNum;
      const existing = map.get(key);
      if (existing) {
        existing.qty += delta;
        const logTime = parseDateString(log.timestamp || "");
        const existingTime = parseDateString(existing.lastTimestamp);
        if (logTime > existingTime) {
          existing.lastTimestamp = log.timestamp || "";
        }
      } else {
        map.set(key, { key, name, location, user, qty: delta, lastTimestamp: log.timestamp || "" });
      }
    }
    return Array.from(map.values())
      .filter((o) => o.qty > 0)
      .sort((a, b) => compareDatesDescending(a.lastTimestamp, b.lastTimestamp));
  }, [rentLogs]);

  const filteredOutstanding = useMemo(() => {
    if (!searchQuery.trim()) return outstandingRentals;
    return outstandingRentals.filter(
      (o) => smartMatch([o.name, o.location, o.user], searchQuery)
    );
  }, [outstandingRentals, searchQuery]);

  // ---------- URL Hash Synchronization for Mobile View ----------
  useEffect(() => {
    const syncFromHash = () => {
      const hash = window.location.hash || "";
      const parts = hash.split("/");
      if (parts.length < 2) return;

      const mainPath = parts[1]; // "monitor", "rent", "defect", "register"
      const subPath = parts[2] as SheetMode || null; // "detail", "form", "edit-inventory" or null

      // Sync tab mode
      // 관리자 모드에서는 '대여 & 반납' 탭 자체를 없앴으므로, 해당 경로로 들어와도 등록 화면으로 대체한다.
      if (mainPath === "monitor") {
        setMode(isAdmin ? "등록" : "대여");
      } else if (mainPath === "rent") {
        setMode(isAdmin ? "등록" : "반납");
      } else if (mainPath === "defect") {
        setMode("불량");
      } else if (mainPath === "register") {
        setMode("등록");
      } else if (mainPath === "scenariotab") {
        setMode("시나리오");
      }

      // Sync sheet mode
      setSheetMode(subPath);

      // If there's no sheet mode, clear active selected item
      if (!subPath) {
        setSelectedItem(null);
        setOutstandingContext(null);
      }
    };

    window.addEventListener("hashchange", syncFromHash);
    syncFromHash(); // Initial load sync

    return () => {
      window.removeEventListener("hashchange", syncFromHash);
    };
  }, []);

  const switchMode = (m: Mode) => {
    setSearchQuery("");
    if (m === "대여") {
      window.location.hash = "#/monitor";
    } else if (m === "반납") {
      window.location.hash = "#/rent";
    } else if (m === "불량") {
      window.location.hash = "#/defect";
    } else if (m === "등록") {
      window.location.hash = "#/register";
    } else if (m === "시나리오") {
      window.location.hash = "#/scenariotab";
    }
  };

  // ---------- 대여 탭에서 품목 탭 ----------
  const openItemDetail = (item: InventoryItem) => {
    setSelectedItem(item);
    setOutstandingContext(null);
    if (item.rowIndex === -1) {
      setCustomBorrowName(item.name || "");
      setCustomBorrowLoc(item.location || "");
    }
    const base = window.location.hash.split("/")[1] || "monitor";
    window.location.hash = `#/${base}/detail`;
  };

  // ---------- 반납 탭에서 미반납 내역 탭 ----------
  const openReturnDetail = (outstanding: OutstandingRental) => {
    const matched = inventory.find(
      (inv) => (inv.name || "").trim() === outstanding.name && (inv.location || "").trim() === outstanding.location
    );
    const item: InventoryItem =
      matched ||
      ({
        rowIndex: -1,
        location: outstanding.location,
        photo: "",
        name: outstanding.name,
        link: "N/A",
        stock: "N/A",
        updatedAt: "",
        manager: "",
        note: "",
        spec: "",
      } as InventoryItem);
    setSelectedItem(item);
    setOutstandingContext(outstanding);
    const base = window.location.hash.split("/")[1] || "monitor";
    window.location.hash = `#/${base}/detail`;
  };

  const closeSheet = () => {
    const base = window.location.hash.split("/")[1] || "monitor";
    window.location.hash = `#/${base}`;
  };

  const openForm = () => {
    if (!selectedItem) return;
    if (mode === "반납" && outstandingContext) {
      setFormUser(outstandingContext.user);
      setFormQty(outstandingContext.qty);
    } else {
      setFormUser("");
      setFormQty(1);
    }
    setFormNote("");
    setFormDueDate("");
    const base = window.location.hash.split("/")[1] || "monitor";
    window.location.hash = `#/${base}/form`;
  };

  const backToDetail = () => {
    const base = window.location.hash.split("/")[1] || "monitor";
    window.location.hash = `#/${base}/detail`;
  };

  const maxQty =
    mode === "대여" && selectedItem && typeof selectedItem.stock === "number"
      ? selectedItem.stock
      : mode === "반납" && outstandingContext
      ? outstandingContext.qty
      : undefined;

  const handleSubmit = async (overrideType?: "대여" | "반납" | "소모") => {
    const actionType = overrideType || mode;
    // 반납 화면에서 "소모로 처리"를 누른 경우: 이미 대여 시 재고가 차감된 상태이므로
    // type은 "반납"으로 유지해 미반납 집계를 정상적으로 닫되, 노트에 [소모완료] 태그를 붙여
    // 재고가 다시 복구되지 않도록 한다. (type:"소모"를 쓰면 재고가 중복 차감되고 미반납도 안 닫힘)
    const isConsumeOnReturn = mode === "반납" && actionType === "소모";
    const recordType: "대여" | "반납" = isConsumeOnReturn ? "반납" : (actionType === "소모" ? "소모" : actionType);
    if (!selectedItem) return;
    if (!formUser.trim()) {
      notify("이름을 입력해 주세요.", "warn");
      return;
    }
    if (formQty <= 0) {
      notify("수량은 1개 이상이어야 합니다.", "warn");
      return;
    }
    if (maxQty !== undefined && formQty > maxQty) {
      notify(
        mode === "반납" ? `미반납 수량(${maxQty}개)을 초과할 수 없습니다.` : `현재고(${maxQty}개)를 초과할 수 없습니다.`,
        "warn"
      );
      return;
    }

    setSubmitting(true);
    try {
      const isCustom = selectedItem.rowIndex === -1;
      const itemName = isCustom ? customBorrowName.trim() : selectedItem.name;
      const itemLoc = isCustom ? customBorrowLoc.trim() : selectedItem.location;
      if (isCustom && !itemName) { notify("물품명을 입력해 주세요.", "warn"); setSubmitting(false); return; }
      const dueTag = actionType === "대여" && formDueDate ? ` [반납예정:${formDueDate}]` : "";
      const consumeTag = isConsumeOnReturn ? " [소모완료]" : "";
      const log: RentLog = {
        timestamp: formatTimestampLocal(),
        location: itemLoc,
        name: itemName,
        type: recordType,
        qty: formQty,
        user: formUser.trim(),
        note: (formNote.trim() || `${actionType} 처리 (모바일 관리자)`) + dueTag + consumeTag,
      };
      await onAddRentLog(log);
      notify(
        actionType === "대여"
          ? `${itemName} ${formQty}개 대여 신청이 접수되었습니다.`
          : actionType === "소모"
          ? `${itemName} ${formQty}개 소모 처리되었습니다. (반납 대상 아님, 재고 변동 없음)`
          : `${itemName} ${formQty}개 반납이 접수되었습니다.`,
        "ok"
      );
      closeSheet();
    } catch (err: any) {
      notify("처리에 실패했습니다: " + (err?.message || "알 수 없는 오류"), "error");
    } finally {
      setSubmitting(false);
    }
  };

  // 1. 신규 품목 등록 (등록 탭) 제출 처리
  const handleRegisterItemSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regName.trim()) {
      notify("품목명을 입력해 주세요.", "warn");
      return;
    }
    const location = regIsCustomLoc
      ? regCustomLocation.trim()
      : `${regRackId}-${regShelf.trim()}`;
    if (!location) {
      notify("위치를 지정하거나 직접 입력해 주세요.", "warn");
      return;
    }

    setRegSubmitting(true);
    try {
      let numericStock: number | string | null = null;
      if (regStock.trim().toUpperCase() === "N/A") {
        numericStock = "N/A";
      } else {
        const val = Number(regStock);
        numericStock = isNaN(val) ? regStock : val;
      }

      const item: Omit<InventoryItem, "rowIndex"> = {
        name: regName.trim(),
        location: location,
        spec: regSpec.trim(),
        stock: numericStock,
        manager: regManager.trim(),
        note: regNote.trim(),
        keywords: regKeywords.trim(),
        photo: regPhoto.trim(),
        link: regLink.trim() || "N/A",
        updatedAt: formatTimestampLocal(),
      };

      if (onSaveInventoryItem) {
        await onSaveInventoryItem(item);
        notify(`${regName} 품목이 성공적으로 등록되었습니다.`, "ok");
        // Reset form
        setRegName("");
        setRegShelf("");
        setRegCustomLocation("");
        setRegSpec("");
        setRegStock("0");
        setRegNote("");
        setRegKeywords("");
        setRegPhoto("");
        setRegLink("N/A");
      } else {
        notify("품목 등록 처리 핸들러가 연결되지 않았습니다.", "error");
      }
    } catch (err: any) {
      notify("등록 중 오류가 발생했습니다: " + (err?.message || "알 수 없는 오류"), "error");
    } finally {
      setRegSubmitting(false);
    }
  };

  // 2. 불량 접수 (불량 탭) 제출 처리
  const handleRegisterDefectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let itemName = "";
    let itemLocation = "";

    if (defSelectedInvIndex === -1) {
      if (!defCustomName.trim()) {
        notify("품목명을 입력해 주세요.", "warn");
        return;
      }
      if (!defCustomLoc.trim()) {
        notify("보관 위치를 입력해 주세요.", "warn");
        return;
      }
      itemName = defCustomName.trim();
      itemLocation = defCustomLoc.trim();
    } else {
      const source = defItemCategory === "rack" ? inventory : robotObjects;
      const selectedInv = source[defSelectedInvIndex];
      if (!selectedInv) {
        notify("선택된 품목이 올바르지 않습니다.", "warn");
        return;
      }
      itemName = selectedInv.name;
      itemLocation = selectedInv.location || "";
    }

    setDefectSubmitting(true);
    try {
      const log: Omit<DefectLog, "rowIndex"> = {
        timestamp: formatTimestampLocal(),
        location: itemLocation,
        name: itemName,
        qty: defQty,
        defectType: defType,
        manager: defManager.trim() || "관리자",
        note: defNote.trim(),
        actionTaken: defActionTaken.trim() || "조치 예정",
        photo: defPhoto,
        itemCategory: defItemCategory,
        culprit: defItemCategory === "robot" ? defCulprit.trim() : "",
      };

      if (onAddDefectLog) {
        await onAddDefectLog(log);
        notify(`불량 접수 완료: ${itemName} (${defQty}개)`, "ok");
        // Reset form
        setDefCustomName("");
        setDefCustomLoc("");
        setDefQty(1);
        setDefNote("");
        setDefCulprit("");
        setDefPhoto(""); // Reset photo state
        setDefSelectedInvIndex(-1);
        setDefItemCategory("rack"); setDefSearch(""); setDefSelectedInvIndex(-1); setDefCustomName(""); setDefCustomLoc(""); setDefListOpen(true);
        setDefSearch("");
        setDefectTab("list"); // Go back to list!
      } else {
        notify("불량 등록 처리 핸들러가 연결되지 않았습니다.", "error");
      }
    } catch (err: any) {
      notify("등록 중 오류가 발생했습니다: " + (err?.message || "알 수 없는 오류"), "error");
    } finally {
      setDefectSubmitting(false);
    }
  };

  // 3. 인라인 품목 재고/정보 수정 (Admin 전용) 제출 처리
  const handleEditInventorySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) return;

    setEditSubmitting(true);
    try {
      let numericStock: number | string | null = null;
      if (editStock.trim().toUpperCase() === "N/A") {
        numericStock = "N/A";
      } else {
        const val = Number(editStock);
        numericStock = isNaN(val) ? editStock : val;
      }

      const updatedItem: Omit<InventoryItem, "rowIndex"> & { rowIndex?: number } = {
        ...selectedItem,
        name: editName.trim(),
        location: editLocation.trim(),
        link: editLink.trim() || "N/A",
        photo: editPhoto.trim(),
        stock: numericStock,
        spec: editSpec.trim(),
        note: editNote.trim(),
        manager: editManager.trim(),
        updatedAt: formatTimestampLocal(),
      };

      if (onSaveInventoryItem) {
        await onSaveInventoryItem(updatedItem);
        notify(`${editName} 정보가 성공적으로 수정되었습니다.`, "ok");
        closeSheet();
      } else {
        notify("수정 처리 핸들러가 연결되지 않았습니다.", "error");
      }
    } catch (err: any) {
      notify("수정 중 오류가 발생했습니다: " + (err?.message || "알 수 없는 오류"), "error");
    } finally {
      setEditSubmitting(false);
    }
  };

  // 4. 인라인 수정 활성화할 때 상태 세팅
  const openEditInventory = () => {
    if (!selectedItem) return;
    setEditName(selectedItem.name || "");
    setEditLocation(selectedItem.location || "");
    setEditLink(selectedItem.link || "N/A");
    setEditPhoto(selectedItem.photo || "");
    setEditStock(selectedItem.stock === null ? "" : String(selectedItem.stock));
    setEditSpec(selectedItem.spec || "");
    setEditNote(selectedItem.note || "");
    setEditManager(selectedItem.manager && selectedItem.manager !== "관리자" ? selectedItem.manager : defaultManagerName);
    
    const base = window.location.hash.split("/")[1] || "monitor";
    window.location.hash = `#/${base}/edit-inventory`;
  };

  const inputBaseStyle: React.CSSProperties = {
    width: "100%",
    background: INPUT_BG,
    border: `1px solid ${BORDER}`,
    borderRadius: "12px",
    padding: "13px 14px",
    color: TEXT_MAIN,
    fontSize: "15px",
    outline: "none",
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: BG,
        color: TEXT_MAIN,
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <style>{`
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        .mvp-btn { cursor: pointer; border: none; transition: all 0.15s ease-in-out; }
        .mvp-btn:active { transform: scale(0.97); }
        .mvp-btn:disabled { cursor: not-allowed; }
        .mvp-card:active { transform: scale(0.985); }
        .mvp-input:focus { border-color: ${ACCENT} !important; box-shadow: 0 0 0 3px rgba(79,70,229,0.15) !important; }
        @keyframes mvpSheetUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes mvpFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes mvpToastIn { from { opacity: 0; transform: translate(-50%, 10px); } to { opacity: 1; transform: translate(-50%, 0); } }
        @keyframes mvpWhHighlight {
          0% { box-shadow: 0 0 0 0 rgba(37,99,235,0.55); border-color: ${ACCENT}; }
          70% { box-shadow: 0 0 0 12px rgba(37,99,235,0); border-color: ${ACCENT}; }
          100% { box-shadow: 0 0 0 0 rgba(37,99,235,0); }
        }
        .mvp-wh-highlight { animation: mvpWhHighlight 1.15s ease-out 2; }
        ::-webkit-scrollbar { width: 0px; height: 0px; }
      `}</style>

      {/* ===== 상단 헤더 (고정) ===== */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: HEADER_BG,
          borderBottom: `1px solid ${BORDER}`,
          padding: "12px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "10px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
          <button
            className="mvp-btn"
            onClick={onBack}
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "10px",
              background: isLightMode ? "#f1f5f9" : "#1e293b",
              color: TEXT_MAIN,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <ArrowLeft size={18} />
          </button>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: "15px", fontWeight: 800, color: TEXT_MAIN, whiteSpace: "nowrap" }}>
              {isAdmin ? "📱 모바일 관리자" : "👀 열람용 모드"}
            </div>
            <div
              style={{
                fontSize: "10.5px",
                color: connected ? GREEN_LIGHT : AMBER,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  background: connected ? GREEN : AMBER,
                  display: "inline-block",
                }}
              />
              {connected ? "실시간 연동 중" : "데모 모드"}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
          <button
            className="mvp-btn"
            onClick={toggleLightMode}
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "10px",
              background: isLightMode ? "#f1f5f9" : "#1e293b",
              color: TEXT_MAIN,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {isLightMode ? <Moon size={16} /> : <Sun size={16} />}
          </button>
        </div>
      </header>

      {/* ===== 대여/반납 모드 탭 + 검색창 (고정) ===== */}
      <div
        style={{
          position: "sticky",
          top: "60px",
          zIndex: 19,
          background: BG,
          padding: "12px 14px 10px",
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isAdmin ? "1fr 1fr 1fr" : "1fr",
            gap: "6px",
            background: isLightMode ? "#f1f5f9" : "#111827",
            padding: "4px",
            borderRadius: "14px",
            marginBottom: ((mode === "등록" && warehouseTab === "register") || mode === "불량") ? "0px" : "10px",
          }}
        >
          {isAdmin ? (
            <>
              <button
                className="mvp-btn"
                onClick={() => switchMode("등록")}
                style={{
                  padding: "10px 4px",
                  borderRadius: "11px",
                  fontSize: "12px",
                  fontWeight: 800,
                  background: mode === "등록" ? TEXT_MAIN : "transparent",
                  color: mode === "등록" ? BG : TEXT_DIM,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                  boxShadow: mode === "등록" ? "0 6px 14px rgba(0,0,0,0.18)" : "none",
                }}
              >
                📦 공구 및 부품류
              </button>
              <button
                className="mvp-btn"
                onClick={() => switchMode("시나리오")}
                style={{
                  padding: "10px 4px",
                  borderRadius: "11px",
                  fontSize: "12px",
                  fontWeight: 800,
                  background: mode === "시나리오" ? TEXT_MAIN : "transparent",
                  color: mode === "시나리오" ? BG : TEXT_DIM,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                  boxShadow: mode === "시나리오" ? "0 6px 14px rgba(0,0,0,0.18)" : "none",
                }}
              >
                🧩 시나리오 물품
              </button>
              <button
                className="mvp-btn"
                onClick={() => switchMode("불량")}
                style={{
                  padding: "10px 4px",
                  borderRadius: "11px",
                  fontSize: "12px",
                  fontWeight: 800,
                  background: mode === "불량" ? AMBER : "transparent",
                  color: mode === "불량" ? "#ffffff" : TEXT_DIM,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                  boxShadow: mode === "불량" ? "0 6px 14px rgba(245,158,11,0.3)" : "none",
                }}
              >
                ⚠️ 불량
              </button>
            </>
          ) : (
            <button
              className="mvp-btn"
              onClick={() => switchMode(mode === "반납" ? "반납" : "대여")}
              style={{
                padding: "13px",
                borderRadius: "11px",
                fontSize: "14.5px",
                fontWeight: 800,
                background: TEXT_MAIN,
                color: BG,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
              }}
            >
              🔄 대여 & 반납
              {outstandingRentals.length > 0 && (
                <span
                  style={{
                    background: "rgba(255,255,255,0.25)",
                    color: BG,
                    fontSize: "9px",
                    fontWeight: 800,
                    borderRadius: "999px",
                    padding: "1px 5px",
                  }}
                >
                  {outstandingRentals.length}
                </span>
              )}
            </button>
          )}
        </div>

        {(mode === "대여" || mode === "반납") && (
          <div style={{ display: "flex", gap: "6px", marginBottom: "10px" }}>
            <button
              className="mvp-btn"
              onClick={() => switchMode("대여")}
              style={{
                flex: 1,
                padding: "9px",
                borderRadius: "10px",
                fontSize: "12.5px",
                fontWeight: 700,
                background: mode === "대여" ? ACCENT : (isLightMode ? "#f1f5f9" : "#111827"),
                color: mode === "대여" ? "#ffffff" : TEXT_DIM,
              }}
            >
              📥 대여
            </button>
            <button
              className="mvp-btn"
              onClick={() => switchMode("반납")}
              style={{
                flex: 1,
                padding: "9px",
                borderRadius: "10px",
                fontSize: "12.5px",
                fontWeight: 700,
                background: mode === "반납" ? GREEN : (isLightMode ? "#f1f5f9" : "#111827"),
                color: mode === "반납" ? "#ffffff" : TEXT_DIM,
              }}
            >
              🔄 반납
            </button>
          </div>
        )}


        {!((mode === "등록" && warehouseTab === "register") || (mode === "불량" && defectTab === "register")) && (
          <>
            <div style={{ position: "relative" }}>
              <Search
                size={16}
                style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: TEXT_DIM }}
              />
              <input
                className="mvp-input"
                type="text"
                inputMode="search"
                placeholder={
                  mode === "대여"
                    ? "품목명, 위치, 규격으로 검색"
                    : mode === "반납"
                    ? "품목명, 위치, 대여자 이름으로 검색"
                    : mode === "등록"
                    ? "물품명·위치·규격 검색"
                    : "제품명, 불량 유형, 상세 내용으로 검색"
                }
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: "100%",
                  background: CARD_BG,
                  border: `1px solid ${BORDER}`,
                  borderRadius: "12px",
                  padding: "12px 14px 12px 38px",
                  color: TEXT_MAIN,
                  fontSize: "14px",
                  outline: "none",
                }}
              />
              {searchQuery && (
                <button
                  className="mvp-btn"
                  onClick={() => setSearchQuery("")}
                  style={{
                    position: "absolute",
                    right: "10px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "transparent",
                    color: TEXT_DIM,
                    width: "24px",
                    height: "24px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <X size={15} />
                </button>
              )}
            </div>
            <div style={{ fontSize: "11px", color: TEXT_DIM, marginTop: "8px", fontWeight: 600 }}>
              {mode === "대여" ? `총 ${filteredInventory.length}개 품목` : `미반납 ${filteredOutstanding.length}건`}
            </div>
          </>
        )}
      </div>

      {/* ===== 리스트 & 폼 메인 영역 ===== */}
      <main
        ref={mainRef}
        onTouchStart={onSwipeStart}
        onTouchEnd={onSwipeEnd}
        style={{ flex: 1, padding: "14px 14px 32px", display: "flex", flexDirection: "column", gap: "10px", overflowY: "auto" }}
      >
        <div key={mode} className={tabSlideDir === "forward" ? "step-forward" : "step-back"} style={{ display: "flex", flexDirection: "column", gap: "10px", flex: 1 }}>
        {mode === "대여" ? (
          <>
          <button
            onClick={() => {
              const customName = searchQuery.trim();
              const custom: InventoryItem = {
                rowIndex: -1,
                location: "",
                photo: "",
                name: customName,
                link: "",
                stock: "N/A",
                updatedAt: "",
                manager: "",
                note: "",
                spec: "",
              };
              openItemDetail(custom);
            }}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
              padding: "11px", borderRadius: "12px", border: `1px dashed ${BORDER}`,
              background: "transparent", color: MODE_COLOR, fontSize: "13px", fontWeight: 700, cursor: "pointer",
            }}
          >
            <Plus size={15} /> 목록에 없는 물품 직접 대여
          </button>
          {filteredInventory.length === 0 ? (
            <div style={{ marginTop: "40px", textAlign: "center", color: TEXT_DIM, fontSize: "13px" }}>
              <Package size={36} style={{ margin: "0 auto 10px", opacity: 0.4 }} />
              검색 결과가 없습니다.
            </div>
          ) : (
            filteredInventory.map((item, idx) => {
              const hasImage = !!item.photo;
              const imageUrl = hasImage ? getGoogleDriveImageUrl(item.photo) : "";
              const stockLabel = item.stock === null || item.stock === "N/A" ? "N/A" : `${item.stock}개`;
              const stockColor =
                item.stock === null || item.stock === "N/A"
                  ? TEXT_DIM
                  : item.stock === 0
                  ? DANGER
                  : GREEN;

              return (
                <div
                  key={`${item.rowIndex}-${idx}`}
                  className="mvp-card"
                  onClick={() => openItemDetail(item)}
                  style={{
                    background: CARD_BG,
                    border: `1px solid ${BORDER}`,
                    borderRadius: "16px",
                    padding: "10px",
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      width: "54px",
                      height: "54px",
                      borderRadius: "12px",
                      overflow: "hidden",
                      flexShrink: 0,
                      background: isLightMode ? "#f1f5f9" : "#0f172a",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {hasImage ? (
                      <img
                        src={imageUrl}
                        alt={item.name}
                        referrerPolicy="no-referrer"
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <Package size={20} color={TEXT_DIM} />
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: "13.5px",
                        fontWeight: 800,
                        color: TEXT_MAIN,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.name || "(이름 없음)"}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                        fontSize: "11px",
                        color: TEXT_DIM,
                        marginTop: "3px",
                      }}
                    >
                      <MapPin size={10} />
                      <span className="mono">{item.location || "위치 미지정"}</span>
                      {item.spec && (
                        <>
                          <span>·</span>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {item.spec}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px", flexShrink: 0 }}>
                    <span
                      className="mono"
                      style={{
                        fontSize: "12px",
                        fontWeight: 800,
                        color: stockColor,
                        background:
                          item.stock === 0 ? "rgba(239,68,68,0.1)" : item.stock === null || item.stock === "N/A" ? "transparent" : "rgba(16,185,129,0.1)",
                        padding: "3px 8px",
                        borderRadius: "999px",
                      }}
                    >
                      {stockLabel}
                    </span>
                    <ChevronRight size={16} color={TEXT_DIM} />
                  </div>
                </div>
              );
            })
          )}
          </>
        ) : mode === "반납" ? (
          filteredOutstanding.length === 0 ? (
            <div style={{ marginTop: "40px", textAlign: "center", color: TEXT_DIM, fontSize: "13px" }}>
              <Check size={36} style={{ margin: "0 auto 10px", opacity: 0.4 }} />
              {searchQuery ? "검색 결과가 없습니다." : "현재 반납할 물품이 없습니다."}
            </div>
          ) : (
            filteredOutstanding.map((o) => {
              const matched = inventory.find(
                (inv) => (inv.name || "").trim() === o.name && (inv.location || "").trim() === o.location
              );
              const hasImage = !!matched?.photo;
              const imageUrl = hasImage ? getGoogleDriveImageUrl(matched!.photo) : "";

              return (
                <div
                  key={o.key}
                  className="mvp-card"
                  onClick={() => openReturnDetail(o)}
                  style={{
                    background: CARD_BG,
                    border: `1px solid ${BORDER}`,
                    borderRadius: "16px",
                    padding: "10px",
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      width: "54px",
                      height: "54px",
                      borderRadius: "12px",
                      overflow: "hidden",
                      flexShrink: 0,
                      background: isLightMode ? "#f1f5f9" : "#0f172a",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {hasImage ? (
                      <img
                        src={imageUrl}
                        alt={o.name}
                        referrerPolicy="no-referrer"
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <Package size={20} color={TEXT_DIM} />
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: "13.5px",
                        fontWeight: 800,
                        color: TEXT_MAIN,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {o.name}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", color: TEXT_DIM, marginTop: "3px" }}>
                      <MapPin size={10} />
                      <span className="mono">{o.location || "위치 미지정"}</span>
                      <span>·</span>
                      <User size={10} />
                      <span>{o.user || "이름 미상"}</span>
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px", flexShrink: 0 }}>
                    <span
                      className="mono"
                      style={{
                        fontSize: "12px",
                        fontWeight: 800,
                        color: AMBER,
                        background: "rgba(245,158,11,0.12)",
                        padding: "3px 8px",
                        borderRadius: "999px",
                      }}
                    >
                      미반납 {o.qty}개
                    </span>
                    <ChevronRight size={16} color={TEXT_DIM} />
                  </div>
                </div>
              );
            })
          )
        ) : mode === "등록" ? (
          /* =========================================================
             3. 공구 및 부품류 탭: 목록 보기 / 새 물품 등록 (Admin 모바일 전용)
             ========================================================= */
          <>
            {onRefreshInventory ? (
              <>
                <style>{`@keyframes mvpInvSpin { to { transform: rotate(360deg); } } .mvp-inv-spin { animation: mvpInvSpin 0.9s linear infinite; }`}</style>
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "6px" }}>
                  <button
                    className="mvp-btn"
                    onClick={onRefreshInventory}
                    disabled={inventoryRefreshing}
                    style={{
                      display: "flex", alignItems: "center", gap: "5px",
                      padding: "7px 12px", borderRadius: "9px",
                      border: `1px solid ${BORDER}`, background: CARD_BG, color: ACCENT_LIGHT,
                      fontSize: "11.5px", fontWeight: 700, opacity: inventoryRefreshing ? 0.7 : 1,
                    }}
                  >
                    <RotateCcw size={13} className={inventoryRefreshing ? "mvp-inv-spin" : undefined} /> 새로고침
                  </button>
                </div>
              </>
            ) : null}
            <div style={subTabBarStyle}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "4px",
                background: isLightMode ? "#f1f5f9" : "#111827",
                padding: "4px",
                borderRadius: "12px",
              }}
            >
              <button
                className="mvp-btn"
                onClick={() => setWarehouseTab("list")}
                style={{
                  padding: "9px",
                  borderRadius: "9px",
                  fontSize: "12.5px",
                  fontWeight: 700,
                  background: warehouseTab === "list" ? TEXT_MAIN : "transparent",
                  color: warehouseTab === "list" ? BG : TEXT_DIM,
                }}
              >
                📋 목록 보기 ({inventory.length})
              </button>
              <button
                className="mvp-btn"
                onClick={() => setWarehouseTab("register")}
                style={{
                  padding: "9px",
                  borderRadius: "9px",
                  fontSize: "12.5px",
                  fontWeight: 700,
                  background: warehouseTab === "register" ? TEXT_MAIN : "transparent",
                  color: warehouseTab === "register" ? BG : TEXT_DIM,
                }}
              >
                ➕ 새 물품 등록
              </button>
            </div>
            </div>

            {warehouseTab === "list" ? (
              <>
                {/* 랙 내비게이터 — 랙을 누르면 슬롯 목록이 펼쳐지고, 슬롯을 고르면 그 위치로 스크롤+하이라이트 */}
                {whRacks.length > 0 ? (
                  <div style={{ marginBottom: "10px" }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                      {whRacks.map((r) => {
                        const on = whExpandedRack === r;
                        return (
                          <button
                            key={r}
                            className="mvp-btn"
                            onClick={() => setWhExpandedRack(on ? null : r)}
                            style={{
                              display: "flex", alignItems: "center", gap: "4px",
                              padding: "8px 12px", borderRadius: "9px",
                              border: `1px solid ${on ? ACCENT : BORDER}`,
                              background: on ? ACCENT : CARD_BG, color: on ? "#fff" : TEXT_MAIN,
                              fontSize: "12.5px", fontWeight: 800, fontFamily: "monospace",
                            }}
                          >
                            {r}랙 {on ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          </button>
                        );
                      })}
                    </div>
                    {whExpandedRack ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "8px", padding: "10px", borderRadius: "10px", background: isLightMode ? "#f1f5f9" : "#111827", border: `1px solid ${BORDER}` }}>
                        {(whSlotsByRack[whExpandedRack] || []).map((slot) => (
                          <button
                            key={slot}
                            className="mvp-btn"
                            onClick={() => { scrollToWhGroup(slot); setWhExpandedRack(null); }}
                            style={{
                              padding: "7px 11px", borderRadius: "7px",
                              border: `1px solid ${BORDER}`, background: CARD_BG, color: TEXT_MAIN,
                              fontSize: "12px", fontWeight: 700, fontFamily: "monospace",
                            }}
                          >
                            {slot}
                          </button>
                        ))}
                        {isAdmin ? (
                          <button
                            className="mvp-btn"
                            onClick={() => startRegisterAtLocation(`${whExpandedRack}-`)}
                            style={{
                              display: "flex", alignItems: "center", gap: "4px",
                              padding: "7px 11px", borderRadius: "7px",
                              border: `1px solid ${ACCENT}`, background: "rgba(37,99,235,0.1)", color: ACCENT_LIGHT,
                              fontSize: "12px", fontWeight: 700,
                            }}
                          >
                            <Plus size={12} /> 이 랙에 새 슬롯
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {whGroups.length === 0 ? (
                  <div style={{ marginTop: "40px", textAlign: "center", color: TEXT_DIM, fontSize: "13px" }}>
                    <Package size={36} style={{ margin: "0 auto 10px", opacity: 0.4 }} />
                    {searchQuery.trim() ? "검색 결과가 없습니다." : "등록된 공구 및 부품류가 없습니다."}
                  </div>
                ) : (
                  whGroups.map(([groupKey, items], idx) => {
                    const isCollapsed = !!whCollapsed[groupKey];
                    const isHighlighted = whHighlightKey === groupKey;
                    const cluster = whGroupClusterInfo[idx];
                    return (
                      <React.Fragment key={groupKey}>
                        {cluster?.isNewRack ? (
                          <div style={{ display: "flex", alignItems: "center", gap: "7px", margin: "10px 2px 6px" }}>
                            <span style={{ fontSize: "10.5px", fontWeight: 800, color: TEXT_DIM, fontFamily: "monospace" }}>{cluster.rack}랙</span>
                            <div style={{ flex: 1, height: "1px", background: BORDER }} />
                          </div>
                        ) : null}
                        <div
                          ref={(el) => { whGroupRefs.current[groupKey] = el; }}
                          className={isHighlighted ? "mvp-wh-highlight" : undefined}
                          style={{ border: `1px solid ${BORDER}`, borderRadius: "14px", background: CARD_BG, overflow: "hidden", marginBottom: "10px" }}
                        >
                        <div
                          onClick={() => setWhCollapsed((p) => ({ ...p, [groupKey]: !p[groupKey] }))}
                          style={{
                            display: "flex", alignItems: "center", gap: "8px", padding: "11px 13px",
                            background: isLightMode ? "#f8fafc" : "#111827",
                            borderBottom: isCollapsed ? "none" : `1px solid ${BORDER}`,
                            cursor: "pointer",
                          }}
                        >
                          {isCollapsed ? <ChevronRight size={15} color={TEXT_DIM} /> : <ChevronDown size={15} color={TEXT_DIM} />}
                          <MapPin size={13} color={ACCENT_LIGHT} />
                          <span style={{ fontWeight: 800, fontSize: "13.5px", flex: 1, fontFamily: "monospace", color: TEXT_MAIN }}>{groupKey}</span>
                          <span style={{ fontSize: "11px", fontWeight: 700, color: ACCENT_LIGHT, background: "rgba(37,99,235,0.12)", borderRadius: "20px", padding: "2px 9px" }}>{items.length}개</span>
                        </div>

                        {!isCollapsed ? (
                          <div style={{ padding: "8px" }}>
                            {items.map((item, idx) => {
                              const hasImage = !!item.photo;
                              const imageUrl = hasImage ? getGoogleDriveImageUrl(item.photo) : "";
                              const stockLabel = item.stock === null || item.stock === "N/A" ? "N/A" : `${item.stock}개`;
                              return (
                                <div
                                  key={`wh-${item.rowIndex}-${idx}`}
                                  className="mvp-card"
                                  onClick={() => openItemDetail(item)}
                                  style={{
                                    display: "flex", alignItems: "center", gap: "10px",
                                    padding: "8px", borderRadius: "12px", cursor: "pointer",
                                  }}
                                >
                                  <div
                                    style={{
                                      width: "42px", height: "42px", borderRadius: "9px", overflow: "hidden", flexShrink: 0,
                                      background: isLightMode ? "#f1f5f9" : "#0f172a", display: "flex", alignItems: "center", justifyContent: "center",
                                    }}
                                  >
                                    {hasImage ? (
                                      <img src={imageUrl} alt={item.name} referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                    ) : (
                                      <Package size={18} style={{ opacity: 0.3 }} />
                                    )}
                                  </div>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: "13.5px", fontWeight: 700, color: TEXT_MAIN, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
                                    <div style={{ fontSize: "11.5px", color: TEXT_DIM, marginTop: "2px" }}>재고 {stockLabel}{item.spec ? ` · ${item.spec}` : ""}</div>
                                  </div>
                                  {isAdmin ? (
                                    <button
                                      className="mvp-btn"
                                      onClick={(e) => { e.stopPropagation(); quickEditItem(item); }}
                                      title="바로 편집"
                                      style={{
                                        flexShrink: 0, width: 34, height: 34, borderRadius: "9px",
                                        display: "flex", alignItems: "center", justifyContent: "center",
                                        border: `1px solid ${BORDER}`, background: isLightMode ? "#f1f5f9" : "#0f172a", color: TEXT_DIM,
                                      }}
                                    >
                                      <Pencil size={14} />
                                    </button>
                                  ) : null}
                                  <ChevronRight size={15} color={TEXT_DIM} />
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                      </React.Fragment>
                    );
                  })
                )}
              </>
            ) : (
          <form onSubmit={handleRegisterItemSubmit} style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
              <Package size={20} color="#2563eb" />
              <div style={{ fontSize: "16px", fontWeight: 800, color: TEXT_MAIN }}>
                📦 신규 물품 등록하기
              </div>
            </div>

            {/* 품목명 */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>물품명 *</label>
              <input
                className="mvp-input"
                type="text"
                placeholder="물품 이름을 입력하세요"
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                style={inputBaseStyle}
                required
              />
            </div>

            {/* 위치 선택 */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>보관 위치 *</label>
                <button
                  type="button"
                  onClick={() => setRegIsCustomLoc(!regIsCustomLoc)}
                  style={{
                    fontSize: "11px",
                    color: "#5b6472",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    fontWeight: 700,
                  }}
                >
                  {regIsCustomLoc ? "랙 선택하기" : "위치 직접 입력"}
                </button>
              </div>

              {regIsCustomLoc ? (
                <input
                  className="mvp-input"
                  type="text"
                  placeholder="보관 위치 입력 (예: A-01)"
                  value={regCustomLocation}
                  onChange={(e) => setRegCustomLocation(e.target.value)}
                  style={inputBaseStyle}
                  required
                />
              ) : (
                <div style={{ display: "flex", gap: "8px" }}>
                  <select
                    className="mvp-input"
                    value={regRackId}
                    onChange={(e) => setRegRackId(e.target.value)}
                    style={{
                      ...inputBaseStyle,
                      flex: 1.2,
                      padding: "12px",
                      background: INPUT_BG,
                      color: TEXT_MAIN,
                      border: `1px solid ${BORDER}`,
                      borderRadius: "12px",
                    }}
                  >
                    <option value="" disabled>랙 선택</option>
                    {racks.map((r) => (
                      <option key={r.id} value={r.id}>{r.name || r.id}</option>
                    ))}
                  </select>
                  <input
                    className="mvp-input"
                    type="text"
                    placeholder="선반 (예: 01)"
                    value={regShelf}
                    onChange={(e) => setRegShelf(e.target.value)}
                    style={{ ...inputBaseStyle, flex: 0.8 }}
                    required={!regIsCustomLoc}
                  />
                </div>
              )}
            </div>

            {/* 규격 및 초기 수량 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>규격 (상세 설명)</label>
                <input
                  className="mvp-input"
                  type="text"
                  placeholder="예: 50A"
                  value={regSpec}
                  onChange={(e) => setRegSpec(e.target.value)}
                  style={inputBaseStyle}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>초기 재고수량</label>
                <div style={{ display: "flex", gap: "6px" }}>
                  <input
                    className="mvp-input"
                    type="text"
                    placeholder="수량"
                    value={regStock}
                    onChange={(e) => setRegStock(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    style={{ ...inputBaseStyle, flex: 1 }}
                  />
                  <button
                    type="button"
                    onClick={() => setRegStock("N/A")}
                    style={{
                      padding: "0 12px",
                      background: regStock === "N/A" ? "#2563eb" : "rgba(255,255,255,0.05)",
                      color: regStock === "N/A" ? "#ffffff" : TEXT_DIM,
                      border: `1px solid ${BORDER}`,
                      borderRadius: "12px",
                      fontSize: "11px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    N/A
                  </button>
                </div>
              </div>
            </div>

            {/* 담당자 & 특이사항 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>등록 담당자</label>
                <input
                  className="mvp-input"
                  type="text"
                  placeholder="담당자명"
                  value={regManager}
                  onChange={(e) => setRegManager(e.target.value)}
                  style={inputBaseStyle}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>비고 (참고사항)</label>
                <input
                  className="mvp-input"
                  type="text"
                  placeholder="비고"
                  value={regNote}
                  onChange={(e) => setRegNote(e.target.value)}
                  style={inputBaseStyle}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>🔎 한글 검색어 (선택)</label>
                <input
                  className="mvp-input"
                  type="text"
                  placeholder="예: 물병, 생수 (영어 품목의 한글 별칭)"
                  value={regKeywords}
                  onChange={(e) => setRegKeywords(e.target.value)}
                  style={inputBaseStyle}
                />
              </div>
            </div>

            {/* 사진 등록 (링크 입력 + 파일 직접 업로드) */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>사진 주소 또는 이미지 직접 업로드</label>
              <input
                className="mvp-input"
                type="text"
                placeholder={regPhoto.startsWith("data:image/") ? "파일 직접 촬영/업로드됨" : "구글 드라이브 주소를 입력하거나 아래에서 직접 촬영/업로드하세요"}
                value={regPhoto.startsWith("data:image/") ? "" : regPhoto}
                disabled={regPhoto.startsWith("data:image/")}
                onChange={(e) => setRegPhoto(e.target.value)}
                style={{ ...inputBaseStyle, opacity: regPhoto.startsWith("data:image/") ? 0.6 : 1 }}
              />
              <div
                style={{
                  border: `1px dashed ${BORDER}`,
                  borderRadius: "12px",
                  padding: "12px",
                  textAlign: "center",
                  background: isLightMode ? "#f8fafc" : "rgba(255, 255, 255, 0.02)",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "6px",
                  marginTop: "4px"
                }}
                onClick={() => document.getElementById("mobile-reg-photo-upload")?.click()}
              >
                <input
                  type="file"
                  id="mobile-reg-photo-upload"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={handleRegPhotoChange}
                />
                {regPhoto && regPhoto.startsWith("data:image/") ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", width: "100%", justifyContent: "center" }}>
                    <img
                      src={regPhoto}
                      alt="Uploaded Preview"
                      style={{ width: "38px", height: "38px", borderRadius: "6px", objectFit: "cover" }}
                    />
                    <div style={{ textAlign: "left" }}>
                      <span style={{ fontSize: "12px", fontWeight: 700, color: "#5b6472", display: "block" }}>
                        📸 이미지 업로드 준비 완료
                      </span>
                      <span style={{ fontSize: "10px", color: TEXT_DIM, display: "block" }}>
                        등록 완료 시 드라이브 폴더에 자동 저장됩니다.
                      </span>
                    </div>
                    <button
                      type="button"
                      className="mvp-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRegPhoto("");
                      }}
                      style={{
                        marginLeft: "auto",
                        background: "rgba(239, 68, 68, 0.15)",
                        color: "#ef4444",
                        border: "none",
                        borderRadius: "6px",
                        padding: "4px 8px",
                        fontSize: "11px",
                        fontWeight: 700
                      }}
                    >
                      삭제
                    </button>
                  </div>
                ) : isRegUploadingImage ? (
                  <span style={{ fontSize: "12px", color: TEXT_DIM }}>이미지 가져오는 중...</span>
                ) : (
                  <>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <Camera size={16} style={{ color: TEXT_DIM }} />
                      <span style={{ fontSize: "12.5px", fontWeight: 700, color: TEXT_MAIN }}>사진 직접 찍기 / 이미지 파일 업로드</span>
                    </div>
                    <span style={{ fontSize: "10px", color: TEXT_DIM }}>
                      (지정 드라이브 폴더에 오브젝트 이름으로 저장됩니다)
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* 구매 링크 */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>구매 링크</label>
              <input
                className="mvp-input"
                type="text"
                placeholder="URL 주소 (기본값: N/A)"
                value={regLink}
                onChange={(e) => setRegLink(e.target.value)}
                style={inputBaseStyle}
              />
            </div>

            <button
              type="submit"
              className="mvp-btn"
              disabled={regSubmitting}
              style={{
                width: "100%",
                padding: "15px",
                borderRadius: "14px",
                background: "#2563eb",
                color: "#ffffff",
                fontSize: "15px",
                fontWeight: 800,
                marginTop: "10px",
                boxShadow: "0 6px 20px rgba(37, 99, 235,0.25)",
              }}
            >
              {regSubmitting ? "실시간 클라우드 등록 중..." : "📦 신규 물품 정식 등록"}
            </button>
          </form>
            )}
          </>
        ) : mode === "시나리오" ? (
          /* =========================================================
             3-B. 시나리오 물품 관리 (같은 영역에서 탭으로 전환, 페이지 이동 없음)
             ========================================================= */
          <>
            {/* 서브 탭: 공구 및 부품류 탭과 동일한 구조 (스크롤해도 고정) */}
            <style>{`@keyframes mvpInvSpin { to { transform: rotate(360deg); } } .mvp-inv-spin { animation: mvpInvSpin 0.9s linear infinite; }`}</style>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "6px" }}>
              <button
                className="mvp-btn"
                onClick={() => loadScenarioItems(true)}
                disabled={sciLoading}
                style={{
                  display: "flex", alignItems: "center", gap: "5px",
                  padding: "7px 12px", borderRadius: "9px",
                  border: `1px solid ${BORDER}`, background: CARD_BG, color: ACCENT_LIGHT,
                  fontSize: "11.5px", fontWeight: 700, opacity: sciLoading ? 0.7 : 1,
                }}
              >
                <RotateCcw size={13} className={sciLoading ? "mvp-inv-spin" : undefined} /> 새로고침
              </button>
            </div>
            <div style={subTabBarStyle}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "4px",
                background: isLightMode ? "#f1f5f9" : "#111827",
                padding: "4px",
                borderRadius: "12px",
              }}
            >
              <button
                className="mvp-btn"
                onClick={() => { setScenarioTab("list"); setSciEditing(false); }}
                style={{
                  padding: "9px", borderRadius: "9px", fontSize: "12.5px", fontWeight: 700,
                  background: scenarioTab === "list" ? TEXT_MAIN : "transparent",
                  color: scenarioTab === "list" ? BG : TEXT_DIM,
                }}
              >
                📋 목록 보기 ({filteredScenarioItems.length})
              </button>
              <button
                className="mvp-btn"
                onClick={openSciNew}
                style={{
                  padding: "9px", borderRadius: "9px", fontSize: "12.5px", fontWeight: 700,
                  background: scenarioTab === "register" ? TEXT_MAIN : "transparent",
                  color: scenarioTab === "register" ? BG : TEXT_DIM,
                }}
              >
                ➕ 새 물품 등록
              </button>
            </div>
            </div>

            {scenarioTab === "list" ? (
              sciLoading && !sciLoaded ? (
                <div style={{ marginTop: "40px", textAlign: "center", color: TEXT_DIM, fontSize: "13px" }}>
                  불러오는 중...
                </div>
              ) : filteredScenarioItems.length === 0 ? (
                <div style={{ marginTop: "40px", textAlign: "center", color: TEXT_DIM, fontSize: "13px" }}>
                  <Package size={36} style={{ margin: "0 auto 10px", opacity: 0.4 }} />
                  등록된 시나리오 물품이 없습니다.
                </div>
              ) : (
                filteredScenarioItems.map((item, idx) => {
                  const hasImage = !!item.image;
                  const imageUrl = hasImage ? getGoogleDriveImageUrl(item.image) : "";
                  return (
                    <div
                      key={`sci-${item.rowIndex}-${idx}`}
                      className="mvp-card"
                      onClick={() => openSciEdit(item)}
                      style={{
                        background: CARD_BG,
                        border: `1px solid ${BORDER}`,
                        borderRadius: "16px",
                        padding: "10px",
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        cursor: "pointer",
                        marginBottom: "8px",
                      }}
                    >
                      <div
                        style={{
                          width: "48px", height: "48px", borderRadius: "10px", overflow: "hidden", flexShrink: 0,
                          background: isLightMode ? "#f1f5f9" : "#0f172a", display: "flex", alignItems: "center", justifyContent: "center",
                        }}
                      >
                        {hasImage ? (
                          <img src={imageUrl} alt={item.name} referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : (
                          <Package size={20} style={{ opacity: 0.3 }} />
                        )}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "14px", fontWeight: 700, color: TEXT_MAIN, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
                        <div style={{ fontSize: "12px", color: TEXT_DIM, marginTop: "2px" }}>
                          ID {item.id} · {item.rootSlot || "위치 없음"} · 재고 {item.stock ?? 0} · 대여 중 {item.rented ?? 0}
                        </div>
                      </div>
                      <ChevronRight size={16} color={TEXT_DIM} />
                    </div>
                  );
                })
              )
            ) : (
              <form onSubmit={handleSciSubmit} style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                  <Package size={20} color="#2563eb" />
                  <div style={{ fontSize: "16px", fontWeight: 800, color: TEXT_MAIN }}>
                    {sciEditing ? "✏️ 시나리오 물품 수정" : "📦 신규 시나리오 물품 등록"}
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>물품명 *</label>
                  <input className="mvp-input" type="text" required placeholder="물품 이름을 입력하세요"
                    value={sciForm.name} onChange={(e) => setSciForm((f) => ({ ...f, name: e.target.value }))} style={inputBaseStyle} />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>물품 ID</label>
                    <input className="mvp-input" type="text" inputMode="numeric" placeholder="예: 000123"
                      value={sciForm.id} onChange={(e) => setSciForm((f) => ({ ...f, id: e.target.value }))}
                      onBlur={(e) => setSciForm((f) => ({ ...f, id: e.target.value.trim() ? padSlot(e.target.value.trim()) : "" }))}
                      style={inputBaseStyle} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>위치(root slot)</label>
                    <input className="mvp-input" type="text" inputMode="numeric" placeholder="예: 000060"
                      value={sciForm.rootSlot} onChange={(e) => setSciForm((f) => ({ ...f, rootSlot: e.target.value }))}
                      onBlur={(e) => setSciForm((f) => ({ ...f, rootSlot: e.target.value.trim() ? padSlot(e.target.value.trim()) : "" }))}
                      style={inputBaseStyle} />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>카테고리</label>
                      <button type="button" onClick={() => setSciCatCustom((v) => !v)} style={{ background: "none", border: "none", color: ACCENT_LIGHT, fontSize: "11px", fontWeight: 700, cursor: "pointer", padding: 0 }}>
                        {sciCatCustom ? "목록에서 선택" : "직접 입력"}
                      </button>
                    </div>
                    {sciCatCustom ? (
                      <input className="mvp-input" type="text" placeholder="새 카테고리 이름"
                        value={sciForm.category} onChange={(e) => setSciForm((f) => ({ ...f, category: e.target.value }))} style={inputBaseStyle} />
                    ) : (
                      <div style={{ position: "relative" }}>
                        <select
                          className="mvp-input"
                          value={sciCategories.includes(sciForm.category || "") ? sciForm.category : ""}
                          onChange={(e) => setSciForm((f) => ({ ...f, category: e.target.value }))}
                          style={{ ...inputBaseStyle, appearance: "none", WebkitAppearance: "none", paddingRight: "34px" }}
                        >
                          <option value="">선택 안 함</option>
                          {sciCategories.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <ChevronDown size={16} color={TEXT_DIM} style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>서브 카테고리</label>
                      <button type="button" onClick={() => setSciSubcatCustom((v) => !v)} style={{ background: "none", border: "none", color: ACCENT_LIGHT, fontSize: "11px", fontWeight: 700, cursor: "pointer", padding: 0 }}>
                        {sciSubcatCustom ? "목록에서 선택" : "직접 입력"}
                      </button>
                    </div>
                    {sciSubcatCustom ? (
                      <input className="mvp-input" type="text" placeholder="새 서브카테고리 이름"
                        value={sciForm.subcategory} onChange={(e) => setSciForm((f) => ({ ...f, subcategory: e.target.value }))} style={inputBaseStyle} />
                    ) : (
                      <div style={{ position: "relative" }}>
                        <select
                          className="mvp-input"
                          value={sciSubcategoriesForCategory.includes(sciForm.subcategory || "") ? sciForm.subcategory : ""}
                          onChange={(e) => setSciForm((f) => ({ ...f, subcategory: e.target.value }))}
                          style={{ ...inputBaseStyle, appearance: "none", WebkitAppearance: "none", paddingRight: "34px" }}
                        >
                          <option value="">선택 안 함</option>
                          {sciSubcategoriesForCategory.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <ChevronDown size={16} color={TEXT_DIM} style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>재고</label>
                    <input className="mvp-input" type="number" min={0}
                      value={sciForm.stock} onChange={(e) => setSciForm((f) => ({ ...f, stock: Math.max(0, Number(e.target.value)) }))} style={inputBaseStyle} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>구역(sector)</label>
                      <button type="button" onClick={() => setSciSectorCustom((v) => !v)} style={{ background: "none", border: "none", color: ACCENT_LIGHT, fontSize: "11px", fontWeight: 700, cursor: "pointer", padding: 0 }}>
                        {sciSectorCustom ? "목록에서 선택" : "직접 입력"}
                      </button>
                    </div>
                    {sciSectorCustom ? (
                      <input className="mvp-input" type="text" placeholder="예: Seoul-Root"
                        value={sciForm.sector} onChange={(e) => setSciForm((f) => ({ ...f, sector: e.target.value }))} style={inputBaseStyle} />
                    ) : (
                      <div style={{ position: "relative" }}>
                        <select
                          className="mvp-input"
                          value={sciSectors.includes(sciForm.sector || "") ? sciForm.sector : ""}
                          onChange={(e) => setSciForm((f) => ({ ...f, sector: e.target.value }))}
                          style={{ ...inputBaseStyle, appearance: "none", WebkitAppearance: "none", paddingRight: "34px" }}
                        >
                          <option value="">선택 안 함</option>
                          {sciSectors.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <ChevronDown size={16} color={TEXT_DIM} style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
                      </div>
                    )}
                  </div>
                </div>

                {/* 사진 */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>사진</label>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{ width: "60px", height: "60px", borderRadius: "12px", overflow: "hidden", flexShrink: 0, background: isLightMode ? "#f1f5f9" : "#0f172a", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {sciForm.image ? (
                        <img src={getGoogleDriveImageUrl(sciForm.image)} alt="" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <Package size={22} style={{ opacity: 0.3 }} />
                      )}
                    </div>
                    <label
                      style={{ flex: 1, padding: "11px", borderRadius: "12px", border: `1px dashed ${BORDER}`, textAlign: "center", fontSize: "12.5px", fontWeight: 700, color: TEXT_DIM, cursor: "pointer" }}
                    >
                      {sciUploading ? "처리 중..." : sciForm.image ? "사진 변경" : "사진 선택 / 촬영"}
                      <input type="file" accept="image/*" style={{ display: "none" }}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleSciPhoto(f); e.currentTarget.value = ""; }} />
                    </label>
                  </div>
                </div>

                {/* 랭킹 제외 */}
                <label style={{ display: "flex", alignItems: "center", gap: "10px", padding: "11px 12px", borderRadius: "12px", border: `1px solid ${BORDER}`, background: CARD_BG }}>
                  <input type="checkbox" checked={!!sciForm.excludeFromRanking}
                    onChange={(e) => setSciForm((f) => ({ ...f, excludeFromRanking: e.target.checked }))} />
                  <span style={{ fontSize: "12.5px", fontWeight: 600, color: TEXT_MAIN }}>
                    "가장 적게 대여된 물품" 랭킹에서 제외
                  </span>
                </label>

                {/* 깨질 위험 */}
                <label style={{ display: "flex", alignItems: "center", gap: "10px", padding: "11px 12px", borderRadius: "12px", border: `1px solid ${sciForm.fragile ? AMBER : BORDER}`, background: sciForm.fragile ? "rgba(245,158,11,0.1)" : CARD_BG }}>
                  <input type="checkbox" checked={!!sciForm.fragile}
                    onChange={(e) => setSciForm((f) => ({ ...f, fragile: e.target.checked }))} />
                  <span style={{ fontSize: "12.5px", fontWeight: 600, color: sciForm.fragile ? AMBER : TEXT_MAIN }}>
                    🔺 깨질 위험이 있는 물품
                  </span>
                </label>

                {/* 화재 위험 */}
                <label style={{ display: "flex", alignItems: "center", gap: "10px", padding: "11px 12px", borderRadius: "12px", border: `1px solid ${sciForm.fireRisk ? DANGER : BORDER}`, background: sciForm.fireRisk ? "rgba(239,68,68,0.1)" : CARD_BG }}>
                  <input type="checkbox" checked={!!sciForm.fireRisk}
                    onChange={(e) => setSciForm((f) => ({ ...f, fireRisk: e.target.checked }))} />
                  <span style={{ fontSize: "12.5px", fontWeight: 600, color: sciForm.fireRisk ? DANGER : TEXT_MAIN }}>
                    🔥 화재 위험이 있는 물품
                  </span>
                </label>

                {/* 보관 처리 — 파손 등으로 오브젝트로 쓰기 어려운 물품을 목록·대여 카탈로그에서 치워둔다 */}
                <label style={{ display: "flex", alignItems: "center", gap: "10px", padding: "11px 12px", borderRadius: "12px", border: `1px solid ${sciForm.archived ? AMBER : BORDER}`, background: sciForm.archived ? "rgba(245,158,11,0.10)" : CARD_BG }}>
                  <input
                    type="checkbox"
                    checked={!!sciForm.archived}
                    onChange={(e) => setSciForm((f) => ({ ...f, archived: e.target.checked }))}
                  />
                  <span style={{ fontSize: "12.5px", fontWeight: 600, color: sciForm.archived ? AMBER : TEXT_MAIN }}>
                    🗄️ 보관 처리 (파손 등으로 사용 불가 — 목록·대여 카탈로그에서 제외됩니다)
                  </span>
                </label>

                {/* 개인 물품 — 체크하면 소유자 이름 입력창이 나타난다 */}
                <div style={{ padding: "11px 12px", borderRadius: "12px", border: `1px solid ${sciForm.personalOwner !== undefined ? ACCENT : BORDER}`, background: CARD_BG }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <input
                      type="checkbox"
                      checked={sciForm.personalOwner !== undefined}
                      onChange={(e) => setSciForm((f) => ({ ...f, personalOwner: e.target.checked ? "" : undefined }))}
                    />
                    <span style={{ fontSize: "12.5px", fontWeight: 600, color: sciForm.personalOwner !== undefined ? ACCENT_LIGHT : TEXT_MAIN }}>
                      👤 개인 물품
                    </span>
                  </label>
                  {sciForm.personalOwner !== undefined ? (
                    <input
                      className="mvp-input"
                      type="text"
                      value={sciForm.personalOwner}
                      onChange={(e) => setSciForm((f) => ({ ...f, personalOwner: e.target.value }))}
                      placeholder="소유자 이름을 입력하세요"
                      style={{ ...inputBaseStyle, marginTop: "9px" }}
                    />
                  ) : null}
                </div>

                {/* 특정 업체 request용 물품 — 체크하면 업체명 입력창이 나타난다 */}
                <div style={{ padding: "11px 12px", borderRadius: "12px", border: `1px solid ${sciForm.requestFor !== undefined ? ACCENT : BORDER}`, background: CARD_BG }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <input
                      type="checkbox"
                      checked={sciForm.requestFor !== undefined}
                      onChange={(e) => setSciForm((f) => ({ ...f, requestFor: e.target.checked ? "" : undefined }))}
                    />
                    <span style={{ fontSize: "12.5px", fontWeight: 600, color: sciForm.requestFor !== undefined ? ACCENT_LIGHT : TEXT_MAIN }}>
                      📌 특정 업체 request용 물품
                    </span>
                  </label>
                  {sciForm.requestFor !== undefined ? (
                    <input
                      className="mvp-input"
                      type="text"
                      value={sciForm.requestFor}
                      onChange={(e) => setSciForm((f) => ({ ...f, requestFor: e.target.value }))}
                      placeholder="업체명을 입력하세요 (예: OO전자)"
                      style={{ ...inputBaseStyle, marginTop: "9px" }}
                    />
                  ) : null}
                </div>

                <div style={{ display: "flex", gap: "8px" }}>
                  {sciEditing ? (
                    <button type="button" onClick={handleSciDelete} disabled={sciSaving}
                      style={{ flex: 1, padding: "15px", borderRadius: "14px", background: "transparent", border: `1px solid ${DANGER}`, color: DANGER, fontSize: "14px", fontWeight: 800 }}>
                      삭제
                    </button>
                  ) : null}
                  <button type="submit" disabled={sciSaving || sciUploading}
                    style={{ flex: 2, padding: "15px", borderRadius: "14px", background: "#2563eb", color: "#ffffff", fontSize: "15px", fontWeight: 800, boxShadow: "0 6px 20px rgba(37, 99, 235,0.25)" }}>
                    {sciSaving ? "저장 중..." : sciEditing ? "수정 저장하기" : "물품 등록하기"}
                  </button>
                </div>
              </form>
            )}
          </>
        ) : (
          /* =========================================================
             4. 불량 제품 관리 및 등록 (Admin 모바일 전용)
             ========================================================= */
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            {/* 불량 탭 내부 서브 탭 스위처 */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "4px",
                background: isLightMode ? "#f1f5f9" : "#111827",
                padding: "3px",
                borderRadius: "10px",
              }}
            >
              <button
                type="button"
                className="mvp-btn"
                onClick={() => setDefectTab("list")}
                style={{
                  padding: "8px",
                  borderRadius: "8px",
                  fontSize: "12.5px",
                  fontWeight: 700,
                  background: defectTab === "list" ? AMBER : "transparent",
                  color: defectTab === "list" ? "#ffffff" : TEXT_DIM,
                }}
              >
                📜 불량 대장 ({defectLogs.length}건)
              </button>
              <button
                type="button"
                className="mvp-btn"
                onClick={() => { setDefectTab("register"); setDefListOpen(true); }}
                style={{
                  padding: "8px",
                  borderRadius: "8px",
                  fontSize: "12.5px",
                  fontWeight: 700,
                  background: defectTab === "register" ? AMBER : "transparent",
                  color: defectTab === "register" ? "#ffffff" : TEXT_DIM,
                }}
              >
                ⚠️ 불량품 등록
              </button>
            </div>

            {defectTab === "list" ? (
              /* 4-A. 불량 로그 목록 */
              filteredDefectLogs.length === 0 ? (
                <div style={{ marginTop: "40px", textAlign: "center", color: TEXT_DIM, fontSize: "13px" }}>
                  <Check size={36} style={{ margin: "0 auto 10px", opacity: 0.4 }} />
                  {searchQuery ? "검색 결과와 일치하는 불량 내역이 없습니다." : "기록된 불량 내역이 존재하지 않습니다."}
                </div>
              ) : (
                [...filteredDefectLogs]
                  .sort((a, b) => compareDatesDescending(a.timestamp, b.timestamp))
                  .map((log, index) => {
                    // 불량 유형별 색상 (PC 버전 DefectLogsPage와 동일한 매핑)
                    let typeBg = "rgba(148, 163, 184, 0.15)";
                    let typeColor = TEXT_DIM;
                    const typeVal = log.defectType || "기타";
                    if (typeVal === "파손") { typeBg = "rgba(244, 63, 94, 0.15)"; typeColor = DANGER; }
                    else if (typeVal === "오염") { typeBg = "rgba(245, 158, 11, 0.15)"; typeColor = "#f59e0b"; }
                    else if (typeVal === "기능 오작동" || typeVal === "기능 이상") { typeBg = "rgba(37, 99, 235, 0.15)"; typeColor = ACCENT; }
                    else if (typeVal === "수량 상이") { typeBg = "rgba(16, 185, 129, 0.15)"; typeColor = "#10b981"; }
                    else if (typeVal === "누락") { typeBg = "rgba(239, 68, 68, 0.15)"; typeColor = "#ef4444"; }

                    return (
                    <div
                      key={log.rowIndex || index}
                      style={{
                        background: CARD_BG,
                        border: `1px solid ${BORDER}`,
                        borderRadius: "16px",
                        padding: "14px",
                        display: "flex",
                        gap: "12px",
                      }}
                    >
                      {/* 사진 썸네일 (PC 버전과 동일하게 탭하면 확대) */}
                      <div
                        onClick={() => log.photo && setLightbox(log.photo!)}
                        style={{
                          width: "56px",
                          height: "56px",
                          borderRadius: "10px",
                          overflow: "hidden",
                          background: isLightMode ? "#f1f5f9" : "#0f172a",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                          cursor: log.photo ? "zoom-in" : "default",
                        }}
                      >
                        {log.photo ? (
                          <img src={log.photo} alt="불량 이미지" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : (
                          <ImageOff size={20} style={{ color: TEXT_DIM, opacity: 0.5 }} />
                        )}
                      </div>

                      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                        <span style={{ fontSize: "14px", fontWeight: 800, color: TEXT_MAIN }}>
                          {log.name}
                        </span>
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 800,
                            color: typeColor,
                            background: typeBg,
                            padding: "2px 7px",
                            borderRadius: "5px",
                            flexShrink: 0,
                            border: `1px solid ${typeColor}33`,
                          }}
                        >
                          {typeVal}
                        </span>
                      </div>

                      <div style={{ display: "flex", gap: "8px", fontSize: "11px", color: TEXT_DIM, flexWrap: "wrap" }}>
                        <span>📍 {log.location}</span>
                        <span>·</span>
                        <span>📦 {log.qty}개</span>
                        <span>·</span>
                        <span>👤 {log.manager}</span>
                      </div>

                      {log.note && (
                        <div
                          style={{
                            fontSize: "12px",
                            color: TEXT_DIM,
                            background: isLightMode ? "#f8fafc" : "rgba(255,255,255,0.03)",
                            padding: "8px 10px",
                            borderRadius: "8px",
                            borderLeft: `3px solid ${AMBER}`,
                            marginTop: "4px",
                          }}
                        >
                          {log.note}
                        </div>
                      )}


                      <div
                        style={{
                          fontSize: "11px",
                          fontWeight: 700,
                          color: GREEN,
                          alignSelf: "flex-start",
                          background: "rgba(16,185,129,0.08)",
                          padding: "3px 6px",
                          borderRadius: "4px",
                          marginTop: "2px",
                        }}
                      >
                        ✅ {log.actionTaken || "조치 예정"}
                      </div>

                      <div style={{ fontSize: "9.5px", color: TEXT_DIM, alignSelf: "flex-end", marginTop: "2px" }}>
                        📅 {log.timestamp}
                      </div>
                      </div>
                    </div>
                    );
                  })
              )
            ) : (
              /* 4-B. 불량 제품 등록 폼 */
              <form onSubmit={handleRegisterDefectSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                {/* 분류 선택: 공구 및 부품류 vs 로봇 오브젝트 */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "4px",
                    background: isLightMode ? "#f1f5f9" : "#111827",
                    padding: "4px",
                    borderRadius: "12px",
                  }}
                >
                  <button
                    type="button"
                    className="mvp-btn"
                    onClick={() => { setDefItemCategory("rack"); setDefSelectedInvIndex(-1); setDefCustomName(""); setDefCustomLoc(""); setDefSearch(""); }}
                    style={{
                      padding: "9px",
                      borderRadius: "9px",
                      fontSize: "12.5px",
                      fontWeight: 700,
                      background: defItemCategory === "rack" ? TEXT_MAIN : "transparent",
                      color: defItemCategory === "rack" ? BG : TEXT_DIM,
                    }}
                  >
                    🧰 공구 및 부품류
                  </button>
                  <button
                    type="button"
                    className="mvp-btn"
                    onClick={() => { setDefItemCategory("robot"); setDefSearch(""); setDefSelectedInvIndex(-1); setDefCustomName(""); setDefCustomLoc(""); setDefListOpen(true); setDefSelectedInvIndex(-1); setDefCustomName(""); setDefCustomLoc(""); setDefSearch(""); }}
                    style={{
                      padding: "9px",
                      borderRadius: "9px",
                      fontSize: "12.5px",
                      fontWeight: 700,
                      background: defItemCategory === "robot" ? TEXT_MAIN : "transparent",
                      color: defItemCategory === "robot" ? BG : TEXT_DIM,
                    }}
                  >
                    🤖 로봇 오브젝트
                  </button>
                </div>

                {/* 품목 선택: 검색하면 실시간으로 후보가 뜨고, 없으면 그 자리에서 직접 입력으로 넘어간다 */}
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>품목 고르기</label>
                  <div style={{ position: "relative" }}>
                    <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: TEXT_DIM }} />
                    <input
                      className="mvp-input"
                      type="text"
                      placeholder={defItemCategory === "rack" ? "물품명·위치로 검색" : "로봇 오브젝트 검색 (이름, 규격 등)"}
                      value={defSearch}
                      onChange={(e) => {
                        setDefSearch(e.target.value);
                        setDefListOpen(true);
                        // 검색어를 바꾸면 기존 선택은 해제 (선택했다고 착각하는 것 방지)
                        if (defSelectedInvIndex !== -1) { setDefSelectedInvIndex(-1); setDefCustomName(""); setDefCustomLoc(""); }
                      }}
                      onFocus={() => setDefListOpen(true)}
                      style={{ ...inputBaseStyle, paddingLeft: "36px", border: `1px solid ${defSelectedInvIndex !== -1 ? ACCENT : BORDER}` }}
                    />
                  </div>

                  {/* 선택 완료 표시 */}
                  {defSelectedInvIndex !== -1 && !defListOpen ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "11px 12px", borderRadius: "12px", background: `${ACCENT}14`, border: `1px solid ${ACCENT}44` }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "13.5px", fontWeight: 700, color: TEXT_MAIN, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{defCustomName}</div>
                        <div style={{ fontSize: "11.5px", color: TEXT_DIM, marginTop: "2px" }}>📍 {defCustomLoc || "위치 지정되지 않음"}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setDefSelectedInvIndex(-1); setDefCustomName(""); setDefCustomLoc(""); setDefSearch(""); setDefListOpen(true); }}
                        style={{ background: "transparent", border: "none", color: ACCENT, fontSize: "12px", fontWeight: 800, flexShrink: 0 }}
                      >
                        변경
                      </button>
                    </div>
                  ) : null}

                  {/* 실시간 후보 목록 */}
                  {defListOpen ? (() => {
                    const source: any[] = defItemCategory === "rack" ? inventory : robotObjects;
                    const matched = source
                      .map((item, idx) => ({ item, idx }))
                      .filter(({ item }) => !defSearch.trim() || smartMatch([item.name, item.location, item.spec, item.keywords], defSearch));
                    const shown = matched.slice(0, 40);
                    return (
                      <div style={{ border: `1px solid ${BORDER}`, borderRadius: "12px", overflow: "hidden", background: CARD_BG }}>
                        {shown.length > 0 ? (
                          <div style={{ maxHeight: "230px", overflowY: "auto" }}>
                            {shown.map(({ item, idx }) => (
                              <div
                                key={idx}
                                onClick={() => {
                                  setDefSelectedInvIndex(idx);
                                  setDefCustomName(item.name);
                                  setDefCustomLoc(item.location || "");
                                  setDefSearch(item.name);
                                  setDefListOpen(false);
                                }}
                                style={{
                                  padding: "11px 12px",
                                  borderBottom: `1px solid ${BORDER}`,
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "8px",
                                  cursor: "pointer",
                                  background: defSelectedInvIndex === idx ? `${ACCENT}14` : "transparent",
                                }}
                              >
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: "13px", fontWeight: 700, color: TEXT_MAIN, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {item.name}{item.spec ? <span style={{ color: TEXT_DIM, fontWeight: 500 }}> [{item.spec}]</span> : null}
                                  </div>
                                  {item.location ? <div style={{ fontSize: "11.5px", color: TEXT_DIM, marginTop: "2px" }}>{item.location}</div> : null}
                                </div>
                                <ChevronRight size={15} color={TEXT_DIM} />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div style={{ padding: "18px 14px", textAlign: "center" }}>
                            <div style={{ fontSize: "12.5px", color: TEXT_DIM, marginBottom: "12px" }}>일치하는 품목이 없습니다.</div>
                            <button
                              type="button"
                              onClick={() => {
                                setDefSelectedInvIndex(-1);
                                setDefCustomName(defSearch.trim());
                                setDefCustomLoc("");
                                setDefListOpen(false);
                              }}
                              disabled={!defSearch.trim()}
                              style={{
                                padding: "10px 16px", borderRadius: "12px",
                                border: `1px solid ${AMBER}`, background: "rgba(245,158,11,0.12)",
                                color: AMBER, fontSize: "12.5px", fontWeight: 800,
                                opacity: defSearch.trim() ? 1 : 0.5,
                              }}
                            >
                              {defSearch.trim() ? `"${defSearch.trim()}"(으)로 직접 입력` : "이름을 먼저 입력하세요"}
                            </button>
                          </div>
                        )}
                        {shown.length > 0 && matched.length > shown.length ? (
                          <div style={{ padding: "8px 12px", fontSize: "11px", color: TEXT_DIM, textAlign: "center", borderTop: `1px solid ${BORDER}` }}>
                            상위 {shown.length}개 표시 · 총 {matched.length}개 — 검색어를 더 입력해 좁혀보세요
                          </div>
                        ) : null}
                      </div>
                    );
                  })() : null}
                </div>

                {/* 직접 입력을 택했을 때만 물품명/위치 입력을 노출한다 (검색 중에는 숨김) */}
                {defSelectedInvIndex === -1 && !defListOpen ? (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>물품명 *</label>
                      <input
                        className="mvp-input"
                        type="text"
                        placeholder="이름 입력"
                        value={defCustomName}
                        onChange={(e) => setDefCustomName(e.target.value)}
                        style={inputBaseStyle}
                        required
                      />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>보관 위치 *</label>
                      <input
                        className="mvp-input"
                        type="text"
                        placeholder="위치 입력"
                        value={defCustomLoc}
                        onChange={(e) => setDefCustomLoc(e.target.value)}
                        style={inputBaseStyle}
                        required
                      />
                    </div>
                  </div>
                ) : null}

                {/* 수량 */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>불량 수량 *</label>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <button
                      type="button"
                      className="mvp-btn"
                      onClick={() => setDefQty((q) => Math.max(1, q - 1))}
                      style={{
                        width: "44px",
                        height: "44px",
                        borderRadius: "12px",
                        background: isLightMode ? "#e2e8f0" : "#1e293b",
                        color: TEXT_MAIN,
                        fontSize: "18px",
                        fontWeight: "bold",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Minus size={16} />
                    </button>
                    <input
                      className="mvp-input"
                      type="number"
                      value={defQty}
                      onChange={(e) => setDefQty(Math.max(1, Number(e.target.value)))}
                      style={{ ...inputBaseStyle, flex: 1, textAlign: "center" }}
                      required
                    />
                    <button
                      type="button"
                      className="mvp-btn"
                      onClick={() => setDefQty((q) => q + 1)}
                      style={{
                        width: "44px",
                        height: "44px",
                        borderRadius: "12px",
                        background: isLightMode ? "#e2e8f0" : "#1e293b",
                        color: TEXT_MAIN,
                        fontSize: "18px",
                        fontWeight: "bold",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                </div>

                {/* 불량 유형 */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>불량 유형</label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {["파손", "부식", "기능 오작동", "오염", "기타"].map((type) => (
                      <button
                        key={type}
                        type="button"
                        className="mvp-btn"
                        onClick={() => setDefType(type)}
                        style={{
                          padding: "8px 12px",
                          borderRadius: "8px",
                          fontSize: "12px",
                          fontWeight: 700,
                          background: defType === type ? AMBER : (isLightMode ? "#e2e8f0" : "#1e293b"),
                          color: defType === type ? "#ffffff" : TEXT_MAIN,
                          border: `1px solid ${BORDER}`,
                        }}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 접수자 */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>불량 접수자</label>
                  <input
                    className="mvp-input"
                    type="text"
                    placeholder="접수 담당자 이름"
                    value={defManager}
                    onChange={(e) => setDefManager(e.target.value)}
                    style={inputBaseStyle}
                    required
                  />
                </div>

                {/* 상세 내역 */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>상세 불량 내용</label>
                  <input
                    className="mvp-input"
                    type="text"
                    placeholder="현상 및 고장 정보 입력"
                    value={defNote}
                    onChange={(e) => setDefNote(e.target.value)}
                    style={inputBaseStyle}
                  />
                </div>

                {/* 후속 조치 */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>조치 예정 사항</label>
                  <input
                    className="mvp-input"
                    type="text"
                    placeholder="예: 폐기 대기, AS 접수 예정"
                    value={defActionTaken}
                    onChange={(e) => setDefActionTaken(e.target.value)}
                    style={inputBaseStyle}
                  />
                </div>

                {/* 파손자 — 로봇 오브젝트일 때만 */}
                {defItemCategory === "robot" ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>🙋 파손자</label>
                    <input
                      className="mvp-input"
                      type="text"
                      value={defCulprit}
                      onChange={(e) => setDefCulprit(e.target.value)}
                      placeholder="파손시킨 사람의 이름 (모르면 비워두세요)"
                      style={inputBaseStyle}
                    />
                  </div>
                ) : null}

                {/* 불량 사진 직접 촬영 / 업로드 */}
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: TEXT_DIM }}>불량 사진 직접 촬영 / 업로드</label>
                  <div
                    style={{
                      border: `1px dashed ${BORDER}`,
                      borderRadius: "12px",
                      padding: "12px",
                      textAlign: "center",
                      background: isLightMode ? "#f8fafc" : "rgba(255, 255, 255, 0.02)",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: "6px",
                      marginTop: "4px"
                    }}
                    onClick={() => document.getElementById("mobile-def-photo-upload")?.click()}
                  >
                    <input
                      type="file"
                      id="mobile-def-photo-upload"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={handleDefPhotoChange}
                    />
                    {defPhoto ? (
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", width: "100%", justifyContent: "center" }}>
                        <img
                          src={defPhoto}
                          alt="Defect Preview"
                          style={{ width: "38px", height: "38px", borderRadius: "6px", objectFit: "cover" }}
                        />
                        <div style={{ textAlign: "left" }}>
                          <span style={{ fontSize: "12px", fontWeight: 700, color: AMBER, display: "block" }}>
                            📸 불량 사진 등록 완료
                          </span>
                          <span style={{ fontSize: "10px", color: TEXT_DIM, display: "block" }}>
                            접수 시 구글 드라이브에 자동 등록됩니다.
                          </span>
                        </div>
                        <button
                          type="button"
                          className="mvp-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDefPhoto("");
                          }}
                          style={{
                            marginLeft: "auto",
                            background: "rgba(239, 68, 68, 0.15)",
                            color: "#ef4444",
                            border: "none",
                            borderRadius: "6px",
                            padding: "4px 8px",
                            fontSize: "11px",
                            fontWeight: 700
                          }}
                        >
                          삭제
                        </button>
                      </div>
                    ) : isDefUploadingImage ? (
                      <span style={{ fontSize: "12px", color: TEXT_DIM }}>이미지 로드 중...</span>
                    ) : (
                      <>
                        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                          <Camera size={16} style={{ color: TEXT_DIM }} />
                          <span style={{ fontSize: "12.5px", fontWeight: 700, color: TEXT_MAIN }}>불량 사진 직접 찍기 / 이미지 파일 업로드</span>
                        </div>
                        <span style={{ fontSize: "10px", color: TEXT_DIM }}>
                          (자동으로 연동된 구글 드라이브 폴더에 업로드되어 실시간 연동됩니다)
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <button
                  type="submit"
                  className="mvp-btn"
                  disabled={defectSubmitting}
                  style={{
                    width: "100%",
                    padding: "15px",
                    borderRadius: "14px",
                    background: AMBER,
                    color: "#ffffff",
                    fontSize: "15px",
                    fontWeight: 800,
                    boxShadow: "0 6px 20px rgba(245,158,11,0.25)",
                    marginTop: "8px",
                  }}
                >
                  {defectSubmitting ? "실시간 동기화 중..." : "⚠️ 불량 제품 접수 등록"}
                </button>
              </form>
            )}
          </div>
        )}
        </div>
      </main>

      {/* ===== 상세/신청 바텀시트 ===== */}
      {sheetMode && selectedItem && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            display: "flex",
            alignItems: "flex-end",
            animation: "mvpFadeIn 0.15s ease-out",
          }}
        >
          <div
            onClick={closeSheet}
            style={{ position: "absolute", inset: 0, background: "rgba(2, 6, 17, 0.6)", backdropFilter: "blur(2px)" }}
          />

          <div
            style={{
              position: "relative",
              width: "100%",
              maxHeight: "88vh",
              background: isLightMode ? "#ffffff" : "#101827",
              borderTopLeftRadius: "24px",
              borderTopRightRadius: "24px",
              boxShadow: "0 -10px 40px rgba(0,0,0,0.3)",
              animation: "mvpSheetUp 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 4px" }}>
              <div style={{ width: "36px", height: "4px", borderRadius: "999px", background: BORDER }} />
            </div>

            <div style={{ overflowY: "auto", padding: "8px 20px 20px" }}>
              {sheetMode === "detail" ? (
                <>
                  {/* 사진 */}
                  <div
                    onClick={() => selectedItem.photo && setLightbox(getGoogleDriveImageUrl(selectedItem.photo))}
                    style={{
                      width: "100%",
                      aspectRatio: "1.4 / 1",
                      borderRadius: "14px",
                      overflow: "hidden",
                      background: isLightMode ? "#f1f5f9" : "#0f172a",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: "16px",
                      cursor: selectedItem.photo ? "zoom-in" : "default",
                    }}
                  >
                    {selectedItem.photo ? (
                      <img
                        src={getGoogleDriveImageUrl(selectedItem.photo)}
                        alt={selectedItem.name}
                        referrerPolicy="no-referrer"
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", color: TEXT_DIM }}>
                        <ImageOff size={32} />
                        <span style={{ fontSize: "12px" }}>등록된 사진이 없습니다</span>
                      </div>
                    )}
                  </div>

                  <h2 style={{ fontSize: "19px", fontWeight: 800, color: TEXT_MAIN, marginBottom: "6px" }}>
                    {selectedItem.name || "(이름 없음)"}
                  </h2>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "14px" }}>
                    <span
                      className="mono"
                      style={{
                        fontSize: "11.5px",
                        fontWeight: 700,
                        color: ACCENT_LIGHT,
                        background: "rgba(37, 99, 235,0.12)",
                        padding: "4px 10px",
                        borderRadius: "999px",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                      }}
                    >
                      <MapPin size={11} />
                      {selectedItem.location || "위치 미지정"}
                    </span>

                    {mode === "대여" ? (
                      <>
                        {selectedItem.spec && (
                          <span
                            style={{
                              fontSize: "11.5px",
                              fontWeight: 700,
                              color: TEXT_DIM,
                              background: isLightMode ? "#f1f5f9" : "#1e293b",
                              padding: "4px 10px",
                              borderRadius: "999px",
                            }}
                          >
                            {selectedItem.spec}
                          </span>
                        )}
                        <span
                          style={{
                            fontSize: "11.5px",
                            fontWeight: 800,
                            color:
                              selectedItem.stock === null || selectedItem.stock === "N/A"
                                ? TEXT_DIM
                                : selectedItem.stock === 0
                                ? DANGER
                                : GREEN,
                            background: selectedItem.stock === 0 ? "rgba(239,68,68,0.1)" : "rgba(16,185,129,0.1)",
                            padding: "4px 10px",
                            borderRadius: "999px",
                          }}
                        >
                          현재고: {selectedItem.stock === null || selectedItem.stock === "N/A" ? "N/A" : `${selectedItem.stock}개`}
                        </span>
                      </>
                    ) : (
                      outstandingContext && (
                        <>
                          <span
                            style={{
                              fontSize: "11.5px",
                              fontWeight: 700,
                              color: TEXT_DIM,
                              background: isLightMode ? "#f1f5f9" : "#1e293b",
                              padding: "4px 10px",
                              borderRadius: "999px",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                            }}
                          >
                            <User size={11} />
                            {outstandingContext.user || "이름 미상"}
                          </span>
                          <span
                            style={{
                              fontSize: "11.5px",
                              fontWeight: 800,
                              color: AMBER,
                              background: "rgba(245,158,11,0.12)",
                              padding: "4px 10px",
                              borderRadius: "999px",
                            }}
                          >
                            미반납 수량: {outstandingContext.qty}개
                          </span>
                        </>
                      )
                    )}
                  </div>

                  {mode === "반납" && outstandingContext?.lastTimestamp && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "5px",
                        fontSize: "11px",
                        color: TEXT_DIM,
                        marginBottom: "14px",
                      }}
                    >
                      <Clock size={11} />
                      최근 대여일시: {outstandingContext.lastTimestamp}
                    </div>
                  )}

                  {mode === "대여" && selectedItem.note && (
                    <div
                      style={{
                        background: isLightMode ? "#f8fafc" : "#0f172a",
                        border: `1px solid ${BORDER}`,
                        borderRadius: "12px",
                        padding: "12px 14px",
                        fontSize: "12.5px",
                        color: TEXT_DIM,
                        marginBottom: "16px",
                        lineHeight: 1.5,
                      }}
                    >
                      <span style={{ fontWeight: 700, color: TEXT_MAIN }}>📝 비고 · </span>
                      {selectedItem.note}
                    </div>
                  )}

                  <button
                    className="mvp-btn"
                    onClick={openForm}
                    disabled={mode === "대여" && isRentDisabled(selectedItem)}
                    style={{
                      width: "100%",
                      background: MODE_COLOR,
                      color: "#ffffff",
                      borderRadius: "14px",
                      padding: "14px",
                      fontSize: "14.5px",
                      fontWeight: 800,
                      opacity: mode === "대여" && isRentDisabled(selectedItem) ? 0.4 : 1,
                      cursor: mode === "대여" && isRentDisabled(selectedItem) ? "not-allowed" : "pointer",
                      boxShadow: `0 6px 16px ${mode === "대여" ? "rgba(79,70,229,0.3)" : "rgba(16,185,129,0.3)"}`,
                    }}
                  >
                    {mode === "대여" ? "📥 대여하기" : "🔄 반납하기"}
                  </button>

                  {isAdmin && (
                    <button
                      className="mvp-btn"
                      onClick={openEditInventory}
                      style={{
                        width: "100%",
                        background: isLightMode ? "#e2e8f0" : "#1e293b",
                        color: TEXT_MAIN,
                        borderRadius: "14px",
                        padding: "13px",
                        fontSize: "14px",
                        fontWeight: 700,
                        marginTop: "10px",
                        border: `1px solid ${BORDER}`,
                        boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
                      }}
                    >
                      ✏️ 기존 물품 정보 수정 (관리자)
                    </button>
                  )}

                  {isAdmin && onDeleteInventory && selectedItem && selectedItem.rowIndex > 0 && (
                    <button
                      className="mvp-btn"
                      onClick={async () => {
                        await onDeleteInventory(selectedItem.rowIndex);
                        closeSheet();
                      }}
                      style={{
                        width: "100%",
                        background: "rgba(239, 68, 68, 0.12)",
                        color: "#ef4444",
                        borderRadius: "14px",
                        padding: "13px",
                        fontSize: "14px",
                        fontWeight: 700,
                        marginTop: "10px",
                        border: "1px solid rgba(239, 68, 68, 0.3)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
                      }}
                    >
                      <Trash2 size={15} /> 이 물품 삭제 (관리자)
                    </button>
                  )}
                </>
              ) : sheetMode === "edit-inventory" ? (
                <>
                  {/* ===== 기존 물품 정보 수정 폼 ===== */}
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
                    <button
                      className="mvp-btn"
                      type="button"
                      onClick={backToDetail}
                      style={{
                        width: "32px",
                        height: "32px",
                        borderRadius: "10px",
                        background: isLightMode ? "#f1f5f9" : "#1e293b",
                        color: TEXT_MAIN,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <ArrowLeft size={16} />
                    </button>
                    <h2 style={{ fontSize: "17px", fontWeight: 800, color: AMBER, margin: 0 }}>
                      ✏️ 기존 물품 정보 수정 (관리자)
                    </h2>
                  </div>

                  {/* 물품 사진 촬영 / 업로드 */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "14px" }}>
                    <label style={{ fontSize: "11.5px", fontWeight: 700, color: TEXT_DIM }}>물품 이미지 직접 촬영 / 업로드</label>
                    <div
                      style={{
                        border: `1px dashed ${BORDER}`,
                        borderRadius: "12px",
                        padding: "12px",
                        textAlign: "center",
                        background: isLightMode ? "#f8fafc" : "rgba(255, 255, 255, 0.02)",
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "6px",
                        marginTop: "4px"
                      }}
                      onClick={() => document.getElementById("mobile-edit-photo-upload")?.click()}
                    >
                      <input
                        type="file"
                        id="mobile-edit-photo-upload"
                        accept="image/*"
                        style={{ display: "none" }}
                        onChange={handleEditPhotoChange}
                      />
                      {editPhoto ? (
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", width: "100%", justifyContent: "center" }}>
                          <img
                            src={editPhoto.startsWith("data:image/") ? editPhoto : getGoogleDriveImageUrl(editPhoto)}
                            alt="Edit Preview"
                            style={{ width: "38px", height: "38px", borderRadius: "6px", objectFit: "cover" }}
                          />
                          <div style={{ textAlign: "left" }}>
                            <span style={{ fontSize: "12px", fontWeight: 700, color: AMBER, display: "block" }}>
                              📸 물품 이미지 선택됨
                            </span>
                            <span style={{ fontSize: "10px", color: TEXT_DIM, display: "block" }}>
                              저장 시 구글 드라이브에 자동 업로드됩니다.
                            </span>
                          </div>
                          <button
                            type="button"
                            className="mvp-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditPhoto("");
                            }}
                            style={{
                              marginLeft: "auto",
                              background: "rgba(239, 68, 68, 0.15)",
                              color: "#ef4444",
                              border: "none",
                              borderRadius: "6px",
                              padding: "4px 8px",
                              fontSize: "11px",
                              fontWeight: 700
                            }}
                          >
                            삭제
                          </button>
                        </div>
                      ) : isEditUploadingImage ? (
                        <span style={{ fontSize: "12px", color: TEXT_DIM }}>이미지 로드 중...</span>
                      ) : (
                        <>
                          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                            <Camera size={16} style={{ color: TEXT_DIM }} />
                            <span style={{ fontSize: "12.5px", fontWeight: 700, color: TEXT_MAIN }}>이미지 직접 찍기 / 파일 업로드</span>
                          </div>
                          <span style={{ fontSize: "10px", color: TEXT_DIM }}>
                            (구글 드라이브 폴더에 업로드되어 실시간 연동됩니다)
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <form onSubmit={handleEditInventorySubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    {/* 품목명 */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "11.5px", fontWeight: 700, color: TEXT_DIM }}>품목명 <span style={{ color: DANGER }}>*</span></label>
                      <input
                        className="mvp-input"
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        style={inputBaseStyle}
                        required
                      />
                    </div>

                    {/* 위치 */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "11.5px", fontWeight: 700, color: TEXT_DIM }}>보관 위치 (예: A-01) <span style={{ color: DANGER }}>*</span></label>
                      <input
                        className="mvp-input"
                        type="text"
                        value={editLocation}
                        onChange={(e) => setEditLocation(e.target.value)}
                        style={inputBaseStyle}
                        required
                      />
                    </div>

                    {/* 규격/설명 (Spec) */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "11.5px", fontWeight: 700, color: TEXT_DIM }}>규격 / 서브카테고리</label>
                      <input
                        className="mvp-input"
                        type="text"
                        value={editSpec}
                        onChange={(e) => setEditSpec(e.target.value)}
                        style={inputBaseStyle}
                        placeholder="예: i7, 16GB, 256GB"
                      />
                    </div>

                    {/* 재고수량 */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "11.5px", fontWeight: 700, color: TEXT_DIM }}>현재고 수량 (숫자 또는 N/A) <span style={{ color: DANGER }}>*</span></label>
                      <input
                        className="mvp-input"
                        type="text"
                        value={editStock}
                        onChange={(e) => setEditStock(e.target.value)}
                        onFocus={(e) => e.target.select()}
                        style={inputBaseStyle}
                        placeholder="예: 5 또는 N/A"
                        required
                      />
                    </div>

                    {/* 링크 */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "11.5px", fontWeight: 700, color: TEXT_DIM }}>연결 링크 (N/A 또는 URL)</label>
                      <input
                        className="mvp-input"
                        type="text"
                        value={editLink}
                        onChange={(e) => setEditLink(e.target.value)}
                        style={inputBaseStyle}
                        placeholder="N/A"
                      />
                    </div>

                    {/* 담당자 */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "11.5px", fontWeight: 700, color: TEXT_DIM }}>수정 담당 관리자 <span style={{ color: DANGER }}>*</span></label>
                      <input
                        className="mvp-input"
                        type="text"
                        value={editManager}
                        onChange={(e) => setEditManager(e.target.value)}
                        style={inputBaseStyle}
                        required
                      />
                    </div>

                    {/* 비고 (Note) */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "11.5px", fontWeight: 700, color: TEXT_DIM }}>비고 / 특이사항</label>
                      <textarea
                        className="mvp-input"
                        value={editNote}
                        onChange={(e) => setEditNote(e.target.value)}
                        style={{ ...inputBaseStyle, minHeight: "80px", resize: "none" }}
                        placeholder="특이사항 입력"
                      />
                    </div>

                    {/* 제출 버튼 */}
                    <button
                      type="submit"
                      className="mvp-btn"
                      disabled={editSubmitting || isEditUploadingImage}
                      style={{
                        width: "100%",
                        background: AMBER,
                        color: "#ffffff",
                        borderRadius: "14px",
                        padding: "15px",
                        fontSize: "15px",
                        fontWeight: 800,
                        opacity: editSubmitting || isEditUploadingImage ? 0.6 : 1,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
                        marginTop: "8px",
                        boxShadow: "0 8px 20px rgba(245,158,11,0.25)",
                      }}
                    >
                      <Check size={17} />
                      {editSubmitting ? "실시간 연동 저장 중..." : "✏️ 품목 정보 수정 완료"}
                    </button>
                  </form>
                </>
              ) : (
                <>
                  {/* ===== 대여/반납 신청 폼 ===== */}
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
                    <button
                      className="mvp-btn"
                      onClick={backToDetail}
                      style={{
                        width: "32px",
                        height: "32px",
                        borderRadius: "10px",
                        background: isLightMode ? "#f1f5f9" : "#1e293b",
                        color: TEXT_MAIN,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <ArrowLeft size={16} />
                    </button>
                    <h2 style={{ fontSize: "17px", fontWeight: 800, color: TEXT_MAIN, margin: 0 }}>
                      {mode === "대여" ? "📥 물품 대여 신청" : "🔄 물품 반납 접수"}
                    </h2>
                  </div>

                  <div
                    style={{
                      background: isLightMode ? "#f8fafc" : "#0f172a",
                      border: `1px solid ${BORDER}`,
                      borderRadius: "12px",
                      padding: "12px 14px",
                      marginBottom: "18px",
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                    }}
                  >
                    {selectedItem.photo ? (
                      <img
                        src={getGoogleDriveImageUrl(selectedItem.photo)}
                        alt={selectedItem.name}
                        referrerPolicy="no-referrer"
                        style={{ width: "40px", height: "40px", borderRadius: "8px", objectFit: "cover", flexShrink: 0 }}
                      />
                    ) : (
                      <div
                        style={{
                          width: "40px",
                          height: "40px",
                          borderRadius: "8px",
                          background: isLightMode ? "#e2e8f0" : "#1e293b",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <Package size={16} color={TEXT_DIM} />
                      </div>
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: "13px",
                          fontWeight: 800,
                          color: TEXT_MAIN,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {selectedItem.name}
                      </div>
                      <div style={{ fontSize: "11px", color: TEXT_DIM }}>
                        {mode === "대여"
                          ? `위치: ${selectedItem.location} · 현재고: ${
                              selectedItem.stock === null || selectedItem.stock === "N/A" ? "N/A" : `${selectedItem.stock}개`
                            }`
                          : `위치: ${selectedItem.location} · 미반납: ${outstandingContext?.qty ?? formQty}개`}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    {selectedItem.rowIndex === -1 ? (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                          <label style={{ fontSize: "11.5px", fontWeight: 700, color: TEXT_DIM }}>물품명 <span style={{ color: DANGER }}>*</span></label>
                          <input className="mvp-input" type="text" placeholder="물품명 입력" value={customBorrowName} onChange={(e) => setCustomBorrowName(e.target.value)} style={inputBaseStyle} />
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                          <label style={{ fontSize: "11.5px", fontWeight: 700, color: TEXT_DIM }}>위치 (선택)</label>
                          <input className="mvp-input" type="text" placeholder="위치 입력" value={customBorrowLoc} onChange={(e) => setCustomBorrowLoc(e.target.value)} style={inputBaseStyle} />
                        </div>
                      </div>
                    ) : null}
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "11.5px", fontWeight: 700, color: TEXT_DIM }}>
                        {mode === "대여" ? "대여자 이름" : "반납자 이름"} <span style={{ color: DANGER }}>*</span>
                      </label>
                      <input
                        className="mvp-input"
                        type="text"
                        placeholder="예: 홍길동"
                        value={formUser}
                        onChange={(e) => setFormUser(e.target.value)}
                        style={inputBaseStyle}
                      />
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "11.5px", fontWeight: 700, color: TEXT_DIM }}>
                        수량 <span style={{ color: DANGER }}>*</span>
                      </label>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <button
                          className="mvp-btn"
                          onClick={() => setFormQty((q) => Math.max(1, q - 1))}
                          style={{
                            width: "44px",
                            height: "44px",
                            borderRadius: "12px",
                            background: isLightMode ? "#f1f5f9" : "#1e293b",
                            color: TEXT_MAIN,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Minus size={18} />
                        </button>
                        <div className="mono" style={{ flex: 1, textAlign: "center", fontSize: "20px", fontWeight: 800, color: TEXT_MAIN }}>
                          {formQty}
                        </div>
                        <button
                          className="mvp-btn"
                          onClick={() => setFormQty((q) => (maxQty !== undefined ? Math.min(maxQty, q + 1) : q + 1))}
                          style={{
                            width: "44px",
                            height: "44px",
                            borderRadius: "12px",
                            background: isLightMode ? "#f1f5f9" : "#1e293b",
                            color: TEXT_MAIN,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Plus size={18} />
                        </button>
                      </div>
                      {maxQty !== undefined && formQty >= maxQty && (
                        <span style={{ fontSize: "11px", color: AMBER }}>
                          {mode === "대여" ? `현재고(${maxQty}개)까지 대여할 수 있습니다.` : `미반납 수량(${maxQty}개)까지 반납할 수 있습니다.`}
                        </span>
                      )}
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "11.5px", fontWeight: 700, color: TEXT_DIM }}>메모 (선택)</label>
                      <input
                        className="mvp-input"
                        type="text"
                        placeholder="예: 테스트 목적 대여"
                        value={formNote}
                        onChange={(e) => setFormNote(e.target.value)}
                        style={{ ...inputBaseStyle, fontSize: "14px" }}
                      />
                    </div>

                    {mode === "대여" ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        <label style={{ fontSize: "11.5px", fontWeight: 700, color: TEXT_DIM }}>반납 예정일 (선택 · 연체 관리)</label>
                        <input
                          className="mvp-input"
                          type="date"
                          value={formDueDate}
                          onChange={(e) => setFormDueDate(e.target.value)}
                          style={{ ...inputBaseStyle, fontSize: "14px" }}
                        />
                      </div>
                    ) : null}

                    <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                      {(mode === "대여" || mode === "반납") && isAdmin ? (
                        <button
                          className="mvp-btn"
                          onClick={() => handleSubmit("소모")}
                          disabled={submitting}
                          style={{
                            flex: "0 0 auto",
                            background: AMBER,
                            color: "#ffffff",
                            borderRadius: "14px",
                            padding: "15px 18px",
                            fontSize: "15px",
                            fontWeight: 800,
                            opacity: submitting ? 0.6 : 1,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "6px",
                            boxShadow: "0 8px 20px rgba(245,158,11,0.3)",
                          }}
                        >
                          🔥 {mode === "반납" ? "소모로 처리" : "소모"}
                        </button>
                      ) : null}
                      <button
                        className="mvp-btn"
                        onClick={() => handleSubmit()}
                        disabled={submitting}
                        style={{
                          flex: 1,
                          background: MODE_COLOR,
                          color: "#ffffff",
                          borderRadius: "14px",
                          padding: "15px",
                          fontSize: "15px",
                          fontWeight: 800,
                          opacity: submitting ? 0.6 : 1,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "6px",
                          boxShadow: `0 8px 20px ${mode === "대여" ? "rgba(79,70,229,0.3)" : "rgba(16,185,129,0.3)"}`,
                        }}
                      >
                        <Check size={17} />
                        {submitting ? "제출 중..." : mode === "대여" ? "대여 제출" : "반납 제출"}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===== 사진 라이트박스 ===== */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            background: "rgba(0,0,0,0.92)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            animation: "mvpFadeIn 0.15s ease-out",
          }}
        >
          <button
            className="mvp-btn"
            onClick={() => setLightbox(null)}
            style={{
              position: "absolute",
              top: "20px",
              right: "20px",
              width: "38px",
              height: "38px",
              borderRadius: "50%",
              background: "rgba(255,255,255,0.12)",
              color: "#ffffff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X size={20} />
          </button>
          <img
            src={lightbox}
            alt="확대 이미지"
            referrerPolicy="no-referrer"
            style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: "12px", objectFit: "contain" }}
          />
        </div>
      )}

      {/* ===== 로컬 토스트 ===== */}
      {localToast && (
        <div
          style={{
            position: "fixed",
            bottom: "24px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 70,
            background: localToast.type === "ok" ? "#10b981" : localToast.type === "error" ? "#ef4444" : "#f59e0b",
            color: "#ffffff",
            padding: "12px 20px",
            borderRadius: "999px",
            fontSize: "13px",
            fontWeight: 700,
            boxShadow: "0 10px 25px rgba(0,0,0,0.3)",
            maxWidth: "90vw",
            textAlign: "center",
            animation: "mvpToastIn 0.2s ease-out",
          }}
        >
          {localToast.msg}
        </div>
      )}
    </div>
  );
}
