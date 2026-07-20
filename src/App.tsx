import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { InventoryItem, Rack, DefectLog, RentLog, WmsUser } from "./types";
import { DEMO_INVENTORY } from "./data/demo";
import { autoLayoutRacks, snap, formatTimestampLocal, parseLocation, hexToRgba, isFuzzyMatch } from "./utils/drive";

// Subcomponents
import ConnectionBadge from "./components/ConnectionBadge";
import SetupModal from "./components/SetupModal";
import ItemFormModal from "./components/ItemFormModal";
import SidePanel from "./components/SidePanel";
import RackGroupedView from "./components/RackGroupedView";
import ScenarioAdminPage from "./components/ScenarioAdminPage";
import ScenarioLogsPage from "./components/ScenarioLogsPage";
import DefectLogsPage from "./components/DefectLogsPage";
import RentLogsPage from "./components/RentLogsPage";
import LandingPage from "./components/LandingPage";
import LoginPage from "./components/LoginPage";
import RentalPage from "./components/RentalPage";
import BorrowSystemPage from "./components/BorrowSystemPage";
import BrowsePage from "./components/BrowsePage";
import MobileViewPage from "./components/MobileViewPage";

// Icons
import {
  RotateCcw,
  Search,
  Plus,
  RefreshCw,
  Settings,
  Grid,
  Home,
  MapPin,
  ChevronRight,
  ChevronLeft,
  Package,
  Sun,
  Moon,
  ExternalLink,
  QrCode,
  Smartphone,
  ArrowLeft,
  ClipboardList,
  AlertTriangle,
} from "lucide-react";

const DEFAULT_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxWI_byjRAxNQ0Li1EC6CwinNu336h-minlRqMS8Ll6Hl85pl_JCY_jgl67mRft2YXq/exec";

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
                photo: "(대용량 이미지 캐시 생략 - 스프레드시트에는 정상 업로드됨)"
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
   메인 컴포넌트 (창고 구역 관리 및 구글 스프레드시트 실시간 연동)
   ============================================================ */
