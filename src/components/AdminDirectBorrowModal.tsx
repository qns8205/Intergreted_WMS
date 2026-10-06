import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, Boxes, Check, CheckCircle2, ChevronRight, Image as ImageIcon,
  Minus, Plus, Search, ShoppingCart, Trash2, Warehouse, X, SlidersHorizontal,
} from "lucide-react";
import {
  fetchBorrowAppVersion, fetchScenarioObjectsForAdmin, fetchSeatMap, fetchWarehouseInventory,
  fetchBorrowerSeatRecommendations, BorrowerSeatRecommendation, BrowseCartItem,
  nowString, postRecordBorrow, postWarehouseRentBulk, ScenarioObjectAdmin, WarehouseItem,
} from "../utils/borrowApi";
import { getGoogleDriveImageUrl, getThumbImageUrl } from "../utils/drive";
import { smartMatch } from "../utils/search";
import { countDistinctItemTypes } from "../utils/itemTypeCount";
import { useVersionWorkGuard } from "../utils/versionWorkGuard";
import RegisteredUserPicker from "./RegisteredUserPicker";
import BrowsePage from "./BrowsePage";

interface Props {
  scriptUrl: string;
  connected: boolean;
  isLightMode: boolean;
  isActive: boolean;
  onClose: () => void;
  onCompleted?: () => void;
  showToast: (msg: string, type: "ok" | "error" | "info" | "warn") => void;
}
type Step = "category" | "identity" | "items" | "confirm" | "done";
type Category = "scenario" | "warehouse";
type ScenarioLine = { kind: "scenario"; id: string; name: string; quantity: number; stock: number; image?: string; location?: string; variantId?: number; variantName?: string };
type WarehouseLine = { kind: "warehouse"; rowIndex: number; name: string; quantity: number; stock: number; photo?: string; location: string; action: "대여" | "소모"; isConsumable?: boolean };
type CartLine = ScenarioLine | WarehouseLine;

