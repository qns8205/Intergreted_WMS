import React, { useState, useEffect } from "react";
import { ClipboardList, HandHelping, PackageOpen, Settings, ShieldAlert, PackageCheck, Link as LinkIcon, RefreshCw, CheckCircle, AlertTriangle, HelpCircle, ChevronDown, ChevronUp } from "lucide-react";
import { fetchNotices, NoticeData, fetchBorrowLock, BorrowLock } from "../utils/borrowApi";

// 고정 안내: 앞으로 적용될 페널티 기준 (코드에 고정한다 — 운영 중 바뀌면 이 배열만 수정)
const PENALTY_RULES: { label: string; limit: string }[] = [
  { label: "오브젝트를 보관함에 넣지 않고 방치", limit: "10종류로 제한 (1일)" },
  { label: "오브젝트를 분실", limit: "10종류로 제한 (7일)" },
  { label: "1주 이상 연체", limit: "5종류로 제한 (7일)" },
];

// 관리자 공지: 지난번에 받은 값을 먼저 그려 즉시 보이게 하고, 응답이 오면 교체한다.
// (GAS 왕복이 느려 공지가 뒤늦게 뜨는 문제를 없애기 위함)
const NOTICE_CACHE_KEY = "wms_notices_v1";
const noticeCache: { key: string; at: number; items: NoticeData[] } = { key: "", at: 0, items: [] };

function readNoticeSeed(): NoticeData[] {
  try {
    const raw = sessionStorage.getItem(NOTICE_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as NoticeData[]) : [];
  } catch (e) {
    return [];
  }
}

function useNotices(scriptUrl: string, connected: boolean) {
  const fresh = noticeCache.key === scriptUrl && Date.now() - noticeCache.at < 3 * 60 * 1000;
  const [items, setItems] = useState<NoticeData[]>(fresh ? noticeCache.items : readNoticeSeed());

  useEffect(() => {
    if (!connected || !scriptUrl) return;
    if (noticeCache.key === scriptUrl && Date.now() - noticeCache.at < 3 * 60 * 1000) {
      setItems(noticeCache.items);
      return;
    }
    let cancelled = false;
    fetchNotices(scriptUrl)
      .then((list) => {
        if (cancelled) return;
        noticeCache.key = scriptUrl;
        noticeCache.at = Date.now();
        noticeCache.items = list;
        setItems(list);
        try { sessionStorage.setItem(NOTICE_CACHE_KEY, JSON.stringify(list)); } catch (e) { /* 저장 실패 무시 */ }
      })
      .catch(() => { /* 랜딩의 부가 정보이므로 실패는 조용히 숨긴다 */ });
    return () => { cancelled = true; };
  }, [scriptUrl, connected]);

  return items;
}

// 대여 잠금도 같은 방식으로 즉시 그린다
const LOCK_CACHE_KEY = "wms_borrow_lock_v1";

function readLockSeed(): BorrowLock {
  try {
    const raw = sessionStorage.getItem(LOCK_CACHE_KEY);
    if (raw) return JSON.parse(raw) as BorrowLock;
  } catch (e) { /* 무시 */ }
  return { locked: false };
}

interface LandingPageProps {
  onNavigate: (view: "borrow" | "browse" | "login") => void;
  isLightMode: boolean;
  isMobile?: boolean;
  scriptUrl: string;
  setScriptUrl: (url: string) => void;
  connecting: boolean;
  connectError: string;
  connected: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onOpenSetup: () => void;
}

