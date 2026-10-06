import { all, get, run, transaction } from "../db.js";
import { nowKst } from "./time.js";
import { normalizeEmployeeId, normalizePersonName, registeredUsersByName, resolveRegisteredIdentity } from "./registeredUsers.js";

export function warehouseIsConsumable(value) {
  return !["", "false", "0", "x", "n", "no", "off"].includes(String(value ?? "").trim().toLowerCase());
}

function borrowerIdentity(employeeId, user) {
  let identity = resolveRegisteredIdentity(employeeId, user);
  if (!identity.ok && !String(employeeId || "").trim()) {
    const matches = registeredUsersByName(user);
    if (matches.length === 1) identity = { ok: true, employeeId: matches[0].employee_id, name: matches[0].name };
  }
  return { user: identity.ok ? identity.name : String(user || "").trim(), employeeId: identity.ok ? identity.employeeId : normalizeEmployeeId(employeeId), identity };
}

function loanKey(location, name, person) {
  return JSON.stringify([String(location || "").trim(), String(name || "").trim(), person.employeeId || normalizePersonName(person.user)]);
}

/** 새로 소모한 물품은 기존 대여 장부와 무관하다. 이미 빌린 물품의 소모 전환만 대여를 해소한다. */
export function warehouseLoanGroups(rows = all("SELECT * FROM warehouse_rental_logs ORDER BY id ASC")) {
  const groups = new Map();
  for (const row of rows) {
    const qty = Number(row.qty);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const note = String(row.note || "");
    const resolving = !note.includes("[신규출고]") && (note.includes("[소모완료]") || note.includes("[즉시반납]"));
    if (row.type === "소모" && !resolving) continue;
    if (!["대여", "반납", "소모"].includes(row.type)) continue;
    const person = borrowerIdentity(row.employee_id, row.manager);
    const location = String(row.location || "").trim(), name = String(row.name || "").trim();
    const key = loanKey(location, name, person);
    const group = groups.get(key) || { location, name, user: person.user || "(이름 없음)", employeeId: person.employeeId, qty: 0, lastDate: "" };
    if (row.type === "대여" && !resolving) {
      group.qty += qty;
      group.lastDate = row.occurred_at || group.lastDate;
    } else {
      group.qty = Math.max(0, group.qty - qty);
    }
    groups.set(key, group);
  }
  return groups;
}

function findWarehouseItem(entry) {
  if (entry.itemId !== undefined) return get("SELECT * FROM warehouse_items WHERE id=?", [Number(entry.itemId)]) || null;
  const exact = all("SELECT * FROM warehouse_items WHERE location=? AND name=?", [entry.location, entry.name]);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  // 대여 중 보관 위치가 변경된 경우, 같은 층 또는 유일한 동일 이름 물품으로 재고를 복구한다.
  const sameName = all("SELECT * FROM warehouse_items WHERE name=?", [entry.name]);
  const levelOf = (loc) => String(loc || "").trim().toUpperCase().split("-").slice(0, 2).join("-");
  const level = levelOf(entry.location);
  const sameLevel = level ? sameName.filter((item) => levelOf(item.location) === level) : [];
  if (sameLevel.length === 1) return sameLevel[0];
  const live = sameName.filter((item) => !warehouseIsConsumable(item.archived));
  return live.length === 1 ? live[0] : sameName.length === 1 ? sameName[0] : null;
}

/** 호출한 함수의 트랜잭션 안에서 재고와 이력을 함께 갱신한다. */
export function applyWarehouseRent(entry) {
  if (!["대여", "반납", "소모"].includes(entry.type)) throw new Error("대여 / 반납 / 소모 중 처리 방식을 선택해주세요.");
  const qty = Number(entry.qty);
  if (!Number.isFinite(qty) || qty <= 0) throw new Error("수량은 0보다 큰 숫자여야 합니다.");
  const person = borrowerIdentity(entry.employeeId, entry.user);
  if (String(entry.employeeId || "").trim() && !person.identity.ok) throw new Error(person.identity.error);
  if (!person.user) throw new Error("사용자를 선택해주세요.");
  const row = findWarehouseItem(entry);
  if (!row) throw new Error(`${entry.name || "물품"}: 재고 물품을 찾을 수 없습니다. 목록을 새로 불러와주세요.`);
  const resolving = entry.resolveLoan === undefined ? String(entry.note || "").includes("[소모완료]") : entry.resolveLoan === true;
  const closesLoan = entry.type === "반납" || resolving;
  if (closesLoan) {
    const outstanding = warehouseLoanGroups().get(loanKey(entry.location, entry.name, person))?.qty || 0;
    if (qty > outstanding) throw new Error(`${entry.name}: 현재 대여 중인 수량은 ${outstanding}개입니다. 목록을 다시 확인해주세요.`);
  } else if (warehouseIsConsumable(row.archived)) {
    throw new Error(`${row.name}: 보관 처리된 물품은 신청할 수 없습니다.`);
  }
  const type = !closesLoan && warehouseIsConsumable(row.consumable) ? "소모" : entry.type;
  const diff = resolving ? 0 : type === "반납" ? qty : -qty;
  const current = Number(row.stock);
  if (diff && (row.stock === null || String(row.stock).trim() === "" || !Number.isFinite(current))) throw new Error(`${row.name}: 재고 수량을 먼저 등록해주세요.`);
  if (diff < 0 && current < qty) throw new Error(`${row.name}: 재고가 부족합니다. 현재 ${current}개입니다.`);
  const at = nowKst();
  if (diff) {
    const next = current + diff;
    run("UPDATE warehouse_items SET stock=?, updated_at=? WHERE id=?", [String(next), at, row.id]);
    run(`INSERT INTO inventory_history (occurred_at,category,ref_id,item_name,before_val,after_val,diff,reason,manager) VALUES (?,'inventory',?,?,?,?,?,?,?)`,
      [at, String(row.id), row.name, current, next, diff, `공구 ${type}`, person.user]);
  }
  // 반납은 대여 당시 위치·품명과 매칭한다. 신규 신청은 현재 재고 물품의 정보를 기록한다.
  const result = run(`INSERT INTO warehouse_rental_logs (occurred_at,type,location,name,qty,manager,employee_id,note) VALUES (?,?,?,?,?,?,?,?)`,
    [at, type, closesLoan ? entry.location : row.location, closesLoan ? entry.name : row.name, qty, person.user, person.employeeId || null,
      entry.resolveLoan === false ? `[신규출고] ${entry.note || ""}`.trim() : entry.note || null]);
  return get("SELECT * FROM warehouse_rental_logs WHERE id=?", [result.lastInsertRowid]);
}

export function applyWarehouseRentBulk(items) {
  if (!Array.isArray(items) || !items.length) throw new Error("처리할 물품을 담아주세요.");
  // 한 줄이라도 실패하면 전부 되돌려, 재시도 시 성공했던 줄이 이중 차감되지 않게 한다.
  return transaction(() => {
    for (const entry of items) applyWarehouseRent(entry);
    return { processed: items.length, failed: [] };
  });
}
