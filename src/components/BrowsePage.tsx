import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  ArrowLeft, Search, User, IdCard, Boxes, Fingerprint, ChevronRight,
  Plus, Minus, X, ShoppingCart, Warehouse, MapPin, Trash2, HandHelping,
  Building2, MoreHorizontal, RotateCcw, Check, TrendingDown,
} from "lucide-react";
import {
  ObjectItem, WarehouseItem, BrowseCartItem, WarehouseCartItem,
  padSlot, isKoreanName, parseRackSlot, warehouseStockNum, compareRackSlot,
  fetchObjectItems, fetchWarehouseInventory, checkConfigDsRegistered,
  fetchMyBorrowedItems, fetchWarehouseBorrowedItems, fetchScenarioAllLogs,
  saveIdentity, loadIdentity,
  saveBrowseCart, loadBrowseCart, saveWarehouseCart, loadWarehouseCart,
  DEMO_OBJECT_ITEMS,
} from "../utils/borrowApi";
import { getGoogleDriveImageUrl } from "../utils/drive";
import { smartMatch } from "../utils/search";

type Affiliation = "cfgw" | "configds" | "other";
type Step = "identity" | "menu" | "scenario" | "warehouse" | "mylookup";
type Kind = "scenario" | "warehouse";

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
  }) => void;
  initialStep?: Step | null;
  /** "browse" = 열람조회(기본), "mylookup" = 내 대여조회 전용 */
  purpose?: "browse" | "mylookup";
}

const DEMO_WAREHOUSE: WarehouseItem[] = [
  { rowIndex: 2, location: "F-02", name: "가구발", photo: "", stock: "N/A", spec: "", note: "", manager: "고성민" },
  { rowIndex: 3, location: "A-01", name: "랙 선반용 합판", photo: "", stock: 12, spec: "", note: "", manager: "고성민" },
  { rowIndex: 4, location: "B-01", name: "프로스펙스 손목 보호대", photo: "", stock: 4, spec: "", note: "", manager: "오피스" },
  { rowIndex: 5, location: "E-03", name: "전자 수평계", photo: "", stock: 2, spec: "", note: "", manager: "윤대성" },
];

