import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { InventoryItem } from "../types";
import { getThumbImageUrl, resizeAndCompressImage } from "../utils/drive";
import { fetchItemPhotosBulk, fetchWarehouseRecentChanges, WarehouseRecentChange, fetchWarehouseRackSections, postSetWarehouseRackSections, fetchWarehouseRackLevels, postSetWarehouseRackLevels, fetchWarehouseRackLevelPhotos, postSetWarehouseRackLevelPhoto, WarehouseRackLevelPhoto } from "../utils/borrowApi";
import { toolRackKey, parseToolLocation, sectionLabel, compareToolLocation, clampSections, DEFAULT_SECTIONS, levelCodes } from "../utils/toolLocation";
import ToolLocationPicker, { SectionMiniMap } from "./ToolLocationPicker";
import { smartMatch } from "../utils/search";
import { KIND_LABEL, relativeTime } from "../utils/warehouseChanges";
import { ChevronDown, ChevronRight, Search, Package, Pencil, MapPin, Boxes, ExternalLink, ArrowUpDown, Plus, Trash2, RotateCcw, Archive, ArchiveRestore, CheckSquare, Square, Move, X, MoreHorizontal, List, LayoutGrid, History, Camera } from "lucide-react";
import ScrollToTopButton from "./ScrollToTopButton";
import ItemThumbnailSlideshow from "./ItemThumbnailSlideshow";

interface Props {
  inventory: InventoryItem[];
  isLightMode: boolean;
  isAdmin: boolean;
  scriptUrl?: string;
  onEditItem: (item: InventoryItem) => void;
  onAdjustStock?: (item: InventoryItem) => void;
  onDeleteItem?: (item: InventoryItem) => void;
  onToggleArchive?: (item: InventoryItem) => void;
  /** 변동 전체를 따로 보는 페이지로 넘어간다. 안 넘기면 "전체 보기" 버튼이 안 보인다. */
  onOpenAllChanges?: () => void;
  onImageClick?: (url: string) => void;
  // 랙/슬롯별로 새 물품을 추가할 때 (그 위치를 미리 채워 등록 화면을 연다)
  onAddItem?: (presetLocation: string) => void;
  // 캐시 무시하고 DB를 다시 읽는 강제 새로고침
  onRefresh?: () => void;
  refreshing?: boolean;
  // 화면 타이틀 — 이 컴포넌트 맨 위에 같이 그린다.
  title?: string;
  // 여러 물품을 선택해서 한 번에 다른 위치로 옮기는 기능. 안 넘기면 "선택 모드" 버튼 자체가 안 보인다.
  onBulkMoveLocation?: (rowIndexes: number[], newLocation: string) => void;
  /** 이 화면을 감싼 스크롤 영역의 안쪽 여백(px). 고정 검색 줄이 그만큼 바깥으로 펴져야 틈이 없다. PC 24, 모바일 14. */
  gutter?: number;
  /** 고정 검색 줄·랙 줄 뒤에 깔 배경. 스크롤 영역 배경과 같아야 아래 목록이 비치지 않는다. */
  stickyBg?: string;
}

const RECENT_HOURS = 48;
const RECENT_PREVIEW = 3;      // 처음에 보이는 건수
const RECENT_EXPANDED = 6;     // "더 보기"를 누르면 보이는 건수. 그보다 많으면 따로 페이지로 넘어간다.
const VIEW_KEY = "wms_rgv_view";
const RECENT_OPEN_KEY = "wms_rgv_recent_open";

function readPref(key: string, fallback: string) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function writePref(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* 저장 실패는 이번 화면에서만 기억한다 */ }
}

/** 재고 값은 "1", "1.0", "N/A", "", 0이 섞여 들어온다. 화면에는 한 가지 모양으로 보이게 정리한다. */
function stockInfo(s: InventoryItem["stock"]): { text: string; tone: "out" | "na" | "ok" } {
  const raw = s === null || s === undefined ? "" : String(s).trim();
  if (!raw || raw.toUpperCase() === "N/A") return { text: "N/A", tone: "na" };
  const n = Number(raw);
  if (Number.isNaN(n)) return { text: raw, tone: "na" };
  const text = Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
  return { text, tone: n <= 0 ? "out" : "ok" };
}

