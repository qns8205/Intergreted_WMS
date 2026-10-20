import { useEffect, useState } from 'react';
import { fetchAdminRentalNotifications } from './borrowApi';

export const RENTAL_NOTIFICATIONS_CHANGED = 'wms:rental-notifications-changed';
export type AdminRentalCounts = { pickup: number; reservations: number; photoReviews: number; objectReports?: number };
export function rentalBadge(counts: AdminRentalCounts, view: string): string {
  if (view === 'adminReturn') return counts.pickup ? String(counts.pickup) : '';
  if (view === 'adminReservations') return counts.reservations ? String(counts.reservations) : '';
  if (view === 'rental') return counts.pickup || counts.reservations ? `${counts.pickup}+${counts.reservations}` : '';
  if (view === 'objectReports') return counts.objectReports ? String(counts.objectReports) : '';
  if (view === 'returnPhotos') return counts.photoReviews ? String(counts.photoReviews) : '';
  if (view === 'items') return counts.photoReviews || counts.objectReports ? String(counts.photoReviews + (counts.objectReports || 0)) : '';
  return '';
}

export function useAdminRentalNotifications(enabled: boolean, scriptUrl: string, refreshKey: string) {
  const [counts, setCounts] = useState<AdminRentalCounts>({ pickup: 0, reservations: 0, photoReviews: 0 });
  useEffect(() => {
    if (!enabled) { setCounts({ pickup: 0, reservations: 0, photoReviews: 0 }); return; }
    let alive = true, inFlight = false, again = false;
    async function refresh() {
      if (!alive || document.hidden) return;
      if (inFlight) { again = true; return; }
      inFlight = true;
      try {
        const next = await fetchAdminRentalNotifications(scriptUrl);
        if (alive) setCounts(next);
      } catch { /* 통신 실패로 기존 건수를 0으로 만들지 않는다. 다음 조회 때 재시도한다. */ }
      finally {
        inFlight = false;
        if (again && alive) { again = false; void refresh(); }
      }
    }
    void refresh();
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener(RENTAL_NOTIFICATIONS_CHANGED, refresh);
    return () => {
      alive = false; window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener(RENTAL_NOTIFICATIONS_CHANGED, refresh);
    };
  }, [enabled, scriptUrl, refreshKey]);
  return counts;
}
