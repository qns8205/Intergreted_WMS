import { all, get } from '../db.js';
import { photoReviewCounts } from './photoReviewCounts.js';

/** 사진·물품 상세·전체 이력 없이 진행 중인 신청 묶음만 집계한다. */
export function adminRentalNotifications() {
  const pending = all(`SELECT 'sid' AS source,id,request_no,batch_id,employee_id,email,borrower_name,applied_at,borrow_date
    FROM sid_rentals WHERE COALESCE(returned,'X')!='O' AND picked_up_at IS NULL
    UNION ALL
    SELECT 'general',id,request_no,batch_id,employee_id,email,borrower_name,applied_at,borrow_date
    FROM general_rentals WHERE COALESCE(returned,'X')!='O' AND picked_up_at IS NULL`);
  const pickupKeys = new Set(pending.map(row => {
    if (Number(row.request_no)>0) return `request:${row.request_no}`;
    const person = row.employee_id || row.email || row.borrower_name || '';
    if (row.batch_id) return JSON.stringify(['batch',person,row.batch_id]);
    // 신청 번호가 없던 과거 기록은 동일 사람·신청 시각으로 묶는다.
    const at = row.applied_at || row.borrow_date;
    return at ? JSON.stringify(['legacy',person,at]) : `${row.source}:${row.id}`;
  }));
  const bookings = all(`SELECT DISTINCT r.employee_id,r.client_id FROM item_reservations r
    WHERE r.status='reserved' OR (r.status='fulfilled' AND EXISTS (
      SELECT 1 FROM general_rentals p WHERE p.request_no=r.request_no AND p.employee_id=r.employee_id
      AND p.item_id=r.item_id AND COALESCE(p.variant_id,0)=r.variant_id
      AND p.status='active' AND COALESCE(p.returned,'X')!='O' AND p.picked_up_at IS NULL
    ))`);
  const photos = photoReviewCounts();
  const objectReports = Number(get("SELECT COUNT(*) AS n FROM object_reports WHERE status IN ('pending','completed')").n);
  return { pickup: pickupKeys.size, reservations: bookings.length, photoReviews: photos.return + photos.pickup + photos.tool, objectReports };
}
