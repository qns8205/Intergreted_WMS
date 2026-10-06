import { all, get, run, transaction } from "../db.js";
import { registeredUser } from "./registeredUsers.js";
import { applyWarehouseRent, warehouseIsConsumable, warehouseLoanGroups } from "./warehouseRentals.js";
import { saveImage } from "./images.js";
import { nowKst } from "./time.js";
import { unattendedEnabled } from "./unattendedPenalties.js";

const normalizeName = value => String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
const receipt = id => {
  const items = all("SELECT i.status,i.reason,i.entered_name AS name,i.qty,l.type FROM warehouse_manual_request_items i LEFT JOIN warehouse_rental_logs l ON l.id=i.rental_log_id WHERE i.request_id=? ORDER BY i.id", [id]);
  return { requestId: Number(id), processed: items.filter(i => i.status === "resolved").length, pending: items.filter(i => i.status === "pending").length, items };
};
function readyItem(item, qty) {
  if (!item || warehouseIsConsumable(item.archived)) return "재고 물품을 연결해주세요.";
  if (item.stock === null || String(item.stock).trim() === "" || !Number.isFinite(Number(item.stock))) return "재고 수량 확인이 필요합니다.";
  if (Number(item.stock) < qty) return `재고 확인 필요: 현재 ${item.stock}개`;
  return "";
}
function linkLine(line, request, item, resolver) {
  const reason = readyItem(item, line.qty);
  if (reason) throw Error(reason);
  const log = applyWarehouseRent({ itemId: item.id, type: "대여", qty: line.qty, user: request.borrower_name, employeeId: request.employee_id,
    location: item.location, name: item.name, resolveLoan: false,
    note: `무인 공구 신청 #${request.id} · 사용 층 ${request.floor} · 입력명: ${line.entered_name}` });
  run("UPDATE warehouse_manual_request_items SET item_id=?,status='resolved',reason=NULL,rental_log_id=?,resolved_at=?,resolver=? WHERE id=? AND status='pending'",
    [item.id, log.id, nowKst(), resolver, line.id]);
}

export async function recordWarehouseManualRequest(payload, savePhoto = saveImage) {
  if (!unattendedEnabled()) throw Error("무인 모드가 켜져 있을 때만 공구를 신청할 수 있습니다.");
  const user = registeredUser(payload.employeeId);
  if (!user) throw Error("등록된 사번을 확인해주세요.");
  const clientId = String(payload.clientId || "");
  if (!/^[a-zA-Z0-9_-]{12,80}$/.test(clientId)) throw Error("신청 식별자가 올바르지 않습니다.");
  const existing = get("SELECT id,employee_id FROM warehouse_manual_requests WHERE client_id=?", [clientId]);
  if (existing) {
    if (existing.employee_id !== user.employee_id) throw Error("다른 사용자의 신청 식별자입니다.");
    return receipt(existing.id);
  }
  const floor = String(payload.floor || "").trim();
  const map = JSON.parse(get("SELECT value FROM settings WHERE key='floor_plan'")?.value || '{"floors":[]}');
  if (!floor || floor.length > 32 || (map.floors?.length && !map.floors.some(f => f.id === floor || f.name === floor))) throw Error("사용할 층수를 선택해주세요.");
  if (!Array.isArray(payload.items) || !payload.items.length || payload.items.length > 30) throw Error("공구 이름을 입력해주세요. 한 번에 최대 30개 항목을 신청할 수 있습니다.");
  const lines = payload.items.map(item => {
    const name = String(item.name || "").trim(), qty = Number(item.qty);
    if (!name || name.length > 150 || !Number.isInteger(qty) || qty < 1 || qty > 999) throw Error("공구 이름과 수량(1~999개)을 확인해주세요.");
    const itemId = item.itemId;
    if (itemId !== undefined && (!Number.isSafeInteger(itemId) || itemId <= 0)) throw Error("선택한 공구를 다시 확인해주세요.");
    return { name, qty, itemId };
  });
  if (typeof payload.photo !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(payload.photo) || payload.photo.length > 12 * 1024 * 1024) throw Error("물품 사진을 촬영해주세요. 사진은 12MB 이하여야 합니다.");
  const image = await savePhoto(payload.photo, "warehouse_requests", clientId);
  return transaction(() => {
    // Two retries can arrive while photo encoding is still in flight.
    const duplicate = get("SELECT id,employee_id FROM warehouse_manual_requests WHERE client_id=?", [clientId]);
    if (duplicate) {
      if (duplicate.employee_id !== user.employee_id) throw Error("다른 사용자의 신청 식별자입니다.");
      return receipt(duplicate.id);
    }
    const result = run("INSERT INTO warehouse_manual_requests (client_id,employee_id,borrower_name,floor,occurred_at,image_path) VALUES (?,?,?,?,?,?)",
      [clientId, user.employee_id, user.name, floor, nowKst(), image.url]);
    const request = get("SELECT * FROM warehouse_manual_requests WHERE id=?", [result.lastInsertRowid]);
    for (const line of lines) {
      const candidates = all("SELECT * FROM warehouse_items").filter(i => !warehouseIsConsumable(i.archived) && normalizeName(i.name) === normalizeName(line.name) && (line.itemId === undefined || i.id === line.itemId));
      const reason = candidates.length !== 1 ? (candidates.length ? "동일한 이름의 물품이 여러 개입니다." : "입력 이름에 해당하는 물품을 연결해주세요.") : readyItem(candidates[0], line.qty);
      const inserted = run("INSERT INTO warehouse_manual_request_items (request_id,entered_name,qty,reason) VALUES (?,?,?,?)", [request.id, line.name, line.qty, reason || null]);
      if (!reason) linkLine({ id: inserted.lastInsertRowid, entered_name: line.name, qty: line.qty }, request, candidates[0], line.itemId === undefined ? "이름 일치 자동 연결" : "검색 후보 본인 선택");
    }
    return receipt(request.id);
  });
}

