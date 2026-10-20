import { get, run, transaction } from '../db.js';
import { kstTimestamp, rentalDeadlineMs } from '../../shared/rentalTerms.js';

// 신청에 저장하므로 부분 수령·부분 반납으로 행이 갈라져도 사유와 예정일을 유지한다.
export function rentalTermsForRow(row) {
  const request = row.request_no ? get('SELECT rental_mode,rental_reason,rental_due_date,rental_general_since,rental_review_reason,rental_reviewed_by FROM rental_requests WHERE id=?',[row.request_no]) : null;
  if (!request?.rental_mode) return undefined; // 이전 대여에 소급하지 않는다.
  const deadline = rentalDeadlineMs(row.picked_up_at,request.rental_general_since);
  return { mode: request.rental_mode, reason: request.rental_reason || '', dueDate: request.rental_due_date || '',
    reviewReason:request.rental_review_reason || '',reviewedBy:request.rental_reviewed_by || '',generalSince:request.rental_general_since || '',
    deadlineAt: request.rental_mode === 'general' && Number.isFinite(deadline) ? kstTimestamp(deadline) : '' };
}

export function convertRentalToGeneral({payload,admin}, now=Date.now()) {
  if (!admin) throw Error('관리자만 대여 방식을 변경할 수 있습니다.');
  const requestNo=Number(payload?.requestNo), reason=String(payload?.reason || '').trim();
  if (!Number.isSafeInteger(requestNo) || requestNo<=0) throw Error('신청 번호를 확인해주세요.');
  if (!reason || reason.length>2000) throw Error('일반 대여 변경 사유를 1~2,000자로 입력해주세요.');
  return transaction(()=>{
    const request=get('SELECT * FROM rental_requests WHERE id=?',[requestNo]);
    if (!request) throw Error('대여 신청을 찾을 수 없습니다.');
    if (request.rental_mode==='general') return {changed:false,message:'이미 일반 대여입니다. 기존 반납 기한을 유지합니다.'};
    if (!['reason','long_term'].includes(request.rental_mode)) throw Error('사유 대여와 장기대여만 일반 대여로 변경할 수 있습니다.');
    const active=['sid_rentals','general_rentals'].some(table=>get(`SELECT 1 FROM ${table} WHERE request_no=? AND COALESCE(returned,'X')!='O' AND status='active' LIMIT 1`,[requestNo]));
    if (!active) throw Error('이미 종료된 신청은 변경할 수 없습니다.');
    const at=kstTimestamp(now), actor=String(admin.name || admin.loginId || admin.id || '관리자');
    run('INSERT OR REPLACE INTO rental_terms_reviews(request_no,previous_mode,previous_reason,previous_due_date,review_reason,reviewed_by,reviewed_at) VALUES (?,?,?,?,?,?,?)',
      [requestNo,request.rental_mode,request.rental_reason,request.rental_due_date,reason,actor,at]);
    run("UPDATE rental_requests SET rental_mode='general',rental_due_date=NULL,rental_general_since=?,rental_review_reason=?,rental_reviewed_by=? WHERE id=?",[at,reason,actor,requestNo]);
    // 신청 사유로 자동 부여한 Request 한도 제외만 해제한다. 별도로 지정한 한도 제외는 유지한다.
    for (const table of ['sid_rentals','general_rentals']) run(`UPDATE ${table} SET type_limit_exempt=NULL,type_limit_exempt_reason=NULL
      WHERE request_no=? AND COALESCE(returned,'X')!='O' AND type_limit_exempt='Y' AND type_limit_exempt_reason=?`,[requestNo,request.rental_reason]);
    return {changed:true,message:'신청 전체를 일반 대여로 변경했습니다. 이미 수령한 물품은 지금부터, 미수령 물품은 수령 확인부터 4시간 내 반납해야 합니다. (점심시간 12:00~13:00 제외)'};
  });
}

// 일반 대여로 들어온 신청을 관리자가 사유 대여(4시간 제한 면제)로 바꾼다. 신청 전체에 적용된다.
// 이미 부과된 미반납 페널티는 그대로 둔다(되돌리려면 페널티 화면에서 따로 처리).
export function convertRentalToReason({payload,admin}) {
  if (!admin) throw Error('관리자만 대여 방식을 변경할 수 있습니다.');
  const requestNo=Number(payload?.requestNo), reason=String(payload?.reason || '').trim();
  if (!Number.isSafeInteger(requestNo) || requestNo<=0) throw Error('신청 번호를 확인해주세요.');
  if (!reason || reason.length>2000) throw Error('대여 사유를 1~2,000자로 입력해주세요.');
  return transaction(()=>{
    const request=get('SELECT * FROM rental_requests WHERE id=?',[requestNo]);
    if (!request) throw Error('대여 신청을 찾을 수 없습니다.');
    if (request.rental_mode && request.rental_mode!=='general') throw Error('일반 대여만 사유 대여로 변경할 수 있습니다.');
    const active=['sid_rentals','general_rentals'].some(table=>get(`SELECT 1 FROM ${table} WHERE request_no=? AND COALESCE(returned,'X')!='O' AND status='active' LIMIT 1`,[requestNo]));
    if (!active) throw Error('이미 종료된 신청은 변경할 수 없습니다.');
    const actor=String(admin.name || admin.loginId || admin.id || '관리자');
    run("UPDATE rental_requests SET rental_mode='reason',rental_reason=?,rental_due_date=NULL,rental_general_since=NULL,rental_review_reason=NULL,rental_reviewed_by=? WHERE id=?",[reason,actor,requestNo]);
    const penalized=get('SELECT 1 FROM rental_overdue_events WHERE request_no=?',[requestNo]);
    return {changed:true,message:`신청 전체를 사유 대여로 변경했습니다. 4시간 반납 제한이 면제됩니다.${penalized ? ' 이미 부과된 미반납 페널티는 그대로 남아 있습니다.' : ''}`};
  });
}
