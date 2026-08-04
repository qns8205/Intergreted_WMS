import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Search, RotateCcw, User, Package, X, Undo2, Check, MapPin, Repeat } from "lucide-react";
import {
  fetchUnreturnedItems, UnreturnedItem,
  postProcessReturn, fetchBorrowAppVersion,
  isVersionMismatchMessage, signalVersionOutdated,
  sendReturnReminderDm,
  fetchScenarioObjectsForAdmin, ScenarioObjectAdmin, postRecordBorrow, nowString,
  postSwapBorrowItem,
  fetchWarehouseBorrowedItems, postWarehouseRentBulk,
  fetchWarehouseInventory, WarehouseItem,
  postRecordBorrow as postBorrow,
} from "../utils/borrowApi";
import { smartMatch } from "../utils/search";
import { getGoogleDriveImageUrl } from "../utils/drive";

interface Props {
  scriptUrl: string;
  connected: boolean;
  isLightMode: boolean;
  showToast: (msg: string, type: "ok" | "error" | "info" | "warn") => void;
}

// 반납 장바구니 한 줄 = 특정 대여 행에서 몇 개를 반납할지
interface ReturnCartLine {
  key: string;                       // sheetType:rowIndex
  sheetType: "scenario" | "general" | "warehouse";
  rowIndex: number;                  // 창고 물품은 목록 순번(전송에는 쓰지 않는다)
  name?: string;                     // 창고 반납 전송용 품명
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
  // 분야: 시나리오·일반 / 공구 및 부품류 — 반납 처리 방식이 서로 달라 탭으로 나눈다
  const [category, setCategory] = useState<"scenario" | "warehouse">("scenario");
  const [whItems, setWhItems] = useState<UnreturnedItem[]>([]);
  const [whLoaded, setWhLoaded] = useState(false);
  const [whLoading, setWhLoading] = useState(false);

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
  // A를 한 번 누르면 사진을 먼저 보여주고, 다시 누르면 담는다 (엉뚱한 물품을 담는 실수 방지)
  const [preview, setPreview] = useState<{ key: string; item: UnreturnedItem } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 반납 후 곧바로 같은 물품을 다시 대여할지 (대여일 갱신 목적)
  const [reborrowAfter, setReborrowAfter] = useState(false);
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

  // 공구 및 부품류 미반납 목록 (탭을 처음 열 때 불러온다)
  const loadWarehouse = useCallback(async (silent = false) => {
    if (!connected || !scriptUrl) { setWhLoaded(true); return; }
    if (!silent) setWhLoading(true);
    try {
      const list = await fetchWarehouseBorrowedItems(scriptUrl, "");
      // 창고 목록은 행 번호가 없으므로 순번을 부여해 화면 키로만 쓴다
      setWhItems(list.map((it: any, i: number) => ({ ...it, sheetType: "warehouse", rowIndex: i + 1 })) as UnreturnedItem[]);
      setWhLoaded(true);
    } catch (e: any) {
      showToast(`공구 및 부품류 미반납 목록을 불러오지 못했습니다: ${e.message}`, "error");
    } finally {
      if (!silent) setWhLoading(false);
    }
  }, [connected, scriptUrl]);

  useEffect(() => {
    if (category === "warehouse" && !whLoaded && !whLoading) loadWarehouse();
  }, [category, whLoaded, whLoading, loadWarehouse]);

  // 분야가 바뀌면 담아둔 내용과 선택을 비운다 (반납 방식이 달라 섞으면 안 된다)
  useEffect(() => {
    setCart([]);
    addHistoryRef.current = [];
    setSelectedBorrower(null);
    setCursor(0);
    setPreview(null);
  }, [category]);

  const activeSource = category === "warehouse" ? whItems : items;
  const activeLoaded = category === "warehouse" ? whLoaded : loaded;
  const activeLoading = category === "warehouse" ? whLoading : loading;
  const reloadActive = (silent = false) => (category === "warehouse" ? loadWarehouse(silent) : load(silent));

  // 15초마다 자동 새로고침.
  // 다른 관리자가 처리한 내용이 바로 반영되도록 하되, 담아둔 장바구니와 선택은 유지한다.
  const submittingRef = useRef(false);
  submittingRef.current = submitting;
  useEffect(() => {
    if (!connected || !scriptUrl) return;
    const timer = window.setInterval(() => {
      if (submittingRef.current) return;      // 처리 중에는 건너뛴다
      if (document.hidden) return;            // 다른 탭을 보고 있으면 굳이 부르지 않는다
      reloadActive(true);                     // 조용히 갱신 (로딩 표시 없음)
    }, 15000);
    return () => window.clearInterval(timer);
  }, [connected, scriptUrl, load]);

  // 자동 새로고침으로 사라진 행(다른 사람이 먼저 반납한 경우)은 장바구니에서 정리한다.
  useEffect(() => {
    if (!activeLoaded || !cart.length) return;
    const alive = new Map(activeSource.map((it) => [`${it.sheetType}:${it.rowIndex}`, it.quantity || 1]));
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
  }, [activeSource, activeLoaded]);

