/**
 * 대여자 로그인.
 *
 * 예전에는 대여를 시작할 때마다 이름·사번·좌석을 물었다. 화면마다 같은 걸 다시 묻다 보니
 * 입력이 흩어지고, 누가 쓰는 중인지도 알 수 없었다. 이제 들어올 때 한 번만 받는다.
 *
 * 관리자 로그인과 달리 비밀번호가 없다. 창고 물품을 빌리는 사내 도구라 본인 확인은
 * 등록된 사번으로 사용자를 확인하고 좌석만 선택하도록 입력을 단순화했다.
 */
import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, IdCard, ChevronRight, Layers } from "lucide-react";
import { fetchSeatMap, SeatFloor, fetchRegisteredUser, loadIdentity, saveIdentity } from "../utils/borrowApi";
import SeatMapViewerModal from "./SeatMapViewerModal";
import SignupRequestPage from "./SignupRequestPage";
import BorrowerSeatSuggestions from "./BorrowerSeatSuggestions";

export type Affiliation = "cfgw" | "configds" | "other";
export interface BorrowerSession {
  name: string;
  employeeId: string;
  affiliation: Affiliation;
  floor: string;
  unit: string;
}

interface Props {
  scriptUrl: string;
  connected: boolean;
  isLightMode: boolean;
  showToast: (msg: string, type: "ok" | "error" | "info" | "warn") => void;
  onBack: () => void;
  onDone: (session: BorrowerSession) => void;
  /** 좌석만 다시 고르는 경우. 이름·사번은 그대로 두고 자리만 바꾼다. */
  seatOnly?: BorrowerSession | null;
}

const SEAT_MAP_CACHE_KEY = "wms_seat_map_v1";