const lineKey = (line: CartLine) => line.kind === "scenario" ? `s:${line.id}:${line.variantId || ""}` : `w:${line.rowIndex}`;
const uniq = (values: (string | undefined)[]) => [...new Set(values.map((v) => String(v || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));

export default function AdminDirectBorrowPage({ scriptUrl, connected, isLightMode, isActive, onClose, onCompleted, showToast }: Props) {
  const [step, setStep] = useState<Step>("category");
  const autoResetTimerRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stickyHeaderRef = useRef<HTMLDivElement | null>(null);
  const [stickyHeaderHeight, setStickyHeaderHeight] = useState(0);
  useEffect(() => {
    const header = stickyHeaderRef.current;
    if (!header) return;
    const observer = new ResizeObserver(() => setStickyHeaderHeight(header.offsetHeight));
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { rootRef.current?.scrollTo({ top: 0 }); }, [step]);
  const [category, setCategory] = useState<Category | null>(null);
  const [name, setName] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [floor, setFloor] = useState("");
  const [unit, setUnit] = useState("");
  const [floors, setFloors] = useState<{ id: string; name?: string; units: { label: string }[] }[]>([]);
  const [seatMapLoading, setSeatMapLoading] = useState(true);
  const [seatRecommendations, setSeatRecommendations] = useState<BorrowerSeatRecommendation[]>([]);
  const [seatRecommendationsLoading, setSeatRecommendationsLoading] = useState(false);
  const [seatRecommendationsError, setSeatRecommendationsError] = useState("");
  const [scenarioItems, setScenarioItems] = useState<ScenarioObjectAdmin[]>([]);
  const [warehouseItems, setWarehouseItems] = useState<WarehouseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterA, setFilterA] = useState("");
  const [filterB, setFilterB] = useState("");
  const [filterC, setFilterC] = useState("");
  const [requestFilter, setRequestFilter] = useState<"all" | "request" | "normal">(() => {
    try {
      const saved = sessionStorage.getItem("wms_scenario_request_filter");
      return saved === "request" || saved === "normal" ? saved : "all";
    } catch { return "all"; }
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [inStockOnly, setInStockOnly] = useState(true);
  const [variantPick, setVariantPick] = useState<ScenarioObjectAdmin | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const browseCart = useMemo<BrowseCartItem[]>(() => cart.filter((line): line is ScenarioLine => line.kind === "scenario")
    .map(({ id, name, quantity, location, variantId, variantName }) => ({ id, name, quantity, rootSlot: location, variantId, variantName })), [cart]);
  const cartTypeCount = useMemo(() => countDistinctItemTypes(cart), [cart]);
  const [purpose, setPurpose] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState<{ src: string; name: string } | null>(null);
  useVersionWorkGuard("admin-direct-borrow", (step !== "category" && step !== "done") || submitting, "관리자 대리 신청 중");
  useEffect(() => {
    try { sessionStorage.setItem("wms_scenario_request_filter", requestFilter); } catch { /* 저장소 접근 불가 */ }
  }, [requestFilter]);

  // 이 화면은 메뉴를 옮겨도 DOM을 유지해 제출 요청이 중간에 끊기지 않게 한다. 그 대신
  // 완료 화면이나 작성 중 장면까지 계속 남아 있었으므로, 완료했거나 다른 메뉴로 나간 뒤
  // 10초가 지나면 입력 상태만 확실히 초기화한다. 다시 들어와도 시작된 타이머는 취소하지 않는다.
  useEffect(() => {
    if (step === "category" || (isActive && step !== "done") || autoResetTimerRef.current !== null) return;
    autoResetTimerRef.current = window.setTimeout(() => {
      autoResetTimerRef.current = null;
      setStep("category");
      setCategory(null);
      setName("");
      setEmployeeId("");
      setFloor("");
      setUnit("");
      setSeatRecommendations([]);
      setSeatRecommendationsError("");
      setCart([]);
      setPurpose("");
      setSearch("");
      setFilterA("");
      setFilterB("");
      setFilterC("");
      setVariantPick(null);
      setPreview(null);
      rootRef.current?.scrollTo({ top: 0, behavior: "auto" });
    }, 10_000);
  }, [isActive, step]);

  useEffect(() => () => {
    if (autoResetTimerRef.current !== null) window.clearTimeout(autoResetTimerRef.current);
  }, []);

  const C = {
    bg: isLightMode ? "#f7f8fa" : "#0b1120", card: isLightMode ? "#fff" : "#161f30",
    cardSub: isLightMode ? "#f4f6f9" : "#0f172a", border: isLightMode ? "#e6e9ef" : "#26324a",
    text: isLightMode ? "#111827" : "#f1f5f9", label: isLightMode ? "#64748b" : "#94a3b8",
    accent: "#2563eb", accentSoft: isLightMode ? "rgba(37,99,235,.09)" : "rgba(37,99,235,.16)",
    accentText: isLightMode ? "#1d4ed8" : "#93c5fd", success: isLightMode ? "#047857" : "#34d399",
    successSoft: "rgba(16,185,129,.12)", error: isLightMode ? "#dc2626" : "#f87171", errorSoft: "rgba(239,68,68,.12)",
  };
  const input: React.CSSProperties = { width: "100%", padding: "14px 16px", fontSize: 15, borderRadius: 12, border: `1px solid ${C.border}`, background: C.card, color: C.text, outline: "none", boxSizing: "border-box" };
  const label: React.CSSProperties = { display: "block", fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 8 };
  const primary: React.CSSProperties = { flex: 1, padding: 14, borderRadius: 12, border: "none", cursor: "pointer", background: C.accent, color: "#fff", fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 };
  const secondary: React.CSSProperties = { flex: 1, padding: 14, borderRadius: 12, border: `1px solid ${C.border}`, cursor: "pointer", background: C.card, color: C.label, fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 };

  useEffect(() => {
    let cancelled = false;
    if (!connected) { setLoading(false); return; }
    setLoading(true);
    Promise.all([fetchScenarioObjectsForAdmin(scriptUrl), fetchWarehouseInventory(scriptUrl)])
      .then(([scenario, warehouse]) => {
        if (cancelled) return;
        setScenarioItems(scenario.filter((it) => !it.archived));
        setWarehouseItems(warehouse.filter((it) => !it.archived));
      }).catch((e: any) => showToast(`대여 물품을 불러오지 못했습니다: ${e.message}`, "error"))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [connected, scriptUrl, showToast]);

  useEffect(() => {
    let cancelled = false;
    if (!connected || category !== "scenario") { setSeatMapLoading(false); return; }
    setSeatMapLoading(true);
    fetchSeatMap(scriptUrl)
      .then((seats) => { if (!cancelled) setFloors(seats.floors || []); })
      .catch(() => { if (!cancelled) setFloors([]); })
      .finally(() => { if (!cancelled) setSeatMapLoading(false); });
    return () => { cancelled = true; };
  }, [connected, scriptUrl, category]);

  useEffect(() => {
    let cancelled = false;
    setSeatRecommendations([]);
    setSeatRecommendationsError("");
    if (!connected || category !== "scenario" || !/^\d{4}$/.test(employeeId)) { setSeatRecommendationsLoading(false); return; }
    setSeatRecommendationsLoading(true);
    fetchBorrowerSeatRecommendations(scriptUrl, employeeId)
      .then((items) => { if (!cancelled) setSeatRecommendations(items); })
      .catch(() => { if (!cancelled) setSeatRecommendationsError("유닛 추천을 불러오지 못했습니다. 아래에서 직접 선택해주세요."); })
      .finally(() => { if (!cancelled) setSeatRecommendationsLoading(false); });
    return () => { cancelled = true; };
  }, [connected, scriptUrl, employeeId, category]);

  const recommendedSeats = useMemo(() => seatRecommendations.flatMap((seat) => {
    const seatFloor = floors.find((f) => f.id === seat.floor || f.name === seat.floor);
    return seatFloor?.units.some((u) => u.label === seat.unit) ? [{ ...seat, floor: seatFloor.id }] : [];
  }).slice(0, 3), [seatRecommendations, floors]);

  const availableUnits = floors.find((f) => f.id === floor)?.units || [];
  const scenarioFilters = useMemo(() => ({ categories: uniq(scenarioItems.map((x) => x.category)), subcategories: uniq(scenarioItems.filter((x) => !filterA || x.category === filterA).map((x) => x.subcategory)), sectors: uniq(scenarioItems.map((x) => x.sector)) }), [scenarioItems, filterA]);
  const warehouseFilters = useMemo(() => ({ racks: uniq(warehouseItems.map((x) => x.location?.split("-")[0])), managers: uniq(warehouseItems.map((x) => x.manager)), specs: uniq(warehouseItems.map((x) => x.spec)) }), [warehouseItems]);
  const filteredScenario = useMemo(() => scenarioItems.filter((it) => (!search.trim() || smartMatch([it.name, it.id, it.rootSlot, it.category, it.subcategory, it.sector, it.requestFor], search)) && (!filterA || it.category === filterA) && (!filterB || it.subcategory === filterB) && (!filterC || it.sector === filterC) && (requestFilter === "all" || (requestFilter === "request" ? it.requestFor !== undefined : it.requestFor === undefined)) && (!inStockOnly || Number(it.stock) > 0)).slice(0, 100), [scenarioItems, search, filterA, filterB, filterC, requestFilter, inStockOnly]);
  const filteredWarehouse = useMemo(() => warehouseItems.filter((it) => { const stock = Number(it.stock); return (!search.trim() || smartMatch([it.name, it.location, it.spec, it.keywords, it.manager], search)) && (!filterA || it.location?.split("-")[0] === filterA) && (!filterB || it.manager === filterB) && (!filterC || it.spec === filterC) && (!inStockOnly || (Number.isFinite(stock) && stock > 0)); }).slice(0, 100), [warehouseItems, search, filterA, filterB, filterC, inStockOnly]);

  function chooseCategory(next: Category) { setCategory(next); setCart([]); setSearch(""); setFilterA(""); setFilterB(""); setFilterC(""); setVariantPick(null); setStep("identity"); }
  function goBack() {
    if (submitting) return;
    if (step === "identity") { setCategory(null); setCart([]); setStep("category"); }
    else if (step === "items") setStep("identity");
    else if (step === "confirm") setStep("items");
  }
  function goToItems() {
    if (!connected || loading || (category === "scenario" && seatMapLoading)) { showToast("물품과 좌석 정보를 불러온 뒤 다시 시도해주세요.", "warn"); return; }
    if (!name.trim()) { showToast("대여자 성함을 입력해주세요.", "warn"); return; }
    if (!/^\d{4}$/.test(employeeId)) { showToast("등록 명부의 이름을 검색해 대여자를 선택해주세요.", "warn"); return; }
    if (category === "scenario" && !floors.some((f) => f.id === floor && f.units.some((u) => u.label === unit))) { showToast("좌석 위치를 선택해주세요.", "warn"); return; }
    setStep("items");
  }
  function changeQty(key: string, delta: number) { if (submitting) return; setCart((prev) => prev.map((line) => lineKey(line) === key ? { ...line, quantity: Math.min(line.stock, Math.max(0, line.quantity + delta)) } : line).filter((line) => line.quantity > 0)); }
  function addScenario(it: ScenarioObjectAdmin, variant?: { id: number; name: string; stock: number; image?: string }) {
    const stock = Number(variant?.stock ?? it.stock); if (!Number.isFinite(stock) || stock <= 0) return;
    const line: ScenarioLine = { kind: "scenario", id: it.id, name: it.name, quantity: 1, stock, image: variant?.image || it.image, location: it.rootSlot, variantId: variant?.id, variantName: variant?.name };
    const key = lineKey(line); setCart((prev) => prev.some((x) => lineKey(x) === key) ? prev.map((x) => lineKey(x) === key ? { ...x, quantity: Math.min(x.stock, x.quantity + 1) } : x) : [...prev, line]);
  }
  function addWarehouse(it: WarehouseItem) {
    const stock = Number(it.stock); if (!Number.isFinite(stock) || stock <= 0) return;
    const line: WarehouseLine = { kind: "warehouse", rowIndex: it.rowIndex, name: it.name, quantity: 1, stock, photo: it.photo, location: it.location, action: it.isConsumable ? "소모" : "대여", isConsumable: it.isConsumable };
    const key = lineKey(line); setCart((prev) => prev.some((x) => lineKey(x) === key) ? prev.map((x) => lineKey(x) === key ? { ...x, quantity: Math.min(x.stock, x.quantity + 1) } : x) : [...prev, line]);
  }
  function changeAction(key: string, action: "대여" | "소모") {
    if (submitting) return;
    setCart((prev) => prev.map((line) => line.kind === "warehouse" && lineKey(line) === key ? { ...line, action: line.isConsumable ? "소모" : action } : line));
  }
  async function submit() {
    if (!category || !cart.length || submitting) return; setSubmitting(true);
    try {
      if (category === "scenario") {
        const version = await fetchBorrowAppVersion(scriptUrl).catch(() => ""); const lines = cart as ScenarioLine[];
        const res = await postRecordBorrow(scriptUrl, [{ itemType: "general", borrowerName: name.trim(), affiliation: "cfgw", employeeId: employeeId.trim(), borrowDate: nowString(), borrowPurpose: purpose.trim() || "대여 신청", borrowedItems: lines.map((x) => ({ id: x.id, name: x.name, quantity: x.quantity, variantId: x.variantId })), generalOption: "일반 대여", floor, unit }], version);
        if (!res.success) throw new Error(res.message || "시나리오 물품 대여 처리 실패");
      } else {
        const res = await postWarehouseRentBulk(scriptUrl, (cart as WarehouseLine[]).map((x) => ({ type: x.action, itemId: x.rowIndex, resolveLoan: false, location: x.location, name: x.name, qty: x.quantity, user: name.trim(), employeeId: employeeId.trim(), note: purpose.trim() || `관리자 직접 ${x.action}` })));
        if (!res.success) throw new Error(res.error || "COS 물품 대여 처리 실패");
      }
      showToast(`${name.trim()}님의 ${category === "warehouse" ? "대여 / 소모 처리" : "대여 신청"}가 완료되었습니다.`, "ok"); onCompleted?.(); setStep("done");
    } catch (e: any) { showToast(e.message || "대여 신청 처리에 실패했습니다.", "error"); } finally { setSubmitting(false); }
  }

  const imgOf = (line: CartLine) => line.kind === "scenario" ? line.image : line.photo;
  const applicationLabel = category === "warehouse" ? "COS 물품 대여 / 소모" : "대여 신청";
  const headerTitle = step === "category" ? "대여 신청" : step === "identity" ? `${category === "scenario" ? "시나리오 물품 대여자" : "COS 물품 사용자"} 정보` : step === "items" ? `${category === "scenario" ? "시나리오 물품" : "COS 물품"} 선택` : step === "done" ? `${applicationLabel} 완료` : `${applicationLabel} 확인`;
  function openImage(raw: string | undefined, title: string) { if (raw) setPreview({ src: getGoogleDriveImageUrl(raw), name: title }); }
  function acceptScenarioCart(items: BrowseCartItem[]) {
    setCart(items.map((item): ScenarioLine => {
      const object = scenarioItems.find((o) => o.id === item.id);
      const variant = object?.variants?.find((v) => v.id === item.variantId);
      return { kind: "scenario", ...item, stock: variant?.stock ?? object?.stock ?? item.quantity,
        image: variant?.image || object?.image, location: object?.rootSlot };
    }));
  }

  return <>
    {category === "scenario" && (step === "items" || step === "confirm") ? <div style={{ height: "100%", overflowY: "auto", display: step === "items" ? "block" : "none" }}>
      <BrowsePage scriptUrl={scriptUrl} connected={connected} isLightMode={isLightMode}
        showToast={showToast} isAdmin adminDirectBorrow adminCart={browseCart} initialStep="scenario"
        session={{ name, employeeId, affiliation: "cfgw", floor: floors.find((f) => f.id === floor)?.name || floor, unit }}
        onBack={() => setStep("identity")}
        onAdminBack={(items) => { acceptScenarioCart(items); setStep("identity"); }}
        onGoBorrow={({ items }) => {
          if (!items?.length) { showToast("대여할 물품을 담아주세요.", "warn"); return; }
          acceptScenarioCart(items);
          setStep("confirm");
        }} />
    </div> : null}
    <div ref={rootRef} className="admin-borrow-root" style={{ height: "100%", overflowY: "auto", background: C.bg, color: C.text, display: category === "scenario" && step === "items" ? "none" : "block" }}>
    <style>{`@media (min-width:900px){.admin-borrow-root{zoom:1.15}} @media (max-width:600px){.admin-tool-cart-lines{order:3;flex-basis:100%!important}}`}</style>
    <div ref={stickyHeaderRef} style={{ position: "sticky", top: 0, zIndex: 20, background: C.card }}>
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: `1px solid ${C.border}`, background: C.card }}>
      {step !== "category" && step !== "done" ? <button onClick={goBack} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.card, color: C.label, cursor: "pointer", fontSize: 13, fontWeight: 600 }}><ArrowLeft size={15} /> 이전</button> : null}
      <h1 style={{ fontSize: 17, fontWeight: 800, margin: 0, flex: 1 }}>{headerTitle}</h1>
      {step !== "category" && name ? <span style={{ fontSize: 12, color: C.label, fontWeight: 600 }}>{name}{employeeId ? ` · ${employeeId}` : ""}</span> : null}
    </div>

    {step === "items" && category === "warehouse" ? <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, padding: "10px 16px", background: C.card, borderBottom: `1px solid ${C.border}` }}>
      <ShoppingCart size={17} style={{ color: cart.length ? C.accentText : C.label, flexShrink: 0 }} /><span style={{ fontSize: 13, fontWeight: 800, whiteSpace: "nowrap" }}>장바구니 <span style={{ color: cart.length ? C.accentText : C.label }}>{cartTypeCount}종</span></span>
      <button type="button" disabled={!cart.length} onClick={() => setStep("confirm")}
        style={{ ...primary, flex: "0 0 auto", padding: "10px 16px", borderRadius: 10, fontSize: 13, whiteSpace: "nowrap", opacity: cart.length ? 1 : .45, cursor: cart.length ? "pointer" : "not-allowed" }}>
        다음 <ChevronRight size={15} />
      </button>
      <div className="admin-tool-cart-lines" style={{ flex: 1, minWidth: 0, display: "flex", gap: 8, overflowX: "auto" }}>{cart.length ? cart.map((line) => <div key={lineKey(line)} style={{ position: "relative", flexShrink: 0, display: "flex", alignItems: "center", gap: 7, borderRadius: 10, padding: "5px 22px 5px 5px", background: C.accentSoft, border: `1px solid ${C.border}` }}><button onClick={() => changeQty(lineKey(line), -line.quantity)} style={{ position: "absolute", top: 2, right: 2, width: 17, height: 17, borderRadius: 99, border: 0, background: C.card, color: C.label, padding: 0 }}><X size={11} /></button><button onClick={() => openImage(imgOf(line), line.name)} style={{ width: 34, height: 34, borderRadius: 8, overflow: "hidden", border: 0, padding: 0, background: C.cardSub }}>{imgOf(line) ? <img src={getThumbImageUrl(imgOf(line)!)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Boxes size={15} color={C.label} />}</button><span style={{ maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 700, color: C.accentText }}>{line.name}{line.variantName ? ` · ${line.variantName}` : ""}{line.quantity > 1 ? ` ×${line.quantity}` : ""}</span></div>) : <span style={{ fontSize: 12, color: C.label }}>아직 담은 물품이 없습니다</span>}</div>
      <button type="button" onClick={() => { if (cart.length && window.confirm("담은 물품을 모두 취소할까요?")) setCart([]); }} disabled={!cart.length}
        style={{ flexShrink: 0, marginLeft: "auto", padding: "5px 8px", borderRadius: 7, border: `1px solid ${C.border}`, background: "transparent", color: C.label, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", cursor: cart.length ? "pointer" : "default", opacity: cart.length ? .8 : .4 }}>전체 취소</button>
    </div> : null}
    </div>

    <div style={{ maxWidth: step === "items" ? 1560 : 620, margin: "0 auto", padding: step === "items" ? "0 16px 120px" : "24px 16px 120px" }}>
      <div key={step} className="step-forward">
        {step === "category" ? <div><div style={{ marginBottom: 20, padding: "14px 16px", background: C.accentSoft, borderRadius: 12, borderLeft: `4px solid ${C.accent}`, fontSize: 13, lineHeight: 1.6 }}>일반 대여자와 같은 절차로 관리자가 대신 신청합니다. 한 신청에는 한 분야의 물품만 담을 수 있습니다.</div><div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[{ key: "scenario" as const, icon: <Boxes size={22} />, title: "시나리오 물품", sub: "오브젝트와 종류를 사진으로 확인해 신청합니다" }, { key: "warehouse" as const, icon: <Warehouse size={22} />, title: "COS 물품", sub: "물품별로 대여 또는 소모를 선택해 처리합니다" }].map((item) => <button key={item.key} onClick={() => chooseCategory(item.key)} style={{ display: "flex", alignItems: "center", gap: 16, padding: "22px 18px", border: `1px solid ${C.border}`, borderRadius: 16, background: C.card, color: C.text, cursor: "pointer", textAlign: "left" }}><span style={{ flex: "0 0 48px", width: 48, height: 48, borderRadius: 13, background: C.accentSoft, color: C.accentText, display: "grid", placeItems: "center" }}>{item.icon}</span><span style={{ flex: 1 }}><b style={{ display: "block", fontSize: 15, marginBottom: 4 }}>{item.title}</b><span style={{ display: "block", fontSize: 12, color: C.label }}>{item.sub}</span></span><ChevronRight size={16} color={C.border} /></button>)}
        </div></div> : null}

        {step === "identity" ? <div><div style={{ marginBottom: 20, padding: "14px 16px", background: C.accentSoft, borderRadius: 12, borderLeft: `4px solid ${C.accent}`, fontSize: 13, lineHeight: 1.6 }}>{category === "warehouse" ? "사용자 이름을 선택해주세요. COS 물품은 좌석 위치 없이 대여 또는 소모할 수 있습니다." : "대여자 이름을 검색해 선택하면 등록된 사번이 자동으로 연결됩니다. 좌석은 일반 대여 신청과 동일하게 필수입니다."}</div>
          <label style={label}>{category === "warehouse" ? "사용자 이름" : "대여자 이름"}</label><div style={{ marginBottom: 20 }}><RegisteredUserPicker scriptUrl={scriptUrl} name={name} employeeId={employeeId} onChange={(nextName, nextId) => { setName(nextName); setEmployeeId(nextId); setFloor(""); setUnit(""); setCart([]); }} isLightMode={isLightMode} placeholder="이름을 검색한 뒤 명부에서 선택" /></div>
          {category === "scenario" ? <><div style={{ marginBottom: 20, padding: "14px 16px", borderRadius: 12, border: `1px solid ${C.border}`, background: C.cardSub }}>
            <label style={label}>자주 사용하는 유닛</label>
            {!employeeId ? <p style={{ color: C.label, fontSize: 13, margin: 0 }}>이름을 검색한 뒤 명부에서 선택하면 자주 사용한 유닛을 추천합니다.</p>
              : seatRecommendationsLoading || seatMapLoading ? <p role="status" style={{ color: C.label, fontSize: 13 }}>대여 이력에서 유닛을 확인하는 중입니다...</p>
              : seatRecommendationsError ? <p role="status" style={{ color: C.label, fontSize: 13 }}>{seatRecommendationsError}</p>
              : recommendedSeats.length ? <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{recommendedSeats.map((seat) => <button
                key={`${seat.floor}:${seat.unit}`} type="button" aria-pressed={floor === seat.floor && unit === seat.unit}
                onClick={() => { setFloor(seat.floor); setUnit(seat.unit); }}
                style={{ textAlign: "left", padding: "11px 14px", borderRadius: 12, border: `1px solid ${floor === seat.floor && unit === seat.unit ? C.accent : C.border}`, background: floor === seat.floor && unit === seat.unit ? C.accentSoft : C.card, color: C.text, cursor: "pointer" }}>
                <b style={{ display: "block", fontSize: 13 }}>{floors.find((f) => f.id === seat.floor)?.name || seat.floor} · {seat.unit}</b>
                <span style={{ display: "block", marginTop: 4, fontSize: 12, color: C.label }}>대여 {seat.count}회</span>
              </button>)}</div> : <p style={{ color: C.label, fontSize: 13 }}>추천할 대여 이력이 없습니다. 아래에서 좌석을 선택해주세요.</p>}
          </div>
          <label style={label}>좌석 위치</label><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 24 }}><select value={floor} onChange={(e) => { setFloor(e.target.value); setUnit(""); }} style={input}><option value="">층수 선택</option>{floors.map((f) => <option key={f.id} value={f.id}>{f.name || f.id}</option>)}</select><select value={unit} onChange={(e) => setUnit(e.target.value)} disabled={!floor} style={{ ...input, opacity: floor ? 1 : .6 }}><option value="">유닛 선택</option>{availableUnits.map((u) => <option key={u.label}>{u.label}</option>)}</select></div></> : null}
          <div style={{ display: "flex", gap: 10 }}><button onClick={goBack} style={secondary}>이전</button><button onClick={goToItems} style={primary}>계속하기 <ChevronRight size={15} /></button></div>
        </div> : null}

        {step === "items" && category === "warehouse" ? <div><div style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "14px 0", position: "sticky", top: stickyHeaderHeight, zIndex: 10, background: C.bg }}><div style={{ flex: "2 1 250px", position: "relative" }}><Search size={15} style={{ position: "absolute", left: 12, top: 12, color: C.label }} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="물품명 · ID · 위치 검색" style={{ ...input, padding: "10px 12px 10px 36px", fontSize: 13 }} /></div>
          {(() => {
            const activeFilterCount = (filterA ? 1 : 0) + (filterB ? 1 : 0) + (filterC ? 1 : 0) + (category === "scenario" && requestFilter !== "all" ? 1 : 0) + (!inStockOnly ? 1 : 0);
            return (
              <>
                <button type="button" onClick={() => setFiltersOpen((v) => !v)} style={{ padding: "10px 14px", borderRadius: 10, border: `1px solid ${filtersOpen || activeFilterCount > 0 ? C.accent : C.border}`, background: filtersOpen || activeFilterCount > 0 ? C.accentSoft : C.card, color: C.accentText, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 800, whiteSpace: "nowrap" }}><SlidersHorizontal size={15} />필터{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}{filtersOpen ? " 접기" : ""}</button>
                {activeFilterCount > 0 && (
                  <button type="button" onClick={() => { setFilterA(""); setFilterB(""); setFilterC(""); setRequestFilter("all"); setInStockOnly(true); }} title="필터 초기화" style={{ padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.card, color: C.label, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}><X size={14} /> 초기화</button>
                )}
              </>
            );
          })()}
          {filtersOpen ? <>{category === "scenario" ? <><Filter value={filterA} setValue={(v) => { setFilterA(v); setFilterB(""); }} options={scenarioFilters.categories} label="분류" C={C} /><Filter value={filterB} setValue={setFilterB} options={scenarioFilters.subcategories} label="세부분류" C={C} /><Filter value={filterC} setValue={setFilterC} options={scenarioFilters.sectors} label="구역" C={C} /><select aria-label="물품 구분" value={requestFilter} onChange={(e) => setRequestFilter(e.target.value as typeof requestFilter)} style={{ flex: "1 1 150px", padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: 12 }}><option value="all">전체 물품</option><option value="request">Request 물품만</option><option value="normal">일반 물품만</option></select></> : <><Filter value={filterA} setValue={setFilterA} options={warehouseFilters.racks} label="랙" C={C} /><Filter value={filterB} setValue={setFilterB} options={warehouseFilters.managers} label="담당자" C={C} /><Filter value={filterC} setValue={setFilterC} options={warehouseFilters.specs} label="규격" C={C} /></>}
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, padding: "0 4px" }}><input type="checkbox" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)} />재고 있음</label></> : null}</div>
          {loading ? <div style={{ textAlign: "center", padding: 64, color: C.label }}>물품 목록을 불러오는 중입니다...</div> : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 16 }}>{category === "scenario" ? filteredScenario.map((it) => <ScenarioCard key={it.id} item={it} C={C} cart={cart} openVariant={() => setVariantPick(it)} add={addScenario} changeQty={changeQty} openImage={openImage} />) : filteredWarehouse.map((it) => <WarehouseCard key={it.rowIndex} item={it} C={C} cart={cart} add={addWarehouse} changeQty={changeQty} changeAction={changeAction} openImage={openImage} />)}</div>}
        </div> : null}

        {step === "confirm" ? <div><div style={{ marginBottom: 20, padding: "14px 16px", background: C.accentSoft, borderRadius: 12, borderLeft: `4px solid ${C.accent}`, fontSize: 13, lineHeight: 1.6 }}><b>{name}</b>님 명의로 아래 물품을 신청합니다.{category === "warehouse" ? <div style={{ marginTop: 8, color: C.label }}>대여는 반납 대상이며, 소모는 재고만 차감하고 대여 확인·반납 목록에 표시하지 않습니다.</div> : null}</div>{cart.map((line) => <CartRow key={lineKey(line)} C={C} line={line} changeQty={changeQty} changeAction={changeAction} />)}<label style={{ ...label, marginTop: 20 }}>{category === "warehouse" ? "사용 목적 / 메모" : "대여 목적 / 메모"}</label><textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={3} placeholder="선택 입력" style={{ ...input, resize: "vertical", marginBottom: 20 }} /><div style={{ display: "flex", gap: 10 }}><button onClick={goBack} style={secondary}>이전</button><button disabled={submitting || !cart.length} onClick={submit} style={{ ...primary, background: C.success, opacity: submitting ? .7 : 1 }}><Check size={15} />{submitting ? "처리 중..." : category === "warehouse" ? "대여 / 소모 처리하기" : "대여 신청하기"}</button></div></div> : null}

        {step === "done" ? <div style={{ textAlign: "center" }}><CheckCircle2 size={58} style={{ color: C.success, marginBottom: 14 }} /><h2 style={{ margin: "0 0 8px", fontSize: 22 }}>{applicationLabel} 완료</h2><p style={{ margin: "0 0 22px", color: C.label, fontSize: 13, lineHeight: 1.6 }}><b style={{ color: C.text }}>{name}</b> · 사번 {employeeId}{category === "scenario" ? <><br />{floor} · {unit}</> : null}</p><div style={{ textAlign: "left", marginBottom: 20 }}>{cart.map((line) => <div key={lineKey(line)} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "11px 13px", borderBottom: `1px solid ${C.border}`, fontSize: 13 }}><span>{line.name}{line.variantName ? ` · ${line.variantName}` : ""}</span><b>{line.quantity}개{line.kind === "warehouse" ? ` · ${line.action}` : ""}</b></div>)}</div>{category === "warehouse" ? <p style={{ margin: "0 0 20px", fontSize: 13, lineHeight: 1.6, color: C.label }}>대여·소모 수량을 재고에 반영했습니다. 소모한 물품은 반납 대상에 포함되지 않습니다.</p> : null}<button onClick={onClose} style={{ ...primary, width: "100%" }}>대여 확인으로 돌아가기</button></div> : null}
      </div>
    </div>
    {variantPick ? <div onClick={() => setVariantPick(null)} style={{ position: "fixed", inset: 0, zIndex: 5000, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}><div onClick={(e) => e.stopPropagation()} style={{ width: "min(420px,100%)", maxHeight: "80vh", overflowY: "auto", padding: 18, borderRadius: 16, border: `1.5px solid ${C.border}`, background: C.card }}><div style={{ fontSize: 15, fontWeight: 800 }}>어떤 종류를 담으시나요?</div><div style={{ fontSize: 12, color: C.label, margin: "3px 0 12px" }}>{variantPick.name}</div><div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{(variantPick.variants || []).map((v) => { const taken = cart.filter((x) => x.kind === "scenario" && x.id === variantPick.id && x.variantId === v.id).reduce((n, x) => n + x.quantity, 0); const out = v.stock <= 0; return <button key={v.id} disabled={out} onClick={() => { addScenario(variantPick, v); setVariantPick(null); }} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 11, border: `1.5px solid ${C.border}`, background: C.cardSub, color: out ? C.label : C.text, cursor: out ? "not-allowed" : "pointer", textAlign: "left", opacity: out ? .55 : 1 }}><span onClick={(e) => { if (v.image || variantPick.image) { e.stopPropagation(); openImage(v.image || variantPick.image, `${variantPick.name} · ${v.name}`); } }} style={{ width: 48, height: 48, flexShrink: 0, borderRadius: 9, overflow: "hidden", background: C.card, display: "grid", placeItems: "center", cursor: v.image || variantPick.image ? "zoom-in" : "default" }}>{v.image || variantPick.image ? <img src={getThumbImageUrl(v.image || variantPick.image)} alt="" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Boxes size={18} color={C.label} />}</span><span style={{ flex: 1, minWidth: 0 }}><b style={{ display: "block", fontSize: 13 }}>{v.name}{taken ? ` · 담김 ${taken}개` : ""}</b><span style={{ display: "block", marginTop: 2, fontSize: 11.5, color: C.label }}>{out ? "재고 없음" : `재고 ${v.stock}개`}</span></span></button>; })}</div><button onClick={() => setVariantPick(null)} style={{ marginTop: 14, width: "100%", padding: 11, borderRadius: 10, border: `1px solid ${C.border}`, background: "transparent", color: C.label, cursor: "pointer", fontSize: 12.5, fontWeight: 700 }}>닫기</button></div></div> : null}
    {preview ? <div onClick={() => setPreview(null)} style={{ position: "fixed", inset: 0, zIndex: 5100, background: "rgba(0,0,0,.84)", display: "grid", placeItems: "center", padding: 24, cursor: "zoom-out" }}><img src={preview.src} alt={preview.name} style={{ maxWidth: "90vw", maxHeight: "84vh", objectFit: "contain" }} /></div> : null}
  </div></>;
}