export default function App() {
  // 1. 상태 선언
  const [currentView, setCurrentView] = useState<"landing" | "login" | "rental" | "borrow" | "return" | "browse" | "mylookup" | "monitor" | "defect" | "rent" | "scenario">("landing");
  // 열람 조회 → 대여 신청으로 넘길 신원 정보 (장바구니 연동)
  const [borrowIdentity, setBorrowIdentity] = useState<{ name: string; employeeId: string; affiliation?: "cfgw" | "configds" | "other" } | null>(null);
  const [borrowKind, setBorrowKind] = useState<"scenario" | "warehouse" | null>(null);
  const [rentLogTab, setRentLogTab] = useState<"warehouse" | "scenario">("scenario");
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
      if (!hash || hash === "#" || hash === "#/") {
        const hasUser = localStorage.getItem("wms_current_user") !== null || localStorage.getItem("wms_is_admin") === "true";
        if (hasUser) {
          window.location.hash = "#/monitor";
        } else {
          window.location.hash = "#/landing";
        }
        return;
      }

      const path = hash.split("/")[1] || "";
      if (path === "landing") {
        setCurrentView("landing");
      } else if (path === "login") {
        setCurrentView("login");
      } else if (path === "rental") {
        setCurrentView("rental");
      } else if (path === "borrow") {
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
      }
    };

    window.addEventListener("hashchange", handleHashChange);
    handleHashChange(); // Initial load sync

    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  useEffect(() => {
    const currentHash = window.location.hash.split("/")[1] || "";
    if (currentView && currentHash !== currentView) {
      if (currentView === "monitor" && window.location.hash.startsWith("#/register")) {
        return;
      }
      window.location.hash = `#/${currentView}`;
    }
  }, [currentView]);

  // 구글 Apps Script 연동 상태 (로컬 스토리지 보존으로 새로고침해도 자동복구)
  const [scriptUrl, setScriptUrl] = useState(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const queryUrl = params.get("script_url");
      if (queryUrl) {
        safeSetLocalStorage("wms_script_url", queryUrl);
        safeSetLocalStorage("wms_connected", "true");
        return queryUrl;
      }
    }
    const saved = localStorage.getItem("wms_script_url");
    // 이 기기(특히 모바일)에 예전 배포 URL이 저장돼 있으면 최신 URL로 자동 교체.
    const LEGACY_SCRIPT_URLS = [
      "https://script.google.com/macros/s/AKfycbwc5YXabteLtTakGJqNo74AHD_AchtBw1bLlXEBiwmyk7CVdKsesrqSx8FZMOM1LrhuYQ/exec",
      "https://script.google.com/macros/s/AKfycby5Way2Bq9NEqxv96yDsKwgCmNw-MLh0ms0Z8XlTKEcjw4n0j4L_xPUEN42RNQDqQ686A/exec",
      "https://script.google.com/macros/s/AKfycbxt86U_xFleI59RbVu-7RMa-zQOgs2J-pLHZQ_acZkQoEdFo9tTOvNv4v9uSWMhZndFgA/exec",
    ];
    if (saved && LEGACY_SCRIPT_URLS.indexOf(saved.trim()) !== -1) {
      safeSetLocalStorage("wms_script_url", DEFAULT_SCRIPT_URL);
      safeSetLocalStorage("wms_connected", "true");
      return DEFAULT_SCRIPT_URL;
    }
    return saved || DEFAULT_SCRIPT_URL;
  });
  const [connected, setConnected] = useState(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("script_url")) {
        return true;
      }
    }
    const savedConnected = localStorage.getItem("wms_connected");
    if (savedConnected === null) {
      return true; // 기본값 연동 활성화
    }
    return savedConnected === "true";
  });
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [showSetup, setShowSetup] = useState(() => {
    const savedUrl = localStorage.getItem("wms_script_url");
    const savedConnected = localStorage.getItem("wms_connected");
    if (!savedUrl && savedConnected === null) {
      return false; // 첫 로드 시 prefilled URL과 connected=true이므로 연동창을 안 띄움
    }
    return savedConnected !== "true";
  });

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

  // 탭(뷰)을 전환하면 열려 있던 품목 편집/추가 모달을 닫는다.
  useEffect(() => {
    setEditingItem(null);
    setShowAddForm(false);
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

  // 2. Refs
  const pendingUpdates = useRef<{ [rowIndex: number]: { stock: number; expiry: number } }>({});
  const canvasRef = useRef<HTMLDivElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number; zoom: number } | null>(null);
  const rotateState = useRef<{ id: string; cx: number; cy: number; startAngle: number } | null>(null);
  const panState = useRef<{ startX: number; startY: number; origPan: { x: number; y: number } } | null>(null);
  const initializedRef = useRef(false);

  // 3. 토스트 알림 표시 유틸
  const showToast = (msg: string, type: "info" | "ok" | "warn" | "error" = "info") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2800);
  };

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
    // URL에서 script_url 파라미터를 읽어 연동 복원했는지 감지
    let isRestored = false;
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const queryUrl = params.get("script_url");
      if (queryUrl) {
        safeSetLocalStorage("wms_script_url", queryUrl);
        safeSetLocalStorage("wms_connected", "true");
        isRestored = true;
        
        // 주소창에서 파라미터를 제거하여 깔끔하게 세팅
        try {
          const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
          window.history.replaceState({ path: cleanUrl }, "", cleanUrl);
        } catch (e) {
          console.error(e);
        }
      }
    }

    if (!localStorage.getItem("wms_script_url")) {
      safeSetLocalStorage("wms_script_url", scriptUrl);
    }
    if (localStorage.getItem("wms_connected") === null) {
      safeSetLocalStorage("wms_connected", String(connected));
    }

    if (isRestored) {
      showToast("🔗 동료로부터 공유받은 구글 스프레드시트 실시간 동기화 링크가 자동 복원되었습니다!", "ok");
    }

    // 로컬 스토리지에 캐시된 인벤토리/랙이 있다면 자동 로드 (단, 복원 시에는 무시하고 강제 리프레시 유도할 수도 있으나, 아래 silentRefresh가 즉시 실행되므로 그대로 유지)
    const cachedInv = localStorage.getItem("wms_cached_inventory");
    const cachedRacks = localStorage.getItem("wms_cached_racks");

    if (cachedInv && cachedRacks && !isRestored) {
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

    // 만약 URL이 들어있고 connected 마크가 참이면 바로 데이터 자동 갱신
    if (scriptUrl && connected) {
      silentRefresh();
    }
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

  /* ---------------- Apps Script API 연동 로직 ---------------- */
  async function callScript(action: string, payload: any) {
    if (!scriptUrl) throw new Error("구글 스프레드시트 연동 URL이 입력되지 않았습니다.");
    
    let res;
    try {
      res = await fetch(scriptUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" }, // CORS 프리플라이트를 피하기 위한 text/plain 설정
        body: JSON.stringify({ action, payload }),
      });
    } catch (e: any) {
      throw new Error(`스프레드시트 서버 연결 실패: ${e.message}.\n\n[체크리스트]\n1. 구글 Apps Script 배포 시 '액세스 권한이 있는 사용자'가 '모든 사용자(Anyone)'로 되어 있는지 확인해 주세요.\n2. 등록하신 URL이 스프레드시트 주소가 아니라 '/exec'로 끝나는 웹앱 URL인지 확인해 주세요.\n3. 회사/학교 계정의 경우 외부 외부망 접근 정책을 확인해 주세요.`);
    }
    
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.error("Non-JSON Response received:", text);
      if (text.includes("Google Accounts") || text.includes("login") || text.includes("Sign in")) {
        throw new Error("구글 웹앱 배포 설정이 잘못되었습니다. 웹앱을 배포할 때 '액세스 권한이 있는 사용자'를 반드시 '모든 사용자(Anyone)'로 설정하고 승인하셔야 합니다. 그렇지 않으면 외부 로그인이 요구되어 연동이 실패합니다.");
      }
      if (text.includes("현재 파일을 열 수 없습니다") || text.includes("페이지를 찾을 수 없음") || text.includes("google.com/drive") || scriptUrl.includes("docs.google.com/spreadsheets")) {
        throw new Error("입력하신 연동 URL이 Apps Script 웹앱 URL이 아니라 구글 스프레드시트 자체 주소입니다. 스프레드시트의 확장 프로그램 -> Apps Script 메뉴에서 배포한 웹앱 URL(https://script.google.com/macros/s/.../exec)을 입력하셔야 정상 연동됩니다.");
      }
      throw new Error(`스프레드시트가 올바르지 않은 응답(HTML)을 반환했습니다. 웹앱을 '새 버전'으로 배포하고 최신 배포 URL을 올바르게 등록했는지 확인하세요.`);
    }
    
    if (!data.success) throw new Error(data.error || "스프레드시트 요청 실패");
    return data;
  }

  async function fetchAll() {
    if (!scriptUrl) throw new Error("연동 URL이 비어 있습니다.");
    
    let res;
    try {
      res = await fetch(`${scriptUrl}?action=getAll`);
    } catch (e: any) {
      throw new Error(`스프레드시트 연결 실패: ${e.message}.\n\n[체크리스트]\n1. 구글 Apps Script 배포 시 '액세스 권한이 있는 사용자'가 '모든 사용자(Anyone)'로 되어 있는지 확인해 주세요.\n2. 등록하신 URL이 스프레드시트 주소가 아니라 '/exec'로 끝나는 웹앱 URL인지 확인해 주세요.\n3. 회사/학교 계정의 경우 외부 외부망 접근 정책을 확인해 주세요.`);
    }
    
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.error("Non-JSON Response received on fetchAll:", text);
      if (text.includes("Google Accounts") || text.includes("login") || text.includes("Sign in")) {
        throw new Error("구글 웹앱 배포 설정이 잘못되었습니다. 웹앱을 배포할 때 '액세스 권한이 있는 사용자'를 '모든 사용자(Anyone)'로 설정해 주세요.");
      }
      if (text.includes("현재 파일을 열 수 없습니다") || text.includes("페이지를 찾을 수 없음") || text.includes("google.com/drive") || scriptUrl.includes("docs.google.com/spreadsheets")) {
        throw new Error("입력하신 연동 URL이 Apps Script 웹앱 URL이 아니라 구글 스프레드시트 자체 주소입니다. 스프레드시트의 확장 프로그램 -> Apps Script 메뉴에서 배포한 웹앱 URL(https://script.google.com/macros/s/.../exec)을 입력하셔야 정상 연동됩니다.");
      }
      throw new Error(`올바르지 않은 데이터 형식입니다. 웹앱 URL 및 배포 설정을 확인하세요.`);
    }
    
    if (!data.success) throw new Error(data.error || "스프레드시트 조회 실패");
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

  // 20초 주기로 스프레드시트 최신 데이터 실시간 자동 동기화 (기기 간 실시간 싱크 완성 및 속도 최적화)
  useEffect(() => {
    if (!connected || !scriptUrl) return;

    // 초기 마운트 시 즉시 한 번 갱신 보장 (화면 전환 시마다 리프레시되는 현상 방지)
    silentRefresh();

    const interval = setInterval(() => {
      silentRefresh();
    }, 20000); // 20초 간격 폴링으로 부하 감소 및 응답 속도 체감 향상

    return () => clearInterval(interval);
  }, [connected, scriptUrl]); // eslint-disable-line

  // 구글 스프레드시트 데이터와 랙 선반 정보 병합
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
    const cleanUrl = scriptUrl.trim();
    if (!cleanUrl) {
      setConnectError("구글 스프레드시트 Apps Script URL을 올바르게 채워주세요.");
      return;
    }
    if (cleanUrl.includes("docs.google.com/spreadsheets")) {
      setConnectError(
        "⚠️ 입력하신 주소는 구글 스프레드시트 자체의 웹 브라우저 주소입니다.\n\n" +
        "연동을 위해서는 스프레드시트 자체가 아니라, 스프레드시트 내 [확장 프로그램] → [Apps Script]에서 복사한 코드를 넣고 [배포]하여 발급받은 '웹 앱 URL'(https://script.google.com/macros/s/.../exec)을 입력하셔야 합니다.\n" +
        "상세한 방법은 아래 '설치 가이드'를 펼쳐서 확인해 주세요."
      );
      return;
    }
    if (!cleanUrl.startsWith("https://script.google.com/") && cleanUrl !== DEFAULT_SCRIPT_URL) {
      setConnectError(
        "⚠️ 올바른 구글 Apps Script 웹앱 URL 형식이 아닙니다.\n" +
        "URL은 반드시 'https://script.google.com/macros/s/.../exec' 형태여야 합니다.\n" +
        "입력하신 주소를 다시 확인해 주세요."
      );
      return;
    }

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
      setShowSetup(false);
      setLastSync(new Date());
      showToast("구글 스프레드시트 연동 완료! 실시간 저장 모드가 활성화되었습니다.", "ok");
    } catch (err: any) {
      setConnectError("스프레드시트 연동 실패: " + err.message + "\nURL과 웹앱 배포 설정(액세스 권한: 모든 사람)을 다시 한번 검토해주세요.");
    } finally {
      setConnecting(false);
    }
  }

  // 실시간 새로고침
  async function handleRefresh() {
    if (!connected) {
      showToast("현재 가상 데모 모드입니다. 구글 시트 연동 후 클릭해주세요.", "warn");
      return;
    }
    showToast("스프레드시트 동기화 진행 중...", "info");
    try {
      const data = await fetchAll();
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
      showToast("실시간 스프레드시트 동기화 완료!", "ok");
    } catch (err: any) {
      showToast("동기화 실패: " + err.message, "error");
    }
  }

  // 랙 배치 레이아웃 스프레드시트 서버 저장
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
    showToast("스프레드시트 위치 코드 분석을 기반으로 랙을 자동 배치하였습니다.", "ok");
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
        .then(async (res: any) => {
          if (isNew && res && res.rowIndex) {
            setInventory((prev) =>
              prev.map((i) => (i.rowIndex === optimisticItem.rowIndex ? { ...i, rowIndex: res.rowIndex } : i))
            );
          }
          setLastSync(new Date());
          safeSetLocalStorage("wms_last_sync", new Date().toISOString());
          showToast(isNew ? "✅ 신규 품목 동기화 완료" : "✅ 품목 스펙 동기화 완료", "ok");
        })
        .catch((err: any) => {
          console.error("백그라운드 저장 에러:", err);
          showToast("⚠️ 실시간 스프레드시트 동기화 지연: " + err.message + " (로컬 캐시는 정상 저장됨)", "warn");
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
          .then(() => {
            setLastSync(new Date());
            showToast("✅ 구글 스프레드시트 일괄 업데이트 완료", "ok");
          })
          .catch((err: any) => {
            console.error("일괄 업데이트 에러:", err);
            showToast("⚠️ 실시간 스프레드시트 동기화 지연: " + err.message + " (로컬 캐시는 저장됨)", "warn");
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
        .then(() => {
          setLastSync(new Date());
          showToast("✅ 구글 스프레드시트 이름 수정 완료", "ok");
        })
        .catch((err: any) => {
          console.error("이름 수정 에러:", err);
          showToast("⚠️ 실시간 스프레드시트 동기화 지연: " + err.message + " (로컬 캐시는 저장됨)", "warn");
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
        .then(() => {
          setLastSync(new Date());
          safeSetLocalStorage("wms_last_sync", new Date().toISOString());
          showToast("✅ 구글 스프레드시트 삭제 반영 완료", "ok");
        })
        .catch((err: any) => {
          console.error("삭제 동기화 에러:", err);
          showToast("⚠️ 삭제 스프레드시트 동기화 지연: " + err.message + " (로컬 목록은 삭제 유지됨)", "warn");
          // 로컬 목록은 지워진 상태를 그대로 유지
        })
        .finally(() => {
          setSaving(false);
        });
    }
  }

  // 불량 로그 등록 및 구글 스프레드시트 기록 함수 (낙관적 업데이트 반영)
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
          showToast("✅ 불량 로그 스프레드시트 기록 완료", "ok");
        })
        .catch((err: any) => {
          console.error("불량로그 동기화 실패:", err);
          showToast("⚠️ 불량로그 동기화 실패: " + err.message + " (로컬 임시 보존됨)", "warn");
        });
    } else {
      showToast("로컬 데모 모드에 불량 로그가 추가되었습니다.", "info");
    }
  }

  // 대여/반납 로그 등록 및 구글 스프레드시트 기록 함수 (낙관적 업데이트를 적용하여 체감 속도 극대화)
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
      // 2. 백그라운드로 안전하게 구글 스프레드시트에 연동 요청 (동기 처리 차단 없음)
      callScript("rentInventoryItem", log)
        .then(() => {
          setLastSync(new Date());
          safeSetLocalStorage("wms_last_sync", new Date().toISOString());
          showToast("스프레드시트에 실시간 동기화 완료!", "ok");
          // 성공 후 구글 시트가 갱신 및 계산 완료될 충분한 시간을 준 후 pending 해제 (2.5초 지연)
          if (rIndex !== undefined && pendingUpdates.current[rIndex]) {
            pendingUpdates.current[rIndex].expiry = Date.now() + 2500;
          }
        })
        .catch((err: any) => {
          showToast("스프레드시트 동기화 실패: " + err.message + " (로컬 보존 중)", "warn");
          if (rIndex !== undefined) {
            delete pendingUpdates.current[rIndex];
          }
        });
    } else {
      showToast("로컬 데모 모드에 대여/반납 내역이 추가되었습니다.", "info");
    }
  }

  /* ---------------- 수량 증감 버튼 (낙관적 렌더링 + 디바운스 스프레드시트 반영) ---------------- */
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
          // 구글 시트 반영 시간 고려 2.5초 지연 후 만료 조정
          if (pendingUpdates.current[item.rowIndex]) {
            pendingUpdates.current[item.rowIndex].expiry = Date.now() + 2500;
          }
        })
        .catch((err: any) => {
          showToast("수량 스프레드시트 반영 에러: " + err.message, "error");
          delete pendingUpdates.current[item.rowIndex];
        });
    }, 600);
  }

  if (currentView === "landing") {
    return (
      <LandingPage
        onNavigate={(view) => {
          if (view === "borrow") {
            setBorrowIdentity(null);
            setBorrowKind(null);
            setCurrentView("borrow");
          } else if (view === "return") {
            setCurrentView("return");
          } else if (view === "browse") {
            setCurrentView("browse");
          } else if (view === "mylookup") {
            setCurrentView("mylookup");
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
        onDisconnect={() => {
          localStorage.removeItem("wms_script_url");
          safeSetLocalStorage("wms_connected", "false");
          setConnected(false);
          setScriptUrl("");
          showToast("스프레드시트 연동이 해제되었습니다. 가상 데모 모드로 동작합니다.", "info");
        }}
        onOpenSetup={() => setShowSetup(true)}
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
          setCurrentView("monitor");
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
        onOpenSetup={() => setShowSetup(true)}
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
        onBack={() => { setBorrowIdentity(null); setBorrowKind(null); setCurrentView("landing"); }}
        showToast={showToast}
        entry={currentView}
        initialIdentity={borrowIdentity}
        initialKind={borrowKind}
        onBackToWarehouseBrowse={() => { setBorrowKind(null); setCurrentView("browse"); }}
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
        onBack={() => setCurrentView("landing")}
        showToast={showToast}
        purpose={currentView === "mylookup" ? "mylookup" : "browse"}
        onGoBorrow={({ identity, kind }) => {
          setBorrowIdentity(identity);
          setBorrowKind(kind);
          setCurrentView("borrow");
        }}
      />
    );
  }

  // 모바일인 경우, PC 화면을 축소한 형태가 아닌
  // 검색 / 사진확인 / 대여·반납 / 등록 / 불량제품에 집중한 전용 모바일 UI를 노출한다.
  if (isMobile && (currentView === "monitor" || currentView === "rent" || currentView === "defect")) {
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
        onBack={() => {
          setIsAdmin(false);
          safeSetLocalStorage("wms_is_admin", "false");
          setCurrentUser(null);
          setCurrentView("login");
        }}
        isLightMode={isLightMode}
        toggleLightMode={toggleLightMode}
        connected={connected}
        currentView={currentView}
        onOpenScenario={() => setCurrentView("scenario")}
      />
    );
  }

  // 모바일: 시나리오 물품 관리 (관리자) — 전용 풀스크린 래퍼로 렌더
  if (isMobile && currentView === "scenario") {
    if (!isAdmin) {
      setCurrentView("landing");
      return null;
    }
    return (
      <div style={{ minHeight: "100vh", background: "var(--canvas-bg, #020617)", color: "var(--text-main, #f1f5f9)" }}>
        <div style={{ position: "sticky", top: 0, zIndex: 20, background: "var(--panel-bg, #1e293b)", borderBottom: "1px solid var(--panel-border, #334155)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 16px 8px" }}>
            <button onClick={() => setCurrentView("landing")} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 12px", borderRadius: "10px", border: "1px solid var(--panel-border, #334155)", background: "transparent", color: "var(--text-dim, #94a3b8)", cursor: "pointer", fontSize: "13px", fontWeight: 700 }}>
              <Home size={15} /> 처음
            </button>
            <h1 style={{ flex: 1, fontSize: "16px", fontWeight: 800, margin: 0 }}>🧩 시나리오 물품 관리</h1>
          </div>
          {/* 창고 탭들로 바로 전환 (탭 넘기기 방식) */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: "6px", padding: "0 12px 10px" }}>
            {[
              { label: "📥 대여", view: "monitor" },
              { label: "🔄 반납", view: "rent" },
              { label: "📦 등록", view: "monitor" },
              { label: "⚠️ 불량", view: "defect" },
              { label: "🧩 물품", view: "scenario" },
            ].map((t, i) => (
              <button
                key={i}
                onClick={() => { if (t.view !== "scenario") setCurrentView(t.view as any); }}
                style={{
                  padding: "10px 2px", borderRadius: "11px", fontSize: "12px", fontWeight: 800, border: "none",
                  background: t.view === "scenario" ? "var(--accent, #0f172a)" : "transparent",
                  color: t.view === "scenario" ? "#ffffff" : "var(--text-dim, #94a3b8)",
                  cursor: "pointer",
                  boxShadow: t.view === "scenario" ? "0 6px 14px var(--accent-soft, rgba(15, 23, 42, 0.2))" : "none",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ padding: "16px" }}>
          <ScenarioAdminPage
            scriptUrl={scriptUrl}
            connected={connected}
            isLightMode={isLightMode}
            showToast={showToast}
          />
        </div>
      </div>
    );
  }

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
          --header-bg: rgba(22, 31, 48, 0.72);
          --panel-bg: rgba(22, 31, 48, 0.75);
          --panel-border: rgba(38, 50, 74, 0.5);
          --text-main: #f1f5f9;
          --text-dim: #8b98ac;
          --input-bg: rgba(15, 23, 42, 0.5);
          --accent: #ffffff;
          --accent-soft: rgba(255, 255, 255, 0.14);
          --radius: 10px;
          --radius-sm: 7px;
          --radius-lg: 14px;
          --shadow-sm: 0 1px 2px rgba(0,0,0,0.18);
          --shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.22);
          --backdrop: blur(14px);
        }
        .wms-light {
          --app-bg: #f4f6f9;
          --canvas-bg: #eef1f5;
          --header-bg: rgba(255, 255, 255, 0.72);
          --panel-bg: rgba(255, 255, 255, 0.75);
          --panel-border: rgba(230, 233, 239, 0.5);
          --text-main: #1e293b;
          --text-dim: #626c7d;
          --input-bg: rgba(244, 246, 249, 0.6);
          --accent: #0f172a;
          --accent-soft: rgba(15, 23, 42, 0.08);
          --radius: 10px;
          --radius-sm: 7px;
          --radius-lg: 14px;
          --shadow-sm: 0 1px 2px rgba(15,23,42,0.06);
          --shadow: 0 8px 32px 0 rgba(15, 23, 42, 0.04);
          --backdrop: blur(14px);
        }
        
        /* 글라스모피즘 핵심 데코레이터 */
        .glass-card, [style*="var(--panel-bg)"], [style*="var(--header-bg)"] {
          backdrop-filter: var(--backdrop, none);
          -webkit-backdrop-filter: var(--backdrop, none);
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

      {/* ===== 1. 좌측 사이드바 ===== */}
      <aside
        style={{
          width: sidebarCollapsed ? 64 : 232,
          background: "var(--header-bg, #1e293b)",
          borderRight: "1px solid var(--panel-border, #334155)",
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          flexShrink: 0,
          zIndex: 110,
          transition: "width 0.2s ease",
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
          <button
            onClick={() => setCurrentView("monitor")}
            title={sidebarCollapsed ? "창고물품" : undefined}
            style={{
              width: "100%",
              padding: sidebarCollapsed ? "10px 0" : "9px 12px",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 700,
              justifyContent: sidebarCollapsed ? "center" : "flex-start",
              background: currentView === "monitor" ? (isLightMode ? "rgba(37, 99, 235, 0.08)" : "rgba(37, 99, 235, 0.15)") : "transparent",
              color: currentView === "monitor" ? (isLightMode ? "#23272f" : "#e8eaed") : "var(--text-dim, #94a3b8)",
              display: "flex",
              alignItems: "center",
              gap: sidebarCollapsed ? 0 : 10,
              border: currentView === "monitor" ? (isLightMode ? "1px solid rgba(37, 99, 235, 0.2)" : "1px solid rgba(37, 99, 235, 0.3)") : "1px solid transparent",
            }}
          >
            <Package size={18} />
            {!sidebarCollapsed && <span>창고물품</span>}
          </button>

          {isAdmin && (
          <button
            onClick={() => setCurrentView("scenario")}
            title={sidebarCollapsed ? "시나리오 물품" : undefined}
            style={{
              width: "100%",
              padding: sidebarCollapsed ? "10px 0" : "9px 12px",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 700,
              justifyContent: sidebarCollapsed ? "center" : "flex-start",
              background: currentView === "scenario" ? (isLightMode ? "rgba(37, 99, 235, 0.08)" : "rgba(37, 99, 235, 0.15)") : "transparent",
              color: currentView === "scenario" ? (isLightMode ? "#23272f" : "#e8eaed") : "var(--text-dim, #94a3b8)",
              display: "flex",
              alignItems: "center",
              gap: sidebarCollapsed ? 0 : 10,
              border: currentView === "scenario" ? (isLightMode ? "1px solid rgba(37, 99, 235, 0.2)" : "1px solid rgba(37, 99, 235, 0.3)") : "1px solid transparent",
            }}
          >
            <Grid size={18} />
            {!sidebarCollapsed && <span>시나리오 물품</span>}
          </button>
          )}

          <button
            onClick={() => setCurrentView("rent")}
            title={sidebarCollapsed ? "대여/반납 대장" : undefined}
            style={{
              width: "100%",
              padding: sidebarCollapsed ? "10px 0" : "9px 12px",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 700,
              justifyContent: sidebarCollapsed ? "center" : "flex-start",
              background: currentView === "rent" ? (isLightMode ? "rgba(37, 99, 235, 0.08)" : "rgba(37, 99, 235, 0.15)") : "transparent",
              color: currentView === "rent" ? (isLightMode ? "#23272f" : "#e8eaed") : "var(--text-dim, #94a3b8)",
              display: "flex",
              alignItems: "center",
              gap: sidebarCollapsed ? 0 : 10,
              border: currentView === "rent" ? (isLightMode ? "1px solid rgba(37, 99, 235, 0.2)" : "1px solid rgba(37, 99, 235, 0.3)") : "1px solid transparent",
            }}
          >
            <ClipboardList size={18} />
            {!sidebarCollapsed && <span>대여/반납 대장</span>}
          </button>

          <button
            onClick={() => setCurrentView("defect")}
            title={sidebarCollapsed ? "불량로그" : undefined}
            style={{
              width: "100%",
              padding: sidebarCollapsed ? "10px 0" : "9px 12px",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 700,
              justifyContent: sidebarCollapsed ? "center" : "flex-start",
              background: currentView === "defect" ? (isLightMode ? "rgba(225, 29, 72, 0.08)" : "rgba(244, 63, 94, 0.15)") : "transparent",
              color: currentView === "defect" ? (isLightMode ? "#e11d48" : "#f43f5e") : "var(--text-dim, #94a3b8)",
              display: "flex",
              alignItems: "center",
              gap: sidebarCollapsed ? 0 : 10,
              border: currentView === "defect" ? (isLightMode ? "1px solid rgba(225, 29, 72, 0.2)" : "1px solid rgba(244, 63, 94, 0.3)") : "1px solid transparent",
            }}
          >
            <AlertTriangle size={18} />
            {!sidebarCollapsed && <span>불량로그</span>}
          </button>


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
          {isAdmin && (
            <button
              onClick={() => setShowSetup(true)}
              style={{
                width: "100%",
                padding: sidebarCollapsed ? "0" : "0 14px",
                height: 38,
                borderRadius: 8,
                background: "var(--input-bg, #0f172a)",
                border: "1px solid var(--panel-border, #334155)",
                color: "var(--text-main, #f1f5f9)",
                fontSize: 12,
                fontWeight: 700,
                gap: sidebarCollapsed ? 0 : 6,
                cursor: "pointer",
                justifyContent: "center",
              }}
              title={sidebarCollapsed ? (connected ? "연동 관리" : "구글 시트 연동") : undefined}
            >
              <Settings size={14} />
              {!sidebarCollapsed && (connected ? "연동 관리" : "구글 시트 연동")}
            </button>
          )}

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
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
          background: "var(--header-bg, #1e293b)",
          borderBottom: "1px solid var(--panel-border, #334155)",
          zIndex: 100,
          flexShrink: 0,
        }}
      >
        {/* 현재 페이지 제목 및 권한 표시 배너 */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: "var(--text-main, #f1f5f9)", letterSpacing: "-0.02em" }}>
            {currentView === "monitor" ? "📦 창고물품" : currentView === "rent" ? "📋 대여/반납 대장 관리" : currentView === "scenario" ? "🧩 시나리오 물품 관리" : "⚠️ 불량로그 기록"}
          </span>
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              padding: "4px 10px",
              borderRadius: "12px",
              background: isAdmin ? "rgba(16, 185, 129, 0.12)" : "rgba(37, 99, 235, 0.12)",
              color: isAdmin ? "#10b981" : "#94a3b8",
              border: `1px solid ${isAdmin ? "rgba(16, 185, 129, 0.25)" : "rgba(37, 99, 235, 0.25)"}`,
              display: "flex",
              alignItems: "center",
              gap: 4
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

        {/* 품목 실시간 검색란 */}
        <div ref={searchContainerRef} style={{ position: "relative", width: 440 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              background: "var(--input-bg, #0f172a)",
              border: "1px solid var(--panel-border, rgba(15, 118, 110, 0.4))",
              borderRadius: 9999,
              padding: "0 16px",
            }}
          >
            <Search size={15} style={{ color: "var(--text-dim, #94a3b8)", marginRight: 8 }} />
            <input
              placeholder="품목 검색... (엔터 누르면 첫 결과의 위치로 바로 이동)"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && searchResults.length > 0) {
                  focusOnItem(searchResults[0]);
                }
              }}
              style={{
                width: "100%",
                padding: "8px 0",
                background: "transparent",
                border: "none",
                color: "var(--text-main, #f1f5f9)",
                fontSize: 13,
                outline: "none",
              }}
            />
          </div>

          {searchOpen && searchQuery && (
            <div
              style={{
                position: "absolute",
                top: 44,
                left: 0,
                right: 0,
                background: "var(--panel-bg, #1e293b)",
                border: "1px solid var(--panel-border, #334155)",
                borderRadius: 8,
                boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
                maxHeight: 350,
                overflowY: "auto",
                zIndex: 1000,
              }}
            >
              {searchResults.length > 0 ? (
                searchResults.map((item) => (
                  <div
                    key={item.rowIndex}
                    onClick={() => focusOnItem(item)}
                    style={{
                      padding: "10px 14px",
                      borderBottom: "1px solid var(--panel-border, #334155)",
                      cursor: "pointer",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "var(--panel-border, #334155)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-main, #f1f5f9)" }}>
                        {item.name}
                      </div>
                      <div
                        style={{
                          fontSize: 10.5,
                          color: "var(--text-dim, #94a3b8)",
                          marginTop: 3,
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <span className="mono" style={{ background: "var(--input-bg, #0f172a)", padding: "1px 5px", borderRadius: 3, color: "#94a3b8" }}>
                          {item.location}
                        </span>
                        {item.note && <span>| 특이사항: {item.note}</span>}
                        {item.manager && <span>| 담당: {item.manager}</span>}
                      </div>
                    </div>
                    <div
                      className="mono"
                      style={{
                        fontSize: 12.5,
                        fontWeight: 800,
                        color: item.stock === 0 ? "#f43f5e" : "#34d399",
                      }}
                    >
                      {item.stock ?? 0} 개
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ padding: 16, color: "#94a3b8", textAlign: "center", fontSize: 12.5 }}>
                  검색 결과와 일치하는 품목이 존재하지 않습니다.
                </div>
              )}
            </div>
          )}
        </div>

        {/* 우측 보조 컨트롤 영역 */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <ConnectionBadge connected={connected} dirty={dirty} saving={saving} lastSync={lastSync} />

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
            style={{
              width: 34,
              height: 34,
              borderRadius: 6,
              border: "1px solid var(--panel-border, #334155)",
              background: "var(--input-bg, #0f172a)",
              color: "var(--text-main, #f1f5f9)",
              cursor: "pointer",
            }}
            title="실시간 강제 새로고침"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </header>

      {/* ===== 실시간 연동/데모 상태 알림 슬림 배너 ===== */}
      <div
        style={{
          background: connected ? "rgba(16, 185, 129, 0.08)" : "rgba(245, 158, 11, 0.12)",
          borderBottom: connected ? "1px solid rgba(16, 185, 129, 0.25)" : "1px solid rgba(245, 158, 11, 0.35)",
          padding: "8px 24px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "12px",
          color: connected ? (isLightMode ? "#047857" : "#34d399") : (isLightMode ? "#b45309" : "#fbbf24"),
          gap: 12,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 500 }}>
          {connected ? (
            <>
              <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#10b981", boxShadow: "0 0 8px #10b981" }} />
              <span>
                <strong>[실시간 동기화 상태]</strong> 현재 내 구글 스프레드시트({scriptUrl.substring(0, 45)}...)와 연동되어 있습니다. <strong>10초 간격으로 실시간 자동 동기화(자동 새로고침) 중</strong>이며, 다른 사용자 PC에서도 동일하게 내용이 실시간 반영됩니다.
              </span>
            </>
          ) : (
            <>
              <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#f59e0b", boxShadow: "0 0 8px #f59e0b" }} />
              <span>
                <strong>[데모용 가상 모드]</strong> 현재 구글 시트와 연동되지 않은 상태입니다. 동료와 실시간 데이터(사용자 계정 포함)를 공유하려면, <strong>[구글 시트 연동]</strong>에서 연동을 완료하고 생성된 <strong>공유 링크</strong>로 동료를 접속하게 하세요!
              </span>
            </>
          )}
        </div>
        {!connected && isAdmin && (
          <button
            onClick={() => setShowSetup(true)}
            style={{
              background: "#f59e0b",
              color: "#ffffff",
              border: "none",
              borderRadius: 4,
              padding: "4px 10px",
              fontSize: "11px",
              fontWeight: 700,
              cursor: "pointer",
              boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
            }}
          >
            연동 설정 열기
          </button>
        )}
      </div>

      {/* ===== 2. 본문 메인 ===== */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {currentView === "scenario" && !isAdmin ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim, #94a3b8)", fontSize: "14px" }}>
            시나리오 물품 관리는 관리자만 사용할 수 있습니다.
          </div>
        ) : currentView === "scenario" ? (
          <div style={{ flex: 1, overflowY: "auto", padding: "24px", background: "var(--canvas-bg, #020617)" }}>
            <ScenarioAdminPage
              scriptUrl={scriptUrl}
              connected={connected}
              isLightMode={isLightMode}
              showToast={showToast}
            />
          </div>
        ) : currentView === "defect" ? (
          <DefectLogsPage
            defectLogs={defectLogs}
            inventory={inventory}
            robotObjects={robotObjects}
            onAddDefectLog={handleAddDefectLog}
            onClose={() => setCurrentView("monitor")}
            isLightMode={isLightMode}
          />
        ) : currentView === "rent" ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {/* 시나리오 / 창고 전환 탭 */}
            <div style={{ display: "flex", gap: "8px", padding: "16px 24px 0", background: "var(--canvas-bg, #020617)" }}>
              {[
                { key: "scenario" as const, label: "시나리오 물품 대장" },
                { key: "warehouse" as const, label: "창고 물품 대장" },
              ].map((t) => (
                <button
                  key={t.key}
                  onClick={() => setRentLogTab(t.key)}
                  style={{
                    padding: "10px 18px",
                    borderRadius: "10px 10px 0 0",
                    border: "none",
                    borderBottom: rentLogTab === t.key ? "2px solid var(--accent, #0f172a)" : "2px solid transparent",
                    background: rentLogTab === t.key ? "var(--accent-soft, rgba(15, 23, 42, 0.08))" : "transparent",
                    color: rentLogTab === t.key ? (isLightMode ? "#23272f" : "#e8eaed") : "var(--text-dim, #94a3b8)",
                    fontSize: "14px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {rentLogTab === "scenario" ? (
              <div style={{ flex: 1, overflowY: "auto", padding: "24px", background: "var(--canvas-bg, #020617)" }}>
                <ScenarioLogsPage
                  scriptUrl={scriptUrl}
                  connected={connected}
                  isLightMode={isLightMode}
                  isAdmin={isAdmin}
                  showToast={showToast}
                />
              </div>
            ) : (
              <RentLogsPage
                rentLogs={rentLogs}
                inventory={inventory}
                onAddRentLog={handleAddRentLog}
                onClose={() => setCurrentView("monitor")}
                isLightMode={isLightMode}
                isAdmin={isAdmin}
                showToast={showToast}
              />
            )}
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
                padding: "24px",
              }}
            >
              {/* 그리드 상단 바 */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "20px",
                  flexWrap: "wrap",
                  gap: "12px",
                }}
              >
                {/* 보기 전환: 물품 그룹 / 배치 지도 */}
                <div style={{ display: "flex", gap: "4px", background: "var(--input-bg, #0f172a)", padding: "4px", borderRadius: "10px", border: "1px solid var(--panel-border, #334155)" }}>
                  {([["grouped", "🗂 물품 보기"], ["map", "🗺 배치 지도"]] as const).map(([v, label]) => (
                    <button
                      key={v}
                      onClick={() => { setMonitorView(v); if (v === "grouped") setSelectedRackId(null); }}
                      style={{
                        padding: "7px 14px", borderRadius: "7px", border: "none", fontSize: "12.5px", fontWeight: 700, cursor: "pointer",
                        background: monitorView === v ? "var(--accent, #0f172a)" : "transparent",
                        color: monitorView === v ? "#ffffff" : "var(--text-dim, #94a3b8)",
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {/* 기능 버튼 */}
                {isAdmin && (
                  <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <button
                      onClick={regenerateFromInventory}
                      style={{
                        background: "var(--panel-bg, #1e293b)",
                        border: "1px solid var(--panel-border, #334155)",
                        color: "var(--text-main, #f1f5f9)",
                        padding: "8px 14px",
                        borderRadius: 8,
                        fontSize: 12,
                        fontWeight: 700,
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        cursor: "pointer",
                      }}
                      title="위치코드 분석기 기반 랙 자동 재정렬"
                    >
                      <MapPin size={13} />
                      자동 배치
                    </button>

                    <button
                      onClick={addManualRack}
                      style={{
                        background: "#334155",
                        color: "#ffffff",
                        padding: "8px 14px",
                        borderRadius: 8,
                        fontSize: 12,
                        fontWeight: 700,
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        cursor: "pointer",
                      }}
                    >
                      <Plus size={13} />
                      새 랙 추가
                    </button>
                  </div>
                )}

              </div>

              {/* 그리드 카드 목록 */}
              {monitorView === "grouped" ? (
                <RackGroupedView
                  inventory={inventory}
                  isLightMode={isLightMode}
                  isAdmin={isAdmin}
                  onEditItem={(item) => setEditingItem(item)}
                  onImageClick={(url) => setImageModalUrl(url)}
                />
              ) : racks.length === 0 ? (
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    border: "2px dashed var(--panel-border, #334155)",
                    borderRadius: "12px",
                    padding: "40px",
                    textAlign: "center",
                  }}
                >
                  <p style={{ color: "var(--text-dim, #94a3b8)", fontSize: "14px", marginBottom: "16px" }}>
                    등록된 구역/랙이 존재하지 않습니다. 위치코드를 기반으로 자동 배치하거나 신규 랙을 직접 생성해 보세요.
                  </p>
                  <div style={{ display: "flex", gap: "10px" }}>
                    <button
                      onClick={regenerateFromInventory}
                      style={{
                        background: "#334155",
                        color: "#ffffff",
                        padding: "10px 18px",
                        borderRadius: "8px",
                        fontSize: "13px",
                        fontWeight: 700,
                      }}
                    >
                      위치코드 기반 자동 배치
                    </button>
                    <button
                      onClick={addManualRack}
                      style={{
                        background: "var(--panel-bg, #1e293b)",
                        border: "1px solid var(--panel-border, #334155)",
                        color: "var(--text-main, #f1f5f9)",
                        padding: "10px 18px",
                        borderRadius: "8px",
                        fontSize: "13px",
                        fontWeight: 700,
                      }}
                    >
                      새 구역 추가
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                    gap: "16px",
                  }}
                >
                  {racks.map((rack) => {
                    const isSelected = selectedRackId === rack.id;
                    const isHighlighted = highlightShelf !== null && rack.id === parseLocation(highlightShelf).rack;

                    return (
                      <div
                        key={rack.id}
                        id={`rack-card-${rack.id}`}
                        onClick={() => setSelectedRackId(rack.id)}
                        style={{
                          background: isSelected 
                            ? "var(--panel-bg, #1e293b)" 
                            : "var(--panel-bg, #1e293b)",
                          border: isSelected
                            ? `2px solid ${rack.color}`
                            : isHighlighted
                            ? "2px solid #f59e0b"
                            : "1px solid var(--panel-border, #334155)",
                          borderRadius: "8px",
                          padding: "20px 16px",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                          animation: isHighlighted ? "searchPulse 1.4s ease-in-out infinite" : "none",
                          minHeight: "80px",
                          position: "relative",
                        }}
                        onMouseEnter={(e) => {
                          if (!isSelected && !isHighlighted) {
                            e.currentTarget.style.borderColor = rack.color;
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isSelected && !isHighlighted) {
                            e.currentTarget.style.borderColor = "var(--panel-border, #334155)";
                          }
                        }}
                      >
                        {/* Rack Name */}
                        <span style={{ 
                          fontWeight: 700, 
                          fontSize: "16px", 
                          color: isSelected ? rack.color : "var(--text-main, #f1f5f9)",
                          textAlign: "center",
                        }}>
                          {rack.name || `${rack.id} 랙`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 우측 사이드 패널 (랙 및 선반별 품목 리스트) */}
            <SidePanel
              rack={selectedRack}
              shelvesWithItems={shelvesWithItems}
              onClose={() => setSelectedRackId(null)}
              onUpdateRack={(fields) => updateRackField(selectedRack!.id, fields)}
              onDeleteRack={() => deleteRack(selectedRack!.id)}
              onEditItem={(item) => setEditingItem(item)}
              onAddItem={(loc, spec) => {
                setDefaultLocationForNewItem(loc || null);
                setDefaultSpecForNewItem(spec || null);
                setShowAddForm(true);
              }}
              onAddSubcategory={handleAddSubcategory}
              onRenameSubcategory={handleRenameSubcategory}
              onDeleteItem={deleteInventoryItemRow}
              highlightShelf={
                selectedRack && highlightShelf && parseLocation(highlightShelf).rack === selectedRack.id
                  ? highlightShelf
                  : null
              }
              highlightedItemRowIndex={highlightedItemRowIndex}
              onChangeStock={handleChangeStock}
              isAdmin={isAdmin}
              onRentItem={(item, actionType) => setShowRentModal({ item, actionType })}
              isLightMode={isLightMode}
            />
          </>
        )}
      </div>

      {/* ===== 3. 설정 모달 ===== */}
      {imageModalUrl ? (
        <div onClick={() => setImageModalUrl("")} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
          <img src={imageModalUrl} alt="" referrerPolicy="no-referrer" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "92%", maxHeight: "92%", borderRadius: "10px", objectFit: "contain", boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }} />
        </div>
      ) : null}

      {showSetup && isAdmin && (
        <SetupModal
          scriptUrl={scriptUrl}
          setScriptUrl={setScriptUrl}
          connecting={connecting}
          connectError={connectError}
          connected={connected}
          onConnect={handleConnect}
          onClose={() => setShowSetup(false)}
          onDisconnect={() => {
            localStorage.removeItem("wms_script_url");
            safeSetLocalStorage("wms_connected", "false");
            setConnected(false);
            setScriptUrl("");
            setShowSetup(false);
            showToast("스프레드시트 연동이 해제되었습니다. 가상 데모 모드로 동작합니다.", "info");
          }}
        />
      )}
      {showSetup && !isAdmin && (
        // 비관리자가 연동 설정에 접근하면 잠금 안내만 표시 (URL 변경 방지)
        <div onClick={() => setShowSetup(false)} style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380, background: "var(--panel-bg, #1e293b)", border: "1px solid var(--panel-border, #334155)", borderRadius: 16, padding: 24, textAlign: "center", color: "var(--text-main, #f1f5f9)" }}>
            <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>🔒 연동 설정은 관리자 전용입니다</div>
            <div style={{ fontSize: 13, color: "var(--text-dim, #94a3b8)", lineHeight: 1.6, marginBottom: 16 }}>서버 연동 주소는 관리자만 변경할 수 있습니다. 변경이 필요하면 관리자에게 요청하세요.</div>
            <button onClick={() => setShowSetup(false)} style={{ padding: "10px 20px", borderRadius: 10, border: "none", background: "var(--accent, #0f172a)", color: "#fff", fontWeight: 700, cursor: "pointer" }}>확인</button>
          </div>
        </div>
      )}

      {/* ===== 4. 품목 팝업 폼 ===== */}
      {(showAddForm || editingItem) && (
        <ItemFormModal
          item={editingItem}
          defaultRackId={selectedRack ? selectedRack.id : racks[0] ? racks[0].id : ""}
          defaultLocation={defaultLocationForNewItem}
          defaultSpec={defaultSpecForNewItem}
          racks={racks}
          onSave={saveInventoryItem}
          onClose={() => {
            setShowAddForm(false);
            setEditingItem(null);
            setDefaultLocationForNewItem(null);
            setDefaultSpecForNewItem(null);
          }}
          defaultManager={currentUser ? (currentUser.name || currentUser.id) : "관리자"}
          inventory={inventory}
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
