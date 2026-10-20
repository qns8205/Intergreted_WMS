import { Router } from "express";
import crypto from "node:crypto";
import { all, get, run, transaction } from "../db.js";
import { requireAdmin } from "../lib/auth.js";
import { maybeSaveImage } from "../lib/images.js";
import { parseItemLabel, padSlot, releaseRentedWithoutRestock, restoreRentalStock, scenarioItemLabel } from "../lib/borrowUtils.js";
import { employeeIdForRentalRow, registeredUser } from "../lib/registeredUsers.js";
import { REQUEST_LOOKUP_PATH } from "./requestLookup.js";
import { nowKst } from "../lib/time.js";
import { scenarioVariantInfo } from "../lib/scenarioVariantDisplay.js";
import { nudge as smSyncNudge } from "../lib/smSync.js";
import { verifySmLogin } from "../lib/smLogin.js";
import { borrowerAuthRequired } from "../lib/httpsConfig.js";
import { digest, kioskEnabled as enabled, validDevice, issueKioskSession, revokeKioskSession, kioskUserFromRequest } from "../lib/unattendedKiosk.js";
import { executePhotoOperation, operationFingerprint, operationStatus, pendingOperationReviews, closeOperationReview } from "../lib/unattendedOperationRecovery.js";
import { settleDamageReport, assertNormalObjectReturn } from '../lib/objectReports.js';

export const unattendedRouter = Router();

function setting(key) { return get("SELECT value FROM settings WHERE key = ?", [key])?.value || ""; }
function saveSetting(key, value) {
  run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, String(value)]);
}
function requireDevice(req, res, next) {
  if (!enabled()) return res.status(403).json({ success: false, error: "현재 무인 모드가 아닙니다." });
  if (!validDevice(req)) return res.status(403).json({ success: false, error: "등록된 무인 반납 PC에서만 사용할 수 있습니다." });
  next();
}
// 사번과 SM 비밀번호로 로그인한 사람만. 이후 처리는 이 사람의 사번으로만 한다.
function requireKioskUser(req, res, next) {
  requireDevice(req, res, () => {
    const user = kioskUserFromRequest(req);
    if (!user) return res.status(401).json({ success: false, relogin: true, error: "로그인이 끝났습니다. 사번과 SM 비밀번호로 다시 로그인해주세요." });
    req.kioskUser = user;
    next();
  });
}

// 비밀번호 대입을 막는다. 사번·무인 PC 주소마다 10분에 몇 번까지만 시도할 수 있다.
const loginAttempts = new Map();
const loginInFlight = new Set();
unattendedRouter.post("/unattended/login", requireDevice, async (req, res) => {
  const employeeId = String(req.body?.employeeId || "").trim();
  let password = typeof req.body?.password === "string" ? req.body.password : "";
  if (req.body) delete req.body.password;
  let ownsAttempt = false;
  try {
    // HTTPS로 운영할 때는 비밀번호가 평문으로 오가지 않게 실제 TLS 연결만 받는다.
    if (borrowerAuthRequired() && !req.socket.encrypted) return res.status(426).json({ success: false, error: "HTTPS 주소에서 로그인해주세요." });
    if (!/^\d{4}$/.test(employeeId) || !password || password.length > 512) return res.status(400).json({ success: false, error: "사번 4자리와 SM 비밀번호를 입력해주세요." });
    const now = Date.now();
    for (const [key, value] of loginAttempts) if (now - value.at > 10 * 60000) loginAttempts.delete(key);
    const keys = [`ip:${req.ip}`, `id:${employeeId}`];
    if (keys.some((key) => (loginAttempts.get(key)?.count || 0) >= (key.startsWith("id:") ? 10 : 30)) || loginInFlight.has(employeeId)) {
      return res.status(429).json({ success: false, error: "로그인 시도가 많습니다. 잠시 후 다시 시도해주세요." });
    }
    for (const key of keys) { const value = loginAttempts.get(key) || { at: now, count: 0 }; value.count++; loginAttempts.set(key, value); }
    const user = registeredUser(employeeId);
    if (!user) return res.status(404).json({ success: false, error: "등록된 사번을 찾지 못했습니다." });
    loginInFlight.add(employeeId);
    ownsAttempt = true;
    const result = await verifySmLogin(employeeId, password);
    password = "";
    // SM에 닿지 않으면 본인 확인을 할 수 없으므로 들여보내지 않는다(사번만으로 넘어가는 길을 두지 않는다).
    if (result.unavailable) return res.status(503).json({ success: false, error: "SM에 연결할 수 없어 로그인할 수 없습니다. 잠시 후 다시 시도해주세요." });
    if (!result.ok) return res.status(401).json({ success: false, error: "사번 또는 SM 비밀번호가 맞지 않습니다." });
    loginAttempts.delete(`id:${employeeId}`);
    res.json({ success: true, token: issueKioskSession(user.employee_id), employeeId: user.employee_id, borrowerName: user.name });
  } catch {
    res.status(500).json({ success: false, error: "로그인을 처리하지 못했습니다. 다시 시도해주세요." });
  } finally {
    password = "";
    if (ownsAttempt) loginInFlight.delete(employeeId);
  }
});
unattendedRouter.post("/unattended/logout", requireDevice, (req, res) => {
  revokeKioskSession(req);
  res.json({ success: true });
});

