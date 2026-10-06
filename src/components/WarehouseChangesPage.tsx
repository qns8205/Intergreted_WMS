import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, History, RefreshCw, Search } from "lucide-react";
import { fetchWarehouseRecentChanges, WarehouseRecentChange } from "../utils/borrowApi";
import { KIND_LABEL, relativeTime } from "../utils/warehouseChanges";

interface Props {
  scriptUrl: string;
  isLightMode: boolean;
  /** COS 물품 목록으로 돌아간다. */
  onBack: () => void;
}

const PERIODS: { hours: number; label: string }[] = [
  { hours: 48, label: "최근 48시간" },
  { hours: 72, label: "3일" },
  { hours: 168, label: "7일" },
];
const KINDS = ["stock", "created", "updated", "deleted", "borrow", "return", "consume"] as const;
// 서버가 받아줄 수 있는 최대치. 7일치가 이보다 많으면 오래된 것부터 잘리므로 화면에 알려준다.
const FETCH_LIMIT = 1000;

/** COS 물품의 재고 조정·정보 수정·대여/반납/소모를 최신순으로 전부 보여주는 페이지. */
export default function WarehouseChangesPage({ scriptUrl, isLightMode, onBack }: Props) {
  const C = {
    text: isLightMode ? "#0f172a" : "#f1f5f9", dim: isLightMode ? "#64748b" : "#94a3b8",
    panel: isLightMode ? "#ffffff" : "#1e293b", input: isLightMode ? "#f8fafc" : "#0f172a",
    border: isLightMode ? "#e2e8f0" : "#334155", accent: "#2563eb", accentText: isLightMode ? "#1d4ed8" : "#93c5fd",
    accentSoft: isLightMode ? "rgba(37,99,235,0.09)" : "rgba(148,163,184,0.14)",
    warn: isLightMode ? "#b45309" : "#fbbf24", warnSoft: "rgba(245,158,11,0.12)",
    error: isLightMode ? "#dc2626" : "#f87171", errorSoft: isLightMode ? "rgba(220,38,38,0.10)" : "rgba(248,113,113,0.14)",
    success: isLightMode ? "#047857" : "#34d399", successSoft: isLightMode ? "rgba(4,120,87,0.10)" : "rgba(52,211,153,0.14)",
  };
  const kindTone = (kind: string) =>
    kind === "deleted" ? { color: C.error, bg: C.errorSoft }
    : kind === "created" || kind === "return" ? { color: C.success, bg: C.successSoft }
    : kind === "borrow" ? { color: C.warn, bg: C.warnSoft }
    : kind === "stock" ? { color: C.accentText, bg: C.accentSoft }
    : { color: C.dim, bg: C.input };

  const [hours, setHours] = useState(48);
  const [kind, setKind] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<WarehouseRecentChange[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetchWarehouseRecentChanges(scriptUrl, hours, FETCH_LIMIT)
      .then((rows) => { setItems(rows); setError(""); })
      .catch((e) => setError(e?.message || "불러오지 못했습니다."))
      .finally(() => setLoading(false));
  }, [scriptUrl, hours]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (items || []).filter((c) =>
      (kind === "all" || c.kind === kind)
      && (!q || [c.itemName, c.summary, c.manager, c.location].some((v) => String(v || "").toLowerCase().includes(q))));
  }, [items, kind, search]);

  // 날짜별 묶음("2026-10-01") — 날짜가 바뀌는 자리에 머리글을 둔다.
  const days = useMemo(() => {
    const map = new Map<string, WarehouseRecentChange[]>();
    for (const c of filtered) {
      const day = String(c.at || "").slice(0, 10) || "시각 없음";
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(c);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const kindCount = (k: string) => (items || []).filter((c) => c.kind === k).length;
  const chip = (on: boolean): React.CSSProperties => ({
    padding: "8px 13px", borderRadius: 999, cursor: "pointer", fontSize: 12.5, fontWeight: 800, whiteSpace: "nowrap",
    border: `1px solid ${on ? C.accent : C.border}`, background: on ? C.accent : C.panel, color: on ? "#fff" : C.text,
  });
  const dayLabel = (day: string) => {
    const d = new Date(`${day}T00:00:00`);
    if (Number.isNaN(d.getTime())) return day;
    const now = new Date();
    const diff = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - d.getTime()) / 86400000);
    const w = "일월화수목금토"[d.getDay()];
    return `${diff === 0 ? "오늘 · " : diff === 1 ? "어제 · " : ""}${d.getMonth() + 1}월 ${d.getDate()}일 (${w})`;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 1000 }}>
      <style>{`
        .wcp-row { display: grid; grid-template-columns: 56px 76px minmax(0,1fr) auto; gap: 10px; align-items: center; padding: 10px 14px; font-size: 12.5px; }
        @media (max-width: 760px) {
          .wcp-row { grid-template-columns: auto auto minmax(0,1fr); grid-template-areas: "time kind who" "body body body"; row-gap: 4px; column-gap: 8px; }
          .wcp-time { grid-area: time; } .wcp-kind { grid-area: kind; } .wcp-body { grid-area: body; white-space: normal !important; } .wcp-who { grid-area: who; justify-self: end; }
        }
      `}</style>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button type="button" onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 13px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.panel, color: C.text, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
          <ArrowLeft size={15} /> COS 물품
        </button>
        <History size={18} style={{ color: C.accentText }} />
        <span style={{ fontSize: 16, fontWeight: 800, color: C.text }}>COS 물품 변동 내역</span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={load} disabled={loading} title="새로고침" aria-label="새로고침" style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.panel, color: C.dim, cursor: loading ? "wait" : "pointer", fontSize: 12.5, fontWeight: 700 }}>
          <RefreshCw size={14} /> 새로고침
        </button>
      </div>

      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
        {PERIODS.map((p) => <button key={p.hours} type="button" onClick={() => setHours(p.hours)} style={chip(hours === p.hours)}>{p.label}</button>)}
      </div>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
        <button type="button" onClick={() => setKind("all")} style={chip(kind === "all")}>전체{items ? ` ${items.length}` : ""}</button>
        {KINDS.filter((k) => kindCount(k) > 0 || kind === k).map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} style={chip(kind === k)}>{KIND_LABEL[k]} {kindCount(k)}</button>
        ))}
      </div>

      <div style={{ position: "relative" }}>
        <Search size={15} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: C.dim }} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="물품명 · 변경 내용 · 위치 · 담당자 검색"
          style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px 10px 34px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.panel, color: C.text, fontSize: 13, outline: "none" }} />
      </div>

      {error ? (
        <div style={{ padding: 16, fontSize: 13, color: C.error }}>변동 내역을 불러오지 못했습니다. {error}</div>
      ) : !items ? (
        <div style={{ padding: 28, textAlign: "center", color: C.dim, fontSize: 13 }}>불러오는 중…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 28, textAlign: "center", color: C.dim, fontSize: 13 }}>
          {items.length === 0 ? `최근 ${hours >= 72 ? `${hours / 24}일` : `${hours}시간`} 동안 바뀐 COS 물품이 없습니다.` : "조건에 맞는 변동이 없습니다."}
        </div>
      ) : (
        <>
          <div style={{ fontSize: 12, color: C.dim }}>
            {filtered.length}건{items.length >= FETCH_LIMIT ? ` · 최신 ${FETCH_LIMIT}건까지만 불러왔습니다. 기간을 줄여 보세요.` : ""}
          </div>
          {days.map(([day, rows]) => (
            <section key={day} style={{ border: `1px solid ${C.border}`, borderRadius: 14, background: C.panel, overflow: "hidden" }}>
              <div style={{ padding: "9px 14px", fontSize: 12.5, fontWeight: 800, color: C.dim, background: C.input, borderBottom: `1px solid ${C.border}` }}>
                {dayLabel(day)} <span style={{ fontWeight: 700 }}>· {rows.length}건</span>
              </div>
              {rows.map((c, i) => {
                const tone = kindTone(c.kind);
                return (
                  <div key={c.key} className="wcp-row" style={{ borderBottom: i === rows.length - 1 ? "none" : `1px solid ${C.border}` }}>
                    <span className="wcp-time" style={{ color: C.dim, whiteSpace: "nowrap" }} title={c.at}>{String(c.at || "").slice(11, 16) || relativeTime(c.at)}</span>
                    <span className="wcp-kind" style={{ justifySelf: "start", fontSize: 11, fontWeight: 800, color: tone.color, background: tone.bg, borderRadius: 6, padding: "2px 7px", whiteSpace: "nowrap" }}>{KIND_LABEL[c.kind] || c.kind}</span>
                    <span className="wcp-body" style={{ minWidth: 0, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <b style={{ fontWeight: 800 }}>{c.itemName || "(이름 없음)"}</b>
                      <span style={{ color: C.dim }}> · {c.summary}</span>
                      {c.location ? <span style={{ color: C.dim }}> · {c.location}</span> : null}
                    </span>
                    <span className="wcp-who" style={{ color: C.dim, whiteSpace: "nowrap", justifySelf: "end" }}>{c.manager}</span>
                  </div>
                );
              })}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
