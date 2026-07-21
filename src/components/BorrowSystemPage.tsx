import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  ArrowLeft, Search, User, Building2, MoreHorizontal, Fingerprint, Boxes,
  HandHelping, PackageOpen, Undo2, MapPin, ChevronRight, Plus, Minus, X, Check,
  CheckCircle2, AlertCircle, Bookmark, RotateCcw, Feather, Flame, PlusCircle, IdCard,
  Warehouse, Trash2, RefreshCw,
} from "lucide-react";
import {
  ObjectItem, ScenarioDefinition, UnreturnedItem, BorrowEntry, ReturnRequest,
  computeLocationSortIndex, padSlot, isKoreanName, nowString,
  fetchBorrowAppVersion, fetchObjectItems, fetchScenarioDefinition, fetchUnreturnedItems,
  fetchMyBorrowedItems, checkConfigDsRegistered, postRecordBorrow, postProcessReturn,
  DEMO_OBJECT_ITEMS, loadBrowseCart, clearBrowseCart, saveIdentity,
  WarehouseItem, WarehouseCartItem, parseRackSlot, warehouseStockNum, compareRackSlot,
  fetchWarehouseInventory, fetchWarehouseBorrowedItems, postWarehouseRent,
  loadWarehouseCart, clearWarehouseCart,
} from "../utils/borrowApi";
import { getGoogleDriveImageUrl } from "../utils/drive";
import { smartMatch } from "../utils/search";

/* ══════════════════════════════ 타입 ══════════════════════════════ */

type Mode =
  | "mode"
  | "pickBorrowKind" | "pickReturnKind"
  | "b1" | "b2" | "b3g" | "b4g" | "b3s" | "b4s"
  | "wborrow" | "wreturn"
  | "return"
  | "result";

interface CartItem { id: string; name: string; quantity: number; rootSlot?: string }
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
  /** 열람에서 바로 넘어온 경우: "scenario"면 일반대여 흐름, "warehouse"면 창고대여 흐름으로 직행 */
  initialKind?: "scenario" | "warehouse" | null;
  /** 뒤로가기 시 창고 열람으로 복귀해야 하는 경우 */
  onBackToWarehouseBrowse?: () => void;
}

/* ══════════════════════════════ 컴포넌트 ══════════════════════════════ */

