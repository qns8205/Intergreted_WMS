import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Camera, Check, ChevronRight, ClipboardList, Package, RotateCcw, Search, Upload, Wrench, X } from 'lucide-react';
import { objectReportGet, objectReportPost } from '../utils/borrowApi';
import { getGoogleDriveImageUrl, resizeAndCompressImage } from '../utils/drive';
import { useVersionWorkGuard } from '../utils/versionWorkGuard';

type Colors = Record<string, string>;
export type ObjectReportAction = { mode: 'choose' | 'history'; item?: any };
const STATUS: Record<string, string> = { pending: '접수 대기', approved: '변형 승인', rejected: '반려', completed: '완료 확인 대기', acknowledged: '파손 확인', closed: '처리 완료' };
const ACTION: Record<string, string> = { ...STATUS, registered: 'SM 신규 등록', submitted: '보고 접수', damage_return: '파손 반납' };
function palette(light: boolean): Colors {
  return { bg: light ? '#f8fafc' : '#0b0f19', card: light ? '#ffffff' : '#161f30', cardSub: light ? '#f4f6f9' : '#0f172a', text: light ? '#111827' : '#f1f5f9', label: light ? '#64748b' : '#94a3b8', border: light ? '#e6e9ef' : '#26324a', accent: '#2563eb', accentText: light ? '#1d4ed8' : '#93c5fd', accentSoft: light ? 'rgba(37,99,235,.09)' : 'rgba(37,99,235,.16)', error: light ? '#dc2626' : '#f87171', warn: light ? '#b45309' : '#fbbf24', warnSoft: light ? 'rgba(180,83,9,.10)' : 'rgba(251,191,36,.14)' };
}
const btn = (C: Colors): React.CSSProperties => ({ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 12px', border: `1px solid ${C.border}`, borderRadius: 10, background: C.cardSub, color: C.text, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700 });
const field = (C: Colors): React.CSSProperties => ({ width: '100%', boxSizing: 'border-box', padding: '11px 12px', border: `1px solid ${C.border}`, borderRadius: 10, background: C.cardSub, color: C.text, fontFamily: 'inherit', fontSize: 13, lineHeight: 1.65, marginTop: 6 });
const label: React.CSSProperties = { display: 'block', fontSize: 12.5, fontWeight: 700, marginBottom: 14 };
function changed() { window.dispatchEvent(new Event('wms:rental-notifications-changed')); }
function Status({ r, C }: { r: any; C: Colors }) {
  const waiting = ['pending', 'completed'].includes(r.status);
  return <span style={{ display: 'inline-flex', flexShrink: 0, padding: '3px 8px', borderRadius: 7, fontSize: 10.5, fontWeight: 800, background: waiting ? C.accentSoft : C.cardSub, color: waiting ? C.accentText : C.label }}>{STATUS[r.status] || r.status}</span>;
}
function Photos({ r, C }: { r: any; C: Colors }) {
  return <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>{[[r.baseline_image, '등록 사진'], [r.image_path, '접수 사진'], [r.completion_image, '완료 사진']].filter(([url]) => url).map(([url, title]) => <a key={title} href={getGoogleDriveImageUrl(url)} target="_blank" rel="noreferrer" style={{ color: C.label, fontSize: 11, textDecoration: 'none' }}><img src={getGoogleDriveImageUrl(url)} alt={title} style={{ display: 'block', width: 110, height: 90, objectFit: 'contain', borderRadius: 9, border: `1px solid ${C.border}`, background: C.cardSub, marginBottom: 5 }} />{title}</a>)}</div>;
}
function ReportSummary({ r, C }: { r: any; C: Colors }) {
  return <div style={{ fontSize: 13, lineHeight: 1.7 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}><span style={{ color: C.accentText }}>{r.kind === 'damage' ? <AlertTriangle size={16} /> : <Wrench size={16} />}</span><strong style={{ flex: 1 }}>{r.item_name}</strong><Status r={r} C={C} /></div>
    <div style={{ color: C.label, fontSize: 11.5, marginBottom: 14 }}>#{r.id} · {r.item_id} · {r.quantity}개<br />{r.borrower_name} · {r.created_at}</div>
    <Photos r={r} C={C} />
    {[[r.reason, '요청 사유 및 파손 경위'], [r.plan, '변형 내용과 복구 계획'], [r.completion_note, '작업 완료 내용'], [r.review_note, '관리자 검토']].filter(([value]) => value).map(([value, title]) => <div key={title} style={{ marginBottom: 14 }}><div style={{ color: C.label, fontSize: 11, marginBottom: 4 }}>{title}</div><div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{value}</div></div>)}
    {r.target_item_id ? <p style={{ color: C.accentText, fontSize: 12 }}>등록 연결 · {r.target_item_id}{r.target_variant_id ? ` / 종류 ${r.target_variant_id}` : ''}</p> : null}
    <details style={{ margin: '14px 0', fontSize: 11.5, color: C.label }}><summary style={{ cursor: 'pointer' }}>처리 이력 {(r.events || []).length}건</summary>{(r.events || []).map((e: any, i: number) => <div key={i} style={{ borderLeft: `2px solid ${C.border}`, paddingLeft: 10, margin: '10px 0', lineHeight: 1.65 }}>{e.occurred_at} · {e.actor}<br /><b>{ACTION[e.action] || e.action}</b> · {e.note}</div>)}</details>
  </div>;
}
function ReportDialog({ C, title, busy = false, onClose, children }: { C: Colors; title: string; busy?: boolean; onClose: () => void; children: React.ReactNode }) {
  const box = useRef<HTMLElement>(null), close = useRef<HTMLButtonElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; return () => { if (previous?.isConnected) previous.focus(); }; }, []);
  useEffect(() => { close.current?.focus(); }, [title]);
  return <div onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }} onKeyDown={e => {
    e.stopPropagation();
    if (e.key === 'Escape' && !busy) { e.preventDefault(); onClose(); }
    if (e.key === 'Tab') {
      const controls = (Array.from(box.current?.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href],summary') || []) as HTMLElement[]).filter(el => el.getClientRects().length);
      const first = controls[0], last = controls[controls.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  }} style={{ position: 'fixed', inset: 0, zIndex: 10020, padding: 16, background: 'rgba(0,0,0,.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.text }}>
    <section ref={box} role="dialog" aria-modal="true" aria-label={title} style={{ display: 'flex', flexDirection: 'column', width: 'min(560px,100%)', maxHeight: '90dvh', background: C.card, border: `1px solid ${C.border}`, borderRadius: 18, boxShadow: '0 20px 60px rgba(0,0,0,.2)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '18px 20px', borderBottom: `1px solid ${C.border}` }}><ClipboardList size={18} color={C.accentText} /><h2 style={{ flex: 1, fontSize: 17, fontWeight: 800, margin: 0 }}>{title}</h2><button ref={close} type="button" aria-label="닫기" disabled={busy} onClick={onClose} style={{ ...btn(C), border: 0, padding: 5, background: 'transparent', color: C.label }}><X size={18} /></button></div>
      <div style={{ padding: 20, overflowY: 'auto', minHeight: 0 }}>{children}</div>
    </section>
  </div>;
}
function PhotoInput({ C, value, onChange, onError, onReading }: { C: Colors; value: string; onChange: (v: string) => void; onError: (s: string) => void; onReading: (v: boolean) => void }) {
  const [reading, setReading] = useState(false), picker = useRef<HTMLInputElement>(null);
  return <div style={{ marginBottom: 18 }}><div style={{ ...label, marginBottom: 6 }}>현재 상태 사진 <span style={{ color: C.error }}>필수</span></div>
    <input ref={picker} aria-label="현재 상태 사진 첨부" type="file" accept="image/jpeg,image/png,image/webp" disabled={reading} style={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden', clipPath: 'inset(50%)' }} onChange={async e => {
      const file = e.target.files?.[0]; if (!file) return;
      setReading(true); onReading(true); onChange('');
      try { if (file.size > 25 * 1024 * 1024) throw Error('25MB 이하 사진을 선택해주세요.'); onChange(await resizeAndCompressImage(file)); }
      catch (err) { onError(err instanceof Error ? err.message : '사진을 읽지 못했습니다.'); }
      finally { setReading(false); onReading(false); }
    }} />
    {value ? <img src={value} alt="첨부 사진 미리보기" style={{ width: '100%', maxHeight: 180, objectFit: 'contain', background: C.cardSub, border: `1px solid ${C.border}`, borderRadius: 10, marginBottom: 8 }} /> : null}
    <button type="button" disabled={reading} onClick={() => picker.current?.click()} style={{ ...btn(C), width: '100%', minHeight: value ? 42 : 64, color: C.accentText }}><Camera size={16} />{reading ? '사진 준비 중…' : value ? '사진 변경' : '사진 업로드'}<Upload size={14} /></button>
    <p style={{ margin: '6px 0 0', fontSize: 11, color: C.label, lineHeight: 1.65 }}>해당 물품과 변경·손상 부위가 보이는 현재 사진을 첨부하세요.</p>
  </div>;
}
export function BorrowerObjectReports({ C, scriptUrl, identity, action, onClose, onSubmitted }: { C: Colors; scriptUrl: string; identity: { employeeId: string; name: string }; action: ObjectReportAction | null; onClose: () => void; onSubmitted: (message: string) => void }) {
  const [reports, setReports] = useState<any[]>([]), [kind, setKind] = useState<'choose' | 'modification' | 'damage' | 'complete'>('choose');
  const [quantity, setQuantity] = useState(1), [reason, setReason] = useState(''), [plan, setPlan] = useState(''), [photo, setPhoto] = useState(''), [clientId, setClientId] = useState('');
  const [completion, setCompletion] = useState<any>(null), [busy, setBusy] = useState(false), [reading, setReading] = useState(false), [error, setError] = useState(''), [loading, setLoading] = useState(false), [expanded, setExpanded] = useState<number | null>(null);
  useVersionWorkGuard('borrower-object-report', !!action && (action.mode !== 'history' || kind === 'complete'), '변형 요청 및 파손 신고 작성 중');
  const refresh = useCallback(async () => { setLoading(true); try { const d = await objectReportGet(scriptUrl, false, identity); setReports(d.items || []); } catch (e: any) { setError(e.message); } finally { setLoading(false); } }, [scriptUrl, identity.employeeId, identity.name]);
  useEffect(() => { if (!action) return; setKind('choose'); setQuantity(1); setReason(''); setPlan(''); setPhoto(''); setCompletion(null); setError(''); setExpanded(null); setClientId(crypto.randomUUID()); if (action.mode === 'history') void refresh(); }, [action, refresh]);
  if (!action) return null;
  const item = action.item, history = action.mode === 'history' && kind !== 'complete';
  const title = history ? '내 요청·신고 내역' : kind === 'choose' ? '변형 요청 · 파손 신고' : kind === 'complete' ? '변형 완료 보고' : kind === 'modification' ? '변형 승인 요청' : '사용 중 파손 신고';
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (busy || reading || !photo) return; setBusy(true); setError('');
    try {
      await objectReportPost(scriptUrl, kind === 'complete' ? 'completeObjectReport' : 'createObjectReport', kind === 'complete' ? { ...identity, id: completion.id, note: reason, photo } : { ...identity, clientId, kind, sheetType: item.sheetType, rowIndex: item.rowIndex, quantity, reason, plan, photo });
      changed(); onClose(); onSubmitted(kind === 'modification' ? '변형 요청을 접수했습니다. 승인 후 작업해주세요.' : kind === 'complete' ? '완료 보고를 접수했습니다. 관리자 확인을 기다려주세요.' : '파손 신고를 접수했습니다. 사용을 중지하고 관리자 안내를 기다려주세요.');
    } catch (e: any) { setError(e.message || '제출하지 못했습니다.'); } finally { setBusy(false); }
  }
  return <ReportDialog C={C} title={title} busy={busy || reading} onClose={onClose}>
    {error ? <p role="alert" style={{ fontSize: 12, color: C.error, lineHeight: 1.6, marginTop: 0 }}>{error}</p> : null}
    {history ? <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}><span style={{ flex: 1, fontSize: 12, color: C.label }}>변형 요청과 파손 신고 {reports.length}건</span><button type="button" aria-label="보고 내역 새로고침" style={btn(C)} disabled={loading} onClick={() => void refresh()}><RotateCcw size={13} /></button></div>
      {loading && !reports.length ? <p role="status" style={{ color: C.label, fontSize: 13 }}>불러오는 중…</p> : !reports.length ? <div className="wms-empty-state" style={{ textAlign: 'center', padding: '36px 0', color: C.label, fontSize: 13 }}><ClipboardList size={32} style={{ opacity: .4, marginBottom: 10 }} /><div>요청·신고 내역이 없습니다.</div></div> : reports.map(r => <div key={r.id} style={{ border: `1px solid ${C.border}`, borderRadius: 12, marginBottom: 8, overflow: 'hidden' }}>
        <button type="button" aria-expanded={expanded === r.id} onClick={() => setExpanded(expanded === r.id ? null : r.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: 12, background: C.cardSub, border: 0, textAlign: 'left', color: C.text, cursor: 'pointer' }}><span style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{r.kind === 'damage' ? '파손 신고' : '변형 요청'} · {r.item_name}</span><Status r={r} C={C} /><ChevronRight size={14} /></button>
        {expanded === r.id ? <div style={{ padding: 14 }}><ReportSummary r={r} C={C} /></div> : null}
        {r.kind === 'modification' && r.status === 'approved' ? <div style={{ padding: '0 12px 12px', background: C.cardSub }}><button type="button" style={{ ...btn(C), color: C.accentText, width: '100%' }} onClick={() => { setCompletion(r); setKind('complete'); setReason(''); setPhoto(''); setError(''); }}>변형 완료 사진 제출<ArrowRight size={13} /></button></div> : null}
      </div>)}
    </> : kind === 'choose' ? <>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>{item?.itemLabel}</div><p style={{ margin: '0 0 18px', color: C.label, fontSize: 12, lineHeight: 1.7 }}>등록 사진 기준으로 사용하고, 변경이나 손상이 있으면 해당 물품에서 보고해주세요.</p>
      {[['modification', '변형 요청', '작업 전 사유와 범위를 승인받습니다.'], ['damage', '지금 파손 신고', '사용 중 발견한 손상을 사진과 함께 신고합니다.']].map(([id, text, hint]) => <button key={id} type="button" onClick={() => setKind(id as 'modification' | 'damage')} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: 16, marginBottom: 10, border: `1px solid ${C.border}`, borderRadius: 12, background: C.cardSub, color: C.text, textAlign: 'left', cursor: 'pointer' }}><span style={{ color: id === 'damage' ? C.error : C.accentText }}>{id === 'damage' ? <AlertTriangle size={20} /> : <Wrench size={20} />}</span><span style={{ flex: 1 }}><strong style={{ display: 'block', fontSize: 14 }}>{text}</strong><span style={{ display: 'block', fontSize: 11.5, color: C.label, marginTop: 4 }}>{hint}</span></span><ChevronRight size={15} color={C.label} /></button>)}
    </> : <form onSubmit={submit}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', paddingBottom: 14, marginBottom: 14, borderBottom: `1px solid ${C.border}` }}>{item?.image ? <img src={getGoogleDriveImageUrl(item.image)} alt="등록 사진" style={{ width: 62, height: 62, objectFit: 'contain', borderRadius: 10, background: C.cardSub }} /> : <Package size={24} color={C.label} />}<div style={{ fontSize: 13, fontWeight: 700 }}>{completion?.item_name || item?.itemLabel}<div style={{ fontSize: 11, color: C.label, fontWeight: 400, marginTop: 4 }}>{kind === 'modification' ? '승인 범위를 확인한 뒤 작업하세요.' : kind === 'complete' ? '실제 작업 내용과 완료 사진을 제출하세요.' : '신고 후 사용을 중지하고 관리자 안내를 기다려주세요.'}</div></div></div>
      {kind !== 'complete' ? <label style={label}>대상 수량<input type="number" required min={1} max={item?.quantity || 1} value={quantity} onChange={e => setQuantity(Number(e.target.value))} style={field(C)} /></label> : null}
      <label style={label}>{kind === 'complete' ? '실제 작업 내용' : kind === 'modification' ? '변형이 필요한 사유' : '파손 증상과 발견 시점 및 경위'}<textarea required maxLength={3000} value={reason} onChange={e => setReason(e.target.value)} style={{ ...field(C), minHeight: 82, resize: 'vertical' }} /></label>
      {kind === 'modification' ? <label style={label}>변형할 부분과 방법 및 원상복구 가능 여부<textarea required maxLength={3000} value={plan} onChange={e => setPlan(e.target.value)} style={{ ...field(C), minHeight: 82, resize: 'vertical' }} /></label> : null}
      <PhotoInput C={C} value={photo} onChange={setPhoto} onError={setError} onReading={setReading} />
      <p style={{ fontSize: 11.5, color: C.label, lineHeight: 1.7, margin: '0 0 16px' }}>{kind === 'damage' ? '반복 사용에 따른 파손도 즉시 신고하세요. 사전 미신고 파손 반납은 대여 가능 종류 5종 차감이 14일간 적용되며, 관리자가 사유를 남겨 면제할 수 있습니다.' : '보고 없이 몰래 반납하거나 승인 없이 훼손·수리·폐기하지 마세요.'}</p>
      <div style={{ display: 'flex', gap: 8 }}><button type="button" disabled={busy || reading} style={btn(C)} onClick={onClose}>취소</button><button type="submit" disabled={busy || reading || !photo} style={{ ...btn(C), flex: 1, background: C.accent, borderColor: C.accent, color: '#fff', opacity: busy || reading || !photo ? .5 : 1 }}><Check size={15} />{busy ? '제출 중…' : '사진과 함께 제출'}</button></div>
    </form>}
  </ReportDialog>;
}

function AdminReport({ r, C, scriptUrl, onChanged, registrationItems }: { key?: number; r: any; C: Colors; scriptUrl: string; onChanged: () => Promise<void>; registrationItems: any[] }) {
  const [note, setNote] = useState(''), [registration, setRegistration] = useState(r.kind === 'damage' ? 'none' : 'restored'), [targetId, setTargetId] = useState(''), [variantId, setVariantId] = useState(''), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [newName, setNewName] = useState(r.item_name || ''), [sector, setSector] = useState('Seoul'), [rootSlot, setRootSlot] = useState(''), [size, setSize] = useState('Small'), [property, setProperty] = useState('Hard'), [newPhoto, setNewPhoto] = useState(''), [reading, setReading] = useState(false);
  const registeredTarget = r.registration_kind === 'new_object' ? r.target_item_id : '';
  const effectiveTarget = registeredTarget || targetId;
  const registrationRequired = r.status === 'completed' || (r.status === 'acknowledged' && registration !== 'none');
  const targetReady = !registrationRequired || (confirmed && (registration !== 'new_object' || !!effectiveTarget) && (registration !== 'variant' || !!variantId));
  useEffect(() => { if (registeredTarget) { setTargetId(registeredTarget); setRegistration('new_object'); } }, [registeredTarget]);
  async function registerNewObject() {
    setBusy(true); setError('');
    try {
      const result = await objectReportPost(scriptUrl, 'registerObjectReportTarget', { id: r.id, name: newName, sector, rootSlot, smSize: size, smProperty: property, photo: newPhoto });
      setTargetId(result.item.id); await onChanged(); changed();
      if (result.warning) setError(result.warning);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  useVersionWorkGuard('admin-object-report', busy || reading || !!note.trim() || !!newPhoto, '오브젝트 보고 검토 중');
  async function review(status: string) { setBusy(true); setError(''); try { await objectReportPost(scriptUrl, 'reviewObjectReport', { id: r.id, status, note, registrationKind: registration, targetItemId: effectiveTarget, targetVariantId: variantId, registrationConfirmed: confirmed }); setNote(''); await onChanged(); changed(); } catch (e: any) { setError(e.message || '처리하지 못했습니다.'); } finally { setBusy(false); } }
  const canReview = ['pending', 'completed', 'acknowledged', 'approved'].includes(r.status);
  return <article><ReportSummary r={r} C={C} />{canReview ? <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
    <label style={label}>검토 사유와 작업 범위 또는 조치 내용 필수<textarea value={note} maxLength={3000} onChange={e => setNote(e.target.value)} style={{ ...field(C), minHeight: 90, resize: 'vertical' }} /></label>
    {['completed', 'acknowledged'].includes(r.status) ? <>
      <label style={label}>완료 후 등록 방식<select disabled={busy || reading || !!registeredTarget} style={field(C)} value={registration} onChange={e => { setRegistration(e.target.value); setConfirmed(false); setTargetId(''); }}>{r.kind === 'damage' ? <option value="none">추가 등록 없이 조치 종료</option> : null}<option value="restored">원상복구 후 기존 오브젝트 유지</option><option value="variant">같은 오브젝트의 다른 종류로 등록</option><option value="new_object">별도 오브젝트로 등록</option></select></label>
      {registration !== 'none' ? <p style={{ fontSize: 11.5, color: C.label, lineHeight: 1.7 }}>실제 상태 사진과 원본·대상 수량을 확인한 뒤 연결하세요. 새 오브젝트는 이 화면에서 Scenario Manager에 등록하며, ID는 자동으로 부여됩니다.</p> : null}
      {registration === 'new_object' ? <div style={{ marginBottom: 14 }}>
        {effectiveTarget ? <div role="status" style={{ padding: 12, borderRadius: 10, background: C.accentSoft, color: C.accentText, fontSize: 12 }}>Scenario Manager 등록 완료 · ID {effectiveTarget}</div> : <>
          <label style={label}>새 오브젝트 이름<input style={field(C)} value={newName} disabled={busy} onChange={e => setNewName(e.target.value)} maxLength={200} /></label>
          <label style={label}>등록 지역<select style={field(C)} value={sector} disabled={busy} onChange={e => setSector(e.target.value)}><option value="Seoul">Seoul</option><option value="Hanoi">Hanoi</option></select></label>
          <label style={label}>보관 위치<input style={field(C)} value={rootSlot} disabled={busy} onChange={e => setRootSlot(e.target.value)} placeholder="6자리 위치 번호 (미입력 시 미지정)" /></label>
          <div style={{ display: 'flex', gap: 10 }}><label style={{ ...label, flex: 1 }}>크기<select style={field(C)} value={size} disabled={busy} onChange={e => setSize(e.target.value)}>{['Extra-Small', 'Small', 'Medium', 'Large'].map(v => <option key={v}>{v}</option>)}</select></label><label style={{ ...label, flex: 1 }}>속성<select style={field(C)} value={property} disabled={busy} onChange={e => setProperty(e.target.value)}>{['Soft', 'Hard', 'Deformable', 'Fragile'].map(v => <option key={v}>{v}</option>)}</select></label></div>
          <PhotoInput C={C} value={newPhoto} onChange={setNewPhoto} onError={setError} onReading={setReading} />
          <p style={{ fontSize: 11.5, color: C.label, lineHeight: 1.7 }}>중복 재고를 막기 위해 새 물품은 재고 0개로 등록합니다. 실물 반납 후 원본과 새 물품의 수량을 정리하고 아래 확인란을 선택하세요.</p>
          <button type="button" style={{ ...btn(C), width: '100%', color: C.accentText }} disabled={busy || reading || !newPhoto || !newName.trim()} onClick={() => void registerNewObject()}>{busy ? 'Scenario Manager 등록 중…' : 'Scenario Manager에 새 오브젝트 등록'}</button>
        </>}
      </div> : null}
      {registration === 'variant' ? <label style={label}>등록한 종류<select style={field(C)} value={variantId} onChange={e => setVariantId(e.target.value)}><option value="">종류 선택</option>{(registrationItems.find(i => i.id === r.item_id)?.variants || []).map((v: any) => <option key={v.id} value={v.id}>{v.name} · 종류 ID {v.id}</option>)}</select></label> : null}
      {registration !== 'none' ? <label style={{ ...label, fontSize: 12, lineHeight: 1.7, fontWeight: 400 }}><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} style={{ accentColor: C.accent, marginRight: 6 }} />실제 상태 사진과 등록 및 재고 수량 반영을 확인했습니다</label> : null}
    </> : null}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {r.status === 'pending' ? <><button type="button" style={{ ...btn(C), flex: 1, background: C.accent, borderColor: C.accent, color: '#fff', opacity: busy || !note.trim() ? .5 : 1 }} disabled={busy || reading || !note.trim()} onClick={() => void review(r.kind === 'damage' ? 'acknowledged' : 'approved')}><Check size={14} />{r.kind === 'damage' ? '파손 신고 확인' : '변형 승인'}</button><button type="button" style={{ ...btn(C), color: C.error }} disabled={busy || reading || !note.trim()} onClick={() => void review('rejected')}>반려</button></> : null}
      {r.status === 'approved' && r.kind === 'modification' ? <button type="button" style={btn(C)} disabled={busy || reading || !note.trim()} onClick={() => void review('rejected')}>작업 전 승인 취소</button> : null}
      {['acknowledged', 'completed'].includes(r.status) ? <button type="button" style={{ ...btn(C), width: '100%', background: C.accent, borderColor: C.accent, color: '#fff', opacity: busy || !note.trim() || !targetReady ? .5 : 1 }} disabled={busy || reading || !note.trim() || !targetReady} onClick={() => void review('closed')}>{r.status === 'completed' ? '등록 연결 후 완료 확인' : '조치 기록 후 종료'}</button> : null}
    </div></div> : null}{error ? <p role="alert" style={{ fontSize: 12, color: C.error }}>{error}</p> : null}</article>;
}
export default function AdminObjectReports({ scriptUrl, isLightMode, isMobile = false }: { scriptUrl: string; isLightMode: boolean; isMobile?: boolean }) {
  const C = palette(isLightMode);
  const [items, setItems] = useState<any[]>([]), [decisions, setDecisions] = useState<any[]>([]), [registrationItems, setRegistrationItems] = useState<any[]>([]), [filter, setFilter] = useState('waiting'), [search, setSearch] = useState(''), [selectedId, setSelectedId] = useState<number | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const inFlight = useRef(false), mounted = useRef(false);
  const refresh = useCallback(async () => { if (inFlight.current) return; inFlight.current = true; try { const d = await objectReportGet(scriptUrl, true); if (mounted.current) { setItems(d.items || []); setDecisions(d.decisions || []); setRegistrationItems(d.registrationItems || []); setError(''); } } catch (e: any) { if (mounted.current) setError(e.message || '목록을 불러오지 못했습니다.'); } finally { inFlight.current = false; if (mounted.current) setLoading(false); } }, [scriptUrl]);
  useEffect(() => { mounted.current = true; void refresh(); const id = window.setInterval(() => { if (!document.hidden) void refresh(); }, 15000); return () => { mounted.current = false; window.clearInterval(id); }; }, [refresh]);
  const selected = items.find(r => r.id === selectedId), query = search.trim().toLocaleLowerCase();
  const visible = items.filter(r => (filter === 'all' || (filter === 'waiting' ? ['pending', 'completed'].includes(r.status) : r.kind === filter)) && [r.item_name, r.item_id, r.borrower_name, r.employee_id].some(s => String(s || '').toLocaleLowerCase().includes(query)));
  const pending = items.filter(r => ['pending', 'completed'].includes(r.status)).length;
  const details = selected ? <AdminReport key={selected.id} r={selected} C={C} scriptUrl={scriptUrl} onChanged={refresh} registrationItems={registrationItems} /> : null;
  return <section aria-label="변형 요청 및 파손 신고 관리" style={{ display: 'flex', flex: 1, width: '100%', minWidth: 0, minHeight: 0, height: '100%', background: C.bg, color: C.text }}>
    <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: isMobile ? 14 : 20 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}><ClipboardList size={19} color={C.accentText} /><h1 style={{ flex: 1, margin: 0, fontSize: 18, fontWeight: 800 }}>변형 요청 및 파손 신고</h1><button type="button" aria-label="변형 및 파손 새로고침" disabled={loading} onClick={() => void refresh()} style={{ ...btn(C), color: C.accentText }}><RotateCcw size={14} /></button></div>
      <div role="tablist" aria-label="보고 유형" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>{[['waiting', '확인 대기'], ['modification', '변형 요청'], ['damage', '파손 신고'], ['all', '전체 이력']].map(([id, text]) => <button key={id} type="button" role="tab" aria-selected={filter === id} onClick={() => setFilter(id)} style={{ ...btn(C), flex: 1, whiteSpace: 'nowrap', background: filter === id ? C.accent : C.card, borderColor: filter === id ? C.accent : C.border, color: filter === id ? '#fff' : C.label }}>{text}{id === 'waiting' && pending > 0 ? <span style={{ fontSize: 11, opacity: .85 }}>{pending}</span> : null}</button>)}</div>
      <div style={{ position: 'relative', marginBottom: 10 }}><Search size={15} color={C.label} style={{ position: 'absolute', left: 12, top: 13 }} /><input aria-label="변형 및 파손 보고 검색" placeholder="이름 · 사번 · 물품 · ID 검색" value={search} onChange={e => setSearch(e.target.value)} style={{ ...field(C), marginTop: 0, paddingLeft: 36 }} /></div>
      <p style={{ fontSize: 11.5, color: C.label, lineHeight: 1.7, margin: '0 0 14px' }}>보고를 선택해 사진과 내용을 확인합니다. 파손 신고 접수만으로 반납·재고 처리가 완료되지는 않습니다.<br />{visible.length}건 · 15초마다 자동 새로고침</p>
      {error ? <p role="alert" style={{ fontSize: 12, color: C.error }}>{error}</p> : null}
      {loading ? <p role="status" style={{ textAlign: 'center', padding: 36, color: C.label, fontSize: 13 }}>불러오는 중…</p> : !visible.length ? <div className="wms-empty-state" style={{ padding: '48px 0', textAlign: 'center', color: C.label, fontSize: 13 }}><ClipboardList size={36} style={{ opacity: .35, marginBottom: 12 }} /><div>해당 보고 건이 없습니다.</div></div> : visible.map(r => <button key={r.id} type="button" aria-label={`보고 #${r.id} ${r.item_name} 상세 보기`} aria-pressed={selectedId === r.id} onClick={() => setSelectedId(r.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: 13, marginBottom: 8, borderRadius: 12, border: `1.5px solid ${selectedId === r.id ? C.accent : C.border}`, background: selectedId === r.id ? C.accentSoft : C.card, color: C.text, cursor: 'pointer' }}>
        <span style={{ width: 32, height: 32, borderRadius: 9, background: r.kind === 'damage' ? C.warnSoft : C.accentSoft, color: r.kind === 'damage' ? C.warn : C.accentText, display: 'grid', placeItems: 'center', flexShrink: 0 }}>{r.kind === 'damage' ? <AlertTriangle size={16} /> : <Wrench size={16} />}</span>
        <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: 'block', fontSize: 13, fontWeight: 700, overflowWrap: 'anywhere' }}>{r.item_name}</span><span style={{ display: 'block', color: C.label, fontSize: 11, lineHeight: 1.65, marginTop: 3 }}>{r.kind === 'damage' ? '파손 신고' : '변형 요청'} · {r.borrower_name} · {r.quantity}개<br />{r.created_at}</span></span><Status r={r} C={C} /><ChevronRight size={14} color={C.label} />
      </button>)}
      <details style={{ borderTop: `1px solid ${C.border}`, marginTop: 20, paddingTop: 14, color: C.label, fontSize: 11.5 }}><summary style={{ cursor: 'pointer' }}>파손 반납 및 페널티 이력 {decisions.length}건</summary>{decisions.map(d => <div key={d.id} style={{ fontSize: 12, lineHeight: 1.7, padding: '10px 0', borderBottom: `1px solid ${C.border}` }}>{d.borrower_name} · 파손 {d.quantity}개 / 사전 신고 {d.reported_qty}개<br />{d.penalty_id ? '5종 차감 · 14일' : d.exempt ? `관리자 면제 · ${d.exemption_reason}` : '사전 신고 확인'}<br />{d.occurred_at} · {d.manager}</div>)}</details>
    </div>
    {!isMobile ? <aside aria-label="보고 상세" style={{ flex: '0 0 min(46%,500px)', minWidth: 0, overflowY: 'auto', background: C.card, borderLeft: `1px solid ${C.border}`, padding: 20 }}>{details || <div className="wms-empty-state" style={{ color: C.label, fontSize: 13, textAlign: 'center', paddingTop: 70 }}><ClipboardList size={32} style={{ opacity: .35, marginBottom: 12 }} /><div>왼쪽에서 보고를 선택해주세요.</div></div>}</aside> : selected ? <ReportDialog C={C} title="보고 상세" onClose={() => setSelectedId(null)}>{details}</ReportDialog> : null}
  </section>;
}
export function DamageReportEvidence({ scriptUrl, lines, isLightMode = false }: { scriptUrl: string; lines: { sheetType: string; rowIndex: number }[]; isLightMode?: boolean }) {
  const C = palette(isLightMode);
  const [reports, setReports] = useState<any[]>([]), [error, setError] = useState(''), [loaded, setLoaded] = useState(false);
  const keys = lines.map(ln => `${ln.sheetType}:${ln.rowIndex}`).join(',');
  useEffect(() => { let alive = true; objectReportGet(scriptUrl, true).then(d => { if (alive) { setReports(d.items || []); setLoaded(true); } }).catch(e => { if (alive) setError(e.message); }); return () => { alive = false; }; }, [scriptUrl, keys]);
  const relevant = reports.filter(r => r.kind === 'damage' && r.status !== 'rejected' && keys.split(',').includes(`${r.sheet_type}:${r.rental_row_id}`) && r.quantity > r.consumed_qty);
  return <div style={{ padding: '12px 14px', border: `1px solid ${C.border}`, borderRadius: 10, background: C.cardSub, color: C.text, fontSize: 12, lineHeight: 1.6 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <strong style={{ flex: 1 }}>사전 파손 신고 증빙</strong>
      {loaded && !error && <span style={{ color: relevant.length ? C.accentText : C.label, fontSize: 11, fontWeight: 700 }}>{relevant.length ? `${relevant.length}건 확인` : '신고 내역 없음'}</span>}
    </div>
    {error ? <p role="alert" style={{ margin: '8px 0 0', color: C.error }}>조회 실패: {error} · 처리 시 신고 여부를 다시 확인합니다.</p> : !loaded ? <p role="status" style={{ margin: '8px 0 0', color: C.label }}>신고 기록을 확인하고 있습니다…</p> : !relevant.length ? <p style={{ margin: '8px 0 0', color: C.label }}>이 대여 건에 적용할 수 있는 사전 신고가 없습니다.</p> : relevant.map(r => <details key={r.id} style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
      <summary style={{ cursor: 'pointer', overflowWrap: 'anywhere' }}>{r.item_name} · 신고 잔여 {r.quantity - r.consumed_qty}개</summary>
      <div style={{ color: C.label, marginTop: 6, fontSize: 11 }}>{r.created_at}</div>
      <p style={{ margin: '6px 0', overflowWrap: 'anywhere' }}>{r.reason}</p>
      <a href={r.image_path} target="_blank" rel="noreferrer" style={{ color: C.accentText, fontWeight: 700 }}>접수 사진 보기 ↗</a>
    </details>)}
    <p style={{ margin: '8px 0 0', fontSize: 11, color: C.label }}>같은 대여 건의 사진 첨부 신고 수량을 자동 확인합니다.</p>
  </div>;
}
