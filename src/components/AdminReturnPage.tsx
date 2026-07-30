import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Search, RotateCcw, User, Package, X, Undo2, Check, MapPin } from "lucide-react";
import {
  fetchUnreturnedItems, UnreturnedItem,
  postProcessReturn, fetchBorrowAppVersion,
  isVersionMismatchMessage, signalVersionOutdated,
  sendReturnReminderDm,
} from "../utils/borrowApi";
import { smartMatch } from "../utils/search";

interface Props {
  scriptUrl: string;
  connected: boolean;
  isLightMode: boolean;
  showToast: (msg: string, type: "ok" | "error" | "info" | "warn") => void;
}

// 반납 장바구니 한 줄 = 특정 대여 행에서 몇 개를 반납할지
interface ReturnCartLine {
  key: string;                       // sheetType:rowIndex
  sheetType: "scenario" | "general";
  rowIndex: number;
  borrower: string;
  itemLabel: string;
  location: string;
  max: number;                       // 이 행에서 반납 가능한 최대 수량
  qty: number;                       // 담은 수량
}

export default function AdminReturnPage({ scriptUrl, connected, isLightMode, showToast }: Props) {
  const C = {
    bg: isLightMode ? "#f8fafc" : "#0b0f19",
    card: isLightMode ? "#ffffff" : "#161f30",
    cardSub: isLightMode ? "#f4f6f9" : "#0f172a",
    border: isLightMode ? "#e6e9ef" : "#26324a",
    text: isLightMode ? "#111827" : "#f1f5f9",
    label: isLightMode ? "#64748b" : "#94a3b8",
    accent: "#2563eb",
    accentSoft: isLightMode ? "rgba(37,99,235,0.09)" : "rgba(37,99,235,0.16)",
    accentText: isLightMode ? "#1d4ed8" : "#93c5fd",
    success: isLightMode ? "#047857" : "#34d399",
    successSoft: isLightMode ? "rgba(4,120,87,0.10)" : "rgba(52,211,153,0.14)",
    warn: isLightMode ? "#b45309" : "#fbbf24",
    warnSoft: isLightMode ? "rgba(180,83,9,0.10)" : "rgba(251,191,36,0.14)",
    error: isLightMode ? "#dc2626" : "#f87171",
    errorSoft: isLightMode ? "rgba(220,38,38,0.10)" : "rgba(248,113,113,0.14)",
  };

  // 지난번 목록을 먼저 그려 화면이 비어 보이지 않게 한다 (응답이 오면 교체)
  const CACHE_KEY = "wms_unreturned_v1";
  const [items, setItems] = useState<UnreturnedItem[]>(() => {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed as UnreturnedItem[];
      }
    } catch (e) { /* 무시 */ }
    return [];
  });
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedBorrower, setSelectedBorrower] = useState<string | null>(null);
  const [cart, setCart] = useState<ReturnCartLine[]>([]);
  // 현재 선택 위치(하이라이트). A는 이 위치를 담고, ↑/↓로 위치만 옮길 수 있다.
  const [cursor, setCursor] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  // 담은 순서를 기억해 C 키로 하나씩 되돌린다
  const addHistoryRef = useRef<string[]>([]);

  const load = useCallback(async (silent = false) => {
    if (!connected || !scriptUrl) { setLoaded(true); return; }
    if (!silent) setLoading(true);
    try {
      const list = await fetchUnreturnedItems(scriptUrl);
      setItems(list);
      setLoaded(true);
      try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(list)); } catch (e) { /* 무시 */ }
    } catch (e: any) {
      showToast(`미반납 목록을 불러오지 못했습니다: ${e.message}`, "error");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [connected, scriptUrl]);

  useEffect(() => { load(); }, [load]);

  // 15초마다 자동 새로고침.
  // 다른 관리자가 처리한 내용이 바로 반영되도록 하되, 담아둔 장바구니와 선택은 유지한다.
  const submittingRef = useRef(false);
  submittingRef.current = submitting;
  useEffect(() => {
    if (!connected || !scriptUrl) return;
    const timer = window.setInterval(() => {
      if (submittingRef.current) return;      // 처리 중에는 건너뛴다
      if (document.hidden) return;            // 다른 탭을 보고 있으면 굳이 부르지 않는다
      load(true);                             // 조용히 갱신 (로딩 표시 없음)
    }, 15000);
    return () => window.clearInterval(timer);
  }, [connected, scriptUrl, load]);

  // 자동 새로고침으로 사라진 행(다른 사람이 먼저 반납한 경우)은 장바구니에서 정리한다.
  useEffect(() => {
    if (!loaded || !cart.length) return;
    const alive = new Map(items.map((it) => [`${it.sheetType}:${it.rowIndex}`, it.quantity || 1]));
    let changed = false;
    const next = cart
      .map((c) => {
        const max = alive.get(c.key);
        if (max === undefined) { changed = true; return null; }   // 이미 반납됨
        if (c.qty > max) { changed = true; return { ...c, qty: max, max }; }
        if (c.max !== max) { changed = true; return { ...c, max }; }
        return c;
      })
      .filter(Boolean) as ReturnCartLine[];
    if (changed) {
      setCart(next);
      addHistoryRef.current = addHistoryRef.current.filter((k) => alive.has(k));
      showToast("다른 곳에서 처리된 항목이 있어 장바구니를 갱신했습니다.", "info");
    }
  }, [items, loaded]);

  // 대여자별로 묶는다
  const borrowers = useMemo(() => {
    const map = new Map<string, { name: string; items: UnreturnedItem[]; qty: number; seats: string[] }>();
    items.forEach((it) => {
      const name = String(it.borrowerName || "").trim() || "(이름 없음)";
      if (!map.has(name)) map.set(name, { name, items: [], qty: 0, seats: [] });
      const g = map.get(name)!;
      g.items.push(it);
      g.qty += it.quantity || 1;
      const seat = [it.floor, it.unit].filter(Boolean).join(" · ");
      if (seat && !g.seats.includes(seat)) g.seats.push(seat);
    });
    const list = Array.from(map.values());
    const q = search.trim();
    return (q
      ? list.filter((g) => smartMatch([g.name, ...g.items.map((i) => i.itemLabel)], q))
      : list
    ).sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
  }, [items, search]);

  const activeItems = useMemo(() => {
    if (!selectedBorrower) return [];
    return items
      .filter((it) => (String(it.borrowerName || "").trim() || "(이름 없음)") === selectedBorrower)
      .sort((a, b) => String(a.location || "").localeCompare(String(b.location || "")));
  }, [items, selectedBorrower]);

  // 반납이 늦은 사람 (7일 이상 / 2일 이상)
  const overdue = useMemo(() => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const map = new Map<string, { name: string; email: string; days: number; qty: number; items: UnreturnedItem[] }>();

    items.forEach((it) => {
      const raw = String(it.borrowDate || "").trim();
      if (!raw) return;
      const t = Date.parse(raw.replace(" ", "T"));
      if (isNaN(t)) return;
      const d = Math.floor((now - t) / day);
      if (d < 2) return;

      const name = String(it.borrowerName || "").trim() || "(이름 없음)";
      if (!map.has(name)) map.set(name, { name, email: String(it.email || ""), days: d, qty: 0, items: [] });
      const g = map.get(name)!;
      if (!g.email && it.email) g.email = it.email;
      if (d > g.days) g.days = d;
      g.qty += it.quantity || 1;
      g.items.push(it);
    });

    const all = Array.from(map.values()).sort((a, b) => b.days - a.days || b.qty - a.qty);
    return { severe: all.filter((g) => g.days >= 7), mild: all.filter((g) => g.days >= 2 && g.days < 7) };
  }, [items]);

  const [dmSending, setDmSending] = useState<string | null>(null);

  async function notifyBorrower(g: { name: string; email: string; days: number; items: UnreturnedItem[] }) {
    if (!connected || !scriptUrl) { showToast("연동이 필요합니다.", "warn"); return; }
    if (!window.confirm(`${g.name}님에게 반납 요청 DM을 보낼까요? (${g.days}일 경과)`)) return;
    setDmSending(g.name);
    try {
      const res = await sendReturnReminderDm(scriptUrl, {
        name: g.name,
        email: g.email,
        days: g.days,
        items: g.items.map((it) => ({ label: it.itemLabel, location: it.location })),
      });
      showToast(res.message || (res.success ? "DM을 보냈습니다." : "DM 발송 실패"), res.success ? "ok" : "error");
    } catch (e: any) {
      showToast(`DM 발송 실패: ${e.message}`, "error");
    } finally {
      setDmSending(null);
    }
  }

  const cartKey = (it: UnreturnedItem) => `${it.sheetType}:${it.rowIndex}`;
  const inCartQty = (it: UnreturnedItem) => cart.find((c) => c.key === cartKey(it))?.qty || 0;
  const cartTotal = cart.reduce((n, c) => n + c.qty, 0);

  // 수량 하나를 장바구니에 담는다 (종류가 아니라 개수 단위)
  const addOne = useCallback((it: UnreturnedItem) => {
    const key = `${it.sheetType}:${it.rowIndex}`;
    const max = it.quantity || 1;
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.key === key);
      if (idx === -1) {
        return [...prev, {
          key,
          sheetType: it.sheetType as "scenario" | "general",
          rowIndex: it.rowIndex,
          borrower: String(it.borrowerName || "").trim() || "(이름 없음)",
          itemLabel: it.itemLabel,
          location: it.location || "",
          max,
          qty: 1,
        }];
      }
      if (prev[idx].qty >= max) return prev; // 대여 수량을 넘길 수 없다
      return prev.map((c, i) => (i === idx ? { ...c, qty: c.qty + 1 } : c));
    });
    addHistoryRef.current.push(key);
  }, []);

  // C: 마지막으로 담은 한 개를 되돌린다
  const undoOne = useCallback(() => {
    const key = addHistoryRef.current.pop();
    if (!key) { showToast("되돌릴 항목이 없습니다.", "info"); return; }
    setCart((prev) =>
      prev
        .map((c) => (c.key === key ? { ...c, qty: c.qty - 1 } : c))
        .filter((c) => c.qty > 0)
    );
  }, []);

  // C 길게 누르기: 담은 것과 대여자 선택을 모두 해제
  const clearAll = useCallback(() => {
    addHistoryRef.current = [];
    setCart([]);
    setSelectedBorrower(null);
    showToast("선택과 장바구니를 모두 해제했습니다.", "info");
  }, []);

  // 아직 다 담지 않은 항목인지
  const isFull = useCallback(
    (it: UnreturnedItem) => inCartQty(it) >= (it.quantity || 1),
    [cart]
  );

  // A 키: 현재 커서 위치의 물품을 한 개 담는다.
  // 그 물품을 다 담았으면 커서를 "아직 안 찬 다음 항목"으로 옮긴다.
  const addAtCursor = useCallback(() => {
    if (!selectedBorrower) { showToast("먼저 대여자를 선택해주세요.", "warn"); return; }
    if (!activeItems.length) return;

    // 커서가 이미 다 찬 항목을 가리키면 다음 빈 항목으로 먼저 이동
    let idx = cursor;
    if (idx >= activeItems.length || isFull(activeItems[idx])) {
      const next = activeItems.findIndex((it, i) => i >= idx && !isFull(it));
      idx = next !== -1 ? next : activeItems.findIndex((it) => !isFull(it));
      if (idx === -1) { showToast("이 대여자의 물품을 모두 담았습니다.", "info"); return; }
      setCursor(idx);
    }

    const target = activeItems[idx];
    addOne(target);

    // 이번 한 개로 가득 찼다면 다음 미완료 항목으로 커서 이동
    if (inCartQty(target) + 1 >= (target.quantity || 1)) {
      const next = activeItems.findIndex((it, i) => i > idx && !isFull(it));
      if (next !== -1) setCursor(next);
      else setCursor(Math.min(idx + 1, activeItems.length - 1));
    }
  }, [selectedBorrower, activeItems, cursor, cart, addOne, isFull]);

  // ↓ / ↑ : 담지 않고 커서만 옮긴다 (건너뛰고 싶은 물품이 있을 때)
  const moveCursor = useCallback((delta: number) => {
    if (!activeItems.length) return;
    setCursor((prev) => Math.max(0, Math.min(activeItems.length - 1, prev + delta)));
  }, [activeItems.length]);

  // 최신 핸들러를 참조로 들고 있어야 키 이벤트가 오래된 값을 잡지 않는다
  const handlersRef = useRef({ addAtCursor, undoOne, clearAll, moveCursor, submit: async () => {} });
  handlersRef.current.addAtCursor = addAtCursor;
  handlersRef.current.moveCursor = moveCursor;
  handlersRef.current.undoOne = undoOne;
  handlersRef.current.clearAll = clearAll;

  const [cHeld, setCHeld] = useState(false);

  useEffect(() => {
    const LONG_PRESS_MS = 650;
    let cTimer: number | null = null;
    let cLongFired = false;

    const isTyping = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase();
      return tag === "input" || tag === "textarea" || !!el?.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const k = e.key.toLowerCase();

      // A: 맨 위 물품 한 개 담기
      if (k === "a" || e.key === "ㅁ") { e.preventDefault(); handlersRef.current.addAtCursor(); return; }

      // ↑ / ↓ : 담지 않고 선택 위치만 이동
      if (e.key === "ArrowDown") { e.preventDefault(); handlersRef.current.moveCursor(1); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); handlersRef.current.moveCursor(-1); return; }

      // B: 반납 완료
      if (k === "b" || e.key === "ㅠ") { e.preventDefault(); handlersRef.current.submit(); return; }

      // C: 짧게 누르면 하나 되돌리기 / 꾹 누르면 전체 해제
      if (k === "c" || e.key === "ㅊ") {
        e.preventDefault();
        if (e.repeat || cTimer !== null) return; // 자동 반복 무시
        cLongFired = false;
        setCHeld(true);
        cTimer = window.setTimeout(() => {
          cLongFired = true;
          cTimer = null;
          setCHeld(false);
          handlersRef.current.clearAll();
        }, LONG_PRESS_MS);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k !== "c" && e.key !== "ㅊ") return;
      if (cTimer !== null) { window.clearTimeout(cTimer); cTimer = null; }
      setCHeld(false);
      if (!cLongFired) handlersRef.current.undoOne(); // 짧게 눌렀을 때만
      cLongFired = false;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      if (cTimer !== null) window.clearTimeout(cTimer);
    };
  }, []);

  function changeQty(key: string, delta: number) {
    setCart((prev) =>
      prev
        .map((c) => (c.key === key ? { ...c, qty: Math.max(0, Math.min(c.max, c.qty + delta)) } : c))
        .filter((c) => c.qty > 0)
    );
  }

  const submitReturnRef = useRef<() => Promise<void>>();

  async function submitReturn() {
    if (!cart.length) { showToast("반납할 물품을 담아주세요.", "warn"); return; }
    if (!window.confirm(`${cart.length}종 · 총 ${cartTotal}개를 반납 처리할까요?`)) return;
    setSubmitting(true);
    try {
      const ver = await fetchBorrowAppVersion(scriptUrl).catch(() => "");
      const res = await postProcessReturn(
        scriptUrl,
        cart.map((c) => ({ sheetType: c.sheetType, rowIndex: c.rowIndex, quantity: c.qty })),
        ver
      );
      if (!res.success && isVersionMismatchMessage(res.message)) { signalVersionOutdated(); return; }
      if (!res.success) { showToast(res.message || "반납 처리 실패", "error"); return; }
      showToast(res.message || `${cartTotal}개를 반납 처리했습니다.`, "ok");

      // 서버 재조회를 기다리지 않고 화면에서 먼저 반영한다 (처리 직후 바로 다음 작업이 가능하도록).
      const done = new Map(cart.map((c) => [c.key, c.qty]));
      setItems((prev) =>
        prev
          .map((it) => {
            const q = done.get(`${it.sheetType}:${it.rowIndex}`);
            if (q === undefined) return it;
            const left = (it.quantity || 1) - Number(q);
            return left > 0 ? { ...it, quantity: left } : null;
          })
          .filter(Boolean) as UnreturnedItem[]
      );
      setCart([]);
      addHistoryRef.current = [];
      load(true); // 정합성은 백그라운드로 맞춘다
    } catch (e: any) {
      showToast(`반납 처리 실패: ${e.message}`, "error");
    } finally {
      setSubmitting(false);
    }
  }

  submitReturnRef.current = submitReturn;
  handlersRef.current.submit = async () => { await submitReturnRef.current?.(); };

  const inputStyle: React.CSSProperties = {
    padding: "10px 12px", borderRadius: "10px", border: `1px solid ${C.border}`,
    background: C.cardSub, color: C.text, fontSize: "13px", outline: "none",
  };

  return (
    <div style={{ display: "flex", flex: 1, width: "100%", minWidth: 0, height: "100%", minHeight: 0, background: C.bg, color: C.text }}>
      {/* ── 왼쪽: 대여자 / 물품 ── */}
      <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
          <Undo2 size={19} style={{ color: C.accentText }} />
          <h1 style={{ fontSize: "18px", fontWeight: 800, margin: 0, flex: 1 }}>반납 처리</h1>
          <span style={{ fontSize: "11px", color: C.label }}>15초마다 자동 새로고침</span>
          <button onClick={load} title="지금 새로고침" style={{ ...inputStyle, cursor: "pointer", display: "flex", alignItems: "center", gap: "5px", fontWeight: 700, color: C.accentText }}>
            <RotateCcw size={14} />
          </button>
        </div>

        <div style={{ position: "relative", marginBottom: "12px" }}>
          <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="대여자 · 물품으로 검색..."
            style={{ ...inputStyle, width: "100%", boxSizing: "border-box", paddingLeft: "36px" }}
          />
        </div>

        <div style={{ fontSize: "11.5px", color: C.label, marginBottom: "10px", lineHeight: 1.6 }}>
          <b style={{ color: C.accentText }}>A</b> 선택한 물품 한 개 담기 · <b style={{ color: C.accentText }}>↑↓</b> 담지 않고 이동 ·{" "}
          <b style={{ color: C.accentText }}>B</b> 반납 완료 · <b style={{ color: C.accentText }}>C</b> 하나 되돌리기 (꾹 누르면 전체 해제)
        </div>

        {/* 반납이 늦은 사람: 7일 이상 / 2일 이상 */}
        {(overdue.severe.length > 0 || overdue.mild.length > 0) ? (
          <div style={{ marginBottom: "14px", display: "flex", flexDirection: "column", gap: "10px" }}>
            {([
              { list: overdue.severe, title: `7일 이상 미반납`, tone: C.error, toneSoft: C.errorSoft, note: "10종류 제한 페널티 대상" },
              { list: overdue.mild, title: `2일 이상 미반납`, tone: C.warn, toneSoft: C.warnSoft, note: "" },
            ] as const).filter((sec) => sec.list.length > 0).map((sec) => (
              <div key={sec.title} style={{ border: `1px solid ${sec.tone}55`, background: sec.toneSoft, borderRadius: "12px", padding: "11px 13px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                  <span style={{ fontSize: "12.5px", fontWeight: 800, color: sec.tone }}>
                    {sec.title} {sec.list.length}명
                  </span>
                  {sec.note ? <span style={{ fontSize: "11px", color: sec.tone, opacity: 0.85 }}>· {sec.note}</span> : null}
                </div>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {sec.list.map((g) => (
                    <button
                      key={g.name}
                      onClick={() => notifyBorrower(g)}
                      disabled={dmSending === g.name}
                      title={`${g.name} · ${g.days}일 경과 · ${g.qty}개 — 누르면 Slack DM으로 반납 요청`}
                      style={{
                        display: "flex", alignItems: "center", gap: "6px",
                        padding: "6px 12px", borderRadius: "999px",
                        cursor: dmSending === g.name ? "wait" : "pointer",
                        border: `1px solid ${sec.tone}`, background: C.card, color: C.text,
                        fontSize: "12px", fontWeight: 700, opacity: dmSending === g.name ? 0.6 : 1,
                      }}
                    >
                      {g.name}
                      <span style={{ fontWeight: 800, color: sec.tone }}>{g.days}일</span>
                      <span style={{ fontWeight: 500, opacity: 0.75 }}>{g.qty}개</span>
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: "10.5px", color: C.label, marginTop: "7px" }}>
                  이름을 누르면 해당 대여자에게 Slack DM으로 반납 요청을 보냅니다.
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {loading && !loaded ? (
          <div style={{ textAlign: "center", padding: "48px 0", color: C.label, fontSize: "13px" }}>불러오는 중...</div>
        ) : borrowers.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 0", color: C.label, fontSize: "13px" }}>
            <Check size={34} style={{ color: C.border, marginBottom: "8px" }} />
            <div>미반납 물품이 없습니다.</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {borrowers.map((g) => {
              const on = selectedBorrower === g.name;
              return (
                <div key={g.name} style={{ border: `1px solid ${on ? C.accent : C.border}`, borderRadius: "12px", background: C.card, overflow: "hidden" }}>
                  <div
                    onClick={() => { setSelectedBorrower(on ? null : g.name); setCursor(0); }}
                    style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 14px", cursor: "pointer", background: on ? C.accentSoft : "transparent" }}
                  >
                    <div style={{ width: 32, height: 32, borderRadius: "9px", background: C.accentSoft, color: C.accentText, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <User size={16} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "7px", flexWrap: "wrap" }}>
                        <span style={{ fontSize: "14px", fontWeight: 800 }}>{g.name}</span>
                        {g.seats.map((sname) => (
                          <span key={sname} style={{ fontSize: "10.5px", fontWeight: 800, color: C.warn, background: C.warnSoft, borderRadius: "999px", padding: "2px 8px" }}>
                            📍 {sname}
                          </span>
                        ))}
                      </div>
                      <div style={{ fontSize: "11.5px", color: C.label, marginTop: "2px" }}>{g.items.length}종 · {g.qty}개 미반납</div>
                    </div>
                    {on ? <span style={{ fontSize: "11px", fontWeight: 800, color: C.accentText, flexShrink: 0 }}>선택됨</span> : null}
                  </div>

                  {on ? (
                    <div style={{ borderTop: `1px solid ${C.border}`, padding: "8px 10px", display: "flex", flexDirection: "column", gap: "5px" }}>
                      {activeItems.map((it, idx) => {
                        const picked = inCartQty(it);
                        const max = it.quantity || 1;
                        const done = picked >= max;
                        const atCursor = idx === cursor;
                        return (
                          <div
                            key={`${it.sheetType}-${it.rowIndex}`}
                            onClick={() => { setCursor(idx); if (!done) addOne(it); }}
                            style={{
                              display: "flex", alignItems: "center", gap: "8px", padding: "9px 10px", borderRadius: "9px",
                              cursor: done ? "default" : "pointer",
                              background: atCursor ? C.accentSoft : done ? C.successSoft : C.cardSub,
                              border: `1px solid ${atCursor ? C.accent : done ? C.success + "55" : "transparent"}`,
                              boxShadow: atCursor ? `inset 3px 0 0 ${C.accent}` : "none",
                            }}
                          >
                            <Package size={13} style={{ color: C.label, flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: "12.5px", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.itemLabel}</div>
                              {it.location ? (
                                <div style={{ fontSize: "10.5px", color: C.warn, fontFamily: "monospace", display: "flex", alignItems: "center", gap: "3px", marginTop: "1px" }}>
                                  <MapPin size={9} /> {it.location}
                                </div>
                              ) : null}
                            </div>
                            <span style={{ fontSize: "11.5px", fontWeight: 800, color: done ? C.success : C.label, flexShrink: 0 }}>
                              {picked} / {max}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── 오른쪽: 반납 장바구니 (화면 절반) ── */}
      <div style={{ width: "50%", flexShrink: 0, borderLeft: `1px solid ${C.border}`, background: C.card, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "18px 20px", borderBottom: `1px solid ${C.border}` }}>
          <Undo2 size={17} style={{ color: C.accentText }} />
          <span style={{ fontSize: "15px", fontWeight: 800, flex: 1 }}>
            반납 장바구니 <span style={{ color: C.accentText }}>{cart.length}종 · {cartTotal}개</span>
          </span>
          {cHeld ? (
            <span style={{ fontSize: "11.5px", fontWeight: 800, color: C.error, background: C.errorSoft, borderRadius: "999px", padding: "3px 10px" }}>
              계속 누르면 전체 해제…
            </span>
          ) : null}
          {cart.length > 0 ? (
            <button onClick={clearAll} style={{ background: "transparent", border: "none", color: C.label, cursor: "pointer", fontSize: "12px", fontWeight: 700 }}>
              비우기
            </button>
          ) : null}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "14px 20px", minHeight: 0 }}>
          {cart.length === 0 ? (
            <div style={{ textAlign: "center", padding: "56px 0", color: C.label, fontSize: "13px", lineHeight: 1.7 }}>
              담은 물품이 없습니다.<br />
              왼쪽에서 대여자를 고르고 <b style={{ color: C.accentText }}>A</b> 키를 눌러보세요.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {cart.map((c) => (
                <div key={c.key} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "11px 12px", borderRadius: "10px", background: C.cardSub, border: `1px solid ${C.border}` }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.itemLabel}</div>
                    <div style={{ fontSize: "10.5px", color: C.label, marginTop: "2px" }}>
                      {c.borrower}{c.location ? ` · ${c.location}` : ""}
                    </div>
                  </div>
                  <button onClick={() => changeQty(c.key, -1)} style={{ width: 26, height: 26, borderRadius: "7px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", fontSize: "13px", lineHeight: 1, flexShrink: 0 }}>−</button>
                  <span style={{ minWidth: "34px", textAlign: "center", fontSize: "13px", fontWeight: 800 }}>{c.qty}<span style={{ fontSize: "10.5px", color: C.label, fontWeight: 600 }}>/{c.max}</span></span>
                  <button onClick={() => changeQty(c.key, 1)} disabled={c.qty >= c.max} style={{ width: 26, height: 26, borderRadius: "7px", border: `1px solid ${C.border}`, background: C.card, color: c.qty >= c.max ? C.label : C.text, cursor: c.qty >= c.max ? "not-allowed" : "pointer", fontSize: "13px", lineHeight: 1, flexShrink: 0 }}>+</button>
                  <button onClick={() => setCart((prev) => prev.filter((x) => x.key !== c.key))} style={{ width: 26, height: 26, borderRadius: "7px", border: "none", background: C.errorSoft, color: C.error, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ padding: "16px 20px", borderTop: `1px solid ${C.border}` }}>
          <button
            onClick={submitReturn}
            disabled={!cart.length || submitting}
            style={{
              width: "100%", padding: "15px", borderRadius: "12px", border: "none",
              background: cart.length ? C.accent : C.border, color: "#fff",
              fontSize: "15px", fontWeight: 800, cursor: cart.length && !submitting ? "pointer" : "not-allowed",
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? "처리 중..." : `반납 처리하기 (${cartTotal}개) · B`}
          </button>
        </div>
      </div>
    </div>
  );
}