export default function RackGroupedView({ inventory, isLightMode, isAdmin, scriptUrl, onEditItem, onAdjustStock, onDeleteItem, onToggleArchive, onOpenAllChanges, onImageClick, onAddItem, onRefresh, refreshing, title, onBulkMoveLocation, gutter = 24, stickyBg = "var(--canvas-bg, #0b1120)" }: Props) {
  // 카드 썸네일을 대표 사진 + 추가 사진 슬라이드로 보여주기 위해, 물품ID별 추가 사진을
  // 한 번에 불러와 둔다(개별 조회하면 카드 수만큼 N+1 요청이 나간다).
  const [extraPhotosMap, setExtraPhotosMap] = useState<Record<string, string[]>>({});
  useEffect(() => {
    if (!scriptUrl) return;
    fetchItemPhotosBulk(scriptUrl, "warehouse").then(setExtraPhotosMap).catch(() => { /* 보조 기능 — 실패해도 조용히 넘어간다 */ });
  }, [scriptUrl]);

  const C = {
    card: isLightMode ? "#ffffff" : "#161f30",
    cardSub: isLightMode ? "#f4f6f9" : "#0f172a",
    hover: isLightMode ? "#f8fafc" : "#1b2538",
    border: isLightMode ? "#e6e9ef" : "#26324a",
    text: isLightMode ? "#111827" : "#f1f5f9",
    label: isLightMode ? "#626c7d" : "#8b98ac",
    accent: "#2563eb",
    accentSoft: isLightMode ? "rgba(37,99,235,0.09)" : "rgba(148,163,184,0.14)",
    accentText: isLightMode ? "#1d4ed8" : "#93c5fd",
    warn: isLightMode ? "#b45309" : "#fbbf24",
    warnSoft: "rgba(245,158,11,0.12)",
    error: isLightMode ? "#dc2626" : "#f87171",
    errorSoft: isLightMode ? "rgba(220,38,38,0.10)" : "rgba(248,113,113,0.14)",
    success: isLightMode ? "#047857" : "#34d399",
    successSoft: isLightMode ? "rgba(4,120,87,0.10)" : "rgba(52,211,153,0.14)",
  };
  const kindTone = (kind: string) =>
    kind === "deleted" ? { color: C.error, bg: C.errorSoft }
    : kind === "created" || kind === "return" ? { color: C.success, bg: C.successSoft }
    : kind === "borrow" ? { color: C.warn, bg: C.warnSoft }
    : kind === "stock" ? { color: C.accentText, bg: C.accentSoft }
    : { color: C.label, bg: C.cardSub };

  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // 기본은 한 줄 목록. 사진으로 찾는 게 편할 때를 위해 사진 격자도 남겨 둔다.
  const [view, setView] = useState<"list" | "gallery">(() => (readPref(VIEW_KEY, "list") === "gallery" ? "gallery" : "list"));
  function changeView(next: "list" | "gallery") { setView(next); writePref(VIEW_KEY, next); }

  // 여러 물품 선택 → 한 번에 위치 이동. 선택 모드일 땐 물품을 눌러도 편집 대신 선택만 토글된다.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState("");

  function toggleSelectMode() {
    setSelectMode((v) => !v);
    setSelectedRows(new Set());
    setMenu(null);
  }
  function toggleRowSelected(rowIndex: number) {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  }
  async function confirmBulkMove() {
    const loc = moveTarget.trim();
    if (!loc || selectedRows.size === 0 || !onBulkMoveLocation) return;
    // 이 창에서 옮길 랙의 구역 수를 바꿨으면 먼저 저장한다. 실패해도 이동은 진행한다.
    const rack = parseToolLocation(loc).rack;
    const n = moveSectionEdits[rack];
    if (scriptUrl && rack && n && rackSections[rack] !== n) {
      try {
        const res = await postSetWarehouseRackSections(scriptUrl, rack, n);
        if (res?.success && res.sections) setRackSections(res.sections);
        else throw new Error(res?.message || "");
      } catch (e: any) {
        window.alert(`랙 구역 수를 저장하지 못했습니다: ${e?.message || e}`);
      }
    }
    setMoveSectionEdits({});
    onBulkMoveLocation(Array.from(selectedRows), loc);
    setMoveModalOpen(false);
    setMoveTarget("");
    setSelectedRows(new Set());
    setSelectMode(false);
  }
  // 보관 처리된 물품(archived)은 기본적으로 안 보이게 하고, "보관함" 버튼을 누르면 그것만 보여준다
  // (시나리오 물품 관리 화면의 보관함과 동일한 개념).
  const [showArchived, setShowArchived] = useState(false);
  const archivedCount = useMemo(() => inventory.filter((it) => it.archived).length, [inventory]);
  const visibleInventory = useMemo(() => inventory.filter((it) => !!it.archived === showArchived), [inventory, showArchived]);

  // 랙(F)별 층 수. 설정된 층은 물품이 없어도 "비어 있는 구역"으로 목록에 남긴다.
  const [rackLevels, setRackLevels] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!scriptUrl) return;
    fetchWarehouseRackLevels(scriptUrl).then(setRackLevels).catch(() => { /* 없으면 물품이 있는 층만 보인다 */ });
  }, [scriptUrl]);
  const [savingLevels, setSavingLevels] = useState<string | null>(null);
  async function changeRackLevels(group: string, count: number) {
    if (!scriptUrl || !isAdmin) return;
    const next = Math.max(0, Math.min(20, count));
    if ((rackLevels[group] ?? 0) === next) return;
    const before = rackLevels;
    setRackLevels((cur) => { const n = { ...cur }; if (next === 0) delete n[group]; else n[group] = next; return n; });
    setSavingLevels(group);
    try {
      const res = await postSetWarehouseRackLevels(scriptUrl, group, next);
      if (!res?.success) throw new Error(res?.message || "저장하지 못했습니다.");
      if (res.levels) setRackLevels(res.levels);
    } catch (e: any) {
      setRackLevels(before);
      window.alert(`층 수를 저장하지 못했습니다: ${e?.message || e}`);
    } finally {
      setSavingLevels(null);
    }
  }

  // 층 전체의 현재 적재 상태 사진. 물품 카드 안에 크게 넣지 않고 항상 보이는 층 머리글에
  // 머리글과 같은 중립색 프레임에 가로 썸네일을 둬, 목록과 자연스럽게 이어지게 한다.
  const [rackLevelPhotos, setRackLevelPhotos] = useState<Record<string, WarehouseRackLevelPhoto>>({});
  const [savingLevelPhoto, setSavingLevelPhoto] = useState<string | null>(null);
  const [levelPhotoTarget, setLevelPhotoTarget] = useState("");
  const levelPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const loadRackLevelPhotos = useCallback(() => {
    if (!scriptUrl) return;
    fetchWarehouseRackLevelPhotos(scriptUrl).then(setRackLevelPhotos).catch(() => { /* 사진이 없어도 목록은 그대로 쓴다 */ });
  }, [scriptUrl]);
  useEffect(() => { loadRackLevelPhotos(); }, [loadRackLevelPhotos]);

  function chooseLevelPhoto(level: string) {
    if (!isAdmin || !scriptUrl || savingLevelPhoto) return;
    setLevelPhotoTarget(level);
    levelPhotoInputRef.current?.click();
  }

  async function uploadLevelPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const level = levelPhotoTarget;
    event.target.value = "";
    if (!file || !level || !scriptUrl) return;
    setSavingLevelPhoto(level);
    try {
      const photo = await resizeAndCompressImage(file);
      const result = await postSetWarehouseRackLevelPhoto(scriptUrl, level, photo);
      if (!result?.success) throw new Error(result?.message || "사진을 저장하지 못했습니다.");
      if (result.photos) setRackLevelPhotos(result.photos);
      else if (result.entry) setRackLevelPhotos((current) => ({ ...current, [level]: result.entry! }));
      loadRecent();
    } catch (error: any) {
      window.alert(`층 현황 사진을 저장하지 못했습니다: ${error?.message || error}`);
    } finally {
      setSavingLevelPhoto(null);
      setLevelPhotoTarget("");
    }
  }

  // 스크롤 이동 대상 그룹(슬롯)·물품의 DOM 참조와, 방금 이동한 대상을 잠깐 반짝여줄 하이라이트 키
  const groupRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const itemRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const [highlightRow, setHighlightRow] = useState<number | null>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const [activeRack, setActiveRack] = useState<string | null>(null);
  const [activeSlot, setActiveSlot] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const rackBtnRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // 스크롤 위치에 따라 왼쪽 랙 강조를 옮기는데(아래 "스크롤 따라가기"), 랙을 눌러 이동하는 동안에는
  // 지나치는 랙마다 강조가 깜빡이지 않도록 잠근다. 스크롤이 멈추면 풀린다.
  const spyLockRef = useRef(false);
  const spyLockTimerRef = useRef<number | null>(null);
  const spyRunRef = useRef<((keepClicked: boolean) => void) | null>(null);
  const clickedRackRef = useRef<string | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, InventoryItem[]>();
    visibleInventory.forEach((it) => {
      // 랙 단위(F-02)로 묶는다. 구역(F-02-5)은 랙 안의 자리라 따로 묶지 않는다.
      const key = toolRackKey(it.location);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    });
    const entries = Array.from(map.entries());
    // 랙 안에서는 구역 번호 순(구역 미정이 맨 앞), 그 안에서 규격이 같은 물품끼리.
    entries.forEach(([, items]) => {
      items.sort((a, b) => {
        const bySection = compareToolLocation(a.location, b.location);
        if (bySection) return bySection;
        const subA = (a.spec || "").trim() || "미분류";
        const subB = (b.spec || "").trim() || "미분류";
        if (subA !== subB) return subA.localeCompare(subB, "ko");
        return (a.name || "").localeCompare(b.name || "", "ko");
      });
    });
    entries.sort((a, b) => compareToolLocation(a[0], b[0]));
    return entries;
  }, [visibleInventory]);

  // 검색어가 입력되면 매칭되는 물품이 있는 슬롯만, 그 안에서도 매칭되는 물품만 보여준다.
  const visibleGroups = useMemo(() => {
    const q = search.trim();
    if (!q) {
      if (showArchived) return groups;
      const have = new Set(groups.map(([key]) => key));
      const empty: [string, InventoryItem[]][] = [];
      Object.entries(rackLevels).forEach(([g, n]) => levelCodes(g, Number(n)).forEach((code) => { if (!have.has(code)) empty.push([code, []]); }));
      if (!empty.length) return groups;
      return [...groups, ...empty].sort((a, b) => compareToolLocation(a[0], b[0]));
    }
    return groups
      .map(([key, items]) => [key, items.filter((it) => smartMatch([it.name, it.location, it.spec, it.keywords], q))] as [string, InventoryItem[]])
      .filter(([, items]) => items.length > 0);
  }, [groups, search, rackLevels, showArchived]);

  const totalShown = visibleGroups.reduce((n, [, items]) => n + items.length, 0);
  const allCollapsed = visibleGroups.length > 0 && visibleGroups.every(([key]) => collapsed[key]);

  // 왼쪽 랙 목록: 랙별 물품 수와 슬롯 목록 (지금 보이는 목록 기준)
  const rackSummary = useMemo(() => {
    const map = new Map<string, { count: number; slots: { key: string; count: number }[] }>();
    visibleGroups.forEach(([key, items]) => {
      const rack = parseToolLocation(key).rackGroup || "미지정";
      if (!map.has(rack)) map.set(rack, { count: 0, slots: [] });
      const r = map.get(rack)!;
      r.count += items.length;
      r.slots.push({ key, count: items.length });
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [visibleGroups]);

  function toggle(key: string) {
    setCollapsed((p) => ({ ...p, [key]: !p[key] }));
  }
  function toggleAll() {
    if (allCollapsed) setCollapsed({});
    else { const next: Record<string, boolean> = {}; groups.forEach(([key]) => (next[key] = true)); setCollapsed(next); }
  }

  function flash(setter: () => void) {
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    setter();
    highlightTimerRef.current = window.setTimeout(() => { setHighlightKey(null); setHighlightRow(null); }, 2300);
  }
  function armSpyLock() {
    spyLockRef.current = true;
    if (spyLockTimerRef.current) window.clearTimeout(spyLockTimerRef.current);
    spyLockTimerRef.current = window.setTimeout(() => { spyLockRef.current = false; spyRunRef.current?.(true); }, 250);
  }
  // 특정 슬롯(위치)으로 스크롤 이동 + 잠깐 하이라이트. 접혀 있으면 먼저 펼친다.
  function scrollToGroup(key: string) {
    armSpyLock();
    setActiveSlot(key);
    setCollapsed((prev) => (prev[key] ? { ...prev, [key]: false } : prev));
    window.setTimeout(() => {
      groupRefs.current[key]?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
    flash(() => { setHighlightKey(key); setHighlightRow(null); });
  }
  function jumpToRack(rack: string) {
    // 누르면 그 랙이 강조되고, 이후에는 스크롤하는 위치를 따라 강조가 옮겨간다(다시 눌러도 꺼지지 않는다).
    setActiveRack(rack);
    clickedRackRef.current = rack;
    const first = visibleGroups.find(([key]) => (parseToolLocation(key).rackGroup || "미지정") === rack);
    if (first) scrollToGroup(first[0]);
  }
  // 최근 변동에서 물품 이름을 누르면 그 물품으로 이동한다.
  function jumpToItem(change: WarehouseRecentChange) {
    const byId = change.itemId ? inventory.find((it) => String(it.rowIndex) === change.itemId) : undefined;
    const byName = byId || inventory.find((it) => it.name === change.itemName && (!change.location || (it.location || "").trim().toUpperCase() === change.location.trim().toUpperCase()))
      || inventory.find((it) => it.name === change.itemName);
    if (!byName) {
      // 물품이 아니라 랙 설정 기록("F-02 · 랙 구역 수", "F랙 · 층 수")이면 그 랙으로 간다.
      const code = String(change.itemName || "").trim().toUpperCase().replace(/랙$/, "");
      const rackKey = visibleGroups.find(([key]) => key === code)?.[0];
      if (rackKey) { setSearch(""); scrollToGroup(rackKey); return; }
      const group = visibleGroups.find(([key]) => parseToolLocation(key).rackGroup === code)?.[0];
      if (group) { setSearch(""); jumpToRack(code); }
      return;
    }
    setSearch("");
    armSpyLock();
    setShowArchived(!!byName.archived);
    const key = toolRackKey(byName.location);
    setCollapsed((prev) => (prev[key] ? { ...prev, [key]: false } : prev));
    window.setTimeout(() => {
      itemRefs.current[byName.rowIndex]?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    flash(() => { setHighlightRow(byName.rowIndex); setHighlightKey(null); });
  }

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
      if (spyLockTimerRef.current) window.clearTimeout(spyLockTimerRef.current);
    };
  }, []);

  /* ── 스크롤 따라가기: 목록을 내리거나 올리면 왼쪽에서 강조된 랙도 지금 보는 랙으로 옮겨간다. ──
   * 고정 검색 줄 바로 아래에 걸친 마지막 슬롯을 "지금 보는 곳"으로 본다. 끝까지 내렸을 때는
   * 짧은 마지막 랙이 그 선까지 못 올라오므로 마지막 슬롯을 쓰되, 방금 눌러서 이동한 랙이
   * 화면에 보이면 그 선택을 존중한다. */
  const visibleGroupsRef = useRef(visibleGroups);
  visibleGroupsRef.current = visibleGroups;
  useEffect(() => {
    const rackOf = (key: string) => parseToolLocation(key).rackGroup || "미지정";
    const scrollParentOf = (from: HTMLElement | null): HTMLElement | null => {
      for (let el = from?.parentElement || null; el; el = el.parentElement) {
        const oy = window.getComputedStyle(el).overflowY;
        if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) return el;
      }
      return (document.scrollingElement as HTMLElement | null) || null;
    };
    const run = (keepClicked: boolean) => {
      const root = rootRef.current;
      const list = visibleGroupsRef.current;
      if (!root || !list.length) return;
      const toolbarH = parseFloat(window.getComputedStyle(root).getPropertyValue("--rgv-toolbar-h")) || 70;
      const mobile = window.matchMedia("(max-width: 760px)").matches;
      const sc = scrollParentOf(root);
      // 스크롤 영역은 화면 맨 위가 아니라 앱 머리글 아래에서 시작할 수 있다. 슬롯 위치는 화면 좌표로 읽으므로 그만큼 더한다.
      const base = sc && sc !== document.scrollingElement ? sc.getBoundingClientRect().top : 0;
      // .rgv-group의 scroll-margin-top과 같은 기준에 약간의 여유를 더한 선
      const line = base + toolbarH + (mobile ? 114 : 8) + 40;
      let current = list[0][0];
      for (const [key] of list) {
        const el = groupRefs.current[key];
        if (el && el.getBoundingClientRect().top <= line) current = key;
      }
      if (sc && sc.scrollHeight > sc.clientHeight + 8 && sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4) {
        current = list[list.length - 1][0];
        const clicked = keepClicked ? clickedRackRef.current : null;
        const firstOfClicked = clicked ? list.find(([key]) => rackOf(key) === clicked)?.[0] : undefined;
        const el = firstOfClicked ? groupRefs.current[firstOfClicked] : null;
        if (firstOfClicked && el && el.getBoundingClientRect().top < window.innerHeight) current = firstOfClicked;
      }
      setActiveRack(rackOf(current));
      setActiveSlot(current);
    };
    spyRunRef.current = run;
    let raf = 0;
    const onScroll = (e: Event) => {
      // 왼쪽 랙 목록 자체를 스크롤하는 건 목록 위치와 무관하다.
      const t = e.target;
      if (t instanceof Node && navRef.current?.contains(t)) return;
      if (spyLockRef.current) { armSpyLock(); return; }
      if (raf) return;
      raf = window.requestAnimationFrame(() => { raf = 0; clickedRackRef.current = null; run(false); });
    };
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      if (raf) window.cancelAnimationFrame(raf);
      spyRunRef.current = null;
    };
  }, []);
  // 보이는 슬롯이 바뀌면(검색·보관함·새로 불러옴) 현재 위치 기준으로 다시 잡는다.
  useEffect(() => {
    const id = window.requestAnimationFrame(() => { if (!spyLockRef.current) spyRunRef.current?.(false); });
    return () => window.cancelAnimationFrame(id);
  }, [visibleGroups]);
  // 강조된 랙이 왼쪽 목록(PC는 세로, 모바일은 가로 칩 줄) 안에서 안 보이면 그 자리로 밀어준다.
  useEffect(() => {
    const nav = navRef.current;
    const el = activeRack ? rackBtnRefs.current[activeRack] : null;
    if (!nav || !el) return;
    if (nav.scrollWidth > nav.clientWidth + 2) {
      nav.scrollTo({ left: Math.max(0, el.offsetLeft - (nav.clientWidth - el.offsetWidth) / 2), behavior: "smooth" });
    } else if (nav.scrollHeight > nav.clientHeight + 2) {
      const top = el.offsetTop, bottom = top + el.offsetHeight;
      if (top < nav.scrollTop) nav.scrollTo({ top: Math.max(0, top - 8), behavior: "smooth" });
      else if (bottom > nav.scrollTop + nav.clientHeight) nav.scrollTo({ top: bottom - nav.clientHeight + 8, behavior: "smooth" });
    }
  }, [activeRack, rackSummary]);

  /* ── 랙별 구역 수(1~9). 바꾸는 곳은 물품 편집 창과 "위치 이동" 창의 보관 위치 선택이다. ── */
  const [rackSections, setRackSections] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!scriptUrl) return;
    fetchWarehouseRackSections(scriptUrl).then(setRackSections).catch(() => { /* 없으면 모든 랙을 3구역으로 본다 */ });
    // 편집 창에서 구역 수를 바꾸고 저장하면 물품 목록이 새로 들어오므로 그때 같이 다시 받는다.
  }, [scriptUrl, inventory]);
  const sectionsOf = (rack: string) => clampSections(rackSections[rack] ?? DEFAULT_SECTIONS);
  // "위치 이동" 창에서 바꾼 구역 수 — 이동할 때 함께 저장한다.
  const [moveSectionEdits, setMoveSectionEdits] = useState<Record<string, number>>({});

  /* ── 최근 48시간 변동 ── */
  const [recent, setRecent] = useState<WarehouseRecentChange[] | null>(null);
  const [recentError, setRecentError] = useState("");
  const [recentOpen, setRecentOpen] = useState(() => readPref(RECENT_OPEN_KEY, typeof window !== "undefined" && window.innerWidth <= 760 ? "0" : "1") === "1");
  const [recentAll, setRecentAll] = useState(false);
  const loadRecent = useCallback(() => {
    if (!isAdmin || !scriptUrl) return;
    fetchWarehouseRecentChanges(scriptUrl, RECENT_HOURS)
      .then((items) => { setRecent(items); setRecentError(""); })
      .catch((e) => setRecentError(e?.message || "불러오지 못했습니다."));
  }, [isAdmin, scriptUrl]);
  // 물품 목록이 새로 들어올 때(편집·재고 변경·새로고침 직후)마다 변동 목록도 다시 받는다.
  useEffect(() => { loadRecent(); }, [loadRecent, inventory]);

  /* ── ⋯ 메뉴 ── */
  const [menu, setMenu] = useState<{ item: InventoryItem; top: number; left: number } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);
  function openMenu(e: React.MouseEvent, item: InventoryItem) {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const width = 190;
    const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
    const spaceBelow = window.innerHeight - r.bottom;
    const top = spaceBelow < 230 ? Math.max(8, r.top - 226) : r.bottom + 4;
    setMenu((cur) => (cur?.item.rowIndex === item.rowIndex ? null : { item, top, left }));
  }
  const hasMenu = isAdmin && !!(onEditItem || onAdjustStock || onToggleArchive || onDeleteItem);

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "9px 12px 9px 34px", fontSize: "13px", borderRadius: "10px",
    border: `1px solid ${C.border}`, background: C.card, color: C.text, outline: "none",
    boxSizing: "border-box",
  };
  const toolBtn = (on = false): React.CSSProperties => ({
    display: "flex", alignItems: "center", gap: "6px", padding: "9px 12px", borderRadius: "10px", cursor: "pointer",
    border: `1px solid ${on ? C.accent : C.border}`, background: on ? C.accentSoft : C.card,
    color: on ? C.accentText : C.label, fontSize: "12px", fontWeight: 700, whiteSpace: "nowrap",
  });

  function stockBadge(it: InventoryItem) {
    const s = stockInfo(it.stock);
    const tone = s.tone === "out" ? { color: C.error, bg: C.errorSoft } : s.tone === "na" ? { color: C.label, bg: C.cardSub } : { color: C.success, bg: C.successSoft };
    const clickable = isAdmin && !!onAdjustStock && !selectMode;
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); if (clickable) onAdjustStock!(it); }}
        title={clickable ? "재고 변경" : undefined}
        style={{
          display: "inline-flex", alignItems: "center", gap: "4px", padding: "4px 10px", borderRadius: "999px",
          border: "none", background: tone.bg, color: tone.color, fontSize: "12px", fontWeight: 800,
          cursor: clickable ? "pointer" : "default", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
        }}
      >
        재고 {s.text}
        {clickable ? <ArrowUpDown size={11} style={{ opacity: 0.7 }} /> : null}
      </button>
    );
  }

  function itemActions(it: InventoryItem) {
    // 링크가 없는 물품도 칸 폭을 같게 둬서 재고 표시가 줄마다 같은 자리에 오게 한다.
    if (selectMode) return <div className="rgv-actions" />;
    return (
      <div className="rgv-actions" style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "2px" }} onClick={(e) => e.stopPropagation()}>
        {it.link ? (
          <a href={it.link} target="_blank" rel="noopener noreferrer" title="제품 링크 열기" aria-label="제품 링크 열기" className="rgv-touch"
            style={{ display: "flex", borderRadius: "8px", color: C.label }}>
            <ExternalLink size={15} />
          </a>
        ) : null}
        {hasMenu ? (
          <button type="button" aria-label="더 보기" className="rgv-touch" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => openMenu(e, it)}
            style={{ display: "flex", borderRadius: "8px", border: "none", background: menu?.item.rowIndex === it.rowIndex ? C.cardSub : "transparent", color: C.label, cursor: "pointer" }}>
            <MoreHorizontal size={16} />
          </button>
        ) : null}
      </div>
    );
  }

  // 층 그림 + "오른쪽 뒤" / "구역 미정"
  function sectionTag(it: InventoryItem) {
    const pl = parseToolLocation(it.location);
    return (
      <span title={it.location} style={{ display: "inline-flex", alignItems: "center", gap: "5px", flexShrink: 0, fontWeight: 700, color: pl.section ? C.accentText : C.label, opacity: pl.section ? 1 : 0.8 }}>
        <SectionMiniMap location={it.location} sections={sectionsOf(pl.rack)} isLightMode={isLightMode} />
        {sectionLabel(pl)}
      </span>
    );
  }

  // 목록에서 랙(F)이 바뀌는 자리에 붙는 머리글. 관리자는 여기서 층 수를 정한다.
  function rackHeader(group: string) {
    const set = rackLevels[group] ?? 0;
    const btn: React.CSSProperties = { width: 26, height: 26, borderRadius: "7px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", fontWeight: 800, fontSize: "14px", lineHeight: 1 };
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "10px", margin: "10px 2px 2px", flexWrap: "wrap" }}>
        <span style={{ fontSize: "16px", fontWeight: 900, color: C.text, fontFamily: "monospace" }}>{group}</span>
        {group !== "미지정" ? (
          isAdmin && scriptUrl ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", opacity: savingLevels === group ? 0.6 : 1 }}>
              <span style={{ fontSize: "12px", fontWeight: 700, color: C.label }}>층 수</span>
              <button type="button" className="rgv-step" aria-label={`${group} 층 수 줄이기`} disabled={savingLevels === group || set <= 0} onClick={() => changeRackLevels(group, set - 1)} style={{ ...btn, opacity: set <= 0 ? 0.4 : 1 }}>−</button>
              <span style={{ minWidth: 34, textAlign: "center", fontSize: "13px", fontWeight: 800, color: set ? C.text : C.label }}>{set ? `${set}층` : "미설정"}</span>
              <button type="button" className="rgv-step" aria-label={`${group} 층 수 늘리기`} disabled={savingLevels === group || set >= 20} onClick={() => changeRackLevels(group, set + 1)} style={btn}>+</button>
              {set ? <span style={{ fontSize: "11.5px", color: C.label }}>{group}-00 ~ {group}-{String(set - 1).padStart(2, "0")}</span> : <span style={{ fontSize: "11.5px", color: C.label }}>물품이 있는 층만 표시</span>}
            </span>
          ) : set ? <span style={{ fontSize: "12px", color: C.label }}>{set}층</span> : null
        ) : null}
        <span style={{ flex: 1, height: "1px", background: C.border }} />
      </div>
    );
  }

  function onItemClick(it: InventoryItem) {
    if (selectMode) toggleRowSelected(it.rowIndex);
    else if (isAdmin) onEditItem(it);
  }

  function renderRow(it: InventoryItem, last: boolean) {
    const img = it.photo ? getThumbImageUrl(it.photo) : "";
    const isSelected = selectedRows.has(it.rowIndex);
    const lit = highlightRow === it.rowIndex;
    return (
      <div
        key={it.rowIndex}
        ref={(el) => { itemRefs.current[it.rowIndex] = el; }}
        className={`rgv-row${lit ? " wms-slot-highlight" : ""}`}
        onClick={() => onItemClick(it)}
        style={{
          display: "grid", gridTemplateColumns: `${selectMode ? "22px " : ""}44px minmax(0,1fr) auto auto`, alignItems: "center", gap: "12px",
          padding: "8px 10px 8px 12px", borderBottom: last ? "none" : `1px solid ${C.border}`,
          background: isSelected ? C.accentSoft : undefined, cursor: selectMode || isAdmin ? "pointer" : "default",
        }}
      >
        {selectMode ? (isSelected ? <CheckSquare size={18} style={{ color: C.accent }} /> : <Square size={18} style={{ color: C.label }} />) : null}
        <div
          onClick={(e) => { if (selectMode) return; e.stopPropagation(); if (img && onImageClick) onImageClick(img); }}
          style={{ width: 44, height: 44, borderRadius: "9px", overflow: "hidden", background: C.cardSub, display: "flex", alignItems: "center", justifyContent: "center", cursor: img && !selectMode ? "zoom-in" : "inherit", flexShrink: 0 }}
        >
          {img ? <img src={img} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Boxes size={18} style={{ color: C.border }} />}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: "14px", color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "3px", fontSize: "12px", color: C.label, minWidth: 0 }}>
            {sectionTag(it)}
            {it.spec ? <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.spec}</span> : null}
            {it.isConsumable ? <span style={{ flexShrink: 0, fontSize: "11px", fontWeight: 700, color: C.warn, background: C.warnSoft, borderRadius: "5px", padding: "1px 6px" }}>소모품</span> : null}
          </div>
        </div>
        {stockBadge(it)}
        {itemActions(it)}
      </div>
    );
  }

  function renderCard(it: InventoryItem) {
    const img = it.photo ? getThumbImageUrl(it.photo) : "";
    const slidePhotos = [img, ...(extraPhotosMap[String(it.rowIndex)] || [])].filter(Boolean) as string[];
    const isSelected = selectedRows.has(it.rowIndex);
    const lit = highlightRow === it.rowIndex;
    return (
      <div
        key={it.rowIndex}
        ref={(el) => { itemRefs.current[it.rowIndex] = el; }}
        className={lit ? "wms-slot-highlight" : undefined}
        onClick={() => onItemClick(it)}
        style={{
          position: "relative", borderRadius: "12px", overflow: "hidden", background: C.card,
          display: "flex", flexDirection: "column", cursor: (selectMode || isAdmin) ? "pointer" : "default",
          border: `1px solid ${isSelected ? C.accent : C.border}`,
          boxShadow: isSelected ? `0 0 0 2px ${C.accent}33` : undefined,
        }}
      >
        {selectMode ? (
          <div style={{ position: "absolute", top: "8px", left: "8px", zIndex: 2, width: 26, height: 26, borderRadius: "7px", background: isSelected ? C.accent : "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
            {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
          </div>
        ) : null}
        <div onClick={(e) => { if (selectMode) return; e.stopPropagation(); if (img && onImageClick) onImageClick(img); }} style={{ height: "130px", background: C.cardSub, display: "flex", alignItems: "center", justifyContent: "center", cursor: img && !selectMode ? "zoom-in" : "inherit" }}>
          {slidePhotos.length > 0 ? <ItemThumbnailSlideshow photos={slidePhotos} referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Boxes size={36} style={{ color: C.border }} />}
        </div>
        <div style={{ padding: "10px 10px 10px 12px", display: "flex", flexDirection: "column", gap: "8px", flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: "13.5px", lineHeight: 1.4, wordBreak: "break-word", color: C.text }}>{it.name}</div>
          <div style={{ fontSize: "12px" }}>{sectionTag(it)}</div>
          <div style={{ marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
            {stockBadge(it)}
            {itemActions(it)}
          </div>
        </div>
      </div>
    );
  }

  const recentShown = recent ? recent.slice(0, recentAll ? RECENT_EXPANDED : RECENT_PREVIEW) : [];

  return (
    // 아래 여백: 화면 우측 하단의 "맨 위로" 버튼이 마지막 줄의 버튼(링크·⋯)을 가리지 않도록, 끝까지 내리면 그 위로 올라오게 한다.
    <div ref={rootRef} style={{ paddingBottom: 96 }}>
      <style>{`
        @keyframes wms-slot-highlight-pulse {
          0% { box-shadow: 0 0 0 0 rgba(37,99,235,0.55); }
          70% { box-shadow: 0 0 0 14px rgba(37,99,235,0); }
          100% { box-shadow: 0 0 0 0 rgba(37,99,235,0); }
        }
        .wms-slot-highlight { animation: wms-slot-highlight-pulse 1.15s ease-out 2; background: ${C.accentSoft} !important; }
        @keyframes rgvSpin { to { transform: rotate(360deg); } }
        .rgv-spin { animation: rgvSpin 0.9s linear infinite; }
        .rgv-row:hover { background: ${C.hover}; }
        .rgv-layout { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 18px; align-items: start; }
        .rgv-side { position: sticky; top: var(--rgv-toolbar-h, 70px); max-height: calc(100vh - var(--rgv-toolbar-h, 70px) - 40px); overflow-y: auto; }
        .rgv-side-btn:hover { background: ${C.hover}; }
        .rgv-recent-row:hover { background: ${C.hover}; }
        .rgv-recent-row { display: grid; grid-template-columns: 76px 70px minmax(0,1fr) auto; grid-template-areas: "time kind body who"; gap: 10px; align-items: center; padding: 8px 14px; font-size: 12.5px; }
        .rgv-rc-time { grid-area: time; } .rgv-rc-kind { grid-area: kind; } .rgv-rc-body { grid-area: body; } .rgv-rc-who { grid-area: who; }
        .rgv-tools { display: contents; }
        .rgv-touch { padding: 7px; }
        /* 링크 아이콘이 없는 물품도 칸 폭을 같게 둬서 재고 표시가 줄마다 같은 자리에 오게 한다. */
        .rgv-actions { width: 66px; }
        .rgv-group { scroll-margin-top: calc(var(--rgv-toolbar-h, 70px) + 8px); }
        .rgv-level-photo { width: 104px; height: 64px; flex-shrink: 0; transition: border-color 180ms ease; }
        .rgv-level-photo:hover, .rgv-level-photo:focus-visible { border-color: ${C.label} !important; }
        .rgv-gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
        @media (max-width: 760px) {
          .rgv-layout { grid-template-columns: minmax(0, 1fr); gap: 10px; }
          /* 랙 줄은 검색 줄 바로 아래에 붙여, 목록을 내려도 다른 랙으로 바로 뛸 수 있게 한다. */
          .rgv-side { position: sticky; top: var(--rgv-toolbar-h, 70px); z-index: 25; max-height: none; display: flex; gap: 6px; overflow-x: auto; background: ${stickyBg}; margin: 0 -${gutter}px; padding: 2px ${gutter}px 8px; scrollbar-width: none; }
          .rgv-side::-webkit-scrollbar { display: none; }
          .rgv-side > div { flex-shrink: 0; }
          .rgv-side-btn { border: 1px solid ${C.border} !important; background: ${C.card}; min-height: 36px; }
          .rgv-side-slots, .rgv-side-title { display: none; }
          /* 검색창은 한 줄 전체, 도구 버튼은 그 아래 한 줄로 두고 옆으로 밀어서 본다. */
          .rgv-search { flex: 1 1 100% !important; min-width: 0 !important; }
          .rgv-tools { display: flex; gap: 6px; width: 100%; overflow-x: auto; scrollbar-width: none; padding-bottom: 2px; }
          .rgv-tools::-webkit-scrollbar { display: none; }
          .rgv-tools > * { flex-shrink: 0; }
          .rgv-summary { width: 100%; }
          .rgv-recent-row { grid-template-columns: auto auto minmax(0,1fr); grid-template-areas: "time kind who" "body body body"; row-gap: 4px; column-gap: 8px; padding: 9px 12px; }
          .rgv-touch { padding: 10px; }
          .rgv-actions { width: 76px; }
          /* 랙 칩 줄도 위에 붙어 있으므로 그만큼 더 내려서 멈춘다. */
          .rgv-group { scroll-margin-top: calc(var(--rgv-toolbar-h, 70px) + 114px); }
          .rgv-level-photo { width: 88px; height: 56px; }
          .rgv-gallery { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
          .rgv-row { gap: 10px !important; padding: 9px 6px 9px 10px !important; }
          .rgv-step { width: 34px !important; height: 34px !important; }
        }
      `}</style>

      {title ? (
        <div style={{ fontSize: "15px", fontWeight: 800, color: C.text, marginBottom: "14px" }}>{title}</div>
      ) : null}

      {/* 최근 48시간 변동 — 관리자에게만. 재고 조정·정보 수정·대여/반납/소모를 한곳에 모은다. */}
      {isAdmin && scriptUrl ? (
        <section style={{ border: `1px solid ${C.border}`, borderRadius: "14px", background: C.card, marginBottom: "2px", overflow: "hidden" }}>
          <button
            type="button"
            onClick={() => { const next = !recentOpen; setRecentOpen(next); writePref(RECENT_OPEN_KEY, next ? "1" : "0"); }}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: "8px", padding: "12px 14px", border: "none", background: "transparent", color: C.text, cursor: "pointer", textAlign: "left" }}
          >
            <History size={16} style={{ color: C.accentText }} />
            <span style={{ fontSize: "14px", fontWeight: 800 }}>최근 {RECENT_HOURS}시간 변동</span>
            <span style={{ fontSize: "12px", fontWeight: 700, color: C.label }}>{recent ? `${recent.length}건` : recentError ? "" : "불러오는 중"}</span>
            <span style={{ flex: 1 }} />
            {recentOpen ? <ChevronDown size={16} style={{ color: C.label }} /> : <ChevronRight size={16} style={{ color: C.label }} />}
          </button>
          {recentOpen ? (
            <div style={{ borderTop: `1px solid ${C.border}` }}>
              {recentError ? (
                <div style={{ padding: "14px", fontSize: "12.5px", color: C.error, display: "flex", gap: "10px", alignItems: "center" }}>
                  변동 내역을 불러오지 못했습니다. {recentError}
                  <button type="button" onClick={loadRecent} style={{ ...toolBtn(), padding: "5px 10px" }}>다시 시도</button>
                </div>
              ) : !recent ? (
                <div style={{ padding: "14px", fontSize: "12.5px", color: C.label }}>불러오는 중…</div>
              ) : recent.length === 0 ? (
                <div style={{ padding: "14px", fontSize: "12.5px", color: C.label }}>최근 {RECENT_HOURS}시간 동안 바뀐 COS 물품이 없습니다.</div>
              ) : (
                <>
                  {recentShown.map((c) => {
                    const tone = kindTone(c.kind);
                    return (
                      <div key={c.key} className="rgv-recent-row" style={{ borderBottom: `1px solid ${C.border}` }}>
                        <span className="rgv-rc-time" style={{ color: C.label, whiteSpace: "nowrap" }} title={c.at}>{relativeTime(c.at)}</span>
                        <span className="rgv-rc-kind" style={{ justifySelf: "start", fontSize: "11px", fontWeight: 800, color: tone.color, background: tone.bg, borderRadius: "6px", padding: "2px 7px", whiteSpace: "nowrap" }}>{KIND_LABEL[c.kind] || c.kind}</span>
                        <span className="rgv-rc-body" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: C.text }}>
                          <button type="button" onClick={() => jumpToItem(c)} title="이 물품으로 이동" style={{ border: "none", background: "none", padding: 0, color: C.text, fontWeight: 800, fontSize: "12.5px", cursor: "pointer" }}>{c.itemName || "(이름 없음)"}</button>
                          <span style={{ color: C.label }}> · {c.summary}</span>
                        </span>
                        <span className="rgv-rc-who" style={{ color: C.label, whiteSpace: "nowrap", justifySelf: "end" }}>{c.manager}</span>
                      </div>
                    );
                  })}
                  {/* 3개 → "더 보기"로 6개 → 그보다 많으면 "전체 보기"로 페이지 이동 */}
                  {!recentAll && recent.length > RECENT_PREVIEW ? (
                    <button type="button" onClick={() => setRecentAll(true)} style={{ width: "100%", padding: "10px", border: "none", background: "transparent", color: C.accentText, fontSize: "12.5px", fontWeight: 700, cursor: "pointer" }}>
                      {Math.min(recent.length, RECENT_EXPANDED) - RECENT_PREVIEW}건 더 보기
                    </button>
                  ) : null}
                  {recentAll ? (
                    <div style={{ display: "flex" }}>
                      <button type="button" onClick={() => setRecentAll(false)} style={{ flex: 1, padding: "10px", border: "none", background: "transparent", color: C.label, fontSize: "12.5px", fontWeight: 700, cursor: "pointer" }}>접기</button>
                      {onOpenAllChanges ? (
                        <button type="button" onClick={onOpenAllChanges} style={{ flex: 1, padding: "10px", border: "none", borderLeft: `1px solid ${C.border}`, background: "transparent", color: C.accentText, fontSize: "12.5px", fontWeight: 700, cursor: "pointer" }}>
                          전체 보기{recent.length > RECENT_EXPANDED ? ` (${recent.length}건)` : ""} →
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* 검색·도구 줄. 스크롤해도 위에 붙어 있고, 뒤로 목록이 비치지 않게 캔버스 배경을 깐다. */}
      <Toolbar
        C={C}
        search={search} setSearch={setSearch} inputStyle={inputStyle}
        view={view} changeView={changeView}
        toolBtn={toolBtn}
        allCollapsed={allCollapsed} toggleAll={toggleAll}
        isAdmin={isAdmin}
        onBulkMoveLocation={onBulkMoveLocation} selectMode={selectMode} toggleSelectMode={toggleSelectMode}
        onToggleArchive={onToggleArchive} showArchived={showArchived} setShowArchived={setShowArchived} archivedCount={archivedCount}
        onRefresh={() => { onRefresh?.(); loadRecent(); loadRackLevelPhotos(); }} hasRefresh={!!onRefresh} refreshing={refreshing}
        summary={`${visibleGroups.length}개 슬롯 · ${totalShown}개 물품`}
        gutter={gutter} stickyBg={stickyBg}
      />

      {inventory.length === 0 ? (
        <div style={{ textAlign: "center", padding: "64px 0", color: C.label }}>
          <RotateCcw size={28} className="rgv-spin" style={{ color: C.border, margin: "0 auto 8px", display: "block" }} />
          <div>COS 물품을 불러오는 중입니다.</div>
        </div>
      ) : (
        <div className="rgv-layout">
          {/* 왼쪽 랙 목록 — 랙을 누르면 그 랙의 첫 슬롯으로 가고 슬롯 목록이 펼쳐진다. */}
          <nav className="rgv-side" aria-label="랙 목록" ref={navRef}>
            <div className="rgv-side-title" style={{ fontSize: "11.5px", fontWeight: 800, color: C.label, padding: "4px 8px 6px" }}>랙</div>
            {rackSummary.map(([rack, info]) => {
              const on = activeRack === rack;
              return (
                <div key={rack} ref={(el) => { rackBtnRefs.current[rack] = el; }} style={{ flexShrink: 0 }}>
                  <button
                    type="button"
                    className="rgv-side-btn"
                    onClick={() => jumpToRack(rack)}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px",
                      padding: "7px 9px", borderRadius: "8px", border: on ? `1px solid ${C.accent}` : "1px solid transparent",
                      background: on ? C.accentSoft : "transparent", color: on ? C.accentText : C.text, cursor: "pointer",
                      fontSize: "13px", fontWeight: 800, whiteSpace: "nowrap",
                    }}
                  >
                    <span style={{ fontFamily: "monospace" }}>{rack}</span>
                    <span style={{ fontSize: "11.5px", fontWeight: 700, color: C.label }}>{info.count}</span>
                  </button>
                  {on ? (
                    <div className="rgv-side-slots" style={{ padding: "2px 0 6px 10px" }}>
                      {info.slots.map((s) => (
                        <button key={s.key} type="button" className="rgv-side-btn" onClick={() => scrollToGroup(s.key)}
                          style={{ width: "100%", display: "flex", justifyContent: "space-between", padding: "5px 8px", borderRadius: "7px", border: "none", background: activeSlot === s.key ? C.accentSoft : "transparent", color: activeSlot === s.key ? C.accentText : C.label, fontWeight: activeSlot === s.key ? 800 : 400, cursor: "pointer", fontSize: "12px", fontFamily: "monospace" }}>
                          <span>{s.key}</span><span>{s.count}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </nav>

          <div style={{ minWidth: 0 }}>
            {visibleGroups.length === 0 ? (
              <div style={{ textAlign: "center", padding: "64px 0", color: C.label }}>
                <Package size={36} style={{ color: C.border, margin: "0 auto 8px", display: "block" }} />
                <div>{search.trim() ? "검색 결과가 없습니다." : showArchived ? "보관함이 비어 있습니다." : "표시할 COS 물품이 없습니다."}</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                {visibleGroups.map(([groupKey, items], gi) => {
                  const isCollapsed = !!collapsed[groupKey];
                  const isHighlighted = highlightKey === groupKey;
                  const rackGroup = parseToolLocation(groupKey).rackGroup || "미지정";
                  const newRackGroup = gi === 0 || (parseToolLocation(visibleGroups[gi - 1][0]).rackGroup || "미지정") !== rackGroup;
                  const isEmpty = items.length === 0;
                  return (
                    <React.Fragment key={groupKey}>
                    {newRackGroup ? rackHeader(rackGroup) : null}
                    <section ref={(el) => { groupRefs.current[groupKey] = el; }} className="rgv-group">
                      {/* 슬롯 머리글 — 상자로 감싸지 않고 한 줄로 가볍게 */}
                      <div
                        onClick={() => toggle(groupKey)}
                        className={isHighlighted ? "wms-slot-highlight" : undefined}
                        style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", padding: "4px 4px 8px", cursor: "pointer", color: C.text, borderRadius: "8px" }}
                      >
                        {isCollapsed ? <ChevronRight size={15} style={{ color: C.label }} /> : <ChevronDown size={15} style={{ color: C.label }} />}
                        <MapPin size={13} style={{ color: C.label }} />
                        <span style={{ fontWeight: 800, fontSize: "14px", fontFamily: "monospace" }}>{groupKey}</span>
                        {(() => {
                          const entry = rackLevelPhotos[groupKey];
                          const photo = entry?.photo || "";
                          const saving = savingLevelPhoto === groupKey;
                          const title = entry?.updatedAt
                            ? `${groupKey} 층 현황 · ${relativeTime(entry.updatedAt)}${entry.updatedBy ? ` · ${entry.updatedBy}` : ""}`
                            : `${groupKey} 층 현황 사진`;
                          return photo ? (
                            <span onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex", alignItems: "center", gap: "8px", flexShrink: 0, padding: "4px 8px 4px 4px", borderRadius: "12px", background: C.cardSub, border: `1px solid ${C.border}` }}>
                              <button type="button" title={`${title} · 눌러서 확대`} aria-label={`${groupKey} 층 현황 사진 확대`}
                                className="rgv-level-photo"
                                onClick={() => onImageClick?.(photo)}
                                style={{ padding: 0, overflow: "hidden", borderRadius: "8px", border: `1px solid ${C.border}`, background: C.cardSub, cursor: onImageClick ? "zoom-in" : "default" }}>
                                <img src={getThumbImageUrl(photo)} alt={`${groupKey} 층 현황`} loading="lazy" style={{ width: "100%", height: "100%", display: "block", objectFit: "cover" }} />
                              </button>
                              <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: "4px" }}>
                                <span style={{ fontSize: "11px", fontWeight: 600, color: C.label, padding: "0 4px" }}>층 현황</span>
                              {isAdmin && scriptUrl ? (
                                <button type="button" title={`${groupKey} 층 현황 사진 교체`} aria-label={`${groupKey} 층 현황 사진 교체`} disabled={!!savingLevelPhoto}
                                  onClick={() => chooseLevelPhoto(groupKey)}
                                  style={{ display: "inline-flex", alignItems: "center", gap: "4px", minHeight: "28px", padding: "4px", borderRadius: "6px", border: "none", background: "transparent", color: C.label, cursor: savingLevelPhoto ? "wait" : "pointer", fontSize: "11.5px", fontWeight: 700, opacity: saving ? 0.55 : 1 }}>
                                  <Camera size={12} /> {saving ? "저장 중" : "사진 변경"}
                                </button>
                              ) : null}
                              </span>
                            </span>
                          ) : isAdmin && scriptUrl ? (
                            <button type="button" onClick={(e) => { e.stopPropagation(); chooseLevelPhoto(groupKey); }} disabled={!!savingLevelPhoto}
                              title={`${groupKey} 층 전체가 보이는 현재 상태 사진 등록`}
                              aria-label={`${groupKey} 층 현황 사진 등록`}
                              style={{ display: "inline-flex", alignItems: "center", gap: "4px", flexShrink: 0, padding: "5px 8px", borderRadius: "8px", border: `1px solid ${C.border}`, background: C.card, color: C.label, cursor: savingLevelPhoto ? "wait" : "pointer", fontSize: "11.5px", fontWeight: 700, opacity: saving ? 0.55 : 1 }}>
                              <Camera size={12} /> {saving ? "저장 중" : "사진 등록"}
                            </button>
                          ) : null;
                        })()}
                        {isEmpty
                          ? <span style={{ fontSize: "11.5px", fontWeight: 700, color: C.label, background: C.cardSub, border: `1px dashed ${C.border}`, borderRadius: "6px", padding: "1px 7px" }}>비어 있는 구역</span>
                          : <span style={{ fontSize: "12px", fontWeight: 700, color: C.label }}>{items.length}개</span>}
                        {(() => {
                          const unplaced = items.filter((it) => !parseToolLocation(it.location).section).length;
                          return unplaced > 0 && unplaced < items.length ? <span style={{ fontSize: "11.5px", fontWeight: 700, color: C.warn }}>구역 미정 {unplaced}</span> : null;
                        })()}
                        <span style={{ flex: 1, height: "1px", background: C.border, marginLeft: "4px" }} />
                        {groupKey !== "미지정" ? <span style={{ fontSize: "11.5px", fontWeight: 700, color: C.label, flexShrink: 0 }}>{sectionsOf(groupKey)}구역</span> : null}
                        {isAdmin && onAddItem ? (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onAddItem(groupKey); }}
                            title={`${groupKey}에 새 물품 추가`}
                            style={{ display: "flex", alignItems: "center", gap: "3px", flexShrink: 0, padding: "4px 9px", borderRadius: "7px", cursor: "pointer", border: `1px solid ${C.border}`, background: C.card, color: C.label, fontSize: "11.5px", fontWeight: 700 }}
                          >
                            <Plus size={12} /> 추가
                          </button>
                        ) : null}
                      </div>
                      {!isCollapsed && isEmpty ? (
                        <div style={{ border: `1px dashed ${C.border}`, borderRadius: "12px", padding: "12px 14px", fontSize: "12.5px", color: C.label }}>
                          비어 있는 구역입니다. 아직 이 층에 놓인 물품이 없습니다.
                        </div>
                      ) : !isCollapsed ? (
                        view === "list" ? (
                          <div style={{ border: `1px solid ${C.border}`, borderRadius: "12px", background: C.card, overflow: "hidden" }}>
                            {items.map((it, i) => renderRow(it, i === items.length - 1))}
                          </div>
                        ) : (
                          <div className="rgv-gallery">
                            {items.map(renderCard)}
                          </div>
                        )
                      ) : null}
                    </section>
                    </React.Fragment>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
      <ScrollToTopButton />
      <input ref={levelPhotoInputRef} type="file" accept="image/*" capture="environment" onChange={uploadLevelPhoto} style={{ display: "none" }} />

      {/* ⋯ 메뉴 — 목록 상자의 둥근 모서리에 잘리지 않도록 화면 기준으로 띄운다. */}
      {menu ? (
        <div
          role="menu"
          onMouseDown={(e) => e.stopPropagation()}
          style={{ position: "fixed", top: menu.top, left: menu.left, width: 190, zIndex: 4000, background: C.card, border: `1px solid ${C.border}`, borderRadius: "12px", boxShadow: "0 12px 30px rgba(0,0,0,0.22)", padding: "6px" }}
        >
          {[
            { key: "edit", show: true, icon: <Pencil size={14} />, label: "편집", tone: C.text, run: () => onEditItem(menu.item) },
            { key: "stock", show: !!onAdjustStock, icon: <ArrowUpDown size={14} />, label: "재고 변경", tone: C.text, run: () => onAdjustStock?.(menu.item) },
            { key: "archive", show: !!onToggleArchive, icon: menu.item.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />, label: menu.item.archived ? "보관함에서 꺼내기" : "보관 처리", tone: C.text, run: () => onToggleArchive?.(menu.item) },
            { key: "delete", show: !!onDeleteItem, icon: <Trash2 size={14} />, label: "삭제", tone: C.error, run: () => onDeleteItem?.(menu.item), divider: true },
          ].filter((m) => m.show).map((m) => (
            <React.Fragment key={m.key}>
              {m.divider ? <div style={{ height: "1px", background: C.border, margin: "4px 2px" }} /> : null}
              <button
                type="button"
                role="menuitem"
                className="rgv-side-btn"
                onClick={() => { setMenu(null); m.run(); }}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: "9px", padding: "8px 10px", borderRadius: "8px", border: "none", background: "transparent", color: m.tone, cursor: "pointer", fontSize: "13px", fontWeight: 700, textAlign: "left" }}
              >
                {m.icon} {m.label}
              </button>
            </React.Fragment>
          ))}
        </div>
      ) : null}

      {/* 선택 모드 하단 고정 액션 바 */}
      {selectMode && selectedRows.size > 0 ? (
        <div style={{ position: "sticky", bottom: "16px", zIndex: 40, display: "flex", justifyContent: "center", marginTop: "16px", pointerEvents: "none" }}>
          <div style={{ pointerEvents: "auto", display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", borderRadius: "14px", background: C.card, border: `1px solid ${C.border}`, boxShadow: "0 8px 24px rgba(0,0,0,0.25)" }}>
            <span style={{ fontSize: "13px", fontWeight: 800, color: C.text }}>{selectedRows.size}개 선택됨</span>
            <button
              onClick={() => { setMoveTarget(""); setMoveModalOpen(true); }}
              style={{ display: "flex", alignItems: "center", gap: "6px", padding: "9px 14px", borderRadius: "10px", border: "none", background: C.accent, color: "#fff", cursor: "pointer", fontSize: "12.5px", fontWeight: 700, whiteSpace: "nowrap" }}
            >
              <Move size={13} /> 위치 이동
            </button>
            <button
              onClick={() => setSelectedRows(new Set())}
              style={{ padding: "9px 14px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.label, cursor: "pointer", fontSize: "12.5px", fontWeight: 700, whiteSpace: "nowrap" }}
            >
              선택 해제
            </button>
          </div>
        </div>
      ) : null}

      {/* 위치 이동 입력 모달 */}
      {moveModalOpen ? (
        <div
          onClick={() => setMoveModalOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 5000, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(440px, 100%)", background: C.card, border: `1px solid ${C.border}`, borderRadius: "14px", padding: "20px" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
              <Move size={17} style={{ color: C.accentText }} />
              <span style={{ fontSize: "15px", fontWeight: 800, color: C.text, flex: 1 }}>위치 이동</span>
              <button onClick={() => setMoveModalOpen(false)} style={{ background: "transparent", border: "none", color: C.label, cursor: "pointer" }}><X size={18} /></button>
            </div>
            <div style={{ fontSize: "12.5px", color: C.label, marginBottom: "12px" }}>
              선택한 <b style={{ color: C.accentText }}>{selectedRows.size}개</b> 물품을 아래 위치로 한 번에 옮깁니다.
            </div>
            <div style={{ marginBottom: "16px" }}>
              <ToolLocationPicker value={moveTarget} onChange={setMoveTarget} inventory={inventory}
                sections={{ ...rackSections, ...moveSectionEdits }}
                onSectionsChange={(rack, n) => setMoveSectionEdits((cur) => ({ ...cur, [rack]: n }))}
                rackLevels={rackLevels}
                isLightMode={isLightMode} />
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={() => setMoveModalOpen(false)}
                style={{ flex: 1, padding: "11px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.text, fontSize: "13px", fontWeight: 700, cursor: "pointer" }}
              >
                취소
              </button>
              <button
                onClick={confirmBulkMove}
                disabled={!moveTarget.trim()}
                style={{ flex: 2, padding: "11px", borderRadius: "10px", border: "none", background: C.accent, color: "#fff", fontSize: "13px", fontWeight: 800, cursor: moveTarget.trim() ? "pointer" : "default", opacity: moveTarget.trim() ? 1 : 0.5 }}
              >
                이동
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 검색·도구 줄. 높이를 재서 --rgv-toolbar-h로 알려주면 왼쪽 랙 목록과 슬롯 이동 위치가 그 아래로 맞춰진다. */
function Toolbar(props: {
  C: any; search: string; setSearch: (v: string) => void; inputStyle: React.CSSProperties;
  view: "list" | "gallery"; changeView: (v: "list" | "gallery") => void;
  toolBtn: (on?: boolean) => React.CSSProperties;
  allCollapsed: boolean; toggleAll: () => void; isAdmin: boolean;
  onBulkMoveLocation?: (rowIndexes: number[], newLocation: string) => void; selectMode: boolean; toggleSelectMode: () => void;
  onToggleArchive?: (item: InventoryItem) => void; showArchived: boolean; setShowArchived: (fn: (v: boolean) => boolean) => void; archivedCount: number;
  onRefresh: () => void; hasRefresh: boolean; refreshing?: boolean; summary: string;
  gutter: number; stickyBg: string;
}) {
  const { C, toolBtn } = props;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => {
      // 부모 스크롤 영역의 윗 패딩(24px)만큼 음수로 붙어 있으므로 그만큼 뺀다.
      const h = Math.max(0, el.offsetHeight - props.gutter);
      el.parentElement?.style.setProperty("--rgv-toolbar-h", `${h}px`);
    };
    apply();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(apply) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [props.gutter]);
  const g = props.gutter;
  return (
    <div ref={ref} style={{ position: "sticky", top: `-${g}px`, zIndex: 30, background: props.stickyBg, margin: `0 -${g}px`, padding: `${g}px ${g}px 0`, boxSizing: "border-box" }}>
      <div style={{ display: "flex", gap: "8px", paddingBottom: g < 20 ? "10px" : "14px", flexWrap: "wrap", alignItems: "center" }}>
        <div className="rgv-search" style={{ position: "relative", flex: "1 1 0%", minWidth: "200px" }}>
          <Search size={15} style={{ position: "absolute", left: "11px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
          <input value={props.search} onChange={(e) => props.setSearch(e.target.value)} placeholder="물품명 · 위치 · 규격 검색" style={props.inputStyle} />
        </div>
        <div className="rgv-tools">
        <div style={{ display: "flex", border: `1px solid ${C.border}`, borderRadius: "10px", overflow: "hidden" }} role="group" aria-label="보기 방식">
          {([["list", <List size={14} key="l" />, "목록"], ["gallery", <LayoutGrid size={14} key="g" />, "사진"]] as const).map(([key, icon, label]) => {
            const on = props.view === key;
            return (
              <button key={key} type="button" aria-pressed={on} onClick={() => props.changeView(key)}
                style={{ display: "flex", alignItems: "center", gap: "5px", padding: "8px 11px", border: "none", background: on ? C.accentSoft : C.card, color: on ? C.accentText : C.label, cursor: "pointer", fontSize: "12px", fontWeight: 700 }}>
                {icon} {label}
              </button>
            );
          })}
        </div>
        <button type="button" onClick={props.toggleAll} style={toolBtn()}>{props.allCollapsed ? "모두 펼치기" : "모두 접기"}</button>
        {props.isAdmin && props.onBulkMoveLocation ? (
          <button type="button" onClick={props.toggleSelectMode} style={toolBtn(props.selectMode)}>
            {props.selectMode ? <X size={13} /> : <CheckSquare size={13} />} {props.selectMode ? "선택 취소" : "선택해서 위치 이동"}
          </button>
        ) : null}
        {props.isAdmin && props.onToggleArchive ? (
          <button type="button" onClick={() => props.setShowArchived((v) => !v)} title={props.showArchived ? "보관함 닫기" : "보관함 열기 (사용 불가 등으로 치워둔 물품)"} style={toolBtn(props.showArchived)}>
            <Archive size={13} /> 보관함{props.archivedCount > 0 ? ` (${props.archivedCount})` : ""}
          </button>
        ) : null}
        {props.hasRefresh ? (
          <button type="button" onClick={props.onRefresh} disabled={props.refreshing} title="지금 새로고침" aria-label="새로고침" style={{ ...toolBtn(), cursor: props.refreshing ? "wait" : "pointer", opacity: props.refreshing ? 0.7 : 1 }}>
            <RotateCcw size={14} className={props.refreshing ? "rgv-spin" : undefined} />
          </button>
        ) : null}
        </div>
        <span className="rgv-summary" style={{ fontSize: "12px", color: C.label, whiteSpace: "nowrap" }}>{props.summary}</span>
      </div>
    </div>
  );
}
