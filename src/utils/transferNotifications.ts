import { useEffect, useState } from 'react';
import { adminHeaders } from './adminAuth';

export const TRANSFER_NOTIFICATIONS_CHANGED = 'wms:transfer-notifications-changed';
export interface TransferNotice {
  id: number; timestamp: string; fromName: string; fromEmployeeId: string;
  toName: string; toEmployeeId: string; floor: string; unit: string; read: boolean;
  items: { kind: string; itemId: string; name: string; variantName: string; quantity: number }[];
}
export async function transferNotificationRequest(path: string, ids?: number[]) {
  const response = await fetch(`/api/admin/transfer-notifications${path}`, {
    method: ids ? 'POST' : 'GET', cache: 'no-store',
    headers: adminHeaders(ids ? { 'Content-Type': 'application/json' } : undefined),
    ...(ids ? { body: JSON.stringify({ ids }) } : {}),
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw Error(result.error || '양도 알림을 불러오지 못했습니다.');
  return result;
}
export function useTransferNotificationCount(enabled: boolean) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) { setCount(0); return; }
    let alive = true, busy = false;
    const refresh = async () => {
      if (document.hidden || busy) return;
      busy = true;
      try { const result = await transferNotificationRequest('/count'); if (alive) setCount(result.unread); }
      catch { /* 다음 조회 때 재시도한다. */ }
      finally { busy = false; }
    };
    void refresh();
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener(TRANSFER_NOTIFICATIONS_CHANGED, refresh);
    return () => {
      alive = false; clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener(TRANSFER_NOTIFICATIONS_CHANGED, refresh);
    };
  }, [enabled]);
  return count;
}
