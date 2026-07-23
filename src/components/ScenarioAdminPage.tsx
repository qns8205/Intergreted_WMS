import React, { useState, useMemo, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Search, Plus, X, Pencil, Trash2, MapPin, Boxes, Upload, Save, Image as ImageIcon, Users, RotateCcw, ClipboardCheck, ArrowUpDown, History,
} from "lucide-react";
import StockAdjustModal from "./StockAdjustModal";
import ScrollToTopButton from "./ScrollToTopButton";
import {
  ScenarioObjectAdmin, padSlot,
  fetchScenarioObjectsForAdmin, updateScenarioObject, addScenarioObject, deleteScenarioObject,
  fetchUnreturnedItems, UnreturnedItem,
  fetchStockAuditHistory, recordStockAudit, StockAuditRecord,
  fetchStockFormulaStatus, StockFormulaStatus,
  fetchScenarioAllLogs, ScenarioLogEntry,
} from "../utils/borrowApi";
import { getGoogleDriveImageUrl, resizeAndCompressImage } from "../utils/drive";
import { smartMatch } from "../utils/search";

interface Props {
  scriptUrl: string;
  connected: boolean;
  isLightMode: boolean;
  showToast: (msg: string, type: "ok" | "error" | "info" | "warn") => void;
}

type EditForm = Partial<ScenarioObjectAdmin> & { rowIndex?: number };

