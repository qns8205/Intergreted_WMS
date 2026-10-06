import { Router } from "express";
import crypto from "node:crypto";
import { all, get, run, transaction } from "../db.js";
import { requireAdmin } from "../lib/auth.js";
import { maybeSaveImage } from "../lib/images.js";
import { parseItemLabel, padSlot, releaseRentedWithoutRestock, restoreRentalStock, scenarioItemLabel } from "../lib/borrowUtils.js";
import { employeeIdForRentalRow, registeredUser } from "../lib/registeredUsers.js";
import { REQUEST_LOOKUP_PATH } from "./requestLookup.js";
import { nowKst } from "../lib/time.js";
import { nudge as smSyncNudge } from "../lib/smSync.js";

export const unattendedRouter = Router();
const DEVICE_HEADER = "x-unattended-device";

function setting(key) { return get("SELECT value FROM settings WHERE key = ?", [key])?.value || ""; }
function saveSetting(key, value) {
  run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, String(value)]);
}
function digest(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function safeEqual(a, b) {
  const aa = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function enabled() { return setting("unattended_enabled") === "1"; }
function validDevice(req) {
  const expected = setting("unattended_device_hash");
  const token = req.header(DEVICE_HEADER) || "";
  return !!expected && !!token && safeEqual(digest(token), expected);
}
function requireDevice(req, res, next) {
  if (!enabled()) return res.status(403).json({ success: false, error: "현재 무인 모드가 아닙니다." });
  if (!validDevice(req)) return res.status(403).json({ success: false, error: "등록된 무인 반납 PC에서만 사용할 수 있습니다." });
  next();
}

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
  transaction(() => {
    if (action === "confirmed") {
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
    pickedUp: !!row.picked_up_at, variantId: row.variant_id || null, variantPending: row.variant_pending === "Y",
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
unattendedRouter.post("/unattended/find-mine", requireDevice, (req, res) => {
  const employeeId = String(req.body?.employeeId || "").trim();
  const user = registeredUser(employeeId);
  if (!user) return res.status(404).json({ success: false, error: "등록된 사번을 찾지 못했습니다." });
  const items = outstandingForEmployee(user.employee_id);
  res.json({ success: true, employeeId: user.employee_id, borrowerName: user.name, items: req.body?.operation === "pickup" ? items.filter((item) => !item.pickedUp) : items });
});

// 사용자가 고칠 수 있는 거절 사유. 전역 오류 처리기로 넘기면 "서버 오류"로 뭉개지므로
// 각 라우트가 이 표시를 보고 사유를 그대로 돌려준다.
function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function resolveSelected(selection) {
  const sheetType = selection.sheetType === "scenario" ? "scenario" : "general";
  const table = sheetType === "scenario" ? "sid_rentals" : "general_rentals";
  const row = get(`SELECT * FROM ${table} WHERE id = ?`, [Number(selection.rowIndex)]);
  if (!row || row.returned === "O") throw badRequest("이미 반납되었거나 존재하지 않는 물품이 포함되어 있습니다. 로그아웃 후 다시 로그인해주세요.");
  const parsed = sheetType === "scenario" ? parseItemLabel(row.item_label) : { id: row.item_id, name: row.item_label, quantity: Number(row.qty) || 1 };
  const rowQty = Number(parsed.quantity) || 1;
  const qty = Math.min(rowQty, Math.max(1, Number(selection.quantity) || rowQty));
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
      const inserted = run(`INSERT INTO sid_rentals (borrower_name,employee_id,sid,item_label,borrow_date,purpose,returned,return_date,email,batch_id,applied_at,item_type,confirmed_at,status,floor,unit,variant_id,variant_pending,request_no,picked_up_at,return_source) VALUES (?,?,?,?,?,?,'O',?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [row.borrower_name,employeeIdOf(row),row.sid,scenarioItemLabel({ id: parsed.id,name: parsed.name,quantity: qty }),row.borrow_date,row.purpose,now,row.email,row.batch_id,row.applied_at,row.item_type,now,status,row.floor,row.unit,row.variant_id,row.variant_pending,row.request_no,row.picked_up_at,returnSource]);
      return Number(inserted.lastInsertRowid);
    }
    run("UPDATE general_rentals SET qty = ? WHERE id = ?", [remain, row.id]);
    const inserted = run(`INSERT INTO general_rentals (borrower_name,employee_id,item_id,item_label,qty,borrow_date,purpose,returned,return_date,email,batch_id,applied_at,category,confirmed_at,status,floor,unit,variant_id,variant_pending,request_no,picked_up_at,return_source) VALUES (?,?,?,?,?,?,?,'O',?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [row.borrower_name,employeeIdOf(row),row.item_id,row.item_label,qty,row.borrow_date,row.purpose,now,row.email,row.batch_id,row.applied_at,row.category,now,status,row.floor,row.unit,row.variant_id,row.variant_pending,row.request_no,row.picked_up_at,returnSource]);
    return Number(inserted.lastInsertRowid);
  }
  run(`UPDATE ${table} SET returned='O', return_date=?, confirmed_at=?, status=?, return_source=? WHERE id=?`, [now, now, status, returnSource, row.id]);
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
    run(`INSERT INTO sid_rentals (borrower_name,employee_id,sid,item_label,borrow_date,purpose,returned,return_date,email,batch_id,applied_at,item_type,confirmed_at,status,floor,unit,variant_id,variant_pending,request_no,picked_up_at) VALUES (?,?,?,?,?,?,'X',NULL,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [row.borrower_name,employeeIdOf(row),row.sid,scenarioItemLabel({id:parsed.id,name:parsed.name,quantity:qty}),row.borrow_date,row.purpose,row.email,row.batch_id,row.applied_at,row.item_type,row.confirmed_at,row.status||"active",row.floor,row.unit,row.variant_id,row.variant_pending,row.request_no,now]);
  } else {
    run("UPDATE general_rentals SET qty=? WHERE id=?", [remain,row.id]);
    run(`INSERT INTO general_rentals (borrower_name,employee_id,item_id,item_label,qty,borrow_date,purpose,returned,return_date,email,batch_id,applied_at,category,confirmed_at,status,floor,unit,variant_id,variant_pending,request_no,picked_up_at) VALUES (?,?,?,?,?,?,?,'X',NULL,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [row.borrower_name,employeeIdOf(row),row.item_id,row.item_label,qty,row.borrow_date,row.purpose,row.email,row.batch_id,row.applied_at,row.category,row.confirmed_at,row.status||"active",row.floor,row.unit,row.variant_id,row.variant_pending,row.request_no,now]);
  }
  return true;
}

unattendedRouter.post("/unattended/return", requireDevice, async (req, res, next) => {
  let returnPhotoId = 0;
  try {
    const clientId = String(req.body?.clientId || "").trim();
    const selections = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!clientId || !selections.length) return res.status(400).json({ success: false, error: "반납할 물품을 선택해주세요." });
    if (typeof req.body?.photo !== "string" || !req.body.photo.startsWith("data:image/")) return res.status(400).json({ success: false, error: "반납 사진을 먼저 촬영해주세요." });
    const previous = get("SELECT * FROM unattended_return_batches WHERE client_id = ?", [clientId]);
    if (previous) return res.json({ success: true, duplicate: true, batchId: previous.id, lookupPath: REQUEST_LOOKUP_PATH });
    // 앞선 요청이 사진 저장까지만 끝나고 실제 반납 트랜잭션 전에 끊겼다면 같은 clientId로
    // 안전하게 다시 시도할 수 있어야 한다.
    const incompletePhoto = get("SELECT id FROM return_photos WHERE client_id=?", [clientId]);
    if (incompletePhoto) run("DELETE FROM return_photos WHERE id=?", [incompletePhoto.id]);
    const resolved = selections.map(resolveSelected);
    const employeeIds = [...new Set(resolved.map((r) => employeeIdOf(r.row)).filter(Boolean))];
    if (employeeIds.length !== 1) throw badRequest("한 사번의 물품만 한 번에 반납해주세요.");
    const hasDamage = resolved.some((r) => !!r.selection.damaged);
    if (hasDamage && (typeof req.body?.damagePhoto !== "string" || !req.body.damagePhoto.startsWith("data:image/"))) {
      return res.status(400).json({ success: false, error: "파손된 물품 사진을 촬영해주세요." });
    }
    for (const r of resolved) {
      if (r.selection.damaged && !String(r.selection.reason || "").trim()) {
        return res.status(400).json({ success: false, error: `'${r.parsed.name || r.row.item_label}'의 파손 사유를 입력해주세요.` });
      }
    }
    // 무인 반납도 일반 관리자 반납과 같은 사진함에 넣는다. 그래야 관리자가 기존
    // "대여·반납 사진" 화면 한 곳에서 모든 반납 증빙을 함께 확인할 수 있다.
    const photoItems = resolved.map((r) => {
      const item = itemFromRow(r.sheetType, r.row);
      return {
        itemLabel: item.itemName, borrower: r.row.borrower_name || "", location: item.location || "",
        borrowDate: r.row.borrow_date || "", qty: r.qty, action: r.selection.damaged ? "파손 신고" : "반납",
      };
    });
    const now = nowKst();
    const photoRow = run(
      "INSERT INTO return_photos (occurred_at,image_path,summary,items_json,client_id,source) VALUES (?,NULL,?,?,?,'unattended')",
      [now,`무인 반납 · ${resolved[0]?.row.borrower_name || "대여자 미상"}`,JSON.stringify(photoItems),clientId],
    );
    returnPhotoId = Number(photoRow.lastInsertRowid);
    const imagePath = await maybeSaveImage(req.body.photo, "return_photos", returnPhotoId);
    run("UPDATE return_photos SET image_path=? WHERE id=?", [imagePath,returnPhotoId]);
    const damageImagePath = hasDamage ? await maybeSaveImage(req.body.damagePhoto, "unattended_damage", clientId) : null;
    let batchId = 0;
    transaction(() => {
      const inserted = run("INSERT INTO unattended_return_batches (client_id,created_at,borrower_name,request_codes_json,items_json,image_path) VALUES (?,?,?,?,?,?)",
        [clientId,now,resolved[0]?.row.borrower_name || "",JSON.stringify([]),JSON.stringify(selections),imagePath]);
      batchId = Number(inserted.lastInsertRowid);
      for (const r of resolved) {
        const damaged = !!r.selection.damaged;
        const returnedRowId = finishRental(r, now, damaged ? "damage_pending" : "archived");
        if (damaged) {
          run("INSERT INTO unattended_damage_pending (batch_id,sheet_type,rental_row_id,item_id,item_name,qty,reason,image_path,status,created_at) VALUES (?,?,?,?,?,?,?,?, 'pending',?)",
            [batchId,r.sheetType,returnedRowId,padSlot(r.parsed.id || ""),r.parsed.name || r.row.item_label,r.qty,String(r.selection.reason || "").trim(),damageImagePath,now]);
        } else restoreRentalStock(r.row, r.parsed.id, r.qty, { variantId: r.selection.variantId });
      }
    });
    smSyncNudge();
    res.json({ success: true, batchId, employeeId: employeeIds[0], lookupPath: REQUEST_LOOKUP_PATH });
  } catch (error) {
    // 실제 반납 처리가 실패했다면 사진함에 성공한 반납처럼 보이는 행을 남기지 않는다.
    if (returnPhotoId) run("DELETE FROM return_photos WHERE id=?", [returnPhotoId]);
    if (error.status) return res.status(error.status).json({ success: false, error: error.message });
    next(error);
  }
});

unattendedRouter.post("/unattended/confirm-pickup", requireDevice, async (req, res, next) => {
  try {
    const clientId = String(req.body?.clientId || "").trim();
    const selections = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!clientId || !selections.length || typeof req.body?.photo !== "string" || !req.body.photo.startsWith("data:image/")) return res.status(400).json({ success: false, error: "확인할 물품과 사진이 필요합니다." });
    const previous = get("SELECT id FROM unattended_pickup_photos WHERE client_id = ?", [clientId]);
    if (previous) return res.json({ success: true, duplicate: true });
    const resolved = selections.map(resolveSelected);
    const employeeIds = [...new Set(resolved.map((r) => employeeIdOf(r.row)).filter(Boolean))];
    if (employeeIds.length !== 1) return res.status(400).json({ success: false, error: "한 사번의 물품만 한 번에 확인해주세요." });
    const rows = resolved.map((r) => itemFromRow(r.sheetType, r.row));
    if (!rows.length) return res.status(400).json({ success: false, error: "대여 확인할 물품이 없습니다." });
    if (rows.some((r) => r.variantPending)) return res.status(400).json({ success: false, error: "종류 확인이 필요한 물품은 관리자 확인 후 수령할 수 있습니다." });
    const imagePath = await maybeSaveImage(req.body.photo, "unattended_pickups", clientId);
    const now = nowKst();
    const photoItems = resolved.map((r, index) => ({
      itemLabel: rows[index].itemName, borrower: r.row.borrower_name || "", location: rows[index].location || "",
      borrowDate: r.row.borrow_date || "", qty: r.qty, action: "대여 확인",
    }));
    transaction(() => {
      run("INSERT INTO unattended_pickup_photos (client_id,request_no,created_at,image_path,items_json) VALUES (?,NULL,?,?,?)", [clientId,now,imagePath,JSON.stringify(photoItems)]);
      for (const r of resolved) confirmSelectedPickup(r, now);
    });
    smSyncNudge();
    res.json({ success: true, employeeId: employeeIds[0] });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ success: false, error: error.message });
    next(error);
  }
});