unattendedRouter.get("/unattended/status", (req, res) => {
  // QR 위치 확인 페이지 주소는 여기서 알려주지 않는다. 무인 PC가 반납을 마쳤을 때만 받는다.
  res.json({ success: true, enabled: enabled(), deviceRegistered: validDevice(req) });
});
unattendedRouter.put("/unattended/mode", requireAdmin, (req, res) => {
  const next = !!req.body?.enabled;
  const wasEnabled = enabled();
  saveSetting("unattended_enabled", next ? "1" : "0");
  if (next && !wasEnabled) saveSetting("unattended_enabled_at", nowKst());
  res.json({ success: true, enabled: enabled() });
});
unattendedRouter.post("/unattended/device/register", requireAdmin, (req, res) => {
  const token = crypto.randomBytes(32).toString("base64url");
  saveSetting("unattended_device_hash", digest(token));
  res.json({ success: true, token });
});

unattendedRouter.get("/unattended/damage-pending", requireAdmin, (req, res) => {
  res.json({ success: true, items: all("SELECT * FROM unattended_damage_pending WHERE status = 'pending' ORDER BY id DESC") });
});
unattendedRouter.post("/unattended/damage-pending/:id/resolve", requireAdmin, (req, res) => {
  const pending = get("SELECT * FROM unattended_damage_pending WHERE id = ? AND status = 'pending'", [Number(req.params.id)]);
  if (!pending) return res.status(404).json({ success: false, error: "이미 처리되었거나 존재하지 않는 확인 건입니다." });
  const table = pending.sheet_type === "scenario" ? "sid_rentals" : "general_rentals";
  const resolver = req.admin.name || req.admin.loginId || String(req.admin.id);
  // 다른 불량 기록과 같은 "YYYY-MM-DD HH:mm:ss"(서울). toISOString()은 UTC라 9시간 이른 시각이 남았다.
  const now = nowKst();
  const action = req.body?.action === "reject" ? "rejected" : "confirmed";
  if (action === 'confirmed' && !pending.image_path) return res.status(400).json({success:false,error:'파손 사진을 확인한 뒤 처리해주세요.'});
  if (action === 'confirmed' && req.body.penaltyExempt === true && !String(req.body.exemptionReason || '').trim()) return res.status(400).json({success:false,error:'페널티 면제 사유를 입력해주세요.'});
  transaction(() => {
    if (action === "confirmed") {
      settleDamageReport({operationId:`unattended:${pending.id}`,sheetType:pending.sheet_type,rowIndex:pending.rental_row_id,reportRowIndex:pending.source_rental_row_id || pending.rental_row_id,quantity:Number(pending.qty),exempt:req.body.penaltyExempt === true,exemptionReason:req.body.exemptionReason,manager:resolver,cutoff:pending.created_at});
      run("UPDATE unattended_damage_pending SET status='confirmed', resolved_at=?, resolver=? WHERE id=?", [now,resolver,pending.id]);
      run(`UPDATE ${table} SET status='archived' WHERE id=?`, [pending.rental_row_id]);
      // 반납 때는 재고를 되돌리지 않았다(파손 확인 대기). 폐기가 확정됐으니 "대여 중"에서만 뺀다.
      const rental = get(`SELECT * FROM ${table} WHERE id = ?`, [pending.rental_row_id]);
      if (rental) releaseRentedWithoutRestock(rental, pending.item_id, Number(pending.qty) || 0);
      run("INSERT INTO defect_logs (product,qty,occurred_date,defect_type,detail,action_taken,image_path,breaker) VALUES (?,?,?,?,?,?,?,?)",
        [pending.item_name,pending.qty,now,"파손",pending.reason || "무인 반납 파손 신고","관리자 확인",pending.image_path,resolver]);
    } else {
      // 오신고면 물건이 반납된 것으로 확정하지 않는다. 대여 줄을 다시 열어 종류 제한에도 복귀시킨다.
      run("UPDATE unattended_damage_pending SET status='rejected', resolved_at=?, resolver=? WHERE id=?", [now,resolver,pending.id]);
      run(`UPDATE ${table} SET returned='X', return_date=NULL, status='active', return_source=NULL WHERE id=?`, [pending.rental_row_id]);
    }
  });
  smSyncNudge();
  res.json({ success: true, status: action });
});

