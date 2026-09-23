import React, { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { Camera, CheckCircle2, IdCard, ImageOff, LockKeyhole, LogOut, MonitorCheck, Search, ShieldAlert } from "lucide-react";
import CameraCaptureModal from "./CameraCaptureModal";

type Item = {
  key: string; sheetType: "scenario" | "general"; rowIndex: number;
  borrowerName: string; employeeId: string; itemId: string; itemName: string;
  quantity: number; location: string; image?: string; pickedUp: boolean;
  variantId?: number | null; variantPending?: boolean;
};
type Mode = "return" | "pickup";

function ItemThumb({ item, C, size = 76 }: { item: Item; C: any; size?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [item.image]);
  return <div style={{ width: size, height: size, flex: `0 0 ${size}px`, borderRadius: 12, overflow: "hidden", border: `1px solid ${C.border}`, background: C.bg, display: "grid", placeItems: "center" }}>
    {item.image && !failed ? <img src={item.image} alt={`${item.itemName} 사진`} loading="lazy" onError={() => setFailed(true)} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} /> : <div style={{ display: "grid", justifyItems: "center", gap: 4, color: C.dim }}><ImageOff size={20} /><span style={{ fontSize: 9, fontWeight: 700 }}>사진 없음</span></div>}
  </div>;
}

const TOKEN_KEY = "wms_unattended_device";
const makeClientId = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;

