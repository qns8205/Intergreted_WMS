import crypto from 'node:crypto';
import sharp from 'sharp';
import { all, get, run, transaction } from '../db.js';
import { maybeSaveImage } from './images.js';
import { nowKst, parseKstMs } from './time.js';
import { parseItemLabel } from './borrowUtils.js';
import { employeeIdForRentalRow } from './registeredUsers.js';

const inFlight = new Map();
const reject = message => Object.assign(Error(message), { status: 409 });
export function operationFingerprint(operation, items) {
  return crypto.createHash('sha256').update(JSON.stringify({ operation, items: items.map(item => ({
    sheetType: item.sheetType, rowIndex: Number(item.rowIndex), quantity: Number(item.quantity),
    damaged: !!item.damaged, reason: String(item.reason || '').trim(), variantId: Number(item.variantId) || null,
  })).sort((a,b) => a.sheetType.localeCompare(b.sheetType) || a.rowIndex-b.rowIndex) })).digest('hex');
}

async function validateImage(photo) {
  if (typeof photo !== 'string' || !/^data:image\/[^;,]+;base64,/.test(photo)) throw Object.assign(Error('사진을 다시 촬영해주세요.'), { status: 400 });
  try {
    const {info} = await sharp(Buffer.from(photo.slice(photo.indexOf(',')+1),'base64'), { limitInputPixels: 20_000_000,failOn:'warning' })
      .resize({width:32,height:32,fit:'inside'}).raw().toBuffer({resolveWithObject:true});
    if (!info.width || !info.height) throw Error('empty image');
  } catch { throw Object.assign(Error('촬영한 사진을 읽을 수 없습니다. 사진을 다시 촬영해주세요.'), { status: 400 }); }
}

/** prepare는 신원·선택/수량 검증, commit은 동기 장부 갱신. 파일 저장 전후로 최신 상태를 검증한다. */
export async function executePhotoOperation({ operation, employeeId, borrowerName, body, prepare, commit, saveImage = maybeSaveImage }) {
  if (!['pickup','return'].includes(operation) || !Array.isArray(body.items) || !body.items.length || body.items.length>200 || body.items.some(item=>!item || typeof item!=='object')) throw Object.assign(Error('처리할 물품을 확인해주세요.'),{status:400});
  const clientId = String(body.clientId || '').trim();
  if (!/^[\w-]{12,100}$/.test(clientId)) throw Object.assign(Error('처리 요청 번호가 올바르지 않습니다. 다시 로그인해주세요.'), { status: 400 });
  const fingerprint = operationFingerprint(operation, body.items);
  const existing = get('SELECT * FROM unattended_operations WHERE client_id=?',[clientId]);
  if (existing && (existing.employee_id !== employeeId || existing.operation !== operation || existing.fingerprint !== fingerprint)) throw reject('저장된 요청과 내용이 다릅니다. 기존 촬영 건을 먼저 확인해주세요.');
  if (existing?.status === 'completed') return JSON.parse(existing.result_json);
  if (existing?.review_status === 'reviewed') throw reject('관리자가 검토를 종료한 촬영 건입니다. 목록을 다시 확인해주세요.');
  const current = inFlight.get(clientId);
  if (current) {
    if (current.employeeId !== employeeId || current.fingerprint !== fingerprint) throw reject('같은 요청 번호로 다른 내용을 처리할 수 없습니다.');
    return current.promise;
  }
  const receivedAt = nowKst();
  const promise = (async () => {
    const prepared=prepare(); // 권한·종류·수량 오류에는 페널티 보류 증빙을 만들지 않는다.
    await validateImage(body.photo);
    if (body.damagePhoto) await validateImage(body.damagePhoto);
    let id = existing?.id;
    if (!id) id = Number(run(`INSERT INTO unattended_operations
      (client_id,operation,employee_id,borrower_name,fingerprint,items_json,photo_validated,received_at,updated_at)
      VALUES (?,?,?,?,?,?,1,?,?)`,[clientId,operation,employeeId,borrowerName,fingerprint,JSON.stringify(prepared.evidence),receivedAt,nowKst()]).lastInsertRowid);
    else run("UPDATE unattended_operations SET status='processing',last_error=NULL,updated_at=? WHERE id=?",[nowKst(),id]);
    try {
      const imagePath = existing?.image_path || await saveImage(body.photo,'unattended_operations',id);
      if (!imagePath) throw Error('촬영 사진 저장 경로가 없습니다.');
      // 장부 반영 전에 사진 저장 성공 자체를 별도 보존한다.
      run('UPDATE unattended_operations SET image_path=?,updated_at=? WHERE id=?',[imagePath,nowKst(),id]);
      const damageImagePath = prepared.hasDamage ? existing?.damage_image_path || await saveImage(body.damagePhoto,'unattended_operation_damage',id) : null;
      if (prepared.hasDamage && !damageImagePath) throw Error('파손 사진 저장 경로가 없습니다.');
      if (damageImagePath) run('UPDATE unattended_operations SET damage_image_path=? WHERE id=?',[damageImagePath,id]);
      return transaction(() => {
        const latest = prepare();
        const data = commit(latest,{imagePath,damageImagePath,now:nowKst()});
        const result = { success:true,...data,operationId:id,clientId,operation,photoSaved:true,completed:true };
        run("UPDATE unattended_operations SET status='completed',result_json=?,updated_at=?,last_error=NULL,review_status='completed' WHERE id=?",[JSON.stringify(result),nowKst(),id]);
        return result;
      });
    } catch (error) {
      // 실패 장부도 정상 반납·대여 완료와 구분한다. 증빙 파일은 관리자 확인까지 보관한다.
      run('UPDATE unattended_operations SET status=?,last_error=?,updated_at=? WHERE id=?',[error.status ? 'rejected' : 'failed',String(error.message || '처리 실패').slice(0,1000),nowKst(),id]);
      error.operationId = id;
      throw error;
    }
  })();
  inFlight.set(clientId,{employeeId,fingerprint,promise});
  try { return await promise; } finally { inFlight.delete(clientId); }
}

