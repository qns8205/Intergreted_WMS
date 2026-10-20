import React, { useEffect, useRef, useState } from "react";
import { BrowseCartItem, ItemReservation, ObjectItem, fetchReservations, reserveItems, cancelItemReservation, acknowledgeReservationNotice } from "../utils/borrowApi";
import RentalTermsFields, { RentalMode } from "./RentalTermsFields";
import { rentalTermsLabel } from '../../shared/rentalTerms.js';
import ItemBorrowersModal from "./ItemBorrowersModal";
import { getThumbImageUrl } from "../utils/drive";
import { CalendarClock, MapPin, Package } from "lucide-react";
import { reservationDay, reservationStart, validReservationStart, RESERVATION_DUE_LEAD_MS } from "../../shared/reservationTime.js";

export const reservationTime = (value: string) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
function frame(C: any): React.CSSProperties { return { position: "fixed", inset: 0, zIndex: 10005, background: "rgba(0,0,0,.65)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, color: C.text }; }
function panel(C: any): React.CSSProperties { return { width: "min(480px,100%)", maxHeight: "90vh", overflowY: "auto", padding: 24, borderRadius: 18, background: C.card }; }
function button(C: any): React.CSSProperties { return { padding: "11px 14px", border: `1px solid ${C.border}`, borderRadius: 10, background: C.cardSub, color: C.text, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700 }; }

export function ReservationNoticeModal({ C, items, scriptUrl, employeeId, onConfirm, onCancel }: { C: any; items: ItemReservation[]; scriptUrl: string; employeeId?: string; onConfirm: () => void; onCancel: () => void }) {
  const [remaining, setRemaining] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const deadline = Date.now() + 3000;
    const timer = window.setInterval(() => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))), 100);
    return () => window.clearInterval(timer);
  }, []);
  return <div style={frame(C)}><section role="dialog" aria-modal="true" aria-labelledby="reservation-notice-title" style={panel(C)}>
    <h2 id="reservation-notice-title" style={{ fontSize: 18, marginTop: 0 }}>예약된 물품입니다</h2>
    {items.map((item) => <p key={item.id} style={{ fontSize: 14, lineHeight: 1.7 }}><b>{item.itemName}{item.variantName ? ` · ${item.variantName}` : ""}</b><br />{item.borrowerName}님이 <b>{reservationTime(item.startsAt)}부터 {item.quantity}개</b> 대여할 예정입니다.</p>)}
    <p style={{ color: C.label, fontSize: 13, lineHeight: 1.7 }}>대여할 수 있습니다. 예약자의 사용 예정 시간 전에 반납해주세요.</p>
    {error ? <p role="alert" style={{ color: C.error }}>{error}</p> : null}
    <div style={{ display: "flex", gap: 8 }}><button disabled={busy} onClick={onCancel} style={button(C)}>닫기</button>
      <button disabled={remaining > 0 || busy} onClick={async () => {
        if (remaining > 0 || busy) return;
        setBusy(true); setError("");
        try { await acknowledgeReservationNotice(scriptUrl, items.map((item) => item.id), employeeId); onConfirm(); }
        catch (err: any) { setError(err.message); setBusy(false); }
      }} style={{ ...button(C), flex: 1, background: C.accent, color: "#fff", opacity: remaining > 0 || busy ? .5 : 1 }}>{busy ? "확인 중…" : remaining > 0 ? `확인 (${remaining}초)` : "확인"}</button>
    </div>
  </section></div>;
}

