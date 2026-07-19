import React, { useState, useMemo } from "react";
import { InventoryItem } from "../types";
import { parseLocation, getGoogleDriveImageUrl } from "../utils/drive";
import { compareRackSlot } from "../utils/borrowApi";
import { smartMatch } from "../utils/search";
import { ChevronDown, ChevronRight, Search, Package, Pencil, MapPin, Boxes } from "lucide-react";

interface Props {
  inventory: InventoryItem[];
  isLightMode: boolean;
  isAdmin: boolean;
  onEditItem: (item: InventoryItem) => void;
  onImageClick?: (url: string) => void;
}

export default function RackGroupedView({ inventory, isLightMode, isAdmin, onEditItem, onImageClick }: Props) {
  const C = {
    card: isLightMode ? "#fbfcfd" : "#262a33",
    cardSub: isLightMode ? "#eef1f4" : "#1e2128",
    border: isLightMode ? "#dfe3e9" : "#333844",
    text: isLightMode ? "#23272f" : "#e8eaed",
    label: isLightMode ? "#6b7280" : "#9aa0aa",
    accent: "#2563eb",
    accentSoft: isLightMode ? "rgba(37,99,235,0.09)" : "rgba(148,163,184,0.14)",
    accentText: isLightMode ? "#3f4756" : "#c2c7d0",
    warn: isLightMode ? "#b45309" : "#fbbf24",
    warnSoft: "rgba(245,158,11,0.12)",
  };

  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const map = new Map<string, InventoryItem[]>();
    inventory.forEach((it) => {
      if (q) {
        if (!smartMatch([it.name, it.location, it.spec, it.keywords], q)) return;
      }
      const { rack } = parseLocation(it.location);
      const key = rack || "미지정";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    });
    // 랙 이름 오름차순, 각 그룹 내부는 슬롯 순
    const entries = Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    entries.forEach(([, items]) => items.sort((a, b) => compareRackSlot(a.location, b.location)));
    return entries;
  }, [inventory, search]);

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
        <button onClick={toggleAll} style={{ padding: "9px 14px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.card, color: C.label, cursor: "pointer", fontSize: "12px", fontWeight: 700, whiteSpace: "nowrap" }}>
          {allCollapsed ? "모두 펼치기" : "모두 접기"}
        </button>
        <span style={{ fontSize: "12px", color: C.label, whiteSpace: "nowrap" }}>{groups.length}개 랙 · {totalShown}개 물품</span>
      </div>

      {groups.length === 0 ? (
        <div style={{ textAlign: "center", padding: "64px 0", color: C.label }}>
          <Package size={36} style={{ color: C.border, marginBottom: "8px" }} />
          <div>{search ? "검색 결과가 없습니다." : "표시할 창고 물품이 없습니다."}</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {groups.map(([rack, items]) => {
            const isCollapsed = !!collapsed[rack];
            return (
              <section key={rack} style={{ border: `1px solid ${C.border}`, borderRadius: "16px", background: C.card, overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
                {/* 랙 헤더 */}
                <button
                  onClick={() => toggle(rack)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: "10px", padding: "13px 16px",
                    background: C.cardSub, border: "none", borderBottom: isCollapsed ? "none" : `1px solid ${C.border}`,
                    cursor: "pointer", color: C.text,
                  }}
                >
                  {isCollapsed ? <ChevronRight size={17} style={{ color: C.label }} /> : <ChevronDown size={17} style={{ color: C.label }} />}
                  <span style={{ width: 30, height: 30, borderRadius: "8px", background: C.accentSoft, color: C.accentText, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "13px", flexShrink: 0 }}>{rack}</span>
                  <span style={{ fontWeight: 800, fontSize: "15px", flex: 1, textAlign: "left" }}>{rack}랙</span>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: C.accentText, background: C.accentSoft, borderRadius: "20px", padding: "3px 11px" }}>{items.length}개</span>
                </button>

                {/* 물품 그리드 */}
                {!isCollapsed ? (
                  <div style={{ padding: "14px 16px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "12px" }}>
                    {items.map((it) => {
                      const img = it.photo ? getGoogleDriveImageUrl(it.photo) : "";
                      return (
                        <div key={it.rowIndex} style={{ border: `1px solid ${C.border}`, borderRadius: "12px", overflow: "hidden", background: C.card, display: "flex", flexDirection: "column", boxShadow: "var(--raise-sm)" }}>
                          <div onClick={() => img && onImageClick && onImageClick(img)} style={{ height: "104px", background: C.card, display: "flex", alignItems: "center", justifyContent: "center", cursor: img ? "zoom-in" : "default", borderBottom: `1px solid ${C.border}` }}>
                            {img ? <img src={img} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Boxes size={28} style={{ color: C.border }} />}
                          </div>
                          <div style={{ padding: "9px 11px", flex: 1, display: "flex", flexDirection: "column", gap: "5px" }}>
                            <div style={{ fontWeight: 700, fontSize: "12.5px", lineHeight: 1.35, wordBreak: "break-word", color: C.text }}>{it.name}</div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", alignItems: "center" }}>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: "3px", fontSize: "10px", fontWeight: 700, color: C.warn, background: C.warnSoft, borderRadius: "5px", padding: "2px 6px", fontFamily: "monospace" }}><MapPin size={10} />{it.location}</span>
                              <span style={{ fontSize: "10px", fontWeight: 700, color: C.accentText, background: C.accentSoft, borderRadius: "5px", padding: "2px 6px" }}>재고 {stockNum(it.stock)}</span>
                            </div>
                            {isAdmin ? (
                              <button onClick={() => onEditItem(it)} style={{ marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "center", gap: "4px", padding: "6px", borderRadius: "8px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", fontSize: "11px", fontWeight: 700 }}>
                                <Pencil size={12} /> 편집
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
