import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRightLeft, ArrowRight, CheckCheck, RefreshCw, Package, Search, ChevronRight } from 'lucide-react';
import { TransferNotice, transferNotificationRequest, TRANSFER_NOTIFICATIONS_CHANGED } from '../utils/transferNotifications';

export default function TransferNotificationsPage({ isLightMode, isMobile = false }: { isLightMode: boolean; isMobile?: boolean }) {
  const [filter, setFilter] = useState<'all' | 'unread'>('unread');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [entries, setEntries] = useState<TransferNotice[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const inFlight = useRef(false);
  const load = useCallback(async (before?: number) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      const data = await transferNotificationRequest(before ? `?before=${before}` : '');
      if (!alive.current) return;
      setEntries(prev => before ? [...prev, ...data.entries] : data.entries);
      setNextBefore(data.nextBefore); setError('');
      window.dispatchEvent(new Event(TRANSFER_NOTIFICATIONS_CHANGED));
    } catch (e) { if (alive.current) setError((e as Error).message); }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }, []);
  useEffect(() => {
    alive.current = true; void load();
    // 자동 갱신 시 최신 양도부터 다시 표시한다.
    const refresh = () => { if (!document.hidden) void load(); };
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => { alive.current = false; clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [load]);
  async function markRead(ids: number[]) {
    if (!ids.length || inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      for (let offset = 0; offset < ids.length; offset += 100) await transferNotificationRequest('/read', ids.slice(offset, offset + 100));
      if (alive.current) { setEntries(prev => prev.map(e => ids.includes(e.id) ? { ...e, read: true } : e)); setError(''); }
      window.dispatchEvent(new Event(TRANSFER_NOTIFICATIONS_CHANGED));
    } catch (e) { if (alive.current) setError((e as Error).message); }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }
  const C = {
    bg: isLightMode ? '#f8fafc' : '#0b0f19', card: isLightMode ? '#ffffff' : '#161f30',
    sub: isLightMode ? '#f4f6f9' : '#0f172a', text: isLightMode ? '#111827' : '#f1f5f9',
    label: isLightMode ? '#64748b' : '#94a3b8', border: isLightMode ? '#e6e9ef' : '#26324a',
    accent: '#2563eb', accentText: isLightMode ? '#1d4ed8' : '#93c5fd',
    accentSoft: isLightMode ? 'rgba(37,99,235,0.09)' : 'rgba(37,99,235,0.16)',
    error: isLightMode ? '#dc2626' : '#f87171',
  };
  const unread = entries.filter(entry => !entry.read);
  const query = search.trim().toLocaleLowerCase();
  const visible = entries.filter(entry => (filter === 'all' || !entry.read) &&
    [entry.fromName, entry.fromEmployeeId, entry.toName, entry.toEmployeeId, entry.floor, entry.unit, ...entry.items.flatMap(item => [item.name, item.itemId, item.variantName])].some(value => value.toLocaleLowerCase().includes(query)));
  const selected = visible.find(entry => entry.id === selectedId);
  const button: React.CSSProperties = { border: '1px solid ' + C.border, borderRadius: 8, padding: '9px 12px', background: C.card, color: C.text, cursor: busy ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, font: 'inherit', fontSize: 12, fontWeight: 700 };
  const detail = (entry: TransferNotice) => <>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
      <span style={{ fontSize: 14, fontWeight: 800, flex: 1 }}>양도 상세</span>
      <span style={{ fontSize: 10.5, fontWeight: 800, color: entry.read ? C.label : C.accentText, background: entry.read ? C.sub : C.accentSoft, padding: '3px 8px', borderRadius: 999 }}>{entry.read ? '확인 완료' : '미확인'}</span>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 20px 1fr', alignItems: 'center', gap: 12, padding: '16px 0', borderTop: '1px solid ' + C.border, borderBottom: '1px solid ' + C.border }}>
      {([['넘긴 사람',entry.fromName,entry.fromEmployeeId],['받는 사람',entry.toName,entry.toEmployeeId]] as const).map(([label,name,id],index) => <React.Fragment key={label}>
        {index === 1 && <ArrowRight size={16} color={C.label} />}
        <div style={{ minWidth: 0 }}><div style={{ fontSize: 11, color: C.label, marginBottom: 7 }}>{label}</div><div style={{ fontSize: 15, fontWeight: 800, overflowWrap: 'anywhere' }}>{name}</div><div style={{ fontSize: 11, color: C.label, marginTop: 4 }}>{id}</div></div>
      </React.Fragment>)}
    </div>
    <dl style={{ display: 'grid', gridTemplateColumns: '76px 1fr', gap: '10px 8px', margin: '18px 0 24px', fontSize: 12, lineHeight: 1.6 }}>
      <dt style={{ color: C.label }}>양도 일시</dt><dd style={{ margin: 0 }}>{entry.timestamp}</dd>
      <dt style={{ color: C.label }}>받는 위치</dt><dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{[entry.floor,entry.unit].filter(Boolean).join(' / ') || '등록된 위치 없음'}</dd>
    </dl>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 12, fontWeight: 800 }}><Package size={14} color={C.label} />양도 물품 <span style={{ color: C.label, fontWeight: 500 }}>{entry.items.length}종</span></div>
    <div>{entry.items.map((item,index) => <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0', borderBottom: '1px solid ' + C.border }}>
      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 700, overflowWrap: 'anywhere' }}>{item.name}</div><div style={{ marginTop: 4, color: C.label, fontSize: 11, lineHeight: 1.6 }}>{[item.kind === 'warehouse' ? 'COS 물품' : '시나리오 물품', item.itemId ? 'ID ' + item.itemId : '', item.variantName].filter(Boolean).join(' · ')}</div></div>
      <strong style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{item.quantity}개</strong>
    </div>)}</div>
    {!entry.read && <button type="button" disabled={busy} style={{ ...button, width: '100%', marginTop: 20, background: C.accent, borderColor: C.accent, color: '#fff', opacity: busy ? .5 : 1 }} onClick={() => void markRead([entry.id])}><CheckCheck size={15} /> 확인 완료로 표시</button>}
  </>;
  return <section aria-label="양도 알림 관리" style={{ display: 'flex', flex: 1, width: '100%', minWidth: 0, minHeight: 0, height: '100%', background: C.bg, color: C.text }}>
    <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: isMobile ? '14px 12px' : 20 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <ArrowRightLeft size={19} color={C.accentText} /><h1 style={{ flex: 1, margin: 0, fontSize: 18, fontWeight: 800 }}>양도 알림</h1>
        <button type="button" disabled={busy} style={{ ...button, color: C.accentText, opacity: busy ? .5 : 1 }} aria-label="양도 알림 새로고침" title="새로고침" onClick={() => void load()}><RefreshCw size={14} /></button>
      </div>
      <div role="group" aria-label="양도 알림 필터" style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {([['unread','미확인',unread.length],['all','전체',entries.length]] as const).map(([value,label,count]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} style={{ flex: 1, padding: '10px 8px', borderRadius: 10, cursor: 'pointer', fontSize: 12.5, fontWeight: 800, border: '1px solid ' + (filter === value ? C.accent : C.border), background: filter === value ? C.accent : C.card, color: filter === value ? '#fff' : C.label, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>{label}<span style={{ fontSize: 11, opacity: .8 }}>{count}</span></button>)}
      </div>
      <div style={{ position: 'relative', marginBottom: 10 }}>
        <Search size={15} color={C.label} style={{ position: 'absolute', top: '50%', left: 12, transform: 'translateY(-50%)', pointerEvents: 'none' }} />
        <input aria-label="양도 알림 검색" value={search} onChange={event => setSearch(event.target.value)} placeholder="이름 · 사번 · 물품 검색" style={{ width: '100%', boxSizing: 'border-box', border: '1px solid ' + C.border, borderRadius: 9, padding: '10px 12px 10px 36px', color: C.text, background: C.sub, fontSize: 12.5, outline: 'none' }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, minHeight: 28 }}>
        <span style={{ color: C.label, fontSize: 11, flex: 1 }}>최근 내역부터 표시 · 30초마다 갱신</span>
        <button type="button" disabled={busy || !visible.some(entry => !entry.read)} onClick={() => void markRead(visible.filter(entry => !entry.read).map(entry => entry.id))} style={{ border: 0, background: 'transparent', color: C.label, fontSize: 11, padding: '5px 0 5px 8px', display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer', opacity: busy || !visible.some(entry => !entry.read) ? .4 : 1 }}><CheckCheck size={13} />목록 모두 확인</button>
      </div>
      {error && <div role="alert" style={{ marginBottom: 12, padding: 12, color: C.error, background: C.card, border: '1px solid ' + C.border, borderRadius: 9, fontSize: 12 }}>{error}</div>}
      {!visible.length && !error && <div role="status" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '58px 12px', color: C.label, fontSize: 12 }}><ArrowRightLeft size={32} style={{ opacity: .3, marginBottom: 12 }} /><div>{busy ? '불러오는 중…' : search ? '검색 결과가 없습니다.' : filter === 'unread' ? '미확인 양도가 없습니다.' : '아직 양도 내역이 없습니다.'}</div></div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {visible.map(entry => <div key={entry.id} style={{ border: '1px solid ' + (selectedId === entry.id ? C.accent : C.border), borderRadius: 10, background: C.card, overflow: 'hidden' }}>
          <button type="button" aria-pressed={selectedId === entry.id} aria-label={entry.fromName + ' → ' + entry.toName + ' 양도 상세'} onClick={() => setSelectedId(id => isMobile && id === entry.id ? null : entry.id)} style={{ width: '100%', border: 0, background: selectedId === entry.id ? C.accentSoft : 'transparent', color: C.text, textAlign: 'left', padding: '13px 12px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <span style={{ width: 6, height: 6, flexShrink: 0, borderRadius: 999, background: entry.read ? C.border : C.accent }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, fontSize: 13, fontWeight: 800, overflowWrap: 'anywhere' }}>{entry.fromName}<ArrowRight size={13} color={C.label} />{entry.toName}</span>
              <span style={{ display: 'block', fontSize: 11.5, marginTop: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: C.label }}>{entry.items.map(item => item.name).join(', ') || '물품 정보 없음'}</span>
              <span style={{ display: 'block', fontSize: 10.5, color: C.label, marginTop: 4 }}>{entry.timestamp.slice(0,16)} · {entry.items.length}종 · {entry.items.reduce((sum,item) => sum + item.quantity,0)}개</span>
            </span>
            <span style={{ fontSize: 10.5, color: entry.read ? C.label : C.accentText, fontWeight: 700, flexShrink: 0 }}>{entry.read ? '확인' : '미확인'}</span>
            <ChevronRight size={14} color={C.label} style={{ flexShrink: 0, transform: isMobile && selectedId === entry.id ? 'rotate(90deg)' : undefined }} />
          </button>
          {isMobile && selectedId === entry.id && <div style={{ padding: 14, borderTop: '1px solid ' + C.border }}>{detail(entry)}</div>}
        </div>)}
      </div>
      {nextBefore && <button type="button" disabled={busy} style={{ ...button, width: '100%', marginTop: 12 }} onClick={() => void load(nextBefore)}>이전 양도 더 보기</button>}
    </div>
    {!isMobile && <aside aria-label="양도 상세" style={{ flex: '0 0 min(42%,460px)', minWidth: 0, overflowY: 'auto', background: C.card, borderLeft: '1px solid ' + C.border, padding: 20 }}>
      {selected ? detail(selected) : <div style={{ paddingTop: 70, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', color: C.label, fontSize: 12 }}><ArrowRightLeft size={32} style={{ opacity: .3, marginBottom: 12 }} /><div>왼쪽에서 양도 내역을 선택해주세요.</div></div>}
    </aside>}
  </section>;
}
