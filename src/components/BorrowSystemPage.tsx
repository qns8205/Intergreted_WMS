import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  ArrowLeft, Search, User, Building2, MoreHorizontal, Fingerprint, Boxes,
  HandHelping, PackageOpen, Undo2, MapPin, ChevronRight, Plus, Minus, X, Check,
  CheckCircle2, AlertCircle, Bookmark, RotateCcw, Feather, Flame, PlusCircle, IdCard,
  Warehouse, Trash2,
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
  // 열람에서 창고 물품을 담아 넘어오면 창고 대여로, 시나리오면 일반대여로 직행
  const rootMode: Mode = initialKind === "warehouse" ? "wborrow"
    : initialKind === "scenario" ? "b1"
    : entry === "return" ? "pickReturnKind" : "pickBorrowKind";
  /* ---------- 팔레트 (WMS 디자인 시스템) ---------- */
  const C = {
    bg: isLightMode ? "#f8fafc" : "#0b0f19",
    card: isLightMode ? "#ffffff" : "#1e293b",
    cardSub: isLightMode ? "#f8fafc" : "#151d30",
    border: isLightMode ? "#e2e8f0" : "#334155",
    text: isLightMode ? "#0f172a" : "#f1f5f9",
    label: isLightMode ? "#475569" : "#94a3b8",
    accent: "#475569",
    accentSoft: "rgba(71, 85, 105, 0.15)",
    accentText: isLightMode ? "#334155" : "#94a3b8",
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
  const [imageModalUrl, setImageModalUrl] = useState<string>("");
  const [resultInfo, setResultInfo] = useState<{ ok: boolean; title: string; sub: string; receipt?: { borrower: string; date: string; due?: string; action: string; items: { name: string; qty: number; location?: string }[] } }>({ ok: true, title: "", sub: "" });

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

  /* ---------- 창고 물품 상태 ---------- */
  const [whItems, setWhItems] = useState<WarehouseItem[]>([]);
  const [whLoaded, setWhLoaded] = useState(false);
  const [whLoading, setWhLoading] = useState(false);
  const [whCart, setWhCart] = useState<WarehouseCartItem[]>([]);
  const [whSearch, setWhSearch] = useState("");
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
  const loadWarehouse = useCallback(async () => {
    if (whLoaded) return;
    setWhLoading(true);
    try {
      if (connected && scriptUrl) setWhItems(await fetchWarehouseInventory(scriptUrl));
      else setWhItems([
        { rowIndex: 2, location: "A-01", name: "랙 선반용 합판", photo: "", stock: 12, spec: "", note: "", manager: "고성민" },
        { rowIndex: 3, location: "B-01", name: "프로스펙스 손목 보호대", photo: "", stock: 4, spec: "", note: "", manager: "오피스" },
      ]);
      setWhLoaded(true);
    } catch (e: any) { showToast(`창고 물품을 불러오지 못했습니다: ${e.message}`, "error"); }
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
    } finally {
      setItemsLoading(false);
    }
  }, [connected, scriptUrl, itemsLoading, showToast]);

  useEffect(() => {
    if ((mode === "b3g" || mode === "b4s") && !itemsLoaded && !itemsLoading) {
      loadItems();
    }
  }, [mode, itemsLoaded, itemsLoading, loadItems]);

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
    if (cat && it.category !== cat) return false;
    if (sub && it.subcategory !== sub) return false;
    if (!q) return true;
    const query = q.toLowerCase();
    const slotRaw = String(it.rootSlot ?? "");
    const slotPad = padSlot(slotRaw);
    const slotTrim = slotPad.replace(/^0+/, "");
    const qTrim = query.replace(/^0+/, "");
    const slotHit = !!slotRaw && (slotRaw.toLowerCase().includes(query) || slotPad.includes(query) || (!!qTrim && slotTrim === qTrim));
    return (
      it.name.toLowerCase().includes(query) || it.id.includes(query) ||
      (it.category || "").toLowerCase().includes(query) ||
      (it.subcategory || "").toLowerCase().includes(query) || slotHit
    );
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

  function StockBadges({ stock, rented }: { stock: number; rented: number }) {
    return (
      <div style={{ display: "flex", gap: "6px", marginTop: "4px", fontSize: "11px", fontWeight: 600 }}>
        <span style={{ color: C.success, background: C.successSoft, padding: "2px 8px", borderRadius: "6px" }}>재고 {stock ?? 0}</span>
        <span style={{ color: C.accentText, background: C.accentSoft, padding: "2px 8px", borderRadius: "6px" }}>대여 중 {rented ?? 0}</span>
      </div>
    );
  }

  function LocBadge({ slot }: { slot?: string }) {
    if (!slot) return null;
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", fontWeight: 700, color: C.warn, background: C.warnSoft, borderRadius: "6px", padding: "2px 8px", fontFamily: "monospace" }}>
        <MapPin size={11} />{padSlot(slot)}
      </span>
    );
  }

  function Thumb({ url, size = 48 }: { url?: string; size?: number }) {
    if (!url) return null;
    const src = getGoogleDriveImageUrl(url);
    return (
      <div
        onClick={(e) => { e.stopPropagation(); setImageModalUrl(src); }}
        style={{ flex: `0 0 ${size}px`, width: size, height: size, borderRadius: "8px", overflow: "hidden", border: `1px solid ${C.border}`, cursor: "zoom-in", background: C.cardSub, display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        <img src={src} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "cover" }} />
      </div>
    );
  }

  function Spinner({ size = 18, light = false }: { size?: number; light?: boolean }) {
    return (
      <span style={{
        width: size, height: size, borderRadius: "50%", display: "inline-block",
        border: `3px solid ${light ? "rgba(255,255,255,0.35)" : C.border}`,
        borderTopColor: light ? "#fff" : C.accent, animation: "bsp-spin 0.9s linear infinite",
      }} />
    );
  }

  function TypeCard({ active, icon, text, onClick, small }: { active: boolean; icon: React.ReactNode; text: string; onClick: () => void; small?: boolean }) {
    return (
      <div
        onClick={onClick}
        style={{
          flex: 1, cursor: "pointer", borderRadius: "14px", textAlign: "center",
          padding: small ? "12px 6px" : "20px 10px",
          border: `1px solid ${active ? C.accent : C.border}`,
          background: active ? C.accentSoft : C.card,
          color: active ? C.accentText : C.label,
          display: "flex", flexDirection: "column", alignItems: "center", gap: "8px",
          transition: "all 0.15s",
        }}
      >
        {icon}
        <span style={{ fontWeight: 700, fontSize: small ? "12px" : "13px", color: active ? C.accentText : C.text }}>{text}</span>
      </div>
    );
  }

  /* ══════════════════════ 물품 피커 (일반/추가 공용) ══════════════════════ */

  function toggleCart(list: CartItem[], setList: (v: CartItem[]) => void, item: ObjectItem) {
    const idx = list.findIndex((c) => c.id === item.id);
    if (idx === -1) {
      if ((item.stock || 0) < 1) { showToast("재고가 부족하여 대여할 수 없습니다. (현재 재고: 0)", "warn"); return; }
      setList([...list, { id: item.id, name: item.name, quantity: 1, rootSlot: item.rootSlot }]);
    } else {
      setList(list.filter((_, i) => i !== idx));
    }
  }

  function changeQty(list: CartItem[], setList: (v: CartItem[]) => void, idx: number, delta: number) {
    const item = list[idx];
    const orig = objectItems.find((o) => o.id === item.id);
    const maxStock = orig ? orig.stock || 0 : 0;
    const next = item.quantity + delta;
    if (delta > 0 && next > maxStock) { showToast(`재고가 부족합니다. (최대 재고: ${maxStock}개)`, "warn"); return; }
    if (next < 1) return;
    setList(list.map((c, i) => (i === idx ? { ...c, quantity: next } : c)));
  }

  function CartBox({ list, setList, emptyText }: { list: CartItem[]; setList: (v: CartItem[]) => void; emptyText: string }) {
    return (
      <div style={{ marginBottom: "14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
          <span style={{ fontSize: "13px", color: C.label }}>선택된 물품</span>
          <span style={{ fontSize: "11px", fontWeight: 700, background: C.accent, color: "#fff", borderRadius: "14px", padding: "2px 10px" }}>{list.length}개</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "180px", overflowY: "auto" }}>
          {list.length === 0 ? (
            <div style={{ textAlign: "center", color: C.label, fontSize: "12px", padding: "12px 0", border: `1px dashed ${C.border}`, borderRadius: "10px" }}>{emptyText}</div>
          ) : (
            list.map((item, idx) => (
              <div key={item.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", background: C.cardSub, border: `1px solid ${C.border}`, borderRadius: "10px" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: "13px", color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.name}</div>
                  <div style={{ fontSize: "11px", color: C.label }}>ID: {item.id}</div>
                  {item.rootSlot ? <div style={{ marginTop: "3px" }}><LocBadge slot={item.rootSlot} /></div> : null}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                  <button onClick={() => changeQty(list, setList, idx, -1)} style={{ width: 28, height: 28, borderRadius: "8px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Minus size={13} /></button>
                  <span style={{ fontWeight: 700, minWidth: "20px", textAlign: "center", color: C.text, fontSize: "13px" }}>{item.quantity}</span>
                  <button onClick={() => changeQty(list, setList, idx, 1)} style={{ width: 28, height: 28, borderRadius: "8px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={13} /></button>
                </div>
                <button onClick={() => setList(list.filter((_, i) => i !== idx))} style={{ width: 28, height: 28, borderRadius: "8px", border: "none", background: C.errorSoft, color: C.error, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={13} /></button>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  function ItemPicker({
    list, setList, search, setSearch, cat, setCat, sub, setSub,
  }: {
    list: CartItem[]; setList: (v: CartItem[]) => void;
    search: string; setSearch: (v: string) => void;
    cat: string; setCat: (v: string) => void;
    sub: string; setSub: (v: string) => void;
  }) {
    const filtered = useMemo(
      () => objectItems.filter((it) => matchesFilters(it, search.trim(), cat, sub)),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [objectItems, search, cat, sub]
    );
    const selectStyle: React.CSSProperties = { ...inputStyle, padding: "10px 12px", fontSize: "13px", flex: 1, minWidth: 0 };
    return (
      <div>
        <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
          <select value={cat} onChange={(e) => { setCat(e.target.value); setSub(""); }} style={selectStyle}>
            <option value="">전체 카테고리</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={sub} onChange={(e) => setSub(e.target.value)} style={selectStyle}>
            <option value="">전체 서브카테고리</option>
            {subsOf(cat).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div style={{ position: "relative", marginBottom: "8px" }}>
          <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ID · 물품명 · 위치(예: 000060)로 검색..." style={{ ...inputStyle, paddingLeft: "36px", padding: "11px 12px 11px 36px", fontSize: "14px" }} />
        </div>
        <div style={{ border: `1px solid ${C.border}`, borderRadius: "12px", overflow: "hidden", maxHeight: "260px", overflowY: "auto" }}>
          {!itemsLoaded ? (
            <div style={{ padding: "24px", textAlign: "center", color: C.label, fontSize: "13px", display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
              <Spinner /> 물품 목록을 불러오는 중...
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: "24px", textAlign: "center", color: C.label, fontSize: "13px" }}>검색 결과가 없습니다.</div>
          ) : (
            filtered.map((it) => {
              const inCart = list.some((c) => c.id === it.id);
              return (
                <div
                  key={it.id}
                  onClick={() => toggleCart(list, setList, it)}
                  style={{ display: "flex", alignItems: "center", gap: "10px", padding: "11px 12px", borderBottom: `1px solid ${C.border}`, cursor: "pointer", background: inCart ? C.accentSoft : "transparent" }}
                >
                  <input type="checkbox" readOnly checked={inCart} style={{ width: 17, height: 17, accentColor: C.accent, flexShrink: 0 }} />
                  <Thumb url={it.image} size={44} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: "13px", color: C.text, lineHeight: 1.3, wordBreak: "break-word" }}>{it.name}</div>
                    <div style={{ fontSize: "11px", color: C.label }}>ID: {it.id}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", marginTop: "2px" }}>
                      {it.category ? (
                        <span style={{ fontSize: "10px", fontWeight: 700, padding: "2px 7px", borderRadius: "6px", background: C.accentSoft, color: C.accentText }}>
                          {it.category}{it.subcategory ? ` · ${it.subcategory}` : ""}
                        </span>
                      ) : null}
                      <LocBadge slot={it.rootSlot} />
                    </div>
                    <StockBadges stock={it.stock} rented={it.rented} />
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div style={{ fontSize: "11px", color: C.label, textAlign: "right", marginTop: "4px" }}>
          {itemsLoaded ? `${filtered.length} / ${objectItems.length}개 물품` : ""}
        </div>
      </div>
    );
  }

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
    const applyResult = (scenario: ScenarioDefinition) => {
      setSidCart((prev) => prev.map((e) => (e.sid === val ? { ...e, loading: false, scenario } : e)));
    };
    if (connected && scriptUrl) {
      fetchScenarioDefinition(scriptUrl, val)
        .then(applyResult)
        .catch(() => applyResult({ sid: val, found: false, syncNeeded: true, blocked: false, blockReason: "", highLevelEn: "", highLevelKo: "", items: [] }));
    } else {
      setTimeout(() => applyResult({
        sid: val, found: true, syncNeeded: false, blocked: false, blockReason: "",
        highLevelEn: "Preview instruction", highLevelKo: "미리보기 안내",
        items: [{ id: "000008", name: "fruit", quantity: 1, rootSlot: "000060", stock: 15, rented: 8 }],
      }), 400);
    }
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
    const name = affiliation === "other" ? otherName.trim() : borrowerName.trim();
    const contact = { affiliation, employeeId: employeeId.trim() };
    const nowStr = nowString();
    const borrowList: BorrowEntry[] = [];

    if (itemType === "general") {
      if (cart.length === 0) { showToast("물품을 하나 이상 선택해주세요.", "warn"); return; }
      if (!generalOption) { showToast("대여 구분(추가 물품 대여 / Light Scenario / Wild Scenario)을 선택해주세요.", "warn"); return; }
      for (const c of cart) {
        const obj = objectItems.find((o) => o.id === c.id);
        const stock = obj ? obj.stock || 0 : 0;
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
        const stock = obj ? obj.stock || 0 : 0;
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
    try {
      if (connected && scriptUrl) {
        const res = await postRecordBorrow(scriptUrl, borrowList, appVersion);
        if (res.success && affiliation === "cfgw") clearBrowseCart(borrowerName.trim(), employeeId.trim());
        setResultInfo({ ok: res.success, title: res.success ? "신청 완료!" : "오류 발생", sub: res.message });
      } else {
        setResultInfo({ ok: true, title: "신청 완료!", sub: "성공적으로 접수되었습니다. (로컬 데모)" });
      }
      setMode("result");
    } catch (e: any) {
      setResultInfo({ ok: false, title: "오류 발생", sub: e.message || "다시 시도해주세요." });
      setMode("result");
    } finally {
      setSubmitting(false);
    }
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
    if (normalizeSearch(it.itemLabel || "").includes(query)) return true;
    const slotRaw = String(it.location ?? "");
    if (!slotRaw) return false;
    const slotPad = padSlot(slotRaw);
    const qTrim = query.replace(/^0+/, "");
    return slotPad.includes(query) || (!!qTrim && slotPad.replace(/^0+/, "") === qTrim);
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

  const returnTree = useMemo(() => {
    const query = normalizeSearch(returnSearch.trim());
    const sorted = unreturned.slice().sort((a, b) => (a.borrowDate || "") < (b.borrowDate || "") ? -1 : (a.borrowDate || "") > (b.borrowDate || "") ? 1 : 0);
    const byBorrower = groupBy<UnreturnedItem>(sorted, (it) => it.borrowerName || "(이름 없음)");
    const visible: { borrower: string; items: UnreturnedItem[] }[] = [];
    byBorrower.forEach(({ key: borrower, items }) => {
      if (!query) { visible.push({ borrower, items }); return; }
      const borrowerMatch = normalizeSearch(borrower).includes(query);
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

  function GroupCheckbox({ items }: { items: UnreturnedItem[] }) {
    const ref = useRef<HTMLInputElement>(null);
    const checkedCount = items.filter((it) => selectedReturn[keyOf(it)] !== undefined).length;
    const all = items.length > 0 && checkedCount === items.length;
    useEffect(() => {
      if (ref.current) ref.current.indeterminate = checkedCount > 0 && !all;
    }, [checkedCount, all]);
    return (
      <input
        ref={ref} type="checkbox" checked={all}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => toggleReturnKeys(items, e.target.checked)}
        style={{ width: 17, height: 17, accentColor: C.accent, flexShrink: 0, cursor: "pointer" }}
      />
    );
  }

  function GroupSection({ gKey, title, icon, items, level, children }: {
    key?: string | number; gKey: string; title: React.ReactNode; icon?: React.ReactNode; items: UnreturnedItem[]; level: number; children: React.ReactNode;
  }) {
    const isOpen = !!expanded[gKey];
    const headerBg = level === 1 ? C.cardSub : "transparent";
    return (
      <div style={{ border: `1px ${level >= 3 ? "dashed" : "solid"} ${C.border}`, borderRadius: "12px", marginBottom: "8px", overflow: "hidden" }}>
        <div
          onClick={() => setExpanded((p) => ({ ...p, [gKey]: !p[gKey] }))}
          style={{ display: "flex", alignItems: "center", gap: "10px", padding: level === 1 ? "13px 14px" : "11px 12px", cursor: "pointer", background: headerBg, borderBottom: isOpen ? `1px solid ${C.border}` : "none" }}
        >
          <GroupCheckbox items={items} />
          <ChevronRight size={13} style={{ color: C.label, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }} />
          <span style={{ flex: 1, fontWeight: 700, fontSize: level === 1 ? "14px" : "13px", color: C.text, display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
            {icon}{title}
          </span>
          <span style={{ fontSize: "11px", fontWeight: 700, background: C.accentSoft, color: C.accentText, borderRadius: "14px", padding: "2px 9px", flexShrink: 0 }}>{sumQty(items)}개</span>
        </div>
        {isOpen ? <div style={{ padding: "8px 8px 2px" }}>{children}</div> : null}
      </div>
    );
  }

  function ReturnItemCard({ item }: { key?: string | number; item: UnreturnedItem }) {
    const k = keyOf(item);
    const maxQty = Math.max(1, parseInt(String(item.quantity), 10) || 1);
    const selectedQty = selectedReturn[k];
    const checked = selectedQty !== undefined;
    const badgeText = item.sheetType === "scenario"
      ? (item.itemKind === "대여 물품" ? "필요 물품" : "추가 물품")
      : (item.generalOption || "일반");
    return (
      <div
        onClick={() => toggleReturnKeys([item], !checked)}
        style={{ display: "flex", alignItems: "flex-start", gap: "10px", padding: "12px", border: `1px solid ${checked ? C.accent : C.border}`, background: checked ? C.accentSoft : "transparent", borderRadius: "10px", marginBottom: "6px", cursor: "pointer" }}
      >
        <input type="checkbox" readOnly checked={checked} style={{ width: 17, height: 17, accentColor: C.accent, marginTop: "2px", flexShrink: 0 }} />
        <Thumb url={item.image} size={44} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: "13px", color: C.text, lineHeight: 1.35 }}>
            <span style={{ fontSize: "10px", fontWeight: 700, padding: "2px 7px", borderRadius: "6px", marginRight: "5px", background: C.accentSoft, color: C.accentText }}>{badgeText}</span>
            {item.sheetType === "scenario" && item.scenarioId ? (
              <span style={{ fontSize: "10px", fontWeight: 700, padding: "2px 7px", borderRadius: "6px", marginRight: "5px", background: C.successSoft, color: C.success }}>{item.scenarioId}</span>
            ) : null}
            {item.itemLabel}
          </div>
          <div style={{ fontSize: "11px", color: C.label, marginTop: "2px" }}>
            대여일: {item.borrowDate}{item.borrowPurpose ? ` · ${item.borrowPurpose}` : ""}
          </div>
          <div style={{ marginTop: "4px" }}><LocBadge slot={item.location} /></div>
          <StockBadges stock={item.stock} rented={item.rented} />
          {maxQty > 1 ? (
            <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "8px" }}>
              <span style={{ fontSize: "11px", color: C.label, fontWeight: 700 }}>반납 수량</span>
              <button onClick={() => setSelectedReturn((p) => ({ ...p, [k]: Math.max(1, (p[k] ?? maxQty) - 1) }))} style={{ width: 26, height: 26, borderRadius: "7px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Minus size={12} /></button>
              <span style={{ fontWeight: 700, minWidth: "18px", textAlign: "center", color: C.text, fontSize: "13px" }}>{selectedQty ?? maxQty}</span>
              <button onClick={() => setSelectedReturn((p) => ({ ...p, [k]: Math.min(maxQty, (p[k] ?? maxQty) + 1) }))} style={{ width: 26, height: 26, borderRadius: "7px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={12} /></button>
              <span style={{ fontSize: "11px", color: C.label }}>/ 총 {maxQty}개</span>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  async function handleReturnSubmit() {
    const keys = Object.keys(selectedReturn);
    if (!keys.length) return;
    const requests: ReturnRequest[] = keys.map((k) => {
      const [sheetType, rowIndex] = k.split(":");
      return { sheetType: sheetType as "scenario" | "general", rowIndex: parseInt(rowIndex, 10), quantity: selectedReturn[k] };
    });
    setReturnSubmitting(true);
    try {
      if (connected && scriptUrl) {
        const res = await postProcessReturn(scriptUrl, requests, appVersion);
        setResultInfo({ ok: res.success, title: res.success ? "반납 처리 완료!" : "오류 발생", sub: res.message });
      } else {
        setResultInfo({ ok: true, title: "반납 처리 완료!", sub: `${keys.length}건이 반납 처리되었습니다. (로컬 데모)` });
      }
      setMode("result");
    } catch (e: any) {
      setResultInfo({ ok: false, title: "오류 발생", sub: e.message || "다시 시도해주세요." });
      setMode("result");
    } finally {
      setReturnSubmitting(false);
    }
  }

  /* ══════════════════════ 창고 물품 대여/반납 ══════════════════════ */


  async function handleWarehouseBorrow(actionType: "대여" | "소모" = "대여") {
    const user = whName.trim();
    if (!user) { showToast("성함을 입력해주세요.", "warn"); return; }
    if (!isKoreanName(user)) { showToast("이름은 한글만 입력할 수 있습니다.", "warn"); return; }
    if (whCart.length === 0) { showToast(`${actionType}할 창고 물품을 담아주세요.`, "warn"); return; }
    // 재고 검증
    for (const c of whCart) {
      const orig = whItems.find((o) => o.rowIndex === c.rowIndex);
      const stock = orig ? warehouseStockNum(orig.stock) : NaN;
      if (!isNaN(stock) && c.quantity > stock) { showToast(`['${c.name}'] 신청 수량(${c.quantity})이 재고(${stock})를 초과합니다.`, "warn"); return; }
    }
    setSubmitting(true);
    try {
      if (connected && scriptUrl) {
        for (const c of whCart) {
          const dueTag = actionType === "대여" && whDueDate ? ` [반납예정:${whDueDate}]` : "";
          const baseNote = whPurpose || (actionType === "소모" ? "소모 처리" : "대여 신청");
          await postWarehouseRent(scriptUrl, { type: actionType, location: c.location, name: c.name, qty: c.quantity, user, note: baseNote + dueTag });
        }
        clearWarehouseCart(user, whEmpId.trim());
      }
      const total = whCart.reduce((n, c) => n + c.quantity, 0);
      setResultInfo({
        ok: true,
        title: actionType === "소모" ? "창고 물품 소모 완료!" : "창고 물품 대여 완료!",
        sub: actionType === "소모"
          ? `${total}개 물품을 소모 처리했습니다. (재고에서 차감되며 반납 대상이 아닙니다)`
          : `${total}개 물품을 대여 처리했습니다.`,
        receipt: {
          borrower: user,
          date: nowString(),
          due: actionType === "대여" && whDueDate ? whDueDate : undefined,
          action: actionType,
          items: whCart.map((c) => ({ name: c.name, qty: c.quantity, location: c.location })),
        },
      });
      setMode("result");
    } catch (e: any) {
      setResultInfo({ ok: false, title: "오류 발생", sub: e.message || "다시 시도해주세요." });
      setMode("result");
    } finally { setSubmitting(false); }
  }

  async function handleWarehouseReturn() {
    const keys = Object.keys(whReturnSel);
    if (!keys.length) { showToast("반납할 물품을 선택해주세요.", "warn"); return; }
    if (!whName.trim()) { showToast("반납자 성함을 입력해주세요.", "warn"); return; }
    setReturnSubmitting(true);
    try {
      if (connected && scriptUrl) {
        for (const k of keys) {
          const idx = parseInt(k, 10);
          const item = whReturnItems[idx];
          if (!item) continue;
          const qty = whReturnSel[k];
          await postWarehouseRent(scriptUrl, { type: "반납", location: item.location, name: item.name, qty, user: whName.trim() || item.borrowerName || "", note: "반납 접수" });
        }
      }
      setResultInfo({ ok: true, title: "창고 물품 반납 완료!", sub: `${keys.length}건을 반납 처리했습니다.` });
      setMode("result");
    } catch (e: any) {
      setResultInfo({ ok: false, title: "오류 발생", sub: e.message || "다시 시도해주세요." });
      setMode("result");
    } finally { setReturnSubmitting(false); }
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
    const q = whSearch.trim().toLowerCase();
    return whItems.filter((it) => {
      const { rack, slot } = parseRackSlot(it.location);
      if (whRack && rack !== whRack) return false;
      if (whSlot && slot !== whSlot) return false;
      if (!q) return true;
      return it.name.toLowerCase().includes(q);
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
    setWhCart([]); setWhSearch(""); setWhRack(""); setWhSlot(""); setWhPurpose(""); setWhDueDate(""); setWhReturnSel({});
    setMode(rootMode);
    if (rootMode === "return") loadUnreturned();
    if (rootMode === "b1") loadItems();
    if (rootMode === "wborrow") { setWhLoaded(false); loadWarehouse(); }
    if (rootMode === "wreturn") loadWhReturn();
  }

  /* ══════════════════════ 헤더/네비 ══════════════════════ */

  const titles: Record<string, string> = {
    pickBorrowKind: "대여 신청", pickReturnKind: "반납 처리",
    b1: "시나리오 대여 신청", b2: "시나리오 대여 신청", b3g: "시나리오 대여 신청",
    b4g: "시나리오 대여 신청", b3s: "시나리오 대여 신청", b4s: "시나리오 대여 신청",
    return: "시나리오 반납 처리", wborrow: "창고 물품 대여", wreturn: "창고 물품 반납", result: "",
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
      <style>{`@keyframes bsp-spin { to { transform: rotate(360deg); } }`}</style>

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
        {mode === "pickBorrowKind" || mode === "pickReturnKind" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ fontSize: "13px", color: C.label, marginBottom: "4px" }}>
              {mode === "pickBorrowKind" ? "대여할 물품 종류를 선택하세요." : "반납할 물품 종류를 선택하세요."}
            </div>
            {[
              { kind: "scenario", icon: <Fingerprint size={22} />, color: C.accentText, bg: C.accentSoft, title: "시나리오 물품", sub: "SID 기반 대여 및 일반 대여 (Slack 연동)" },
              { kind: "warehouse", icon: <Warehouse size={22} />, color: C.success, bg: C.successSoft, title: "창고 물품", sub: "창고 재고를 랙·슬롯 기준으로 대여/반납" },
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
              <TypeCard active={itemType === "scenario"} icon={<Fingerprint size={26} />} text="SID 기반 대여" onClick={() => { setItemType("scenario"); setMode("b3s"); }} />
              <TypeCard active={itemType === "general"} icon={<Boxes size={26} />} text="일반 대여" onClick={() => { setItemType("general"); setMode("b3g"); }} />
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
            <CartBox list={cart} setList={setCart} emptyText="아래 목록에서 물품을 선택해주세요" />
            <ItemPicker list={cart} setList={setCart} search={itemSearch} setSearch={setItemSearch} cat={itemCat} setCat={setItemCat} sub={itemSub} setSub={setItemSub} />
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
              <TypeCard small active={generalOption === "추가 물품 대여"} icon={<PlusCircle size={18} />} text="추가 물품 대여" onClick={() => setGeneralOption("추가 물품 대여")} />
              <TypeCard small active={generalOption === "Light Scenario"} icon={<Feather size={18} />} text="Light Scenario" onClick={() => setGeneralOption("Light Scenario")} />
              <TypeCard small active={generalOption === "Wild Scenario"} icon={<Flame size={18} />} text="Wild Scenario" onClick={() => setGeneralOption("Wild Scenario")} />
            </div>
            <label style={labelStyle}>대여 목적</label>
            <textarea value={purposeGeneral} onChange={(e) => setPurposeGeneral(e.target.value)} placeholder="간략한 대여 목적을 적어주세요" style={{ ...inputStyle, minHeight: "90px", resize: "none", marginBottom: "20px" }} />
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => setMode("b3g")} style={secondaryBtn}>이전</button>
              <button onClick={handleBorrowSubmit} disabled={submitting} style={{ ...primaryBtn, opacity: submitting ? 0.7 : 1 }}>
                {submitting ? <><Spinner size={16} light /> 처리 중...</> : "신청하기"}
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
                        ) : entry.scenario?.blocked ? (
                          <div style={{ fontSize: "11px", color: C.error, marginTop: "3px", fontWeight: 700 }}>{entry.scenario.blockReason}</div>
                        ) : entry.scenario?.syncNeeded ? (
                          <div style={{ fontSize: "11px", color: C.warn, marginTop: "3px", fontWeight: 700 }}>동기화가 필요한 SID입니다. 대여는 계속할 수 있습니다.</div>
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
                    ) : s?.syncNeeded ? (
                      <div style={{ color: C.warn, fontSize: "12px", fontWeight: 700 }}>동기화가 필요한 SID입니다. 대여는 가능합니다.</div>
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
            <CartBox list={reqCart} setList={setReqCart} emptyText="필요하다면 아래 목록에서 물품을 선택해주세요" />
            <ItemPicker list={reqCart} setList={setReqCart} search={reqSearch} setSearch={setReqSearch} cat={reqCat} setCat={setReqCat} sub={reqSub} setSub={setReqSub} />

            <div style={{ marginTop: "18px" }}>
              <label style={labelStyle}>대여 목적</label>
              <textarea value={purposeScenario} onChange={(e) => setPurposeScenario(e.target.value)} placeholder="간략한 대여 목적을 적어주세요" style={{ ...inputStyle, minHeight: "90px", resize: "none", marginBottom: "20px" }} />
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => setMode("b3s")} style={secondaryBtn}>이전</button>
              <button onClick={handleBorrowSubmit} disabled={submitting} style={{ ...primaryBtn, opacity: submitting ? 0.7 : 1 }}>
                {submitting ? <><Spinner size={16} light /> 처리 중...</> : "신청하기"}
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
                <Spinner size={30} /> 미반납 목록을 불러오는 중입니다...
              </div>
            ) : unreturned.length === 0 ? (
              <div style={{ textAlign: "center", padding: "48px 0", color: C.label, fontSize: "14px" }}>
                <Check size={36} style={{ color: C.border, marginBottom: "8px" }} /><div>현재 미반납된 물품이 없습니다.</div>
              </div>
            ) : returnTree.length === 0 ? (
              <div style={{ textAlign: "center", padding: "48px 0", color: C.label, fontSize: "14px" }}>검색 결과가 없습니다.</div>
            ) : (
              <div style={{ marginBottom: "80px" }}>
                {returnTree.map(({ borrower, items }) => {
                  const all = sortByLoc(items);
                  const scenarioItems = all.filter((it) => it.sheetType === "scenario");
                  const additionalItems = all.filter((it) => it.sheetType === "general" && it.generalOption === "추가 물품 대여");
                  const generalItems = all.filter((it) => it.sheetType === "general" && it.generalOption !== "추가 물품 대여");
                  return (
                    <GroupSection key={borrower} gKey={borrower} title={borrower} items={all} level={1}>
                      {(scenarioItems.length || additionalItems.length) ? (
                        <GroupSection gKey={`${borrower}|sid`} title="SID 대여" icon={<Fingerprint size={13} style={{ color: C.accentText }} />} items={[...scenarioItems, ...additionalItems]} level={2}>
                          {groupBy(scenarioItems, (it) => it.scenarioId || "(SID 없음)").map((grp) => (
                            <GroupSection key={grp.key} gKey={`${borrower}|sid|${grp.key}`} title={grp.key} items={grp.items} level={3}>
                              {sortByLoc(grp.items).map((item) => <ReturnItemCard key={keyOf(item)} item={item} />)}
                            </GroupSection>
                          ))}
                          {additionalItems.length ? (
                            <GroupSection gKey={`${borrower}|add`} title="추가 대여" icon={<PlusCircle size={13} style={{ color: C.warn }} />} items={additionalItems} level={3}>
                              {groupBy(additionalItems, borrowDateKey).map((grp) => (
                                <GroupSection key={grp.key} gKey={`${borrower}|add|${grp.key}`} title={grp.key} items={grp.items} level={4}>
                                  {sortByLoc(grp.items).map((item) => <ReturnItemCard key={keyOf(item)} item={item} />)}
                                </GroupSection>
                              ))}
                            </GroupSection>
                          ) : null}
                        </GroupSection>
                      ) : null}
                      {generalItems.length ? (
                        <GroupSection gKey={`${borrower}|gen`} title="일반 대여" icon={<Boxes size={13} style={{ color: C.accentText }} />} items={generalItems} level={2}>
                          {groupBy(generalItems, borrowDateKey).map((grp) => (
                            <GroupSection key={grp.key} gKey={`${borrower}|gen|${grp.key}`} title={grp.key} items={grp.items} level={3}>
                              {sortByLoc(grp.items).map((item) => <ReturnItemCard key={keyOf(item)} item={item} />)}
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
                  {returnSubmitting ? <><Spinner size={16} light /> 처리 중...</> : `반납 처리하기${Object.keys(selectedReturn).length ? ` (${Object.keys(selectedReturn).length}건)` : ""}`}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* ───────── 창고 물품 대여 ───────── */}
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
                  <span style={{ fontSize: "13px", color: C.label }}>담은 창고 물품</span>
                  <span style={{ fontSize: "11px", fontWeight: 700, background: C.accent, color: "#fff", borderRadius: "14px", padding: "2px 10px" }}>{whCartCount}개</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "180px", overflowY: "auto" }}>
                  {whCart.map((item, idx) => (
                    <div key={item.rowIndex} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", background: C.cardSub, border: `1px solid ${C.border}`, borderRadius: "10px" }}>
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
              {!whLoaded || whLoading ? (
                <div style={{ padding: "24px", textAlign: "center", color: C.label, fontSize: "13px", display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}><Spinner /> 창고 물품을 불러오는 중...</div>
              ) : whFiltered.length === 0 ? (
                <div style={{ padding: "24px", textAlign: "center", color: C.label, fontSize: "13px" }}>검색 결과가 없습니다.</div>
              ) : (
                whFiltered.map((it) => {
                  const inCart = whCart.some((c) => c.rowIndex === it.rowIndex);
                  const stockN = warehouseStockNum(it.stock);
                  const { rack, slot } = parseRackSlot(it.location);
                  return (
                    <div key={it.rowIndex} onClick={() => addWhCart(it)} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "11px 12px", borderBottom: `1px solid ${C.border}`, cursor: "pointer", background: inCart ? C.accentSoft : "transparent" }}>
                      <input type="checkbox" readOnly checked={inCart} style={{ width: 17, height: 17, accentColor: C.accent, flexShrink: 0 }} />
                      <Thumb url={it.photo} size={44} />
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

        {/* ───────── 창고 물품 반납 ───────── */}
        {mode === "wreturn" ? (
          <div>
            <div style={{ marginBottom: "12px", padding: "12px 14px", background: C.accentSoft, borderRadius: "12px", borderLeft: `4px solid ${C.accent}`, fontSize: "12px", lineHeight: 1.6 }}>
              현재 대여 중인 창고 물품 전체 목록입니다. 반납할 물품을 선택하고, 아래에 반납자 성함을 입력해주세요.
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
              <div style={{ textAlign: "center", padding: "40px 0", color: C.label, fontSize: "14px" }}>현재 대여 중인 창고 물품이 없습니다.</div>
            ) : (
              <>
                {whReturnItems
                  .map((item, idx) => ({ item, idx }))
                  .filter(({ item }) => {
                    const q = whSearch.trim().toLowerCase();
                    if (!q) return true;
                    return String(item.name || "").toLowerCase().includes(q)
                      || String(item.borrowerName || "").toLowerCase().includes(q)
                      || String(item.location || "").toLowerCase().includes(q);
                  })
                  .map(({ item, idx }) => {
                  const key = String(idx);
                  const maxQty = Math.max(1, parseInt(String(item.quantity), 10) || 1);
                  const sel = whReturnSel[key];
                  const checked = sel !== undefined;
                  const { rack, slot } = parseRackSlot(item.location);
                  return (
                    <div key={key} onClick={() => setWhReturnSel((p) => { const n = { ...p }; if (checked) delete n[key]; else n[key] = maxQty; return n; })}
                      style={{ display: "flex", alignItems: "flex-start", gap: "10px", padding: "13px", border: `1px solid ${checked ? C.accent : C.border}`, background: checked ? C.accentSoft : "transparent", borderRadius: "12px", marginBottom: "8px", cursor: "pointer" }}>
                      <input type="checkbox" readOnly checked={checked} style={{ width: 17, height: 17, accentColor: C.accent, marginTop: "2px", flexShrink: 0 }} />
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
            {resultInfo.ok ? (
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
