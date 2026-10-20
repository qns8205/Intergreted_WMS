/**
 * 관리자 공지 작성 화면.
 *
 * 공지는 두 군데에 나간다.
 *  - 랜딩의 공지 목록(제목만, 누르면 전체 내용). 최대 NOTICE_MAX건.
 *  - 대여자 로그인 직후 팝업. 작성한 지 48시간 이내인 공지만, 로그인마다 한 번.
 * 관리자가 "이 공지가 지금 팝업에 나가는지, 언제까지인지, 고치면 어떻게 되는지"를 저장하기 전에 알 수 있도록
 * 공지마다 상태를 보여주고, 팝업이 어떻게 보일지 미리 보여준다.
 */
import React, { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Eye, Trash2, Plus, Megaphone } from "lucide-react";
import { NoticeData, NOTICE_MAX } from "../utils/borrowApi";
import { NoticePopupView } from "./NoticePopup";

export const NOTICE_TITLE_MAX = 80;
export const NOTICE_TEXT_MAX = 2000;
/** 서버 규칙(notices.js NOTICE_POPUP_HOURS)과 같아야 한다 — 안내 문구용. */
export const NOTICE_POPUP_HOURS = 48;

/** 서버가 내용이 같은 공지로 보는 기준과 같다(앞뒤 공백 무시). 같으면 저장해도 작성 시각이 유지된다. */
const sameNotice = (a: { title?: string; text?: string }, b: { title?: string; text?: string }) =>
  String(a.title ?? "").trim() === String(b.title ?? "").trim() && String(a.text ?? "").trim() === String(b.text ?? "").trim();

/** 남은 분 → "1일 3시간" / "5시간 20분" / "42분" */
export function formatRemaining(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}시간 ${m % 60}분` : `${h}시간`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}일 ${h % 24}시간` : `${d}일`;
}

type Draft = NoticeData;
type Status = { kind: "new" | "edited" | "active" | "ended"; label: string; hint: string; color: string };

function statusOf(draft: Draft, original?: NoticeData): Status {
  const empty = !(draft.title || "").trim() && !(draft.text || "").trim();
  if (empty) return { kind: "new", label: "비어 있음", hint: "내용을 쓰지 않으면 저장할 때 제외됩니다.", color: "#64748b" };
  if (!original) {
    return { kind: "new", label: "새 공지", hint: `저장하면 지금부터 ${NOTICE_POPUP_HOURS}시간 동안 로그인 팝업에 나갑니다.`, color: "#2563eb" };
  }
  if (!sameNotice(draft, original)) {
    return { kind: "edited", label: "수정됨", hint: `저장하면 새로 작성한 것으로 보고 지금부터 ${NOTICE_POPUP_HOURS}시간 동안 다시 팝업에 나갑니다.`, color: "#d97706" };
  }
  const popup = original.popup;
  if (popup?.active) {
    return { kind: "active", label: "팝업 노출 중", hint: `로그인 팝업에 ${formatRemaining(popup.remainingMinutes)} 더 나갑니다. 고치지 않고 저장하면 시각이 그대로 유지됩니다.`, color: "#16a34a" };
  }
  return { kind: "ended", label: "팝업 종료", hint: `작성한 지 ${NOTICE_POPUP_HOURS}시간이 지나 팝업에는 나가지 않습니다(랜딩 목록에는 계속 표시).`, color: "#64748b" };
}

interface Props {
  isLightMode: boolean;
  /** 서버에 저장돼 있는 공지(팝업 상태 포함). 새로 만든 칸은 여기에 없다. */
  original: NoticeData[];
  drafts: Draft[];
  onChange: (next: Draft[]) => void;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}