  // 대여자별로 묶는다
  const borrowers = useMemo(() => {
    const map = new Map<string, { name: string; items: UnreturnedItem[]; qty: number; seats: string[] }>();
    activeSource.forEach((it) => {
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
  }, [activeSource, search]);

  const activeItems = useMemo(() => {
    if (!selectedBorrower) return [];
    return activeSource
      .filter((it) => (String(it.borrowerName || "").trim() || "(이름 없음)") === selectedBorrower)
      .sort((a, b) => String(a.location || "").localeCompare(String(b.location || "")));
  }, [activeSource, selectedBorrower]);

  // 연체 예외 처리: 사유가 있어 독촉하지 않을 사람은 목록에서 제외한다.
  // (장기 프로젝트 대여, 관리자 승인 보관 등)
  const EXEMPT_KEY = "wms_overdue_exempt_v1";
  const [exempt, setExempt] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem(EXEMPT_KEY);
      if (raw) return JSON.parse(raw) as Record<string, string>;
    } catch (e) { /* 무시 */ }
    return {};
  });

  function saveExempt(next: Record<string, string>) {
    setExempt(next);
    try { localStorage.setItem(EXEMPT_KEY, JSON.stringify(next)); } catch (e) { /* 무시 */ }
  }

  function toggleExempt(name: string) {
    if (exempt[name]) {
      if (!window.confirm(`${name}님을 예외에서 해제할까요? 다시 연체 목록에 표시됩니다.`)) return;
      const next = { ...exempt };
      delete next[name];
      saveExempt(next);
      showToast(`${name}님을 예외에서 해제했습니다.`, "ok");
      return;
    }
    const reason = window.prompt(`${name}님을 연체 목록에서 제외합니다.\n\n사유를 입력해주세요. (예: 장기 프로젝트 대여 승인)`, "");
    if (reason === null) return;
    saveExempt({ ...exempt, [name]: reason.trim() || "사유 미기재" });
    showToast(`${name}님을 연체 예외로 등록했습니다.`, "ok");
  }

  /* ── 공구 및 부품류 직접 대여 (관리자가 대신 처리) ── */
  const [whLendOpen, setWhLendOpen] = useState(false);
  const [whCatalog, setWhCatalog] = useState<WarehouseItem[]>([]);
  const [whLendName, setWhLendName] = useState("");
  const [whLendSearch, setWhLendSearch] = useState("");
  const [whLendNote, setWhLendNote] = useState("");
  const [whLendCart, setWhLendCart] = useState<{ rowIndex: number; location: string; name: string; quantity: number; stock: number }[]>([]);
  const [whLendSubmitting, setWhLendSubmitting] = useState(false);

  async function openWhLend() {
    setWhLendOpen(true);
    setWhLendCart([]);
    setWhLendName("");
    setWhLendSearch("");
    setWhLendNote("");
    if (!whCatalog.length && connected && scriptUrl) {
      try {
        setWhCatalog(await fetchWarehouseInventory(scriptUrl));
      } catch (e: any) {
        showToast(`공구 목록을 불러오지 못했습니다: ${e.message}`, "error");
      }
    }
  }

  function addWhLend(it: WarehouseItem) {
    const stock = Number(it.stock);
    const cap = isNaN(stock) ? 999 : stock;
    if (cap <= 0) { showToast("재고가 없는 물품입니다.", "warn"); return; }
    setWhLendCart((prev) => {
      const i = prev.findIndex((c) => c.rowIndex === it.rowIndex);
      if (i === -1) return [...prev, { rowIndex: it.rowIndex, location: it.location, name: it.name, quantity: 1, stock: cap }];
      if (prev[i].quantity >= cap) return prev;
      return prev.map((c, idx) => (idx === i ? { ...c, quantity: c.quantity + 1 } : c));
    });
  }

  async function submitWhLend() {
    if (!whLendName.trim()) { showToast("대여자 성함을 입력해주세요.", "warn"); return; }
    if (!whLendCart.length) { showToast("대여할 물품을 담아주세요.", "warn"); return; }
    setWhLendSubmitting(true);
    try {
      const res = await postWarehouseRentBulk(
        scriptUrl,
        whLendCart.map((c) => ({
          type: "대여" as const,
          location: c.location,
          name: c.name,
          qty: c.quantity,
          user: whLendName.trim(),
          note: whLendNote.trim() || "관리자 직접 대여",
        }))
      );
      if (!res.success) { showToast(res.error || "대여 처리 실패", "error"); return; }
      showToast(`${whLendName.trim()}님에게 ${whLendCart.reduce((n, c) => n + c.quantity, 0)}개를 대여했습니다.`, "ok");
      setWhLendOpen(false);
      setWhLendCart([]);
      loadWarehouse(true);
    } catch (e: any) {
      showToast(`대여 처리 실패: ${e.message}`, "error");
    } finally {
      setWhLendSubmitting(false);
    }
  }

  /* ── 물품 교체 (반납하면서 다른 오브젝트로 대체) ── */
  const [swapTarget, setSwapTarget] = useState<UnreturnedItem | null>(null);
  const [swapItemId, setSwapItemId] = useState("");
  const [swapQty, setSwapQty] = useState(1);
  const [swapSearch, setSwapSearch] = useState("");
  const [swapReason, setSwapReason] = useState("");
  const [swapping, setSwapping] = useState(false);

  async function openSwap(it: UnreturnedItem) {
    setSwapTarget(it);
    setSwapItemId("");
    setSwapQty(it.quantity || 1);
    setSwapSearch("");
    setSwapReason("");
    if (!lendCatalog.length && connected && scriptUrl) {
      try {
        setLendCatalog(await fetchScenarioObjectsForAdmin(scriptUrl));
      } catch (e: any) {
        showToast(`물품 목록을 불러오지 못했습니다: ${e.message}`, "error");
      }
    }
  }

  async function submitSwap() {
    if (!swapTarget) return;
    if (!swapItemId) { showToast("교체할 물품을 선택해주세요.", "warn"); return; }
    setSwapping(true);
    try {
      const ver = await fetchBorrowAppVersion(scriptUrl).catch(() => "");
      const res = await postSwapBorrowItem(scriptUrl, {
        sheetType: swapTarget.sheetType as "scenario" | "general",
        rowIndex: swapTarget.rowIndex,
        newItemId: swapItemId,
        newQuantity: swapQty,
        reason: swapReason.trim(),
      }, ver);
      if (!res.success && isVersionMismatchMessage(res.message)) { signalVersionOutdated(); return; }
      if (!res.success) { showToast(res.message || "물품 교체 실패", "error"); return; }
      showToast(res.message || "물품을 교체했습니다.", "ok");
      setSwapTarget(null);
      // 교체된 행은 반납 처리되므로 담아둔 장바구니에서도 정리한다
      const key = `${swapTarget.sheetType}:${swapTarget.rowIndex}`;
      setCart((prev) => prev.filter((c) => c.key !== key));
      addHistoryRef.current = addHistoryRef.current.filter((k) => k !== key);
      await load();
    } catch (e: any) {
      showToast(`물품 교체 실패: ${e.message}`, "error");
    } finally {
      setSwapping(false);
    }
  }

  /* ── 추가 대여 (반납하러 온 김에 더 빌려가는 경우) ── */
  const [lendTarget, setLendTarget] = useState<{ name: string; email: string; floor?: string; unit?: string } | null>(null);
  const [lendCatalog, setLendCatalog] = useState<ScenarioObjectAdmin[]>([]);
  const [lendSearch, setLendSearch] = useState("");
  const [lendCart, setLendCart] = useState<{ id: string; name: string; quantity: number; stock: number }[]>([]);
  const [lendSubmitting, setLendSubmitting] = useState(false);

  async function openLend(g: { name: string; items: UnreturnedItem[] }) {
    const first = g.items[0];
    setLendTarget({
      name: g.name,
      email: String(first?.email || ""),
      floor: first?.floor,
      unit: first?.unit,
    });
    setLendCart([]);
    setLendSearch("");
    if (!lendCatalog.length && connected && scriptUrl) {
      try {
        setLendCatalog(await fetchScenarioObjectsForAdmin(scriptUrl));
      } catch (e: any) {
        showToast(`물품 목록을 불러오지 못했습니다: ${e.message}`, "error");
      }
    }
  }

  const lendFiltered = useMemo(() => {
    const q = lendSearch.trim();
    const base = q ? lendCatalog.filter((it) => smartMatch([it.name, it.id, it.rootSlot], q)) : lendCatalog;
    return base.slice(0, 60);
  }, [lendCatalog, lendSearch]);

  function addLend(it: ScenarioObjectAdmin) {
    const stock = Number(it.stock) || 0;
    if (stock <= 0) { showToast("재고가 없는 물품입니다.", "warn"); return; }
    setLendCart((prev) => {
      const i = prev.findIndex((c) => c.id === it.id);
      if (i === -1) return [...prev, { id: it.id, name: it.name, quantity: 1, stock }];
      if (prev[i].quantity >= stock) return prev;
      return prev.map((c, idx) => (idx === i ? { ...c, quantity: c.quantity + 1 } : c));
    });
  }

  async function submitLend() {
    if (!lendTarget || !lendCart.length) { showToast("대여할 물품을 담아주세요.", "warn"); return; }
    setLendSubmitting(true);
    try {
      const ver = await fetchBorrowAppVersion(scriptUrl).catch(() => "");
      // 이메일에서 소속과 사번을 되짚는다 (cfgw-kr은 사번@cfgw-kr.com)
      const email = lendTarget.email;
      const isCfgw = /@cfgw-kr\.com$/i.test(email);
      const res = await postRecordBorrow(scriptUrl, [{
        itemType: "general",
        borrowerName: lendTarget.name,
        affiliation: isCfgw ? "cfgw" : (email ? "configds" : "other"),
        employeeId: isCfgw ? email.split("@")[0] : "",
        knownEmail: email || undefined,
        borrowDate: nowString(),
        borrowPurpose: "반납 처리 중 추가 대여",
        borrowedItems: lendCart.map((c) => ({ id: c.id, name: c.name, quantity: c.quantity })),
        generalOption: "추가 물품 대여",
        floor: lendTarget.floor,
        unit: lendTarget.unit,
      }], ver);

      if (!res.success && isVersionMismatchMessage(res.message)) { signalVersionOutdated(); return; }
      if (!res.success) { showToast(res.message || "대여 처리 실패", "error"); return; }
      showToast(res.message || `${lendTarget.name}님에게 ${lendCart.length}종을 추가 대여했습니다.`, "ok");
      setLendTarget(null);
      setLendCart([]);
      load(true);
    } catch (e: any) {
      showToast(`추가 대여 실패: ${e.message}`, "error");
    } finally {
      setLendSubmitting(false);
    }
  }

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

  // 물품별 경과일 (대여일 기준)
  const daysSince = (borrowDate?: string) => {
    const raw = String(borrowDate || "").trim();
    if (!raw) return null;
    const t = Date.parse(raw.replace(" ", "T"));
    if (isNaN(t)) return null;
    return Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
  };

  // 반납이 늦은 사람 (7일 이상 / 2일 이상)
  const overdue = useMemo(() => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const map = new Map<string, { name: string; email: string; days: number; qty: number; items: UnreturnedItem[] }>();

    activeSource.forEach((it) => {
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

    const all = Array.from(map.values())
      .filter((g) => !exempt[g.name]) // 예외로 등록된 사람은 제외
      .sort((a, b) => b.days - a.days || b.qty - a.qty);
    return { severe: all.filter((g) => g.days >= 7), mild: all.filter((g) => g.days >= 2 && g.days < 7) };
  }, [activeSource, exempt]);

  const [dmSending, setDmSending] = useState<string | null>(null);

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
          sheetType: it.sheetType as "scenario" | "general" | "warehouse",
          rowIndex: it.rowIndex,
          name: (it as any).name || it.itemLabel,
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

    // 시나리오 물품은 사진 확인 단계를 한 번 거친다.
    // (미리보기가 떠 있고 그 물품이 커서와 같으면 이번 A는 "담기"로 처리)
    if (category === "scenario") {
      const cur = activeItems[Math.min(cursor, activeItems.length - 1)];
      const curKey = cur ? `${cur.sheetType}:${cur.rowIndex}` : "";
      if (!preview || preview.key !== curKey) {
        if (cur && !isFull(cur)) { setPreview({ key: curKey, item: cur }); return; }
      }
      setPreview(null);
    }

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
  }, [selectedBorrower, activeItems, cursor, cart, addOne, isFull, category, preview]);

  // P / O : 담지 않고 커서만 옮긴다 (건너뛰고 싶은 물품이 있을 때)
  const moveCursor = useCallback((delta: number) => {
    if (!activeItems.length) return;
    setPreview(null); // 다른 물품으로 옮기면 미리보기는 닫는다
    setCursor((prev) => Math.max(0, Math.min(activeItems.length - 1, prev + delta)));
  }, [activeItems.length]);

  // 커서가 화면 밖으로 나가지 않도록 따라간다
  const cursorElRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    cursorElRef.current?.scrollIntoView({ block: "nearest" });
  }, [cursor, selectedBorrower]);

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

      // P: 담지 않고 다음 물품으로 이동 (건너뛰기)
      // O: 이전 물품으로 이동
      // 화살표 키는 페이지가 함께 스크롤되어 쓰지 않는다.
      if (k === "p" || e.key === "ㅔ") { e.preventDefault(); handlersRef.current.moveCursor(1); return; }
      if (k === "o" || e.key === "ㅐ") { e.preventDefault(); handlersRef.current.moveCursor(-1); return; }

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
      let res: { success: boolean; message?: string };
      if (category === "warehouse") {
        // 공구 및 부품류는 반납 로그를 쌓는 방식이라 별도 API를 쓴다
        const bulk = await postWarehouseRentBulk(
          scriptUrl,
          cart.map((c) => ({
            type: "반납" as const,
            location: c.location,
            name: c.name || c.itemLabel,
            qty: c.qty,
            user: c.borrower,
            note: "관리자 반납 처리",
          }))
        );
        res = { success: bulk.success, message: bulk.success ? `${cartTotal}개를 반납 처리했습니다.` : (bulk.error || "반납 처리 실패") };
      } else {
        const ver = await fetchBorrowAppVersion(scriptUrl).catch(() => "");
        res = await postProcessReturn(
          scriptUrl,
          cart.map((c) => ({ sheetType: c.sheetType as "scenario" | "general", rowIndex: c.rowIndex, quantity: c.qty })),
          ver
        );
      }
      if (!res.success && isVersionMismatchMessage(res.message)) { signalVersionOutdated(); return; }
      if (!res.success) { showToast(res.message || "반납 처리 실패", "error"); return; }
      // 반납 후 재대여: 같은 사람·같은 물품을 새 대여일로 다시 기록한다
      if (reborrowAfter) {
        try {
          const byBorrower: Record<string, typeof cart> = {};
          cart.forEach((c) => { (byBorrower[c.borrower] ||= []).push(c); });

          for (const who of Object.keys(byBorrower)) {
            const lines = byBorrower[who];
            if (category === "warehouse") {
              await postWarehouseRentBulk(
                scriptUrl,
                lines.map((c) => ({
                  type: "대여" as const,
                  location: c.location,
                  name: c.name || c.itemLabel,
                  qty: c.qty,
                  user: who,
                  note: "반납 후 재대여 (대여일 갱신)",
                }))
              );
            } else {
              // 원래 대여 기록에서 이메일·위치를 가져와 Slack 태깅과 좌석 정보를 유지한다
              const src = activeSource.find((it) => `${it.sheetType}:${it.rowIndex}` === lines[0].key);
              const ver2 = await fetchBorrowAppVersion(scriptUrl).catch(() => "");
              await postBorrow(scriptUrl, [{
                itemType: "general",
                borrowerName: who,
                affiliation: "",
                employeeId: "",
                knownEmail: src?.email || undefined,
                borrowDate: nowString(),
                borrowPurpose: "반납 후 재대여 (대여일 갱신)",
                generalOption: "재대여",
                borrowedItems: lines.map((c) => {
                  const item = activeSource.find((it) => `${it.sheetType}:${it.rowIndex}` === c.key);
                  return { id: item?.itemId || "", name: item?.itemName || c.itemLabel, quantity: c.qty };
                }).filter((x) => x.id),
                floor: src?.floor,
                unit: src?.unit,
              }], ver2);
            }
          }
          showToast(`${cartTotal}개를 반납 후 다시 대여했습니다. (대여일 갱신)`, "ok");
        } catch (reErr: any) {
          showToast(`반납은 완료했지만 재대여에 실패했습니다: ${reErr.message}`, "warn");
        }
      } else {
        showToast(res.message || `${cartTotal}개를 반납 처리했습니다.`, "ok");
      }

      // 서버 재조회를 기다리지 않고 화면에서 먼저 반영한다 (처리 직후 바로 다음 작업이 가능하도록).
      const done = new Map(cart.map((c) => [c.key, c.qty]));
      const applyLocal = category === "warehouse" ? setWhItems : setItems;
      if (!reborrowAfter) applyLocal((prev) =>
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
      reloadActive(true); // 정합성은 백그라운드로 맞춘다
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
          {category === "warehouse" ? (
            <button
              onClick={openWhLend}
              style={{ ...inputStyle, cursor: "pointer", display: "flex", alignItems: "center", gap: "5px", fontWeight: 800, color: "#fff", background: C.accent, border: `1px solid ${C.accent}` }}
            >
              + 직접 대여
            </button>
          ) : null}
          <span style={{ fontSize: "11px", color: C.label }}>15초마다 자동 새로고침</span>
          <button onClick={() => reloadActive()} title="지금 새로고침" style={{ ...inputStyle, cursor: "pointer", display: "flex", alignItems: "center", gap: "5px", fontWeight: 700, color: C.accentText }}>
            <RotateCcw size={14} />
          </button>
        </div>

        {/* 분야 탭 — 반납 처리 방식이 달라 분리해서 다룬다 */}
        <div style={{ display: "flex", gap: "6px", marginBottom: "12px" }}>
          {([["scenario", "🧩 시나리오 물품"], ["warehouse", "🔧 공구 및 부품류"]] as const).map(([v, label]) => {
            const on = category === v;
            return (
              <button
                key={v}
                onClick={() => setCategory(v)}
                style={{
                  flex: 1, padding: "10px", borderRadius: "11px", cursor: "pointer",
                  fontSize: "13px", fontWeight: 800,
                  border: `1px solid ${on ? C.accent : C.border}`,
                  background: on ? C.accentSoft : C.card,
                  color: on ? C.accentText : C.label,
                }}
              >
                {label}
              </button>
            );
          })}
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
          {category === "scenario" ? <><b style={{ color: C.accentText }}>우클릭</b> 다른 물품으로 교체 · </> : null}<b style={{ color: C.accentText }}>A</b> {category === "scenario" ? "사진 확인 → 한 번 더 눌러 담기" : "한 개 담기"} · <b style={{ color: C.accentText }}>P</b> 다음 물품 ·{" "}
          <b style={{ color: C.accentText }}>O</b> 이전 물품 · <b style={{ color: C.accentText }}>B</b> 반납 완료 ·{" "}
          <b style={{ color: C.accentText }}>C</b> 하나 되돌리기 (꾹 누르면 전체 해제)
        </div>

        {/* 연체 예외로 등록된 사람 */}
        {Object.keys(exempt).length > 0 ? (
          <div style={{ marginBottom: "12px", border: `1px solid ${C.border}`, background: C.cardSub, borderRadius: "12px", padding: "10px 13px" }}>
            <div style={{ fontSize: "11.5px", fontWeight: 800, color: C.label, marginBottom: "7px" }}>
              연체 예외 {Object.keys(exempt).length}명 <span style={{ fontWeight: 500 }}>(연체 목록·DM 대상에서 제외)</span>
            </div>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {Object.entries(exempt).map(([name, why]) => (
                <button
                  key={name}
                  onClick={() => toggleExempt(name)}
                  title={`${why}\n누르면 예외를 해제합니다`}
                  style={{
                    display: "flex", alignItems: "center", gap: "6px",
                    padding: "5px 11px", borderRadius: "999px", cursor: "pointer",
                    border: `1px solid ${C.border}`, background: C.card, color: C.label,
                    fontSize: "11.5px", fontWeight: 700,
                  }}
                >
                  {name}
                  <span style={{ fontWeight: 500, opacity: 0.8, maxWidth: "140px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{why}</span>
                  <X size={11} />
                </button>
              ))}
            </div>
          </div>
        ) : null}

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
                      onContextMenu={(e) => { e.preventDefault(); toggleExempt(g.name); }}
                      disabled={dmSending === g.name}
                      title={`${g.name} · ${g.days}일 경과 · ${g.qty}개\n좌클릭: Slack DM으로 반납 요청\n우클릭: 연체 예외로 등록`}
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
                  이름을 누르면 Slack DM으로 반납 요청 · 우클릭하면 연체 예외로 등록합니다.
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {activeLoading && !activeLoaded ? (
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
                    {category === "scenario" ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); openLend(g); }}
                      title={`${g.name}님에게 물품 추가 대여`}
                      style={{
                        flexShrink: 0, display: "flex", alignItems: "center", gap: "4px",
                        padding: "5px 11px", borderRadius: "999px", cursor: "pointer",
                        border: `1px solid ${C.accent}`, background: C.card, color: C.accentText,
                        fontSize: "11px", fontWeight: 700,
                      }}
                    >
                      + 대여
                    </button>
                    ) : null}
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
                            ref={atCursor ? cursorElRef : undefined}
                            onClick={() => { setCursor(idx); if (!done) addOne(it); }}
                            onContextMenu={(e) => {
                              if (category === "warehouse") return; // 창고 물품은 교체 대상이 아니다
                              e.preventDefault(); setCursor(idx); openSwap(it);
                            }}
                            title={category === "warehouse" ? undefined : "우클릭하면 다른 물품으로 교체할 수 있습니다"}
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
                              <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
                                <span style={{ flex: 1, minWidth: 0, fontSize: "12.5px", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.itemLabel}</span>
                                {(() => {
                                  const d = daysSince(it.borrowDate);
                                  if (d === null || d < 2) return null;
                                  const severe = d >= 7;
                                  return (
                                    <span
                                      title={`${it.borrowDate} 대여 · ${d}일 경과`}
                                      style={{
                                        flexShrink: 0, fontSize: "10px", fontWeight: 800, borderRadius: "999px", padding: "2px 7px",
                                        color: severe ? C.error : C.warn,
                                        background: severe ? C.errorSoft : C.warnSoft,
                                      }}
                                    >
                                      {severe ? `⚠ ${d}일` : `${d}일`}
                                    </span>
                                  );
                                })()}
                              </div>
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

      {/* 공구 및 부품류 직접 대여 — 실수로 닫히지 않도록 배경 클릭으로는 닫지 않는다 */}
      {whLendOpen ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 4300, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
          <div style={{ width: "min(600px, 100%)", maxHeight: "86vh", display: "flex", flexDirection: "column", background: C.card, borderRadius: "16px", border: `1px solid ${C.border}`, padding: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
              <Package size={17} style={{ color: C.accentText }} />
              <span style={{ fontSize: "15px", fontWeight: 800, flex: 1 }}>공구 및 부품류 직접 대여</span>
              <button onClick={() => setWhLendOpen(false)} title="닫기" style={{ background: "transparent", border: "none", color: C.label, cursor: "pointer" }}><X size={19} /></button>
            </div>

            <input
              value={whLendName}
              onChange={(e) => setWhLendName(e.target.value.replace(/[^\uAC00-\uD7A3\u3131-\u318E\s]/g, ""))}
              placeholder="대여자 성함 (필수)"
              style={{ ...inputStyle, width: "100%", boxSizing: "border-box", marginBottom: "8px", fontWeight: 700 }}
            />

            <div style={{ position: "relative", marginBottom: "10px" }}>
              <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
              <input
                value={whLendSearch}
                onChange={(e) => setWhLendSearch(e.target.value)}
                placeholder="물품명 · 위치로 검색"
                style={{ ...inputStyle, width: "100%", boxSizing: "border-box", paddingLeft: "36px" }}
              />
            </div>

            <div style={{ flex: 1, minHeight: "160px", overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: "10px", marginBottom: "12px" }}>
              {whCatalog.length === 0 ? (
                <div style={{ padding: "24px", textAlign: "center", fontSize: "12.5px", color: C.label }}>공구 목록을 불러오는 중입니다...</div>
              ) : (
                whCatalog
                  .filter((it) => !whLendSearch.trim() || smartMatch([it.name, it.location, it.spec], whLendSearch))
                  .slice(0, 60)
                  .map((it) => {
                    const stock = Number(it.stock);
                    const soldOut = !isNaN(stock) && stock <= 0;
                    const picked = whLendCart.find((c) => c.rowIndex === it.rowIndex)?.quantity || 0;
                    return (
                      <div
                        key={it.rowIndex}
                        onClick={() => addWhLend(it)}
                        style={{
                          display: "flex", alignItems: "center", gap: "9px", padding: "9px 12px",
                          borderBottom: `1px solid ${C.border}`, cursor: soldOut ? "not-allowed" : "pointer",
                          opacity: soldOut ? 0.45 : 1, background: picked > 0 ? C.accentSoft : "transparent",
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "12.5px", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</div>
                          <div style={{ fontSize: "10.5px", color: C.warn, fontFamily: "monospace" }}>{it.location}</div>
                        </div>
                        <span style={{ flexShrink: 0, fontSize: "11px", fontWeight: 700, color: soldOut ? C.error : C.success }}>
                          재고 {isNaN(stock) ? "N/A" : stock}
                        </span>
                        {picked > 0 ? <span style={{ flexShrink: 0, fontSize: "11.5px", fontWeight: 800, color: C.accentText }}>{picked}개</span> : null}
                      </div>
                    );
                  })
              )}
            </div>

            {whLendCart.length > 0 ? (
              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: "10px", marginBottom: "10px", display: "flex", flexDirection: "column", gap: "6px", maxHeight: "140px", overflowY: "auto" }}>
                {whLendCart.map((c, idx) => (
                  <div key={c.rowIndex} style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: "12.5px", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                    <button onClick={() => setWhLendCart((prev) => prev.map((x, i) => (i === idx ? { ...x, quantity: x.quantity - 1 } : x)).filter((x) => x.quantity > 0))}
                      style={{ width: 24, height: 24, borderRadius: "7px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", fontSize: "12px", lineHeight: 1 }}>−</button>
                    <span style={{ minWidth: "34px", textAlign: "center", fontSize: "12.5px", fontWeight: 800 }}>{c.quantity}<span style={{ fontSize: "10px", color: C.label }}>/{c.stock}</span></span>
                    <button onClick={() => setWhLendCart((prev) => prev.map((x, i) => (i === idx ? { ...x, quantity: Math.min(x.stock, x.quantity + 1) } : x)))}
                      style={{ width: 24, height: 24, borderRadius: "7px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", fontSize: "12px", lineHeight: 1 }}>+</button>
                  </div>
                ))}
              </div>
            ) : null}

            <input
              value={whLendNote}
              onChange={(e) => setWhLendNote(e.target.value)}
              placeholder="목적 / 메모 (선택)"
              style={{ ...inputStyle, width: "100%", boxSizing: "border-box", marginBottom: "12px" }}
            />

            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={() => setWhLendOpen(false)}
                disabled={whLendSubmitting}
                style={{ flex: 1, padding: "13px", borderRadius: "11px", border: `1px solid ${C.border}`, background: "transparent", color: C.label, cursor: "pointer", fontSize: "13px", fontWeight: 700 }}
              >
                취소
              </button>
              <button
                onClick={submitWhLend}
                disabled={whLendSubmitting || !whLendCart.length || !whLendName.trim()}
                style={{
                  flex: 2, padding: "13px", borderRadius: "11px", border: "none",
                  background: (whLendCart.length && whLendName.trim()) ? C.accent : C.border, color: "#fff",
                  cursor: (whLendCart.length && whLendName.trim() && !whLendSubmitting) ? "pointer" : "not-allowed",
                  fontSize: "14px", fontWeight: 800, opacity: whLendSubmitting ? 0.7 : 1,
                }}
              >
                {whLendSubmitting ? "처리 중..." : `대여 처리하기 (${whLendCart.reduce((n, c) => n + c.quantity, 0)}개)`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* A 1회: 사진 확인 → A 한 번 더: 담기 */}
      {preview ? (
        <div
          onClick={() => setPreview(null)}
          style={{ position: "fixed", inset: 0, zIndex: 4200, background: "rgba(15,23,42,0.62)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(420px, 100%)", background: C.card, borderRadius: "18px", border: `2px solid ${C.accent}`, padding: "20px", textAlign: "center" }}
          >
            <div style={{ width: "100%", height: "230px", borderRadius: "12px", overflow: "hidden", background: C.cardSub, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "14px" }}>
              {preview.item.image ? (
                <img src={getGoogleDriveImageUrl(preview.item.image)} alt="" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
              ) : (
                <div style={{ color: C.label, fontSize: "13px", display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
                  <Package size={34} style={{ opacity: 0.4 }} />
                  등록된 사진이 없습니다
                </div>
              )}
            </div>

            <div style={{ fontSize: "15px", fontWeight: 800, color: C.text, marginBottom: "4px" }}>{preview.item.itemLabel}</div>
            <div style={{ fontSize: "12px", color: C.label, marginBottom: "16px" }}>
              {preview.item.location ? `📍 ${preview.item.location} · ` : ""}
              {inCartQty(preview.item)} / {preview.item.quantity || 1}개 담김
            </div>

            <div style={{ display: "flex", gap: "9px" }}>
              <button
                onClick={() => setPreview(null)}
                style={{ flex: 1, padding: "13px", borderRadius: "11px", border: `1px solid ${C.border}`, background: "transparent", color: C.label, cursor: "pointer", fontSize: "13px", fontWeight: 700 }}
              >
                취소
              </button>
              <button
                onClick={() => { const it = preview.item; setPreview(null); addOne(it); }}
                style={{ flex: 2, padding: "13px", borderRadius: "11px", border: "none", background: C.accent, color: "#fff", cursor: "pointer", fontSize: "14px", fontWeight: 800 }}
              >
                맞습니다 · 담기 (A)
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 물품 교체 모달 */}
      {swapTarget ? (
        <div
          onClick={() => !swapping && setSwapTarget(null)}
          style={{ position: "fixed", inset: 0, zIndex: 4100, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(560px, 100%)", maxHeight: "84vh", display: "flex", flexDirection: "column", background: C.card, borderRadius: "16px", border: `1px solid ${C.border}`, padding: "20px" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
              <Repeat size={17} style={{ color: C.accentText }} />
              <span style={{ fontSize: "15px", fontWeight: 800, flex: 1 }}>물품 교체</span>
              <button onClick={() => setSwapTarget(null)} style={{ background: "transparent", border: "none", color: C.label, cursor: "pointer" }}><X size={19} /></button>
            </div>

            <div style={{ padding: "11px 13px", borderRadius: "10px", background: C.cardSub, border: `1px solid ${C.border}`, marginBottom: "12px" }}>
              <div style={{ fontSize: "10.5px", color: C.label, marginBottom: "3px" }}>기존 물품 (반납 처리됩니다)</div>
              <div style={{ fontSize: "13px", fontWeight: 700 }}>{swapTarget.itemLabel}</div>
              <div style={{ fontSize: "11px", color: C.label, marginTop: "2px" }}>
                {swapTarget.borrowerName}{swapTarget.location ? ` · ${swapTarget.location}` : ""}
              </div>
            </div>

            <div style={{ position: "relative", marginBottom: "10px" }}>
              <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
              <input
                value={swapSearch}
                onChange={(e) => setSwapSearch(e.target.value)}
                placeholder="교체할 물품 검색 (이름 · ID · 위치)"
                style={{ ...inputStyle, width: "100%", boxSizing: "border-box", paddingLeft: "36px" }}
              />
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: "10px", marginBottom: "12px" }}>
              {lendCatalog.length === 0 ? (
                <div style={{ padding: "24px", textAlign: "center", fontSize: "12.5px", color: C.label }}>물품 목록을 불러오는 중입니다...</div>
              ) : (
                lendCatalog
                  .filter((it) => !swapSearch.trim() || smartMatch([it.name, it.id, it.rootSlot], swapSearch))
                  .slice(0, 60)
                  .map((it) => {
                    const stock = Number(it.stock) || 0;
                    const on = swapItemId === it.id;
                    return (
                      <div
                        key={it.id}
                        onClick={() => { if (stock > 0) { setSwapItemId(it.id); setSwapQty((q) => Math.min(q, stock) || 1); } }}
                        style={{
                          display: "flex", alignItems: "center", gap: "9px", padding: "9px 12px",
                          borderBottom: `1px solid ${C.border}`, cursor: stock > 0 ? "pointer" : "not-allowed",
                          opacity: stock > 0 ? 1 : 0.45, background: on ? C.accentSoft : "transparent",
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "12.5px", fontWeight: 700, color: on ? C.accentText : C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</div>
                          <div style={{ fontSize: "10.5px", color: C.label, fontFamily: "monospace" }}>{it.id} · {it.rootSlot || "위치 없음"}</div>
                        </div>
                        <span style={{ flexShrink: 0, fontSize: "11px", fontWeight: 700, color: stock > 0 ? C.success : C.error }}>재고 {stock}</span>
                      </div>
                    );
                  })
              )}
            </div>

            <div style={{ display: "flex", gap: "10px", marginBottom: "12px" }}>
              <div style={{ flex: "0 0 110px" }}>
                <div style={{ fontSize: "11.5px", fontWeight: 700, color: C.label, marginBottom: "5px" }}>수량</div>
                <input type="number" min={1} value={swapQty}
                  onChange={(e) => setSwapQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "11.5px", fontWeight: 700, color: C.label, marginBottom: "5px" }}>사유 (선택)</div>
                <input value={swapReason} onChange={(e) => setSwapReason(e.target.value)} placeholder="예: 파손으로 대체"
                  style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
              </div>
            </div>

            <button
              onClick={submitSwap}
              disabled={!swapItemId || swapping}
              style={{
                width: "100%", padding: "14px", borderRadius: "12px", border: "none",
                background: swapItemId ? C.accent : C.border, color: "#fff",
                fontSize: "14.5px", fontWeight: 800,
                cursor: swapItemId && !swapping ? "pointer" : "not-allowed", opacity: swapping ? 0.7 : 1,
              }}
            >
              {swapping ? "교체 중..." : "교체하기"}
            </button>
          </div>
        </div>
      ) : null}

      {/* 추가 대여 모달 */}
      {lendTarget ? (
        <div
          onClick={() => !lendSubmitting && setLendTarget(null)}
          style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(560px, 100%)", maxHeight: "84vh", display: "flex", flexDirection: "column", background: C.card, borderRadius: "16px", border: `1px solid ${C.border}`, padding: "20px" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
              <Package size={17} style={{ color: C.accentText }} />
              <span style={{ fontSize: "15px", fontWeight: 800, flex: 1 }}>추가 대여 — {lendTarget.name}</span>
              <button onClick={() => setLendTarget(null)} style={{ background: "transparent", border: "none", color: C.label, cursor: "pointer" }}><X size={19} /></button>
            </div>
            <div style={{ fontSize: "11.5px", color: C.label, marginBottom: "12px" }}>
              {[lendTarget.floor, lendTarget.unit].filter(Boolean).join(" · ") || "위치 정보 없음"} · 대여 기록과 Slack 알림은 본인 명의로 남습니다.
            </div>

            <div style={{ position: "relative", marginBottom: "10px" }}>
              <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
              <input
                value={lendSearch}
                onChange={(e) => setLendSearch(e.target.value)}
                placeholder="물품명 · ID · 위치로 검색"
                style={{ ...inputStyle, width: "100%", boxSizing: "border-box", paddingLeft: "36px" }}
              />
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: "10px", marginBottom: "12px" }}>
              {lendFiltered.length === 0 ? (
                <div style={{ padding: "24px", textAlign: "center", fontSize: "12.5px", color: C.label }}>
                  {lendCatalog.length === 0 ? "물품 목록을 불러오는 중입니다..." : "검색 결과가 없습니다."}
                </div>
              ) : (
                lendFiltered.map((it) => {
                  const stock = Number(it.stock) || 0;
                  const picked = lendCart.find((c) => c.id === it.id)?.quantity || 0;
                  return (
                    <div
                      key={it.id}
                      onClick={() => addLend(it)}
                      style={{
                        display: "flex", alignItems: "center", gap: "9px", padding: "9px 12px",
                        borderBottom: `1px solid ${C.border}`, cursor: stock > 0 ? "pointer" : "not-allowed",
                        opacity: stock > 0 ? 1 : 0.45,
                        background: picked > 0 ? C.accentSoft : "transparent",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "12.5px", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</div>
                        <div style={{ fontSize: "10.5px", color: C.label, fontFamily: "monospace" }}>{it.id} · {it.rootSlot || "위치 없음"}</div>
                      </div>
                      <span style={{ flexShrink: 0, fontSize: "11px", fontWeight: 700, color: stock > 0 ? C.success : C.error }}>재고 {stock}</span>
                      {picked > 0 ? <span style={{ flexShrink: 0, fontSize: "11.5px", fontWeight: 800, color: C.accentText }}>{picked}개</span> : null}
                    </div>
                  );
                })
              )}
            </div>

            {lendCart.length > 0 ? (
              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: "10px", marginBottom: "12px", display: "flex", flexDirection: "column", gap: "6px", maxHeight: "150px", overflowY: "auto" }}>
                {lendCart.map((c, idx) => (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: "12.5px", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                    <button onClick={() => setLendCart((prev) => prev.map((x, i) => (i === idx ? { ...x, quantity: Math.max(0, x.quantity - 1) } : x)).filter((x) => x.quantity > 0))}
                      style={{ width: 24, height: 24, borderRadius: "7px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", fontSize: "12px", lineHeight: 1 }}>−</button>
                    <span style={{ minWidth: "34px", textAlign: "center", fontSize: "12.5px", fontWeight: 800 }}>{c.quantity}<span style={{ fontSize: "10px", color: C.label }}>/{c.stock}</span></span>
                    <button onClick={() => setLendCart((prev) => prev.map((x, i) => (i === idx ? { ...x, quantity: Math.min(x.stock, x.quantity + 1) } : x)))}
                      style={{ width: 24, height: 24, borderRadius: "7px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", fontSize: "12px", lineHeight: 1 }}>+</button>
                  </div>
                ))}
              </div>
            ) : null}

            <button
              onClick={submitLend}
              disabled={!lendCart.length || lendSubmitting}
              style={{
                width: "100%", padding: "14px", borderRadius: "12px", border: "none",
                background: lendCart.length ? C.accent : C.border, color: "#fff",
                fontSize: "14.5px", fontWeight: 800,
                cursor: lendCart.length && !lendSubmitting ? "pointer" : "not-allowed",
                opacity: lendSubmitting ? 0.7 : 1,
              }}
            >
              {lendSubmitting ? "처리 중..." : `대여 처리하기 (${lendCart.reduce((n, c) => n + c.quantity, 0)}개)`}
            </button>
          </div>
        </div>
      ) : null}

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
          <label
            style={{
              display: "flex", alignItems: "center", gap: "9px", padding: "10px 12px", marginBottom: "10px",
              borderRadius: "10px", cursor: "pointer",
              border: `1px solid ${reborrowAfter ? C.accent : C.border}`,
              background: reborrowAfter ? C.accentSoft : "transparent",
            }}
          >
            <input type="checkbox" checked={reborrowAfter} onChange={(e) => setReborrowAfter(e.target.checked)} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: "12.5px", fontWeight: 800, color: reborrowAfter ? C.accentText : C.text }}>
                반납 후 재대여 (대여일 갱신)
              </span>
              <span style={{ display: "block", fontSize: "10.5px", color: C.label, marginTop: "2px", lineHeight: 1.5 }}>
                실물은 그대로 두고 대여 기록만 오늘로 새로 남깁니다.
              </span>
            </span>
          </label>

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
            {submitting ? "처리 중..." : reborrowAfter ? `반납 후 재대여 (${cartTotal}개) · B` : `반납 처리하기 (${cartTotal}개) · B`}
          </button>
        </div>
      </div>
    </div>
  );
}
