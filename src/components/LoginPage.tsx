import React, { useState } from "react";
import { WmsUser } from "../types";
import { Lock, User, RefreshCw, KeyRound, Eye, ShieldAlert } from "lucide-react";
import { setAdminToken } from "../utils/adminAuth";

interface LoginPageProps {
  users: WmsUser[];
  onLoginSuccess: (user: WmsUser) => void;
  onViewOnlyMode: () => void;
  adminOnly?: boolean;
  onBack?: () => void;
  isLightMode: boolean;
  onSyncUsers: () => Promise<void>;
  syncing: boolean;
  isMobile: boolean;
}

export default function LoginPage({
  users,
  onLoginSuccess,
  onViewOnlyMode,
  adminOnly = false,
  onBack,
  isLightMode,
  onSyncUsers,
  syncing,
  isMobile,
}: LoginPageProps) {
  const [selectedMode, setSelectedMode] = useState<"view" | "admin">(adminOnly ? "admin" : "view");
  const [idInput, setIdInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [localError, setLocalError] = useState("");

  const [loggingIn, setLoggingIn] = useState(false);

  // 관리자 가입 신청: Scenario Manager 계정의 아이디·비밀번호로 신청하고, 기존 관리자가 승인한다.
  const [signupView, setSignupView] = useState<"off" | "form" | "done">("off");
  const [signupName, setSignupName] = useState("");
  const [signupSending, setSignupSending] = useState(false);

  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError("");
    const name = signupName.trim().replace(/\s+/g, " ");
    if (!idInput.trim() || !passwordInput) { setLocalError("Scenario Manager 아이디와 비밀번호를 입력해 주세요."); return; }
    if (name.length < 2 || name.length > 20) { setLocalError("이름을 2~20자로 입력해 주세요."); return; }
    setSignupSending(true);
    try {
      const res = await fetch("/api/admin-signup-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId: idInput.trim(), password: passwordInput, name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) { setLocalError(data.error || `신청 실패 (HTTP ${res.status})`); return; }
      setPasswordInput("");
      setSignupView("done");
    } catch (err: any) {
      setLocalError("가입 신청에 실패했습니다: " + err.message);
    } finally {
      setSignupSending(false);
    }
  };

  const leaveSignup = () => { setSignupView("off"); setPasswordInput(""); setSignupName(""); setLocalError(""); };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError("");

    if (!idInput.trim() || !passwordInput.trim()) {
      setLocalError("아이디와 비밀번호를 모두 입력해 주세요.");
      return;
    }

    setLoggingIn(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId: idInput.trim(), password: passwordInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setLocalError(data.error || "일치하는 계정 정보가 없습니다. 다시 입력해 주세요.");
        return;
      }
      setAdminToken(data.token);
      onLoginSuccess({ id: data.user.loginId, name: data.user.name });
    } catch (err: any) {
      setLocalError("로그인 요청에 실패했습니다: " + err.message);
    } finally {
      setLoggingIn(false);
    }
  };

  const ACCENT = "#2563eb";
  const ACCENT_LIGHT = "rgba(37, 99, 235, 0.08)";
  const TEXT_MAIN = isLightMode ? "#0f172a" : "#f1f5f9";
  const TEXT_DIM = isLightMode ? "#2563eb" : "#94a3b8";
  const PANEL_BG = isLightMode ? "#ffffff" : "#1e293b";
  const INPUT_BG = isLightMode ? "#f8fafc" : "#0f172a";
  const BORDER_COLOR = isLightMode ? "#cbd5e1" : "#334155";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: isLightMode
          ? "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)"
          : "linear-gradient(135deg, #0f172a 0%, #020617 100%)",
        color: TEXT_MAIN,
        padding: "24px 16px",
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "760px",
          background: PANEL_BG,
          border: `1px solid ${BORDER_COLOR}`,
          borderRadius: "24px",
          padding: "40px 48px",
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 10px 10px -5px rgba(0, 0, 0, 0.1)",
        }}
      >
        {/* Header App Title */}
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "56px",
              height: "56px",
              borderRadius: "16px",
              background: "rgba(37, 99, 235, 0.12)",
              color: ACCENT,
              marginBottom: "16px",
            }}
          >
            <Lock size={26} />
          </div>
          <h1 style={{ fontSize: "22px", fontWeight: 800, color: TEXT_MAIN, marginBottom: "8px", letterSpacing: "-0.03em" }}>
            창고 보관구역 관리 시스템
          </h1>
          <p style={{ fontSize: "13px", color: TEXT_DIM }}>
            원하시는 서비스 이용 권한을 선택하여 시작하세요.
          </p>
        </div>

        {!adminOnly && (
        <>
        {/* Permissions Choice Cards: Side-by-Side */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "16px",
            marginBottom: "28px",
          }}
        >
          {/* Left Choice Card: View-Only Mode */}
          <button
            type="button"
            onClick={onViewOnlyMode}
            style={{
              background: "transparent",
              border: `2px solid ${BORDER_COLOR}`,
              borderRadius: "20px",
              padding: "32px 20px",
              cursor: "pointer",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "14px",
              transition: "all 0.2s ease-in-out",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "#10b981";
              e.currentTarget.style.background = isLightMode ? "rgba(16, 185, 129, 0.04)" : "rgba(16, 185, 129, 0.08)";
              e.currentTarget.style.transform = "translateY(-2px)";
              e.currentTarget.style.boxShadow = "0 10px 25px rgba(16, 185, 129, 0.15)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = BORDER_COLOR;
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.transform = "none";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            <div
              style={{
                width: "56px",
                height: "56px",
                borderRadius: "50%",
                background: "rgba(16, 185, 129, 0.12)",
                color: "#10b981",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.2s",
              }}
            >
              <Eye size={28} />
            </div>
            <div>
              <div style={{ fontSize: "16px", fontWeight: 800, color: TEXT_MAIN, marginBottom: "4px" }}>
                열람용 모드
              </div>
              <div style={{ fontSize: "11.5px", color: TEXT_DIM, lineHeight: "1.4" }}>
                실시간 현황 조회 전용<br />
                <span style={{ color: "#10b981", fontWeight: 600 }}>[즉시 진입하기]</span>
              </div>
            </div>
          </button>

          {/* Right Choice Card: Admin Mode */}
          <button
            type="button"
            onClick={() => {
              setSelectedMode("admin");
              setLocalError("");
            }}
            style={{
              background: selectedMode === "admin"
                ? (isLightMode ? "rgba(37, 99, 235, 0.05)" : "rgba(37, 99, 235, 0.15)")
                : "transparent",
              border: `2px solid ${selectedMode === "admin" ? ACCENT : BORDER_COLOR}`,
              borderRadius: "20px",
              padding: "32px 20px",
              cursor: "pointer",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "14px",
              transition: "all 0.2s ease-in-out",
              opacity: 1,
              boxShadow: selectedMode === "admin" ? `0 10px 25px ${isLightMode ? "rgba(37, 99, 235, 0.15)" : "rgba(37, 99, 235, 0.3)"}` : "none",
            }}
            onMouseEnter={(e) => {
              if (selectedMode === "admin") return;
              e.currentTarget.style.borderColor = ACCENT;
              e.currentTarget.style.background = isLightMode ? "rgba(37, 99, 235, 0.02)" : "rgba(255, 255, 255, 0.03)";
            }}
            onMouseLeave={(e) => {
              if (selectedMode === "admin") return;
              e.currentTarget.style.borderColor = BORDER_COLOR;
              e.currentTarget.style.background = "transparent";
            }}
          >
            <div
              style={{
                width: "56px",
                height: "56px",
                borderRadius: "50%",
                background: selectedMode === "admin" ? ACCENT : (isLightMode ? "#e2e8f0" : "#334155"),
                color: selectedMode === "admin" ? "#ffffff" : TEXT_DIM,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.2s",
              }}
            >
              <ShieldAlert size={26} />
            </div>
            <div>
              <div style={{ fontSize: "16px", fontWeight: 800, color: TEXT_MAIN, marginBottom: "4px" }}>
                관리자 모드
              </div>
              <div style={{ fontSize: "11.5px", color: TEXT_DIM, lineHeight: "1.4" }}>
                {isMobile ? (
                  <>
                    모바일 대여/반납/등록/불량<br />
                    <span style={{ color: ACCENT, fontWeight: 600 }}>[모바일 관리자 로그인]</span>
                  </>
                ) : (
                  <>
                    재고 정보 수정 및 등록<br />
                    <span style={{ color: ACCENT, fontWeight: 600 }}>[로그인 필요]</span>
                  </>
                )}
              </div>
            </div>
          </button>
        </div>
        </>
        )}

        {isMobile && (
          <div
            style={{
              fontSize: "12px",
              color: selectedMode === "admin" ? ACCENT : "#10b981",
              background: selectedMode === "admin" ? "rgba(37, 99, 235, 0.08)" : "rgba(16, 185, 129, 0.08)",
              border: selectedMode === "admin" ? "1px solid rgba(37, 99, 235, 0.2)" : "1px solid rgba(16, 185, 129, 0.2)",
              borderRadius: "12px",
              padding: "12px 14px",
              marginBottom: "24px",
              textAlign: "center",
              lineHeight: 1.5,
            }}
          >
            {selectedMode === "admin" ? (
              <span>📱 <b>모바일 관리자 모드 시스템</b>을 가동합니다. 대여, 반납, 신규 제품 등록 및 불량 접수를 한 곳에서 간편하게 처리할 수 있습니다.</span>
            ) : (
              <span>👀 현재 <b>열람용 모드</b>가 선택되어 있습니다. 우측의 관리자 모드를 선택하시면 로그인하여 직접 작업을 수행할 수 있습니다.</span>
            )}
          </div>
        )}

        {adminOnly && (
          <div
            style={{
              fontSize: "12px",
              color: ACCENT,
              background: "rgba(37, 99, 235, 0.08)",
              border: "1px solid rgba(37, 99, 235, 0.2)",
              borderRadius: "12px",
              padding: "12px 14px",
              marginBottom: "20px",
              textAlign: "center",
              lineHeight: 1.5,
            }}
          >
            🔒 <b>관리 모드</b>는 Admin 계정에 등록된 ID와 비밀번호로 로그인해야 이용할 수 있습니다.
          </div>
        )}

        {/* Dynamic Panel based on selection */}
        {selectedMode === "admin" && signupView === "done" && (
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ fontSize: "16px", fontWeight: 800 }}>관리자 가입 신청이 접수되었습니다</div>
            <div style={{ fontSize: "12.5px", color: TEXT_DIM, lineHeight: 1.7 }}>
              기존 관리자가 승인하면 <b style={{ color: TEXT_MAIN }}>{idInput.trim()}</b> 계정으로 로그인할 수 있습니다.
            </div>
            <button type="button" onClick={leaveSignup} style={{ background: ACCENT, color: "#fff", border: "none", borderRadius: "10px", padding: "12px", fontSize: "13.5px", fontWeight: 700, cursor: "pointer" }}>
              로그인 화면으로
            </button>
          </div>
        )}

        {selectedMode === "admin" && signupView !== "done" && (
          <form onSubmit={signupView === "form" ? handleSignupSubmit : handleLoginSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {signupView === "form" && (
              <div style={{ fontSize: "12px", color: ACCENT, background: "rgba(37, 99, 235, 0.08)", border: "1px solid rgba(37, 99, 235, 0.2)", borderRadius: "12px", padding: "12px 14px", lineHeight: 1.6 }}>
                <b>Scenario Manager와 같은 아이디·비밀번호</b>로 신청해 주세요. Scenario Manager에서 로그인되는 계정만 신청할 수 있고, 기존 관리자가 승인하면 같은 아이디·비밀번호로 로그인됩니다.
              </div>
            )}
            {/* ID Input */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "11px", fontWeight: 700, color: TEXT_DIM }}>
                관리자 ID
              </label>
              <div style={{ position: "relative" }}>
                <User
                  size={16}
                  style={{
                    position: "absolute",
                    left: "12px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: isLightMode ? "#94a3b8" : "#64748b",
                  }}
                />
                <input
                  type="text"
                  placeholder="ID 입력"
                  value={idInput}
                  onChange={(e) => setIdInput(e.target.value)}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck="false"
                  style={{
                    width: "100%",
                    background: INPUT_BG,
                    border: `1px solid ${BORDER_COLOR}`,
                    borderRadius: "10px",
                    padding: "10px 12px 10px 38px",
                    color: TEXT_MAIN,
                    fontSize: "13px",
                    outline: "none",
                    transition: "border-color 0.2s",
                  }}
                  onFocus={(e) => (e.target.style.borderColor = ACCENT)}
                  onBlur={(e) => (e.target.style.borderColor = BORDER_COLOR)}
                />
              </div>
            </div>

            {/* Password Input */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "11px", fontWeight: 700, color: TEXT_DIM }}>
                비밀번호
              </label>
              <div style={{ position: "relative" }}>
                <KeyRound
                  size={16}
                  style={{
                    position: "absolute",
                    left: "12px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: isLightMode ? "#94a3b8" : "#64748b",
                  }}
                />
                <input
                  type="password"
                  placeholder="비밀번호 입력"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck="false"
                  style={{
                    width: "100%",
                    background: INPUT_BG,
                    border: `1px solid ${BORDER_COLOR}`,
                    borderRadius: "10px",
                    padding: "10px 12px 10px 38px",
                    color: TEXT_MAIN,
                    fontSize: "13px",
                    outline: "none",
                    transition: "border-color 0.2s",
                  }}
                  onFocus={(e) => (e.target.style.borderColor = ACCENT)}
                  onBlur={(e) => (e.target.style.borderColor = BORDER_COLOR)}
                />
              </div>
            </div>

            {signupView === "form" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "11px", fontWeight: 700, color: TEXT_DIM }}>이름</label>
                <input
                  type="text"
                  placeholder="실명"
                  maxLength={20}
                  value={signupName}
                  onChange={(e) => setSignupName(e.target.value)}
                  style={{ width: "100%", background: INPUT_BG, border: `1px solid ${BORDER_COLOR}`, borderRadius: "10px", padding: "10px 12px", color: TEXT_MAIN, fontSize: "13px", outline: "none" }}
                />
              </div>
            )}

            <div style={{ fontSize: "11px", color: TEXT_DIM, display: "flex", justifyContent: "space-between" }}>
              <span>현재 동기화된 관리자 계정 수: <b style={{ color: ACCENT }}>{users.length}개</b></span>
            </div>

            {localError && (
              <div
                style={{
                  fontSize: "12px",
                  color: "#ef4444",
                  background: "rgba(239, 68, 68, 0.08)",
                  padding: "8px 12px",
                  borderRadius: "8px",
                  border: "1px solid rgba(239, 68, 68, 0.15)",
                  textAlign: "center",
                }}
              >
                {localError}
              </div>
            )}

            <button
              type="submit"
              disabled={loggingIn || signupSending}
              style={{
                width: "100%",
                opacity: loggingIn || signupSending ? 0.6 : 1,
                background: ACCENT,
                color: "#ffffff",
                border: "none",
                borderRadius: "10px",
                padding: "12px",
                fontSize: "13.5px",
                fontWeight: 700,
                cursor: "pointer",
                transition: "background 0.2s",
                boxShadow: "0 4px 12px rgba(37, 99, 235, 0.25)",
                marginTop: "4px",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#334155")}
              onMouseLeave={(e) => (e.currentTarget.style.background = ACCENT)}
            >
              {signupView === "form"
                ? (signupSending ? "계정 확인 중..." : "가입 신청")
                : (loggingIn ? "로그인 확인 중..." : "🔐 관리자 로그인 및 모니터링 진입")}
            </button>

            <button
              type="button"
              onClick={() => { setLocalError(""); setSignupView(signupView === "form" ? "off" : "form"); }}
              style={{ background: "transparent", border: "none", color: ACCENT, fontSize: "12px", fontWeight: 700, cursor: "pointer", padding: "2px", textDecoration: "underline" }}
            >
              {signupView === "form" ? "← 로그인으로 돌아가기" : "관리자 계정이 없나요? 가입 신청"}
            </button>
          </form>
        )}

        {/* Sync Area at the bottom */}
        <div
          style={{
            marginTop: "24px",
            paddingTop: "16px",
            borderTop: `1px solid ${isLightMode ? "#f1f5f9" : "#334155"}`,
            display: "flex",
            justifyContent: "center",
          }}
        >
          <button
            onClick={onSyncUsers}
            disabled={syncing}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              background: "transparent",
              border: "none",
              color: ACCENT,
              fontSize: "11px",
              fontWeight: 700,
              cursor: "pointer",
              opacity: syncing ? 0.6 : 1,
            }}
          >
            <RefreshCw size={12} className={syncing ? "animate-spin" : ""} style={{ animation: syncing ? "spin 1s linear infinite" : "none" }} />
            {syncing ? "DB에서 동기화 중..." : "관리자 계정 실시간 수동 동기화"}
          </button>
        </div>

        {onBack && (
          <button
            type="button"
            onClick={onBack}
            style={{
              marginTop: "16px",
              width: "100%",
              background: "transparent",
              border: "none",
              color: TEXT_DIM,
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
              padding: "8px",
            }}
          >
            ← 처음 화면으로 돌아가기
          </button>
        )}
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