function Filter({ value, setValue, options, label, C }: any) { return <select aria-label={label} value={value} onChange={(e) => setValue(e.target.value)} style={{ flex: "1 1 125px", padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: 12 }}><option value="">{label} 전체</option>{options.map((v: string) => <option key={v}>{v}</option>)}</select>; }

function ScenarioCard({ item, C, cart, openVariant, add, changeQty, openImage }: any) {
  const lines = cart.filter((x: CartLine) => x.kind === "scenario" && x.id === item.id);
  const simple = lines.find((x: ScenarioLine) => !x.variantId);
  const total = lines.reduce((n: number, x: ScenarioLine) => n + x.quantity, 0);
  return <div style={{ border: `1px solid ${lines.length ? C.accent : C.border}`, background: C.card, borderRadius: 16, overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: lines.length ? "0 8px 20px -8px rgba(37,99,235,.4)" : "0 2px 4px rgba(0,0,0,.04)" }}><button onClick={() => openImage(item.image, item.name)} style={{ height: 150, border: 0, padding: 0, background: C.cardSub, borderBottom: `1px solid ${C.border}`, cursor: item.image ? "zoom-in" : "default" }}>{item.image ? <img src={getThumbImageUrl(item.image)} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Boxes size={40} color={C.border} />}</button><div style={{ padding: "12px 14px", flex: 1, display: "flex", flexDirection: "column", gap: 6 }}><b style={{ fontSize: 14, lineHeight: 1.35 }}>{item.name}</b><span style={{ fontSize: 11, color: C.label }}>{item.id}</span><div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}><span style={{ color: C.success, background: C.successSoft, padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600 }}>재고 {item.stock}</span>{item.requestFor !== undefined ? <span title={item.requestFor ? `${item.requestFor} 업체 request용` : "Request 물품"} style={{ color: C.accentText, background: C.accentSoft, padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700 }}>📌 {item.requestFor || "Request"}</span> : null}</div><div style={{ marginTop: "auto", paddingTop: 8 }}>{item.variants?.length ? <button onClick={openVariant} style={{ width: "100%", padding: 9, borderRadius: 10, border: 0, background: C.accent, color: "#fff", fontSize: 13, fontWeight: 700 }}><ShoppingCart size={14} /> {total ? `종류 선택 · 담김 ${total}개` : "장바구니 담기"}</button> : simple ? <Qty C={C} qty={simple.quantity} minus={() => changeQty(lineKey(simple), -1)} plus={() => changeQty(lineKey(simple), 1)} /> : <button disabled={item.stock <= 0} onClick={() => add(item)} style={{ width: "100%", padding: 9, borderRadius: 10, border: 0, background: item.stock > 0 ? C.accent : C.border, color: "#fff", fontSize: 13, fontWeight: 700 }}><ShoppingCart size={14} /> 장바구니 담기</button>}</div></div></div>;
}

