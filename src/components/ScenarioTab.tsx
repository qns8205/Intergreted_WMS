import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check, Fingerprint, Loader2, MapPin, Minus, Package, Plus,
  Search, Undo2, UserSearch, X, ShoppingCart, ChevronRight,
} from "lucide-react";
import {
  Affiliation, CartItem, ScenarioObjectItem, SidCartEntry, UnreturnedItem,
} from "../types";
import {
  C, cardStyle, fuzzy, inputStyle, labelStyle, padSlot, pillBtn, pillGroupStyle,
  primaryBtn, qtyBtnStyle, secondaryBtnStyle, sortIdx, Spinner,
} from "../ui";
import { callGas } from "../api";

interface Props {
  scriptUrl: string;
  showToast: (msg: string, type: "ok" | "error" | "warn" | "info") => void;
  /** 지정하면 내부 메뉴 화면을 건너뛰고 바로 이 모드로 진입 (외부 상위 네비게이션에서 사용) */
  startMode?: "borrow" | "return";
  /** startMode가 지정된 경우, "← 메뉴로" 클릭 시 내부 메뉴 대신 이 콜백 호출 */
  onExitToMenu?: () => void;
}

type ScenarioMode = "menu" | "borrow" | "return" | "mylookup" | "sidlookup";
type BorrowType = "scenario" | "general";

