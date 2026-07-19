import React, { useState, useMemo, useEffect, useCallback } from "react";
import {
  Search, RotateCcw, Package, MapPin, User, Check, Undo2,
} from "lucide-react";
import {
  UnreturnedItem, ReturnRequest, padSlot,
  fetchUnreturnedItems, postProcessReturn, fetchBorrowAppVersion,
} from "../utils/borrowApi";

interface Props {
  scriptUrl: string;
  connected: boolean;
  isLightMode: boolean;
  isAdmin: boolean;
  showToast: (msg: string, type: "ok" | "error" | "info" | "warn") => void;
}

export default function ScenarioLogsPage({ scriptUrl, connected, isLightMode, isAdmin, showToast }: Props) {
  const C = {
    card: isLightMode ? "#ffffff" : "#1e293b",
    cardSub: isLightMode ? "#f8fafc" : "#151d30",
    border: isLightMode ? "#e2e8f0" : "#334155",
    text: isLightMode ? "#0f172a" : "#f1f5f9",
    label: isLightMode ? "#475569" : "#94a3b8",
    accent: "#6366f1",
    accentSoft: "rgba(99, 102, 241, 0.15)",
    accentText: isLightMode ? "#4f46e5" : "#818cf8",
    success: isLightMode ? "#047857" : "#34d399",
    successSoft: "rgba(16, 185, 129, 0.12)",
    warn: isLightMode ? "#b45309" : "#fbbf24",
    warnSoft: "rgba(245, 158, 11, 0.12)",
    error: isLightMode ? "#dc2626" : "#f87171",
    errorSoft: "rgba(239, 68, 68, 0.12)",
  };

  const [items, setItems] = useState<UnreturnedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "scenario" | "general">("all");
  const [borrowerFilter, setBorrowerFilter] = useState("");
  const [sel, setSel] = useState<Record<string, number>>({}); // key = sheetType:rowIndex -> qty
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setSel({});
    try {
      if (connected && scriptUrl) {
        const [list, ver] = await Promise.all([
          fetchUnreturnedItems(scriptUrl),
          fetchBorrowAppVersion(scriptUrl).catch(() => ""),
        ]);
        setItems(list);
        setAppVersion(ver);
      } else {
        setItems([
          { sheetType: "scenario", rowIndex: 2, borrowerName: "홍길동", scenarioId: "S00001", itemLabel: "[000060] 소화기 x 2", itemKind: "필수 물품", location: "000060", quantity: 2, borrowDate: "2026-07-10 09:00", borrowPurpose: "훈련", email: "", batchId: "b1", image: "", stock: 5, rented: 2 },
          { sheetType: "general", rowIndex: 3, borrowerName: "김철수", itemLabel: "[000012] 삼각대 x 1", location: "000012", quantity: 1, borrowDate: "2026-07-11 14:00", borrowPurpose: "촬영", email: "", batchId: "b2", generalOption: "일반 대여", image: "", stock: 3, rented: 1 },
        ]);
      }
      setLoaded(true);
    } catch (e: any) { showToast(`시나리오 대여 내역을 불러오지 못했습니다: ${e.message}`, "error"); }
    finally { setLoading(false); }
  }, [connected, scriptUrl, showToast]);

  useEffect(() => { load(); }, [load]);

  const borrowers = useMemo(() => {
    const set = new Set<string>();
    items.forEach((it) => { if (it.borrowerName) set.add(it.borrowerName); });
    return Array.from(set).sort();
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (kindFilter !== "all" && it.sheetType !== kindFilter) return false;
      if (borrowerFilter && it.borrowerName !== borrowerFilter) return false;
      if (!q) return true;
      return it.itemLabel.toLowerCase().includes(q) ||
        it.borrowerName.toLowerCase().includes(q) ||
        (it.scenarioId || "").toLowerCase().includes(q) ||
        (it.borrowPurpose || "").toLowerCase().includes(q) ||
        padSlot(it.location).includes(q);
    });
  }, [items, search, kindFilter, borrowerFilter]);

  // 신청 단위(batchId+borrower)로 그룹화
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; borrower: string; scenarioId?: string; date: string; purpose: string; kind: string; items: UnreturnedItem[] }>();
    filtered.forEach((it) => {
      const gkey = `${it.borrowerName}|${it.batchId || it.scenarioId || it.borrowDate}`;
      if (!map.has(gkey)) map.set(gkey, { key: gkey, borrower: it.borrowerName, scenarioId: it.scenarioId, date: it.borrowDate, purpose: it.borrowPurpose, kind: it.sheetType === "scenario" ? "SID 대여" : "일반 대여", items: [] });
      map.get(gkey)!.items.push(it);
    });
    return Array.from(map.values()).sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [filtered]);

  const selKey = (it: UnreturnedItem) => `${it.sheetType}:${it.rowIndex}`;
  const selCount = Object.keys(sel).length;

  function toggle(it: UnreturnedItem) {
    const k = selKey(it);
    setSel((p) => { const n = { ...p }; if (k in n) delete n[k]; else n[k] = it.quantity; return n; });
  }
  function setQty(it: UnreturnedItem, q: number) {
    const k = selKey(it);
    setSel((p) => ({ ...p, [k]: Math.max(1, Math.min(it.quantity, q)) }));
  }

  async function doReturn() {
    if (!isAdmin) { showToast("반납 처리는 관리자만 가능합니다.", "warn"); return; }
    const keys = Object.keys(sel);
    if (!keys.length) { showToast("반납할 물품을 선택해주세요.", "warn"); return; }
    setSubmitting(true);
    try {
      const reqs: ReturnRequest[] = keys.map((k) => {
        const [sheetType, rowIndex] = k.split(":");
        return { sheetType: sheetType as "scenario" | "general", rowIndex: Number(rowIndex), quantity: sel[k] };
      });
      if (connected && scriptUrl) {
        const res = await postProcessReturn(scriptUrl, reqs, appVersion);
        if (!res.success) { showToast(res.message || "반납 처리 실패", "error"); return; }
        showToast(res.message || `${keys.length}건을 반납 처리했습니다.`, "ok");
      } else {
        showToast("데모 모드: 실제 반납은 연동 시 동작합니다.", "info");
      }
      await load();
    } catch (e: any) { showToast(`반납 처리 실패: ${e.message}`, "error"); }
    finally { setSubmitting(false); }
  }

  const inputStyle: React.CSSProperties = {
    padding: "10px 12px", fontSize: "13px", borderRadius: "10px",
    border: `1px solid ${C.border}`, background: isLightMode ? "#ffffff" : "#0f172a",
    color: C.text, outline: "none", boxSizing: "border-box",
  };
  function Spinner({ size = 20 }: { size?: number }) {
    return <span style={{ width: size, height: size, borderRadius: "50%", display: "inline-block", border: `3px solid ${C.border}`, borderTopColor: C.accent, animation: "slp-spin 0.9s linear infinite" }} />;
  }

  const totalUnreturned = items.length;
  const scenarioCount = items.filter((i) => i.sheetType === "scenario").length;
  const generalCount = items.filter((i) => i.sheetType === "general").length;

  return (
    <div>
      <style>{`@keyframes slp-spin { to { transform: rotate(360deg); } }`}</style>

      {/* 요약 통계 */}
      <div style={{ display: "flex", gap: "10px", marginBottom: "14px", flexWrap: "wrap" }}>
        {[
          { label: "미반납 전체", value: totalUnreturned, color: C.accentText, bg: C.accentSoft },
          { label: "SID 대여", value: scenarioCount, color: C.warn, bg: C.warnSoft },
          { label: "일반 대여", value: generalCount, color: C.success, bg: C.successSoft },
        ].map((s) => (
          <div key={s.label} style={{ flex: "1 1 120px", padding: "12px 14px", borderRadius: "12px", background: s.bg, border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: "11px", color: C.label, fontWeight: 600 }}>{s.label}</div>
            <div style={{ fontSize: "22px", fontWeight: 800, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* 필터 */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "8px", flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: "2 1 240px", minWidth: 0 }}>
          <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="물품 · 대여자 · SID · 목적 · 위치로 검색..." style={{ ...inputStyle, paddingLeft: "36px", width: "100%" }} />
        </div>
        <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as any)} style={{ ...inputStyle, flex: "1 1 130px", minWidth: 0 }}>
          <option value="all">전체 유형</option>
          <option value="scenario">SID 대여</option>
          <option value="general">일반 대여</option>
        </select>
        <select value={borrowerFilter} onChange={(e) => setBorrowerFilter(e.target.value)} style={{ ...inputStyle, flex: "1 1 130px", minWidth: 0 }}>
          <option value="">전체 대여자</option>
          {borrowers.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <button onClick={load} title="새로고침" style={{ ...inputStyle, cursor: "pointer", display: "flex", alignItems: "center", gap: "5px", fontWeight: 700, color: C.accentText }}><RotateCcw size={14} /></button>
      </div>
      <div style={{ fontSize: "12px", color: C.label, marginBottom: "12px" }}>{loaded ? `${filtered.length} / ${items.length}건 미반납` : ""}</div>

      {loading && !loaded ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", padding: "64px 0", color: C.label }}><Spinner size={30} /> 불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "64px 0", color: C.label }}><Check size={36} style={{ color: C.border, marginBottom: "8px" }} /><div>미반납 시나리오 물품이 없습니다.</div></div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {groups.map((g) => (
            <div key={g.key} style={{ border: `1px solid ${C.border}`, borderRadius: "14px", background: C.card, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 16px", borderBottom: `1px solid ${C.border}`, background: C.cardSub }}>
                <div style={{ width: 34, height: 34, borderRadius: "9px", background: C.accentSoft, color: C.accentText, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><User size={17} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: "14px" }}>{g.borrower} {g.scenarioId ? <span style={{ fontSize: "11px", color: C.warn, fontWeight: 700 }}>· {g.scenarioId}</span> : null}</div>
                  <div style={{ fontSize: "11px", color: C.label }}>{g.kind} · {g.date}{g.purpose ? ` · ${g.purpose}` : ""}</div>
                </div>
                <span style={{ fontSize: "11px", fontWeight: 700, color: C.accentText, background: C.accentSoft, padding: "3px 10px", borderRadius: "20px", flexShrink: 0 }}>{g.items.length}개</span>
              </div>
              <div style={{ padding: "8px 12px" }}>
                {g.items.map((it) => {
                  const k = selKey(it);
                  const checked = k in sel;
                  return (
                    <div key={k} onClick={() => isAdmin && toggle(it)} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "9px 8px", borderRadius: "10px", cursor: isAdmin ? "pointer" : "default", background: checked ? C.accentSoft : "transparent" }}>
                      {isAdmin ? <input type="checkbox" readOnly checked={checked} style={{ width: 16, height: 16, accentColor: C.accent, flexShrink: 0 }} /> : <Package size={15} style={{ color: C.label, flexShrink: 0 }} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "13px", fontWeight: 600, wordBreak: "break-word" }}>{it.itemLabel}</div>
                        <div style={{ display: "flex", gap: "6px", marginTop: "3px", flexWrap: "wrap" }}>
                          {it.location ? <span style={{ display: "inline-flex", alignItems: "center", gap: "3px", fontSize: "10px", fontWeight: 700, color: C.warn, background: C.warnSoft, borderRadius: "6px", padding: "2px 7px", fontFamily: "monospace" }}><MapPin size={10} />{padSlot(it.location)}</span> : null}
                          {it.itemKind ? <span style={{ fontSize: "10px", fontWeight: 700, color: C.accentText, background: C.accentSoft, borderRadius: "6px", padding: "2px 7px" }}>{it.itemKind}</span> : null}
                        </div>
                      </div>
                      {checked && it.quantity > 1 ? (
                        <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                          <button onClick={() => setQty(it, (sel[k] ?? it.quantity) - 1)} style={{ width: 24, height: 24, borderRadius: "6px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer" }}>-</button>
                          <span style={{ fontSize: "12px", fontWeight: 700, minWidth: "30px", textAlign: "center" }}>{sel[k] ?? it.quantity}/{it.quantity}</span>
                          <button onClick={() => setQty(it, (sel[k] ?? it.quantity) + 1)} style={{ width: 24, height: 24, borderRadius: "6px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer" }}>+</button>
                        </div>
                      ) : <span style={{ fontSize: "12px", color: C.label, fontWeight: 600, flexShrink: 0 }}>x{it.quantity}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 반납 처리 바 (관리자) */}
      {isAdmin && selCount > 0 ? (
        <div style={{ position: "sticky", bottom: 0, marginTop: "16px", padding: "14px 16px", background: C.card, border: `1px solid ${C.accent}`, borderRadius: "14px", display: "flex", alignItems: "center", gap: "12px", boxShadow: "0 -4px 16px rgba(0,0,0,0.15)" }}>
          <span style={{ flex: 1, fontSize: "13px", fontWeight: 700 }}>{selCount}건 선택됨</span>
          <button onClick={() => setSel({})} style={{ padding: "10px 14px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.card, color: C.label, cursor: "pointer", fontSize: "13px", fontWeight: 700 }}>선택 해제</button>
          <button onClick={doReturn} disabled={submitting} style={{ padding: "10px 20px", borderRadius: "10px", border: "none", background: C.accent, color: "#fff", cursor: "pointer", fontSize: "13px", fontWeight: 700, display: "flex", alignItems: "center", gap: "7px", opacity: submitting ? 0.7 : 1 }}>
            {submitting ? <><Spinner size={14} /> 처리 중...</> : <><Undo2 size={15} /> 반납 처리</>}
          </button>
        </div>
      ) : null}
    </div>
  );
}
