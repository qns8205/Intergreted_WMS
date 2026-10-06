/**
 * 페널티 입력 폼. 세 곳에서 같이 쓴다.
 *  - 대여/반납 설정 > 페널티: 새로 등록, 등록된 페널티 내용 수정
 *  - 반납 로그 화면: 로그의 한 줄에서 바로 부여(PenaltyGrantModal)
 *
 * 해제일은 달력(input type="date")으로 고른다. 글자로 적게 두면 "내일쯤" 같은 값이 들어가
 * 만료 비교가 어긋난다(서버도 올바른 날짜만 받는다).
 */
import React, { useEffect, useState } from "react";
import { X, ShieldAlert } from "lucide-react";
import { adminHeaders } from "../utils/adminAuth";

/* ── 대여·반납 기록 연결 ─────────────────────────────────── */

export type LinkCause = "rental" | "return";
export interface PenaltyRentalRow {
  sheetType: "scenario" | "general";
  rowId: number;
  itemName: string;
  variantName: string;
  qty: number;
  requestCode: string;
  appliedAt: string;
  pickedUpAt: string;
  returnedAt: string;
  state: string;
}
export interface PenaltyLink extends PenaltyRentalRow { cause: LinkCause }
export const CAUSE_LABEL: Record<LinkCause, string> = { rental: "대여 때문", return: "반납 때문" };
export const CAUSE_COLOR: Record<LinkCause, string> = { rental: "#2563eb", return: "#d97706" };

export interface PenaltyColors { text: string; dim: string; border: string; panel: string; input: string; accent: string }

/** "2026-10-03 13:01:40" → "10/03 13:01" */
export const shortTime = (value: string) => (value ? value.slice(5, 16).replace("-", "/") : "");

/** "신청 261004-001 · 대여 10/04 09:00 → 반납 10/05 12:00 · 반납 완료" */
export const rentalMeta = (r: PenaltyRentalRow) =>
  [r.requestCode ? `신청 ${r.requestCode}` : "", `대여 ${shortTime(r.appliedAt) || "-"}${r.returnedAt ? ` → 반납 ${shortTime(r.returnedAt)}` : ""}`, r.state]
    .filter(Boolean).join(" · ");
export const rentalTitle = (r: PenaltyRentalRow) => `${r.itemName}${r.variantName ? ` · ${r.variantName}` : ""} ×${r.qty}`;
export const linkKey = (r: { sheetType: string; rowId: number }) => `${r.sheetType}:${r.rowId}`;

/* ── 서버 호출 ───────────────────────────────────────────── */

export async function penaltyApi(method: string, url: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: adminHeaders({ "Content-Type": "application/json" }),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || `요청 실패 (HTTP ${res.status})`);
  return data;
}

export interface PenaltyFormValues {
  name: string;
  maxTypes: string;
  reason: string;
  expiresAt: string;
  links: PenaltyLink[];
}
export const EMPTY_PENALTY: PenaltyFormValues = { name: "", maxTypes: "", reason: "", expiresAt: "", links: [] };

/** 서버로 보내는 모양. 연결은 어느 줄(sheetType+rowId)을 어떤 원인으로 묶는지만 보낸다. */
export function penaltyPayload(v: PenaltyFormValues) {
  return {
    name: v.name.trim(),
    maxTypes: v.maxTypes.trim() === "" ? null : Number(v.maxTypes),
    reason: v.reason.trim(),
    expiresAt: v.expiresAt.trim(),
    links: v.links.map((l) => ({ sheetType: l.sheetType, rowId: l.rowId, cause: l.cause })),
  };
}

/* ── 날짜 ────────────────────────────────────────────────── */

const pad = (n: number) => String(n).padStart(2, "0");
const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** 오늘로부터 days일 뒤의 날짜(YYYY-MM-DD, 이 PC의 달력 기준) */
export function dateAfter(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return dateKey(d);
}
const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];

/** 해제일 아래에 보여줄 설명. 날짜만 적힌 해제일은 그 날짜 0시에 풀린다(서버 만료 비교 방식). */
function describeExpiry(raw: string): { text: string; warn: boolean } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!m) return raw ? { text: `달력에서 읽을 수 없는 값입니다(${raw}). 달력으로 다시 고르면 바뀝니다.`, warn: true } : null;
  const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date();
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = Math.round((target.getTime() - base.getTime()) / 86400000);
  const label = `${m[1]}-${m[2]}-${m[3]} (${WEEKDAY[target.getDay()]})`;
  if (diff <= 0) return { text: `${label} — 이미 지난 날짜라 등록하면 바로 풀린 상태가 됩니다.`, warn: true };
  return { text: `${label} 0시에 자동으로 풀립니다 · 오늘부터 ${diff}일 뒤`, warn: false };
}

