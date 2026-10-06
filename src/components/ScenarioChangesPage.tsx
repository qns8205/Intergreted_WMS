import React, { useEffect, useMemo, useState } from "react";
import { Clock, Download, History, RefreshCw, Save } from "lucide-react";
import { fetchItemChangeHistory, ItemChangeCategory, ScenarioChangeEntry, saveScenarioChangesCheckpoint } from "../utils/borrowApi";
import { adminHeaders as tokenHeaders } from "../utils/adminAuth";

interface Props {
  scriptUrl: string;
  connected: boolean;
  isLightMode: boolean;
  showToast: (msg: string, type?: "info" | "ok" | "warn" | "error") => void;
}

const SETTINGS_KEY = "scenario_changes_checkpoint";
const TABS: { key: ItemChangeCategory; label: string }[] = [
  { key: "scenario", label: "시나리오 물품" },
  { key: "inventory", label: "COS 물품" },
  { key: "tablecloth", label: "테이블보" },
];

function adminHeaders(): HeadersInit {
  return tokenHeaders({ "Content-Type": "application/json" });
}
function toDbFormat(local: string) { return local ? `${local.replace("T", " ")}:00` : ""; }
function toLocalInputFormat(db: string) { return db ? db.slice(0, 16).replace(" ", "T") : ""; }
function nowCheckpoint() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

