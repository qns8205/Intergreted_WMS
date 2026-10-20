/**
 * 대여자 로그인 입력 화면에 들어온 직후 뜨는 공지 팝업.
 *
 * - 작성한 지 48시간 이내의 공지만 뜬다(서버가 서버 시각으로 걸러서 준다: getNoticePopup).
 * - 로그인 입력 화면 진입마다 한 번. 로그인 완료 후 랜딩에서는 다시 뜨지 않는다.
 * - 로그인 전에는 사번을 알 수 없어 "오늘 하루 보지 않기"는 브라우저 기준이다.
 *   오늘 안에 새 공지가 올라오거나 내용이 바뀌면 다시 보여준다.
 */
import React, { useEffect, useState } from "react";
import { Megaphone, X } from "lucide-react";
import { fetchNoticePopup, NoticeData } from "../utils/borrowApi";

/** 이 로그인(탭)에서 이미 확인했는지 — 사번을 값으로 둔다. 로그아웃해 랜딩이 비로그인으로 열리면 지운다. */
export const NOTICE_POPUP_SHOWN_KEY = "wms_notice_popup_shown";
const SHOWN_KEY = NOTICE_POPUP_SHOWN_KEY;
const hideKey = (employeeId: string) => `wms_notice_hide_today:${employeeId}`;

/** 오늘(서울) 날짜 "YYYY-MM-DD". PC의 시간대 설정과 무관하게 같은 날을 가리킨다. */
export function seoulToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** 공지 구성의 지문. 새 공지가 오거나 내용이 바뀌면 달라져서 "오늘 하루 보지 않기"가 풀린다. */
export function noticeSignature(items: NoticeData[]): string {
  return items.map((n) => `${n.updatedAt || ""}|${n.title || ""}|${n.text}`).join("\n");
}

/** 오늘 이 사람이 같은 공지를 "오늘 하루 보지 않기"로 숨겼는지 */
export function isHiddenToday(employeeId: string, items: NoticeData[], now: Date = new Date()): boolean {
  try {
    const saved = JSON.parse(localStorage.getItem(hideKey(employeeId)) || "null");
    return !!saved && saved.date === seoulToday(now) && saved.signature === noticeSignature(items);
  } catch {
    return false;
  }
}

export function hideForToday(employeeId: string, items: NoticeData[], now: Date = new Date()): void {
  try {
    localStorage.setItem(hideKey(employeeId), JSON.stringify({ date: seoulToday(now), signature: noticeSignature(items) }));
  } catch { /* 저장이 막혀 있으면 이번 로그인에서만 안 뜬다 */ }
}

interface Props {
  scriptUrl: string;
  connected: boolean;
  isLightMode: boolean;
  /** 로그인한 대여자의 사번. 비로그인이면 빈 값/없음 — 팝업은 대여자에게만 뜬다. */
  employeeId?: string;
  /** 사번 입력 전에 표시한다. 숨김은 이 브라우저에만 적용한다. */
  beforeLogin?: boolean;
}

