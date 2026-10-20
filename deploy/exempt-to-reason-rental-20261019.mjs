// 2026-10-19: 현재 한도 제외 중인(반납 전) 대여를 "사유 대여 · 4시간 제한 면제"로 바꾼다.
// 대여 방식은 신청(rental_requests) 단위라, 같은 신청의 다른 물품도 함께 사유 대여가 된다.
// 한도 제외 표시(type_limit_exempt)는 그대로 둔다. 이미 사유 대여·장기대여인 신청은 건드리지 않는다.
// 사용: node exempt-to-reason-rental-20261019.mjs            → 미리보기만(쓰기 없음)
//       node exempt-to-reason-rental-20261019.mjs --apply    → 온라인 백업 후 적용
import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';

const DB = '/home/configds/wms/server/data/db.sqlite3';
const apply = process.argv.includes('--apply');
const db = new DatabaseSync(DB, { readOnly: !apply });

const exempt = [];
for (const t of ['sid_rentals', 'general_rentals']) {
  exempt.push(...db.prepare(`SELECT '${t}' tbl, id, request_no, borrower_name, item_label, type_limit_exempt_reason reason
    FROM ${t} WHERE type_limit_exempt='Y' AND COALESCE(returned,'X')!='O' AND status='active'`).all());
}
const noRequest = exempt.filter(r => !r.request_no);
const targets = new Map(); // request_no → {request, reason}
for (const r of exempt) {
  if (!r.request_no || targets.has(r.request_no)) continue;
  const q = db.prepare('SELECT id,borrower_name,rental_mode,rental_reason,rental_due_date,rental_general_since,rental_review_reason FROM rental_requests WHERE id=?').get(r.request_no);
  if (!q || ['reason', 'long_term', 'planner'].includes(q.rental_mode)) continue;
  // 사유는 한도 제외 사유를 기준으로 한다. 같은 신청 안에서 제외 사유가 여러 개면 모두 이어 붙인다.
  const exemptReasons = [...new Set(exempt.filter(x => x.request_no === r.request_no).map(x => String(x.reason || '').trim()).filter(Boolean))];
  const reason = exemptReasons.join(' / ') || String(q.rental_reason || '').trim() || '한도 제외 물품';
  targets.set(r.request_no, { q, reason });
}

console.log(`한도 제외 중인 대여 줄: ${exempt.length}개 (신청번호 없음 ${noRequest.length}개 — 대여 방식을 둘 곳이 없어 제외)`);
console.log(`사유 대여로 바꿀 신청: ${targets.size}건`);
for (const [no, { q, reason }] of targets) {
  const rows = ['sid_rentals', 'general_rentals'].flatMap(t => db.prepare(`SELECT item_label, type_limit_exempt FROM ${t} WHERE request_no=? AND COALESCE(returned,'X')!='O' AND status='active'`).all(no));
  console.log(`  #${no} ${q.borrower_name} | ${q.rental_mode || '(방식 없음)'} → 사유 대여 · 사유 "${reason}" | 물품 ${rows.length}개: ${rows.map(r => r.item_label + (r.type_limit_exempt === 'Y' ? '' : '(한도 제외 아님)')).join(', ')}`);
}
for (const r of noRequest) console.log(`  [신청번호 없음] ${r.borrower_name} | ${r.item_label}`);

if (!apply) { console.log('\n미리보기만 했습니다. 적용하려면 --apply'); process.exit(0); }

const stamp = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 19).replace(/[-:T]/g, '');
const dir = `/home/configds/backups/${stamp}-exempt-to-reason`;
mkdirSync(dir, { recursive: true });
await backup(db, `${dir}/db.sqlite3`);
writeFileSync(`${dir}/previous-rental-terms.json`, JSON.stringify([...targets.values()].map(v => v.q), null, 2));
const update = db.prepare("UPDATE rental_requests SET rental_mode='reason', rental_reason=?, rental_due_date=NULL, rental_general_since=NULL WHERE id=?");
db.exec('BEGIN');
try {
  for (const [no, { reason }] of targets) update.run(reason, no);
  db.exec('COMMIT');
} catch (e) { db.exec('ROLLBACK'); throw e; }
console.log(`\n적용 완료: ${targets.size}건. 백업: ${dir}`);
