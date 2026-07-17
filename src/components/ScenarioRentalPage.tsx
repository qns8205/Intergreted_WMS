import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  ArrowLeft,
  Search,
  Plus,
  X,
  Fingerprint,
  Package,
  Boxes,
  Undo2,
  UserSearch,
  Minus,
  Check,
  MapPin,
  Loader2,
} from "lucide-react";
import { isFuzzyMatch } from "../utils/drive";

/* ============================================================
   타입
   ============================================================ */
interface ScenarioObjectItem {
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

interface ScenarioDefinition {
  sid: string;
  found: boolean;
  syncNeeded: boolean;
  blocked: boolean;
  blockReason: string;
  highLevelEn: string;
  highLevelKo: string;
  items: {
    id: string;
    name: string;
    quantity: number;
    rootSlot?: string;
    category?: string;
    subcategory?: string;
    image?: string;
    stock?: number;
    rented?: number;
  }[];
}

interface CartItem {
  id: string;
  name: string;
  quantity: number;
}

interface SidCartEntry {
  sid: string;
  loading: boolean;
  scenario: ScenarioDefinition | null;
}

interface UnreturnedItem {
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

type Affiliation = "cfgw" | "configds" | "other";
type Mode = "menu" | "borrow" | "return" | "mylookup" | "sidlookup";
type BorrowType = "scenario" | "general";

interface ScenarioRentalPageProps {
  scriptUrl: string;
  connected: boolean;
  isLightMode: boolean;
  onBack: () => void;
  showToast: (msg: string, type: "ok" | "error" | "info" | "warn") => void;
}

/* ============================================================
   위치 정렬 밴드 — 서버(Code.gs)의 LOCATION_SORT_BANDS_와 동일하게 유지할 것
   ============================================================ */
const LOCATION_SORT_BANDS = [
  { start: 186, end: 251, dir: "asc" as const },
  { start: 120, end: 185, dir: "desc" as const },
  { start: 60, end: 119, dir: "asc" as const },
  { start: 0, end: 59, dir: "desc" as const },
  { start: 100000, end: 100025, dir: "asc" as const },
];

function computeLocationSortIndex(rootSlot: string | number | null | undefined): number {
  const n = parseInt(String(rootSlot ?? "").replace(/\D/g, ""), 10);
  if (isNaN(n)) return Number.MAX_SAFE_INTEGER;
  let offset = 0;
  for (const b of LOCATION_SORT_BANDS) {
    const size = b.end - b.start + 1;
    if (n >= b.start && n <= b.end) return offset + (b.dir === "asc" ? n - b.start : b.end - n);
    offset += size;
  }
  return offset + n;
}

function padSlot(raw: string | number | null | undefined): string {
  const s = String(raw ?? "").trim().replace(/\D/g, "");
  if (!s) return String(raw ?? "").trim();
  return s.length < 6 ? s.padStart(6, "0") : s;
}

/* ============================================================
   메인 컴포넌트
   ============================================================ */
export default function ScenarioRentalPage({
  scriptUrl,
  connected,
  isLightMode,
  onBack,
  showToast,
}: ScenarioRentalPageProps) {
  const [mode, setMode] = useState<Mode>("menu");
  const [appVersion, setAppVersion] = useState<string>("");

  // 신청인 정보
  const [borrowerName, setBorrowerName] = useState("");
  const [affiliation, setAffiliation] = useState<Affiliation>("cfgw");
  const [employeeId, setEmployeeId] = useState("");
  const [otherName, setOtherName] = useState("");

  // 대여 유형/물품
  const [borrowType, setBorrowType] = useState<BorrowType>("scenario");
  const [objectItems, setObjectItems] = useState<ScenarioObjectItem[]>([]);
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]); // 일반 대여
  const [reqCart, setReqCart] = useState<CartItem[]>([]); // 추가 물품(시나리오)
  const [sidCart, setSidCart] = useState<SidCartEntry[]>([]);
  const [sidInput, setSidInput] = useState("");
  const [generalOption, setGeneralOption] = useState("추가 물품 대여");
  const [borrowPurpose, setBorrowPurpose] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 반납
  const [unreturned, setUnreturned] = useState<UnreturnedItem[]>([]);
  const [unreturnedLoading, setUnreturnedLoading] = useState(false);
  const [returnSelected, setReturnSelected] = useState<Record<string, number>>({});
  const [returnSearch, setReturnSearch] = useState("");
  const [returnSubmitting, setReturnSubmitting] = useState(false);

  // 내 대여 조회
  const [myLookupName, setMyLookupName] = useState("");
  const [myLookupAff, setMyLookupAff] = useState<Affiliation>("cfgw");
  const [myLookupEmpId, setMyLookupEmpId] = useState("");
  const [myLookupResult, setMyLookupResult] = useState<UnreturnedItem[] | null>(null);
  const [myLookupLoading, setMyLookupLoading] = useState(false);

