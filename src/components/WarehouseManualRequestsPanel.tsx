import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, RotateCcw } from "lucide-react";
import { fetchPendingToolRequests, PendingToolRequest, resolveToolRequest } from "../utils/warehouseManualApi";
import { fetchWarehouseInventory, WarehouseItem } from "../utils/borrowApi";

export default function WarehouseManualRequestsPanel({ scriptUrl, isLightMode, onCompleted }: {
  scriptUrl: string; isLightMode: boolean; onCompleted: () => void;
}) {
  const [lines, setLines] = useState<PendingToolRequest[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [inventory, setInventory] = useState<WarehouseItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [selected, setSelected] = useState<Record<number, number>>({});
  const [search, setSearch] = useState<Record<number, string>>({});
  const inFlight = useRef(false), mounted = useRef(false), completeRef = useRef(onCompleted);
  completeRef.current = onCompleted;
  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true; setLoading(true);
    try { const next = await fetchPendingToolRequests(); if (mounted.current) { setLines(next); setError(""); } }
    catch (e: any) { if (mounted.current) setError(e.message); }
    finally { inFlight.current = false; if (mounted.current) setLoading(false); }
  }, []);
  useEffect(() => {
    mounted.current = true; void load();
    const interval = setInterval(() => { if (!document.hidden) void load(); }, 30000);
    return () => { mounted.current = false; clearInterval(interval); };
  }, [load]);
  useEffect(() => {
    if (!open || loaded) return;
    let alive = true;
    fetchWarehouseInventory(scriptUrl).then(items => { if (alive) { setInventory(items.filter(i => !i.archived)); setLoaded(true); } }).catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [open, loaded, scriptUrl]);
  async function resolve(line: PendingToolRequest) {
    if (busy !== null || !selected[line.id]) return;
    setBusy(line.id); setError("");
    try {
      await resolveToolRequest(line.id, selected[line.id]);
      if (!mounted.current) return;
      setLines(prev => prev.filter(i => i.id !== line.id)); setLoaded(false);
      completeRef.current(); void load();
    } catch (e: any) { if (mounted.current) setError(e.message); }
    finally { if (mounted.current) setBusy(null); }
  }
  const bg = isLightMode ? "#fff" : "#1e293b", color = isLightMode ? "#111827" : "#f1f5f9", border = isLightMode ? "#dfe5ee" : "#334155";
  const input: React.CSSProperties = { padding: "10px", borderRadius: 9, border: `1px solid ${border}`, background: bg, color, font: "inherit", width: "100%", boxSizing: "border-box" };
  return <section style={{ marginBottom: 14, border: `1px solid ${border}`, borderRadius: 12, background: bg, color }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 12 }}>
      <button onClick={() => setOpen(v => !v)} aria-expanded={open} style={{ border: 0, background: "none", color, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontWeight: 800, flex: 1, textAlign: "left" }}>
        <ChevronDown size={16} style={{ transform: open ? "rotate(180deg)" : undefined }} /> 무인 공구 신청 · 확인 대기 {lines.length}건
      </button>
      <button title="무인 공구 신청 새로고침" aria-label="무인 공구 신청 새로고침" disabled={loading} onClick={() => void load()} style={{ ...input, width: "auto", cursor: "pointer" }}><RotateCcw size={14} /></button>
    </div>
    {error && <div role="alert" style={{ color: "#dc2626", padding: "0 12px 12px", fontSize: 13 }}>{error}</div>}
    {open && <div style={{ padding: "0 12px 12px", maxHeight: 580, overflowY: "auto" }}>
      <p style={{ color: "#64748b", fontSize: 12, lineHeight: 1.7 }}>입력한 이름과 사진을 확인하고 실제 재고를 연결해주세요. 연결 즉시 대여 처리·재고 차감되며, 소모품은 소모로 기록됩니다.</p>
      {!lines.length && <p style={{ fontSize: 13 }}>확인 대기 중인 신청이 없습니다.</p>}
      {lines.map(line => {
        const q = (search[line.id] || "").trim().toLocaleLowerCase();
        const options = inventory.filter(i => i.rowIndex === selected[line.id] || !q || `${i.name} ${i.location} ${i.rowIndex}`.toLocaleLowerCase().includes(q));
        return <article key={line.id} style={{ padding: "14px 0", borderTop: `1px solid ${border}` }}>
          <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
            <a href={line.image_path} target="_blank" rel="noopener noreferrer" title="신청 사진 크게 보기"><img src={line.image_path} alt={`${line.entered_name} 신청 사진`} loading="lazy" style={{ width: 92, height: 92, borderRadius: 9, objectFit: "contain", background: "#f1f5f9" }} /></a>
            <div style={{ minWidth: 0 }}><strong>{line.entered_name} × {line.qty}</strong>
              <div style={{ fontSize: 12, lineHeight: 1.8, marginTop: 5 }}>{line.borrower_name} · {line.employee_id} · {line.floor}<br />신청 #{line.request_id} · {line.occurred_at}</div>
              <div style={{ color: "#b45309", fontSize: 12, marginTop: 5 }}>{line.reason}</div>
            </div>
          </div>
          <input aria-label={`재고 검색 ${line.id}`} placeholder="연결할 재고 이름 / ID 검색" style={input} value={search[line.id] || ""} onChange={e => setSearch(v => ({ ...v, [line.id]: e.target.value }))} disabled={busy !== null} />
          <select aria-label={`재고 연결 ${line.id}`} style={{ ...input, marginTop: 8 }} value={selected[line.id] || ""} disabled={busy !== null || !loaded} onChange={e => setSelected(v => ({ ...v, [line.id]: Number(e.target.value) }))}>
            <option value="">{loaded ? "실제 재고 물품 선택" : "재고 목록 불러오는 중…"}</option>
            {options.map(i => <option key={i.rowIndex} value={i.rowIndex}>#{i.rowIndex} · {i.name} · {i.location} · 재고 {i.stock ?? "미등록"}{i.isConsumable ? " · 소모품" : ""}</option>)}
          </select>
          <button disabled={busy !== null || !selected[line.id]} onClick={() => void resolve(line)} style={{ ...input, marginTop: 8, background: "#2563eb", color: "#fff", fontWeight: 700, cursor: "pointer", opacity: busy !== null || !selected[line.id] ? .5 : 1 }}>{busy === line.id ? "처리 중…" : "재고 연결하고 처리"}</button>
        </article>;
      })}
    </div>}
  </section>;
}
