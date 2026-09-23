import React, { useState, useMemo, useRef, useEffect } from "react";
import { InventoryItem } from "../types";
import { parseLocation, getThumbImageUrl } from "../utils/drive";
import { compareRackSlot, fetchItemPhotosBulk } from "../utils/borrowApi";
import { smartMatch } from "../utils/search";
import { ChevronDown, ChevronRight, Search, Package, Pencil, MapPin, Boxes, ExternalLink, ArrowUpDown, PackageOpen, Plus, Trash2, RotateCcw, Archive, ArchiveRestore, CheckSquare, Square, Move, X } from "lucide-react";
import ScrollToTopButton from "./ScrollToTopButton";
import ItemThumbnailSlideshow from "./ItemThumbnailSlideshow";

interface Props {
  inventory: InventoryItem[];
  isLightMode: boolean;
  isAdmin: boolean;
  // 무인 모드 중에는 비관리자에게 보관 위치를 전부 숨긴다 — 이 화면은 원래 위치별로
  // 묶어 보여주는 게 핵심이라, 켜지면 그룹/카드 모두에서 실제 위치 표기를 뺀다.
  unattendedEnabled?: boolean;
  scriptUrl?: string;
  onEditItem: (item: InventoryItem) => void;
  onAdjustStock?: (item: InventoryItem) => void;
  onDeleteItem?: (item: InventoryItem) => void;
  onToggleArchive?: (item: InventoryItem) => void;
  onManageSets?: () => void;
  onImageClick?: (url: string) => void;
  // 랙/슬롯별로 새 물품을 추가할 때 (그 위치를 미리 채워 등록 화면을 연다)
  onAddItem?: (presetLocation: string) => void;
  // 캐시 무시하고 DB를 다시 읽는 강제 새로고침
  onRefresh?: () => void;
  refreshing?: boolean;
  // 화면 타이틀 — 별도 바로 안 빼고 이 컴포넌트의 고정 헤더 안에 같이 넣는다.
  // (따로 두면 타이틀만 고정이 안 돼서 그 자리가 스크롤할 때 비어 보이는 문제가 있었다)
  title?: string;
  // 여러 물품을 선택해서 한 번에 다른 위치로 옮기는 기능. 안 넘기면 "선택 모드" 버튼 자체가 안 보인다.
  onBulkMoveLocation?: (rowIndexes: number[], newLocation: string) => void;
}

