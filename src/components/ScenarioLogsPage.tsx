import React, { useState, useMemo, useEffect, useCallback } from "react";
import {
  Search, RotateCcw, Package, MapPin, User, Check, Undo2, RefreshCw,
  TrendingUp, Clock, CheckCircle2, Repeat,
} from "lucide-react";
import {
  ScenarioLogEntry, ReturnRequest, padSlot,
  fetchScenarioAllLogs, postProcessReturn, fetchBorrowAppVersion, reBorrowScenarioLogs,
} from "../utils/borrowApi";

interface Props {
  scriptUrl: string;
  connected: boolean;
  isLightMode: boolean;
  isAdmin: boolean;
  showToast: (msg: string, type: "ok" | "error" | "info" | "warn") => void;
}

type StatusFilter = "all" | "unreturned" | "returned";

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

  const [logs, setLogs] = useState<ScenarioLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "scenario" | "general">("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [borrowerFilter, setBorrowerFilter] = useState("");
  const [sel, setSel] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [reborrowing, setReborrowing] = useState(false);
  const [showStats, setShowStats] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setSel({});
    try {
      if (connected && scriptUrl) {
        const [list, ver] = await Promise.all([
          fetchScenarioAllLogs(scriptUrl),
          fetchBorrowAppVersion(scriptUrl).catch(() => ""),
        ]);
        setLogs(list);
        setAppVersion(ver);
      } else {
        setLogs([
          { sheetType: "scenario", rowIndex: 2, borrowerName: "홍길동", scenarioId: "S00001", itemLabel: "[000060] 소화기 x 2", itemKind: "필수 물품", location: "000060", itemId: "000060", itemName: "소화기", quantity: 2, borrowDate: "2026-07-15 09:00", borrowPurpose: "훈련", email: "", batchId: "b1", returned: false, image: "", stock: 5, rented: 2 },
          { sheetType: "general", rowIndex: 3, borrowerName: "김철수", itemLabel: "[000012] 삼각대 x 1", location: "000012", itemId: "000012", itemName: "삼각대", quantity: 1, borrowDate: "2026-07-11 14:00", borrowPurpose: "촬영", email: "", batchId: "b2", generalOption: "일반 대여", returned: true, image: "", stock: 3, rented: 0 },
        ]);
      }
      setLoaded(true);
    } catch (e: any) { showToast(`시나리오 대여 대장을 불러오지 못했습니다: ${e.message}`, "error"); }
    finally { setLoading(false); }
  }, [connected, scriptUrl, showToast]);

  useEffect(() => { load(); }, [load]);

  const borrowers = useMemo(() => {
    const set = new Set<string>();
    logs.forEach((it) => { if (it.borrowerName) set.add(it.borrowerName); });
    return Array.from(set).sort();
  }, [logs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((it) => {
      if (kindFilter !== "all" && it.sheetType !== kindFilter) return false;
      if (statusFilter === "unreturned" && it.returned) return false;
      if (statusFilter === "returned" && !it.returned) return false;
      if (borrowerFilter && it.borrowerName !== borrowerFilter) return false;
      if (!q) return true;
      return it.itemLabel.toLowerCase().includes(q) ||
        it.borrowerName.toLowerCase().includes(q) ||
        (it.scenarioId || "").toLowerCase().includes(q) ||
        (it.borrowPurpose || "").toLowerCase().includes(q) ||
        padSlot(it.location).includes(q);
    });
  }, [logs, search, kindFilter, statusFilter, borrowerFilter]);

  // 신청 단위(batchId+borrower)로 그룹화, 이미 최신순으로 서버 정렬됨
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; borrower: string; scenarioId?: string; date: string; purpose: string; kind: string; items: ScenarioLogEntry[]; allReturned: boolean }>();
    filtered.forEach((it) => {
      const gkey = `${it.borrowerName}|${it.batchId || it.scenarioId || it.borrowDate}`;
      if (!map.has(gkey)) map.set(gkey, { key: gkey, borrower: it.borrowerName, scenarioId: it.scenarioId, date: it.borrowDate, purpose: it.borrowPurpose, kind: it.sheetType === "scenario" ? "SID 대여" : "일반 대여", items: [], allReturned: true });
      const g = map.get(gkey)!;
      g.items.push(it);
      if (!it.returned) g.allReturned = false;
    });
    return Array.from(map.values());
  }, [filtered]);

  // ── 분석: 대여자별·기간별 집계 ──
  const stats = useMemo(() => {
    const byBorrower: Record<string, { total: number; unreturned: number; returned: number }> = {};
    const byItem: Record<string, number> = {};
    const byDay: Record<string, number> = {};
    logs.forEach((l) => {
      const b = l.borrowerName || "(미상)";
      if (!byBorrower[b]) byBorrower[b] = { total: 0, unreturned: 0, returned: 0 };
      byBorrower[b].total += 1;
      if (l.returned) byBorrower[b].returned += 1; else byBorrower[b].unreturned += 1;
      byItem[l.itemName] = (byItem[l.itemName] || 0) + l.quantity;
      const day = String(l.borrowDate || "").slice(0, 10);
      if (day) byDay[day] = (byDay[day] || 0) + 1;
    });
    const topBorrowers = Object.entries(byBorrower).sort((a, b) => b[1].total - a[1].total).slice(0, 5);
    const topItems = Object.entries(byItem).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const recentDays = Object.entries(byDay).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 7);
    return { topBorrowers, topItems, recentDays };
  }, [logs]);

  const selKey = (it: ScenarioLogEntry) => `${it.sheetType}:${it.rowIndex}`;
  const selCount = Object.keys(sel).length;
  const selEntries = useMemo(() => Object.keys(sel).map((k) => logs.find((l) => selKey(l) === k)).filter(Boolean) as ScenarioLogEntry[], [sel, logs]);
  const selHasReturned = selEntries.some((e) => e.returned);
  const selHasUnreturned = selEntries.some((e) => !e.returned);

  function toggle(it: ScenarioLogEntry) {
    const k = selKey(it);
    setSel((p) => { const n = { ...p }; if (k in n) delete n[k]; else n[k] = it.quantity; return n; });
  }
  function toggleGroup(g: { items: ScenarioLogEntry[] }) {
    setSel((p) => {
      const n = { ...p };
      const allSel = g.items.every((it) => selKey(it) in n);
      g.items.forEach((it) => { const k = selKey(it); if (allSel) delete n[k]; else n[k] = it.quantity; });
      return n;
    });
  }

  async function doReturn() {
    if (!isAdmin) { showToast("반납 처리는 관리자만 가능합니다.", "warn"); return; }
    const targets = selEntries.filter((e) => !e.returned);
    if (!targets.length) { showToast("반납할(미반납) 물품을 선택해주세요.", "warn"); return; }
    setSubmitting(true);
    try {
      const reqs: ReturnRequest[] = targets.map((e) => ({ sheetType: e.sheetType, rowIndex: e.rowIndex, quantity: sel[selKey(e)] }));
      if (connected && scriptUrl) {
        const res = await postProcessReturn(scriptUrl, reqs, appVersion);
        if (!res.success) { showToast(res.message || "반납 처리 실패", "error"); return; }
        showToast(res.message || `${targets.length}건을 반납 처리했습니다.`, "ok");
      } else { showToast("데모 모드: 실제 반납은 연동 시 동작합니다.", "info"); }
      await load();
    } catch (e: any) { showToast(`반납 처리 실패: ${e.message}`, "error"); }
    finally { setSubmitting(false); }
  }

  async function doReBorrow() {
    if (!isAdmin) { showToast("재대여는 관리자만 가능합니다.", "warn"); return; }
    const targets = selEntries.filter((e) => e.returned);
    if (!targets.length) { showToast("재대여할(반납완료) 물품을 선택해주세요.", "warn"); return; }
    // 대여자별로 묶어서 각각 재대여
    const byBorrower: Record<string, ScenarioLogEntry[]> = {};
    targets.forEach((e) => { (byBorrower[e.borrowerName] ||= []).push(e); });
    setReborrowing(true);
    try {
      if (connected && scriptUrl) {
        let ok = 0;
        for (const b of Object.keys(byBorrower)) {
          const res = await reBorrowScenarioLogs(scriptUrl, byBorrower[b], appVersion);
          if (res.success) ok += byBorrower[b].length;
          else showToast(`${b} 재대여 실패: ${res.message}`, "error");
        }
        if (ok) showToast(`${ok}건을 동일 조건으로 다시 대여 신청했습니다.`, "ok");
      } else { showToast("데모 모드: 실제 재대여는 연동 시 동작합니다.", "info"); }
      await load();
    } catch (e: any) { showToast(`재대여 실패: ${e.message}`, "error"); }
    finally { setReborrowing(false); }
  }

  const inputStyle: React.CSSProperties = {
    padding: "10px 12px", fontSize: "13px", borderRadius: "10px",
    border: `1px solid ${C.border}`, background: isLightMode ? "#ffffff" : "#0f172a",
    color: C.text, outline: "none", boxSizing: "border-box",
  };
  function Spinner({ size = 20 }: { size?: number }) {
    return <span style={{ width: size, height: size, borderRadius: "50%", display: "inline-block", border: `3px solid ${C.border}`, borderTopColor: C.accent, animation: "slp-spin 0.9s linear infinite" }} />;
  }

  const total = logs.length;
  const unreturnedCount = logs.filter((l) => !l.returned).length;
  const returnedCount = logs.filter((l) => l.returned).length;

  return (
    <div>
      <style>{`@keyframes slp-spin { to { transform: rotate(360deg); } }`}</style>

      {/* 요약 통계 */}
      <div style={{ display: "flex", gap: "10px", marginBottom: "12px", flexWrap: "wrap" }}>
        {[
          { label: "전체 기록", value: total, color: C.accentText, bg: C.accentSoft, icon: <Package size={16} /> },
          { label: "미반납", value: unreturnedCount, color: C.warn, bg: C.warnSoft, icon: <Clock size={16} /> },
          { label: "반납 완료", value: returnedCount, color: C.success, bg: C.successSoft, icon: <CheckCircle2 size={16} /> },
        ].map((s) => (
          <div key={s.label} style={{ flex: "1 1 120px", padding: "12px 14px", borderRadius: "12px", background: s.bg, border: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: C.label, fontWeight: 600 }}>{s.icon} {s.label}</div>
            <div style={{ fontSize: "22px", fontWeight: 800, color: s.color }}>{s.value}</div>
          </div>
        ))}
        <button onClick={() => setShowStats((v) => !v)} style={{ flex: "0 0 auto", padding: "0 16px", borderRadius: "12px", border: `1px solid ${showStats ? C.accent : C.border}`, background: showStats ? C.accentSoft : C.card, color: showStats ? C.accentText : C.label, cursor: "pointer", fontSize: "12px", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px" }}>
          <TrendingUp size={15} /> 분석 {showStats ? "닫기" : "보기"}
        </button>
      </div>

      {/* 분석 패널 */}
      {showStats ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "12px", marginBottom: "14px" }}>
          <StatCard C={C} title="대여자별 (상위 5)" rows={stats.topBorrowers.map(([name, v]) => ({ label: name, value: `${v.total}건 (미반납 ${v.unreturned})` }))} />
          <StatCard C={C} title="많이 대여된 물품 (상위 5)" rows={stats.topItems.map(([name, v]) => ({ label: name, value: `${v}개` }))} />
          <StatCard C={C} title="최근 대여일별 (7일)" rows={stats.recentDays.map(([day, v]) => ({ label: day, value: `${v}건` }))} />
        </div>
      ) : null}

      {/* 필터 */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "8px", flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: "2 1 240px", minWidth: 0 }}>
          <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="물품 · 대여자 · SID · 목적 · 위치로 검색..." style={{ ...inputStyle, paddingLeft: "36px", width: "100%" }} />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} style={{ ...inputStyle, flex: "1 1 120px", minWidth: 0 }}>
          <option value="all">전체 상태</option>
          <option value="unreturned">미반납만</option>
          <option value="returned">반납완료만</option>
        </select>
        <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as any)} style={{ ...inputStyle, flex: "1 1 120px", minWidth: 0 }}>
          <option value="all">전체 유형</option>
          <option value="scenario">SID 대여</option>
          <option value="general">일반 대여</option>
        </select>
        <select value={borrowerFilter} onChange={(e) => setBorrowerFilter(e.target.value)} style={{ ...inputStyle, flex: "1 1 120px", minWidth: 0 }}>
          <option value="">전체 대여자</option>
          {borrowers.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <button onClick={load} title="새로고침" style={{ ...inputStyle, cursor: "pointer", display: "flex", alignItems: "center", gap: "5px", fontWeight: 700, color: C.accentText }}><RotateCcw size={14} /></button>
      </div>
      <div style={{ fontSize: "12px", color: C.label, marginBottom: "12px" }}>{loaded ? `${filtered.length} / ${logs.length}건 (최신순)` : ""}</div>

      {loading && !loaded ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", padding: "64px 0", color: C.label }}><Spinner size={30} /> 불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "64px 0", color: C.label }}><Check size={36} style={{ color: C.border, marginBottom: "8px" }} /><div>표시할 대여 기록이 없습니다.</div></div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {groups.map((g) => (
            <div key={g.key} style={{ border: `1px solid ${C.border}`, borderRadius: "14px", background: C.card, overflow: "hidden", opacity: g.allReturned ? 0.85 : 1 }}>
              <div onClick={() => isAdmin && toggleGroup(g)} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 16px", borderBottom: `1px solid ${C.border}`, background: C.cardSub, cursor: isAdmin ? "pointer" : "default" }}>
                <div style={{ width: 34, height: 34, borderRadius: "9px", background: g.allReturned ? C.successSoft : C.accentSoft, color: g.allReturned ? C.success : C.accentText, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><User size={17} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: "14px" }}>{g.borrower} {g.scenarioId ? <span style={{ fontSize: "11px", color: C.warn, fontWeight: 700 }}>· {g.scenarioId}</span> : null}</div>
                  <div style={{ fontSize: "11px", color: C.label }}>{g.kind} · {g.date}{g.purpose ? ` · ${g.purpose}` : ""}</div>
                </div>
                {g.allReturned ? <span style={{ fontSize: "11px", fontWeight: 700, color: C.success, background: C.successSoft, padding: "3px 10px", borderRadius: "20px", flexShrink: 0 }}>반납완료</span>
                  : <span style={{ fontSize: "11px", fontWeight: 700, color: C.warn, background: C.warnSoft, padding: "3px 10px", borderRadius: "20px", flexShrink: 0 }}>미반납 포함</span>}
              </div>
              <div style={{ padding: "8px 12px" }}>
                {g.items.map((it) => {
                  const k = selKey(it);
                  const checked = k in sel;
                  return (
                    <div key={k} onClick={() => isAdmin && toggle(it)} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "9px 8px", borderRadius: "10px", cursor: isAdmin ? "pointer" : "default", background: checked ? C.accentSoft : "transparent" }}>
                      {isAdmin ? <input type="checkbox" readOnly checked={checked} style={{ width: 16, height: 16, accentColor: C.accent, flexShrink: 0 }} /> : <Package size={15} style={{ color: C.label, flexShrink: 0 }} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "13px", fontWeight: 600, wordBreak: "break-word", textDecoration: it.returned ? "line-through" : "none", opacity: it.returned ? 0.7 : 1 }}>{it.itemLabel}</div>
                        <div style={{ display: "flex", gap: "6px", marginTop: "3px", flexWrap: "wrap" }}>
                          {it.location ? <span style={{ display: "inline-flex", alignItems: "center", gap: "3px", fontSize: "10px", fontWeight: 700, color: C.warn, background: C.warnSoft, borderRadius: "6px", padding: "2px 7px", fontFamily: "monospace" }}><MapPin size={10} />{padSlot(it.location)}</span> : null}
                          {it.returned ? <span style={{ fontSize: "10px", fontWeight: 700, color: C.success, background: C.successSoft, borderRadius: "6px", padding: "2px 7px" }}>반납완료</span> : <span style={{ fontSize: "10px", fontWeight: 700, color: C.warn, background: C.warnSoft, borderRadius: "6px", padding: "2px 7px" }}>미반납</span>}
                          {it.itemKind ? <span style={{ fontSize: "10px", fontWeight: 700, color: C.accentText, background: C.accentSoft, borderRadius: "6px", padding: "2px 7px" }}>{it.itemKind}</span> : null}
                        </div>
                      </div>
                      <span style={{ fontSize: "12px", color: C.label, fontWeight: 600, flexShrink: 0 }}>x{it.quantity}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 액션 바 (관리자) */}
      {isAdmin && selCount > 0 ? (
        <div style={{ position: "sticky", bottom: 0, marginTop: "16px", padding: "14px 16px", background: C.card, border: `1px solid ${C.accent}`, borderRadius: "14px", display: "flex", alignItems: "center", gap: "10px", boxShadow: "0 -4px 16px rgba(0,0,0,0.15)", flexWrap: "wrap" }}>
          <span style={{ flex: 1, fontSize: "13px", fontWeight: 700, minWidth: "80px" }}>{selCount}건 선택됨</span>
          <button onClick={() => setSel({})} style={{ padding: "10px 14px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.card, color: C.label, cursor: "pointer", fontSize: "13px", fontWeight: 700 }}>해제</button>
          {selHasReturned ? (
            <button onClick={doReBorrow} disabled={reborrowing} title="반납완료된 항목을 동일 조건으로 다시 대여" style={{ padding: "10px 16px", borderRadius: "10px", border: "none", background: C.warn, color: "#fff", cursor: "pointer", fontSize: "13px", fontWeight: 700, display: "flex", alignItems: "center", gap: "7px", opacity: reborrowing ? 0.7 : 1 }}>
              {reborrowing ? <><Spinner size={14} /> 처리 중...</> : <><Repeat size={15} /> 다시 대여</>}
            </button>
          ) : null}
          {selHasUnreturned ? (
            <button onClick={doReturn} disabled={submitting} style={{ padding: "10px 18px", borderRadius: "10px", border: "none", background: C.accent, color: "#fff", cursor: "pointer", fontSize: "13px", fontWeight: 700, display: "flex", alignItems: "center", gap: "7px", opacity: submitting ? 0.7 : 1 }}>
              {submitting ? <><Spinner size={14} /> 처리 중...</> : <><Undo2 size={15} /> 반납 처리</>}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function StatCard({ C, title, rows }: { C: any; title: string; rows: { label: string; value: string }[] }) {
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: "12px", background: C.card, padding: "14px 16px" }}>
      <div style={{ fontSize: "12px", fontWeight: 800, color: C.accentText, marginBottom: "10px" }}>{title}</div>
      {rows.length === 0 ? <div style={{ fontSize: "12px", color: C.label }}>데이터 없음</div> : rows.map((r, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: i < rows.length - 1 ? `1px solid ${C.border}` : "none", gap: "8px" }}>
          <span style={{ fontSize: "12px", color: C.text, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.label}</span>
          <span style={{ fontSize: "12px", color: C.label, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}>{r.value}</span>
        </div>
      ))}
    </div>
  );
}
