import React, { useState } from "react";
import { ClipboardList, HandHelping, Settings, ShieldAlert, PackageCheck, Link as LinkIcon, RefreshCw, CheckCircle, AlertTriangle, HelpCircle, ChevronDown, ChevronUp } from "lucide-react";

interface LandingPageProps {
  onNavigate: (view: "borrow" | "return" | "browse" | "login") => void;
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

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: isLightMode
          ? "radial-gradient(circle at top, #f8fafc 0%, #e2e8f0 100%)"
          : "radial-gradient(circle at top, #0f172a 0%, #020617 100%)",
        color: isLightMode ? "#0f172a" : "#f1f5f9",
        padding: "40px 20px",
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
      }}
    >
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
            borderRadius: "20px",
            background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
            color: "#ffffff",
            marginBottom: "20px",
            boxShadow: "0 10px 25px -5px rgba(79, 70, 229, 0.4)",
          }}
        >
          <PackageCheck size={32} />
        </div>
        <h1
          style={{
            fontSize: "36px",
            fontWeight: 800,
            letterSpacing: "-0.025em",
            marginBottom: "12px",
            background: "linear-gradient(to right, #818cf8, #6366f1, #4f46e5)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          스마트 WMS 자재 자율 대여 및 관리 시스템
        </h1>
        <p
          style={{
            fontSize: "15px",
            color: isLightMode ? "#475569" : "#94a3b8",
            lineHeight: 1.6,
          }}
        >
          실시간 구글 스프레드시트 연동 기반 of 자재 관리 플랫폼입니다.<br />
          대여·반납·열람은 아래 세 가지 모드를 이용하세요. 창고 배치 및 재고 수정은 관리 모드에서 가능합니다.
        </p>

        {/* 구글 시트 연동 상태 인디케이터 */}
        <div
          style={{
            marginTop: "20px",
            display: "inline-flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "8px",
            padding: "12px 24px",
            borderRadius: "16px",
            background: connected ? "rgba(16, 185, 129, 0.08)" : "rgba(245, 158, 11, 0.08)",
            border: connected ? "1px solid rgba(16, 185, 129, 0.2)" : "1px solid rgba(245, 158, 11, 0.2)",
            maxWidth: "600px",
            margin: "20px auto 0 auto",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}>
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: connected ? "#10b981" : "#f59e0b",
                boxShadow: connected ? "0 0 8px #10b981" : "0 0 8px #f59e0b",
              }}
            />
            <span style={{ fontWeight: 600, color: connected ? (isLightMode ? "#047857" : "#34d399") : (isLightMode ? "#b45309" : "#fbbf24") }}>
              {connected ? "구글 스프레드시트 연동 상태 (실시간 동기화)" : "데모 가상 모드 (구글 시트 미연동)"}
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "11px", color: isLightMode ? "#64748b" : "#94a3b8", textAlign: "center" }}>
              {connected 
                ? `연동 주소: ${scriptUrl.substring(0, 35)}...`
                : "타 기기/동료와 실시간으로 데이터를 공유하려면 구글 시트 연동을 마쳐야 합니다."}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenSetup();
              }}
              style={{
                background: connected ? "rgba(99, 102, 241, 0.15)" : "#f59e0b",
                color: connected ? "#6366f1" : "#ffffff",
                border: "none",
                borderRadius: "6px",
                padding: "4px 10px",
                fontSize: "11px",
                fontWeight: 700,
                cursor: "pointer",
                transition: "all 0.2s",
                boxShadow: connected ? "none" : "0 2px 4px rgba(0,0,0,0.1)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "scale(1.02)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "scale(1)";
              }}
            >
              {connected ? "연동 주소 변경" : "구글 시트 연동하기"}
            </button>
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: "16px",
          maxWidth: "800px",
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
            desc: "시나리오 물품과 창고 물품을 열람합니다. 장바구니에 담아 바로 대여할 수 있습니다.",
          },
        ].map((c) => (
          <div
            key={c.key}
            onClick={() => onNavigate(c.key)}
            style={{
              background: isLightMode ? "#ffffff" : "#1e293b",
              border: `1px solid ${isLightMode ? "#e2e8f0" : "#334155"}`,
              borderRadius: "24px",
              padding: "28px 24px",
              cursor: "pointer",
              transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
              boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-4px)";
              e.currentTarget.style.boxShadow = "0 20px 25px -5px rgba(99, 102, 241, 0.25)";
              e.currentTarget.style.borderColor = "#6366f1";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "0 4px 6px -1px rgba(0, 0, 0, 0.1)";
              e.currentTarget.style.borderColor = isLightMode ? "#e2e8f0" : "#334155";
            }}
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "14px",
                background: "rgba(99, 102, 241, 0.15)",
                color: "#818cf8",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: "18px",
              }}
            >
              {c.icon}
            </div>
            <h2
              style={{
                fontSize: "19px",
                fontWeight: 700,
                marginBottom: "8px",
                color: isLightMode ? "#0f172a" : "#f1f5f9",
              }}
            >
              {c.title}
            </h2>
            <p
              style={{
                fontSize: "13px",
                lineHeight: 1.6,
                color: isLightMode ? "#475569" : "#94a3b8",
                marginBottom: "20px",
              }}
            >
              {c.desc}
            </p>
            <div
              style={{
                marginTop: "auto",
                padding: "9px 16px",
                background: "#4f46e5",
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
          maxWidth: "800px",
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
          e.currentTarget.style.borderColor = "#6366f1";
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
            background: "rgba(99, 102, 241, 0.15)",
            color: "#818cf8",
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
              color: isLightMode ? "#0f172a" : "#f1f5f9",
              marginBottom: "3px",
            }}
          >
            🛠️ 관리 모드
          </div>
          <div style={{ fontSize: "12px", color: isLightMode ? "#475569" : "#94a3b8" }}>
            창고 구역 배치·재고 수정·로그 관리. Admin 시트의 ID와 비밀번호로 로그인해야 합니다.
          </div>
        </div>
        <div
          style={{
            padding: "9px 18px",
            background: "#4f46e5",
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
          color: isLightMode ? "#94a3b8" : "#475569",
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
