import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { InventoryItem, Rack, DefectLog, RentLog, WmsUser } from "./types";
import { DEMO_INVENTORY } from "./data/demo";
import { autoLayoutRacks, snap, formatTimestampLocal, parseLocation, hexToRgba, isFuzzyMatch } from "./utils/drive";

// Subcomponents
import AdminConnectionSettings from "./components/AdminConnectionSettings";
import DbViewerPage from "./components/DbViewerPage";
import ScenarioChangesPage from "./components/ScenarioChangesPage";
import ReturnPhotosPage from "./components/ReturnPhotosPage";
import ItemFormModal from "./components/ItemFormModal";
import { fetchBorrowAppVersion, VERSION_OUTDATED_EVENT, publishAppVersion, fetchNotices, saveNotices, NoticeData, NOTICE_MAX, fetchBorrowLock, setBorrowLock, BorrowLock, UnitLock, unitLockKey, fetchSeatMap, withGasConcurrencyLimit, clearIdentity } from "./utils/borrowApi";
import StockAdjustModal from "./components/StockAdjustModal";
import AdminReturnPage from "./components/AdminReturnPage";
import AdminDirectBorrowModal from "./components/AdminDirectBorrowModal";
import ItemSetManageModal from "./components/ItemSetManageModal";
import SeatMapAdminPage from "./components/SeatMapAdminPage";
import SidePanel from "./components/SidePanel";
import RackGroupedView from "./components/RackGroupedView";
import ScenarioAdminPage from "./components/ScenarioAdminPage";
import TableclothAdminPage from "./components/TableclothAdminPage";
import ScenarioLogsPage from "./components/ScenarioLogsPage";
import DefectLogsPage from "./components/DefectLogsPage";
import RentLogsPage from "./components/RentLogsPage";
import LandingPage from "./components/LandingPage";
import LoginPage from "./components/LoginPage";
import RentalPage from "./components/RentalPage";
import BorrowSystemPage from "./components/BorrowSystemPage";
import BrowsePage from "./components/BrowsePage";
import BorrowerLoginPage, { BorrowerSession } from "./components/BorrowerLoginPage";
import MobileViewPage from "./components/MobileViewPage";
import UnattendedModeSettings from "./components/UnattendedModeSettings";
import UnattendedReturnPage from "./components/UnattendedReturnPage";
import { getVersionWorkItems, VERSION_WORK_CHANGED_EVENT, VersionWorkItem } from "./utils/versionWorkGuard";

// Icons
import {
  RotateCcw,
  Search,
  Plus,
  RefreshCw,
  Settings,
  Grid,
  LayoutGrid,
  Home,
  MapPin,
  ChevronRight,
  ChevronLeft,
  Package,
  Sun,
  Moon,
  QrCode,
  Smartphone,
  ArrowLeft,
  ClipboardList,
  AlertTriangle,
  Undo2,
  Boxes,
  ShieldAlert,
  Lock,
  Megaphone,
  Rocket,
  Database,
  History,
  Camera, Layers, Menu, HandHelping, Users,} from "lucide-react";


const DEMO_DEFECT_LOGS: DefectLog[] = [
  {
    timestamp: "2026-06-25 14:20:10",
    location: "A-1-2",
    name: "리튬 이온 배터리 팩",
    qty: 2,
    defectType: "파손",
    manager: "김민수",
    note: "파레트 하차 중 낙하하여 배터리 케이스 균열 발생",
    actionTaken: "즉시 안전 폐기 대기 구역으로 이동 조치함"
  },
  {
    timestamp: "2026-06-24 10:15:30",
    location: "B-2-1",
    name: "고주파 동축 케이블 (5m)",
    qty: 5,
    defectType: "오염",
    manager: "박영희",
    note: "박스 내부 습기 침투로 인해 커넥터 접촉부 부식 발생",
    actionTaken: "불량 케이블 전량 반품 및 공급사 교환 요청 접수"
  },
  {
    timestamp: "2026-06-22 17:05:00",
    location: "C-1-1",
    name: "LED 디스플레이 모듈 7형",
    qty: 1,
    defectType: "기능 오작동",
    manager: "이준우",
    note: "전원 인가 시 화면 일부 픽셀 깨짐 및 세로줄 노이즈 발생",
    actionTaken: "제조사 무상 AS 의뢰 접수 및 대체품 교체 완료"
  }
];

const DEMO_RENT_LOGS: RentLog[] = [
  {
    timestamp: "2026-06-26 14:10:00",
    location: "A-1-1",
    name: "리튬 이온 배터리 팩",
    type: "대여",
    qty: 3,
    user: "홍길동",
    note: "배터리 팩 방전 테스트 목적 대여"
  },
  {
    timestamp: "2026-06-25 11:20:00",
    location: "B-2-2",
    name: "고주파 동축 케이블 (5m)",
    type: "반납",
    qty: 2,
    user: "이영희",
    note: "부서 테스트 장비 사용 완료 후 정상 반납"
  }
];

const DEMO_ROBOT_OBJECTS = [
  { rowIndex: 2, name: "Gripper", location: "로봇팔 A", spec: "UR5e 그리퍼 조인트", note: "관절 마찰 마모 검사 필", stock: 3 },
  { rowIndex: 3, name: "Intel Realsense", location: "로봇팔 B", spec: "D435i 카메라 모듈", note: "비전 캘리브레이션 필요", stock: 5 },
  { rowIndex: 4, name: "Suction Cap", location: "흡착 스테이션", spec: "SMC 진공 패드", note: "흡착력 저하 시 즉시 교체", stock: 12 },
  { rowIndex: 5, name: "Magnetic Sensor", location: "AGV-01 전면", spec: "AGV 가이드 센서", note: "자기 테이프 검출 거리 15mm", stock: 4 },
  { rowIndex: 6, name: "Safety Scanner", location: "협동로봇 구역", spec: "SICK 안전 레이저 스캐너", note: "안전 필드 보호 영역 점검", stock: 2 }
];

// 입력·업로드·처리 작업이 있는 관리자 화면은 메뉴 이동 때 언마운트하지 않는다.
// 한 번 연 화면을 DOM에 유지하고 표시만 바꾸면, 진행 중인 네트워크 요청과 화면 상태가
// 그대로 살아 있어 다른 서브메뉴를 잠깐 확인하고 돌아와도 작업을 이어갈 수 있다.
const PERSISTENT_ADMIN_VIEWS = ["scenario", "tablecloth", "adminReturn", "adminBorrow"] as const;
type PersistentAdminView = typeof PERSISTENT_ADMIN_VIEWS[number];
function isPersistentAdminView(view: string): view is PersistentAdminView {
  return (PERSISTENT_ADMIN_VIEWS as readonly string[]).includes(view);
}

/* ============================================================
   로컬 스토리지 안전 저장 및 복원 함수
   ============================================================ */
function safeSetLocalStorage(key: string, value: string) {
  try {
    // 특정 캐시 값에 대용량 base64 데이터(예: 사진 업로드)가 들어있으면,
    // 브라우저 5MB 제한(QuotaExceededError)을 방지하기 위해 base64 부분을 생략/압축하여 캐싱합니다.
    if (key === "wms_cached_defect_logs" || key === "wms_cached_inventory") {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          let modified = false;
          const cleaned = parsed.map((item: any) => {
            if (item && item.photo && typeof item.photo === "string" && item.photo.startsWith("data:image/")) {
              modified = true;
              return {
                ...item,
                photo: "(대용량 이미지 캐시 생략 - DB에는 정상 업로드됨)"
              };
            }
            return item;
          });
          if (modified) {
            value = JSON.stringify(cleaned);
          }
        }
      } catch (err) {
        console.warn("로컬 캐시 데이터 최적화 실패:", err);
      }
    }
    localStorage.setItem(key, value);
  } catch (error) {
    console.error(`[LocalStorage Warning] '${key}' 저장 실패 (용량 초과 혹은 브라우저 보안 제한):`, error);
  }
}

/* ============================================================
   메인 컴포넌트 (창고 구역 관리 및 로컬 서버 실시간 연동)
   ============================================================ */
