import React, { useState } from "react";
import { ClipboardList, HandHelping, PackageOpen, Settings, ShieldAlert, PackageCheck, Link as LinkIcon, RefreshCw, CheckCircle, AlertTriangle, HelpCircle, ChevronDown, ChevronUp } from "lucide-react";

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
        color: isLightMode ? "#23272f" : "#e8eaed",
        padding: "32px 20px",
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
            color: isLightMode ? "#2b303a" : "#e8eaed",
          }}
        >
          자재 대여 · 반납 · 관리
        </h1>
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
            desc: "시나리오 물품과 창고 물품을 열람합니다. 장바구니에 담아 바로 대여할 수 있습니다.",
          },
          {
            key: "mylookup" as const,
            icon: <PackageOpen size={24} />,
            title: "내 대여 조회",
            desc: "내가 대여 중인 시나리오·창고 물품과 위치를 확인합니다.",
          },
        ].map((c) => (
          <div
            key={c.key}
            onClick={() => onNavigate(c.key)}
            style={{
              background: isLightMode ? "#fbfcfd" : "#262a33",
              border: `1px solid ${isLightMode ? "#dfe3e9" : "#333844"}`,
              borderRadius: "16px",
              padding: "20px 20px",
              cursor: "pointer",
              transition: "transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease",
              boxShadow: "var(--raise)",
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-2px)";
              e.currentTarget.style.boxShadow = "0 1px 0 rgba(255,255,255,0.9) inset, 0 3px 6px rgba(17,24,39,0.06), 0 14px 30px rgba(17,24,39,0.13)";
              e.currentTarget.style.borderColor = "#2563eb";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "var(--raise)";
              e.currentTarget.style.borderColor = isLightMode ? "#dfe3e9" : "#333844";
            }}
          >
            <div
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "11px",
                background: "rgba(37, 99, 235, 0.13)",
                color: "#94a3b8",
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
                color: isLightMode ? "#23272f" : "#e8eaed",
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
                background: "#334155",
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
          background: isLightMode ? "#fbfcfd" : "#262a33",
          border: `1px solid ${isLightMode ? "#dfe3e9" : "#333844"}`,
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
          e.currentTarget.style.borderColor = isLightMode ? "#dfe3e9" : "#333844";
          e.currentTarget.style.transform = "translateY(0)";
        }}
      >
        <div
          style={{
            flex: "0 0 44px",
            width: "44px",
            height: "44px",
            borderRadius: "12px",
            background: "rgba(37, 99, 235, 0.15)",
            color: "#94a3b8",
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
              color: isLightMode ? "#23272f" : "#e8eaed",
              marginBottom: "3px",
            }}
          >
            🛠️ 관리 모드
          </div>
          <div style={{ fontSize: "12px", color: isLightMode ? "#2563eb" : "#94a3b8" }}>
            창고 구역 배치·재고 수정·로그 관리. Admin 시트의 ID와 비밀번호로 로그인해야 합니다.
          </div>
        </div>
        <div
          style={{
            padding: "9px 18px",
            background: "#334155",
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
          color: isLightMode ? "#94a3b8" : "#2563eb",
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