export function pendingWarehouseManualRequests() {
  return all(`SELECT i.*,r.employee_id,r.borrower_name,r.floor,r.occurred_at,r.image_path
    FROM warehouse_manual_request_items i JOIN warehouse_manual_requests r ON r.id=i.request_id
    WHERE i.status='pending' ORDER BY r.id DESC,i.id LIMIT 200`);
}
export function resolveWarehouseManualRequest(id, itemId, resolver) {
  return transaction(() => {
    const line = get("SELECT * FROM warehouse_manual_request_items WHERE id=?", [Number(id)]);
    if (!line) throw Error("신청 항목을 찾지 못했습니다.");
    if (line.status === "resolved") return { alreadyResolved: true };
    if (line.status !== "pending") throw Error("이미 처리된 신청입니다.");
    const request = get("SELECT * FROM warehouse_manual_requests WHERE id=?", [line.request_id]);
    const item = get("SELECT * FROM warehouse_items WHERE id=?", [Number(itemId)]);
    linkLine(line, request, item, resolver);
    return { alreadyResolved: false };
  });
}

/** 대여자는 사번으로 자기 공구만 조회한다. 소모 기록은 대여 장부에 없으므로 제외된다. */
export function outstandingWarehouseTools(employeeId) {
  const user = registeredUser(employeeId);
  if (!user) throw Error("등록된 사번을 확인해주세요.");
  const items = [];
  for (const [key, group] of warehouseLoanGroups()) {
    if (group.employeeId !== user.employee_id || group.qty <= 0) continue;
    const stock = get("SELECT image_path FROM warehouse_items WHERE location=? AND name=?", [group.location, group.name]);
    items.push({ key: `loan:${key}`, name: group.name, qty: group.qty, image: stock?.image_path || "", borrowedAt: group.lastDate, pending: false });
  }
  for (const line of all(`SELECT i.*,r.image_path,r.occurred_at FROM warehouse_manual_request_items i
    JOIN warehouse_manual_requests r ON r.id=i.request_id WHERE r.employee_id=? AND i.status='pending'`, [user.employee_id])) {
    items.push({ key: `request:${line.id}`, name: line.entered_name, qty: line.qty, image: line.image_path, borrowedAt: line.occurred_at, pending: true });
  }
  return { employeeId: user.employee_id, name: user.name, items };
}
export async function returnWarehouseTools(payload, savePhoto = saveImage) {
  if (!unattendedEnabled()) throw Error("무인 모드가 켜져 있을 때만 직접 반납할 수 있습니다.");
  const user = registeredUser(payload.employeeId);
  if (!user) throw Error("등록된 사번을 확인해주세요.");
  const clientId = String(payload.clientId || "");
  if (!/^[a-zA-Z0-9_-]{12,80}$/.test(clientId)) throw Error("반납 식별자가 올바르지 않습니다.");
  const existingReceipt = () => {
    const prior = get("SELECT * FROM warehouse_manual_returns WHERE client_id=?", [clientId]);
    if (!prior) return null;
    const items = JSON.parse(prior.items_json || "[]");
    if (prior.employee_id !== user.employee_id) throw Error("다른 사용자의 반납 식별자입니다.");
    return { returnId: prior.id, items };
  };
  const existing = existingReceipt();
  if (existing) return existing;
  if (!Array.isArray(payload.items) || !payload.items.length || payload.items.length > 200) throw Error("반납할 공구를 선택해주세요.");
  const selected = payload.items.map(i => ({ key: String(i.key || ""), qty: Number(i.qty) }));
  if (new Set(selected.map(i => i.key)).size !== selected.length || selected.some(i => !Number.isFinite(i.qty) || i.qty <= 0)) throw Error("반납 물품과 수량을 확인해주세요.");
  if (typeof payload.photo !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(payload.photo) || payload.photo.length > 12 * 1024 * 1024) throw Error("반납 사진을 촬영해주세요.");
  const image = await savePhoto(payload.photo, "warehouse_returns", clientId);
  return transaction(() => {
    const duplicate = existingReceipt();
    if (duplicate) return duplicate;
    const mine = outstandingWarehouseTools(user.employee_id).items;
    const snapshots = [];
    for (const chosen of selected) {
      const current = mine.find(i => i.key === chosen.key);
      if (!current || chosen.qty > current.qty) throw Error("이미 반납되었거나 대여 수량이 변경되었습니다. 목록을 새로 불러와주세요.");
      if (current.pending) {
        const id = Number(chosen.key.slice("request:".length));
        // 재고 연결 전 반납은 추측해서 재고를 늘리지 않고, 사진과 반납 기록만 남긴다.
        if (chosen.qty === current.qty) run("UPDATE warehouse_manual_request_items SET status='returned',resolved_at=?,resolver='연결 전 본인 반납' WHERE id=?", [nowKst(), id]);
        else run("UPDATE warehouse_manual_request_items SET qty=qty-? WHERE id=?", [chosen.qty, id]);
      } else {
        const group = warehouseLoanGroups().get(chosen.key.slice("loan:".length));
        if (!group || group.employeeId !== user.employee_id) throw Error("본인의 대여 물품만 반납할 수 있습니다.");
        applyWarehouseRent({ type: "반납", qty: chosen.qty, employeeId: user.employee_id, user: user.name, name: group.name, location: group.location, note: "무인 공구 본인 반납 · 사진 확인 기록" });
      }
      snapshots.push({ name: current.name, itemLabel: current.name, qty: chosen.qty, action: "반납", borrower: user.name, employeeId: user.employee_id, borrowDate: current.borrowedAt, pending: current.pending, sheetType: "warehouse" });
    }
    const saved = run("INSERT INTO warehouse_manual_returns (client_id,employee_id,occurred_at,items_json) VALUES (?,?,?,?)", [clientId, user.employee_id, nowKst(), JSON.stringify(snapshots)]);
    run("INSERT INTO return_photos (occurred_at,image_path,summary,items_json,source,client_id) VALUES (?,?,?,?,?,?)", [nowKst(), image.url, `무인 공구 반납 · ${user.name} (${user.employee_id}) · ${snapshots.length}종`, JSON.stringify(snapshots), "unattended", `tool-return:${clientId}`]);
    return { returnId: Number(saved.lastInsertRowid), items: snapshots };
  });
}