/* ── 기록 선택 ───────────────────────────────────────────── */

/**
 * 페널티의 원인이 된 대여·반납 기록을 고른다. 이름(또는 사번)으로 그 사람의 기록 줄을 불러오고,
 * 줄마다 "대여 때문"/"반납 때문"을 누르면 연결된다(같은 버튼을 다시 누르면 해제).
 * 이미 연결된 줄은 불러오기 전에도 맨 위에 보인다. autoLoad면 열자마자 불러온다.
 */
export function PenaltyLinkPicker({ name, value, onChange, colors, autoLoad = false }: {
  name: string;
  value: PenaltyLink[];
  onChange: (next: PenaltyLink[]) => void;
  colors: PenaltyColors;
  autoLoad?: boolean;
}) {
  const [candidates, setCandidates] = useState<PenaltyRentalRow[]>([]);
  const [loadedFor, setLoadedFor] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function fetchRows() {
    const key = name.trim();
    if (!key) return;
    setLoading(true);
    setError("");
    try {
      const data = await penaltyApi("GET", `/api/penalties/rentals?name=${encodeURIComponent(key)}`);
      setCandidates(data.rows || []);
      setLoadedFor(key);
    } catch (err: any) {
      setError(err.message || "기록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (autoLoad) fetchRows();
    // 처음 열릴 때 한 번만 — 이후는 버튼으로 다시 불러온다.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const byKey = new Map<string, PenaltyRentalRow>(candidates.map((c): [string, PenaltyRentalRow] => [linkKey(c), c]));
  const selected = new Map<string, PenaltyLink>(value.map((l): [string, PenaltyLink] => [linkKey(l), l]));
  // 연결된 줄은 서버가 알려준 최신 모양(상태 등)으로 보여주되 원인은 선택한 값을 쓴다.
  const rows: PenaltyRentalRow[] = [
    ...value.map((l) => { const fresh = byKey.get(linkKey(l)); return fresh ? { ...l, ...fresh } : l; }),
    ...candidates.filter((c) => !selected.has(linkKey(c))),
  ];

  function pick(row: PenaltyRentalRow, cause: LinkCause) {
    const current = selected.get(linkKey(row));
    if (current?.cause === cause) onChange(value.filter((l) => linkKey(l) !== linkKey(row)));
    else if (current) onChange(value.map((l) => (linkKey(l) === linkKey(row) ? { ...l, cause } : l)));
    else onChange([...value, { ...row, cause }]);
  }

  return (
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 12 }}>대여·반납 기록 연결 <span style={{ color: colors.dim, fontWeight: 500 }}>(선택)</span></strong>
        <span style={{ fontSize: 11, color: colors.dim, flex: 1, minWidth: 140 }}>어느 기록의 어느 물품 때문인지 남기면 랜딩의 페널티 상세에도 표시됩니다.</span>
        <button
          type="button"
          onClick={fetchRows}
          disabled={!name.trim() || loading}
          style={{ background: "transparent", color: colors.accent, border: `1px solid ${colors.accent}66`, borderRadius: 7, padding: "5px 10px", fontSize: 11.5, fontWeight: 800, cursor: !name.trim() || loading ? "not-allowed" : "pointer", opacity: !name.trim() ? 0.5 : 1 }}
        >
          {loading ? "불러오는 중…" : loadedFor ? "다시 불러오기" : "이 사람의 기록 불러오기"}
        </button>
      </div>
      {!name.trim() ? <div style={{ fontSize: 11.5, color: colors.dim }}>위에서 이름(또는 4자리 사번)을 먼저 입력하세요.</div> : null}
      {error ? <div style={{ fontSize: 11.5, color: "#ef4444" }}>{error}</div> : null}
      {loadedFor && !candidates.length && !error ? <div style={{ fontSize: 11.5, color: colors.dim }}>'{loadedFor}'의 대여 기록이 없습니다.</div> : null}
      {rows.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 300, overflowY: "auto" }}>
          {rows.map((row) => {
            const current = selected.get(linkKey(row));
            return (
              <div key={linkKey(row)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 9px", borderRadius: 8, background: current ? `${CAUSE_COLOR[current.cause]}14` : colors.input, border: `1px solid ${current ? CAUSE_COLOR[current.cause] + "88" : colors.border}` }}>
                <div style={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: 1.5 }}>
                  <div style={{ fontWeight: 800, overflowWrap: "anywhere" }}>{rentalTitle(row)}</div>
                  <div style={{ fontSize: 11, color: colors.dim }}>{rentalMeta(row)}</div>
                </div>
                <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                  {(["rental", "return"] as LinkCause[]).map((cause) => {
                    const on = current?.cause === cause;
                    return (
                      <button
                        key={cause}
                        type="button"
                        onClick={() => pick(row, cause)}
                        aria-pressed={on}
                        style={{ padding: "5px 9px", borderRadius: 7, fontSize: 11.5, fontWeight: 800, cursor: "pointer", border: `1px solid ${CAUSE_COLOR[cause]}${on ? "" : "66"}`, background: on ? CAUSE_COLOR[cause] : "transparent", color: on ? "#fff" : CAUSE_COLOR[cause] }}
                      >
                        {CAUSE_LABEL[cause]}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
      {value.length ? <div style={{ fontSize: 11.5, color: colors.dim }}>{value.length}건 연결됨</div> : null}
    </div>
  );
}

/* ── 폼 ──────────────────────────────────────────────────── */

/**
 * 이름·최대 종류·사유·해제일(달력)·기록 연결을 받는다. 상태는 폼이 들고 있고, 제출할 때만 값을 넘긴다.
 * 값을 다른 것으로 바꾸려면(예: 수정할 페널티를 바꿈) 부모가 key를 바꿔 새로 그리게 한다.
 */
export function PenaltyForm({ mode, initial, colors, submitting, submitLabel, onSubmit, onCancel, autoLoadRecords }: {
  mode: "create" | "edit";
  initial: PenaltyFormValues;
  colors: PenaltyColors;
  submitting?: boolean;
  submitLabel?: string;
  onSubmit: (values: PenaltyFormValues) => void;
  onCancel?: () => void;
  autoLoadRecords?: boolean;
}) {
  const [v, setV] = useState<PenaltyFormValues>(initial);
  const set = <K extends keyof PenaltyFormValues>(key: K, value: PenaltyFormValues[K]) => setV((prev) => ({ ...prev, [key]: value }));

  const input: React.CSSProperties = {
    width: "100%", background: colors.input, border: `1px solid ${colors.border}`, borderRadius: 8,
    padding: "8px 10px", color: colors.text, fontSize: 13, outline: "none", boxSizing: "border-box",
  };
  const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: colors.dim, marginBottom: 4, display: "block" };
  const quick: React.CSSProperties = { background: "transparent", color: colors.accent, border: `1px solid ${colors.accent}55`, borderRadius: 7, padding: "5px 9px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" };

  // 달력에는 날짜 부분만 보인다. 예전 형식(시각 포함)이 그대로면 저장할 때도 원래 값을 그대로 둔다.
  const dateValue = /^\d{4}-\d{2}-\d{2}/.test(v.expiresAt) ? v.expiresAt.slice(0, 10) : "";
  const expiry = describeExpiry(v.expiresAt);
  const canSubmit = !!v.name.trim() && !submitting;

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (canSubmit) onSubmit(v); }}
      style={{ display: "flex", flexDirection: "column", gap: 12, color: colors.text }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 10 }}>
        <label>
          <span style={label}>이름 (또는 4자리 사번)</span>
          <input style={input} value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="예: 홍길동" maxLength={50} />
        </label>
        <label>
          <span style={label}>대여 가능 최대 종류</span>
          <input style={input} type="number" inputMode="numeric" min={0} max={999} step={1} value={v.maxTypes} onChange={(e) => set("maxTypes", e.target.value)} placeholder="예: 5 (비우면 제한 없음)" />
        </label>
      </div>

      <label>
        <span style={label}>사유</span>
        <input style={input} value={v.reason} onChange={(e) => set("reason", e.target.value)} placeholder="예: 파손 후 미신고" maxLength={500} />
      </label>

      <div>
        <span style={label}>해제일 (이 날짜가 되면 자동으로 풀립니다)</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <input
            style={{ ...input, width: 170 }}
            type="date"
            value={dateValue}
            min={mode === "create" ? dateAfter(0) : undefined}
            onChange={(e) => set("expiresAt", e.target.value)}
            aria-label="해제일"
          />
          {[7, 14, 30].map((days) => (
            <button key={days} type="button" style={quick} onClick={() => set("expiresAt", dateAfter(days))}>{days}일 후</button>
          ))}
          <button type="button" style={{ ...quick, color: colors.dim, border: `1px solid ${colors.border}` }} onClick={() => set("expiresAt", "")}>기한 없음</button>
        </div>
        <div style={{ fontSize: 11.5, marginTop: 5, color: expiry?.warn ? "#d97706" : colors.dim }}>
          {expiry ? expiry.text : "기한 없음 — 관리자가 직접 지우기 전까지 계속 적용됩니다."}
        </div>
      </div>

      <PenaltyLinkPicker name={v.name} value={v.links} onChange={(links) => set("links", links)} colors={colors} autoLoad={autoLoadRecords} />

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="submit"
          disabled={!canSubmit}
          style={{ background: colors.accent, color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 12.5, fontWeight: 800, cursor: canSubmit ? "pointer" : "not-allowed", opacity: canSubmit ? 1 : 0.55 }}
        >
          {submitting ? "저장 중…" : submitLabel || (mode === "create" ? "페널티 등록" : "수정 저장")}
        </button>
        {onCancel ? (
          <button type="button" onClick={onCancel} disabled={submitting} style={{ background: "transparent", color: colors.dim, border: `1px solid ${colors.border}`, borderRadius: 8, padding: "9px 16px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
            취소
          </button>
        ) : null}
      </div>
    </form>
  );
}

/* ── 로그 화면에서 바로 부여 ─────────────────────────────── */

/** 대여·반납 로그의 한 줄에서 페널티를 바로 준다. 이름과 그 줄(원인 포함)이 미리 채워진다. */
export function PenaltyGrantModal({ isLightMode, borrowerName, link, onClose, onSaved, showToast }: {
  isLightMode: boolean;
  borrowerName: string;
  link: PenaltyLink;
  onClose: () => void;
  onSaved?: () => void;
  showToast: (msg: string, type: "ok" | "error" | "info" | "warn") => void;
}) {
  const colors: PenaltyColors = {
    text: isLightMode ? "#0f172a" : "#f1f5f9",
    dim: isLightMode ? "#64748b" : "#94a3b8",
    border: isLightMode ? "#e2e8f0" : "#334155",
    panel: isLightMode ? "#ffffff" : "#1e293b",
    input: isLightMode ? "#f8fafc" : "#0f172a",
    accent: "#2563eb",
  };
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !saving) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  async function save(values: PenaltyFormValues) {
    setSaving(true);
    try {
      await penaltyApi("POST", "/api/penalties", penaltyPayload(values));
      showToast(`${values.name.trim()} 님에게 페널티를 부여했습니다.`, "ok");
      onSaved?.();
      onClose();
    } catch (err: any) {
      showToast("페널티 부여 실패: " + err.message, "error");
      setSaving(false);
    }
  }

  return (
    <div
      onClick={() => { if (!saving) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 6000, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="페널티 부여"
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(640px, 100%)", maxHeight: "90vh", overflowY: "auto", background: colors.panel, color: colors.text, border: `1px solid ${colors.border}`, borderRadius: 16, padding: 20 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <ShieldAlert size={18} style={{ color: "#d97706" }} />
          <strong style={{ fontSize: 16, flex: 1 }}>페널티 부여</strong>
          <button type="button" onClick={onClose} disabled={saving} aria-label="닫기" style={{ background: "transparent", border: "none", color: colors.dim, cursor: "pointer", display: "flex" }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ fontSize: 12, color: colors.dim, lineHeight: 1.6, marginBottom: 12 }}>
          선택한 로그 줄이 원인 기록으로 미리 연결되어 있습니다. 최대 종류와 해제일은 기본값(5종류, 7일 후)이니 필요하면 바꿔 주세요.
        </div>
        <PenaltyForm
          mode="create"
          initial={{ name: borrowerName, maxTypes: "5", reason: "", expiresAt: dateAfter(7), links: [link] }}
          colors={colors}
          submitting={saving}
          submitLabel="페널티 부여"
          onSubmit={save}
          onCancel={onClose}
          autoLoadRecords
        />
      </div>
    </div>
  );
}
