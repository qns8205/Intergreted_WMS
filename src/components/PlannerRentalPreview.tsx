import React from 'react';
import type { PlannerRentalContext } from '../utils/borrowApi';

export default function PlannerRentalPreview({ plans, expanded, color, border }: {
  plans: PlannerRentalContext[]; expanded: boolean; color: string; border: string;
}) {
  const upcoming = plans.filter((p) => p.nextRoutine);
  if (!upcoming.length) return null;
  return <div aria-label="다음 촬영 루틴 미리보기" style={{ margin: '0 14px 10px', padding: '9px 11px', border: `1px dashed ${border}`, borderRadius: 9, color, opacity: 0.8, fontSize: 11.5 }}>
    {upcoming.map((p) => {
      const next = p.nextRoutine!;
      const newTypes = new Set(next.items.filter((i) => i.quantity > 0).map((i) => i.id)).size;
      return <section key={p.planId} style={{ marginTop: upcoming.length > 1 ? 5 : 0 }}>
        <div style={{ display: 'flex', gap: '5px 8px', flexWrap: 'wrap', overflowWrap: 'anywhere' }}>
          <b>다음 루틴 {next.number}</b><span>신청 전 · 미리보기</span>
          <span>{p.collectionName} · 촬영 {next.shotCount}건 · 새로 대여 {newTypes}종</span>
        </div>
        {expanded ? <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 8 }}>
          {next.items.map((item, i) => <div key={`${item.id}:${i}`} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{item.name}{item.variantName ? ` · ${item.variantName}` : ''}
              <small style={{ marginLeft: 7 }}>{item.location || item.id}</small>
            </span>
            <span style={{ flexShrink: 0 }}>{[item.quantity > 0 ? `대여 예정 ${item.quantity}개` : '', item.keptQuantity > 0 ? `계속 사용 ${item.keptQuantity}개` : ''].filter(Boolean).join(' · ')}</span>
          </div>)}
          {!newTypes ? <span>새로 대여할 물품 없음{next.items.length ? ' · 보유 물품으로 진행' : ''}</span> : null}
          <small>계획 기준 수량이며, 신청 시 종류와 여분 선택에 따라 달라질 수 있습니다.</small>
        </div> : null}
      </section>;
    })}
  </div>;
}
