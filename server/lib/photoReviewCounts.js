import { get } from '../db.js';

/** 사진 화면과 사이드바가 같은 기준으로 집계한다. 사진 내용은 읽지 않는다. */
export function photoReviewCounts() {
  const count = (table, kind, condition) => Number(get(`SELECT COUNT(*) AS n FROM ${table} p
    WHERE p.image_path IS NOT NULL AND p.image_path != '' ${condition}
    AND NOT EXISTS (SELECT 1 FROM photo_reviews r WHERE r.kind = ? AND r.photo_id = p.id)`, [kind]).n);
  return {
    return: count('return_photos', 'return', "AND p.source='unattended'"),
    pickup: count('unattended_pickup_photos', 'pickup', ''),
    tool: count('warehouse_manual_requests', 'tool', ''),
  };
}
