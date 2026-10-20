import crypto from 'node:crypto';
import { all, get, run, transaction } from '../db.js';
import { requireBorrowerIdentity } from './borrowerAuth.js';
import { resolveRegisteredIdentity, employeeIdForRentalRow } from './registeredUsers.js';
import { padSlot, parseItemLabel } from './borrowUtils.js';
import { saveImage } from './images.js';
import { nowKst } from './time.js';
import { rentalTypeLimitPolicy } from './rentalTypeLimitPolicy.js';

export const REPORT_PENDING = "'pending','completed'";
export function assertNormalObjectReturn(sheetType, rowIndex, quantity) {
  const loan = rentalForReport(sheetType,rowIndex);
  const reported = get("SELECT COALESCE(SUM(quantity-consumed_qty),0) AS n FROM object_reports WHERE sheet_type=? AND rental_row_id=? AND kind='damage' AND status!='rejected'", [sheetType,Number(rowIndex)]);
  if (Number(quantity || loan.quantity) > loan.quantity-Number(reported.n)) throw Error('파손 신고된 수량은 관리자 파손 반납으로 처리해주세요.');
  if (get("SELECT id FROM object_reports WHERE sheet_type=? AND rental_row_id=? AND kind='modification' AND status IN ('approved','completed')", [sheetType,Number(rowIndex)])) throw Error('변형 완료 확인과 등록 처리를 마친 뒤 반납해주세요.');
}
export function reportIdentity(ctx) {
  const payload = ctx.payload || ctx.query || {};
  const authenticated = requireBorrowerIdentity(ctx.req, payload);
  if (authenticated) return authenticated;
  const identity = resolveRegisteredIdentity(payload.employeeId, payload.name || payload.borrowerName);
  if (!identity.ok) throw Error(identity.error);
  return { employeeId: identity.employeeId, name: identity.name };
}
export function rentalForReport(sheetType, rowId) {
  const table = { scenario: 'sid_rentals', general: 'general_rentals' }[sheetType];
  if (!table || !Number.isSafeInteger(Number(rowId)) || Number(rowId) <= 0) throw Error('대여 건을 확인해주세요.');
  const row = get(`SELECT * FROM ${table} WHERE id=?`, [Number(rowId)]);
  if (!row) throw Error('대여 기록이 없습니다.');
  const parsed = sheetType === 'scenario' ? parseItemLabel(row.item_label) : { id: row.item_id, name: row.item_label, quantity: row.qty };
  return { row, itemId: padSlot(parsed.id || ''), name: parsed.name, quantity: Number(parsed.quantity) || 1 };
}
function text(value, label, required = true) {
  const s = String(value || '').trim();
  if ((required && !s) || s.length > 3000) throw Error(`${label}을 확인해주세요. (최대 3000자)`);
  return s;
}
export async function reportPhoto(photo) {
  if (typeof photo !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(photo) || photo.length > 14_000_000) throw Error('현재 상태 사진을 반드시 첨부해주세요.');
  try { return (await saveImage(photo, 'object_reports', crypto.randomUUID())).url; }
  catch { throw Error('사진을 저장하지 못했습니다. 이미지 파일을 확인한 뒤 다시 제출해주세요.'); }
}
function event(id, actor, action, note) {
  run('INSERT INTO object_report_events (report_id,occurred_at,actor,action,note) VALUES (?,?,?,?,?)', [id, nowKst(), actor, action, note]);
}
function owned(ctx, id) {
  const user = reportIdentity(ctx);
  const report = get('SELECT * FROM object_reports WHERE id=? AND employee_id=?', [Number(id), user.employeeId]);
  if (!report) throw Error('본인의 보고 건만 처리할 수 있습니다.');
  return { user, report };
}
export function listObjectReports(ctx) {
  const user = ctx.admin ? null : reportIdentity(ctx);
  const items = user ? all('SELECT * FROM object_reports WHERE employee_id=? ORDER BY id DESC', [user.employeeId]) : all('SELECT * FROM object_reports ORDER BY id DESC');
  const events = user
    ? all('SELECT e.* FROM object_report_events e JOIN object_reports r ON r.id=e.report_id WHERE r.employee_id=? ORDER BY e.id', [user.employeeId])
    : all('SELECT * FROM object_report_events ORDER BY id');
  const eventMap = new Map();
  for (const e of events) { if (!eventMap.has(e.report_id)) eventMap.set(e.report_id,[]); eventMap.get(e.report_id).push(e); }
  const result = { items:items.map(r=>({...r,events:eventMap.get(r.id) || []})) };
  if (ctx.admin) {
    const variants = new Map();
    for (const v of all('SELECT id,item_id,name FROM scenario_item_variants ORDER BY id')) { if (!variants.has(v.item_id)) variants.set(v.item_id,[]); variants.get(v.item_id).push(v); }
    result.registrationItems = all('SELECT id,name FROM scenario_items ORDER BY id').map(item=>({...item,variants:variants.get(item.id) || []}));
    result.decisions = all('SELECT * FROM damage_return_decisions ORDER BY id DESC LIMIT 200');
  }
  return result;
}
export async function createObjectReport(ctx) {
  const user = reportIdentity(ctx), p = ctx.payload;
  if (!['damage','modification'].includes(p.kind)) throw Error('보고 유형을 확인해주세요.');
  if (!/^[\w-]{8,100}$/.test(String(p.clientId || ''))) throw Error('제출 번호가 필요합니다. 화면을 다시 열어주세요.');
  const prior = get('SELECT * FROM object_reports WHERE client_id=?', [p.clientId]);
  if (prior) { if (prior.employee_id !== user.employeeId) throw Error('제출 번호가 중복되었습니다.'); return { id: prior.id }; }
  const reason = text(p.reason, '사유'), plan = text(p.plan, '변형 내용과 원상복구 계획', p.kind === 'modification');
  const quantity = Number(p.quantity);
  const validate = () => {
    const loan = rentalForReport(p.sheetType, p.rowIndex);
    if (employeeIdForRentalRow(loan.row) !== user.employeeId) throw Error('본인의 대여 물품만 보고할 수 있습니다.');
    if (loan.row.returned === 'O' || loan.row.status !== 'active' || !loan.row.picked_up_at) throw Error('현재 수령하여 사용 중인 물품만 보고할 수 있습니다.');
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > loan.quantity) throw Error('보고 수량을 확인해주세요.');
    const pending = get("SELECT COALESCE(SUM(quantity-consumed_qty),0) AS n FROM object_reports WHERE sheet_type=? AND rental_row_id=? AND kind=? AND status NOT IN ('rejected','closed')", [p.sheetType, Number(p.rowIndex), p.kind]);
    if (Number(pending.n) + quantity > loan.quantity) throw Error('이미 접수된 수량이 있습니다. 기존 보고 건을 확인해주세요.');
    return loan;
  };
  validate();
  const image = await reportPhoto(p.photo);
  return transaction(() => {
    const replay = get('SELECT id,employee_id FROM object_reports WHERE client_id=?', [p.clientId]);
    if (replay) { if (replay.employee_id !== user.employeeId) throw Error('제출 번호가 중복되었습니다.'); return { id: replay.id }; }
    const loan = validate();
    const item = get('SELECT * FROM scenario_items WHERE id=?', [loan.itemId]);
    const variant = loan.row.variant_id ? get('SELECT image_path FROM scenario_item_variants WHERE id=? AND item_id=?', [loan.row.variant_id, loan.itemId]) : null;
    const id = Number(run(`INSERT INTO object_reports (client_id,kind,sheet_type,rental_row_id,employee_id,borrower_name,item_id,item_name,variant_id,quantity,reason,plan,baseline_image,image_path,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [p.clientId,p.kind,p.sheetType,Number(p.rowIndex),user.employeeId,user.name,loan.itemId,item?.name || loan.name,loan.row.variant_id || null,quantity,reason,plan,variant?.image_path || item?.image_path || '',image,nowKst()]).lastInsertRowid);
    event(id,user.name,'submitted',reason);
    return { id };
  });
}
export async function completeObjectReport(ctx) {
  let { user, report } = owned(ctx, ctx.payload.id);
  if (report.kind !== 'modification' || report.status !== 'approved') throw Error('승인된 변형 요청만 완료 보고할 수 있습니다.');
  const note = text(ctx.payload.note, '완료 내용'), image = await reportPhoto(ctx.payload.photo);
  return transaction(() => {
    ({ user, report } = owned(ctx, ctx.payload.id));
    if (report.status !== 'approved') throw Error('처리 상태가 변경되었습니다. 다시 확인해주세요.');
    run("UPDATE object_reports SET status='completed',completion_image=?,completion_note=?,completed_at=? WHERE id=?", [image,note,nowKst(),report.id]);
    event(report.id,user.name,'completed',note);
    return { id: report.id };
  });
}
export function reviewObjectReport(ctx) {
  const p = ctx.payload, actor = ctx.admin.name || ctx.admin.loginId;
  const note = text(p.note, '검토 사유');
  return transaction(() => {
    const report = get('SELECT * FROM object_reports WHERE id=?', [Number(p.id)]);
    if (!report) throw Error('보고 건을 찾을 수 없습니다.');
    const allowed = report.kind === 'damage' ? { pending: ['acknowledged','rejected'], acknowledged: ['closed'] } : { pending: ['approved','rejected'], approved:['rejected'], completed: ['closed'] };
    if (!(allowed[report.status] || []).includes(p.status)) throw Error('현재 상태에서 처리할 수 없습니다.');
    let registration = null, target = null, variant = null;
    if (p.status === 'closed' && (report.kind === 'modification' || (p.registrationKind && p.registrationKind !== 'none'))) {
      registration = p.registrationKind;
      if (!['restored','variant','new_object'].includes(registration)) throw Error('처리 후 등록 방식을 선택해주세요.');
      target = registration === 'new_object' ? padSlot(p.targetItemId || '') : report.item_id;
      if (report.registration_kind === 'new_object' && report.target_item_id && (registration !== 'new_object' || target !== report.target_item_id)) throw Error('이 보고에서 SM에 등록한 오브젝트로 연결해주세요.');
      const object = get('SELECT * FROM scenario_items WHERE id=?', [target]);
      if (!object || (registration === 'new_object' && target === report.item_id)) throw Error('Scenario Manager에서 등록한 대상 오브젝트를 불러와 선택해주세요.');
      if (registration === 'variant') {
        variant = Number(p.targetVariantId);
        if (!get('SELECT id FROM scenario_item_variants WHERE id=? AND item_id=?', [variant,target])) throw Error('등록을 완료한 대상 종류 ID를 입력해주세요.');
      }
      const registeredPhoto = variant ? get('SELECT image_path FROM scenario_item_variants WHERE id=?',[variant])?.image_path : object.image_path;
      if (!registeredPhoto) throw Error('대상 오브젝트 또는 종류의 실제 상태 사진을 먼저 등록해주세요.');
      // SM 등록/가져오기와 실제 상태 사진 및 재고 반영을 확인한 뒤 연결한다.
      if (p.registrationConfirmed !== true) throw Error('사진과 재고 수량 반영을 확인해주세요.');
    }
    if (p.status === 'closed' && report.registration_kind === 'new_object' && report.target_item_id && !target) throw Error('등록한 새 오브젝트 연결을 확인해주세요.');
    run('UPDATE object_reports SET status=?,review_note=?,reviewed_by=?,reviewed_at=?,registration_kind=?,target_item_id=?,target_variant_id=? WHERE id=?', [p.status,note,actor,nowKst(),registration,target,variant,report.id]);
    event(report.id,actor,p.status,`${note}${target ? ` · 등록 ${target}${variant ? ` 종류 ${variant}` : ''}` : ''}`);
    return { id: report.id };
  });
}

/** 반납 트랜잭션 안에서 실행한다. 사진이 있는 사전 신고 수량만 한 번씩 사용한다. */
export function settleDamageReport({ operationId, sheetType, rowIndex, quantity, exempt, exemptionReason, manager, cutoff = nowKst(), reportRowIndex = rowIndex }) {
  const prior = get('SELECT * FROM damage_return_decisions WHERE operation_id=? AND sheet_type=? AND rental_row_id=?', [operationId,sheetType,rowIndex]);
  if (prior) return prior;
  const loan = rentalForReport(sheetType,rowIndex), row = loan.row;
  let remaining = quantity;
  const reports = all("SELECT * FROM object_reports WHERE sheet_type=? AND rental_row_id=? AND kind='damage' AND status!='rejected' AND image_path!='' AND created_at<=? AND quantity>consumed_qty ORDER BY id", [sheetType,reportRowIndex,cutoff]);
  for (const report of reports) {
    const used = Math.min(remaining,report.quantity-report.consumed_qty);
    run('UPDATE object_reports SET consumed_qty=consumed_qty+? WHERE id=?', [used,report.id]);
    if (used) event(report.id,manager,'damage_return',`파손 반납 ${used}개 확인`);
    remaining -= used;
    if (!remaining) break;
  }
  if (exempt && !String(exemptionReason || '').trim()) throw Error('페널티 면제 사유를 입력해주세요.');
  let penaltyId = null;
  if (remaining > 0 && !exempt) {
    const policy = rentalTypeLimitPolicy({ name: row.borrower_name });
    const before = policy.legacyMax, after = Math.max(0,before-5);
    const expires = new Date(Date.now()+14*86400000+9*3600000).toISOString().slice(0,19).replace('T',' ');
    const reason = `파손 사전 미신고 · ${loan.itemId} ${loan.name} ${remaining}개 · 대여 가능 종류 ${before}→${after}종 · 14일`;
    penaltyId = Number(run('INSERT INTO penalties (name,max_types,reason,expires_at) VALUES (?,?,?,?)', [row.borrower_name,after,reason,expires]).lastInsertRowid);
    run(`INSERT INTO penalty_links (penalty_id,sheet_type,row_id,cause,item_id,item_name,qty,request_no,applied_at,created_at,created_by) VALUES (?,?,?,'return',?,?,?,?,?,?,?)`, [penaltyId,sheetType,rowIndex,loan.itemId,loan.name,quantity,row.request_no || null,row.applied_at || row.borrow_date,nowKst(),manager]);
  }
  const id = Number(run(`INSERT INTO damage_return_decisions (operation_id,sheet_type,rental_row_id,employee_id,borrower_name,quantity,reported_qty,exempt,exemption_reason,penalty_id,occurred_at,manager) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [operationId,sheetType,rowIndex,employeeIdForRentalRow(row),row.borrower_name,quantity,quantity-remaining,exempt ? 1 : 0,exemptionReason || null,penaltyId,nowKst(),manager]).lastInsertRowid);
  return get('SELECT * FROM damage_return_decisions WHERE id=?', [id]);
}