export default function ScenarioChangesPage({ scriptUrl, connected, isLightMode, showToast }: Props) {
  const color = {
    text: isLightMode ? "#0f172a" : "#f1f5f9", dim: isLightMode ? "#64748b" : "#94a3b8",
    panel: isLightMode ? "#ffffff" : "#1e293b", input: isLightMode ? "#f8fafc" : "#0f172a",
    border: isLightMode ? "#e2e8f0" : "#334155", accent: "#2563eb",
  };
  const [category, setCategory] = useState<ItemChangeCategory>("scenario");
  const [checkpoint, setCheckpoint] = useState("");
  const [checkpointInput, setCheckpointInput] = useState("");
  const [checkpointLoaded, setCheckpointLoaded] = useState(false);
  const [savingCheckpoint, setSavingCheckpoint] = useState(false);
  const [logs, setLogs] = useState<ScenarioChangeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/settings", { headers: adminHeaders() })
      .then((r) => r.json())
      .then((data) => {
        const saved = data.settings?.[SETTINGS_KEY] || "";
        setCheckpoint(saved);
        setCheckpointInput(toLocalInputFormat(saved));
      })
      .finally(() => setCheckpointLoaded(true));
  }, []);

  async function load(nextCategory = category, since = checkpoint) {
    if (!connected || !scriptUrl || !since) return;
    setLoading(true);
    try { setLogs(await fetchItemChangeHistory(scriptUrl, nextCategory, since)); }
    catch (e: any) { showToast(`변경 이력을 불러오지 못했습니다: ${e.message}`, "error"); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    if (checkpointLoaded && checkpoint) load(category, checkpoint);
  }, [checkpointLoaded, checkpoint, category, connected, scriptUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  async function applyCheckpoint(value: string) {
    setSavingCheckpoint(true);
    try {
      await saveScenarioChangesCheckpoint(scriptUrl, value);
      setCheckpoint(value);
      setCheckpointInput(toLocalInputFormat(value));
      showToast("변경 이력 기준 시점을 저장했습니다.", "ok");
    } catch (e: any) { showToast(`기준 시점 저장 실패: ${e.message}`, "error"); }
    finally { setSavingCheckpoint(false); }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter((l) => [l.itemId, l.itemName, l.summary, l.manager].some((v) => String(v || "").toLowerCase().includes(q)));
  }, [logs, search]);
  const tabLabel = TABS.find((t) => t.key === category)?.label || "물품";

  function exportCsv() {
    const rows = [["시각", "구분", "물품 ID", "물품명", "변경 내용", "관리자"], ...filtered.map((l) => [l.timestamp, tabLabel, l.itemId, l.itemName, l.summary, l.manager])];
    const csv = "﻿" + rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `물품_상태_변경_이력_${category}_${checkpoint.slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const badgeStyle = (type: string): React.CSSProperties => {
    const c = type === "created" ? "#059669" : type === "deleted" ? "#dc2626" : type === "stock_adjust" ? "#7c3aed" : color.accent;
    return { fontSize: 10.5, fontWeight: 800, color: c, background: `${c}18`, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" };
  };

  return <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1120 }}>
    <p style={{ margin: 0, fontSize: 12, color: color.dim, lineHeight: 1.6 }}>대여·반납 기록은 제외하고, 관리자 모드에서 직접 수행한 재고·위치·분류·보관 및 물품 정보 수정만 표시합니다.</p>

    <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>{TABS.map((tab) => <button key={tab.key} onClick={() => { setCategory(tab.key); setSearch(""); }} style={{
      padding: "9px 15px", borderRadius: 9, cursor: "pointer", fontSize: 12.5, fontWeight: 800,
      border: `1px solid ${category === tab.key ? color.accent : color.border}`, background: category === tab.key ? color.accent : color.panel,
      color: category === tab.key ? "#fff" : color.text,
    }}>{tab.label}</button>)}</div>

    <div style={{ background: color.panel, border: `1px solid ${color.border}`, borderRadius: 14, padding: 17 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}><Clock size={16} color={color.accent} /><span style={{ fontWeight: 800, fontSize: 14, color: color.text }}>기준 시점</span></div>
      {!checkpointLoaded ? <div style={{ fontSize: 12, color: color.dim }}>불러오는 중...</div> : !checkpoint ? <button onClick={() => applyCheckpoint(nowCheckpoint())} disabled={savingCheckpoint} style={{ background: color.accent, color: "#fff", border: 0, borderRadius: 8, padding: "9px 15px", fontWeight: 700, cursor: "pointer" }}>지금 시점으로 시작하기</button> : <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <input type="datetime-local" value={checkpointInput} onChange={(e) => setCheckpointInput(e.target.value)} style={{ background: color.input, border: `1px solid ${color.border}`, borderRadius: 8, padding: "8px 10px", color: color.text }} />
        <button onClick={() => applyCheckpoint(toDbFormat(checkpointInput))} disabled={savingCheckpoint || !checkpointInput} style={{ display: "flex", alignItems: "center", gap: 5, background: color.accent, color: "#fff", border: 0, borderRadius: 8, padding: "8px 13px", fontWeight: 700, cursor: "pointer" }}><Save size={13} /> 저장</button>
        <button onClick={() => applyCheckpoint(nowCheckpoint())} disabled={savingCheckpoint} style={{ display: "flex", alignItems: "center", gap: 5, background: "transparent", color: color.text, border: `1px solid ${color.border}`, borderRadius: 8, padding: "8px 13px", fontWeight: 700, cursor: "pointer" }}><Clock size={13} /> 지금으로 갱신</button>
        <span style={{ color: color.dim, fontSize: 11 }}>{checkpoint} 이후</span>
      </div>}
    </div>

    {checkpoint ? <div style={{ background: color.panel, border: `1px solid ${color.border}`, borderRadius: 14, padding: 17 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 11 }}><History size={16} color={color.accent} /><strong style={{ color: color.text, fontSize: 14 }}>관리자 변경 ({filtered.length}건)</strong><span style={{ flex: 1 }} />
        <button onClick={() => load()} disabled={loading} style={{ display: "flex", alignItems: "center", gap: 5, background: "transparent", color: color.accent, border: `1px solid ${color.border}`, borderRadius: 8, padding: "7px 10px", fontWeight: 700, cursor: "pointer" }}><RefreshCw size={13} /> 새로고침</button>
        <button onClick={exportCsv} disabled={!filtered.length} style={{ display: "flex", alignItems: "center", gap: 5, background: color.accent, color: "#fff", border: 0, borderRadius: 8, padding: "7px 11px", fontWeight: 700, cursor: "pointer", opacity: filtered.length ? 1 : .5 }}><Download size={13} /> CSV</button>
      </div>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="물품명 · ID · 변경 내용 · 관리자로 검색" style={{ width: "100%", boxSizing: "border-box", background: color.input, border: `1px solid ${color.border}`, borderRadius: 8, padding: "9px 11px", color: color.text, fontSize: 12.5, outline: "none", marginBottom: 11 }} />
      {loading ? <div style={{ padding: 22, textAlign: "center", color: color.dim, fontSize: 12 }}>불러오는 중...</div> : filtered.length === 0 ? <div style={{ padding: 22, textAlign: "center", color: color.dim, fontSize: 12 }}>기준 시점 이후 관리자 변경 기록이 없습니다.</div> : <div style={{ display: "flex", flexDirection: "column", gap: 7, maxHeight: 620, overflowY: "auto" }}>{filtered.map((log, i) => <div key={`${log.timestamp}-${log.itemId}-${i}`} style={{ display: "grid", gridTemplateColumns: "minmax(155px, .8fr) minmax(240px, 2fr) auto", gap: 12, alignItems: "center", padding: "11px 12px", background: color.input, border: `1px solid ${color.border}`, borderRadius: 10 }}>
        <div style={{ minWidth: 0 }}><div style={{ color: color.text, fontSize: 12.5, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{log.itemName || "(이름 없음)"}</div><div style={{ color: color.dim, fontSize: 10.5, marginTop: 2 }}>ID {log.itemId || "-"} · {log.timestamp}</div></div>
        <div style={{ color: color.text, fontSize: 12, lineHeight: 1.45 }}>{log.summary}</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 7 }}>{log.manager ? <span style={{ color: color.dim, fontSize: 10.5 }}>{log.manager}</span> : null}<span style={badgeStyle(log.changeType)}>{log.changeType === "created" ? "등록" : log.changeType === "deleted" ? "삭제" : log.changeType === "stock_adjust" ? "재고" : "수정"}</span></div>
      </div>)}</div>}
    </div> : null}
  </div>;
}
