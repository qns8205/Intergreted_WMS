// 대여자 본인이 들고 있는 물품을 다른 등록 사용자에게 넘기는 "양도".
//
// 관리자 화면의 양도는 "반납 → 받는 사람 이름으로 재대여"를 두 번의 요청으로 나눠 보내서,
// 두 번째가 실패하면 물건이 반납 상태로 남는다. 여기서는 한 트랜잭션 안에서
// 넘기는 사람의 대여 줄을 닫고 받는 사람의 대여 줄을 연다. 물건은 창고에 들어온 적이
// 없으므로 시나리오 물품의 재고·대여 중 수량은 건드리지 않는다.
import crypto from "node:crypto";
import { all, get, run, transaction } from "../db.js";
import { nowKst } from "./time.js";
import { padSlot, parseItemLabel, scenarioItemLabel, objectMap, variantMap, resolveBorrowerContact } from "./borrowUtils.js";
import { employeeIdForRentalRow, registeredUser } from "./registeredUsers.js";
import { applyWarehouseRent, warehouseLoanGroups, warehouseIsConsumable } from "./warehouseRentals.js";
import { assertNormalObjectReturn } from './objectReports.js';
import { validateRentalTerms } from '../../shared/rentalTerms.js';

const TABLES = { scenario: "sid_rentals", general: "general_rentals" };

/** 공구 대여는 위치+품명+사람으로 묶인다. 위치는 대여자에게 숨기므로 화면에는 해시만 준다. */
function warehouseKey(group) {
  const raw = JSON.stringify([group.location, group.name, group.employeeId]);
  return `warehouse:${crypto.createHash("sha256").update(raw).digest("hex").slice(0, 24)}`;
}

function myWarehouseGroups(employeeId) {
  return [...warehouseLoanGroups().values()].filter((g) => g.qty > 0 && g.employeeId === employeeId);
}

function rentalRowsOf(employeeId) {
  return Object.entries(TABLES).flatMap(([sheetType, table]) =>
    all(`SELECT * FROM ${table} WHERE (returned != 'O' OR returned IS NULL) ORDER BY id`)
      .filter((row) => employeeIdForRentalRow(row) === employeeId)
      .map((row) => ({ sheetType, row })));
}

function rentalShape(sheetType, row, objMap, vMap) {
  const parsed = sheetType === "scenario" ? parseItemLabel(row.item_label) : null;
  const itemId = padSlot((sheetType === "scenario" ? parsed.id : row.item_id) || "");
  const name = (sheetType === "scenario" ? parsed.name : row.item_label) || objMap[itemId]?.name || "물품";
  const quantity = sheetType === "scenario" ? parsed.quantity || 1 : Number(row.qty) || 1;
  const variant = row.variant_id ? (vMap[itemId] || []).find((v) => v.id === row.variant_id) : null;
  return { itemId, name, quantity, variantName: variant?.name || "", image: objMap[itemId]?.image || "" };
}

/** 이 대여 줄이 속한 신청의 대여 방식. 새 규칙 이전의 예전 대여는 mode가 null이다. */
function sourceTerms(row) {
  const src = row.request_no ? get("SELECT rental_mode, rental_reason, rental_due_date FROM rental_requests WHERE id = ?", [row.request_no]) : null;
  return src?.rental_mode ? { mode: src.rental_mode, reason: src.rental_reason || null, dueDate: src.rental_due_date || null } : null;
}