function TimeWheel({ C, label, value, min, max, disabled, onChange, formatValue }: { C: any; label: string; value: number; min: number; max: number; disabled: boolean; onChange: (value: number) => void; formatValue?: (value: number) => string }) {
  const wheel = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(timer.current);
    if (wheel.current) wheel.current.scrollTop = (value - min) * 44;
  }, [value, min, max]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return <div style={{ flex: 1, minWidth: 0 }}>
    <div style={{ fontSize: 12, fontWeight: 800, textAlign: "center", marginBottom: 8 }}>{label}</div>
    <div ref={wheel} role="listbox" aria-label={`${label} 선택`} aria-disabled={disabled} tabIndex={disabled ? -1 : 0}
      onKeyDown={(event) => {
        if (disabled) return;
        const next = event.key === "ArrowUp" ? value - 1 : event.key === "ArrowDown" ? value + 1 : event.key === "Home" ? min : event.key === "End" ? max : null;
        if (next !== null) { event.preventDefault(); onChange(Math.max(min, Math.min(max, next))); }
      }}
      onScroll={() => {
        if (disabled) return;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          if (wheel.current) onChange(Math.max(min, Math.min(max, min + Math.round(wheel.current.scrollTop / 44))));
        }, 120);
      }}
      style={{ height: 132, boxSizing: "border-box", overflowY: disabled ? "hidden" : "auto", padding: "44px 0", borderRadius: 12, background: C.cardSub, scrollSnapType: "y mandatory", overscrollBehavior: "contain", scrollbarWidth: "none", touchAction: "pan-y", opacity: disabled ? .6 : 1 }}>
      {Array.from({ length: max - min + 1 }, (_, index) => min + index).map((number) => <div key={number} role="option" aria-selected={number === value} onClick={() => !disabled && onChange(number)}
        style={{ height: 44, display: "flex", alignItems: "center", justifyContent: "center", scrollSnapAlign: "center", fontSize: formatValue && number >= 24 ? 16 : number === value ? 24 : 18, fontWeight: number === value ? 850 : 600, color: number === value ? C.accent : C.text, opacity: number === value ? 1 : .45, background: number === value ? C.accentSoft : "transparent", borderRadius: 10, cursor: disabled ? "default" : "pointer" }}>{formatValue ? formatValue(number) : String(number).padStart(2, "0")}</div>)}
    </div>
  </div>;
}

