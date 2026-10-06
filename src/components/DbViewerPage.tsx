import React, { useEffect, useState } from "react";
import { Database, Play, RefreshCw, ChevronLeft, ChevronRight, ScrollText, FileSpreadsheet } from "lucide-react";
import AdminConnectionSettings from "./AdminConnectionSettings";
import { adminHeaders as tokenHeaders } from "../utils/adminAuth";

interface Props {
  isLightMode: boolean;
  showToast: (msg: string, type?: "info" | "ok" | "warn" | "error") => void;
}

interface TableInfo { name: string; count: number }

function adminHeaders(): HeadersInit {
  return tokenHeaders({ "Content-Type": "application/json" });
}

async function api(method: string, url: string, body?: unknown) {
  const res = await fetch(url, { method, headers: adminHeaders(), body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || `요청 실패 (HTTP ${res.status})`);
  return data;
}

export default function DbViewerPage({ isLightMode, showToast }: Props) {
  const TEXT_MAIN = isLightMode ? "#0f172a" : "#f1f5f9";
  const TEXT_DIM = isLightMode ? "#64748b" : "#94a3b8";
  const PANEL_BG = isLightMode ? "#ffffff" : "#1e293b";
  const INPUT_BG = isLightMode ? "#f8fafc" : "#0f172a";
  const BORDER_COLOR = isLightMode ? "#e2e8f0" : "#334155";
  const ACCENT = "#2563eb";
  const [section, setSection] = useState<"viewer" | "scenarios" | "xlsx">("viewer");

  const [tables, setTables] = useState<TableInfo[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [rowsLoading, setRowsLoading] = useState(false);
  const limit = 100;

  const [sql, setSql] = useState("");
  const [sqlRunning, setSqlRunning] = useState(false);
  const [sqlResult, setSqlResult] = useState<{ columns: string[]; rows: any[]; truncated?: boolean } | null>(null);
  const [sqlError, setSqlError] = useState("");

  function loadTables() {
    setTablesLoading(true);
    api("GET", "/api/admin/db/tables")
      .then((data) => setTables(data.tables || []))
      .catch((err) => showToast(`테이블 목록 불러오기 실패: ${err.message}`, "error"))
      .finally(() => setTablesLoading(false));
  }
  useEffect(loadTables, []);

  function openTable(name: string, off = 0) {
    setSelected(name);
    setOffset(off);
    setRowsLoading(true);
    api("GET", `/api/admin/db/table/${encodeURIComponent(name)}?limit=${limit}&offset=${off}`)
      .then((data) => { setColumns(data.columns || []); setRows(data.rows || []); setTotal(data.total || 0); })
      .catch((err) => showToast(`${name} 조회 실패: ${err.message}`, "error"))
      .finally(() => setRowsLoading(false));
  }

  async function runQuery() {
    if (!sql.trim()) { showToast("SQL을 입력해주세요.", "warn"); return; }
    setSqlRunning(true);
    setSqlError("");
    try {
      const data = await api("POST", "/api/admin/db/query", { sql });
      setSqlResult({ columns: data.columns || [], rows: data.rows || [], truncated: data.truncated });
    } catch (err: any) {
      setSqlError(err.message);
      setSqlResult(null);
    } finally {
      setSqlRunning(false);
    }
  }

  const cellStyle: React.CSSProperties = { padding: "6px 10px", fontSize: 12, color: TEXT_MAIN, borderBottom: `1px solid ${BORDER_COLOR}`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 260 };
  const headStyle: React.CSSProperties = { padding: "6px 10px", fontSize: 11, fontWeight: 800, color: TEXT_DIM, borderBottom: `2px solid ${BORDER_COLOR}`, textAlign: "left", whiteSpace: "nowrap", position: "sticky", top: 0, background: PANEL_BG };

  function renderTable(cols: string[], data: any[]) {
    if (!data.length) return <div style={{ fontSize: 12, color: TEXT_DIM, padding: 16 }}>결과가 없습니다.</div>;
    return (
      <div style={{ overflow: "auto", maxHeight: 480, border: `1px solid ${BORDER_COLOR}`, borderRadius: 8 }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr>{cols.map((c) => <th key={c} style={headStyle}>{c}</th>)}</tr></thead>
          <tbody>
            {data.map((r, i) => (
              <tr key={i}>
                {cols.map((c) => <td key={c} style={cellStyle} title={r[c] === null ? "NULL" : String(r[c])}>{r[c] === null ? <span style={{ color: TEXT_DIM }}>NULL</span> : String(r[c])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 1100 }}>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
        {([
          ["viewer", "DB 조회", <Database size={15} />],
          ["scenarios", "SID 편집", <ScrollText size={15} />],
          ["xlsx", "xlsx 입력/추출", <FileSpreadsheet size={15} />],
        ] as const).map(([key, label, icon]) => (
          <button
            key={key}
            onClick={() => setSection(key)}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 9,
              border: `1px solid ${section === key ? ACCENT : BORDER_COLOR}`,
              background: section === key ? ACCENT : PANEL_BG,
              color: section === key ? "#fff" : TEXT_MAIN,
              fontSize: 12.5, fontWeight: 800, cursor: "pointer",
            }}
          >
            {icon}{label}
          </button>
        ))}
      </div>

      {section === "scenarios" ? (
        <AdminConnectionSettings embedded initialTab="scenarios" visibleTabs={["scenarios"]} showHeader={false} showTabs={false} isLightMode={isLightMode} showToast={showToast} />
      ) : section === "xlsx" ? (
        <AdminConnectionSettings embedded initialTab="import" visibleTabs={["import"]} showHeader={false} showTabs={false} isLightMode={isLightMode} showToast={showToast} />
      ) : <>
      <p style={{ fontSize: 12, color: TEXT_DIM, lineHeight: 1.6 }}>
        SQLite 데이터베이스를 직접 조회합니다. <strong>조회(SELECT) 전용</strong>이며 값 수정은 여기서 할 수 없습니다.
      </p>

      <div style={{ background: PANEL_BG, border: `1px solid ${BORDER_COLOR}`, borderRadius: 14, padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <Database size={16} color={ACCENT} />
          <span style={{ fontWeight: 800, fontSize: 14, color: TEXT_MAIN, flex: 1 }}>테이블</span>
          <button onClick={loadTables} disabled={tablesLoading} style={{ background: "transparent", border: "none", color: ACCENT, cursor: "pointer", display: "flex", alignItems: "center" }}>
            <RefreshCw size={14} className={tablesLoading ? undefined : undefined} />
          </button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {tables.map((t) => (
            <button
              key={t.name}
              onClick={() => openTable(t.name)}
              style={{
                padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: "pointer",
                border: `1px solid ${selected === t.name ? ACCENT : BORDER_COLOR}`,
                background: selected === t.name ? ACCENT : INPUT_BG,
                color: selected === t.name ? "#fff" : TEXT_MAIN,
              }}
            >
              {t.name} <span style={{ opacity: 0.7 }}>({t.count})</span>
            </button>
          ))}
        </div>

        {selected ? (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: TEXT_DIM }}>
                {rowsLoading ? "불러오는 중..." : `${Math.min(offset + 1, total)}–${Math.min(offset + limit, total)} / ${total}행`}
              </span>
              <span style={{ flex: 1 }} />
              <button onClick={() => openTable(selected, Math.max(0, offset - limit))} disabled={offset === 0 || rowsLoading} style={{ background: "transparent", border: `1px solid ${BORDER_COLOR}`, borderRadius: 6, color: TEXT_MAIN, cursor: offset === 0 ? "default" : "pointer", opacity: offset === 0 ? 0.4 : 1, padding: "4px 6px", display: "flex" }}>
                <ChevronLeft size={14} />
              </button>
              <button onClick={() => openTable(selected, offset + limit)} disabled={offset + limit >= total || rowsLoading} style={{ background: "transparent", border: `1px solid ${BORDER_COLOR}`, borderRadius: 6, color: TEXT_MAIN, cursor: offset + limit >= total ? "default" : "pointer", opacity: offset + limit >= total ? 0.4 : 1, padding: "4px 6px", display: "flex" }}>
                <ChevronRight size={14} />
              </button>
            </div>
            {renderTable(columns, rows)}
          </div>
        ) : null}
      </div>

      <div style={{ background: PANEL_BG, border: `1px solid ${BORDER_COLOR}`, borderRadius: 14, padding: 18 }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: TEXT_MAIN, marginBottom: 8 }}>SQL 직접 조회 (SELECT 전용)</div>
        <textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          placeholder={`예: SELECT * FROM scenario_items WHERE stock = 0 LIMIT 20`}
          rows={3}
          style={{ width: "100%", background: INPUT_BG, border: `1px solid ${BORDER_COLOR}`, borderRadius: 8, padding: "10px 12px", color: TEXT_MAIN, fontSize: 13, fontFamily: "monospace", resize: "vertical", outline: "none" }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <button
            onClick={runQuery}
            disabled={sqlRunning}
            style={{ display: "flex", alignItems: "center", gap: 6, background: ACCENT, color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: sqlRunning ? "wait" : "pointer", opacity: sqlRunning ? 0.7 : 1 }}
          >
            <Play size={14} /> {sqlRunning ? "실행 중..." : "실행"}
          </button>
        </div>
        {sqlError ? <div style={{ color: "#ef4444", fontSize: 12, marginTop: 8 }}>{sqlError}</div> : null}
        {sqlResult ? (
          <div style={{ marginTop: 12 }}>
            {sqlResult.truncated ? <div style={{ fontSize: 11, color: TEXT_DIM, marginBottom: 6 }}>결과가 많아 앞 1000행만 표시합니다.</div> : null}
            {renderTable(sqlResult.columns, sqlResult.rows)}
          </div>
        ) : null}
      </div>
      </>}
    </div>
  );
}
