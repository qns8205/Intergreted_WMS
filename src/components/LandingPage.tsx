import React, { useState, useEffect, useRef } from "react";
import { ClipboardList, PackageOpen, Settings, ShieldAlert, PackageCheck, Link as LinkIcon, RefreshCw, CheckCircle, AlertTriangle, HelpCircle, ChevronDown, ChevronUp, Fingerprint } from "lucide-react";
import { fetchNotices, fetchPenalties, fetchPenaltyDetail, fetchActiveItemTypeCount, NoticeData, PenaltyEntry, PenaltyDetailEntry, BorrowLock, ActiveItemTypeInfo } from "../utils/borrowApi";

// "2026-10-03 13:01:40" → "10/03 13:01"
function shortTime(value: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(value || "");
  return m ? `${m[1]}/${m[2]} ${m[3]}:${m[4]}` : value || "-";
}

// 분 → "1시간 20분" / "35분" / "2일 3시간"
function overText(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}시간 ${m % 60}분` : `${h}시간`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}일 ${h % 24}시간` : `${d}일`;
}

// 고정 안내: 앞으로 적용될 페널티 기준 (코드에 고정한다 — 운영 중 바뀌면 이 배열만 수정)
const PENALTY_RULES: { label: string; limit: string }[] = [
  { label: "모든 사유에 대하여", limit: "5종류로 제한 (7일)" },
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

// 현재 페널티가 적용 중인 사람 목록. 서버가 이미 만료된 건 걸러서 주므로 받은 대로 그린다.
function usePenalties(scriptUrl: string, connected: boolean) {
  const [items, setItems] = useState<PenaltyEntry[]>([]);

  useEffect(() => {
    if (!connected || !scriptUrl) { setItems([]); return; }
    let cancelled = false;
    fetchPenalties(scriptUrl)
      .then((list) => { if (!cancelled) setItems(Array.isArray(list) ? list : []); })
      .catch(() => { /* 랜딩의 부가 정보이므로 실패는 조용히 숨긴다 */ });
    return () => { cancelled = true; };
  }, [scriptUrl, connected]);

  return items;
}

interface LandingPageProps {
  onNavigate: (view: "borrow" | "browse" | "mylookup" | "sid" | "login" | "admin") => void;
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
  /** App.tsx가 최초 마운트 시 이미 조회해둔 값을 그대로 받는다 — 이 화면에서 따로
   *  getBorrowLock을 또 부르면 같은 데이터를 위해 GAS 요청이 두 번 나가게 된다. */
  borrowLock: BorrowLock;
  /** 관리자로 로그인한 상태인지. 관리 모드 카드를 보일지와, 그 카드가 무엇을 하는지가 갈린다. */
  isAdmin?: boolean;
  /** 관리자 이름(표시용). */
  adminName?: string;
  onAdminLogout?: () => void;
  /** 로그인한 대여자. 관리자로 들어온 경우에는 없다. */
  borrower?: { name: string; employeeId: string; affiliation?: string; floor: string; unit: string } | null;
  onChangeSeat?: () => void;
  onLogout?: () => void;
}

export default function LandingPage({
  isAdmin = false,
  adminName = "",
  onAdminLogout,
  borrower = null,
  onChangeSeat,
  onLogout,
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
  borrowLock,
}: LandingPageProps) {
  const [showGuide, setShowGuide] = useState(false);
  const notices = useNotices(scriptUrl, connected);
  const penalties = usePenalties(scriptUrl, connected);
  const [itemTypeInfo, setItemTypeInfo] = useState<ActiveItemTypeInfo | null>(null);
  const [openNotice, setOpenNotice] = useState<NoticeData | null>(null);
  // 페널티를 눌렀을 때 뜨는 상세. 열 때마다 새로 불러온다(그사이 반납되면 결과가 달라진다).
  const [openPenalty, setOpenPenalty] = useState<PenaltyEntry | null>(null);
  const [penaltyDetail, setPenaltyDetail] = useState<PenaltyDetailEntry[] | null>(null);
  const [penaltyDetailError, setPenaltyDetailError] = useState("");

  const penaltyReq = useRef(0);

  function showPenalty(p: PenaltyEntry) {
    const req = ++penaltyReq.current;
    setOpenPenalty(p);
    setPenaltyDetail(null);
    setPenaltyDetailError("");
    fetchPenaltyDetail(scriptUrl, p.name)
      .then((list) => { if (req === penaltyReq.current) setPenaltyDetail(list); })
      .catch((err) => { if (req === penaltyReq.current) setPenaltyDetailError(err?.message || "상세를 불러오지 못했습니다."); });
  }

  function closePenalty() {
    penaltyReq.current++;
    setOpenPenalty(null);
  }

  // 로그인한 사람에게는 현재 빌린 종류를 뺀 실제 추가 대여 가능 수를 보여준다.
  // 로그인 전/관리자 랜딩에서는 빈 이름으로 조회해 현재 설정된 기본 상한만 표시한다.
  useEffect(() => {
    if (!connected || !scriptUrl) { setItemTypeInfo(null); return; }
    let cancelled = false;
    fetchActiveItemTypeCount(
      scriptUrl,
      borrower?.name || "",
      borrower ? { floor: borrower.floor, unit: borrower.unit } : undefined,
      borrower ? { employeeId: borrower.employeeId, affiliation: borrower.affiliation } : undefined,
    )
      .then((info) => { if (!cancelled) setItemTypeInfo(info); })
      .catch(() => { if (!cancelled) setItemTypeInfo(null); });
    return () => { cancelled = true; };
  }, [scriptUrl, connected, borrower?.name, borrower?.employeeId, borrower?.affiliation, borrower?.floor, borrower?.unit]);

  // 대여 잠금/공지 배너는 연결 상태가 확정돼야 뜨는데, 그게 이 화면이 이미 보인 뒤에 뒤늦게
  // 도착하면 배너가 갑자기 나타나면서 바로 아래 메인 카드들이 밀려 내려가 실수로 다른 카드를
  // 누르게 되는 문제가 있었다. 연결 상태가 확정되기 전까지는 카드 영역을 잠깐 로딩 표시로
  // 대신하고, 확정된 뒤(배너가 있든 없든 이미 자리를 잡은 뒤) 카드를 그 자리에 한 번에 그린다.
  // 연결이 계속 안 되는 경우까지 무한정 기다리진 않도록 짧은 최대 대기 시간을 둔다.
  const [cardsReady, setCardsReady] = useState(connected);
  useEffect(() => {
    if (connected) { setCardsReady(true); return; }
    const t = setTimeout(() => setCardsReady(true), 900);
    return () => clearTimeout(t);
  }, [connected]);


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
          // 이 묶음의 마지막 줄(대여자 정보·관리 모드)도 자기 아래 여백을 갖고 있었다.
          // 둘이 더해져 지나치게 벌어졌으므로 그쪽 여백은 없애고 여기서만 준다.
          // 넓은 화면에서는 이 화면 전체가 1.15배로 확대되니 실제 간격은 조금 더 넓다.
          marginBottom: "14px",
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
              maxWidth: "680px",
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
              maxWidth: "680px",
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
            maxWidth: "680px",
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

          {penalties.length > 0 ? (
            <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: `1px solid ${isLightMode ? "#fed7aa" : "#7c2d12"}` }}>
              <div style={{ fontSize: "12px", fontWeight: 800, color: isLightMode ? "#b91c1c" : "#fca5a5", marginBottom: "8px" }}>
                현재 페널티 적용 중
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {penalties.map((p, i) => (
                  <button
                    key={`${p.name}-${i}`}
                    type="button"
                    onClick={() => showPenalty(p)}
                    title="눌러서 사유와 이유 보기"
                    style={{
                      margin: 0,
                      padding: "6px 8px",
                      border: "none",
                      borderRadius: "8px",
                      background: "transparent",
                      cursor: "pointer",
                      textAlign: "left",
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "8px",
                      fontFamily: "inherit",
                      fontSize: isMobile ? "12.5px" : "13.5px",
                      fontWeight: 600,
                      lineHeight: 1.5,
                      wordBreak: "keep-all",
                      color: isLightMode ? "#6b7280" : "#94a3b8",
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontWeight: 800, color: isLightMode ? "#b91c1c" : "#fca5a5" }}>{p.name}</span>
                      {" - "}{p.max}종류{" - "}{p.reason || "사유 없음"}{" - "}{p.until ? p.until.slice(0, 10) : "해제 시까지"}
                    </span>
                    <span style={{ flexShrink: 0, fontSize: "11px", fontWeight: 800, color: isLightMode ? "#c2410c" : "#fdba74", whiteSpace: "nowrap" }}>자세히 ›</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
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
              maxWidth: "680px",
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

        {/* 현재 이용 상태는 사용자 정보·로그아웃 카드와 한 묶음으로 읽히도록 바로 위에 둔다. */}
        {itemTypeInfo ? (
          <div
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap",
              margin: "10px auto 0", padding: "11px 16px", borderRadius: "14px",
              maxWidth: "680px", width: "100%", textAlign: "left",
              background: isLightMode ? "#eff6ff" : "rgba(37,99,235,0.12)",
              border: `1px solid ${isLightMode ? "#bfdbfe" : "rgba(147,197,253,0.28)"}`,
              boxShadow: "0 2px 12px rgba(0,0,0,0.04)",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: "7px", fontSize: "13.5px", fontWeight: 900, color: isLightMode ? "#1d4ed8" : "#bfdbfe" }}>
              <PackageCheck size={16} />
              현재 대여 가능 종류 {itemTypeInfo.exempt || itemTypeInfo.max >= 9999 ? "제한 없음" : `${Math.max(0, itemTypeInfo.max - itemTypeInfo.count)}종류`}
            </span>
            {borrower ? (
              <span style={{ fontSize: "11.5px", fontWeight: 700, color: isLightMode ? "#475569" : "#94a3b8" }}>
                대여 중 {itemTypeInfo.count}종류 · 최대 {itemTypeInfo.exempt || itemTypeInfo.max >= 9999 ? "제한 없음" : `${itemTypeInfo.max}종류`}
              </span>
            ) : (
              <span style={{ fontSize: "11.5px", fontWeight: 700, color: isLightMode ? "#475569" : "#94a3b8" }}>
                현재 기본 제한
              </span>
            )}
          </div>
        ) : null}

        {/* 로그인한 사람과, 자리를 옮겼거나 다른 사람에게 넘길 때 쓰는 단추.
            공지 바로 아래에 둔다 — 메뉴 카드보다 위면 시선을 뺏고, 맨 아래면 못 찾는다. */}
        {borrower ? (
          <div
            style={{
              display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap",
              // 바로 위 공지사항과 같은 폭으로 맞춘다 — 읽는 영역과 좌우가 어긋나면 따로 논다.
              width: "100%", maxWidth: "680px", margin: "8px auto 0",
              padding: "12px 16px", borderRadius: "14px",
              background: isLightMode ? "#ffffff" : "#1e293b",
              border: `1px solid ${isLightMode ? "#e2e8f0" : "#334155"}`,
            }}
          >
            <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
              <div style={{ fontSize: "13.5px", fontWeight: 800, color: isLightMode ? "#111827" : "#f1f5f9" }}>
                {borrower.name}{borrower.employeeId ? ` · ${borrower.employeeId}` : ""}
              </div>
              <div style={{ fontSize: "11.5px", color: isLightMode ? "#64748b" : "#94a3b8", marginTop: "2px" }}>
                {borrower.floor || borrower.unit ? `📍 ${borrower.floor}${borrower.unit ? ` ${borrower.unit}` : ""}` : "좌석 미지정"}
              </div>
            </div>
            <button
              onClick={onChangeSeat}
              style={{
                padding: "8px 14px", borderRadius: "9px", fontSize: "12.5px", fontWeight: 800, cursor: "pointer",
                border: `1px solid ${isLightMode ? "#e2e8f0" : "#334155"}`,
                background: "transparent", color: isLightMode ? "#2563eb" : "#93c5fd",
              }}
            >
              좌석 변경
            </button>
            <button
              onClick={onLogout}
              style={{
                padding: "8px 14px", borderRadius: "9px", fontSize: "12.5px", fontWeight: 800, cursor: "pointer",
                border: "none", background: isLightMode ? "#fee2e2" : "rgba(239,68,68,0.16)", color: "#ef4444",
              }}
            >
              로그아웃
            </button>
          </div>
        ) : null}

        {/* 관리자로 들어왔음을 알리고, 여기서 바로 나갈 수 있게 한다.
            대여자 줄과 같은 자리·같은 모양이라 누가 로그인해 있든 찾는 곳이 같다. */}
        {isAdmin ? (
          <div
            style={{
              display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap",
              width: "100%", maxWidth: "680px", margin: "8px auto 8px",
              padding: "12px 16px", borderRadius: "14px",
              background: isLightMode ? "#ffffff" : "#1e293b",
              border: `1px solid ${isLightMode ? "#e2e8f0" : "#334155"}`,
            }}
          >
            <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
              <div style={{ fontSize: "13.5px", fontWeight: 800, color: isLightMode ? "#111827" : "#f1f5f9" }}>
                🛠️ 관리자 모드{adminName ? ` · ${adminName}` : ""}
              </div>
              <div style={{ fontSize: "11.5px", color: isLightMode ? "#64748b" : "#94a3b8", marginTop: "2px" }}>
                재고·로그·설정을 다룰 수 있습니다.
              </div>
            </div>
            <button
              onClick={onAdminLogout}
              style={{
                padding: "8px 14px", borderRadius: "9px", fontSize: "12.5px", fontWeight: 800, cursor: "pointer",
                border: "none", background: isLightMode ? "#fee2e2" : "rgba(239,68,68,0.16)", color: "#ef4444",
              }}
            >
              로그아웃
            </button>
          </div>
        ) : null}

        {/* 관리 모드.
            - 관리자로 로그인했으면 바로 관리 화면으로 들어간다(다시 로그인시키지 않는다).
            - 대여자로 로그인했으면 아예 보이지 않는다. 쓸 수 없는 문을 보여줄 이유가 없다.
            공지 위에 둔다 — 관리자는 이걸 가장 먼저 누른다. */}
        {isAdmin ? (
      <div
        onClick={() => onNavigate("admin")}
        style={{
          // 위의 관리자 모드 줄과 같은 폭·같은 가운데 정렬이어야 좌우가 맞는다.
          // auto 여백이 없어서 카드만 왼쪽으로 밀려 있었다.
          maxWidth: "680px",
          width: "100%",
          margin: "0 auto 2px",
          background: isLightMode ? "#ffffff" : "#1e293b",
          border: `1px solid ${isLightMode ? "#e2e8f0" : "#334155"}`,
          borderRadius: "14px",
          padding: "16px 18px",
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
            창고 구역 배치·재고 수정·로그 관리.
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
          들어가기 →
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

        {/* 페널티 상세 모달: 사유와 "왜 이 제한이 걸렸는지" */}
        {openPenalty ? (() => {
          const dim = isLightMode ? "#6b7280" : "#94a3b8";
          const red = isLightMode ? "#b91c1c" : "#fca5a5";
          const line = isLightMode ? "#e2e8f0" : "#26324a";
          const stacked = (penaltyDetail || []).filter((d) => d.auto).length;
          return (
            <div
              onClick={closePenalty}
              style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(15,23,42,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: "min(540px, 100%)", maxHeight: "82vh", overflowY: "auto",
                  background: isLightMode ? "#ffffff" : "#151d30",
                  border: `1px solid ${line}`,
                  borderRadius: "16px", padding: "22px", textAlign: "left",
                  color: isLightMode ? "#111827" : "#f1f5f9",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", marginBottom: "14px" }}>
                  <ShieldAlert size={18} style={{ color: red, flexShrink: 0, marginTop: "2px" }} />
                  <span style={{ flex: 1, fontSize: "16px", fontWeight: 800, lineHeight: 1.4 }}>{openPenalty.name} 님의 대여 제한</span>
                  <button onClick={closePenalty} style={{ background: "transparent", border: "none", cursor: "pointer", color: isLightMode ? "#94a3b8" : "#64748b", padding: 0 }}>✕</button>
                </div>

                <div style={{ padding: "12px 14px", borderRadius: "12px", background: isLightMode ? "#fff7ed" : "#1f1611", border: `1px solid ${isLightMode ? "#fed7aa" : "#7c2d12"}`, fontSize: "13px", lineHeight: 1.7, marginBottom: "16px" }}>
                  지금 한 번에 빌릴 수 있는 물품은 <b style={{ color: red }}>{openPenalty.max}종류</b>까지입니다.<br />
                  {openPenalty.until
                    ? <>해제 예정일은 <b>{openPenalty.until.slice(0, 10)}</b>입니다. 그 날짜가 되면 자동으로 풀립니다.</>
                    : <>기한이 정해져 있지 않아, 관리자가 해제할 때까지 적용됩니다.</>}
                </div>

                <div style={{ fontSize: "12px", fontWeight: 800, color: dim, marginBottom: "8px" }}>왜 이렇게 됐나요?</div>

                {penaltyDetailError ? (
                  <div style={{ fontSize: "12.5px", color: red, lineHeight: 1.6 }}>상세를 불러오지 못했습니다. 아래 사유만 확인해 주세요.<br />{openPenalty.reason || "사유 없음"}</div>
                ) : penaltyDetail === null ? (
                  <div style={{ fontSize: "12.5px", color: dim }}>불러오는 중…</div>
                ) : penaltyDetail.length === 0 ? (
                  <div style={{ fontSize: "13px", lineHeight: 1.7 }}>{openPenalty.reason || "사유 없음"}</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {penaltyDetail.map((d, idx) => (
                      <div key={d.id} style={{ padding: "12px 14px", borderRadius: "12px", border: `1px solid ${line}`, background: isLightMode ? "#f8fafc" : "#0f172a" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "6px" }}>
                          <span style={{ fontSize: "10.5px", fontWeight: 800, padding: "2px 8px", borderRadius: "999px", color: d.auto ? "#7c3aed" : "#0369a1", border: `1px solid ${d.auto ? "#7c3aed66" : "#0369a166"}` }}>
                            {d.auto ? "자동 부여 (무인 모드)" : "관리자가 직접 등록"}
                          </span>
                          {idx === 0 && penaltyDetail.length > 1 ? <span style={{ fontSize: "10.5px", fontWeight: 800, color: red }}>가장 최근</span> : null}
                          <span style={{ marginLeft: "auto", fontSize: "11.5px", fontWeight: 800, color: red }}>{d.max}종류 · {d.until ? `${d.until.slice(0, 10)} 해제` : "해제 시까지"}</span>
                        </div>
                        <div style={{ fontSize: "13px", lineHeight: 1.7, fontWeight: 700 }}>{d.reason || "사유 없음"}</div>
                        {d.events.map((e, n) => {
                          const pickup = e.eventType === "pickup_unconfirmed_4h";
                          return (
                            <div key={n} style={{ marginTop: "8px", paddingTop: "8px", borderTop: `1px dashed ${line}`, fontSize: "12.5px", lineHeight: 1.7, color: isLightMode ? "#374151" : "#cbd5e1" }}>
                              {pickup ? "대여를 신청한 뒤 " : "대여 확인(수령) 뒤 "}
                              <b>{e.hours}시간</b> 안에 {pickup ? "대여 확인을" : "반납을"} 처리해야 하는데,
                              {" "}기한({shortTime(e.deadlineAt)})까지 처리되지 않았습니다
                              {e.overMinutes > 0 ? <> — <b style={{ color: red }}>{overText(e.overMinutes)}</b> 초과</> : null}.
                              <div style={{ fontSize: "11.5px", color: dim, marginTop: "2px" }}>
                                {e.requestCode ? `신청 ${e.requestCode} · ` : ""}{pickup ? "신청" : "대여 확인"} {shortTime(e.sourceAt)} → 페널티 부여 {shortTime(e.occurredAt)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                    {stacked > 1 ? (
                      <div style={{ fontSize: "12px", color: dim, lineHeight: 1.7 }}>
                        자동 페널티가 {stacked}건 쌓여 있습니다. 한 건이 생길 때마다 대여 가능 종류가 2종씩 줄고, 가장 최근 건의 값이 지금 적용되는 제한입니다.
                      </div>
                    ) : null}
                  </div>
                )}

                <div style={{ marginTop: "16px", fontSize: "11.5px", color: dim, lineHeight: 1.6 }}>
                  사유에 이의가 있거나 일찍 풀어야 하면 관리자에게 문의해 주세요. 반납은 제한 중에도 그대로 할 수 있습니다.
                </div>
              </div>
            </div>
          );
        })() : null}
      </div>

      {!isAdmin && cardsReady ? (
      <>
      <div
        style={{
          // 세로로 쌓는다. 가로로 세 칸을 벌리면 카드 하나가 900픽셀의 3분의 1을 차지해
          // 설명이 두세 줄로 접히고, 화면 폭에 따라 2열로 갈라지기도 했다.
          // 위의 공지·정보 줄과 폭을 맞추면 화면 전체가 한 기둥으로 읽힌다.
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          maxWidth: "680px",
          width: "100%",
        }}
      >
        {[
          // "대여" 카드는 없앴다. 대여는 이제 대여 화면에서 물품을 담아 시작한다 —
          // 들어가는 길이 둘이면 어느 쪽으로 들어왔는지에 따라 묻는 것이 달라져 헷갈린다.
          {
            key: "browse" as const,
            icon: <ClipboardList size={24} />,
            title: "대여",
            // 제목 뒤에 "하기"를 붙이면 "대여 하기"처럼 띄어쓰기가 어색해진다. 카드마다 따로 적는다.
            cta: "대여하기",
            desc: "시나리오 물품과 테이블보를 보고 장바구니에 담아 대여합니다.",
          },
          {
            key: "mylookup" as const,
            icon: <PackageOpen size={24} />,
            title: "내 대여 조회",
            cta: "조회하기",
            desc: "내가 대여 중인 시나리오 물품·COS 물품과 보관 위치를 확인합니다.",
          },
          {
            key: "sid" as const,
            icon: <Fingerprint size={24} />,
            title: "SID 열람",
            cta: "열람하기",
            desc: "시나리오 ID로 필요한 물품과 보관 위치를 확인합니다.",
          },
        ].map((c) => (
          <div
            key={c.key}
            onClick={() => onNavigate(c.key)}
            style={{
              background: isLightMode ? "#ffffff" : "#1e293b",
              border: `1px solid ${isLightMode ? "#e2e8f0" : "#334155"}`,
              borderRadius: "14px",
              padding: "24px 20px",
              cursor: "pointer",
              transition: "transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease",
              boxShadow: "var(--shadow-sm)",
              // 세로로 쌓이는 카드라 안쪽은 가로로 둔다 — 아이콘·글·버튼을 한 줄에 놓으면
              // 카드 높이가 낮아져 셋이 한 화면에 들어온다.
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: "14px",
              textAlign: "left",
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
                flex: "0 0 50px",
                width: "50px",
                height: "50px",
                borderRadius: "13px",
                background: "rgba(37, 99, 235, 0.12)",
                color: "#2563eb",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {c.icon}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2
                style={{
                  fontSize: "17px",
                  fontWeight: 800,
                  margin: "0 0 5px",
                  color: isLightMode ? "#111827" : "#f1f5f9",
                }}
              >
                {c.title}
              </h2>
              <p
                style={{
                  fontSize: "12.5px",
                  lineHeight: 1.55,
                  margin: 0,
                  color: isLightMode ? "#5b6472" : "#c2c7d0",
                }}
              >
                {c.desc}
              </p>
            </div>
            <div
              style={{
                flexShrink: 0,
                padding: "11px 18px",
                background: "#2563eb",
                color: "#ffffff",
                borderRadius: "12px",
                fontSize: "12.5px",
                fontWeight: 700,
                whiteSpace: "nowrap",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              {c.cta} →
            </div>
          </div>
        ))}
      </div>


      </>
      ) : !isAdmin ? (
        <div
          style={{
            maxWidth: "620px",
            width: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "10px",
            padding: "48px 0",
            color: isLightMode ? "#94a3b8" : "#64748b",
          }}
        >
          <style>{`@keyframes lp-spin { to { transform: rotate(360deg); } }`}</style>
          <div
            style={{
              width: "22px", height: "22px", borderRadius: "50%",
              border: `2.5px solid ${isLightMode ? "#e2e8f0" : "#334155"}`,
              borderTopColor: "#2563eb",
              animation: "lp-spin 0.7s linear infinite",
            }}
          />
          <span style={{ fontSize: "12.5px", fontWeight: 600 }}>불러오는 중...</span>
        </div>
      ) : null}

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
        <span>권한 있는 계정 및 패스워드는 설정의 <strong>Admin 계정</strong> 탭에서 실시간 관리 가능합니다.</span>
      </div>
    </div>
  );
}