/** 양도 화면 첫 단계 — 지금 들고 있는 물품. 아직 받아 가지 않은 신청 줄은 넘길 실물이 없다. */
export function transferableItemsFor(employeeId) {
  const objMap = objectMap();
  const vMap = variantMap();
  const items = rentalRowsOf(employeeId).map(({ sheetType, row }) => {
    const shape = rentalShape(sheetType, row, objMap, vMap);
    const pickedUp = !!row.picked_up_at;
    return {
      key: `${sheetType}:${row.id}`,
      kind: "scenario",
      ...shape,
      scenarioId: sheetType === "scenario" ? row.sid || "" : "",
      borrowDate: row.borrow_date || "",
      transferable: pickedUp && row.variant_pending !== "Y",
      reason: pickedUp ? (row.variant_pending === "Y" ? "종류 확인 전" : "") : "대여 확인 전",
      // 대여 방식이 없는 예전 대여는 양도할 때 받는 사람의 방식을 골라야 한다.
      needsRentalMode: !sourceTerms(row),
    };
  });
  for (const group of myWarehouseGroups(employeeId)) {
    const item = get("SELECT image_path, consumable FROM warehouse_items WHERE location = ? AND name = ?", [group.location, group.name]);
    const consumable = item ? warehouseIsConsumable(item.consumable) : false;
    items.push({
      key: warehouseKey(group), kind: "warehouse", itemId: "", name: group.name, quantity: group.qty,
      variantName: "", image: item?.image_path || "", scenarioId: "", borrowDate: group.lastDate || "",
      transferable: !consumable, reason: consumable ? "소모품" : "",
    });
  }
  return items;
}

/** 넘길 줄의 일부 또는 전부를 "양도"로 닫는다. 재고는 되돌리지 않는다(물건이 창고에 오지 않았다). */
function closeForTransfer(sheetType, row, qty, now) {
  const table = TABLES[sheetType];
  const rowQty = sheetType === "scenario" ? parseItemLabel(row.item_label).quantity || 1 : Number(row.qty) || 1;
  if (qty >= rowQty) {
    run(`UPDATE ${table} SET returned = 'O', return_date = ?, confirmed_at = ?, status = 'archived', return_source = 'transfer' WHERE id = ?`, [now, now, row.id]);
    return;
  }
  const remain = rowQty - qty;
  if (sheetType === "scenario") {
    const item = parseItemLabel(row.item_label);
    run("UPDATE sid_rentals SET item_label = ? WHERE id = ?", [scenarioItemLabel({ id: item.id, name: item.name, quantity: remain }), row.id]);
    run(
      `INSERT INTO sid_rentals (borrower_name, sid, item_label, borrow_date, purpose, returned, return_date, email, batch_id, applied_at, item_type, confirmed_at, status, variant_id, variant_pending, request_no, return_source, floor, unit, employee_id, picked_up_at)
       VALUES (?, ?, ?, ?, ?, 'O', ?, ?, ?, ?, ?, ?, 'archived', ?, ?, ?, 'transfer', ?, ?, ?, ?)`,
      [row.borrower_name, row.sid, scenarioItemLabel({ id: item.id, name: item.name, quantity: qty }), row.borrow_date, row.purpose, now, row.email, row.batch_id, row.applied_at, row.item_type, now, row.variant_id, row.variant_pending, row.request_no, row.floor, row.unit, row.employee_id, row.picked_up_at],
    );
  } else {
    run("UPDATE general_rentals SET qty = ? WHERE id = ?", [remain, row.id]);
    run(
      `INSERT INTO general_rentals (borrower_name, item_id, item_label, qty, borrow_date, purpose, returned, return_date, email, batch_id, applied_at, category, confirmed_at, status, variant_id, variant_pending, request_no, return_source, floor, unit, employee_id, picked_up_at)
       VALUES (?, ?, ?, ?, ?, ?, 'O', ?, ?, ?, ?, ?, ?, 'archived', ?, ?, ?, 'transfer', ?, ?, ?, ?)`,
      [row.borrower_name, row.item_id, row.item_label, qty, row.borrow_date, row.purpose, now, row.email, row.batch_id, row.applied_at, row.category, now, row.variant_id, row.variant_pending, row.request_no, row.floor, row.unit, row.employee_id, row.picked_up_at],
    );
  }
}

/**
 * 고른 물품을 받는 사람 명의로 옮긴다. 하나라도 문제가 있으면 아무것도 바꾸지 않는다.
 * `checkTypeLimit(receiver, incomingItemIds)`는 받는 사람의 대여 가능 종류 한도를 확인한다(넘으면 throw).
 */