export default function RackGroupedView({ inventory, isLightMode, isAdmin, unattendedEnabled, scriptUrl, onEditItem, onAdjustStock, onDeleteItem, onToggleArchive, onManageSets, onImageClick, onAddItem, onRefresh, refreshing, title, onBulkMoveLocation }: Props) {
  const hideLocation = !!unattendedEnabled && !isAdmin;
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
    border: isLightMode ? "#e6e9ef" : "#26324a",
    text: isLightMode ? "#111827" : "#f1f5f9",
    label: isLightMode ? "#626c7d" : "#8b98ac",
    accent: "#2563eb",
    accentSoft: isLightMode ? "rgba(37,99,235,0.09)" : "rgba(148,163,184,0.14)",
    accentText: isLightMode ? "#111827" : "#f1f5f9",
    warn: isLightMode ? "#b45309" : "#fbbf24",
    warnSoft: "rgba(245,158,11,0.12)",
    error: isLightMode ? "#dc2626" : "#f87171",
    errorSoft: isLightMode ? "rgba(220,38,38,0.10)" : "rgba(248,113,113,0.14)",
    success: isLightMode ? "#047857" : "#34d399",
    successSoft: isLightMode ? "rgba(4,120,87,0.10)" : "rgba(52,211,153,0.14)",
  };

  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // 여러 물품 선택 → 한 번에 위치 이동. 선택 모드일 땐 카드를 눌러도 편집 모달 대신 선택만 토글된다.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState("");

  function toggleSelectMode() {
    setSelectMode((v) => !v);
    setSelectedRows(new Set());
  }
  function toggleRowSelected(rowIndex: number) {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  }
  function confirmBulkMove() {
    const loc = moveTarget.trim();
    if (!loc || selectedRows.size === 0 || !onBulkMoveLocation) return;
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
  // 슬롯(정확한 위치) 단위 그룹핑이 기본이자 유일한 방식이다. (랙 단위 그룹핑 제거)

  // 헤더 랙 내비게이터: 어떤 랙이 펼쳐져 슬롯 목록을 보여주고 있는지
  const [expandedRack, setExpandedRack] = useState<string | null>(null);

  // 스크롤 이동 대상 그룹(슬롯)의 DOM 참조와, 방금 이동한 그룹을 잠깐 반짝여줄 하이라이트 키
  const groupRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const highlightTimerRef = useRef<number | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, InventoryItem[]>();
    visibleInventory.forEach((it) => {
      // 슬롯 단위: 정확한 위치(랙-슬롯) 하나하나를 그룹으로
      const key = (it.location || "").trim().toUpperCase() || "미지정";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    });
    const entries = Array.from(map.entries());
    // 슬롯 "안"에서만 서브카테고리(규격)가 같은 물품끼리 나란히 붙도록 정렬한다.
    // (슬롯 자체의 순서는 절대 바꾸지 않는다 — 전에 랙 전체를 서브카테고리로 재배열했더니
    //  슬롯 번호 순서가 뒤죽박죽돼 보였다는 피드백을 반영했다)
    entries.forEach(([, items]) => {
      items.sort((a, b) => {
        const subA = (a.spec || "").trim() || "미분류";
        const subB = (b.spec || "").trim() || "미분류";
        if (subA !== subB) return subA.localeCompare(subB, "ko");
        return compareRackSlot(a.location, b.location);
      });
    });
    // 슬롯은 항상 정상적인 랙-슬롯 번호 순서 그대로 나열한다.
    entries.sort((a, b) => compareRackSlot(a[0], b[0]));
    return entries;
  }, [visibleInventory]);

  // 검색어가 입력되면 매칭되는 슬롯만 걸러서 보여준다.
  // (전에는 스크롤+하이라이트 방식이었는데, 필터링이 더 낫다는 피드백으로 바꿨다)
  const visibleGroups = useMemo(() => {
    const q = search.trim();
    if (!q) return groups;
    return groups.filter(([, items]) => items.some((it) => smartMatch([it.name, it.location, it.spec, it.keywords], q)));
  }, [groups, search]);

  // 화면에 그릴 때 "여기서부터 새 랙이 시작된다"를 미리 계산해둔다 (구분선 표시용).
  const groupClusterInfo = useMemo(() => {
    let prevRack = "";
    return visibleGroups.map(([groupKey]) => {
      const rack = parseLocation(groupKey).rack || "미지정";
      const isNewRack = rack !== prevRack;
      prevRack = rack;
      return { rack, isNewRack };
    });
  }, [visibleGroups]);

  const totalShown = visibleGroups.reduce((n, [, items]) => n + items.length, 0);
  const allCollapsed = visibleGroups.length > 0 && visibleGroups.every(([key]) => collapsed[key]);

  // 헤더 랙 내비게이터용: 랙 목록과, 랙별 슬롯(정확한 위치) 목록
  const racks = useMemo(() => {
    const set = new Set<string>();
    inventory.forEach((it) => {
      const { rack } = parseLocation(it.location);
      if (rack) set.add(rack);
    });
    return Array.from(set).sort();
  }, [inventory]);

  const slotsByRack = useMemo(() => {
    const map: Record<string, string[]> = {};
    inventory.forEach((it) => {
      const { rack } = parseLocation(it.location);
      if (!rack) return;
      const loc = (it.location || "").trim().toUpperCase();
      if (!loc) return;
      if (!map[rack]) map[rack] = [];
      if (!map[rack].includes(loc)) map[rack].push(loc);
    });
    Object.keys(map).forEach((r) => map[r].sort(compareRackSlot));
    return map;
  }, [inventory]);

  function toggle(key: string) {
    setCollapsed((p) => ({ ...p, [key]: !p[key] }));
  }
  function toggleAll() {
    if (allCollapsed) setCollapsed({});
    else { const next: Record<string, boolean> = {}; groups.forEach(([key]) => (next[key] = true)); setCollapsed(next); }
  }

  // 특정 슬롯(위치)으로 스크롤 이동 + 잠깐 하이라이트. 접혀 있으면 먼저 펼친다.
  function scrollToGroup(key: string) {
    setCollapsed((prev) => (prev[key] ? { ...prev, [key]: false } : prev));
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    // 방금 펼쳐졌을 수 있으니 렌더가 반영된 다음 스크롤한다
    window.setTimeout(() => {
      groupRefs.current[key]?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
    setHighlightKey(key);
    highlightTimerRef.current = window.setTimeout(() => setHighlightKey(null), 2300);
  }

  useEffect(() => {
    return () => { if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current); };
  }, []);

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "9px 12px 9px 34px", fontSize: "13px", borderRadius: "10px",
    border: `1px solid ${C.border}`, background: C.card, color: C.text, outline: "none",
    boxSizing: "border-box",
  };

  function stockNum(s: InventoryItem["stock"]): string {
    if (s === null || s === undefined || s === "") return "-";
    return String(s);
  }

  return (
    <div>
      {/* 하이라이트 펄스 애니메이션 */}
      <style>{`
        @keyframes wms-slot-highlight-pulse {
          0% { box-shadow: 0 0 0 0 rgba(37,99,235,0.55); border-color: ${C.accent}; }
          70% { box-shadow: 0 0 0 16px rgba(37,99,235,0); border-color: ${C.accent}; }
          100% { box-shadow: 0 0 0 0 rgba(37,99,235,0); }
        }
        .wms-slot-highlight { animation: wms-slot-highlight-pulse 1.15s ease-out 2; }
        @keyframes rgv-skel-pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
        .rgv-skel { animation: rgv-skel-pulse 1.3s ease-in-out infinite; }
      `}</style>

      {/* 헤더 전체(랙 내비게이터 + 검색/컨트롤 바)를 하나로 묶어 함께 고정한다.
          따로 고정하면 랙 칩 줄은 스크롤에 그냥 흘러가버려서, 그 틈으로 아래 목록
          사진이 비쳐 보이는 문제가 있었다. */}
      {/* 스크롤 시 아래 내용이 비쳐 보이지 않도록:
          - 배경색을 부모 캔버스와 같은 변수(--canvas-bg)로 맞춘다 (전에는 다른 색을 하드코딩해 이질감이 있었다)
          - 부모의 24px 좌우/상단 패딩만큼 음수 마진으로 넓혀, 헤더 바깥에 틈이 생기지 않게 한다 */}
      <div style={{
        position: "sticky", top: "-24px", zIndex: 30,
        background: "var(--canvas-bg, #0b1120)",
        margin: "-24px -24px 0",
        padding: "24px 24px 0",
        boxSizing: "border-box",
      }}>
        {title ? (
          <div style={{ fontSize: "15px", fontWeight: 800, color: C.text, marginBottom: "14px" }}>{title}</div>
        ) : null}
        {/* 헤더 랙 내비게이터 — 검색창 위 공간을 채운다. 랙을 누르면 슬롯 목록이 펼쳐진다.
            인벤토리가 아직 로드되기 전엔(inventory가 비어있는 동안) 이 줄 자체가 접혀 있다가
            로드되는 순간 갑자기 나타나면서 아래 검색창·버튼들이 밀려 내려가 실수로 다른 걸
            누르게 되는 문제가 있었다 — 로드 전에는 같은 높이의 스켈레톤을 대신 깔아둔다. */}
        {hideLocation ? (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px", borderRadius: "10px", background: C.warnSoft, color: C.warn, fontSize: "12px", fontWeight: 700, marginBottom: "10px" }}>
            🔒 무인 모드 중에는 보관 위치가 표시되지 않습니다. 이름·규격으로 검색해서 찾아주세요.
          </div>
        ) : inventory.length === 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "10px" }}>
            {[46, 46, 46, 46, 46].map((w, i) => (
              <div key={i} className="rgv-skel" style={{ width: w, height: 31, borderRadius: "9px", background: C.cardSub, border: `1px solid ${C.border}` }} />
            ))}
          </div>
        ) : racks.length > 0 ? (
        <div style={{ marginBottom: "10px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {racks.map((r) => {
              const on = expandedRack === r;
              return (
                <button
                  key={r}
                  onClick={() => setExpandedRack(on ? null : r)}
                  style={{
                    display: "flex", alignItems: "center", gap: "4px",
                    padding: "7px 12px", borderRadius: "9px", cursor: "pointer",
                    border: `1px solid ${on ? C.accent : C.border}`,
                    background: on ? C.accent : C.card, color: on ? "#fff" : C.text,
                    fontSize: "12px", fontWeight: 800, fontFamily: "monospace",
                  }}
                >
                  {r}랙 {on ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
              );
            })}
          </div>
          {expandedRack ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "8px", padding: "10px", borderRadius: "10px", background: C.cardSub, border: `1px solid ${C.border}` }}>
              {(slotsByRack[expandedRack] || []).length === 0 ? (
                <span style={{ fontSize: "11.5px", color: C.label }}>이 랙에는 등록된 물품이 없습니다.</span>
              ) : (
                (slotsByRack[expandedRack] || []).map((slot) => (
                  <button
                    key={slot}
                    onClick={() => { scrollToGroup(slot); setExpandedRack(null); }}
                    style={{
                      padding: "6px 10px", borderRadius: "7px", cursor: "pointer",
                      border: `1px solid ${C.border}`, background: C.card, color: C.text,
                      fontSize: "11.5px", fontWeight: 700, fontFamily: "monospace",
                    }}
                  >
                    {slot}
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>
        ) : null}

        {/* 상단 컨트롤 */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap", alignItems: "center", paddingBottom: "10px" }}>
          <div style={{ position: "relative", flex: "1 1 0%", minWidth: "200px" }}>
            <Search size={15} style={{ position: "absolute", left: "11px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="물품명 · 위치 · 규격 검색..." style={inputStyle} />
          </div>
        <button onClick={toggleAll} style={{ padding: "9px 14px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.card, color: C.label, cursor: "pointer", fontSize: "12px", fontWeight: 700, whiteSpace: "nowrap" }}>
          {allCollapsed ? "모두 펼치기" : "모두 접기"}
        </button>
        {isAdmin && onManageSets ? (
          <button onClick={onManageSets} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "9px 14px", borderRadius: "10px", border: "none", background: C.accent, color: "#fff", cursor: "pointer", fontSize: "12px", fontWeight: 700, whiteSpace: "nowrap" }}>
            <PackageOpen size={13} /> 세트 관리
          </button>
        ) : null}
        {isAdmin && onBulkMoveLocation ? (
          <button
            onClick={toggleSelectMode}
            style={{
              display: "flex", alignItems: "center", gap: "6px", padding: "9px 14px", borderRadius: "10px", cursor: "pointer",
              border: `1px solid ${selectMode ? C.accent : C.border}`, background: selectMode ? C.accentSoft : C.card,
              color: selectMode ? C.accentText : C.label, fontSize: "12px", fontWeight: 700, whiteSpace: "nowrap",
            }}
          >
            {selectMode ? <X size={13} /> : <CheckSquare size={13} />} {selectMode ? "선택 취소" : "선택해서 위치 이동"}
          </button>
        ) : null}
        {isAdmin && onToggleArchive ? (
          <button
            onClick={() => setShowArchived((v) => !v)}
            title={showArchived ? "보관함 닫기" : "보관함 열기 (사용 불가 등으로 치워둔 물품)"}
            style={{
              display: "flex", alignItems: "center", gap: "6px", padding: "9px 14px", borderRadius: "10px", cursor: "pointer",
              border: `1px solid ${showArchived ? C.accent : C.border}`, background: showArchived ? C.accentSoft : C.card,
              color: showArchived ? C.accentText : C.label, fontSize: "12px", fontWeight: 700, whiteSpace: "nowrap",
            }}
          >
            <Archive size={13} /> 보관함{archivedCount > 0 ? ` (${archivedCount})` : ""}
          </button>
        ) : null}
        {onRefresh ? (
          <>
            <style>{`@keyframes rgvSpin { to { transform: rotate(360deg); } } .rgv-spin { animation: rgvSpin 0.9s linear infinite; }`}</style>
            <button onClick={onRefresh} disabled={refreshing} title="지금 새로고침" style={{ display: "flex", alignItems: "center", padding: "9px 12px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.card, color: C.accentText, cursor: refreshing ? "wait" : "pointer", opacity: refreshing ? 0.7 : 1 }}>
              <RotateCcw size={14} className={refreshing ? "rgv-spin" : undefined} />
            </button>
          </>
        ) : null}
        <span style={{ fontSize: "12px", color: C.label, whiteSpace: "nowrap" }}>{visibleGroups.length}개 슬롯 · {totalShown}개 물품</span>
        </div>
      </div>

      {visibleGroups.length === 0 ? (
        <div style={{ textAlign: "center", padding: "64px 0", color: C.label }}>
          <Package size={36} style={{ color: C.border, marginBottom: "8px" }} />
          <div>{search.trim() ? "검색 결과가 없습니다." : "표시할 공구 및 부품류가 없습니다."}</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {visibleGroups.map(([groupKey, items], idx) => {
            const isCollapsed = !!collapsed[groupKey];
            const isHighlighted = highlightKey === groupKey;
            const cluster = groupClusterInfo[idx];
            return (
              <React.Fragment key={groupKey}>
                {cluster?.isNewRack && !hideLocation ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", margin: "6px 2px -6px" }}>
                    <span style={{ fontSize: "11px", fontWeight: 800, color: C.label, fontFamily: "monospace" }}>{cluster.rack}랙</span>
                    <div style={{ flex: 1, height: "1px", background: C.border }} />
                  </div>
                ) : null}
                <section
                  ref={(el) => { groupRefs.current[groupKey] = el; }}
                  className={isHighlighted ? "wms-slot-highlight" : undefined}
                  style={{ border: `1px solid ${C.border}`, borderRadius: "14px", background: C.card, overflow: "hidden", boxShadow: "var(--shadow-sm)" }}
                >
                {/* 그룹 헤더 */}
                <div
                  onClick={() => toggle(groupKey)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: "10px", padding: "13px 16px",
                    background: C.cardSub, border: "none", borderBottom: isCollapsed ? "none" : `1px solid ${C.border}`,
                    cursor: "pointer", color: C.text, boxSizing: "border-box",
                  }}
                >
                  {isCollapsed ? <ChevronRight size={17} style={{ color: C.label }} /> : <ChevronDown size={17} style={{ color: C.label }} />}
                  <span style={{ width: 30, height: 30, borderRadius: "8px", background: C.accentSoft, color: C.accentText, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "10px", flexShrink: 0, fontFamily: "monospace" }}><MapPin size={14} /></span>
                  <span style={{ fontWeight: 800, fontSize: "15px", flex: 1, textAlign: "left", fontFamily: "monospace" }}>{hideLocation ? `보관 구역 ${idx + 1}` : groupKey}</span>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: C.accentText, background: C.accentSoft, borderRadius: "20px", padding: "3px 11px" }}>{items.length}개</span>
                  {isAdmin && onAddItem ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation(); // 헤더 접기와 겹치지 않게
                        onAddItem(groupKey);
                      }}
                      title={`${groupKey}에 새 물품 추가`}
                      style={{
                        display: "flex", alignItems: "center", gap: "4px", flexShrink: 0,
                        padding: "5px 11px", borderRadius: "8px", cursor: "pointer",
                        border: `1px solid ${C.accent}`, background: C.card, color: C.accentText,
                        fontSize: "11.5px", fontWeight: 700,
                      }}
                    >
                      <Plus size={13} /> 물품 추가
                    </button>
                  ) : null}
                </div>

                {/* 물품 그리드 */}
                {!isCollapsed ? (
                  <div style={{ padding: "16px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "16px" }}>
                    {items.map((it) => {
                      const img = it.photo ? getThumbImageUrl(it.photo) : "";
                      const slidePhotos = [img, ...(extraPhotosMap[String(it.rowIndex)] || [])].filter(Boolean) as string[];
                      const isSelected = selectedRows.has(it.rowIndex);
                      return (
                        <div
                          key={it.rowIndex}
                          onClick={() => { if (selectMode) toggleRowSelected(it.rowIndex); else if (isAdmin) onEditItem(it); }}
                          style={{
                            position: "relative", borderRadius: "14px", overflow: "hidden", background: C.cardSub,
                            display: "flex", flexDirection: "column", cursor: (selectMode || isAdmin) ? "pointer" : "default",
                            transition: "box-shadow 0.15s ease, border-color 0.15s ease",
                            border: `1px solid ${isSelected ? C.accent : C.border}`,
                            boxShadow: isSelected ? `0 0 0 2px ${C.accent}33` : undefined,
                          }}
                        >
                          {selectMode ? (
                            <div style={{ position: "absolute", top: "8px", left: "8px", zIndex: 2, width: 26, height: 26, borderRadius: "7px", background: isSelected ? C.accent : "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
                              {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                            </div>
                          ) : null}
                          <div onClick={(e) => { e.stopPropagation(); if (selectMode) { toggleRowSelected(it.rowIndex); return; } img && onImageClick && onImageClick(img); }} style={{ height: "150px", background: C.card, display: "flex", alignItems: "center", justifyContent: "center", cursor: img ? "zoom-in" : "default", borderBottom: `1px solid ${C.border}` }}>
                            {slidePhotos.length > 0 ? <ItemThumbnailSlideshow photos={slidePhotos} referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Boxes size={40} style={{ color: C.border }} />}
                          </div>
                          <div style={{ padding: "13px 14px", flex: 1, display: "flex", flexDirection: "column", gap: "7px" }}>
                            <div style={{ fontWeight: 700, fontSize: "14px", lineHeight: 1.4, wordBreak: "break-word", color: C.text }}>{it.name}</div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", alignItems: "center" }}>
                              {!hideLocation ? <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", fontWeight: 700, color: C.warn, background: C.warnSoft, borderRadius: "6px", padding: "3px 8px", fontFamily: "monospace" }}><MapPin size={11} />{it.location}</span> : null}
                              <span style={{ fontSize: "11px", fontWeight: 700, color: C.accentText, background: C.accentSoft, borderRadius: "6px", padding: "3px 8px" }}>재고 {stockNum(it.stock)}</span>
                            </div>
                            {!selectMode ? (
                              <>
                                <div style={{ marginTop: "auto", display: "flex", gap: "6px" }} onClick={(e) => e.stopPropagation()}>
                                  {it.link ? (
                                    <a
                                      href={it.link}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      title="새 탭에서 제품 링크 열기"
                                      style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "5px", padding: "9px", borderRadius: "9px", border: `1px solid ${C.accent}`, background: C.accentSoft, color: C.accentText, fontSize: "12px", fontWeight: 700, textDecoration: "none" }}
                                    >
                                      <ExternalLink size={13} /> 링크 열기
                                    </a>
                                  ) : null}
                                  {isAdmin ? (
                                    <button onClick={() => onEditItem(it)} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "5px", padding: "9px", borderRadius: "9px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", fontSize: "12px", fontWeight: 700 }}>
                                      <Pencil size={13} /> 편집
                                    </button>
                                  ) : null}
                                </div>
                                {isAdmin && onAdjustStock ? (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); onAdjustStock(it); }}
                                    style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "5px", padding: "9px", borderRadius: "9px", border: "none", background: C.accentSoft, color: C.accentText, cursor: "pointer", fontSize: "12px", fontWeight: 700 }}
                                  >
                                    <ArrowUpDown size={13} /> 재고 변경
                                  </button>
                                ) : null}
                                {isAdmin && onToggleArchive ? (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); onToggleArchive(it); }}
                                    title={it.archived ? "보관함에서 꺼내기" : "보관 처리 (사용 불가 등으로 목록·대여 카탈로그에서 제외)"}
                                    style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "5px", padding: "9px", borderRadius: "9px", border: "none", background: it.archived ? C.successSoft : C.warnSoft, color: it.archived ? C.success : C.warn, cursor: "pointer", fontSize: "12px", fontWeight: 700 }}
                                  >
                                    {it.archived ? <><ArchiveRestore size={13} /> 보관함에서 꺼내기</> : <><Archive size={13} /> 보관 처리</>}
                                  </button>
                                ) : null}
                                {isAdmin && onDeleteItem ? (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); onDeleteItem(it); }}
                                    title={`${it.name} 삭제`}
                                    style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "5px", padding: "9px", borderRadius: "9px", border: "none", background: C.errorSoft, color: C.error, cursor: "pointer", fontSize: "12px", fontWeight: 700 }}
                                  >
                                    <Trash2 size={13} /> 삭제
                                  </button>
                                ) : null}
                              </>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </section>
              </React.Fragment>
            );
          })}
        </div>
      )}
      <ScrollToTopButton />

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
            style={{ width: "min(380px, 100%)", background: C.card, border: `1px solid ${C.border}`, borderRadius: "14px", padding: "20px" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
              <Move size={17} style={{ color: C.accentText }} />
              <span style={{ fontSize: "15px", fontWeight: 800, color: C.text, flex: 1 }}>위치 이동</span>
              <button onClick={() => setMoveModalOpen(false)} style={{ background: "transparent", border: "none", color: C.label, cursor: "pointer" }}><X size={18} /></button>
            </div>
            <div style={{ fontSize: "12.5px", color: C.label, marginBottom: "12px" }}>
              선택한 <b style={{ color: C.accentText }}>{selectedRows.size}개</b> 물품을 아래 위치로 한 번에 옮깁니다.
            </div>
            <input
              value={moveTarget}
              onChange={(e) => setMoveTarget(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirmBulkMove(); }}
              placeholder="예: A-01"
              autoFocus
              style={{ width: "100%", padding: "11px 13px", fontSize: "14px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.text, outline: "none", boxSizing: "border-box", marginBottom: "16px" }}
            />
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