function employeeIdOf(row) {
  return employeeIdForRentalRow(row);
}
function itemFromRow(sheetType, row) {
  const scenario = sheetType === "scenario";
  const parsed = scenario ? parseItemLabel(row.item_label) : { id: row.item_id, name: row.item_label, quantity: Number(row.qty) || 1 };
  const obj = get("SELECT name, root_slot, image_path FROM scenario_items WHERE id = ?", [padSlot(parsed.id || "")]) || {};
  const variant = row.variant_id ? get("SELECT image_path FROM scenario_item_variants WHERE id = ?", [Number(row.variant_id)]) : null;
  return {
    key: `${sheetType}:${row.id}`, sheetType, rowIndex: row.id,
    borrowerName: row.borrower_name || "", employeeId: employeeIdOf(row),
    itemId: padSlot(parsed.id || ""), itemName: parsed.name || obj.name || "물품", quantity: Number(parsed.quantity) || 1,
    scenarioId: row.sid || "", location: obj.root_slot || "", image: variant?.image_path || obj.image_path || "",
    pickedUp: !!row.picked_up_at, ...scenarioVariantInfo(parsed.id || "", row),
  };
}
function outstandingForEmployee(employeeId) {
  const rows = [];
  for (const r of all("SELECT * FROM sid_rentals WHERE (returned IS NULL OR returned != 'O') ORDER BY id")) if (employeeIdOf(r) === employeeId) rows.push(itemFromRow("scenario", r));
  for (const r of all("SELECT * FROM general_rentals WHERE (returned IS NULL OR returned != 'O') ORDER BY id")) if (employeeIdOf(r) === employeeId) rows.push(itemFromRow("general", r));
  return rows;
}

unattendedRouter.post("/unattended/lookup-request", requireDevice, (req, res) => {
  res.status(410).json({ success: false, error: "무인 모드의 대여 번호 조회는 종료되었습니다. 사번으로 로그인해주세요." });
});
unattendedRouter.post("/unattended/find-mine", requireKioskUser, (req, res) => {
  // 화면이 보낸 사번이 아니라 로그인한 사람의 사번으로만 찾는다.
  const user = registeredUser(req.kioskUser.employeeId);
  if (!user) return res.status(404).json({ success: false, error: "등록된 사번을 찾지 못했습니다." });
  // 보관 위치는 무인 PC 화면에 내보내지 않는다 — 위치는 신청 후 받은 QR로만 확인한다.
  const items = outstandingForEmployee(user.employee_id).map(({ location, ...item }) => item);
  res.json({ success: true, employeeId: user.employee_id, borrowerName: user.name, items: req.body?.operation === "pickup" ? items.filter((item) => !item.pickedUp) : items });
});

