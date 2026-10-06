import React, { useEffect, useMemo, useState } from "react";
import { InventoryItem } from "../types";
import {
  parseToolLocation, buildToolLocation, formatToolLocation, compareToolLocation,
  sectionRows, rowLabels, clampSections, DEFAULT_SECTIONS, MAX_SECTIONS, levelCodes,
} from "../utils/toolLocation";

/**
 * 공구 보관 위치 고르기: 랙을 고르고, 그 랙의 구역 수(1~9)를 정한 뒤 배치 그림에서 구역을 누른다.
 * 구역 수는 랙 단위 설정이라 여기서 바꾸면 onSectionsChange로 알려주고, 저장할 때 함께 반영한다.
 */
export default function ToolLocationPicker({ value, onChange, inventory, sections, onSectionsChange, rackLevels = {}, isLightMode }: {
  value: string;
  onChange: (loc: string) => void;
  inventory: InventoryItem[];
  /** 랙별 구역 수 { "F-02": 7 } — 없으면 3 */
  sections: Record<string, number>;
  onSectionsChange: (rack: string, count: number) => void;
  /** 랙별 층 수 { "F": 5 } — 아직 물품이 없는 층도 목록에 넣는다 */
  rackLevels?: Record<string, number>;
  isLightMode: boolean;
}) {
  const C = {
    card: isLightMode ? "#ffffff" : "#0f172a",
    sub: isLightMode ? "#f4f6f9" : "#111a2c",
    border: isLightMode ? "#dfe3ea" : "#2a3650",
    text: isLightMode ? "#111827" : "#f1f5f9",
    label: isLightMode ? "#626c7d" : "#94a3b8",
    accent: "#2563eb",
    accentSoft: isLightMode ? "rgba(37,99,235,0.10)" : "rgba(96,165,250,0.18)",
    accentText: isLightMode ? "#1d4ed8" : "#93c5fd",
    warn: isLightMode ? "#b45309" : "#fbbf24",
  };
  const p = parseToolLocation(value);
  const [manual, setManual] = useState(false);

  // 이미 쓰고 있는 랙 목록 (재고 목록에서 뽑는다)
  const rackList = useMemo(() => {
    const set = new Set<string>();
    inventory.forEach((it) => { const r = parseToolLocation(it.location).rack; if (r) set.add(r); });
    Object.entries(rackLevels).forEach(([g, n]) => levelCodes(g, Number(n)).forEach((c) => set.add(c)));
    return Array.from(set).sort((a, b) => compareToolLocation(a, b));
  }, [inventory, rackLevels]);
  const emptyRacks = useMemo(() => {
    const used = new Set(inventory.map((it) => parseToolLocation(it.location).rack));
    return new Set(rackList.filter((r) => !used.has(r)));
  }, [inventory, rackList]);
  const [newRackMode, setNewRackMode] = useState(false);
  // 목록에 없는 랙 코드면 입력 칸으로 보여준다. 층 수 설정이 늦게 도착해 목록에 들어오면 다시 선택 칸으로 바뀐다.
  const newRack = newRackMode || (!!p.rack && !rackList.includes(p.rack));

  const count = p.rack ? clampSections(sections[p.rack] ?? DEFAULT_SECTIONS) : DEFAULT_SECTIONS;
  // 숫자 칸은 지우고 다시 칠 수 있게 글자로 따로 들고 있다가, 1~9가 되면 반영한다.
  const [countText, setCountText] = useState(String(count));
  useEffect(() => { setCountText(String(count)); }, [p.rack, count]);
  const rows = sectionRows(count);
  const labels = rowLabels(rows.length);
  const outOfRange = useMemo(
    () => (p.rack ? inventory.filter((it) => { const q = parseToolLocation(it.location); return q.rack === p.rack && (q.section ?? 0) > count; }).length : 0),
    [inventory, p.rack, count],
  );

  function applyCount(n: number) {
    if (!p.rack) return;
    const next = clampSections(n);
    onSectionsChange(p.rack, next);
    // 고른 구역이 줄어든 범위를 벗어나면 구역 미정으로 되돌린다.
    if (p.section && p.section > next) onChange(buildToolLocation(p.rack, null));
  }

  const input: React.CSSProperties = {
    padding: "10px 12px", fontSize: "14px", borderRadius: "10px", border: `1px solid ${C.border}`,
    background: C.card, color: C.text, outline: "none", boxSizing: "border-box", width: "100%",
  };
  const chip = (on: boolean): React.CSSProperties => ({
    padding: "6px 10px", borderRadius: "8px", cursor: "pointer", fontSize: "12px", fontWeight: 700,
    border: `1px solid ${on ? C.accent : C.border}`, background: on ? C.accentSoft : C.card, color: on ? C.accentText : C.label,
  });
  const stepBtn: React.CSSProperties = { width: 34, height: 34, borderRadius: "8px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", fontSize: "16px", fontWeight: 800 };

  if (manual) {
    return (
      <div>
        <input className="mono" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} placeholder="예: F-02-5" style={{ ...input, fontFamily: "monospace" }} />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "6px", fontSize: "12px", color: C.label }}>
          <span>{value ? formatToolLocation(value) : "랙-구역 (예: F-02, F-02-5)"}</span>
          <button type="button" onClick={() => setManual(false)} style={{ ...chip(false), padding: "3px 8px" }}>그림으로 고르기</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {newRack ? (
        <div style={{ display: "flex", gap: "8px" }}>
          <input className="mono" value={p.rack} onChange={(e) => onChange(buildToolLocation(e.target.value.replace(/[^A-Za-z0-9-]/g, "").toUpperCase(), null))} placeholder="새 랙 코드 (예: L-01)" style={{ ...input, fontFamily: "monospace" }} autoFocus />
          {rackList.length ? <button type="button" onClick={() => { setNewRackMode(false); onChange(""); }} style={{ ...chip(false), flexShrink: 0 }}>목록에서 고르기</button> : null}
        </div>
      ) : (
        <select value={p.rack} onChange={(e) => { if (e.target.value === "__new") { setNewRackMode(true); onChange(""); } else onChange(buildToolLocation(e.target.value, null)); }} style={input}>
          <option value="">랙 선택</option>
          {rackList.map((r) => <option key={r} value={r}>{r}{emptyRacks.has(r) ? " (비어 있음)" : ""}</option>)}
          <option value="__new">+ 새 랙</option>
        </select>
      )}

      {p.rack ? (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: "12px", padding: "12px", background: C.sub }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "12.5px", fontWeight: 800, color: C.text }}>구역 수</span>
            <button type="button" aria-label="구역 수 줄이기" onClick={() => applyCount(count - 1)} disabled={count <= 1} style={{ ...stepBtn, opacity: count <= 1 ? 0.4 : 1 }}>−</button>
            <input
              type="text" inputMode="numeric" aria-label="구역 수 (1~9)"
              value={countText}
              onChange={(e) => {
                const t = e.target.value.replace(/\D/g, "").slice(-1);
                setCountText(t);
                if (t && Number(t) >= 1) applyCount(Number(t));
              }}
              onFocus={(e) => e.target.select()}
              onBlur={() => setCountText(String(count))}
              style={{ width: 52, height: 34, textAlign: "center", borderRadius: "8px", border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: "15px", fontWeight: 800, boxSizing: "border-box" }}
            />
            <button type="button" aria-label="구역 수 늘리기" onClick={() => applyCount(count + 1)} disabled={count >= MAX_SECTIONS} style={{ ...stepBtn, opacity: count >= MAX_SECTIONS ? 0.4 : 1 }}>+</button>
            <span style={{ fontSize: "11.5px", color: C.label }}>1~9 · 이 랙 전체에 적용</span>
            <span style={{ flex: 1 }} />
            <button type="button" onClick={() => onChange(buildToolLocation(p.rack, null))} style={chip(!p.section)}>구역 미정</button>
          </div>

          {/* 뒤쪽 줄이 위, 앞줄(통로 쪽)이 아래에 오도록 거꾸로 쌓는다. */}
          <div style={{ display: "flex", flexDirection: "column-reverse", gap: "5px" }}>
            {rows.map((row, ri) => (
              <div key={ri} style={{ display: "grid", gridTemplateColumns: `${rows.length > 1 ? "44px " : ""}repeat(${rows[0].length}, 1fr)`, gap: "5px" }}>
                {rows.length > 1 ? <span style={{ fontSize: "11.5px", color: C.label, alignSelf: "center" }}>{labels[ri]}</span> : null}
                {row.map((n) => {
                  const on = p.section === n;
                  return (
                    <button key={n} type="button" onClick={() => onChange(buildToolLocation(p.rack, n))}
                      style={{
                        padding: rows.length >= 3 ? "9px 0" : "12px 0", borderRadius: "8px", cursor: "pointer", fontSize: "13px", fontWeight: 800,
                        border: `${on ? 2 : 1}px solid ${on ? C.accent : C.border}`, background: on ? C.accentSoft : C.card, color: on ? C.accentText : C.label,
                      }}>
                      {n}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div style={{ textAlign: "center", fontSize: "11px", color: C.label, marginTop: "6px" }}>앞 (통로 쪽) · 랙 정면에서 본 방향</div>
          {outOfRange > 0 ? (
            <div style={{ marginTop: "8px", fontSize: "11.5px", fontWeight: 700, color: C.warn }}>
              이 랙에서 {count}구역보다 번호가 큰 구역에 놓인 물품이 {outOfRange}개 있습니다. 그 물품들은 구역을 다시 지정해주세요.
            </div>
          ) : null}
        </div>
      ) : null}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", fontSize: "12.5px" }}>
        <span style={{ color: C.text }}>
          <span className="mono" style={{ fontFamily: "monospace", fontWeight: 800, marginRight: "8px" }}>{value || "—"}</span>
          <span style={{ color: C.label }}>{value ? formatToolLocation(value) : "위치를 골라주세요"}</span>
        </span>
        <button type="button" onClick={() => setManual(true)} style={{ ...chip(false), padding: "3px 8px" }}>코드 직접 입력</button>
      </div>
    </div>
  );
}

/** 목록 행에 붙이는 작은 배치 그림. 칠해진 칸이 이 물품의 구역이다. */
export function SectionMiniMap({ location, sections, isLightMode }: { location: string; sections: number; isLightMode: boolean }) {
  const p = parseToolLocation(location);
  const rows = sectionRows(sections);
  const on = isLightMode ? "#2563eb" : "#60a5fa";
  const off = isLightMode ? "#dfe3ea" : "#334155";
  const h = rows.length === 1 ? 8 : rows.length === 2 ? 5 : 4;
  return (
    <span aria-hidden="true" style={{ display: "inline-flex", flexDirection: "column-reverse", gap: "1.5px", verticalAlign: "middle" }}>
      {rows.map((row, ri) => (
        <span key={ri} style={{ display: "flex", gap: "1.5px" }}>
          {row.map((n) => <span key={n} style={{ width: 6, height: h, borderRadius: 1.5, background: p.section === n ? on : off }} />)}
        </span>
      ))}
    </span>
  );
}
