import React, { useState, useEffect } from "react";
import { ClipboardList, HandHelping, PackageOpen, Settings, ShieldAlert, PackageCheck, Link as LinkIcon, RefreshCw, CheckCircle, AlertTriangle, HelpCircle, ChevronDown, ChevronUp, TrendingDown } from "lucide-react";
import { fetchScenarioAllLogs, fetchScenarioObjectsForAdmin } from "../utils/borrowApi";

// 가장 적게 대여된 물품: 랜딩 진입 때마다 무거운 전체 대장 조회를 반복하지 않도록
// 모듈 레벨에서 5분간 캐시한다. 실패해도 조용히 숨긴다(랜딩 화면의 부가 정보일 뿐이므로).
const bottomItemsCache: { key: string; at: number; items: [string, number][] } = { key: "", at: 0, items: [] };

type BottomItemsState = {
  items: [string, number][];
  loading: boolean;
  failed: boolean;
};

function useBottomItems(scriptUrl: string, connected: boolean): BottomItemsState {
  const cached = bottomItemsCache.key === scriptUrl && Date.now() - bottomItemsCache.at < 5 * 60 * 1000;
  const [items, setItems] = useState<[string, number][]>(cached ? bottomItemsCache.items : []);
  // 연동은 되어 있지만 아직 캐시가 없으면 곧바로 로딩 중 상태로 시작한다.
  // → 카드가 나중에 "툭" 튀어나오지 않고, 랜딩 화면과 함께 스켈레톤으로 바로 보인다.
  const [loading, setLoading] = useState(!!connected && !!scriptUrl && !cached);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!connected || !scriptUrl) { setLoading(false); return; }
    if (bottomItemsCache.key === scriptUrl && Date.now() - bottomItemsCache.at < 5 * 60 * 1000) {
      setItems(bottomItemsCache.items);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    (async () => {
      try {
        const [logs, catalog] = await Promise.all([
          fetchScenarioAllLogs(scriptUrl),
          fetchScenarioObjectsForAdmin(scriptUrl).catch(() => []),
        ]);
        const byItem: Record<string, number> = {};
        // 카탈로그의 모든 물품을 먼저 0으로 깔아둔다 — 한 번도 대여된 적 없는 물품도 순위에 포함되도록.
        catalog.forEach((it) => {
          const nm = String(it.name || "").trim();
          if (nm) byItem[nm] = 0;
        });
        logs.forEach((l) => {
          const nm = String(l.itemName || "").trim();
          if (!nm || nm === "(물품 미등록)") return;
          byItem[nm] = (byItem[nm] || 0) + (l.quantity || 1);
        });
        const bottom = Object.entries(byItem).sort((a, b) => a[1] - b[1]).slice(0, 5) as [string, number][];
        bottomItemsCache.key = scriptUrl;
        bottomItemsCache.at = Date.now();
        bottomItemsCache.items = bottom;
        if (!cancelled) { setItems(bottom); setLoading(false); }
      } catch {
        // 조용히 무시하되, 로딩 스켈레톤은 접어서 실패를 티내지 않는다(랜딩 화면의 부가 정보일 뿐이므로).
        if (!cancelled) { setLoading(false); setFailed(true); }
      }
    })();
    return () => { cancelled = true; };
  }, [scriptUrl, connected]);

  return { items, loading, failed };
}

interface LandingPageProps {
  onNavigate: (view: "borrow" | "return" | "browse" | "mylookup" | "login") => void;
  isLightMode: boolean;
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
  const { items: bottomItems, loading: bottomLoading } = useBottomItems(scriptUrl, connected);

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
          공구 및 부품류 대여 · 반납 · 관리
        </h1>
        {connected && (bottomLoading || bottomItems.length > 0) ? (
          <div
            style={{
              display: "inline-block",
              textAlign: "left",
              marginTop: "4px",
              padding: "12px 16px",
              borderRadius: "14px",
              border: `1px solid ${isLightMode ? "#e2e8f0" : "#1e293b"}`,
              background: isLightMode ? "#ffffff" : "#0f172a",
              boxShadow: "0 2px 12px rgba(0,0,0,0.04)",
              maxWidth: "420px",
              width: "100%",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 800, color: isLightMode ? "#475569" : "#94a3b8", marginBottom: "8px" }}>
              <TrendingDown size={14} style={{ color: isLightMode ? "#2563eb" : "#60a5fa" }} />
              가장 적게 대여된 물품
            </div>
            {bottomLoading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    style={{
                      height: "13px",
                      borderRadius: "6px",
                      width: i === 0 ? "70%" : i === 1 ? "55%" : "62%",
                      background: isLightMode ? "#e2e8f0" : "#1e293b",
                      animation: "landingSkeletonPulse 1.2s ease-in-out infinite",
                      animationDelay: `${i * 0.12}s`,
                    }}
                  />
                ))}
                <style>{`@keyframes landingSkeletonPulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }`}</style>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {bottomItems.map(([name, qty]) => (
                  <div key={name} style={{ display: "flex", justifyContent: "space-between", gap: "10px", fontSize: "12px" }}>
                    <span style={{ color: isLightMode ? "#111827" : "#e2e8f0", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                    <span style={{ color: isLightMode ? "#64748b" : "#94a3b8", flexShrink: 0 }}>{qty}개</span>
                  </div>
                ))}
              </div>
            )}
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
            key: "return" as const,
            icon: <PackageCheck size={24} />,
            title: "반납",
            desc: "대여 중인 물품을 선택해 반납 처리합니다. 부분 수량 반납도 가능합니다.",
          },
          {
            key: "browse" as const,
            icon: <ClipboardList size={24} />,
            title: "열람 조회",
            desc: "시나리오 물품과 공구 및 부품류를 열람합니다. 장바구니에 담아 바로 대여할 수 있습니다.",
          },
          {
            key: "mylookup" as const,
            icon: <PackageOpen size={24} />,
            title: "내 대여 조회",
            desc: "내가 대여 중인 시나리오·공구 및 부품류와 위치를 확인합니다.",
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
