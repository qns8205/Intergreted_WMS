import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { Search, Plus, X, Pencil, Trash2, MapPin, Save, Upload, Camera, Layers, Archive, ArchiveRestore, RotateCcw, History, Link2, ExternalLink, Copy, SlidersHorizontal, ChevronUp, ChevronDown, ArrowUpDown } from "lucide-react";
import ImageZoomModal from "./ImageZoomModal";
import { locationKey, locationOptions } from "../utils/tableclothLocation";
import {
  TC_DEFAULT_CATEGORIES, TcCategory, tcCategory, tcLabel, tcColor, tcCategoryOptions, tcNewKey,
  tcLinks, tcLinkLabel,
} from "../utils/tableclothCategory";
import ScrollToTopButton from "./ScrollToTopButton";
import CameraCaptureModal from "./CameraCaptureModal";
import TableclothCategoryPicker from "./TableclothCategoryPicker";
import { getThumbImageUrl, getGoogleDriveImageUrl, resizeAndCompressImage } from "../utils/drive";
import { smartMatch } from "../utils/search";
import {
  TableclothItem, TableclothRental, TableclothCategory, updateTableclothArchived,
  deleteTableclothItems, duplicateTableclothItems,
  fetchTableclothCategories, fetchTableclothCategoryUsage, saveTableclothCategories,
  fetchTableclothItems, addTableclothItem, updateTableclothItem, updateTableclothLocations, updateTableclothCategories, deleteTableclothItem,
  fetchTableclothRentalLogs,
} from "../utils/borrowApi";
import { useVersionWorkGuard } from "../utils/versionWorkGuard";
import StockAdjustModal from "./StockAdjustModal";

interface Props {
  scriptUrl: string;
  connected: boolean;
  isLightMode: boolean;
  showToast: (msg: string, type: "ok" | "error" | "info" | "warn") => void;
}

type Form = Partial<TableclothItem>;

/** 천을 다 펼쳐서 재기가 번거로워 보통 1/4로 접은(가로·세로를 각각 반으로 접은) 상태로 잰다.
 *  그래서 한 변당 2배가 펼친 크기다. DB에는 항상 펼친 크기만 저장하고, 접은 값은 입력할 때만 쓴다. */
const FOLD_FACTOR = 2;

/** 천은 두께가 의미 없어 가로·세로만 쓴다. 둘 다 있어야 크기를 표시한다. */
function sizeLabel(it: Form): string {
  const w = Number(it.widthMm), d = Number(it.depthMm);
  if (!(w > 0 && d > 0)) return "";
  const cm = (v: number) => { const n = v / 10; return Number.isInteger(n) ? String(n) : n.toFixed(1); };
  return `${cm(w)} × ${cm(d)}cm`;
}

