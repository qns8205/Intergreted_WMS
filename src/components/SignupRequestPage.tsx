/**
 * 가입 신청.
 *
 * 명부(registered_users)에 없는 사번은 로그인할 수 없다. 여기서 사번과 이름을 남기면
 * 관리자가 계정 설정 > 가입 승인에서 확인한 뒤 명부에 넣는다. 바로 등록하지 않는 건
 * 사번을 잘못 쳐서 남의 사번을 차지하는 일을 사람이 한 번 걸러내기 위해서다.
 */
import React, { useState } from "react";
import { ArrowLeft, IdCard, User, CheckCircle2, ChevronRight } from "lucide-react";

interface Props {
  isLightMode: boolean;
  initialEmployeeId?: string;
  showToast: (msg: string, type: "ok" | "error" | "info" | "warn") => void;
  onBack: () => void;
}

type Step = "form" | "confirm" | "done";

export default function SignupRequestPage({ isLightMode, initialEmployeeId = "", showToast, onBack }: Props) {
  const C = {
    bg: isLightMode ? "#f7f8fa" : "#0b1120",
    card: isLightMode ? "#ffffff" : "#161f30",
    cardSub: isLightMode ? "#f4f6f9" : "#0f172a",
    border: isLightMode ? "#e6e9ef" : "#26324a",
    text: isLightMode ? "#111827" : "#f1f5f9",
    label: isLightMode ? "#64748b" : "#94a3b8",
    accent: "#2563eb",
    accentSoft: isLightMode ? "rgba(37,99,235,0.09)" : "rgba(37,99,235,0.16)",
    success: "#16a34a",
  };

  const [step, setStep] = useState<Step>("form");
  const [empId, setEmpId] = useState(initialEmployeeId);
  const [name, setName] = useState("");
  const [sending, setSending] = useState(false);

  const trimmedName = name.trim().replace(/\s+/g, " ");

  function next() {
    if (!/^\d{4}$/.test(empId) || empId === "0000") { showToast("4자리 사번을 입력해주세요.", "warn"); return; }
    if (trimmedName.length < 2 || trimmedName.length > 20) { showToast("이름을 2~20자로 입력해주세요.", "warn"); return; }
    setStep("confirm");
  }

  async function send() {
    setSending(true);
    try {
      const res = await fetch("/api/signup-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: empId, name: trimmedName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) throw new Error(data.error || `신청 실패 (HTTP ${res.status})`);
      setStep("done");
    } catch (e: any) {
      showToast(e.message, "error");
      setStep("form");
    } finally {
      setSending(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "16px 18px 16px 42px", borderRadius: "12px",
    border: `1px solid ${C.border}`, background: C.cardSub, color: C.text,
    fontSize: "17px", fontWeight: 600,
  };
  const labelStyle: React.CSSProperties = { display: "block", fontSize: "15px", fontWeight: 700, color: C.label, marginBottom: "9px" };
  const primaryBtn: React.CSSProperties = {
    flex: 1, padding: "18px", borderRadius: "13px", border: "none", background: C.accent, color: "#fff",
    fontSize: "17px", fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
  };
  const secondaryBtn: React.CSSProperties = {
    flex: "0 0 auto", padding: "18px 22px", borderRadius: "13px", border: `1px solid ${C.border}`, background: C.card, color: C.label,
    fontSize: "16px", fontWeight: 700, cursor: "pointer",
  };
  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !(e.nativeEvent as any).isComposing) next();
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "16px 20px", borderBottom: `1px solid ${C.border}`, background: C.card }}>
        <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "11px 18px", borderRadius: "11px", border: `1px solid ${C.border}`, background: C.card, color: C.label, cursor: "pointer", fontSize: "15px", fontWeight: 600 }}>
          <ArrowLeft size={15} /> 로그인으로
        </button>
        <h1 style={{ fontSize: "22px", fontWeight: 800, margin: 0, flex: 1 }}>가입 신청</h1>
      </div>

      <div style={{ maxWidth: "560px", margin: "0 auto", padding: "40px 20px 100px" }}>
        {step === "form" ? (
          <>
            <div style={{ marginBottom: "26px", padding: "18px 20px", background: C.accentSoft, borderRadius: "14px", borderLeft: `5px solid ${C.accent}`, fontSize: "15px", lineHeight: 1.6 }}>
              처음 사용하는 사번이라면 여기서 신청해주세요. <b>관리자가 승인하면</b> 그때부터 사번으로 로그인할 수 있습니다.
            </div>
            <label style={labelStyle}>사번</label>
            <div style={{ position: "relative", marginBottom: "18px" }}>
              <IdCard size={16} style={{ position: "absolute", left: "15px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
              <input value={empId} maxLength={4} onChange={(e) => setEmpId(e.target.value.replace(/\D/g, "").slice(0, 4))} onKeyDown={onEnter} placeholder="4자리 사번" inputMode="numeric" style={inputStyle} />
            </div>
            <label style={labelStyle}>이름</label>
            <div style={{ position: "relative", marginBottom: "30px" }}>
              <User size={16} style={{ position: "absolute", left: "15px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
              <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} onKeyDown={onEnter} placeholder="실명" style={inputStyle} />
            </div>
            <div style={{ display: "flex" }}>
              <button onClick={next} style={primaryBtn}>다음 <ChevronRight size={16} /></button>
            </div>
          </>
        ) : step === "confirm" ? (
          <>
            <div style={{ fontSize: "18px", fontWeight: 800, marginBottom: "16px" }}>이대로 신청할까요?</div>
            <div style={{ padding: "22px 24px", borderRadius: "16px", border: `1.5px solid ${C.accent}`, background: C.card, marginBottom: "14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "6px 0" }}>
                <span style={{ color: C.label, fontSize: "15px", fontWeight: 700 }}>사번</span>
                <span style={{ fontSize: "28px", fontWeight: 900, fontFamily: "monospace", letterSpacing: "0.08em" }}>{empId}</span>
              </div>
              <div style={{ height: 1, background: C.border, margin: "8px 0" }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "6px 0" }}>
                <span style={{ color: C.label, fontSize: "15px", fontWeight: 700 }}>이름</span>
                <span style={{ fontSize: "24px", fontWeight: 900 }}>{trimmedName}</span>
              </div>
            </div>
            <div style={{ fontSize: "14px", color: C.label, lineHeight: 1.6, marginBottom: "26px" }}>
              사번이 틀리면 다른 사람의 사번으로 등록됩니다. 한 번 더 확인해주세요. 승인된 뒤에는 관리자만 바꿀 수 있습니다.
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => setStep("form")} disabled={sending} style={secondaryBtn}>수정</button>
              <button onClick={send} disabled={sending} style={{ ...primaryBtn, opacity: sending ? 0.7 : 1, cursor: sending ? "default" : "pointer" }}>
                {sending ? "신청 중..." : "이대로 신청"}
              </button>
            </div>
          </>
        ) : (
          <div style={{ textAlign: "center", paddingTop: "20px" }}>
            <CheckCircle2 size={56} style={{ display: "block", color: C.success, margin: "0 auto 16px" }} />
            <div style={{ fontSize: "22px", fontWeight: 900, marginBottom: "10px" }}>가입 신청이 접수되었습니다</div>
            <div style={{ fontSize: "15px", color: C.label, lineHeight: 1.7, marginBottom: "30px" }}>
              사번 <b style={{ color: C.text }}>{empId}</b> · <b style={{ color: C.text }}>{trimmedName}</b><br />
              관리자가 승인하면 이 사번으로 로그인할 수 있습니다.
            </div>
            <div style={{ display: "flex" }}>
              <button onClick={onBack} style={primaryBtn}>로그인 화면으로</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