/** 본인 인증 뒤에만 호출한다. 다른 사람의 요청 유무나 사진 주소를 노출하지 않는다. */
export function operationStatus(clientId, employeeId) {
  const row=get('SELECT * FROM unattended_operations WHERE client_id=? AND employee_id=?',[String(clientId || ''),employeeId]);
  if (!row) return {status:'not-found'};
  return {status:row.status,operation:row.operation,operationId:row.id,photoReceived:!!row.photo_validated,
    reviewStatus:row.review_status,
    adminReview:row.review_status==='pending' && row.status!=='completed',
    ...(row.status==='completed' ? {result:JSON.parse(row.result_json)} : {error:row.last_error || ''})};
}

/** 검증된 사진이 기한 전에 도착한 실제 기술 오류만 보류한다. 단순 촬영/오입력은 제외. */
export function recoveryHoldChecker(operation) {
  const evidence=all(`SELECT items_json,received_at,status,updated_at FROM unattended_operations
    WHERE operation=? AND photo_validated=1 AND review_status='pending' AND status IN ('processing','failed')`,[operation]);
  const byRow=new Map();
  for (const entry of evidence) {
    let items=[]; try { items=JSON.parse(entry.items_json); } catch { continue; }
    for (const item of items) {
      const key=`${item.sheetType}:${item.rowIndex}`;
      const list=byRow.get(key) || []; list.push({...item,...entry}); byRow.set(key,list);
    }
  }
  return (row,sheetType,deadlineMs) => {
    const entries=byRow.get(`${sheetType}:${row.id}`) || [];
    const quantity=sheetType==='scenario' ? Number(parseItemLabel(row.item_label).quantity)||1 : Number(row.qty)||1;
    return entries.some(item => item.employeeId === employeeIdForRentalRow(row)
      && parseKstMs(item.received_at) <= deadlineMs
      && ((Number(item.quantity)>=quantity && Number(item.quantity)>=Number(item.rowQuantity || quantity)) || (item.status==='processing' && Date.now()-parseKstMs(item.updated_at)<120_000)));
  };
}

export function pendingOperationReviews() {
  return all(`SELECT id,operation,employee_id,borrower_name,items_json,image_path,damage_image_path,status,received_at,updated_at,last_error
    FROM unattended_operations WHERE review_status='pending' AND status!='completed' ORDER BY received_at LIMIT 100`)
    .filter(row=>row.status!=='processing' || Date.now()-parseKstMs(row.updated_at)>120_000)
    .map(row=>({...row,items:JSON.parse(row.items_json)}));
}
export function closeOperationReview(id,admin,note) {
  if(!Number.isSafeInteger(Number(id)) || Number(id)<=0)throw Object.assign(Error('오류 확인 번호가 올바르지 않습니다.'),{status:400});
  if (String(note || '').trim().length<3) throw Object.assign(Error('확인 내용 또는 조치 내용을 3자 이상 적어주세요.'),{status:400});
  const row=get("SELECT * FROM unattended_operations WHERE id=? AND review_status='pending' AND status!='completed'",[Number(id)]);
  if (!row) throw reject('이미 처리되었거나 없는 오류 건입니다.');
  if (inFlight.has(row.client_id)) throw reject('사진 처리가 진행 중입니다. 잠시 후 다시 확인해주세요.');
  run("UPDATE unattended_operations SET review_status='reviewed',review_note=?,reviewer=?,reviewed_at=? WHERE id=?",[String(note).trim(),admin,nowKst(),row.id]);
}