  // SID 검색
  const [sidLookupInput, setSidLookupInput] = useState("");
  const [sidLookupResult, setSidLookupResult] = useState<ScenarioDefinition | null>(null);
  const [sidLookupLoading, setSidLookupLoading] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  /* ---------------- GAS 통신 (App.tsx의 callScript와 동일 패턴) ---------------- */
  const callGas = useCallback(
    async (action: string, payload: any = {}) => {
      if (!scriptUrl) throw new Error("구글 스프레드시트 연동 URL이 설정되지 않았습니다.");
      const res = await fetch(scriptUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action, payload }),
      });
      const text = await res.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error("서버 응답을 해석할 수 없습니다. 배포 URL/버전을 확인해주세요.");
      }
      if (!data.success) throw new Error(data.error || data.message || "요청 실패");
      return data;
    },
    [scriptUrl]
  );

  // 버전 확인 (최초 1회)
  useEffect(() => {
    if (!connected) return;
    callGas("borrow_getVersion")
      .then((data) => setAppVersion(data.version?.current || ""))
      .catch(() => {});
  }, [connected, callGas]);

  const ensureItemsLoaded = useCallback(async () => {
    if (itemsLoaded || itemsLoading) return;
    setItemsLoading(true);
    try {
      const data = await callGas("borrow_getObjects");
      setObjectItems(data.items || []);
      setItemsLoaded(true);
    } catch (e: any) {
      showToast("물품 목록을 불러오지 못했습니다: " + e.message, "error");
    } finally {
      setItemsLoading(false);
    }
  }, [itemsLoaded, itemsLoading, callGas, showToast]);

  const colors = {
    bg: isLightMode ? "#f8fafc" : "#0b0f19",
    text: isLightMode ? "#0f172a" : "#f1f5f9",
    sub: isLightMode ? "#64748b" : "#94a3b8",
    card: isLightMode ? "#ffffff" : "#151d30",
    border: isLightMode ? "#e2e8f0" : "#222f4b",
    inputBg: isLightMode ? "#f8fafc" : "#0f172a",
    primary: "#4f46e5",
    primaryLight: isLightMode ? "rgba(79,70,229,0.08)" : "rgba(99,102,241,0.15)",
    success: "#10b981",
    warn: "#f59e0b",
    danger: "#ef4444",
  };

  /* ---------------- 공통 스타일 헬퍼 ---------------- */
  const cardStyle: React.CSSProperties = {
    background: colors.card,
    border: `1px solid ${colors.border}`,
    borderRadius: 20,
    padding: 24,
    boxShadow: "0 10px 25px -5px rgba(0,0,0,0.05)",
  };
  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "12px 14px",
    borderRadius: 12,
    border: `1.5px solid ${colors.border}`,
    background: colors.inputBg,
    color: colors.text,
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 700,
    color: colors.sub,
    marginBottom: 6,
    display: "block",
  };
  function primaryBtn(disabled?: boolean): React.CSSProperties {
    return {
      background: disabled ? colors.border : colors.primary,
      color: "#fff",
      border: "none",
      borderRadius: 12,
      padding: "13px 20px",
      fontSize: 14,
      fontWeight: 700,
      cursor: disabled ? "not-allowed" : "pointer",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    };
  }
  const secondaryBtn: React.CSSProperties = {
    background: isLightMode ? "#f1f5f9" : "#1e293b",
    color: colors.sub,
    border: "none",
    borderRadius: 12,
    padding: "13px 20px",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
  };
  const pillGroup: React.CSSProperties = {
    display: "flex",
    gap: 8,
    background: isLightMode ? "#f1f5f9" : "#0f172a",
    padding: 4,
    borderRadius: 12,
  };
  function pillBtn(active: boolean): React.CSSProperties {
    return {
      flex: 1,
      padding: "10px",
      borderRadius: 9,
      fontSize: 13,
      fontWeight: 700,
      border: "none",
      cursor: "pointer",
      background: active ? colors.primary : "transparent",
      color: active ? "#fff" : colors.sub,
    };
  }

  /* ============================================================
     대여 신청 로직
     ============================================================ */
  function toggleCartItem(item: ScenarioObjectItem, target: "cart" | "reqCart") {
    const setter = target === "cart" ? setCart : setReqCart;
    const list = target === "cart" ? cart : reqCart;
    const idx = list.findIndex((c) => c.id === item.id);
    if (idx === -1) {
      if ((item.stock || 0) < 1) {
        showToast("재고가 부족하여 대여할 수 없습니다.", "warn");
        return;
      }
      setter([...list, { id: item.id, name: item.name, quantity: 1 }]);
    } else {
      setter(list.filter((c) => c.id !== item.id));
    }
  }

  function changeQty(target: "cart" | "reqCart", id: string, delta: number) {
    const setter = target === "cart" ? setCart : setReqCart;
    const list = target === "cart" ? cart : reqCart;
    const objItem = objectItems.find((o) => o.id === id);
    const maxStock = objItem?.stock || 0;
    setter(
      list.map((c) => {
        if (c.id !== id) return c;
        let q = c.quantity + delta;
        if (q < 1) q = 1;
        if (q > maxStock) {
          showToast(`재고가 부족합니다. (최대 ${maxStock}개)`, "warn");
          q = maxStock;
        }
        return { ...c, quantity: q };
      })
    );
  }

  async function addSid() {
    const val = sidInput.trim().toUpperCase();
    if (!val) return;
    if (!/^[SL]\d+$/i.test(val)) {
      showToast("시나리오 ID 형식이 유효하지 않습니다. 예: S1234, L1234", "warn");
      return;
    }
    if (sidCart.some((s) => s.sid === val)) {
      showToast("이미 추가된 SID입니다: " + val, "warn");
      return;
    }
    setSidInput("");
    setSidCart((prev) => [...prev, { sid: val, loading: true, scenario: null }]);
    try {
      const data = await callGas("borrow_getScenarioInfo", { sid: val });
      setSidCart((prev) =>
        prev.map((e) => (e.sid === val ? { ...e, loading: false, scenario: data.definition } : e))
      );
      if (data.definition?.blocked) {
        showToast(data.definition.blockReason || "사용할 수 없는 SID입니다.", "error");
      }
    } catch (e: any) {
      setSidCart((prev) =>
        prev.map((e) =>
          e.sid === val
            ? { ...e, loading: false, scenario: { sid: val, found: false, syncNeeded: true, blocked: false, blockReason: "", highLevelEn: "", highLevelKo: "", items: [] } }
            : e
        )
      );
      showToast("SID 조회 중 오류: " + e.message, "error");
    }
  }

  function removeSid(sid: string) {
    setSidCart((prev) => prev.filter((e) => e.sid !== sid));
  }

  const stockErrorFor = useMemo(() => {
    // 총 요청 수량이 재고를 초과하는지 클라이언트단 사전 검증 (서버가 최종 검증하지만 UX상 미리 안내)
    const totals: Record<string, { name: string; qty: number }> = {};
    if (borrowType === "general") {
      cart.forEach((c) => {
        totals[c.id] = { name: c.name, qty: (totals[c.id]?.qty || 0) + c.quantity };
      });
    } else {
      sidCart.forEach((entry) => {
        (entry.scenario?.items || []).forEach((it) => {
          totals[it.id] = { name: it.name, qty: (totals[it.id]?.qty || 0) + (it.quantity || 1) };
        });
      });
      reqCart.forEach((c) => {
        totals[c.id] = { name: c.name, qty: (totals[c.id]?.qty || 0) + c.quantity };
      });
    }
    for (const id in totals) {
      const obj = objectItems.find((o) => o.id === id);
      const stock = obj?.stock || 0;
      if (totals[id].qty > stock) {
        return `'${totals[id].name}' 요청 수량(${totals[id].qty}개)이 재고(${stock}개)를 초과합니다.`;
      }
    }
    return null;
  }, [borrowType, cart, reqCart, sidCart, objectItems]);

  function resolveBorrowerName() {
    return affiliation === "other" ? otherName.trim() : borrowerName.trim();
  }

  async function submitBorrow() {
    const name = resolveBorrowerName();
    if (!name) {
      showToast("성함을 입력해주세요.", "warn");
      return;
    }
    if (affiliation === "cfgw" && !/^\d+$/.test(employeeId.trim())) {
      showToast("사번은 숫자만 입력해주세요.", "warn");
      return;
    }
    if (borrowType === "general" && cart.length === 0) {
      showToast("물품을 하나 이상 선택해주세요.", "warn");
      return;
    }
    if (borrowType === "scenario" && sidCart.length === 0) {
      showToast("시나리오 ID를 하나 이상 추가해주세요.", "warn");
      return;
    }
    if (stockErrorFor) {
      showToast(stockErrorFor, "error");
      return;
    }

    setSubmitting(true);
    try {
      // ConfigDS 소속 검증
      if (affiliation === "configds") {
        const v = await callGas("borrow_verifyUser", { affiliation, borrowerName: name });
        if (!v.valid) {
          showToast(v.message || "'ConfigDS계정' 시트에 등록되지 않은 이름입니다.", "error");
          setSubmitting(false);
          return;
        }
      }

      const nowStr = new Date().toISOString().slice(0, 19).replace("T", " ");
      const additionalItems = reqCart.map((c) => ({ id: c.id, name: c.name, quantity: c.quantity }));

      let borrowList: any[] = [];
      if (borrowType === "general") {
        borrowList = [
          {
            itemType: "general",
            borrowerName: name,
            affiliation,
            employeeId: employeeId.trim(),
            borrowedItems: cart.map((c) => ({ id: c.id, name: c.name, quantity: c.quantity })),
            generalOption,
            borrowDate: nowStr,
            borrowPurpose,
          },
        ];
      } else {
        borrowList = sidCart.map((entry) => ({
          itemType: "scenario",
          borrowerName: name,
          affiliation,
          employeeId: employeeId.trim(),
          scenarioId: entry.sid,
          requiredObjects: entry.scenario?.items || [],
          additionalItems, // 서버가 배치당 1회만 기록하도록 중복 제거 처리함
          syncNeeded: !!entry.scenario?.syncNeeded,
          borrowDate: nowStr,
          borrowPurpose,
        }));
      }

      const result = await callGas("borrow_submitBorrow", { borrowList, clientVersion: appVersion });
      showToast(result.message || "대여 신청이 접수되었습니다.", "ok");
      resetBorrowForm();
      setMode("menu");
    } catch (e: any) {
      showToast("대여 신청 실패: " + e.message, "error");
    } finally {
      setSubmitting(false);
    }
  }

  function resetBorrowForm() {
    setCart([]);
    setReqCart([]);
    setSidCart([]);
    setSidInput("");
    setBorrowerName("");
    setOtherName("");
    setEmployeeId("");
    setBorrowPurpose("");
    setItemSearch("");
  }

  /* ============================================================
     반납 처리
     ============================================================ */
  async function loadUnreturned() {
    setUnreturnedLoading(true);
    setReturnSelected({});
    try {
      const data = await callGas("borrow_getUnreturned");
      setUnreturned(data.items || []);
    } catch (e: any) {
      showToast("미반납 목록 조회 실패: " + e.message, "error");
    } finally {
      setUnreturnedLoading(false);
    }
  }

  function returnKey(it: UnreturnedItem) {
    return `${it.sheetType}:${it.rowIndex}`;
  }

  function toggleReturnItem(it: UnreturnedItem) {
    const key = returnKey(it);
    setReturnSelected((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = it.quantity;
      return next;
    });
  }

  async function submitReturn() {
    const keys = Object.keys(returnSelected);
    if (keys.length === 0) return;
    setReturnSubmitting(true);
    try {
      const returnRequests = keys.map((k) => {
        const [sheetType, rowIndex] = k.split(":");
        return { sheetType, rowIndex: parseInt(rowIndex, 10), quantity: returnSelected[k] };
      });
      const result = await callGas("borrow_submitReturn", { returnRequests, clientVersion: appVersion });
      showToast(result.message || "반납 처리가 완료되었습니다.", "ok");
      setReturnSelected({});
      loadUnreturned();
    } catch (e: any) {
      showToast("반납 처리 실패: " + e.message, "error");
    } finally {
      setReturnSubmitting(false);
    }
  }

  const filteredReturnGroups = useMemo(() => {
    const q = returnSearch.trim();
    const filtered = q
      ? unreturned.filter(
          (it) =>
            isFuzzyMatch(it.borrowerName || "", q) ||
            isFuzzyMatch(it.itemLabel || "", q) ||
            isFuzzyMatch(padSlot(it.location), q)
        )
      : unreturned;
    const sorted = [...filtered].sort(
      (a, b) => computeLocationSortIndex(a.location) - computeLocationSortIndex(b.location)
    );
    const groups: Record<string, UnreturnedItem[]> = {};
    const order: string[] = [];
    sorted.forEach((it) => {
      const key = it.borrowerName || "(이름 없음)";
      if (!groups[key]) {
        groups[key] = [];
        order.push(key);
      }
      groups[key].push(it);
    });
    return order.map((k) => ({ borrower: k, items: groups[k] }));
  }, [unreturned, returnSearch]);

  /* ============================================================
     내 대여 조회
     ============================================================ */
  async function runMyLookup() {
    const name = myLookupName.trim();
    if (!name) {
      showToast("성함을 입력해주세요.", "warn");
      return;
    }
    let empId = "";
    if (myLookupAff === "cfgw") {
      empId = myLookupEmpId.trim();
      if (!/^\d+$/.test(empId)) {
        showToast("사번은 숫자만 입력해주세요.", "warn");
        return;
      }
    }
    setMyLookupLoading(true);
    try {
      const data = await callGas("borrow_getMyRentals", { borrowerName: name, employeeId: empId });
      setMyLookupResult(data.items || []);
    } catch (e: any) {
      showToast("조회 실패: " + e.message, "error");
    } finally {
      setMyLookupLoading(false);
    }
  }

  /* ============================================================
     SID 검색
     ============================================================ */
  async function runSidLookup() {
    const sid = sidLookupInput.trim().toUpperCase();
    if (!/^[SL]\d+$/i.test(sid)) {
      showToast("시나리오 ID 형식이 유효하지 않습니다. 예: S1234, L1234", "warn");
      return;
    }
    setSidLookupLoading(true);
    setSidLookupResult(null);
    try {
      const data = await callGas("borrow_getScenarioInfo", { sid });
      setSidLookupResult(data.definition);
    } catch (e: any) {
      showToast("SID 검색 실패: " + e.message, "error");
    } finally {
      setSidLookupLoading(false);
    }
  }

  /* ============================================================
     화면별 렌더
     ============================================================ */
  const filteredObjectItems = useMemo(() => {
    if (!itemSearch.trim()) return objectItems;
    return objectItems.filter(
      (it) =>
        isFuzzyMatch(it.name, itemSearch) ||
        it.id.includes(itemSearch) ||
        isFuzzyMatch(padSlot(it.rootSlot), itemSearch) ||
        isFuzzyMatch(it.category || "", itemSearch)
    );
  }, [objectItems, itemSearch]);

  function Header({ title }: { title: string }) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <button
          onClick={() => (mode === "menu" ? onBack() : setMode("menu"))}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: colors.card,
            border: `1px solid ${colors.border}`,
            color: colors.sub,
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
            padding: "10px 14px",
            borderRadius: 12,
          }}
        >
          <ArrowLeft size={16} />
          {mode === "menu" ? "처음 화면으로" : "메뉴로"}
        </button>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: colors.text, margin: 0 }}>{title}</h2>
      </div>
    );
  }

  function ItemPickerList({ target }: { target: "cart" | "reqCart" }) {
    const currentCart = target === "cart" ? cart : reqCart;
    if (itemsLoading) {
      return (
        <div style={{ padding: 30, textAlign: "center", color: colors.sub, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <Loader2 size={22} className="animate-spin" />
          물품 목록을 불러오는 중...
        </div>
      );
    }
    if (filteredObjectItems.length === 0) {
      return <div style={{ padding: 30, textAlign: "center", color: colors.sub }}>검색 결과가 없습니다.</div>;
    }
    return (
      <div style={{ maxHeight: 300, overflowY: "auto", border: `1px solid ${colors.border}`, borderRadius: 12 }}>
        {filteredObjectItems.map((it) => {
          const inCart = currentCart.some((c) => c.id === it.id);
          return (
            <div
              key={it.id}
              onClick={() => toggleCartItem(it, target)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderBottom: `1px solid ${colors.border}`,
                cursor: "pointer",
                background: inCart ? colors.primaryLight : "transparent",
              }}
            >
              <input type="checkbox" checked={inCart} readOnly style={{ accentColor: colors.primary }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: colors.text }}>{it.name}</div>
                <div style={{ fontSize: 11, color: colors.sub }}>ID: {it.id}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                  {it.rootSlot && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: colors.warn, background: "rgba(245,158,11,0.12)", borderRadius: 6, padding: "1px 6px", fontFamily: "monospace" }}>
                      <MapPin size={10} style={{ display: "inline", marginRight: 2, verticalAlign: -1 }} />
                      {padSlot(it.rootSlot)}
                    </span>
                  )}
                  <span style={{ fontSize: 11, fontWeight: 700, color: colors.success, background: "rgba(16,185,129,0.12)", borderRadius: 6, padding: "1px 6px" }}>
                    재고 {it.stock ?? 0}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  function CartList({ target }: { target: "cart" | "reqCart" }) {
    const list = target === "cart" ? cart : reqCart;
    if (list.length === 0) {
      return <div style={{ fontSize: 12, color: colors.sub, textAlign: "center", padding: "10px 0" }}>선택된 물품이 없습니다.</div>;
    }
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {list.map((c) => (
          <div
            key={c.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              background: colors.primaryLight,
              border: `1px solid ${colors.border}`,
              borderRadius: 10,
              fontSize: 13,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: colors.text }}>{c.name}</div>
              <div style={{ fontSize: 11, color: colors.sub }}>ID: {c.id}</div>
            </div>
            <button onClick={() => changeQty(target, c.id, -1)} style={qtyBtnStyle}>
              <Minus size={12} />
            </button>
            <span style={{ minWidth: 18, textAlign: "center", fontWeight: 700 }}>{c.quantity}</span>
            <button onClick={() => changeQty(target, c.id, 1)} style={qtyBtnStyle}>
              <Plus size={12} />
            </button>
            <button
              onClick={() => (target === "cart" ? setCart(cart.filter((x) => x.id !== c.id)) : setReqCart(reqCart.filter((x) => x.id !== c.id)))}
              style={{ ...qtyBtnStyle, background: "rgba(239,68,68,0.12)", color: colors.danger }}
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    );
  }

  const qtyBtnStyle: React.CSSProperties = {
    width: 26,
    height: 26,
    border: "none",
    borderRadius: 7,
    background: isLightMode ? "#fff" : "#0f172a",
    color: colors.text,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  /* ---------------- 메뉴 ---------------- */
  function MenuScreen() {
    const items: { key: Mode; icon: React.ReactNode; title: string; sub: string; color: string }[] = [
      { key: "borrow", icon: <Package size={20} />, title: "대여 신청", sub: "시나리오 물품을 새로 대여 신청합니다", color: colors.primary },
      { key: "mylookup", icon: <UserSearch size={20} />, title: "내 대여 조회", sub: "내가 빌린 물품과 위치를 확인합니다", color: "#0ea5e9" },
      { key: "return", icon: <Undo2 size={20} />, title: "반납 처리", sub: "대여 중인 물품을 반납 처리합니다", color: colors.success },
      { key: "sidlookup", icon: <Fingerprint size={20} />, title: "SID 검색", sub: "시나리오 ID로 필요 물품을 확인합니다", color: colors.warn },
    ];
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map((it) => (
          <div
            key={it.key}
            onClick={() => {
              setMode(it.key);
              if (it.key === "return") loadUnreturned();
              if (it.key === "borrow") ensureItemsLoaded();
            }}
            style={{
              ...cardStyle,
              padding: 20,
              display: "flex",
              alignItems: "center",
              gap: 16,
              cursor: "pointer",
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                background: `${it.color}1f`,
                color: it.color,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {it.icon}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: colors.text }}>{it.title}</div>
              <div style={{ fontSize: 12, color: colors.sub, marginTop: 2 }}>{it.sub}</div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  /* ---------------- 대여 신청 화면 ---------------- */
  function BorrowScreen() {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={cardStyle}>
          <label style={labelStyle}>소속</label>
          <div style={pillGroup}>
            {(["cfgw", "configds", "other"] as Affiliation[]).map((a) => (
              <button key={a} style={pillBtn(affiliation === a)} onClick={() => setAffiliation(a)}>
                {a === "cfgw" ? "Cfgw-kr" : a === "configds" ? "ConfigDS" : "기타"}
              </button>
            ))}
          </div>

          <div style={{ height: 14 }} />
          {affiliation === "other" ? (
            <>
              <label style={labelStyle}>이름</label>
              <input style={inputStyle} value={otherName} onChange={(e) => setOtherName(e.target.value)} placeholder="성함을 입력해주세요" />
            </>
          ) : (
            <>
              <label style={labelStyle}>신청인 성함 (한글)</label>
              <input
                style={inputStyle}
                value={borrowerName}
                onChange={(e) => setBorrowerName(e.target.value.replace(/[^\uAC00-\uD7A3\u3131-\u318E\s]/g, ""))}
                placeholder="성함을 입력해주세요"
              />
              {affiliation === "cfgw" && (
                <>
                  <div style={{ height: 12 }} />
                  <label style={labelStyle}>사번</label>
                  <input
                    style={inputStyle}
                    value={employeeId}
                    onChange={(e) => setEmployeeId(e.target.value.replace(/\D/g, ""))}
                    placeholder="숫자만 입력"
                    inputMode="numeric"
                  />
                </>
              )}
            </>
          )}
        </div>

        <div style={cardStyle}>
          <label style={labelStyle}>대여 유형</label>
          <div style={pillGroup}>
            <button style={pillBtn(borrowType === "scenario")} onClick={() => setBorrowType("scenario")}>
              <Fingerprint size={14} style={{ display: "inline", marginRight: 6, verticalAlign: -2 }} />
              SID 기반 대여
            </button>
            <button style={pillBtn(borrowType === "general")} onClick={() => setBorrowType("general")}>
              <Boxes size={14} style={{ display: "inline", marginRight: 6, verticalAlign: -2 }} />
              일반 대여
            </button>
          </div>
        </div>

        {borrowType === "scenario" ? (
          <>
            <div style={cardStyle}>
              <label style={labelStyle}>시나리오 ID 추가</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  style={inputStyle}
                  value={sidInput}
                  onChange={(e) => setSidInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addSid()}
                  placeholder="예: S1234 또는 L1234"
                />
                <button style={primaryBtn()} onClick={addSid}>
                  <Plus size={14} /> 추가
                </button>
              </div>
              {sidCart.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
                  {sidCart.map((entry) => (
                    <div key={entry.sid} style={{ border: `1px solid ${colors.border}`, borderRadius: 12, padding: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ fontWeight: 800, color: colors.primary, fontSize: 14 }}>
                          <Fingerprint size={14} style={{ display: "inline", marginRight: 6, verticalAlign: -2 }} />
                          {entry.sid}
                        </div>
                        <button onClick={() => removeSid(entry.sid)} style={{ ...qtyBtnStyle, background: "rgba(239,68,68,0.12)", color: colors.danger }}>
                          <X size={12} />
                        </button>
                      </div>
                      {entry.loading ? (
                        <div style={{ fontSize: 12, color: colors.sub, marginTop: 6 }}>필요 물품을 불러오는 중…</div>
                      ) : entry.scenario?.blocked ? (
                        <div style={{ fontSize: 12, color: colors.danger, marginTop: 6 }}>{entry.scenario.blockReason}</div>
                      ) : entry.scenario?.syncNeeded ? (
                        <div style={{ fontSize: 12, color: colors.warn, marginTop: 6 }}>동기화가 필요한 SID입니다. 대여는 계속할 수 있습니다.</div>
                      ) : (
                        <div style={{ fontSize: 12, color: colors.sub, marginTop: 6 }}>
                          {(entry.scenario?.items || []).map((it) => (
                            <div key={it.id}>
                              • {it.name} ({it.id}) x {it.quantity || 1}
                              {it.rootSlot && (
                                <span style={{ color: colors.warn, fontFamily: "monospace", fontWeight: 700, marginLeft: 6 }}>
                                  {padSlot(it.rootSlot)}
                                </span>
                              )}
                            </div>
                          ))}
                          {(!entry.scenario?.items || entry.scenario.items.length === 0) && "필요 물품이 없습니다."}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={cardStyle}>
              <label style={labelStyle}>추가 물품 (선택)</label>
              <div style={{ marginBottom: 10 }}>
                <CartList target="reqCart" />
              </div>
              <div style={{ position: "relative", marginBottom: 10 }}>
                <Search size={14} style={{ position: "absolute", left: 12, top: 13, color: colors.sub }} />
                <input
                  style={{ ...inputStyle, paddingLeft: 34 }}
                  value={itemSearch}
                  onChange={(e) => setItemSearch(e.target.value)}
                  placeholder="ID · 물품명 · 위치로 검색"
                />
              </div>
              <ItemPickerList target="reqCart" />
            </div>
          </>
        ) : (
          <div style={cardStyle}>
            <label style={labelStyle}>대여 구분</label>
            <div style={pillGroup}>
              {["추가 물품 대여", "Light Scenario", "Wild Scenario"].map((opt) => (
                <button key={opt} style={pillBtn(generalOption === opt)} onClick={() => setGeneralOption(opt)}>
                  {opt}
                </button>
              ))}
            </div>
            <div style={{ height: 14 }} />
            <label style={labelStyle}>선택된 물품</label>
            <div style={{ marginBottom: 10 }}>
              <CartList target="cart" />
            </div>
            <div style={{ position: "relative", marginBottom: 10 }}>
              <Search size={14} style={{ position: "absolute", left: 12, top: 13, color: colors.sub }} />
              <input
                style={{ ...inputStyle, paddingLeft: 34 }}
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                placeholder="ID · 물품명 · 위치로 검색"
              />
            </div>
            <ItemPickerList target="cart" />
          </div>
        )}

        <div style={cardStyle}>
          <label style={labelStyle}>대여 목적</label>
          <textarea
            style={{ ...inputStyle, minHeight: 80, resize: "none", fontFamily: "inherit" }}
            value={borrowPurpose}
            onChange={(e) => setBorrowPurpose(e.target.value)}
            placeholder="간략한 대여 목적을 적어주세요"
          />
        </div>

        {stockErrorFor && (
          <div style={{ color: colors.danger, fontSize: 13, fontWeight: 700, background: "rgba(239,68,68,0.08)", padding: 12, borderRadius: 10 }}>
            {stockErrorFor}
          </div>
        )}

        <button style={primaryBtn(submitting)} disabled={submitting} onClick={submitBorrow}>
          {submitting ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
          {submitting ? "신청 중..." : "대여 신청하기"}
        </button>
      </div>
    );
  }

  /* ---------------- 반납 화면 ---------------- */
  function ReturnScreen() {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ position: "relative" }}>
          <Search size={14} style={{ position: "absolute", left: 12, top: 13, color: colors.sub }} />
          <input
            style={{ ...inputStyle, paddingLeft: 34 }}
            value={returnSearch}
            onChange={(e) => setReturnSearch(e.target.value)}
            placeholder="대여자 · 물품명 · 위치로 검색"
          />
        </div>

        {unreturnedLoading ? (
          <div style={{ padding: 40, textAlign: "center", color: colors.sub }}>
            <Loader2 size={22} className="animate-spin" />
            <div style={{ marginTop: 8 }}>미반납 목록을 불러오는 중...</div>
          </div>
        ) : filteredReturnGroups.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: colors.sub }}>현재 미반납된 물품이 없습니다.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {filteredReturnGroups.map((g) => (
              <div key={g.borrower} style={cardStyle}>
                <div style={{ fontWeight: 800, fontSize: 14, color: colors.text, marginBottom: 10 }}>{g.borrower}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {g.items.map((it) => {
                    const key = returnKey(it);
                    const checked = !!returnSelected[key];
                    return (
                      <div
                        key={key}
                        onClick={() => toggleReturnItem(it)}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 10,
                          padding: 12,
                          border: `1.5px solid ${checked ? colors.primary : colors.border}`,
                          background: checked ? colors.primaryLight : "transparent",
                          borderRadius: 12,
                          cursor: "pointer",
                        }}
                      >
                        <input type="checkbox" checked={checked} readOnly style={{ marginTop: 2, accentColor: colors.primary }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: 13, color: colors.text }}>
                            {it.scenarioId && (
                              <span style={{ fontSize: 10, fontWeight: 700, background: "rgba(16,185,129,0.14)", color: "#1a9c56", borderRadius: 6, padding: "1px 6px", marginRight: 6 }}>
                                {it.scenarioId}
                              </span>
                            )}
                            {it.itemLabel}
                          </div>
                          <div style={{ fontSize: 11, color: colors.sub, marginTop: 2 }}>
                            대여일: {it.borrowDate} {it.borrowPurpose ? `· ${it.borrowPurpose}` : ""}
                          </div>
                          {it.location && (
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                fontSize: 11,
                                fontWeight: 700,
                                color: colors.warn,
                                background: "rgba(245,158,11,0.12)",
                                borderRadius: 8,
                                padding: "2px 8px",
                                marginTop: 6,
                                fontFamily: "monospace",
                              }}
                            >
                              <MapPin size={10} />
                              {padSlot(it.location)}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <button
          style={primaryBtn(Object.keys(returnSelected).length === 0 || returnSubmitting)}
          disabled={Object.keys(returnSelected).length === 0 || returnSubmitting}
          onClick={submitReturn}
        >
          {returnSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Undo2 size={16} />}
          {returnSubmitting ? "처리 중..." : `반납 처리하기 (${Object.keys(returnSelected).length}건)`}
        </button>
      </div>
    );
  }

  /* ---------------- 내 대여 조회 화면 ---------------- */
  function MyLookupScreen() {
    if (myLookupResult) {
      const sorted = [...myLookupResult].sort(
        (a, b) => computeLocationSortIndex(a.location) - computeLocationSortIndex(b.location)
      );
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 800, color: colors.text }}>
              {myLookupName}님이 대여 중인 물품 ({sorted.reduce((n, it) => n + (it.quantity || 1), 0)}개)
            </div>
            <button style={secondaryBtn} onClick={() => setMyLookupResult(null)}>
              다시 조회
            </button>
          </div>
          {sorted.length === 0 ? (
            <div style={{ padding: 30, textAlign: "center", color: colors.sub }}>현재 대여 중인 물품이 없습니다.</div>
          ) : (
            sorted.map((it, i) => (
              <div key={i} style={{ ...cardStyle, padding: 14, display: "flex", gap: 10 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: it.sheetType === "scenario" ? "rgba(16,185,129,0.12)" : colors.primaryLight,
                    color: it.sheetType === "scenario" ? colors.success : colors.primary,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {it.sheetType === "scenario" ? <Fingerprint size={16} /> : <Package size={16} />}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: colors.text }}>{it.itemLabel}</div>
                  <div style={{ fontSize: 11, color: colors.sub, marginTop: 2 }}>
                    대여일: {it.borrowDate}
                    {it.scenarioId ? ` · ${it.scenarioId}` : ""}
                  </div>
                  {it.location && (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 11,
                        fontWeight: 700,
                        color: colors.warn,
                        background: "rgba(245,158,11,0.12)",
                        borderRadius: 8,
                        padding: "2px 8px",
                        marginTop: 6,
                        fontFamily: "monospace",
                      }}
                    >
                      <MapPin size={10} />
                      {padSlot(it.location)}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      );
    }
    return (
      <div style={cardStyle}>
        <label style={labelStyle}>성함 (한글)</label>
        <input
          style={inputStyle}
          value={myLookupName}
          onChange={(e) => setMyLookupName(e.target.value.replace(/[^\uAC00-\uD7A3\u3131-\u318E\s]/g, ""))}
          placeholder="대여 시 입력한 성함"
        />
        <div style={{ height: 14 }} />
        <label style={labelStyle}>소속</label>
        <div style={pillGroup}>
          <button style={pillBtn(myLookupAff === "cfgw")} onClick={() => setMyLookupAff("cfgw")}>
            Cfgw-kr
          </button>
          <button style={pillBtn(myLookupAff !== "cfgw")} onClick={() => setMyLookupAff("other")}>
            ConfigDS · 기타
          </button>
        </div>
        {myLookupAff === "cfgw" && (
          <>
            <div style={{ height: 14 }} />
            <label style={labelStyle}>사번</label>
            <input
              style={inputStyle}
              value={myLookupEmpId}
              onChange={(e) => setMyLookupEmpId(e.target.value.replace(/\D/g, ""))}
              placeholder="숫자만 입력"
              inputMode="numeric"
              onKeyDown={(e) => e.key === "Enter" && runMyLookup()}
            />
          </>
        )}
        <div style={{ height: 18 }} />
        <button style={primaryBtn(myLookupLoading)} disabled={myLookupLoading} onClick={runMyLookup}>
          {myLookupLoading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
          조회하기
        </button>
      </div>
    );
  }

  /* ---------------- SID 검색 화면 ---------------- */
  function SidLookupScreen() {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            style={inputStyle}
            value={sidLookupInput}
            onChange={(e) => setSidLookupInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSidLookup()}
            placeholder="예: S1234 또는 L1234"
          />
          <button style={primaryBtn(sidLookupLoading)} disabled={sidLookupLoading} onClick={runSidLookup}>
            {sidLookupLoading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
          </button>
        </div>

        {sidLookupResult && (
          <div style={cardStyle}>
            <div style={{ fontWeight: 800, fontSize: 15, color: colors.primary, marginBottom: 8 }}>
              <Fingerprint size={15} style={{ display: "inline", marginRight: 6, verticalAlign: -2 }} />
              {sidLookupResult.sid}
              {sidLookupResult.found ? (
                <span style={{ fontSize: 10, fontWeight: 700, background: colors.success, color: "#fff", borderRadius: 10, padding: "2px 8px", marginLeft: 8 }}>
                  등록됨
                </span>
              ) : (
                <span style={{ fontSize: 10, fontWeight: 700, background: colors.warn, color: "#fff", borderRadius: 10, padding: "2px 8px", marginLeft: 8 }}>
                  동기화 필요
                </span>
              )}
            </div>
            {sidLookupResult.found && (
              <>
                <div style={{ fontSize: 13, color: colors.text, marginBottom: 4 }}>
                  <b style={{ color: colors.sub, fontSize: 11 }}>EN</b> {sidLookupResult.highLevelEn || "-"}
                </div>
                <div style={{ fontSize: 13, color: colors.text, marginBottom: 10 }}>
                  <b style={{ color: colors.sub, fontSize: 11 }}>KO</b> {sidLookupResult.highLevelKo || "-"}
                </div>
              </>
            )}
            <div style={{ fontWeight: 700, fontSize: 12, color: colors.sub, marginBottom: 6 }}>
              필요 물품 ({sidLookupResult.items.length}개)
            </div>
            {sidLookupResult.items.length === 0 ? (
              <div style={{ fontSize: 13, color: colors.sub }}>등록된 필요 물품이 없습니다.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {sidLookupResult.items.map((it) => (
                  <div key={it.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 10px", background: colors.inputBg, borderRadius: 8, fontSize: 13 }}>
                    <span>
                      {it.name} <span style={{ color: colors.sub, fontSize: 11 }}>({it.id})</span> x {it.quantity}
                    </span>
                    {it.rootSlot && (
                      <span style={{ color: colors.warn, fontFamily: "monospace", fontWeight: 700, fontSize: 12 }}>{padSlot(it.rootSlot)}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  const titles: Record<Mode, string> = {
    menu: "시나리오 물품 대여",
    borrow: "대여 신청",
    return: "반납 처리",
    mylookup: "내 대여 조회",
    sidlookup: "SID 검색",
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: colors.bg,
        color: colors.text,
        padding: "32px 20px",
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
      }}
    >
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <Header title={titles[mode]} />
        {!connected && (
          <div
            style={{
              background: "rgba(245,158,11,0.08)",
              border: "1px solid rgba(245,158,11,0.25)",
              borderRadius: 12,
              padding: "10px 16px",
              marginBottom: 16,
              fontSize: 12,
              color: colors.warn,
              fontWeight: 700,
            }}
          >
            스프레드시트가 연동되지 않았습니다. 연동 설정 후 이용해주세요.
          </div>
        )}
        {mode === "menu" && <MenuScreen />}
        {mode === "borrow" && <BorrowScreen />}
        {mode === "return" && <ReturnScreen />}
        {mode === "mylookup" && <MyLookupScreen />}
        {mode === "sidlookup" && <SidLookupScreen />}
      </div>
    </div>
  );
}