export default function LandingPage({
  onNavigate,
  isLightMode,
  isMobile = false,
  scriptUrl,
  setScriptUrl,
  connecting,
  connectError,
  connected,
  onConnect,
  onDisconnect,
  onOpenSetup,
}: LandingPageProps) {
  const [showGuide, setShowGuide] = useState(false);
  const notices = useNotices(scriptUrl, connected);
  const [openNotice, setOpenNotice] = useState<NoticeData | null>(null);

  // 대여 잠금 상태 (관리자가 일시 중단한 경우 안내한다)
  const [borrowLock, setBorrowLock] = useState<BorrowLock>(readLockSeed);
  useEffect(() => {
    if (!connected || !scriptUrl) return;
    fetchBorrowLock(scriptUrl)
      .then((l) => {
        setBorrowLock(l);
        try { sessionStorage.setItem(LOCK_CACHE_KEY, JSON.stringify(l)); } catch (e) { /* 무시 */ }
      })
      .catch(() => { /* 조회 실패는 무시 */ });
  }, [connected, scriptUrl]);

  return (
    <div
      className="lp-root"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: isLightMode ? "radial-gradient(circle at top, #f8fafc 0%, #e2e8f0 100%)" : "radial-gradient(circle at top, #0f172a 0%, #020617 100%)",
        color: isLightMode ? "#111827" : "#f1f5f9",
        padding: "32px 20px",
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
      }}
    >
      <style>{`
        @media (min-width: 900px) {
          .lp-root { zoom: 1.15; }
        }
      `}</style>
      <div
        style={{
          maxWidth: "720px",
          width: "100%",
          textAlign: "center",
          marginBottom: "32px",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "64px",
            height: "64px",
            borderRadius: "16px",
            background: "linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)",
            color: "#ffffff",
            marginBottom: "20px",
            boxShadow: "0 10px 25px -5px rgba(37, 99, 235, 0.4)",
          }}
        >
          <PackageCheck size={32} />
        </div>
        <h1
          style={{
            fontSize: "30px",
            fontWeight: 800,
            letterSpacing: "-0.025em",
            marginBottom: "12px",
            color: isLightMode ? "#111827" : "#f1f5f9",
          }}
        >
          대여 · 반납 · 관리
        </h1>
        {/* 대여 잠금 안내 */}
        {connected && borrowLock.locked ? (
          <div
            style={{
              marginTop: "4px",
              padding: "12px 16px",
              borderRadius: "14px",
              border: `1px solid ${isLightMode ? "#fca5a5" : "#991b1b"}`,
              background: isLightMode ? "#fef2f2" : "#1f1113",
              maxWidth: "480px",
              width: "100%",
              marginLeft: "auto",
              marginRight: "auto",
              textAlign: "left",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12.5px", fontWeight: 800, color: isLightMode ? "#b91c1c" : "#fca5a5", marginBottom: "5px" }}>
              <AlertTriangle size={14} />
              대여가 일시 중단되었습니다
            </div>
            <div style={{ fontSize: "12px", color: isLightMode ? "#7f1d1d" : "#fecaca", lineHeight: 1.6 }}>
              {borrowLock.reason ? <>사유: {borrowLock.reason}<br /></> : null}
              반납은 정상적으로 가능합니다.
            </div>
          </div>
        ) : null}

        {/* 유닛별 대여 잠금 안내 */}
        {connected && !borrowLock.locked && (borrowLock.units || []).length > 0 ? (
          <div
            style={{
              marginTop: "4px",
              padding: "12px 16px",
              borderRadius: "14px",
              border: `1px solid ${isLightMode ? "#fca5a5" : "#991b1b"}`,
              background: isLightMode ? "#fef2f2" : "#1f1113",
              maxWidth: "480px",
              width: "100%",
              marginLeft: "auto",
              marginRight: "auto",
              textAlign: "left",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12.5px", fontWeight: 800, color: isLightMode ? "#b91c1c" : "#fca5a5", marginBottom: "6px" }}>
              <AlertTriangle size={14} />
              대여가 중단된 유닛
            </div>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {(borrowLock.units || []).map((u, i) => (
                <span
                  key={`${u.floor}-${u.unit}-${i}`}
                  title={u.reason || ""}
                  style={{ fontSize: "11.5px", fontWeight: 700, padding: "4px 10px", borderRadius: "999px", background: isLightMode ? "#fee2e2" : "#3f1113", color: isLightMode ? "#b91c1c" : "#fca5a5" }}
                >
                  {u.floor} · {u.unit}
                </span>
              ))}
            </div>
            <div style={{ fontSize: "11.5px", color: isLightMode ? "#7f1d1d" : "#fecaca", marginTop: "7px", lineHeight: 1.6 }}>
              다른 유닛은 정상적으로 대여할 수 있고, 반납도 가능합니다.
            </div>
          </div>
        ) : null}

        {/* 상단: 페널티 기준 안내 (항상 고정) */}
        <div
          style={{
            marginTop: "4px",
            padding: "12px 16px",
            borderRadius: "14px",
            border: `1px solid ${isLightMode ? "#fed7aa" : "#7c2d12"}`,
            background: isLightMode ? "#fffbf5" : "#1a1410",
            boxShadow: "0 2px 12px rgba(0,0,0,0.04)",
            maxWidth: "480px",
            width: "100%",
            marginLeft: "auto",
            marginRight: "auto",
            textAlign: "left",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 800, color: isLightMode ? "#c2410c" : "#fdba74", marginBottom: "6px" }}>
            <ShieldAlert size={14} />
            대여 기간 페널티 안내
          </div>
          <div style={{ fontSize: "11.5px", color: isLightMode ? "#78716c" : "#a8a29e", lineHeight: 1.6, marginBottom: "9px" }}>
            앞으로는 <b style={{ color: isLightMode ? "#c2410c" : "#fdba74" }}>사전 통보 없이</b> 아래 기준으로 대여 가능 종류가 제한될 수 있습니다.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {PENALTY_RULES.map((r) => (
              <div key={r.label} style={{ display: "flex", alignItems: "flex-start", gap: "8px", fontSize: "12px" }}>
                <span style={{ flex: 1, minWidth: 0, color: isLightMode ? "#111827" : "#e2e8f0", lineHeight: 1.45 }}>{r.label}</span>
                <span style={{ flexShrink: 0, fontWeight: 800, fontSize: "11px", color: isLightMode ? "#c2410c" : "#fdba74" }}>{r.limit}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 하단: 관리자가 작성한 공지 (최대 3개, 제목만 표시 → 클릭하면 전체 내용) */}
        {connected && notices.length > 0 ? (
          <div
            style={{
              marginTop: "10px",
              padding: "12px 16px",
              borderRadius: "14px",
              border: `1px solid ${isLightMode ? "#bfdbfe" : "#1e3a8a"}`,
              background: isLightMode ? "#f5f9ff" : "#0f1729",
              boxShadow: "0 2px 12px rgba(0,0,0,0.04)",
              maxWidth: "480px",
              width: "100%",
              marginLeft: "auto",
              marginRight: "auto",
              textAlign: "left",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 800, color: isLightMode ? "#1d4ed8" : "#93c5fd", marginBottom: "8px" }}>
              <ClipboardList size={14} />
              공지사항 {notices.length > 1 ? <span style={{ fontWeight: 600, opacity: 0.8 }}>{notices.length}건</span> : null}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              {notices.slice(0, 3).map((n, i) => (
                <button
                  key={`${n.title}-${i}`}
                  onClick={() => setOpenNotice(n)}
                  style={{
                    display: "flex", alignItems: "center", gap: "8px", width: "100%",
                    padding: "8px 6px", borderRadius: "8px", cursor: "pointer",
                    border: "none", background: "transparent", textAlign: "left",
                    borderBottom: i < Math.min(notices.length, 3) - 1 ? `1px solid ${isLightMode ? "#e2e8f0" : "#1e293b"}` : "none",
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0, fontSize: "12.5px", fontWeight: 700, color: isLightMode ? "#111827" : "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {n.title || "(제목 없음)"}
                  </span>
                  {n.updatedAt ? (
                    <span style={{ flexShrink: 0, fontSize: "10.5px", color: isLightMode ? "#94a3b8" : "#64748b" }}>
                      {n.updatedAt.slice(0, 10)}
                    </span>
                  ) : null}
                  <ChevronDown size={13} style={{ flexShrink: 0, transform: "rotate(-90deg)", color: isLightMode ? "#94a3b8" : "#64748b" }} />
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* 공지 전체 내용 모달 */}
        {openNotice ? (
          <div
            onClick={() => setOpenNotice(null)}
            style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "min(520px, 100%)", maxHeight: "80vh", overflowY: "auto",
                background: isLightMode ? "#ffffff" : "#151d30",
                border: `1px solid ${isLightMode ? "#e2e8f0" : "#26324a"}`,
                borderRadius: "16px", padding: "22px", textAlign: "left",
                color: isLightMode ? "#111827" : "#f1f5f9",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", marginBottom: "6px" }}>
                <ClipboardList size={17} style={{ color: isLightMode ? "#1d4ed8" : "#93c5fd", flexShrink: 0, marginTop: "2px" }} />
                <span style={{ flex: 1, fontSize: "16px", fontWeight: 800, lineHeight: 1.4 }}>{openNotice.title || "공지사항"}</span>
                <button onClick={() => setOpenNotice(null)} style={{ background: "transparent", border: "none", cursor: "pointer", color: isLightMode ? "#94a3b8" : "#64748b", padding: 0 }}>✕</button>
              </div>
              {openNotice.updatedAt ? (
                <div style={{ fontSize: "11.5px", color: isLightMode ? "#94a3b8" : "#64748b", marginBottom: "14px" }}>
                  {openNotice.updatedAt}{openNotice.author ? ` · ${openNotice.author}` : ""}
                </div>
              ) : null}
              <div style={{ fontSize: "13.5px", lineHeight: 1.75, whiteSpace: "pre-wrap" }}>
                {openNotice.text}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: "16px",
          maxWidth: "620px",
          width: "100%",
        }}
      >
        {[
          {
            key: "borrow" as const,
            icon: <HandHelping size={24} />,
            title: "대여",
            desc: "SID 기반 대여와 일반 대여를 신청합니다. 신청 내역은 Slack에 자동 공유됩니다.",
          },
          {
            key: "browse" as const,
            icon: <ClipboardList size={24} />,
            title: "열람 조회",
            desc: "시나리오 물품과 공구 및 부품류를 열람합니다. 장바구니에 담아 바로 대여할 수 있습니다.",
          },
        ].map((c) => (
          <div
            key={c.key}
            onClick={() => onNavigate(c.key)}
            style={{
              background: isLightMode ? "#ffffff" : "#1e293b",
              border: `1px solid ${isLightMode ? "#e2e8f0" : "#334155"}`,
              borderRadius: "16px",
              padding: "20px 20px",
              cursor: "pointer",
              transition: "transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease",
              boxShadow: "var(--shadow-sm)",
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-2px)";
              e.currentTarget.style.boxShadow = "0 8px 20px -6px rgba(37, 99, 235, 0.28)";
              e.currentTarget.style.borderColor = "#2563eb";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "var(--shadow-sm)";
              e.currentTarget.style.borderColor = isLightMode ? "#e2e8f0" : "#334155";
            }}
          >
            <div
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "11px",
                background: "rgba(37, 99, 235, 0.12)",
                color: "#2563eb",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: "14px",
              }}
            >
              {c.icon}
            </div>
            <h2
              style={{
                fontSize: "19px",
                fontWeight: 700,
                marginBottom: "8px",
                color: isLightMode ? "#111827" : "#f1f5f9",
              }}
            >
              {c.title}
            </h2>
            <p
              style={{
                fontSize: "13px",
                lineHeight: 1.6,
                color: isLightMode ? "#5b6472" : "#c2c7d0",
                marginBottom: "20px",
              }}
            >
              {c.desc}
            </p>
            <div
              style={{
                marginTop: "auto",
                padding: "9px 16px",
                background: "#2563eb",
                color: "#ffffff",
                borderRadius: "12px",
                fontSize: "13px",
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              {c.title} 하기 →
            </div>
          </div>
        ))}
      </div>

      {/* 관리 모드 (Admin 시트 로그인 필요) */}
      <div
        onClick={() => onNavigate("login")}
        style={{
          maxWidth: "620px",
          width: "100%",
          marginTop: "16px",
          background: isLightMode ? "#ffffff" : "#1e293b",
          border: `1px solid ${isLightMode ? "#e2e8f0" : "#334155"}`,
          borderRadius: "20px",
          padding: "20px 24px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: "16px",
          transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
          boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = "#2563eb";
          e.currentTarget.style.transform = "translateY(-2px)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = isLightMode ? "#e2e8f0" : "#334155";
          e.currentTarget.style.transform = "translateY(0)";
        }}
      >
        <div
          style={{
            flex: "0 0 44px",
            width: "44px",
            height: "44px",
            borderRadius: "12px",
            background: "rgba(37, 99, 235, 0.12)",
            color: "#2563eb",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Settings size={22} />
        </div>
        <div style={{ flex: 1, textAlign: "left" }}>
          <div
            style={{
              fontSize: "16px",
              fontWeight: 700,
              color: isLightMode ? "#111827" : "#f1f5f9",
              marginBottom: "3px",
            }}
          >
            🛠️ 관리 모드
          </div>
          <div style={{ fontSize: "12px", color: isLightMode ? "#64748b" : "#94a3b8" }}>
            창고 구역 배치·재고 수정·로그 관리. Admin 시트의 ID와 비밀번호로 로그인해야 합니다.
          </div>
        </div>
        <div
          style={{
            padding: "9px 18px",
            background: "#2563eb",
            color: "#ffffff",
            borderRadius: "12px",
            fontSize: "13px",
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}
        >
          로그인 →
        </div>
      </div>

      <div
        style={{
          marginTop: "48px",
          fontSize: "11px",
          color: isLightMode ? "#94a3b8" : "#94a3b8",
          display: "flex",
          alignItems: "center",
          gap: "4px",
        }}
      >
        <ShieldAlert size={12} />
        <span>권한 있는 계정 및 패스워드는 스프레드시트의 <strong>Admin</strong> 탭에서 실시간 업데이트 가능합니다.</span>
      </div>
    </div>
  );
}