export default function NoticeEditor({ isLightMode, original, drafts, onChange, saving, onCancel, onSave }: Props) {
  const [preview, setPreview] = useState(false);
  const [skipToday, setSkipToday] = useState(false);

  const C = {
    panel: isLightMode ? "#ffffff" : "#151d30",
    border: isLightMode ? "#e2e8f0" : "#26324a",
    input: isLightMode ? "#f8fafc" : "#0f172a",
    text: isLightMode ? "#111827" : "#f1f5f9",
    dim: isLightMode ? "#64748b" : "#94a3b8",
    accent: isLightMode ? "#1d4ed8" : "#93c5fd",
  };
  const field: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 9, fontSize: 13,
    border: `1px solid ${C.border}`, background: C.input, color: C.text, outline: "none",
  };

  // 각 칸이 서버의 어느 공지에서 왔는지는 칸에 붙은 _origin으로 안다. 순서를 바꾸거나 일부를 지워도, 내용을 고쳐도 유지된다.
  // (내용으로 짝지으면 고치는 순간 짝을 잃어 "수정됨"이 아니라 "새 공지"로 보이고, 순서를 바꾸면 엉뚱한 공지와 짝지어진다.)
  const originals = useMemo(
    () => drafts.map((d) => (typeof d._origin === "number" ? original[d._origin] : undefined)),
    [original, drafts],
  );

  const patch = (idx: number, change: Partial<Draft>) => onChange(drafts.map((d, i) => (i === idx ? { ...d, ...change } : d)));
  const move = (idx: number, dir: -1 | 1) => {
    const to = idx + dir;
    if (to < 0 || to >= drafts.length) return;
    const next = drafts.slice();
    [next[idx], next[to]] = [next[to], next[idx]];
    onChange(next);
  };

  const filled = drafts.filter((d) => (d.title || "").trim() || (d.text || "").trim());
  // 새로 나가는 공지 = 서버에 없는 칸(새 공지) + 내용을 고친 칸. 이미 노출 중 = 서버에서 안 고친 채 아직 48시간 안인 칸.
  const statuses = drafts.map((d, i) => statusOf(d, originals[i]));
  const isFilled = (d: Draft) => !!((d.title || "").trim() || (d.text || "").trim());
  const toPublish = drafts.filter((d, i) => isFilled(d) && (statuses[i].kind === "new" || statuses[i].kind === "edited")).length;
  const stillActive = drafts.filter((d, i) => isFilled(d) && statuses[i].kind === "active").length;
  const tooLong = drafts.some((d) => (d.title || "").length > NOTICE_TITLE_MAX || (d.text || "").length > NOTICE_TEXT_MAX);

  // 미리보기는 지금 팝업이 실제로 보여줄 것과 같다: 팝업 대상(새로 나가는 공지 + 아직 노출 중인 공지)만.
  const previewItems: NoticeData[] = drafts
    .map((d, i) => ({ d, i, kind: statuses[i].kind, o: originals[i] }))
    .filter(({ d, kind }) => isFilled(d) && (kind === "new" || kind === "edited" || kind === "active"))
    .map(({ d, kind, o }) => ({ title: d.title?.trim() || undefined, text: d.text || "", updatedAt: kind === "active" ? o?.updatedAt : "저장 시각", author: kind === "active" ? o?.author : undefined }));

  return (
    <div style={{ width: "min(640px, 100%)", maxHeight: "92vh", overflowY: "auto", background: C.panel, color: C.text, border: `1px solid ${C.border}`, borderRadius: 16, padding: 22, boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <Megaphone size={18} style={{ color: C.accent }} />
        <strong style={{ fontSize: 16 }}>공지 작성</strong>
      </div>

      <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.7, marginBottom: 14, padding: "10px 12px", borderRadius: 10, background: C.input, border: `1px solid ${C.border}` }}>
        <div>• <b>랜딩 목록</b>에 제목만 보이고, 누르면 전체 내용이 뜹니다. 최대 {NOTICE_MAX}건.</div>
        <div>• <b>로그인 팝업</b>: 대여자가 로그인하면 <b>작성한 지 {NOTICE_POPUP_HOURS}시간 이내</b>의 공지가 로그인마다 한 번 뜹니다. 대여자는 "오늘 하루 보지 않기"로 끌 수 있고, 새 공지가 올라오면 다시 뜹니다.</div>
        <div>• 내용을 <b>고치면 새로 작성한 것</b>으로 보고 {NOTICE_POPUP_HOURS}시간이 다시 시작됩니다. 그대로 두면 시각이 유지됩니다.</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {drafts.map((n, idx) => {
          const status = statusOf(n, originals[idx]);
          const titleLen = (n.title || "").length, textLen = (n.text || "").length;
          return (
            <div key={idx} style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: C.accent }}>공지 {idx + 1}</span>
                <span style={{ fontSize: 11, fontWeight: 800, padding: "2px 9px", borderRadius: 999, color: "#fff", background: status.color }}>{status.label}</span>
                {originals[idx]?.updatedAt ? <span style={{ fontSize: 11, color: C.dim }}>작성 {originals[idx]!.updatedAt!.slice(0, 16)}{originals[idx]!.author ? ` · ${originals[idx]!.author}` : ""}</span> : null}
                <span style={{ marginLeft: "auto", display: "inline-flex", gap: 2 }}>
                  <button type="button" onClick={() => move(idx, -1)} disabled={idx === 0} aria-label="위로" title="위로" style={{ background: "transparent", border: "none", color: C.dim, cursor: idx === 0 ? "default" : "pointer", opacity: idx === 0 ? 0.35 : 1, display: "flex", padding: 4 }}><ArrowUp size={15} /></button>
                  <button type="button" onClick={() => move(idx, 1)} disabled={idx === drafts.length - 1} aria-label="아래로" title="아래로" style={{ background: "transparent", border: "none", color: C.dim, cursor: idx === drafts.length - 1 ? "default" : "pointer", opacity: idx === drafts.length - 1 ? 0.35 : 1, display: "flex", padding: 4 }}><ArrowDown size={15} /></button>
                  <button type="button" onClick={() => onChange(drafts.filter((_, i) => i !== idx))} aria-label="삭제" title="삭제" style={{ background: "transparent", border: "none", color: "#dc2626", cursor: "pointer", display: "flex", padding: 4 }}><Trash2 size={15} /></button>
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: C.dim, marginBottom: 8, lineHeight: 1.5 }}>{status.hint}</div>
              <input
                value={n.title || ""}
                onChange={(e) => patch(idx, { title: e.target.value })}
                placeholder="제목 — 예) 유닛별 전수조사 (31일 금 09:05~16:00)"
                style={{ ...field, fontWeight: 700, marginBottom: 4 }}
              />
              <div style={{ textAlign: "right", fontSize: 11, color: titleLen > NOTICE_TITLE_MAX ? "#dc2626" : C.dim, marginBottom: 6 }}>{titleLen} / {NOTICE_TITLE_MAX}</div>
              <textarea
                value={n.text || ""}
                onChange={(e) => patch(idx, { text: e.target.value })}
                placeholder="본문 — 줄바꿈은 그대로 표시됩니다."
                style={{ ...field, minHeight: 110, resize: "vertical", lineHeight: 1.6 }}
              />
              <div style={{ textAlign: "right", fontSize: 11, color: textLen > NOTICE_TEXT_MAX ? "#dc2626" : C.dim, marginTop: 3 }}>{textLen} / {NOTICE_TEXT_MAX}</div>
            </div>
          );
        })}
      </div>

      {drafts.length < NOTICE_MAX ? (
        <button
          type="button"
          onClick={() => onChange([...drafts, { title: "", text: "" }])}
          style={{ width: "100%", marginTop: 10, padding: 11, borderRadius: 10, cursor: "pointer", fontSize: 12.5, fontWeight: 700, border: `1px dashed ${C.border}`, background: "transparent", color: C.dim, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
        >
          <Plus size={14} /> 공지 추가 ({drafts.length} / {NOTICE_MAX})
        </button>
      ) : null}

      <div style={{ marginTop: 14, padding: "10px 12px", borderRadius: 10, background: C.input, border: `1px solid ${C.border}`, fontSize: 12, color: C.dim, lineHeight: 1.6 }}>
        저장하면: 새로 팝업에 나가는 공지 <b style={{ color: C.text }}>{toPublish}건</b> · 이미 노출 중인 공지 <b style={{ color: C.text }}>{stillActive}건</b>
        {filled.length < drafts.length ? ` · 비어 있는 ${drafts.length - filled.length}칸은 제외됩니다` : ""}
      </div>

      {preview ? (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: C.dim, marginBottom: 6 }}>로그인 팝업 미리보기 (실제와 같은 화면, 저장하지 않은 내용 포함)</div>
          {previewItems.length ? (
            <div style={{ padding: 12, borderRadius: 14, background: "rgba(15,23,42,0.12)" }}>
              <NoticePopupView items={previewItems} isLightMode={isLightMode} skipToday={skipToday} onSkipTodayChange={setSkipToday} onClose={() => setPreview(false)} inline />
            </div>
          ) : (
            <div style={{ fontSize: 12.5, color: C.dim, padding: 12, borderRadius: 10, border: `1px dashed ${C.border}` }}>지금 저장하면 로그인 팝업에 나갈 공지가 없습니다.</div>
          )}
        </div>
      ) : null}

      {tooLong ? <div style={{ marginTop: 10, fontSize: 12, color: "#dc2626", fontWeight: 700 }}>글자 수가 한도를 넘은 칸이 있습니다. 줄여 주세요.</div> : null}

      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button type="button" onClick={onCancel} disabled={saving} style={{ flex: 1, padding: 12, borderRadius: 10, cursor: "pointer", fontSize: 13.5, fontWeight: 700, border: `1px solid ${C.border}`, background: "transparent", color: C.dim }}>
          취소
        </button>
        <button type="button" onClick={() => setPreview((v) => !v)} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "12px 16px", borderRadius: 10, cursor: "pointer", fontSize: 13.5, fontWeight: 700, border: `1px solid ${C.accent}66`, background: "transparent", color: C.accent }}>
          <Eye size={15} /> {preview ? "미리보기 닫기" : "팝업 미리보기"}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving || tooLong}
          style={{ flex: 2, padding: 12, borderRadius: 10, cursor: saving || tooLong ? "not-allowed" : "pointer", fontSize: 14, fontWeight: 800, border: "none", background: "#2563eb", color: "#fff", opacity: saving || tooLong ? 0.6 : 1 }}
        >
          {saving ? "저장 중..." : "공지 저장"}
        </button>
      </div>
    </div>
  );
}