export function transferItems({ fromEmployeeId, toEmployeeId, items, floor, unit, checkTypeLimit, rentalTerms }) {
  const giver = registeredUser(fromEmployeeId);
  if (!giver) throw new Error("로그인한 사용자를 확인할 수 없습니다. 다시 로그인해주세요.");
  const receiver = registeredUser(toEmployeeId);
  if (!receiver || receiver.employee_id === "0000") throw new Error("양도받을 사람을 명부에서 선택해주세요.");
  if (receiver.employee_id === giver.employee_id) throw new Error("본인에게는 양도할 수 없습니다.");
  if (!Array.isArray(items) || !items.length) throw new Error("양도할 물품을 선택해주세요.");
  if (items.length > 200) throw new Error("한 번에 양도할 수 있는 물품 수를 넘었습니다.");
  const seatFloor = String(floor || "").trim();
  const seatUnit = String(unit || "").trim();

  const requested = new Map();
  for (const raw of items) {
    const key = String(raw?.key || "");
    const qty = Math.trunc(Number(raw?.quantity));
    if (!key || !Number.isFinite(qty) || qty <= 0) throw new Error("양도할 수량을 다시 확인해주세요.");
    requested.set(key, (requested.get(key) || 0) + qty);
  }

  const now = nowKst();
  const note = `${giver.name}님 → ${receiver.name}님 양도`;
  const contact = resolveBorrowerContact({ affiliation: "cfgw", employeeId: receiver.employee_id, borrowerName: receiver.name });
  const objMap = objectMap();
  const vMap = variantMap();

  return transaction(() => {
    // 화면을 연 뒤에 반납·대여 확인이 끼어들었을 수 있으므로 트랜잭션 안에서 다시 읽는다.
    const rentalRows = new Map(rentalRowsOf(giver.employee_id).map((r) => [`${r.sheetType}:${r.row.id}`, r]));
    const warehouseGroups = new Map(myWarehouseGroups(giver.employee_id).map((g) => [warehouseKey(g), g]));
    const rentalMoves = [];
    const warehouseMoves = [];
    for (const [key, qty] of requested) {
      if (key.startsWith("warehouse:")) {
        const group = warehouseGroups.get(key);
        if (!group) throw new Error("이미 반납했거나 본인이 대여 중이 아닌 COS 물품이 있습니다. 목록을 새로고침해주세요.");
        if (qty > group.qty) throw new Error(`${group.name}: 대여 중인 수량은 ${group.qty}개입니다.`);
        warehouseMoves.push({ group, qty });
        continue;
      }
      const found = rentalRows.get(key);
      if (!found) throw new Error("이미 반납했거나 본인이 대여 중이 아닌 물품이 있습니다. 목록을 새로고침해주세요.");
      const shape = rentalShape(found.sheetType, found.row, objMap, vMap);
      assertNormalObjectReturn(found.sheetType,found.row.id,qty);
      if (!found.row.picked_up_at) throw new Error(`${shape.name}: 대여 확인 전인 물품은 양도할 수 없습니다.`);
      if (found.row.variant_pending === "Y") throw new Error(`${shape.name}: 종류가 확인되지 않은 물품은 양도할 수 없습니다.`);
      if (qty > shape.quantity) throw new Error(`${shape.name}: 대여 중인 수량은 ${shape.quantity}개입니다.`);
      rentalMoves.push({ ...found, shape, qty });
    }

    const countedIds = rentalMoves.filter((m) => m.row.type_limit_exempt !== "Y").map((m) => m.shape.itemId || m.shape.name);
    if (countedIds.length) checkTypeLimit?.({ name: receiver.name, employeeId: receiver.employee_id, floor: seatFloor, unit: seatUnit }, countedIds);

    // 대여 방식이 없는 예전 대여가 섞여 있으면, 화면에서 고른 방식 하나를 그 물품 모두에 적용한다.
    let chosenTerms = null;
    if (rentalMoves.some((m) => !sourceTerms(m.row))) {
      if (!rentalTerms?.mode) throw new Error("대여 방식이 정해지지 않은 물품이 있습니다. 받는 사람의 대여 방식을 선택해주세요.");
      const v = validateRentalTerms(rentalTerms);
      chosenTerms = { mode: v.mode, reason: v.reason || null, dueDate: v.dueDate || null };
    }

    // 대여 방식(일반·사유·장기대여)과 사유·반납 예정일은 원래 신청에서 그대로 옮긴다.
    // 방식이 다른 물품끼리는 신청을 나눈다. 받는 사람은 지금 수령한 것으로 열리므로
    // 일반 대여의 4시간 기한은 양도 시점부터 새로 센다(rental_general_since는 옮기지 않는다).
    const requestByTerms = new Map();
    const requestFor = (row) => {
      const src = sourceTerms(row) || chosenTerms;
      const terms = [src?.mode || null, src?.reason || null, src?.dueDate || null];
      const key = JSON.stringify(terms);
      if (!requestByTerms.has(key)) {
        requestByTerms.set(key, Number(run(
          "INSERT INTO rental_requests (created_at, borrower_name, employee_id, rental_mode, rental_reason, rental_due_date) VALUES (?, ?, ?, ?, ?, ?)",
          [now, receiver.name, receiver.employee_id, ...terms],
        ).lastInsertRowid) || null);
      }
      return requestByTerms.get(key);
    };
    const batchId = crypto.randomUUID();
    for (const move of rentalMoves) {
      const requestNo = requestFor(move.row);
      closeForTransfer(move.sheetType, move.row, move.qty, now);
      // 받는 사람 손에 이미 있는 물건이므로 대여 확인까지 끝난 대여로 연다(관리자 양도와 같다).
      run(
        `INSERT INTO general_rentals (borrower_name, employee_id, item_id, item_label, qty, borrow_date, purpose, returned, return_date, email, batch_id, applied_at, category, confirmed_at, status, floor, unit, variant_id, variant_pending, request_no, picked_up_at, type_limit_exempt, type_limit_exempt_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'X', NULL, ?, ?, ?, '양도', NULL, 'active', ?, ?, ?, NULL, ?, ?, ?, ?)`,
        [receiver.name, receiver.employee_id, move.shape.itemId, move.shape.name, move.qty, now, note, contact.email || "", batchId, now,
          seatFloor || null, seatUnit || null, move.row.variant_id || null, requestNo, now, move.row.type_limit_exempt || null, move.row.type_limit_exempt_reason || null],
      );
    }
    for (const { group, qty } of warehouseMoves) {
      applyWarehouseRent({ type: "반납", location: group.location, name: group.name, qty, user: giver.name, employeeId: giver.employee_id, note: `[양도] ${note}` });
      const opened = applyWarehouseRent({ type: "대여", location: group.location, name: group.name, qty, user: receiver.name, employeeId: receiver.employee_id, note: `[양도] ${note}` });
      if (opened.type !== "대여") throw new Error(`${group.name}: 소모품은 양도할 수 없습니다.`);
    }
    const movedQty = [...rentalMoves, ...warehouseMoves].reduce((n, m) => n + m.qty, 0);
    const noticeItems = [
      ...rentalMoves.map(m => ({ kind: 'scenario', itemId: m.shape.itemId, name: m.shape.name, variantName: m.shape.variantName, quantity: m.qty })),
      ...warehouseMoves.map(m => ({ kind: 'warehouse', itemId: '', name: m.group.name, variantName: '', quantity: m.qty })),
    ];
    run(`INSERT INTO transfer_notifications (occurred_at,from_employee_id,from_name,to_employee_id,to_name,floor,unit,items_json)
      VALUES (?,?,?,?,?,?,?,?)`, [now,giver.employee_id,giver.name,receiver.employee_id,receiver.name,seatFloor,seatUnit,JSON.stringify(noticeItems)]);
    const requestNos = [...requestByTerms.values()];
    return { receiverName: receiver.name, receiverEmployeeId: receiver.employee_id, movedQty, itemTypes: requested.size, requestNo: requestNos[0] ?? null, requestNos };
  });
}
