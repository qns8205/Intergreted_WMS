import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, RotateCcw, Search, X, User, Package, MapPin, ChevronDown } from "lucide-react";
import { AdminItemReservation, cancelAdminItemReservation, fetchAdminReservations } from "../utils/borrowApi";
import { getGoogleDriveImageUrl, getThumbImageUrl } from "../utils/drive";
import { useVersionWorkGuard } from "../utils/versionWorkGuard";
import ImageZoomModal from "./ImageZoomModal";
import { rentalTermsLabel } from '../../shared/rentalTerms.js';
import { filterReservations, groupReservationBorrowers, isReservationDue, RESERVATION_DUE_LEAD_MS, reservationTime as time } from "../utils/reservationDisplay";
import type { ReservationTiming } from "../utils/reservationDisplay";

interface Props {
  scriptUrl: string;
  connected: boolean;
  isLightMode: boolean;
  isActive?: boolean;
  isMobile?: boolean;
  showToast: (message: string, type: "ok" | "error" | "warn" | "info") => void;
}

export default function AdminReservationsPage({ scriptUrl, connected, isLightMode, showToast, isActive = true, isMobile = false }: Props) {
  const [items, setItems] = useState<AdminItemReservation[]>([]);
  const [search, setSearch] = useState("");
  const [timing, setTiming] = useState<ReservationTiming>("upcoming");
  const [personKey, setPersonKey] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [preview, setPreview] = useState("");
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [target, setTarget] = useState<AdminItemReservation | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const mounted = useRef(false), inFlight = useRef(false), generation = useRef(0), cancelling = useRef(false);
  const activeRef = useRef(isActive);
  activeRef.current = isActive;
  const closeRef = useRef<HTMLButtonElement>(null);
  useVersionWorkGuard("admin-reservations", !!target || busy, "예약 취소 확인 중");

  const load = useCallback(async (silent = false) => {
    if (!connected || !scriptUrl || inFlight.current) return;
    inFlight.current = true;
    const ticket = ++generation.current;
    if (!silent) setLoading(true);
    try {
      const rows = await fetchAdminReservations(scriptUrl);
      if (mounted.current && ticket === generation.current) { setItems(rows); setError(""); setLoaded(true); }
    } catch (err: any) {
      if (mounted.current && ticket === generation.current) setError(err.message || "예약 목록을 불러오지 못했습니다.");
    } finally {
      inFlight.current = false;
      if (mounted.current) setLoading(false);
    }
  }, [scriptUrl, connected]);
  useEffect(() => {
    mounted.current = true; void load();
    const refresh = () => { if (!document.hidden && activeRef.current) { setNow(Date.now()); void load(true); } };
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    return () => { mounted.current = false; generation.current++; window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [load]);
  // 화면은 숨겨도 유지한다. 돌아왔을 때 검색·확인 상태는 그대로 두고 최신 목록만 읽는다.
  useEffect(() => { if (isActive) { setNow(Date.now()); void load(true); } }, [isActive, load]);
  useEffect(() => { if (target) closeRef.current?.focus(); }, [target]);

  const groups = useMemo(() => groupReservationBorrowers(filterReservations(items, search, timing, now)), [items, search, timing, now]);
  const selected = items.find(item => item.id === selectedId) || null;
  const visibleCount = groups.reduce((sum,group) => sum + group.items.length,0);
  async function cancel() {
    if (!target || cancelling.current) return;
    const chosen = target;
    cancelling.current = true; setBusy(true); setActionError("");
    try {
      const result = await cancelAdminItemReservation(scriptUrl, chosen.id);
      // 취소 전에 시작한 조회가 뒤늦게 끝나도 취소한 줄을 되살리지 않는다.
      generation.current++;
      if (mounted.current) {
        setItems(rows => rows.filter(row => row.id !== chosen.id)); setTarget(null);
        setSelectedId(current => current === chosen.id ? null : current); setDetailOpen(false);
        showToast(`${chosen.borrowerName}님의 '${chosen.itemName}' 미수령 예약을 취소했습니다.${result.releasedQuantity ? ` 재고 ${result.releasedQuantity}개를 복구했습니다.` : ""}`, "ok");
      }
      void load(true);
    } catch (err: any) {
      if (mounted.current) setActionError(err.message || "예약 취소에 실패했습니다.");
      void load(true);
    } finally {
      cancelling.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const C = {
    bg: isLightMode ? "#f8fafc" : "#0b0f19", card: isLightMode ? "#ffffff" : "#161f30",
    sub: isLightMode ? "#f4f6f9" : "#0f172a", text: isLightMode ? "#111827" : "#f1f5f9",
    label: isLightMode ? "#64748b" : "#94a3b8", border: isLightMode ? "#e6e9ef" : "#26324a",
    accent: "#2563eb", accentText: isLightMode ? "#1d4ed8" : "#93c5fd",
    accentSoft: isLightMode ? "rgba(37,99,235,0.09)" : "rgba(37,99,235,0.16)",
    warn: isLightMode ? "#b45309" : "#fbbf24", warnSoft: isLightMode ? "rgba(180,83,9,0.10)" : "rgba(251,191,36,0.14)",
    danger: isLightMode ? "#dc2626" : "#f87171",
  };
  const button: React.CSSProperties = { border: "1px solid " + C.border, borderRadius: 10,
    padding: "10px 12px", background: C.sub, color: C.text, cursor: "pointer", font: "inherit", fontSize: 13, fontWeight: 700 };
  function choose(item: AdminItemReservation) { setSelectedId(item.id); setDetailOpen(true); }
  return <section aria-label="예약 대여 관리" onKeyDown={event => {
    if (event.key === "Escape" && preview) { event.preventDefault(); setPreview(""); }
    event.stopPropagation();
  }}
    style={{ display:"flex", flexDirection:isMobile ? "column" : "row", flex:1, width:"100%", minWidth:0, height:"100%", minHeight:0, background:C.bg, color:C.text, position:"relative" }}>
    <div id="admin-reservations-list" style={{flex:1,minWidth:0,minHeight:0,overflowY:"auto",padding:isMobile ? "14px 12px 84px" : 20}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
        <CalendarClock size={19} color={C.accentText} /><h1 style={{fontSize:18,fontWeight:800,margin:0,flex:1}}>예약 대여</h1>
        {!isMobile ? <span style={{fontSize:11,color:C.label}}>15초마다 자동 새로고침</span> : null}
        <button type="button" title="예약 대여 새로고침" aria-label="예약 대여 새로고침" disabled={loading || busy || !connected} onClick={() => void load()}
          style={{...button,display:"flex",color:C.accentText,opacity:loading || busy || !connected ? .5 : 1}}><RotateCcw size={14} /></button>
      </div>
      <div role="group" aria-label="예약 시각 필터" style={{display:"flex",gap:6,marginBottom:10}}>
        {([["upcoming","예정 시각 전"],["due","예약 후 미수령"]] as const).map(([value,label]) => <button key={value} type="button" aria-pressed={timing===value} onClick={() => setTiming(value)}
          style={{flex:1,padding:"10px 4px",borderRadius:11,cursor:"pointer",fontSize:isMobile ? 12 : 13,fontWeight:800,
            border:"1.5px solid " + (timing===value ? C.accent : C.border),background:timing===value ? C.accent : C.card,color:timing===value ? "#fff" : C.label}}>{label}</button>)}
      </div>
      <div style={{position:"relative",marginBottom:10}}>
        <Search size={15} style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:C.label,pointerEvents:"none"}} />
        <input aria-label="예약 대여 검색" placeholder="이름 · 사번 · 물품 · 좌석 검색" value={search} onChange={event => setSearch(event.target.value)}
          style={{...button,width:"100%",boxSizing:"border-box",paddingLeft:36,paddingRight:search ? 36 : 12,fontWeight:400,outline:"none",cursor:"text"}} />
        {search ? <button type="button" aria-label="예약 검색 지우기" onClick={() => setSearch("")} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",border:0,padding:0,display:"flex",background:"transparent",color:C.label,cursor:"pointer"}}><X size={14} /></button> : null}
      </div>
      <div style={{fontSize:11,color:C.label,lineHeight:1.7,marginBottom:14}}>
        <b style={{color:C.accentText}}>대여자 선택 → 예약 물품 선택</b> 후 {isMobile ? "아래" : "오른쪽"}에서 확인·취소합니다.
        <span style={{display:"block"}}>예약 시각 {RESERVATION_DUE_LEAD_MS / 60000}분 전부터 ‘예약 후 미수령’에 표시됩니다. 대여 확인을 완료하면 목록에서 사라집니다.</span>
        <span style={{display:"block"}}>예약 예정 시각부터 20분 내 수령 확인이 없으면 자동 취소됩니다. 전환 대기 중인 예약도 포함됩니다.</span>
        {loaded ? <span style={{display:"block"}}>{groups.length}명 · {visibleCount}건{search || timing!=="all" ? " / 전체 " + items.length + "건" : ""}</span> : null}
      </div>
      {!connected ? <p style={{fontSize:13,color:C.label}}>서버 연결 후 예약을 확인할 수 있습니다.</p> : null}
      {error ? <p role="alert" style={{color:C.danger,fontSize:12}}>{error}</p> : null}
      {loading && !loaded ? <div role="status" style={{padding:"48px 0",textAlign:"center",color:C.label,fontSize:13}}>불러오는 중…</div> : null}
      {loaded && !error && !groups.length ? <div className="wms-empty-state" style={{textAlign:"center",padding:"48px 0",color:C.label,fontSize:13}}>
        <CalendarClock size={36} style={{marginBottom:12,opacity:.35}} /><div>{items.length ? "검색 조건에 맞는 예약이 없습니다." : "진행 중인 예약이 없습니다."}</div>
      </div> : null}
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {groups.map(group => {
          const active = personKey===group.key;
          return <article key={group.key} style={{border:"1.5px solid " + (active ? C.accent : C.border),borderRadius:12,background:C.card,overflow:"hidden"}}>
            <button type="button" aria-expanded={active} aria-label={group.name + " · 사번 " + group.employeeId + " 예약 보기"} onClick={() => {setPersonKey(active ? null : group.key);setSelectedId(null);setDetailOpen(false);}}
              style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",width:"100%",border:0,textAlign:"left",cursor:"pointer",color:C.text,background:active ? C.accentSoft : "transparent"}}>
              <span style={{width:32,height:32,borderRadius:9,background:C.accentSoft,color:C.accentText,display:"grid",placeItems:"center",flexShrink:0}}><User size={16} /></span>
              <span style={{flex:1,minWidth:0}}>
                <span style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
                  <strong style={{fontSize:14,fontWeight:800}}>{group.name}</strong>
                  <span style={{fontSize:11,fontWeight:900,color:C.accentText,background:C.accentSoft,border:"1px solid " + C.accent + "44",borderRadius:7,padding:"2px 7px",fontFamily:"monospace"}}>사번 {group.employeeId}</span>
                  {group.seats.map(seat => <span key={seat} style={{fontSize:10.5,fontWeight:800,color:C.warn,background:C.warnSoft,borderRadius:999,padding:"2px 8px"}}>📍 {seat}</span>)}
                </span>
                <span style={{display:"block",fontSize:11.5,color:C.label,marginTop:2}}>{group.types}종 · {group.quantity}개 · 예약 {group.items.length}건</span>
              </span>
              <ChevronDown size={15} color={active ? C.accentText : C.label} style={{flexShrink:0,transform:active ? "rotate(180deg)" : undefined}} />
            </button>
            {active ? <div style={{borderTop:"1px solid " + C.border,padding:"8px 10px"}}>
              {group.times.map(bucket => <div key={bucket.startsAt} style={{marginBottom:10}}>
                <div style={{display:"flex",alignItems:"center",gap:7,padding:"4px 2px 6px",color:C.accentText,fontSize:11.5,fontWeight:800}}>
                  <CalendarClock size={12} /><span>{time(bucket.startsAt)} 예정</span>
                  <span style={{height:1,background:C.border,flex:1}} />
                  <span style={{color:C.label,fontWeight:500}}>{bucket.items.length}건</span>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:5}}>
                  {bucket.items.map(item => <button key={item.id} type="button" aria-label={item.itemName + " 예약 선택 · " + item.quantity + "개"} aria-pressed={selectedId===item.id} onClick={() => choose(item)}
                    style={{display:"flex",alignItems:"center",gap:9,width:"100%",padding:"9px 10px",textAlign:"left",border:"1px solid " + (selectedId===item.id ? C.accent : C.border),borderRadius:9,
                      background:selectedId===item.id ? C.accentSoft : C.sub,color:C.text,cursor:"pointer"}}>
                    {item.image ? <img src={getThumbImageUrl(item.image)} alt="" loading="lazy" style={{width:42,height:42,objectFit:"contain",borderRadius:7,background:C.card,flexShrink:0}} /> : <span style={{width:42,height:42,borderRadius:7,background:C.card,color:C.label,display:"grid",placeItems:"center",flexShrink:0}}><Package size={19} /></span>}
                    <span style={{flex:1,minWidth:0}}>
                      <span style={{display:"flex",gap:7,alignItems:"center",flexWrap:"wrap",fontSize:12.5,fontWeight:800}}>{item.itemName}
                        {item.variantName ? <span style={{fontSize:10,fontWeight:700,borderRadius:999,padding:"2px 7px",color:C.accentText,background:C.accentSoft}}>{item.variantName}</span> : null}
                      </span>
                      <span style={{display:"block",marginTop:2,fontSize:10.5,color:C.label}}>ID {item.itemId} · {item.status === "fulfilled" ? "예약 후 미수령 · 대여 확인 대기" : isReservationDue(item.startsAt,now) ? "예약 후 미수령 · 자동 전환 대기" : "예정 시각 전"}{item.status !== "fulfilled" && !item.available ? " · 현재 재고 부족" : ""}</span>
                      {item.promotionError ? <span style={{display:"block",marginTop:3,fontSize:11,color:C.warn}}>자동 전환 대기: {item.promotionError}</span> : null}
                    </span>
                    <span style={{fontSize:12,fontWeight:800,color:selectedId===item.id ? C.accentText : C.label,flexShrink:0}}>×{item.quantity}</span>
                  </button>)}
                </div>
              </div>)}
            </div> : null}
          </article>;
        })}
      </div>
    </div>
    {isMobile ? <button type="button" onClick={() => setDetailOpen(value => !value)} aria-expanded={detailOpen} style={{position:"absolute",bottom:0,left:0,right:0,zIndex:10,display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,padding:"16px 18px",border:0,borderTop:"1px solid " + C.border,background:C.card,color:C.text,fontSize:13,fontWeight:800}}>
      <span>예약 상세 <span style={{color:C.accentText}}>{selected ? "1건 · " + selected.quantity + "개" : "물품 선택"}</span></span><span style={{color:C.accentText}}>{detailOpen ? "접기 ▼" : "펼치기 ▲"}</span>
    </button> : null}
    <aside aria-label="예약 상세" style={{display:isMobile && !detailOpen ? "none" : "flex",flexDirection:"column",minHeight:0,boxSizing:"border-box",background:C.card,
      ...(isMobile ? {position:"absolute",left:0,right:0,bottom:58,height:"min(70%, 600px)",zIndex:9,borderTop:"1px solid " + C.border,borderRadius:"16px 16px 0 0",boxShadow:"0 -8px 30px rgba(0,0,0,.12)"} : {width:"50%",flexShrink:0,borderLeft:"1px solid " + C.border})}}>
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"18px 20px",borderBottom:"1px solid " + C.border}}>
        <CalendarClock size={18} color={C.accentText} /><h2 style={{fontSize:14,fontWeight:800,margin:0,flex:1}}>예약 상세 <span style={{color:C.accentText}}>{selected ? "1건 · " + selected.quantity + "개" : "0건"}</span></h2>
        {selected ? <button type="button" aria-label="예약 선택 해제" onClick={() => {setSelectedId(null);setDetailOpen(false);}} style={{border:0,background:"transparent",color:C.label,cursor:"pointer",display:"flex"}}><X size={17} /></button> : null}
      </div>
      <div style={{flex:1,minHeight:0,overflowY:"auto",padding:20}}>
        {!selected ? <div className="wms-empty-state" style={{textAlign:"center",padding:"48px 0",color:C.label,fontSize:13,lineHeight:1.8}}>
          <Package size={34} style={{opacity:.3,marginBottom:12}} /><div>선택한 예약 물품이 없습니다.</div><div>왼쪽에서 대여자를 고르고 예약 물품을 선택해주세요.</div>
        </div> : <>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}><User size={17} color={C.accentText} /><strong>{selected.borrowerName}</strong><span style={{fontSize:11,fontWeight:800,color:C.accentText,background:C.accentSoft,padding:"3px 7px",borderRadius:7}}>사번 {selected.employeeId}</span></div>
          <div style={{display:"flex",gap:12,padding:14,border:"1px solid " + C.border,borderRadius:12,background:C.sub}}>
            {selected.image ? <button type="button" title="예약 물품 사진 크게 보기" onClick={() => setPreview(getGoogleDriveImageUrl(selected.image))} style={{padding:0,border:0,background:C.card,borderRadius:8,cursor:"zoom-in",flexShrink:0}}><img src={getThumbImageUrl(selected.image)} alt={selected.itemName} style={{width:68,height:68,objectFit:"contain",borderRadius:8,display:"block"}} /></button> : <span style={{width:68,height:68,borderRadius:8,background:C.card,color:C.label,display:"grid",placeItems:"center",flexShrink:0}}><Package size={25} /></span>}
            <div style={{minWidth:0,flex:1,lineHeight:1.7}}><strong style={{fontSize:14,overflowWrap:"anywhere"}}>{selected.itemName}</strong><div style={{fontSize:11,color:C.label}}>ID {selected.itemId}</div>{selected.variantName ? <span style={{fontSize:11,color:C.accentText,fontWeight:700}}>{selected.variantName}</span> : null}<div style={{fontSize:13,fontWeight:800,color:C.accentText}}>예약 수량 {selected.quantity}개</div></div>
          </div>
          <dl style={{display:"grid",gridTemplateColumns:"80px minmax(0,1fr)",gap:"12px 10px",margin:"20px 0",fontSize:12,lineHeight:1.7}}>
            <dt style={{color:C.label}}>대여 예정</dt><dd style={{margin:0,fontWeight:800,color:C.accentText}}>{time(selected.startsAt)}</dd>
            <dt style={{color:C.label}}>좌석</dt><dd style={{margin:0,overflowWrap:"anywhere"}}><MapPin size={12} style={{verticalAlign:"middle",marginRight:4,color:C.warn}} />{selected.floor} / {selected.unit}</dd>
            <dt style={{color:C.label}}>예약 신청</dt><dd style={{margin:0}}>{time(selected.createdAt)}</dd>
            <dt style={{color:C.label}}>현재 상태</dt><dd style={{margin:0}}>{selected.status === "fulfilled" ? "예약 후 미수령 · 대여 확인 대기" : isReservationDue(selected.startsAt,now) ? "예약 후 미수령 · 자동 전환 대기" : "예정 시각 전"}</dd>
            {selected.rentalTerms ? <><dt style={{color:C.label}}>대여 기간</dt><dd style={{margin:0}}>{rentalTermsLabel(selected.rentalTerms)}</dd></> : null}
            {selected.requestRental ? <><dt style={{color:C.label}}>대여 방식</dt><dd style={{margin:0}}>{selected.requestRental.mode === "request" ? "Request 대여 · 종류 한도 제외" : "일반 대여 · 기존 한도 적용"}</dd>
              {selected.requestRental.mode === "request" ? <><dt style={{color:C.label}}>Request 사유</dt><dd style={{margin:0,whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{selected.requestRental.reason}</dd></> : null}</> : null}
          </dl>
          {selected.status === "fulfilled" ? <div style={{padding:"10px 12px",borderRadius:10,fontSize:12,color:C.accentText,background:C.accentSoft,lineHeight:1.6}}>미수령 물품의 재고가 확보된 상태입니다. 안 가져갈 물품은 아래에서 바로 취소해 재고를 풀어주세요. 실제 수령 확인은 ‘대여 및 반납’에서 처리합니다.</div> : !selected.available ? <div style={{padding:"10px 12px",borderRadius:10,fontSize:12,color:C.warn,background:C.warnSoft,lineHeight:1.6}}>현재 재고가 부족하거나 대여할 수 없는 물품입니다. 예약 취소는 가능합니다.</div> : null}
          {selected.promotionError ? <p role="status" style={{fontSize:12,color:C.warn,lineHeight:1.7}}>자동 전환 대기: {selected.promotionError}<br />조건이 충족되면 자동으로 다시 확인합니다.</p> : null}
        </>}
      </div>
      <div style={{padding:"16px 20px",borderTop:"1px solid " + C.border}}>
        <p style={{margin:"0 0 10px",fontSize:11,color:C.label,lineHeight:1.6}}>미수령 수량만 취소합니다. 전환 후 묶인 재고는 복구하고, 이미 수령한 물품은 유지합니다.</p>
        <button type="button" disabled={!selected || busy || !connected} onClick={() => {if(selected){setActionError("");setTarget(selected);}}}
          style={{width:"100%",padding:14,border:0,borderRadius:11,display:"flex",alignItems:"center",justifyContent:"center",gap:7,fontSize:14,fontWeight:800,
            background:selected && connected ? "#dc2626" : C.border,color:selected && connected ? "#fff" : C.label,cursor:selected && !busy ? "pointer" : "not-allowed",opacity:busy ? .5 : 1}}>
          <X size={16} />{busy ? "취소 중…" : "선택한 예약 취소"}
        </button>
      </div>
    </aside>
    {target ? <div onClick={() => { if (!busy) setTarget(null); }} style={{ position: "fixed", inset: 0, zIndex: 10010, background: "rgba(0,0,0,.6)", display: "grid", placeItems: "center", padding: 16 }}>
      <section role="dialog" aria-modal="true" aria-labelledby="admin-reservation-cancel-title" onClick={event => event.stopPropagation()}
        onKeyDown={event => {
          if (event.key === "Escape" && !busy) { event.preventDefault(); setTarget(null); }
          if (event.key !== "Tab") return;
          const dialog = event.currentTarget as HTMLElement;
          const buttons = [...dialog.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
          const first = buttons[0], last = buttons.at(-1);
          if (!first || !last) { event.preventDefault(); return; }
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }}
        style={{ width: "min(420px,100%)", boxSizing: "border-box", background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24 }}>
        <h2 id="admin-reservation-cancel-title" style={{ fontSize: 18, marginTop: 0 }}>이 예약을 취소할까요?</h2>
        <p style={{ fontSize: 14, lineHeight: 1.8 }}>{target.borrowerName} · {target.employeeId}<br />{target.itemName}{target.variantName ? ` · ${target.variantName}` : ""} × {target.quantity}<br />{time(target.startsAt)} 예정</p>
        <p style={{ color: C.label, fontSize: 12 }}>선택한 물품의 미수령 수량만 취소합니다. 차감된 재고는 복구하며, 이미 수령한 물품과 기존 기록은 유지합니다.</p>
        {actionError ? <p role="alert" style={{ color: C.danger, fontSize: 12 }}>{actionError}</p> : null}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
          <button ref={closeRef} type="button" disabled={busy} onClick={() => setTarget(null)} style={button}>돌아가기</button>
          <button type="button" disabled={busy} onClick={() => void cancel()} style={{ ...button, color: "#fff", background: "#dc2626", borderColor: "#dc2626", opacity: busy ? .6 : 1 }}>{busy ? "취소 중…" : "예약 취소"}</button>
        </div>
      </section>
    </div> : null}
    <ImageZoomModal url={preview} onClose={() => setPreview("")} />
  </section>;
}
