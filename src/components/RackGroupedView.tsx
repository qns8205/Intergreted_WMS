import React, { useState, useMemo } from "react";
import { InventoryItem } from "../types";
import { parseLocation, getGoogleDriveImageUrl } from "../utils/drive";
import { compareRackSlot } from "../utils/borrowApi";
import { smartMatch } from "../utils/search";
import { ChevronDown, ChevronRight, Search, Package, Pencil, MapPin, Boxes, ExternalLink, LayoutGrid, Rows3, ArrowUpDown } from "lucide-react";

interface Props {
  inventory: InventoryItem[];
  isLightMode: boolean;
  isAdmin: boolean;
  onEditItem: (item: InventoryItem) => void;
  onAdjustStock?: (item: InventoryItem) => void;
  onImageClick?: (url: string) => void;
}

export default function RackGroupedView({ inventory, isLightMode, isAdmin, onEditItem, onAdjustStock, onImageClick }: Props) {
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
  };

  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [groupMode, setGroupMode] = useState<"rack" | "slot">("rack"); // 랙 단위 vs 슬롯(정확한 위치) 단위

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const map = new Map<string, InventoryItem[]>();
    inventory.forEach((it) => {
      if (q) {
        if (!smartMatch([it.name, it.location, it.spec, it.keywords], q)) return;
      }
      let key: string;
      if (groupMode === "rack") {
        const { rack } = parseLocation(it.location);
        key = rack || "미지정";
      } else {
        // 슬롯 단위: 정확한 위치(랙-슬롯) 하나하나를 그룹으로
        key = (it.location || "").trim().toUpperCase() || "미지정";
      }
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    });
    // 랙/슬롯 이름 오름차순 정렬 (슬롯 단위는 랙-슬롯 순서 비교 함수 재사용)
    const entries = Array.from(map.entries()).sort((a, b) =>
      groupMode === "rack" ? a[0].localeCompare(b[0]) : compareRackSlot(a[0], b[0])
    );
    entries.forEach(([, items]) => items.sort((a, b) => compareRackSlot(a.location, b.location)));
    return entries;
  }, [inventory, search, groupMode]);

  const totalShown = groups.reduce((n, [, items]) => n + items.length, 0);
  const allCollapsed = groups.length > 0 && groups.every(([rack]) => collapsed[rack]);

  function toggle(rack: string) {
    setCollapsed((p) => ({ ...p, [rack]: !p[rack] }));
  }
  function toggleAll() {
    if (allCollapsed) setCollapsed({});
    else { const next: Record<string, boolean> = {}; groups.forEach(([rack]) => (next[rack] = true)); setCollapsed(next); }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "9px 12px 9px 34px", fontSize: "13px", borderRadius: "10px",
    border: `1px solid ${C.border}`, background: C.card, color: C.text, outline: "none",
  };

  function stockNum(s: InventoryItem["stock"]): string {
    if (s === null || s === undefined || s === "") return "-";
    return String(s);
  }

  return (
    <div>
      {/* 상단 컨트롤 */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: "1 1 260px", minWidth: 0 }}>
          <Search size={15} style={{ position: "absolute", left: "11px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="물품명 · 위치 · 규격 검색..." style={inputStyle} />
        </div>
        <div style={{ display: "flex", border: `1px solid ${C.border}`, borderRadius: "10px", overflow: "hidden", flexShrink: 0 }}>
          <button
            onClick={() => setGroupMode("rack")}
            title="랙 단위로 그룹화"
            style={{ display: "flex", alignItems: "center", gap: "5px", padding: "9px 12px", border: "none", background: groupMode === "rack" ? C.accent : C.card, color: groupMode === "rack" ? "#fff" : C.label, cursor: "pointer", fontSize: "12px", fontWeight: 700 }}
          >
            <LayoutGrid size={13} /> 랙 단위
          </button>
          <button
            onClick={() => setGroupMode("slot")}
            title="슬롯(정확한 위치) 단위로 그룹화"
            style={{ display: "flex", alignItems: "center", gap: "5px", padding: "9px 12px", border: "none", borderLeft: `1px solid ${C.border}`, background: groupMode === "slot" ? C.accent : C.card, color: groupMode === "slot" ? "#fff" : C.label, cursor: "pointer", fontSize: "12px", fontWeight: 700 }}
          >
            <Rows3 size={13} /> 슬롯 단위
          </button>
        </div>
        <button onClick={toggleAll} style={{ padding: "9px 14px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.card, color: C.label, cursor: "pointer", fontSize: "12px", fontWeight: 700, whiteSpace: "nowrap" }}>
          {allCollapsed ? "모두 펼치기" : "모두 접기"}
        </button>
        <span style={{ fontSize: "12px", color: C.label, whiteSpace: "nowrap" }}>{groups.length}개 {groupMode === "rack" ? "랙" : "슬롯"} · {totalShown}개 물품</span>
      </div>

      {groups.length === 0 ? (
        <div style={{ textAlign: "center", padding: "64px 0", color: C.label }}>
          <Package size={36} style={{ color: C.border, marginBottom: "8px" }} />
          <div>{search ? "검색 결과가 없습니다." : "표시할 공구 및 부품류가 없습니다."}</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {groups.map(([groupKey, items]) => {
            const isCollapsed = !!collapsed[groupKey];
            return (
              <section key={groupKey} style={{ border: `1px solid ${C.border}`, borderRadius: "14px", background: C.card, overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
                {/* 그룹 헤더 */}
                <button
                  onClick={() => toggle(groupKey)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: "10px", padding: "13px 16px",
                    background: C.cardSub, border: "none", borderBottom: isCollapsed ? "none" : `1px solid ${C.border}`,
                    cursor: "pointer", color: C.text,
                  }}
                >
                  {isCollapsed ? <ChevronRight size={17} style={{ color: C.label }} /> : <ChevronDown size={17} style={{ color: C.label }} />}
                  <span style={{ width: 30, height: 30, borderRadius: "8px", background: C.accentSoft, color: C.accentText, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: groupMode === "rack" ? "13px" : "10px", flexShrink: 0, fontFamily: groupMode === "slot" ? "monospace" : "inherit" }}>{groupMode === "rack" ? groupKey : <MapPin size={14} />}</span>
                  <span style={{ fontWeight: 800, fontSize: "15px", flex: 1, textAlign: "left", fontFamily: groupMode === "slot" ? "monospace" : "inherit" }}>{groupMode === "rack" ? `${groupKey}랙` : groupKey}</span>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: C.accentText, background: C.accentSoft, borderRadius: "20px", padding: "3px 11px" }}>{items.length}개</span>
                </button>

                {/* 물품 그리드 */}
                {!isCollapsed ? (
                  <div style={{ padding: "16px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "16px" }}>
                    {items.map((it) => {
                      const img = it.photo ? getGoogleDriveImageUrl(it.photo) : "";
                      return (
                        <div
                          key={it.rowIndex}
                          onClick={() => isAdmin && onEditItem(it)}
                          style={{ border: `1px solid ${C.border}`, borderRadius: "14px", overflow: "hidden", background: C.cardSub, display: "flex", flexDirection: "column", cursor: isAdmin ? "pointer" : "default", transition: "box-shadow 0.15s ease" }}
                        >
                          <div onClick={(e) => { e.stopPropagation(); img && onImageClick && onImageClick(img); }} style={{ height: "150px", background: C.card, display: "flex", alignItems: "center", justifyContent: "center", cursor: img ? "zoom-in" : "default", borderBottom: `1px solid ${C.border}` }}>
                            {img ? <img src={img} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Boxes size={40} style={{ color: C.border }} />}
                          </div>
                          <div style={{ padding: "13px 14px", flex: 1, display: "flex", flexDirection: "column", gap: "7px" }}>
                            <div style={{ fontWeight: 700, fontSize: "14px", lineHeight: 1.4, wordBreak: "break-word", color: C.text }}>{it.name}</div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", alignItems: "center" }}>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", fontWeight: 700, color: C.warn, background: C.warnSoft, borderRadius: "6px", padding: "3px 8px", fontFamily: "monospace" }}><MapPin size={11} />{it.location}</span>
                              <span style={{ fontSize: "11px", fontWeight: 700, color: C.accentText, background: C.accentSoft, borderRadius: "6px", padding: "3px 8px" }}>재고 {stockNum(it.stock)}</span>
                            </div>
                            <div style={{ marginTop: "auto", display: "flex", gap: "6px" }} onClick={(e) => e.stopPropagation()}>
                              {it.link ? (
                                <a
                                  href={it.link}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{ flex: isAdmin ? "0 0 auto" : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "5px", padding: "9px", borderRadius: "9px", border: `1px solid ${C.border}`, background: C.card, color: C.accentText, fontSize: "12px", fontWeight: 700, textDecoration: "none" }}
                                >
                                  <ExternalLink size={13} /> {isAdmin ? "" : "링크 열기"}
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
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