export default function TableclothAdminPage({ scriptUrl, connected, isLightMode, showToast }: Props) {
  // 시나리오 물품 관리와 같은 색 토큰을 쓴다 — 같은 "물품 관리" 안의 화면이라 톤이 갈리면 안 된다.
  const C = {
    bg: isLightMode ? "#f8fafc" : "#0b0f19",
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

  const [items, setItems] = useState<TableclothItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  // 위치 필터 — "" 는 전체. 표기가 흔들리는 위치를 정규화 키로 묶어 고른다.
  const [locFilter, setLocFilter] = useState("");
  // 무늬 분류 필터 — ""는 전체.
  const [catFilter, setCatFilter] = useState("");
  // 고정 머리에는 검색만 남기고 탭·작업·필터는 한 번에 접는다.
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const toolbarTouchY = useRef<number | null>(null);
  // 분류표 — 서버가 원본이고 "분류 관리" 탭에서 고친다. 도착 전에는 기본 목록으로 그린다.
  const [cats, setCats] = useState<TcCategory[]>(TC_DEFAULT_CATEGORIES);
  // 위치 일괄 변경 — 선택 모드일 때만 카드에 체크 표시가 붙는다.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkLocation, setBulkLocation] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  // 분류 일괄 지정 — 사진을 훑으며 같은 결의 천을 골라 한 번에 찍는 게 한 장씩 여는 것보다 빠르다.
  const [bulkCatOpen, setBulkCatOpen] = useState(false);
  // 그대로 복사 — 같은 천을 다른 층에도 두려고 만든 기능이라 복사할 위치를 먼저 고른다.
  const [dupOpen, setDupOpen] = useState(false);
  const [dupLocation, setDupLocation] = useState("");
  const [bulkCat, setBulkCat] = useState("");
  const [editing, setEditing] = useState<Form | null>(null);
  const [stockAdjustItem, setStockAdjustItem] = useState<TableclothItem | null>(null);
  const [isNew, setIsNew] = useState(false);
  // 크기를 접은 채로 재서 넣는 중인지. 현장에서 그게 기본이라 켜둔 채로 시작한다.
  const [foldedInput, setFoldedInput] = useState(true);
  const [saving, setSaving] = useState(false);
  const [camOpen, setCamOpen] = useState(false);
  const [modalUrl, setModalUrl] = useState("");
  // 대여 이력 — 테이블보는 담당자 확인 단계가 없어서, 지금 누가 들고 있는지를 이 장부로만 알 수 있다.
  // 대여 이력은 담당자 확인 없이 오가는 물건을 추적하는 유일한 창구라 상단 탭으로 꺼내 둔다.
  const [tab, setTab] = useState<"items" | "logs" | "cats">("items");
  const [logs, setLogs] = useState<TableclothRental[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsOnlyOut, setLogsOnlyOut] = useState(true);
  useVersionWorkGuard("tablecloth-admin-work", !!editing || saving || bulkSaving || bulkOpen || bulkCatOpen || dupOpen, "테이블보 관리 작업 중");

  const loadLogs = useCallback(async () => {
    if (!connected || !scriptUrl) return;
    setLogsLoading(true);
    try {
      setLogs(await fetchTableclothRentalLogs(scriptUrl));
    } catch (e: any) {
      showToast("대여 이력을 불러오지 못했습니다: " + e.message, "error");
    } finally {
      setLogsLoading(false);
    }
  }, [connected, scriptUrl, showToast]);

  useEffect(() => { loadLogs(); }, [loadLogs]);
  useEffect(() => { if (tab === "logs") loadLogs(); }, [tab, loadLogs]);

  // 지금 나가 있는 건수 — 탭 배지로 늘 보인다.
  const outCount = useMemo(() => logs.filter((r) => !r.returned).length, [logs]);

  const [lastSync, setLastSync] = useState<Date | null>(null);
  // 배경 갱신은 매번 다시 그리면 스크롤이 튀므로, 내용이 실제로 달라졌을 때만 반영한다.
  const sigRef = useRef("");
  const signature = (list: TableclothItem[]) =>
    list.map((x) => `${x.id}:${x.name}:${x.stock}:${x.rented}:${x.location}:${x.image}:${x.widthMm}:${x.depthMm}:${x.category}:${x.subcategory}:${x.link}:${x.note}:${x.archived}`).join("|");

  /** silent=true면 다른 사람이 바꾼 내용을 조용히 따라잡는다(스피너·토스트 없음). */
  const load = useCallback(async (silent = false) => {
    if (!connected) return;
    if (!silent) setLoading(true);
    try {
      const next = await fetchTableclothItems(scriptUrl);
      const sig = signature(next);
      if (sig !== sigRef.current) {
        const had = sigRef.current !== "";
        sigRef.current = sig;
        setItems(next);
        // 처음 불러올 때는 알리지 않는다 — 바뀐 게 아니라 그냥 켠 것이다.
        if (silent && had) showToast("테이블보 목록이 갱신되었습니다.", "info");
      }
      setLastSync(new Date());
    } catch (e: any) {
      if (!silent) showToast("테이블보 목록을 불러오지 못했습니다: " + e.message, "error");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [scriptUrl, connected, showToast]);

  useEffect(() => { load(); }, [load]);

  // 편집 중이거나 화면이 안 보일 때는 갱신하지 않는다 — 입력하던 내용이 날아가거나
  // 보지도 않는 화면 때문에 서버를 두드리는 일이 없게 한다.
  const busy = !!editing || camOpen || !!modalUrl;
  useEffect(() => {
    if (!connected || busy) return;
    const tick = () => { if (document.visibilityState === "visible") load(true); };
    const timer = window.setInterval(tick, 20000);
    // 다른 탭에 갔다 돌아오면 곧바로 따라잡는다
    const onVisible = () => { if (document.visibilityState === "visible") load(true); };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [connected, busy, load]);

  const shown = useMemo(() => {
    const q = search.trim();
    return items
      .filter((it) => !!it.archived === showArchived)
      .filter((it) => (locFilter ? locationKey(it.location) === locFilter : true))
      // "미분류"는 분류가 비었거나 없어진 key를 가리키는 자리라 따로 걸러낸다.
      .filter((it) => (catFilter ? (catFilter === "__none__" ? !tcCategory(cats, it.category) : it.category === catFilter) : true))
      .filter((it) => (q ? smartMatch([it.name, it.location, it.note, it.link, tcLabel(cats, it.category)], q) : true));
  }, [items, search, showArchived, locFilter, catFilter, cats]);

  // 분류 칩 후보 — 위치 필터와 마찬가지로 지금 보고 있는 보관 상태 안에서만 센다.
  const catScope = useMemo(() => items.filter((it) => !!it.archived === showArchived), [items, showArchived]);
  const catOptions = useMemo(() => tcCategoryOptions(cats, catScope), [cats, catScope]);
  // 필터 후보는 지금 보고 있는 보관 상태(일반/보관함) 안에서만 뽑는다 — 없는 위치가 떠 있으면 헷갈린다.
  const locOptions = useMemo(
    () => locationOptions(items.filter((it) => !!it.archived === showArchived)),
    [items, showArchived]
  );

  // 위치별로 묶어서 구분선과 함께 보여준다. 목록 순서는 위치 필터 칩과 같은 순서를 쓴다.
  const groupedShown = useMemo(() => {
    const order = locationOptions(shown);
    return order
      .map((o) => ({ ...o, items: shown.filter((it) => locationKey(it.location) === o.key) }))
      .filter((g) => g.items.length);
  }, [shown]);

  const totalStock = useMemo(() => shown.reduce((n, it) => n + (Number(it.stock) || 0), 0), [shown]);

  const toggleSelected = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const exitSelectMode = () => { setSelectMode(false); setSelected(new Set()); };

  const applyBulkLocation = async () => {
    if (!selected.size) return;
    setBulkSaving(true);
    try {
      const res = await updateTableclothLocations(scriptUrl, [...selected], bulkLocation.trim());
      if (res?.success === false) { showToast(res.message || "위치 변경에 실패했습니다.", "error"); return; }
      showToast(res?.message || `${selected.size}종의 위치를 바꿨습니다.`, "ok");
      setBulkOpen(false);
      exitSelectMode();
      await load();
    } catch (e: any) {
      showToast("위치 변경 실패: " + e.message, "error");
    } finally {
      setBulkSaving(false);
    }
  };

  const applyBulkCategory = async () => {
    if (!selected.size) return;
    setBulkSaving(true);
    try {
      const res = await updateTableclothCategories(scriptUrl, [...selected], bulkCat, "");
      if (res?.success === false) { showToast(res.message || "분류 변경에 실패했습니다.", "error"); return; }
      showToast(res?.message || `${selected.size}종의 분류를 바꿨습니다.`, "ok");
      setBulkCatOpen(false);
      exitSelectMode();
      await load();
    } catch (e: any) {
      showToast("분류 변경 실패: " + e.message, "error");
    } finally {
      setBulkSaving(false);
    }
  };

  // ── 분류표 편집 ──────────────────────────────────────────
  // 서버에서 받은 표(cats)를 그대로 고치면 저장 전에도 목록 배지가 따라 움직여 헷갈린다.
  // 그래서 "초안(draft)"을 따로 두고, 저장에 성공한 것만 cats로 올린다.
  const [catDraft, setCatDraft] = useState<TcCategory[]>([]);
  const [catUsage, setCatUsage] = useState<Record<string, { total: number; subs: Record<string, number> }>>({});
  const [catSaving, setCatSaving] = useState(false);

  const loadCats = useCallback(async () => {
    if (!connected) return;
    try {
      const list = await fetchTableclothCategories(scriptUrl);
      if (list.length) setCats(list);
    } catch { /* 못 받아도 기본 목록으로 계속 간다 — 물품에는 key만 붙어 있어 필터는 어긋나지 않는다. */ }
  }, [scriptUrl, connected]);

  useEffect(() => { loadCats(); }, [loadCats]);

  // 분류 관리 탭에 들어올 때마다 최신 표를 초안으로 복사하고, 몇 장이 물려 있는지도 같이 받는다.
  useEffect(() => {
    if (tab !== "cats") return;
    setCatDraft(cats.map((c) => ({ ...c, subs: c.subs.map((sub) => ({ ...sub })) })));
    fetchTableclothCategoryUsage(scriptUrl).then(setCatUsage).catch(() => setCatUsage({}));
  }, [tab, cats, scriptUrl]);

  const catDirty = useMemo(() => JSON.stringify(catDraft) !== JSON.stringify(cats), [catDraft, cats]);

  const patchCat = (ci: number, patch: Partial<TcCategory>) =>
    setCatDraft((prev) => prev.map((c, i) => (i === ci ? { ...c, ...patch } : c)));

  const moveCat = (ci: number, dir: -1 | 1) =>
    setCatDraft((prev) => {
      const next = [...prev];
      const to = ci + dir;
      if (to < 0 || to >= next.length) return prev;
      [next[ci], next[to]] = [next[to], next[ci]];
      return next;
    });

  const saveCats = async () => {
    // 지워진 분류에 물려 있던 테이블보는 서버가 미분류로 되돌린다. 되돌릴 수 없으니 먼저 알린다.
    const goneCats = cats.filter((c) => !catDraft.some((d) => d.key === c.key));
    let affected = goneCats.reduce((n, c) => n + (catUsage[c.key]?.total || 0), 0);
    if (affected && !window.confirm(`지운 분류를 쓰던 테이블보 ${affected}장의 분류가 지워집니다. 계속할까요?`)) return;

    setCatSaving(true);
    try {
      const res = await saveTableclothCategories(scriptUrl, catDraft as TableclothCategory[]);
      if (!res?.success) throw new Error(res?.message || "저장에 실패했습니다.");
      if (res.categories?.length) setCats(res.categories);
      showToast(res.cleared ? `분류표를 저장했습니다. ${res.cleared}장의 분류가 정리되었습니다.` : "분류표를 저장했습니다.", "ok");
      await load();
    } catch (e: any) {
      showToast("분류표 저장 실패: " + e.message, "error");
    } finally {
      setCatSaving(false);
    }
  };

  /**
   * 선택한 것들을 다른 층으로 그대로 복사한다 — 같은 천을 두 곳에 둘 때 쓴다.
   *
   * 사진·크기·분류·링크·메모·재고는 원본과 같고, 위치는 고른 곳으로 바뀐다.
   * 번호는 새로 받는다 — 번호가 곧 DB 기본키라 원본과 같은 번호는 둘이 될 수 없다.
   */
  const applyBulkDuplicate = async () => {
    if (!selected.size) return;
    setBulkSaving(true);
    try {
      const res = await duplicateTableclothItems(scriptUrl, [...selected], dupLocation.trim());
      if (res?.success === false) { showToast(res.message || "복사에 실패했습니다.", "error"); return; }
      showToast(res?.message || `${selected.size}종을 복사했습니다.`, "ok");
      setDupOpen(false);
      exitSelectMode();
      await load();
    } catch (e: any) {
      showToast("복사 실패: " + e.message, "error");
    } finally {
      setBulkSaving(false);
    }
  };

  /**
   * 선택한 것들을 목록에서 완전히 지운다.
   *
   * 보관과 달리 되돌릴 수 없어서 확인을 두 번 받는다 — 잘못 등록한 중복이나 실물이
   * 없어진 천을 치울 때만 쓰고, 잠시 안 쓰는 천은 보관함으로 보내는 게 맞다.
   */
  const applyBulkDelete = async () => {
    if (!selected.size) return;
    const picked = items.filter((it) => selected.has(it.id));
    const rentedCount = picked.filter((it) => Number(it.rented) > 0).length;
    const warn = rentedCount
      ? `

(이 중 ${rentedCount}종은 지금 대여 중입니다. 지우면 반납 처리가 막힙니다.)`
      : "";
    if (!window.confirm(`${selected.size}종을 완전히 삭제할까요? 되돌릴 수 없습니다.${warn}

잠시 안 쓰는 천이라면 "보관함으로"를 쓰세요.`)) return;
    if (!window.confirm(`정말 삭제합니다. 확인을 누르면 ${selected.size}종이 목록에서 사라집니다.`)) return;

    setBulkSaving(true);
    try {
      const res = await deleteTableclothItems(scriptUrl, [...selected]);
      if (res?.success === false) { showToast(res.message || "삭제에 실패했습니다.", "error"); return; }
      showToast(res?.message || `${selected.size}종을 삭제했습니다.`, "ok");
      exitSelectMode();
      await load();
    } catch (e: any) {
      showToast("삭제 실패: " + e.message, "error");
    } finally {
      setBulkSaving(false);
    }
  };

  /**
   * 선택한 것들을 한꺼번에 보관함으로 보내거나 되돌린다.
   *
   * 방향은 지금 보고 있는 목록의 반대다 — 일반 목록을 보고 있으면 "보관함으로",
   * 보관함을 보고 있으면 "되돌리기". 화면에 보이는 것과 반대 동작만 가능하므로 헷갈릴 일이 없다.
   */
  const applyBulkArchive = async () => {
    if (!selected.size) return;
    const toArchive = !showArchived;
    const picked = items.filter((it) => selected.has(it.id));
    // 대여 중인 걸 내리면 목록에서 사라져 당황할 수 있다. 막지는 않고 알려만 준다 —
    // 반납은 대여 이력으로 하므로 보관 처리해도 돌려받는 데는 지장이 없다.
    const rentedCount = picked.filter((it) => Number(it.rented) > 0).length;
    const warn = rentedCount
      ? `\n\n(이 중 ${rentedCount}종은 지금 대여 중입니다. 보관해도 반납은 대여 이력에서 그대로 가능합니다.)`
      : "";
    const question = toArchive
      ? `${selected.size}종을 보관함으로 옮길까요? 대여 화면과 목록에서 감춰집니다.${warn}`
      : `${selected.size}종을 목록으로 되돌릴까요? 다시 대여할 수 있게 됩니다.`;
    if (!window.confirm(question)) return;

    setBulkSaving(true);
    try {
      const res = await updateTableclothArchived(scriptUrl, [...selected], toArchive);
      if (res?.success === false) { showToast(res.message || "보관 처리에 실패했습니다.", "error"); return; }
      showToast(res?.message || `${selected.size}종을 처리했습니다.`, "ok");
      exitSelectMode();
      await load();
    } catch (e: any) {
      showToast("보관 처리 실패: " + e.message, "error");
    } finally {
      setBulkSaving(false);
    }
  };

  const openNew = () => { setEditing({ location: "", stock: 0, note: "" } as any); setIsNew(true); };
  const openEdit = (it: TableclothItem) => { setEditing({ ...it }); setIsNew(false); };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const dataUrl = await resizeAndCompressImage(file);
      setEditing((p) => (p ? { ...p, image: dataUrl } : p));
    } catch (e: any) {
      showToast("사진을 처리하지 못했습니다: " + e.message, "error");
    }
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const res = isNew
        ? await addTableclothItem(scriptUrl, editing)
        : await updateTableclothItem(scriptUrl, { ...editing, id: Number(editing.id) });
      if (res && res.success === false) throw new Error(res.message || "저장에 실패했습니다.");
      showToast(isNew ? "테이블보를 등록했습니다." : "저장했습니다.", "ok");
      setEditing(null);
      await load();
    } catch (e: any) {
      showToast("저장 실패: " + e.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editing?.id) return;
    if (!window.confirm(`'${editing.name}'을(를) 삭제할까요? 되돌릴 수 없습니다.`)) return;
    setSaving(true);
    try {
      await deleteTableclothItem(scriptUrl, Number(editing.id));
      showToast("삭제했습니다.", "ok");
      setEditing(null);
      await load();
    } catch (e: any) {
      showToast("삭제 실패: " + e.message, "error");
    } finally {
      setSaving(false);
    }
  };

  // 대여 이력에는 사진이 실려 오지 않는다. 이미 불러둔 물품 목록에서 번호로 찾아 붙인다 —
  // 목록에는 보관 처리된 것도 들어 있어서 철 지난 천의 예전 기록도 사진이 뜬다.
  const itemById = useMemo(() => {
    const m = new Map<number, TableclothItem>();
    for (const it of items) m.set(it.id, it);
    return m;
  }, [items]);

  const shownLogs = useMemo(
    () => (logsOnlyOut ? logs.filter((r) => !r.returned) : logs),
    [logs, logsOnlyOut]
  );

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "9px 11px", borderRadius: "9px",
    border: `1px solid ${C.border}`, background: C.cardSub, color: C.text,
    fontSize: "13px", outline: "none", fontFamily: "inherit",
  };
  const lblStyle: React.CSSProperties = {
    display: "block", fontSize: "11px", fontWeight: 700, color: C.label, marginBottom: "5px",
  };

  return (
    <div
      onWheel={(e) => { if (e.deltaY > 2) setFilterPanelOpen(false); }}
      onTouchStart={(e) => { toolbarTouchY.current = e.touches[0]?.clientY ?? null; }}
      onTouchMove={(e) => {
        const y = e.touches[0]?.clientY;
        if (toolbarTouchY.current !== null && y !== undefined && toolbarTouchY.current - y > 6) setFilterPanelOpen(false);
      }}
      onTouchEnd={() => { toolbarTouchY.current = null; }}
      style={{ padding: "16px 18px 60px", background: C.bg, color: C.text, minHeight: "100%" }}
    >
      {/* 검색은 항상 보이고, 나머지 탭·작업·필터는 한 패널로 접는다. */}
      <div style={{
        position: "sticky", top: 0, zIndex: 30,
        background: C.bg, margin: "-16px -18px 14px", padding: "16px 18px 10px",
        borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
            <Search size={15} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: C.label }} />
            <input
              value={search}
              onFocus={() => setTab("items")}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="테이블보 검색"
              style={{ ...inputStyle, paddingLeft: "32px" }}
            />
          </div>
          <button
            onClick={() => setFilterPanelOpen((v) => !v)}
            aria-expanded={filterPanelOpen}
            style={{
              flexShrink: 0, display: "flex", alignItems: "center", gap: "6px",
              padding: "9px 11px", borderRadius: "9px", border: `1px solid ${filterPanelOpen ? C.accent : C.border}`,
              background: filterPanelOpen ? C.accentSoft : C.card, color: C.text,
              cursor: "pointer", fontSize: "12px", fontWeight: 800,
            }}
          >
            <SlidersHorizontal size={14} /> 메뉴
            {filterPanelOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>

      {filterPanelOpen ? <div style={{ marginTop: "10px" }}>
      <div style={{ display: "flex", gap: "7px", flexWrap: "wrap" }}>
        {([["items", "🧵 테이블보 목록"], ["logs", "🕘 대여 이력"], ["cats", "🏷️ 분류 관리"]] as const).map(([v, label]) => {
          const on = tab === v;
          return (
            <button
              key={v}
              onClick={() => setTab(v)}
              style={{
                display: "flex", alignItems: "center", gap: "7px",
                padding: "10px 16px", borderRadius: "11px", cursor: "pointer",
                fontSize: "13px", fontWeight: 800,
                border: `1.5px solid ${on ? C.accent : C.border}`,
                background: on ? C.accent : C.card,
                color: on ? "#fff" : C.label,
              }}
            >
              {label}
              {v === "logs" && outCount > 0 ? (
                <span style={{
                  fontSize: "11px", fontWeight: 900, padding: "1px 7px", borderRadius: "999px",
                  background: on ? "rgba(255,255,255,0.24)" : C.warnSoft,
                  color: on ? "#fff" : C.warn,
                }}>
                  대여 중 {outCount}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

        {tab === "items" ? (
        <div>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", marginTop: "10px", marginBottom: "12px" }}>
          <button
            onClick={() => setShowArchived((v) => !v)}
            style={{
              display: "flex", alignItems: "center", gap: "6px", padding: "9px 13px", borderRadius: "9px",
              border: `1px solid ${showArchived ? C.warn : C.border}`,
              background: showArchived ? C.warnSoft : "transparent",
              color: showArchived ? C.warn : C.label, cursor: "pointer", fontSize: "12.5px", fontWeight: 700,
            }}
          >
            {showArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />} {showArchived ? "보관함 보는 중" : "보관함"}
          </button>
          <button
            onClick={() => load()}
            disabled={loading}
            title="지금 다시 불러오기"
            style={{
              display: "flex", alignItems: "center", gap: "6px", padding: "9px 13px", borderRadius: "9px",
              border: `1px solid ${C.border}`, background: "transparent", color: C.label,
              cursor: loading ? "wait" : "pointer", fontSize: "12.5px", fontWeight: 700,
            }}
          >
            <RotateCcw size={14} /> 새로고침
          </button>
          <button
            onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
            style={{
              display: "flex", alignItems: "center", gap: "6px", padding: "9px 13px", borderRadius: "9px",
              border: `1px solid ${selectMode ? C.accent : C.border}`,
              background: selectMode ? C.accentSoft : "transparent",
              color: selectMode ? C.accentText : C.label,
              cursor: "pointer", fontSize: "12.5px", fontWeight: 700,
            }}
          >
            <MapPin size={14} /> {selectMode ? "선택 끝내기" : "일괄 변경"}
          </button>
          <button
            onClick={openNew}
            style={{
              display: "flex", alignItems: "center", gap: "6px", padding: "9px 14px", borderRadius: "9px",
              border: "none", background: C.accent, color: "#fff", cursor: "pointer", fontSize: "12.5px", fontWeight: 800,
            }}
          >
            <Plus size={15} /> 테이블보 추가
          </button>
        </div>

        <div style={{ display: "flex", gap: "8px", fontSize: "11.5px", fontWeight: 700, marginBottom: "12px" }}>
          <span style={{ color: C.accentText, background: C.accentSoft, padding: "3px 10px", borderRadius: "7px" }}>
            {shown.length}종
          </span>
          <span style={{ color: C.success, background: C.successSoft, padding: "3px 10px", borderRadius: "7px" }}>
            총 재고 {totalStock}
          </span>
          {lastSync ? (
            <span style={{ color: C.label, fontWeight: 600, alignSelf: "center" }}>
              {busy ? "자동 갱신 멈춤 (편집 중)" : `${lastSync.toLocaleTimeString("ko-KR", { hour12: false })} 기준 · 20초마다 자동 갱신`}
            </span>
          ) : null}
        </div>

        {/* 위치별 필터 — 색은 카드에 붙는 위치 배지와 같은 색이라 눈으로 바로 이어진다. */}
        {locOptions.length > 1 ? (
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "12px" }}>
            <button
              onClick={() => setLocFilter("")}
              style={{
                padding: "5px 11px", borderRadius: "8px", cursor: "pointer", fontSize: "11.5px", fontWeight: 700,
                border: `1px solid ${locFilter === "" ? C.accent : C.border}`,
                background: locFilter === "" ? C.accentSoft : "transparent",
                color: locFilter === "" ? C.text : C.label,
              }}
            >
              전체 {items.filter((it) => !!it.archived === showArchived).length}
            </button>
            {locOptions.map((o) => {
              const on = locFilter === o.key;
              return (
                <button
                  key={o.key || "none"}
                  onClick={() => setLocFilter(on ? "" : o.key)}
                  style={{
                    padding: "5px 11px", borderRadius: "8px", cursor: "pointer", fontSize: "11.5px", fontWeight: 700,
                    border: `1px solid ${on ? C.accent : C.border}`,
                    background: on ? C.accentSoft : "transparent",
                    color: on ? C.text : C.label,
                  }}
                >
                  {o.key ? o.label : "위치 미지정"} {o.count}
                </button>
              );
            })}
          </div>
        ) : null}

        {/* 무늬 분류 필터 — 테이블보는 이름이 번호뿐이라, 원하는 천을 고르는 실제 기준은 무늬다. */}
        {catOptions.length > 1 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              <button
                onClick={() => setCatFilter("")}
                style={{
                  padding: "5px 11px", borderRadius: "8px", cursor: "pointer", fontSize: "11.5px", fontWeight: 700,
                  border: `1px solid ${catFilter === "" ? C.accent : C.border}`,
                  background: catFilter === "" ? C.accentSoft : "transparent",
                  color: catFilter === "" ? C.text : C.label,
                }}
              >
                전체 무늬
              </button>
              {catOptions.map((o) => {
                const on = catFilter === o.key;
                return (
                  <button
                    key={o.key}
                    onClick={() => setCatFilter(on ? "" : o.key)}
                    style={{
                      padding: "5px 11px", borderRadius: "8px", cursor: "pointer", fontSize: "11.5px", fontWeight: 700,
                      border: `1px solid ${on ? o.color : C.border}`,
                      background: on ? `${o.color}22` : "transparent",
                      color: on ? o.color : C.label,
                    }}
                  >
                    {o.emoji} {o.label} {o.count}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        </div>
        ) : null}
      </div> : null}
      </div>

      {tab === "items" ? (
        <>
      {selectMode ? (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", padding: "10px 12px", marginBottom: "12px", borderRadius: "10px", background: C.accentSoft, border: `1px solid ${C.accent}` }}>
          <span style={{ fontSize: "12.5px", fontWeight: 800 }}>{selected.size}종 선택됨</span>
          <button
            onClick={() => setSelected(new Set(shown.map((it) => it.id)))}
            style={{ padding: "5px 10px", borderRadius: "7px", border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: "11.5px", fontWeight: 700, cursor: "pointer" }}
          >
            보이는 {shown.length}종 모두 선택
          </button>
          <button
            onClick={() => setSelected(new Set())}
            style={{ padding: "5px 10px", borderRadius: "7px", border: `1px solid ${C.border}`, background: "transparent", color: C.label, fontSize: "11.5px", fontWeight: 700, cursor: "pointer" }}
          >
            선택 해제
          </button>
          <span style={{ fontSize: "11px", color: C.label, marginLeft: "auto" }}>
            위치 필터로 좁힌 뒤 모두 선택하면 한 선반을 통째로 옮길 수 있습니다.
          </span>
          <button
            onClick={() => { setBulkLocation(""); setBulkOpen(true); }}
            disabled={!selected.size}
            style={{
              padding: "7px 14px", borderRadius: "8px", border: "none",
              background: selected.size ? C.accent : C.border, color: "#fff",
              fontSize: "12px", fontWeight: 800, cursor: selected.size ? "pointer" : "not-allowed",
            }}
          >
            위치 바꾸기
          </button>
          <button
            onClick={() => { setBulkCat(""); setBulkCatOpen(true); }}
            disabled={!selected.size}
            style={{
              padding: "7px 14px", borderRadius: "8px", border: "none",
              background: selected.size ? C.accent : C.border, color: "#fff",
              fontSize: "12px", fontWeight: 800, cursor: selected.size ? "pointer" : "not-allowed",
            }}
          >
            분류 바꾸기
          </button>
          <button
            onClick={applyBulkArchive}
            disabled={!selected.size || bulkSaving}
            title={showArchived ? "선택한 것을 다시 목록으로" : "선택한 것을 목록에서 감춤"}
            style={{
              display: "flex", alignItems: "center", gap: "6px",
              padding: "7px 14px", borderRadius: "8px", border: "none",
              background: selected.size ? C.warn : C.border, color: "#fff",
              fontSize: "12px", fontWeight: 800,
              cursor: selected.size && !bulkSaving ? "pointer" : "not-allowed",
            }}
          >
            {showArchived ? <><ArchiveRestore size={14} /> 보관함에서 꺼내기</> : <><Archive size={14} /> 보관함으로</>}
          </button>
          <button
            onClick={() => { setDupLocation(""); setDupOpen(true); }}
            disabled={!selected.size || bulkSaving}
            title="선택한 것과 똑같은 항목을 다른 층에 새 번호로 만든다"
            style={{
              display: "flex", alignItems: "center", gap: "6px",
              padding: "7px 14px", borderRadius: "8px",
              border: `1px solid ${selected.size ? C.accent : C.border}`,
              background: "transparent", color: selected.size ? C.accentText : C.label,
              fontSize: "12px", fontWeight: 800,
              cursor: selected.size && !bulkSaving ? "pointer" : "not-allowed",
            }}
          >
            <Copy size={14} /> 다른 층으로 복사
          </button>
          <button
            onClick={applyBulkDelete}
            disabled={!selected.size || bulkSaving}
            title="되돌릴 수 없다 — 잠시 안 쓰는 천은 보관함으로"
            style={{
              display: "flex", alignItems: "center", gap: "6px",
              padding: "7px 14px", borderRadius: "8px", border: "none",
              background: selected.size ? C.error : C.border, color: "#fff",
              fontSize: "12px", fontWeight: 800,
              cursor: selected.size && !bulkSaving ? "pointer" : "not-allowed",
            }}
          >
            <Trash2 size={14} /> 삭제
          </button>
        </div>
      ) : null}

      {loading ? (
        <div style={{ padding: "40px", textAlign: "center", color: C.label, fontSize: "13px" }}>불러오는 중…</div>
      ) : shown.length === 0 ? (
        <div style={{ padding: "48px 20px", textAlign: "center", color: C.label, fontSize: "13px", border: `1px dashed ${C.border}`, borderRadius: "12px" }}>
          {search ? "검색 결과가 없습니다." : showArchived ? "보관 처리된 테이블보가 없습니다." : "등록된 테이블보가 없습니다. 오른쪽 위 “테이블보 추가”로 등록해주세요."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          {groupedShown.map((g) => (
            <section key={g.key || "none"}>
              {/* 위치 구분선 — 어느 선반 구역인지 목록을 훑으며 바로 읽히게 한다. */}
              <div style={{ display: "flex", alignItems: "center", gap: "9px", marginBottom: "9px" }}>
                <MapPin size={13} style={{ color: C.label, flexShrink: 0 }} />
                <span style={{ fontSize: "12.5px", fontWeight: 800, flexShrink: 0 }}>
                  {g.key ? g.label : "위치 미지정"}
                </span>
                <span style={{ fontSize: "11px", fontWeight: 700, color: C.label, flexShrink: 0 }}>{g.items.length}종</span>
                <span style={{ flex: 1, height: 1, background: C.border }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(212px, 1fr))", gap: "12px" }}>
          {g.items.map((it) => (
            <div
              key={it.id}
              onClick={() => (selectMode ? toggleSelected(it.id) : openEdit(it))}
              style={{
                border: `1px solid ${C.border}`, background: C.card, borderRadius: "14px", overflow: "hidden",
                display: "flex", flexDirection: "column", cursor: "pointer", opacity: it.archived ? 0.65 : 1,
                outline: selectMode && selected.has(it.id) ? `2px solid ${C.accent}` : "none",
                outlineOffset: "-2px",
              }}
            >
              <div
                onClick={(e) => { if (it.image) { e.stopPropagation(); setModalUrl(getGoogleDriveImageUrl(it.image)); } }}
                style={{
                  height: "140px", background: C.cardSub, display: "flex", alignItems: "center", justifyContent: "center",
                  borderBottom: `1px solid ${C.border}`, cursor: it.image ? "zoom-in" : "pointer",
                }}
              >
                {it.image
                  ? <img src={getThumbImageUrl(it.image)} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : <Layers size={36} style={{ color: C.border }} />}
              </div>
              <div style={{ padding: "11px 13px", display: "flex", flexDirection: "column", gap: "6px", flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  {selectMode ? (
                    <span style={{
                      width: 15, height: 15, borderRadius: "4px", flexShrink: 0,
                      border: `1.5px solid ${selected.has(it.id) ? C.accent : C.border}`,
                      background: selected.has(it.id) ? C.accent : "transparent",
                      color: "#fff", fontSize: "10px", fontWeight: 900,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>{selected.has(it.id) ? "\u2713" : ""}</span>
                  ) : null}
                  <div style={{ fontWeight: 700, fontSize: "13.5px", lineHeight: 1.35, wordBreak: "break-word" }}>{it.name}</div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                  {tcLabel(cats, it.category) ? (
                    <span style={{
                      fontSize: "10px", fontWeight: 800, borderRadius: "6px", padding: "2px 7px",
                      color: tcColor(cats, it.category), background: `${tcColor(cats, it.category)}1f`,
                    }}>
                      {tcCategory(cats, it.category)?.emoji} {tcLabel(cats, it.category)}
                    </span>
                  ) : (
                    <span style={{ fontSize: "10px", fontWeight: 700, color: C.label, background: C.cardSub, borderRadius: "6px", padding: "2px 7px" }}>
                      미분류
                    </span>
                  )}
                  {it.location ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "10px", fontWeight: 700, color: C.label, background: C.cardSub, borderRadius: "6px", padding: "2px 7px", fontFamily: "monospace" }}>
                      <MapPin size={10} />{it.location}
                    </span>
                  ) : (
                    <span style={{ fontSize: "10px", fontWeight: 700, color: C.error, background: C.errorSoft, borderRadius: "6px", padding: "2px 7px" }}>위치 없음</span>
                  )}
                  {sizeLabel(it) ? (
                    <span style={{ fontSize: "10px", fontWeight: 700, padding: "2px 7px", borderRadius: "6px", border: `1px solid ${C.border}`, color: C.label }}>
                      📐 {sizeLabel(it)}
                    </span>
                  ) : null}
                </div>
                <div style={{ display: "flex", gap: "6px", fontSize: "11px", fontWeight: 600, marginTop: "auto", paddingTop: "4px" }}>
                  <span style={{ color: C.success, background: C.successSoft, padding: "2px 8px", borderRadius: "6px" }}>재고 {it.stock}</span>
                  {!selectMode ? (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setStockAdjustItem(it); }}
                      style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 6, border: `1px solid ${C.border}`, background: C.accentSoft, color: C.accentText, cursor: "pointer", fontSize: 10.5, fontWeight: 800 }}
                    >
                      <ArrowUpDown size={10} /> 재고 변경
                    </button>
                  ) : null}
                </div>
                {tcLinks(it.link).length ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                    {tcLinks(it.link).map((url) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title={url}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: "4px", maxWidth: "100%",
                          fontSize: "10.5px", fontWeight: 700, textDecoration: "none",
                          color: C.accent, background: C.accentSoft, borderRadius: "6px", padding: "2px 7px",
                        }}
                      >
                        <ExternalLink size={10} style={{ flexShrink: 0 }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tcLinkLabel(url)}</span>
                      </a>
                    ))}
                  </div>
                ) : null}
                {it.note ? (
                  <div style={{ fontSize: "11px", color: C.label, borderLeft: `2px solid ${C.border}`, paddingLeft: "7px" }}>{it.note}</div>
                ) : null}
              </div>
            </div>
          ))}
              </div>
            </section>
          ))}
        </div>
      )}

        </>
      ) : null}

      {/* 대여 이력 — 담당자 확인 절차가 없는 물건이라, "지금 나가 있는 것"이 기본 보기다. */}
      {tab === "logs" ? (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
            <History size={17} style={{ color: C.accent }} />
            <span style={{ fontSize: "14.5px", fontWeight: 800, flex: 1 }}>테이블보 대여 이력</span>
            <button
              onClick={() => loadLogs()}
              disabled={logsLoading}
              title="다시 불러오기"
              style={{
                display: "flex", alignItems: "center", gap: "6px", padding: "8px 12px", borderRadius: "9px",
                border: `1px solid ${C.border}`, background: "transparent", color: C.label,
                cursor: logsLoading ? "wait" : "pointer", fontSize: "12.5px", fontWeight: 700,
              }}
            >
              <RotateCcw size={14} /> 새로고침
            </button>
          </div>
            <div style={{ display: "flex", gap: "6px", padding: "0 0 12px", borderBottom: `1px solid ${C.border}`, marginBottom: "12px" }}>
              {([[true, "지금 나가 있는 것"], [false, "전체 기록"]] as const).map(([onlyOut, label]) => {
                const on = logsOnlyOut === onlyOut;
                return (
                  <button key={String(onlyOut)} onClick={() => setLogsOnlyOut(onlyOut)}
                    style={{
                      padding: "6px 12px", borderRadius: "8px", cursor: "pointer", fontSize: "12px", fontWeight: 700,
                      border: `1px solid ${on ? C.accent : C.border}`, background: on ? C.accentSoft : "transparent",
                      color: on ? C.text : C.label,
                    }}>
                    {label}
                  </button>
                );
              })}
              <span style={{ marginLeft: "auto", alignSelf: "center", fontSize: "11px", color: C.label }}>
                {logsLoading ? "불러오는 중…" : `${shownLogs.length}건`}
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {shownLogs.length === 0 ? (
                <div style={{ padding: "40px", textAlign: "center", color: C.label, fontSize: "13px" }}>
                  {logsLoading ? "불러오는 중…" : logsOnlyOut ? "지금 나가 있는 테이블보가 없습니다." : "기록이 없습니다."}
                </div>
              ) : shownLogs.map((r) => (
                <div key={r.rowIndex} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "9px 11px", borderRadius: "10px", background: C.cardSub, border: `1px solid ${C.border}` }}>
                  {(() => {
                    // 번호만 적힌 이력은 "어떤 천이었는지"를 알 수 없다. 번호를 눌러 사진을 연다.
                    // 사진이 없거나 물품이 지워졌으면 누를 것이 없으므로 그냥 글자로 둔다.
                    const logItem = itemById.get(r.itemId);
                    const photo = logItem?.image;
                    if (!photo) {
                      return (
                        <span
                          title={logItem ? "등록된 사진이 없습니다" : "삭제된 테이블보입니다"}
                          style={{ fontSize: "12.5px", fontWeight: 800, minWidth: "72px", color: C.label }}
                        >
                          {r.itemLabel}
                        </span>
                      );
                    }
                    return (
                      <button
                        onClick={() => setModalUrl(getGoogleDriveImageUrl(photo))}
                        title="사진 보기"
                        style={{
                          display: "flex", alignItems: "center", gap: "6px", minWidth: "72px",
                          padding: 0, border: "none", background: "transparent", cursor: "zoom-in",
                          fontSize: "12.5px", fontWeight: 800, color: C.accent, fontFamily: "inherit",
                          textAlign: "left",
                        }}
                      >
                        <img
                          src={getThumbImageUrl(photo)}
                          alt=""
                          loading="lazy"
                          style={{ width: "26px", height: "26px", objectFit: "cover", borderRadius: "6px", border: `1px solid ${C.border}`, flexShrink: 0 }}
                        />
                        {r.itemLabel}
                      </button>
                    );
                  })()}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "12.5px", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.borrowerName || "이름 없음"}
                      <span style={{ fontWeight: 600, color: C.label }}>
                        {r.affiliation ? ` · ${r.affiliation}` : ""}{r.employeeId ? ` ${r.employeeId}` : ""}{r.floor ? ` · ${r.floor}` : ""}
                      </span>
                    </div>
                    <div style={{ fontSize: "10.5px", color: C.label, marginTop: "2px" }}>
                      {(r.borrowDate || "").slice(0, 16)}
                      {r.returned && r.returnDate ? ` → 반납 ${r.returnDate.slice(0, 16)}` : ""}
                      {r.purpose ? ` · ${r.purpose}` : ""}
                    </div>
                  </div>
                  <span style={{ fontSize: "12px", fontWeight: 800, color: C.label }}>{r.quantity}개</span>
                  <span style={{
                    fontSize: "10.5px", fontWeight: 800, padding: "3px 8px", borderRadius: "6px",
                    background: r.returned ? C.successSoft : C.warnSoft, color: r.returned ? C.success : C.warn,
                  }}>
                    {r.returned ? "반납" : "대여 중"}
                  </span>
                </div>
              ))}
            </div>
        </div>
      ) : null}

      <ScrollToTopButton />

      {/* 등록 · 편집 */}
      {editing ? (
        <div
          onClick={() => !saving && setEditing(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "16px" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", width: "min(460px, 100%)", maxHeight: "88vh", overflowY: "auto" }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontSize: "14.5px", fontWeight: 800 }}>{isNew ? "테이블보 추가" : "테이블보 편집"}</div>
              <button onClick={() => setEditing(null)} style={{ background: "none", border: "none", color: C.label, cursor: "pointer", padding: "4px" }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "13px" }}>
              {/* 이름은 받지 않는다 — 등록하는 순간 번호(TC-0007)가 자동으로 붙고 그게 이름 역할을 한다. */}
              <div>
                <label style={lblStyle}>번호</label>
                <div style={{ ...inputStyle, display: "flex", alignItems: "center", color: isNew ? C.label : C.text }}>
                  {isNew ? "저장하면 번호가 자동으로 부여됩니다" : editing.name || ""}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={lblStyle}>위치</label>
                  <input
                    value={editing.location || ""}
                    onChange={(e) => setEditing((p) => (p ? { ...p, location: e.target.value } : p))}
                    placeholder="예: K-01"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={lblStyle}>재고</label>
                  <input
                    type="number"
                    min={0}
                    value={editing.stock ?? 0}
                    disabled={!isNew}
                    onChange={(e) => setEditing((p) => (p ? { ...p, stock: Number(e.target.value) || 0 } : p))}
                    title={!isNew ? "등록 후 수량 변경은 '재고 변경'에서만 할 수 있습니다." : undefined}
                    style={{ ...inputStyle, opacity: !isNew ? 0.6 : 1, cursor: !isNew ? "not-allowed" : undefined }}
                  />
                  {!isNew ? <div style={{ fontSize: 10.5, color: C.label, marginTop: 5 }}>수량은 물품 카드의 ‘재고 변경’을 이용해주세요.</div> : null}
                </div>
              </div>

              {/* 천은 두께가 의미 없어 가로·세로만 받는다.
                  현장에서는 1/4로 접은 채로 재기 때문에 그 값을 그대로 넣게 하고, 여기서 펼친 크기로 환산한다. */}
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "5px" }}>
                  <label style={{ ...lblStyle, marginBottom: 0 }}>실측 크기 (선택)</label>
                  <span style={{ fontSize: "10.5px", color: C.label }}>
                    {sizeLabel(editing) ? `펼친 크기 ${sizeLabel(editing)}` : "mm로 입력"}
                  </span>
                </div>

                <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
                  {([[true, "1/4로 접은 상태"], [false, "펼친 상태"]] as const).map(([folded, label]) => {
                    const on = foldedInput === folded;
                    return (
                      <button
                        key={String(folded)}
                        type="button"
                        onClick={() => setFoldedInput(folded)}
                        style={{
                          flex: 1, padding: "7px", borderRadius: "8px", cursor: "pointer",
                          fontSize: "11.5px", fontWeight: 700,
                          border: `1px solid ${on ? C.accent : C.border}`,
                          background: on ? C.accentSoft : C.card,
                          color: on ? C.text : C.label,
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  {([["widthMm", "가로"], ["depthMm", "세로"]] as const).map(([key, label]) => {
                    const actual = Number((editing as any)[key]);
                    const shown = Number.isFinite(actual) && actual > 0
                      ? (foldedInput ? actual / FOLD_FACTOR : actual)
                      : undefined;
                    return (
                      <div key={key}>
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={shown ?? ""}
                          onChange={(e) =>
                            setEditing((prev) => {
                              if (!prev) return prev;
                              const raw = e.target.value;
                              const n = Number(raw);
                              const bad = raw === "" || !Number.isFinite(n) || n <= 0;
                              // 입력값이 접은 치수면 여기서 펼친 크기로 되돌려 저장한다.
                              return { ...prev, [key]: bad ? undefined : (foldedInput ? n * FOLD_FACTOR : n) } as Form;
                            })
                          }
                          placeholder={label}
                          style={inputStyle}
                        />
                        <div style={{ fontSize: "10px", color: C.label, marginTop: "3px", textAlign: "center" }}>
                          {label} (mm){foldedInput ? " · 접은 채로" : ""}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {foldedInput ? (
                  <div style={{ fontSize: "10.5px", color: C.label, marginTop: "6px", lineHeight: 1.5 }}>
                    가로·세로를 각각 반으로 접은(넓이 1/4) 상태로 잰 값을 넣으세요 — 한 변당 2배로 환산해
                    <b style={{ color: C.text }}> {sizeLabel(editing) || "펼친 크기"}</b>로 저장됩니다.
                  </div>
                ) : null}
              </div>

              <div>
                <label style={lblStyle}>사진</label>
                <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
                  <div style={{ width: "88px", height: "88px", borderRadius: "10px", overflow: "hidden", background: C.cardSub, border: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                    {editing.image
                      ? <img src={editing.image.startsWith("data:") ? editing.image : getThumbImageUrl(editing.image)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      : <Layers size={26} style={{ color: C.border }} />}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1 }}>
                    <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: "8px", borderRadius: "9px", border: `1px solid ${C.border}`, color: C.label, cursor: "pointer", fontSize: "12px", fontWeight: 700 }}>
                      <Upload size={13} /> 파일 선택
                      <input type="file" accept="image/*" onChange={(e) => pickFile(e.target.files?.[0])} style={{ display: "none" }} />
                    </label>
                    <button
                      type="button"
                      onClick={() => setCamOpen(true)}
                      style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: "8px", borderRadius: "9px", border: `1px solid ${C.border}`, background: "none", color: C.label, cursor: "pointer", fontSize: "12px", fontWeight: 700 }}
                    >
                      <Camera size={13} /> 카메라 촬영
                    </button>
                    {editing.image ? (
                      <button
                        type="button"
                        onClick={() => setEditing((p) => (p ? { ...p, image: "" } : p))}
                        style={{ padding: "6px", borderRadius: "9px", border: "none", background: "none", color: C.error, cursor: "pointer", fontSize: "11.5px", fontWeight: 700 }}
                      >
                        사진 제거
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* 무늬 분류 */}
              <div>
                <div>
                  <label style={lblStyle}>무늬 분류</label>
                  <TableclothCategoryPicker
                    scriptUrl={scriptUrl}
                    cats={cats}
                    onCatsChange={setCats}
                    value={editing.category || ""}
                    onChange={(key) => setEditing((p) => (p ? { ...p, category: key, subcategory: "" } : p))}
                    colors={C}
                    inputStyle={inputStyle}
                    showToast={showToast}
                    placeholder="미분류"
                  />
                </div>
              </div>

              {/* 참고 링크 — 구매처를 메모에 적어두면 눌러지지 않아서 따로 받는다.
                  한 줄에 하나씩, 여러 개를 넣을 수 있다. */}
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "5px" }}>
                  <label style={{ ...lblStyle, marginBottom: 0, display: "flex", alignItems: "center", gap: "5px" }}>
                    <Link2 size={12} /> 참고 링크 (선택)
                  </label>
                  <span style={{ fontSize: "10.5px", color: C.label }}>한 줄에 하나씩</span>
                </div>
                <textarea
                  value={editing.link || ""}
                  onChange={(e) => setEditing((p) => (p ? { ...p, link: e.target.value } : p))}
                  placeholder={"예: smartstore.naver.com/xxx\nhttps://... (구매처 · 원단 정보)"}
                  rows={2}
                  style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
                />
                {tcLinks(editing.link).length ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", marginTop: "7px" }}>
                    {tcLinks(editing.link).map((url) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={url}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: "4px",
                          fontSize: "10.5px", fontWeight: 700, textDecoration: "none",
                          color: C.accent, background: C.accentSoft, borderRadius: "6px", padding: "3px 8px",
                        }}
                      >
                        <ExternalLink size={10} /> {tcLinkLabel(url)} 열어보기
                      </a>
                    ))}
                  </div>
                ) : null}
                <div style={{ fontSize: "10.5px", color: C.label, marginTop: "6px", lineHeight: 1.5 }}>
                  http(s) 주소만 저장됩니다. 스킴을 빼고 넣으면 https를 붙여 저장합니다.
                </div>
              </div>

              <div>
                <label style={lblStyle}>메모 (선택)</label>
                <input
                  value={editing.note || ""}
                  onChange={(e) => setEditing((p) => (p ? { ...p, note: e.target.value } : p))}
                  placeholder="예: 얼룩 있음, 세탁 필요"
                  style={inputStyle}
                />
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12.5px", color: C.label, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={!!editing.archived}
                  onChange={(e) => setEditing((p) => (p ? { ...p, archived: e.target.checked } : p))}
                />
                보관 처리 (목록에서 감춤)
              </label>
            </div>

            <div style={{ display: "flex", gap: "9px", padding: "0 16px 16px" }}>
              {!isNew ? (
                <button
                  onClick={remove}
                  disabled={saving}
                  style={{ padding: "11px 13px", borderRadius: "10px", border: `1px solid ${C.error}`, background: "none", color: C.error, cursor: saving ? "not-allowed" : "pointer", fontSize: "12.5px", fontWeight: 700 }}
                >
                  <Trash2 size={14} />
                </button>
              ) : null}
              <button
                onClick={() => setEditing(null)}
                disabled={saving}
                style={{ flex: 1, padding: "11px", borderRadius: "10px", border: `1px solid ${C.border}`, background: "none", color: C.label, cursor: saving ? "not-allowed" : "pointer", fontSize: "12.5px", fontWeight: 700 }}
              >
                취소
              </button>
              <button
                onClick={save}
                disabled={saving}
                style={{ flex: 2, padding: "11px", borderRadius: "10px", border: "none", background: saving ? C.border : C.accent, color: "#fff", cursor: saving ? "not-allowed" : "pointer", fontSize: "12.5px", fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}
              >
                <Save size={14} /> {saving ? "저장 중…" : isNew ? "등록" : "저장"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <CameraCaptureModal
        open={camOpen}
        onClose={() => setCamOpen(false)}
        onCapture={(dataUrl) => setEditing((p) => (p ? { ...p, image: dataUrl } : p))}
        isLightMode={isLightMode}
        title="테이블보 촬영"
      />

      {/* 다른 층으로 복사 — 위치만 새로 고르고 나머지는 원본 그대로 복제한다. */}
      {dupOpen ? (
        <div
          onClick={() => !bulkSaving && setDupOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 4300, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(430px, 100%)", background: C.card, border: `1px solid ${C.border}`, borderRadius: "14px", padding: "18px" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
              <Copy size={17} style={{ color: C.accent }} />
              <span style={{ fontSize: "14.5px", fontWeight: 800, flex: 1 }}>다른 층으로 복사</span>
              <button onClick={() => setDupOpen(false)} style={{ background: "transparent", border: "none", color: C.label, cursor: "pointer", display: "flex" }}>
                <X size={18} />
              </button>
            </div>
            <div style={{ fontSize: "11.5px", color: C.label, marginBottom: "12px", lineHeight: 1.6 }}>
              선택한 <b style={{ color: C.text }}>{selected.size}종</b>을 그대로 하나씩 더 만듭니다. 사진·크기·분류·재고는 원본과 같고 번호만 새로 붙습니다. 원본은 그대로 남습니다.
            </div>

            <label style={lblStyle}>복사본을 둘 위치</label>
            <input
              value={dupLocation}
              onChange={(e) => setDupLocation(e.target.value)}
              placeholder="예: B2 Hanger"
              style={inputStyle}
              autoFocus
            />

            {locOptions.length ? (
              <div style={{ display: "flex", gap: "5px", flexWrap: "wrap", marginTop: "8px" }}>
                {locOptions.filter((o) => o.key).map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => setDupLocation(o.label)}
                    style={{
                      padding: "4px 9px", borderRadius: "7px", cursor: "pointer", fontSize: "11px", fontWeight: 700,
                      border: `1px solid ${C.border}`, background: "transparent", color: C.label,
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            ) : null}
            <div style={{ fontSize: "10.5px", color: C.label, marginTop: "7px", lineHeight: 1.5 }}>
              비워두면 위치 없음으로 만들어집니다. 나중에 위치 일괄 변경으로 고칠 수 있습니다.
            </div>

            <div style={{ display: "flex", gap: "9px", marginTop: "16px" }}>
              <button
                onClick={() => setDupOpen(false)}
                disabled={bulkSaving}
                style={{ flex: 1, padding: "11px", borderRadius: "10px", border: `1px solid ${C.border}`, background: "transparent", color: C.text, fontSize: "13px", fontWeight: 700, cursor: "pointer" }}
              >
                취소
              </button>
              <button
                onClick={applyBulkDuplicate}
                disabled={bulkSaving || !selected.size}
                style={{ flex: 2, padding: "11px", borderRadius: "10px", border: "none", background: bulkSaving ? C.border : C.accent, color: "#fff", fontSize: "13px", fontWeight: 800, cursor: bulkSaving ? "not-allowed" : "pointer" }}
              >
                {bulkSaving ? "복사 중…" : `${selected.size}종 복사하기`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 위치 일괄 변경 — 선반을 통째로 옮기거나 갈린 표기를 하나로 맞출 때 쓴다. */}
      {bulkOpen ? (
        <div
          onClick={() => !bulkSaving && setBulkOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 4300, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(430px, 100%)", background: C.card, border: `1px solid ${C.border}`, borderRadius: "14px", padding: "18px" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
              <MapPin size={17} style={{ color: C.accent }} />
              <span style={{ fontSize: "14.5px", fontWeight: 800, flex: 1 }}>위치 일괄 변경</span>
              <button onClick={() => setBulkOpen(false)} style={{ background: "transparent", border: "none", color: C.label, cursor: "pointer", display: "flex" }}>
                <X size={18} />
              </button>
            </div>
            <div style={{ fontSize: "11.5px", color: C.label, marginBottom: "12px", lineHeight: 1.6 }}>
              선택한 <b style={{ color: C.text }}>{selected.size}종</b>의 위치만 바꿉니다. 재고·사진·크기는 건드리지 않습니다.
            </div>

            <label style={lblStyle}>새 위치</label>
            <input
              value={bulkLocation}
              onChange={(e) => setBulkLocation(e.target.value)}
              placeholder="예: B2 Hanger"
              style={inputStyle}
              autoFocus
            />

            {locOptions.length ? (
              <div style={{ display: "flex", gap: "5px", flexWrap: "wrap", marginTop: "8px" }}>
                {locOptions.filter((o) => o.key).map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => setBulkLocation(o.label)}
                    style={{
                      padding: "4px 9px", borderRadius: "7px", cursor: "pointer", fontSize: "11px", fontWeight: 700,
                      border: `1px solid ${C.border}`, background: "transparent", color: C.label,
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            ) : null}
            <div style={{ fontSize: "10.5px", color: C.label, marginTop: "7px", lineHeight: 1.5 }}>
              쓰던 위치를 눌러 그대로 넣거나 새로 입력하세요. 비워두면 위치 없음으로 바뀝니다.
            </div>

            <div style={{ display: "flex", gap: "9px", marginTop: "16px" }}>
              <button
                onClick={() => setBulkOpen(false)}
                disabled={bulkSaving}
                style={{ flex: 1, padding: "11px", borderRadius: "10px", border: `1px solid ${C.border}`, background: "transparent", color: C.text, fontSize: "13px", fontWeight: 700, cursor: "pointer" }}
              >
                취소
              </button>
              <button
                onClick={applyBulkLocation}
                disabled={bulkSaving}
                style={{ flex: 2, padding: "11px", borderRadius: "10px", border: "none", background: C.accent, color: "#fff", fontSize: "13px", fontWeight: 800, cursor: bulkSaving ? "wait" : "pointer" }}
              >
                {bulkSaving ? "바꾸는 중…" : `${selected.size}종 위치 바꾸기`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 분류 일괄 지정 — 위치 일괄 변경과 같은 자리·같은 모양이라 조작을 새로 배울 게 없다. */}
      {/* ── 분류 관리 ──────────────────────────────────────────
          무늬를 나누는 기준은 쓰면서 계속 바뀐다. 그때마다 배포를 기다릴 수 없으니 분류표 자체를
          여기서 고친다. 저장하기 전까지는 초안만 바뀌므로 목록의 배지는 그대로다. */}
      {tab === "cats" ? (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px", flexWrap: "wrap" }}>
            <Layers size={17} style={{ color: C.accent }} />
            <span style={{ fontSize: "14.5px", fontWeight: 800, flex: 1 }}>무늬 분류표</span>
            <button
              onClick={() => setCatDraft(cats.map((c) => ({ ...c, subs: c.subs.map((sub) => ({ ...sub })) })))}
              disabled={!catDirty || catSaving}
              style={{
                padding: "8px 13px", borderRadius: "9px", border: `1px solid ${C.border}`,
                background: "transparent", color: catDirty ? C.text : C.label,
                fontSize: "12.5px", fontWeight: 700, cursor: catDirty ? "pointer" : "not-allowed",
              }}
            >
              되돌리기
            </button>
            <button
              onClick={saveCats}
              disabled={!catDirty || catSaving}
              style={{
                display: "flex", alignItems: "center", gap: "6px",
                padding: "8px 15px", borderRadius: "9px", border: "none",
                background: catDirty ? C.accent : C.border, color: "#fff",
                fontSize: "12.5px", fontWeight: 800, cursor: catDirty && !catSaving ? "pointer" : "not-allowed",
              }}
            >
              <Save size={14} /> {catSaving ? "저장 중…" : "분류표 저장"}
            </button>
          </div>
          <div style={{ fontSize: "11.5px", color: C.label, lineHeight: 1.6, marginBottom: "14px" }}>
            이름·이모지·색·순서를 바꾸거나 분류를 더하고 지울 수 있습니다. 이름을 바꿔도 이미 분류해 둔
            테이블보는 그대로 따라옵니다. 다만 <b style={{ color: C.text }}>분류를 지우면</b> 그 분류를 쓰던
            테이블보는 미분류로 돌아갑니다.
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {catDraft.map((c, ci) => {
              const used = catUsage[c.key]?.total || 0;
              const last = ci === catDraft.length - 1;
              return (
                <div key={c.key} style={{ border: `1px solid ${C.border}`, background: C.card, borderRadius: "12px", padding: "12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "7px", flexWrap: "wrap" }}>
                    <span style={{ width: "5px", alignSelf: "stretch", borderRadius: "3px", background: c.color || C.border }} />
                    <input
                      value={c.emoji}
                      onChange={(e) => patchCat(ci, { emoji: e.target.value })}
                      title="이모지"
                      style={{ ...inputStyle, width: "52px", flex: "none", textAlign: "center", padding: "9px 4px" }}
                    />
                    <input
                      value={c.label}
                      onChange={(e) => patchCat(ci, { label: e.target.value })}
                      placeholder="분류 이름"
                      style={{ ...inputStyle, flex: 1, minWidth: "120px", fontWeight: 700 }}
                    />
                    <input
                      type="color"
                      value={/^#[0-9a-fA-F]{6}$/.test(c.color) ? c.color : "#94a3b8"}
                      onChange={(e) => patchCat(ci, { color: e.target.value })}
                      title="필터 칩·배지 색"
                      style={{ width: "40px", height: "36px", padding: 0, border: `1px solid ${C.border}`, borderRadius: "9px", background: C.cardSub, cursor: "pointer" }}
                    />
                    <span style={{ fontSize: "11px", fontWeight: 700, color: C.label, whiteSpace: "nowrap" }}>{used}장</span>
                    <button onClick={() => moveCat(ci, -1)} disabled={ci === 0} title="위로"
                      style={{ padding: "7px 9px", borderRadius: "8px", border: `1px solid ${C.border}`, background: "transparent", color: ci === 0 ? C.border : C.label, cursor: ci === 0 ? "not-allowed" : "pointer", fontSize: "12px", fontWeight: 800 }}>↑</button>
                    <button onClick={() => moveCat(ci, 1)} disabled={last} title="아래로"
                      style={{ padding: "7px 9px", borderRadius: "8px", border: `1px solid ${C.border}`, background: "transparent", color: last ? C.border : C.label, cursor: last ? "not-allowed" : "pointer", fontSize: "12px", fontWeight: 800 }}>↓</button>
                    <button
                      onClick={() => {
                        if (used && !window.confirm(`'${c.label}'을(를) 지우면 이 분류를 쓰던 ${used}장이 미분류로 돌아갑니다. 계속할까요?`)) return;
                        setCatDraft((prev) => prev.filter((_, i) => i !== ci));
                      }}
                      title="분류 지우기"
                      style={{ padding: "7px 9px", borderRadius: "8px", border: `1px solid ${C.border}`, background: "transparent", color: C.error, cursor: "pointer", display: "flex" }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                </div>
              );
            })}

            <button
              onClick={() => setCatDraft((prev) => [...prev, { key: tcNewKey(), label: "", emoji: "🏷️", color: "#94a3b8", subs: [] }])}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: "12px", borderRadius: "12px", border: `1px dashed ${C.border}`, background: "transparent", color: C.label, fontSize: "12.5px", fontWeight: 700, cursor: "pointer" }}
            >
              <Plus size={14} /> 분류 추가
            </button>
          </div>
        </div>
      ) : null}

      {bulkCatOpen ? (
        <div
          onClick={() => setBulkCatOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", zIndex: 60 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(430px, 100%)", background: C.card, border: `1px solid ${C.border}`, borderRadius: "14px", padding: "18px" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
              <Layers size={17} style={{ color: C.accent }} />
              <span style={{ fontSize: "14.5px", fontWeight: 800, flex: 1 }}>무늬 분류 일괄 지정</span>
              <button onClick={() => setBulkCatOpen(false)} style={{ background: "transparent", border: "none", color: C.label, cursor: "pointer", display: "flex" }}>
                <X size={18} />
              </button>
            </div>
            <div style={{ fontSize: "11.5px", color: C.label, marginBottom: "12px", lineHeight: 1.6 }}>
              선택한 <b style={{ color: C.text }}>{selected.size}종</b>의 분류만 바꿉니다. 위치·재고·사진은 건드리지 않습니다.
            </div>

            <label style={lblStyle}>무늬 분류</label>
            <TableclothCategoryPicker
              scriptUrl={scriptUrl}
              cats={cats}
              onCatsChange={setCats}
              value={bulkCat}
              onChange={setBulkCat}
              colors={C}
              inputStyle={inputStyle}
              showToast={showToast}
              placeholder="미분류로 되돌리기"
            />

            <div style={{ display: "flex", gap: "9px", marginTop: "16px" }}>
              <button
                onClick={() => setBulkCatOpen(false)}
                disabled={bulkSaving}
                style={{ flex: 1, padding: "11px", borderRadius: "10px", border: `1px solid ${C.border}`, background: "transparent", color: C.text, fontSize: "13px", fontWeight: 700, cursor: "pointer" }}
              >
                취소
              </button>
              <button
                onClick={applyBulkCategory}
                disabled={bulkSaving}
                style={{ flex: 2, padding: "11px", borderRadius: "10px", border: "none", background: C.accent, color: "#fff", fontSize: "13px", fontWeight: 800, cursor: bulkSaving ? "wait" : "pointer" }}
              >
                {bulkSaving ? "바꾸는 중…" : `${selected.size}종 분류 바꾸기`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {stockAdjustItem ? (
        <StockAdjustModal
          scriptUrl={scriptUrl}
          connected={connected}
          isLightMode={isLightMode}
          category="tablecloth"
          rowIndex={stockAdjustItem.id}
          itemId={String(stockAdjustItem.id)}
          itemLabel={stockAdjustItem.name}
          currentStock={Number(stockAdjustItem.stock) || 0}
          showToast={showToast}
          onClose={() => setStockAdjustItem(null)}
          onSaved={(newStock) => {
            setItems((prev) => prev.map((it) => (it.id === stockAdjustItem.id ? { ...it, stock: newStock } : it)));
            setStockAdjustItem(null);
          }}
        />
      ) : null}

      <ImageZoomModal url={modalUrl} onClose={() => setModalUrl("")} />
    </div>
  );
}