export default function ScenarioAdminPage({ scriptUrl, connected, isLightMode, showToast }: Props) {
  const C = {
    bg: isLightMode ? "#f8fafc" : "#0b0f19",
    card: isLightMode ? "#ffffff" : "#161f30",
    cardSub: isLightMode ? "#f4f6f9" : "#0f172a",
    border: isLightMode ? "#e6e9ef" : "#26324a",
    text: isLightMode ? "#111827" : "#f1f5f9",
    label: isLightMode ? "#2563eb" : "#94a3b8",
    accent: "#2563eb",
    accentSoft: isLightMode ? "rgba(37,99,235,0.09)" : "rgba(148,163,184,0.14)",
    accentText: isLightMode ? "#111827" : "#f1f5f9",
    success: isLightMode ? "#047857" : "#34d399",
    successSoft: "rgba(16, 185, 129, 0.12)",
    warn: isLightMode ? "#b45309" : "#fbbf24",
    warnSoft: "rgba(245, 158, 11, 0.12)",
    error: isLightMode ? "#dc2626" : "#f87171",
    errorSoft: "rgba(239, 68, 68, 0.12)",
  };

  const [items, setItems] = useState<ScenarioObjectAdmin[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("");
  const [editing, setEditing] = useState<EditForm | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [modalUrl, setModalUrl] = useState("");

  // 오브젝트 클릭 시 "누가 얼마나 빌려갔는지" 보여주는 대여자 상세 모달
  const [borrowersItem, setBorrowersItem] = useState<ScenarioObjectAdmin | null>(null);
  const [stockAdjustItem, setStockAdjustItem] = useState<ScenarioObjectAdmin | null>(null);
  const [unreturned, setUnreturned] = useState<UnreturnedItem[]>([]);
  const [unreturnedLoading, setUnreturnedLoading] = useState(false);
  const [unreturnedLoaded, setUnreturnedLoaded] = useState(false);
  const [detailTab, setDetailTab] = useState<"borrowers" | "audit" | "history">("borrowers");

  // 재고 실사 기록 (수동으로 세어본 수량 vs 시스템 재고)
  const [auditHistory, setAuditHistory] = useState<StockAuditRecord[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditLoadedForId, setAuditLoadedForId] = useState<string | null>(null);
  const [auditCountInput, setAuditCountInput] = useState("");
  const [auditNote, setAuditNote] = useState("");
  const [auditSubmitting, setAuditSubmitting] = useState(false);

  // 진단: 왜 이런 차이가 발생했는지 지금까지의 기록으로 추측
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosedForId, setDiagnosedForId] = useState<string | null>(null);
  const [formulaStatus, setFormulaStatus] = useState<StockFormulaStatus | null>(null);
  const [itemLogs, setItemLogs] = useState<ScenarioLogEntry[]>([]);
  // "전체 이력" 탭: 이 물품의 지금까지의 모든 대여·반납 기록 (반납완료 포함)
  const [historyLogs, setHistoryLogs] = useState<ScenarioLogEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadedForId, setHistoryLoadedForId] = useState<string | null>(null);

  const loadHistory = useCallback(async (itemId: string) => {
    setHistoryLoading(true);
    try {
      if (connected && scriptUrl) {
        const logs = await fetchScenarioAllLogs(scriptUrl);
        const targetId = padSlot(itemId);
        setHistoryLogs(logs.filter((l) => l.itemId && padSlot(l.itemId) === targetId));
      } else {
        setHistoryLogs([]);
      }
      setHistoryLoadedForId(itemId);
    } catch (e: any) {
      showToast(`대여·반납 기록을 불러오지 못했습니다: ${e.message}`, "error");
    } finally {
      setHistoryLoading(false);
    }
  }, [connected, scriptUrl, showToast]);

  const loadUnreturned = useCallback(async () => {
    setUnreturnedLoading(true);
    try {
      if (connected && scriptUrl) setUnreturned(await fetchUnreturnedItems(scriptUrl));
      else setUnreturned([]);
      setUnreturnedLoaded(true);
    } catch (e: any) {
      showToast(`대여 현황을 불러오지 못했습니다: ${e.message}`, "error");
    } finally {
      setUnreturnedLoading(false);
    }
  }, [connected, scriptUrl, showToast]);

  const loadAuditHistory = useCallback(async (itemId: string) => {
    setAuditLoading(true);
    try {
      if (connected && scriptUrl) {
        setAuditHistory(await fetchStockAuditHistory(scriptUrl, itemId));
      } else {
        setAuditHistory([]);
      }
      setAuditLoadedForId(itemId);
    } catch (e: any) {
      showToast(`재고 실사 기록을 불러오지 못했습니다: ${e.message}`, "error");
    } finally {
      setAuditLoading(false);
    }
  }, [connected, scriptUrl, showToast]);

  function openBorrowers(it: ScenarioObjectAdmin) {
    setBorrowersItem(it);
    setDetailTab("borrowers");
    setAuditCountInput("");
    setAuditNote("");
    setDiagnosedForId(null);
    setFormulaStatus(null);
    setItemLogs([]);
    setHistoryLoadedForId(null);
    setHistoryLogs([]);
    if (!unreturnedLoaded && !unreturnedLoading) loadUnreturned();
  }

  async function runDiagnosis() {
    if (!borrowersItem) return;
    setDiagnosing(true);
    try {
      if (connected && scriptUrl) {
        const [status, logs] = await Promise.all([
          fetchStockFormulaStatus(scriptUrl, borrowersItem.id),
          fetchScenarioAllLogs(scriptUrl),
        ]);
        setFormulaStatus(status);
        const targetId = padSlot(borrowersItem.id);
        setItemLogs(logs.filter((l) => l.itemId && padSlot(l.itemId) === targetId));
      } else {
        setFormulaStatus({ found: true, stockIsFormula: false, rentedIsFormula: false });
        setItemLogs([]);
      }
      setDiagnosedForId(borrowersItem.id);
    } catch (e: any) {
      showToast(`진단 정보를 불러오지 못했습니다: ${e.message}`, "error");
    } finally {
      setDiagnosing(false);
    }
  }

  // 날짜 문자열("yyyy-MM-dd HH:mm:ss" 등)을 타임스탬프로. 실패 시 0.
  function parseTs(v?: string): number {
    const s = String(v || "").trim();
    if (!s) return 0;
    const t = Date.parse(s.replace(" ", "T"));
    return isNaN(t) ? 0 : t;
  }

  async function submitAudit() {
    if (!borrowersItem) return;
    const actual = parseInt(auditCountInput, 10);
    if (isNaN(actual) || actual < 0) { showToast("실사 수량을 올바르게 입력해주세요.", "warn"); return; }
    setAuditSubmitting(true);
    try {
      if (connected && scriptUrl) {
        const res = await recordStockAudit(scriptUrl, {
          itemId: borrowersItem.id,
          itemName: borrowersItem.name,
          systemStock: borrowersItem.stock || 0,
          actualCount: actual,
          note: auditNote.trim(),
        });
        if (!res.success) { showToast(res.message || "재고 실사 기록에 실패했습니다.", "error"); return; }
        showToast("재고 실사를 기록했습니다.", "ok");
      } else {
        showToast("데모 모드: 실제 저장은 연동 시 동작합니다.", "info");
      }
      setAuditCountInput("");
      setAuditNote("");
      loadAuditHistory(borrowersItem.id);
    } catch (e: any) {
      showToast(`재고 실사 기록 실패: ${e.message}`, "error");
    } finally {
      setAuditSubmitting(false);
    }
  }

  // 선택된 오브젝트를 현재 대여 중인 사람들 (동일 물품 ID 기준)
  const borrowersForItem = useMemo(() => {
    if (!borrowersItem) return [];
    const targetId = padSlot(borrowersItem.id);
    return unreturned
      .filter((u) => (u.itemId ? padSlot(u.itemId) === targetId : false))
      .sort((a, b) => (a.borrowDate < b.borrowDate ? 1 : -1));
  }, [unreturned, borrowersItem]);

  // 실사 기록 사이 구간마다: 로그 기반 예상 변화량 vs 실제 시스템 재고 변화량을 비교해
  // 기록에 안 잡히는 변동(수동 수정, 누락된 반납 처리 등)이 있었는지 짚어준다.
  const diagnosis = useMemo(() => {
    if (!borrowersItem || diagnosedForId !== borrowersItem.id) return null;

    const overdueDays = 14;
    const now = Date.now();
    const overdue = borrowersForItem
      .map((u) => ({ ...u, days: Math.floor((now - parseTs(u.borrowDate)) / 86400000) }))
      .filter((u) => u.days >= overdueDays)
      .sort((a, b) => b.days - a.days);

    // 실사 기록을 오래된 순으로 정렬하고, 구간별 대여/반납 순변화를 로그와 대조
    const auditsAsc = [...auditHistory].sort((a, b) => parseTs(a.auditedAt) - parseTs(b.auditedAt));
    const points = [
      ...auditsAsc.map((a) => ({ label: a.auditedAt, ts: parseTs(a.auditedAt), systemStock: a.systemStock })),
      { label: "현재", ts: now, systemStock: borrowersItem.stock || 0 },
    ];

    const windows: { from: string; to: string; expected: number; actual: number; mismatch: number; borrowCount: number; returnCount: number }[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const from = points[i], to = points[i + 1];
      if (to.ts <= from.ts) continue;
      let borrowQty = 0, returnQty = 0, borrowCount = 0, returnCount = 0;
      itemLogs.forEach((l) => {
        const bts = parseTs(l.borrowDate);
        if (bts > from.ts && bts <= to.ts) { borrowQty += l.quantity || 1; borrowCount++; }
        const rts = parseTs(l.returnDate);
        if (l.returned && rts > from.ts && rts <= to.ts) { returnQty += l.quantity || 1; returnCount++; }
      });
      const expected = returnQty - borrowQty; // 반납은 재고 증가, 대여는 재고 감소
      const actual = to.systemStock - from.systemStock;
      const mismatch = actual - expected;
      windows.push({ from: from.label, to: to.label, expected, actual, mismatch, borrowCount, returnCount });
    }

    const hasIssue = !!(formulaStatus?.stockIsFormula) || overdue.length > 0 || windows.some((w) => w.mismatch !== 0);

    return { overdue, windows, hasIssue };
  }, [borrowersItem, diagnosedForId, borrowersForItem, auditHistory, itemLogs, formulaStatus]);

  useEffect(() => {
    if (detailTab === "audit" && borrowersItem && auditLoadedForId !== borrowersItem.id && !auditLoading) {
      loadAuditHistory(borrowersItem.id);
    }
  }, [detailTab, borrowersItem, auditLoadedForId, auditLoading, loadAuditHistory]);

  useEffect(() => {
    if (detailTab === "history" && borrowersItem && historyLoadedForId !== borrowersItem.id && !historyLoading) {
      loadHistory(borrowersItem.id);
    }
  }, [detailTab, borrowersItem, historyLoadedForId, historyLoading, loadHistory]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (connected && scriptUrl) setItems(await fetchScenarioObjectsForAdmin(scriptUrl));
      else setItems([
        { rowIndex: 2, id: "000008", name: "fruit", sector: "Seoul-Root", rootSlot: "000060", category: "식음료", subcategory: "간식 및 식사류", image: "", stock: 15, rented: 8 },
      ]);
      setLoaded(true);
    } catch (e: any) { showToast(`시나리오 물품을 불러오지 못했습니다: ${e.message}`, "error"); }
    finally { setLoading(false); }
  }, [connected, scriptUrl, showToast]);

  useEffect(() => { load(); }, [load]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    items.forEach((it) => { if (it.category) set.add(it.category); });
    return Array.from(set).sort();
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim();
    return items.filter((it) => {
      if (cat && it.category !== cat) return false;
      if (!q) return true;
      const slotPad = padSlot(it.rootSlot);
      return smartMatch([it.name, it.id, it.category, it.subcategory, slotPad, it.rootSlot], q);
    }).sort((a, b) => {
      // Location(rootSlot) 기준 정렬 (숫자 오름차순, 위치 없는 항목은 뒤로)
      const na = parseInt(String(a.rootSlot ?? "").replace(/\D/g, ""), 10);
      const nb = parseInt(String(b.rootSlot ?? "").replace(/\D/g, ""), 10);
      const va = isNaN(na) ? Number.MAX_SAFE_INTEGER : na;
      const vb = isNaN(nb) ? Number.MAX_SAFE_INTEGER : nb;
      if (va !== vb) return va - vb;
      return a.name.localeCompare(b.name);
    });
  }, [items, search, cat]);

  function openEdit(it: ScenarioObjectAdmin) { setEditing({ ...it }); setIsNew(false); }
  function openNew() {
    setEditing({ id: "", name: "", sector: "", rootSlot: "", category: "", subcategory: "", image: "", stock: 0 });
    setIsNew(true);
  }

  async function handleFile(file: File) {
    try {
      setUploading(true);
      const base64 = await resizeAndCompressImage(file, 1200, 1200, 0.75);
      setEditing((p) => (p ? { ...p, image: base64 } : p));
    } catch (e: any) { showToast(`이미지 처리 실패: ${e.message || e}`, "error"); }
    finally { setUploading(false); }
  }

  async function save() {
    if (!editing) return;
    if (!editing.name?.trim()) { showToast("물품명을 입력해주세요.", "warn"); return; }
    if (isNew && !editing.id?.trim()) { showToast("ID를 입력해주세요.", "warn"); return; }
    setSaving(true);
    try {
      if (connected && scriptUrl) {
        if (isNew) {
          const res = await addScenarioObject(scriptUrl, editing);
          if (res && res.success && res.item) setItems((p) => [...p, res.item]);
          showToast("시나리오 물품을 추가했습니다.", "ok");
        } else {
          const res = await updateScenarioObject(scriptUrl, editing as any);
          if (res && res.success && res.item) setItems((p) => p.map((x) => (x.rowIndex === res.item.rowIndex ? res.item : x)));
          showToast("수정 사항을 저장했습니다.", "ok");
        }
      } else {
        showToast("데모 모드: 실제 저장은 연동 시 동작합니다.", "info");
      }
      setEditing(null);
    } catch (e: any) { showToast(`저장 실패: ${e.message}`, "error"); }
    finally { setSaving(false); }
  }

  async function remove(it: ScenarioObjectAdmin) {
    if (!window.confirm(`'${it.name}'(${it.id})을(를) 삭제할까요? 시트에서 행이 제거됩니다.`)) return;
    try {
      if (connected && scriptUrl) await deleteScenarioObject(scriptUrl, it.rowIndex);
      setItems((p) => p.filter((x) => x.rowIndex !== it.rowIndex));
      showToast("삭제했습니다.", "ok");
    } catch (e: any) { showToast(`삭제 실패: ${e.message}`, "error"); }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "11px 13px", fontSize: "14px", borderRadius: "10px",
    border: `1px solid ${C.border}`, background: isLightMode ? "#ffffff" : "#0f172a",
    color: C.text, outline: "none", boxSizing: "border-box",
  };
  const lblStyle: React.CSSProperties = { display: "block", fontSize: "12px", fontWeight: 700, color: C.label, marginBottom: "5px" };

  function Spinner({ size = 20 }: { size?: number }) {
    return <span style={{ width: size, height: size, borderRadius: "50%", display: "inline-block", border: `3px solid ${C.border}`, borderTopColor: C.accent, animation: "sap-spin 0.9s linear infinite" }} />;
  }

  return (
    <div className="sap-root">
      <style>{`
        @keyframes sap-spin { to { transform: rotate(360deg); } }
        @media (min-width: 900px) {
          .sap-root { zoom: 1.15; }
        }
      `}</style>

      {/* 필터 바 (스크롤해도 고정) */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "14px", flexWrap: "wrap", alignItems: "center", position: "sticky", top: 0, zIndex: 30, background: "var(--canvas-bg, #020617)", padding: "10px 0" }}>
        <div style={{ position: "relative", flex: "2 1 260px", minWidth: 0 }}>
          <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ID · 물품명 · 위치 · 카테고리로 검색..." style={{ ...inputStyle, paddingLeft: "36px" }} />
        </div>
        <select value={cat} onChange={(e) => setCat(e.target.value)} style={{ ...inputStyle, flex: "1 1 160px", minWidth: 0 }}>
          <option value="">전체 카테고리</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button onClick={openNew} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "11px 16px", borderRadius: "10px", border: "none", background: C.accent, color: "#fff", cursor: "pointer", fontSize: "13px", fontWeight: 700, whiteSpace: "nowrap" }}>
          <Plus size={15} /> 새 물품
        </button>
      </div>
      <div style={{ fontSize: "12px", color: C.label, marginBottom: "12px" }}>{loaded ? `${filtered.length} / ${items.length}개 시나리오 물품` : ""}</div>

      {loading && !loaded ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", padding: "64px 0", color: C.label }}><Spinner size={30} /> 불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "64px 0", color: C.label }}>결과가 없습니다.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: "16px" }}>
          {filtered.map((it) => (
            <div
              key={it.rowIndex}
              onClick={() => openBorrowers(it)}
              style={{ border: `1px solid ${C.border}`, background: C.card, borderRadius: "16px", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 2px 4px rgba(0,0,0,0.04)", cursor: "pointer" }}
            >
              <div onClick={(e) => { e.stopPropagation(); if (it.image) setModalUrl(getGoogleDriveImageUrl(it.image)); }} style={{ height: "150px", background: C.cardSub, display: "flex", alignItems: "center", justifyContent: "center", cursor: it.image ? "zoom-in" : "default", borderBottom: `1px solid ${C.border}` }}>
                {it.image ? <img src={getGoogleDriveImageUrl(it.image)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Boxes size={40} style={{ color: C.border }} />}
              </div>
              <div style={{ padding: "12px 14px", flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
                <div style={{ fontWeight: 700, fontSize: "14px", lineHeight: 1.35, wordBreak: "break-word" }}>{it.name}</div>
                <div style={{ fontSize: "11px", color: C.label }}>ID: {it.id}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                  {it.rootSlot ? <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "10px", fontWeight: 700, color: C.warn, background: C.warnSoft, borderRadius: "6px", padding: "2px 7px", fontFamily: "monospace" }}><MapPin size={11} />{padSlot(it.rootSlot)}</span> : <span style={{ fontSize: "10px", fontWeight: 700, color: C.error, background: C.errorSoft, borderRadius: "6px", padding: "2px 7px" }}>위치 없음</span>}
                  {it.category ? <span style={{ fontSize: "10px", fontWeight: 700, padding: "2px 7px", borderRadius: "6px", background: C.accentSoft, color: C.accentText }}>{it.category}</span> : null}
                </div>
                <div style={{ display: "flex", gap: "6px", fontSize: "11px", fontWeight: 600 }}>
                  <span style={{ color: C.success, background: C.successSoft, padding: "2px 8px", borderRadius: "6px" }}>재고 {it.stock}</span>
                  <span style={{ color: C.accentText, background: C.accentSoft, padding: "2px 8px", borderRadius: "6px" }}>대여 중 {it.rented}</span>
                </div>
                <div style={{ marginTop: "auto", paddingTop: "8px", display: "flex", flexDirection: "column", gap: "6px" }} onClick={(e) => e.stopPropagation()}>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <button onClick={() => openEdit(it)} style={{ flex: 1, padding: "8px", borderRadius: "9px", border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", fontSize: "12px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: "5px" }}><Pencil size={13} /> 편집</button>
                    <button onClick={() => remove(it)} style={{ flex: "0 0 auto", padding: "8px 10px", borderRadius: "9px", border: "none", background: C.errorSoft, color: C.error, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Trash2 size={13} /></button>
                  </div>
                  <button onClick={() => setStockAdjustItem(it)} style={{ padding: "8px", borderRadius: "9px", border: "none", background: C.accentSoft, color: C.accentText, cursor: "pointer", fontSize: "12px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: "5px" }}><ArrowUpDown size={13} /> 재고 변경</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 편집 모달 (뷰포트 중앙 고정 — 사이드바 영향 없이 화면 정중앙) */}
      {editing ? createPortal(
        <div className="sap-root" onClick={() => !saving && setEditing(null)} style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(520px, 100%)", maxHeight: "90vh", overflowY: "auto", background: C.card, borderRadius: "14px", border: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "18px 20px", borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, background: C.card, zIndex: 1 }}>
              <h2 style={{ flex: 1, fontSize: "16px", fontWeight: 800, margin: 0 }}>{isNew ? "새 시나리오 물품" : "시나리오 물품 편집"}</h2>
              <button onClick={() => !saving && setEditing(null)} style={{ background: "none", border: "none", color: C.label, cursor: "pointer" }}><X size={20} /></button>
            </div>
            <div style={{ padding: "20px" }}>
              {/* 이미지 */}
              <label style={lblStyle}>사진</label>
              <div style={{ display: "flex", gap: "12px", marginBottom: "16px", alignItems: "flex-start" }}>
                <div style={{ flex: "0 0 96px", width: 96, height: 96, borderRadius: "12px", overflow: "hidden", border: `1px solid ${C.border}`, background: C.cardSub, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {editing.image ? (
                    <img src={editing.image.startsWith("data:image/") ? editing.image : getGoogleDriveImageUrl(editing.image)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : <ImageIcon size={28} style={{ color: C.border }} />}
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "8px" }}>
                  <button onClick={() => document.getElementById("sap-photo-upload")?.click()} disabled={uploading} style={{ padding: "10px", borderRadius: "10px", border: `1px dashed ${C.accent}`, background: C.accentSoft, color: C.accentText, cursor: "pointer", fontSize: "13px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                    {uploading ? <><Spinner size={14} /> 처리 중...</> : <><Upload size={14} /> 이미지 업로드</>}
                  </button>
                  <input id="sap-photo-upload" type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.currentTarget.value = ""; }} />
                  <input value={editing.image && editing.image.startsWith("data:image/") ? "" : (editing.image || "")} disabled={!!(editing.image && editing.image.startsWith("data:image/"))} onChange={(e) => setEditing((p) => (p ? { ...p, image: e.target.value } : p))} placeholder={editing.image && editing.image.startsWith("data:image/") ? "파일이 업로드되었습니다" : "드라이브 공유 링크 직접 입력"} style={{ ...inputStyle, fontSize: "12px", opacity: editing.image && editing.image.startsWith("data:image/") ? 0.6 : 1 }} />
                  {editing.image ? <button onClick={() => setEditing((p) => (p ? { ...p, image: "" } : p))} style={{ fontSize: "11px", color: C.error, background: "none", border: "none", cursor: "pointer", textAlign: "left", fontWeight: 600 }}>이미지 제거</button> : null}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
                <div>
                  <label style={lblStyle}>ID {isNew ? <span style={{ color: C.error }}>*</span> : null}</label>
                  <input value={editing.id || ""} disabled={!isNew} onChange={(e) => setEditing((p) => (p ? { ...p, id: e.target.value } : p))} placeholder="예: 000008" style={{ ...inputStyle, opacity: isNew ? 1 : 0.6 }} />
                </div>
                <div>
                  <label style={lblStyle}>위치 (root_slot)</label>
                  <input value={editing.rootSlot || ""} onChange={(e) => setEditing((p) => (p ? { ...p, rootSlot: e.target.value } : p))} placeholder="예: 000060" style={inputStyle} />
                </div>
              </div>

              <div style={{ marginBottom: "12px" }}>
                <label style={lblStyle}>물품명 <span style={{ color: C.error }}>*</span></label>
                <input value={editing.name || ""} onChange={(e) => setEditing((p) => (p ? { ...p, name: e.target.value } : p))} placeholder="물품명" style={inputStyle} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
                <div>
                  <label style={lblStyle}>카테고리</label>
                  <input value={editing.category || ""} onChange={(e) => setEditing((p) => (p ? { ...p, category: e.target.value } : p))} placeholder="카테고리" style={inputStyle} list="sap-cat-list" />
                  <datalist id="sap-cat-list">{categories.map((c) => <option key={c} value={c} />)}</datalist>
                </div>
                <div>
                  <label style={lblStyle}>서브카테고리</label>
                  <input value={editing.subcategory || ""} onChange={(e) => setEditing((p) => (p ? { ...p, subcategory: e.target.value } : p))} placeholder="서브카테고리" style={inputStyle} />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "4px" }}>
                <div>
                  <label style={lblStyle}>Sector</label>
                  <input value={editing.sector || ""} onChange={(e) => setEditing((p) => (p ? { ...p, sector: e.target.value } : p))} placeholder="예: Seoul-Root" style={inputStyle} />
                </div>
                <div>
                  <label style={lblStyle}>재고</label>
                  <input type="number" value={editing.stock ?? 0} onChange={(e) => setEditing((p) => (p ? { ...p, stock: e.target.value === "" ? 0 : Number(e.target.value) } : p))} placeholder="0" style={inputStyle} />
                </div>
              </div>
              {!isNew ? <div style={{ fontSize: "11px", color: C.label, marginTop: "8px" }}>재고 열에 수식이 걸려 있으면 재고 값은 무시됩니다. 대여 중({editing.rented ?? 0})은 자동 계산됩니다.</div> : null}

              <div style={{ marginTop: "16px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px", color: C.text }}>
                  <input
                    type="checkbox"
                    checked={!!editing.excludeFromRanking}
                    onChange={(e) => setEditing((p) => (p ? { ...p, excludeFromRanking: e.target.checked } : p))}
                    style={{ width: 16, height: 16, accentColor: C.accent }}
                  />
                  "가장 적게 대여된 물품" 랭킹에서 이 물품 제외
                </label>
              </div>
            </div>
            <div style={{ padding: "16px 20px", borderTop: `1px solid ${C.border}`, display: "flex", gap: "10px", position: "sticky", bottom: 0, background: C.card }}>
              <button onClick={() => setEditing(null)} disabled={saving} style={{ flex: 1, padding: "13px", borderRadius: "11px", border: `1px solid ${C.border}`, background: C.card, color: C.label, cursor: "pointer", fontSize: "14px", fontWeight: 700 }}>취소</button>
              <button onClick={save} disabled={saving || uploading} style={{ flex: 2, padding: "13px", borderRadius: "11px", border: "none", background: C.accent, color: "#fff", cursor: "pointer", fontSize: "14px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: "7px", opacity: saving || uploading ? 0.7 : 1 }}>
                {saving ? <><Spinner size={15} /> 저장 중...</> : <><Save size={15} /> {isNew ? "추가하기" : "저장하기"}</>}
              </button>
            </div>
          </div>
        </div>,
        document.body
      ) : null}

      {/* 오브젝트 상세 모달 (오브젝트 클릭 시 — 대여 현황 / 재고 실사) */}
      {borrowersItem ? createPortal(
        <div className="sap-root" onClick={() => setBorrowersItem(null)} style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(480px, 100%)", maxHeight: "85vh", overflowY: "auto", background: C.card, borderRadius: "14px", border: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "18px 20px 12px", borderBottom: `1px solid ${C.border}`, position: "sticky", top: 0, background: C.card, zIndex: 1 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 style={{ fontSize: "16px", fontWeight: 800, margin: 0 }}>{borrowersItem.name}</h2>
                <div style={{ fontSize: "12px", color: C.label, marginTop: "3px" }}>ID: {borrowersItem.id} · 재고 {borrowersItem.stock} · 대여 중 {borrowersItem.rented}</div>
              </div>
              <button
                onClick={() => {
                  if (detailTab === "borrowers") { if (!unreturnedLoading) loadUnreturned(); }
                  else if (detailTab === "audit") { if (!auditLoading) loadAuditHistory(borrowersItem.id); }
                  else { if (!historyLoading) loadHistory(borrowersItem.id); }
                }}
                disabled={detailTab === "borrowers" ? unreturnedLoading : detailTab === "audit" ? auditLoading : historyLoading}
                title="새로고침"
                style={{ display: "flex", alignItems: "center", gap: "5px", padding: "6px 9px", borderRadius: "8px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.label, cursor: (detailTab === "borrowers" ? unreturnedLoading : detailTab === "audit" ? auditLoading : historyLoading) ? "default" : "pointer", opacity: (detailTab === "borrowers" ? unreturnedLoading : detailTab === "audit" ? auditLoading : historyLoading) ? 0.6 : 1, fontSize: "11px", fontWeight: 700 }}
              >
                <style>{`@keyframes sapSpinBtn { to { transform: rotate(360deg); } } .sap-spin-btn { animation: sapSpinBtn 0.9s linear infinite; }`}</style>
                <RotateCcw size={13} className={(detailTab === "borrowers" ? unreturnedLoading : detailTab === "audit" ? auditLoading : historyLoading) ? "sap-spin-btn" : undefined} />
              </button>
              <button onClick={() => setBorrowersItem(null)} style={{ background: "none", border: "none", color: C.label, cursor: "pointer" }}><X size={20} /></button>
            </div>

            {/* 탭 */}
            <div style={{ display: "flex", gap: "4px", padding: "10px 20px 0", borderBottom: `1px solid ${C.border}`, position: "sticky", top: "69px", background: C.card, zIndex: 1 }}>
              {[
                { key: "borrowers" as const, label: "대여 현황", icon: <Users size={13} /> },
                { key: "history" as const, label: "전체 이력", icon: <History size={13} /> },
                { key: "audit" as const, label: "재고 실사", icon: <ClipboardCheck size={13} /> },
              ].map((t) => (
                <button
                  key={t.key}
                  onClick={() => setDetailTab(t.key)}
                  style={{
                    display: "flex", alignItems: "center", gap: "5px", padding: "9px 14px",
                    border: "none", borderBottom: detailTab === t.key ? `2px solid ${C.accent}` : "2px solid transparent",
                    background: "none", color: detailTab === t.key ? C.accentText : C.label,
                    fontSize: "12.5px", fontWeight: 700, cursor: "pointer",
                  }}
                >
                  {t.icon} {t.label}
                </button>
              ))}
            </div>

            <div style={{ padding: "16px 20px" }}>
              {detailTab === "borrowers" ? (
                unreturnedLoading && !unreturnedLoaded ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", padding: "32px 0", color: C.label }}><Spinner size={26} /> 대여 현황을 불러오는 중...</div>
                ) : borrowersForItem.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "32px 0", color: C.label, fontSize: "13px" }}>현재 이 물품을 대여 중인 사람이 없습니다.</div>
                ) : (
                  <>
                    <div style={{ fontSize: "12px", color: C.label, marginBottom: "10px" }}>
                      총 <b style={{ color: C.accentText }}>{borrowersForItem.reduce((s, u) => s + (u.quantity || 1), 0)}개</b>가 <b style={{ color: C.accentText }}>{new Set(borrowersForItem.map((u) => u.borrowerName)).size}명</b>에게 대여 중
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {borrowersForItem.map((u, idx) => (
                        <div key={`${u.sheetType}-${u.rowIndex}-${idx}`} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", background: C.cardSub, border: `1px solid ${C.border}`, borderRadius: "10px" }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: "13px", color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.borrowerName || "(대여자 미상)"}</div>
                            <div style={{ fontSize: "11px", color: C.label, marginTop: "2px", display: "flex", gap: "5px", alignItems: "center", flexWrap: "wrap" }}>
                              <span>{u.sheetType === "scenario" ? `SID 대여${u.scenarioId ? ` (${u.scenarioId})` : ""}` : "일반 대여"}</span>
                              <span>·</span>
                              <span>{u.borrowDate || "-"}</span>
                            </div>
                          </div>
                          <span style={{ fontSize: "12px", fontWeight: 800, color: C.accentText, background: C.accentSoft, borderRadius: "8px", padding: "3px 10px", flexShrink: 0 }}>{u.quantity || 1}개</span>
                        </div>
                      ))}
                    </div>
                  </>
                )
              ) : detailTab === "history" ? (
                historyLoading && historyLoadedForId !== borrowersItem.id ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", padding: "32px 0", color: C.label }}><Spinner size={26} /> 대여·반납 기록을 불러오는 중...</div>
                ) : historyLogs.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "32px 0", color: C.label, fontSize: "13px" }}>이 물품의 대여·반납 기록이 없습니다.</div>
                ) : (
                  <>
                    <div style={{ fontSize: "12px", color: C.label, marginBottom: "10px" }}>
                      총 <b style={{ color: C.accentText }}>{historyLogs.length}건</b>의 기록 (최신순)
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {[...historyLogs]
                        .sort((a, b) => {
                          const ta = new Date((a.returnDate || a.borrowDate || "").replace(" ", "T")).getTime();
                          const tb = new Date((b.returnDate || b.borrowDate || "").replace(" ", "T")).getTime();
                          return (isNaN(tb) ? 0 : tb) - (isNaN(ta) ? 0 : ta);
                        })
                        .map((l, idx) => (
                          <div key={`${l.sheetType}-${l.rowIndex}-${idx}`} style={{ padding: "10px 12px", background: C.cardSub, border: `1px solid ${C.border}`, borderRadius: "10px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 700, fontSize: "13px", color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.borrowerName || "(대여자 미상)"}</div>
                                <div style={{ fontSize: "11px", color: C.label, marginTop: "2px", display: "flex", gap: "5px", alignItems: "center", flexWrap: "wrap" }}>
                                  <span>{l.sheetType === "scenario" ? `SID 대여${l.scenarioId ? ` (${l.scenarioId})` : ""}` : "일반 대여"}</span>
                                  <span>·</span>
                                  <span>대여 {l.borrowDate || "-"}</span>
                                </div>
                              </div>
                              <span style={{ fontSize: "12px", fontWeight: 800, color: C.accentText, background: C.accentSoft, borderRadius: "8px", padding: "3px 10px", flexShrink: 0 }}>{l.quantity || 1}개</span>
                              <span
                                style={{
                                  fontSize: "10.5px", fontWeight: 800, borderRadius: "999px", padding: "2px 9px", flexShrink: 0,
                                  color: l.returned ? C.success : C.warn,
                                  background: l.returned ? C.successSoft : C.warnSoft,
                                }}
                              >
                                {l.returned ? "반납 완료" : "미반납"}
                              </span>
                            </div>
                            {l.returned && l.returnDate ? (
                              <div style={{ fontSize: "11px", color: C.label, marginTop: "5px" }}>반납 {l.returnDate}</div>
                            ) : null}
                          </div>
                        ))}
                    </div>
                  </>
                )
              ) : (
                <>
                  {/* 실사 입력 */}
                  <div style={{ padding: "14px", background: C.cardSub, borderRadius: "12px", border: `1px solid ${C.border}`, marginBottom: "16px" }}>
                    <div style={{ fontSize: "12px", color: C.label, marginBottom: "10px", lineHeight: 1.6 }}>
                      현재 시스템 재고는 <b style={{ color: C.accentText }}>{borrowersItem.stock}개</b>입니다. 실제로 세어본 수량을 입력해 기록하세요.
                    </div>
                    <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
                      <input
                        type="number"
                        min={0}
                        value={auditCountInput}
                        onChange={(e) => setAuditCountInput(e.target.value)}
                        placeholder="실사 수량"
                        style={{ ...inputStyle, flex: 1 }}
                      />
                      <button
                        onClick={submitAudit}
                        disabled={auditSubmitting || auditCountInput.trim() === ""}
                        style={{ padding: "0 18px", borderRadius: "10px", border: "none", background: C.accent, color: "#fff", cursor: "pointer", fontSize: "13px", fontWeight: 700, opacity: auditSubmitting || auditCountInput.trim() === "" ? 0.6 : 1, whiteSpace: "nowrap" }}
                      >
                        {auditSubmitting ? "기록 중..." : "기록하기"}
                      </button>
                    </div>
                    {auditCountInput.trim() !== "" && !isNaN(parseInt(auditCountInput, 10)) ? (
                      (() => {
                        const diff = parseInt(auditCountInput, 10) - (borrowersItem.stock || 0);
                        return diff !== 0 ? (
                          <div style={{ fontSize: "11px", fontWeight: 700, color: diff > 0 ? C.success : C.error }}>
                            시스템 대비 {diff > 0 ? `+${diff}` : diff}개 차이
                          </div>
                        ) : (
                          <div style={{ fontSize: "11px", fontWeight: 700, color: C.label }}>시스템 재고와 일치합니다.</div>
                        );
                      })()
                    ) : null}
                    <input
                      value={auditNote}
                      onChange={(e) => setAuditNote(e.target.value)}
                      placeholder="메모 (선택 — 예: 창고 B구역 실사, 파손 3개 확인 등)"
                      style={{ ...inputStyle, marginTop: "8px", fontSize: "12px" }}
                    />
                  </div>

                  {/* 실사 이력 */}
                  {auditLoading && auditLoadedForId !== borrowersItem.id ? (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", padding: "24px 0", color: C.label }}><Spinner size={24} /> 실사 이력을 불러오는 중...</div>
                  ) : auditHistory.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "24px 0", color: C.label, fontSize: "13px" }}>이 물품의 실사 기록이 아직 없습니다.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {auditHistory.map((a, idx) => (
                        <div key={idx} style={{ padding: "10px 12px", background: C.cardSub, border: `1px solid ${C.border}`, borderRadius: "10px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                            <span style={{ fontSize: "11px", color: C.label }}>{a.auditedAt}{a.auditor ? ` · ${a.auditor}` : ""}</span>
                            <span style={{ fontSize: "12px", fontWeight: 800, color: a.diff === 0 ? C.label : a.diff > 0 ? C.success : C.error }}>
                              {a.diff === 0 ? "일치" : a.diff > 0 ? `+${a.diff}` : a.diff}
                            </span>
                          </div>
                          <div style={{ fontSize: "13px", fontWeight: 700, color: C.text, marginTop: "4px" }}>
                            실사 {a.actualCount}개 <span style={{ color: C.label, fontWeight: 400 }}>(당시 시스템 재고 {a.systemStock}개)</span>
                          </div>
                          {a.note ? <div style={{ fontSize: "11px", color: C.label, marginTop: "3px" }}>{a.note}</div> : null}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 진단: 왜 차이가 발생했는지 기록으로 추측 */}
                  <div style={{ marginTop: "18px", paddingTop: "16px", borderTop: `1px dashed ${C.border}` }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                      <div style={{ fontSize: "13px", fontWeight: 800, color: C.text, display: "flex", alignItems: "center", gap: "5px" }}>
                        <Search size={13} style={{ color: C.accentText }} /> 원인 진단
                      </div>
                      <button
                        onClick={runDiagnosis}
                        disabled={diagnosing}
                        style={{ padding: "6px 12px", borderRadius: "8px", border: `1px solid ${C.border}`, background: C.card, color: C.accentText, cursor: diagnosing ? "default" : "pointer", fontSize: "11px", fontWeight: 700, opacity: diagnosing ? 0.6 : 1 }}
                      >
                        {diagnosing ? "분석 중..." : diagnosedForId === borrowersItem.id ? "다시 진단" : "진단하기"}
                      </button>
                    </div>

                    {!diagnosis ? (
                      <div style={{ fontSize: "12px", color: C.label, lineHeight: 1.6 }}>
                        지금까지의 대여·반납 기록과 실사 이력을 대조해서, 불일치가 왜 발생했을지 단서를 찾아드립니다. (확정적인 원인이 아니라 참고용 추정입니다.)
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                        {formulaStatus?.stockIsFormula ? (
                          <div style={{ padding: "10px 12px", background: C.errorSoft, borderRadius: "10px", fontSize: "12px", color: C.error, lineHeight: 1.6 }}>
                            <b>이 물품의 '재고' 값은 수식으로 계산되고 있습니다.</b> 대여/반납이 발생해도 스크립트가 자동으로 값을 갱신하지 않으므로, 수식이 실제 흐름을 반영하지 못하면 실사와 어긋날 수 있습니다.
                          </div>
                        ) : null}

                        {diagnosis.windows.filter((w) => w.mismatch !== 0).length > 0 ? (
                          <div>
                            <div style={{ fontSize: "12px", fontWeight: 700, color: C.text, marginBottom: "6px" }}>기록에 안 잡히는 변동이 있는 구간</div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                              {diagnosis.windows.filter((w) => w.mismatch !== 0).map((w, i) => (
                                <div key={i} style={{ padding: "9px 11px", background: C.warnSoft, borderRadius: "9px", fontSize: "11.5px", color: C.text, lineHeight: 1.6 }}>
                                  <b>{w.from} ~ {w.to}</b>: 이 구간에 대여 {w.borrowCount}건 · 반납 {w.returnCount}건이 로그에 기록되어 예상 변화는 {w.expected >= 0 ? `+${w.expected}` : w.expected}개였지만, 실제 시스템 재고는 {w.actual >= 0 ? `+${w.actual}` : w.actual}개 변동했습니다.
                                  {" "}차이 <b style={{ color: C.error }}>{w.mismatch >= 0 ? `+${w.mismatch}` : w.mismatch}개</b> — 로그에 남지 않은 변동(수동 재고 수정, 대여 로그에 없는 실물 이동, 반납 처리 누락 등)이 있었을 가능성이 있습니다.
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {diagnosis.overdue.length > 0 ? (
                          <div>
                            <div style={{ fontSize: "12px", fontWeight: 700, color: C.text, marginBottom: "6px" }}>장기 미반납 (분실 의심)</div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                              {diagnosis.overdue.map((u, i) => (
                                <div key={i} style={{ padding: "9px 11px", background: C.cardSub, border: `1px solid ${C.border}`, borderRadius: "9px", fontSize: "11.5px", color: C.text }}>
                                  <b>{u.borrowerName || "(대여자 미상)"}</b>가 {u.borrowDate}에 {u.quantity || 1}개 대여 — <span style={{ color: C.warn, fontWeight: 700 }}>{u.days}일째 미반납</span>. 실물이 사라졌거나 반납 처리를 놓쳤을 수 있습니다.
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {!diagnosis.hasIssue ? (
                          <div style={{ fontSize: "12px", color: C.label, lineHeight: 1.6 }}>
                            기록 기준으로는 뚜렷한 이상 신호가 없습니다. 데이터 입력 실수(수량 오기입), 실물 카운트 오차, 또는 아직 실사 기록이 부족해서 비교할 구간이 없을 가능성이 있습니다.
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body
      ) : null}

      {/* 이미지 확대 */}
      {modalUrl ? createPortal(
        <div className="sap-root" onClick={() => setModalUrl("")} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
          <button onClick={() => setModalUrl("")} style={{ position: "absolute", top: "16px", right: "20px", background: "none", border: "none", color: "#fff", cursor: "pointer" }}><X size={32} /></button>
          <img src={modalUrl} alt="" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "90%", maxHeight: "90%", borderRadius: "8px", objectFit: "contain" }} />
        </div>,
        document.body
      ) : null}

      {/* 재고 변경 모달 (시나리오 물품) */}
      {stockAdjustItem && (
        <StockAdjustModal
          scriptUrl={scriptUrl}
          connected={connected}
          isLightMode={isLightMode}
          category="scenario"
          rowIndex={stockAdjustItem.rowIndex}
          itemId={stockAdjustItem.id}
          itemLabel={stockAdjustItem.name}
          currentStock={stockAdjustItem.stock || 0}
          showToast={showToast}
          onClose={() => setStockAdjustItem(null)}
          onSaved={(newStock) => {
            setItems((prev) => prev.map((it) => (it.rowIndex === stockAdjustItem.rowIndex ? { ...it, stock: newStock } : it)));
          }}
        />
      )}
      <ScrollToTopButton />
    </div>
  );
}