export default function BrowsePage({
  scriptUrl, connected, isLightMode, onBack, showToast, onGoBorrow, initialStep = null, purpose = "browse",
}: BrowsePageProps) {
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

  const [step, setStep] = useState<Step>(initialStep || "identity");
  const [affiliation, setAffiliation] = useState<Affiliation>("cfgw");
  const [name, setName] = useState("");
  const [empId, setEmpId] = useState("");
  const [otherName, setOtherName] = useState("");
  const [verifying, setVerifying] = useState(false);

  const [sciItems, setSciItems] = useState<ObjectItem[]>([]);
  const [sciLoaded, setSciLoaded] = useState(false);
  // 시나리오 물품 열람 상단: 가장 적게 대여된 물품 20개를 5+5씩 슬라이드로 보여준다.
  const [leastBorrowed, setLeastBorrowed] = useState<[string, number][]>([]);
  const [leastBorrowedLoading, setLeastBorrowedLoading] = useState(false);
  const [leastBorrowedLoaded, setLeastBorrowedLoaded] = useState(false);
  const [leastBorrowedPage, setLeastBorrowedPage] = useState(0);
  const [whItems, setWhItems] = useState<WarehouseItem[]>([]);
  const [whLoaded, setWhLoaded] = useState(false);
  const [sciLoading, setSciLoading] = useState(false);
  const [whLoading, setWhLoading] = useState(false);
  const [sciErr, setSciErr] = useState("");
  const [whErr, setWhErr] = useState("");

  const [sciCart, setSciCart] = useState<BrowseCartItem[]>([]);
  const [whCart, setWhCart] = useState<WarehouseCartItem[]>([]);
  const [cartOpen, setCartOpen] = useState<Kind | null>(null);

  const [sciSearch, setSciSearch] = useState("");
  const [sciCat, setSciCat] = useState("");
  const [sciSub, setSciSub] = useState("");
  const [whSearch, setWhSearch] = useState("");
  const [whRack, setWhRack] = useState("");
  const [whSlot, setWhSlot] = useState("");

  const [modalUrl, setModalUrl] = useState("");
  const [myLoading, setMyLoading] = useState(false);
  const [myResult, setMyResult] = useState<{ scenario: any[]; general: any[]; warehouse: any[] } | null>(null);

  const identName = affiliation === "other" ? otherName.trim() : name.trim();
  const identEmp = affiliation === "cfgw" ? empId.trim() : "";

  useEffect(() => {
    const saved = loadIdentity();
    if (saved) { setName(saved.name || ""); setEmpId(saved.employeeId || ""); }
  }, []);

  // 화면(단계)이 바뀌면 스크롤이 이전 위치에 그대로 남아있지 않도록 맨 위로 초기화한다.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [step]);

  useEffect(() => {
    if (step === "identity" || !identName) return;
    saveBrowseCart(identName, identEmp, sciCart);
  }, [sciCart, identName, identEmp, step]);
  useEffect(() => {
    if (step === "identity" || !identName) return;
    saveWarehouseCart(identName, identEmp, whCart);
  }, [whCart, identName, identEmp, step]);

  const loadScenario = useCallback(async () => {
    setSciLoading(true);
    try {
      setSciItems(connected && scriptUrl ? await fetchObjectItems(scriptUrl) : DEMO_OBJECT_ITEMS);
      setSciErr("");
    } catch (e: any) {
      setSciErr(e?.message || "불러오기에 실패했습니다.");
      showToast(`시나리오 물품을 불러오지 못했습니다: ${e.message}`, "error");
    }
    finally { setSciLoaded(true); setSciLoading(false); }
  }, [connected, scriptUrl, showToast]);

  const loadWarehouse = useCallback(async () => {
    setWhLoading(true);
    try {
      setWhItems(connected && scriptUrl ? await fetchWarehouseInventory(scriptUrl) : DEMO_WAREHOUSE);
      setWhErr("");
    } catch (e: any) {
      setWhErr(e?.message || "불러오기에 실패했습니다.");
      showToast(`공구 및 부품류를 불러오지 못했습니다: ${e.message}`, "error");
    }
    finally { setWhLoaded(true); setWhLoading(false); }
  }, [connected, scriptUrl, showToast]);

  // step이 scenario/warehouse가 되면 (아직 미로드·비로딩일 때) 자동 로드.
  // 클릭 핸들러에서 직접 호출하지 않고 effect로 처리하여 클로저/중복호출 문제를 원천 차단.
  useEffect(() => {
    if (step === "scenario" && !sciLoaded && !sciLoading) loadScenario();
    if (step === "warehouse" && !whLoaded && !whLoading) loadWarehouse();
  }, [step, sciLoaded, sciLoading, whLoaded, whLoading, loadScenario, loadWarehouse]);

  // 시나리오 물품 열람 화면 상단: 가장 적게 대여된 물품 20개 (카탈로그 전체를 0으로 깔고 로그로 덮어씀)
  useEffect(() => {
    if (step !== "scenario" || !sciLoaded || leastBorrowedLoaded || leastBorrowedLoading) return;
    if (!connected || !scriptUrl) { setLeastBorrowedLoaded(true); return; }
    setLeastBorrowedLoading(true);
    fetchScenarioAllLogs(scriptUrl)
      .then((logs) => {
        const byItem: Record<string, number> = {};
        sciItems.forEach((it) => {
          const nm = String(it.name || "").trim();
          if (nm) byItem[nm] = 0;
        });
        logs.forEach((l) => {
          const nm = String(l.itemName || "").trim();
          if (!nm || nm === "(물품 미등록)") return;
          byItem[nm] = (byItem[nm] || 0) + (l.quantity || 1);
        });
        const bottom = Object.entries(byItem).sort((a, b) => a[1] - b[1]).slice(0, 20) as [string, number][];
        setLeastBorrowed(bottom);
      })
      .catch(() => { /* 조용히 무시 — 열람 화면의 부가 정보일 뿐 */ })
      .finally(() => { setLeastBorrowedLoading(false); setLeastBorrowedLoaded(true); });
  }, [step, sciLoaded, sciItems, connected, scriptUrl, leastBorrowedLoaded, leastBorrowedLoading]);

  // 페이지가 여러 개면 몇 초마다 자동으로 다음 페이지로 슬라이드
  const leastBorrowedPageCount = Math.max(1, Math.ceil(leastBorrowed.length / 10));
  useEffect(() => {
    if (leastBorrowedPageCount <= 1) return;
    const timer = setInterval(() => setLeastBorrowedPage((p) => (p + 1) % leastBorrowedPageCount), 4000);
    return () => clearInterval(timer);
  }, [leastBorrowedPageCount]);

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
    const q = sciSearch.trim();
    return sciItems.filter((it) => {
      if (sciCat && it.category !== sciCat) return false;
      if (sciSub && it.subcategory !== sciSub) return false;
      if (!q) return true;
      const slotPad = padSlot(it.rootSlot);
      return smartMatch([it.name, it.id, it.category, it.subcategory, slotPad, it.rootSlot], q);
    });
  }, [sciItems, sciSearch, sciCat, sciSub]);

  const whRackMap = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    whItems.forEach((it) => {
      const { rack, slot } = parseRackSlot(it.location);
      if (!rack) return;
      if (!map[rack]) map[rack] = new Set<string>();
      if (slot) map[rack].add(slot);
    });
    return map;
  }, [whItems]);
  const whRacks = useMemo(() => Object.keys(whRackMap).sort(), [whRackMap]);
  const whSlots = whRack && whRackMap[whRack] ? Array.from<string>(whRackMap[whRack]).sort() : [];

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

  const sciCartCount = sciCart.reduce((n, c) => n + c.quantity, 0);
  const whCartCount = whCart.reduce((n, c) => n + c.quantity, 0);

  function addSci(it: ObjectItem) {
    if ((it.stock || 0) < 1) { showToast("재고가 부족하여 담을 수 없습니다. (현재 재고: 0)", "warn"); return; }
    setSciCart((prev) => {
      const idx = prev.findIndex((c) => c.id === it.id);
      if (idx === -1) return [...prev, { id: it.id, name: it.name, quantity: 1, rootSlot: it.rootSlot }];
      if (prev[idx].quantity >= (it.stock || 0)) { showToast(`재고가 부족합니다. (최대 ${it.stock}개)`, "warn"); return prev; }
      return prev.map((c, i) => (i === idx ? { ...c, quantity: c.quantity + 1 } : c));
    });
  }
  function chgSci(idx: number, d: number) {
    setSciCart((prev) => {
      const item = prev[idx]; if (!item) return prev;
      const orig = sciItems.find((o) => o.id === item.id);
      const max = orig ? orig.stock || 0 : 0; const next = item.quantity + d;
      if (d > 0 && next > max) { showToast(`재고가 부족합니다. (최대 ${max}개)`, "warn"); return prev; }
      if (next < 1) return prev.filter((_, i) => i !== idx);
      return prev.map((c, i) => (i === idx ? { ...c, quantity: next } : c));
    });
  }
  function addWh(it: WarehouseItem) {
    const stock = warehouseStockNum(it.stock);
    if (!isNaN(stock) && stock < 1) { showToast("재고가 부족하여 담을 수 없습니다. (현재 재고: 0)", "warn"); return; }
    setWhCart((prev) => {
      const idx = prev.findIndex((c) => c.rowIndex === it.rowIndex);
      if (idx === -1) return [...prev, { rowIndex: it.rowIndex, location: it.location, name: it.name, quantity: 1 }];
      if (!isNaN(stock) && prev[idx].quantity >= stock) { showToast(`재고가 부족합니다. (최대 ${stock}개)`, "warn"); return prev; }
      return prev.map((c, i) => (i === idx ? { ...c, quantity: c.quantity + 1 } : c));
    });
  }
  function chgWh(idx: number, d: number) {
    setWhCart((prev) => {
      const item = prev[idx]; if (!item) return prev;
      const orig = whItems.find((o) => o.rowIndex === item.rowIndex);
      const stock = orig ? warehouseStockNum(orig.stock) : NaN; const next = item.quantity + d;
      if (d > 0 && !isNaN(stock) && next > stock) { showToast(`재고가 부족합니다. (최대 ${stock}개)`, "warn"); return prev; }
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
    if (affiliation === "configds" && connected && scriptUrl) {
      setVerifying(true);
      try {
        const ok = await checkConfigDsRegistered(scriptUrl, name.trim());
        if (!ok) { showToast("'ConfigDS계정' 시트에 등록되지 않은 이름입니다. 관리자에게 등록을 요청해주세요.", "error"); return; }
      } catch (e: any) { showToast(`확인 중 오류: ${e.message}`, "error"); return; }
      finally { setVerifying(false); }
    }
    const nm = affiliation === "other" ? otherName.trim() : name.trim();
    const eid = affiliation === "cfgw" ? empId.trim() : "";
    if (affiliation === "cfgw") saveIdentity({ name: nm, employeeId: eid });
    setSciCart(loadBrowseCart(nm, eid));
    setWhCart(loadWarehouseCart(nm, eid));
    if (purpose === "mylookup") { setMyResult(null); setStep("mylookup"); runMyLookup(); }
    else setStep("menu");
  }

  async function runMyLookup() {
    setMyLoading(true);
    try {
      if (connected && scriptUrl) {
        const [sc, wh] = await Promise.all([
          fetchMyBorrowedItems(scriptUrl, identName, identEmp),
          fetchWarehouseBorrowedItems(scriptUrl, identName),
        ]);
        // 시트 기준으로 분리: SID대여 시트(scenario) vs 일반대여 시트(general)
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
  function AffCard({ active, icon, text, onClick }: { active: boolean; icon: React.ReactNode; text: string; onClick: () => void }) {
    return (
      <div onClick={onClick} style={{ flex: 1, cursor: "pointer", borderRadius: "14px", textAlign: "center", padding: "16px 8px", border: `1px solid ${active ? C.accent : C.border}`, background: active ? C.accentSoft : C.card, display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
        <span style={{ color: active ? C.accentText : C.label }}>{icon}</span>
        <span style={{ fontWeight: 700, fontSize: "12px", color: active ? C.accentText : C.text }}>{text}</span>
      </div>
    );
  }

  function topBack() {
    if (step === "identity") return onBack();
    if (step === "menu") return setStep("identity");
    if (step === "mylookup" && purpose === "mylookup") return setStep("identity");
    setStep("menu");
  }

  const headerTitle = step === "scenario" ? "시나리오 물품 열람"
    : step === "warehouse" ? "공구 및 부품류 열람"
    : step === "mylookup" ? "내 대여 조회" : "열람 조회";

  /* ── URL 해시로 열람 단계 세분화 (#/browse/<단계>) ── */
  const stepRef = useRef(step);
  stepRef.current = step;

  // 슬라이딩 방향 추적 (렌더 중 동기 계산)
  const STEP_ORDER: Record<string, number> = { identity: 0, menu: 1, scenario: 2, warehouse: 2, mylookup: 2 };
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
    if (suppressBrowseHash.current) { suppressBrowseHash.current = false; return; }
    const target = `#/${browseBase}/${step}`;
    if (window.location.hash !== target) {
      window.history.pushState(null, "", target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    const onPop = () => {
      const parts = window.location.hash.split("/");
      const base = parts[1] || "";
      const slug = parts[2] || "";
      if (base !== "browse" && base !== "mylookup") { onBack(); return; }
      const valid: Step[] = ["identity", "menu", "scenario", "warehouse", "mylookup"];
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
        @media (min-width: 900px) {
          .brp-root { zoom: 1.15; }
        }
      `}</style>

      <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "16px 20px", borderBottom: `1px solid ${C.border}`, background: C.card, position: "sticky", top: 0, zIndex: 20 }}>
        <button onClick={topBack} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.card, color: C.label, cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>
          <ArrowLeft size={15} /> {step === "identity" ? "메인으로" : "이전"}
        </button>
        <h1 style={{ fontSize: "17px", fontWeight: 800, margin: 0, flex: 1 }}>{headerTitle}</h1>
        {step !== "identity" ? (
          <span style={{ fontSize: "12px", color: C.label, fontWeight: 600 }}>
            {identName}{identEmp ? ` · ${identEmp}` : ` · ${affiliation === "configds" ? "ConfigDS" : "기타"}`}
          </span>
        ) : null}
      </div>

      <div style={{ maxWidth: step === "scenario" || step === "warehouse" ? "1200px" : "620px", margin: "0 auto", padding: "24px 16px 96px" }}>

        <div key={step} className={slideDir === "forward" ? "step-forward" : "step-back"}>
        {step === "identity" ? (
          <div>
            <div style={{ marginBottom: "20px", padding: "14px 16px", background: C.accentSoft, borderRadius: "12px", borderLeft: `4px solid ${C.accent}`, fontSize: "13px", lineHeight: 1.6 }}>
              {purpose === "mylookup"
                ? "내 대여 조회에는 소속과 성함이 필요합니다. 대여 시 입력한 것과 동일하게 입력해주세요."
                : "열람 조회에는 소속과 성함이 필요합니다. 담아둔 장바구니는 대여 신청 시 같은 소속·성함으로 그대로 불러옵니다."}
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
                <div style={{ fontSize: "12px", color: C.label, marginBottom: "16px", lineHeight: 1.5 }}>기타 소속은 성함만 입력합니다. (사번·Slack 멘션 없음)</div>
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
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={onBack} style={secondaryBtn}>이전</button>
              <button onClick={submitIdentity} disabled={verifying} style={{ ...primaryBtn, opacity: verifying ? 0.7 : 1 }}>
                {verifying ? <><Spinner size={16} /> 확인 중...</> : <>계속하기 <ChevronRight size={15} /></>}
              </button>
            </div>
          </div>
        ) : null}

        {step === "menu" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {[
              { key: "scenario" as const, icon: <Fingerprint size={22} />, color: C.accentText, bg: C.accentSoft, title: "시나리오 물품 열람", sub: "모든 시나리오 물품을 그리드로 보고 장바구니에 담습니다" },
              { key: "warehouse" as const, icon: <Warehouse size={22} />, color: C.success, bg: C.successSoft, title: "공구 및 부품류 열람", sub: "창고 재고를 랙·슬롯별로 보고 장바구니에 담습니다" },
            ].map((m) => (
              <div
                key={m.key}
                onClick={() => setStep(m.key)}
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

        {step === "scenario" ? (
          <>
            {leastBorrowedLoading || leastBorrowed.length > 0 ? (
              <div
                style={{
                  marginBottom: "16px",
                  padding: "14px 16px",
                  borderRadius: "14px",
                  border: `1px solid ${C.border}`,
                  background: C.card,
                  boxShadow: "0 2px 12px rgba(0,0,0,0.04)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 800, color: C.label, marginBottom: "10px" }}>
                  <TrendingDown size={14} style={{ color: C.accentText }} />
                  가장 적게 대여된 물품
                </div>
                {leastBorrowedLoading ? (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridAutoFlow: "column", gridTemplateRows: "repeat(5, auto)", gap: "8px 20px" }}>
                    {Array.from({ length: 10 }).map((_, i) => (
                      <div key={i} style={{ height: "13px", borderRadius: "6px", width: `${50 + (i % 3) * 12}%`, background: C.cardSub, animation: "browseLbSkeleton 1.2s ease-in-out infinite", animationDelay: `${i * 0.08}s` }} />
                    ))}
                    <style>{`@keyframes browseLbSkeleton { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }`}</style>
                  </div>
                ) : (
                  <>
                    <div style={{ position: "relative", overflow: "hidden" }}>
                      <div style={{ display: "flex", transform: `translateX(-${leastBorrowedPage * 100}%)`, transition: "transform 0.5s ease" }}>
                        {Array.from({ length: leastBorrowedPageCount }).map((_, pageIdx) => (
                          <div
                            key={pageIdx}
                            style={{ flex: "0 0 100%", display: "grid", gridTemplateColumns: "1fr 1fr", gridAutoFlow: "column", gridTemplateRows: "repeat(5, auto)", gap: "8px 20px" }}
                          >
                            {leastBorrowed.slice(pageIdx * 10, pageIdx * 10 + 10).map(([name, qty]) => (
                              <div key={name} style={{ display: "flex", justifyContent: "space-between", gap: "10px", fontSize: "12px" }}>
                                <span style={{ color: C.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                                <span style={{ color: C.label, flexShrink: 0 }}>{qty}개</span>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                    {leastBorrowedPageCount > 1 ? (
                      <div style={{ display: "flex", justifyContent: "center", gap: "5px", marginTop: "10px" }}>
                        {Array.from({ length: leastBorrowedPageCount }).map((_, i) => (
                          <button
                            key={i}
                            onClick={() => setLeastBorrowedPage(i)}
                            aria-label={`${i + 1}번째 페이지`}
                            style={{ width: i === leastBorrowedPage ? "14px" : "6px", height: "6px", borderRadius: "999px", border: "none", padding: 0, cursor: "pointer", background: i === leastBorrowedPage ? C.accent : C.border, transition: "all 0.3s ease" }}
                          />
                        ))}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}

          <ItemGrid C={C} Spinner={Spinner} loaded={sciLoaded} loading={sciLoading} count={sciFiltered.length} total={sciItems.length} error={sciErr} onRetry={() => { setSciErr(""); loadScenario(); }}
            filterRow={
              <>
                <div style={{ position: "relative", flex: "2 1 260px", minWidth: 0 }}>
                  <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
                  <input value={sciSearch} onChange={(e) => setSciSearch(e.target.value)} placeholder="ID · 물품명 · 위치로 검색..." style={{ ...inputStyle, paddingLeft: "36px", padding: "11px 12px 11px 36px", fontSize: "14px" }} />
                </div>
                <select value={sciCat} onChange={(e) => { setSciCat(e.target.value); setSciSub(""); }} style={{ ...inputStyle, padding: "11px 12px", fontSize: "13px", flex: "1 1 150px", minWidth: 0 }}>
                  <option value="">전체 카테고리</option>{sciCats.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={sciSub} onChange={(e) => setSciSub(e.target.value)} style={{ ...inputStyle, padding: "11px 12px", fontSize: "13px", flex: "1 1 150px", minWidth: 0 }}>
                  <option value="">전체 서브</option>{sciSubs.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </>
            }
          >
            {sciFiltered.map((it) => {
              const inCart = sciCart.find((c) => c.id === it.id);
              const out = (it.stock || 0) < 1;
              return (
                <GridCard key={it.id} C={C} inCart={!!inCart} out={out} image={it.image} onImage={() => it.image && setModalUrl(getGoogleDriveImageUrl(it.image))}
                  title={it.name} idText={`ID: ${it.id}`}
                  badges={<>
                    {it.rootSlot ? <Chip C={C} icon={<MapPin size={11} />} text={padSlot(it.rootSlot)} tone="warn" /> : null}
                    {it.category ? <Chip C={C} text={it.category} tone="accent" /> : null}
                  </>}
                  stock={it.stock || 0} rented={it.rented || 0}
                  qty={inCart?.quantity}
                  onAdd={() => addSci(it)}
                  onMinus={() => chgSci(sciCart.findIndex((c) => c.id === it.id), -1)}
                  onPlus={() => chgSci(sciCart.findIndex((c) => c.id === it.id), 1)}
                />
              );
            })}
          </ItemGrid>
          </>
        ) : null}

        {step === "warehouse" ? (
          <ItemGrid C={C} Spinner={Spinner} loaded={whLoaded} loading={whLoading} count={whFiltered.length} total={whItems.length} error={whErr} onRetry={() => { setWhErr(""); loadWarehouse(); }}
            filterRow={
              <>
                <div style={{ position: "relative", flex: "2 1 260px", minWidth: 0 }}>
                  <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
                  <input value={whSearch} onChange={(e) => setWhSearch(e.target.value)} placeholder="물품명으로 검색..." style={{ ...inputStyle, paddingLeft: "36px", padding: "11px 12px 11px 36px", fontSize: "14px" }} />
                </div>
                <select value={whRack} onChange={(e) => { setWhRack(e.target.value); setWhSlot(""); }} style={{ ...inputStyle, padding: "11px 12px", fontSize: "13px", flex: "1 1 130px", minWidth: 0 }}>
                  <option value="">전체 랙</option>{whRacks.map((r) => <option key={r} value={r}>{r}랙</option>)}
                </select>
                <select value={whSlot} onChange={(e) => setWhSlot(e.target.value)} style={{ ...inputStyle, padding: "11px 12px", fontSize: "13px", flex: "1 1 130px", minWidth: 0 }}>
                  <option value="">전체 슬롯</option>{whSlots.map((s) => <option key={s} value={s}>{s}번</option>)}
                </select>
              </>
            }
          >
            {whFiltered.map((it) => {
              const inCart = whCart.find((c) => c.rowIndex === it.rowIndex);
              const stockN = warehouseStockNum(it.stock);
              const out = !isNaN(stockN) && stockN < 1;
              const { rack, slot } = parseRackSlot(it.location);
              return (
                <GridCard key={it.rowIndex} C={C} inCart={!!inCart} out={out} image={it.photo} onImage={() => it.photo && setModalUrl(getGoogleDriveImageUrl(it.photo))}
                  title={it.name} idText={it.location || ""}
                  badges={<>
                    {it.location ? <Chip C={C} icon={<MapPin size={11} />} text={`${rack}랙 ${slot}`} tone="warn" /> : null}
                    {it.manager ? <Chip C={C} text={it.manager} tone="accent" /> : null}
                  </>}
                  stock={isNaN(stockN) ? "N/A" : stockN} rented={null}
                  qty={inCart?.quantity}
                  onAdd={() => addWh(it)}
                  onMinus={() => chgWh(whCart.findIndex((c) => c.rowIndex === it.rowIndex), -1)}
                  onPlus={() => chgWh(whCart.findIndex((c) => c.rowIndex === it.rowIndex), 1)}
                />
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
                          <MyRow key={`s${i}`} C={C} icon={<Fingerprint size={17} />} tone="accent" label={item.itemLabel} sub={`대여일: ${item.borrowDate || "-"}${item.scenarioId ? ` · ${item.scenarioId}` : ""}`} loc={padSlot(item.location)} image={item.image} onImage={() => item.image && setModalUrl(getGoogleDriveImageUrl(item.image))} />
                        ))}
                      </>
                    ) : null}
                    {myResult.general.length ? (
                      <>
                        <div style={{ fontSize: "12px", fontWeight: 700, color: C.accentText, margin: "16px 0 8px" }}>일반 대여</div>
                        {myResult.general.map((item: any, i: number) => (
                          <MyRow key={`g${i}`} C={C} icon={<Boxes size={17} />} tone="accent" label={item.itemLabel} sub={`대여일: ${item.borrowDate || "-"}${item.generalOption ? ` · ${item.generalOption}` : ""}`} loc={padSlot(item.location)} image={item.image} onImage={() => item.image && setModalUrl(getGoogleDriveImageUrl(item.image))} />
                        ))}
                      </>
                    ) : null}
                    {myResult.warehouse.length ? (
                      <>
                        <div style={{ fontSize: "12px", fontWeight: 700, color: C.success, margin: "16px 0 8px" }}>공구 및 부품류</div>
                        {myResult.warehouse.map((item: any, i: number) => {
                          const { rack, slot } = parseRackSlot(item.location);
                          return <MyRow key={`w${i}`} C={C} icon={<Warehouse size={17} />} tone="success" label={item.itemLabel} sub={`대여일: ${item.borrowDate || "-"}`} loc={item.location ? `${rack}랙 ${slot}` : ""} image={item.image} onImage={() => item.image && setModalUrl(getGoogleDriveImageUrl(item.image))} />;
                        })}
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

      {(step === "scenario" || step === "warehouse") && (step === "scenario" ? sciCartCount : whCartCount) > 0 ? (
        <button
          onClick={() => setCartOpen(step as Kind)}
          style={{ position: "fixed", right: "20px", bottom: "20px", zIndex: 40, display: "flex", alignItems: "center", gap: "10px", padding: "14px 20px", borderRadius: "999px", border: "none", background: C.accent, color: "#fff", cursor: "pointer", fontSize: "14px", fontWeight: 700, boxShadow: "0 8px 24px rgba(37, 99, 235,0.5)" }}
        >
          <ShoppingCart size={18} /> 장바구니
          <span style={{ background: "#fff", color: C.accent, borderRadius: "999px", padding: "1px 9px", fontSize: "12px", fontWeight: 800 }}>{step === "scenario" ? sciCartCount : whCartCount}</span>
        </button>
      ) : null}

      {cartOpen ? (
        <div onClick={() => setCartOpen(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 50, display: "flex", justifyContent: "flex-end" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(420px, 100%)", background: C.card, borderLeft: `1px solid ${C.border}`, display: "flex", flexDirection: "column", height: "100%" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "18px 20px", borderBottom: `1px solid ${C.border}` }}>
              <ShoppingCart size={18} style={{ color: C.accentText }} />
              <h2 style={{ flex: 1, fontSize: "16px", fontWeight: 800, margin: 0 }}>{cartOpen === "scenario" ? "시나리오" : "창고"} 장바구니 ({cartOpen === "scenario" ? sciCartCount : whCartCount}개)</h2>
              <button onClick={() => setCartOpen(null)} style={{ background: "none", border: "none", color: C.label, cursor: "pointer" }}><X size={20} /></button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
              {cartOpen === "warehouse" ? (
                <div style={{ marginBottom: "12px", padding: "10px 12px", background: C.warnSoft, borderRadius: "10px", fontSize: "12px", color: C.text, lineHeight: 1.5 }}>
                  다음 화면에서 <b>대여</b> 또는 <b>소모</b>를 선택할 수 있습니다. 소모는 재고에서 차감되며 반납 대상이 아닙니다.
                </div>
              ) : null}
              {cartOpen === "scenario" ? (
                sciCart.length === 0 ? <EmptyCart C={C} /> : sciCart.map((item, idx) => (
                  <CartRow key={item.id} C={C} name={item.name} sub={`ID: ${item.id}`} qty={item.quantity} onMinus={() => chgSci(idx, -1)} onPlus={() => chgSci(idx, 1)} onRemove={() => setSciCart(sciCart.filter((_, i) => i !== idx))} />
                ))
              ) : (
                whCart.length === 0 ? <EmptyCart C={C} /> : whCart.map((item, idx) => (
                  <CartRow key={item.rowIndex} C={C} name={item.name} sub={item.location} qty={item.quantity} onMinus={() => chgWh(idx, -1)} onPlus={() => chgWh(idx, 1)} onRemove={() => setWhCart(whCart.filter((_, i) => i !== idx))} />
                ))
              )}
            </div>
            <div style={{ padding: "16px 20px", borderTop: `1px solid ${C.border}`, display: "flex", gap: "10px" }}>
              <button onClick={() => (cartOpen === "scenario" ? setSciCart([]) : setWhCart([]))} disabled={(cartOpen === "scenario" ? sciCart : whCart).length === 0} style={{ ...secondaryBtn, flex: "0 0 auto", padding: "14px 16px", opacity: (cartOpen === "scenario" ? sciCart : whCart).length === 0 ? 0.5 : 1 }}><Trash2 size={15} /></button>
              <button
                onClick={() => onGoBorrow({ identity: { name: identName, employeeId: identEmp, affiliation }, kind: cartOpen })}
                disabled={(cartOpen === "scenario" ? sciCart : whCart).length === 0}
                style={{ ...primaryBtn, opacity: (cartOpen === "scenario" ? sciCart : whCart).length === 0 ? 0.5 : 1 }}
              >
                <HandHelping size={15} /> {cartOpen === "warehouse" ? "대여 / 소모하기" : "대여 신청하기"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {modalUrl ? (
        <div onClick={() => setModalUrl("")} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
          <button onClick={() => setModalUrl("")} style={{ position: "absolute", top: "16px", right: "20px", background: "none", border: "none", color: "#fff", cursor: "pointer" }}><X size={32} /></button>
          <img src={modalUrl} alt="" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "90%", maxHeight: "90%", borderRadius: "8px", objectFit: "contain" }} />
        </div>
      ) : null}
    </div>
  );
}

function Chip({ C, icon, text, tone }: { C: any; icon?: React.ReactNode; text: string; tone: "warn" | "accent" }) {
  const color = tone === "warn" ? C.warn : C.accentText;
  const bg = tone === "warn" ? C.warnSoft : C.accentSoft;
  return <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "10px", fontWeight: 700, color, background: bg, borderRadius: "6px", padding: "2px 7px", fontFamily: icon ? "monospace" : "inherit" }}>{icon}{text}</span>;
}

function ItemGrid({ C, Spinner, loaded, loading, count, total, filterRow, children, error, onRetry }: any) {
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
      <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>{filterRow}</div>
      <div style={{ fontSize: "12px", color: C.label, marginBottom: "12px" }}>{loaded && !error ? `${count} / ${total}개 물품` : ""}</div>
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "16px" }}>{children}</div>
      )}
    </div>
  );
}

function GridCard({ C, inCart, out, image, onImage, title, idText, badges, stock, rented, qty, onAdd, onMinus, onPlus }: any) {
  return (
    <div style={{ border: `1px solid ${inCart ? C.accent : C.border}`, background: C.card, borderRadius: "16px", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: inCart ? "0 8px 20px -8px rgba(37, 99, 235,0.4)" : "0 2px 4px rgba(0,0,0,0.04)", transition: "all 0.2s", opacity: out ? 0.6 : 1 }}>
      <div onClick={onImage} style={{ height: "150px", background: C.cardSub, display: "flex", alignItems: "center", justifyContent: "center", cursor: image ? "zoom-in" : "default", borderBottom: `1px solid ${C.border}` }}>
        {image ? <img src={getGoogleDriveImageUrl(image)} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Boxes size={40} style={{ color: C.border }} />}
      </div>
      <div style={{ padding: "12px 14px", flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
        <div style={{ fontWeight: 700, fontSize: "14px", lineHeight: 1.35, wordBreak: "break-word" }}>{title}</div>
        <div style={{ fontSize: "11px", color: C.label }}>{idText}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>{badges}</div>
        <div style={{ display: "flex", gap: "6px", fontSize: "11px", fontWeight: 600 }}>
          <span style={{ color: C.success, background: C.successSoft, padding: "2px 8px", borderRadius: "6px" }}>재고 {stock}</span>
          {rented !== null ? <span style={{ color: C.accentText, background: C.accentSoft, padding: "2px 8px", borderRadius: "6px" }}>대여 중 {rented}</span> : null}
        </div>
        <div style={{ marginTop: "auto", paddingTop: "8px" }}>
          {qty !== undefined ? (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", justifyContent: "center", background: C.accentSoft, borderRadius: "10px", padding: "6px" }}>
              <button onClick={onMinus} style={{ width: 28, height: 28, borderRadius: "8px", border: "none", background: C.card, color: C.text, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Minus size={13} /></button>
              <span style={{ fontWeight: 800, minWidth: "22px", textAlign: "center", color: C.accentText }}>{qty}</span>
              <button onClick={onPlus} style={{ width: 28, height: 28, borderRadius: "8px", border: "none", background: C.card, color: C.text, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={13} /></button>
            </div>
          ) : (
            <button disabled={out} onClick={onAdd} style={{ width: "100%", padding: "9px", borderRadius: "10px", border: "none", background: out ? C.border : C.accent, color: "#fff", cursor: out ? "not-allowed" : "pointer", fontSize: "13px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
              <ShoppingCart size={14} /> {out ? "재고 없음" : "장바구니 담기"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CartRow({ C, name, sub, qty, onMinus, onPlus, onRemove }: any) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", background: C.cardSub, border: `1px solid ${C.border}`, borderRadius: "10px", marginBottom: "8px" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: "13px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</div>
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

function MyRow({ C, icon, tone, label, sub, loc, image, onImage }: any) {
  const color = tone === "success" ? C.success : C.accentText;
  const bg = tone === "success" ? C.successSoft : C.accentSoft;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "13px", border: `1px solid ${C.border}`, borderRadius: "12px", marginBottom: "8px", background: C.card }}>
      <div
        onClick={image ? onImage : undefined}
        style={{ flex: "0 0 40px", width: 40, height: 40, borderRadius: "10px", overflow: "hidden", background: bg, color, display: "flex", alignItems: "center", justifyContent: "center", cursor: image ? "zoom-in" : "default" }}
      >
        {image ? <img src={getGoogleDriveImageUrl(image)} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: "13px", wordBreak: "break-word" }}>{label}</div>
        <div style={{ fontSize: "11px", color: C.label, marginTop: "2px" }}>{sub}</div>
      </div>
      {loc ? <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", fontWeight: 700, color: C.warn, background: C.warnSoft, borderRadius: "8px", padding: "3px 9px", fontFamily: "monospace", flexShrink: 0 }}><MapPin size={11} />{loc}</span> : null}
    </div>
  );
}
