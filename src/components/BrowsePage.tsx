import React, { useState, useMemo, useEffect, useCallback } from "react";
import {
  ArrowLeft, Search, User, IdCard, Boxes, Fingerprint, ChevronRight,
  Plus, Minus, X, ShoppingCart, Warehouse, MapPin, Trash2, HandHelping, PackageOpen,
} from "lucide-react";
import {
  ObjectItem, BrowseCartItem, padSlot, isKoreanName,
  fetchObjectItems, saveIdentity, loadIdentity, saveBrowseCart, loadBrowseCart,
  DEMO_OBJECT_ITEMS,
} from "../utils/borrowApi";
import { getGoogleDriveImageUrl } from "../utils/drive";

interface BrowsePageProps {
  scriptUrl: string;
  connected: boolean;
  isLightMode: boolean;
  onBack: () => void;
  onOpenWarehouseView: () => void;
  onGoBorrow: (identity: { name: string; employeeId: string }) => void;
  onGoMode: (mode: "mylookup" | "sidlookup" | "location", identity: { name: string; employeeId: string }) => void;
  showToast: (msg: string, type: "ok" | "error" | "info" | "warn") => void;
}

type Step = "identity" | "menu" | "scenario";

export default function BrowsePage({
  scriptUrl, connected, isLightMode, onBack, onOpenWarehouseView, onGoBorrow, onGoMode, showToast,
}: BrowsePageProps) {
  const C = {
    bg: isLightMode ? "#f8fafc" : "#0b0f19",
    card: isLightMode ? "#ffffff" : "#1e293b",
    cardSub: isLightMode ? "#f8fafc" : "#151d30",
    border: isLightMode ? "#e2e8f0" : "#334155",
    text: isLightMode ? "#0f172a" : "#f1f5f9",
    label: isLightMode ? "#475569" : "#94a3b8",
    accent: "#6366f1",
    accentSoft: "rgba(99, 102, 241, 0.15)",
    accentText: isLightMode ? "#4f46e5" : "#818cf8",
    success: isLightMode ? "#047857" : "#34d399",
    successSoft: "rgba(16, 185, 129, 0.12)",
    warn: isLightMode ? "#b45309" : "#fbbf24",
    warnSoft: "rgba(245, 158, 11, 0.12)",
    error: isLightMode ? "#dc2626" : "#f87171",
    errorSoft: "rgba(239, 68, 68, 0.12)",
  };

  const [step, setStep] = useState<Step>("identity");
  const [name, setName] = useState("");
  const [empId, setEmpId] = useState("");
  const [items, setItems] = useState<ObjectItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("");
  const [sub, setSub] = useState("");
  const [cart, setCart] = useState<BrowseCartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [modalUrl, setModalUrl] = useState("");

  /* 이전에 입력한 신원 자동 채움 */
  useEffect(() => {
    const saved = loadIdentity();
    if (saved) { setName(saved.name || ""); setEmpId(saved.employeeId || ""); }
  }, []);

  /* 장바구니 변경 시 저장 */
  useEffect(() => {
    if (step === "identity" || !name) return;
    saveBrowseCart(name, empId, cart);
  }, [cart, name, empId, step]);

  const loadItems = useCallback(async () => {
    if (loading || loaded) return;
    setLoading(true);
    try {
      setItems(connected && scriptUrl ? await fetchObjectItems(scriptUrl) : DEMO_OBJECT_ITEMS);
      setLoaded(true);
    } catch (e: any) {
      showToast(`물품 목록을 불러오지 못했습니다: ${e.message}`, "error");
    } finally {
      setLoading(false);
    }
  }, [connected, scriptUrl, loading, loaded, showToast]);

  const categoryMap = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    items.forEach((it) => {
      if (!it.category) return;
      if (!map[it.category]) map[it.category] = new Set<string>();
      if (it.subcategory) map[it.category].add(it.subcategory);
    });
    return map;
  }, [items]);
  const categories = useMemo(() => Object.keys(categoryMap).sort(), [categoryMap]);
  const subs = cat && categoryMap[cat] ? Array.from<string>(categoryMap[cat]).sort() : [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (cat && it.category !== cat) return false;
      if (sub && it.subcategory !== sub) return false;
      if (!q) return true;
      const slotPad = padSlot(it.rootSlot);
      const qTrim = q.replace(/^0+/, "");
      const slotHit = slotPad.includes(q) || (!!qTrim && slotPad.replace(/^0+/, "") === qTrim);
      return it.name.toLowerCase().includes(q) || it.id.includes(q) ||
        (it.category || "").toLowerCase().includes(q) ||
        (it.subcategory || "").toLowerCase().includes(q) || slotHit;
    });
  }, [items, search, cat, sub]);

  const cartCount = cart.reduce((n, c) => n + c.quantity, 0);

  function addToCart(it: ObjectItem) {
    if ((it.stock || 0) < 1) { showToast("재고가 부족하여 담을 수 없습니다. (현재 재고: 0)", "warn"); return; }
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.id === it.id);
      if (idx === -1) return [...prev, { id: it.id, name: it.name, quantity: 1, rootSlot: it.rootSlot }];
      if (prev[idx].quantity >= (it.stock || 0)) { showToast(`재고가 부족합니다. (최대 ${it.stock}개)`, "warn"); return prev; }
      return prev.map((c, i) => (i === idx ? { ...c, quantity: c.quantity + 1 } : c));
    });
  }

  function changeQty(idx: number, delta: number) {
    setCart((prev) => {
      const item = prev[idx];
      const orig = items.find((o) => o.id === item.id);
      const max = orig ? orig.stock || 0 : 0;
      const next = item.quantity + delta;
      if (delta > 0 && next > max) { showToast(`재고가 부족합니다. (최대 ${max}개)`, "warn"); return prev; }
      if (next < 1) return prev.filter((_, i) => i !== idx);
      return prev.map((c, i) => (i === idx ? { ...c, quantity: next } : c));
    });
  }

  function submitIdentity() {
    const n = name.trim();
    if (!n) { showToast("성함을 입력해주세요.", "warn"); return; }
    if (!isKoreanName(n)) { showToast("이름은 한글만 입력할 수 있습니다.", "warn"); return; }
    if (!/^\d+$/.test(empId.trim())) { showToast("사번은 숫자만 입력할 수 있습니다.", "warn"); return; }
    saveIdentity({ name: n, employeeId: empId.trim() });
    setCart(loadBrowseCart(n, empId.trim()));
    setStep("menu");
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

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text }}>
      <style>{`@keyframes bsp-spin { to { transform: rotate(360deg); } }`}</style>

      {/* 상단바 */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "16px 20px", borderBottom: `1px solid ${C.border}`, background: C.card, position: "sticky", top: 0, zIndex: 20 }}>
        <button
          onClick={() => (step === "identity" ? onBack() : step === "menu" ? setStep("identity") : setStep("menu"))}
          style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.card, color: C.label, cursor: "pointer", fontSize: "13px", fontWeight: 600 }}
        >
          <ArrowLeft size={15} /> {step === "identity" ? "메인으로" : "이전"}
        </button>
        <h1 style={{ fontSize: "17px", fontWeight: 800, margin: 0, flex: 1 }}>
          {step === "scenario" ? "시나리오 물품 열람" : "열람 조회"}
        </h1>
        {step !== "identity" ? (
          <span style={{ fontSize: "12px", color: C.label, fontWeight: 600 }}>{name} · {empId}</span>
        ) : null}
        {step === "scenario" ? (
          <button
            onClick={() => setCartOpen(true)}
            style={{ position: "relative", display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px", borderRadius: "10px", border: "none", background: C.accent, color: "#fff", cursor: "pointer", fontSize: "13px", fontWeight: 700 }}
          >
            <ShoppingCart size={15} /> 장바구니
            <div style={{ marginTop: "8px", fontSize: "12px", fontWeight: 700, color: C.label }}>기타 조회</div>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              {[
                { key: "mylookup" as const, icon: <PackageOpen size={16} />, title: "내 대여 조회" },
                { key: "sidlookup" as const, icon: <Fingerprint size={16} />, title: "SID 검색" },
                { key: "location" as const, icon: <MapPin size={16} />, title: "위치 검색" },
              ].map((m) => (
                <button
                  key={m.key}
                  onClick={() => onGoMode(m.key, { name: name.trim(), employeeId: empId.trim() })}
                  style={{ flex: "1 1 140px", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", padding: "14px", border: `1px solid ${C.border}`, borderRadius: "12px", background: C.card, color: C.text, cursor: "pointer", fontSize: "13px", fontWeight: 700 }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accent; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; }}
                >
                  {m.icon} {m.title}
                </button>
              ))}
            </div>

            {cartCount > 0 ? (
              <span style={{ background: "#fff", color: C.accent, borderRadius: "20px", padding: "0 7px", fontSize: "11px", fontWeight: 800 }}>{cartCount}</span>
            ) : null}
          </button>
        ) : null}
      </div>

      <div style={{ maxWidth: step === "scenario" ? "1200px" : "620px", margin: "0 auto", padding: "24px 16px 48px" }}>

        {/* ───── 신원 입력 ───── */}
        {step === "identity" ? (
          <div>
            <div style={{ marginBottom: "20px", padding: "14px 16px", background: C.accentSoft, borderRadius: "12px", borderLeft: `4px solid ${C.accent}`, fontSize: "13px", lineHeight: 1.6, color: C.text }}>
              열람 조회에는 사번과 성함이 필요합니다. 여기서 담아둔 장바구니는 <b>대여 신청 시 같은 사번·성함을 입력하면 그대로 불러옵니다.</b>
            </div>
            <label style={labelStyle}>성함</label>
            <div style={{ position: "relative", marginBottom: "16px" }}>
              <User size={16} style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
              <input
                value={name}
                onChange={(e) => setName(e.target.value.replace(/[^\uAC00-\uD7A3\u3131-\u318E\s]/g, ""))}
                onKeyDown={(e) => { if (e.key === "Enter") submitIdentity(); }}
                placeholder="성함을 입력해주세요"
                style={{ ...inputStyle, paddingLeft: "40px" }}
              />
            </div>
            <label style={labelStyle}>사번</label>
            <div style={{ position: "relative", marginBottom: "24px" }}>
              <IdCard size={16} style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
              <input
                value={empId}
                onChange={(e) => setEmpId(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => { if (e.key === "Enter") submitIdentity(); }}
                placeholder="사번을 입력해주세요 (숫자만)" inputMode="numeric"
                style={{ ...inputStyle, paddingLeft: "40px" }}
              />
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={onBack} style={secondaryBtn}>이전</button>
              <button onClick={submitIdentity} style={primaryBtn}>계속하기 <ChevronRight size={15} /></button>
            </div>
          </div>
        ) : null}

        {/* ───── 열람 메뉴 ───── */}
        {step === "menu" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {[
              { key: "scenario", icon: <Fingerprint size={22} />, color: C.accentText, bg: C.accentSoft, title: "시나리오 물품 열람", sub: "모든 시나리오 물품을 그리드로 보고 장바구니에 담습니다" },
              { key: "warehouse", icon: <Warehouse size={22} />, color: C.success, bg: C.successSoft, title: "창고 물품 열람", sub: "WMS 창고 재고와 구역 배치를 열람용 모드로 확인합니다" },
            ].map((m) => (
              <div
                key={m.key}
                onClick={() => {
                  if (m.key === "warehouse") { onOpenWarehouseView(); return; }
                  setStep("scenario");
                  loadItems();
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

            {cartCount > 0 ? (
              <div style={{ marginTop: "8px", padding: "16px", border: `1px solid ${C.accent}`, background: C.accentSoft, borderRadius: "14px", display: "flex", alignItems: "center", gap: "12px" }}>
                <ShoppingCart size={20} style={{ color: C.accentText }} />
                <div style={{ flex: 1, fontSize: "13px" }}>
                  장바구니에 <b>{cartCount}개</b> 물품이 담겨 있습니다. 대여 신청에서 같은 사번·성함을 입력하면 그대로 불러옵니다.
                </div>
                <button onClick={() => onGoBorrow({ name: name.trim(), employeeId: empId.trim() })} style={{ padding: "10px 16px", borderRadius: "10px", border: "none", background: C.accent, color: "#fff", cursor: "pointer", fontSize: "13px", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap" }}>
                  <HandHelping size={14} /> 대여 신청하기
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ───── 시나리오 물품 그리드 ───── */}
        {step === "scenario" ? (
          <div>
            <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
              <div style={{ position: "relative", flex: "2 1 260px", minWidth: 0 }}>
                <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ID · 물품명 · 위치(예: 000060)로 검색..." style={{ ...inputStyle, paddingLeft: "36px", padding: "11px 12px 11px 36px", fontSize: "14px" }} />
              </div>
              <select value={cat} onChange={(e) => { setCat(e.target.value); setSub(""); }} style={{ ...inputStyle, padding: "11px 12px", fontSize: "13px", flex: "1 1 160px", minWidth: 0 }}>
                <option value="">전체 카테고리</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={sub} onChange={(e) => setSub(e.target.value)} style={{ ...inputStyle, padding: "11px 12px", fontSize: "13px", flex: "1 1 160px", minWidth: 0 }}>
                <option value="">전체 서브카테고리</option>
                {subs.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ fontSize: "12px", color: C.label, marginBottom: "12px" }}>
              {loaded ? `${filtered.length} / ${items.length}개 물품` : ""}
            </div>

            {!loaded ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", padding: "64px 0", color: C.label }}>
                <Spinner size={30} /> 시나리오 물품을 불러오는 중입니다...
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ textAlign: "center", padding: "64px 0", color: C.label }}>검색 결과가 없습니다.</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "16px" }}>
                {filtered.map((it) => {
                  const inCart = cart.find((c) => c.id === it.id);
                  const out = (it.stock || 0) < 1;
                  return (
                    <div
                      key={it.id}
                      style={{
                        border: `1px solid ${inCart ? C.accent : C.border}`,
                        background: C.card, borderRadius: "16px", overflow: "hidden",
                        display: "flex", flexDirection: "column",
                        boxShadow: inCart ? `0 8px 20px -8px rgba(99,102,241,0.4)` : "0 2px 4px rgba(0,0,0,0.04)",
                        transition: "all 0.2s", opacity: out ? 0.6 : 1,
                      }}
                    >
                      <div
                        onClick={() => it.image && setModalUrl(getGoogleDriveImageUrl(it.image))}
                        style={{ height: "150px", background: C.cardSub, display: "flex", alignItems: "center", justifyContent: "center", cursor: it.image ? "zoom-in" : "default", borderBottom: `1px solid ${C.border}` }}
                      >
                        {it.image ? (
                          <img src={getGoogleDriveImageUrl(it.image)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : (
                          <Boxes size={40} style={{ color: C.border }} />
                        )}
                      </div>
                      <div style={{ padding: "12px 14px", flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
                        <div style={{ fontWeight: 700, fontSize: "14px", lineHeight: 1.35, wordBreak: "break-word" }}>{it.name}</div>
                        <div style={{ fontSize: "11px", color: C.label }}>ID: {it.id}</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                          {it.rootSlot ? (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", fontWeight: 700, color: C.warn, background: C.warnSoft, borderRadius: "6px", padding: "2px 8px", fontFamily: "monospace" }}>
                              <MapPin size={11} />{padSlot(it.rootSlot)}
                            </span>
                          ) : null}
                          {it.category ? (
                            <span style={{ fontSize: "10px", fontWeight: 700, padding: "2px 7px", borderRadius: "6px", background: C.accentSoft, color: C.accentText }}>{it.category}</span>
                          ) : null}
                        </div>
                        <div style={{ display: "flex", gap: "6px", fontSize: "11px", fontWeight: 600 }}>
                          <span style={{ color: C.success, background: C.successSoft, padding: "2px 8px", borderRadius: "6px" }}>재고 {it.stock || 0}</span>
                          <span style={{ color: C.accentText, background: C.accentSoft, padding: "2px 8px", borderRadius: "6px" }}>대여 중 {it.rented || 0}</span>
                        </div>
                        <div style={{ marginTop: "auto", paddingTop: "8px" }}>
                          {inCart ? (
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", justifyContent: "center", background: C.accentSoft, borderRadius: "10px", padding: "6px" }}>
                              <button onClick={() => changeQty(cart.findIndex((c) => c.id === it.id), -1)} style={{ width: 28, height: 28, borderRadius: "8px", border: "none", background: C.card, color: C.text, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Minus size={13} /></button>
                              <span style={{ fontWeight: 800, minWidth: "22px", textAlign: "center", color: C.accentText }}>{inCart.quantity}</span>
                              <button onClick={() => changeQty(cart.findIndex((c) => c.id === it.id), 1)} style={{ width: 28, height: 28, borderRadius: "8px", border: "none", background: C.card, color: C.text, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={13} /></button>
                            </div>
                          ) : (
                            <button
                              disabled={out}
                              onClick={() => addToCart(it)}
                              style={{ width: "100%", padding: "9px", borderRadius: "10px", border: "none", background: out ? C.border : C.accent, color: "#fff", cursor: out ? "not-allowed" : "pointer", fontSize: "13px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}
                            >
                              <ShoppingCart size={14} /> {out ? "재고 없음" : "장바구니 담기"}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* 장바구니 패널 */}
      {cartOpen ? (
        <div onClick={() => setCartOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 50, display: "flex", justifyContent: "flex-end" }}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(420px, 100%)", background: C.card, borderLeft: `1px solid ${C.border}`, display: "flex", flexDirection: "column", height: "100%" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "18px 20px", borderBottom: `1px solid ${C.border}` }}>
              <ShoppingCart size={18} style={{ color: C.accentText }} />
              <h2 style={{ flex: 1, fontSize: "16px", fontWeight: 800, margin: 0 }}>장바구니 ({cartCount}개)</h2>
              <button onClick={() => setCartOpen(false)} style={{ background: "none", border: "none", color: C.label, cursor: "pointer" }}><X size={20} /></button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
              {cart.length === 0 ? (
                <div style={{ textAlign: "center", color: C.label, fontSize: "13px", padding: "48px 0" }}>
                  <ShoppingCart size={32} style={{ color: C.border, marginBottom: "8px" }} />
                  <div>장바구니가 비어 있습니다.</div>
                </div>
              ) : (
                cart.map((item, idx) => (
                  <div key={item.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", background: C.cardSub, border: `1px solid ${C.border}`, borderRadius: "10px", marginBottom: "8px" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: "13px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.name}</div>
                      <div style={{ fontSize: "11px", color: C.label }}>ID: {item.id}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                      <button onClick={() => changeQty(idx, -1)} style={{ width: 26, height: 26, borderRadius: "7px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Minus size={12} /></button>
                      <span style={{ fontWeight: 700, minWidth: "18px", textAlign: "center", fontSize: "13px" }}>{item.quantity}</span>
                      <button onClick={() => changeQty(idx, 1)} style={{ width: 26, height: 26, borderRadius: "7px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={12} /></button>
                    </div>
                    <button onClick={() => setCart(cart.filter((_, i) => i !== idx))} style={{ width: 26, height: 26, borderRadius: "7px", border: "none", background: C.errorSoft, color: C.error, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><X size={12} /></button>
                  </div>
                ))
              )}
            </div>
            <div style={{ padding: "16px 20px", borderTop: `1px solid ${C.border}`, display: "flex", gap: "10px" }}>
              <button onClick={() => setCart([])} disabled={cart.length === 0} style={{ ...secondaryBtn, flex: "0 0 auto", padding: "14px 16px", opacity: cart.length === 0 ? 0.5 : 1 }}><Trash2 size={15} /></button>
              <button
                onClick={() => onGoBorrow({ name: name.trim(), employeeId: empId.trim() })}
                disabled={cart.length === 0}
                style={{ ...primaryBtn, opacity: cart.length === 0 ? 0.5 : 1 }}
              >
                <HandHelping size={15} /> 대여 신청하기
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 이미지 확대 */}
      {modalUrl ? (
        <div onClick={() => setModalUrl("")} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
          <button onClick={() => setModalUrl("")} style={{ position: "absolute", top: "16px", right: "20px", background: "none", border: "none", color: "#fff", cursor: "pointer" }}><X size={32} /></button>
          <img src={modalUrl} alt="" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "90%", maxHeight: "90%", borderRadius: "8px", objectFit: "contain" }} />
        </div>
      ) : null}
    </div>
  );
}
