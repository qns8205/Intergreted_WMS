import React, { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, RotateCcw } from "lucide-react";
import CameraCaptureModal from "./CameraCaptureModal";
import { BorrowedTool, returnTools } from "../utils/warehouseManualApi";
import { resizeAndCompressImage, getGoogleDriveImageUrl } from "../utils/drive";
import { useVersionWorkGuard } from "../utils/versionWorkGuard";
import { kioskPalette, KIOSK_ACCENT_SOFT, KIOSK_PRIMARY_BG, KIOSK_PRIMARY_TEXT } from "../utils/kioskTheme";

type ReturnResult = Awaited<ReturnType<typeof returnTools>>;

export default function UnattendedToolReturnForm({ active, enabled, employeeId, items, isLightMode, onRefresh, kiosk, onFinished }: {
  active: boolean; enabled: boolean; employeeId: string; items: BorrowedTool[]; isLightMode: boolean; onRefresh: () => void;
  /** 무인 PC 화면: 큰 글씨·버튼, 파일 첨부 없음(카메라만). */
  kiosk?: boolean;
  /** 주면 반납 결과를 이 폼에서 보여주지 않고 넘긴다(무인 PC는 자체 완료 화면과 자동 로그아웃을 쓴다). */
  onFinished?: (result: ReturnResult) => void;
}) {
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [photo, setPhoto] = useState("");
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<ReturnResult | null>(null);
  const payloadRef = useRef<Parameters<typeof returnTools>[0] | null>(null);
  const inFlight = useRef(false), upload = useRef<HTMLInputElement>(null), identity = useRef(employeeId);
  useEffect(() => {
    if (identity.current === employeeId) return;
    identity.current = employeeId; setSelected({}); setPhoto(""); setDone(null); setError(""); payloadRef.current = null;
  }, [employeeId]);
  useEffect(() => { if (!active) setCamera(false); }, [active]);
  useEffect(() => {
    if (payloadRef.current || done) return;
    setSelected(prev => {
      const next: Record<string, number> = {};
      for (const [key, value] of Object.entries(prev)) {
        const qty = Number(value);
        const item = items.find(i => i.key === key);
        if (item && qty > 0) next[key] = Math.min(qty, item.qty);
      }
      return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
    });
  }, [items, done]);
  const keys = Object.keys(selected).filter(key => selected[key] > 0);
  useVersionWorkGuard("unattended-tool-return", busy || photoBusy || (!done && (keys.length > 0 || !!photo)), "공구 반납 작성 중");
  const k = !!kiosk, P = kioskPalette(isLightMode);
  const bg = k ? P.panel : isLightMode ? "#fff" : "#1e293b", color = k ? P.text : isLightMode ? "#111827" : "#f1f5f9", border = k ? P.border : isLightMode ? "#dfe5ee" : "#334155";
  const muted = k ? P.dim : "#64748b", accent = k ? P.accent : "#2563eb";
  const button: React.CSSProperties = { padding: k ? "14px 20px" : "12px 16px", minHeight: k ? 56 : undefined, borderRadius: k ? 16 : 10, border: `1px solid ${border}`, background: bg, color, font: "inherit", fontSize: k ? 17 : undefined, cursor: "pointer", fontWeight: k ? 800 : 700 };
  const locked = busy || photoBusy || !!payloadRef.current;
  async function submit() {
    if (inFlight.current || !keys.length || !photo || !enabled) return;
    inFlight.current = true; setBusy(true); setError("");
    payloadRef.current ||= { clientId: globalThis.crypto?.randomUUID?.() || `return_${Date.now()}_${Math.random().toString(36).slice(2)}`, employeeId, photo, items: keys.map(key => ({ key, qty: selected[key] })) };
    try {
      const result = await returnTools(payloadRef.current);
      if (onFinished) { setSelected({}); setPhoto(""); payloadRef.current = null; onFinished(result); }
      else setDone(result);
      onRefresh();
    }
    catch (e: any) { if (e.status === 400) { payloadRef.current = null; onRefresh(); } setError(e.message); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function attach(file?: File) {
    if (!file) return;
    setPhotoBusy(true); setError("");
    try { setPhoto(await resizeAndCompressImage(file, 1280, 1280, .82)); }
    catch { setError("사진을 읽지 못했습니다. 다시 촬영해주세요."); }
    finally { setPhotoBusy(false); }
  }
  if (!active) return null;
  return <div style={{ maxWidth: 900, margin: "0 auto", color }}>
    {done ? <section style={{ padding: 24, border: `1px solid ${border}`, borderRadius: 16, background: bg }}>
      <h2 style={{ fontSize: 20, margin: "0 0 16px" }}>공구 반납 완료</h2>
      {done.items.map((i, n) => <p key={n}>{i.name} × {i.qty} <small style={{ color: "#64748b" }}>{i.pending ? "재고 연결 전 반납 · 기록 저장" : "재고 복구됨"}</small></p>)}
      <p style={{ color: "#64748b", lineHeight: 1.7, fontSize: 13 }}>반납한 물품과 촬영 사진을 저장했습니다.</p>
      <button style={button} onClick={() => { setDone(null); setSelected({}); setPhoto(""); payloadRef.current = null; onRefresh(); }}>다른 물품 반납</button>
    </section> : <>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, ...(k ? { padding: "20px 24px", borderRadius: 26, background: bg, border: `1px solid ${border}` } : null) }}>
        <div style={{ flex: 1 }}><h2 style={{ fontSize: k ? 23 : 18, fontWeight: k ? 900 : undefined, margin: 0 }}>반납할 공구를 선택해주세요</h2><p style={{ color: muted, fontSize: k ? 16 : 13, lineHeight: 1.7, margin: k ? "6px 0 0" : undefined }}>선택한 물품만 사진을 찍고 반납합니다. 일부 수량만 반납할 수도 있습니다.</p></div>
        <button style={button} disabled={locked} onClick={onRefresh} aria-label="공구 반납 목록 새로고침"><RotateCcw size={k ? 20 : 16} /></button>
      </div>
      {!items.length && <p style={{ fontSize: k ? 17 : undefined, color: k ? muted : undefined }}>반납할 공구가 없습니다. 우측 상단에서 공구를 추가로 신청할 수 있습니다.</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,240px),1fr))", gap: 14 }}>
        {items.map(item => {
          const on = !!selected[item.key];
          return <div key={item.key} style={{ position: "relative", background: on && k ? KIOSK_ACCENT_SOFT : bg, border: `2px solid ${on ? accent : border}`, borderRadius: k ? 22 : 14, overflow: "hidden" }}>
            <button disabled={locked} aria-pressed={on} onClick={() => { setSelected(prev => ({ ...prev, [item.key]: prev[item.key] ? 0 : item.qty })); setPhoto(""); }} style={{ display: "block", width: "100%", padding: 0, background: "none", color, border: 0, cursor: "pointer", textAlign: "left", font: "inherit" }}>
              {item.image ? <img src={getGoogleDriveImageUrl(item.image)} alt={item.name} loading="lazy" style={{ width: "100%", height: 160, objectFit: "contain", background: "#f1f5f9" }} /> : <div style={{ height: 160, display: "grid", placeItems: "center", color: "#64748b", background: k ? P.surface : isLightMode ? "#f1f5f9" : "#0f172a" }}>사진 없음</div>}
              <div style={{ padding: "14px 14px 8px" }}>
                <strong style={{ fontSize: k ? 20 : undefined }}>{!k && on ? "✓ " : ""}{item.name}</strong>
                <div style={{ marginTop: 7, fontSize: k ? 15 : 13, color: muted }}>대여 중 {item.qty}개{item.pending ? " · 관리자 연결 대기" : ""}</div>
                {k && <div style={{ marginTop: 8, fontSize: 15, fontWeight: 900, color: on ? accent : muted }}>{on ? "✓ 반납할 물품" : "눌러서 선택"}</div>}
              </div>
            </button>
            {k && on && <CheckCircle2 size={30} color={accent} style={{ position: "absolute", top: 10, right: 10, background: bg, borderRadius: 999 }} />}
            {on && <label style={{ display: "flex", padding: "4px 14px 14px", alignItems: "center", gap: 10, fontSize: k ? 16 : 13 }}>반납 수량 <input aria-label={`${item.name} 반납 수량`} type="number" min={1} max={item.qty} value={selected[item.key]} disabled={locked} onChange={e => { const qty = Number(e.target.value); setSelected(prev => ({ ...prev, [item.key]: Math.max(1, Math.min(item.qty, qty)) })); setPhoto(""); }} style={{ ...button, padding: 8, width: 85 }} /></label>}
          </div>;
        })}
      </div>
      {!!keys.length && <section style={{ marginTop: 18, padding: k ? "22px 24px" : 18, background: bg, border: `1px solid ${border}`, borderRadius: k ? 22 : 14 }}>
        <h3 style={{ fontSize: k ? 20 : 16, fontWeight: k ? 900 : undefined, margin: "0 0 12px" }}>반납 물품 {keys.length}종 · 사진 촬영</h3>
        {keys.some(key => items.find(i => i.key === key)?.pending) && <p style={{ fontSize: k ? 15 : 13, color: "#b45309", lineHeight: 1.7 }}>재고 연결 대기 물품은 반납 기록만 남기며, 임의로 재고 수량을 늘리지 않습니다.</p>}
        {photo && <img src={photo} alt="반납 확인 사진" style={{ width: "100%", maxHeight: 320, objectFit: "contain", borderRadius: 10, marginBottom: 12 }} />}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={{ ...button, ...(k ? { borderColor: accent, color: accent, minHeight: 60 } : null) }} disabled={locked} onClick={() => setCamera(true)}><Camera size={k ? 20 : 16} style={{ verticalAlign: "middle", marginRight: 6 }} />{photo ? "다시 촬영" : "반납 사진 찍기"}</button>
          {/* 무인 PC에서 파일 선택 창을 열면 PC 안의 파일을 아무나 둘러볼 수 있다. 카메라만 쓴다. */}
          {!k && <button style={button} disabled={locked} onClick={() => upload.current?.click()}>휴대폰 촬영 / 사진 첨부</button>}
          {!k && <input hidden ref={upload} type="file" accept="image/*" capture="environment" onChange={e => { void attach(e.target.files?.[0]); e.target.value = ""; }} />}
        </div>
      </section>}
      {error && <p role="alert" style={{ color: "#dc2626", lineHeight: 1.7, fontSize: k ? 16 : undefined, fontWeight: k ? 750 : undefined }}>{error}</p>}
      {!!payloadRef.current && !busy && <p style={{ color: "#64748b", fontSize: 13 }}>중복 반납을 막기 위해 같은 내용으로 다시 확인합니다.</p>}
      {!!keys.length && <div style={{ position: "sticky", bottom: 12, marginTop: 18, padding: k ? 14 : 12, background: bg, border: `1px solid ${border}`, borderRadius: k ? 22 : 12, boxShadow: k ? "0 14px 40px rgba(15,23,42,.2)" : undefined }}><button disabled={busy || photoBusy || !photo || !enabled} onClick={() => void submit()} style={{ ...button, width: "100%", background: k ? KIOSK_PRIMARY_BG : "#2563eb", color: k ? KIOSK_PRIMARY_TEXT : "#fff", opacity: busy || !photo || !enabled ? .55 : 1, ...(k ? { border: 0, minHeight: 70, fontSize: 21, borderRadius: 18, fontWeight: 850 } : null) }}>{busy ? "반납 처리 중…" : payloadRef.current ? "같은 반납 다시 확인" : "선택한 공구 반납 완료"}</button></div>}
    </>}
    <CameraCaptureModal open={camera && active} onClose={() => setCamera(false)} onCapture={value => { setPhoto(value); setCamera(false); }} title="반납할 공구 사진 촬영" isLightMode={isLightMode} />
  </div>;
}