export default function BorrowSystemPage({ scriptUrl, connected, isLightMode, onBack, showToast, entry = "borrow", initialIdentity = null, initialKind = null, onBackToWarehouseBrowse }: BorrowSystemPageProps) {
  // 열람에서 일반 자재을 담아 넘어오면 창고 대여로, 시나리오면 일반대여로 직행
  const rootMode: Mode = initialKind === "warehouse" ? "wborrow"
    : initialKind === "scenario" ? "b1"
    : entry === "return" ? "pickReturnKind" : "pickBorrowKind";
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
  const [appVersion, setAppVersion] = useState<string>("");
  const [objectItems, setObjectItems] = useState<ObjectItem[]>([]);
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [itemsLoading, setItemsLoading] = useState(false);
  // 재고 검증에 필요한 물품 목록이 로딩 중일 때 "신청하기"를 누른 경우,
  // 로딩 완료 후 자동으로 이어서 제출하기 위한 대기 플래그.
  const [pendingSubmit, setPendingSubmit] = useState(false);
  const [imageModalUrl, setImageModalUrl] = useState<string>("");
  const [resultInfo, setResultInfo] = useState<{ ok: boolean; isSyncing?: boolean; title: string; sub: string; receipt?: { borrower: string; date: string; due?: string; action: string; items: { name: string; qty: number; location?: string }[] } }>({ ok: true, isSyncing: false, title: "", sub: "" });

  /* ---------- 대여 신청 상태 ---------- */
  const [borrowerName, setBorrowerName] = useState(initialIdentity?.name || "");
  const [affiliation, setAffiliation] = useState<"cfgw" | "configds" | "other">(initialIdentity?.affiliation || "cfgw");
  const [employeeId, setEmployeeId] = useState(initialIdentity?.employeeId || "");
  const [otherName, setOtherName] = useState(initialIdentity?.affiliation === "other" ? (initialIdentity?.name || "") : "");
  const [verifying, setVerifying] = useState(false);
  const [itemType, setItemType] = useState<"scenario" | "general">("scenario");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [reqCart, setReqCart] = useState<CartItem[]>([]);
  const [sidCart, setSidCart] = useState<SidEntry[]>([]);
  const [sidInput, setSidInput] = useState("");
  const [generalOption, setGeneralOption] = useState<string>("");
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
  const [reqSearch, setReqSearch] = useState("");
  const [reqCat, setReqCat] = useState("");
  const [reqSub, setReqSub] = useState("");

  /* ---------- 일반 자재 상태 ---------- */
  const [whItems, setWhItems] = useState<WarehouseItem[]>([]);
  const [whLoaded, setWhLoaded] = useState(false);
  const [whLoading, setWhLoading] = useState(false);
  const [whCart, setWhCart] = useState<WarehouseCartItem[]>([]);
  const [whSearch, setWhSearch] = useState("");
  const [whCustomLoc, setWhCustomLoc] = useState("");
  const [whRack, setWhRack] = useState("");
  const [whSlot, setWhSlot] = useState("");
  const [whPurpose, setWhPurpose] = useState("");
  const [whDueDate, setWhDueDate] = useState("");
  const [whReturnItems, setWhReturnItems] = useState<any[]>([]);
  const [whReturnLoading, setWhReturnLoading] = useState(false);
  const [whReturnSel, setWhReturnSel] = useState<Record<string, number>>({});
  const [whName, setWhName] = useState(initialIdentity?.name || "");
  const [whEmpId, setWhEmpId] = useState(initialIdentity?.employeeId || "");

  /* ---------- 초기 로드: 버전 ---------- */
  useEffect(() => {
    if (!connected || !scriptUrl) return;
    fetchBorrowAppVersion(scriptUrl).then(setAppVersion).catch(() => {});
  }, [connected, scriptUrl]);

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
        if (saved.length) { setCart(saved.map((c) => ({ id: c.id, name: c.name, quantity: c.quantity, rootSlot: c.rootSlot }))); setItemType("general"); }
      }
    }
    if (initialKind === "warehouse") {
      loadWarehouse();
      if (initialIdentity) {
        const saved = loadWarehouseCart(initialIdentity.name, initialIdentity.employeeId);
        if (saved.length) setWhCart(saved);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- 창고 재고/미반납 로드 ---------- */
  const loadWarehouse = useCallback(async (force = false) => {
    if (!force && whLoaded) return;
    setWhLoading(true);
    try {
      if (connected && scriptUrl) setWhItems(await fetchWarehouseInventory(scriptUrl));
      else setWhItems([
        { rowIndex: 2, location: "A-01", name: "랙 선반용 합판", photo: "", stock: 12, spec: "", note: "", manager: "고성민" },
        { rowIndex: 3, location: "B-01", name: "프로스펙스 손목 보호대", photo: "", stock: 4, spec: "", note: "", manager: "오피스" },
      ]);
      setWhLoaded(true);
    } catch (e: any) {
      setWhLoaded(true); // 실패해도 무한 스피너 방지 (재시도 버튼으로 다시 시도)
      showToast(`일반 자재을 불러오지 못했습니다: ${e.message}`, "error");
    }
    finally { setWhLoading(false); }
  }, [connected, scriptUrl, whLoaded, showToast]);

  const loadWhReturn = useCallback(async () => {
    setWhReturnLoading(true);
    setWhReturnSel({});
    try {
      if (connected && scriptUrl) setWhReturnItems(await fetchWarehouseBorrowedItems(scriptUrl, ""));
      else setWhReturnItems([{ location: "A-01", name: "랙 선반용 합판", quantity: 2, itemLabel: "[A-01] 랙 선반용 합판 x 2", borrowDate: "2026-07-01", borrowerName: "고성민" }]);
    } catch (e: any) { showToast(`창고 대여 내역을 불러오지 못했습니다: ${e.message}`, "error"); }
    finally { setWhReturnLoading(false); }
  }, [connected, scriptUrl, showToast]);

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
    } finally {
      setItemsLoading(false);
    }
  }, [connected, scriptUrl, itemsLoading, showToast]);

  useEffect(() => {
    // b3s(SID 입력)에서 미리 로딩을 시작해야, 다음 화면(b4s)에 도착해 바로 "신청하기"를
    // 눌러도 재고 목록이 비어 있어 재고초과로 오판되는 경쟁 상태(race condition)를 피할 수 있다.
    if ((mode === "b3g" || mode === "b3s" || mode === "b4s") && !itemsLoaded && !itemsLoading) {
      loadItems();
    }
  }, [mode, itemsLoaded, itemsLoading, loadItems]);

  // 로딩 중에 "신청하기"를 눌러 대기 상태가 된 경우, 로딩이 끝나면 자동으로 이어서 제출한다.
  useEffect(() => {
    if (pendingSubmit && itemsLoaded && !itemsLoading) {
      setPendingSubmit(false);
      handleBorrowSubmit();
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
      if (!otherName.trim()) { showToast("성함을 입력해주세요.", "warn"); return false; }
      return true;
    }
    const v = borrowerName.trim();
    if (!v) { showToast("성함을 입력해주세요.", "warn"); return false; }
    if (!isKoreanName(v)) { showToast("이름은 한글만 입력할 수 있습니다.", "warn"); return false; }
    if (affiliation === "cfgw" && !/^\d+$/.test(employeeId.trim())) { showToast("사번은 숫자만 입력할 수 있습니다.", "warn"); return false; }
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
    if (!validateStep1()) return;
    if (affiliation === "configds" && connected && scriptUrl) {
      setVerifying(true);
      try {
        const ok = await checkConfigDsRegistered(scriptUrl, borrowerName.trim());
        if (!ok) {
          showToast("'ConfigDS계정' 시트에 등록되지 않은 이름입니다. 관리자에게 계정 등록을 요청해주세요.", "error");
          return;
        }
      } catch (e: any) {
        showToast(`확인 중 오류: ${e.message}`, "error");
        return;
      } finally {
        setVerifying(false);
      }
    }
    // 열람 조회 장바구니 불러오기 (같은 사번·성함)
    if (affiliation === "cfgw") {
      const nm = borrowerName.trim();
      const eid = employeeId.trim();
      saveIdentity({ name: nm, employeeId: eid });
      const saved = loadBrowseCart(nm, eid);
      if (saved.length > 0) {
        const merge = (prev: CartItem[]) => {
          const next = prev.slice();
          saved.forEach((sv) => {
            const i = next.findIndex((c) => c.id === sv.id);
            if (i === -1) next.push({ id: sv.id, name: sv.name, quantity: sv.quantity, rootSlot: sv.rootSlot });
          });
          return next;
        };
        setCart(merge);
        setReqCart(merge);
        showToast(`열람 장바구니에서 ${saved.length}개 물품을 불러왔습니다.`, "ok");
      }
    }
    setMode("b2");
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
    const blocked = sidCart.find((e) => e.scenario?.blocked);
    if (blocked && blocked.scenario) { showToast(blocked.scenario.blockReason, "error"); return; }
    setMode("b4s");
  }

  async function handleBorrowSubmit() {
    // 재고 검증에 물품 목록(objectItems)이 필요한데 아직 로딩 중이면, 재고를 0으로 오판해
    // "재고 초과"로 잘못 막아버릴 수 있다. 이 경우 조용히 대기했다가 로딩이 끝나면 자동으로
    // 이어서 제출한다 (사용자가 다시 버튼을 누를 필요 없음).
    if (itemsLoading || !itemsLoaded) {
      setPendingSubmit(true);
      showToast("물품 재고 정보를 불러오는 중입니다. 완료되면 자동으로 신청을 진행합니다...", "warn");
      if (!itemsLoading && !itemsLoaded) loadItems();
      return;
    }

    const name = affiliation === "other" ? otherName.trim() : borrowerName.trim();
    const contact = { affiliation, employeeId: employeeId.trim() };
    const nowStr = nowString();
    const borrowList: BorrowEntry[] = [];

    if (itemType === "general") {
      if (cart.length === 0) { showToast("물품을 하나 이상 선택해주세요.", "warn"); return; }
      if (!generalOption) { showToast("대여 구분(추가 물품 대여 / Light Scenario / Wild Scenario)을 선택해주세요.", "warn"); return; }
      for (const c of cart) {
        const obj = objectItems.find((o) => o.id === c.id);
        // 물품 목록은 이미 로딩이 끝난 상태(위에서 보장됨)이므로, obj가 없다는 것은
        // 카탈로그에 해당 ID가 없다는 뜻 — 재고 0으로 간주해 막기보다는 검증을 건너뛴다.
        if (!obj) continue;
        const stock = obj.stock || 0;
        if (c.quantity > stock) {
          showToast(`['${c.name}'] 신청 수량(${c.quantity}개)이 현재 재고(${stock}개)를 초과합니다. 수량을 조절해주세요.`, "warn");
          return;
        }
      }
      borrowList.push({
        itemType: "general", borrowerName: name, ...contact,
        borrowedItems: cart.map((c) => ({ id: c.id, name: c.name, quantity: c.quantity })),
        generalOption, borrowDate: nowStr, borrowPurpose: purposeGeneral,
      });
    } else {
      if (sidCart.some((e) => e.loading)) { showToast("Scenario 시트의 필요 물품을 불러오는 중입니다. 잠시 후 다시 시도해주세요.", "warn"); return; }
      // 재고 합산 검증 (필요 물품 + 추가 물품)
      const totals: Record<string, { name: string; quantity: number }> = {};
      const addQty = (id: string, nm: string, q: number) => {
        if (!totals[id]) totals[id] = { name: nm, quantity: 0 };
        totals[id].quantity += q;
      };
      sidCart.forEach((e) => (e.scenario?.items || []).forEach((it) => addQty(it.id, it.name, it.quantity || 1)));
      const additionalItems = reqCart.map((c) => ({ id: c.id, name: c.name, quantity: c.quantity }));
      additionalItems.forEach((it) => addQty(it.id, it.name, it.quantity || 1));
      for (const id in totals) {
        const req = totals[id];
        const obj = objectItems.find((o) => o.id === id);
        // 카탈로그(objectItems)에 없는 ID(예: 시나리오 시트에만 존재하는 필요 물품)는
        // 재고 0으로 간주해 막지 않고 검증을 건너뛴다 — 실제 서버 처리 시 별도로 확인된다.
        if (!obj) continue;
        const stock = obj.stock || 0;
        if (req.quantity > stock) {
          showToast(`['${req.name}'] 대여 예정 총 수량(${req.quantity}개)이 현재 재고(${stock}개)를 초과합니다. 다른 물품을 선택하거나 신청을 분할해주세요.`, "warn");
          return;
        }
      }
      sidCart.forEach((entry) => {
        const scenario = entry.scenario || ({ items: [], syncNeeded: true } as any);
        borrowList.push({
          itemType: "scenario", borrowerName: name, ...contact,
          scenarioId: entry.sid,
          requiredObjects: scenario.items || [],
          additionalItems,
          syncNeeded: !!scenario.syncNeeded,
          borrowDate: nowStr, borrowPurpose: purposeScenario,
        });
      });
    }

    setSubmitting(true);
    
    // 로컬 장바구니 즉시 비우기 (Optimistic UI)
    if (affiliation === "cfgw") {
      clearBrowseCart(borrowerName.trim(), employeeId.trim());
    }

    // 영수증에 표시할 물품 리스트 구성
    const receiptItems: { name: string; qty: number; location?: string }[] = [];
    if (itemType === "general") {
      cart.forEach((c) => {
        const obj = objectItems.find((o) => o.id === c.id);
        receiptItems.push({ name: c.name, qty: c.quantity, location: obj?.rootSlot });
      });
    } else {
      sidCart.forEach((entry) => {
        const items = entry.scenario?.items || [];
        items.forEach((it: any) => {
          const obj = objectItems.find((o) => o.id === it.id);
          receiptItems.push({
            name: `[시나리오 ${entry.sid}] ${it.name}`,
            qty: it.quantity || 1,
            location: obj?.rootSlot || it.rootSlot,
          });
        });
      });
      reqCart.forEach((c) => {
        const obj = objectItems.find((o) => o.id === c.id);
        receiptItems.push({
          name: `[추가] ${c.name}`,
          qty: c.quantity,
          location: obj?.rootSlot,
        });
      });
    }

    // 일단 즉시 "접수 완료 및 동기화 중" 화면 표시 (사용자가 대기할 필요가 없도록 비동기 처리)
    setResultInfo({
      ok: true,
      isSyncing: true,
      title: "대여 신청 접수 중...",
      sub: "구글 스프레드시트 기록 및 Slack 메시지 발송을 진행하고 있습니다. 잠시만 기다리시거나 창을 닫으셔도 안전하게 완료됩니다.",
      receipt: {
        borrower: name,
        date: nowStr,
        action: itemType === "general" ? "일반 대여 신청" : "시나리오 대여 신청",
        items: receiptItems,
      },
    });
    setMode("result");
    setSubmitting(false);

    // 실제 전송은 백그라운드 비동기로 진행
    (async () => {
      try {
        if (connected && scriptUrl) {
          const res = await postRecordBorrow(scriptUrl, borrowList, appVersion);
          setResultInfo((prev) => ({
            ...prev,
            ok: res.success,
            isSyncing: false,
            title: res.success ? "대여 신청 완료!" : "대여 기록 실패",
            sub: res.message
          }));
          if (res.success) {
            // 성공 시 리스트 새로고침
            loadUnreturned();
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
        }
      } catch (e: any) {
        setResultInfo((prev) => ({
          ...prev,
          ok: false,
          isSyncing: false,
          title: "대여 신청 오류",
          sub: e.message || "네트워크 상태를 확인하고 다시 시도해주세요."
        }));
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

  const uniqueWhBorrowers = useMemo(() => {
    const namesMap: Record<string, number> = {};
    whReturnItems.forEach((item) => {
      const bName = (item.borrowerName || "(이름 없음)").trim();
      namesMap[bName] = (namesMap[bName] || 0) + (Math.max(1, parseInt(String(item.quantity), 10) || 1));
    });
    return Object.entries(namesMap)
      .map(([name, totalQty]) => ({ name, totalQty }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [whReturnItems]);

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
      return { sheetType: sheetType as "scenario" | "general", rowIndex: parseInt(rowIndex, 10), quantity: selectedReturn[k] };
    });
    setReturnSubmitting(true);

    // 먼저 "반납 처리 진행 중" 화면 표시하여 무한 스피너 대기 제거
    setResultInfo({
      ok: true,
      isSyncing: true,
      title: "반납 처리 진행 중...",
      sub: "구글 시트에 반납을 기록하고 Slack 스레드를 전송하고 있습니다. 화면을 닫으셔도 백그라운드에서 안전하게 전송이 완료됩니다."
    });
    setMode("result");
    setReturnSubmitting(false);

    // 실제 반납 API 백그라운드 전송
    (async () => {
      try {
        if (connected && scriptUrl) {
          const res = await postProcessReturn(scriptUrl, requests, appVersion);
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

  /* ══════════════════════ 일반 자재 대여/반납 ══════════════════════ */


  async function handleWarehouseBorrow(actionType: "대여" | "소모" = "대여") {
    const user = whName.trim();
    if (!user) { showToast("성함을 입력해주세요.", "warn"); return; }
    if (!isKoreanName(user)) { showToast("이름은 한글만 입력할 수 있습니다.", "warn"); return; }
    if (whCart.length === 0) { showToast(`${actionType}할 일반 자재을 담아주세요.`, "warn"); return; }
    // 재고 검증
    for (const c of whCart) {
      const orig = whItems.find((o) => o.rowIndex === c.rowIndex);
      const stock = orig ? warehouseStockNum(orig.stock) : NaN;
      if (!isNaN(stock) && c.quantity > stock) { showToast(`['${c.name}'] 신청 수량(${c.quantity})이 재고(${stock})를 초과합니다.`, "warn"); return; }
    }
    setSubmitting(true);
    const total = whCart.reduce((n, c) => n + c.quantity, 0);
    const cartSnapshot = [...whCart];

    // 즉시 로컬 장바구니 비우기 및 결과 영수증 페이지로 이동 (Optimistic UI)
    clearWarehouseCart(user, whEmpId.trim());
    setWhCart([]);

    setResultInfo({
      ok: true,
      isSyncing: true,
      title: actionType === "소모" ? "일반 자재 소모 진행 중..." : "일반 자재 대여 진행 중...",
      sub: actionType === "소모"
        ? `${total}개 물품의 소모를 구글 시트에 기록 중입니다. 잠시만 기다리시거나 화면을 닫으셔도 정상 완료됩니다.`
        : `${total}개 물품의 대여를 구글 시트에 기록 중입니다. 잠시만 기다리시거나 화면을 닫으셔도 정상 완료됩니다.`,
      receipt: {
        borrower: user,
        date: nowString(),
        due: actionType === "대여" && whDueDate ? whDueDate : undefined,
        action: actionType,
        items: cartSnapshot.map((c) => ({ name: c.name, qty: c.quantity, location: c.location })),
      },
    });
    setMode("result");
    setSubmitting(false);

    // 백그라운드 병렬 처리 실행
    (async () => {
      try {
        if (connected && scriptUrl) {
          await Promise.all(cartSnapshot.map(async (c) => {
            const dueTag = actionType === "대여" && whDueDate ? ` [반납예정:${whDueDate}]` : "";
            const baseNote = whPurpose || (actionType === "소모" ? "소모 처리" : "대여 신청");
            return postWarehouseRent(scriptUrl, { type: actionType, location: c.location, name: c.name, qty: c.quantity, user, note: baseNote + dueTag });
          }));
          
          setResultInfo((prev: any) => ({
            ...prev,
            isSyncing: false,
            title: actionType === "소모" ? "일반 자재 소모 완료!" : "일반 자재 대여 완료!",
            sub: actionType === "소모"
              ? `${total}개 물품을 소모 처리했습니다.`
              : `${total}개 물품을 대여 처리했습니다.`,
          }));
          
          // 리프레시
          loadWarehouse(true);
          loadWhReturn();
        } else {
          // 데모 모드
          await new Promise((resolve) => setTimeout(resolve, 800));
          setResultInfo((prev: any) => ({
            ...prev,
            isSyncing: false,
          }));
        }
      } catch (e: any) {
        setResultInfo((prev: any) => ({
          ...prev,
          ok: false,
          isSyncing: false,
          title: "창고 연동 실패",
          sub: e.message || "구글 시트에 내역을 전송하는 중 오류가 발생했습니다. 네트워크를 확인해주세요."
        }));
      }
    })();
  }

  async function handleWarehouseReturn() {
    const keys = Object.keys(whReturnSel);
    if (!keys.length) { showToast("반납할 물품을 선택해주세요.", "warn"); return; }
    if (!whName.trim()) { showToast("반납자 성함을 입력해주세요.", "warn"); return; }
    setReturnSubmitting(true);
    const returnSnapshot = keys.map((k) => {
      const idx = parseInt(k, 10);
      const item = whReturnItems[idx];
      return { item, qty: whReturnSel[k] };
    }).filter(x => x.item !== undefined);

    const total = returnSnapshot.reduce((n, c) => n + c.qty, 0);

    // 즉시 반납 진행 중 UI 표시
    setResultInfo({
      ok: true,
      isSyncing: true,
      title: "일반 자재 반납 진행 중...",
      sub: `${total}개 물품의 반납을 기록하고 있습니다. 화면을 닫으셔도 구글 시트에 안전하게 완료됩니다.`,
      receipt: {
        borrower: whName.trim(),
        date: nowString(),
        action: "창고 반납",
        items: returnSnapshot.map((c) => ({ name: c.item.name, qty: c.qty, location: c.item.location })),
      }
    });
    setMode("result");
    setReturnSubmitting(false);

    // 백그라운드 병렬 전송
    (async () => {
      try {
        if (connected && scriptUrl) {
          await Promise.all(returnSnapshot.map(async (c) => {
            // 반납 로그의 user는 반드시 '원래 대여자'와 일치해야 서버에서 해당 건의 재고를 정확히 상계한다.
            // (대여자별로 분리 집계되므로, 반납자 이름을 넣으면 다른 사람의 항목으로 잘못 매칭될 수 있다)
            return postWarehouseRent(scriptUrl, { type: "반납", location: c.item.location, name: c.item.name, qty: c.qty, user: c.item.borrowerName || whName.trim() || "", note: `반납 접수 (반납자: ${whName.trim()})` });
          }));
          
          setResultInfo((prev: any) => ({
            ...prev,
            isSyncing: false,
            title: "일반 자재 반납 완료!",
            sub: `${total}개 물품을 반납 처리했습니다.`,
          }));
          
          // 리스트 초기화 및 새로고침
          setWhReturnSel({});
          loadWarehouse(true);
          loadWhReturn();
        } else {
          // 데모 모드
          await new Promise((resolve) => setTimeout(resolve, 800));
          setResultInfo((prev: any) => ({
            ...prev,
            isSyncing: false,
            title: "일반 자재 반납 완료!",
            sub: `${total}개 물품을 반납 처리했습니다. (로컬 데모)`,
          }));
          setWhReturnSel({});
        }
      } catch (e: any) {
        setResultInfo((prev: any) => ({
          ...prev,
          ok: false,
          isSyncing: false,
          title: "창고 반납 오류",
          sub: e.message || "구글 시트 전송 중 오류가 발생했습니다."
        }));
      }
    })();
  }

  const whCatMapRacks = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    whItems.forEach((it) => {
      const { rack, slot } = parseRackSlot(it.location);
      if (!rack) return;
      if (!map[rack]) map[rack] = new Set<string>();
      if (slot) map[rack].add(slot);
    });
    return map;
  }, [whItems]);
  const whRacks = useMemo(() => Object.keys(whCatMapRacks).sort(), [whCatMapRacks]);
  const whSlots = whRack && whCatMapRacks[whRack] ? Array.from<string>(whCatMapRacks[whRack]).sort() : [];
  const whFiltered = useMemo(() => {
    const q = whSearch.trim();
    return whItems.filter((it) => {
      const { rack, slot } = parseRackSlot(it.location);
      if (whRack && rack !== whRack) return false;
      if (whSlot && slot !== whSlot) return false;
      if (!q) return true;
      return smartMatch([it.name, it.location, it.keywords], q);
    }).sort((a, b) => compareRackSlot(a.location, b.location));
  }, [whItems, whSearch, whRack, whSlot]);
  const whCartCount = whCart.reduce((n, c) => n + c.quantity, 0);

  function addWhCart(it: WarehouseItem) {
    const stock = warehouseStockNum(it.stock);
    if (!isNaN(stock) && stock < 1) { showToast("재고가 부족합니다. (재고: 0)", "warn"); return; }
    setWhCart((prev) => {
      const idx = prev.findIndex((c) => c.rowIndex === it.rowIndex);
      if (idx === -1) return [...prev, { rowIndex: it.rowIndex, location: it.location, name: it.name, quantity: 1 }];
      if (!isNaN(stock) && prev[idx].quantity >= stock) { showToast(`재고가 부족합니다. (최대 ${stock}개)`, "warn"); return prev; }
      return prev.map((c, i) => (i === idx ? { ...c, quantity: c.quantity + 1 } : c));
    });
  }
  // 목록에 없는 물품을 직접 이름으로 담는다 (rowIndex: -1 = 커스텀 항목)
  function addCustomWhCart(name: string, location: string) {
    const nm = name.trim();
    if (!nm) { showToast("물품명을 입력해주세요.", "warn"); return; }
    setWhCart((prev) => {
      // 같은 이름의 커스텀 항목이 이미 있으면 수량 +1
      const idx = prev.findIndex((c) => c.rowIndex === -1 && c.name === nm && c.location === location.trim());
      if (idx !== -1) return prev.map((c, i) => (i === idx ? { ...c, quantity: c.quantity + 1 } : c));
      return [...prev, { rowIndex: -1, location: location.trim(), name: nm, quantity: 1 }];
    });
    showToast(`'${nm}' 담았습니다.`, "ok");
  }

  function chgWhCart(idx: number, d: number) {
    setWhCart((prev) => {
      const item = prev[idx]; if (!item) return prev;
      const orig = whItems.find((o) => o.rowIndex === item.rowIndex);
      const stock = orig ? warehouseStockNum(orig.stock) : NaN; const next = item.quantity + d;
      if (d > 0 && !isNaN(stock) && next > stock) { showToast(`재고가 부족합니다. (최대 ${stock}개)`, "warn"); return prev; }
      if (next < 1) return prev.filter((_, i) => i !== idx);
      return prev.map((c, i) => (i === idx ? { ...c, quantity: next } : c));
    });
  }

  /* ══════════════════════ 초기화 & 결과 ══════════════════════ */

  function resetAll() {
    setCart([]); setReqCart([]); setSidCart([]); setSidInput("");
    setGeneralOption(""); setPurposeGeneral(""); setPurposeScenario("");
    setSelectedReturn({}); setExpanded({}); setReturnSearch("");
    setItemSearch(""); setItemCat(""); setItemSub(""); setReqSearch(""); setReqCat(""); setReqSub("");
    setItemsLoaded(false); setObjectItems([]);
    setWhCart([]); setWhSearch(""); setWhCustomLoc(""); setWhRack(""); setWhSlot(""); setWhPurpose(""); setWhDueDate(""); setWhReturnSel({});
    setMode(rootMode);
    if (rootMode === "return") loadUnreturned();
    if (rootMode === "b1") loadItems();
    if (rootMode === "wborrow") { loadWarehouse(true); }
    if (rootMode === "wreturn") loadWhReturn();
  }

  /* ══════════════════════ 헤더/네비 ══════════════════════ */

  const titles: Record<string, string> = {
    pickBorrowKind: "대여 신청", pickReturnKind: "반납 처리",
    b1: "시나리오 대여 신청", b2: "시나리오 대여 신청", b3g: "시나리오 대여 신청",
    b4g: "시나리오 대여 신청", b3s: "시나리오 대여 신청", b4s: "시나리오 대여 신청",
    return: "시나리오 반납 처리", wborrow: "일반 자재 대여", wreturn: "일반 자재 반납", result: "",
  };

  function goPrev() {
    if (mode === rootMode) {
      if (rootMode === "wborrow" && onBackToWarehouseBrowse) { onBackToWarehouseBrowse(); return; }
      onBack(); return;
    }
    if (mode === "b1") setMode(entry === "return" ? "pickReturnKind" : "pickBorrowKind");
    else if (mode === "b2") setMode("b1");
    else if (mode === "b3g" || mode === "b3s") setMode("b2");
    else if (mode === "b4g") setMode("b3g");
    else if (mode === "b4s") setMode("b3s");
    else if (mode === "return") setMode("pickReturnKind");
    else if (mode === "wborrow" || mode === "wreturn") setMode(entry === "return" ? "pickReturnKind" : "pickBorrowKind");
    else setMode(rootMode);
  }

  const progressIdx = mode === "b1" ? 1 : mode === "b2" ? 2 : mode === "b3g" || mode === "b3s" ? 3 : mode === "b4g" || mode === "b4s" ? 4 : 0;

  /* ── URL 해시로 대여 단계를 세분화 (#/borrow/<단계>) — 새로고침·공유·뒤로가기 지원 ── */
  const MODE_SLUGS: Record<string, string> = {
    pickBorrowKind: "kind", pickReturnKind: "kind",
    b1: "identity", b2: "items", b3g: "general", b4g: "confirm",
    b3s: "sid", b4s: "confirm-sid", wborrow: "warehouse", wreturn: "warehouse-return",
    return: "return", result: "done", mode: "kind",
  };
  const SLUG_TO_MODE: Record<string, Mode> = {
    kind: entry === "return" ? "pickReturnKind" : "pickBorrowKind",
    identity: "b1", items: "b2", general: "b3g", confirm: "b4g",
    sid: "b3s", "confirm-sid": "b4s", warehouse: "wborrow",
    "warehouse-return": "wreturn", return: "return", done: "result",
  };
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const suppressHashSync = useRef(false);

  // 슬라이딩 방향 추적: 단계 순서를 매겨 앞으로/뒤로를 판단한다.
  // (렌더 중 동기 계산 — key가 바뀌는 순간 올바른 방향이 즉시 적용되도록)
  const MODE_ORDER: Record<string, number> = {
    pickBorrowKind: 0, pickReturnKind: 0, mode: 0,
    b1: 1, b2: 2, b3g: 3, b3s: 3, b4g: 4, b4s: 4,
    wborrow: 1, wreturn: 1, return: 1, result: 5,
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
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "inherit" }}>
      <style>{`
        @keyframes bsp-spin { to { transform: rotate(360deg); } }
        
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
      <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "16px 20px", borderBottom: `1px solid ${C.border}`, background: C.card, position: "sticky", top: 0, zIndex: 20 }}>
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

      <div style={{ maxWidth: "620px", margin: "0 auto", padding: "24px 16px 48px" }}>

        {/* 진행바 (대여 신청 흐름) */}
        {progressIdx > 0 ? (
          <div style={{ marginBottom: "24px" }}>
            <div style={{ width: "100%", height: "6px", background: C.border, borderRadius: "10px", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${((progressIdx - 1) / 3) * 100}%`, background: `linear-gradient(90deg, ${C.accent}, #94a3b8)`, borderRadius: "10px", transition: "width 0.3s" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "8px", fontSize: "11px", color: C.label, fontWeight: 600 }}>
              <span>정보 입력</span><span>유형 선택</span><span>물품 선택</span><span>제출</span>
            </div>
          </div>
        ) : null}

        {/* ───────── 대여 종류 선택 (시나리오 / 창고) ───────── */}
        <div key={mode} className={slideDir === "forward" ? "step-forward" : "step-back"}>
        {mode === "pickBorrowKind" || mode === "pickReturnKind" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ fontSize: "13px", color: C.label, marginBottom: "4px" }}>
              {mode === "pickBorrowKind" ? "대여할 물품 종류를 선택하세요." : "반납할 물품 종류를 선택하세요."}
            </div>
            {[
              { kind: "scenario", icon: <Fingerprint size={22} />, color: C.accentText, bg: C.accentSoft, title: "시나리오 물품", sub: "SID 기반 대여 및 일반 대여 (Slack 연동)" },
              { kind: "warehouse", icon: <Warehouse size={22} />, color: C.success, bg: C.successSoft, title: "일반 자재", sub: "창고 재고를 랙·슬롯 기준으로 대여/반납" },
            ].map((m) => (
              <div
                key={m.kind}
                onClick={() => {
                  if (mode === "pickBorrowKind") {
                    if (m.kind === "scenario") { setMode("b1"); setItemsLoaded(false); loadItems(); }
                    else { setMode("wborrow"); loadWarehouse(); }
                  } else {
                    if (m.kind === "scenario") { setMode("return"); loadUnreturned(); }
                    else { setMode("wreturn"); loadWhReturn(); }
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

        {/* ───────── Step 1: 신청인 ───────── */}
        {mode === "b1" ? (
          <div>
            {affiliation !== "other" ? (
              <div style={{ marginBottom: "16px" }}>
                <label style={labelStyle}>신청인 성함</label>
                <div style={{ position: "relative" }}>
                  <User size={16} style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
                  <input
                    value={borrowerName}
                    onChange={(e) => setBorrowerName(e.target.value.replace(/[^\uAC00-\uD7A3\u3131-\u318E\s]/g, ""))}
                    onKeyDown={onEnter(step1Next)}
                    placeholder="성함을 입력해주세요"
                    style={{ ...inputStyle, paddingLeft: "40px" }}
                  />
                </div>
              </div>
            ) : null}

            <label style={labelStyle}>소속</label>
            <div style={{ display: "flex", gap: "10px", marginBottom: "16px" }}>
              <TypeCard small active={affiliation === "cfgw"} icon={<Building2 size={19} />} text="Cfgw-kr" onClick={() => setAffiliation("cfgw")} />
              <TypeCard small active={affiliation === "configds"} icon={<Building2 size={19} />} text="ConfigDS" onClick={() => setAffiliation("configds")} />
              <TypeCard small active={affiliation === "other"} icon={<MoreHorizontal size={19} />} text="기타" onClick={() => setAffiliation("other")} />
            </div>

            {affiliation === "cfgw" ? (
              <div style={{ position: "relative", marginBottom: "16px" }}>
                <IdCard size={16} style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
                <input
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value.replace(/\D/g, ""))}
                  placeholder="사번을 입력해주세요 (숫자만)"
                  inputMode="numeric"
                  onKeyDown={onEnter(step1Next)}
                  style={{ ...inputStyle, paddingLeft: "40px" }}
                />
              </div>
            ) : null}

            {affiliation === "other" ? (
              <div style={{ marginBottom: "16px" }}>
                <label style={labelStyle}>이름</label>
                <div style={{ position: "relative" }}>
                  <User size={16} style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
                  <input value={otherName} onChange={(e) => setOtherName(e.target.value)} onKeyDown={onEnter(step1Next)} placeholder="성함을 입력해주세요" style={{ ...inputStyle, paddingLeft: "40px" }} />
                </div>
                <div style={{ fontSize: "12px", color: C.label, marginTop: "6px", lineHeight: 1.5 }}>
                  기타 소속은 Slack 이메일 없이 성함만 입력합니다. (Slack 멘션은 제공되지 않습니다)
                </div>
              </div>
            ) : null}

            <div style={{ display: "flex", gap: "10px", marginTop: "24px" }}>
              <button onClick={() => (onBack())} style={secondaryBtn}>이전</button>
              <button onClick={step1Next} disabled={verifying} style={{ ...primaryBtn, opacity: verifying ? 0.7 : 1 }}>
                {verifying ? <><Spinner size={16} light /> 확인 중...</> : <>다음 단계 <ChevronRight size={15} /></>}
              </button>
            </div>
          </div>
        ) : null}

        {/* ───────── Step 2: 유형 선택 ───────── */}
        {mode === "b2" ? (
          <div>
            <label style={labelStyle}>대여 유형</label>
            <div style={{ display: "flex", gap: "12px", marginBottom: "24px" }}>
              <TypeCard active={itemType === "scenario"} icon={<Fingerprint size={26} />} text="SID 기반 대여" onClick={() => { setItemType("scenario"); setMode("b3s"); }} C={C} />
              <TypeCard active={itemType === "general"} icon={<Boxes size={26} />} text="일반 대여" onClick={() => { setItemType("general"); setMode("b3g"); }} C={C} />
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => (rootMode === "b1" ? onBack() : setMode("b1"))} style={secondaryBtn}>이전</button>
              <button onClick={() => setMode(itemType === "general" ? "b3g" : "b3s")} style={primaryBtn}>다음 단계 <ChevronRight size={15} /></button>
            </div>
          </div>
        ) : null}

        {/* ───────── Step 3-일반: 물품 선택 ───────── */}
        {mode === "b3g" ? (
          <div>
            <label style={labelStyle}>대여 물품 선택</label>
            <CartBox list={cart} setList={setCart} emptyText="아래 목록에서 물품을 선택해주세요" C={C} objectItems={objectItems} showToast={showToast} />
            <ItemPicker list={cart} setList={setCart} search={itemSearch} setSearch={setItemSearch} cat={itemCat} setCat={setItemCat} sub={itemSub} setSub={setItemSub} C={C} isLightMode={isLightMode} objectItems={objectItems} itemsLoaded={itemsLoaded} categories={categories} subsOf={subsOf} matchesFilters={matchesFilters} showToast={showToast} setImageModalUrl={setImageModalUrl} />
            <div style={{ display: "flex", gap: "10px", marginTop: "18px" }}>
              <button onClick={() => setMode("b2")} style={secondaryBtn}>이전</button>
              <button onClick={() => { if (cart.length === 0) { showToast("물품을 하나 이상 선택해주세요.", "warn"); return; } setMode("b4g"); }} style={primaryBtn}>다음 단계 <ChevronRight size={15} /></button>
            </div>
          </div>
        ) : null}

        {/* ───────── Step 4-일반: 구분/목적/제출 ───────── */}
        {mode === "b4g" ? (
          <div>
            <label style={labelStyle}>대여 구분 <span style={{ fontWeight: 400, color: C.error, fontSize: "12px" }}>(필수)</span></label>
            <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
              <TypeCard small active={generalOption === "추가 물품 대여"} icon={<PlusCircle size={18} />} text="추가 물품 대여" onClick={() => setGeneralOption("추가 물품 대여")} C={C} />
              <TypeCard small active={generalOption === "Light Scenario"} icon={<Feather size={18} />} text="Light Scenario" onClick={() => setGeneralOption("Light Scenario")} C={C} />
              <TypeCard small active={generalOption === "Wild Scenario"} icon={<Flame size={18} />} text="Wild Scenario" onClick={() => setGeneralOption("Wild Scenario")} C={C} />
            </div>
            <label style={labelStyle}>대여 목적</label>
            <textarea value={purposeGeneral} onChange={(e) => setPurposeGeneral(e.target.value)} placeholder="간략한 대여 목적을 적어주세요" style={{ ...inputStyle, minHeight: "90px", resize: "none", marginBottom: "20px" }} />
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => setMode("b3g")} style={secondaryBtn}>이전</button>
              <button onClick={handleBorrowSubmit} disabled={submitting || pendingSubmit} style={{ ...primaryBtn, opacity: (submitting || pendingSubmit) ? 0.7 : 1 }}>
                {submitting ? <><Spinner size={16} light={true} C={C} /> 처리 중...</> : pendingSubmit ? <><Spinner size={16} light={true} C={C} /> 물품 정보 확인 중...</> : "신청하기"}
              </button>
            </div>
          </div>
        ) : null}

        {/* ───────── Step 3-SID: SID 입력 ───────── */}
        {mode === "b3s" ? (
          <div>
            <label style={labelStyle}>시나리오 ID 입력</label>
            <div style={{ position: "relative", marginBottom: "12px" }}>
              <Fingerprint size={16} style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
              <input
                value={sidInput}
                onChange={(e) => setSidInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); tryAddSid(); } }}
                placeholder="예: S1234 또는 L1234"
                style={{ ...inputStyle, paddingLeft: "40px" }}
              />
            </div>
            {appVersion ? (
              <div style={{ fontSize: "10px", color: C.label, marginTop: "-6px", marginBottom: "12px" }}>서버 버전: {appVersion}</div>
            ) : null}
            {sidCart.length > 0 ? (
              <div style={{ marginBottom: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <span style={{ fontSize: "13px", color: C.label }}>추가된 SID</span>
                  <span style={{ fontSize: "11px", fontWeight: 700, background: C.accent, color: "#fff", borderRadius: "14px", padding: "2px 10px" }}>{sidCart.length}개</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "220px", overflowY: "auto" }}>
                  {sidCart.map((entry, idx) => (
                    <div key={entry.sid} style={{ display: "flex", alignItems: "flex-start", gap: "10px", padding: "10px 12px", background: C.cardSub, border: `1px solid ${C.border}`, borderRadius: "10px" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: "13px", color: C.text, display: "flex", alignItems: "center", gap: "6px" }}>
                          <Fingerprint size={13} style={{ color: C.accentText }} />{entry.sid}
                        </div>
                        {entry.loading ? (
                          <div style={{ fontSize: "11px", color: C.label, marginTop: "3px" }}>Scenario 시트에서 필요 물품을 불러오는 중…</div>
                        ) : entry.scenario?.fetchError ? (
                          <div style={{ marginTop: "4px" }}>
                            <div style={{ fontSize: "11px", color: C.error, fontWeight: 700 }}>조회 실패: {entry.scenario.fetchError}</div>
                            <button onClick={() => loadSidScenario(entry.sid)} style={{ marginTop: "4px", fontSize: "11px", fontWeight: 700, color: C.accentText, background: "none", border: `1px solid ${C.border}`, borderRadius: "6px", padding: "3px 8px", cursor: "pointer" }}>다시 시도</button>
                          </div>
                        ) : entry.scenario?.blocked ? (
                          <div style={{ fontSize: "11px", color: C.error, marginTop: "3px", fontWeight: 700 }}>{entry.scenario.blockReason}</div>
                        ) : entry.scenario?.syncNeeded ? (
                          <div style={{ marginTop: "4px" }}>
                            <div style={{ fontSize: "11px", color: C.warn, fontWeight: 700 }}>Scenario 시트에서 이 SID를 찾지 못했습니다. 대여는 계속할 수 있습니다.</div>
                            {entry.scenario.errorMessage ? (
                              <div style={{ fontSize: "10px", color: C.label, marginTop: "2px" }}>({entry.scenario.errorMessage})</div>
                            ) : null}
                            <button onClick={() => loadSidScenario(entry.sid)} style={{ marginTop: "4px", fontSize: "11px", fontWeight: 700, color: C.accentText, background: "none", border: `1px solid ${C.border}`, borderRadius: "6px", padding: "3px 8px", cursor: "pointer" }}>다시 시도</button>
                          </div>
                        ) : (
                          <div style={{ fontSize: "11px", color: C.label, marginTop: "3px" }}>
                            {(entry.scenario?.items || []).map((it) => (
                              <div key={it.id}>• {it.name} ({it.id}) x {it.quantity || 1}{it.rootSlot ? <span style={{ color: C.warn, fontFamily: "monospace", fontWeight: 700 }}> — {padSlot(it.rootSlot)}</span> : null}</div>
                            ))}
                            {(entry.scenario?.items || []).length === 0 ? <div>필요 물품이 없습니다.</div> : null}
                          </div>
                        )}
                      </div>
                      <button onClick={() => setSidCart(sidCart.filter((_, i) => i !== idx))} style={{ width: 28, height: 28, borderRadius: "8px", border: "none", background: C.errorSoft, color: C.error, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><X size={13} /></button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <button onClick={tryAddSid} style={{ ...primaryBtn, width: "100%", marginBottom: "18px", padding: "12px" }}><Plus size={15} /> SID 추가</button>
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => setMode("b2")} style={secondaryBtn}>이전</button>
              <button onClick={step3ScenarioNext} style={primaryBtn}>다음 단계 <ChevronRight size={15} /></button>
            </div>
          </div>
        ) : null}

        {/* ───────── Step 4-SID: 상세 + 추가 물품 ───────── */}
        {mode === "b4s" ? (
          <div>
            <label style={labelStyle}>SID 목록 및 필요 물품</label>
            <div style={{ marginBottom: "16px", padding: "14px 16px", background: C.cardSub, borderRadius: "12px", borderLeft: `4px solid ${C.accent}`, fontSize: "13px" }}>
              {sidCart.map((entry) => {
                const s = entry.scenario;
                return (
                  <div key={entry.sid} style={{ marginBottom: "12px" }}>
                    <strong style={{ color: C.text }}>{entry.sid}</strong>
                    {entry.loading ? (
                      <div style={{ color: C.label, fontSize: "12px" }}>불러오는 중…</div>
                    ) : s?.fetchError ? (
                      <div style={{ color: C.error, fontSize: "12px", fontWeight: 700 }}>조회 실패: {s.fetchError}</div>
                    ) : s?.syncNeeded ? (
                      <div style={{ color: C.warn, fontSize: "12px", fontWeight: 700 }}>Scenario 시트에서 이 SID를 찾지 못했습니다. 대여는 가능합니다.</div>
                    ) : (
                      <div style={{ color: C.label, fontSize: "12px", lineHeight: 1.5 }}>
                        <div>EN: {s?.highLevelEn || "-"}</div>
                        <div>KO: {s?.highLevelKo || "-"}</div>
                        <div style={{ marginTop: "5px", fontWeight: 700, color: C.text }}>필요 물품</div>
                        {(s?.items || []).map((it) => (
                          <div key={it.id}>• {it.name} ({it.id}) x {it.quantity || 1}{it.rootSlot ? <span style={{ color: C.warn, fontFamily: "monospace", fontWeight: 700 }}> — {padSlot(it.rootSlot)}</span> : null}</div>
                        ))}
                        {(s?.items || []).length === 0 ? <div>필요 물품이 없습니다.</div> : null}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <label style={labelStyle}>추가 물품 <span style={{ fontWeight: 400, color: C.label, fontSize: "12px" }}>(필요 물품과 별도로 필요한 물품만 선택하세요. 추가 물품은 일반 대여로 처리됩니다.)</span></label>
            <CartBox list={reqCart} setList={setReqCart} emptyText="필요하다면 아래 목록에서 물품을 선택해주세요" C={C} objectItems={objectItems} showToast={showToast} />
            <ItemPicker list={reqCart} setList={setReqCart} search={reqSearch} setSearch={setReqSearch} cat={reqCat} setCat={setReqCat} sub={reqSub} setSub={setReqSub} C={C} isLightMode={isLightMode} objectItems={objectItems} itemsLoaded={itemsLoaded} categories={categories} subsOf={subsOf} matchesFilters={matchesFilters} showToast={showToast} setImageModalUrl={setImageModalUrl} />

            <div style={{ marginTop: "18px" }}>
              <label style={labelStyle}>대여 목적</label>
              <textarea value={purposeScenario} onChange={(e) => setPurposeScenario(e.target.value)} placeholder="간략한 대여 목적을 적어주세요" style={{ ...inputStyle, minHeight: "90px", resize: "none", marginBottom: "20px" }} />
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => setMode("b3s")} style={secondaryBtn}>이전</button>
              <button onClick={handleBorrowSubmit} disabled={submitting || pendingSubmit} style={{ ...primaryBtn, opacity: (submitting || pendingSubmit) ? 0.7 : 1 }}>
                {submitting ? <><Spinner size={16} light={true} C={C} /> 처리 중...</> : pendingSubmit ? <><Spinner size={16} light={true} C={C} /> 물품 정보 확인 중...</> : "신청하기"}
              </button>
            </div>
          </div>
        ) : null}

        {/* ───────── 반납 처리 ───────── */}
        {mode === "return" ? (
          <div>
            <label style={labelStyle}>반납 처리할 물품을 선택해주세요</label>
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

        {/* ───────── 일반 자재 대여 ───────── */}
        {mode === "wborrow" ? (
          <div>
            <label style={labelStyle}>대여자 성함</label>
            <div style={{ position: "relative", marginBottom: "16px" }}>
              <User size={16} style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
              <input value={whName} onChange={(e) => setWhName(e.target.value.replace(/[^\uAC00-\uD7A3\u3131-\u318E\s]/g, ""))} placeholder="성함을 입력해주세요" style={{ ...inputStyle, paddingLeft: "40px" }} />
            </div>

            {whCart.length > 0 ? (
              <div style={{ marginBottom: "14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <span style={{ fontSize: "13px", color: C.label }}>담은 일반 자재</span>
                  <span style={{ fontSize: "11px", fontWeight: 700, background: C.accent, color: "#fff", borderRadius: "14px", padding: "2px 10px" }}>{whCartCount}개</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "180px", overflowY: "auto" }}>
                  {whCart.map((item, idx) => (
                    <div key={`${item.rowIndex}-${item.name}-${idx}`} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", background: C.cardSub, border: `1px solid ${C.border}`, borderRadius: "10px" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: "13px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.name}</div>
                        <div style={{ fontSize: "11px", color: C.label }}>{item.location}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                        <button onClick={() => chgWhCart(idx, -1)} style={{ width: 28, height: 28, borderRadius: "8px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Minus size={13} /></button>
                        <span style={{ fontWeight: 700, minWidth: "20px", textAlign: "center", fontSize: "13px" }}>{item.quantity}</span>
                        <button onClick={() => chgWhCart(idx, 1)} style={{ width: 28, height: 28, borderRadius: "8px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={13} /></button>
                      </div>
                      <button onClick={() => setWhCart(whCart.filter((_, i) => i !== idx))} style={{ width: 28, height: 28, borderRadius: "8px", border: "none", background: C.errorSoft, color: C.error, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={13} /></button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* 랙/슬롯 필터 + 검색 */}
            <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
              <select value={whRack} onChange={(e) => { setWhRack(e.target.value); setWhSlot(""); }} style={{ ...inputStyle, padding: "10px 12px", fontSize: "13px", flex: 1, minWidth: 0 }}>
                <option value="">전체 랙</option>{whRacks.map((r) => <option key={r} value={r}>{r}랙</option>)}
              </select>
              <select value={whSlot} onChange={(e) => setWhSlot(e.target.value)} style={{ ...inputStyle, padding: "10px 12px", fontSize: "13px", flex: 1, minWidth: 0 }}>
                <option value="">전체 슬롯</option>{whSlots.map((sl) => <option key={sl} value={sl}>{sl}번</option>)}
              </select>
            </div>
            <div style={{ position: "relative", marginBottom: "8px" }}>
              <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
              <input value={whSearch} onChange={(e) => setWhSearch(e.target.value)} placeholder="물품명으로 검색..." style={{ ...inputStyle, paddingLeft: "36px", padding: "11px 12px 11px 36px", fontSize: "14px" }} />
            </div>
            <div style={{ border: `1px solid ${C.border}`, borderRadius: "12px", overflow: "hidden", maxHeight: "280px", overflowY: "auto" }}>
              {whLoading ? (
                <div style={{ padding: "24px", textAlign: "center", color: C.label, fontSize: "13px", display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}><Spinner /> 일반 자재을 불러오는 중...</div>
              ) : !whLoaded || whItems.length === 0 ? (
                <div style={{ padding: "24px", textAlign: "center", color: C.label, fontSize: "13px", display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
                  <div>일반 자재 목록을 불러오지 못했습니다.</div>
                  <button onClick={() => loadWarehouse(true)} style={{ padding: "8px 16px", borderRadius: "8px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", fontSize: "12px", fontWeight: 700 }}>다시 불러오기</button>
                </div>
              ) : whFiltered.length === 0 ? (
                <div style={{ padding: "24px", textAlign: "center", color: C.label, fontSize: "13px" }}>검색 결과가 없습니다.</div>
              ) : (
                whFiltered.map((it) => {
                  const inCart = whCart.some((c) => c.rowIndex === it.rowIndex);
                  const stockN = warehouseStockNum(it.stock);
                  const { rack, slot } = parseRackSlot(it.location);
                  return (
                    <div key={it.rowIndex} onClick={() => addWhCart(it)} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "11px 12px", borderBottom: `1px solid ${C.border}`, cursor: "pointer", background: inCart ? C.accentSoft : "transparent" }}>
                      <input type="checkbox" readOnly checked={inCart} style={{ width: 20, height: 20, accentColor: C.accent, flexShrink: 0 }} />
                      <Thumb url={it.photo} size={44} C={C} setImageModalUrl={setImageModalUrl} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: "13px", lineHeight: 1.3, wordBreak: "break-word" }}>{it.name}</div>
                        <div style={{ marginTop: "3px", display: "flex", gap: "5px", flexWrap: "wrap" }}>
                          {it.location ? <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "10px", fontWeight: 700, color: C.warn, background: C.warnSoft, borderRadius: "6px", padding: "2px 7px", fontFamily: "monospace" }}><MapPin size={11} />{rack}랙 {slot}</span> : null}
                          <span style={{ fontSize: "11px", color: C.success, background: C.successSoft, padding: "2px 8px", borderRadius: "6px", fontWeight: 600 }}>재고 {isNaN(stockN) ? "N/A" : stockN}</span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* 목록에 없는 물품 직접 입력하여 담기 */}
            <div style={{ marginTop: "10px", border: `1px dashed ${C.border}`, borderRadius: "12px", padding: "12px", background: C.cardSub }}>
              <div style={{ fontSize: "12px", fontWeight: 700, color: C.label, marginBottom: "8px", display: "flex", alignItems: "center", gap: "5px" }}>
                <Plus size={13} /> 목록에 없는 물품 직접 대여
              </div>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                <input
                  value={whSearch}
                  onChange={(e) => setWhSearch(e.target.value)}
                  placeholder="물품명"
                  style={{ ...inputStyle, flex: "2 1 140px", padding: "9px 11px", fontSize: "13px" }}
                />
                <input
                  value={whCustomLoc}
                  onChange={(e) => setWhCustomLoc(e.target.value)}
                  placeholder="위치 (선택)"
                  style={{ ...inputStyle, flex: "1 1 90px", padding: "9px 11px", fontSize: "13px" }}
                />
                <button
                  onClick={() => { addCustomWhCart(whSearch, whCustomLoc); setWhSearch(""); setWhCustomLoc(""); }}
                  disabled={!whSearch.trim()}
                  style={{ padding: "9px 16px", borderRadius: "10px", border: "none", background: whSearch.trim() ? C.accent : C.border, color: "#fff", fontSize: "13px", fontWeight: 700, cursor: whSearch.trim() ? "pointer" : "default", whiteSpace: "nowrap" }}
                >
                  담기
                </button>
              </div>
              <div style={{ fontSize: "11px", color: C.label, marginTop: "6px", lineHeight: 1.5 }}>
                재고에 등록되지 않은 물품도 이름을 입력해 대여 기록을 남길 수 있습니다.
              </div>
            </div>

            <div style={{ marginTop: "16px" }}>
              <label style={labelStyle}>목적 / 메모 <span style={{ fontWeight: 400, color: C.label, fontSize: "12px" }}>(선택)</span></label>
              <textarea value={whPurpose} onChange={(e) => setWhPurpose(e.target.value)} placeholder="대여 목적 또는 소모 사유를 적어주세요" style={{ ...inputStyle, minHeight: "80px", resize: "none" }} />
            </div>
            <div style={{ marginTop: "12px" }}>
              <label style={labelStyle}>반납 예정일 <span style={{ fontWeight: 400, color: C.label, fontSize: "12px" }}>(대여 시 선택 · 연체 관리에 사용)</span></label>
              <input type="date" value={whDueDate} onChange={(e) => setWhDueDate(e.target.value)} style={{ ...inputStyle }} />
              {whDueDate ? <div style={{ fontSize: "11px", color: C.accentText, marginTop: "5px", fontWeight: 600 }}>이 예정일이 지나면 대여 대장에서 연체로 표시됩니다.</div> : null}
            </div>
            <div style={{ display: "flex", gap: "10px", marginTop: "18px" }}>
              <button onClick={goPrev} style={secondaryBtn}>이전</button>
              <button onClick={() => handleWarehouseBorrow("소모")} disabled={submitting} style={{ flex: 1, padding: "14px", borderRadius: "12px", border: "none", cursor: "pointer", background: C.warn, color: "#fff", fontSize: "15px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", opacity: submitting ? 0.7 : 1 }}>
                {submitting ? <Spinner size={16} light /> : <Flame size={16} />} 소모
              </button>
              <button onClick={() => handleWarehouseBorrow("대여")} disabled={submitting} style={{ ...primaryBtn, opacity: submitting ? 0.7 : 1 }}>
                {submitting ? <><Spinner size={16} light /> 처리 중...</> : <><HandHelping size={16} /> 대여</>}
              </button>
            </div>
            <div style={{ fontSize: "11px", color: C.label, marginTop: "8px", lineHeight: 1.5 }}>
              <b>소모</b>는 재고에서 차감되며 <b>반납 대상이 아닙니다</b> (아예 사용/소진). 반납이 필요하면 <b>대여</b>를 선택하세요.
            </div>
          </div>
        ) : null}

        {/* ───────── 일반 자재 반납 ───────── */}
        {mode === "wreturn" ? (
          <div>
            <div style={{ marginBottom: "12px", padding: "12px 14px", background: C.accentSoft, borderRadius: "12px", borderLeft: `4px solid ${C.accent}`, fontSize: "12px", lineHeight: 1.6 }}>
              현재 대여 중인 일반 자재 전체 목록입니다. 반납할 물품을 선택하고, 아래에 반납자 성함을 입력해주세요.
            </div>
            <label style={labelStyle}>반납자 성함</label>
            <div style={{ position: "relative", marginBottom: "12px" }}>
              <User size={16} style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
              <input value={whName} onChange={(e) => setWhName(e.target.value.replace(/[^\uAC00-\uD7A3\u3131-\u318E\s]/g, ""))} placeholder="반납자 성함 (반납 기록에 남습니다)" style={{ ...inputStyle, paddingLeft: "40px" }} />
            </div>
            <div style={{ position: "relative", marginBottom: "12px" }}>
              <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
              <input value={whSearch} onChange={(e) => setWhSearch(e.target.value)} placeholder="물품명 · 대여자 · 위치로 검색..." style={{ ...inputStyle, paddingLeft: "36px", padding: "11px 12px 11px 36px", fontSize: "14px" }} />
            </div>

            {whReturnLoading ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", padding: "48px 0", color: C.label }}><Spinner size={30} /> 대여 내역을 불러오는 중...</div>
            ) : whReturnItems.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 0", color: C.label, fontSize: "14px" }}>현재 대여 중인 일반 자재이 없습니다.</div>
            ) : (
              <>
                {(() => {
                  const q = whSearch.trim().toLowerCase();
                  const visible = whReturnItems
                    .map((item, idx) => ({ item, idx }))
                    .filter(({ item }) => {
                      if (!q) return true;
                      return String(item.name || "").toLowerCase().includes(q)
                        || String(item.borrowerName || "").toLowerCase().includes(q)
                        || String(item.location || "").toLowerCase().includes(q);
                    });
                  // 대여자별 그룹화 (시나리오 반납 화면과 동일한 UX)
                  const groupMap: Record<string, { item: any; idx: number }[]> = {};
                  const order: string[] = [];
                  visible.forEach((e) => {
                    const b = String(e.item.borrowerName || "(대여자 미상)");
                    if (!groupMap[b]) { groupMap[b] = []; order.push(b); }
                    groupMap[b].push(e);
                  });
                  return order.map((borrower) => {
                    const entries = groupMap[borrower];
                    const gKey = `wh|${borrower}`;
                    // 기본 접힘, 검색 중에는 자동 펼침. 직접 토글한 상태가 우선.
                    const isExp = expanded[gKey] ?? (q.length > 0);
                    const checkedCount = entries.filter(({ idx }) => whReturnSel[String(idx)] !== undefined).length;
                    const isAll = checkedCount === entries.length && entries.length > 0;
                    const isSome = checkedCount > 0 && !isAll;
                    const avatar = getAvatarColor(borrower);
                    const totalQty = entries.reduce((s, { item }) => s + (parseInt(String(item.quantity), 10) || 1), 0);
                    const toggleGroupSel = () => {
                      setWhReturnSel((p) => {
                        const n = { ...p };
                        entries.forEach(({ item, idx }) => {
                          const key = String(idx);
                          const maxQty = Math.max(1, parseInt(String(item.quantity), 10) || 1);
                          if (isAll) delete n[key]; else n[key] = n[key] ?? maxQty;
                        });
                        return n;
                      });
                    };
                    return (
                      <div key={gKey} style={{ marginBottom: "12px" }}>
                        <div
                          onClick={() => setExpanded((prev) => ({ ...prev, [gKey]: !isExp }))}
                          style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 14px", background: C.card, borderRadius: "14px", border: `1.5px solid ${isAll ? C.accent : C.border}`, boxShadow: "0 2px 12px rgba(0,0,0,0.02)", cursor: "pointer", userSelect: "none" }}
                        >
                          <div
                            onClick={(e) => { e.stopPropagation(); toggleGroupSel(); }}
                            style={{ width: 22, height: 22, borderRadius: "6px", border: `2px solid ${isAll || isSome ? C.accent : C.label}`, background: isAll ? C.accent : isSome ? C.accentSoft : C.card, boxShadow: isAll || isSome ? "none" : "inset 0 1px 2px rgba(0,0,0,0.06)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
                          >
                            {isAll ? <Check size={14} strokeWidth={3.5} style={{ color: "#ffffff" }} /> : null}
                            {isSome ? <div style={{ width: 10, height: 10, background: C.accent, borderRadius: "3px" }} /> : null}
                          </div>
                          <div style={{ width: 32, height: 32, borderRadius: "50%", background: avatar.bg, color: avatar.text, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "12px", flexShrink: 0 }}>
                            {borrower.slice(0, 1)}
                          </div>
                          <span style={{ fontWeight: 800, fontSize: "14px", color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 }}>{borrower}</span>
                          <span style={{ fontSize: "10px", fontWeight: 700, color: C.accentText, background: C.accentSoft, borderRadius: "8px", padding: "1px 6px", flexShrink: 0 }}>{totalQty}개</span>
                          {checkedCount > 0 ? (
                            <span style={{ fontSize: "10px", fontWeight: 700, color: C.success, background: C.successSoft, borderRadius: "8px", padding: "1px 6px", flexShrink: 0 }}>{checkedCount}건 선택됨</span>
                          ) : null}
                          <ChevronRight size={16} style={{ color: C.label, flexShrink: 0, transform: isExp ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s ease" }} />
                        </div>
                        {isExp ? (
                          <div style={{ paddingLeft: "12px", borderLeft: `1px dashed ${C.border}`, marginLeft: "16px", marginTop: "6px" }}>
                            {entries.map(({ item, idx }) => {
                  const key = String(idx);
                  const maxQty = Math.max(1, parseInt(String(item.quantity), 10) || 1);
                  const sel = whReturnSel[key];
                  const checked = sel !== undefined;
                  const { rack, slot } = parseRackSlot(item.location);
                  return (
                    <div key={key} onClick={() => setWhReturnSel((p) => { const n = { ...p }; if (checked) delete n[key]; else n[key] = maxQty; return n; })}
                      style={{ display: "flex", alignItems: "flex-start", gap: "10px", padding: "13px", border: `1px solid ${checked ? C.accent : C.border}`, background: checked ? C.accentSoft : "transparent", borderRadius: "12px", marginBottom: "8px", cursor: "pointer" }}>
                      <input type="checkbox" readOnly checked={checked} style={{ width: 20, height: 20, accentColor: C.accent, marginTop: "2px", flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: "13px" }}>{item.itemLabel || item.name}</div>
                        <div style={{ fontSize: "11px", color: C.label, marginTop: "2px" }}>
                          {item.borrowerName ? `대여자: ${item.borrowerName} · ` : ""}대여일: {item.borrowDate || "-"}
                        </div>
                        <div style={{ marginTop: "4px" }}>
                          {item.location ? <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", fontWeight: 700, color: C.warn, background: C.warnSoft, borderRadius: "8px", padding: "2px 8px", fontFamily: "monospace" }}><MapPin size={11} />{rack}랙 {slot}</span> : null}
                        </div>
                        {maxQty > 1 ? (
                          <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "8px" }}>
                            <span style={{ fontSize: "11px", color: C.label, fontWeight: 700 }}>반납 수량</span>
                            <button onClick={() => setWhReturnSel((p) => ({ ...p, [key]: Math.max(1, (p[key] ?? maxQty) - 1) }))} style={{ width: 26, height: 26, borderRadius: "7px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Minus size={12} /></button>
                            <span style={{ fontWeight: 700, minWidth: "18px", textAlign: "center", fontSize: "13px" }}>{sel ?? maxQty}</span>
                            <button onClick={() => setWhReturnSel((p) => ({ ...p, [key]: Math.min(maxQty, (p[key] ?? maxQty) + 1) }))} style={{ width: 26, height: 26, borderRadius: "7px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={12} /></button>
                            <span style={{ fontSize: "11px", color: C.label }}>/ 총 {maxQty}개</span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  });
                })()}
                <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
                  <button onClick={goPrev} style={secondaryBtn}>이전</button>
                  <button onClick={handleWarehouseReturn} disabled={Object.keys(whReturnSel).length === 0 || returnSubmitting} style={{ ...primaryBtn, opacity: Object.keys(whReturnSel).length === 0 || returnSubmitting ? 0.5 : 1 }}>
                    {returnSubmitting ? <><Spinner size={16} light /> 처리 중...</> : `반납 처리하기${Object.keys(whReturnSel).length ? ` (${Object.keys(whReturnSel).length}건)` : ""}`}
                  </button>
                </div>
              </>
            )}
            {whReturnItems.length === 0 ? (
              <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
                <button onClick={goPrev} style={secondaryBtn}>이전</button>
              </div>
            ) : null}
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

            {resultInfo.ok && resultInfo.receipt ? (
              <div style={{ maxWidth: "360px", margin: "24px auto 0", textAlign: "left", border: `1px solid ${C.border}`, borderRadius: "14px", background: C.card, overflow: "hidden" }}>
                <div style={{ padding: "12px 16px", borderBottom: `1px dashed ${C.border}`, background: C.cardSub, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "13px", fontWeight: 800 }}>📋 {resultInfo.receipt.action} 내역</span>
                  <span style={{ fontSize: "11px", color: C.label }}>{resultInfo.receipt.date}</span>
                </div>
                <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                    <span style={{ color: C.label }}>대여자</span><span style={{ fontWeight: 700 }}>{resultInfo.receipt.borrower}</span>
                  </div>
                  {resultInfo.receipt.due ? (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                      <span style={{ color: C.label }}>반납 예정일</span><span style={{ fontWeight: 700, color: C.accentText }}>{resultInfo.receipt.due}</span>
                    </div>
                  ) : null}
                </div>
                <div style={{ padding: "0 16px 12px" }}>
                  {resultInfo.receipt.items.map((it, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderTop: `1px solid ${C.border}`, fontSize: "12px" }}>
                      <span style={{ flex: 1, fontWeight: 600, wordBreak: "break-word" }}>{it.name}{it.location ? <span style={{ color: C.label, fontWeight: 400 }}> · {it.location}</span> : null}</span>
                      <span style={{ fontWeight: 800, marginLeft: "8px" }}>{it.qty}개</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div style={{ display: "flex", gap: "10px", marginTop: "32px", maxWidth: "320px", margin: "32px auto 0" }}>
              <button onClick={resetAll} style={secondaryBtn}>처음으로 돌아가기</button>
            </div>
          </div>
        ) : null}
        </div>
      </div>

      {/* 이미지 확대 모달 */}
      {imageModalUrl ? (
        <div
          onClick={() => setImageModalUrl("")}
          style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
        >
          <button onClick={() => setImageModalUrl("")} style={{ position: "absolute", top: "16px", right: "20px", background: "none", border: "none", color: "#fff", cursor: "pointer" }}><X size={32} /></button>
          <img src={imageModalUrl} alt="" style={{ maxWidth: "90%", maxHeight: "90%", borderRadius: "8px", objectFit: "contain", boxShadow: "0 4px 24px rgba(0,0,0,0.6)" }} onClick={(e) => e.stopPropagation()} />
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
  const src = getGoogleDriveImageUrl(url);
  const borderCol = C ? C.border : "#e6e9ef";
  const cardSubBg = C ? C.cardSub : "#f7f9fa";
  return (
    <div
      onClick={(e) => { e.stopPropagation(); setImageModalUrl(src); }}
      style={{ flex: `0 0 ${size}px`, width: size, height: size, borderRadius: "8px", overflow: "hidden", border: `1px solid ${borderCol}`, cursor: "zoom-in", background: cardSubBg, display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <img src={src} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "cover" }} />
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
  const chgQty = (id: string, delta: number) => {
    const orig = objectItems.find((x) => x.id === id);
    const stock = orig ? Number(orig.stock || 0) : 999;
    setList((prev: CartItem[]) => {
      const match = prev.find((x) => x.id === id);
      if (!match) return prev;
      const target = match.quantity + delta;
      if (target <= 0) {
        return prev.filter((x) => x.id !== id);
      }
      if (target > stock) {
        showToast(`최대 재고(${stock}개)까지만 선택 가능합니다.`, "warn");
        return prev;
      }
      return prev.map((x) => (x.id === id ? { ...x, quantity: target } : x));
    });
  };

  const remove = (id: string) => {
    setList((prev: CartItem[]) => prev.filter((x) => x.id !== id));
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
        return (
          <div key={it.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", background: C.cardSub, border: `1px solid ${C.border}`, borderRadius: "10px" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: "13px", color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.name}</div>
              <div style={{ fontSize: "11px", color: C.label, display: "flex", gap: "6px" }}>
                <span>ID: {it.id}</span>
                {orig?.rootSlot ? <span>• {padSlot(orig.rootSlot)}</span> : null}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <button onClick={() => chgQty(it.id, -1)} style={{ width: 28, height: 28, borderRadius: "8px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Minus size={13} /></button>
              <span style={{ fontWeight: 800, minWidth: "20px", textAlign: "center", fontSize: "13px" }}>{it.quantity}</span>
              <button onClick={() => chgQty(it.id, 1)} style={{ width: 28, height: 28, borderRadius: "8px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={13} /></button>
            </div>
            <button onClick={() => remove(it.id)} style={{ width: 28, height: 28, borderRadius: "8px", border: "none", background: C.errorSoft, color: C.error, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={13} /></button>
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
  C,
  isLightMode,
  objectItems,
  itemsLoaded,
  categories,
  subsOf,
  matchesFilters,
  showToast,
  setImageModalUrl,
}: {
  list: CartItem[];
  setList: (val: any) => void;
  search: string;
  setSearch: (v: string) => void;
  cat: string;
  setCat: (v: string) => void;
  sub: string;
  setSub: (v: string) => void;
  C: any;
  isLightMode: boolean;
  objectItems: any[];
  itemsLoaded: boolean;
  categories: string[];
  subsOf: (cat: string) => string[];
  matchesFilters: (it: any, query: string, c: string, s: string) => boolean;
  showToast: (msg: string, type?: string) => void;
  setImageModalUrl: (url: string) => void;
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

  const filtered = objectItems.filter((it) => matchesFilters(it, search, cat, sub));

  const toggleItem = (it: any) => {
    const inCart = list.some((x) => x.id === it.id);
    if (inCart) {
      setList((prev: CartItem[]) => prev.filter((x) => x.id !== it.id));
    } else {
      const stock = Number(it.stock || 0);
      if (stock <= 0) {
        showToast("재고가 없는 물품입니다.", "warn");
        return;
      }
      setList((prev: CartItem[]) => [...prev, { id: it.id, name: it.name, quantity: 1 }]);
    }
  };

  return (
    <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: "16px", padding: "14px", display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ position: "relative" }}>
        <Search size={14} style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="물품 ID 또는 물품명으로 검색..." style={inputStyle} />
      </div>

      <div style={{ display: "flex", gap: "8px" }}>
        <select value={cat} onChange={(e) => { setCat(e.target.value); setSub(""); }} style={selectStyle}>
          <option value="">대분류 (전체)</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={sub} onChange={(e) => setSub(e.target.value)} style={selectStyle} disabled={!cat || cat === "전체"}>
          <option value="">소분류 (전체)</option>
          {subsOf(cat).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {!itemsLoaded ? (
        <div style={{ display: "flex", justifySelf: "center", alignItems: "center", gap: "8px", padding: "32px 0", color: C.label, fontSize: "12px", justifyContent: "center" }}>
          <Spinner size={16} C={C} /> 물품 목록 로딩 중...
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "32px 0", color: C.label, fontSize: "12px" }}>조건에 맞는 물품이 없습니다.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "240px", overflowY: "auto", paddingRight: "2px" }}>
          {filtered.slice(0, 100).map((it) => {
            const inCart = list.some((x) => x.id === it.id);
            const stock = Number(it.stock || 0);
            const rented = Number(it.rented || 0);
            return (
              <div key={it.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px", background: C.card, border: `1px solid ${C.border}`, borderRadius: "10px" }}>
                <Thumb url={it.image} size={40} C={C} setImageModalUrl={setImageModalUrl} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 800, fontSize: "12px", color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.name}</span>
                    <span style={{ fontSize: "10px", color: C.label, fontFamily: "monospace" }}>({it.id})</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "2px" }}>
                    <LocBadge slot={it.rootSlot} C={C} />
                    <StockBadges stock={stock} rented={rented} C={C} />
                  </div>
                </div>
                <button onClick={() => toggleItem(it)} style={itemBtnStyle(inCart)}>
                  {inCart ? "취소" : "선택"}
                </button>
              </div>
            );
          })}
        </div>
      )}
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
  selectedReturn: Record<string, boolean>;
  keyOf: (it: any) => string;
  C: any;
}) {
  const itemKeys = items.map(keyOf);
  const checkedCount = itemKeys.filter((k) => !!selectedReturn[k]).length;
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
  selectedReturn: Record<string, boolean>;
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
  const checkedCount = itemKeys.filter((k) => !!selectedReturn[k]).length;
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
  selectedReturn: Record<string, boolean>;
  setSelectedReturn: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  toggleReturnKeys: (items: any[], force: boolean) => void;
  C: any;
  keyOf: (it: any) => string;
  setImageModalUrl: (url: string) => void;
}) {
  const k = keyOf(item);
  const isSel = !!selectedReturn[k];

  const handleToggle = () => {
    setSelectedReturn((prev) => {
      const next = { ...prev };
      if (next[k]) {
        delete next[k];
      } else {
        next[k] = true;
      }
      return next;
    });
  };

  return (
    <div
      onClick={handleToggle}
      style={{
        display: "flex",
        alignItems: "center",
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
      <div style={{ flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
        <GroupCheckbox gKey={k} items={[item]} toggleReturnKeys={toggleReturnKeys} selectedReturn={selectedReturn} keyOf={keyOf} C={C} />
      </div>
      <Thumb url={item.image} size={40} C={C} setImageModalUrl={setImageModalUrl} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: "13px", color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {item.name}
        </div>
        <div style={{ display: "flex", gap: "6px", fontSize: "11px", color: C.label, marginTop: "2px", alignItems: "center" }}>
          <span>{item.id}</span>
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
      </div>
    </div>
  );
}