function WarehouseCard({ item, C, cart, add, changeQty, changeAction, openImage }: any) { const stock = Number(item.stock); const line = cart.find((x: CartLine) => x.kind === "warehouse" && x.rowIndex === item.rowIndex) as WarehouseLine | undefined; return <div style={{ border: `1px solid ${line ? C.accent : C.border}`, background: C.card, borderRadius: 16, overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: line ? "0 8px 20px -8px rgba(37,99,235,.4)" : "0 2px 4px rgba(0,0,0,.04)" }}><button onClick={() => openImage(item.photo, item.name)} style={{ height: 150, border: 0, padding: 0, background: C.cardSub, borderBottom: `1px solid ${C.border}` }}>{item.photo ? <img src={getThumbImageUrl(item.photo)} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Warehouse size={40} color={C.border} />}</button><div style={{ padding: "12px 14px", flex: 1, display: "flex", flexDirection: "column", gap: 6 }}><b style={{ fontSize: 14, lineHeight: 1.35 }}>{item.name}</b><div><span style={{ color: C.success, background: C.successSoft, padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600 }}>재고 {Number.isFinite(stock) ? stock : "-"}</span></div><div style={{ marginTop: "auto", paddingTop: 8 }}>{line ? <WarehouseActionChoice C={C} line={line} changeAction={changeAction} /> : item.isConsumable ? <div style={{ marginBottom: 8, fontSize: 11, color: C.label }}>소모품 · 반납 대상 아님</div> : null}{line ? <Qty C={C} qty={line.quantity} minus={() => changeQty(lineKey(line), -1)} plus={() => changeQty(lineKey(line), 1)} /> : <button disabled={!Number.isFinite(stock) || stock <= 0} onClick={() => add(item)} style={{ width: "100%", padding: 9, borderRadius: 10, border: 0, background: stock > 0 ? C.accent : C.border, color: "#fff", fontSize: 13, fontWeight: 700 }}><ShoppingCart size={14} /> {item.isConsumable ? "소모로 담기" : "장바구니 담기"}</button>}</div></div></div>; }