async function call(path: string, body?: unknown) {
  const response = await fetch(`/api/unattended/${path}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", "x-unattended-device": localStorage.getItem(TOKEN_KEY) || "" },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) throw new Error(data.error || "요청을 처리하지 못했습니다.");
  return data;
}

export default function UnattendedReturnPage({ onAdminExit, isLightMode, showToast }: {
  onAdminExit: (user: { id: string; name?: string }) => void; isLightMode: boolean;
  showToast: (message: string, type?: "info" | "ok" | "warn" | "error") => void;
}) {
  const [employeeId, setEmployeeId] = useState("");
  const [borrowerName, setBorrowerName] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [mode, setMode] = useState<Mode>("return");
  const [actionSelected, setActionSelected] = useState(false);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [damaged, setDamaged] = useState<Record<string, boolean>>({});
  const [damageReason, setDamageReason] = useState<Record<string, string>>({});
  const [damagePhoto, setDamagePhoto] = useState("");
  const [damageCamera, setDamageCamera] = useState(false);
  const [captureMode, setCaptureMode] = useState<Mode | null>(null);
  const [damageConfirm, setDamageConfirm] = useState(false);
  // "예/아니요"부터 먼저 묻는다 — 곧장 물품별 체크리스트를 보여주면 다들 안 보고
  // 넘겨버리는 경우가 많았다. "아니요"는 5초 뒤에야 고를 수 있고, "예"를 고르면
  // 기존과 같은 물품별 체크리스트(list 단계)로 넘어간다.
  const [damageStage, setDamageStage] = useState<"ask" | "list">("ask");
  const [returnConfirmCount, setReturnConfirmCount] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ kind: Mode; qr?: string } | null>(null);
  const [logoutSeconds, setLogoutSeconds] = useState(15);
  const [adminLoginOpen, setAdminLoginOpen] = useState(false);
  const [adminLoginId, setAdminLoginId] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminError, setAdminError] = useState("");
  const attempt = useRef(makeClientId());

  const C = {
    bg: isLightMode ? "#f1f5f9" : "#020617", panel: isLightMode ? "#fff" : "#111827",
    text: isLightMode ? "#111827" : "#f8fafc", dim: isLightMode ? "#64748b" : "#94a3b8",
    border: isLightMode ? "#e2e8f0" : "#334155",
  };
  const returnItems = useMemo(() => items.filter((item) => item.pickedUp), [items]);
  const pickupItems = useMemo(() => items.filter((item) => !item.pickedUp), [items]);
  const visibleItems = mode === "return" ? returnItems : pickupItems;
  const chosen = visibleItems.filter((item) => (selected[item.key] || 0) > 0);
  const hasDamage = chosen.some((item) => damaged[item.key]);

  function selectAll(list: Item[]) {
    setSelected(Object.fromEntries(list.map((item) => [item.key, item.quantity])));
    setDamaged({}); setDamageReason({}); setDamagePhoto(""); setError("");
  }
  function chooseMode(next: Mode) {
    setMode(next);
    setActionSelected(true);
    // 전부 체크된 채로 시작하면 안 가져간 물품까지 실수로 반납/확인 처리될 수 있다 —
    // 하나씩 직접 확인하고, 전부 맞으면 아래 "전체 선택"으로 한 번에 고르게 한다.
    selectAll([]);
  }
  const allChosen = visibleItems.length > 0 && visibleItems.every((item) => (selected[item.key] || 0) >= item.quantity);
  // 반납은 초록, 대여 확인은 파랑 — 업무 선택 카드와 같은 색으로 화면 전체에서 지금 뭘
  // 하고 있는지 한눈에 알아보게 한다.
  const modeAccent = mode === "return" ? "#059669" : "#2563eb";
  const modeAccentSoft = mode === "return" ? "rgba(5,150,105,.12)" : "rgba(37,99,235,.12)";
  function toggleSelectAll() {
    if (allChosen) selectAll([]);
    else selectAll(visibleItems);
  }
  function returnToActionChoice() {
    setActionSelected(false);
    setSelected({}); setDamaged({}); setDamageReason({}); setDamagePhoto(""); setError("");
  }
  function openReturnConfirm() {
    setError("");
    setReturnConfirmCount(5);
    setDamageStage("ask");
    setDamageConfirm(true);
  }
  function logout() {
    setEmployeeId(""); setBorrowerName(""); setLoggedIn(false); setItems([]); setSelected({}); setActionSelected(false);
    setDamaged({}); setDamageReason({}); setDamagePhoto(""); setDamageConfirm(false); setDamageStage("ask");
    setCaptureMode(null); setProcessing(false); setReturnConfirmCount(0); setLogoutSeconds(15); setError(""); setDone(null); attempt.current = makeClientId();
  }

  useEffect(() => {
    if (!done) return;
    setLogoutSeconds(15);
    const id = window.setInterval(() => setLogoutSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearInterval(id);
  }, [done]);
  useEffect(() => { if (done && logoutSeconds === 0) logout(); }, [done, logoutSeconds]);
  useEffect(() => {
    let timer = 0;
    const touch = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { if (!processing && !damageCamera && !captureMode) logout(); }, 180_000);
    };
    ["pointerdown", "keydown"].forEach((event) => window.addEventListener(event, touch)); touch();
    return () => { window.clearTimeout(timer); ["pointerdown", "keydown"].forEach((event) => window.removeEventListener(event, touch)); };
  }, [processing, damageCamera, captureMode]);
  useEffect(() => {
    if (!damageConfirm || returnConfirmCount <= 0) return;
    const timer = window.setTimeout(() => setReturnConfirmCount((count) => Math.max(0, count - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [damageConfirm, returnConfirmCount]);

  async function login() {
    if (!/^\d{4}$/.test(employeeId)) { setError("4자리 사번을 입력해주세요."); return; }
    setBusy(true); setError("");
    try {
      const data = await call("find-mine", { employeeId });
      const list: Item[] = data.items || [];
      const returns = list.filter((item) => item.pickedUp);
      const pickups = list.filter((item) => !item.pickedUp);
      const initialMode: Mode = returns.length ? "return" : "pickup";
      setBorrowerName(data.borrowerName || ""); setItems(list); setLoggedIn(true); setMode(initialMode);
      setActionSelected(false); setSelected({}); setDamaged({}); setDamageReason({}); setDamagePhoto("");
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }

  const payload = () => chosen.map((item) => ({
    sheetType: item.sheetType, rowIndex: item.rowIndex, quantity: selected[item.key],
    damaged: !!damaged[item.key], reason: damageReason[item.key] || "", variantId: item.variantId,
  }));

  async function finishReturn(returnPhoto: string) {
    setProcessing(true); setError("");
    try {
      const data = await call("return", { clientId: attempt.current, items: payload(), photo: returnPhoto, ...(hasDamage ? { damagePhoto } : {}) });
      const link = `${location.protocol}//${location.hostname}:3002${data.lookupPath}?employeeId=${encodeURIComponent(employeeId)}&returnBatch=${data.batchId}`;
      const qr = await QRCode.toDataURL(link, { width: 360, margin: 2 });
      setDone({ kind: "return", qr }); setDamageConfirm(false);
    } catch (e: any) { setError(e.message); setDamageConfirm(false); }
    finally { setProcessing(false); }
  }

  function beginReturn() {
    if (!chosen.length) return;
    if (hasDamage) {
      const missing = chosen.find((item) => damaged[item.key] && !String(damageReason[item.key] || "").trim());
      if (missing) { setError(`'${missing.itemName}'의 파손 사유를 입력해주세요.`); return; }
      if (!damagePhoto) { setError("파손된 물품 사진을 촬영해주세요."); return; }
    }
    setDamageConfirm(false);
    setCaptureMode("return");
  }

  async function finishPickup(pickupPhoto: string) {
    if (!chosen.length) return;
    setProcessing(true); setError("");
    try {
      await call("confirm-pickup", { clientId: attempt.current, items: payload(), photo: pickupPhoto });
      showToast("대여 확인 사진을 저장하고 처리를 완료했습니다.", "ok"); setDone({ kind: "pickup" });
    } catch (e: any) { setError(e.message); }
    finally { setProcessing(false); }
  }

  async function loginAsAdmin(event: React.FormEvent) {
    event.preventDefault();
    if (!adminLoginId.trim() || !adminPassword) { setAdminError("관리자 ID와 비밀번호를 입력해주세요."); return; }
    setAdminBusy(true); setAdminError("");
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId: adminLoginId.trim(), password: adminPassword }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || "관리자 계정 정보를 확인해주세요.");
      localStorage.setItem("wms_admin_id", String(data.user.id));
      onAdminExit({ id: data.user.loginId, name: data.user.name });
    } catch (e: any) { setAdminError(e.message || "관리자 로그인에 실패했습니다."); }
    finally { setAdminBusy(false); }
  }

  const adminFooter = <footer style={{ width: "100%", maxWidth: 900, margin: "28px auto 0", padding: "18px 0 2px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "center" }}>
    <button onClick={() => { setAdminError(""); setAdminLoginOpen(true); }} style={{ ...ghost(C), color: C.dim, background: "transparent", borderColor: "transparent" }}><LockKeyhole size={15} /> 관리자 로그인 · 일반 모드 전환</button>
  </footer>;
  const adminLoginModal = adminLoginOpen ? <div style={{ ...overlay, zIndex: 7000 }}><form onSubmit={loginAsAdmin} style={{ ...panel(C), width: "min(440px,100%)", padding: 26 }}>
    <div style={{ width: 48, height: 48, borderRadius: 14, display: "grid", placeItems: "center", background: "rgba(37,99,235,.1)", color: "#2563eb", marginBottom: 14 }}><LockKeyhole size={23} /></div>
    <h2 style={{ margin: "0 0 7px" }}>관리자 로그인</h2><p style={{ margin: "0 0 20px", color: C.dim, fontSize: 13, lineHeight: 1.6 }}>인증이 완료되면 무인 화면을 종료하고 일반 관리자 모드로 전환합니다.</p>
    <div style={{ display: "grid", gap: 10 }}><input autoFocus autoComplete="username" placeholder="관리자 ID" value={adminLoginId} onChange={(e) => setAdminLoginId(e.target.value)} style={{ ...input(C), width: "100%" }} /><input type="password" autoComplete="current-password" placeholder="비밀번호" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} style={{ ...input(C), width: "100%" }} /></div>
    {adminError ? <p style={errorStyle}>{adminError}</p> : null}
    <button type="submit" disabled={adminBusy} style={{ ...primary, width: "100%", justifyContent: "center", marginTop: 16, opacity: adminBusy ? .6 : 1 }}>{adminBusy ? "로그인 확인 중..." : "일반 모드로 전환"}</button>
    <button type="button" disabled={adminBusy} onClick={() => { setAdminLoginOpen(false); setAdminPassword(""); setAdminError(""); }} style={{ ...ghost(C), width: "100%", justifyContent: "center", marginTop: 8 }}>취소</button>
  </form></div> : null;

  if (done) return <main style={{ minHeight: "100vh", background: mainBg(C, isLightMode), color: C.text, display: "flex", flexDirection: "column", padding: 24, textAlign: "center" }}><style>{sectionSlideCss}</style><div style={{ flex: 1, display: "grid", placeItems: "center" }}><div key="done" className="wms-section-slide" style={{ ...panel(C), maxWidth: 540, width: "100%", padding: "30px clamp(22px,5vw,38px)", display: "grid", justifyItems: "center" }}>
    <div style={{ width: 58, height: 58, borderRadius: 999, display: "grid", placeItems: "center", color: "#059669", background: "rgba(5,150,105,.1)", marginBottom: 14 }}><CheckCircle2 size={36} /></div><h1 style={{ margin: "0 0 8px", fontSize: 23 }}>{done.kind === "return" ? "반납이 완료되었습니다" : "대여 확인이 완료되었습니다"}</h1>
    {done.qr ? <><p style={{ color: C.dim, margin: "0 0 14px", lineHeight: 1.55 }}>QR을 열어 보관 위치를 확인하고 물품을 제자리에 놓아주세요.</p><img src={done.qr} alt="물품 위치 확인 QR" style={{ width: "min(300px,72vw)", background: "#fff", padding: 8, borderRadius: 14 }} /></> : <p style={{ color: C.dim, margin: "0 0 18px" }}>촬영한 대여 확인 사진이 안전하게 저장되었습니다.</p>}
    <div style={{ marginTop: 18, padding: "7px 13px", borderRadius: 999, background: isLightMode ? "#eff6ff" : "rgba(37,99,235,.14)", color: "#2563eb", fontSize: 13, fontWeight: 850 }}><b style={{ fontSize: 17 }}>{logoutSeconds}</b>초 후 자동 로그아웃</div>
    <button onClick={logout} style={{ ...primary, width: "100%", justifyContent: "center", marginTop: 12, minHeight: 48 }}><LogOut size={17} /> 지금 로그아웃</button>
  </div></div>{adminFooter}{adminLoginModal}</main>;

  return <main style={{ minHeight: "100vh", background: mainBg(C, isLightMode), color: C.text, padding: "28px clamp(14px,4vw,36px) 18px", display: "flex", flexDirection: "column" }}><style>{sectionSlideCss}</style><div style={{ maxWidth: 900, margin: "0 auto", width: "100%", flex: 1 }}>
    <header style={{ position: "relative", textAlign: "center", margin: "8px 0 30px", padding: "0 72px" }}>
      <div className="wms-header-badge" style={{ width: 72, height: 72, display: "grid", placeItems: "center", margin: "0 auto 16px", borderRadius: 22, color: "#fff", background: "linear-gradient(135deg, #3b82f6, #1d4ed8)", boxShadow: "0 14px 30px rgba(37,99,235,.35)" }}><MonitorCheck size={34} /></div>
      <h1 style={{ margin: 0, fontSize: "clamp(30px,4.2vw,40px)", fontWeight: 900, letterSpacing: "-.045em", background: "linear-gradient(135deg, #2563eb, #1e40af)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>무인 대여 · 반납</h1>
      <div style={{ fontSize: 14.5, color: C.dim, marginTop: 9, fontWeight: 600 }}>사번으로 로그인하면 지금 필요한 업무부터 안내합니다.</div>
      {loggedIn ? <button onClick={logout} style={{ ...ghost(C), position: "absolute", right: 0, top: 10 }}><LogOut size={16} /> 로그아웃</button> : null}
    </header>

    {!loggedIn ? <section key="login" className="wms-section-slide" style={{ ...panel(C), maxWidth: 540, margin: "0 auto", padding: "0", overflow: "hidden", boxShadow: isLightMode ? "0 20px 45px rgba(37,99,235,.14)" : "0 20px 45px rgba(0,0,0,.4)" }}>
      <div style={{ height: 6, background: "linear-gradient(90deg, #3b82f6, #1d4ed8, #059669)" }} />
      <div style={{ padding: "28px clamp(18px,4vw,32px) 26px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span style={{ width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center", background: isLightMode ? "#eff6ff" : "rgba(37,99,235,.16)", color: "#2563eb", flexShrink: 0 }}><IdCard size={18} /></span>
          <h2 style={{ margin: 0, fontSize: 21, fontWeight: 900 }}>사번 로그인</h2>
        </div>
        <p style={{ color: C.dim, fontSize: 13, lineHeight: 1.65, margin: "0 0 22px" }}>로그인한 뒤 대여 확인 또는 반납을 선택해서 진행합니다.</p>
        <div style={formRow}>
          <div style={{ position: "relative", flex: 1, minWidth: 120 }}>
            <IdCard size={18} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: C.dim }} />
            <input autoFocus placeholder="4자리 사번" inputMode="numeric" maxLength={4} value={employeeId} onChange={(e) => setEmployeeId(e.target.value.replace(/\D/g, "").slice(0, 4))} onKeyDown={(e) => e.key === "Enter" && login()} style={{ ...input(C), width: "100%", minHeight: 54, paddingLeft: 42, fontSize: 18, fontWeight: 800, letterSpacing: "0.08em" }} />
          </div>
          <button disabled={busy || employeeId.length !== 4} onClick={login} style={{ ...primary, minHeight: 54, paddingInline: 22, fontSize: 15, opacity: busy || employeeId.length !== 4 ? 0.6 : 1, background: "linear-gradient(135deg, #3b82f6, #1d4ed8)", boxShadow: "0 8px 20px rgba(37,99,235,.35)" }}><Search size={18} /> 로그인</button>
        </div>
        {error ? <p style={errorStyle}>{error}</p> : null}
      </div>
    </section> : !actionSelected ? <div key="action" className="wms-section-slide">
      <section style={{ ...panel(C), marginBottom: 14, textAlign: "center", padding: "26px clamp(18px,4vw,32px)" }}><h2 style={{ margin: "0 0 5px", fontSize: 22 }}>{borrowerName}님</h2><div style={{ color: C.dim, fontSize: 13 }}>진행할 업무를 선택해주세요.</div><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 12, marginTop: 22 }}>
        <button disabled={!pickupItems.length} onClick={() => chooseMode("pickup")} style={actionCard(C, "#2563eb", !pickupItems.length)}><span style={{ ...actionIcon, color: "#2563eb", background: "rgba(37,99,235,.11)" }}><CheckCircle2 size={28} /></span><span style={{ fontSize: 19, fontWeight: 900 }}>대여 확인</span><span style={{ color: C.dim, fontSize: 13 }}>수령한 물품 {pickupItems.length}종 확인</span></button>
        <button disabled={!returnItems.length} onClick={() => chooseMode("return")} style={actionCard(C, "#059669", !returnItems.length)}><span style={{ ...actionIcon, color: "#059669", background: "rgba(5,150,105,.11)" }}><LogOut size={28} style={{ transform: "rotate(180deg)" }} /></span><span style={{ fontSize: 19, fontWeight: 900 }}>반납</span><span style={{ color: C.dim, fontSize: 13 }}>대여 중인 물품 {returnItems.length}종 반납</span></button>
      </div>{!pickupItems.length && !returnItems.length ? <p style={{ color: C.dim, margin: "20px 0 0" }}>현재 처리할 대여 또는 반납 물품이 없습니다.</p> : null}</section>
    </div> : <div key={`items-${mode}`} className="wms-section-slide">
      <section style={{ ...panel(C), marginBottom: 14, borderLeft: `5px solid ${modeAccent}` }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}><div><h2 style={{ margin: 0, fontSize: 19, fontWeight: 900 }}>{borrowerName} · 사번 {employeeId}</h2><div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8, padding: "4px 12px", borderRadius: 999, background: modeAccentSoft, color: modeAccent, fontSize: 12.5, fontWeight: 850 }}>{mode === "return" ? <LogOut size={13} style={{ transform: "rotate(180deg)" }} /> : <CheckCircle2 size={13} />}{mode === "return" ? `반납할 물품 ${returnItems.length}종` : `대여 확인 대기 ${pickupItems.length}종`}</div></div><button onClick={returnToActionChoice} style={ghost(C)}>업무 다시 선택</button></div></section>
      <section style={{ ...panel(C), marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 16 }}>
          <span style={{ width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center", background: modeAccentSoft, color: modeAccent, flexShrink: 0 }}>{mode === "return" ? <LogOut size={17} style={{ transform: "rotate(180deg)" }} /> : <CheckCircle2 size={17} />}</span>
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 900 }}>{mode === "return" ? "반납할 물품" : "수령할 물품"}</h2>
        </div>
        {!visibleItems.length ? <div style={{ padding: 30, textAlign: "center", color: C.dim }}>처리할 물품이 없습니다.</div> : <div style={{ display: "grid", gap: 10 }}>{visibleItems.map((item) => {
          const isChosen = (selected[item.key] || 0) > 0;
          return <label key={item.key} style={{ position: "relative", display: "flex", alignItems: "center", gap: 12, border: `2px solid ${isChosen ? modeAccent : C.border}`, borderRadius: 14, padding: 11, cursor: "pointer", background: isChosen ? modeAccentSoft : "transparent", boxShadow: isChosen ? `0 6px 16px ${modeAccentSoft}` : "none", transition: "all 0.15s ease" }}>
            <input type="checkbox" checked={isChosen} onChange={(e) => setSelected((current) => ({ ...current, [item.key]: e.target.checked ? item.quantity : 0 }))} style={{ width: 24, height: 24, flexShrink: 0, accentColor: modeAccent }} />
            <ItemThumb item={item} C={C} /><div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 850, lineHeight: 1.35 }}>{item.itemName}</div><div style={{ fontSize: 12, color: C.dim, marginTop: 5 }}>{item.itemId} · {item.location || "위치 미등록"}</div></div><input aria-label={`${item.itemName} 수량`} type="number" min={0} max={item.quantity} value={selected[item.key] || 0} onChange={(e) => setSelected((current) => ({ ...current, [item.key]: Math.min(item.quantity, Math.max(0, Number(e.target.value) || 0)) }))} style={{ ...input(C), flex: "none", width: 70 }} /><span style={{ whiteSpace: "nowrap" }}>/ {item.quantity}</span>
          </label>;
        })}
        <label style={{ display: "flex", alignItems: "center", gap: 12, border: `2px dashed ${allChosen ? modeAccent : C.border}`, borderRadius: 14, padding: 11, cursor: "pointer", marginTop: 2, background: allChosen ? modeAccentSoft : "transparent" }}><input type="checkbox" checked={allChosen} onChange={toggleSelectAll} style={{ width: 24, height: 24, flexShrink: 0, accentColor: modeAccent }} /><span style={{ fontWeight: 850, color: allChosen ? modeAccent : C.dim }}>전체 선택</span></label>
      </div>}{visibleItems.length ? <button disabled={!chosen.length || busy || processing} onClick={() => mode === "return" ? openReturnConfirm() : setCaptureMode("pickup")} style={{ ...primary, width: "100%", justifyContent: "center", marginTop: 16, opacity: !chosen.length ? .6 : 1 }}>{processing ? "처리 중..." : mode === "return" ? "반납 확인" : "대여 확인 사진 촬영"}</button> : null}{error ? <p style={errorStyle}>{error}</p> : null}</section>
    </div>}
  </div>{adminFooter}

  <CameraCaptureModal open={damageCamera} onClose={() => setDamageCamera(false)} onCapture={(photo) => { setDamagePhoto(photo); setDamageCamera(false); setDamageConfirm(true); }} title="파손된 물품 촬영" isLightMode={isLightMode} />
  <CameraCaptureModal open={captureMode !== null} onClose={() => setCaptureMode(null)} onCapture={(photo) => { const target = captureMode; setCaptureMode(null); if (target === "return") void finishReturn(photo); else if (target === "pickup") void finishPickup(photo); }} title={captureMode === "return" ? "반납 상태 확인 사진 촬영" : "대여 수령 확인 사진 촬영"} isLightMode={isLightMode} />
  {adminLoginModal}
  {damageConfirm ? <div style={overlay}><div style={{ ...panel(C), maxWidth: 600, width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
    {damageStage === "ask" ? (
      <div style={{ textAlign: "center", padding: "6px 4px" }}>
        <div className="wms-warn-badge" style={{ width: 68, height: 68, borderRadius: 999, background: "rgba(245,158,11,.14)", display: "grid", placeItems: "center", margin: "0 auto 18px" }}>
          <ShieldAlert size={38} color="#f59e0b" />
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 900, margin: "0 0 10px", color: isLightMode ? "#92400e" : "#fbbf24", lineHeight: 1.4 }}>
          파손되었거나<br />정상 사용이 어려운 물품이 있나요?
        </h2>
        <p style={{ color: C.dim, fontSize: 13.5, lineHeight: 1.65, margin: "0 auto 24px", maxWidth: 420 }}>
          반납 전 마지막 확인입니다. 파손된 채로 반납하면 다음 사람이 모르고 그대로 사용하게 됩니다 — 꼭 확인해주세요.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button
            onClick={() => setDamageStage("list")}
            style={{ ...primary, width: "100%", justifyContent: "center", minHeight: 54, background: "#dc2626", fontSize: 16 }}
          >
            <ShieldAlert size={18} /> 예, 파손된 물품이 있습니다
          </button>
          <button
            disabled={processing || returnConfirmCount > 0}
            onClick={beginReturn}
            style={{
              ...ghost(C), width: "100%", justifyContent: "center", minHeight: 54, fontSize: 15,
              opacity: returnConfirmCount > 0 ? .55 : 1, cursor: returnConfirmCount > 0 ? "not-allowed" : "pointer",
            }}
          >
            <CheckCircle2 size={18} /> {returnConfirmCount > 0 ? `아니요, 없습니다 (${returnConfirmCount}초 후 선택 가능)` : "아니요, 없습니다"}
          </button>
          <button
            disabled={processing}
            onClick={() => { setDamageConfirm(false); setReturnConfirmCount(0); setError(""); }}
            style={{ border: "none", background: "transparent", color: C.dim, fontSize: 12.5, fontWeight: 700, cursor: "pointer", padding: "6px 0" }}
          >
            물품 선택으로 돌아가기
          </button>
        </div>
        {error ? <p style={errorStyle}>{error}</p> : null}
      </div>
    ) : <>
      <ShieldAlert size={40} color="#f59e0b" /><h2 style={{ fontWeight: 900 }}>어느 물품이 파손됐나요?</h2><p style={{ color: C.dim }}>파손된 물품만 선택하고 사유를 작성한 뒤, 파손된 부분이 보이도록 사진을 촬영해주세요.</p>{chosen.map((item) => <div key={item.key} style={{ padding: "10px 0", borderBottom: `1px solid ${C.border}` }}><label style={{ display: "flex", gap: 10, alignItems: "center" }}><input type="checkbox" checked={!!damaged[item.key]} onChange={(e) => { setDamaged((current) => ({ ...current, [item.key]: e.target.checked })); setError(""); }} /><ItemThumb item={item} C={C} size={54} /><span style={{ flex: 1, fontWeight: 800 }}>{item.itemName} × {selected[item.key]}</span><span style={{ color: damaged[item.key] ? "#dc2626" : C.dim, fontWeight: 800 }}>{damaged[item.key] ? "파손" : "정상"}</span></label>{damaged[item.key] ? <textarea placeholder="파손 상태와 확인이 필요한 내용을 적어주세요" value={damageReason[item.key] || ""} onChange={(e) => setDamageReason((current) => ({ ...current, [item.key]: e.target.value }))} style={{ ...input(C), width: "100%", minHeight: 72, marginTop: 9, resize: "vertical" }} /> : null}</div>)}{hasDamage ? <button onClick={() => { setDamageConfirm(false); setDamageCamera(true); }} style={{ ...ghost(C), width: "100%", justifyContent: "center", marginTop: 14 }}><Camera size={17} /> {damagePhoto ? "파손 사진 다시 촬영" : "파손 사진 촬영"}</button> : null}<button disabled={processing} onClick={beginReturn} style={{ ...primary, width: "100%", justifyContent: "center", marginTop: 14, background: hasDamage ? "#dc2626" : "#059669" }}>{hasDamage ? "파손 포함 · 반납 사진 촬영" : "파손 없음 · 반납 사진 촬영"}</button><button disabled={processing} onClick={() => setDamageStage("ask")} style={{ ...ghost(C), width: "100%", justifyContent: "center", marginTop: 8 }}>다시 묻기</button>{error ? <p style={errorStyle}>{error}</p> : null}
    </>}
  </div></div> : null}
  {processing ? <div style={{ ...overlay, zIndex: 6000 }}><div style={{ ...panel(C), width: "min(440px,100%)", textAlign: "center", padding: 30 }}><div style={{ fontSize: 54 }}>⏳</div><h2>촬영한 사진을 저장하고 있습니다</h2><p style={{ color: C.dim }}>창을 닫지 말고 처리가 끝날 때까지 잠시 기다려주세요.</p></div></div> : null}
  </main>;
}