export function ReserveItemsCard({ C, items, inventory, scriptUrl, floor, unit, onClose, onSaved }: { C: any; items: BrowseCartItem[]; inventory: ObjectItem[]; scriptUrl: string; floor: string; unit: string; onClose: () => void; onSaved: () => void }) {
  const [now, setNow] = useState(Date.now());
  const today = reservationDay(now);
  const [customTime, setCustomTime] = useState(false);
  const [selection, setSelection] = useState(() => ({ date: today.date, minutes: Math.min(1500, Math.ceil(today.minMinutes / 30) * 30) }));
  const selectedMinutes = Math.max(today.minMinutes, Math.min(1500, selection.date === today.date ? selection.minutes : today.minMinutes));
  const minutes = customTime ? selectedMinutes : Math.min(1500, Math.ceil(selectedMinutes / 30) * 30);
  const hour = Math.floor(minutes / 60), minute = minutes % 60;
  const minHour = Math.floor(today.minMinutes / 60);
  const minMinute = hour === minHour ? today.minMinutes % 60 : 0;
  const startMs = reservationStart(today.date, minutes);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const requestItems = items.filter(item => inventory.find(obj => obj.id === item.id)?.requestFor !== undefined);
  const requestKey = JSON.stringify([...new Set(requestItems.map(item=>item.id))].sort());
  const [requestMode, setRequestMode] = useState<RentalMode | null>(null);
  const [requestReason, setRequestReason] = useState("");
  const [dueDate,setDueDate]=useState('');
  useEffect(()=>{setRequestMode(null);setRequestReason('');setDueDate('');},[requestKey]);
  const clientId = useRef(crypto.randomUUID());
  const requestInvalid = !requestMode || (requestMode !== 'general' && !requestReason.trim()) || (requestMode === 'long_term' && (!dueDate || dueDate < new Date(now+9*3600000).toISOString().slice(0,10)));
  const disabled = busy || !floor || !unit || !items.length || !validReservationStart(startMs, now) || requestInvalid;
  return <section aria-labelledby="reserve-items-title" style={{ border: `1px solid ${C.border}`, borderRadius: 22, background: C.card, padding: "clamp(20px, 5vw, 32px)", boxShadow: "0 8px 28px rgba(15,23,42,.06)" }}>
    <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 20 }}>
      <div style={{ background: C.accentSoft, color: C.accent, padding: 12, borderRadius: 14, display: "flex" }}><CalendarClock size={24} /></div>
      <div><h2 id="reserve-items-title" style={{ fontSize: 22, fontWeight: 850, margin: "0 0 4px" }}>예약 정보 확인</h2><div style={{ fontSize: 13, color: C.text, opacity: .65 }}>선택한 물품과 대여 예정 시간을 확인해주세요.</div></div>
    </div>
    <div style={{ borderRadius: 12, padding: "14px 16px", background: C.accentSoft, fontSize: 13, lineHeight: 1.7, marginBottom: 24 }}>
      <strong style={{ display: "block", fontWeight: 800 }}>예약 시 재고는 차감되지 않습니다.</strong>
      <span style={{ color: C.text, opacity: .75 }}>예약 시각 10분 전에 재고를 다시 확인하고 자동으로 대여 확인 대기로 전환합니다. 재고가 부족하면 대기하며 다시 확인합니다.</span>
      <strong style={{display:"block",marginTop:8}}>예약 예정 시각부터 20분 내에 수령 확인을 완료하지 않으면 자동 취소됩니다.</strong>
    </div>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>예약 물품</h3>
      <span style={{ fontSize: 12, fontWeight: 700, color: C.text, opacity: .65 }}>{new Set(items.map((item) => item.id)).size}종 · {items.reduce((sum, item) => sum + item.quantity, 0)}개</span>
    </div>
    <div style={{ display: "grid", gap: 10 }}>
      {items.map((item, index) => <article key={`${item.id}:${item.variantId || 0}:${index}`} style={{ display: "flex", gap: 12, alignItems: "center", padding: 16, border: `1px solid ${C.border}`, borderRadius: 14, background: C.cardSub }}>
        <Package size={21} style={{ color: C.accent, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}><strong style={{ fontSize: 14, fontWeight: 800, overflowWrap: "anywhere" }}>{item.name}</strong><div style={{ fontSize: 12, color: C.text, opacity: .6, marginTop: 5 }}>ID {item.id}{item.variantName ? ` · ${item.variantName}` : ""}</div></div>
        <strong style={{ borderRadius: 9, padding: "7px 10px", background: C.accentSoft, color: C.accent, fontSize: 14, fontWeight: 800, whiteSpace: "nowrap" }}>{item.quantity}개</strong>
      </article>)}
    </div>
    <form onSubmit={async (event) => {
      event.preventDefault(); if (disabled) return;
      if (!validReservationStart(startMs, Date.now())) { setNow(Date.now()); setError("현재 시각 이후의 시간을 다시 선택해주세요."); return; }
      setBusy(true); setError("");
      try { await reserveItems(scriptUrl, { items, startsAt: new Date(startMs).toISOString(), floor, unit, clientId: clientId.current,
        ...(requestMode ? {rentalTerms:{mode:requestMode,reason:requestMode === 'general' ? '' : requestReason.trim(),dueDate:requestMode === 'long_term' ? dueDate : ''},requestRental:{mode:requestMode === 'general' ? 'general' as const : 'request' as const,reason:requestMode === 'general' ? '' : requestReason.trim()}} : {}) }); onSaved(); }
      catch (err: any) { setError(err.message); setBusy(false); }
    }}>
      <div style={{marginTop:24,padding:16,border:`1px solid ${C.border}`,borderRadius:14}}>
        <p style={{fontSize:13,lineHeight:1.6,margin:"0 0 8px"}}>대여 방식을 선택해주세요. 일반 대여는 실제 수령 확인 후 4시간 내 반납해야 합니다. (점심시간 12:00~13:00 제외)</p>
        <p style={{fontSize:12,color:C.label,margin:"0 0 14px"}}>{[...new Set(requestItems.map(item=>item.name))].join(", ")}</p>
        <RentalTermsFields C={C} mode={requestMode} reason={requestReason} dueDate={dueDate} onDueDate={setDueDate} disabled={busy} onMode={setRequestMode} onReason={setRequestReason} />
        <p style={{fontSize:12,color:C.label,lineHeight:1.6,margin:"12px 0 0"}}>선택한 방식과 사유는 예약 시 저장되어 자동 대여 전환에도 적용됩니다. 함께 담은 일반 물품은 한도에서 제외되지 않습니다.</p>
      </div>
      <fieldset disabled={busy} style={{ margin: "26px 0 0", padding: 0, border: 0, minWidth: 0 }}>
        <legend style={{ fontSize: 15, fontWeight: 800 }}>대여 예정 시간 <span style={{ fontSize: 12, fontWeight: 600, opacity: .6 }}>(한국 시간)</span></legend>
        <div style={{ marginTop: 12, padding: "13px 14px", border: `1px solid ${C.border}`, borderRadius: 12, display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13 }}><span style={{ opacity: .65 }}>예약 날짜{minutes >= 1440 ? " · 다음날" : " · 오늘"}</span><strong style={{ fontWeight: 800 }}>{new Date(startMs + 9 * 3600_000).toISOString().slice(0, 10).replaceAll("-", ". ")}</strong></div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, margin: "20px 0 12px" }}>
          <strong style={{ fontSize: 14, fontWeight: 800 }}>시각 선택</strong>
          <button type="button" disabled={busy} aria-expanded={customTime} onClick={() => setCustomTime(!customTime)} style={{ background: "transparent", border: 0, padding: "6px 0", color: C.accent, fontSize: 12, fontWeight: 800, cursor: "pointer" }}>{customTime ? "시간 목록으로" : "직접 설정 · 1분 단위"}</button>
        </div>
        {!customTime ? <div role="group" aria-label="예약 시각 선택" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
          {Array.from({ length: (1500 - Math.floor(today.minMinutes / 60) * 60) / 30 + 1 }, (_, index) => Math.floor(today.minMinutes / 60) * 60 + index * 30).map((slot) => {
            const unavailable = slot < today.minMinutes;
            const selected = slot === minutes;
            const time = `${String(Math.floor(slot / 60) % 24).padStart(2, "0")}:${String(slot % 60).padStart(2, "0")}`;
            return <button type="button" key={slot} disabled={busy || unavailable} aria-pressed={selected} onClick={() => setSelection({ date: today.date, minutes: slot })}
              style={{ padding: "12px 2px", minWidth: 0, borderRadius: 8, border: `1px solid ${selected ? C.accent : C.border}`, background: selected ? C.accentSoft : unavailable ? C.cardSub : C.card, color: selected ? C.accent : C.text, fontSize: 14, fontWeight: selected ? 850 : 700, opacity: unavailable ? .3 : busy ? .6 : 1, cursor: busy || unavailable ? "not-allowed" : "pointer" }}>{slot >= 1440 ? <span style={{ display: "block", fontSize: 10, marginBottom: 3 }}>다음날</span> : null}{time}</button>;
          })}
        </div> : <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 16 }}>
          <TimeWheel C={C} label="시" value={hour} min={minHour} max={25} disabled={busy} formatValue={(value) => value >= 24 ? `다음날 ${String(value - 24).padStart(2, "0")}` : String(value).padStart(2, "0")} onChange={(value) => setSelection({ date: today.date, minutes: Math.max(today.minMinutes, value === 25 ? 1500 : value * 60 + minute) })} />
          <span style={{ fontSize: 24, fontWeight: 800, marginTop: 22 }}>:</span>
          <TimeWheel C={C} label="분" value={minute} min={minMinute} max={hour === 25 ? 0 : 59} disabled={busy || hour === 25} onChange={(value) => setSelection({ date: today.date, minutes: hour * 60 + value })} />
        </div>}
        <p role="status" style={{ fontSize: 13, lineHeight: 1.7, margin: "14px 0 0", padding: "12px 14px", borderRadius: 10, background: C.accentSoft, color: C.text }}><strong style={{ fontWeight: 800 }}>{hour >= 24 ? "다음날" : "오늘"} {String(hour % 24).padStart(2, "0")}:{String(minute).padStart(2, "0")}</strong>부터 대여 예정<br /><span style={{ opacity: .65 }}>지난 시간은 선택할 수 없습니다. 다음날 오전 1시까지 예약할 수 있습니다.</span></p>
      </fieldset>
      <div style={{ display: "flex", gap: 9, alignItems: "center", marginTop: 16, padding: "13px 14px", borderRadius: 12, border: `1px solid ${C.border}` }}>
        <MapPin size={18} style={{ color: C.accent, flexShrink: 0 }} /><div style={{ fontSize: 13 }}><span style={{ opacity: .65 }}>예약 좌석</span><strong style={{ display: "block", marginTop: 3, fontWeight: 800 }}>{floor && unit ? `${floor} · ${unit}` : "좌석을 선택해주세요"}</strong></div>
      </div>
      {error ? <p role="alert" style={{ color: C.error, fontSize: 13, fontWeight: 700, lineHeight: 1.6 }}>{error}</p> : null}
      <div style={{ display: "flex", gap: 10, marginTop: 26 }}>
        <button type="button" disabled={busy} onClick={onClose} style={{ ...button(C), padding: "14px 16px", fontWeight: 800 }}>물품 수정</button>
        <button type="submit" disabled={disabled} style={{ ...button(C), flex: 1, padding: "14px 16px", fontSize: 15, fontWeight: 800, background: C.accent, color: "#fff", border: "none", opacity: disabled ? .5 : 1 }}>{busy ? "예약 중…" : "예약 확정하기"}</button>
      </div>
    </form>
  </section>;
}