export default function BorrowerLoginPage({ scriptUrl, connected, isLightMode, showToast, onBack, onDone, seatOnly = null }: Props) {
  const C = {
    bg: isLightMode ? "#f7f8fa" : "#0b1120",
    card: isLightMode ? "#ffffff" : "#161f30",
    cardSub: isLightMode ? "#f4f6f9" : "#0f172a",
    border: isLightMode ? "#e6e9ef" : "#26324a",
    text: isLightMode ? "#111827" : "#f1f5f9",
    label: isLightMode ? "#64748b" : "#94a3b8",
    accent: "#2563eb",
    accentSoft: isLightMode ? "rgba(37,99,235,0.09)" : "rgba(37,99,235,0.16)",
  };

  const saved = useMemo(() => loadIdentity(), []);
  const [empId, setEmpId] = useState(seatOnly?.employeeId || saved?.employeeId || "");
  const [selFloor, setSelFloor] = useState(seatOnly?.floor || saved?.floor || "");
  const [selUnit, setSelUnit] = useState(seatOnly?.unit || saved?.unit || "");
  const [verifying, setVerifying] = useState(false);
  // 명부에 없는 사번: "none"이면 가입 신청을 권하고, "pending"이면 승인 대기 중이라고 알린다.
  const [unregistered, setUnregistered] = useState<"" | "none" | "pending" | "rejected">("");
  const [signupOpen, setSignupOpen] = useState(false);

  // 배치도는 거의 바뀌지 않으므로 지난번 값을 먼저 그려 선택 칸이 바로 뜨게 한다.
  const [seatMap, setSeatMap] = useState<SeatFloor[]>(() => {
    try {
      const raw = sessionStorage.getItem(SEAT_MAP_CACHE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) return parsed as SeatFloor[];
    } catch { /* 캐시가 없거나 깨졌으면 빈 값으로 시작 */ }
    return [];
  });
  const [seatMapLoaded, setSeatMapLoaded] = useState(false);
  const [seatMapOpen, setSeatMapOpen] = useState(false);
  const [seatMapViewFloor, setSeatMapViewFloor] = useState("");

  useEffect(() => {
    if (!connected || !scriptUrl) { setSeatMapLoaded(true); return; }
    fetchSeatMap(scriptUrl)
      .then((m) => {
        const floors = m.floors || [];
        setSeatMap(floors);
        try { sessionStorage.setItem(SEAT_MAP_CACHE_KEY, JSON.stringify(floors)); } catch { /* 저장 실패는 무시 */ }
      })
      // 배치도를 못 불러와도 막지 않는다. 층·유닛 없이도 대여는 된다.
      .catch((e: any) => console.error("[좌석배치도 조회 실패]", e))
      .finally(() => setSeatMapLoaded(true));
  }, [connected, scriptUrl]);

  /** 되살린 좌석이 지금 배치도에 없으면 비운다 — 화면은 빈 칸인데 값만 남아 통과해버린다. */
  useEffect(() => {
    if (!seatMapLoaded || seatMap.length === 0) return;
    const floor = seatMap.find((f) => (f.name || f.id) === selFloor);
    if (selFloor && !floor) { setSelFloor(""); setSelUnit(""); return; }
    if (selUnit && floor && !(floor.units || []).some((u) => u.label === selUnit)) setSelUnit("");
  }, [seatMapLoaded, seatMap, selFloor, selUnit]);

  /** "Unit 3"처럼 번호만 붙은 이름을 먼저, 그다음 숫자 순으로 둔다. */
  const units = useMemo(() => {
    const floor = seatMap.find((f) => (f.name || f.id) === selFloor);
    return [...(floor?.units || [])].sort((a, b) => {
      const plainA = /^unit\s*\d+$/i.test(a.label.trim());
      const plainB = /^unit\s*\d+$/i.test(b.label.trim());
      if (plainA !== plainB) return plainA ? -1 : 1;
      const nA = parseInt((a.label.match(/\d+/) || ["Infinity"])[0], 10);
      const nB = parseInt((b.label.match(/\d+/) || ["Infinity"])[0], 10);
      if (nA !== nB) return nA - nB;
      return a.label.localeCompare(b.label);
    });
  }, [seatMap, selFloor]);

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "16px 18px", borderRadius: "12px",
    border: `1px solid ${C.border}`, background: C.cardSub, color: C.text,
    fontSize: "17px", fontWeight: 600,
  };
  const labelStyle: React.CSSProperties = { display: "block", fontSize: "15px", fontWeight: 700, color: C.label, marginBottom: "9px" };

  async function submit() {
    if (!seatOnly) {
      if (!/^\d{4}$/.test(empId.trim())) { showToast("4자리 사번을 입력해주세요.", "warn"); return; }
    }

    // 좌석은 필수다. 자리를 모르면 물품이 어디로 갔는지 추적할 수 없고, 종수 한도도
    // 자리 기준으로 판정된다. 배치도 자체를 못 불러온 경우까지 막지는 않는다.
    if (!seatMapLoaded) { showToast("좌석 배치도를 불러오는 중입니다. 잠시 후 다시 시도해주세요.", "warn"); return; }
    if (seatMap.length > 0) {
      if (!selFloor) { showToast("좌석 위치(층)를 선택해주세요.", "warn"); return; }
      if (!selUnit) { showToast("좌석 위치(유닛)를 선택해주세요.", "warn"); return; }
    }

    let nm = seatOnly ? seatOnly.name : "";
    if (!seatOnly) {
      if (!connected || !scriptUrl) { showToast("서버 연결 후 사번을 확인할 수 있습니다.", "error"); return; }
      setVerifying(true);
      try {
        const result = await fetchRegisteredUser(scriptUrl, empId.trim());
        if (!result.found || !result.name) {
          const status = await fetch(`/api/signup-requests/status?employeeId=${encodeURIComponent(empId.trim())}`)
            .then((r) => r.json()).then((d) => d.status).catch(() => "none");
          setUnregistered(status === "pending" || status === "rejected" ? status : "none");
          return;
        }
        nm = result.name;
      } catch (e: any) { showToast(`확인 중 오류: ${e.message}`, "error"); return; }
      finally { setVerifying(false); }
    }

    const session = {
      name: nm,
      employeeId: seatOnly ? seatOnly.employeeId : empId.trim(),
      // 등록 사용자 로그인은 소속을 별도로 받지 않는다. 기존 대여 데이터 형식과의
      // 호환을 위해 내부 값만 기본 소속으로 유지한다.
      affiliation: seatOnly ? seatOnly.affiliation : "cfgw" as const,
      floor: selFloor,
      unit: selUnit,
    };
    // 이 브라우저에도 남긴다. 다음에 다시 왔을 때 채워 넣는 데 쓰고, 화면 사이를 오가다
    // 값이 끊겼을 때 되살리는 데도 쓴다(대여 신청이 신원을 잃고 멈추는 일이 있었다).
    saveIdentity(session);
    onDone(session);
  }

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !(e.nativeEvent as any).isComposing) submit();
  };

  if (signupOpen) {
    return (
      <SignupRequestPage
        isLightMode={isLightMode}
        initialEmployeeId={empId}
        showToast={showToast}
        onBack={() => { setSignupOpen(false); setUnregistered(""); }}
      />
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "16px 20px", borderBottom: `1px solid ${C.border}`, background: C.card }}>
        <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "11px 18px", borderRadius: "11px", border: `1px solid ${C.border}`, background: C.card, color: C.label, cursor: "pointer", fontSize: "15px", fontWeight: 600 }}>
          <ArrowLeft size={15} /> 이전
        </button>
        <h1 style={{ fontSize: "22px", fontWeight: 800, margin: 0, flex: 1 }}>{seatOnly ? "좌석 변경" : "대여자 로그인"}</h1>
      </div>

      <div style={{ maxWidth: "720px", margin: "0 auto", padding: "40px 20px 100px" }}>
        <div style={{ marginBottom: "26px", padding: "18px 20px", background: C.accentSoft, borderRadius: "14px", borderLeft: `5px solid ${C.accent}`, fontSize: "15px", lineHeight: 1.6 }}>
          {seatOnly
            ? "자리를 옮겼다면 여기서 바꿔주세요. 이름과 사번은 그대로 유지됩니다."
            : "대여·반납과 조회에 쓰입니다. 창을 닫기 전까지 유지되며, 4시간 동안 아무 동작이 없으면 자동으로 로그아웃됩니다."}
        </div>

        {!seatOnly ? (
          <>
            <label style={labelStyle}>사번</label>
            <div style={{ position: "relative", marginBottom: "18px" }}>
              <IdCard size={16} style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: C.label }} />
              <input value={empId} maxLength={4} onChange={(e) => {
                const next = e.target.value.replace(/\D/g, "").slice(0, 4);
                if (next !== empId) { setSelFloor(""); setSelUnit(""); }
                setEmpId(next); setUnregistered("");
              }} onKeyDown={onEnter} placeholder="4자리 사번" inputMode="numeric" style={{ ...inputStyle, paddingLeft: "40px" }} />
            </div>
            {unregistered ? (
              <div style={{ marginTop: "-6px", marginBottom: "22px", padding: "14px 16px", borderRadius: "12px", border: `1px solid ${unregistered === "pending" ? "#f59e0b" : "#ef4444"}55`, background: unregistered === "pending" ? "rgba(245,158,11,0.1)" : "rgba(239,68,68,0.08)", fontSize: "15px", lineHeight: 1.6 }}>
                {unregistered === "pending" ? (
                  <><b>가입 승인 대기 중인 사번입니다.</b><br />관리자가 승인하면 로그인할 수 있습니다.</>
                ) : (
                  <>
                    <b>{unregistered === "rejected" ? "가입 신청이 거절된 사번입니다." : "등록되지 않은 사번입니다."}</b> 사번이 맞다면 가입 신청을 해주세요.
                    <button type="button" onClick={() => setSignupOpen(true)} style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "10px", padding: "10px 16px", borderRadius: "10px", border: "none", background: C.accent, color: "#fff", fontSize: "15px", fontWeight: 800, cursor: "pointer" }}>
                      가입 신청하기 <ChevronRight size={15} />
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div style={{ fontSize: "14px", color: C.label, marginTop: "-8px", marginBottom: "22px", lineHeight: 1.5 }}>
                이름은 등록 명부에서 사번과 자동으로 매칭됩니다.{" "}
                <button type="button" onClick={() => setSignupOpen(true)} style={{ padding: 0, border: "none", background: "none", color: C.accent, fontSize: "14px", fontWeight: 800, cursor: "pointer", textDecoration: "underline" }}>처음 사용하시나요? 가입 신청</button>
              </div>
            )}
          </>
        ) : null}

        <BorrowerSeatSuggestions scriptUrl={scriptUrl} connected={connected} isLightMode={isLightMode}
          employeeId={seatOnly?.employeeId || empId} floors={seatMap} seatsLoaded={seatMapLoaded}
          selectedFloor={selFloor} selectedUnit={selUnit}
          onSelect={(floor, unit) => { setSelFloor(floor); setSelUnit(unit); }} />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginBottom: "9px" }}>
          <label style={{ ...labelStyle, marginBottom: 0 }}>좌석 위치 <span style={{ color: "#ef4444" }}>*</span></label>
          <button
            type="button"
            disabled={!seatMapLoaded || seatMap.length === 0}
            onClick={() => {
              const selected = seatMap.find((f) => (f.name || f.id) === selFloor);
              setSeatMapViewFloor(selected?.id || seatMap[0]?.id || "");
              setSeatMapOpen(true);
            }}
            style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "9px 12px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.accent, cursor: seatMapLoaded && seatMap.length ? "pointer" : "not-allowed", fontSize: "13px", fontWeight: 800, opacity: seatMapLoaded && seatMap.length ? 1 : 0.5 }}
          >
            <Layers size={14} /> 좌석 배치도 보기
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
          <select
            value={selFloor}
            onChange={(e) => { setSelFloor(e.target.value); setSelUnit(""); }}
            disabled={!seatMapLoaded || seatMap.length === 0}
            style={{ ...inputStyle, opacity: seatMapLoaded && seatMap.length ? 1 : 0.6 }}
          >
            <option value="">층수 선택</option>
            {seatMap.map((f) => <option key={f.id} value={f.name || f.id}>{f.name || f.id}</option>)}
          </select>
          <select
            value={selUnit}
            onChange={(e) => setSelUnit(e.target.value)}
            disabled={!selFloor}
            style={{ ...inputStyle, opacity: selFloor ? 1 : 0.6 }}
          >
            <option value="">유닛 선택</option>
            {units.map((u) => <option key={`${u.row}-${u.col}`} value={u.label}>{u.label}</option>)}
          </select>
        </div>
        <div style={{ fontSize: "14px", color: C.label, marginTop: "9px", marginBottom: "30px", lineHeight: 1.5 }}>
          {!seatMapLoaded
            ? "좌석 배치도를 불러오는 중입니다..."
            : seatMap.length === 0
              ? "좌석 배치도를 불러오지 못했습니다. 층·유닛 없이 진행됩니다."
              : "지금 계신 층과 유닛(자리)을 골라주세요. 테이블보는 층만 쓰입니다."}
        </div>

        <button
          onClick={submit}
          disabled={verifying}
          style={{
            width: "100%", padding: "19px", borderRadius: "13px", border: "none",
            background: C.accent, color: "#fff", fontSize: "18px", fontWeight: 800,
            cursor: verifying ? "default" : "pointer", opacity: verifying ? 0.7 : 1,
            display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
          }}
        >
          {verifying ? "확인 중..." : <>{seatOnly ? "좌석 변경" : "계속하기"} <ChevronRight size={15} /></>}
        </button>
      </div>
      {seatMapOpen ? (
        <SeatMapViewerModal
          C={C}
          floors={seatMap}
          activeFloorId={seatMapViewFloor}
          selectedFloor={selFloor}
          selectedUnit={selUnit}
          onFloorChange={setSeatMapViewFloor}
          onSelect={(floor, unit) => {
            setSelFloor(floor.name || floor.id);
            setSelUnit(unit.label);
            setSeatMapOpen(false);
          }}
          onClose={() => setSeatMapOpen(false)}
        />
      ) : null}
    </div>
  );
}
