/**
 * 관리자 상단 오른쪽 알림.
 * 가입 신청은 대기 중인 동안 모두에게 뜨고, 누가 처리하면 사라진다.
 * 물품 상태 변경은 관리자마다 읽을 때까지 숫자가 쌓인다(서버가 관리자별로 읽음을 기억한다).
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Bell, UserPlus, History, CheckCheck } from "lucide-react";
import { adminHeaders } from "../utils/adminAuth";

/** kind가 "admin"이면 employeeId 자리에 관리자 로그인 아이디가 들어 있다. */
interface SignupNotice { id: number; kind?: "borrower" | "admin"; employeeId: string; name: string; createdAt: string }
interface ChangeNotice {
  key: string; timestamp: string; category: string; categoryLabel: string;
  itemId: string; itemName: string; changeType: string; summary: string; manager: string; read: boolean;
}

interface Props {
  isLightMode: boolean;
  onOpenSignups: () => void;
  onOpenChanges: () => void;
  /** 사이드바 "계정 설정" 옆 숫자에 쓴다. */
  onSignupCount?: (count: number) => void;
}

const POLL_MS = 60_000;

export default function NotificationBell({ isLightMode, onOpenSignups, onOpenChanges, onSignupCount }: Props) {
  const C = {
    panel: isLightMode ? "#ffffff" : "#1e293b",
    sub: isLightMode ? "#f8fafc" : "#0f172a",
    border: isLightMode ? "#e2e8f0" : "#334155",
    text: isLightMode ? "#0f172a" : "#f1f5f9",
    dim: isLightMode ? "#64748b" : "#94a3b8",
    accent: "#2563eb",
    unreadBg: isLightMode ? "rgba(37,99,235,0.06)" : "rgba(37,99,235,0.14)",
    warn: "#d97706",
    warnBg: isLightMode ? "rgba(245,158,11,0.08)" : "rgba(245,158,11,0.14)",
  };

  const [open, setOpen] = useState(false);
  const [signups, setSignups] = useState<SignupNotice[]>([]);
  const [changes, setChanges] = useState<ChangeNotice[]>([]);
  const [unreadChanges, setUnreadChanges] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    fetch("/api/admin/notifications", { headers: adminHeaders(), cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!d.success) return;
        setSignups(d.signups || []);
        setChanges(d.changes || []);
        setUnreadChanges(d.unreadChanges || 0);
        onSignupCount?.((d.signups || []).length);
      })
      .catch(() => {});
  }, [onSignupCount]);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, POLL_MS);
    // 가입 승인·거절, 물품 수정 직후에는 기다리지 않고 바로 갱신한다.
    window.addEventListener("wms-signups-changed", refresh);
    window.addEventListener("wms-notifications-changed", refresh);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("wms-signups-changed", refresh);
      window.removeEventListener("wms-notifications-changed", refresh);
    };
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    refresh();
    const onDown = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function markRead(body: { keys: string[] } | { all: true }) {
    // 숫자는 먼저 줄이고, 서버 반영 후 다시 맞춘다.
    if ("all" in body) {
      setChanges([]);
      setUnreadChanges(0);
    } else {
      const keys = new Set(body.keys);
      const dropped = changes.filter((c) => keys.has(c.key) && !c.read).length;
      setChanges((prev) => prev.filter((c) => !keys.has(c.key)));
      setUnreadChanges((n) => Math.max(0, n - dropped));
    }
    fetch("/api/admin/notifications/read", {
      method: "POST",
      headers: adminHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    }).then(refresh).catch(() => {});
  }

  const total = signups.length + unreadChanges;

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title={total ? `알림 ${total}건` : "알림"}
        style={{
          position: "relative", width: 34, height: 34, borderRadius: 6,
          border: `1px solid ${total ? "rgba(239,68,68,0.45)" : "var(--panel-border, #334155)"}`,
          background: "var(--input-bg, #0f172a)", color: "var(--text-main, #f1f5f9)", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <Bell size={15} />
        {total ? (
          <span style={{
            position: "absolute", top: -7, right: -7, minWidth: 18, height: 18, padding: "0 5px", borderRadius: 999,
            background: "#ef4444", color: "#fff", fontSize: 10.5, fontWeight: 900, lineHeight: "18px", textAlign: "center",
            boxShadow: "0 0 0 2px var(--header-bg, #0b1120)",
          }}>
            {total > 99 ? "99+" : total}
          </span>
        ) : null}
      </button>

      {open ? (
        <div style={{
          position: "absolute", right: 0, top: "calc(100% + 8px)", zIndex: 5000, width: "min(400px, calc(100vw - 24px))",
          maxHeight: "72vh", display: "flex", flexDirection: "column", background: C.panel, color: C.text,
          border: `1px solid ${C.border}`, borderRadius: 14, boxShadow: "0 18px 44px rgba(15,23,42,0.28)", overflow: "hidden",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "13px 15px", borderBottom: `1px solid ${C.border}` }}>
            <strong style={{ fontSize: 14, flex: 1 }}>알림</strong>
            {unreadChanges ? (
              <button onClick={() => markRead({ all: true })} style={{ display: "flex", alignItems: "center", gap: 4, border: "none", background: "transparent", color: C.accent, fontSize: 12, fontWeight: 800, cursor: "pointer" }}>
                <CheckCheck size={14} /> 모두 읽음
              </button>
            ) : null}
          </div>

          <div style={{ overflowY: "auto" }}>
            {signups.length ? (
              <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.border}`, background: C.warnBg }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 800, color: C.warn, marginBottom: 7 }}>
                  <UserPlus size={14} /> 가입 승인 대기 {signups.length}건
                </div>
                {signups.map((s) => (
                  <button
                    key={`${s.kind || "borrower"}:${s.id}`}
                    onClick={() => { setOpen(false); onOpenSignups(); }}
                    style={{ width: "100%", display: "flex", alignItems: "baseline", gap: 8, padding: "7px 8px", borderRadius: 8, border: "none", background: "transparent", color: C.text, cursor: "pointer", textAlign: "left" }}
                  >
                    {s.kind === "admin" ? <span style={{ fontSize: 10, fontWeight: 800, color: "#7c3aed", border: "1px solid #7c3aed66", borderRadius: 999, padding: "0 6px" }}>관리자</span> : null}
                    <span style={{ fontFamily: "monospace", fontWeight: 800, color: C.accent, fontSize: 12.5 }}>{s.employeeId}</span>
                    <span style={{ fontWeight: 800, fontSize: 13, flex: 1 }}>{s.name}</span>
                    <span style={{ color: C.dim, fontSize: 11 }}>{s.createdAt.slice(5, 16)}</span>
                  </button>
                ))}
              </div>
            ) : null}

            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 15px 6px" }}>
              <History size={14} color={C.accent} />
              <span style={{ fontSize: 12, fontWeight: 800, flex: 1 }}>물품 상태 변경 {unreadChanges ? <span style={{ color: "#ef4444" }}>· 안 읽음 {unreadChanges}</span> : null}</span>
            </div>

            {changes.length === 0 ? (
              <div style={{ padding: "22px 15px", textAlign: "center", color: C.dim, fontSize: 12 }}>
                읽지 않은 변경이 없습니다.
              </div>
            ) : changes.map((c) => (
              <button
                key={c.key}
                onClick={() => { if (!c.read) markRead({ keys: [c.key] }); }}
                title={c.read ? undefined : "눌러서 읽음 처리"}
                style={{
                  width: "100%", display: "flex", gap: 9, padding: "10px 15px", border: "none", borderTop: `1px solid ${C.border}`,
                  background: c.read ? "transparent" : C.unreadBg, color: C.text, cursor: c.read ? "default" : "pointer", textAlign: "left",
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: 999, marginTop: 6, flexShrink: 0, background: c.read ? "transparent" : "#ef4444" }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 12.5, fontWeight: c.read ? 600 : 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", opacity: c.read ? 0.75 : 1 }}>
                    {c.itemName || "(이름 없음)"} <span style={{ color: C.dim, fontWeight: 600, fontSize: 11 }}>· {c.categoryLabel}{c.itemId ? ` ${c.itemId}` : ""}</span>
                  </span>
                  <span style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", fontSize: 12, lineHeight: 1.45, color: c.read ? C.dim : C.text, marginTop: 2 }}>
                    {c.summary}
                  </span>
                  <span style={{ display: "block", fontSize: 10.5, color: C.dim, marginTop: 3 }}>{c.timestamp.slice(5, 16)}{c.manager ? ` · ${c.manager}` : ""}</span>
                </span>
              </button>
            ))}
          </div>

          <button
            onClick={() => { setOpen(false); onOpenChanges(); }}
            style={{ padding: "11px", border: "none", borderTop: `1px solid ${C.border}`, background: C.sub, color: C.accent, fontSize: 12, fontWeight: 800, cursor: "pointer" }}
          >
            물품 상태 변경 이력 전체 보기
          </button>
        </div>
      ) : null}
    </div>
  );
}