export default function App() {
  // 1. 상태 선언
  // 열람 화면에 어느 단계로 들어갈지 (SID 열람 등)
  const [browseInitialStep, setBrowseInitialStep] = useState<"sid" | "sidBorrow" | null>(null);
  const [currentView, setCurrentView] = useState<"gate" | "borrowerLogin" | "seatChange" | "landing" | "login" | "rental" | "borrow" | "return" | "browse" | "mylookup" | "monitor" | "defect" | "rent" | "scenario" | "seatmap" | "adminReturn" | "adminBorrow" | "connectionSettings" | "rentalSettings" | "dbViewer" | "scenarioChanges" | "returnPhotos" | "tablecloth" | "unattended">("landing");
  // 무인 화면에서는 브라우저 뒤로가기도 일반 모드 이탈 수단이 되면 안 된다.
  // 하단 관리자 로그인이 성공한 순간에만 이 잠금을 해제한다.
  const unattendedLockedRef = useRef(typeof window !== "undefined" && window.location.hash.split("/")[1] === "unattended");
  const [unattendedReady, setUnattendedReady] = useState(false);
  // 기기 등록 여부와 무관하게, 무인 모드 자체가 켜져 있는지만 나타낸다.
  // 일반 열람 화면에서 위치를 숨길지 판단하는 데 쓴다(무인 반납 PC가 아니어도 적용돼야 함).
  const [unattendedEnabled, setUnattendedEnabled] = useState(false);
  // 서버(GAS)가 새 버전으로 재배포되면, 이미 열려 있던 탭은 구버전 상태로 남는다.
  // 최초 접속 시 버전을 기억해두고, 주기적으로 서버 버전과 비교해서 달라지면
  // 새로고침 전까지 안 사라지는 경고 배너를 화면 어디서든 띄운다.
  const [versionMismatch, setVersionMismatch] = useState(false);
  const [versionWorkItems, setVersionWorkItems] = useState<VersionWorkItem[]>(() => getVersionWorkItems());
  const [publishingVersion, setPublishingVersion] = useState(false);
  // 관리자 하위 메뉴: null(선택 화면) | items(물품 관리) | rental(대여 & 반납 관리)
  const [adminSection, setAdminSection] = useState<"items" | "rental" | "settings" | null>(null);

  const refreshUnattendedStatus = useCallback(() => {
    let token = ""; try { token = localStorage.getItem("wms_unattended_device") || ""; } catch {}
    return fetch("/api/unattended/status", { headers: { "x-unattended-device": token }, cache: "no-store" })
      .then((r) => r.json()).then((d) => { setUnattendedReady(!!d.enabled && !!d.deviceRegistered); setUnattendedEnabled(!!d.enabled); }).catch(() => { setUnattendedReady(false); setUnattendedEnabled(false); });
  }, []);
  useEffect(() => {
    refreshUnattendedStatus();
    // 다른 사람/다른 탭에서 무인 모드를 켜고 끄면 이 탭도 새로고침 없이 따라가야
    // 위치 숨김이 실제로 걸린다 — 켠 사람의 탭은 onModeChanged로 즉시 반영되지만,
    // 이미 열려 있던 다른 탭들은 이 주기적 확인으로만 알 수 있다.
    const id = window.setInterval(refreshUnattendedStatus, 30_000);
    return () => window.clearInterval(id);
  }, [refreshUnattendedStatus]);

  async function openNoticeModal() {
    setNoticeModalOpen(true);
    try {
      const list = await fetchNotices(scriptUrl);
      setNoticeDrafts(list.length ? list : [{ title: "", text: "" }]);
    } catch (e) {
      setNoticeDrafts([{ title: "", text: "" }]);
    }
  }

  async function submitNotice() {
    setNoticeSaving(true);
    try {
      const items = noticeDrafts.filter((n) => (n.title || "").trim() || (n.text || "").trim());
      const res = await saveNotices(scriptUrl, items, currentUser?.name || "관리자");
      if (res.success) {
        showToast(items.length ? `공지 ${items.length}건을 저장했습니다.` : "공지를 모두 지웠습니다.", "ok");
        setNoticeModalOpen(false);
        try { sessionStorage.removeItem("wms_notices_v1"); } catch (e) { /* 무시 */ }
      } else {
        showToast(res.message || "공지 저장에 실패했습니다.", "error");
      }
    } catch (e: any) {
      showToast(`공지 저장 실패: ${e.message}`, "error");
    } finally {
      setNoticeSaving(false);
    }
  }
  const baselineAppVersionRef = useRef<string | null>(null);
  // 열람 조회 → 대여 신청으로 넘길 신원 정보 (장바구니 연동)
  const [borrowIdentity, setBorrowIdentity] = useState<{ name: string; employeeId: string; affiliation?: "cfgw" | "configds" | "other" } | null>(null);
  const [borrowKind, setBorrowKind] = useState<"scenario" | "warehouse" | "tablecloth" | null>(null);
  // 물품 열람의 신원 입력에서 받아둔 좌석. 대여 화면이 같은 것을 또 묻지 않도록 넘겨준다.
  const [borrowSeat, setBorrowSeat] = useState<{ floor: string; unit: string } | null>(null);
  // SID 대여로 담았다면 그 번호. 대여 화면이 방식과 SID를 다시 묻지 않는다.
  const [borrowSid, setBorrowSid] = useState("");
  const [borrowAdditionalItems, setBorrowAdditionalItems] = useState<any[]>([]);
  // 해시 라우터는 한 번만 등록되므로, 그 안에서 최신의 대여 임시 상태를 읽기 위한 ref다.
  // 이 상태가 없는 #/borrow/* 주소는 예전 단계 URL이므로 절대 열어서는 안 된다.
  const borrowFlowRef = useRef({ identity: borrowIdentity, kind: borrowKind });
  borrowFlowRef.current = { identity: borrowIdentity, kind: borrowKind };

  /* ── 대여자 로그인 ──────────────────────────────────────────
   * 예전에는 화면마다 이름·사번·좌석을 다시 물었다. 이제 들어올 때 한 번만 받고,
   * 그 값을 필요한 화면들이 나눠 쓴다.
   *
   * 창을 닫으면 사라져야 하므로 sessionStorage에 둔다(localStorage면 다음 사람이 그대로
   * 이어받는다 — 공용 PC에서 남의 이름으로 빌리게 된다).
   * 아무 동작 없이 4시간이 지나면 자동으로 풀린다. */
  const BORROWER_KEY = "wms_borrower_session";
  const IDLE_LIMIT_MS = 4 * 60 * 60 * 1000;
  const [borrower, setBorrower] = useState<BorrowerSession | null>(() => {
    try {
      const raw = sessionStorage.getItem(BORROWER_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.session?.name || !/^\d{4}$/.test(String(parsed?.session?.employeeId || ""))) return null;
      if (Date.now() - (parsed.at || 0) > IDLE_LIMIT_MS) { sessionStorage.removeItem(BORROWER_KEY); return null; }
      return parsed.session as BorrowerSession;
    } catch { return null; }
  });

  /** 마지막 동작 시각을 함께 저장한다 — 이 값이 4시간 지나면 자동 로그아웃한다. */
  const touchBorrower = useCallback((session: BorrowerSession | null) => {
    try {
      if (session) sessionStorage.setItem(BORROWER_KEY, JSON.stringify({ session, at: Date.now() }));
      else sessionStorage.removeItem(BORROWER_KEY);
    } catch { /* 저장 실패는 무시 — 그 창에서만 로그인 상태가 유지되지 않는다 */ }
  }, []);

  const [users, setUsers] = useState<WmsUser[]>(() => {
    try {
      const cached = localStorage.getItem("wms_cached_users");
      return cached ? JSON.parse(cached) : [{ id: "admin", password: "1234" }];
    } catch (e) {
      console.error("Failed to load cached users:", e);
      return [{ id: "admin", password: "1234" }];
    }
  });
  const [defectLogs, setDefectLogs] = useState<DefectLog[]>(() => {
    try {
      const cached = localStorage.getItem("wms_cached_defect_logs");
      return cached ? JSON.parse(cached) : DEMO_DEFECT_LOGS;
    } catch (e) {
      console.error("Failed to load cached defect logs:", e);
      return DEMO_DEFECT_LOGS;
    }
  });
  const [robotObjects, setRobotObjects] = useState<any[]>(() => {
    try {
      const cached = localStorage.getItem("wms_cached_robot_objects");
      return cached ? JSON.parse(cached) : DEMO_ROBOT_OBJECTS;
    } catch (e) {
      console.error("Failed to load cached robot objects:", e);
      return DEMO_ROBOT_OBJECTS;
    }
  });
  const [rentLogs, setRentLogs] = useState<RentLog[]>(() => {
    try {
      const cached = localStorage.getItem("wms_cached_rent_logs");
      return cached ? JSON.parse(cached) : DEMO_RENT_LOGS;
    } catch (e) {
      console.error("Failed to load cached rent logs:", e);
      return DEMO_RENT_LOGS;
    }
  });
  const [isAdmin, setIsAdmin] = useState<boolean>(() => {
    try {
      const cached = localStorage.getItem("wms_is_admin");
      return cached === "true"; // 기본은 false (대여/조회 모드)
    } catch {
      return false;
    }
  });
  const [mountedAdminViews, setMountedAdminViews] = useState<Set<PersistentAdminView>>(() => new Set());
  useEffect(() => {
    if (!isAdmin || !isPersistentAdminView(currentView)) return;
    setMountedAdminViews((prev) => {
      if (prev.has(currentView)) return prev;
      const next = new Set(prev);
      next.add(currentView);
      return next;
    });
  }, [isAdmin, currentView]);
  const [currentUser, setCurrentUser] = useState<WmsUser | null>(() => {
    try {
      const cached = localStorage.getItem("wms_current_user");
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });
  const [showRentModal, setShowRentModal] = useState<{ item: InventoryItem; actionType: "대여" | "반납" | "소모" } | null>(null);
  const [modalActionType, setModalActionType] = useState<"대여" | "반납" | "소모">("대여");
  const [rentUserName, setRentUserName] = useState("");
  const [rentQty, setRentQty] = useState(1);
  const [rentNote, setRentNote] = useState("");

  const [loginId, setLoginId] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  const [showAdminAuthModal, setShowAdminAuthModal] = useState(false);
  const [authPasscodeInput, setAuthPasscodeInput] = useState("");
  const [authError, setAuthError] = useState("");

  // 대여 모달이 열릴 때 기본값으로 상태 리셋
  useEffect(() => {
    if (showRentModal) {
      setRentUserName("");
      setRentQty(1);
      setRentNote("");
      setModalActionType(showRentModal.actionType);
    }
  }, [showRentModal]);

  const [inventory, setInventory] = useState<InventoryItem[]>(DEMO_INVENTORY);
  const [racks, setRacks] = useState<Rack[]>([]);
  const [inventoryRefreshing, setInventoryRefreshing] = useState(false);
  const [selectedRackId, setSelectedRackId] = useState<string | null>(null);
  const [monitorView, setMonitorView] = useState<"map" | "grouped">("grouped");
  const [imageModalUrl, setImageModalUrl] = useState<string>("");

  // 모바일 화면 여부 감지 (열람용 모드 진입 시 전용 모바일 UI를 보여주기 위함)
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 768px)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(max-width: 768px)");
    const handleChange = () => setIsMobile(mql.matches);
    handleChange();
    if (mql.addEventListener) {
      mql.addEventListener("change", handleChange);
      return () => mql.removeEventListener("change", handleChange);
    } else {
      // 구형 브라우저 호환
      mql.addListener(handleChange);
      return () => mql.removeListener(handleChange);
    }
  }, []);

  // --- 2-Way Hash Routing Synchronization ---
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      const path = hash.split("/")[1] || "";
      if (unattendedLockedRef.current && path !== "unattended") {
        window.history.replaceState(null, "", "#/unattended");
        setCurrentView("unattended");
        return;
      }
      if (!hash || hash === "#" || hash === "#/") {
        const hasUser = localStorage.getItem("wms_current_user") !== null || localStorage.getItem("wms_is_admin") === "true";
        if (hasUser) {
          window.location.hash = "#/monitor";
        } else {
          window.location.hash = "#/landing";
        }
        return;
      }

      if (path === "landing") {
        setCurrentView("landing");
      } else if (path === "login") {
        setCurrentView("login");
      } else if (path === "rental") {
        setCurrentView("rental");
      } else if (path === "borrow") {
        // 물품 선택 화면에서 넘겨 준 임시 신원·분야가 없는 주소는 모두 폐기된 대여 경로다.
        // 특히 새로고침, 뒤로가기, #/borrow/ 직접 입력으로 옛 b1~b4 화면이 되살아나는 것을 막는다.
        if (!borrowFlowRef.current.identity || !borrowFlowRef.current.kind) {
          window.location.hash = "#/landing";
          return;
        }
        setCurrentView("borrow");
      } else if (path === "return") {
        setCurrentView("return");
      } else if (path === "browse") {
        setCurrentView("browse");
      } else if (path === "mylookup") {
        setCurrentView("mylookup");
      } else if (path === "monitor") {
        setCurrentView("monitor");
      } else if (path === "rent") {
        setCurrentView("rent");
      } else if (path === "defect") {
        setCurrentView("defect");
      } else if (path === "register") {
        setCurrentView("monitor");
      } else if (path === "adminReturn") {
        setCurrentView("adminReturn");
      } else if (path === "adminBorrow") {
        setCurrentView("adminBorrow");
      } else if (path === "scenario") {
        setCurrentView("scenario");
      } else if (path === "seatmap") {
        setCurrentView("seatmap");
      } else if (path === "connectionSettings") {
        setCurrentView("connectionSettings");
      } else if (path === "rentalSettings") {
        setCurrentView("rentalSettings");
      } else if (path === "dbViewer") {
        setCurrentView("dbViewer");
      } else if (path === "scenarioChanges") {
        setCurrentView("scenarioChanges");
      } else if (path === "tablecloth") {
        setCurrentView("tablecloth");
      } else if (path === "returnPhotos") {
        setCurrentView("returnPhotos");
      } else if (path === "unattended") {
        unattendedLockedRef.current = true;
        setCurrentView("unattended");
      }

      // 관리자 화면을 사이드바의 "새 탭으로 열기" 버튼으로 열었을 때만(URL에 /direct 표시가
      // 붙어 있을 때만) 사이드바가 선택 화면을 건너뛰고 바로 해당 하위 메뉴로 열리게 한다.
      // 로그인 직후에도 기본적으로 같은 해시(#/monitor)로 이동하는데, 그 일반 흐름까지
      // 이 로직을 타면 원래 보여야 할 "물품 관리 / 대여 & 반납 관리" 선택 화면이 사라진다.
      const isDirectSectionLink = hash.split("/")[2] === "direct";
      if (isDirectSectionLink) {
        if (path === "monitor" || path === "scenario" || path === "defect" || path === "returnPhotos" || path === "tablecloth") {
          setAdminSection("items");
        } else if (path === "adminReturn" || path === "adminBorrow" || path === "rent" || path === "seatmap") {
          setAdminSection("rental");
        }
      }
    };

    window.addEventListener("hashchange", handleHashChange);
    handleHashChange(); // Initial load sync

    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  // 마운트 직후엔 아직 read-effect가 URL 해시를 읽어 currentView를 맞추기 전이라,
  // currentView의 초기값("landing")을 그대로 해시에 덮어쓰면 새 탭을 특정 해시(#/monitor 등)로
  // 열었을 때 그 값이 "#/landing"으로 지워져버린다. 그래서 첫 번째 실행은 건너뛴다.
  const hashWriteSkippedFirst = useRef(false);
  useEffect(() => {
    if (!hashWriteSkippedFirst.current) {
      hashWriteSkippedFirst.current = true;
      return;
    }
    const currentHash = window.location.hash.split("/")[1] || "";
    if (currentView && currentHash !== currentView) {
      if (currentView === "monitor" && window.location.hash.startsWith("#/register")) {
        return;
      }
      window.location.hash = `#/${currentView}`;
    }
  }, [currentView]);

  // 로컬 Node/SQLite 백엔드는 항상 같은 오리진에서 서빙되므로 GAS 시절의 "연동 URL 입력/연결" 개념이 없다.
  // scriptUrl은 하위 컴포넌트/borrowApi.ts의 기존 함수 시그니처 호환을 위해 남겨두되, 실제로는
  // 로컬 GAS 호환 디스패처(server/routes/gas.js)를 가리키는 고정 경로다.
  const [scriptUrl, setScriptUrl] = useState("/api/gas");
  const [connected, setConnected] = useState(true);

  // 대여 잠금 (관리자 전용) — 반납은 계속 가능
  const [borrowLock, setBorrowLockState] = useState<BorrowLock>({ locked: false });
  const [lockBusy, setLockBusy] = useState(false);

  useEffect(() => {
    if (!connected || !scriptUrl) return;
    fetchBorrowLock(scriptUrl).then(setBorrowLockState).catch(() => { /* 조회 실패는 무시 */ });
  }, [connected, scriptUrl]);

  // 대여 가능 종류 수 기본 제한 (페널티 없이도 전체에 적용되는 기본값)
  const [maxItemTypesDefault, setMaxItemTypesDefault] = useState("");
  const [savingMaxItemTypes, setSavingMaxItemTypes] = useState(false);
  function adminApiHeaders(): HeadersInit {
    let adminId = "";
    try { adminId = localStorage.getItem("wms_admin_id") || ""; } catch {}
    return { "Content-Type": "application/json", "x-admin-id": adminId };
  }
  useEffect(() => {
    if (!isAdmin) return;
    fetch("/api/settings", { headers: adminApiHeaders() })
      .then((r) => r.json())
      .then((data) => setMaxItemTypesDefault(data.settings?.max_item_types_default || ""))
      .catch(() => { /* 조회 실패는 무시 */ });
  }, [isAdmin]);
  async function saveMaxItemTypesDefault() {
    setSavingMaxItemTypes(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: adminApiHeaders(),
        body: JSON.stringify({ max_item_types_default: maxItemTypesDefault.trim() }),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.error || "저장 실패");
      showToast("대여 가능 종류 제한을 저장했습니다.", "ok");
    } catch (e: any) {
      showToast(`저장 실패: ${e.message}`, "error");
    } finally {
      setSavingMaxItemTypes(false);
    }
  }

  const [lockModalOpen, setLockModalOpen] = useState(false);
  const [lockDraftGlobal, setLockDraftGlobal] = useState(false);
  const [lockDraftReason, setLockDraftReason] = useState("");
  const [lockDraftUnits, setLockDraftUnits] = useState<UnitLock[]>([]);
  const [lockSeatFloors, setLockSeatFloors] = useState<{ id: string; name?: string; units: { label: string }[] }[]>([]);

  async function openLockModal() {
    setLockModalOpen(true);
    setLockDraftGlobal(borrowLock.locked);
    setLockDraftReason(borrowLock.reason || "");
    setLockDraftUnits(borrowLock.units || []);
    try {
      const map = await fetchSeatMap(scriptUrl);
      setLockSeatFloors((map.floors || []) as any);
    } catch (e) { /* 좌석 배치도를 못 받으면 전체 잠금만 사용한다 */ }
  }

  function toggleUnitLock(floor: string, unit: string) {
    const key = unitLockKey(floor, unit);
    setLockDraftUnits((prev) =>
      prev.some((u) => unitLockKey(u.floor, u.unit) === key)
        ? prev.filter((u) => unitLockKey(u.floor, u.unit) !== key)
        : [...prev, { floor, unit, reason: "" }]
    );
  }

  async function submitLock() {
    setLockBusy(true);
    try {
      const res = await setBorrowLock(scriptUrl, lockDraftGlobal, lockDraftReason.trim(), lockDraftUnits);
      if (res.success) {
        setBorrowLockState(res.lock || { locked: lockDraftGlobal, reason: lockDraftReason, units: lockDraftUnits });
        setLockModalOpen(false);
        showToast(
          lockDraftGlobal
            ? "대여를 전체 잠갔습니다. 반납은 계속 가능합니다."
            : lockDraftUnits.length
              ? `${lockDraftUnits.length}개 유닛의 대여를 잠갔습니다.`
              : "대여 잠금을 모두 해제했습니다.",
          "ok"
        );
      } else {
        showToast(res.message || "설정에 실패했습니다.", "error");
      }
    } catch (e: any) {
      showToast(`설정 실패: ${e.message}`, "error");
    } finally {
      setLockBusy(false);
    }
  }

  // 랜딩 공지 작성 (관리자 전용)
  const [noticeModalOpen, setNoticeModalOpen] = useState(false);
  const [noticeDrafts, setNoticeDrafts] = useState<NoticeData[]>([]);
  const [noticeSaving, setNoticeSaving] = useState(false);

  // 구버전 감지: 처음 접속했을 때의 서버 버전을 기억해두고, 2분마다 서버의 현재 버전과 비교한다.
  // 그 사이 관리자가 GAS를 새 버전으로 재배포했으면 값이 달라지므로, 새로고침 전까지 안 사라지는 경고를 띄운다.
  useEffect(() => {
    // 테스트용: 주소 뒤에 ?test_outdated=1 을 붙이면 GAS를 새로 배포하지 않아도 바로 경고 화면을 확인할 수 있다.
    // 예: https://내주소/?test_outdated=1
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("test_outdated") === "1") {
      setVersionMismatch(true);
      return;
    }
    if (!connected || !scriptUrl) return;
    let cancelled = false;
    // 구버전 판정 기준은 오직 하나: 관리자가 발급한 APP_VERSION.
    // (배포 자체를 자동 감지하지 않는다. GAS·Vercel 배포를 모두 마친 뒤 관리자가
    //  "새 버전 발급"을 눌러야 비로소 구버전 화면들이 차단된다 — 차단 시점을 관리자가 통제한다.)
    const check = async () => {
      try {
        const v = await fetchBorrowAppVersion(scriptUrl);
        if (cancelled || !v) return;
        if (!baselineAppVersionRef.current) {
          baselineAppVersionRef.current = v;
        } else if (baselineAppVersionRef.current !== v) {
          setVersionMismatch(true);
        }
      } catch (e) { /* 조회 실패는 무시 — 부가 점검용 폴링이므로 앱 동작을 막지 않는다 */ }
    };
    check();
    // 재배포 직후 구버전 상태로 대여/반납을 진행하는 시간을 줄이기 위해 40초 주기로 확인한다.
    const interval = setInterval(check, 40000);
    // 화면을 다시 볼 때(탭 전환 복귀 등)에도 즉시 한 번 확인한다.
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [connected, scriptUrl]);

  // 하위 화면(대여 제출, 반납 제출 등)에서 구버전을 감지하면 window 이벤트로 알려온다.
  // 폴링 주기와 무관하게, 어느 단계에 있든 즉시 오버레이를 띄운다.
  useEffect(() => {
    const onOutdated = () => setVersionMismatch(true);
    window.addEventListener(VERSION_OUTDATED_EVENT, onOutdated);
    return () => window.removeEventListener(VERSION_OUTDATED_EVENT, onOutdated);
  }, []);

  useEffect(() => {
    const update = () => setVersionWorkItems(getVersionWorkItems());
    update();
    window.addEventListener(VERSION_WORK_CHANGED_EVENT, update);
    return () => window.removeEventListener(VERSION_WORK_CHANGED_EVENT, update);
  }, []);

  // 구버전 경고: JSX 트리와 무관하게 화면 전체를 덮는 오버레이를 DOM에 직접 붙인다.
  // (App 컴포넌트 안에 화면별 return 분기가 여러 개라, 특정 화면에서만 빠지는 걸 방지)
  // 화면 전체를 반투명/블러 배경으로 덮고 클릭도 막아서, 새로고침 전에는 정상적인 조작이 불가능하게 한다.
  useEffect(() => {
    if (!versionMismatch) return;
    const el = document.createElement("div");
    el.id = "wms-version-banner";
    const working = versionWorkItems.length > 0;
    const workLabel = versionWorkItems.map((item) => item.label).filter(Boolean).join(" · ");
    el.style.cssText = working
      ? "position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:999999;width:min(680px,calc(100% - 28px));font-family:inherit;pointer-events:none;"
      : "position:fixed;inset:0;z-index:999999;background:rgba(15,23,42,0.35);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:24px;font-family:inherit;";
    el.innerHTML = working
      ? '<div style="background:#fff7ed;border:1px solid #fdba74;border-radius:14px;padding:13px 15px;display:flex;align-items:center;gap:12px;box-shadow:0 10px 32px rgba(0,0,0,0.2);pointer-events:auto;">'
        + '<div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:800;color:#9a3412;">새 버전이 있습니다 · 현재 작업을 먼저 완료해주세요</div>'
        + `<div style="margin-top:3px;font-size:11.5px;color:#7c2d12;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${workLabel || "진행 중인 작업"} · 완료되면 새로고침 안내로 전환됩니다.</div></div>`
        + '<button id="wms-version-refresh-btn" style="flex-shrink:0;padding:8px 13px;border-radius:999px;border:1px solid #fb923c;background:#fff;color:#9a3412;cursor:pointer;font-size:11.5px;font-weight:800;">지금 새로고침</button>'
        + '</div>'
      : '<div style="background:rgba(255,255,255,0.92);border-radius:20px;padding:28px 32px;display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center;max-width:360px;box-shadow:0 12px 40px rgba(0,0,0,0.25);">'
        + '<div style="font-size:14px;font-weight:700;color:#111827;">새 버전이 있어요</div>'
        + '<div style="font-size:12.5px;color:#6b7280;line-height:1.6;">진행 중인 작업이 없습니다. 새로고침하면 최신 버전이 적용됩니다.</div>'
        + '<button id="wms-version-refresh-btn" style="margin-top:4px;padding:10px 24px;border-radius:999px;border:none;background:#2563eb;color:#fff;cursor:pointer;font-size:13px;font-weight:700;">새로고침</button>'
        + '</div>';
    document.body.appendChild(el);
    if (!working) document.body.style.overflow = "hidden";
    const btn = document.getElementById("wms-version-refresh-btn");
    const handler = () => window.location.reload();
    if (btn) btn.addEventListener("click", handler);
    return () => {
      if (btn) btn.removeEventListener("click", handler);
      if (el.parentNode) el.parentNode.removeChild(el);
      document.body.style.overflow = "";
    };
  }, [versionMismatch, versionWorkItems]);

  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");

  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(() => {
    const saved = localStorage.getItem("wms_last_sync");
    return saved ? new Date(saved) : null;
  });

  const [isLightMode, setIsLightMode] = useState(() => {
    const saved = localStorage.getItem("wms_light_mode");
    return saved === null ? true : saved === "true";
  });

  const toggleLightMode = () => {
    setIsLightMode((prev) => {
      const next = !prev;
      safeSetLocalStorage("wms_light_mode", String(next));
      return next;
    });
  };

  // 글자 크기 배율 (0.9 ~ 1.3), 접근성/현장 가독성용
  const [fontScale, setFontScale] = useState<number>(() => {
    const saved = parseFloat(localStorage.getItem("wms_font_scale") || "1");
    return isNaN(saved) ? 1 : Math.min(1.3, Math.max(0.9, saved));
  });
  const cycleFontScale = () => {
    setFontScale((prev) => {
      const steps = [0.9, 1, 1.1, 1.2, 1.3];
      const idx = steps.findIndex((s) => Math.abs(s - prev) < 0.001);
      const next = steps[(idx + 1) % steps.length];
      safeSetLocalStorage("wms_font_scale", String(next));
      return next;
    });
  };
  useEffect(() => {
    document.documentElement.style.setProperty("--wms-font-scale", String(fontScale));
  }, [fontScale]);

  const [toast, setToast] = useState<{ msg: string; type: "info" | "ok" | "warn" | "error" } | null>(null);
  const [zoom, setZoom] = useState(1.0);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const [showAddForm, setShowAddForm] = useState(false);
  const [defaultLocationForNewItem, setDefaultLocationForNewItem] = useState<string | null>(null);
  const [defaultSpecForNewItem, setDefaultSpecForNewItem] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [stockAdjustItem, setStockAdjustItem] = useState<InventoryItem | null>(null);
  const [showItemSetManager, setShowItemSetManager] = useState(false);

  // 탭(뷰)을 전환하면 열려 있던 품목 편집/추가 모달을 닫는다.
  useEffect(() => {
    setEditingItem(null);
    setShowAddForm(false);
    setStockAdjustItem(null);
    setShowItemSetManager(false);
  }, [currentView]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [highlightShelf, setHighlightShelf] = useState<string | null>(null);
  const [highlightedItemRowIndex, setHighlightedItemRowIndex] = useState<number | null>(null);

  const [showAddRackModal, setShowAddRackModal] = useState(false);
  const [newRackCode, setNewRackCode] = useState("");
  const [newRackName, setNewRackName] = useState("");

  const [displayMode, setDisplayMode] = useState<"grid" | "canvas">("grid");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // 모바일에서는 사이드바가 화면을 가리므로 평소에는 접어두고 햄버거로 연다.
  // 예전에는 모바일 전용 화면(MobileViewPage)이 탭 막대를 따로 갖고 있었는데, 같은 기능을
  // 두 벌로 만들다 보니 한쪽만 고쳐지고 검색창도 둘로 갈렸다. 이제 PC와 같은 사이드바를 쓴다.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  useEffect(() => { setMobileNavOpen(false); }, [currentView]);

  // 2. Refs
  const pendingUpdates = useRef<{ [rowIndex: number]: { stock: number; expiry: number } }>({});
  const canvasRef = useRef<HTMLDivElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number; zoom: number } | null>(null);
  const rotateState = useRef<{ id: string; cx: number; cy: number; startAngle: number } | null>(null);
  const panState = useRef<{ startX: number; startY: number; origPan: { x: number; y: number } } | null>(null);
  const initializedRef = useRef(false);

  // 3. 토스트 알림 표시 유틸
  // 토큰으로 각 호출을 구분해, 겹쳐서 호출됐을 때 오래된 타이머가 방금 뜬 새 토스트를
  // 조기에 지워버리는 문제를 막는다. (예: A 토스트 → 곧이어 B 토스트가 뜬 경우,
  // A의 2.8초 타이머가 나중에 발동해 B를 순식간에 지워버려 "경고가 안 뜬 것처럼" 보이는 버그)
  const toastTokenRef = useRef(0);
  // useCallback으로 감싸 참조가 렌더마다 바뀌지 않게 한다. 안 그러면 showToast를
  // 의존성 배열에 넣은 여러 화면의 useEffect(재고 변경 이력 조회 등)가 App이 리렌더될
  // 때마다 "함수가 바뀌었다"고 오인해 데이터를 계속 다시 불러오며 깜빡이게 된다.
  const showToast = useCallback((msg: string, type: "info" | "ok" | "warn" | "error" = "info") => {
    const myToken = ++toastTokenRef.current;
    setToast({ msg, type });
    setTimeout(() => {
      if (toastTokenRef.current === myToken) setToast(null);
    }, 2800);
  }, []);

  /* 사람이 움직이면 시각을 갱신하고, 4시간 넘게 아무 일도 없으면 로그아웃한다.
   * 매 동작마다 쓰면 저장이 너무 잦으므로 1분에 한 번만 갱신한다.
   * 창을 닫으면 sessionStorage가 통째로 사라지므로 따로 처리할 것이 없다. */
  useEffect(() => {
    if (!borrower) return;
    let lastWrite = 0;
    const bump = () => {
      const now = Date.now();
      if (now - lastWrite < 60000) return;
      lastWrite = now;
      touchBorrower(borrower);
    };
    // 이 탭의 이 페이지에서 일어난 동작만 센다. 다른 탭이나 다른 프로그램에서 무엇을 하든
    // 이 창에는 이벤트가 오지 않으므로 시간은 계속 흐른다.
    //
    // visibilitychange는 넣지 않는다 — 탭을 떠날 때도 함께 발생해서, 다른 탭을 오가기만 해도
    // 계속 쓰는 중으로 잡힌다. 대신 "이 탭으로 돌아왔을 때"만 갱신한다.
    const events = ["pointerdown", "keydown", "scroll", "wheel"] as const;
    for (const e of events) window.addEventListener(e, bump, { passive: true });
    const onVisible = () => { if (!document.hidden) bump(); };
    document.addEventListener("visibilitychange", onVisible);

    const timer = window.setInterval(() => {
      try {
        const raw = sessionStorage.getItem(BORROWER_KEY);
        const at = raw ? JSON.parse(raw)?.at || 0 : 0;
        if (!raw || Date.now() - at > IDLE_LIMIT_MS) {
          setBorrower(null);
          touchBorrower(null);
          clearIdentity();
          showToast("4시간 동안 사용이 없어 자동으로 로그아웃되었습니다.", "info");
        }
      } catch { /* 읽기 실패는 다음 회차에 다시 본다 */ }
    }, 60000);

    return () => {
      for (const e of events) window.removeEventListener(e, bump);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [borrower, touchBorrower, showToast]);

  // 3-1. 모바일용 관리자 모드 시스템 활성화 지원
  useEffect(() => {
    // 모바일에서도 관리자 모드를 정식 지원하므로 자동 강등 처리 제거
  }, [isMobile]);

  // 3-2. 검색결과 외부 클릭 감지하여 닫기 및 화면 전환 시 자동 닫기
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    setSearchOpen(false);
  }, [currentView]);

  // 4. 초기 레이아웃 복원
  useEffect(() => {
    // 로컬 스토리지에 캐시된 인벤토리/랙이 있다면 자동 로드 (아래 silentRefresh가 즉시 실행되어 최신 데이터로 갱신됨)
    const cachedInv = localStorage.getItem("wms_cached_inventory");
    const cachedRacks = localStorage.getItem("wms_cached_racks");

    if (cachedInv && cachedRacks) {
      try {
        setInventory(JSON.parse(cachedInv));
        setRacks(JSON.parse(cachedRacks));
        initializedRef.current = true;
      } catch (e) {
        // 캐시 파싱 에러 시 데모 기본값 로드
        const r = autoLayoutRacks(DEMO_INVENTORY, []);
        setRacks(r);
        initializedRef.current = true;
      }
    } else {
      const r = autoLayoutRacks(inventory, []);
      setRacks(r);
      initializedRef.current = true;
    }

    silentRefresh();
  }, []); // eslint-disable-line

  // 랙 정보가 변경될 때마다 캐시에 저장
  useEffect(() => {
    if (racks.length > 0) {
      safeSetLocalStorage("wms_cached_racks", JSON.stringify(racks));
    }
  }, [racks]);

  useEffect(() => {
    if (inventory.length > 0) {
      safeSetLocalStorage("wms_cached_inventory", JSON.stringify(inventory));
    }
  }, [inventory]);

  useEffect(() => {
    if (defectLogs.length > 0) {
      safeSetLocalStorage("wms_cached_defect_logs", JSON.stringify(defectLogs));
    }
  }, [defectLogs]);

  useEffect(() => {
    if (rentLogs.length > 0) {
      safeSetLocalStorage("wms_cached_rent_logs", JSON.stringify(rentLogs));
    }
  }, [rentLogs]);

  useEffect(() => {
    safeSetLocalStorage("wms_is_admin", String(isAdmin));
  }, [isAdmin]);

  /* ---------------- 로컬 백엔드 API 연동 로직 ---------------- */
  async function callScript(action: string, payload: any) {
    if (!scriptUrl) throw new Error("서버 연동 URL이 입력되지 않았습니다.");
    
    let res;
    // 타임아웃이 없으면 네트워크가 끊겼을 때 화면이 몇 분씩 멈춘다. 다만 이 경로는 재고 변경 등
    // 되돌릴 수 없는 처리를 하므로, 끊긴 뒤 자동 재시도는 하지 않고 "확인 후 재시도"만 안내한다.
    const TIMEOUT_MS = 45000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      res = await withGasConcurrencyLimit(() => fetch(scriptUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" }, // CORS 프리플라이트를 피하기 위한 text/plain 설정
        body: JSON.stringify({
          action,
          payload: payload && typeof payload === "object" && !Array.isArray(payload)
            ? { ...payload, _actor: payload._actor || currentUser?.name || currentUser?.id || "관리자" }
            : payload,
        }),
        signal: controller.signal,
      }));
    } catch (e: any) {
      if (e?.name === "AbortError") {
        throw new Error(`서버 응답이 ${Math.round(TIMEOUT_MS / 1000)}초 안에 오지 않았습니다. 처리가 이미 완료됐을 수도 있으니, 새로고침해 확인한 뒤 다시 시도해주세요.`);
      }
      throw new Error(`서버 연결 실패: ${e.message}`);
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.error("Non-JSON Response received:", text);
      throw new Error("서버가 올바르지 않은 응답을 반환했습니다.");
    }

    if (!data.success) throw new Error(data.error || "요청 실패");
    return data;
  }

  async function fetchAll(forceRefresh?: boolean) {
    if (!scriptUrl) throw new Error("연동 URL이 비어 있습니다.");

    // 대시보드 화면 하나가 여러 부분(재고/랙/로그 등)을 동시에 필요로 하므로,
    // 큰 응답 한 번보다 작은 조각들로 나눠 받아 합치는 편이 안정적이다.
    const PARTS = ["inventory", "sectors", "users", "rentLogs", "defectLogs", "robotObjects"] as const;
    try {
      const merged: any = { success: true };
      for (const part of PARTS) {
        // 조각 하나가 echo 404(HTML)로 실패해도, 조각별 재조회를 바로 포기하고 통짜
        // 조회로 넘어가지 않는다 — 통짜 조회야말로 애초에 조각내서 피하려던, 가장
        // 크고 잘 터지는 요청이기 때문이다. 짧게 쉬었다가 그 조각만 다시 시도한다.
        const PART_RETRIES = 2;
        let d: any = null;
        let lastErr: any = null;
        for (let attempt = 0; attempt <= PART_RETRIES; attempt++) {
          const bust = `_ts=${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const url = `${scriptUrl}?action=getAll&part=${part}${forceRefresh ? "&forceRefresh=1" : ""}&${bust}`;
          try {
            const r = await withGasConcurrencyLimit(() => fetch(url, { cache: "no-store" }));
            const t = await r.text();
            d = JSON.parse(t); // 조각이 JSON이 아니면 catch로 넘어가 재시도
            lastErr = null;
            break;
          } catch (e) {
            lastErr = e;
            if (attempt < PART_RETRIES) {
              await new Promise((res) => setTimeout(res, 400 + attempt * 400));
            }
          }
        }
        if (lastErr) throw lastErr; // 조각 하나가 재시도 끝까지 실패하면 아래 catch에서 통짜 조회로 폴백
        if (d && d.success) Object.assign(merged, d);
      }
      // 최소한 재고가 들어왔으면 정상 응답으로 본다
      if (merged.inventory) return merged;
    } catch (partErr) {
      // 조각 방식이 재시도까지 다 실패하면(구버전 서버 등) 아래의 기존 통짜 조회로 넘어간다
      console.warn("부분 조회 실패, 전체 조회로 대체합니다:", partErr);
    }

    let res;
    try {
      const bust = `_ts=${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      res = await withGasConcurrencyLimit(() => fetch(
        `${scriptUrl}?action=getAll${forceRefresh ? "&forceRefresh=1" : ""}&${bust}`,
        { cache: "no-store" }
      ));
    } catch (e: any) {
      throw new Error(`서버 연결 실패: ${e.message}`);
    }

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.error("Non-JSON Response received on fetchAll:", text);
      throw new Error("서버가 올바르지 않은 응답을 반환했습니다.");
    }

    if (!data.success) throw new Error(data.error || "조회 실패");
    return data;
  }

  // 서버에서 받은 인벤토리 데이터와 아직 반영 중인 로컬의 최신 재고(낙관적 업데이트)를 병합하여 깜빡임 방지
  function mergePendingStocks(serverInv: InventoryItem[]): InventoryItem[] {
    const now = Date.now();
    return serverInv.map((item) => {
      const pending = pendingUpdates.current[item.rowIndex];
      if (pending && now < pending.expiry) {
        return { ...item, stock: pending.stock };
      }
      return item;
    });
  }

  // 백그라운드 무소음 리프레시 (사용자 흐름 방해 없이 자동 싱크)
  async function silentRefresh() {
    try {
      const data = await fetchAll();
      const rawInv = data.inventory && data.inventory.length > 0 ? data.inventory : DEMO_INVENTORY;
      const inv = mergePendingStocks(rawInv);
      setInventory(inv);
      if (data.sectors && data.sectors.length > 0) {
        setRacks(racksFromServerSectors(data.sectors, inv));
      }
      if (data.defectLogs) {
        setDefectLogs(data.defectLogs);
      }
      if (data.robotObjects) {
        setRobotObjects(data.robotObjects);
        safeSetLocalStorage("wms_cached_robot_objects", JSON.stringify(data.robotObjects));
      }
      if (data.rentLogs) {
        setRentLogs(data.rentLogs);
      }
      if (data.users && data.users.length > 0) {
        setUsers(data.users);
        safeSetLocalStorage("wms_cached_users", JSON.stringify(data.users));
      }
      setLastSync(new Date());
    } catch (e) {
      // 무소음 실패는 무시
    }
  }

  // 60초 주기로 DB 최신 데이터 자동 동기화.
  // (원래 10초였는데, 반납 화면의 자체 폴링까지 겹치면 무거운 조회가 너무 잦게 나가
  //  구글이 응답 대신 오류 페이지를 돌려보내는 일이 있었다. 실제 변경이 생기는 대여/반납
  //  처리 직후에는 코드에서 즉시 갱신을 따로 호출하므로, 주기를 늘려도 체감 차이는 작다)
  useEffect(() => {
    if (!connected || !scriptUrl) return;

    // 접속 직후 한 번은 확실히 갱신한다
    silentRefresh();

    const interval = setInterval(() => {
      // 탭이 뒤에 있거나 창이 최소화된 상태면 굳이 부르지 않는다.
      // 사람이 안 보고 있는 화면까지 계속 갱신하면 요청만 늘고 얻는 게 없다.
      if (document.hidden) return;
      silentRefresh();
    }, 120000); // 2분 간격 폴링

    // 다른 탭을 보다 돌아왔을 때는 즉시 한 번 최신화해 준다.
    // (이러면 주기를 길게 잡아도 실제로 화면을 보는 순간의 최신성은 유지된다)
    const onVisible = () => { if (!document.hidden) silentRefresh(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // currentView는 일부러 뺐다. 넣으면 화면을 전환할 때마다 폴링이 재시작되면서
    // 그때마다 요청이 한 번씩 더 나가, 화면을 자주 오갈수록 호출량이 불어난다.
  }, [connected, scriptUrl]); // eslint-disable-line

  // 서버 데이터와 랙 선반 정보 병합
  function racksFromServerSectors(sectors: any[], inv: InventoryItem[]): Rack[] {
    const rackShelves: { [key: string]: Set<string> } = {};
    inv.forEach((item) => {
      const { rack } = parseLocation(item.location);
      if (!rack) return;
      if (!rackShelves[rack]) rackShelves[rack] = new Set<string>();
      rackShelves[rack].add(item.location.trim());
    });

    return sectors.map((s, i) => ({
      id: s.id,
      name: s.name || `${s.id} 랙`,
      x: s.x,
      y: s.y,
      width: s.width || 200,
      height: s.height || 200,
      rotation: s.rotation || 0,
      color: s.color || "#9CAF97",
      shelves: Array.from(rackShelves[s.id] || []).sort(),
    }));
  }

  // 첫 연동 테스트
  async function handleConnect() {
    // 로컬 백엔드는 항상 /api/gas에 있으므로 URL 검증 없이 바로 재조회한다.
    setConnecting(true);
    setConnectError("");
    try {
      const data = await fetchAll();
      const rawInv = data.inventory && data.inventory.length > 0 ? data.inventory : DEMO_INVENTORY;
      const inv = mergePendingStocks(rawInv);
      setInventory(inv);
      
      let nextRacks: Rack[] = [];
      if (data.sectors && data.sectors.length > 0) {
        nextRacks = racksFromServerSectors(data.sectors, inv);
      } else {
        nextRacks = autoLayoutRacks(inv, []);
      }
      setRacks(nextRacks);

      if (data.defectLogs) {
        setDefectLogs(data.defectLogs);
      }

      if (data.robotObjects) {
        setRobotObjects(data.robotObjects);
        safeSetLocalStorage("wms_cached_robot_objects", JSON.stringify(data.robotObjects));
      }

      if (data.rentLogs) {
        setRentLogs(data.rentLogs);
      }

      if (data.users && data.users.length > 0) {
        setUsers(data.users);
        safeSetLocalStorage("wms_cached_users", JSON.stringify(data.users));
      }

      // 로컬 스토리지에 연동 정보 저장
      safeSetLocalStorage("wms_script_url", scriptUrl.trim());
      safeSetLocalStorage("wms_connected", "true");
      safeSetLocalStorage("wms_last_sync", new Date().toISOString());

      setConnected(true);
      setLastSync(new Date());
      showToast("서버 연동 완료! 실시간 저장 모드가 활성화되었습니다.", "ok");
    } catch (err: any) {
      setConnectError("서버 연동 실패: " + err.message);
    } finally {
      setConnecting(false);
    }
  }

  // 실시간 새로고침 — 서버 캐시를 무시하고 데이터를 직접 다시 읽는다.
  async function handleRefresh() {
    if (!connected) {
      showToast("현재 가상 데모 모드입니다.", "warn");
      return;
    }
    setInventoryRefreshing(true);
    showToast("DB 동기화 진행 중...", "info");
    try {
      const data = await fetchAll(true);
      const rawInv = data.inventory || [];
      const inv = mergePendingStocks(rawInv);
      setInventory(inv);
      if (data.sectors && data.sectors.length > 0) {
        setRacks(racksFromServerSectors(data.sectors, inv));
      }
      if (data.defectLogs) {
        setDefectLogs(data.defectLogs);
      }
      if (data.rentLogs) {
        setRentLogs(data.rentLogs);
      }
      if (data.users && data.users.length > 0) {
        setUsers(data.users);
        safeSetLocalStorage("wms_cached_users", JSON.stringify(data.users));
      }
      setLastSync(new Date());
      safeSetLocalStorage("wms_last_sync", new Date().toISOString());
      setDirty(false);
      showToast("실시간 DB 동기화 완료!", "ok");
    } catch (err: any) {
      showToast("동기화 실패: " + err.message, "error");
    } finally {
      setInventoryRefreshing(false);
    }
  }

  // 랙 배치 레이아웃 DB 저장
  async function persistLayout(nextRacks: Rack[]) {
    if (!connected) {
      setDirty(true);
      return;
    }
    setSaving(true);
    try {
      const sectors = nextRacks.map((r) => ({
        id: r.id,
        name: r.name,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        rotation: r.rotation,
        color: r.color,
        group: r.id,
      }));
      await callScript("saveSectorLayout", { sectors });
      setLastSync(new Date());
      safeSetLocalStorage("wms_last_sync", new Date().toISOString());
      setDirty(false);
    } catch (err: any) {
      showToast("배치 저장 실패: " + err.message, "error");
    } finally {
      setSaving(false);
    }
  }

  // 디바운스 레이아웃 저장 타이머
  const saveTimer = useRef<NodeJS.Timeout | null>(null);
  function scheduleSave(nextRacks: Rack[]) {
    setDirty(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      persistLayout(nextRacks);
    }, 800);
  }

  /* ---------------- 랙 배치 및 조작 ---------------- */
  function regenerateFromInventory() {
    const r = autoLayoutRacks(inventory, racks);
    setRacks(r);
    scheduleSave(r);
    showToast("DB 위치 코드 분석을 기반으로 랙을 자동 배치하였습니다.", "ok");
  }

  function addManualRack() {
    setNewRackCode("");
    setNewRackName("");
    setShowAddRackModal(true);
  }

  function handleCreateManualRack() {
    const id = newRackCode.trim().toUpperCase();
    if (!id) {
      showToast("올바른 단축 코드를 입력해야 합니다.", "warn");
      return;
    }

    if (racks.some((r) => r.id === id)) {
      showToast(`이미 '${id}' 단축 코드를 사용하는 구역이 존재합니다.`, "warn");
      return;
    }

    const name = newRackName.trim() || `${id} 구역`;

    const newRack: Rack = {
      id,
      name,
      x: snap(120 + Math.random() * 200),
      y: snap(120 + Math.random() * 200),
      width: 200,
      height: 200,
      rotation: 0,
      color: "#8FA3B8",
      shelves: [],
    };
    const next = [...racks, newRack];
    setRacks(next);
    scheduleSave(next);
    setSelectedRackId(id);
    setShowAddRackModal(false);
    showToast(`'${name}' (${id}) 구역이 새로 생성되었습니다.`, "ok");
  }

  function deleteRack(id: string) {
    const next = racks.filter((r) => r.id !== id);
    setRacks(next);
    setSelectedRackId(null);
    scheduleSave(next);
    if (connected) {
      callScript("deleteSector", { sectorId: id }).catch(() => {});
    }
    showToast("랙 구역을 철거하였습니다.", "info");
  }

  function updateRackField(id: string, fields: Partial<Rack>) {
    const next = racks.map((r) => (r.id === id ? { ...r, ...fields } : r));
    setRacks(next);
    scheduleSave(next);
  }

  /* ---------------- 랙 이동 마우스 드래그 ---------------- */
  const onPointerDownMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, rack: Rack) => {
      e.stopPropagation();
      setSelectedRackId(rack.id);
      const startX = e.clientX;
      const startY = e.clientY;
      dragState.current = {
        id: rack.id,
        startX,
        startY,
        origX: rack.x,
        origY: rack.y,
        zoom,
      };

      function onMove(ev: PointerEvent) {
        if (!dragState.current) return;
        const dx = (ev.clientX - dragState.current.startX) / dragState.current.zoom;
        const dy = (ev.clientY - dragState.current.startY) / dragState.current.zoom;
        
        setRacks((prev) =>
          prev.map((r) =>
            r.id === dragState.current!.id
              ? {
                  ...r,
                  x: Math.max(0, snap(dragState.current!.origX + dx)),
                  y: Math.max(0, snap(dragState.current!.origY + dy)),
                }
              : r
          )
        );
      }

      function onUp() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        dragState.current = null;
        setRacks((prev) => {
          scheduleSave(prev);
          return prev;
        });
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [zoom]
  );

  /* ---------------- 랙 모서리 수동 회전 ---------------- */
  const onPointerDownRotate = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, rack: Rack) => {
      e.stopPropagation();
      e.preventDefault();
      const canvasEl = canvasRef.current;
      if (!canvasEl) return;
      const rect = canvasEl.getBoundingClientRect();
      const cx = rect.left + (rack.x + rack.width / 2) * zoom;
      const cy = rect.top + (rack.y + rack.height / 2) * zoom;

      const angleFromCenter = (xVal: number, yVal: number) => {
        return (Math.atan2(yVal - cy, xVal - cx) * 180) / Math.PI;
      };

      rotateState.current = {
        id: rack.id,
        cx,
        cy,
        startAngle: angleFromCenter(e.clientX, e.clientY) - rack.rotation,
      };

      function onMove(ev: PointerEvent) {
        if (!rotateState.current) return;
        const current = angleFromCenter(ev.clientX, ev.clientY);
        let rotation = current - rotateState.current.startAngle;
        
        // Shift 키 홀드 시 15도 스냅 정렬 기능 지원
        if (ev.shiftKey) {
          rotation = Math.round(rotation / 15) * 15;
        }
        
        setRacks((prev) =>
          prev.map((r) =>
            r.id === rotateState.current!.id ? { ...r, rotation: Math.round(rotation) } : r
          )
        );
      }

      function onUp() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        rotateState.current = null;
        setRacks((prev) => {
          scheduleSave(prev);
          return prev;
        });
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [zoom]
  );

  /* ---------------- 캔버스 팬 / 휠 줌 조작 ---------------- */
  function onCanvasPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // 랙 박스를 클릭했을 때는 배경 팬이 작동하지 않도록 함
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains("canvas-bg")) {
      return;
    }
    setSelectedRackId(null);
    setSearchOpen(false);
    panState.current = { startX: e.clientX, startY: e.clientY, origPan: { ...pan } };

    function onMove(ev: PointerEvent) {
      if (!panState.current) return;
      const dx = ev.clientX - panState.current.startX;
      const dy = ev.clientY - panState.current.startY;
      setPan({
        x: panState.current.origPan.x + dx,
        y: panState.current.origPan.y + dy,
      });
    }

    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      panState.current = null;
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
    // 확대축소 한계치 설정 (0.4배 ~ 2.2배)
    const delta = e.deltaY > 0 ? -0.06 : 0.06;
    setZoom((z) => Math.min(2.2, Math.max(0.4, z + delta)));
  }

  /* ---------------- 선택한 구역의 선반별 필터링 ---------------- */
  const selectedRack = useMemo(() => {
    return racks.find((r) => r.id === selectedRackId);
  }, [racks, selectedRackId]);

  const shelvesWithItems = useMemo(() => {
    if (!selectedRack) return [];
    const map: { [key: string]: InventoryItem[] } = {};
    inventory.forEach((it) => {
      const { rack } = parseLocation(it.location);
      if (rack !== selectedRack.id) return;
      const loc = it.location.trim().toUpperCase();
      if (!map[loc]) map[loc] = [];
      map[loc].push(it);
    });
    return Object.keys(map)
      .sort((a, b) => {
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
      })
      .map((loc) => {
        // 같은 선반 내의 아이템들을 가나다 & ABC, 숫자 순으로 정렬
        const sortedItems = [...map[loc]].sort((a, b) => {
          const nameA = a.name || "";
          const nameB = b.name || "";
          return nameA.localeCompare(nameB, "ko", { sensitivity: "base", numeric: true });
        });
        return { shelf: loc, items: sortedItems };
      });
  }, [selectedRack, inventory]);

  const totalStockByRack = useMemo(() => {
    const map: { [key: string]: number } = {};
    inventory.forEach((it) => {
      const { rack } = parseLocation(it.location);
      if (!rack) return;
      map[rack] = (map[rack] || 0) + (typeof it.stock === "number" ? it.stock : 0);
    });
    return map;
  }, [inventory]);

  const itemCountByRack = useMemo(() => {
    const map: { [key: string]: number } = {};
    inventory.forEach((it) => {
      const { rack } = parseLocation(it.location);
      if (!rack) return;
      map[rack] = (map[rack] || 0) + 1;
    });
    return map;
  }, [inventory]);

  /* ---------------- 품목명, 스펙 검색 ---------------- */
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return inventory
      .filter(
        (it) =>
          isFuzzyMatch(it.name || "", searchQuery) ||
          isFuzzyMatch(it.location || "", searchQuery) ||
          isFuzzyMatch(it.spec || "", searchQuery) ||
          isFuzzyMatch(it.note || "", searchQuery) ||
          isFuzzyMatch(it.manager || "", searchQuery)
      )
      .slice(0, 30);
  }, [searchQuery, inventory]);

  function focusOnItem(item: InventoryItem) {
    const { rack } = parseLocation(item.location);
    setSelectedRackId(rack);
    setHighlightShelf(item.location.trim());
    setHighlightedItemRowIndex(item.rowIndex ?? null);
    setSearchOpen(false);
    
    showToast(`🔍 ${item.name}의 위치(${item.location})로 자동 이동하였습니다.`, "ok");

    // 해당 랙 카드가 있는 위치로 스크롤 이동
    setTimeout(() => {
      const element = document.getElementById(`rack-card-${rack}`);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 100);

    setTimeout(() => {
      setHighlightShelf(null);
      setHighlightedItemRowIndex(null);
    }, 5000);
  }

  /* ---------------- 품목 추가 / 수정 / 삭제 실시간 연동 ---------------- */
  async function saveInventoryItem(item: Omit<InventoryItem, "rowIndex"> & { rowIndex?: number }) {
    const isNew = !item.rowIndex;
    const originalInventory = [...inventory]; // 실패 시 롤백용 원본 백업

    // 1. 임시 로컬 데이터를 만들어 상태에 즉시 반영 (낙관적 업데이트)
    let optimisticItem: InventoryItem;
    if (isNew) {
      const nextRow = Math.max(0, ...inventory.map((i) => i.rowIndex)) + 1;
      optimisticItem = {
        ...item,
        rowIndex: nextRow,
        updatedAt: formatTimestampLocal(),
      } as InventoryItem;
      setInventory((prev) => [...prev, optimisticItem]);
    } else {
      optimisticItem = {
        ...item,
        updatedAt: formatTimestampLocal(),
      } as InventoryItem;
      setInventory((prev) =>
        prev.map((i) => (i.rowIndex === item.rowIndex ? { ...i, ...optimisticItem } : i))
      );
    }

    // 폼 즉시 닫기 (기다리는 시간 0초 극대화)
    setEditingItem(null);
    setShowAddForm(false);
    showToast(isNew ? "신규 품목 등록 중... (백그라운드 동기화)" : "품목 스펙 저장 중... (백그라운드 동기화)", "info");

    // 2. 백그라운드 서버 연동 (비동기 수행)
    if (connected) {
      setSaving(true);
      const action = isNew ? "addInventoryItem" : "updateInventoryItem";
      callScript(action, item)
        .then(async () => {
          // 최신 인벤토리 실시간 재동기화
          const data = await fetchAll();
          setInventory(mergePendingStocks(data.inventory || []));
          setLastSync(new Date());
          safeSetLocalStorage("wms_last_sync", new Date().toISOString());
          showToast(isNew ? "✅ 신규 품목 동기화 완료" : "✅ 품목 스펙 동기화 완료", "ok");
        })
        .catch((err: any) => {
          console.error("백그라운드 저장 에러:", err);
          showToast("⚠️ 실시간 DB 동기화 지연: " + err.message + " (로컬 캐시는 정상 저장됨)", "warn");
          // 로컬 데이터는 보존하여 사용자의 대기 시간을 최소화하고 저장 상태를 안전하게 지킴
        })
        .finally(() => {
          setSaving(false);
        });
    } else {
      // 데모 모드일 때는 즉시 완료
      showToast(isNew ? "로컬 데모 모드에 등록되었습니다." : "로컬 데모 모드에 저장되었습니다.", "ok");
    }
  }

  // saveInventoryItem은 낙관적으로 즉시 닫고 백그라운드에서 저장하는 방식이라, 실제 서버가
  // 부여한 rowIndex를 호출한 쪽이 알 수 없다 — "신규 등록과 동시에 추가 사진도 올리기"처럼
  // 그 rowIndex가 꼭 필요한 경우에만 이 버전을 쓴다(서버 응답을 실제로 기다린다).
  async function saveNewInventoryItemAwaited(item: Omit<InventoryItem, "rowIndex">): Promise<number | null> {
    if (!connected) {
      const nextRow = Math.max(0, ...inventory.map((i) => i.rowIndex)) + 1;
      const optimisticItem = { ...item, rowIndex: nextRow, updatedAt: formatTimestampLocal() } as InventoryItem;
      setInventory((prev) => [...prev, optimisticItem]);
      showToast("로컬 데모 모드에 등록되었습니다.", "ok");
      return nextRow;
    }
    setSaving(true);
    try {
      const data = await callScript("addInventoryItem", item);
      if (data.rowIndex == null) { showToast("신규 품목 등록 실패: 서버가 rowIndex를 반환하지 않았습니다.", "error"); return null; }
      const optimisticItem = { ...item, rowIndex: data.rowIndex, photo: data.photo || item.photo, updatedAt: formatTimestampLocal() } as InventoryItem;
      setInventory((prev) => [...prev, optimisticItem]);
      setLastSync(new Date());
      safeSetLocalStorage("wms_last_sync", new Date().toISOString());
      showToast("✅ 신규 품목 동기화 완료", "ok");
      return data.rowIndex;
    } catch (err: any) {
      showToast(`신규 품목 등록 실패: ${err.message}`, "error");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function handleAddSubcategory(shelf: string, spec: string, selectedRowIndexes?: number[]) {
    if (selectedRowIndexes && selectedRowIndexes.length > 0) {
      const itemsToUpdate = inventory.filter((item) => selectedRowIndexes.includes(item.rowIndex));
      const updatedItems = itemsToUpdate.map((item) => ({
        ...item,
        spec: spec,
        updatedAt: formatTimestampLocal(),
      }));

      // Update locally
      setInventory((prev) =>
        prev.map((item) => {
          if (selectedRowIndexes.includes(item.rowIndex)) {
            return { ...item, spec: spec, updatedAt: formatTimestampLocal() };
          }
          return item;
        })
      );

      showToast(`선택한 ${selectedRowIndexes.length}개 물품의 서브 분류가 [${spec}]으로 변경되었습니다.`, "info");

      if (connected) {
        setSaving(true);
        callScript("updateMultipleInventoryItems", { items: updatedItems })
          .then(async () => {
            const data = await fetchAll();
            setInventory(mergePendingStocks(data.inventory || []));
            setLastSync(new Date());
            showToast("✅ 서버 일괄 업데이트 완료", "ok");
          })
          .catch((err: any) => {
            console.error("일괄 업데이트 에러:", err);
            showToast("⚠️ 실시간 DB 동기화 지연: " + err.message + " (로컬 캐시는 저장됨)", "warn");
          })
          .finally(() => {
            setSaving(false);
          });
      }
    } else {
      const newItem: Omit<InventoryItem, "rowIndex"> = {
        location: shelf,
        spec: spec,
        name: "새 품목",
        link: "N/A",
        stock: 0,
        photo: "",
        manager: currentUser ? (currentUser.name || currentUser.id) : "관리자",
        note: "서브 분류 생성을 위해 자동 등록된 임시 품목입니다.",
        updatedAt: formatTimestampLocal(),
      };
      await saveInventoryItem(newItem);
      showToast(`선반 [${shelf}] 에 [${spec}] 서브 분류가 생성되었습니다.`, "ok");
    }
  }

  async function handleRenameSubcategory(shelf: string, oldSubName: string, newSubName: string) {
    const itemsToUpdate = inventory.filter((item) => item.location === shelf && item.spec === oldSubName);
    if (itemsToUpdate.length === 0) return;

    const updatedItems = itemsToUpdate.map((item) => ({
      ...item,
      spec: newSubName,
      updatedAt: formatTimestampLocal(),
    }));

    // Update locally
    setInventory((prev) =>
      prev.map((item) => {
        if (item.location === shelf && item.spec === oldSubName) {
          return { ...item, spec: newSubName, updatedAt: formatTimestampLocal() };
        }
        return item;
      })
    );

    showToast(`서브 분류명이 [${oldSubName}]에서 [${newSubName}]으로 변경되었습니다.`, "info");

    if (connected) {
      setSaving(true);
      callScript("updateMultipleInventoryItems", { items: updatedItems })
        .then(async () => {
          const data = await fetchAll();
          setInventory(mergePendingStocks(data.inventory || []));
          setLastSync(new Date());
          showToast("✅ 서버 이름 수정 완료", "ok");
        })
        .catch((err: any) => {
          console.error("이름 수정 에러:", err);
          showToast("⚠️ 실시간 DB 동기화 지연: " + err.message + " (로컬 캐시는 저장됨)", "warn");
        })
        .finally(() => {
          setSaving(false);
        });
    }
  }

  // 공구 및 부품류 물품 여러 개를 골라서 한 번에 다른 위치로 옮긴다 (RackGroupedView의 "선택해서 위치 이동").
  async function handleBulkMoveLocation(rowIndexes: number[], newLocation: string) {
    const itemsToUpdate = inventory.filter((item) => rowIndexes.includes(item.rowIndex));
    if (itemsToUpdate.length === 0) return;

    const updatedItems = itemsToUpdate.map((item) => ({
      ...item,
      location: newLocation,
      updatedAt: formatTimestampLocal(),
    }));

    setInventory((prev) =>
      prev.map((item) =>
        rowIndexes.includes(item.rowIndex) ? { ...item, location: newLocation, updatedAt: formatTimestampLocal() } : item
      )
    );

    showToast(`선택한 ${rowIndexes.length}개 물품을 [${newLocation}](으)로 이동했습니다.`, "info");

    if (connected) {
      setSaving(true);
      callScript("updateMultipleInventoryItems", { items: updatedItems })
        .then(async () => {
          const data = await fetchAll();
          setInventory(mergePendingStocks(data.inventory || []));
          setLastSync(new Date());
          showToast("✅ 서버 위치 이동 완료", "ok");
        })
        .catch((err: any) => {
          console.error("위치 이동 에러:", err);
          showToast("⚠️ 실시간 DB 동기화 지연: " + err.message + " (로컬 캐시는 저장됨)", "warn");
        })
        .finally(() => {
          setSaving(false);
        });
    }
  }

  async function deleteInventoryItemRow(rowIndex: number) {
    if (!window.confirm("정말로 이 품목을 삭제하시겠습니까? 관련 데이터가 완전히 소멸합니다.")) {
      return;
    }
    const originalInventory = [...inventory];

    // 1. 낙관적으로 목록에서 즉시 제거
    setInventory((prev) => prev.filter((i) => i.rowIndex !== rowIndex));
    showToast("품목을 목록에서 삭제하였습니다. (백그라운드 동기화)", "info");

    // 2. 백그라운드 서버 연동 (비동기 수행)
    if (connected) {
      setSaving(true);
      callScript("deleteInventoryItem", { rowIndex })
        .then(async () => {
          const data = await fetchAll();
          setInventory(mergePendingStocks(data.inventory || []));
          setLastSync(new Date());
          safeSetLocalStorage("wms_last_sync", new Date().toISOString());
          showToast("✅ 서버 삭제 반영 완료", "ok");
        })
        .catch((err: any) => {
          console.error("삭제 동기화 에러:", err);
          showToast("⚠️ 삭제 DB 동기화 지연: " + err.message + " (로컬 목록은 삭제 유지됨)", "warn");
          // 로컬 목록은 지워진 상태를 그대로 유지
        })
        .finally(() => {
          setSaving(false);
        });
    }
  }

  // 공구 및 부품류 보관 처리 토글 — 시나리오 물품의 보관함과 같은 개념: 목록·대여 카탈로그에서 치워둔다.
  async function toggleArchiveInventoryItem(item: InventoryItem) {
    const next = !item.archived;
    setInventory((prev) => prev.map((i) => (i.rowIndex === item.rowIndex ? { ...i, archived: next } : i)));
    if (connected) {
      try {
        await callScript("updateInventoryItem", { rowIndex: item.rowIndex, archived: next });
        showToast(next ? "보관함으로 옮겼습니다." : "보관함에서 꺼냈습니다.", "ok");
      } catch (err: any) {
        setInventory((prev) => prev.map((i) => (i.rowIndex === item.rowIndex ? { ...i, archived: !next } : i)));
        showToast(`보관 처리 실패: ${err.message}`, "error");
      }
    }
  }

  // 불량 로그 등록 및 서버 기록 함수 (낙관적 업데이트 반영)
  async function handleAddDefectLog(log: Omit<DefectLog, "rowIndex">) {
    const tempIndex = Date.now();
    const tempLog: DefectLog = {
      ...log,
      rowIndex: tempIndex,
    };

    // 1. 화면 반응속도 향상을 위해 낙관적 즉시 추가
    setDefectLogs((prev) => [tempLog, ...prev]);
    showToast("불량 로그 등록 중... (백그라운드 동기화)", "info");

    if (connected) {
      callScript("addDefectLog", log)
        .then((res) => {
          // 실시간으로 받은 올바른 rowIndex와 구글 드라이브 이미지 URL로 교체 (대용량 base64 데이터 제거 및 최적화)
          setDefectLogs((prev) =>
            prev.map((l) => (l.rowIndex === tempIndex ? { ...l, rowIndex: res.rowIndex, photo: res.photo || l.photo } : l))
          );
          setLastSync(new Date());
          safeSetLocalStorage("wms_last_sync", new Date().toISOString());
          showToast("✅ 불량 로그 DB 기록 완료", "ok");
        })
        .catch((err: any) => {
          console.error("불량로그 동기화 실패:", err);
          showToast("⚠️ 불량로그 동기화 실패: " + err.message + " (로컬 임시 보존됨)", "warn");
        });
    } else {
      showToast("로컬 데모 모드에 불량 로그가 추가되었습니다.", "info");
    }
  }

  // 대여/반납 로그 등록 및 서버 기록 함수 (낙관적 업데이트를 적용하여 체감 속도 극대화)
  async function handleAddRentLog(log: RentLog) {
    const targetItem = inventory.find((it) => it.location === log.location && it.name === log.name);
    const rIndex = targetItem?.rowIndex;
    let nextStock: number | null = null;

    if (targetItem && typeof targetItem.stock === "number") {
      if (log.note && log.note.includes("[소모완료]")) {
        nextStock = targetItem.stock; // No change to stock
      } else if (log.type === "대여" || log.type === "소모") {
        nextStock = Math.max(0, targetItem.stock - Number(log.qty));
      } else {
        nextStock = targetItem.stock + Number(log.qty);
      }
    }

    if (rIndex !== undefined && nextStock !== null) {
      pendingUpdates.current[rIndex] = {
        stock: nextStock,
        expiry: Date.now() + 15000, // 최대 15초 동안 폴링 무시 (세이프가드)
      };
    }

    // 1. 화면 반응속도 향상을 위해 로컬 상태(로그 목록 및 인벤토리 재고) 즉시 낙관적 업데이트
    setRentLogs((prev) => [log, ...prev]);
    setInventory((prev) =>
      prev.map((it) => {
        if (it.location === log.location && it.name === log.name) {
          if (it.stock === null) {
            return {
              ...it,
              updatedAt: log.timestamp,
            };
          }
          const currentStock = it.stock;
          if (typeof currentStock !== "number") {
            return {
              ...it,
              updatedAt: log.timestamp,
            };
          }
          let calculatedNext = currentStock;
          if (log.note && log.note.includes("[소모완료]")) {
            calculatedNext = currentStock; // No change to stock
          } else if (log.type === "대여" || log.type === "소모") {
            calculatedNext = Math.max(0, currentStock - Number(log.qty));
          } else {
            calculatedNext = currentStock + Number(log.qty);
          }
          return {
            ...it,
            stock: calculatedNext,
            updatedAt: log.timestamp,
          };
        }
        return it;
      })
    );

    if (connected) {
      // 2. 백그라운드로 안전하게 서버에 연동 요청 (동기 처리 차단 없음)
      callScript("rentInventoryItem", log)
        .then(() => {
          setLastSync(new Date());
          safeSetLocalStorage("wms_last_sync", new Date().toISOString());
          showToast("DB에 실시간 동기화 완료!", "ok");
          // 성공 후 서버가 갱신 및 계산 완료될 충분한 시간을 준 후 pending 해제 (2.5초 지연)
          if (rIndex !== undefined && pendingUpdates.current[rIndex]) {
            pendingUpdates.current[rIndex].expiry = Date.now() + 2500;
          }
        })
        .catch((err: any) => {
          showToast("DB 동기화 실패: " + err.message + " (로컬 보존 중)", "warn");
          if (rIndex !== undefined) {
            delete pendingUpdates.current[rIndex];
          }
        });
    } else {
      showToast("로컬 데모 모드에 대여/반납 내역이 추가되었습니다.", "info");
    }
  }

  /* ---------------- 수량 증감 버튼 (낙관적 렌더링 + 디바운스 DB 반영) ---------------- */
  const stockSaveTimers = useRef<{ [key: number]: NodeJS.Timeout }>({});
  
  function handleChangeStock(item: InventoryItem, delta: number) {
    if (typeof item.stock !== "number") return;
    const nextStock = Math.max(0, item.stock + delta);
    const ts = formatTimestampLocal();
    const currentUserName = currentUser ? (currentUser.name || currentUser.id) : "관리자";

    // 대기열 및 완료 전까지 stale 데이터 덮어쓰기 방지
    pendingUpdates.current[item.rowIndex] = {
      stock: nextStock,
      expiry: Date.now() + 15000, // 최대 15초 세이프가드
    };

    // 1. 화면 반응속도 향상을 위해 낙관적 로컬 업데이트 즉시 수행
    setInventory((prev) =>
      prev.map((i) => (i.rowIndex === item.rowIndex ? { ...i, stock: nextStock, manager: currentUserName, updatedAt: ts } : i))
    );

    if (!connected) return;

    // 2. 여러 번 연타해도 단 한 번의 요청만 가도록 600ms 디바운스 적용
    const key = item.rowIndex;
    if (stockSaveTimers.current[key]) clearTimeout(stockSaveTimers.current[key]);
    
    stockSaveTimers.current[key] = setTimeout(() => {
      callScript("updateInventoryItem", { rowIndex: item.rowIndex, stock: nextStock, manager: currentUserName })
        .then(() => {
          setLastSync(new Date());
          safeSetLocalStorage("wms_last_sync", new Date().toISOString());
          // 서버 반영 시간 고려 2.5초 지연 후 만료 조정
          if (pendingUpdates.current[item.rowIndex]) {
            pendingUpdates.current[item.rowIndex].expiry = Date.now() + 2500;
          }
        })
        .catch((err: any) => {
          showToast("수량 DB 반영 에러: " + err.message, "error");
          delete pendingUpdates.current[item.rowIndex];
        });
    }, 600);
  }

  /* ── 로그인 관문 ──
   * 관리자든 대여자든 로그인해야 안으로 들어간다. 예전에는 아무나 바로 열람·대여로
   * 들어갈 수 있어서, 누가 무엇을 빌렸는지는 신청 순간에야 알 수 있었다. */
  if (currentView === "unattended") {
    return <UnattendedReturnPage isLightMode={isLightMode} showToast={showToast} onAdminExit={(user) => { unattendedLockedRef.current = false; setCurrentUser(user); safeSetLocalStorage("wms_current_user", JSON.stringify(user)); setIsAdmin(true); safeSetLocalStorage("wms_is_admin", "true"); setAdminSection(null); window.location.hash = "#/landing"; setCurrentView("landing"); refreshUnattendedStatus(); showToast(`${user.name || user.id} 관리자님, 일반 모드로 전환했습니다.`, "ok"); }} />;
  }

  // 무인 키오스크는 일반 로그인 관문과 별개로 자체 사번 로그인을 사용한다.
  if (currentView === "unattended" || window.location.hash.split("/")[1] === "unattended") {
    return <UnattendedReturnPage isLightMode={isLightMode} showToast={showToast} onAdminExit={(user) => { unattendedLockedRef.current = false; setCurrentUser(user); safeSetLocalStorage("wms_current_user", JSON.stringify(user)); setIsAdmin(true); safeSetLocalStorage("wms_is_admin", "true"); setAdminSection(null); window.location.hash = "#/landing"; setCurrentView("landing"); refreshUnattendedStatus(); showToast(`${user.name || user.id} 관리자님, 일반 모드로 전환했습니다.`, "ok"); }} />;
  }

  if (!isAdmin && !borrower && currentView !== "login" && currentView !== "borrowerLogin") {
    const card = (title: string, desc: string, onClick: () => void, accent: string) => (
      <div
        onClick={onClick}
        style={{
          display: "flex", alignItems: "center", gap: 18, padding: "30px 28px", cursor: "pointer",
          background: isLightMode ? "#ffffff" : "#1e293b",
          border: `1px solid ${isLightMode ? "#e2e8f0" : "#334155"}`,
          borderRadius: 16, boxShadow: "0 1px 2px rgba(15,23,42,0.06)",
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 19, marginBottom: 6, color: accent }}>{title}</div>
          <div style={{ fontSize: 15, lineHeight: 1.5, color: isLightMode ? "#64748b" : "#94a3b8" }}>{desc}</div>
        </div>
        <ChevronRight size={18} style={{ color: isLightMode ? "#cbd5e1" : "#475569" }} />
      </div>
    );
    return (
      <div
        className={isLightMode ? "wms-light" : "wms-dark"}
        style={{
          minHeight: "100vh", background: isLightMode ? "#f7f8fa" : "#0b1120",
          color: isLightMode ? "#111827" : "#f1f5f9",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          padding: 24, gap: 18,
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 6 }}>
          <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-0.02em" }}>대여 · 반납 · 관리</div>
          <div style={{ fontSize: 16, marginTop: 10, color: isLightMode ? "#64748b" : "#94a3b8" }}>
            이용하려면 먼저 로그인해주세요.
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, width: "100%", maxWidth: 640 }}>
          {unattendedReady ? card("무인 대여 · 반납", "등록된 관리자 PC에서 사번으로 대여·반납을 일괄 처리합니다.", () => { unattendedLockedRef.current = true; window.location.hash = "#/unattended"; setCurrentView("unattended"); }, "#f59e0b") : null}
          {card("대여자 로그인", "이름·사번·좌석을 입력합니다. 대여·반납과 조회에 쓰입니다.", () => setCurrentView("borrowerLogin"), "#2563eb")}
          {card("관리자 로그인", "관리자 ID와 비밀번호로 들어갑니다. 재고·로그·설정을 다룹니다.", () => {
            setLoginId(""); setLoginPassword(""); setLoginError(""); setCurrentView("login");
          }, "#10b981")}
        </div>
      </div>
    );
  }

  if (currentView === "borrowerLogin" || currentView === "seatChange") {
    return (
      <BorrowerLoginPage
        scriptUrl={scriptUrl}
        connected={connected}
        isLightMode={isLightMode}
        showToast={showToast}
        seatOnly={currentView === "seatChange" ? borrower : null}
        onBack={() => setCurrentView(currentView === "seatChange" ? "landing" : "gate")}
        onDone={(session) => {
          setBorrower(session);
          touchBorrower(session);
          setCurrentView("landing");
          showToast(currentView === "seatChange" ? "좌석을 변경했습니다." : `${session.name}님, 환영합니다.`, "ok");
        }}
      />
    );
  }

  if (currentView === "landing") {
    return (
      <LandingPage
        isMobile={isMobile}
        isAdmin={isAdmin}
        adminName={currentUser?.name || currentUser?.id || ""}
        onAdminLogout={() => {
          setIsAdmin(false);
          setCurrentUser(null);
          localStorage.removeItem("wms_is_admin");
          localStorage.removeItem("wms_current_user");
          showToast("로그아웃되었습니다.", "info");
        }}
        borrower={borrower}
        onChangeSeat={() => setCurrentView("seatChange")}
        onLogout={() => {
          setBorrower(null);
          touchBorrower(null);
          // 이 브라우저에 남은 이름·사번·좌석과 장바구니까지 지운다 — 공용 PC에서
          // 다음 사람에게 앞사람 정보가 그대로 뜨면 안 된다.
          clearIdentity();
          showToast("로그아웃했습니다.", "ok");
        }}
        onNavigate={(view) => {
          if (view === "borrow") {
            setBorrowIdentity(null);
            setBorrowKind(null);
            setCurrentView("borrow");
          } else if (view === "browse") {
            // 주소를 같이 바꿔주지 않으면 앞 화면에서 남은 해시(#/borrow 등)가 그대로 남아,
            // 뒤로가기나 새로고침 한 번에 옛 대여 신청 화면으로 튕긴다.
            setBrowseInitialStep(null);
            window.location.hash = "#/browse";
            setCurrentView("browse");
          } else if (view === "mylookup") {
            // 이전에 SID 열람을 봤다면 주소가 #/browse/sid 로 남아 있으므로 먼저 정리한다
            setBrowseInitialStep(null);
            window.location.hash = "#/mylookup";
            setCurrentView("mylookup");
          } else if (view === "sid") {
            // SID 열람은 열람 화면의 하위 단계다. 주소를 먼저 맞춰두고 진입한다.
            window.location.hash = "#/browse/sid";
            setBrowseInitialStep("sid");
            setCurrentView("browse");
          } else if (view === "admin") {
            // 이미 관리자로 로그인한 상태다. 다시 묻지 않고 바로 관리 화면으로 들어간다.
            setAdminSection(null);
            setCurrentView("monitor");
          } else if (view === "login") {
            setLoginId("");
            setLoginPassword("");
            setLoginError("");
            setCurrentView("login");
          }
        }}
        isLightMode={isLightMode}
        scriptUrl={scriptUrl}
        setScriptUrl={setScriptUrl}
        connecting={connecting}
        connectError={connectError}
        connected={connected}
        onConnect={handleConnect}
        onDisconnect={() => { /* 로컬 백엔드 연결은 해제할 수 없음 — no-op */ }}
        onOpenSetup={() => { setAdminSection("settings"); setCurrentView("connectionSettings"); }}
        borrowLock={borrowLock}
      />
    );
  }

  if (currentView === "login") {
    return (
      <LoginPage
        users={users}
        onLoginSuccess={(user) => {
          setCurrentUser(user);
          safeSetLocalStorage("wms_current_user", JSON.stringify(user));
          setIsAdmin(true);
          safeSetLocalStorage("wms_is_admin", "true");
          setAdminSection(null); // 로그인 직후에는 하위 메뉴 선택 화면부터 보여준다
          // 처음 화면은 대여자와 똑같이 초기 화면이다. 관리 화면은 거기서 "관리 모드"로 들어간다.
          setCurrentView("landing");
          if (isMobile) {
            showToast(`📱 모바일 관리자(${user.name || user.id}) 로그인 성공!`, "ok");
          } else {
            showToast(`${user.name || user.id} 관리자님, 환영합니다!`, "ok");
          }
        }}
        onViewOnlyMode={() => {
          setIsAdmin(false);
          safeSetLocalStorage("wms_is_admin", "false");
          setCurrentUser(null);
          setCurrentView("monitor");
          showToast("열람용 모드(조회 전용)로 진입했습니다. 수정이 차단됩니다.", "ok");
        }}
        adminOnly
        onBack={() => setCurrentView("landing")}
        isLightMode={isLightMode}
        onSyncUsers={handleRefresh}
        syncing={connecting}
        isMobile={isMobile}
      />
    );
  }

  if (currentView === "rental") {
    return (
      <RentalPage
        inventory={inventory}
        onAddRentLog={handleAddRentLog}
        onBack={() => {
          setCurrentView("landing");
        }}
        isLightMode={isLightMode}
        showToast={showToast}
        connected={connected}
        lastSync={lastSync}
        onOpenSetup={() => { setAdminSection("settings"); setCurrentView("connectionSettings"); }}
      />
    );
  }

  if (currentView === "borrow" || currentView === "return") {
    return (
      <BorrowSystemPage
        key={currentView + (borrowIdentity ? `:${borrowIdentity.employeeId}:${borrowKind || ""}` : "")}
        scriptUrl={scriptUrl}
        connected={connected}
        isLightMode={isLightMode}
        isAdmin={isAdmin}
        unattendedEnabled={unattendedEnabled}
        // 대여 완료 화면과 중단된 신청 화면 모두 여기로 돌아온다. SID·좌석까지
        // 함께 비워야 다음 대여가 이전 SID의 자동 신청으로 이어지지 않는다.
        onBack={() => {
          setBorrowIdentity(null);
          setBorrowKind(null);
          setBorrowSeat(null);
          setBorrowSid("");
          setBorrowAdditionalItems([]);
          // 결과 화면이 mode 변경으로 #/borrow/* 해시를 다시 쓰기 전에 주소부터 Landing으로 고정한다.
          window.location.hash = "#/landing";
          setCurrentView("landing");
        }}
        showToast={showToast}
        entry={currentView}
        initialIdentity={borrowIdentity}
        initialKind={borrowKind}
        initialSeat={borrowSeat}
        initialSid={borrowSid}
        initialAdditionalItems={borrowAdditionalItems}
        onGoPickItems={(target) => { setBorrowKind(null); setBrowseInitialStep(target === "sid" ? "sidBorrow" : null); window.location.hash = target === "sid" ? "#/browse/sid" : "#/browse"; setCurrentView("browse"); }}
        onBackToWarehouseBrowse={() => { setBorrowKind(null); setCurrentView("browse"); }}
        onInventoryChanged={handleRefresh}
      />
    );
  }

  if (currentView === "browse" || currentView === "mylookup") {
    return (
      <BrowsePage
        key={currentView}
        scriptUrl={scriptUrl}
        connected={connected}
        isLightMode={isLightMode}
        isAdmin={isAdmin}
        unattendedEnabled={unattendedEnabled}
        onBack={() => setCurrentView("landing")}
        showToast={showToast}
        purpose={currentView === "mylookup" ? "mylookup" : "browse"}
        session={borrower}
        initialStep={browseInitialStep}
        onGoTableclothReturn={() => {
          // 이미 로그인한 사람이다 — 이름·사번·좌석을 다시 묻지 않고 내 기록으로 바로 간다.
          setBorrowIdentity(borrower ? { name: borrower.name, employeeId: borrower.employeeId, affiliation: borrower.affiliation } : null);
          setBorrowSeat(borrower ? { floor: borrower.floor, unit: borrower.unit } : null);
          setBorrowKind("tablecloth");
          setCurrentView("return");
        }}
        onGoBorrow={({ identity, kind, seat, sid, additionalItems }) => {
          setBorrowIdentity(identity);
          setBorrowKind(kind);
          setBorrowSeat(seat || null);
          setBorrowSid(sid || "");
          setBorrowAdditionalItems(additionalItems || []);
          setCurrentView("borrow");
        }}
      />
    );
  }

  // 모바일인 경우, PC 화면을 축소한 형태가 아닌
  // 검색 / 사진확인 / 대여·반납 / 등록 / 불량제품에 집중한 전용 모바일 UI를 노출한다.
  // 관리자 로그인 직후: 헤더·사이드바 없이 하위 메뉴 선택 화면만 보여준다
  // (CSS 변수는 메인 return의 <style>에서 정의되므로, 여기서는 isLightMode로 색을 직접 지정한다)
  if (isAdmin && !adminSection) {
    const hubBg = isLightMode ? "#f8fafc" : "#0b0f19";
    const hubCard = isLightMode ? "#ffffff" : "#151d30";
    const hubBorder = isLightMode ? "#e2e8f0" : "#26324a";
    const hubText = isLightMode ? "#111827" : "#f1f5f9";
    const hubDim = isLightMode ? "#64748b" : "#94a3b8";

    return (
      <div
        className={isLightMode ? "wms-light" : "wms-dark"}
        style={{
          width: "100%", minHeight: "100vh",
          background: hubBg, color: hubText,
          fontFamily: "'Inter', sans-serif",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          padding: "24px", gap: "26px",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "32px", fontWeight: 800, marginBottom: "10px", color: hubText }}>
            {currentUser?.name ? `${currentUser.name}님, 무엇을 하시겠어요?` : "무엇을 하시겠어요?"}
          </div>
          <div style={{ fontSize: "16px", color: hubDim }}>관리할 영역을 선택해주세요.</div>
        </div>

        {/* 세 장을 한 줄로 세운다. auto-fit + 260px 최소폭이면 화면이 어중간할 때 2열로 접혀
            마지막 한 장만 아래에 홀로 남았다. 좁은 화면에서는 아예 세로로 쌓는다. */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)",
            gap: "20px", width: "100%", maxWidth: "1240px",
          }}
        >
          {[
            { key: "rental" as const, icon: <Undo2 size={28} />, title: "대여 & 반납 관리", desc: "반납 처리 · 반납 로그 · 좌석 배치도", view: "adminReturn" },
            { key: "items" as const, icon: <Package size={28} />, title: "물품 관리", desc: "시나리오 물품 · 공구 및 부품류 · 불량로그", view: "scenario" },
            { key: "settings" as const, icon: <Settings size={28} />, title: "설정", desc: "연결 설정 · 대여/반납 설정 · DB 설정", view: "connectionSettings" },
          ].map((c) => (
            <a
              key={c.key}
              href={`#/${c.view}/direct`}
              onClick={(e) => {
                e.preventDefault();
                setAdminSection(c.key);
                setCurrentView(c.view as any);
              }}
              style={{
                textDecoration: "none",
                display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "10px",
                padding: "34px 30px", borderRadius: "18px", cursor: "pointer", textAlign: "left",
                border: `1px solid ${hubBorder}`,
                background: hubCard,
                color: hubText,
                boxShadow: isLightMode ? "0 4px 18px rgba(0,0,0,0.06)" : "0 4px 18px rgba(0,0,0,0.35)",
                transition: "transform 0.15s ease, border-color 0.15s ease",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.borderColor = "#2563eb"; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.borderColor = hubBorder; }}
            >
              <div style={{ width: 62, height: 62, borderRadius: "15px", display: "flex", alignItems: "center", justifyContent: "center", background: isLightMode ? "rgba(37,99,235,0.09)" : "rgba(37,99,235,0.18)", color: "#60a5fa" }}>
                {React.cloneElement(c.icon as any, { size: 32 })}
              </div>
              <div style={{ fontSize: "21px", fontWeight: 800, color: hubText }}>{c.title}</div>
              <div style={{ fontSize: "14.5px", color: hubDim, lineHeight: 1.55 }}>{c.desc}</div>
            </a>
          ))}
        </div>

        <div style={{ display: "flex", gap: "10px" }}>
          <button
            onClick={() => setCurrentView("landing")}
            style={{ padding: "14px 26px", borderRadius: "11px", cursor: "pointer", fontSize: "15px", fontWeight: 700,
              border: `1px solid ${hubBorder}`, background: "transparent", color: hubDim }}
          >
            초기 화면
          </button>
          <button
            onClick={() => {
              setIsAdmin(false);
              setCurrentUser(null);
              setAdminSection(null);
              localStorage.removeItem("wms_is_admin");
              localStorage.removeItem("wms_current_user");
              setCurrentView("login");
              showToast("로그아웃되었습니다. 로그인 화면으로 이동합니다.", "info");
            }}
            style={{ padding: "14px 26px", borderRadius: "11px", cursor: "pointer", fontSize: "15px", fontWeight: 700,
              border: "1px solid rgba(220,38,38,0.35)", background: "rgba(220,38,38,0.10)", color: isLightMode ? "#dc2626" : "#f87171" }}
          >
            로그아웃
          </button>
        </div>
      </div>
    );
  }

  // 비관리자(열람용) 모바일에서는 monitor/rent가 각각 대여/반납 셀프서비스 화면이 된다 —
  // 그것도 PC 전용으로 막는다 (defect=불량 신고는 대여/반납이 아니라 그대로 허용).
  if (isMobile && !isAdmin && (currentView === "monitor" || currentView === "rent")) {
    return (
      <div
        className={isLightMode ? "wms-light" : "wms-dark"}
        style={{
          width: "100%", minHeight: "100vh", background: "var(--app-bg, #0f172a)", color: "var(--text-main, #f1f5f9)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 24, textAlign: "center",
        }}
      >
        <div style={{ fontSize: 40 }}>💻</div>
        <div style={{ fontSize: 16, fontWeight: 800 }}>대여 신청/반납은 PC에서만 가능합니다</div>
        <div style={{ fontSize: 13, color: "var(--text-dim, #94a3b8)", maxWidth: 320, lineHeight: 1.6 }}>화면이 작은 모바일에서는 대여/반납 진행이 불편하고 실수하기 쉬워, PC에서만 지원합니다.</div>
        <button
          onClick={() => setCurrentView("landing")}
          style={{ marginTop: 8, padding: "10px 20px", borderRadius: 10, border: "none", background: "#2563eb", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
        >
          메인으로 돌아가기
        </button>
      </div>
    );
  }

  // 모바일에서 관리자는 PC와 똑같은 화면·사이드바를 쓴다. 예전에는 여기서 MobileViewPage라는
  // 별도 구현으로 빠졌는데, 같은 기능이 두 벌이 되면서 한쪽만 고쳐지고, 탭 막대와 검색창이
  // 둘로 갈리고, 화면마다 동작이 달랐다. 이제 껍데기 하나만 두고 사이드바로 오간다.
  //
  // 비관리자 조회는 아직 이 화면을 쓴다 — 창고 물품을 훑어보기만 하는 흐름이라 모바일에
  // 맞춰 만든 것이 여전히 낫고, 관리 기능이 섞여 있지 않아 헷갈릴 일도 없다.
  if (isMobile && !isAdmin && currentView === "monitor") {
    return (
      <MobileViewPage
        inventory={inventory}
        rentLogs={rentLogs}
        defectLogs={defectLogs}
        racks={racks}
        isAdmin={isAdmin}
        currentUser={currentUser}
        onAddRentLog={handleAddRentLog}
        onAddDefectLog={handleAddDefectLog}
        onSaveInventoryItem={saveInventoryItem}
        onSaveNewInventoryItemAwaited={saveNewInventoryItemAwaited}
        onDeleteInventory={deleteInventoryItemRow}
        onBulkMoveLocation={handleBulkMoveLocation}
        onBack={() => setCurrentView("landing")}
        isLightMode={isLightMode}
        toggleLightMode={toggleLightMode}
        connected={connected}
        scriptUrl={scriptUrl}
        currentView={currentView}
        onOpenScenario={() => setCurrentView("scenario")}
        onRefreshInventory={handleRefresh}
        inventoryRefreshing={inventoryRefreshing}
      />
    );
  }

  // 모바일 시나리오·테이블보 화면을 위한 전용 래퍼가 여기 있었다. 같은 컴포넌트를
  // 다른 껍데기로 한 번 더 감싸느라 탭 막대가 생기고 사이드바와 길이 갈렸다.
  // 이제 두 화면 모두 아래의 공용 레이아웃에서 그대로 렌더된다.

  // 대여 잠금 설정 모달 (관리자)
  const lockModal = lockModalOpen ? (
    <div
      onClick={() => !lockBusy && setLockModalOpen(false)}
      style={{ position: "fixed", inset: 0, zIndex: 5000, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(520px, 100%)", maxHeight: "84vh", overflowY: "auto",
          background: isLightMode ? "#ffffff" : "#151d30",
          border: `1px solid ${isLightMode ? "#e2e8f0" : "#26324a"}`, borderRadius: "16px", padding: "22px",
          color: isLightMode ? "#111827" : "#f1f5f9",
        }}
      >
        <div style={{ fontSize: "15px", fontWeight: 800, marginBottom: "6px" }}>🔒 대여 잠금 설정</div>
        <div style={{ fontSize: "12px", color: isLightMode ? "#64748b" : "#94a3b8", marginBottom: "14px", lineHeight: 1.6 }}>
          잠금 중에도 <b>반납은 계속 가능</b>합니다.
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 14px", borderRadius: "12px", cursor: "pointer", marginBottom: "12px", border: `1px solid ${lockDraftGlobal ? "#dc2626" : (isLightMode ? "#e2e8f0" : "#26324a")}`, background: lockDraftGlobal ? "rgba(220,38,38,0.08)" : "transparent" }}>
          <input type="checkbox" checked={lockDraftGlobal} onChange={(e) => setLockDraftGlobal(e.target.checked)} />
          <span style={{ fontSize: "13.5px", fontWeight: 800 }}>전체 대여 잠금</span>
          <span style={{ marginLeft: "auto", fontSize: "11.5px", color: isLightMode ? "#94a3b8" : "#64748b" }}>모든 유닛·창고물품</span>
        </label>

        <input
          value={lockDraftReason}
          onChange={(e) => setLockDraftReason(e.target.value)}
          placeholder="사유 (선택) — 사용자에게 함께 표시됩니다"
          style={{
            width: "100%", boxSizing: "border-box", padding: "11px 12px", borderRadius: "10px", fontSize: "13px", marginBottom: "16px",
            border: `1px solid ${isLightMode ? "#e2e8f0" : "#26324a"}`,
            background: isLightMode ? "#f8fafc" : "#0f172a", color: isLightMode ? "#111827" : "#f1f5f9", outline: "none",
          }}
        />

        <div style={{ fontSize: "12.5px", fontWeight: 800, marginBottom: "8px", opacity: lockDraftGlobal ? 0.45 : 1 }}>
          유닛별 잠금 {lockDraftUnits.length > 0 ? <span style={{ color: "#dc2626" }}>({lockDraftUnits.length}곳)</span> : null}
        </div>

        {lockSeatFloors.length === 0 ? (
          <div style={{ fontSize: "12px", color: isLightMode ? "#94a3b8" : "#64748b", padding: "12px 0" }}>
            좌석 배치도를 불러오지 못했습니다. 전체 잠금만 사용할 수 있습니다.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px", opacity: lockDraftGlobal ? 0.45 : 1, pointerEvents: lockDraftGlobal ? "none" : "auto" }}>
            {lockSeatFloors.map((f) => {
              const floorName = f.name || f.id;
              return (
                <div key={f.id}>
                  <div style={{ fontSize: "11.5px", fontWeight: 700, color: isLightMode ? "#64748b" : "#94a3b8", marginBottom: "5px" }}>{floorName}</div>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {(f.units || []).map((u) => {
                      const on = lockDraftUnits.some((x) => unitLockKey(x.floor, x.unit) === unitLockKey(floorName, u.label));
                      return (
                        <button
                          key={u.label}
                          onClick={() => toggleUnitLock(floorName, u.label)}
                          style={{
                            padding: "6px 12px", borderRadius: "999px", cursor: "pointer", fontSize: "12px", fontWeight: 700,
                            border: `1px solid ${on ? "#dc2626" : (isLightMode ? "#e2e8f0" : "#26324a")}`,
                            background: on ? "#dc2626" : "transparent",
                            color: on ? "#ffffff" : (isLightMode ? "#475569" : "#94a3b8"),
                          }}
                        >
                          {on ? "🔒 " : ""}{u.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ display: "flex", gap: "10px", marginTop: "18px" }}>
          <button
            onClick={() => setLockModalOpen(false)}
            disabled={lockBusy}
            style={{ flex: 1, padding: "12px", borderRadius: "10px", cursor: "pointer", fontSize: "13.5px", fontWeight: 700, border: `1px solid ${isLightMode ? "#e2e8f0" : "#26324a"}`, background: "transparent", color: isLightMode ? "#475569" : "#94a3b8" }}
          >
            취소
          </button>
          <button
            onClick={submitLock}
            disabled={lockBusy}
            style={{ flex: 2, padding: "12px", borderRadius: "10px", cursor: "pointer", fontSize: "14px", fontWeight: 800, border: "none", background: "#dc2626", color: "#fff", opacity: lockBusy ? 0.7 : 1 }}
          >
            {lockBusy ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  // 공지 작성 모달 (관리자)
  const noticeModal = noticeModalOpen ? (
    <div
      onClick={() => !noticeSaving && setNoticeModalOpen(false)}
      style={{ position: "fixed", inset: 0, zIndex: 5000, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(520px, 100%)", background: isLightMode ? "#ffffff" : "#151d30",
          border: `1px solid ${isLightMode ? "#e2e8f0" : "#26324a"}`, borderRadius: "16px", padding: "22px",
          color: isLightMode ? "#111827" : "#f1f5f9",
        }}
      >
        <div style={{ fontSize: "15px", fontWeight: 800, marginBottom: "6px" }}>📢 공지 작성</div>
        <div style={{ fontSize: "12px", color: isLightMode ? "#64748b" : "#94a3b8", marginBottom: "14px", lineHeight: 1.6 }}>
          첫 화면(랜딩)에 <b>제목만</b> 표시되고, 제목을 누르면 전체 내용이 뜹니다. 최대 {NOTICE_MAX}건까지 등록할 수 있습니다.
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {noticeDrafts.map((n, idx) => (
            <div key={idx} style={{ border: `1px solid ${isLightMode ? "#e2e8f0" : "#26324a"}`, borderRadius: "12px", padding: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                <span style={{ fontSize: "11.5px", fontWeight: 800, color: isLightMode ? "#1d4ed8" : "#93c5fd" }}>공지 {idx + 1}</span>
                <button
                  onClick={() => setNoticeDrafts((prev) => prev.filter((_, i) => i !== idx))}
                  style={{ marginLeft: "auto", background: "transparent", border: "none", cursor: "pointer", fontSize: "11.5px", fontWeight: 700, color: "#dc2626" }}
                >
                  삭제
                </button>
              </div>
              <input
                value={n.title || ""}
                onChange={(e) => setNoticeDrafts((prev) => prev.map((x, i) => (i === idx ? { ...x, title: e.target.value } : x)))}
                placeholder="제목 — 예) 유닛별 전수조사 (31일 금 09:05~16:00)"
                style={{
                  width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: "9px", fontSize: "13px", fontWeight: 700, marginBottom: "8px",
                  border: `1px solid ${isLightMode ? "#e2e8f0" : "#26324a"}`,
                  background: isLightMode ? "#f8fafc" : "#0f172a",
                  color: isLightMode ? "#111827" : "#f1f5f9", outline: "none",
                }}
              />
              <textarea
                value={n.text || ""}
                onChange={(e) => setNoticeDrafts((prev) => prev.map((x, i) => (i === idx ? { ...x, text: e.target.value } : x)))}
                placeholder="본문 — 줄바꿈은 그대로 표시됩니다."
                style={{
                  width: "100%", minHeight: "110px", resize: "vertical", boxSizing: "border-box",
                  padding: "12px", borderRadius: "9px", fontSize: "13px", lineHeight: 1.6,
                  border: `1px solid ${isLightMode ? "#e2e8f0" : "#26324a"}`,
                  background: isLightMode ? "#f8fafc" : "#0f172a",
                  color: isLightMode ? "#111827" : "#f1f5f9", outline: "none",
                }}
              />
            </div>
          ))}
        </div>

        {noticeDrafts.length < NOTICE_MAX ? (
          <button
            onClick={() => setNoticeDrafts((prev) => [...prev, { title: "", text: "" }])}
            style={{
              width: "100%", marginTop: "10px", padding: "11px", borderRadius: "10px", cursor: "pointer",
              fontSize: "12.5px", fontWeight: 700,
              border: `1px dashed ${isLightMode ? "#cbd5e1" : "#334155"}`, background: "transparent",
              color: isLightMode ? "#475569" : "#94a3b8",
            }}
          >
            + 공지 추가 ({noticeDrafts.length} / {NOTICE_MAX})
          </button>
        ) : null}
        <div style={{ display: "flex", gap: "10px", marginTop: "14px" }}>
          <button
            onClick={() => setNoticeModalOpen(false)}
            disabled={noticeSaving}
            style={{ flex: 1, padding: "12px", borderRadius: "10px", cursor: "pointer", fontSize: "13.5px", fontWeight: 700, border: `1px solid ${isLightMode ? "#e2e8f0" : "#26324a"}`, background: "transparent", color: isLightMode ? "#475569" : "#94a3b8" }}
          >
            취소
          </button>
          <button
            onClick={submitNotice}
            disabled={noticeSaving}
            style={{ flex: 2, padding: "12px", borderRadius: "10px", cursor: "pointer", fontSize: "14px", fontWeight: 800, border: "none", background: "#2563eb", color: "#fff", opacity: noticeSaving ? 0.7 : 1 }}
          >
            {noticeSaving ? "저장 중..." : "공지 저장"}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div
      className={isLightMode ? "wms-light" : "wms-dark"}
      style={{
        width: "100%",
        height: "100vh",
        background: "var(--app-bg, #0f172a)",
        color: "var(--text-main, #f1f5f9)",
        fontFamily: "'Inter', sans-serif",
        display: "flex",
        flexDirection: "row",
        overflow: "hidden",
      }}
    >
      {/* 글로벌 스타일 오버라이드 */}
      <style>{`
        * { box-sizing: border-box; }
        .wms-dark {
          --app-bg: #0f172a;
          --canvas-bg: #0b1120;
          --header-bg: #161f30;
          --panel-bg: #161f30;
          --panel-border: #26324a;
          --text-main: #f1f5f9;
          --text-dim: #8b98ac;
          --input-bg: #0f172a;
          --accent: #2563eb;
          --accent-soft: rgba(37, 99, 235,0.16);
          --radius: 10px;
          --radius-sm: 7px;
          --radius-lg: 14px;
          --shadow-sm: 0 1px 2px rgba(0,0,0,0.18);
          --shadow: 0 4px 12px rgba(0,0,0,0.22);
        }
        .wms-light {
          --app-bg: #f7f8fa;
          --canvas-bg: #eef1f5;
          --header-bg: #ffffff;
          --panel-bg: #ffffff;
          --panel-border: #e6e9ef;
          --text-main: #111827;
          --text-dim: #626c7d;
          --input-bg: #f4f6f9;
          --accent: #2563eb;
          --accent-soft: rgba(37, 99, 235,0.10);
          --radius: 10px;
          --radius-sm: 7px;
          --radius-lg: 14px;
          --shadow-sm: 0 1px 2px rgba(15,23,42,0.06);
          --shadow: 0 4px 14px rgba(15,23,42,0.08);
        }
        body { font-size: ${16 * fontScale}px; }
        .mono { font-family: 'JetBrains Mono', monospace; font-feature-settings: 'tnum'; }
        button { cursor: pointer; transition: background 0.14s ease, opacity 0.14s ease, transform 0.08s ease; display: flex; align-items: center; justify-content: center; border: none; }
        button:hover { opacity: 0.92; }
        button:active { transform: scale(0.98); }
        input, select, textarea { outline: none; transition: border-color 0.14s ease, box-shadow 0.14s ease; }
        input:focus, select:focus, textarea:focus { border-color: var(--accent) !important; box-shadow: 0 0 0 3px var(--accent-soft) !important; }
        :focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
        ::-webkit-scrollbar { width: 9px; height: 9px; }
        ::-webkit-scrollbar-thumb { background: var(--panel-border); border-radius: 20px; }
        ::-webkit-scrollbar-track { background: transparent; }
        @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
        @keyframes toastIn { from { opacity: 0; transform: translate(-50%, 8px); } to { opacity: 1; transform: translate(-50%, 0); } }
        @keyframes searchPulse { 0% { box-shadow: 0 0 0 0px rgba(37, 99, 235,0.4); } 100% { box-shadow: 0 0 0 14px rgba(37, 99, 235,0); } }
        .canvas-bg { user-select: none; }
      `}</style>

      {/* 모바일에서 서랍이 열려 있을 때 뒤쪽을 덮는 막. 눌러서 닫는다. */}
      {isMobile && mobileNavOpen ? (
        <div
          onClick={() => setMobileNavOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,0.55)", zIndex: 109 }}
        />
      ) : null}

      {/* 물품 관리 모바일 화면은 큰 상단 헤더만 숨긴다. 사이드바는 이 작은 단추로
          언제든 열 수 있어 다른 관리 영역으로 이동하는 길을 없애지 않는다. */}
      {isMobile && isAdmin && adminSection === "items" && !mobileNavOpen ? (
        <button
          onClick={() => setMobileNavOpen(true)}
          aria-label="관리 메뉴 열기"
          title="관리 메뉴 열기"
          style={{
            position: "fixed", left: 10, bottom: 14, zIndex: 108,
            width: 42, height: 42, borderRadius: 12,
            display: "flex", alignItems: "center", justifyContent: "center",
            border: "1px solid var(--panel-border, #334155)",
            background: "var(--header-bg, #1e293b)", color: "var(--text-main, #f1f5f9)",
            boxShadow: "0 8px 22px rgba(0,0,0,0.28)", cursor: "pointer",
          }}
        >
          <Menu size={20} />
        </button>
      ) : null}

      {/* ===== 1. 좌측 사이드바 ===== */}
      {/* 모바일에서는 화면 폭이 좁아 사이드바가 상시로 자리를 차지할 수 없다. 화면 위로
          겹쳐 나오는 서랍으로 두고, 상단 햄버거로 연다. 메뉴 구성은 PC와 완전히 같다. */}
      <aside
        style={{
          width: isMobile ? 264 : sidebarCollapsed ? 64 : 232,
          background: "var(--header-bg, #1e293b)",
          borderRight: "1px solid var(--panel-border, #334155)",
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          flexShrink: 0,
          zIndex: 110,
          transition: isMobile ? "transform 0.22s ease" : "width 0.2s ease",
          ...(isMobile
            ? {
                position: "fixed" as const,
                top: 0,
                left: 0,
                transform: mobileNavOpen ? "translateX(0)" : "translateX(-100%)",
                boxShadow: mobileNavOpen ? "0 0 40px rgba(0,0,0,0.45)" : "none",
              }
            : {}),
        }}
      >
        {/* 상단 로고 영역 */}
        {sidebarCollapsed ? (
          <div
            style={{
              height: 56,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderBottom: "1px solid var(--panel-border, #334155)",
            }}
          >
            <button
              onClick={() => setSidebarCollapsed(false)}
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                background: "transparent",
                color: "var(--text-main, #f1f5f9)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
              title="사이드바 펼치기"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        ) : (
          <div
            style={{
              height: 56,
              padding: "0 16px 0 20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              borderBottom: "1px solid var(--panel-border, #334155)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button
                onClick={() => setCurrentView("landing")}
                title="초기 화면으로"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontWeight: 800,
                  fontSize: 14,
                  color: "#ffffff",
                  background: "#334155",
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: "none",
                  cursor: "pointer",
                  boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                }}
              >
                <Home size={16} />
                {!sidebarCollapsed && <span>초기 화면</span>}
              </button>
            </div>
            <button
              onClick={() => setSidebarCollapsed(true)}
              style={{
                width: 32,
                height: 32,
                borderRadius: 6,
                background: "transparent",
                color: "var(--text-dim, #94a3b8)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
              title="사이드바 접기"
            >
              <ChevronLeft size={18} />
            </button>
          </div>
        )}

        {/* 사용자 정보 영역 */}
        {currentUser && (
          sidebarCollapsed ? (
            <div
              style={{
                padding: "16px 0",
                borderBottom: "1px solid var(--panel-border, #334155)",
                display: "flex",
                justifyContent: "center",
                background: "rgba(0,0,0,0.1)",
              }}
              title={`로그인 사용자: ${currentUser.name || currentUser.id} (관리자)`}
            >
              <span style={{ fontSize: 16 }}>👤</span>
            </div>
          ) : (
            <div
              style={{
                padding: "16px 20px",
                borderBottom: "1px solid var(--panel-border, #334155)",
                background: "rgba(0,0,0,0.1)",
              }}
            >
              <div style={{ fontSize: 11, color: "var(--text-dim, #94a3b8)", marginBottom: 4, fontWeight: 500 }}>
                현재 로그인 사용자
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-main, #f1f5f9)", display: "flex", alignItems: "center", gap: 6 }}>
                👤 {currentUser.name || currentUser.id} <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: "#334155", color: "#fff", fontWeight: 700 }}>관리자</span>
              </div>
            </div>
          )
        )}

        {/* 메인 탐색 메뉴 */}
        <div
          style={{
            flex: 1,
            padding: sidebarCollapsed ? "16px 8px" : "16px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {(() => {
            const navBtn = (view: string, icon: React.ReactNode, label: string) => (
              <a
                key={view}
                href={`#/${view}`}
                onClick={(e) => { e.preventDefault(); setCurrentView(view as any); }}
                title={sidebarCollapsed ? label : undefined}
                style={{
                  textDecoration: "none",
                  width: "100%",
                  padding: sidebarCollapsed ? "10px 0" : "9px 12px",
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 700,
                  justifyContent: sidebarCollapsed ? "center" : "flex-start",
                  background: currentView === view ? (isLightMode ? "rgba(37, 99, 235, 0.08)" : "rgba(37, 99, 235, 0.15)") : "transparent",
                  color: currentView === view ? (isLightMode ? "#23272f" : "#e8eaed") : "var(--text-dim, #94a3b8)",
                  display: "flex",
                  alignItems: "center",
                  gap: sidebarCollapsed ? 0 : 10,
                  border: currentView === view ? (isLightMode ? "1px solid rgba(37, 99, 235, 0.2)" : "1px solid rgba(37, 99, 235, 0.3)") : "1px solid transparent",
                  cursor: "pointer",
                }}
              >
                {icon}
                {!sidebarCollapsed && <span>{label}</span>}
              </a>
            );

            // 관리자가 아니면 예전처럼 공구 및 부품류만 보인다
            if (!isAdmin) return navBtn("monitor", <Package size={18} />, "공구 및 부품류");

            const SECTION_META: Record<"items" | "rental" | "settings", { icon: React.ReactNode; label: string; desc: string; view: typeof currentView }> = {
              rental: { icon: <Undo2 size={18} />, label: "대여 & 반납 관리", desc: "반납 · 로그 · 좌석 배치도", view: "adminReturn" },
              // 목록 첫 항목이 시나리오 물품이라 진입 화면도 그것으로 맞춘다.
              items: { icon: <Package size={18} />, label: "물품 관리", desc: "시나리오 · 공구 · 불량로그", view: "scenario" },
              settings: { icon: <Settings size={18} />, label: "설정", desc: "연결 설정 · 대여/반납 설정 · DB 설정", view: "connectionSettings" },
            };

            // 아코디언 방식: 최상위 메뉴 세 개를 항상 보여주고, 펼쳐진(현재 선택된) 메뉴만
            // 하위 항목을 그 아래 들여써서 보여준다.
            const SUB_ITEMS: Record<"items" | "rental" | "settings", { view: string; icon: React.ReactNode; label: string }[]> = {
              items: [
                // 시나리오 물품이 가장 자주 쓰는 화면이라 맨 위에 둔다.
                { view: "scenario", icon: <Boxes size={16} />, label: "시나리오 물품" },
                { view: "monitor", icon: <Package size={16} />, label: "공구 및 부품류" },
                { view: "tablecloth", icon: <Layers size={16} />, label: "테이블보" },
                { view: "defect", icon: <AlertTriangle size={16} />, label: "불량로그" },
                { view: "returnPhotos", icon: <Camera size={16} />, label: "대여 · 반납 사진" },
              ],
              rental: [
                { view: "adminReturn", icon: <Undo2 size={16} />, label: "대여 및 반납" },
                { view: "adminBorrow", icon: <HandHelping size={16} />, label: "대여 신청" },
                { view: "rent", icon: <ClipboardList size={16} />, label: "반납 로그" },
                { view: "seatmap", icon: <LayoutGrid size={16} />, label: "좌석 배치도" },
              ],
              settings: [
                { view: "connectionSettings", icon: <Users size={16} />, label: "계정 설정" },
                { view: "rentalSettings", icon: <ShieldAlert size={16} />, label: "대여/반납 설정" },
                { view: "dbViewer", icon: <Database size={16} />, label: "DB 설정" },
                { view: "scenarioChanges", icon: <History size={16} />, label: "물품 상태 변경 이력" },
              ],
            };

            const topLevelBtn = (key: "items" | "rental" | "settings") => {
              const meta = SECTION_META[key];
              const active = adminSection === key;
              return (
                <a
                  key={key}
                  href={`#/${meta.view}/direct`}
                  onClick={(e) => { e.preventDefault(); setAdminSection(key); setCurrentView(meta.view); if (isMobile) setMobileNavOpen(false); }}
                  title={sidebarCollapsed ? meta.label : undefined}
                  style={{
                    textDecoration: "none",
                    width: "100%", padding: sidebarCollapsed ? "10px 0" : "10px 12px", borderRadius: 8,
                    display: "flex", alignItems: "center", gap: sidebarCollapsed ? 0 : 10, cursor: "pointer",
                    justifyContent: sidebarCollapsed ? "center" : "flex-start",
                    background: active ? (isLightMode ? "rgba(37, 99, 235, 0.08)" : "rgba(37, 99, 235, 0.15)") : "transparent",
                    color: active ? (isLightMode ? "#23272f" : "#e8eaed") : "var(--text-dim, #94a3b8)",
                    border: active ? (isLightMode ? "1px solid rgba(37, 99, 235, 0.2)" : "1px solid rgba(37, 99, 235, 0.3)") : "1px solid transparent",
                    fontSize: 14, fontWeight: 800,
                  }}
                >
                  {meta.icon}
                  {!sidebarCollapsed && <span>{meta.label}</span>}
                </a>
              );
            };

            const subBtn = (view: string, icon: React.ReactNode, label: string) => (
              <a
                key={view}
                href={`#/${view}/direct`}
                onClick={(e) => { e.preventDefault(); setCurrentView(view as any); if (isMobile) setMobileNavOpen(false); }}
                title={sidebarCollapsed ? label : undefined}
                style={{
                  textDecoration: "none",
                  width: "100%",
                  padding: sidebarCollapsed ? "8px 0" : "8px 12px 8px 30px",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  justifyContent: sidebarCollapsed ? "center" : "flex-start",
                  background: currentView === view ? (isLightMode ? "rgba(37, 99, 235, 0.06)" : "rgba(37, 99, 235, 0.12)") : "transparent",
                  color: currentView === view ? (isLightMode ? "#23272f" : "#e8eaed") : "var(--text-dim, #94a3b8)",
                  display: "flex",
                  alignItems: "center",
                  gap: sidebarCollapsed ? 0 : 8,
                  border: "1px solid transparent",
                  cursor: "pointer",
                }}
              >
                {icon}
                {!sidebarCollapsed && <span>{label}</span>}
              </a>
            );

            return (
              <>
                {topLevelBtn("rental")}
                {adminSection === "rental" && SUB_ITEMS.rental.map((it) => subBtn(it.view, it.icon, it.label))}

                {topLevelBtn("items")}
                {/* 모바일 물품 관리는 본문 탭으로 전환한다. 사이드바 자체는 남기되 같은
                    항목을 하위 메뉴로 한 번 더 나열하지 않는다. */}
                {adminSection === "items" && !isMobile && SUB_ITEMS.items.map((it) => subBtn(it.view, it.icon, it.label))}

                {topLevelBtn("settings")}
                {adminSection === "settings" && SUB_ITEMS.settings.map((it) => subBtn(it.view, it.icon, it.label))}
              </>
            );
          })()}


        </div>

        {/* 사이드바 하단 영역 */}
        <div
          style={{
            padding: sidebarCollapsed ? "16px 8px" : "16px",
            borderTop: "1px solid var(--panel-border, #334155)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <button
            onClick={() => {
              setIsAdmin(false);
              setCurrentUser(null);
              localStorage.removeItem("wms_is_admin");
              localStorage.removeItem("wms_current_user");
              setCurrentView("login");
              showToast("로그아웃되었습니다. 로그인 화면으로 이동합니다.", "info");
            }}
            style={{
              width: "100%",
              padding: sidebarCollapsed ? "0" : "0 12px",
              height: 38,
              borderRadius: 8,
              background: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.2)",
              color: "#f87171",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: sidebarCollapsed ? 0 : 6,
            }}
            title={sidebarCollapsed ? "로그아웃" : "관리자 세션을 종료하고 메인 화면으로 돌아갑니다."}
          >
            <span>🔒</span>
            {!sidebarCollapsed && <span>로그아웃</span>}
          </button>
        </div>
      </aside>

      {/* ===== 2. 우측 메인 작업 영역 ===== */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          height: "100vh",
        }}
      >

      {/* ===== 1. 상단 툴바 (우측 작업 영역 내부) ===== */}
      <header
        style={{
          height: 64,
          display: isMobile && isAdmin && adminSection === "items" ? "none" : "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: isMobile ? "0 12px" : "0 24px",
          background: "var(--header-bg, #1e293b)",
          borderBottom: "1px solid var(--panel-border, #334155)",
          zIndex: 100,
          flexShrink: 0,
        }}
      >
        {/* 현재 페이지 제목 및 권한 표시 배너 */}
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 12, minWidth: 0 }}>
          {/* 모바일에서 사이드바를 여는 단추. 화면 이동은 전부 여기서 한다. */}
          {isMobile ? (
            <button
              onClick={() => setMobileNavOpen(true)}
              aria-label="메뉴 열기"
              style={{
                flexShrink: 0, width: 36, height: 36, borderRadius: 9,
                background: "rgba(148,163,184,0.12)", color: "var(--text-main, #f1f5f9)",
                border: "1px solid var(--panel-border, #334155)",
              }}
            >
              <Menu size={18} />
            </button>
          ) : null}
          <span style={{ fontSize: isMobile ? 14 : 16, fontWeight: 800, color: "var(--text-main, #f1f5f9)", letterSpacing: "-0.02em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {currentView === "monitor" ? "📦 공구 및 부품류" : currentView === "adminReturn" ? "↩️ 대여 및 반납" : currentView === "adminBorrow" ? "🤝 대여 신청" : currentView === "rent" ? "📋 반납 로그" : currentView === "scenario" ? "🧩 시나리오 물품 관리" : currentView === "seatmap" ? "🪑 좌석 배치도 관리" : currentView === "connectionSettings" ? "🔌 연결 설정" : currentView === "rentalSettings" ? "⚙️ 대여/반납 설정" : currentView === "dbViewer" ? "🗄️ DB 설정" : currentView === "scenarioChanges" ? "🕘 물품 상태 변경 이력" : currentView === "tablecloth" ? "🧵 테이블보 관리" : currentView === "returnPhotos" ? "📸 대여 · 반납 사진" : "⚠️ 불량로그 기록"}
          </span>
          <span
            style={{
              // 모바일에서는 제목에 자리를 내준다 — 관리자 여부는 사이드바에도 표시된다.
              display: isMobile ? "none" : "flex",
              fontSize: "11px",
              fontWeight: 700,
              padding: "4px 10px",
              borderRadius: "12px",
              background: isAdmin ? "rgba(16, 185, 129, 0.12)" : "rgba(37, 99, 235, 0.12)",
              color: isAdmin ? "#10b981" : "#94a3b8",
              border: `1px solid ${isAdmin ? "rgba(16, 185, 129, 0.25)" : "rgba(37, 99, 235, 0.25)"}`,
              alignItems: "center",
              gap: 4,
              whiteSpace: "nowrap",
            }}
          >
            {isAdmin ? "🛠️ 관리자 모드" : "👀 열람용 모드"}
          </span>
          {!isAdmin && (
            <button
              onClick={() => {
                setLoginId("");
                setLoginPassword("");
                setLoginError("");
                setCurrentView("login");
              }}
              style={{
                background: "rgba(37, 99, 235, 0.08)",
                border: "1px solid rgba(37, 99, 235, 0.25)",
                borderRadius: "6px",
                padding: "3px 10px",
                fontSize: "11px",
                fontWeight: 700,
                color: "#94a3b8",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4,
                transition: "all 0.2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(37, 99, 235, 0.18)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(37, 99, 235, 0.08)";
              }}
            >
              🔐 관리자 로그인
            </button>
          )}
        </div>


        {/* 우측 보조 컨트롤 영역 */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={cycleFontScale}
            style={{
              height: 34,
              minWidth: 44,
              padding: "0 8px",
              borderRadius: 6,
              border: "1px solid var(--panel-border, #334155)",
              background: "var(--input-bg, #0f172a)",
              color: "var(--text-main, #f1f5f9)",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 3,
            }}
            title={`글자 크기 (현재 ${Math.round(fontScale * 100)}%) · 눌러서 변경`}
          >
            <span style={{ fontSize: 11 }}>가</span>
            <span style={{ fontSize: 15 }}>가</span>
          </button>

          <button
            onClick={toggleLightMode}
            style={{
              width: 34,
              height: 34,
              borderRadius: 6,
              border: "1px solid var(--panel-border, #334155)",
              background: "var(--input-bg, #0f172a)",
              color: "var(--text-main, #f1f5f9)",
              cursor: "pointer",
            }}
            title={isLightMode ? "다크 모드로 전환" : "라이트 모드로 전환"}
          >
            {isLightMode ? <Moon size={14} /> : <Sun size={14} />}
          </button>

          <button
            onClick={handleRefresh}
            disabled={inventoryRefreshing}
            style={{
              width: 34,
              height: 34,
              borderRadius: 6,
              border: "1px solid var(--panel-border, #334155)",
              background: "var(--input-bg, #0f172a)",
              color: "var(--text-main, #f1f5f9)",
              cursor: inventoryRefreshing ? "wait" : "pointer",
              opacity: inventoryRefreshing ? 0.7 : 1,
            }}
            title="실시간 강제 새로고침"
          >
            <RefreshCw size={14} className={inventoryRefreshing ? "app-topbar-spin" : undefined} />
          </button>
        </div>
      </header>
      <style>{`@keyframes appTopbarSpin { to { transform: rotate(360deg); } } .app-topbar-spin { animation: appTopbarSpin 0.9s linear infinite; }`}</style>

      {/* ===== 실시간 연동/데모 상태 알림 슬림 배너 ===== */}
      <div
        style={{
          background: connected ? "rgba(16, 185, 129, 0.08)" : "rgba(245, 158, 11, 0.12)",
          borderBottom: connected ? "1px solid rgba(16, 185, 129, 0.25)" : "1px solid rgba(245, 158, 11, 0.35)",
          padding: "8px 24px",
          display: isMobile && isAdmin && adminSection === "items" ? "none" : "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "12px",
          color: connected ? (isLightMode ? "#047857" : "#34d399") : (isLightMode ? "#b45309" : "#fbbf24"),
          gap: 12,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 500 }}>
          <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#10b981", boxShadow: "0 0 8px #10b981" }} />
          <span>
            <strong>[실시간 동기화 상태]</strong> 로컬 서버와 연결되어 <strong>2분 간격으로 자동 동기화 중</strong>(화면을 다시 열면 즉시 갱신)이며, 다른 사용자 PC에서도 동일하게 내용이 실시간 반영됩니다.
          </span>
        </div>
      </div>

      {/* ===== 2. 본문 메인 ===== */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {isMobile && isAdmin && adminSection === "items" ? (
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden" }}>
            <MobileViewPage
              inventory={inventory}
              rentLogs={rentLogs}
              defectLogs={defectLogs}
              racks={racks}
              isAdmin
              currentUser={currentUser}
              onAddRentLog={handleAddRentLog}
              onAddDefectLog={handleAddDefectLog}
              onSaveInventoryItem={saveInventoryItem}
              onSaveNewInventoryItemAwaited={saveNewInventoryItemAwaited}
              onDeleteInventory={deleteInventoryItemRow}
              onBulkMoveLocation={handleBulkMoveLocation}
              onBack={() => setMobileNavOpen(true)}
              isLightMode={isLightMode}
              toggleLightMode={toggleLightMode}
              connected={connected}
              scriptUrl={scriptUrl}
              currentView={currentView}
              onRefreshInventory={handleRefresh}
              inventoryRefreshing={inventoryRefreshing}
              hideHeader
            />
          </div>
        ) : null}
        {/* 작업 보존 화면: 한 번 연 뒤에는 숨길 뿐 제거하지 않는다. 업로드·대여·반납
            요청도 백그라운드에서 끝까지 진행되며, 돌아오면 입력/장바구니/진행 상태가 남는다. */}
        {isAdmin && !(isMobile && adminSection === "items") && (mountedAdminViews.has("scenario") || currentView === "scenario") ? (
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: currentView === "scenario" ? "flex" : "none", overflow: "hidden" }}>
            <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "24px", background: "var(--canvas-bg, #020617)" }}>
              <ScenarioAdminPage
                scriptUrl={scriptUrl}
                connected={connected}
                isLightMode={isLightMode}
                showToast={showToast}
                adminName={currentUser?.name || currentUser?.id || ""}
              />
            </div>
          </div>
        ) : null}
        {isAdmin && !(isMobile && adminSection === "items") && (mountedAdminViews.has("tablecloth") || currentView === "tablecloth") ? (
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: currentView === "tablecloth" ? "flex" : "none", overflow: "hidden" }}>
            <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", background: "var(--canvas-bg, #020617)" }}>
              <TableclothAdminPage scriptUrl={scriptUrl} connected={connected} isLightMode={isLightMode} showToast={showToast} />
            </div>
          </div>
        ) : null}
        {isAdmin && (mountedAdminViews.has("adminReturn") || currentView === "adminReturn") ? (
          <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: currentView === "adminReturn" ? "flex" : "none", width: "100%" }}>
            <AdminReturnPage
              scriptUrl={scriptUrl}
              connected={connected}
              isLightMode={isLightMode}
              showToast={showToast}
              onInventoryChanged={handleRefresh}
              isMobile={isMobile}
            />
          </div>
        ) : null}
        {isAdmin && (mountedAdminViews.has("adminBorrow") || currentView === "adminBorrow") ? (
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: currentView === "adminBorrow" ? "block" : "none", background: "var(--canvas-bg, #020617)" }}>
            <AdminDirectBorrowModal
              scriptUrl={scriptUrl}
              connected={connected}
              isLightMode={isLightMode}
              showToast={showToast}
              onCompleted={handleRefresh}
              onClose={() => setCurrentView("adminReturn")}
            />
          </div>
        ) : null}

        {isMobile && isAdmin && adminSection === "items" ? null : isAdmin && isPersistentAdminView(currentView) ? null : currentView === "tablecloth" && !isAdmin ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim, #94a3b8)", fontSize: "14px" }}>
            테이블보 관리는 관리자만 사용할 수 있습니다.
          </div>
        ) : currentView === "tablecloth" ? (
          <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", background: "var(--canvas-bg, #020617)" }}>
            {/* 여백을 주지 않는다 — 테이블보 화면은 위에 붙는 머리(탭·검색·필터)가 있어서,
                바깥에서 한 겹 더 띄우면 그만큼 틈이 생겨 그 사이로 카드가 비친다. */}
            <TableclothAdminPage
              scriptUrl={scriptUrl}
              connected={connected}
              isLightMode={isLightMode}
              showToast={showToast}
            />
          </div>
        ) : currentView === "scenario" && !isAdmin ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim, #94a3b8)", fontSize: "14px" }}>
            시나리오 물품 관리는 관리자만 사용할 수 있습니다.
          </div>
        ) : currentView === "scenario" ? (
          <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "24px", background: "var(--canvas-bg, #020617)" }}>
            <ScenarioAdminPage
              scriptUrl={scriptUrl}
              connected={connected}
              isLightMode={isLightMode}
              showToast={showToast}
              adminName={currentUser?.name || currentUser?.id || ""}
            />
          </div>
        ) : currentView === "seatmap" && !isAdmin ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim, #94a3b8)", fontSize: "14px" }}>
            좌석 배치도 관리는 관리자만 사용할 수 있습니다.
          </div>
        ) : currentView === "seatmap" ? (
          <div style={{ flex: 1, overflowY: "auto" }}>
            <SeatMapAdminPage
              scriptUrl={scriptUrl}
              connected={connected}
              isLightMode={isLightMode}
              showToast={showToast}
              onBack={() => setCurrentView("monitor")}
            />
          </div>
        ) : currentView === "defect" ? (
          <DefectLogsPage
            defectLogs={defectLogs}
            inventory={inventory}
            onAddDefectLog={handleAddDefectLog}
            onClose={() => setCurrentView("monitor")}
            isLightMode={isLightMode}
            scriptUrl={scriptUrl}
            connected={connected}
          />
        ) : currentView === "adminReturn" && !isAdmin ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim, #94a3b8)" }}>
            관리자만 접근할 수 있습니다.
          </div>
        ) : currentView === "adminReturn" ? (
          <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: "flex", width: "100%" }}>
            <AdminReturnPage
              scriptUrl={scriptUrl}
              connected={connected}
              isLightMode={isLightMode}
              showToast={showToast}
              onInventoryChanged={handleRefresh}
              isMobile={isMobile}
            />
          </div>
        ) : currentView === "adminBorrow" && !isAdmin ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim, #94a3b8)" }}>관리자만 접근할 수 있습니다.</div>
        ) : currentView === "adminBorrow" ? (
          <div style={{ flex: 1, minHeight: 0, background: "var(--canvas-bg, #020617)" }}>
            <AdminDirectBorrowModal
              scriptUrl={scriptUrl}
              connected={connected}
              isLightMode={isLightMode}
              showToast={showToast}
              onCompleted={handleRefresh}
              onClose={() => setCurrentView("adminReturn")}
            />
          </div>
        ) : currentView === "rent" ? (
          // 대여/반납 대장: 시나리오·공구 구분은 페이지 안의 분야 탭에서 처리한다
          <div style={{ flex: 1, overflowY: "auto", padding: "24px", background: "var(--canvas-bg, #020617)" }}>
            <ScenarioLogsPage
              scriptUrl={scriptUrl}
              connected={connected}
              isLightMode={isLightMode}
              isAdmin={isAdmin}
              showToast={showToast}
            />
          </div>
        ) : currentView === "connectionSettings" && !isAdmin ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim, #94a3b8)" }}>
            관리자만 접근할 수 있습니다.
          </div>
        ) : currentView === "connectionSettings" ? (
          <div style={{ flex: 1, overflowY: "auto", padding: "24px", background: "var(--canvas-bg, #020617)" }}>
            <AdminConnectionSettings embedded visibleTabs={["admins", "borrowers"]} isLightMode={isLightMode} showToast={showToast} />
          </div>
        ) : currentView === "rentalSettings" && !isAdmin ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim, #94a3b8)" }}>
            관리자만 접근할 수 있습니다.
          </div>
        ) : currentView === "rentalSettings" ? (
          <div style={{ flex: 1, overflowY: "auto", padding: "24px", background: "var(--canvas-bg, #020617)" }}>
            <div style={{ maxWidth: 640, display: "flex", flexDirection: "column", gap: 20 }}>
              <UnattendedModeSettings
                showToast={showToast}
                onOpen={() => { unattendedLockedRef.current = true; refreshUnattendedStatus(); window.location.hash = "#/unattended"; setCurrentView("unattended"); }}
                onModeChanged={refreshUnattendedStatus}
              />
              {/* 대여 가능 종류 수 제한 */}
              <div style={{ background: "var(--panel-bg, #151d30)", border: "1px solid var(--panel-border, #26324a)", borderRadius: 14, padding: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 15, marginBottom: 6 }}>
                  <ShieldAlert size={17} /> 대여 가능 종류 수 제한
                </div>
                <p style={{ fontSize: 12, color: "var(--text-dim, #94a3b8)", lineHeight: 1.6, marginBottom: 12 }}>
                  한 사람이 동시에 대여할 수 있는 물품 <strong>종류(가짓수)</strong>의 기본 상한입니다. 비워두면 제한이 없습니다.
                  특정 인원에게만 다른 제한을 걸고 싶으면 아래 페널티에서 개별 등록할 수 있고,
                  좌석 배치도 관리에서 특정 유닛을 <strong>∞ 예외</strong>로 지정하면 그 유닛에서 신청할 때는 이 제한이 적용되지 않습니다.
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="number"
                    min={1}
                    value={maxItemTypesDefault}
                    onChange={(e) => setMaxItemTypesDefault(e.target.value)}
                    placeholder="예: 15 (비워두면 무제한)"
                    style={{ flex: 1, background: "var(--input-bg, #0f172a)", border: "1px solid var(--panel-border, #334155)", borderRadius: 8, padding: "8px 12px", color: "var(--text-main, #f1f5f9)", fontSize: 13 }}
                  />
                  <button
                    onClick={saveMaxItemTypesDefault}
                    disabled={savingMaxItemTypes}
                    style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: savingMaxItemTypes ? "not-allowed" : "pointer", opacity: savingMaxItemTypes ? 0.6 : 1 }}
                  >
                    {savingMaxItemTypes ? "저장 중..." : "저장"}
                  </button>
                </div>
              </div>

              {/* 개인별 페널티는 대여 제한 설정과 같은 맥락에서 관리한다. */}
              <div style={{ background: "var(--panel-bg, #151d30)", border: "1px solid var(--panel-border, #26324a)", borderRadius: 14, padding: 20 }}>
                <AdminConnectionSettings embedded initialTab="penalties" visibleTabs={["penalties"]} showHeader={false} showTabs={false} isLightMode={isLightMode} showToast={showToast} />
              </div>

              {/* 공지사항 */}
              <div style={{ background: "var(--panel-bg, #151d30)", border: "1px solid var(--panel-border, #26324a)", borderRadius: 14, padding: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 15, marginBottom: 6 }}>
                  <Megaphone size={17} /> 공지사항
                </div>
                <p style={{ fontSize: 12, color: "var(--text-dim, #94a3b8)", lineHeight: 1.6, marginBottom: 12 }}>랜딩 화면에 표시할 공지를 작성합니다.</p>
                <button
                  onClick={openNoticeModal}
                  style={{ background: "rgba(37, 99, 235, 0.12)", border: "1px solid rgba(37, 99, 235, 0.35)", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 700, color: "#2563eb", cursor: "pointer" }}
                >
                  📢 공지 작성
                </button>
              </div>

              {/* 대여 잠금 */}
              <div style={{ background: "var(--panel-bg, #151d30)", border: "1px solid var(--panel-border, #26324a)", borderRadius: 14, padding: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 15, marginBottom: 6 }}>
                  <Lock size={17} /> 대여 잠금
                </div>
                <p style={{ fontSize: 12, color: "var(--text-dim, #94a3b8)", lineHeight: 1.6, marginBottom: 12 }}>대여를 일시 중단합니다 (반납은 계속 가능). 전체 또는 특정 유닛만 잠글 수 있습니다.</p>
                <button
                  onClick={openLockModal}
                  disabled={lockBusy}
                  style={{
                    background: borrowLock.locked ? "#dc2626" : "rgba(100, 116, 139, 0.15)",
                    border: `1px solid ${borrowLock.locked ? "#dc2626" : "rgba(100, 116, 139, 0.35)"}`,
                    borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 700,
                    color: borrowLock.locked ? "#fff" : "var(--text-main, #f1f5f9)",
                    cursor: lockBusy ? "not-allowed" : "pointer", opacity: lockBusy ? 0.6 : 1,
                  }}
                >
                  {lockBusy
                    ? "처리 중..."
                    : borrowLock.locked
                      ? "🔒 대여 잠김 (클릭해서 변경)"
                      : (borrowLock.units && borrowLock.units.length)
                        ? `🔒 유닛 ${borrowLock.units.length}곳 잠김 (클릭해서 변경)`
                        : "🔓 대여 잠금 설정"}
                </button>
              </div>

              {/* 새 버전 발급 */}
              <div style={{ background: "var(--panel-bg, #151d30)", border: "1px solid var(--panel-border, #26324a)", borderRadius: 14, padding: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 15, marginBottom: 6 }}>
                  <Rocket size={17} /> 새 버전 발급
                </div>
                <p style={{ fontSize: 12, color: "var(--text-dim, #94a3b8)", lineHeight: 1.6, marginBottom: 12 }}>배포 후 실행하세요. 지금 열려 있는 다른 사용자들의 구버전 화면이 즉시 차단되고 새로고침 안내가 표시됩니다.</p>
                <button
                  onClick={async () => {
                    if (!window.confirm("배포를 모두 마치셨나요?\n\n새 버전을 발급하면 지금 열려 있는 다른 사용자들의 구버전 화면이 즉시 차단되고 새로고침 안내가 표시됩니다.")) return;
                    setPublishingVersion(true);
                    try {
                      const res = await publishAppVersion(scriptUrl);
                      if (res.success) {
                        showToast(`새 버전 발급 완료: ${res.version}`, "ok");
                        baselineAppVersionRef.current = res.version || null;
                      } else {
                        showToast(res.message || "버전 발급에 실패했습니다.", "error");
                      }
                    } catch (e: any) {
                      showToast(`버전 발급 실패: ${e.message}`, "error");
                    } finally {
                      setPublishingVersion(false);
                    }
                  }}
                  disabled={publishingVersion}
                  style={{ background: "rgba(245, 158, 11, 0.15)", border: "1px solid rgba(245, 158, 11, 0.4)", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 700, color: "#f59e0b", cursor: publishingVersion ? "not-allowed" : "pointer", opacity: publishingVersion ? 0.6 : 1 }}
                >
                  {publishingVersion ? "발급 중..." : "🚀 새 버전 발급"}
                </button>
              </div>
            </div>
          </div>
        ) : currentView === "dbViewer" && !isAdmin ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim, #94a3b8)" }}>
            관리자만 접근할 수 있습니다.
          </div>
        ) : currentView === "dbViewer" ? (
          <div style={{ flex: 1, overflowY: "auto", padding: "24px", background: "var(--canvas-bg, #020617)" }}>
            <DbViewerPage isLightMode={isLightMode} showToast={showToast} />
          </div>
        ) : currentView === "scenarioChanges" && !isAdmin ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim, #94a3b8)" }}>
            관리자만 접근할 수 있습니다.
          </div>
        ) : currentView === "scenarioChanges" ? (
          <div style={{ flex: 1, overflowY: "auto", padding: "24px", background: "var(--canvas-bg, #020617)" }}>
            <ScenarioChangesPage scriptUrl={scriptUrl} connected={connected} isLightMode={isLightMode} showToast={showToast} />
          </div>
        ) : currentView === "returnPhotos" && !isAdmin ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim, #94a3b8)" }}>
            관리자만 접근할 수 있습니다.
          </div>
        ) : currentView === "returnPhotos" ? (
          <div style={{ flex: 1, overflowY: "auto", padding: "24px", background: "var(--canvas-bg, #020617)" }}>
            <ReturnPhotosPage scriptUrl={scriptUrl} connected={connected} isLightMode={isLightMode} showToast={showToast} />
          </div>
        ) : currentView === "__never_rent__" ? (
          <RentLogsPage
            rentLogs={rentLogs}
            inventory={inventory}
            onAddRentLog={handleAddRentLog}
            onClose={() => setCurrentView("monitor")}
            isLightMode={isLightMode}
            isAdmin={isAdmin}
            showToast={showToast}
          />
        ) : (
          <>
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                background: "var(--canvas-bg, #020617)",
                overflowY: "auto",
                overflowX: "hidden",
                padding: "24px",
              }}
            >
              <RackGroupedView
                title="🗂 공구 및 부품류"
                inventory={inventory}
                isLightMode={isLightMode}
                isAdmin={isAdmin}
                unattendedEnabled={unattendedEnabled}
                scriptUrl={scriptUrl}
                onEditItem={(item) => setEditingItem(item)}
                onAdjustStock={(item) => setStockAdjustItem(item)}
                onDeleteItem={(item) => deleteInventoryItemRow(item.rowIndex)}
                onToggleArchive={(item) => toggleArchiveInventoryItem(item)}
                onManageSets={() => setShowItemSetManager(true)}
                onImageClick={(url) => setImageModalUrl(url)}
                onRefresh={handleRefresh}
                refreshing={inventoryRefreshing}
                onAddItem={(presetLocation) => {
                  // 해당 랙/슬롯 위치를 미리 채운 채 등록 화면을 연다
                  setDefaultLocationForNewItem(presetLocation);
                  setEditingItem(null);
                  setShowAddForm(true);
                }}
                onBulkMoveLocation={handleBulkMoveLocation}
              />
            </div>
          </>
        )}
      </div>

      {/* ===== 3. 설정 모달 ===== */}
      {imageModalUrl ? (
        <div onClick={() => setImageModalUrl("")} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
          <img src={imageModalUrl} alt="" referrerPolicy="no-referrer" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "92%", maxHeight: "92%", borderRadius: "10px", objectFit: "contain", boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }} />
        </div>
      ) : null}

      {lockModal}
      {noticeModal}

      {/* ===== 4. 품목 팝업 폼 ===== */}
      {(showAddForm || editingItem) && (
        <ItemFormModal
          item={editingItem}
          isLightMode={isLightMode}
          defaultRackId={selectedRack ? selectedRack.id : racks[0] ? racks[0].id : ""}
          defaultLocation={defaultLocationForNewItem}
          defaultSpec={defaultSpecForNewItem}
          racks={racks}
          onSave={saveInventoryItem}
          onSaveNewItem={saveNewInventoryItemAwaited}
          onClose={() => {
            setShowAddForm(false);
            setEditingItem(null);
            setDefaultLocationForNewItem(null);
            setDefaultSpecForNewItem(null);
          }}
          defaultManager={currentUser ? (currentUser.name || currentUser.id) : "관리자"}
          inventory={inventory}
          scriptUrl={scriptUrl}
          showToast={showToast}
        />
      )}

      {/* ===== 4-1. 재고 변경 모달 (공구 및 부품류) ===== */}
      {stockAdjustItem && (
        <StockAdjustModal
          scriptUrl={scriptUrl}
          connected={connected}
          isLightMode={isLightMode}
          category="inventory"
          rowIndex={stockAdjustItem.rowIndex}
          itemId={stockAdjustItem.location}
          itemLabel={stockAdjustItem.name}
          currentStock={typeof stockAdjustItem.stock === "number" ? stockAdjustItem.stock : Number(stockAdjustItem.stock) || 0}
          managerName={currentUser ? (currentUser.name || currentUser.id) : "관리자"}
          showToast={showToast}
          onClose={() => setStockAdjustItem(null)}
          onSaved={(newStock) => {
            setInventory((prev) => prev.map((it) => (it.rowIndex === stockAdjustItem.rowIndex ? { ...it, stock: newStock } : it)));
          }}
        />
      )}

      {/* ===== 4-2. 물품 세트 관리 모달 ===== */}
      {showItemSetManager && (
        <ItemSetManageModal
          scriptUrl={scriptUrl}
          connected={connected}
          isLightMode={isLightMode}
          inventory={inventory}
          showToast={showToast}
          onClose={() => setShowItemSetManager(false)}
        />
      )}

      {/* ===== 6. 새 랙 직접 설계 모달 ===== */}
      {showAddRackModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(2, 6, 17, 0.75)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
        >
          <div
            style={{
              background: "var(--panel-bg, #1e293b)",
              border: "1px solid var(--panel-border, #334155)",
              borderRadius: "16px",
              padding: "24px",
              width: "420px",
              maxWidth: "90%",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.2)",
            }}
          >
            <h3 style={{ fontSize: "18px", fontWeight: 800, color: "var(--text-main, #f1f5f9)", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
              🛠️ 새 랙 직접 설계
            </h3>
            
            <p style={{ fontSize: "12px", color: "var(--text-dim, #94a3b8)", lineHeight: "1.5", marginBottom: "20px" }}>
              새로운 물류 적재 랙 구역을 직접 도면에 배치합니다. 단축 코드는 상품 위치코드의 구역 접두사(예: A 구역의 선반들은 A-01, A-02 등으로 맵핑)가 됩니다.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "14px", marginBottom: "24px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-main, #f1f5f9)" }}>
                  구역 단축 코드 (ID) <span style={{ color: "#f43f5e" }}>*</span>
                </label>
                <input
                  type="text"
                  placeholder="예: A, B, R1, ZONE-A"
                  value={newRackCode}
                  onChange={(e) => {
                    const code = e.target.value.toUpperCase();
                    setNewRackCode(code);
                    // Automatically pre-fill Name if it's empty or matches previous logic
                    if (!newRackName || newRackName === `${newRackCode} 구역`) {
                      setNewRackName(code ? `${code} 구역` : "");
                    }
                  }}
                  style={{
                    background: "var(--input-bg, #0f172a)",
                    border: "1px solid var(--panel-border, #334155)",
                    borderRadius: "8px",
                    padding: "10px 12px",
                    color: "var(--text-main, #f1f5f9)",
                    fontSize: "13px",
                    outline: "none",
                  }}
                  autoFocus
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-main, #f1f5f9)" }}>
                  구역 표시 이름
                </label>
                <input
                  type="text"
                  placeholder="예: A 구역 (원자재 적재대)"
                  value={newRackName}
                  onChange={(e) => setNewRackName(e.target.value)}
                  style={{
                    background: "var(--input-bg, #0f172a)",
                    border: "1px solid var(--panel-border, #334155)",
                    borderRadius: "8px",
                    padding: "10px 12px",
                    color: "var(--text-main, #f1f5f9)",
                    fontSize: "13px",
                    outline: "none",
                  }}
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowAddRackModal(false)}
                style={{
                  background: "transparent",
                  border: "1px solid var(--panel-border, #334155)",
                  color: "var(--text-main, #f1f5f9)",
                  padding: "10px 16px",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: 600,
                }}
              >
                취소
              </button>
              <button
                onClick={handleCreateManualRack}
                style={{
                  background: "#334155",
                  color: "#ffffff",
                  padding: "10px 20px",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: 700,
                  boxShadow: "0 4px 12px rgba(37, 99, 235, 0.25)",
                }}
              >
                설계 및 배치 시작
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 7. 관리자 암호 인증 모달 ===== */}
      {showAdminAuthModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(2, 6, 17, 0.75)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
        >
          <div
            style={{
              background: "var(--panel-bg, #1e293b)",
              border: "1px solid var(--panel-border, #334155)",
              borderRadius: "16px",
              padding: "24px",
              width: "380px",
              maxWidth: "90%",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.3)",
            }}
          >
            <h3 style={{ fontSize: "16px", fontWeight: 800, color: "var(--text-main, #f1f5f9)", marginBottom: "8px" }}>
              🔓 관리자(편집) 모드 전환
            </h3>
            <p style={{ fontSize: "12px", color: "var(--text-dim, #94a3b8)", marginBottom: "16px", lineHeight: "1.4" }}>
              편집 권한 활성화를 위해 비밀번호를 입력해주세요.<br />
              <span style={{ color: "#94a3b8", fontWeight: 700 }}>(공용 비밀번호: 1234)</span>
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "16px" }}>
              <input
                type="password"
                placeholder="비밀번호 입력"
                value={authPasscodeInput}
                onChange={(e) => setAuthPasscodeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (authPasscodeInput === "1234") {
                      setIsAdmin(true);
                      setShowAdminAuthModal(false);
                      showToast("관리자 권한이 활성화되었습니다.", "ok");
                    } else {
                      setAuthError("비밀번호가 일치하지 않습니다.");
                    }
                  }
                }}
                style={{
                  background: "var(--input-bg, #0f172a)",
                  border: "1px solid var(--panel-border, #334155)",
                  borderRadius: "8px",
                  padding: "10px 12px",
                  color: "var(--text-main, #f1f5f9)",
                  fontSize: "14px",
                  textAlign: "center",
                  outline: "none",
                }}
                autoFocus
              />
              {authError && (
                <div style={{ fontSize: "11px", color: "#f43f5e", textAlign: "center", marginTop: "2px" }}>
                  {authError}
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowAdminAuthModal(false)}
                style={{
                  background: "transparent",
                  border: "1px solid var(--panel-border, #334155)",
                  color: "var(--text-main, #f1f5f9)",
                  padding: "8px 14px",
                  borderRadius: "8px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                취소
              </button>
              <button
                onClick={() => {
                  if (authPasscodeInput === "1234") {
                    setIsAdmin(true);
                    setShowAdminAuthModal(false);
                    showToast("관리자 권한이 활성화되었습니다.", "ok");
                  } else {
                    setAuthError("비밀번호가 일치하지 않습니다.");
                  }
                }}
                style={{
                  background: "#334155",
                  color: "#ffffff",
                  padding: "8px 16px",
                  borderRadius: "8px",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                인증하기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 8. 물품 대여 / 반납 모달 ===== */}
      {showRentModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(2, 6, 17, 0.75)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
        >
          <div
            style={{
              background: "var(--panel-bg, #1e293b)",
              border: "1px solid var(--panel-border, #334155)",
              borderRadius: "16px",
              padding: "24px",
              width: "400px",
              maxWidth: "90%",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.3)",
            }}
          >
            <h3
              style={{
                fontSize: "16px",
                fontWeight: 800,
                color: modalActionType === "대여" ? "#94a3b8" : modalActionType === "소모" ? "#f59e0b" : "#10b981",
                marginBottom: "16px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              {modalActionType === "대여" ? "📋 물품 대여 신청" : modalActionType === "소모" ? "🔥 물품 소모 신청" : "🔄 물품 반납 접수"}
            </h3>

            <div style={{ background: "var(--input-bg, #0f172a)", padding: "12px", borderRadius: "8px", marginBottom: "16px", fontSize: "13px" }}>
              <div style={{ color: "var(--text-main, #f1f5f9)", fontWeight: 700, marginBottom: "4px" }}>
                {showRentModal.item.name}
              </div>
              <div style={{ color: "var(--text-dim, #94a3b8)", fontSize: "11px", display: "flex", gap: "8px" }}>
                <span>위치: <span className="mono" style={{ color: "#94a3b8" }}>{showRentModal.item.location}</span></span>
                <span>| 현재 수량: <span className="mono" style={{ color: "#34d399" }}>{showRentModal.item.stock ?? 0}개</span></span>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "20px" }}>
              {/* 구분 선택 (대여 / 반납 / 소모) */}
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-main, #f1f5f9)" }}>
                  구분
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px", background: "var(--input-bg, #0f172a)", padding: "4px", borderRadius: "8px", border: "1px solid var(--panel-border, #334155)" }}>
                  <button
                    type="button"
                    onClick={() => setModalActionType("대여")}
                    style={{
                      padding: "6px 0",
                      borderRadius: "6px",
                      border: "none",
                      fontSize: "12px",
                      fontWeight: 700,
                      cursor: "pointer",
                      background: modalActionType === "대여" ? "#334155" : "transparent",
                      color: modalActionType === "대여" ? "#ffffff" : "var(--text-dim, #94a3b8)",
                      transition: "all 0.15s",
                    }}
                  >
                    대여
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalActionType("반납")}
                    style={{
                      padding: "6px 0",
                      borderRadius: "6px",
                      border: "none",
                      fontSize: "12px",
                      fontWeight: 700,
                      cursor: "pointer",
                      background: modalActionType === "반납" ? "#10b981" : "transparent",
                      color: modalActionType === "반납" ? "#ffffff" : "var(--text-dim, #94a3b8)",
                      transition: "all 0.15s",
                    }}
                  >
                    반납
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalActionType("소모")}
                    style={{
                      padding: "6px 0",
                      borderRadius: "6px",
                      border: "none",
                      fontSize: "12px",
                      fontWeight: 700,
                      cursor: "pointer",
                      background: modalActionType === "소모" ? "#f59e0b" : "transparent",
                      color: modalActionType === "소모" ? "#ffffff" : "var(--text-dim, #94a3b8)",
                      transition: "all 0.15s",
                    }}
                  >
                    소모
                  </button>
                </div>
              </div>

              {/* 대여/반납/소모자 입력 */}
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-main, #f1f5f9)" }}>
                  {modalActionType === "대여" ? "대여자 이름" : modalActionType === "소모" ? "소모자 이름" : "반납자 이름"} <span style={{ color: "#f43f5e" }}>*</span>
                </label>
                <input
                  type="text"
                  placeholder="예: 홍길동"
                  value={rentUserName}
                  onChange={(e) => setRentUserName(e.target.value)}
                  style={{
                    background: "var(--input-bg, #0f172a)",
                    border: "1px solid var(--panel-border, #334155)",
                    borderRadius: "8px",
                    padding: "8px 10px",
                    color: "var(--text-main, #f1f5f9)",
                    fontSize: "13px",
                    outline: "none",
                  }}
                  autoFocus
                />
              </div>

              {/* 수량 입력 */}
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-main, #f1f5f9)" }}>
                  {modalActionType === "대여" ? "대여 수량" : modalActionType === "소모" ? "소모 수량" : "반납 수량"} <span style={{ color: "#f43f5e" }}>*</span>
                </label>
                <input
                  type="number"
                  min={1}
                  max={(modalActionType === "대여" || modalActionType === "소모") ? (typeof showRentModal.item.stock === "number" ? showRentModal.item.stock : undefined) : undefined}
                  value={rentQty}
                  onChange={(e) => setRentQty(Math.max(1, parseInt(e.target.value) || 1))}
                  style={{
                    background: "var(--input-bg, #0f172a)",
                    border: "1px solid var(--panel-border, #334155)",
                    borderRadius: "8px",
                    padding: "8px 10px",
                    color: "var(--text-main, #f1f5f9)",
                    fontSize: "13px",
                    outline: "none",
                  }}
                />
                {(modalActionType === "대여" || modalActionType === "소모") && typeof showRentModal.item.stock === "number" && rentQty > showRentModal.item.stock && (
                  <span style={{ fontSize: "11px", color: "#f43f5e" }}>
                    재고 수량({showRentModal.item.stock}개)을 초과하여 처리할 수 없습니다.
                  </span>
                )}
              </div>

              {/* 메모 입력 */}
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-main, #f1f5f9)" }}>
                  특이사항 / 용도
                </label>
                <input
                  type="text"
                  placeholder="예: 테스트 목적 사용"
                  value={rentNote}
                  onChange={(e) => setRentNote(e.target.value)}
                  style={{
                    background: "var(--input-bg, #0f172a)",
                    border: "1px solid var(--panel-border, #334155)",
                    borderRadius: "8px",
                    padding: "8px 10px",
                    color: "var(--text-main, #f1f5f9)",
                    fontSize: "13px",
                    outline: "none",
                  }}
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowRentModal(null)}
                style={{
                  background: "transparent",
                  border: "1px solid var(--panel-border, #334155)",
                  color: "var(--text-main, #f1f5f9)",
                  padding: "10px 16px",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                취소
              </button>
              <button
                onClick={() => {
                  if (!rentUserName.trim()) {
                    const roleName = modalActionType === "대여" ? "대여자" : modalActionType === "소모" ? "소모자" : "반납자";
                    showToast(`${roleName} 이름을 입력해주세요.`, "warn");
                    return;
                  }
                  if ((modalActionType === "대여" || modalActionType === "소모") && typeof showRentModal.item.stock === "number" && rentQty > showRentModal.item.stock) {
                    showToast("재고 수량이 부족합니다.", "warn");
                    return;
                  }

                  const log: RentLog = {
                    timestamp: formatTimestampLocal(),
                    location: showRentModal.item.location,
                    name: showRentModal.item.name,
                    type: modalActionType,
                    qty: rentQty,
                    user: rentUserName.trim(),
                    note: rentNote.trim() || undefined,
                  };

                  handleAddRentLog(log);
                  setShowRentModal(null);
                }}
                disabled={(modalActionType === "대여" || modalActionType === "소모") && typeof showRentModal.item.stock === "number" && rentQty > showRentModal.item.stock}
                style={{
                  background: modalActionType === "대여" ? "#334155" : modalActionType === "소모" ? "#f59e0b" : "#10b981",
                  color: "#ffffff",
                  padding: "10px 20px",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: 700,
                  cursor: "pointer",
                  opacity: (modalActionType === "대여" || modalActionType === "소모") && typeof showRentModal.item.stock === "number" && rentQty > showRentModal.item.stock ? 0.5 : 1,
                }}
              >
                {modalActionType === "대여" ? "대여하기" : modalActionType === "소모" ? "소모하기" : "반납하기"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 5. 토스트 알림 ===== */}
      {toast && (
        <div
          style={{
            position: "absolute",
            bottom: 30,
            left: "50%",
            transform: "translateX(-50%)",
            background:
              toast.type === "error"
                ? "#f43f5e"
                : toast.type === "ok"
                ? "#10b981"
                : toast.type === "warn"
                ? "#f59e0b"
                : "#1e293b",
            color: toast.type === "info" ? "#f1f5f9" : "#020617",
            padding: "12px 24px",
            borderRadius: 8,
            fontSize: 13.5,
            fontWeight: 700,
            boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
            animation: "toastIn 0.2s ease-out",
            zIndex: 10000,
            border: toast.type === "info" ? "1px solid #334155" : "none",
          }}
        >
          {toast.msg}
        </div>
      )}
      </div>
    </div>
  );
}