export function MyReservations({ C, scriptUrl, onBorrow, onChanged }: { C: any; scriptUrl: string; onBorrow: (item: ItemReservation) => void; onChanged?: () => void }) {
  const [items, setItems] = useState<ItemReservation[]>([]), [error, setError] = useState("");
  const [loading, setLoading] = useState(true), [busyId, setBusyId] = useState<number | null>(null);
  const [borrowers, setBorrowers] = useState<ItemReservation | null>(null);
  const [now, setNow] = useState(Date.now());
  const alive = useRef(true);
  const refreshGeneration = useRef(0);
  async function refresh() {
    const ticket = ++refreshGeneration.current;
    try { const rows = await fetchReservations(scriptUrl, true); if (alive.current && ticket === refreshGeneration.current) { setItems(rows); setError(""); } return rows; }
    catch (err: any) { if (alive.current && ticket === refreshGeneration.current) setError(err.message); return null; }
    finally { if (alive.current && ticket === refreshGeneration.current) setLoading(false); }
  }
  useEffect(() => {
    alive.current = true; void refresh();
    const timer = window.setInterval(() => { setNow(Date.now()); void refresh(); }, 15_000);
    const focus = () => { setNow(Date.now()); void refresh(); };
    window.addEventListener("focus", focus);
    return () => { alive.current = false; refreshGeneration.current++; window.clearInterval(timer); window.removeEventListener("focus", focus); };
  }, [scriptUrl]);
  return <section style={{ marginBottom: 24 }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}><h2 style={{ fontSize: 15 }}>내 예약 물품 · {items.length}건</h2><button onClick={() => { setLoading(true); void refresh(); }} disabled={loading} style={button(C)}>새로고침</button></div>
    <p style={{fontSize:12,color:C.label,lineHeight:1.7}}>예약 시각 10분 전에 자동으로 대여 확인 대기로 이동합니다. 전환 후에도 수령 전이면 여기서 바로 취소할 수 있습니다.</p>
    <p style={{fontSize:12,color:C.warn,lineHeight:1.7}}>예약 예정 시각부터 20분 내 수령 확인이 없으면 자동 취소됩니다. 재고·한도 부족으로 대기 중인 예약도 동일합니다.</p>
    {error ? <p role="alert" style={{ fontSize: 12, color: C.error }}>{error}</p> : null}
    {loading && !items.length ? <p role="status" style={{ fontSize: 12, color: C.label, lineHeight: 1.7, padding: "16px 0" }}>예약 목록을 불러오는 중…</p> : !items.length ? <p style={{ fontSize: 12, color: C.label, padding: "16px 0" }}>예약한 물품이 없습니다.</p> : null}
    {items.map((item) => {
      const future = Date.parse(item.startsAt) - RESERVATION_DUE_LEAD_MS > now;
      const blocked = item.status !== "fulfilled" && !item.available;
      return <div key={item.id} style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginTop: 10, background: C.card }}>
        <button onClick={() => {if(item.status !== "fulfilled") setBorrowers(item);}} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: 0, border: 0, background: "transparent", color: C.text, textAlign: "left", cursor: item.status === "fulfilled" ? "default" : "pointer", opacity: blocked ? .6 : 1 }}>
          {item.image ? <img src={getThumbImageUrl(item.image)} alt="" style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 8 }} /> : null}
          <span><b>{item.itemName}</b><span style={{ display: "block", fontSize: 12, marginTop: 4 }}>{item.variantName ? `${item.variantName} · ` : ""}{item.quantity}개 · {reservationTime(item.startsAt)}부터 예약</span>
            {item.rentalTerms ? <p style={{fontSize:12,lineHeight:1.6,color:C.accentText}}>{rentalTermsLabel(item.rentalTerms)}</p> : null}
            {item.requestRental ? <span style={{display:"block",fontSize:12,marginTop:6,color:C.label}}>{item.requestRental.mode === "request" ? `Request 대여 · 한도 제외 · ${item.requestRental.reason}` : "Request 물품 · 일반 대여"}</span> : null}
            {item.promotionError ? <span style={{display:"block",fontSize:12,marginTop:6,color:C.warn}}>자동 전환 대기: {item.promotionError}</span> : null}
            {blocked ? <span style={{ display: "block", fontSize: 12, marginTop: 6 }}>현재 재고가 부족합니다. 지금 대여 중인 사람을 보려면 클릭하세요</span> : null}</span>
        </button>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <span style={{...button(C),flex:1,color:blocked || item.promotionError ? C.warn : C.label,cursor:"default",textAlign:"center"}}>{item.status === "fulfilled" ? "재고 확보 · 수령 확인 대기" : future ? "예정 시각 10분 전 자동 신청" : blocked || item.promotionError ? "자동 전환 대기" : "자동 신청 확인 중…"}</span>
          <button disabled={busyId !== null} onClick={async () => {
            if (!window.confirm(`'${item.itemName}'의 미수령 예약 ${item.quantity}개를 취소할까요?\n차감된 재고는 복구하고, 이미 수령한 물품은 유지합니다.`)) return;
            setBusyId(item.id);
            try { await cancelItemReservation(scriptUrl, item.id); refreshGeneration.current++; await refresh(); if(alive.current) onChanged?.(); }
            catch (err: any) { setError(err.message); }
            finally { setBusyId(null); }
          }} style={button(C)}>예약 취소</button>
        </div>
      </div>;
    })}
    {borrowers ? <ItemBorrowersModal target={{ id: borrowers.itemId, name: borrowers.itemName, category: "scenario", variantId: borrowers.variantId, reservationId: borrowers.id }} scriptUrl={scriptUrl} C={C} onClose={() => setBorrowers(null)} /> : null}
  </section>;
}