// 로그인 → 업무 선택 → 물품 목록 → 완료로 넘어갈 때 화면이 뚝뚝 끊겨 보이지 않도록,
// 다음 카드가 옆에서 밀려 들어오는 느낌을 준다. 단계가 바뀔 때마다 key가 바뀌어
// React가 새 엘리먼트로 취급하므로 애니메이션이 매번 다시 걸린다.
const sectionSlideCss = `
@keyframes wms-section-slide-in { from { opacity: 0; transform: translateX(28px); } to { opacity: 1; transform: translateX(0); } }
.wms-section-slide { animation: wms-section-slide-in 0.32s cubic-bezier(0.16,1,0.3,1) both; }
@keyframes wms-warn-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(245,158,11,.35); } 50% { box-shadow: 0 0 0 10px rgba(245,158,11,0); } }
.wms-warn-badge { animation: wms-warn-pulse 1.8s ease-in-out infinite; }
@keyframes wms-header-glow { 0%,100% { box-shadow: 0 14px 30px rgba(37,99,235,.35); } 50% { box-shadow: 0 14px 38px rgba(37,99,235,.55); } }
.wms-header-badge { animation: wms-header-glow 2.6s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .wms-section-slide, .wms-warn-badge, .wms-header-badge { animation: none; } }
`;