export default function ScenarioTab({ scriptUrl, showToast, startMode, onExitToMenu }: Props) {
  const [mode, setMode] = useState<ScenarioMode>(startMode || "menu");
  const [appVersion, setAppVersion] = useState("");

  const [borrowerName, setBorrowerName] = useState("");
  const [affiliation, setAffiliation] = useState<Affiliation>("cfgw");
  const [employeeId, setEmployeeId] = useState("");
  const [otherName, setOtherName] = useState("");

  const [borrowType, setBorrowType] = useState<BorrowType>("scenario");
  const [objectItems, setObjectItems] = useState<ScenarioObjectItem[]>([]);
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [reqCart, setReqCart] = useState<CartItem[]>([]);
  const [sidCart, setSidCart] = useState<SidCartEntry[]>([]);
  const [sidInput, setSidInput] = useState("");
  const [generalOption, setGeneralOption] = useState("추가 물품 대여");
  const [borrowPurpose, setBorrowPurpose] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [unreturned, setUnreturned] = useState<UnreturnedItem[]>([]);
  const [unreturnedLoading, setUnreturnedLoading] = useState(false);
  const [returnSelected, setReturnSelected] = useState<Record<string, number>>({});
  const [returnSearch, setReturnSearch] = useState("");
  const [returnSubmitting, setReturnSubmitting] = useState(false);

  const [myLookupName, setMyLookupName] = useState("");
  const [myLookupAff, setMyLookupAff] = useState<Affiliation>("cfgw");
  const [myLookupEmpId, setMyLookupEmpId] = useState("");
  const [myLookupResult, setMyLookupResult] = useState<UnreturnedItem[] | null>(null);
  const [myLookupLoading, setMyLookupLoading] = useState(false);

  const [sidLookupInput, setSidLookupInput] = useState("");
  const [sidLookupResult, setSidLookupResult] = useState<any>(null);
  const [sidLookupLoading, setSidLookupLoading] = useState(false);

  useEffect(() => {
    callGas(scriptUrl, "borrow_getVersion")
      .then((d) => setAppVersion(d.version?.current || ""))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ensureItemsLoaded = useCallback(async () => {
    if (itemsLoaded || itemsLoading) return;
    setItemsLoading(true);
    try {
      const data = await callGas(scriptUrl, "borrow_getObjects");
      setObjectItems(data.items || []);
      setItemsLoaded(true);
    } catch (e: any) {
      showToast("물품 목록 조회 실패: " + e.message, "error");
    } finally {
      setItemsLoading(false);
    }
  }, [itemsLoaded, itemsLoading, scriptUrl, showToast]);

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
      showToast("형식: S1234 또는 L1234", "warn");
      return;
    }
    if (sidCart.some((s) => s.sid === val)) {
      showToast("이미 추가된 SID입니다.", "warn");
      return;
    }
    setSidInput("");
    setSidCart((prev) => [...prev, { sid: val, loading: true, scenario: null }]);
    try {
      const data = await callGas(scriptUrl, "borrow_getScenarioInfo", { sid: val });
      setSidCart((prev) => prev.map((e) => (e.sid === val ? { ...e, loading: false, scenario: data.definition } : e)));
      if (data.definition?.blocked) showToast(data.definition.blockReason || "사용할 수 없는 SID입니다.", "error");
    } catch (e: any) {
      setSidCart((prev) =>
        prev.map((en) =>
          en.sid === val
            ? { ...en, loading: false, scenario: { sid: val, found: false, syncNeeded: true, blocked: false, blockReason: "", highLevelEn: "", highLevelKo: "", items: [] } }
            : en
        )
      );
      showToast("SID 조회 오류: " + e.message, "error");
    }
  }
  function removeSid(sid: string) {
    setSidCart((prev) => prev.filter((e) => e.sid !== sid));
  }

  const stockError = useMemo(() => {
    const totals: Record<string, { name: string; qty: number }> = {};
    if (borrowType === "general") {
      cart.forEach((c) => {
        totals[c.id] = { name: c.name, qty: (totals[c.id]?.qty || 0) + c.quantity };
      });
    } else {
      sidCart.forEach((entry) =>
        (entry.scenario?.items || []).forEach((it) => {
          totals[it.id] = { name: it.name, qty: (totals[it.id]?.qty || 0) + (it.quantity || 1) };
        })
      );
      reqCart.forEach((c) => {
        totals[c.id] = { name: c.name, qty: (totals[c.id]?.qty || 0) + c.quantity };
      });
    }
    for (const id in totals) {
      const obj = objectItems.find((o) => o.id === id);
      const stock = obj?.stock || 0;
      if (totals[id].qty > stock) return `'${totals[id].name}' 요청 수량(${totals[id].qty}개)이 재고(${stock}개)를 초과합니다.`;
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
    if (stockError) {
      showToast(stockError, "error");
      return;
    }
    setSubmitting(true);
    try {
      if (affiliation === "configds") {
        const v = await callGas(scriptUrl, "borrow_verifyUser", { affiliation, borrowerName: name });
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
          additionalItems,
          syncNeeded: !!entry.scenario?.syncNeeded,
          borrowDate: nowStr,
          borrowPurpose,
        }));
      }
      const result = await callGas(scriptUrl, "borrow_submitBorrow", { borrowList, clientVersion: appVersion });
      showToast(result.message || "대여 신청이 접수되었습니다.", "ok");
      setCart([]);
      setReqCart([]);
      setSidCart([]);
      setSidInput("");
      setBorrowPurpose("");
      setMode("menu");
    } catch (e: any) {
      showToast("대여 신청 실패: " + e.message, "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function loadUnreturned() {
    setUnreturnedLoading(true);
    setReturnSelected({});
    try {
      const data = await callGas(scriptUrl, "borrow_getUnreturned");
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
      const result = await callGas(scriptUrl, "borrow_submitReturn", { returnRequests, clientVersion: appVersion });
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
      ? unreturned.filter((it) => fuzzy(it.borrowerName, q) || fuzzy(it.itemLabel, q) || fuzzy(padSlot(it.location), q))
      : unreturned;
    const sorted = [...filtered].sort((a, b) => sortIdx(a.location) - sortIdx(b.location));
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
      const data = await callGas(scriptUrl, "borrow_getMyRentals", { borrowerName: name, employeeId: empId });
      setMyLookupResult(data.items || []);
    } catch (e: any) {
      showToast("조회 실패: " + e.message, "error");
    } finally {
      setMyLookupLoading(false);
    }
  }

  async function runSidLookup() {
    const sid = sidLookupInput.trim().toUpperCase();
    if (!/^[SL]\d+$/i.test(sid)) {
      showToast("형식: S1234 또는 L1234", "warn");
      return;
    }
    setSidLookupLoading(true);
    setSidLookupResult(null);
    try {
      const data = await callGas(scriptUrl, "borrow_getScenarioInfo", { sid });
      setSidLookupResult(data.definition);
    } catch (e: any) {
      showToast("SID 검색 실패: " + e.message, "error");
    } finally {
      setSidLookupLoading(false);
    }
  }

  const filteredObjectItems = useMemo(() => {
    if (!itemSearch.trim()) return objectItems;
    return objectItems.filter(
      (it) => fuzzy(it.name, itemSearch) || it.id.includes(itemSearch) || fuzzy(padSlot(it.rootSlot), itemSearch) || fuzzy(it.category || "", itemSearch)
    );
  }, [objectItems, itemSearch]);

  function ItemPickerList({ target }: { target: "cart" | "reqCart" }) {
    const currentCart = target === "cart" ? cart : reqCart;
    if (itemsLoading) return <div style={{ padding: 30, textAlign: "center", color: C.sub }}>물품 목록을 불러오는 중...</div>;
    if (filteredObjectItems.length === 0) return <div style={{ padding: 30, textAlign: "center", color: C.sub }}>검색 결과가 없습니다.</div>;
    return (
      <div style={{ maxHeight: 260, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 10 }}>
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
                padding: "12px 14px",
                borderBottom: `1px solid ${C.border}`,
                cursor: "pointer",
                background: inCart ? C.primaryLight : "transparent",
              }}
            >
              <input type="checkbox" checked={inCart} readOnly style={{ width: 20, height: 20, accentColor: C.primary, cursor: "pointer", flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{it.name}</div>
                <div style={{ fontSize: 11, color: C.sub }}>ID: {it.id}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                  {it.rootSlot && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.warn, background: "rgba(245,158,11,0.12)", borderRadius: 6, padding: "1px 6px", fontFamily: "monospace" }}>
                      <MapPin size={10} style={{ display: "inline", marginRight: 2, verticalAlign: -1 }} />
                      {padSlot(it.rootSlot)}
                    </span>
                  )}
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.success, background: "rgba(16,185,129,0.12)", borderRadius: 6, padding: "1px 6px" }}>
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
    if (list.length === 0) return <div style={{ fontSize: 12, color: C.sub, textAlign: "center", padding: "10px 0" }}>선택된 물품이 없습니다.</div>;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {list.map((c) => (
          <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: C.primaryLight, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 13 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: C.text }}>{c.name}</div>
              <div style={{ fontSize: 11, color: C.sub }}>ID: {c.id}</div>
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
              style={{ ...qtyBtnStyle, background: "rgba(239,68,68,0.12)", color: C.danger }}
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    );
  }

  function SubHeader({ title }: { title: string }) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <button onClick={() => (startMode && onExitToMenu ? onExitToMenu() : setMode("menu"))} style={{ ...secondaryBtnStyle, padding: "8px 12px" }}>
          ← 메뉴로
        </button>
        <h3 style={{ fontSize: 16, fontWeight: 800, color: C.text, margin: 0 }}>{title}</h3>
      </div>
    );
  }

  if (mode === "menu") {
    const items: { key: ScenarioMode; icon: React.ReactNode; title: string; sub: string; color: string }[] = [
      { key: "borrow", icon: <Package size={20} />, title: "대여 신청", sub: "시나리오 물품을 새로 대여 신청합니다", color: C.primary },
      { key: "mylookup", icon: <UserSearch size={20} />, title: "내 대여 조회", sub: "내가 빌린 물품과 위치를 확인합니다", color: "#0ea5e9" },
      { key: "return", icon: <Undo2 size={20} />, title: "반납 처리", sub: "대여 중인 물품을 반납 처리합니다", color: C.success },
      { key: "sidlookup", icon: <Fingerprint size={20} />, title: "SID 검색", sub: "시나리오 ID로 필요 물품을 확인합니다", color: C.warn },
    ];
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((it) => (
          <div
            key={it.key}
            onClick={() => {
              setMode(it.key);
              if (it.key === "return") loadUnreturned();
              if (it.key === "borrow") ensureItemsLoaded();
            }}
            style={{ ...cardStyle, padding: 18, display: "flex", alignItems: "center", gap: 14, cursor: "pointer" }}
          >
            <div style={{ width: 44, height: 44, borderRadius: 12, background: `${it.color}1f`, color: it.color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {it.icon}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: 14, color: C.text }}>{it.title}</div>
              <div style={{ fontSize: 12, color: C.sub, marginTop: 2 }}>{it.sub}</div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (mode === "borrow") {
    return (
      <div>
        <SubHeader title="대여 신청" />
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={cardStyle}>
            <label style={labelStyle}>소속</label>
            <div style={pillGroupStyle}>
              {(["cfgw", "configds", "other"] as Affiliation[]).map((a) => (
                <button key={a} style={pillBtn(affiliation === a)} onClick={() => setAffiliation(a)}>
                  {a === "cfgw" ? "Cfgw-kr" : a === "configds" ? "ConfigDS" : "기타"}
                </button>
              ))}
            </div>
            <div style={{ height: 12 }} />
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
                    <div style={{ height: 10 }} />
                    <label style={labelStyle}>사번</label>
                    <input style={inputStyle} value={employeeId} onChange={(e) => setEmployeeId(e.target.value.replace(/\D/g, ""))} placeholder="숫자만 입력" inputMode="numeric" />
                  </>
                )}
              </>
            )}
          </div>

          <div style={cardStyle}>
            <label style={labelStyle}>대여 유형</label>
            <div style={pillGroupStyle}>
              <button style={pillBtn(borrowType === "scenario")} onClick={() => setBorrowType("scenario")}>
                <Fingerprint size={13} style={{ display: "inline", marginRight: 5, verticalAlign: -2 }} />
                SID 기반 대여
              </button>
              <button style={pillBtn(borrowType === "general")} onClick={() => setBorrowType("general")}>
                <Package size={13} style={{ display: "inline", marginRight: 5, verticalAlign: -2 }} />
                일반 대여
              </button>
            </div>
          </div>

          {borrowType === "scenario" ? (
            <>
              <div style={cardStyle}>
                <label style={labelStyle}>시나리오 ID 추가</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input style={inputStyle} value={sidInput} onChange={(e) => setSidInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addSid()} placeholder="예: S1234 또는 L1234" />
                  <button style={primaryBtn(false)} onClick={addSid}>
                    <Plus size={14} /> 추가
                  </button>
                </div>
                {sidCart.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
                    {sidCart.map((entry) => (
                      <div key={entry.sid} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div style={{ fontWeight: 800, color: C.primary, fontSize: 14 }}>
                            <Fingerprint size={13} style={{ display: "inline", marginRight: 5, verticalAlign: -2 }} />
                            {entry.sid}
                          </div>
                          <button onClick={() => removeSid(entry.sid)} style={{ ...qtyBtnStyle, background: "rgba(239,68,68,0.12)", color: C.danger }}>
                            <X size={12} />
                          </button>
                        </div>
                        {entry.loading ? (
                          <div style={{ fontSize: 12, color: C.sub, marginTop: 6 }}>필요 물품을 불러오는 중…</div>
                        ) : entry.scenario?.blocked ? (
                          <div style={{ fontSize: 12, color: C.danger, marginTop: 6 }}>{entry.scenario.blockReason}</div>
                        ) : entry.scenario?.syncNeeded ? (
                          <div style={{ fontSize: 12, color: C.warn, marginTop: 6 }}>동기화가 필요한 SID입니다. 대여는 계속할 수 있습니다.</div>
                        ) : (
                          <div style={{ fontSize: 12, color: C.sub, marginTop: 6 }}>
                            {(entry.scenario?.items || []).map((it) => (
                              <div key={it.id}>
                                • {it.name} ({it.id}) x {it.quantity || 1}
                                {it.rootSlot && <span style={{ color: C.warn, fontFamily: "monospace", fontWeight: 700, marginLeft: 6 }}>{padSlot(it.rootSlot)}</span>}
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
                  <Search size={14} style={{ position: "absolute", left: 12, top: 13, color: C.sub }} />
                  <input style={{ ...inputStyle, paddingLeft: 34 }} value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="ID · 물품명 · 위치로 검색" />
                </div>
                <ItemPickerList target="reqCart" />
              </div>
            </>
          ) : (
            <div style={cardStyle}>
              <label style={labelStyle}>대여 구분</label>
              <div style={pillGroupStyle}>
                {["추가 물품 대여", "Light Scenario", "Wild Scenario"].map((opt) => (
                  <button key={opt} style={pillBtn(generalOption === opt)} onClick={() => setGeneralOption(opt)}>
                    {opt}
                  </button>
                ))}
              </div>
              <div style={{ height: 12 }} />
              <label style={labelStyle}>선택된 물품</label>
              <div style={{ marginBottom: 10 }}>
                <CartList target="cart" />
              </div>
              <div style={{ position: "relative", marginBottom: 10 }}>
                <Search size={14} style={{ position: "absolute", left: 12, top: 13, color: C.sub }} />
                <input style={{ ...inputStyle, paddingLeft: 34 }} value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="ID · 물품명 · 위치로 검색" />
              </div>
              <ItemPickerList target="cart" />
            </div>
          )}

          <div id="sc-checkout-form" style={cardStyle}>
            <label style={labelStyle}>대여 목적</label>
            <textarea style={{ ...inputStyle, minHeight: 70, resize: "none" }} value={borrowPurpose} onChange={(e) => setBorrowPurpose(e.target.value)} placeholder="간략한 대여 목적을 적어주세요" />
          </div>

          {stockError && <div style={{ color: C.danger, fontSize: 13, fontWeight: 700, background: "rgba(239,68,68,0.08)", padding: 12, borderRadius: 10 }}>{stockError}</div>}

          <button style={primaryBtn(submitting)} disabled={submitting} onClick={submitBorrow}>
            {submitting ? <Spinner size={16} /> : <Check size={16} />}
            {submitting ? "신청 중..." : "대여 신청하기"}
          </button>
        </div>
      </div>
    );
  }

  if (mode === "return") {
    return (
      <div>
        <SubHeader title="반납 처리" />
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 12, top: 13, color: C.sub }} />
            <input style={{ ...inputStyle, paddingLeft: 34 }} value={returnSearch} onChange={(e) => setReturnSearch(e.target.value)} placeholder="대여자 · 물품명 · 위치로 검색" />
          </div>
          {unreturnedLoading ? (
            <div style={{ padding: 40, textAlign: "center", color: C.sub }}>미반납 목록을 불러오는 중...</div>
          ) : filteredReturnGroups.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: C.sub }}>현재 미반납된 물품이 없습니다.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingBottom: 100 }}>
              {filteredReturnGroups.map((g) => (
                <div key={g.borrower} style={cardStyle}>
                  <div style={{ fontWeight: 800, fontSize: 14, color: C.text, marginBottom: 10 }}>{g.borrower}</div>
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
                            border: `1.5px solid ${checked ? C.primary : C.border}`,
                            background: checked ? C.primaryLight : "transparent",
                            borderRadius: 10,
                            cursor: "pointer",
                          }}
                        >
                          <input type="checkbox" checked={checked} readOnly style={{ width: 20, height: 20, marginTop: 2, accentColor: C.primary, cursor: "pointer", flexShrink: 0 }} />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>
                              {it.scenarioId && (
                                <span style={{ fontSize: 10, fontWeight: 700, background: "rgba(16,185,129,0.14)", color: "#1a9c56", borderRadius: 6, padding: "1px 6px", marginRight: 6 }}>
                                  {it.scenarioId}
                                </span>
                              )}
                              {it.itemLabel}
                            </div>
                            <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>
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
                                  color: C.warn,
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

          {/* 🔄 화면 하단 고정 반납 처리 바 */}
          <div
            style={{
              position: "fixed",
              bottom: "20px",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 1000,
              width: "calc(100% - 32px)",
              maxWidth: "480px",
              background: "rgba(255, 255, 255, 0.92)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              border: `1px solid ${C.border}`,
              borderRadius: "16px",
              padding: "12px 16px",
              boxShadow: "0 10px 30px rgba(15, 23, 42, 0.12)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
              animation: "tabCartSlideUp 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.1) both",
            }}
          >
            <div>
              <div style={{ fontWeight: 800, fontSize: "13px", color: C.text }}>
                반납 처리 대기 항목
              </div>
              <div style={{ fontSize: "11px", color: C.sub }}>
                {Object.keys(returnSelected).length > 0
                  ? `${Object.keys(returnSelected).length}건이 선택되었습니다.`
                  : "반납 처리할 항목을 선택해주세요."}
              </div>
            </div>
            <button
              style={{
                ...primaryBtn(Object.keys(returnSelected).length === 0 || returnSubmitting),
                padding: "10px 16px",
                borderRadius: "10px",
                fontSize: "12.5px",
                boxShadow: Object.keys(returnSelected).length > 0 ? "0 4px 12px rgba(15, 118, 110, 0.25)" : "none",
              }}
              disabled={Object.keys(returnSelected).length === 0 || returnSubmitting}
              onClick={submitReturn}
            >
              {returnSubmitting ? <Spinner size={14} /> : <Undo2 size={14} />}
              {returnSubmitting ? "처리 중..." : `반납 처리하기 (${Object.keys(returnSelected).length}건)`}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (mode === "mylookup") {
    return (
      <div>
        <SubHeader title="내 대여 조회" />
        {myLookupResult ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 800, color: C.text }}>
                {myLookupName}님이 대여 중인 물품 ({myLookupResult.reduce((n, it) => n + (it.quantity || 1), 0)}개)
              </div>
              <button style={secondaryBtnStyle} onClick={() => setMyLookupResult(null)}>
                다시 조회
              </button>
            </div>
            {myLookupResult.length === 0 ? (
              <div style={{ padding: 30, textAlign: "center", color: C.sub }}>현재 대여 중인 물품이 없습니다.</div>
            ) : (
              [...myLookupResult]
                .sort((a, b) => sortIdx(a.location) - sortIdx(b.location))
                .map((it, i) => (
                  <div key={i} style={{ ...cardStyle, padding: 14 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{it.itemLabel}</div>
                    <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>
                      대여일: {it.borrowDate}
                      {it.scenarioId ? ` · ${it.scenarioId}` : ""}
                    </div>
                  </div>
                ))
            )}
          </div>
        ) : (
          <div style={cardStyle}>
            <label style={labelStyle}>성함 (한글)</label>
            <input
              style={inputStyle}
              value={myLookupName}
              onChange={(e) => setMyLookupName(e.target.value.replace(/[^\uAC00-\uD7A3\u3131-\u318E\s]/g, ""))}
              placeholder="대여 시 입력한 성함"
            />
            <div style={{ height: 12 }} />
            <label style={labelStyle}>소속</label>
            <div style={pillGroupStyle}>
              <button style={pillBtn(myLookupAff === "cfgw")} onClick={() => setMyLookupAff("cfgw")}>
                Cfgw-kr
              </button>
              <button style={pillBtn(myLookupAff !== "cfgw")} onClick={() => setMyLookupAff("other")}>
                ConfigDS · 기타
              </button>
            </div>
            {myLookupAff === "cfgw" && (
              <>
                <div style={{ height: 12 }} />
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
            <div style={{ height: 16 }} />
            <button style={primaryBtn(myLookupLoading)} disabled={myLookupLoading} onClick={runMyLookup}>
              {myLookupLoading ? <Spinner size={16} /> : <Search size={16} />}
              조회하기
            </button>
          </div>
        )}
      </div>
    );
  }

  // sidlookup
  return (
    <div>
      <SubHeader title="SID 검색" />
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input style={inputStyle} value={sidLookupInput} onChange={(e) => setSidLookupInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runSidLookup()} placeholder="예: S1234 또는 L1234" />
          <button style={primaryBtn(sidLookupLoading)} disabled={sidLookupLoading} onClick={runSidLookup}>
            {sidLookupLoading ? <Spinner size={16} /> : <Search size={16} />}
          </button>
        </div>
        {sidLookupResult && (
          <div style={cardStyle}>
            <div style={{ fontWeight: 800, fontSize: 15, color: C.primary, marginBottom: 8 }}>
              <Fingerprint size={15} style={{ display: "inline", marginRight: 6, verticalAlign: -2 }} />
              {sidLookupResult.sid}
              {sidLookupResult.found ? (
                <span style={{ fontSize: 10, fontWeight: 700, background: C.success, color: "#fff", borderRadius: 10, padding: "2px 8px", marginLeft: 8 }}>등록됨</span>
              ) : (
                <span style={{ fontSize: 10, fontWeight: 700, background: C.warn, color: "#fff", borderRadius: 10, padding: "2px 8px", marginLeft: 8 }}>동기화 필요</span>
              )}
            </div>
            {sidLookupResult.found && (
              <>
                <div style={{ fontSize: 13, color: C.text, marginBottom: 4 }}>
                  <b style={{ color: C.sub, fontSize: 11 }}>EN</b> {sidLookupResult.highLevelEn || "-"}
                </div>
                <div style={{ fontSize: 13, color: C.text, marginBottom: 10 }}>
                  <b style={{ color: C.sub, fontSize: 11 }}>KO</b> {sidLookupResult.highLevelKo || "-"}
                </div>
              </>
            )}
            <div style={{ fontWeight: 700, fontSize: 12, color: C.sub, marginBottom: 6 }}>필요 물품 ({sidLookupResult.items.length}개)</div>
            {sidLookupResult.items.length === 0 ? (
              <div style={{ fontSize: 13, color: C.sub }}>등록된 필요 물품이 없습니다.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {sidLookupResult.items.map((it: any) => (
                  <div key={it.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 10px", background: C.inputBg, borderRadius: 8, fontSize: 13 }}>
                    <span>
                      {it.name} <span style={{ color: C.sub, fontSize: 11 }}>({it.id})</span> x {it.quantity}
                    </span>
                    {it.rootSlot && <span style={{ color: C.warn, fontFamily: "monospace", fontWeight: 700, fontSize: 12 }}>{padSlot(it.rootSlot)}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 🛒 동적 플로팅 장바구니 (ScenarioTab) */}
      {mode === "borrow" && (borrowType === "general" ? cart.length > 0 : (sidCart.length > 0 || reqCart.length > 0)) && (
        <div
          style={{
            position: "fixed",
            bottom: "24px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1000,
            width: "calc(100% - 32px)",
            maxWidth: "480px",
            background: "rgba(255, 255, 255, 0.88)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            border: `1px solid ${C.border}`,
            borderRadius: "20px",
            padding: "10px 16px",
            boxShadow: "0 12px 36px -4px rgba(15, 23, 42, 0.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            animation: "tabCartSlideUp 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.2) both",
          }}
        >
          <style>{`
            @keyframes tabCartSlideUp {
              from { opacity: 0; transform: translate(-50%, 20px) scale(0.95); }
              to { opacity: 1; transform: translate(-50%, 0) scale(1); }
            }
          `}</style>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                width: "38px",
                height: "38px",
                borderRadius: "12px",
                background: C.primaryLight,
                color: C.primary,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
              }}
            >
              <ShoppingCart size={18} />
              <span
                style={{
                  position: "absolute",
                  top: "-5px",
                  right: "-5px",
                  background: C.primary,
                  color: "#fff",
                  fontSize: "10px",
                  fontWeight: 800,
                  borderRadius: "10px",
                  padding: "1px 5px",
                  minWidth: "16px",
                  textAlign: "center",
                }}
              >
                {borrowType === "general"
                  ? cart.reduce((sum, item) => sum + (item.quantity || 1), 0)
                  : (sidCart.length + reqCart.reduce((sum, item) => sum + (item.quantity || 1), 0))
                }
              </span>
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: "13.5px", color: C.text }}>
                {borrowType === "general" ? `대여 물품 ${cart.length}종` : `SID ${sidCart.length}건 + 추가 ${reqCart.length}종`}
              </div>
              <div style={{ fontSize: "11px", color: C.sub }}>
                대여 신청을 완료해주세요.
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "2px", overflow: "hidden", flex: 1, justifyContent: "center" }}>
            {(borrowType === "general" ? cart : [...sidCart.map(s => ({ name: s.sid, image: null })), ...reqCart]).slice(0, 3).map((item, idx) => (
              <div
                key={idx}
                style={{
                  width: "28px",
                  height: "28px",
                  borderRadius: "6px",
                  border: "2px solid #ffffff",
                  background: "rgba(0,0,0,0.05)",
                  overflow: "hidden",
                  marginLeft: idx > 0 ? "-8px" : "0",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.1)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {"image" in item && item.image ? (
                  <img src={item.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <span style={{ fontSize: "9px", fontWeight: 700, color: C.text }}>
                    {item.name?.slice(0, 2)}
                  </span>
                )}
              </div>
            ))}
          </div>

          <button
            onClick={() => {
              document.getElementById("sc-checkout-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
            style={{
              background: C.primary,
              color: "#ffffff",
              border: "none",
              borderRadius: "12px",
              padding: "8px 14px",
              fontSize: "12.5px",
              fontWeight: 800,
              cursor: "pointer",
              boxShadow: "0 4px 12px rgba(15, 118, 110, 0.25)",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              whiteSpace: "nowrap",
            }}
          >
            신청서 작성 <ChevronRight size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
