import { all, get, run, transaction } from '../db.js';
import { kstTimestamp, rentalTimeMs, rentalDeadlineMs } from '../../shared/rentalTerms.js';
import { recoveryHoldChecker } from './unattendedOperationRecovery.js';
import { rentalTypeLimitPolicy } from './rentalTypeLimitPolicy.js';
import { parseItemLabel } from './borrowUtils.js';

/** 신청당 한 번만 5종을 48시간 차감한다. 서버 중단 중 반납된 지연 건도 확인한다. */
export function applyRentalOverduePenalties(now = Date.now()) {
  const held = recoveryHoldChecker('return');
  const groups = new Map();
  for (const [table, sheet] of [['sid_rentals','scenario'],['general_rentals','general']]) {
    const rows = all(`SELECT r.*,q.rental_general_since FROM ${table} r JOIN rental_requests q ON q.id=r.request_no
      LEFT JOIN rental_overdue_events e ON e.request_no=q.id
      WHERE q.rental_mode='general' AND e.request_no IS NULL AND r.picked_up_at IS NOT NULL
      AND COALESCE(r.return_source,'') != 'cancel'`);
    for (const row of rows) {
      const start = rentalTimeMs(row.picked_up_at), deadline = rentalDeadlineMs(row.picked_up_at,row.rental_general_since);
      const end = row.returned === 'O' ? rentalTimeMs(row.return_date) : now;
      if (!Number.isFinite(start) || !Number.isFinite(end) || deadline >= now || end <= deadline || held(row,sheet,deadline)) continue;
      const previous = groups.get(row.request_no);
      if (!previous || deadline < previous.deadline) groups.set(row.request_no,{row,deadline,sheet});
    }
  }
  let penalized = 0;
  transaction(() => {
    for (const [requestNo,{row,deadline,sheet}] of groups) {
      if (get('SELECT 1 FROM rental_overdue_events WHERE request_no=?',[requestNo])) continue;
      const policy = rentalTypeLimitPolicy({name:row.borrower_name});
      const max = Math.max(0,policy.max-5);
      const reason = `일반 대여 4시간 초과 미반납 · 신청 #${requestNo} · 대여 가능 종류 5종 차감 · 48시간`;
      const penalty = run('INSERT INTO penalties(name,max_types,reason,expires_at,deduction_types) VALUES (?,?,?,?,5)',
        [row.borrower_name,max,reason,kstTimestamp(now+48*3600000)]);
      run('INSERT INTO rental_overdue_events(request_no,penalty_id,deadline_at,occurred_at) VALUES (?,?,?,?)',
        [requestNo,Number(penalty.lastInsertRowid),kstTimestamp(deadline),kstTimestamp(now)]);
      const item = sheet==='scenario' ? parseItemLabel(row.item_label) : {id:row.item_id,name:row.item_label,quantity:row.qty};
      run(`INSERT INTO penalty_links(penalty_id,sheet_type,row_id,cause,item_id,item_name,qty,request_no,applied_at,created_at,created_by)
        VALUES (?,?,?,'rental',?,?,?,?,?,?,?)`,[Number(penalty.lastInsertRowid),sheet,row.id,item.id || '',item.name || '',Number(item.quantity)||1,requestNo,row.applied_at || row.borrow_date || '',kstTimestamp(now),'4시간 미반납 자동 차감']);
      penalized++;
    }
  });
  return {penalized};
}