const primary: React.CSSProperties = { display: "flex", alignItems: "center", gap: 7, border: 0, borderRadius: 10, padding: "11px 16px", background: "#2563eb", color: "#fff", fontWeight: 850, cursor: "pointer" };
const formRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" };
// 밋밋한 단색 배경 대신 은은한 색 그러데이션을 깔아 화면이 더 눈에 띄게 한다.
const mainBg = (C: any, isLightMode: boolean) => isLightMode
  ? "radial-gradient(1200px 600px at 50% -10%, #dbeafe 0%, #f1f5f9 45%, #f1f5f9 100%)"
  : "radial-gradient(1200px 600px at 50% -10%, #1e293b 0%, #020617 45%, #020617 100%)";
const panel = (C: any): React.CSSProperties => ({ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 18, padding: 18, boxShadow: "0 8px 24px rgba(15,23,42,.06)" });
const input = (C: any): React.CSSProperties => ({ flex: 1, minWidth: 120, border: `1px solid ${C.border}`, background: C.bg, color: C.text, borderRadius: 10, padding: "11px 12px", fontSize: 15, fontFamily: "inherit" });
const ghost = (C: any): React.CSSProperties => ({ display: "flex", alignItems: "center", gap: 6, border: `1px solid ${C.border}`, background: C.panel, color: C.text, borderRadius: 10, padding: "9px 12px", fontWeight: 800, cursor: "pointer" });
const tab = (C: any, active: boolean): React.CSSProperties => ({ border: 0, borderRadius: 9, padding: "9px 13px", background: active ? "#2563eb" : C.bg, color: active ? "#fff" : C.text, fontWeight: 800, cursor: "pointer" });
const actionCard = (C: any, accent: string, disabled: boolean): React.CSSProperties => ({ minHeight: 170, border: `1.5px solid ${disabled ? C.border : accent}`, borderRadius: 17, background: C.panel, color: C.text, padding: 22, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 9, fontFamily: "inherit", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? .45 : 1, boxShadow: disabled ? "none" : "0 8px 20px rgba(15,23,42,.06)" });
const actionIcon: React.CSSProperties = { width: 54, height: 54, borderRadius: 16, display: "grid", placeItems: "center", marginBottom: 2 };
const overlay: React.CSSProperties = { position: "fixed", inset: 0, zIndex: 5000, background: "rgba(2,6,23,.78)", display: "grid", placeItems: "center", padding: 18 };
const errorStyle: React.CSSProperties = { color: "#dc2626", fontWeight: 750, fontSize: 13 };