export default function NoticePopup({ scriptUrl, connected, isLightMode, employeeId, beforeLogin = false }: Props) {
  const [items, setItems] = useState<NoticeData[] | null>(null);
  const [skipToday, setSkipToday] = useState(false);
  const scope = beforeLogin ? "login-entry" : employeeId;

  useEffect(() => {
    setItems(null);
    setSkipToday(false);
    // 로그아웃 상태로 랜딩이 열리면 다음 로그인에서 다시 뜨도록 기록을 지운다.
    if (!scope) {
      try { sessionStorage.removeItem(SHOWN_KEY); } catch { /* 무시 */ }
      setItems(null);
      return;
    }
    if (!connected || !scriptUrl) return;
    let already = false;
    try { already = !beforeLogin && sessionStorage.getItem(SHOWN_KEY) === scope; } catch { /* 무시 */ }
    if (already) return;

    // 앱이 뜨는 동안 connected 같은 값이 바뀌면 이 효과가 정리되고 다시 실행된다. 요청 중이던 첫 번째는 취소되므로,
    // "이미 물었음"은 응답을 실제로 처리한 뒤에만 기록해야 한다(요청을 보내기 전에 표시하면 두 번째 실행이 막혀 팝업이 안 뜬다).
    let cancelled = false;
    fetchNoticePopup(scriptUrl)
      .then((list) => {
        if (cancelled) return;
        // 확인은 이 로그인에서 한 번으로 친다. 보여줄 게 없었거나 숨김이어도 다시 묻지 않는다.
        if (!beforeLogin) { try { sessionStorage.setItem(SHOWN_KEY, scope); } catch { /* 무시 */ } }
        if (list.length && !isHiddenToday(scope, list)) setItems(list);
      })
      .catch(() => { /* 팝업은 부가 기능이다. 실패하면 조용히 넘어가고 다음 진입 때 다시 시도한다. */ });
    return () => { cancelled = true; };
  }, [scope, beforeLogin, connected, scriptUrl]);

  useEffect(() => {
    if (!items) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  function close() {
    if (items && scope && skipToday) hideForToday(scope, items);
    setItems(null);
    setSkipToday(false);
  }

  if (!items || !items.length) return null;

  return (
    <NoticePopupView
      items={items}
      isLightMode={isLightMode}
      skipToday={skipToday}
      onSkipTodayChange={setSkipToday}
      onClose={close}
      hideTodayLabel={beforeLogin ? "이 브라우저에서 오늘 하루 보지 않기" : "오늘 하루 보지 않기"}
    />
  );
}

/**
 * 팝업의 모양. 실제 팝업(NoticePopup)과 관리자 편집기의 미리보기가 같은 코드를 쓴다 —
 * 미리보기가 실제와 달라지는 일이 없도록 표시만 맡고, 상태는 모두 바깥에서 받는다.
 * inline이면 화면 전체를 덮지 않고 그 자리에 카드로만 그린다(미리보기용).
 */
export function NoticePopupView({ items, isLightMode, skipToday, onSkipTodayChange, onClose, inline = false, hideTodayLabel = "이 브라우저에서 오늘 하루 보지 않기" }: {
  items: NoticeData[];
  isLightMode: boolean;
  skipToday: boolean;
  onSkipTodayChange: (value: boolean) => void;
  onClose: () => void;
  inline?: boolean;
  hideTodayLabel?: string;
}) {
  const dim = isLightMode ? "#64748b" : "#94a3b8";
  const line = isLightMode ? "#e2e8f0" : "#26324a";
  const accent = isLightMode ? "#1d4ed8" : "#93c5fd";

  const card = (
    <div
      role={inline ? undefined : "dialog"}
      aria-modal={inline ? undefined : true}
      aria-label="공지사항"
      onClick={(e) => e.stopPropagation()}
      style={{
        width: inline ? "100%" : "min(560px, 100%)", maxHeight: inline ? undefined : "86vh", display: "flex", flexDirection: "column",
        background: isLightMode ? "#ffffff" : "#151d30", color: isLightMode ? "#111827" : "#f1f5f9",
        border: `1px solid ${line}`, borderRadius: 18, boxShadow: inline ? "none" : "0 24px 60px rgba(15,23,42,0.35)", textAlign: "left", overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 20px 12px" }}>
        <Megaphone size={20} style={{ color: accent, flexShrink: 0 }} />
        <strong style={{ fontSize: 17, flex: 1 }}>공지사항</strong>
        <button type="button" onClick={onClose} aria-label="닫기" style={{ background: "transparent", border: "none", color: dim, cursor: "pointer", display: "flex", padding: 0 }}>
          <X size={20} />
        </button>
      </div>

      <div style={{ overflowY: "auto", padding: "0 20px", display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map((n, i) => (
          <article key={i} style={{ padding: "14px 16px", borderRadius: 12, border: `1px solid ${line}`, background: isLightMode ? "#f8fafc" : "#0f172a" }}>
            {n.title ? <h3 style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 800, lineHeight: 1.4 }}>{n.title}</h3> : null}
            <div style={{ fontSize: 14, lineHeight: 1.75, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{n.text}</div>
            {n.updatedAt ? <div style={{ marginTop: 8, fontSize: 11.5, color: dim }}>{n.updatedAt.slice(0, 16)}{n.author ? ` · ${n.author}` : ""}</div> : null}
          </article>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 20px 18px", flexWrap: "wrap" }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: dim, cursor: "pointer", flex: 1, minWidth: 150 }}>
          <input type="checkbox" checked={skipToday} onChange={(e) => onSkipTodayChange(e.target.checked)} style={{ width: 17, height: 17, accentColor: "#2563eb" }} />
          {hideTodayLabel}
        </label>
        <button
          type="button"
          onClick={onClose}
          autoFocus={!inline}
          style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 10, padding: "11px 28px", fontSize: 14, fontWeight: 800, cursor: "pointer" }}
        >
          확인
        </button>
      </div>
    </div>
  );

  if (inline) return card;
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 5000, background: "rgba(15,23,42,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      {card}
    </div>
  );
}
