import React, { useEffect, useRef, useState } from "react";
import { Camera, Check, Plus, Trash2, Sparkles, X } from "lucide-react";
import CameraCaptureModal from "./CameraCaptureModal";
import { SeatFloor } from "../utils/borrowApi";
import { resizeAndCompressImage } from "../utils/drive";
import { submitToolRequest, ToolRequestReceipt, searchTools, suggestTools, ToolSearchCandidate, ToolSearchResult, ToolSuggestion } from "../utils/warehouseManualApi";
import { useVersionWorkGuard } from "../utils/versionWorkGuard";
import { kioskPalette, KIOSK_ACCENT_SOFT, KIOSK_PRIMARY_BG, KIOSK_PRIMARY_TEXT } from "../utils/kioskTheme";

const newId = () => globalThis.crypto?.randomUUID?.() || `tool_${Date.now()}_${Math.random().toString(36).slice(2)}`;
interface Props {
  active: boolean; enabled: boolean; employeeId: string; name: string;
  floors: SeatFloor[]; floorsLoaded: boolean; isLightMode: boolean;
  onSubmitted?: () => void;
  /** 무인 PC 화면: 큰 글씨·버튼, 파일 첨부 없음(카메라만). */
  kiosk?: boolean;
  /** 주면 접수 결과를 이 폼에서 보여주지 않고 넘긴다(무인 PC는 자체 완료 화면과 자동 로그아웃을 쓴다). */
  onFinished?: (receipt: ToolRequestReceipt, floor: string) => void;
}
/** 항상 마운트해 두어 분야/탭을 오가도 입력과 사진이 남는다. */
export default function UnattendedToolBorrowForm({ active, enabled, employeeId, name, floors, floorsLoaded, isLightMode, onSubmitted, kiosk, onFinished }: Props) {
  const [floor, setFloor] = useState("");
  const [items, setItems] = useState<{ name: string; qty: number; itemId?: number; image?: string }[]>([{ name: "", qty: 1 }]);
  const [search, setSearch] = useState<{ index: number; query: string; loading: boolean; result?: ToolSearchResult; error?: string } | null>(null);
  const searchController = useRef<AbortController | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function closeSearch() {
    searchController.current?.abort(); searchController.current = null;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = null; setSearch(null);
  }
  // 이름을 적는 동안 비슷한 COS 물품을 바로 아래 띄운다. 이름이 글자 그대로 같아야 자동 처리되므로
  // 여기서 골라야 관리자 확인 대기로 쌓이지 않는다.
  const [suggest, setSuggest] = useState<{ index: number; items: ToolSuggestion[] } | null>(null);
  const suggestController = useRef<AbortController | null>(null);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function closeSuggest() {
    suggestController.current?.abort(); suggestController.current = null;
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    suggestTimer.current = null; setSuggest(null);
  }
  function queueSuggest(index: number, value: string) {
    suggestController.current?.abort(); suggestController.current = null;
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    const query = value.trim();
    if (!query || !enabled || !employeeId) { setSuggest(null); return; }
    suggestTimer.current = setTimeout(async () => {
      const controller = new AbortController(); suggestController.current = controller;
      try {
        const found = await suggestTools(employeeId, query, controller.signal);
        if (suggestController.current === controller) setSuggest({ index, items: found });
      } catch { /* 중단·연결 실패: 후보 없이 직접 입력으로 신청하면 된다. */ }
    }, 220);
  }
  useEffect(() => () => {
    searchController.current?.abort(); if (searchTimer.current) clearTimeout(searchTimer.current);
    suggestController.current?.abort(); if (suggestTimer.current) clearTimeout(suggestTimer.current);
  }, []);
  const [photo, setPhoto] = useState("");
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<ToolRequestReceipt | null>(null);
  const clientId = useRef(newId());
  const submitting = useRef(false);
  const payloadRef = useRef<Parameters<typeof submitToolRequest>[0] | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const identityRef = useRef(employeeId);
  useEffect(() => {
    if (identityRef.current === employeeId) return;
    identityRef.current = employeeId;
    closeSearch(); closeSuggest();
    setFloor(""); setItems([{ name: "", qty: 1 }]); setPhoto(""); setReceipt(null); setError("");
    clientId.current = newId(); payloadRef.current = null;
  }, [employeeId]);
  useEffect(() => { if (!active) { setCamera(false); closeSearch(); closeSuggest(); } }, [active]);
  const dirty = !receipt && (!!floor || !!photo || items.some(i => !!i.name.trim()));
  useVersionWorkGuard("unattended-tool-request", dirty || busy || photoBusy, "공구 대여 신청 작성 중");
  const k = !!kiosk, P = kioskPalette(isLightMode);
  const bg = k ? P.panel : isLightMode ? "#fff" : "#1e293b", text = k ? P.text : isLightMode ? "#111827" : "#f1f5f9";
  const border = k ? P.border : isLightMode ? "#dfe5ee" : "#334155", muted = k ? P.dim : isLightMode ? "#64748b" : "#94a3b8";
  const accent = k ? P.accent : "#2563eb", soft = k ? KIOSK_ACCENT_SOFT : isLightMode ? "#eff6ff" : "#172b46";
  // 무인 PC는 손가락으로 누르므로 글씨와 누르는 곳을 키운다.
  const F = k ? { h: 23, body: 17, note: 15, small: 14 } : { h: 17, body: 14, note: 13, small: 12 };
  const locked = busy || photoBusy || !!payloadRef.current;
  const input: React.CSSProperties = { width: "100%", padding: k ? "14px 16px" : "12px", minHeight: k ? 60 : undefined, borderRadius: k ? 16 : 10, border: `1px solid ${border}`, background: k ? P.surface : bg, color: text, font: "inherit", fontSize: k ? 19 : undefined, boxSizing: "border-box" };
  const button: React.CSSProperties = { ...input, width: "auto", background: bg, minHeight: k ? 56 : undefined, fontSize: k ? 17 : undefined, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7, fontWeight: k ? 800 : 700 };
  const section: React.CSSProperties = { padding: k ? "24px 28px" : 20, border: `1px solid ${border}`, borderRadius: k ? 26 : 16, background: bg, boxShadow: k ? "0 12px 32px rgba(0,0,0,.09)" : undefined };
  const heading: React.CSSProperties = { fontSize: F.h, margin: "0 0 14px", fontWeight: k ? 900 : undefined };
  async function findTools(index: number) {
    if (locked || !enabled) return;
    const query = items[index].name.trim();
    if (!query) { setError("AI로 찾을 공구 이름을 먼저 입력해주세요."); return; }
    closeSearch(); closeSuggest(); setError("");
    const controller = new AbortController(); searchController.current = controller;
    setSearch({ index, query, loading: true });
    searchTimer.current = setTimeout(() => controller.abort(), 6000);
    try {
      const result = await searchTools(employeeId, query, controller.signal);
      if (searchController.current === controller) setSearch({ index, query, loading: false, result });
    } catch (e: any) {
      if (searchController.current === controller) setSearch({ index, query, loading: false, error: e.name === "AbortError" ? "응답이 늦어 검색을 중단했습니다. 직접 입력으로 신청하거나 다시 검색해주세요." : e instanceof TypeError ? "검색 서버에 연결하지 못했습니다. 직접 입력으로 신청하거나 다시 검색해주세요." : e.message });
    } finally {
      if (searchController.current === controller && searchTimer.current) { clearTimeout(searchTimer.current); searchTimer.current = null; }
    }
  }
  function linkCandidate(index: number, candidate: ToolSearchCandidate) {
    if (locked) return;
    setItems(prev => prev.map((item, n) => n === index ? { ...item, name: candidate.name, itemId: candidate.id, image: candidate.image } : item));
  }
  function selectCandidate(candidate: ToolSearchCandidate) {
    if (!search || locked) return;
    linkCandidate(search.index, candidate);
    closeSearch();
  }
  async function submit() {
    if (submitting.current) return;
    closeSearch(); closeSuggest(); setError("");
    if (!enabled) { setError("무인 모드가 종료되어 신청할 수 없습니다."); return; }
    if (!employeeId || !floor || items.some(i => !i.name.trim() || !Number.isInteger(i.qty) || i.qty < 1 || i.qty > 999) || !photo) {
      setError("층수, 물품 이름·수량, 촬영 사진을 모두 확인해주세요."); return;
    }
    const payload = payloadRef.current || { clientId: clientId.current, employeeId, floor, items: items.map(i => ({ ...i, name: i.name.trim() })), photo };
    payloadRef.current = payload; submitting.current = true; setBusy(true);
    try {
      const result = await submitToolRequest(payload);
      if (onFinished) {
        // 결과는 부르는 쪽 완료 화면에서 보여준다. 이어서 또 신청할 수 있게 입력만 비운다(층은 그대로 둔다).
        setItems([{ name: "", qty: 1 }]); setPhoto(""); setError(""); clientId.current = newId(); payloadRef.current = null;
        onFinished(result, payload.floor);
      } else setReceipt(result);
      onSubmitted?.();
    }
    catch (e: any) {
      if (e.status === 400) payloadRef.current = null;
      setError(e.message || "신청에 실패했습니다. 다시 시도해주세요.");
    }
    finally { submitting.current = false; setBusy(false); }
  }
  // 전송 오류 뒤에는 동일한 내용을 재전송한다. 응답 유실 시 입력 변경으로 이중 출고되는 일을 막는다.
  async function attach(file?: File) {
    if (!file) return;
    setPhotoBusy(true); setError("");
    try { setPhoto(await resizeAndCompressImage(file, 1280, 1280, .82)); }
    catch { setError("사진을 읽지 못했습니다. 다시 촬영해주세요."); }
    finally { setPhotoBusy(false); }
  }
  if (!active) return null;
  const thumb = (src: string | undefined, size: number) => src
    ? <img src={src} alt="" loading="lazy" style={{ width: size, height: size, objectFit: "contain", borderRadius: 8, background: k ? P.surface : "transparent", flexShrink: 0 }} />
    : <div style={{ width: size, height: size, borderRadius: 8, background: k ? P.surface : isLightMode ? "#f8fafc" : "#0f172a", display: "grid", placeItems: "center", color: muted, fontSize: 10, flexShrink: 0 }}>사진 없음</div>;
  return <div style={{ maxWidth: k ? 900 : 760, margin: "0 auto", color: text, display: "grid", gap: 16 }}>
    {receipt ? <section style={section}>
      <h2 style={{ margin: "0 0 12px", fontSize: 20 }}><Check size={20} /> 공구 신청 #{receipt.requestId} 접수 완료</h2>
      <p style={{ color: muted, lineHeight: 1.7 }}>{name} · 사번 {employeeId} · {floor}<br />처리 완료 {receipt.processed}건 / 관리자 확인 대기 {receipt.pending}건</p>
      {receipt.items.map((item, n) => <div key={n} style={{ padding: "12px 0", borderTop: `1px solid ${border}` }}>
        <strong>{item.name} × {item.qty}</strong><div style={{ marginTop: 6, fontSize: 13, color: item.status === "resolved" ? "#059669" : "#b45309" }}>
          {item.status === "resolved" ? `${item.type === "소모" ? "소모" : "대여"} 처리 완료 · 재고 반영됨` : `관리자 확인 대기 · ${item.reason || "재고 연결 필요"}`}
        </div>
      </div>)}
      {!!receipt.pending && <p style={{ fontSize: 13, color: muted, lineHeight: 1.7 }}>확인 대기 물품은 사진과 함께 기록되었습니다. 관리자가 재고를 연결하면 재고 및 대여 장부에 반영됩니다.</p>}
      <button style={button} onClick={() => { setReceipt(null); setItems([{ name: "", qty: 1 }]); setPhoto(""); setError(""); clientId.current = newId(); payloadRef.current = null; }}>다른 공구 신청</button>
    </section> : <>
      <section style={section}>
        <h2 style={heading}>1. 사번 확인 · 사용할 층</h2>
        <p style={{ margin: "0 0 16px", fontSize: F.body, color: muted }}>{name} · 사번 {employeeId}</p>
        <label style={{ fontSize: F.note, fontWeight: 700 }}>사용할 층수</label>
        {floors.length ? <select aria-label="사용할 층수" style={{ ...input, marginTop: 8 }} value={floor} disabled={locked} onChange={e => setFloor(e.target.value)}>
          <option value="">층수를 선택해주세요</option>{floors.map(f => <option key={f.id} value={f.name || f.id}>{f.name || f.id}</option>)}
        </select> : <input aria-label="사용할 층수" style={{ ...input, marginTop: 8 }} placeholder={floorsLoaded ? "예: 2F" : "층 정보 불러오는 중"} value={floor} disabled={locked || !floorsLoaded} onChange={e => setFloor(e.target.value)} />}
      </section>
      <section style={{ ...section, opacity: floor ? 1 : .6 }}>
        <h2 style={heading}>2. 가져갈 물품 이름 · 수량</h2>
        <div style={{ padding: k ? "14px 16px" : "12px 14px", marginBottom: 14, borderRadius: k ? 14 : 10, background: soft, lineHeight: 1.6 }}>
          <strong style={{ display: "block", fontSize: F.body }}>이름을 적으면 비슷한 물품이 아래에 바로 뜹니다. 맞는 물품을 눌러주세요.</strong>
          <span style={{ fontSize: F.small, color: muted }}>목록에 없으면 적은 이름 그대로 신청해도 됩니다. 관리자가 사진을 보고 확인합니다. 그래도 못 찾겠으면 AI 검색을 눌러보세요.</span>
        </div>
        <fieldset disabled={!floor || locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          {items.map((item, n) => <div key={n} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", gap: 8 }}>
            <div style={{ display: "flex", flex: 1, minWidth: 0, border: `1px solid ${border}`, borderRadius: k ? 16 : 10, overflow: "hidden" }}>
            <input aria-label={`물품 이름 ${n + 1}`} maxLength={150} placeholder="물품 이름 직접 입력" style={{ ...input, border: 0, borderRadius: 0, flex: 1, minWidth: 0 }} value={item.name} onChange={e => { closeSearch(); setItems(prev => prev.map((i, idx) => idx === n ? { name: e.target.value, qty: i.qty } : i)); queueSuggest(n, e.target.value); }} />
            <button type="button" aria-label={`AI 검색 ${n + 1}`} disabled={!enabled || !item.name.trim()} onClick={() => void findTools(n)} style={{ ...button, border: 0, borderLeft: `1px solid ${border}`, borderRadius: 0, color: accent, padding: k ? "10px 16px" : "10px", flexShrink: 0 }}><Sparkles size={16} /><span>AI 검색</span></button>
            </div>
            <input aria-label={`수량 ${n + 1}`} type="number" min={1} max={999} style={{ ...input, width: k ? 96 : 82 }} value={item.qty || ""} onChange={e => setItems(prev => prev.map((i, idx) => idx === n ? { ...i, qty: Number(e.target.value) } : i))} />
            {items.length > 1 && <button aria-label={`물품 삭제 ${n + 1}`} style={button} onClick={() => { closeSearch(); closeSuggest(); setItems(prev => prev.filter((_, idx) => idx !== n)); }}><Trash2 size={15} /></button>}
            </div>
            {item.itemId && <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, color: k ? accent : muted, fontSize: k ? 15 : 12, fontWeight: k ? 800 : undefined }}>
              {item.image && <img src={item.image} alt="선택한 공구" style={{ width: k ? 48 : 40, height: k ? 48 : 40, objectFit: "contain", borderRadius: 6 }} />}
              <span><Check size={k ? 15 : 12} /> 확인한 물품 · {item.name} · #{item.itemId}</span>
              <button type="button" style={{ border: 0, background: "transparent", color: muted, cursor: "pointer", font: "inherit", fontSize: k ? 14 : undefined, padding: k ? "8px 6px" : undefined }} onClick={() => setItems(prev => prev.map((i, idx) => idx === n ? { name: i.name, qty: i.qty } : i))}>선택 해제</button>
            </div>}
            {suggest?.index === n && suggest.items.length > 0 && !item.itemId && search?.index !== n && item.name.trim() && <div style={{ marginTop: 8, border: `1px solid ${border}`, borderRadius: k ? 16 : 12, overflow: "hidden", background: bg }}>
              <div style={{ padding: k ? "10px 14px" : "8px 12px", fontSize: F.small, color: muted, background: k ? P.surface : "transparent" }}>이 중에 있나요? 누르면 정확한 물품으로 신청됩니다.</div>
              {suggest.items.map(c => <button key={c.id} type="button" onClick={() => { linkCandidate(n, c); closeSuggest(); }}
                style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", padding: k ? "10px 14px" : "8px 12px", minHeight: k ? 72 : 52, border: 0, borderTop: `1px solid ${border}`, background: "transparent", color: text, cursor: "pointer", font: "inherit" }}>
                {thumb(c.image, k ? 52 : 38)}
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 800, fontSize: k ? 18 : 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                  <span style={{ display: "block", marginTop: 2, fontSize: F.small, color: c.stock === 0 && !c.consumable ? "#b45309" : muted }}>{[c.location, c.consumable ? "소모품" : "", c.stock === null ? "재고 확인 필요" : `재고 ${c.stock}개`].filter(Boolean).join(" · ")}</span>
                </span>
                <span style={{ color: accent, fontWeight: 800, fontSize: k ? 15 : 12, whiteSpace: "nowrap" }}>선택</span>
              </button>)}
            </div>}
            {search?.index === n && <div style={{ border: `1px solid ${border}`, borderRadius: 12, padding: 12, marginTop: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}><strong style={{ fontSize: k ? 17 : 14 }}>{search.loading ? "유사 공구를 찾고 있습니다…" : `‘${search.query}’ 검색 결과`}</strong><button type="button" aria-label="AI 검색 닫기" onClick={closeSearch} style={{ ...button, padding: 6, border: 0 }}><X size={16} /></button></div>
              {search.error && <p role="alert" style={{ fontSize: F.note, color: "#b45309", lineHeight: 1.6 }}>{search.error}</p>}
              {search.result && <>
                <p style={{ fontSize: F.small, color: muted, lineHeight: 1.6 }}>{search.result.message}</p>
                {!search.result.items.length && <p style={{ color: muted, fontSize: F.note }}>맞는 후보가 없습니다. 입력한 이름과 촬영 사진으로 신청하면 관리자가 확인합니다.</p>}
                <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${k ? 180 : 150}px, 1fr))`, gap: 10 }}>
                  {search.result.items.map(candidate => <button key={candidate.id} type="button" onClick={() => selectCandidate(candidate)} style={{ ...button, width: "100%", padding: 10, display: "flex", flexDirection: "column", alignItems: "stretch", textAlign: "left" }}>
                    {candidate.image ? <img src={candidate.image} alt={candidate.name} loading="lazy" style={{ height: 115, width: "100%", objectFit: "contain", borderRadius: 8 }} /> : <div style={{ height: 115, display: "grid", placeItems: "center", color: muted, fontSize: 12, background: k ? P.surface : isLightMode ? "#f8fafc" : "#0f172a", borderRadius: 8 }}>등록된 사진 없음</div>}
                    <span style={{ fontSize: k ? 17 : 14, overflowWrap: "anywhere" }}>{candidate.name}</span>
                    <span style={{ fontSize: F.small, color: muted, fontWeight: 400 }}>#{candidate.id} · {candidate.consumable ? "소모품" : "대여 물품"} · {candidate.stock === null ? "재고 확인 필요" : `재고 ${candidate.stock}개`}</span>
                    <span style={{ fontSize: F.small, color: accent }}>이 물품 선택</span>
                  </button>)}
                </div>
                <p style={{ margin: "12px 0 0", fontSize: F.small, color: muted }}>맞는 물품이 없으면 닫고 직접 입력해주세요. 후보 선택만으로 신청되지는 않습니다.</p>
              </>}
            </div>}
          </div>)}
          <button style={button} disabled={items.length >= 30} onClick={() => { closeSuggest(); setItems(prev => [...prev, { name: "", qty: 1 }]); }}><Plus size={16} /> 물품 추가</button>
        </fieldset>
      </section>
      <section style={section}>
        <h2 style={{ ...heading, margin: "0 0 10px" }}>3. 물품 촬영</h2>
        <p style={{ color: muted, fontSize: F.note, lineHeight: 1.7 }}>가져갈 물품을 한 장에 모두 담아주세요. 이름을 찾지 못한 물품은 이 사진으로 관리자가 확인합니다.</p>
        {photo && <img src={photo} alt="신청할 공구 촬영 사진" style={{ display: "block", width: "100%", maxHeight: 320, objectFit: "contain", borderRadius: 12, marginBottom: 14 }} />}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <button style={{ ...button, ...(k ? { borderColor: accent, color: accent, minHeight: 60, paddingInline: 22 } : null) }} disabled={locked || !floor || items.some(i => !i.name.trim())} onClick={() => setCamera(true)}><Camera size={k ? 20 : 17} /> {photo ? "다시 촬영" : "사진 찍기"}</button>
          {/* 무인 PC에서 파일 선택 창을 열면 PC 안의 파일을 아무나 둘러볼 수 있다. 카메라만 쓴다. */}
          {!k && <button style={button} disabled={locked || !floor || items.some(i => !i.name.trim())} onClick={() => uploadRef.current?.click()}>휴대폰 촬영 / 사진 첨부</button>}
          {!k && <input ref={uploadRef} hidden type="file" accept="image/*" capture="environment" onChange={e => { void attach(e.target.files?.[0]); e.target.value = ""; }} />}
        </div>
      </section>
      {error && <div role="alert" style={{ color: "#dc2626", padding: 12, lineHeight: 1.7, fontSize: k ? 16 : undefined, fontWeight: k ? 750 : undefined }}>{error}</div>}
      {!!payloadRef.current && !busy && <p style={{ color: muted, fontSize: F.note, margin: 0 }}>전송한 신청을 다시 확인합니다. 중복 출고 방지를 위해 내용을 유지한 채 재시도해주세요.</p>}
      <div style={{ position: "sticky", bottom: 12, background: bg, padding: k ? 14 : 12, border: `1px solid ${border}`, borderRadius: k ? 22 : 12, boxShadow: k ? "0 14px 40px rgba(15,23,42,.2)" : undefined }}>
        <button disabled={busy || photoBusy || !photo || !enabled} style={{ ...button, width: "100%", justifyContent: "center", background: k ? KIOSK_PRIMARY_BG : "#2563eb", color: k ? KIOSK_PRIMARY_TEXT : "#fff", opacity: busy || !photo || !enabled ? .55 : 1, ...(k ? { border: 0, minHeight: 70, fontSize: 21, borderRadius: 18, fontWeight: 850 } : null) }} onClick={() => void submit()}>{busy ? "신청 처리 중…" : payloadRef.current ? "같은 신청 다시 확인" : "공구 신청 완료"}</button>
      </div>
    </>}
    <CameraCaptureModal open={camera && active} onClose={() => setCamera(false)} onCapture={value => { setPhoto(value); setCamera(false); }} title="가져갈 공구 사진 촬영" isLightMode={isLightMode} />
  </div>;
}