// 사용자가 고칠 수 있는 거절 사유. 전역 오류 처리기로 넘기면 "서버 오류"로 뭉개지므로
// 각 라우트가 이 표시를 보고 사유를 그대로 돌려준다.
function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function resolveSelected(selection) {
  if (!['scenario','general'].includes(selection.sheetType) || !Number.isSafeInteger(Number(selection.rowIndex)) || Number(selection.rowIndex)<=0) throw badRequest('선택한 물품 정보가 올바르지 않습니다.');
  const sheetType = selection.sheetType === "scenario" ? "scenario" : "general";
  const table = sheetType === "scenario" ? "sid_rentals" : "general_rentals";
  const row = get(`SELECT * FROM ${table} WHERE id = ?`, [Number(selection.rowIndex)]);
  if (!row || row.returned === "O") throw badRequest("이미 반납되었거나 존재하지 않는 물품이 포함되어 있습니다. 로그아웃 후 다시 로그인해주세요.");
  if (row.status && row.status!=='active') throw badRequest('처리할 수 없는 상태의 물품입니다. 관리자에게 확인해주세요.');
  const parsed = sheetType === "scenario" ? parseItemLabel(row.item_label) : { id: row.item_id, name: row.item_label, quantity: Number(row.qty) || 1 };
  const rowQty = Number(parsed.quantity) || 1;
  const qty = Number(selection.quantity);
  if (!Number.isSafeInteger(qty) || qty<1 || qty>rowQty) throw badRequest('선택한 수량이 남은 대여 수량과 다릅니다. 목록을 다시 확인해주세요.');
  return { selection, sheetType, table, row, parsed, rowQty, qty };
}
function finishRental(r, now, status) {
  const { row, table, sheetType, parsed, rowQty, qty } = r;
  // 파손 신고는 선반으로 돌아가지 않고, 대여 확인 전 물품은 가져간 적이 없으니 취소다.
  // QR 위치 확인의 "미확인 반납"에는 'unattended'만 올라간다.
  const returnSource = r.selection.damaged ? "damage" : !row.picked_up_at ? "cancel" : "unattended";
  if (qty < rowQty) {
    const remain = rowQty - qty;
    if (sheetType === "scenario") {
      run("UPDATE sid_rentals SET item_label = ? WHERE id = ?", [scenarioItemLabel({ id: parsed.id, name: parsed.name, quantity: remain }), row.id]);
      const inserted = run(`INSERT INTO sid_rentals (borrower_name,employee_id,sid,item_label,borrow_date,purpose,returned,return_date,email,batch_id,applied_at,item_type,confirmed_at,status,floor,unit,variant_id,variant_pending,request_no,picked_up_at,return_source,type_limit_exempt,type_limit_exempt_reason) VALUES (?,?,?,?,?,?,'O',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [row.borrower_name,employeeIdOf(row),row.sid,scenarioItemLabel({ id: parsed.id,name: parsed.name,quantity: qty }),row.borrow_date,row.purpose,now,row.email,row.batch_id,row.applied_at,row.item_type,now,status,row.floor,row.unit,row.variant_id,row.variant_pending,row.request_no,row.picked_up_at,returnSource,row.type_limit_exempt,row.type_limit_exempt_reason]);
      return Number(inserted.lastInsertRowid);
    }
    run("UPDATE general_rentals SET qty = ? WHERE id = ?", [remain, row.id]);
    const inserted = run(`INSERT INTO general_rentals (borrower_name,employee_id,item_id,item_label,qty,borrow_date,purpose,returned,return_date,email,batch_id,applied_at,category,confirmed_at,status,floor,unit,variant_id,variant_pending,request_no,picked_up_at,return_source,type_limit_exempt,type_limit_exempt_reason) VALUES (?,?,?,?,?,?,?,'O',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [row.borrower_name,employeeIdOf(row),row.item_id,row.item_label,qty,row.borrow_date,row.purpose,now,row.email,row.batch_id,row.applied_at,row.category,now,status,row.floor,row.unit,row.variant_id,row.variant_pending,row.request_no,row.picked_up_at,returnSource,row.type_limit_exempt,row.type_limit_exempt_reason]);
    return Number(inserted.lastInsertRowid);
  }
  run(`UPDATE ${table} SET returned='O', return_date=?, confirmed_at=?, status=?, return_source=? WHERE id=?`, [now, now, status, returnSource, row.id]);
  if (returnSource === "cancel") run(`UPDATE ${table} SET cancel_by='self', cancel_actor=? WHERE id=?`, [row.borrower_name || "", row.id]);
  return row.id;
}

function confirmSelectedPickup(r, now) {
  const { row, table, sheetType, parsed, rowQty, qty } = r;
  if (row.picked_up_at) return false;
  if (qty >= rowQty) {
    run(`UPDATE ${table} SET picked_up_at=? WHERE id=? AND picked_up_at IS NULL`, [now,row.id]);
    return true;
  }
  const remain = rowQty - qty;
  if (sheetType === "scenario") {
    run("UPDATE sid_rentals SET item_label=? WHERE id=?", [scenarioItemLabel({id:parsed.id,name:parsed.name,quantity:remain}),row.id]);
    run(`INSERT INTO sid_rentals (borrower_name,employee_id,sid,item_label,borrow_date,purpose,returned,return_date,email,batch_id,applied_at,item_type,confirmed_at,status,floor,unit,variant_id,variant_pending,request_no,picked_up_at,type_limit_exempt,type_limit_exempt_reason) VALUES (?,?,?,?,?,?,'X',NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [row.borrower_name,employeeIdOf(row),row.sid,scenarioItemLabel({id:parsed.id,name:parsed.name,quantity:qty}),row.borrow_date,row.purpose,row.email,row.batch_id,row.applied_at,row.item_type,row.confirmed_at,row.status||"active",row.floor,row.unit,row.variant_id,row.variant_pending,row.request_no,now,row.type_limit_exempt,row.type_limit_exempt_reason]);
  } else {
    run("UPDATE general_rentals SET qty=? WHERE id=?", [remain,row.id]);
    run(`INSERT INTO general_rentals (borrower_name,employee_id,item_id,item_label,qty,borrow_date,purpose,returned,return_date,email,batch_id,applied_at,category,confirmed_at,status,floor,unit,variant_id,variant_pending,request_no,picked_up_at,type_limit_exempt,type_limit_exempt_reason) VALUES (?,?,?,?,?,?,?,'X',NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [row.borrower_name,employeeIdOf(row),row.item_id,row.item_label,qty,row.borrow_date,row.purpose,row.email,row.batch_id,row.applied_at,row.category,row.confirmed_at,row.status||"active",row.floor,row.unit,row.variant_id,row.variant_pending,row.request_no,now,row.type_limit_exempt,row.type_limit_exempt_reason]);
  }
  return true;
}

function preparePhotoOperation(operation, body, user) {
  const selections=body.items;
  if (!Array.isArray(selections) || !selections.length || selections.length>200) throw badRequest('처리할 물품을 1~200건 선택해주세요.');
  const keys=selections.map(item=>item.sheetType+':'+item.rowIndex);
  if (new Set(keys).size!==keys.length) throw badRequest('같은 물품이 중복 선택되었습니다.');
  const resolved=selections.map(resolveSelected);
  if (operation === 'return') for (const r of resolved) if (!r.selection.damaged) assertNormalObjectReturn(r.sheetType,r.row.id,r.qty);
  if (resolved.some(r=>employeeIdOf(r.row)!==user.employeeId)) throw badRequest('로그인한 본인의 물품만 처리할 수 있습니다.');
  if (operation==='pickup' && resolved.some(r=>r.row.picked_up_at)) throw badRequest('이미 수령 확인된 물품입니다. 목록을 다시 확인해주세요.');
  if (operation==='pickup' && resolved.some(r=>r.row.variant_pending==='Y')) throw badRequest('종류 확인이 필요한 물품은 관리자 확인 후 수령할 수 있습니다.');
  const hasDamage=operation==='return' && resolved.some(r=>!!r.selection.damaged);
  if (hasDamage && (!body.damagePhoto || resolved.some(r=>r.selection.damaged && !String(r.selection.reason || '').trim()))) throw badRequest('파손 사진과 파손 사유를 확인해주세요.');
  const evidence=resolved.map(r=>({sheetType:r.sheetType,rowIndex:r.row.id,employeeId:employeeIdOf(r.row),quantity:r.qty,rowQuantity:r.rowQty,itemName:r.parsed.name || r.row.item_label,requestNo:r.row.request_no || null}));
  return {resolved,hasDamage,evidence};
}
function commitPhotoOperation(operation, body, prepared, saved) {
  const {resolved}=prepared, {now,imagePath,damageImagePath}=saved;
  const photoItems=resolved.map(r=>{
    const item=itemFromRow(r.sheetType,r.row);
    return {itemLabel:item.itemName,borrower:r.row.borrower_name || '',location:item.location || '',itemId:item.itemId,sheetType:r.sheetType,
      ...scenarioVariantInfo(item.itemId,!r.row.variant_id && r.row.variant_pending!=='Y' && r.selection.variantId ? {variantId:r.selection.variantId} : r.row),
      borrowDate:r.row.borrow_date || '',qty:r.qty,action:operation==='pickup' ? '대여 확인' : r.selection.damaged ? '파손 신고' : '반납'};
  });
  if (operation==='pickup') {
    run('INSERT INTO unattended_pickup_photos (client_id,request_no,created_at,image_path,items_json) VALUES (?,NULL,?,?,?)',[body.clientId,now,imagePath,JSON.stringify(photoItems)]);
    for(const r of resolved) confirmSelectedPickup(r,now);
    return {};
  }
  run("INSERT INTO return_photos (occurred_at,image_path,summary,items_json,client_id,source) VALUES (?,?,?,?,?,'unattended')",
    [now,imagePath,'무인 반납 · '+(resolved[0]?.row.borrower_name || ''),JSON.stringify(photoItems),body.clientId]);
  const batchId=Number(run('INSERT INTO unattended_return_batches (client_id,created_at,borrower_name,request_codes_json,items_json,image_path) VALUES (?,?,?,?,?,?)',
    [body.clientId,now,resolved[0]?.row.borrower_name || '',JSON.stringify([]),JSON.stringify(body.items),imagePath]).lastInsertRowid);
  for(const r of resolved){
    const damaged=!!r.selection.damaged;
    const returnedRowId=finishRental(r,now,damaged ? 'damage_pending' : 'archived');
    if(damaged) run("INSERT INTO unattended_damage_pending (batch_id,sheet_type,rental_row_id,item_id,item_name,qty,reason,image_path,status,created_at,source_rental_row_id) VALUES (?,?,?,?,?,?,?,?,'pending',?,?)",
      [batchId,r.sheetType,returnedRowId,padSlot(r.parsed.id || ''),r.parsed.name || r.row.item_label,r.qty,String(r.selection.reason).trim(),damageImagePath,now,r.row.id]);
    else restoreRentalStock(r.row,r.parsed.id,r.qty,{variantId:r.selection.variantId});
  }
  return {batchId,lookupPath:REQUEST_LOOKUP_PATH};
}
async function processPhotoOperation(operation,req,res){
  const body=req.body || {};
  try{
    // 배포 전에 완료된 요청도 본인 소유권을 검사한 뒤 중복 실행 없이 확인한다.
    const table=operation==='pickup' ? 'unattended_pickup_photos' : 'unattended_return_batches';
    const legacy=get('SELECT * FROM '+table+' WHERE client_id=?',[String(body.clientId || '')]);
    if(legacy && !get('SELECT id FROM unattended_operations WHERE client_id=?',[String(body.clientId || '')])){
      const selected=Array.isArray(body.items) ? body.items : [];
      if(!selected.length || selected.some(item=>{
        if(!['scenario','general'].includes(item.sheetType)) return true;
        const row=get('SELECT * FROM '+(item.sheetType==='scenario' ? 'sid_rentals' : 'general_rentals')+' WHERE id=?',[Number(item.rowIndex)]);
        return !row || employeeIdOf(row)!==req.kioskUser.employeeId;
      })) throw badRequest('본인의 완료된 요청만 확인할 수 있습니다.');
      if(operation==='return'){
        let saved=[];try{saved=JSON.parse(legacy.items_json || '[]');}catch{}
        if(operationFingerprint(operation,saved)!==operationFingerprint(operation,selected))throw badRequest('완료된 반납 요청과 선택 내용이 다릅니다.');
      }else{
        let saved=[];try{saved=JSON.parse(legacy.items_json || '[]');}catch{}
        const snapshot=selected.map(item=>{
          const row=get('SELECT * FROM '+(item.sheetType==='scenario'?'sid_rentals':'general_rentals')+' WHERE id=?',[Number(item.rowIndex)]);
          const parsed=item.sheetType==='scenario'?parseItemLabel(row.item_label):{id:row.item_id};
          return {sheetType:item.sheetType,itemId:padSlot(parsed.id),borrowDate:row.borrow_date || '',qty:Number(item.quantity)};
        });
        const keys=items=>items.map(item=>JSON.stringify([item.sheetType,padSlot(item.itemId),item.borrowDate || '',Number(item.qty)])).sort().join('|');
        if(keys(saved)!==keys(snapshot))throw badRequest('완료된 수령 요청과 선택 내용이 다릅니다.');
      }
      return res.json({success:true,duplicate:true,completed:true,photoSaved:!!legacy.image_path,clientId:body.clientId,operation,operationId:legacy.id,
        ...(operation==='return' ? {batchId:legacy.id,lookupPath:REQUEST_LOOKUP_PATH} : {})});
    }
    const result=await executePhotoOperation({operation,employeeId:req.kioskUser.employeeId,borrowerName:req.kioskUser.name,body,
      prepare:()=>preparePhotoOperation(operation,body,req.kioskUser),
      commit:(prepared,saved)=>commitPhotoOperation(operation,body,prepared,saved)});
    smSyncNudge();
    res.json(result);
  }catch(error){
    console.error('[unattended:'+operation+'] operation='+(error.operationId || 'not-received')+' '+error.message);
    res.status(error.status || 500).json({success:false,error:error.status ? error.message : '사진 또는 장부 처리를 완료하지 못했습니다. 촬영본을 유지한 채 다시 확인해주세요.',
      ...(error.operationId ? {operationId:error.operationId,photoReceived:true,adminReview:true} : {})});
  }
}
unattendedRouter.post('/unattended/return',requireKioskUser,(req,res)=>processPhotoOperation('return',req,res));
unattendedRouter.post('/unattended/confirm-pickup',requireKioskUser,(req,res)=>processPhotoOperation('pickup',req,res));
unattendedRouter.get('/unattended/operation-status',requireKioskUser,(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.json({success:true,...operationStatus(req.query.clientId,req.kioskUser.employeeId)});
});
unattendedRouter.get('/unattended/operation-reviews',requireAdmin,(_req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.json({success:true,items:pendingOperationReviews()});
});
unattendedRouter.post('/unattended/operation-reviews/:id/close',requireAdmin,(req,res)=>{
  try{
    closeOperationReview(req.params.id,req.admin.name || req.admin.loginId,req.body?.note);
    res.json({success:true});
  }catch(error){res.status(error.status || 500).json({success:false,error:error.message});}
});
