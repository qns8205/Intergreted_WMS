import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Repeat, Search, User, X } from "lucide-react";
import { fetchCancelLogs, ScenarioLogEntry } from "../utils/borrowApi";
import { smartMatch } from "../utils/search";
import { scenarioVariantText } from "../utils/scenarioVariant";

// 취소 = 물건이 나가지 않고 닫힌 대여. 누가 취소했는지에 따라 의미가 다르다.
//  - auto: 신청 후 기한 안에 안 가져가서 자동 취소 → 대여자 잘못
//  - admin: 관리자가 대여 확인 전에 반납(취소) 처리
//  - self: 대여자 본인이 대여 확인 전에 반납(취소)
//  - "": 이 구분을 기록하기 전(2026-10-13 이전)의 수동 취소 — 관리자인지 본인인지 알 수 없다
type Reason = "auto" | "admin" | "self" | "unknown";
const REASONS: { key: Reason; label: string; hint: string }[] = [
  { key: "auto", label: "미수령 자동 취소", hint: "신청 후 기한 안에 가져가지 않아 자동으로 취소됨 (대여자)" },
  { key: "admin", label: "관리자 취소", hint: "관리자가 대여 확인 전에 취소 처리함" },
  { key: "self", label: "본인 취소", hint: "대여자 본인이 대여 확인 전에 취소함" },
  { key: "unknown", label: "구분 기록 없음", hint: "누가 취소했는지 기록하기 전(10/13 이전)의 수동 취소" },
];
const reasonOf = (it: ScenarioLogEntry): Reason => (it.cancelBy === "auto" || it.cancelBy === "admin" || it.cancelBy === "self" ? it.cancelBy : "unknown");
const PAGE = 30;