function Qty({ C, qty, minus, plus }: any) { return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: C.accentSoft, borderRadius: 10, padding: 6 }}><button onClick={minus} style={{ width: 28, height: 28, borderRadius: 8, border: 0, background: C.card, color: C.text }}><Minus size={13} /></button><b style={{ minWidth: 22, textAlign: "center", color: C.accentText }}>{qty}</b><button onClick={plus} style={{ width: 28, height: 28, borderRadius: 8, border: 0, background: C.card, color: C.text }}><Plus size={13} /></button></div>; }
function WarehouseActionChoice({ C, line, changeAction }: { C: any; line: WarehouseLine; changeAction: (key: string, action: "대여" | "소모") => void }) {
  return <div style={{ marginBottom: 9 }}>
    <div role="group" aria-label={`${line.name} 사용 방식`} style={{ display: "flex", gap: 5 }}>
      {(["대여", "소모"] as const).map((action) => <button key={action} type="button"
        aria-pressed={line.action === action} disabled={line.isConsumable && action === "대여"}
        onClick={() => changeAction(lineKey(line), action)}
        style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: `1px solid ${line.action === action ? C.accent : C.border}`,
          background: line.action === action ? C.accentSoft : C.card, color: line.action === action ? C.accentText : C.label,
          fontSize: 12, fontWeight: 800, cursor: line.isConsumable && action === "대여" ? "not-allowed" : "pointer",
          opacity: line.isConsumable && action === "대여" ? .4 : 1 }}>{action}</button>)}
    </div>
    <div style={{ marginTop: 5, fontSize: 11, lineHeight: 1.5, color: C.label }}>{line.action === "소모" ? "소모 · 재고 차감, 반납 없음" : "대여 · 사용 후 반납"}</div>
  </div>;
}

function CartRow({ C, line, changeQty, changeAction }: any) {
  return <div style={{ padding: "12px", background: C.cardSub, border: `1px solid ${C.border}`, borderRadius: 10, marginBottom: 8 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 150px", minWidth: 0 }}>
        <b style={{ fontSize: 13 }}>{line.name}</b>
        {line.variantName ? <span style={{ marginLeft: 5, fontSize: 10.5, padding: "1px 7px", borderRadius: 99, background: C.accentSoft, color: C.accentText }}>{line.variantName}</span> : null}
        <div style={{ fontSize: 11, color: C.label }}>{line.location || "위치 없음"}</div>
      </div>
      <Qty C={C} qty={line.quantity} minus={() => changeQty(lineKey(line), -1)} plus={() => changeQty(lineKey(line), 1)} />
      <button aria-label={`${line.name} 삭제`} onClick={() => changeQty(lineKey(line), -line.quantity)} style={{ width: 26, height: 26, borderRadius: 7, border: 0, background: C.errorSoft, color: C.error }}><Trash2 size={12} /></button>
    </div>
    {line.kind === "warehouse" ? <div style={{ marginTop: 10 }}><WarehouseActionChoice C={C} line={line} changeAction={changeAction} /></div> : null}
  </div>;
}