export default function CancelLogsPanel({ scriptUrl, connected, C, showToast, isAdmin = false, reloadKey = 0, reborrowing = false, onReborrow }: {
  scriptUrl: string; connected: boolean; C: Record<string, string>;
  showToast: (msg: string, type: "ok" | "error" | "info" | "warn") => void;
  isAdmin?: boolean;
  /** 바뀌면 다시 불러오고 선택을 비운다(재대여 성공 뒤). */
  reloadKey?: number;
  reborrowing?: boolean;
  /** 고른 줄로 재대여 창을 연다(반납 로그의 재대여와 같은 창). */
  onReborrow?: (entries: ScenarioLogEntry[]) => void;
}) {
  const [sel, setSel] = useState<Record<string, true>>({});
  const keyOf = (it: ScenarioLogEntry) => `${it.sheetType}:${it.rowIndex}`;
  const [rows, setRows] = useState<ScenarioLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [reason, setReason] = useState<Reason | "all">("all");
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(PAGE);
  const tone: Record<Reason, { color: string; bg: string }> = {
    auto: { color: C.warn, bg: C.warnSoft },
    admin: { color: C.accent, bg: "rgba(37,99,235,0.12)" },
    self: { color: C.success, bg: C.successSoft },
    unknown: { color: C.label, bg: C.cardSub },
  };

  const load = useCallback(async () => {
    if (!connected || !scriptUrl) { setLoaded(true); return; }
    setLoading(true);
    try { setRows(await fetchCancelLogs(scriptUrl)); }
    catch (e: any) { showToast(`취소 로그를 불러오지 못했습니다: ${e.message}`, "error"); }
    finally { setLoading(false); setLoaded(true); }
  }, [connected, scriptUrl, showToast]);
  useEffect(() => { load(); }, [load, reloadKey]);
  useEffect(() => { setSel({}); }, [reloadKey]);
  useEffect(() => { setShown(PAGE); }, [reason, search]);

  const counts = useMemo(() => {
    const c: Record<Reason, number> = { auto: 0, admin: 0, self: 0, unknown: 0 };
    for (const it of rows) c[reasonOf(it)]++;
    return c;
  }, [rows]);

  // 같은 사람이 같은 시각에 같은 이유로 취소된 줄을 한 묶음으로 본다(신청 한 건이 통째로 취소되는 경우가 많다).
  const groups = useMemo(() => {
    const q = search.trim();
    const list = rows.filter((it) => (reason === "all" || reasonOf(it) === reason)
      && (!q || smartMatch([it.itemLabel, scenarioVariantText(it), it.borrowerName, it.employeeId, it.scenarioId, it.borrowPurpose, it.cancelActor], q)));
    const map = new Map<string, { key: string; borrower: string; employeeId: string; at: string; reason: Reason; actor: string; appliedAt: string; seat: string; sid: string; purpose: string; items: ScenarioLogEntry[] }>();
    for (const it of list) {
      const r = reasonOf(it);
      const key = `${it.borrowerName}|${it.returnDate}|${r}`;
      if (!map.has(key)) {
        map.set(key, {
          key, borrower: it.borrowerName, employeeId: it.employeeId || "", at: it.returnDate || "", reason: r, actor: it.cancelActor || "",
          appliedAt: it.appliedAt || it.borrowDate || "", seat: [it.floor, it.unit].filter(Boolean).join(" · "), sid: it.scenarioId || "",
          purpose: String(it.borrowPurpose || "").replace(/\s*\[미수령 자동 취소\]\s*/g, " ").trim(), items: [],
        });
      }
      map.get(key)!.items.push(it);
    }
    return [...map.values()];
  }, [rows, reason, search]);

  const chip = (key: Reason | "all", label: string, n: number, hint?: string) => {
    const on = reason === key;
    const t = key === "all" ? { color: C.accent, bg: "rgba(37,99,235,0.12)" } : tone[key];
    return (
      <button key={key} type="button" title={hint} onClick={() => setReason(key)}
        style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 5, flex: "1 1 130px", padding: "10px 12px", borderRadius: 12, textAlign: "left", cursor: "pointer",
          border: `1px solid ${on ? t.color : C.border}`, background: on ? t.bg : C.card }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: on ? t.color : C.label }}>{label}</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: t.color }}>{n}</div>
      </button>
    );
  };

  return (
    <div>
      <div style={{ fontSize: 12, color: C.label, marginBottom: 10, lineHeight: 1.6 }}>
        물건이 나가지 않고 닫힌 대여입니다. 누가 취소했는지에 따라 나눠 봅니다. 반납 로그에는 나오지 않습니다.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        {chip("all", "전체", rows.length)}
        {REASONS.map((r) => chip(r.key, r.label, counts[r.key], r.hint))}
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: C.label }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="물품 · 대여자 · 사번 · SID · 처리한 관리자로 검색..."
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 32px 10px 34px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: 13, outline: "none" }} />
          {search ? <button type="button" onClick={() => setSearch("")} aria-label="검색 지우기" style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", border: 0, background: "transparent", color: C.label, cursor: "pointer" }}><X size={14} /></button> : null}
        </div>
        <button type="button" onClick={load} disabled={loading} title="새로고침" style={{ padding: "0 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.card, color: C.label, cursor: loading ? "wait" : "pointer" }}><RefreshCw size={15} /></button>
      </div>

      {isAdmin && onReborrow && Object.keys(sel).length ? (
        <div style={{ position: "sticky", top: 0, zIndex: 5, display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", marginBottom: 10, borderRadius: 12, border: `1px solid ${C.accent}`, background: C.card, boxShadow: "0 6px 18px rgba(15,23,42,0.12)" }}>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 800, color: C.text }}>{Object.keys(sel).length}건 선택</span>
          <button type="button" onClick={() => setSel({})} style={{ padding: "8px 12px", borderRadius: 9, border: `1px solid ${C.border}`, background: C.card, color: C.label, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>선택 해제</button>
          <button type="button" disabled={reborrowing}
            onClick={() => onReborrow(rows.filter((it) => sel[keyOf(it)]).map((it) => ({ ...it, borrowPurpose: String(it.borrowPurpose || "").replace(/\s*\[미수령 자동 취소\]\s*/g, " ").trim() })))}
            title="고른 물품을 같은 대여자·종류·수량으로 다시 대여 신청합니다"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 9, border: 0, background: C.accent, color: "#fff", fontSize: 12.5, fontWeight: 800, cursor: "pointer", opacity: reborrowing ? 0.6 : 1 }}>
            <Repeat size={14} /> 재대여
          </button>
        </div>
      ) : null}

      {!loaded || (loading && !rows.length) ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: C.label, fontSize: 13 }}>취소 로그를 불러오는 중…</div>
      ) : !groups.length ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: C.label, fontSize: 13 }}>해당하는 취소 기록이 없습니다.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {groups.slice(0, shown).map((g) => {
            const t = tone[g.reason];
            const label = REASONS.find((r) => r.key === g.reason)!.label;
            return (
              <div key={g.key} style={{ border: `1px solid ${C.border}`, borderRadius: 14, background: C.card, overflow: "hidden" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", background: C.cardSub, borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
                  {isAdmin && onReborrow ? (
                    <input type="checkbox" aria-label={`${g.borrower} 묶음 전체 선택`} checked={g.items.every((it) => sel[keyOf(it)])}
                      onChange={(e) => setSel((prev) => {
                        const next = { ...prev };
                        for (const it of g.items) { if (e.target.checked) next[keyOf(it)] = true; else delete next[keyOf(it)]; }
                        return next;
                      })} style={{ width: 16, height: 16, accentColor: C.accent, flexShrink: 0 }} />
                  ) : <User size={16} style={{ color: C.label, flexShrink: 0 }} />}
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      {g.borrower}
                      {g.employeeId ? <span style={{ fontSize: 10, fontWeight: 800, color: C.label, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: "1px 6px", fontFamily: "monospace" }}>사번 {g.employeeId}</span> : null}
                      {g.sid ? <span style={{ fontSize: 11, color: C.warn, fontWeight: 700 }}>· {g.sid}</span> : null}
                    </div>
                    <div style={{ fontSize: 11, color: C.label, marginTop: 2 }}>
                      취소 {g.at}{g.appliedAt ? ` · 신청 ${g.appliedAt}` : ""}{g.seat ? ` · 📍 ${g.seat}` : ""}{g.purpose ? ` · ${g.purpose}` : ""}
                    </div>
                  </div>
                  <span title={REASONS.find((r) => r.key === g.reason)!.hint}
                    style={{ fontSize: 11, fontWeight: 800, color: t.color, background: t.bg, padding: "3px 10px", borderRadius: 14, whiteSpace: "nowrap" }}>
                    {label}{g.reason === "admin" && g.actor ? ` · ${g.actor}` : ""}
                  </span>
                </div>
                <div style={{ padding: "6px 14px 10px" }}>
                  {g.items.map((it) => (
                    <div key={`${it.sheetType}:${it.rowIndex}`} onClick={() => isAdmin && onReborrow && setSel((prev) => { const next = { ...prev }; if (next[keyOf(it)]) delete next[keyOf(it)]; else next[keyOf(it)] = true; return next; })}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: `1px dashed ${C.border}`, cursor: isAdmin && onReborrow ? "pointer" : "default" }}>
                      {isAdmin && onReborrow ? <input type="checkbox" readOnly checked={!!sel[keyOf(it)]} aria-label={`${it.itemLabel} 선택`} style={{ width: 15, height: 15, accentColor: C.accent, flexShrink: 0 }} /> : null}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.text, wordBreak: "break-word" }}>{it.itemLabel}</div>
                        {scenarioVariantText(it) ? <div style={{ fontSize: 11.5, fontWeight: 700, color: C.accent, marginTop: 2 }}>종류: {scenarioVariantText(it)}</div> : null}
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 700, color: C.label }}>{it.sheetType === "scenario" ? "SID" : "일반"}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {groups.length > shown ? (
            <button type="button" onClick={() => setShown((n) => n + PAGE)}
              style={{ padding: 12, borderRadius: 10, border: `1px solid ${C.border}`, background: C.card, color: C.label, fontWeight: 700, cursor: "pointer" }}>
              더 보기 ({groups.length - shown}건 남음)
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
