// GAS(Google Apps Script)-compatible action dispatcher.
// The frontend (App.tsx callScript/fetchAll, src/utils/borrowApi.ts apiGet/apiPost) was built against
// a GAS web app's doGet/doPost({action, payload}) contract. Rather than rewrite every one of the ~50
// exported wrapper functions to hit individual REST endpoints, this single dispatcher mimics that same
// action-based contract locally, backed by SQLite. The frontend's `scriptUrl` is hard-coded to "/api/gas".
import express, { Router } from "express";
import crypto from "node:crypto";
import { get, all, run, transaction } from "../db.js";
import { toInventoryItem, toDefectLog, toRentLog, toSector, toScenarioObject, toTableclothItem, tableclothLabel } from "../lib/serialize.js";
import { maybeSaveImage, uploadsDir } from "../lib/images.js";
import fs from "node:fs";
import path from "node:path";
import { nowKst, shiftOf } from "../lib/time.js";
import { employeeIdForRentalRow, normalizeEmployeeId, normalizePersonName, registeredUser, registeredUsersByName, resolveRegisteredIdentity } from "../lib/registeredUsers.js";
import * as smObjects from "../lib/smObjects.js";
import * as smObjectsSession from "../lib/smObjectsSession.js";
import * as smLocationSync from "../lib/smLocationSync.js";
import { nudge as smSyncNudge, syncChangesNow as runSmChangesNow, status as smSyncStatus } from "../lib/smSync.js";

// 오브젝트 등록에 쓸 창구를 고른다.
//   토큰 창구(smObjects)  — SM이 외부 시스템용으로 연 정식 경로. 중복 방지가 있어 더 안전하다.
//   세션 창구(smObjectsSession) — 관리자 로그인 세션으로 사람 화면과 같은 요청을 보낸다.
// 토큰이 있으면 토큰을 쓰고, 없으면 세션으로 넘어간다.
function objectRegistrar() {
  if (smObjects.enabled()) return smObjects;
  return smObjectsSession;
}
import {
  padSlot, normalizeSid, parseSidParts, parseItemLabel, scenarioItemLabel,
  objectMap, updateInventory, updateTableclothInventory, tableclothRentalId, lookupConfigDsContact, resolveBorrowerContact,
  expectedEmailFor, matchesBorrowerIdentity, sameBorrowerIdentity,
  variantMap, withVariants, updateVariantInventory, syncItemStockFromVariants,
  legacyOutstanding, creditVariantStock, restoreRentalStock,
} from "../lib/borrowUtils.js";

export const gasRouter = Router();

const DEFAULT_APP_VERSION = "local-1.0";
const UNLIMITED_ITEM_TYPES = 9999; // 관리자가 기본값을 설정하지 않았을 때 쓰는 "사실상 무제한" 값

/** 관리자 설정(연결 설정 > 대여/반납 설정)에서 저장한 기본 종류 제한. 미설정이면 무제한. */
function defaultMaxItemTypes() {
  const row = get("SELECT value FROM settings WHERE key = 'max_item_types_default'");
  const n = row?.value ? Number(row.value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : UNLIMITED_ITEM_TYPES;
}

function appVersion() {
  const row = get("SELECT value FROM settings WHERE key = 'app_version'");
  return row?.value || DEFAULT_APP_VERSION;
}

const nowIso = nowKst;

function changeActor(payload) {
  return String(payload?._actor || payload?.manager || "관리자").trim() || "관리자";
}

function logItemChange(category, itemId, itemName, changeType, summary, payload) {
  if (!summary) return;
  run(
    `INSERT INTO item_change_logs (occurred_at, category, item_id, item_name, change_type, summary, manager)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [nowIso(), category, String(itemId ?? ""), itemName || "", changeType || "updated", summary, changeActor(payload)]
  );
}

function displayValue(value) {
  if (value === undefined || value === null || value === "") return "(없음)";
  return String(value);
}

function diffFields(before, after, fields) {
  const parts = [];
  for (const field of fields) {
    const beforeValue = field.bool ? !!before?.[field.key] : (before?.[field.key] ?? "");
    const afterValue = field.bool ? !!after?.[field.key] : (after?.[field.key] ?? "");
    if (String(beforeValue) === String(afterValue)) continue;
    parts.push(`${field.label}: ${field.bool ? (beforeValue ? "예" : "아니오") : displayValue(beforeValue)} → ${field.bool ? (afterValue ? "예" : "아니오") : displayValue(afterValue)}`);
  }
  return parts.join(", ");
}

// ── getAll (bootstrap, 파트별 조회 지원) ─────────────────────

const PART_BUILDERS = {
  inventory: () => all("SELECT * FROM warehouse_items ORDER BY id").map(toInventoryItem),
  sectors: () => all("SELECT * FROM sectors ORDER BY id").map(toSector),
  users: () => all("SELECT id, name FROM admin_users"),
  rentLogs: () => all("SELECT * FROM warehouse_rental_logs ORDER BY id DESC").map(toRentLog),
  defectLogs: () => all("SELECT * FROM defect_logs ORDER BY id DESC").map(toDefectLog),
  robotObjects: () => [],
};

function getAll({ query }) {
  const part = query.part;
  if (part && PART_BUILDERS[part]) return { [part]: PART_BUILDERS[part]() };
  const out = {};
  for (const key of Object.keys(PART_BUILDERS)) out[key] = PART_BUILDERS[key]();
  return out;
}

// ── 인벤토리 CRUD ─────────────────────────────────────────────

async function addInventoryItem({ payload }) {
  const item = payload || {};
  const result = run(
    `INSERT INTO warehouse_items (location, subcategory, name, purchase_link, stock, updated_at, manager, manager2, note, image_path, keywords, consumable)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [item.location ?? null, item.spec ?? null, item.name ?? null, item.link ?? null, item.stock ?? null, item.updatedAt ?? nowIso(), item.manager ?? null, item.manager2 ?? null, item.note ?? null, null, item.keywords ?? null, item.consumable ?? null]
  );
  const id = result.lastInsertRowid;
  const imagePath = await maybeSaveImage(item.photo, "warehouse_items", id);
  if (imagePath) run("UPDATE warehouse_items SET image_path = ? WHERE id = ?", [imagePath, id]);
  const row = get("SELECT * FROM warehouse_items WHERE id = ?", [id]);
  const saved = toInventoryItem(row);
  logItemChange("inventory", id, saved.name, "created", `신규 등록 (재고 ${Number(saved.stock) || 0}개, 위치 ${displayValue(saved.location)})`, item);
  return { rowIndex: saved.rowIndex, photo: saved.photo };
}

async function updateInventoryItem({ payload }) {
  const item = payload || {};
  const id = Number(item.rowIndex);
  const existing = get("SELECT * FROM warehouse_items WHERE id = ?", [id]);
  if (!existing) return { success: false, error: "물품을 찾을 수 없습니다." };
  const imagePath = item.photo !== undefined ? await maybeSaveImage(item.photo, "warehouse_items", id) : existing.image_path;
  const archived = item.archived !== undefined ? (item.archived ? "TRUE" : null) : existing.archived;
  run(
    `UPDATE warehouse_items SET location=?, subcategory=?, name=?, purchase_link=?, stock=?, updated_at=?, manager=?, manager2=?, note=?, image_path=?, keywords=?, consumable=?, archived=? WHERE id=?`,
    [
      item.location ?? existing.location, item.spec ?? existing.subcategory, item.name ?? existing.name, item.link ?? existing.purchase_link,
      item.stock ?? existing.stock, item.updatedAt ?? nowIso(), item.manager ?? existing.manager, item.manager2 ?? existing.manager2,
      item.note ?? existing.note, imagePath, item.keywords ?? existing.keywords, item.consumable ?? existing.consumable, archived, id,
    ]
  );
  const after = toInventoryItem(get("SELECT * FROM warehouse_items WHERE id = ?", [id]));
  const before = toInventoryItem(existing);
  const summary = diffFields(before, after, [
    { key: "name", label: "이름" }, { key: "location", label: "위치" }, { key: "spec", label: "분류" },
    { key: "stock", label: "재고" }, { key: "link", label: "구매 링크" }, { key: "note", label: "메모" },
    { key: "keywords", label: "키워드" }, { key: "consumable", label: "소모품" }, { key: "archived", label: "보관 처리", bool: true },
  ]);
  logItemChange("inventory", id, after.name, "updated", summary, item);
  return {};
}

function updateMultipleInventoryItems({ payload }) {
  const items = payload?.items || [];
  transaction(() => {
    for (const item of items) {
      const existing = get("SELECT * FROM warehouse_items WHERE id = ?", [Number(item.rowIndex)]);
      run(
        `UPDATE warehouse_items SET location=?, subcategory=?, name=?, purchase_link=?, stock=?, updated_at=?, manager=?, manager2=?, note=?, keywords=?, consumable=? WHERE id=?`,
        [item.location ?? null, item.spec ?? null, item.name ?? null, item.link ?? null, item.stock ?? null, item.updatedAt ?? nowIso(), item.manager ?? null, item.manager2 ?? null, item.note ?? null, item.keywords ?? null, item.consumable ?? null, item.rowIndex]
      );
      if (existing) {
        const before = toInventoryItem(existing);
        const after = toInventoryItem(get("SELECT * FROM warehouse_items WHERE id = ?", [Number(item.rowIndex)]));
        const summary = diffFields(before, after, [
          { key: "name", label: "이름" }, { key: "location", label: "위치" }, { key: "spec", label: "분류" },
          { key: "stock", label: "재고" }, { key: "note", label: "메모" }, { key: "keywords", label: "키워드" },
        ]);
        logItemChange("inventory", item.rowIndex, after.name, "updated", summary, payload);
      }
    }
  });
  return {};
}

function deleteInventoryItem({ payload }) {
  const id = Number(payload.rowIndex);
  const existing = get("SELECT * FROM warehouse_items WHERE id = ?", [id]);
  run("DELETE FROM warehouse_items WHERE id = ?", [id]);
  if (existing) logItemChange("inventory", id, existing.name, "deleted", "삭제됨", payload);
  deleteItemPhotosForItem("warehouse", String(id));
  return {};
}

// ── 불량 로그 ────────────────────────────────────────────────

// 불량 등록으로 재고를 깎는다. 종류가 나뉜 물품은 scenario_items.stock을 직접 줄여봐야
// 다음 동기화에서 종류 합계로 덮어써져 차감이 증발하므로, 반드시 종류(또는 미확인) 쪽을 줄여야 한다.
// 어느 종류인지 아는 경우(파손 반납은 대여 기록에 종류가 남아 있다)는 그 종류에서,
// 모르는 경우는 미확인 재고에서 뺀다. 둘 다 불가능하면 깎지 않고 그 사실을 돌려준다.
function applyDefectStockDeduction({ itemId, variantId, qty, reason, manager }) {
  const id = padSlot(itemId);
  const row = get("SELECT * FROM scenario_items WHERE id = ?", [id]);
  if (!row || !(qty > 0)) return { deducted: 0, warning: "" };

  const before = Number(row.stock) || 0;
  const variants = variantMap()[id] || [];
  let deducted = 0;
  let warning = "";

  if (!variants.length) {
    deducted = Math.min(qty, before);
    run("UPDATE scenario_items SET stock = ? WHERE id = ?", [before - deducted, id]);
  } else if (variantId) {
    const v = get("SELECT * FROM scenario_item_variants WHERE id = ? AND item_id = ?", [Number(variantId), id]);
    if (v) {
      deducted = Math.min(qty, Number(v.stock) || 0);
      run("UPDATE scenario_item_variants SET stock = ? WHERE id = ?", [(Number(v.stock) || 0) - deducted, Number(variantId)]);
      syncItemStockFromVariants(id);
    }
  } else {
    const un = Number(row.unassigned_stock) || 0;
    deducted = Math.min(qty, un);
    run("UPDATE scenario_items SET unassigned_stock = ? WHERE id = ?", [un - deducted, id]);
    syncItemStockFromVariants(id);
  }

  if (deducted < qty) {
    warning = variants.length && !variantId
      ? `'${row.name}'은(는) 종류별로 재고를 관리하는 물품입니다. 미확인 재고가 부족해 ${qty - deducted}개는 차감하지 못했습니다 — 물품 편집 화면에서 종류별 재고를 직접 맞춰주세요.`
      : `'${row.name}'의 재고가 부족해 ${qty - deducted}개는 차감하지 못했습니다.`;
  }

  if (deducted) {
    const after = get("SELECT stock FROM scenario_items WHERE id = ?", [id]);
    run(
      `INSERT INTO inventory_history (occurred_at, category, ref_id, item_name, before_val, after_val, diff, reason, manager) VALUES (?, 'scenario', ?, ?, ?, ?, ?, ?, ?)`,
      [nowIso(), id, row.name, before, Number(after?.stock) || 0, (Number(after?.stock) || 0) - before, reason, manager || null]
    );
  }
  return { deducted, warning };
}

async function addDefectLog({ payload }) {
  const log = payload || {};
  const result = run(
    `INSERT INTO defect_logs (product, qty, occurred_date, defect_type, detail, action_taken, image_path, breaker) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    // 파손자는 폼이 culprit으로 보내는데 예전엔 manager만 읽어서 통째로 버려지고 있었다
    // (기존 로그 88건 중 71건이 파손자 공란). 둘 다 받아준다.
    [log.name ?? null, log.qty ?? null, log.timestamp ?? nowIso(), log.defectType ?? null, log.note ?? null, log.actionTaken ?? null, null, log.culprit || log.manager || null]
  );
  const id = result.lastInsertRowid;
  const imagePath = await maybeSaveImage(log.photo, "defect_logs", id);
  if (imagePath) run("UPDATE defect_logs SET image_path = ? WHERE id = ?", [imagePath, id]);
  // 직접 불량 등록은 재고를 건드리지 않는다 — 공구·부품류 전용 창구이기 때문이다.
  // 시나리오 오브젝트 파손은 반납 화면의 "파손 처리"(recordDamagedReturn)로만 등록한다.
  // 거기서만 어느 종류(variant)가 파손됐는지 알 수 있어 재고가 정확히 깎인다.
  const stockWarning = "";
  const row = get("SELECT * FROM defect_logs WHERE id = ?", [id]);
  const saved = toDefectLog(row);
  return { rowIndex: saved.rowIndex, photo: saved.photo, stockWarning };
}

// 반납 처리 시 촬영한 증빙 사진 — 사진 파일 자체가 증빙이라 항목 단위가 아니라
// 처리 묶음(제출 1건) 단위로 한 장만 남긴다.
async function saveReturnPhoto({ payload }) {
  const p = payload || {};
  const itemsJson = Array.isArray(p.items) ? JSON.stringify(p.items) : null;
  const clientId = String(p.clientId || "").trim() || null;

  // 이미 저장된 시도라면 그대로 성공으로 답한다.
  // 사진은 올라갔는데 응답이 돌아오지 못한 경우(사무실 Wi-Fi 경로에서 실제로 일어난다)
  // 사람이 "다시 시도"를 누르게 되는데, 그때 같은 사진이 두 장 남으면 안 된다.
  if (clientId) {
    const existing = get("SELECT id, image_path FROM return_photos WHERE client_id = ?", [clientId]);
    if (existing && existing.image_path) return { success: true, duplicate: true };
    // 사진 없이 줄만 남은 미완성 시도는 지우고 다시 저장한다(앞선 시도가 중간에 끊긴 것).
    if (existing) run("DELETE FROM return_photos WHERE id = ?", [existing.id]);
  }

  const result = run(
    `INSERT INTO return_photos (occurred_at, image_path, summary, items_json, client_id) VALUES (?, ?, ?, ?, ?)`,
    [nowIso(), null, p.summary ?? null, itemsJson, clientId]
  );
  const id = result.lastInsertRowid;
  const imagePath = await maybeSaveImage(p.photo, "return_photos", id);
  if (!imagePath) return { success: false, error: "사진 저장에 실패했습니다." };
  run("UPDATE return_photos SET image_path = ? WHERE id = ?", [imagePath, id]);
  return { success: true };
}

// ── 창고 물품 대여/반납/소모 ─────────────────────────────────

const RENT_DELTA = { "대여": -1, "반납": 1, "소모": -1 };

function applyWarehouseRent(entry) {
  // "소모"로 기록되는 두 가지 경우를 구분해야 한다: (1) 대여 없이 바로 소모(BorrowSystemPage) —
  // 이번에 처음 재고에서 빠지는 것이므로 -1이 맞다. (2) 이미 대여 중이던 물품을 반납 화면에서
  // "소모로 전환"(AdminReturnPage는 type:"소모", MobileViewPage는 type:"반납"으로 보냄) — 대여
  // 시점에 이미 -1이 적용된 상태라 여기서 또 재고를 건드리면 이중 차감(-1) 되거나 되레 복구(+1)
  // 돼버린다. 두 화면 다 note에 [소모완료] 태그를 붙여 보내므로, 그 태그가 있으면 타입에 상관없이
  // 재고를 건드리지 않는다.
  const isResolvingExistingLoan = String(entry.note || "").includes("[소모완료]");
  const sign = isResolvingExistingLoan ? 0 : (RENT_DELTA[entry.type] ?? 0);
  const qty = Number(entry.qty) || 0;
  const row = get("SELECT * FROM warehouse_items WHERE location = ? AND name = ?", [entry.location, entry.name]);
  if (row) {
    const current = Number(row.stock);
    if (!Number.isNaN(current)) run("UPDATE warehouse_items SET stock = ? WHERE id = ?", [String(current + sign * qty), row.id]);
  }
  let identity = resolveRegisteredIdentity(entry.employeeId, entry.user);
  if (!identity.ok && !String(entry.employeeId || "").trim()) {
    const byName = registeredUsersByName(entry.user);
    if (byName.length === 1) identity = { ok: true, employeeId: byName[0].employee_id, name: byName[0].name };
  }
  const manager = identity.ok ? identity.name : (entry.user ?? null);
  const employeeId = identity.ok ? identity.employeeId : normalizeEmployeeId(entry.employeeId);
  run(`INSERT INTO warehouse_rental_logs (occurred_at, type, location, name, qty, manager, employee_id, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [nowIso(), entry.type ?? null, entry.location ?? null, entry.name ?? null, qty, manager, employeeId || null, entry.note ?? null]);
}

function rentInventoryItem({ payload }) {
  const entry = payload || {};
  transaction(() => applyWarehouseRent(entry));
  return {};
}

function rentInventoryItemsBulk({ payload }) {
  const items = payload?.items || [];
  const failed = [];
  let processed = 0;
  transaction(() => {
    for (const item of items) {
      try {
        applyWarehouseRent(item);
        processed++;
      } catch (err) {
        failed.push(item.name || "?");
      }
    }
  });
  return { processed, failed };
}

// ── 랙 레이아웃 ──────────────────────────────────────────────

function saveSectorLayout({ payload }) {
  const sectors = payload?.sectors || [];
  transaction(() => {
    for (const s of sectors) {
      run(
        `INSERT INTO sectors (id, name, x, y, width, height, rotation, color) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, x=excluded.x, y=excluded.y, width=excluded.width, height=excluded.height, rotation=excluded.rotation, color=excluded.color`,
        [s.id, s.name ?? null, s.x ?? 0, s.y ?? 0, s.width ?? 0, s.height ?? 0, s.rotation ?? 0, s.color ?? null]
      );
    }
  });
  return {};
}

function deleteSector({ payload }) {
  run("DELETE FROM sectors WHERE id = ?", [payload.sectorId]);
  return {};
}

// ── 대여 시스템: 오브젝트/시나리오 조회 ──────────────────────

function getBorrowAppInfo() {
  return { version: appVersion() };
}

// 대여 화면이 쓰는 물품 목록. 보관 처리된 물품(is_storage)은 빼고 내보낸다 —
// 파손 등으로 오브젝트로 쓸 수 없어 치워둔 것들이라 빌릴 수 있으면 안 된다.
// 화면에서 걸러도 되지만, 목록을 쓰는 곳이 여럿이라 한 곳만 빠뜨려도 다시 새어나간다.
function getObjectItems() {
  // 보관 여부 판정은 직렬화(toScenarioObject)에 맡긴다 — is_storage 값이 TRUE/Y/N/빈값으로
  // 섞여 있어서 SQL로 직접 거르면 어느 하나를 반드시 빠뜨린다.
  const items = withVariants(all("SELECT * FROM scenario_items").map((r) => toScenarioObject(r)));
  return { items: items.filter((it) => !it.archived) };
}

function getWarehouseInventoryOnly() {
  return { inventory: all("SELECT * FROM warehouse_items ORDER BY id").map(toInventoryItem) };
}

function findMaxKnownSid() {
  return get("SELECT sid FROM scenarios ORDER BY CAST(REPLACE(REPLACE(sid, 'S', ''), 'L', '') AS INTEGER) DESC LIMIT 1");
}

function getScenarioDefinition({ query }) {
  const target = normalizeSid(query.scenarioId);
  const result = { sid: target, found: false, syncNeeded: true, blocked: false, blockReason: "", highLevelEn: "", highLevelKo: "", items: [] };
  if (!target) return { scenario: result };

  const rows = all("SELECT * FROM scenarios WHERE UPPER(REPLACE(sid, ' ', '')) = ?", [target]);
  if (rows.length) {
    result.found = true;
    result.syncNeeded = false;
    result.highLevelEn = rows[0].instruction_en || "";
    result.highLevelKo = rows[0].instruction_ko || "";
    const objMap = objectMap();
    const vMap = variantMap();
    for (const r of rows) {
      if (!r.object_id) continue;
      const obj = objMap[r.object_id];
      result.items.push({
        id: r.object_id, name: r.object_name || obj?.name || "", quantity: r.quantity || 1,
        rootSlot: obj?.rootSlot || "", category: obj?.category || "", subcategory: obj?.subcategory || "",
        image: obj?.image || "", stock: obj?.stock || 0, rented: obj?.rented || 0,
        variants: vMap[r.object_id] || [], // 종류가 있으면 신청 화면에서 종류를 고르게 한다
      });
    }
  } else {
    const parts = parseSidParts(target);
    if (parts) {
      const maxRow = findMaxKnownSid();
      const maxParts = maxRow ? parseSidParts(normalizeSid(maxRow.sid)) : null;
      if (maxParts && parts.num <= maxParts.num) {
        result.blocked = true;
        result.blockReason = `${target} 는 DB에 등록되어 있지 않습니다. 등록된 마지막 SID(${maxRow.sid})보다 앞번호이므로 잘못된 SID이거나 삭제된 시나리오입니다.`;
      }
    }
  }
  return { scenario: result };
}

function buildUnreturnedRows() {
  const objMap = objectMap();
  const vMap = variantMap();
  // 대여 확인 화면이 "이 줄은 어떤 종류였나 / 아직 안 정해졌나 / 고를 수 있는 종류는 뭔가"를
  // 한 번에 알 수 있도록, 줄마다 종류 정보를 같이 실어 보낸다.
  const variantInfo = (itemId, row) => {
    const list = vMap[padSlot(itemId)] || [];
    const chosen = row.variant_id ? list.find((v) => v.id === row.variant_id) : null;
    return {
      variants: list,
      variantId: row.variant_id || null,
      variantName: chosen ? chosen.name : "",
      variantPending: row.variant_pending === "Y",
      // 종류가 생기기 전에 나간 대여 건 — 어느 종류가 돌아오는지 반납할 때 담당자가 골라야 한다.
      variantUnassigned: list.length > 0 && !row.variant_id && row.variant_pending !== "Y",
    };
  };
  const result = [];
  for (const row of all("SELECT * FROM sid_rentals WHERE returned != 'O' OR returned IS NULL")) {
    const employeeId = employeeIdForRentalRow(row);
    const borrowerName = registeredUser(employeeId)?.name || row.borrower_name;
    const parsed = parseItemLabel(row.item_label);
    const obj = objMap[parsed.id] || {};
    result.push({
      sheetType: "scenario", rowIndex: row.id, borrowerName, scenarioId: row.sid,
      itemLabel: row.item_label || "(물품 미등록)", itemId: parsed.id, itemKind: row.item_type || "추가 대여물품",
      location: obj.rootSlot || "", quantity: parsed.quantity || 1, borrowDate: row.borrow_date, borrowDateTime: row.applied_at,
      borrowPurpose: row.purpose, email: row.email || "", batchId: row.batch_id || "", requestNo: Number(row.request_no) || undefined, floor: row.floor || "", unit: row.unit || "",
      employeeId,
      shift: shiftOf(row.applied_at || row.borrow_date) || "day",
      pickedUp: !!row.picked_up_at, image: obj.image || "", stock: obj.stock || 0, rented: obj.rented || 0,
      // 반납 화면에서도 request 물품인지 바로 알아야 한다(업체에 나가는 물건이라 취급이 다르다)
      requestFor: obj.requestFor, personalOwner: obj.personalOwner,
      fragile: !!obj.fragile, fireRisk: !!obj.fireRisk,
      ...variantInfo(parsed.id, row),
    });
  }
  for (const row of all("SELECT * FROM general_rentals WHERE returned != 'O' OR returned IS NULL")) {
    const employeeId = employeeIdForRentalRow(row);
    const borrowerName = registeredUser(employeeId)?.name || row.borrower_name;
    const obj = objMap[row.item_id] || {};
    result.push({
      sheetType: "general", rowIndex: row.id, borrowerName, itemId: row.item_id,
      itemLabel: (row.item_id ? `[${row.item_id}] ` : "") + (row.item_label || "") + ((row.qty || 1) > 1 ? ` x ${row.qty}` : ""),
      location: obj.rootSlot || "", quantity: row.qty || 1, borrowDate: row.borrow_date, borrowDateTime: row.applied_at,
      borrowPurpose: row.purpose, email: row.email || "", batchId: row.batch_id || "", requestNo: Number(row.request_no) || undefined, generalOption: row.category || "",
      employeeId,
      floor: row.floor || "", unit: row.unit || "", pickedUp: !!row.picked_up_at,
      shift: shiftOf(row.applied_at || row.borrow_date) || "day",
      image: obj.image || "", stock: obj.stock || 0, rented: obj.rented || 0,
      requestFor: obj.requestFor, personalOwner: obj.personalOwner,
      fragile: !!obj.fragile, fireRisk: !!obj.fireRisk,
      ...variantInfo(row.item_id, row),
    });
  }
  return result;
}

function paginate(rows, limitRaw, offsetRaw) {
  const limit = Number(limitRaw);
  const offset = Number(offsetRaw) || 0;
  if (!limit || Number.isNaN(limit)) return { items: rows, hasMore: false };
  const items = rows.slice(offset, offset + limit);
  return { items, hasMore: offset + limit < rows.length };
}

function getUnreturnedItems({ query }) {
  const rows = buildUnreturnedRows();
  const { items, hasMore } = paginate(rows, query.limit ?? query.peopleLimit, query.offset ?? query.peopleOffset);
  return { items, hasMore };
}

function getMyBorrowedItems({ query }) {
  const name = String(query.name || "").trim();
  if (!name) return { items: [] };
  const employeeId = String(query.employeeId || "").trim();
  if (/^\d{4}$/.test(employeeId)) {
    return { items: buildUnreturnedRows().filter((item) => item.employeeId === employeeId) };
  }
  const expectedEmail = expectedEmailFor({ affiliation: query.affiliation, employeeId: query.employeeId, name });
  const items = buildUnreturnedRows().filter((item) => matchesBorrowerIdentity(item, name, expectedEmail));
  return { items };
}

function isConfigDsRegistered({ query }) {
  const found = lookupConfigDsContact(query.name);
  if (found && found.ambiguous) return { registered: false, ambiguous: true };
  return { registered: !!found };
}

// 위치 "A-01" 를 랙(A~) → 슬롯 숫자 순으로 정렬 비교
function compareRackSlot(la, lb) {
  const pa = String(la || "").toUpperCase().split("-");
  const pb = String(lb || "").toUpperCase().split("-");
  const ra = pa[0] || "", rb = pb[0] || "";
  if (ra !== rb) return ra < rb ? -1 : 1;
  let sa = parseInt(String(pa[1] || "").replace(/\D/g, ""), 10);
  let sb = parseInt(String(pb[1] || "").replace(/\D/g, ""), 10);
  if (Number.isNaN(sa)) sa = 999999;
  if (Number.isNaN(sb)) sb = 999999;
  return sa - sb;
}

// 창고물품(공구 및 부품류)은 시나리오 물품과 달리 "반납됨" 플래그가 있는 게 아니라, 로그(대여/반납/소모)만
// 쌓인다. 그래서 미반납 수량은 위치+품명별로 대여 로그에서 반납 로그를 (오래된 대여부터) 차감해서
// 계산해야 한다 — 원래 앱스크립트의 getWarehouseBorrowedItems_ 포팅.
function getWarehouseBorrowedItems() {
  const rows = all("SELECT * FROM warehouse_rental_logs ORDER BY id ASC");
  // 물품(위치+이름)뿐 아니라 사람 단위로도 묶어야 한다 — 그렇지 않으면 A가 빌리고 B가 빌린 뒤
  // B만 반납해도 "가장 오래된 대여 건"인 A의 기록이 엉뚱하게 상쇄되어 버린다.
  const groups = new Map();
  const order = [];

  for (const row of rows) {
    const loc = String(row.location || "").trim();
    const nm = String(row.name || "").trim();
    if (!loc && !nm) continue;
    let q = Number(row.qty);
    if (Number.isNaN(q) || q <= 0) q = 0;
    const user = String(row.manager || "").trim() || "(이름 없음)";
    const matched = normalizeEmployeeId(row.employee_id) || (registeredUsersByName(user).length === 1 ? registeredUsersByName(user)[0].employee_id : "");
    const note = String(row.note || "").trim();
    const typ = String(row.type || "").trim();

    const key = `${loc}||${nm}||${matched || normalizePersonName(user)}`;
    if (!groups.has(key)) { groups.set(key, { location: loc, name: nm, user, employeeId: matched, qty: 0, lastDate: "" }); order.push(key); }
    const g = groups.get(key);

    // 소모도 반납과 마찬가지로 "이 사람이 더 이상 들고 있지 않음"을 뜻하므로 미반납 집계에서 제외한다
    // (반납은 재고로 돌아가고 소모는 재고에서 영구 차감된다는 차이는 재고 수량 쪽에서만 다루면 되고,
    // "누가 아직 안 돌려줬는지" 집계에서는 둘 다 똑같이 해소된 것으로 봐야 한다).
    const isConsumeNote = note.includes("[소모완료]") || note.includes("[즉시반납]");
    if (typ === "반납" || typ === "소모" || isConsumeNote) {
      g.qty -= q;
    } else {
      g.qty += q;
      if (row.occurred_at) g.lastDate = row.occurred_at;
    }
  }

  const result = [];
  for (const key of order) {
    const g = groups.get(key);
    if (g.qty <= 0) continue;
    result.push({
      sheetType: "warehouse",
      borrowerName: g.user,
      employeeId: g.employeeId || "",
      location: g.location,
      name: g.name,
      quantity: g.qty,
      itemLabel: (g.location ? `[${g.location}] ` : "") + g.name + (g.qty > 1 ? ` x ${g.qty}` : ""),
      borrowDate: g.lastDate,
      borrowPurpose: "",
    });
  }

  result.sort((a, b) => {
    if (a.borrowerName !== b.borrowerName) return a.borrowerName < b.borrowerName ? -1 : 1;
    return compareRackSlot(a.location, b.location);
  });
  return { items: result };
}

function getScenarioObjectsForAdmin({ query }) {
  const rows = withVariants(all("SELECT * FROM scenario_items ORDER BY id").map((r) => toScenarioObject(r, { forAdmin: true })));
  const { items, hasMore } = paginate(rows, query.limit, query.offset);
  return { items, hasMore };
}

// 대여 행 하나가 어떤 종류였는지. 로그·상세 어디서든 같은 모양으로 쓴다.
//
// 이름만이 아니라 id도 함께 내보낸다 — 로그에서 재대여할 때 "그때 그 종류"를 그대로
// 다시 빌리려면 id가 있어야 한다(이름은 바뀔 수 있고, 대여 API는 id로 종류를 지정한다).
// 종류가 그 사이 삭제됐으면 id는 null이 되어, 화면이 "재대여 불가"를 미리 알려줄 수 있다.
function rowVariantInfo(vMap, itemId, row) {
  const list = vMap[padSlot(itemId || "")] || [];
  if (!list.length) return { variantName: "", variantPending: false, variantId: null };
  if (row.variant_pending === "Y") return { variantName: "", variantPending: true, variantId: null };
  const v = row.variant_id ? list.find((x) => x.id === row.variant_id) : null;
  return { variantName: v ? v.name : "", variantPending: false, variantId: v ? v.id : null };
}

function buildScenarioLogRows() {
  const objMap = objectMap();
  const vMap = variantMap();
  const result = [];
  for (const row of all("SELECT * FROM sid_rentals ORDER BY id DESC")) {
    const employeeId = employeeIdForRentalRow(row);
    const borrowerName = registeredUser(employeeId)?.name || row.borrower_name;
    const parsed = parseItemLabel(row.item_label);
    const obj = objMap[parsed.id] || {};
    result.push({
      sheetType: "scenario", rowIndex: row.id, borrowerName, scenarioId: row.sid,
      itemLabel: row.item_label, location: obj.rootSlot || "", itemId: parsed.id, itemName: parsed.name,
      quantity: parsed.quantity || 1, borrowDate: row.borrow_date, borrowPurpose: row.purpose, email: row.email || "",
      batchId: row.batch_id || "", employeeId, returned: row.returned === "O", returnDate: row.return_date || "",
      floor: row.floor || "", unit: row.unit || "", image: obj.image || "", stock: obj.stock || 0, rented: obj.rented || 0,
      ...rowVariantInfo(vMap, parsed.id, row),
    });
  }
  for (const row of all("SELECT * FROM general_rentals ORDER BY id DESC")) {
    const employeeId = employeeIdForRentalRow(row);
    const borrowerName = registeredUser(employeeId)?.name || row.borrower_name;
    const obj = objMap[row.item_id] || {};
    result.push({
      sheetType: "general", rowIndex: row.id, borrowerName, itemId: row.item_id, itemName: row.item_label,
      itemLabel: (row.item_id ? `[${row.item_id}] ` : "") + (row.item_label || "") + ((row.qty || 1) > 1 ? ` x ${row.qty}` : ""),
      location: obj.rootSlot || "", quantity: row.qty || 1, borrowDate: row.borrow_date, borrowPurpose: row.purpose, email: row.email || "",
      batchId: row.batch_id || "", employeeId, generalOption: row.category || "", returned: row.returned === "O", returnDate: row.return_date || "",
      floor: row.floor || "", unit: row.unit || "", image: obj.image || "", stock: obj.stock || 0, rented: obj.rented || 0,
      ...rowVariantInfo(vMap, row.item_id, row),
    });
  }
  return result;
}

function getScenarioAllLogs({ query }) {
  let rows = buildScenarioLogRows();
  if (query.recentDays) {
    const cutoff = Date.now() - Number(query.recentDays) * 86400000;
    rows = rows.filter((r) => {
      const t = Date.parse(r.borrowDate);
      return Number.isNaN(t) || t >= cutoff;
    });
  }
  if (query.scope === "unreturned") rows = rows.filter((r) => !r.returned);
  else if (query.scope === "returned") rows = rows.filter((r) => r.returned);
  const totalPeople = new Set(rows.map((r) => r.borrowerName)).size;
  const { items, hasMore } = paginate(rows, query.limit ?? query.peopleLimit, query.offset ?? query.peopleOffset);
  return { items, hasMore, totalPeople };
}

function getBatchDetail({ query }) {
  const objMap = objectMap();
  const vMap = variantMap();
  const items = [];
  for (const row of all("SELECT * FROM sid_rentals WHERE batch_id = ?", [query.batchId])) {
    const parsed = parseItemLabel(row.item_label);
    const obj = objMap[parsed.id] || {};
    items.push({
      sheetType: "scenario", rowIndex: row.id, borrowerName: row.borrower_name, scenarioId: row.sid,
      itemId: parsed.id, itemName: obj.name || parsed.name, itemLabel: row.item_label || "(물품 미등록)",
      quantity: parsed.quantity || 1, location: obj.rootSlot || "", borrowDate: row.borrow_date,
      borrowDateTime: row.applied_at, borrowPurpose: row.purpose, returned: row.returned === "O",
      returnDate: row.return_date || "", itemKind: row.item_type || "추가 대여물품", floor: row.floor || "", unit: row.unit || "",
      ...rowVariantInfo(vMap, parsed.id, row),
    });
  }
  for (const row of all("SELECT * FROM general_rentals WHERE batch_id = ?", [query.batchId])) {
    const obj = objMap[row.item_id] || {};
    items.push({
      sheetType: "general", rowIndex: row.id, borrowerName: row.borrower_name,
      itemId: row.item_id || "", itemName: obj.name || row.item_label || "", itemLabel: row.item_label || "",
      quantity: row.qty || 1, location: obj.rootSlot || "", borrowDate: row.borrow_date,
      borrowDateTime: row.applied_at, borrowPurpose: row.purpose, returned: row.returned === "O",
      returnDate: row.return_date || "", itemKind: row.category || "일반 대여", floor: row.floor || "", unit: row.unit || "",
      ...rowVariantInfo(vMap, row.item_id, row),
    });
  }
  return { items };
}

function getWarehouseLogs({ query }) {
  let rows = all("SELECT * FROM warehouse_rental_logs ORDER BY id DESC").map((r) => ({
    rowIndex: r.id, timestamp: r.occurred_at, type: r.type, location: r.location, name: r.name, quantity: r.qty, user: r.manager,
    employeeId: normalizeEmployeeId(r.employee_id) || (registeredUsersByName(r.manager).length === 1 ? registeredUsersByName(r.manager)[0].employee_id : ""), note: r.note,
  }));
  if (query.recentDays) {
    const cutoff = Date.now() - Number(query.recentDays) * 86400000;
    rows = rows.filter((r) => {
      const t = Date.parse(r.timestamp);
      return Number.isNaN(t) || t >= cutoff;
    });
  }
  const totalPeople = new Set(rows.map((r) => r.user)).size;
  const { items, hasMore } = paginate(rows, query.limit ?? query.peopleLimit, query.offset ?? query.peopleOffset);
  return { items, hasMore, totalPeople };
}

// ── 페널티 / 대여 물품 종류 제한 ─────────────────────────────

function activePenaltyForName(name) {
  const target = String(name || "").trim().toLowerCase();
  if (!target) return null;
  const now = nowIso();
  return get("SELECT * FROM penalties WHERE LOWER(TRIM(name)) = ? AND (expires_at IS NULL OR expires_at = '' OR expires_at > ?) ORDER BY id DESC LIMIT 1", [target, now]);
}

function getPenalties() {
  const now = nowIso();
  const rows = all("SELECT * FROM penalties WHERE expires_at IS NULL OR expires_at = '' OR expires_at > ? ORDER BY id DESC", [now]);
  // 관리자 목록에는 사건별 행을 모두 남기되, 랜딩의 "현재 적용 중"에는 사람별 최신 상태만 보인다.
  const seen = new Set();
  const latest = rows.filter((row) => {
    const key = String(row.name || "").trim().toLocaleLowerCase("ko-KR");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { items: latest.map((r) => ({ name: r.name, max: r.max_types, reason: r.reason, until: r.expires_at })) };
}

function isSeatExempt(floor, unit) {
  if (!floor || !unit) return false;
  const row = get("SELECT value FROM settings WHERE key = 'floor_plan'");
  if (!row) return false;
  try {
    const map = JSON.parse(row.value);
    for (const f of map.floors || []) {
      if (f.id !== floor && f.name !== floor) continue;
      for (const u of f.units || []) {
        if (u.label === unit || `${f.id}-${u.row}-${u.col}` === unit) return !!u.exempt;
      }
    }
  } catch (err) {
    return false;
  }
  return false;
}

function getActiveItemTypeCount({ query }) {
  const name = String(query.name || "").trim();
  const expectedEmail = expectedEmailFor({ affiliation: query.affiliation, employeeId: query.employeeId, name });
  const items = buildUnreturnedRows().filter((r) => matchesBorrowerIdentity(r, name, expectedEmail));
  const penaltyRow = activePenaltyForName(name);
  const exempt = isSeatExempt(query.floor, query.unit);
  const baseMax = defaultMaxItemTypes();
  const penaltyMax = penaltyRow ? Number(penaltyRow.max_types) : NaN;
  const max = exempt ? UNLIMITED_ITEM_TYPES : (Number.isFinite(penaltyMax) ? penaltyMax : baseMax);
  // 한도의 단위는 '물품'이지 '종류'가 아니다. 같은 Plate를 Pink 하나, White 하나 빌렸다면
  // 줄은 둘이지만 빌린 물품은 Plate 하나다(2개). 색상만 다른 걸 두 종으로 세면 한도가
  // 부당하게 두 배로 깎인다. 대여 확인·반납은 그대로 줄(종류)별로 따로 처리한다.
  const distinctTypes = new Set(items.map((i) => i.itemId || i.itemLabel));

  return {
    count: distinctTypes.size,
    max,
    baseMax,
    penalty: penaltyRow ? { max: penaltyRow.max_types, reason: penaltyRow.reason, until: penaltyRow.expires_at } : null,
    exempt,
    items: items.map((i) => ({ id: i.itemId, name: i.itemLabel, quantity: i.quantity, borrowDate: i.borrowDate })),
  };
}

// ── 재고 조정 / 실사 이력 (기존 inventory_history / inventory_audits 테이블 재사용) ──

function getStockChangeHistory({ query }) {
  let sql = "SELECT * FROM inventory_history";
  const params = [];
  const conds = [];
  if (query.category) { conds.push("category = ?"); params.push(query.category); }
  if (query.id) { conds.push("ref_id = ?"); params.push(String(query.id)); }
  if (conds.length) sql += " WHERE " + conds.join(" AND ");
  sql += " ORDER BY id DESC LIMIT 200";
  const rows = all(sql, params);
  return { items: rows.map((r) => ({ changedAt: r.occurred_at, category: r.category, id: r.ref_id, itemName: r.item_name, oldStock: r.before_val, newStock: r.after_val, diff: r.diff, reason: r.reason, manager: r.manager })) };
}

function adjustStock({ payload }) {
  const { category, rowIndex, id, newStock, newRented, reason, manager } = payload || {};
  let oldStock, oldRented, itemName, refId;
  if (category === "scenario") {
    const key = padSlot(id || rowIndex);
    const row = get("SELECT * FROM scenario_items WHERE id = ?", [key]);
    if (!row) return { success: false, message: "물품을 찾을 수 없습니다." };
    // 종류별로 재고를 관리하는 물품은 총재고가 종류 합계로 계산되므로, 총재고만 따로
    // 조정하면 곧바로 덮어써져 사라진다 — 종류 편집 쪽으로 보낸다.
    if (get("SELECT 1 FROM scenario_item_variants WHERE item_id = ?", [key])) {
      return { success: false, message: "종류별로 재고를 관리하는 물품입니다. 물품 편집 화면의 '종류' 항목에서 종류별 재고를 조정해주세요." };
    }
    oldStock = row.stock; oldRented = row.rented; itemName = row.name; refId = row.id;
    run("UPDATE scenario_items SET stock = ?, rented = ? WHERE id = ?", [newStock ?? row.stock, newRented ?? row.rented, row.id]);
  } else {
    const row = get("SELECT * FROM warehouse_items WHERE id = ?", [Number(rowIndex)]);
    if (!row) return { success: false, message: "물품을 찾을 수 없습니다." };
    oldStock = row.stock; itemName = row.name; refId = String(row.id);
    run("UPDATE warehouse_items SET stock = ? WHERE id = ?", [String(newStock), row.id]);
  }
  const diff = (Number(newStock) || 0) - (Number(oldStock) || 0);
  run(
    `INSERT INTO inventory_history (occurred_at, category, ref_id, item_name, before_val, after_val, diff, reason, manager) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [nowIso(), category, refId, itemName, Number(oldStock) || 0, Number(newStock) || 0, diff, reason || null, manager || null]
  );
  if (category === "scenario" && newRented !== undefined && Number(newRented) !== Number(oldRented)) {
    logItemChange("scenario", refId, itemName, "updated", `대여중 수량: ${Number(oldRented) || 0} → ${Number(newRented) || 0}${reason ? ` · ${reason}` : ""}`, payload);
  }
  return { message: "재고를 조정했습니다.", oldStock, newStock, diff, oldRented, newRented, rentedChanged: newRented !== undefined && newRented !== oldRented };
}

function getStockAuditHistory({ query }) {
  let sql = "SELECT * FROM inventory_audits";
  const params = [];
  if (query.itemId) { sql += " WHERE item_id = ?"; params.push(padSlot(query.itemId)); }
  sql += " ORDER BY id DESC LIMIT 200";
  const rows = all(sql, params);
  return { items: rows.map((r) => ({ auditedAt: r.audited_at, itemId: r.item_id, itemName: r.item_name, systemStock: r.system_stock, actualCount: r.audited_stock, diff: r.diff, auditor: r.auditor, note: r.memo })) };
}

function recordStockAudit({ payload }) {
  const { itemId, itemName, systemStock, actualCount, auditor, note } = payload || {};
  const diff = (Number(actualCount) || 0) - (Number(systemStock) || 0);
  run(
    `INSERT INTO inventory_audits (audited_at, item_id, item_name, system_stock, audited_stock, diff, auditor, memo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [nowIso(), itemId ? padSlot(itemId) : null, itemName || null, systemStock ?? null, actualCount ?? null, diff, auditor || null, note || null]
  );
  return { message: "실사 결과를 기록했습니다.", record: { itemId, itemName, systemStock, actualCount, diff, auditor, note } };
}

function getStockFormulaStatus({ query }) {
  const row = get("SELECT id FROM scenario_items WHERE id = ?", [padSlot(query.itemId)]);
  return { status: { found: !!row, stockIsFormula: false, rentedIsFormula: false } };
}

// ── 물품세트 (기존 item_sets 테이블, set_name으로 그룹핑) ───

function getItemSets() {
  const rows = all("SELECT * FROM item_sets ORDER BY id");
  const bySet = new Map();
  for (const r of rows) {
    if (!bySet.has(r.set_name)) bySet.set(r.set_name, []);
    bySet.get(r.set_name).push({ location: r.location, name: r.item_name, qty: r.qty });
  }
  return { sets: Array.from(bySet.entries()).map(([name, items]) => ({ name, items })) };
}

function saveItemSet({ payload }) {
  const { name, items, originalName } = payload || {};
  transaction(() => {
    run("DELETE FROM item_sets WHERE set_name = ?", [originalName || name]);
    for (const it of items || []) {
      run("INSERT INTO item_sets (set_name, location, item_name, qty) VALUES (?, ?, ?, ?)", [name, it.location ?? null, it.name ?? null, it.qty ?? null]);
    }
  });
  return { message: "물품세트를 저장했습니다." };
}

function deleteItemSet({ payload }) {
  run("DELETE FROM item_sets WHERE set_name = ?", [payload.name]);
  return { message: "물품세트를 삭제했습니다." };
}

// ── 좌석배치도 (settings.floor_plan JSON 재사용) ────────────

function getSeatMap() {
  const row = get("SELECT value FROM settings WHERE key = 'floor_plan'");
  const map = row ? JSON.parse(row.value) : { floors: [] };
  return { map };
}

function saveSeatMap({ payload }) {
  run(`INSERT INTO settings (key, value) VALUES ('floor_plan', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [JSON.stringify(payload)]);
  return { message: "좌석 배치도를 저장했습니다." };
}

// sid_rentals/general_rentals에 floor/unit이 직접 저장되어 있으므로, 별도의 rental_locations
// 테이블을 조인하지 않고 이 두 테이블에서 바로 조회해 batch_id로 묶는다 — 위치 정보를 두 곳에
// 중복 저장하다 서로 어긋나는 문제 자체를 없앤다.
function getSeatOccupancy({ query }) {
  const { floor, unit, shift } = query;
  const groups = new Map();

  const addRow = (r, sheetType, itemEntry) => {
    const key = r.batch_id || `${sheetType}-${r.id}`;
    if (!groups.has(key)) {
      groups.set(key, {
        timestamp: r.applied_at || r.borrow_date,
        borrowerName: r.borrower_name,
        batchId: r.batch_id || "",
        sheetType,
        items: [],
      });
    }
    groups.get(key).items.push(itemEntry);
  };

  // 미반납 건은 아무리 오래됐어도 절대 빠지면 안 된다(반납 처리를 하러 온 화면이므로) — 반납된
  // 건만 "최근 300건"으로 제한해서 오래된 완료 이력이 화면을 과하게 채우지 않게 한다.
  for (const r of all("SELECT * FROM sid_rentals WHERE floor = ? AND unit = ? AND returned != 'O' ORDER BY id DESC", [floor, unit])) {
    const parsed = parseItemLabel(r.item_label);
    addRow(r, "scenario", { name: r.item_label, qty: parsed.quantity || 1, returned: r.returned === "O", rowIndex: r.id, sheetType: "scenario", returnDate: r.return_date });
  }
  for (const r of all("SELECT * FROM general_rentals WHERE floor = ? AND unit = ? AND returned != 'O' ORDER BY id DESC", [floor, unit])) {
    addRow(r, "general", { name: r.item_label, qty: r.qty, returned: r.returned === "O", rowIndex: r.id, sheetType: "general", returnDate: r.return_date });
  }
  for (const r of all("SELECT * FROM sid_rentals WHERE floor = ? AND unit = ? AND returned = 'O' ORDER BY id DESC LIMIT 300", [floor, unit])) {
    const parsed = parseItemLabel(r.item_label);
    addRow(r, "scenario", { name: r.item_label, qty: parsed.quantity || 1, returned: r.returned === "O", rowIndex: r.id, sheetType: "scenario", returnDate: r.return_date });
  }
  for (const r of all("SELECT * FROM general_rentals WHERE floor = ? AND unit = ? AND returned = 'O' ORDER BY id DESC LIMIT 300", [floor, unit])) {
    addRow(r, "general", { name: r.item_label, qty: r.qty, returned: r.returned === "O", rowIndex: r.id, sheetType: "general", returnDate: r.return_date });
  }

  // 실제 신청 시각으로 Day/Night를 판단한다 — 예전엔 쿼리로 받은 shift 값을 그냥 그대로 돌려주기만
  // 해서, 탭을 바꿔도 항상 같은 목록이 보이는(필터링이 전혀 안 되는) 버그가 있었다.
  let grouped = Array.from(groups.values()).map((g) => ({ ...g, shift: shiftOf(g.timestamp) || "day", allReturned: g.items.length > 0 && g.items.every((i) => i.returned) }));
  if (shift === "day" || shift === "night") grouped = grouped.filter((g) => g.shift === shift);
  const unreturned = grouped.filter((g) => !g.allReturned);
  const returned = grouped.filter((g) => g.allReturned).sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || ""))).slice(0, 30);
  const items = unreturned.concat(returned).sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")));

  return { items };
}

// ── 공지사항 ─────────────────────────────────────────────────

function getNotices() {
  const rows = all("SELECT * FROM notices ORDER BY id DESC LIMIT 3");
  return { items: rows.map((r) => ({ title: r.title || undefined, text: r.content || "", updatedAt: r.created_at || undefined, author: r.author || undefined })) };
}

function saveNotices({ payload }) {
  const items = payload?.items || [];
  const author = payload?.author || null;
  transaction(() => {
    run("DELETE FROM notices");
    const now = nowIso();
    for (const n of items) {
      run("INSERT INTO notices (created_at, author, content, title) VALUES (?, ?, ?, ?)", [now, author, n.text || "", n.title || null]);
    }
  });
  return { items, message: "공지를 저장했습니다." };
}

function getNotice() {
  const row = get("SELECT * FROM notices ORDER BY id DESC LIMIT 1");
  return { notice: row ? { title: row.title || undefined, text: row.content || "", updatedAt: row.created_at || undefined, author: row.author || undefined } : { text: "" } };
}

function saveNotice({ payload }) {
  run("INSERT INTO notices (created_at, author, content) VALUES (?, ?, ?)", [nowIso(), payload?.author || null, payload?.text || ""]);
  return { message: "공지를 저장했습니다." };
}

// ── 대여 잠금 ─────────────────────────────────────────────────

function getBorrowLock() {
  const row = get("SELECT value FROM settings WHERE key = 'borrow_lock'");
  const lock = row ? JSON.parse(row.value) : { locked: false, reason: "", units: [] };
  return { lock };
}

function setBorrowLock({ payload }) {
  const lock = { locked: !!payload?.locked, reason: payload?.reason || "", at: nowIso(), units: payload?.units || [] };
  run(`INSERT INTO settings (key, value) VALUES ('borrow_lock', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [JSON.stringify(lock)]);
  return { lock, message: "대여 잠금 상태를 저장했습니다." };
}

// ── 앱 버전 ──────────────────────────────────────────────────

function publishAppVersion() {
  const previous = appVersion();
  const next = `v${Date.now()}`;
  run(`INSERT INTO settings (key, value) VALUES ('app_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [next]);
  return { version: next, previous, message: "버전을 갱신했습니다." };
}

// ── 대여/반납/픽업확인/물품교체 ─────────────────────────────

function validateStockAndBuildTotals(borrowList) {
  const requestedTotals = {};
  const add = (id, name, qty) => {
    const itemId = padSlot(String(id || "").trim());
    if (!itemId) return;
    if (!requestedTotals[itemId]) requestedTotals[itemId] = { name, quantity: 0 };
    requestedTotals[itemId].quantity += qty || 1;
  };
  let additionalRecorded = false;
  for (const info of borrowList) {
    if (info.itemType !== "scenario") {
      for (const item of info.borrowedItems || []) add(item.id, item.name, item.quantity);
    } else {
      for (const item of info.requiredObjects || []) add(item.id, item.name, item.quantity);
      const additional = additionalRecorded ? [] : info.additionalItems || [];
      if (additional.length) additionalRecorded = true;
      for (const item of additional) add(item.id, item.name, item.quantity);
    }
  }
  return requestedTotals;
}

// 종류를 지정해서 신청한 줄만 모아 종류별 요청 수량을 합산한다.
// (종류 상관없음 줄은 신청 시점에 재고를 건드리지 않으므로 여기 포함하지 않는다.)
function variantTotals(borrowList) {
  const totals = {};
  const add = (item) => {
    const vid = Number(item?.variantId);
    if (!vid) return;
    totals[vid] = (totals[vid] || 0) + (item.quantity || 1);
  };
  let additionalRecorded = false;
  for (const info of borrowList) {
    if (info.itemType !== "scenario") {
      for (const item of info.borrowedItems || []) add(item);
    } else {
      for (const item of info.requiredObjects || []) add(item);
      const additional = additionalRecorded ? [] : info.additionalItems || [];
      if (additional.length) additionalRecorded = true;
      for (const item of additional) add(item);
    }
  }
  return totals;
}

/** 신청한 종류에 맞춰 재고를 차감한다. 미확정(상관없음)이면 아무것도 차감하지 않는다. */
function applyBorrowStock(itemId, quantity, choice) {
  if (choice.pending) return;               // 대여 확인 때 담당자가 종류를 정하면 그때 차감
  if (choice.variantId) updateVariantInventory(choice.variantId, quantity); // 총재고는 합계로 자동 갱신
  else updateInventory(itemId, quantity);
}

/** 신청 줄 하나가 어느 종류인지. 종류가 나뉜 물품은 반드시 하나를 골라야 하므로,
 *  여기서 나오는 값은 "지정된 종류" 아니면 "종류 없는 물품"뿐이다. */
function variantChoiceOf(item) {
  const vid = Number(item?.variantId);
  return { variantId: vid || null, pending: false };
}

async function recordBorrow({ payload }) {
  const { borrowList } = payload || {};
  if (!Array.isArray(borrowList) || !borrowList.length) return { success: false, message: "대여 요청 정보가 없습니다." };

  const first = borrowList[0];
  // 사번이 기준이다. 화면에 오래 남아 있던 이름이 달라도 명부의 이름으로 바로잡아 저장한다.
  let identity = resolveRegisteredIdentity(first.employeeId);
  if (!identity.ok && !String(first.employeeId || "").trim()) {
    const byName = registeredUsersByName(first.borrowerName);
    if (byName.length === 1) identity = { ok: true, employeeId: byName[0].employee_id, name: byName[0].name };
  }
  if (!identity.ok) return { success: false, message: identity.error || "등록된 사번을 확인해주세요." };
  for (const info of borrowList) {
    info.employeeId = identity.employeeId;
    info.borrowerName = identity.name;
  }
  // 무인 모드에서 request 표시 물품은 해당 SID의 필수 물품으로만 신청할 수 있다.
  // 화면을 우회해도 서버가 막는다. 관리자 직접 대여는 실제 관리자 ID가 확인될 때만 예외다.
  if (get("SELECT value FROM settings WHERE key = 'unattended_enabled'")?.value === "1") {
    const adminDirect = borrowList.every((info) => info.adminDirect === true)
      && !!get("SELECT id FROM admin_users WHERE id = ?", [Number(first.adminId)]);
    if (!adminDirect) {
      const isRequestItem = (id) => {
        const row = get("SELECT request FROM scenario_items WHERE id = ?", [padSlot(id || "")]);
        return !!row && row.request !== null;
      };
      for (const info of borrowList) {
        const forbiddenGeneral = [...(info.borrowedItems || []), ...(info.additionalItems || [])].find((item) => isRequestItem(item.id));
        if (forbiddenGeneral) return { success: false, message: `'${forbiddenGeneral.name || forbiddenGeneral.id}'은(는) 무인 모드에서 SID 대여로만 신청할 수 있는 request 물품입니다.` };
        for (const item of info.requiredObjects || []) {
          if (!isRequestItem(item.id)) continue;
          const belongs = get("SELECT 1 FROM scenarios WHERE UPPER(REPLACE(sid,' ','')) = ? AND object_id = ?", [normalizeSid(info.scenarioId), padSlot(item.id || "")]);
          if (!belongs) return { success: false, message: `'${item.name || item.id}' request 물품은 해당 SID의 필수 물품이 아닙니다.` };
        }
      }
    }
  }
  const contact = resolveBorrowerContact(first);

  const blockedMsgs = [];
  for (const info of borrowList) {
    if (info.itemType !== "scenario") continue;
    const target = normalizeSid(info.scenarioId);
    const parts = parseSidParts(target);
    const found = get("SELECT 1 FROM scenarios WHERE UPPER(REPLACE(sid,' ','')) = ?", [target]);
    if (!found && parts) {
      const maxRow = findMaxKnownSid();
      const maxParts = maxRow ? parseSidParts(normalizeSid(maxRow.sid)) : null;
      if (maxParts && parts.num <= maxParts.num) {
        const reason = `${target} 는 DB에 등록되어 있지 않습니다. 등록된 마지막 SID(${maxRow.sid})보다 앞번호이므로 대여할 수 없습니다.`;
        if (!blockedMsgs.includes(reason)) blockedMsgs.push(reason);
      }
    }
  }
  if (blockedMsgs.length) return { success: false, message: blockedMsgs.join("\n") };

  const requestedTotals = validateStockAndBuildTotals(borrowList);
  const invMap = objectMap();

  // 재고가 모자란 물품들. `skipOutOfStock`이 오면 막는 대신 그것들만 빼고 진행한다.
  //
  // SID 대여는 시나리오 하나에 물품이 여럿이라, 그중 하나가 품절이라고 전부 못 빌리면 곤란하다.
  // 화면에서도 미리 걸러 보여주지만, 화면이 가진 카탈로그에 없는 물품(시나리오에만 있는 것)은
  // 여기서만 보인다 — 그래서 "무엇이 실제로 빠졌는지"는 서버가 돌려주는 skipped가 기준이다.
  const shortages = [];
  for (const [id, req_] of Object.entries(requestedTotals)) {
    const available = invMap[id] ? invMap[id].stock || 0 : 0;
    if (req_.quantity > available) shortages.push({ id, name: req_.name, requested: req_.quantity, available });
  }
  const skipOutOfStock = !!(payload || {}).skipOutOfStock;
  if (shortages.length && !skipOutOfStock) {
    const first = shortages[0];
    return { success: false, message: `재고 부족 오류: '${first.name}' 물품의 대여 요청 수량(${first.requested}개)이 현재 사용 가능한 재고(${first.available}개)를 초과합니다.` };
  }
  if (shortages.length) {
    const drop = new Set(shortages.map((x) => x.id));
    const keep = (item) => !drop.has(padSlot(String(item?.id || "").trim()));
    for (const info of borrowList) {
      if (Array.isArray(info.borrowedItems)) info.borrowedItems = info.borrowedItems.filter(keep);
      if (Array.isArray(info.requiredObjects)) info.requiredObjects = info.requiredObjects.filter(keep);
      if (Array.isArray(info.additionalItems)) info.additionalItems = info.additionalItems.filter(keep);
    }
    const left = borrowList.reduce(
      (n, info) => n + (info.borrowedItems || []).length + (info.requiredObjects || []).length + (info.additionalItems || []).length,
      0
    );
    if (!left) return { success: false, message: "재고가 있는 물품이 하나도 없어 대여할 수 없습니다.", skipped: shortages };
  }

  // 종류가 나뉜 물품은 반드시 종류를 골라야 한다("상관없음"은 없앴다) — 안 고르면
  // 어느 종류의 재고를 뺄지 알 수 없고, 미확인만 쌓이기 때문이다.
  const vMapForBorrow = variantMap();
  const checkChosen = (item) => {
    const list = vMapForBorrow[padSlot(item?.id || "")] || [];
    if (!list.length) return null;
    if (!Number(item?.variantId)) return `'${item?.name || item?.id}'은(는) 종류를 선택해야 대여할 수 있습니다.`;
    return null;
  };
  for (const info of borrowList) {
    // 검증만 하는 단계라 같은 줄을 두 번 봐도 무해하다 — 빠뜨리지 않는 쪽을 택한다.
    for (const item of [...(info.borrowedItems || []), ...(info.requiredObjects || []), ...(info.additionalItems || [])]) {
      const msg = checkChosen(item);
      if (msg) return { success: false, message: msg };
    }
  }

  // 종류를 콕 집어 신청한 줄은 그 종류의 재고를 넘을 수 없다.
  const vTotals = variantTotals(borrowList);
  for (const [vid, qty] of Object.entries(vTotals)) {
    const v = get("SELECT * FROM scenario_item_variants WHERE id = ?", [Number(vid)]);
    if (!v) return { success: false, message: "선택한 종류를 찾을 수 없습니다. 화면을 새로고침한 뒤 다시 시도해주세요." };
    if (qty > (Number(v.stock) || 0)) {
      return { success: false, message: `재고 부족 오류: '${v.name}' 종류의 대여 요청 수량(${qty}개)이 현재 사용 가능한 재고(${Number(v.stock) || 0}개)를 초과합니다.` };
    }
  }

  let scenarioCount = 0;
  let generalCount = 0;
  const scenarioBatchId = crypto.randomUUID();
  const additionalBatchId = crypto.randomUUID();
  const now = nowIso();
  let additionalItemsRecorded = false;

  let requestNo = 0;

  transaction(() => {
    const requestRow = run(
      "INSERT INTO rental_requests (created_at, borrower_name, employee_id) VALUES (?, ?, ?)",
      [now, identity.name, identity.employeeId]
    );
    requestNo = Number(requestRow.lastInsertRowid) || 0;
    for (const info of borrowList) {
      const purpose = info.borrowPurpose;
      const borrowDate = info.borrowDate || now;
      const floor = info.floor || null;
      const unit = info.unit || null;

      if (info.itemType !== "scenario") {
        const generalBatchId = crypto.randomUUID();
        for (const item of info.borrowedItems || []) {
          const choice = variantChoiceOf(item);
          run(
            `INSERT INTO general_rentals (borrower_name, item_id, item_label, qty, borrow_date, purpose, returned, return_date, email, batch_id, applied_at, category, confirmed_at, status, floor, unit, variant_id, variant_pending, request_no)
             VALUES (?, ?, ?, ?, ?, ?, 'X', NULL, ?, ?, ?, ?, NULL, 'active', ?, ?, ?, ?, ?)`,
            [info.borrowerName, padSlot(item.id || ""), item.name || "", item.quantity || 1, borrowDate, purpose, contact.email || "", generalBatchId, now, info.generalOption || "", floor, unit, choice.variantId, choice.pending ? "Y" : null, requestNo]
          );
          generalCount += item.quantity || 1;
          applyBorrowStock(item.id, item.quantity || 1, choice);
        }
        continue;
      }

      const required = info.requiredObjects || [];
      const additional = additionalItemsRecorded ? [] : info.additionalItems || [];
      if (additional.length) additionalItemsRecorded = true;

      for (const item of required) {
        const choice = variantChoiceOf(item);
        run(
          `INSERT INTO sid_rentals (borrower_name, sid, item_label, borrow_date, purpose, returned, return_date, email, batch_id, applied_at, item_type, confirmed_at, status, floor, unit, variant_id, variant_pending, request_no)
           VALUES (?, ?, ?, ?, ?, 'X', NULL, ?, ?, ?, '대여 물품', NULL, 'active', ?, ?, ?, ?, ?)`,
          [info.borrowerName, info.scenarioId, scenarioItemLabel(item), borrowDate, purpose, contact.email || "", scenarioBatchId, now, floor, unit, choice.variantId, choice.pending ? "Y" : null, requestNo]
        );
        applyBorrowStock(item.id, item.quantity || 1, choice);
      }
      if (!required.length) {
        run(
          `INSERT INTO sid_rentals (borrower_name, sid, item_label, borrow_date, purpose, returned, return_date, email, batch_id, applied_at, item_type, confirmed_at, status, floor, unit, request_no)
           VALUES (?, ?, '', ?, ?, 'X', NULL, ?, ?, ?, '대여 물품', NULL, 'active', ?, ?, ?)`,
          [info.borrowerName, info.scenarioId, borrowDate, purpose, contact.email || "", scenarioBatchId, now, floor, unit, requestNo]
        );
      }
      scenarioCount++;

      for (const item of additional) {
        const choice = variantChoiceOf(item);
        run(
          `INSERT INTO general_rentals (borrower_name, item_id, item_label, qty, borrow_date, purpose, returned, return_date, email, batch_id, applied_at, category, confirmed_at, status, floor, unit, variant_id, variant_pending, request_no)
           VALUES (?, ?, ?, ?, ?, ?, 'X', NULL, ?, ?, ?, 'SID 추가 물품', NULL, 'active', ?, ?, ?, ?, ?)`,
          [info.borrowerName, padSlot(item.id || ""), item.name || "", item.quantity || 1, borrowDate, purpose, contact.email || "", additionalBatchId, now, floor, unit, choice.variantId, choice.pending ? "Y" : null, requestNo]
        );
        generalCount += item.quantity || 1;
        applyBorrowStock(item.id, item.quantity || 1, choice);
      }
    }
    run("UPDATE sid_rentals SET employee_id = ? WHERE request_no = ?", [identity.employeeId, requestNo]);
    run("UPDATE general_rentals SET employee_id = ? WHERE request_no = ?", [identity.employeeId, requestNo]);
  });

  // 무인 모드 위치 QR용 토큰. 신청마다 하나만 발급하고, 이 신청 물품의 위치를 지금 보여줘도
  // 되는지는 조회할 때마다 서버가 실시간으로 판정한다(server/lib/locationVisibility.js).
  const locationToken = crypto.randomBytes(24).toString("base64url");
  run(
    "INSERT INTO location_tokens (token, request_no, borrower_name, employee_id, created_at) VALUES (?, ?, ?, ?, ?)",
    [locationToken, requestNo, identity.name, identity.employeeId, now]
  );

  // 재고가 없어 빠진 물품이 있으면 함께 돌려준다 — 화면이 "무엇이 빠졌는지"를 그대로 알려줄 수 있게.
  return {
    message: `SID ${scenarioCount}건, 일반 물품 ${generalCount}개를 기록했습니다.`,
    requestNo, locationToken,
    ...(shortages.length ? { skipped: shortages } : {}),
  };
}

async function processReturn({ payload }) {
  const { returnRequests } = payload || {};
  if (!Array.isArray(returnRequests) || !returnRequests.length) return { success: false, message: "반납할 물품을 선택해주세요." };

  const now = nowIso();
  let processed = 0;
  // 종류가 생기기 전에 나간 대여 건은 어느 종류가 돌아오는지 기록이 없다 — 담당자가
  // 골라줘야 그 종류의 재고로 되돌릴 수 있다. 한 줄이라도 빠지면 아무것도 처리하지 않는다.
  const vMapForReturn = variantMap();
  for (const request of returnRequests) {
    const isScenario = request.sheetType === "scenario";
    const table = isScenario ? "sid_rentals" : "general_rentals";
    const row = get(`SELECT * FROM ${table} WHERE id = ?`, [request.rowIndex]);
    if (!row || row.returned === "O") continue;
    if (row.variant_id || row.variant_pending === "Y") continue;
    // 파손 반납은 선반으로 돌아가지 않으니 어느 종류였는지 몰라도 된다 — 묻지 않는다.
    if (request.damaged) continue;

    const itemId = isScenario ? parseItemLabel(row.item_label).id : row.item_id;
    const list = vMapForReturn[padSlot(itemId || "")] || [];
    if (!list.length) continue; // 종류를 안 쓰는 물품 — 지금까지와 동일

    const vid = Number(request.variantId) || 0;
    if (!vid) {
      return { success: false, message: `'${row.item_label}'은(는) 종류가 생기기 전에 대여된 건입니다. 어떤 종류가 반납되는지 선택해주세요.` };
    }
    if (!list.some((v) => v.id === vid)) {
      return { success: false, message: `'${row.item_label}'에 없는 종류가 선택되었습니다. 화면을 새로고침한 뒤 다시 시도해주세요.` };
    }
  }

  transaction(() => {
    for (const request of returnRequests) {
      const isScenario = request.sheetType === "scenario";
      const table = isScenario ? "sid_rentals" : "general_rentals";
      const row = get(`SELECT * FROM ${table} WHERE id = ?`, [request.rowIndex]);
      if (!row || row.returned === "O") continue;

      let item, rowQty;
      if (isScenario) {
        item = parseItemLabel(row.item_label);
        rowQty = item.quantity || 1;
      } else {
        item = { id: row.item_id, name: row.item_label, quantity: row.qty || 1 };
        rowQty = row.qty || 1;
      }

      let reqQty = parseInt(request.quantity, 10);
      if (Number.isNaN(reqQty) || reqQty <= 0) reqQty = rowQty;
      if (reqQty > rowQty) reqQty = rowQty;

      if (reqQty < rowQty) {
        const remainQty = rowQty - reqQty;
        if (isScenario) {
          run(`UPDATE sid_rentals SET item_label = ? WHERE id = ?`, [scenarioItemLabel({ id: item.id, name: item.name, quantity: remainQty }), row.id]);
          run(
            `INSERT INTO sid_rentals (borrower_name, sid, item_label, borrow_date, purpose, returned, return_date, email, batch_id, applied_at, item_type, confirmed_at, status, variant_id, variant_pending, request_no)
             VALUES (?, ?, ?, ?, ?, 'O', ?, ?, ?, ?, ?, ?, 'archived', ?, ?, ?)`,
            [row.borrower_name, row.sid, scenarioItemLabel({ id: item.id, name: item.name, quantity: reqQty }), row.borrow_date, row.purpose, now, row.email, row.batch_id, row.applied_at, row.item_type, now, row.variant_id, row.variant_pending, row.request_no]
          );
        } else {
          run(`UPDATE general_rentals SET qty = ? WHERE id = ?`, [remainQty, row.id]);
          run(
            `INSERT INTO general_rentals (borrower_name, item_id, item_label, qty, borrow_date, purpose, returned, return_date, email, batch_id, applied_at, category, confirmed_at, status, variant_id, variant_pending, request_no)
             VALUES (?, ?, ?, ?, ?, ?, 'O', ?, ?, ?, ?, ?, ?, 'archived', ?, ?, ?)`,
            [row.borrower_name, row.item_id, row.item_label, reqQty, row.borrow_date, row.purpose, now, row.email, row.batch_id, row.applied_at, row.category, now, row.variant_id, row.variant_pending, row.request_no]
          );
        }
      } else {
        run(`UPDATE ${table} SET returned = 'O', return_date = ?, confirmed_at = ?, status = 'archived' WHERE id = ?`, [now, now, row.id]);
      }

      processed += reqQty;
      // 재고 되돌리기 규칙은 미수령 자동 취소와 공유한다(borrowUtils.restoreRentalStock).
      restoreRentalStock(row, item.id, reqQty, { variantId: request.variantId });
    }
  });
  return { message: `${processed}개 물품의 반납을 처리했습니다.` };
}

// 신청자가 "종류 상관없음"으로 담은 줄은 재고가 아직 빠지지 않은 상태다.
// 대여 확인 때 담당자가 실제로 나간 종류를 지정해야 하며, 그때 비로소 차감된다.
// (종류가 없는 물품이나 이미 종류가 정해진 줄은 지금까지와 똑같이 그냥 통과한다.)
// 파손 반납: 반납 처리(processReturn)로 물건은 이미 재고에 되돌아온 상태에서 호출된다.
// 여기서 파손 수량만큼 다시 깎고 불량 로그를 남긴다 —
// 순 효과는 "돌아왔지만 못 쓰는 수량"만큼 재고가 안 늘고, 대여 중은 정상적으로 빠지는 것.
// 사진은 묶음당 한 장만 저장하고 모든 불량 로그가 그 경로를 함께 쓴다(파일 중복 방지).
async function recordDamagedReturn({ payload }) {
  const rows = Array.isArray(payload?.items) ? payload.items : [];
  if (!rows.length) return { success: false, message: "파손으로 등록할 물품이 없습니다." };

  const defectType = payload?.defectType || "파손";
  const culprit = payload?.culprit || payload?.manager || null;
  const now = payload?.timestamp || nowIso();

  // 사진 한 장을 먼저 저장하고 경로를 공유한다. 저장 id는 첫 로그가 생긴 뒤에 알 수 있으므로
  // 임시 키로 저장한다.
  const imagePath = payload?.photo
    ? await maybeSaveImage(payload.photo, "defect_logs", `return_${Date.now()}`)
    : null;

  const warnings = [];
  let created = 0;
  transaction(() => {
    for (const r of rows) {
      const qty = Number(r?.qty) || 0;
      if (qty <= 0) continue;
      const itemId = padSlot(r?.itemId || "");
      const item = itemId ? get("SELECT name FROM scenario_items WHERE id = ?", [itemId]) : null;
      const name = r?.itemName || item?.name || "";

      // 교체 건(파손품을 버리고 대체품을 그대로 들고 가는 경우)은 대여가 이어지므로
      // 로그에서도 구분해둔다 — 나중에 "대여중인데 왜 재고가 빠졌나"를 되짚을 수 있어야 한다.
      const keep = !!r?.keepBorrowed;
      const detail = keep ? `[교체 후 계속 대여] ${payload?.note ?? ""}`.trim() : payload?.note ?? null;

      run(
        `INSERT INTO defect_logs (product, qty, occurred_date, defect_type, detail, action_taken, image_path, breaker)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [name, qty, now, defectType, detail, payload?.actionTaken ?? null, imagePath, culprit]
      );
      created++;

      // 반납 단계에서 재고를 되돌리지 않은 건(종류를 모르는 파손 건)은 여기서도 깎지 않는다.
      // 되돌린 적이 없는데 깎으면 그만큼 재고가 이중으로 사라진다.
      // 교체 건은 예외다 — 그 수량은 애초에 반납되지 않았고, 대신 대체품이 새로 나갔으므로
      // 정확히 한 번 깎는 것이 맞다(파손품 폐기분은 이미 대여중으로 빠져 있다).
      if (itemId && (keep || !r?.noStock)) {
        const res = applyDefectStockDeduction({
          itemId,
          variantId: r?.variantId,
          qty,
          reason: keep ? `파손 교체 (${defectType})` : `파손 반납 (${defectType})`,
          manager: culprit,
        });
        if (res.warning) warnings.push(res.warning);
      }

      // 교체로 대여가 이어지는 줄은 실제로 나간 물건이 바뀌었다 — 종류를 대체품 것으로 갱신한다.
      // 안 그러면 나중에 반납할 때 원래(파손된) 종류의 재고로 되돌아가 장부가 어긋난다.
      if (keep && r?.variantId && r?.rentalRowIndex) {
        const table = r.rentalSheetType === "general" ? "general_rentals" : "sid_rentals";
        const rental = get(`SELECT id, returned FROM ${table} WHERE id = ?`, [Number(r.rentalRowIndex)]);
        if (rental && rental.returned !== "O") {
          run(`UPDATE ${table} SET variant_id = ?, variant_pending = 'N' WHERE id = ?`, [Number(r.variantId), rental.id]);
        }
      }
    }
  });

  return {
    message: `${created}건을 불량 로그에 등록했습니다.`,
    created,
    warnings,
  };
}

function confirmPickup({ payload }) {
  const items = payload?.items || [];
  const now = nowIso();

  // 먼저 전부 검증한다 — 한 줄이라도 막히면 아무것도 처리하지 않는다.
  const resolved = [];
  for (const it of items) {
    const table = it.sheetType === "scenario" ? "sid_rentals" : "general_rentals";
    const row = get(`SELECT * FROM ${table} WHERE id = ?`, [it.rowIndex]);
    if (!row) continue;
    if (row.picked_up_at) continue;

    const parsed = table === "sid_rentals" ? parseItemLabel(row.item_label) : null;
    const itemId = table === "sid_rentals" ? parsed.id : row.item_id;
    const rowQty = table === "sid_rentals" ? (parsed.quantity || 1) : (Number(row.qty) || 1);
    let qty = parseInt(it.quantity, 10);
    if (Number.isNaN(qty) || qty <= 0) qty = rowQty;
    qty = Math.min(qty, rowQty);

    if (row.variant_pending !== "Y") {
      resolved.push({ table, row, parsed, variantId: null, qty, rowQty });
      continue;
    }

    const label = table === "sid_rentals" ? row.item_label : row.item_label;
    const variantId = Number(it.variantId) || 0;
    if (!variantId) {
      return { success: false, message: `'${label}'은(는) 종류가 정해지지 않았습니다. 실제로 가져간 종류를 선택한 뒤 확인해주세요.` };
    }
    const v = get("SELECT * FROM scenario_item_variants WHERE id = ? AND item_id = ?", [variantId, padSlot(itemId)]);
    if (!v) return { success: false, message: `'${label}'에 없는 종류가 선택되었습니다. 화면을 새로고침한 뒤 다시 시도해주세요.` };
    if (qty > (Number(v.stock) || 0)) {
      return { success: false, message: `재고 부족: '${v.name}' 종류의 남은 재고(${Number(v.stock) || 0}개)보다 확인 수량(${qty}개)이 많습니다.` };
    }
    resolved.push({ table, row, parsed, variantId, qty, rowQty });
  }

  let processed = 0;
  transaction(() => {
    for (const r of resolved) {
      const partial = r.qty < r.rowQty;
      const confirmedVariantId = r.variantId || r.row.variant_id || null;
      const confirmedVariantPending = r.variantId ? null : r.row.variant_pending;

      if (partial && r.table === "sid_rentals") {
        const remainQty = r.rowQty - r.qty;
        run(`UPDATE sid_rentals SET item_label = ? WHERE id = ?`, [scenarioItemLabel({ id: r.parsed.id, name: r.parsed.name, quantity: remainQty }), r.row.id]);
        run(
          `INSERT INTO sid_rentals (borrower_name, sid, item_label, borrow_date, purpose, returned, return_date, email, batch_id, applied_at, item_type, confirmed_at, status, floor, unit, variant_id, variant_pending, request_no, picked_up_at)
           VALUES (?, ?, ?, ?, ?, 'X', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [r.row.borrower_name, r.row.sid, scenarioItemLabel({ id: r.parsed.id, name: r.parsed.name, quantity: r.qty }), r.row.borrow_date, r.row.purpose,
           r.row.email, r.row.batch_id, r.row.applied_at, r.row.item_type, r.row.confirmed_at, r.row.status || "active", r.row.floor, r.row.unit,
           confirmedVariantId, confirmedVariantPending, r.row.request_no, now]
        );
      } else if (partial) {
        const remainQty = r.rowQty - r.qty;
        run(`UPDATE general_rentals SET qty = ? WHERE id = ?`, [remainQty, r.row.id]);
        run(
          `INSERT INTO general_rentals (borrower_name, item_id, item_label, qty, borrow_date, purpose, returned, return_date, email, batch_id, applied_at, category, confirmed_at, status, floor, unit, variant_id, variant_pending, request_no, picked_up_at)
           VALUES (?, ?, ?, ?, ?, ?, 'X', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [r.row.borrower_name, r.row.item_id, r.row.item_label, r.qty, r.row.borrow_date, r.row.purpose, r.row.email, r.row.batch_id, r.row.applied_at,
           r.row.category, r.row.confirmed_at, r.row.status || "active", r.row.floor, r.row.unit, confirmedVariantId, confirmedVariantPending, r.row.request_no, now]
        );
      } else if (r.variantId) {
        run(`UPDATE ${r.table} SET picked_up_at = ?, variant_id = ?, variant_pending = NULL WHERE id = ?`, [now, r.variantId, r.row.id]);
      } else {
        run(`UPDATE ${r.table} SET picked_up_at = ? WHERE id = ?`, [now, r.row.id]);
      }

      if (r.variantId) updateVariantInventory(r.variantId, r.qty); // 선택한 수량만 종류 재고에서 차감
      processed += r.qty;
    }
  });
  return { message: `${processed}개 물품의 픽업을 확인했습니다.` };
}

function getRegisteredUser({ query }) {
  const user = registeredUser(query.employeeId);
  return user ? { found: true, employeeId: user.employee_id, name: user.name } : { found: false };
}

function searchRegisteredUsers({ query }) {
  const raw = String(query.query || query.name || "").trim();
  const key = normalizePersonName(raw);
  if (!key) return { items: [] };
  const rows = all("SELECT employee_id, name FROM registered_users WHERE active = 1 AND employee_id != '0000'")
    .filter((row) => normalizePersonName(row.name).includes(key) || String(row.employee_id).includes(raw))
    .sort((a, b) => {
      const an = normalizePersonName(a.name), bn = normalizePersonName(b.name);
      const ae = an === key ? 0 : an.startsWith(key) ? 1 : 2;
      const be = bn === key ? 0 : bn.startsWith(key) ? 1 : 2;
      return ae - be || a.name.localeCompare(b.name, "ko") || a.employee_id.localeCompare(b.employee_id);
    })
    .slice(0, 12)
    .map((row) => ({ employeeId: row.employee_id, name: row.name }));
  return { items: rows };
}

function swapBorrowItem({ payload }) {
  const { sheetType, rowIndex, newItemId, newQuantity, reason, newVariantId } = payload || {};
  const table = sheetType === "scenario" ? "sid_rentals" : "general_rentals";
  const row = get(`SELECT * FROM ${table} WHERE id = ?`, [rowIndex]);
  if (!row) return { success: false, message: "대상을 찾을 수 없습니다." };
  const now = nowIso();
  const invMap = objectMap();
  const newObj = invMap[padSlot(newItemId)];

  // 반납되는 쪽은 원래 대여 기록에 종류가 남아 있으니 그대로 되돌리면 되고,
  // 새로 나가는 쪽만 어느 종류인지 정해주면 된다.
  const vm = variantMap();
  const newVariants = vm[padSlot(newItemId || "")] || [];
  if (newVariants.length) {
    const vid = Number(newVariantId) || 0;
    const v = newVariants.find((x) => x.id === vid);
    if (!v) return { success: false, message: `'${newObj?.name || newItemId}'은(는) 종류를 선택해야 교체할 수 있습니다.` };
    if ((newQuantity || 1) > (Number(v.stock) || 0)) {
      return { success: false, message: `재고 부족: '${v.name}' 종류의 재고(${Number(v.stock) || 0}개)보다 많이 교체할 수 없습니다.` };
    }
  }

  // 새로 나가는 쪽 차감 / 돌아오는 쪽 복구를 종류까지 맞춰 처리한다.
  const takeOut = (qty) => {
    if (newVariants.length) updateVariantInventory(Number(newVariantId), qty);
    else updateInventory(newItemId, qty);
  };
  const putBack = (itemId, qty) => {
    if (row.variant_id) updateVariantInventory(row.variant_id, -qty);
    else if (row.variant_pending === "Y") { /* 확인 전이라 빠진 적이 없다 */ }
    else if (itemId) updateInventory(itemId, -qty);
  };

  transaction(() => {
    run(`UPDATE ${table} SET returned = 'O', return_date = ?, status = 'archived' WHERE id = ?`, [now, rowIndex]);
    if (sheetType === "scenario") {
      const oldParsed = parseItemLabel(row.item_label);
      putBack(oldParsed.id, oldParsed.quantity || 1);
      const label = scenarioItemLabel({ id: newItemId, name: newObj?.name || "", quantity: newQuantity || 1 });
      run(
        `INSERT INTO sid_rentals (borrower_name, sid, item_label, borrow_date, purpose, returned, email, batch_id, applied_at, item_type, status, floor, unit, variant_id, request_no)
         VALUES (?, ?, ?, ?, ?, 'X', ?, ?, ?, '물품 교체', 'active', ?, ?, ?, ?)`,
        [row.borrower_name, row.sid, label, now, reason || row.purpose, row.email, row.batch_id, now, row.floor, row.unit,
         newVariants.length ? Number(newVariantId) : null, row.request_no]
      );
      takeOut(newQuantity || 1);
    } else {
      putBack(row.item_id, row.qty || 1);
      run(
        `INSERT INTO general_rentals (borrower_name, item_id, item_label, qty, borrow_date, purpose, returned, email, batch_id, applied_at, category, status, floor, unit, variant_id, request_no)
         VALUES (?, ?, ?, ?, ?, ?, 'X', ?, ?, ?, '물품 교체', 'active', ?, ?, ?, ?)`,
        [row.borrower_name, padSlot(newItemId), newObj?.name || row.item_label, newQuantity || 1, now, reason || row.purpose, row.email, row.batch_id, now, row.floor, row.unit,
         newVariants.length ? Number(newVariantId) : null, row.request_no]
      );
      takeOut(newQuantity || 1);
    }
  });
  return { message: "물품을 교체했습니다." };
}

// ── 시나리오 오브젝트 관리자 CRUD ────────────────────────────

// "설정 > 시나리오 변경 이력"에서 보여줄, 재고가 아닌 속성 변경/등록/삭제 기록.
/** 치수는 선택 입력이라 빈 문자열·0·잘못된 값은 전부 "없음"(NULL)으로 저장한다. */
function numOrNull(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const SCI_EDIT_FIELDS = [
  { key: "name", label: "이름" },
  { key: "category", label: "카테고리" },
  { key: "subcategory", label: "서브카테고리" },
  { key: "sector", label: "구역" },
  { key: "rootSlot", label: "위치" },
  { key: "archived", label: "보관 처리", bool: true },
  { key: "fragile", label: "파손 위험", bool: true },
  { key: "fireRisk", label: "화재 위험", bool: true },
  { key: "requestFor", label: "request 업체" },
  { key: "personalOwner", label: "개인 물품 소유자" },
  { key: "widthMm", label: "가로(mm)" },
  { key: "depthMm", label: "세로(mm)" },
  { key: "heightMm", label: "높이(mm)" },
  { key: "purchaseLink", label: "구매 링크" },
  { key: "smSize", label: "크기(SM)" },
  { key: "smProperty", label: "속성(SM)" },
  { key: "productMemo", label: "기타 메모" },
];
function logScenarioEdit(itemId, itemName, changeType, summary, manager) {
  if (!summary) return;
  run(
    `INSERT INTO scenario_item_edits (occurred_at, item_id, item_name, change_type, summary, manager) VALUES (?, ?, ?, ?, ?, ?)`,
    [nowIso(), itemId, itemName || "", changeType, summary, manager || null]
  );
}
function diffScenarioFields(before, after) {
  const parts = [];
  for (const f of SCI_EDIT_FIELDS) {
    const bv = f.bool ? !!before?.[f.key] : (before?.[f.key] ?? "");
    const av = f.bool ? !!after?.[f.key] : (after?.[f.key] ?? "");
    if (bv === av) continue;
    if (f.bool) parts.push(`${f.label}: ${bv ? "예" : "아니오"} → ${av ? "예" : "아니오"}`);
    else parts.push(`${f.label}: "${bv || "-"}" → "${av || "-"}"`);
  }
  return parts.join(", ");
}

const SM_METADATA_DIRTY_KEY = "sm_metadata_dirty_ids";
function smMetadataDirtyIds() {
  try {
    const value = get("SELECT value FROM settings WHERE key = ?", [SM_METADATA_DIRTY_KEY])?.value || "[]";
    return [...new Set(JSON.parse(value).map((id) => padSlot(id)).filter(Boolean))];
  } catch { return []; }
}
function saveSmMetadataDirtyIds(ids) {
  run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [SM_METADATA_DIRTY_KEY, JSON.stringify([...new Set(ids)])]);
}
function markSmMetadataDirty(id) {
  saveSmMetadataDirtyIds([...smMetadataDirtyIds(), padSlot(id)]);
}
function clearSmMetadataDirty(ids) {
  const done = new Set(ids.map(padSlot));
  saveSmMetadataDirtyIds(smMetadataDirtyIds().filter((id) => !done.has(id)));
}
function smRootSlotValue(rootSlot) {
  const slot = String(rootSlot ?? "").trim();
  return slot || "Unknown";
}
function smUploadName(name) {
  const original = String(name ?? "").trim();
  const cleaned = original
    .replace(/\s*[\(\[\{（［｛][^()\[\]{}（）［］｛｝]*[\)\]\}）］｝]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || original;
}

function storedImageDataUrl(imagePath) {
  const value = String(imagePath || "");
  if (!value.startsWith("/uploads/")) return "";
  const relative = value.slice("/uploads/".length).replace(/\\/g, "/");
  const filePath = path.resolve(uploadsDir, relative);
  const root = path.resolve(uploadsDir) + path.sep;
  if (!filePath.startsWith(root) || !fs.existsSync(filePath)) return "";
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/webp";
  return `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
}

async function pushScenarioMetadataRow(row) {
  if (!row) return { ok: false, reason: "WMS 물품을 찾지 못했습니다." };
  return smLocationSync.pushItemChanges(row.id, {
    name: smUploadName(row.name),
    sector: row.sector || "",
    rootSlot: row.root_slot || "",
    productLink: row.purchase_link || "",
    smSize: row.sm_size || "",
    smProperty: row.sm_property || "",
    productMemo: row.product_memo || "",
    imageDataUrl: storedImageDataUrl(row.image_path),
  });
}

// 클라이언트가 항상 전체 필드를 보내는 게 아니라(예: 보관함 토글은 {rowIndex, archived}만 보냄),
// 기존 행 값을 먼저 읽어와 페이로드에 있는 필드만 덮어쓴다 — 부분 업데이트로 다른 속성이 날아가지 않게.
async function updateScenarioObject({ payload }) {
  const item = payload || {};
  const id = padSlot(item.rowIndex || item.id);
  const existing = get("SELECT * FROM scenario_items WHERE id = ?", [id]);
  const existingObj = existing ? toScenarioObject(existing, { forAdmin: true }) : {};
  const merged = { ...existingObj, ...item };
  let smUpdate = null;
  const imagePath = item.image !== undefined ? await maybeSaveImage(item.image, "scenario_items", id) : existing?.image_path ?? null;
  run(
    `UPDATE scenario_items SET name=?, sector=?, root_slot=?, category=?, subcategory=?, image_path=?, stock=?, rented=?,
       exclude_low_rent=?, fragile=?, fire=?, request=?, personal_owner=?, is_storage=?,
       width_mm=?, depth_mm=?, height_mm=?, shape=?, purchase_link=?, sm_size=?, sm_property=?, product_memo=? WHERE id=?`,
    [
      merged.name ?? null, merged.sector ?? null, merged.rootSlot ?? null, merged.category ?? null, merged.subcategory ?? null,
      imagePath, merged.stock ?? 0, merged.rented ?? 0,
      merged.excludeFromRanking ? "TRUE" : null, merged.fragile ? "TRUE" : null, merged.fireRisk ? "TRUE" : null,
      merged.requestFor !== undefined ? merged.requestFor : null, merged.personalOwner !== undefined ? merged.personalOwner : null, merged.archived ? "TRUE" : null,
      numOrNull(merged.widthMm), numOrNull(merged.depthMm), numOrNull(merged.heightMm), shapeOrNull(merged.shape),
      merged.purchaseLink ?? null, merged.smSize ?? null, merged.smProperty ?? null, merged.productMemo ?? null,
      id,
    ]
  );
  // 종류가 있는 물품은 총재고가 종류 합계로 결정된다 — 위 UPDATE가 넘겨받은 stock으로
  // 덮어썼더라도 여기서 다시 합계로 되돌린다.
  syncItemStockFromVariants(id);
  const summary = diffScenarioFields(existingObj, merged);
  if (summary) logScenarioEdit(id, merged.name, "updated", summary, changeActor(item));
  // 위치와 구매 링크는 SM에도 같은 값이 있다 — 바뀌었으면 그쪽도 맞춘다.
  // 재고는 여기서 건드리지 않는다. 재고 동기화(smSync)가 20초마다 따로 맞추고 있어서,
  // 양쪽에서 같이 쓰면 서로 덮어쓴다.
  const linkChanged = item.purchaseLink !== undefined && (existingObj.purchaseLink || "") !== (merged.purchaseLink || "");
  const slotChanged = item.rootSlot !== undefined && (existingObj.rootSlot || "") !== (merged.rootSlot || "");
  const nameChanged = item.name !== undefined && (existingObj.name || "") !== (merged.name || "");
  const sectorChanged = item.sector !== undefined && (existingObj.sector || "") !== (merged.sector || "");
  const sizeChanged = item.smSize !== undefined && (existingObj.smSize || "") !== (merged.smSize || "");
  const propertyChanged = item.smProperty !== undefined && (existingObj.smProperty || "") !== (merged.smProperty || "");
  const memoChanged = item.productMemo !== undefined && (existingObj.productMemo || "") !== (merged.productMemo || "");
  // 사진을 새로 올린 경우다. 값이 아니라 파일이라 "바뀌었는지"를 비교할 수 없으니,
  // 새 사진이 실려 왔다는 것 자체를 바뀐 것으로 본다.
  const newImage = typeof item.image === "string" && item.image.startsWith("data:image/") ? item.image : "";
  // SM 반영은 기다리지 않는다. 목록을 받아와야 하는 경우가 있어 몇 분이 걸릴 수 있고,
  // 그동안 화면이 멈춰 있으면 저장이 실패한 것처럼 보인다(실제로 타임아웃이 났다).
  // 창고 장부가 먼저다 — WMS 저장은 이미 끝났고, SM은 뒤따라간다. 결과는 로그에 남는다.
  const smMetadataChanged = linkChanged || slotChanged || nameChanged || sectorChanged || sizeChanged || propertyChanged || memoChanged || !!newImage;
  if (smMetadataChanged) {
    markSmMetadataDirty(id);
    smUpdate = { queued: true };
    void (async () => {
    if (smObjects.enabled()) {
      // 토큰 창구는 바꾸려는 항목만 보낼 수 있다.
      const changes = {};
      if (nameChanged) changes.name = smUploadName(merged.name);
      if (sectorChanged) changes.sector = merged.sector || "";
      if (linkChanged) changes.product_link = merged.purchaseLink || "";
      if (slotChanged) { changes.root_slot = smRootSlotValue(merged.rootSlot); changes.location = smRootSlotValue(merged.rootSlot); }
      if (sizeChanged) changes.size = merged.smSize || "Small";
      if (propertyChanged) changes.property = merged.smProperty || "Hard";
      if (memoChanged) changes.product_memo = merged.productMemo || "";
      if (Object.keys(changes).length) await smObjects.updateObject(id, changes, { actorId: item.manager });
      // 토큰 창구는 사진을 별도 요청으로 받는다.
      if (newImage) await smObjects.putImage(id, newImage, { actorId: item.manager });
    } else {
      // 세션 창구는 전체를 다시 저장해야 한다. 사진을 포함해 나머지 값은 SM에서 읽어
      // 그대로 되돌려 보내므로 다른 값이 사라지지 않는다.
      await smLocationSync.pushItemChanges(id, {
        rootSlot: merged.rootSlot || "",
        productLink: merged.purchaseLink || "",
        name: smUploadName(merged.name),
        sector: merged.sector || "",
        smSize: merged.smSize || "",
        smProperty: merged.smProperty || "",
        productMemo: merged.productMemo || "",
        imageDataUrl: newImage,
      });
    }
    })().catch((e) => console.error(`[sm-update:${id}]`, e));
  }
  const row = get("SELECT * FROM scenario_items WHERE id = ?", [id]);
  return { item: toScenarioObject(row, { forAdmin: true }), variants: variantMap()[id] || [], smUpdate };
}

// 등록은 SM이 번호를 부여하는 것부터 시작한다. 관리자가 번호를 직접 적어 보내면
// 지금까지처럼 그 번호를 그대로 쓴다(이미 SM에 있는 오브젝트를 WMS에 뒤늦게 넣는 경우).
//
// 순서가 SM 먼저인 이유: WMS를 먼저 만들면 임시 번호를 지어내야 하고, 나중에 진짜 번호로
// 바꾸려면 대여 기록까지 전부 따라가야 한다. 반대로 SM이 먼저 성공하고 WMS INSERT가
// 실패하면 SM에만 오브젝트가 남는데, 그때는 관리자에게 그 번호를 알려주어 같은 번호로
// 다시 등록하게 한다 — 그러면 아무것도 중복되지 않는다.
async function addScenarioObject({ payload }) {
  const item = payload || {};
  let id = padSlot(item.id || "");
  let smCreated = null;
  let smFinalize = null;
  let smCreatedRow = null;
  if (!id) {
    const registrar = objectRegistrar();
    if (!registrar.enabled()) throw new Error(registrar.disabledReason());
    const res = await registrar.createObject(item, { actorId: item.manager, idempotencyKey: item.clientId });
    smCreated = res.id;
    // 등록하면서 받아 둔 SM 행. 뒤에서 위치를 넣을 때 그대로 쓴다 — 없으면 목록 전체를
    // 다시 받게 되고, 그것만으로 몇 분이 걸린다.
    smCreatedRow = res.row || null;
    id = padSlot(res.id);
    if (get("SELECT id FROM scenario_items WHERE id = ?", [id])) {
      // 같은 등록 시도가 두 번 닿은 경우다 — SM은 중복 방지 키 덕분에 같은 오브젝트를
      // 돌려주고, WMS에는 첫 번째 시도가 이미 넣어두었다. 양쪽 다 하나씩이라 문제는 없다.
      throw new Error(`이미 ${id}번으로 등록된 물품입니다. 목록에서 확인해 주세요.`);
    }
  }
  const imagePath = await maybeSaveImage(item.image, "scenario_items", id);
  run(
    `INSERT INTO scenario_items (id, name, sector, root_slot, category, subcategory, image_path, stock, rented,
       exclude_low_rent, fragile, fire, request, personal_owner, is_storage, width_mm, depth_mm, height_mm, shape, purchase_link,
       sm_size, sm_property, product_memo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, item.name ?? null, item.sector ?? null, item.rootSlot ?? null, item.category ?? null, item.subcategory ?? null,
      imagePath, item.stock ?? 0, item.rented ?? 0,
      item.excludeFromRanking ? "TRUE" : null, item.fragile ? "TRUE" : null, item.fireRisk ? "TRUE" : null,
      item.requestFor !== undefined ? item.requestFor : null, item.personalOwner !== undefined ? item.personalOwner : null, item.archived ? "TRUE" : null,
      numOrNull(item.widthMm), numOrNull(item.depthMm), numOrNull(item.heightMm), shapeOrNull(item.shape),
      item.purchaseLink ?? null, item.smSize ?? null, item.smProperty ?? null, item.productMemo ?? null,
    ]
  );
  logScenarioEdit(id, item.name, "created", `신규 등록 (재고 ${item.stock ?? 0}개)${smCreated ? " · SM 등록" : ""}`, changeActor(item));
  // 사진은 번호가 난 뒤에야 올릴 수 있다. 여기서 실패해도 등록 자체는 유효하다 —
  // 번호는 이미 났고 사진은 수정 화면에서 다시 올리면 된다.
  // 토큰 창구는 사진을 별도 요청으로 받는다. 세션 창구는 등록 요청에 이미 실어 보냈다.
  if (smCreated && item.image && smObjects.enabled()) await smObjects.putImage(smCreated, item.image, { actorId: item.manager });
  // 세션 창구는 등록 단계에서 위치와 수량을 받지 않는다 — 번호가 난 뒤에 따로 넣는다.
  if (smCreated && !smObjects.enabled()) smFinalize = await smObjectsSession.finalizeAfterCreate(smCreated, item, { current: smCreatedRow });
  const row = get("SELECT * FROM scenario_items WHERE id = ?", [id]);
  return { item: toScenarioObject(row, { forAdmin: true }), smRegistered: !!smCreated, smFinalize };
}

// 물품 하나의 "종류" 목록을 통째로 저장한다(추가/이름 변경/수량 변경/삭제).
// 저장하는 순간부터 이 물품의 총재고는 종류 재고의 합으로 덮어써진다 — 그 전까지는
// 기존 총재고를 그대로 두므로, 종류를 안 쓰는 물품은 아무 영향도 받지 않는다.
async function saveScenarioVariants({ payload }) {
  const itemId = padSlot(payload?.itemId);
  const item = get("SELECT * FROM scenario_items WHERE id = ?", [itemId]);
  if (!item) return { success: false, message: "물품을 찾을 수 없습니다." };

  const incoming = Array.isArray(payload?.variants) ? payload.variants : [];
  for (const v of incoming) {
    if (!String(v?.name || "").trim()) return { success: false, message: "종류 이름은 비워둘 수 없습니다." };
    if (!(Number(v?.stock) >= 0)) return { success: false, message: `'${v.name}' 종류의 재고는 0 이상이어야 합니다.` };
  }
  const names = incoming.map((v) => String(v.name).trim());
  if (new Set(names).size !== names.length) return { success: false, message: "같은 이름의 종류가 두 개 이상입니다." };

  const existing = all("SELECT * FROM scenario_item_variants WHERE item_id = ?", [itemId]);
  const keepIds = new Set(incoming.map((v) => Number(v.id)).filter(Boolean));

  // 대여 중이거나 대여 기록이 걸려 있는 종류는 지울 수 없다 — 지우면 그 대여 건이
  // 어떤 종류였는지 영영 알 수 없게 되고, 반납 때 되돌릴 재고도 사라진다.
  for (const row of existing) {
    if (keepIds.has(row.id)) continue;
    if (Number(row.rented) > 0) return { success: false, message: `'${row.name}' 종류는 대여 중인 수량이 있어 삭제할 수 없습니다.` };
    const used = get(
      "SELECT 1 FROM sid_rentals WHERE variant_id = ? AND status = 'active' UNION ALL SELECT 1 FROM general_rentals WHERE variant_id = ? AND status = 'active'",
      [row.id, row.id]
    );
    if (used) return { success: false, message: `'${row.name}' 종류를 쓰는 대여 건이 남아 있어 삭제할 수 없습니다.` };
  }

  // 종류별 사진은 트랜잭션 밖에서 미리 저장한다 — 파일 I/O가 트랜잭션을 오래 잡지 않도록.
  const imagePaths = [];
  for (const v of incoming) {
    const prev = existing.find((r) => r.id === Number(v.id));
    if (v.image === undefined) { imagePaths.push(prev?.image_path ?? null); continue; }
    if (!v.image) { imagePaths.push(null); continue; } // 사진 제거
    imagePaths.push(await maybeSaveImage(v.image, "scenario_variants", `${itemId}_${v.id || `new${imagePaths.length}`}`));
  }

  const unassigned = Math.max(0, Number(payload?.unassignedStock) || 0);

  // 치수는 "안 보냈으면 그대로 둔다". 재고 조정 화면처럼 이름·재고만 보내는 곳이 있어서,
  // 무조건 덮어쓰면 그쪽에서 저장할 때마다 애써 재둔 치수가 날아간다.
  const dimOf = (v, prev) => ({
    width: v?.widthMm === undefined ? (prev?.width_mm ?? null) : numOrNull(v.widthMm),
    depth: v?.depthMm === undefined ? (prev?.depth_mm ?? null) : numOrNull(v.depthMm),
    height: v?.heightMm === undefined ? (prev?.height_mm ?? null) : numOrNull(v.heightMm),
    shape: v?.shape === undefined ? (prev?.shape ?? null) : shapeOrNull(v.shape),
  });

  transaction(() => {
    for (const row of existing) if (!keepIds.has(row.id)) run("DELETE FROM scenario_item_variants WHERE id = ?", [row.id]);
    incoming.forEach((v, i) => {
      const name = String(v.name).trim();
      const stock = Number(v.stock) || 0;
      const prev = existing.find((r) => r.id === Number(v.id));
      const d = dimOf(v, prev);
      if (v.id && existing.some((r) => r.id === Number(v.id))) {
        run(
          "UPDATE scenario_item_variants SET name = ?, stock = ?, sort_order = ?, image_path = ?, width_mm = ?, depth_mm = ?, height_mm = ?, shape = ? WHERE id = ?",
          [name, stock, i, imagePaths[i], d.width, d.depth, d.height, d.shape, Number(v.id)]
        );
      } else {
        run(
          "INSERT INTO scenario_item_variants (item_id, name, stock, rented, sort_order, image_path, width_mm, depth_mm, height_mm, shape) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?)",
          [itemId, name, stock, i, imagePaths[i], d.width, d.depth, d.height, d.shape]
        );
      }
    });
    // 종류를 다 지우면 미확인 개념도 의미가 없어지므로 같이 0으로 되돌린다.
    run("UPDATE scenario_items SET unassigned_stock = ? WHERE id = ?", [incoming.length ? unassigned : 0, itemId]);
    syncItemStockFromVariants(itemId);
  });

  const after = get("SELECT * FROM scenario_items WHERE id = ?", [itemId]);
  const summary = incoming.length
    ? `종류 설정: ${incoming.map((v) => `${String(v.name).trim()} ${Number(v.stock) || 0}개`).join(", ")}${unassigned ? `, 미확인 ${unassigned}개` : ""}`
    : "종류 구분 해제";
  logScenarioEdit(itemId, item.name, "updated", summary, changeActor(payload));
  return { item: toScenarioObject(after), variants: variantMap()[itemId] || [] };
}

// 미확인(종류를 아직 모르는 선반 재고)에서 실제 종류로 옮긴다.
// 관리자가 창고에서 실물을 확인한 뒤 "이 3개는 Empty Can이었다"를 반영하는 용도.
function assignUnassignedStock({ payload }) {
  const itemId = padSlot(payload?.itemId);
  const item = get("SELECT * FROM scenario_items WHERE id = ?", [itemId]);
  if (!item) return { success: false, message: "물품을 찾을 수 없습니다." };

  // 여러 종류를 한 번에 옮기는 형태(items)와 한 건만 옮기는 옛 형태를 모두 받는다.
  const rows = Array.isArray(payload?.items) && payload.items.length
    ? payload.items
    : [{ variantId: payload?.variantId, quantity: payload?.quantity }];

  const moves = [];
  let total = 0;
  for (const r of rows) {
    const qty = Number(r?.quantity) || 0;
    if (qty <= 0) continue; // 0은 그냥 건너뛴다 — 입력 안 한 칸일 뿐이다
    const variant = get("SELECT * FROM scenario_item_variants WHERE id = ? AND item_id = ?", [Number(r?.variantId) || 0, itemId]);
    if (!variant) return { success: false, message: "이 물품에 없는 종류입니다." };
    moves.push({ variant, qty });
    total += qty;
  }
  if (!moves.length) return { success: false, message: "옮길 수량을 1개 이상 입력해주세요." };

  const unassigned = Number(item.unassigned_stock) || 0;
  if (total > unassigned) {
    return { success: false, message: `미확인 재고(${unassigned}개)보다 많이 옮길 수 없습니다. (입력 합계 ${total}개)` };
  }

  // 여러 종류를 한 트랜잭션으로 옮긴다 — 중간에 실패해 일부만 반영되는 일이 없도록.
  transaction(() => {
    run("UPDATE scenario_items SET unassigned_stock = ? WHERE id = ?", [unassigned - total, itemId]);
    for (const m of moves) {
      run("UPDATE scenario_item_variants SET stock = ? WHERE id = ?", [(Number(m.variant.stock) || 0) + m.qty, m.variant.id]);
    }
    syncItemStockFromVariants(itemId); // 총재고는 그대로(칸만 이동) — 그래도 다시 맞춰둔다
  });

  const detail = moves.map((m) => `${m.variant.name} ${m.qty}개`).join(", ");
  logScenarioEdit(itemId, item.name, "updated", `미확인 ${total}개 배분: ${detail}`, changeActor(payload));
  const after = get("SELECT * FROM scenario_items WHERE id = ?", [itemId]);
  return { item: toScenarioObject(after), variants: variantMap()[itemId] || [], moved: total };
}

// 카테고리 일괄 정리용. updateScenarioObject는 재고/대여중까지 함께 다시 쓰기 때문에,
// 대여가 오가는 중에 수백 건을 돌리면 그 사이의 대여/반납을 덮어쓸 수 있다.
// 여기서는 분류 두 칸만 건드린다.
function updateScenarioCategories({ payload }) {
  const rows = Array.isArray(payload?.items) ? payload.items : [];
  if (!rows.length) return { success: false, message: "변경할 물품이 없습니다." };

  let updated = 0;
  const missing = [];
  transaction(() => {
    for (const r of rows) {
      const id = padSlot(r?.id);
      const existing = get("SELECT id, name, category, subcategory FROM scenario_items WHERE id = ?", [id]);
      if (!existing) { missing.push(id); continue; }
      const cat = r.category ?? null;
      const sub = r.subcategory ?? null;
      if (existing.category === cat && existing.subcategory === sub) continue;
      run("UPDATE scenario_items SET category = ?, subcategory = ? WHERE id = ?", [cat, sub, id]);
      logScenarioEdit(id, existing.name, "updated",
        `분류 변경: ${existing.category || "(없음)"} > ${existing.subcategory || "(없음)"} → ${cat || "(없음)"} > ${sub || "(없음)"}`,
        changeActor(payload));
      updated++;
    }
  });
  return { message: `${updated}건의 분류를 변경했습니다.`, updated, missing };
}

/** 아는 형태만 저장한다 — 모르는 값이 들어오면 기본(육면체)으로 둔다. */
function shapeOrNull(v) {
  return ["box", "cylinder", "pyramid"].includes(v) ? v : null;
}

/**
 * 아직 반납되지 않은 대여 줄의 자리(층·유닛)를 바꾼다.
 *
 * 자리는 대여할 때 찍히는데, 그 뒤에 자리를 옮기는 사람이 있다. 그러면 반납을 받으러 가거나
 * 물건을 찾을 때 적힌 자리가 틀려서 헛걸음을 한다. 담당자가 화면에서 바로 고칠 수 있게 한다.
 *
 * 이미 반납된 줄은 건드리지 않는다 — 그건 "그때 어디에 있었나"라는 지난 기록이라 고치면 안 된다.
 * 자리 정보가 없는 창고(공구) 대여는 애초에 대상이 아니다.
 */
function updateBorrowerSeat({ payload }) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const floor = String(payload?.floor ?? "").trim();
  const unit = String(payload?.unit ?? "").trim();
  if (!rows.length) return { success: false, message: "자리를 바꿀 대여 기록이 없습니다." };

  let updated = 0;
  transaction(() => {
    for (const r of rows) {
      const id = Number(r?.rowIndex);
      if (!id) continue;
      const table = r?.sheetType === "scenario" ? "sid_rentals" : r?.sheetType === "general" ? "general_rentals" : null;
      if (!table) continue;
      const row = get(`SELECT id, returned FROM ${table} WHERE id = ?`, [id]);
      if (!row || row.returned === "O") continue;
      run(`UPDATE ${table} SET floor = ?, unit = ? WHERE id = ?`, [floor || null, unit || null, id]);
      updated++;
    }
  });

  const where = [floor, unit].filter(Boolean).join(" · ") || "(자리 없음)";
  return { success: true, updated, message: `${updated}건의 자리를 '${where}'(으)로 바꿨습니다.` };
}

// ── 테이블보 ──────────────────────────────────────────────
// 촬영용 천이라 시나리오 물품과 관리 항목이 다르다 — 재고·위치·사진과 펼친 크기만 본다.
// 두께는 의미가 없어 가로·세로만 받는다.

/**
 * 사람이 손으로 넣는 참고 링크를 저장 가능한 꼴로 다듬는다.
 *
 * 주소창에서 복사하면 보통 http(s)로 시작하지만, "smartstore.naver.com/..." 처럼 스킴 없이
 * 붙여넣는 경우가 더 흔해서 그때는 https를 붙여 준다. 반대로 javascript:·data: 같은 것은
 * 링크가 아니라 실행이라 화면에서 눌리는 순간 위험해지므로 아예 저장하지 않는다.
 * 여러 줄이면 줄마다 따로 다듬어 다시 줄바꿈으로 잇는다.
 */
function normalizeLinks(raw) {
  const lines = String(raw ?? "").split(/\r?\n/).map((v) => v.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    if (/^https?:\/\//i.test(line)) { out.push(line); continue; }
    // 스킴이 붙어 있는데 http(s)가 아니면 버린다(javascript:, data:, file: …).
    if (/^[a-z][a-z0-9+.-]*:/i.test(line)) continue;
    out.push("https://" + line);
  }
  return out.length ? out.join("\n") : null;
}

function getTableclothItems() {
  // 이름 대신 번호로 부르므로 번호 순이 곧 사람이 기대하는 순서다.
  return { items: all("SELECT * FROM tablecloth_items ORDER BY archived IS NOT NULL, id").map(toTableclothItem) };
}

async function addTableclothItem({ payload }) {
  const it = payload || {};
  const imagePath = await maybeSaveImage(it.image, "tablecloth_items", `new-${Date.now()}`);
  run(
    `INSERT INTO tablecloth_items (name, location, image_path, stock, width_mm, depth_mm, category, subcategory, link, note, archived, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [null, it.location ?? null, imagePath, Number(it.stock) || 0,
     numOrNull(it.widthMm), numOrNull(it.depthMm), it.category || null, it.subcategory || null,
     normalizeLinks(it.link), it.note ?? null, it.archived ? "TRUE" : null, nowIso()]
  );
  // 이름은 받지 않는다 — 번호가 곧 이름이라 새로 받은 id로 라벨을 박아둔다.
  // (화면 표시는 어차피 id에서 파생하지만, DB만 따로 봐도 무엇인지 알 수 있게 맞춰둔다.)
  const row = get("SELECT * FROM tablecloth_items WHERE id = last_insert_rowid()");
  run("UPDATE tablecloth_items SET name = ? WHERE id = ?", [tableclothLabel(row.id), row.id]);
  const saved = toTableclothItem(get("SELECT * FROM tablecloth_items WHERE id = ?", [row.id]));
  logItemChange("tablecloth", row.id, saved.name, "created", `신규 등록 (재고 ${saved.stock || 0}개, 위치 ${displayValue(saved.location)})`, it);
  return { item: saved };
}

async function updateTableclothItem({ payload }) {
  const it = payload || {};
  const id = Number(it.id);
  const existing = get("SELECT * FROM tablecloth_items WHERE id = ?", [id]);
  if (!existing) return { success: false, message: "없는 테이블보입니다." };
  // 클라이언트가 일부 필드만 보낼 수 있으므로 기존 값 위에 덮어쓴다
  const merged = { ...toTableclothItem(existing), ...it };
  const imagePath = it.image !== undefined ? await maybeSaveImage(it.image, "tablecloth_items", String(id)) : existing.image_path;
  run(
    `UPDATE tablecloth_items SET name=?, location=?, image_path=?, stock=?, width_mm=?, depth_mm=?, category=?, subcategory=?, link=?, note=?, archived=?, updated_at=? WHERE id=?`,
    [tableclothLabel(id), merged.location ?? null, imagePath, Number(merged.stock) || 0,
     numOrNull(merged.widthMm), numOrNull(merged.depthMm), merged.category || null, merged.subcategory || null,
     normalizeLinks(merged.link), merged.note ?? null, merged.archived ? "TRUE" : null, nowIso(), id]
  );
  const before = toTableclothItem(existing);
  const saved = toTableclothItem(get("SELECT * FROM tablecloth_items WHERE id = ?", [id]));
  const summary = diffFields(before, saved, [
    { key: "location", label: "위치" }, { key: "stock", label: "재고" },
    { key: "widthMm", label: "가로(mm)" }, { key: "depthMm", label: "세로(mm)" },
    { key: "category", label: "카테고리" }, { key: "subcategory", label: "서브카테고리" },
    { key: "link", label: "링크" }, { key: "note", label: "메모" }, { key: "archived", label: "보관 처리", bool: true },
  ]);
  logItemChange("tablecloth", id, saved.name, "updated", summary, it);
  return { item: saved };
}

// ── 테이블보 대여 (자체 장부) ──────────────────────────────
// 담당자를 거치지 않는다 — 각자 본인이 빌리고 본인이 반납한다. 그래서 "대여 확인" 단계가
// 없고, 신청하는 순간 picked_up_at 을 함께 찍어 바로 대여 중으로 만든다.
// 반납도 본인 것만 가능하다(processTableclothReturn 에서 신원을 대조한다).

function tcRow(r) {
  return {
    rowIndex: r.id, sheetType: "tablecloth",
    borrowerName: r.borrower_name || "", affiliation: r.affiliation || "", employeeId: r.employee_id || "",
    floor: r.floor || "", unit: r.unit || "",
    itemId: r.item_id, itemLabel: r.item_label || "", quantity: Number(r.qty) || 0,
    purpose: r.purpose || "", borrowDate: r.applied_at || "",
    pickedUp: !!r.picked_up_at, status: r.status || "",
    returned: r.returned === "O", returnDate: r.return_date || "",
  };
}

async function recordTableclothBorrow({ payload }) {
  const req = payload || {};
  const lines = Array.isArray(req.items) ? req.items : [];
  if (!lines.length) return { success: false, message: "대여할 테이블보를 선택해주세요." };
  if (!String(req.borrowerName || "").trim()) return { success: false, message: "대여자 이름이 필요합니다." };

  // 신청 시점에 재고를 확인한다 — 통과한 뒤 트랜잭션 안에서 다시 빼므로 중간에 어긋나지 않는다.
  for (const ln of lines) {
    const row = get("SELECT * FROM tablecloth_items WHERE id = ?", [Number(ln.id)]);
    if (!row) return { success: false, message: `없는 테이블보입니다: ${ln.name || ln.id}` };
    if ((Number(ln.qty) || 0) > (Number(row.stock) || 0)) {
      return { success: false, message: `재고 부족: '${tableclothLabel(row.id)}' 신청 ${ln.qty}개 / 재고 ${row.stock}개` };
    }
  }

  const now = nowIso();
  const batchId = crypto.randomUUID();
  const done = [];
  // 대여자 이메일을 지금 못박아 둔다 — 비워 두면 반납 때 이름만으로 대조하게 되어
  // 동명이인이 서로의 것을 반납할 수 있다.
  const borrowerEmail = req.email || expectedEmailFor({
    affiliation: req.affiliation, employeeId: req.employeeId, name: req.borrowerName,
  }) || null;
  transaction(() => {
    for (const ln of lines) {
      const id = Number(ln.id);
      const qty = Number(ln.qty) || 0;
      const row = get("SELECT * FROM tablecloth_items WHERE id = ?", [id]);
      run(
        `INSERT INTO tablecloth_rentals
           (borrower_name, affiliation, employee_id, email, floor, unit, item_id, item_label, qty, purpose,
            applied_at, picked_up_at, returned, return_date, status, batch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'X', NULL, 'active', ?)`,
        [req.borrowerName, req.affiliation ?? null, req.employeeId ?? null, borrowerEmail,
         req.floor ?? null, req.unit ?? null, id, tableclothLabel(id), qty, req.purpose ?? null, now, now, batchId]
      );
      updateTableclothInventory(id, qty);
      done.push(`${tableclothLabel(id)} x${qty}`);
    }
  });

  return { success: true, message: `테이블보 ${done.length}종을 대여했습니다.`, batchId };
}

function getTableclothUnreturned() {
  const rows = all(
    `SELECT * FROM tablecloth_rentals
      WHERE status = 'active' AND (returned IS NULL OR returned != 'O') ORDER BY id DESC`
  );
  const items = objectMapTablecloth();
  return {
    items: rows.map((r) => {
      const it = items[r.item_id] || {};
      return { ...tcRow(r), image: it.image || "", location: it.location || "", stock: it.stock ?? 0, rented: it.rented ?? 0 };
    }),
  };
}

function objectMapTablecloth() {
  const m = {};
  for (const r of all("SELECT * FROM tablecloth_items")) m[r.id] = toTableclothItem(r);
  return m;
}

function confirmTableclothPickup({ payload }) {
  const rows = payload?.rows || [];
  const now = nowIso();
  let n = 0;
  transaction(() => {
    for (const r of rows) {
      const row = get("SELECT * FROM tablecloth_rentals WHERE id = ?", [Number(r.rowIndex)]);
      if (!row || row.picked_up_at) continue;
      run("UPDATE tablecloth_rentals SET picked_up_at = ? WHERE id = ?", [now, row.id]);
      n++;
    }
  });
  return { success: true, message: `${n}건의 대여를 확인했습니다.` };
}

async function processTableclothReturn({ payload }) {
  const reqs = payload?.returnRequests || [];
  if (!reqs.length) return { success: false, message: "반납할 물품을 선택해주세요." };

  // 본인 것만 반납할 수 있다 — 화면에서 이미 걸러 주지만, 남의 줄 번호를 그대로 보내도
  // 처리되면 장부의 "누가 빌렸나"가 무너지므로 서버에서도 대조한다.
  const asName = String(payload?.borrowerName || "").trim();
  if (!asName) return { success: false, message: "반납자 정보가 없습니다." };
  const asEmail = expectedEmailFor({
    affiliation: payload?.affiliation, employeeId: payload?.employeeId, name: asName,
  });
  for (const r of reqs) {
    const row = get("SELECT * FROM tablecloth_rentals WHERE id = ?", [Number(r.rowIndex)]);
    if (!row) continue;
    if (!sameBorrowerIdentity(row.borrower_name, row.email, asName, asEmail)) {
      return { success: false, message: "본인이 빌린 테이블보만 반납할 수 있습니다." };
    }
  }

  const now = nowIso();
  const done = [];
  transaction(() => {
    for (const r of reqs) {
      const row = get("SELECT * FROM tablecloth_rentals WHERE id = ?", [Number(r.rowIndex)]);
      if (!row || row.returned === "O") continue;
      const rowQty = Number(row.qty) || 0;
      const qty = Math.min(Math.max(1, Number(r.quantity) || rowQty), rowQty);
      // 대여 확인 전(=재고가 빠진 상태)이든 후든 신청 때 이미 빠졌으므로 되돌린다.
      updateTableclothInventory(row.item_id, -qty);
      if (qty < rowQty) {
        // 일부만 돌아왔다 — 줄을 닫지 않고 남은 수량만 줄인다(시나리오 부분 반납과 같은 방식).
        run("UPDATE tablecloth_rentals SET qty = ? WHERE id = ?", [rowQty - qty, row.id]);
      } else {
        run("UPDATE tablecloth_rentals SET returned = 'O', return_date = ?, status = 'archived' WHERE id = ?", [now, row.id]);
      }
      done.push(`${row.item_label} x${qty}`);
    }
  });
  return { success: true, message: `${done.length}건을 반납 처리했습니다.` };
}

/**
 * 대여 중인 테이블보를 다른 테이블보로 바꿔준다(시나리오의 "물품 교체"와 같은 역할).
 * 원래 물품은 재고로 돌려놓고, 새 물품에서 같은 수량을 빼며, 줄의 물품만 갈아끼운다.
 */
function swapTableclothRental({ payload }) {
  const rowIndex = Number(payload?.rowIndex);
  const toId = Number(payload?.toId);
  if (!rowIndex || !toId) return { success: false, message: "교체할 대상이 없습니다." };

  const row = get("SELECT * FROM tablecloth_rentals WHERE id = ?", [rowIndex]);
  if (!row || row.returned === "O") return { success: false, message: "이미 반납되었거나 없는 대여입니다." };
  if (Number(row.item_id) === toId) return { success: false, message: "같은 물품으로는 교체할 수 없습니다." };

  const to = get("SELECT * FROM tablecloth_items WHERE id = ?", [toId]);
  if (!to) return { success: false, message: "교체할 테이블보를 찾을 수 없습니다." };

  const qty = Number(row.qty) || 0;
  if (qty > (Number(to.stock) || 0)) {
    return { success: false, message: `재고 부족: '${to.name}' 재고 ${to.stock}개 / 필요 ${qty}개` };
  }

  transaction(() => {
    updateTableclothInventory(row.item_id, -qty); // 원래 물품 되돌리기
    updateTableclothInventory(toId, qty);         // 새 물품 빼기
    run("UPDATE tablecloth_rentals SET item_id = ?, item_label = ? WHERE id = ?", [toId, tableclothLabel(toId), rowIndex]);
  });
  return { success: true, message: `'${row.item_label}' → '${tableclothLabel(toId)}'로 교체했습니다.` };
}

/**
 * 내가 지금 빌린 것 + 지난 N일(기본 7일) 동안의 내 대여/반납 기록.
 * 담당자가 없으니 본인이 스스로 확인할 창구가 필요하다.
 */
function getMyTableclothRentals({ query }) {
  const name = String(query?.name || "").trim();
  if (!name) return { active: [], recent: [] };
  const email = expectedEmailFor({ affiliation: query?.affiliation, employeeId: query?.employeeId, name });
  const days = Math.min(90, Math.max(1, Number(query?.days) || 7));
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const items = objectMapTablecloth();
  const decorate = (r) => {
    const it = items[r.item_id] || {};
    return { ...tcRow(r), returned: r.returned === "O", returnDate: r.return_date || "",
             image: it.image || "", location: it.location || "" };
  };
  const mine = all("SELECT * FROM tablecloth_rentals ORDER BY id DESC")
    .filter((r) => sameBorrowerIdentity(r.borrower_name, r.email, name, email));

  return {
    days,
    active: mine.filter((r) => r.returned !== "O" && r.status === "active").map(decorate),
    // 기간 안에 빌렸거나 돌려준 줄을 모두 보여준다 — "지난 주에 뭘 썼더라"에 답하는 게 목적이다.
    recent: mine.filter((r) => (r.applied_at || "") >= since || (r.return_date || "") >= since).map(decorate),
  };
}

/**
 * 테이블보 한 장을 지금 누가 빌려갔는지. 물품을 눌렀을 때 보여준다.
 * 연락하려면 이름·소속·자리가 필요해서 함께 넘긴다(이메일은 넘기지 않는다).
 */
function getTableclothBorrowers({ query }) {
  const itemId = Number(query?.itemId);
  if (!itemId) return { borrowers: [] };
  const rows = all(
    `SELECT * FROM tablecloth_rentals
      WHERE item_id = ? AND status = 'active' AND (returned IS NULL OR returned != 'O')
      ORDER BY id DESC`, [itemId]
  );
  return {
    borrowers: rows.map((r) => ({
      rowIndex: r.id, borrowerName: r.borrower_name || "", affiliation: r.affiliation || "",
      floor: r.floor || "", unit: r.unit || "", quantity: Number(r.qty) || 0,
      purpose: r.purpose || "", borrowDate: r.applied_at || "",
    })),
  };
}

/**
 * 지금 나가 있는 천을 물품별로 묶어 한 번에 돌려준다.
 *
 * 테이블보는 담당자를 거치지 않고 각자 알아서 빌리고 돌려놓는다. 그래서 "남은 수량 0"만
 * 보여주면 받을 사람이 누구에게 물어야 할지 알 수 없다. 목록에서 바로 이름과 자리를
 * 보여주려면 장마다 따로 물어볼 수 없으니(수백 번 왕복한다) 한 번에 내려준다.
 */
function getTableclothActiveBorrowers() {
  const rows = all(
    `SELECT * FROM tablecloth_rentals
      WHERE status = 'active' AND (returned IS NULL OR returned != 'O')
      ORDER BY id DESC`
  );
  const byItem = {};
  for (const r of rows) {
    const key = String(r.item_id);
    if (!byItem[key]) byItem[key] = [];
    byItem[key].push({
      rowIndex: r.id, purpose: r.purpose || "",
      borrowerName: r.borrower_name || "", affiliation: r.affiliation || "",
      floor: r.floor || "", unit: r.unit || "",
      quantity: Number(r.qty) || 0, borrowDate: r.applied_at || "",
    });
  }
  return { byItem };
}

function getTableclothRentalLogs({ query }) {
  const limit = Math.min(500, Number(query?.limit) || 200);
  return { logs: all("SELECT * FROM tablecloth_rentals ORDER BY id DESC LIMIT ?", [limit]).map(tcRow) };
}

/**
 * 테이블보 여러 장의 위치를 한 번에 바꾼다. 선반을 통째로 옮기거나, 표기가 갈린 위치
 * ("B02" / "B2")를 하나로 맞출 때 쓴다. 위치 말고는 아무것도 건드리지 않는다.
 */
function updateTableclothLocations({ payload }) {
  const ids = Array.isArray(payload?.ids) ? payload.ids.map(Number).filter(Boolean) : [];
  const location = String(payload?.location ?? "").trim();
  if (!ids.length) return { success: false, message: "위치를 바꿀 테이블보가 없습니다." };

  const now = nowIso();
  let updated = 0;
  transaction(() => {
    const stmt = "UPDATE tablecloth_items SET location = ?, updated_at = ? WHERE id = ?";
    for (const id of ids) {
      const existing = get("SELECT * FROM tablecloth_items WHERE id = ?", [id]);
      if (!existing) continue;
      run(stmt, [location || null, now, id]);
      if (String(existing.location || "") !== String(location || "")) {
        logItemChange("tablecloth", id, existing.name || tableclothLabel(id), "updated", `위치: ${displayValue(existing.location)} → ${displayValue(location)}`, payload);
      }
      updated++;
    }
  });
  return { success: true, updated, message: `${updated}종의 위치를 '${location || "(비움)"}'으로 바꿨습니다.` };
}

/**
 * 테이블보 여러 장을 한 번에 보관 처리하거나 되돌린다.
 *
 * 철 지난 천을 시즌 단위로 한꺼번에 내리는 일이 잦은데, 한 장씩 열어 체크박스를 누르면
 * 백 장 넘는 목록에서 하루가 간다. 보관 여부 말고는 아무것도 건드리지 않는다 —
 * 재고와 대여 기록은 그대로 두어야 나중에 되돌렸을 때 숫자가 맞는다.
 */
function updateTableclothArchived({ payload }) {
  const ids = Array.isArray(payload?.ids) ? payload.ids.map(Number).filter(Boolean) : [];
  const archived = !!payload?.archived;
  if (!ids.length) return { success: false, message: "보관 처리할 테이블보가 없습니다." };

  const now = nowIso();
  let updated = 0;
  transaction(() => {
    const stmt = "UPDATE tablecloth_items SET archived = ?, updated_at = ? WHERE id = ?";
    for (const id of ids) {
      const existing = get("SELECT * FROM tablecloth_items WHERE id = ?", [id]);
      if (!existing) continue;
      run(stmt, [archived ? "TRUE" : null, now, id]);
      if (!!existing.archived !== archived) {
        logItemChange("tablecloth", id, existing.name || tableclothLabel(id), "updated", `보관 처리: ${existing.archived ? "예" : "아니오"} → ${archived ? "예" : "아니오"}`, payload);
      }
      updated++;
    }
  });
  return {
    success: true,
    updated,
    message: archived ? `${updated}종을 보관함으로 옮겼습니다.` : `${updated}종을 목록으로 되돌렸습니다.`,
  };
}

// ── 테이블보 분류표 ────────────────────────────────────────
// 무늬를 나누는 기준은 촬영 팀이 쓰면서 계속 바뀐다("한복지"를 따로 빼고 싶다는 식으로).
// 그때마다 배포할 수는 없으니 분류표 자체를 화면에서 고치게 하고, 여기서는 그 표를 읽고 쓴다.

function getTableclothCategories() {
  const rows = all("SELECT * FROM tablecloth_categories ORDER BY sort_order, rowid");
  const tops = rows.filter((r) => !r.parent_key);
  return {
    categories: tops.map((c) => ({
      key: c.key, label: c.label || "", emoji: c.emoji || "", color: c.color || "",
      subs: rows.filter((r) => r.parent_key === c.key).map((r) => ({ key: r.key, label: r.label || "" })),
    })),
  };
}

/**
 * 분류표를 통째로 저장한다(부분 수정이 아니라 전체 교체). 화면에서 순서를 바꾸고 몇 개를 지우고
 * 몇 개를 더한 결과를 한 번에 받는 편이, 조각조각 주고받다 표가 반쯤 어긋난 상태로 남는 것보다 낫다.
 *
 * 사라진 key를 쓰던 테이블보는 그 자리를 비운다 — 화면에 뜨지도 않는 분류가 물품에 박혀 있으면
 * "미분류로 보이는데 필터에는 안 걸리는" 유령이 된다. 지우기 전에 몇 장이 딸려 있는지는
 * getTableclothCategoryUsage로 미리 보여준다.
 */
function saveTableclothCategories({ payload }) {
  const input = Array.isArray(payload?.categories) ? payload.categories : null;
  if (!input) return { success: false, message: "분류표가 비어 있습니다." };

  // key는 물품이 참조하는 값이라 빈 값·중복이면 분류가 서로 섞인다. 저장 전에 막는다.
  const cats = [];
  const seen = new Set();
  for (const c of input) {
    const key = String(c?.key ?? "").trim();
    const label = String(c?.label ?? "").trim();
    if (!key || !label) return { success: false, message: "이름이 비어 있는 분류가 있습니다." };
    if (seen.has(key)) return { success: false, message: `분류 키가 겹칩니다: ${key}` };
    seen.add(key);
    const subs = [];
    const subSeen = new Set();
    for (const sub of Array.isArray(c.subs) ? c.subs : []) {
      const sk = String(sub?.key ?? "").trim();
      const sl = String(sub?.label ?? "").trim();
      if (!sk || !sl) return { success: false, message: `'${label}'에 이름이 비어 있는 세부 분류가 있습니다.` };
      if (subSeen.has(sk)) return { success: false, message: `'${label}'의 세부 분류 키가 겹칩니다: ${sk}` };
      subSeen.add(sk);
      subs.push({ key: sk, label: sl });
    }
    cats.push({ key, label, emoji: String(c.emoji ?? "").trim(), color: String(c.color ?? "").trim(), subs });
  }

  let cleared = 0;
  transaction(() => {
    run("DELETE FROM tablecloth_categories");
    cats.forEach((c, ci) => {
      run("INSERT INTO tablecloth_categories (key, parent_key, label, emoji, color, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
        [c.key, "", c.label, c.emoji || null, c.color || null, ci]);
      c.subs.forEach((sub, si) => {
        run("INSERT INTO tablecloth_categories (key, parent_key, label, emoji, color, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
          [sub.key, c.key, sub.label, null, null, si]);
      });
    });

    const now = nowIso();
    for (const it of all("SELECT id, category, subcategory FROM tablecloth_items WHERE category IS NOT NULL AND category <> ''")) {
      const cat = cats.find((c) => c.key === it.category);
      if (!cat) {
        run("UPDATE tablecloth_items SET category = NULL, subcategory = NULL, updated_at = ? WHERE id = ?", [now, it.id]);
        logItemChange("tablecloth", it.id, tableclothLabel(it.id), "updated", `분류: ${displayValue(it.category)} / ${displayValue(it.subcategory)} → (없음)`, payload);
        cleared++;
      } else if (it.subcategory && !cat.subs.some((sub) => sub.key === it.subcategory)) {
        // 대분류는 남았는데 소분류만 사라진 경우 — 대분류까지 지울 이유는 없다.
        run("UPDATE tablecloth_items SET subcategory = NULL, updated_at = ? WHERE id = ?", [now, it.id]);
        logItemChange("tablecloth", it.id, tableclothLabel(it.id), "updated", `서브카테고리: ${it.subcategory} → (없음)`, payload);
        cleared++;
      }
    }
  });

  return { success: true, cleared, ...getTableclothCategories() };
}

/** 분류별로 지금 몇 장이 물려 있는지. 분류를 지우기 전에 "이거 지우면 12장이 미분류가 됩니다"를 보여주려고 쓴다. */
function getTableclothCategoryUsage() {
  const usage = {};
  for (const it of all("SELECT category, subcategory FROM tablecloth_items WHERE category IS NOT NULL AND category <> ''")) {
    const k = it.category;
    usage[k] = usage[k] || { total: 0, subs: {} };
    usage[k].total++;
    if (it.subcategory) usage[k].subs[it.subcategory] = (usage[k].subs[it.subcategory] || 0) + 1;
  }
  return { usage };
}

/**
 * 테이블보 여러 장의 무늬 분류를 한 번에 지정한다. 사진을 훑으며 같은 결의 천을 골라
 * 한꺼번에 찍어 두는 게 한 장씩 여는 것보다 훨씬 빠르다. 분류 외에는 건드리지 않는다.
 * subcategory만 비워 보내면 대분류만 남긴다(소분류를 아직 못 정한 경우).
 */
function updateTableclothCategories({ payload }) {
  const ids = Array.isArray(payload?.ids) ? payload.ids.map(Number).filter(Boolean) : [];
  const category = String(payload?.category ?? "").trim();
  const subcategory = String(payload?.subcategory ?? "").trim();
  if (!ids.length) return { success: false, message: "분류를 지정할 테이블보가 없습니다." };

  const now = nowIso();
  let updated = 0;
  transaction(() => {
    const stmt = "UPDATE tablecloth_items SET category = ?, subcategory = ?, updated_at = ? WHERE id = ?";
    for (const id of ids) {
      const existing = get("SELECT * FROM tablecloth_items WHERE id = ?", [id]);
      if (!existing) continue;
      // 대분류를 비우면 소분류도 같이 지운다 — 남겨두면 어디에도 속하지 않은 소분류가 떠돈다.
      run(stmt, [category || null, category ? (subcategory || null) : null, now, id]);
      const nextSub = category ? subcategory : "";
      if (String(existing.category || "") !== category || String(existing.subcategory || "") !== nextSub) {
        logItemChange("tablecloth", id, existing.name || tableclothLabel(id), "updated",
          `분류: ${displayValue(existing.category)} / ${displayValue(existing.subcategory)} → ${displayValue(category)} / ${displayValue(nextSub)}`, payload);
      }
      updated++;
    }
  });
  return { success: true, updated, message: `${updated}종의 분류를 바꿨습니다.` };
}

function deleteTableclothItem({ payload }) {
  const id = Number(payload?.id);
  if (!id) return { success: false, message: "id가 없습니다." };
  const existing = get("SELECT * FROM tablecloth_items WHERE id = ?", [id]);
  run("DELETE FROM tablecloth_items WHERE id = ?", [id]);
  if (existing) logItemChange("tablecloth", id, existing.name || tableclothLabel(id), "deleted", "삭제됨", payload);
  return { success: true };
}

/**
 * 테이블보 여러 장을 한 번에 지운다.
 *
 * 보관(archived)과 달리 되돌릴 수 없다 — 잘못 들어온 중복 등록이나 실물이 없어진 천을
 * 목록에서 완전히 치울 때만 쓴다. 대여 기록은 item_id 로만 남으므로 함께 지우지 않는다.
 */
function deleteTableclothItems({ payload }) {
  const ids = Array.isArray(payload?.ids) ? payload.ids.map(Number).filter(Boolean) : [];
  if (!ids.length) return { success: false, message: "삭제할 테이블보가 없습니다." };

  let deleted = 0;
  transaction(() => {
    for (const id of ids) {
      const existing = get("SELECT * FROM tablecloth_items WHERE id = ?", [id]);
      if (!existing) continue;
      run("DELETE FROM tablecloth_items WHERE id = ?", [id]);
      logItemChange("tablecloth", id, existing.name || tableclothLabel(id), "deleted", "삭제됨", payload);
      deleted++;
    }
  });
  return { success: true, deleted, message: `${deleted}종을 삭제했습니다.` };
}

/**
 * 테이블보 여러 장을 그대로 복제한다.
 *
 * 같은 천을 다른 층·다른 선반에도 두는 일이 잦은데, 한 장씩 사진을 다시 올리며 등록하는
 * 게 제일 번거롭다. 사진·크기·분류·링크·메모·재고는 그대로 옮기고 위치만 새로 받는다.
 * 번호는 새로 받는다(번호가 곧 기본키라 원본과 같은 번호는 둘이 공존할 수 없다).
 * 사진은 파일을 다시 만들지 않고 같은 경로를 가리키게 둔다 — 같은 천이니 같은 사진이 맞다.
 */
function duplicateTableclothItems({ payload }) {
  const ids = Array.isArray(payload?.ids) ? payload.ids.map(Number).filter(Boolean) : [];
  if (!ids.length) return { success: false, message: "복사할 테이블보가 없습니다." };
  // location 을 아예 보내지 않으면 원본 위치 그대로, 보내면(빈 문자열 포함) 그 값으로 둔다.
  const hasLoc = payload?.location !== undefined;
  const location = String(payload?.location ?? "").trim() || null;

  const now = nowIso();
  const created = [];
  transaction(() => {
    for (const id of ids) {
      const src = get("SELECT * FROM tablecloth_items WHERE id = ?", [id]);
      if (!src) continue;
      run(
        `INSERT INTO tablecloth_items (name, location, image_path, stock, width_mm, depth_mm, category, subcategory, link, note, archived, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [null, hasLoc ? location : src.location, src.image_path, src.stock, src.width_mm, src.depth_mm,
         src.category, src.subcategory, src.link, src.note, src.archived, now]
      );
      const row = get("SELECT * FROM tablecloth_items WHERE id = last_insert_rowid()");
      run("UPDATE tablecloth_items SET name = ? WHERE id = ?", [tableclothLabel(row.id), row.id]);
      logItemChange("tablecloth", row.id, tableclothLabel(row.id), "created", `${tableclothLabel(id)}에서 복사 · 위치 ${displayValue(hasLoc ? location : src.location)}`, payload);
      created.push(row.id);
    }
  });
  const where = hasLoc ? `'${location || "(위치 없음)"}'(으)로 ` : "";
  return { success: true, created: created.length, ids: created, message: `${where}${created.length}종을 복사했습니다.` };
}

function deleteScenarioObject({ payload }) {
  const id = padSlot(payload.rowIndex);
  const existing = get("SELECT * FROM scenario_items WHERE id = ?", [id]);
  run("DELETE FROM scenario_items WHERE id = ?", [id]);
  run("DELETE FROM scenario_item_variants WHERE item_id = ?", [id]);
  if (existing) logScenarioEdit(id, existing.name, "deleted", "삭제됨", changeActor(payload));
  deleteItemPhotosForItem("scenario", id);
  return {};
}

// 설정 > 물품 상태 변경 이력. 대여/반납 장부는 의도적으로 제외하고,
// 관리자 화면에서 직접 수정한 정보와 수동 재고 조정만 한 타임라인으로 합친다.
function getItemChangeHistory({ query }) {
  const since = query.since || "1970-01-01";
  const category = ["scenario", "inventory", "tablecloth"].includes(query.category) ? query.category : "scenario";
  const rows = [];

  // 시나리오는 기존 감사 로그를 그대로 살려 과거 기록도 보이게 한다.
  if (category === "scenario") {
    for (const r of all("SELECT * FROM scenario_item_edits WHERE occurred_at >= ? ORDER BY id DESC", [since])) {
      rows.push({ timestamp: r.occurred_at, category, itemId: r.item_id, itemName: r.item_name, changeType: r.change_type, summary: r.summary, manager: r.manager || "" });
    }
  }
  for (const r of all("SELECT * FROM inventory_history WHERE category = ? AND occurred_at >= ? ORDER BY id DESC", [category, since])) {
    // 불량 처리 및 대여/반납에서 파생된 변화는 각각의 업무 장부에서 확인한다.
    if (/불량|파손|대여|반납/.test(r.reason || "")) continue;
    rows.push({ timestamp: r.occurred_at, category, itemId: r.ref_id, itemName: r.item_name, changeType: "stock_adjust", summary: `재고 ${r.before_val} → ${r.after_val} (${r.diff > 0 ? "+" : ""}${r.diff})${r.reason ? ` · ${r.reason}` : ""}`, manager: r.manager || "" });
  }
  for (const r of all("SELECT * FROM item_change_logs WHERE category = ? AND occurred_at >= ? ORDER BY id DESC", [category, since])) {
    rows.push({ timestamp: r.occurred_at, category, itemId: r.item_id, itemName: r.item_name, changeType: r.change_type, summary: r.summary, manager: r.manager || "" });
  }

  rows.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
  return { items: rows };
}

function getScenarioChanges(ctx) {
  return getItemChangeHistory({ query: { ...ctx.query, category: "scenario" } });
}

// 기준 시점은 단순히 "이 날짜 이후만 보겠다"는 값을 저장해두는 것뿐이다. 재고/대여중의 "그 시점 값"은
// 미리 찍어두지 않고, 아래 getScenarioChangeSummary가 현재 값에서 그 이후 있었던 변화량을 거꾸로
// 빼서 매번 그때그때 역산한다 — 그래야 나중에 임의의 과거 날짜를 입력해도 정확하게 계산된다
// (미리 스냅샷을 찍는 방식은 "저장한 순간의 현재값"만 기억하므로, 입력한 날짜가 무엇이든 항상
// 스냅샷=현재값이 되어 버려 순변화가 늘 0으로 나오는 문제가 있었다).
function setScenarioChangesCheckpoint({ payload }) {
  const checkpoint = (payload && payload.checkpoint) || nowIso();
  run(
    `INSERT INTO settings (key, value) VALUES ('scenario_changes_checkpoint', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [checkpoint]
  );
  return { checkpoint };
}

// 설정 > 시나리오 변경 이력의 기본 화면: 로그를 쭉 나열하는 대신, 물품별로 "재고 N개 → M개",
// "대여중 N개 → M개"처럼 기준 시점 대비 순변화를 한눈에 보여준다. "기준 시점의 값"은 저장해두지
// 않고, 현재 값에서 그 시점 이후 발생한 모든 변화량(대여/반납/수동조정/불량)을 거꾸로 빼서 역산한다.
function getScenarioChangeSummary({ query }) {
  const since = query.since || "1970-01-01";
  const currentRows = all("SELECT * FROM scenario_items");
  const currentMap = new Map(currentRows.map((r) => [r.id, r]));

  // item_id -> "since 이후 일어난" 순변화량 (이 값을 현재값에서 빼면 since 시점의 값이 나온다)
  const stockDeltaSince = new Map();
  const rentedDeltaSince = new Map();
  const add = (map, id, amount) => { if (id && amount) map.set(id, (map.get(id) || 0) + amount); };

  for (const r of all("SELECT * FROM sid_rentals")) {
    const parsed = parseItemLabel(r.item_label);
    if (!parsed.id) continue;
    const qty = parsed.quantity || 1;
    if (r.applied_at && r.applied_at >= since) { add(stockDeltaSince, parsed.id, -qty); add(rentedDeltaSince, parsed.id, qty); }
    if (r.returned === "O" && r.return_date && r.return_date >= since) { add(stockDeltaSince, parsed.id, qty); add(rentedDeltaSince, parsed.id, -qty); }
  }
  for (const r of all("SELECT * FROM general_rentals")) {
    if (!r.item_id) continue;
    const id = padSlot(r.item_id);
    const qty = r.qty || 1;
    if (r.applied_at && r.applied_at >= since) { add(stockDeltaSince, id, -qty); add(rentedDeltaSince, id, qty); }
    if (r.returned === "O" && r.return_date && r.return_date >= since) { add(stockDeltaSince, id, qty); add(rentedDeltaSince, id, -qty); }
  }
  // 수동 재고 조정(StockAdjustModal) + 불량 등록으로 인한 차감 — inventory_history.diff는 이미
  // "그 사건이 만든 재고 변화량"이므로 그대로 더한다 (대여중만 따로 손댄 조정은 여기서 못 잡는다).
  for (const r of all("SELECT * FROM inventory_history WHERE category = 'scenario'")) {
    if (r.occurred_at && r.occurred_at >= since) add(stockDeltaSince, r.ref_id, Number(r.diff) || 0);
  }

  const editRows = all("SELECT * FROM scenario_item_edits WHERE occurred_at >= ? ORDER BY id DESC", [since]);
  const editsByItem = new Map();
  for (const e of editRows) {
    if (!editsByItem.has(e.item_id)) editsByItem.set(e.item_id, []);
    editsByItem.get(e.item_id).push(e);
  }

  const allIds = new Set([...currentMap.keys(), ...stockDeltaSince.keys(), ...rentedDeltaSince.keys(), ...editsByItem.keys()]);
  const results = [];
  for (const id of allIds) {
    const cur = currentMap.get(id);
    const edits = editsByItem.get(id) || [];
    const isNew = edits.some((e) => e.change_type === "created");
    const isDeleted = !cur && edits.some((e) => e.change_type === "deleted");
    const stockAfter = cur ? Number(cur.stock) || 0 : 0;
    const rentedAfter = cur ? Number(cur.rented) || 0 : 0;
    const sDelta = stockDeltaSince.get(id) || 0;
    const rDelta = rentedDeltaSince.get(id) || 0;
    // 신규 등록된 물품은 "그 이전엔 존재하지 않았음"이 기준이라 이전 값을 0으로 둔다 (역산하면 음수가
    // 나올 수 있어 그대로 두면 이상해 보인다 — 신규 등록 시점의 대여 이력은 애초에 없다).
    const stockBefore = isNew ? 0 : stockAfter - sDelta;
    const rentedBefore = isNew ? 0 : rentedAfter - rDelta;
    const stockDiff = stockAfter - stockBefore;
    const rentedDiff = rentedAfter - rentedBefore;
    if (stockDiff === 0 && rentedDiff === 0 && edits.length === 0 && !isNew && !isDeleted) continue;
    if (!cur && !isDeleted && edits.length === 0 && sDelta === 0 && rDelta === 0) continue; // 삭제도 아니고 최근 활동도 없는 유령 id 방지
    results.push({
      itemId: id,
      itemName: (cur && cur.name) || (edits[0] && edits[0].item_name) || "",
      location: cur ? cur.root_slot : "",
      stockBefore, stockAfter, stockDiff,
      rentedBefore, rentedAfter, rentedDiff,
      editCount: edits.length,
      lastEdit: edits[0] ? edits[0].summary : "",
      status: isNew ? "created" : isDeleted ? "deleted" : "changed",
    });
  }
  results.sort((a, b) => (Math.abs(b.stockDiff) + Math.abs(b.rentedDiff)) - (Math.abs(a.stockDiff) + Math.abs(a.rentedDiff)));
  return { items: results };
}

// 반납 처리 때 찍어둔 증빙 사진 열람 (최신순). itemSearch가 있으면 그 사진에 함께 찍힌
// 물품들(items_json) 중 이름이 일치하는 게 하나라도 있는 사진만 걸러서 보여준다 —
// "이 물품, 반납할 때 사진 찍었었나?"를 날짜를 몰라도 바로 찾을 수 있게.
function getReturnPhotos({ query }) {
  const unattended = query.source === "unattended";
  const rows = unattended
    ? all("SELECT * FROM return_photos WHERE image_path IS NOT NULL AND source='unattended' ORDER BY id DESC")
    : all("SELECT * FROM return_photos WHERE image_path IS NOT NULL AND (source IS NULL OR source='' OR source!='unattended') ORDER BY id DESC");
  const mapped = rows.map((r) => {
    let batchItems = [];
    try { batchItems = r.items_json ? JSON.parse(r.items_json) : []; } catch { batchItems = []; }
    return {
      id: r.id,
      occurredAt: r.occurred_at,
      summary: r.summary || "",
      photo: r.image_path,
      thumb: r.image_path ? r.image_path.replace("/original-", "/thumb-") : r.image_path,
      items: batchItems,
    };
  });
  const search = String(query.itemSearch || "").trim().toLowerCase();
  const filtered = search
    ? mapped.filter((r) => r.items.some((it) => String(it.itemLabel || "").toLowerCase().includes(search)))
    : mapped;
  const { items, hasMore } = paginate(filtered, query.limit, query.offset);
  return { items, hasMore };
}

// ── 물품 추가 사진 (대표 사진 외에 여러 장 등록) ──────────────────

function getItemPhotos({ query }) {
  const category = String(query.category || "").trim();
  const itemId = String(query.itemId || "").trim();
  if (!category || !itemId) return { items: [] };
  const rows = all(
    "SELECT * FROM item_photos WHERE category = ? AND item_id = ? AND image_path IS NOT NULL ORDER BY sort_order ASC, id ASC",
    [category, itemId]
  );
  return {
    items: rows.map((r) => ({
      id: r.id,
      photo: r.image_path,
      thumb: r.image_path ? r.image_path.replace("/original-", "/thumb-") : r.image_path,
    })),
  };
}

// 목록/그리드 화면에서 물품마다 따로 조회하면 N+1이 되니, 카테고리 하나에 등록된
// 추가 사진 전부를 한 번에 물품별로 묶어서 돌려준다 — 카드 썸네일을 여러 장 슬라이드로
// 보여줄 때 쓴다.
function getItemPhotosBulk({ query }) {
  const category = String(query.category || "").trim();
  if (!category) return { items: {} };
  const rows = all(
    "SELECT item_id, image_path FROM item_photos WHERE category = ? AND image_path IS NOT NULL ORDER BY item_id, sort_order ASC, id ASC",
    [category]
  );
  const map = {};
  for (const r of rows) {
    (map[r.item_id] ||= []).push(r.image_path.replace("/original-", "/thumb-"));
  }
  return { items: map };
}

async function addItemPhoto({ payload }) {
  const category = String(payload?.category || "").trim();
  const itemId = String(payload?.itemId || "").trim();
  if (!category || !itemId || !payload?.photo) return { success: false, error: "필수 정보가 없습니다." };
  const maxRow = get("SELECT MAX(sort_order) AS m FROM item_photos WHERE category = ? AND item_id = ?", [category, itemId]);
  const nextOrder = (maxRow?.m ?? -1) + 1;
  const result = run(
    "INSERT INTO item_photos (category, item_id, image_path, sort_order, created_at) VALUES (?, ?, ?, ?, ?)",
    [category, itemId, null, nextOrder, nowIso()]
  );
  const id = result.lastInsertRowid;
  const imagePath = await maybeSaveImage(payload.photo, "item_photos", id);
  if (!imagePath) return { success: false, error: "사진 저장에 실패했습니다." };
  run("UPDATE item_photos SET image_path = ? WHERE id = ?", [imagePath, id]);
  return { success: true, id, photo: imagePath };
}

function removeItemPhotoFiles(id) {
  const dir = path.join(uploadsDir, "item_photos", String(id));
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 이미 없거나 접근 실패 — DB 정리는 계속 진행 */ }
}

function deleteItemPhoto({ payload }) {
  const id = Number(payload?.id);
  removeItemPhotoFiles(id);
  run("DELETE FROM item_photos WHERE id = ?", [id]);
  return { success: true };
}

// 물품 자체가 삭제될 때, 그 물품에 등록돼 있던 추가 사진(item_photos)도 같이 정리한다 —
// 안 지우면 다시는 찾을 수 없는 파일만 디스크에 계속 남는다.
function deleteItemPhotosForItem(category, itemId) {
  const rows = all("SELECT id FROM item_photos WHERE category = ? AND item_id = ?", [category, itemId]);
  for (const r of rows) removeItemPhotoFiles(r.id);
  run("DELETE FROM item_photos WHERE category = ? AND item_id = ?", [category, itemId]);
}

// SM 등록 연동이 지금 쓸 수 있는 상태인지. 등록 화면이 ID 칸을 "자동 부여"로 둘지
// "직접 입력"으로 둘지 정하는 데 쓴다.
async function getSmObjectStatus() {
  if (smObjects.enabled()) {
    const h = await smObjects.health();
    return { enabled: true, ok: h.ok, reason: h.reason, via: "token" };
  }
  const ok = smObjectsSession.enabled();
  return { enabled: ok, ok, reason: ok ? "" : smObjectsSession.disabledReason(), via: "session" };
}

function getUnattendedReturnPhotos({ query }) {
  return getReturnPhotos({ query: { ...query, source: "unattended" } });
}

// 무인 대여 확인 때 사용자가 직접 찍은 수령 증빙 사진. 반납 사진과 DB·파일 폴더를
// 분리하되 관리자 화면에서는 같은 형태로 읽어 두 탭을 오갈 수 있게 한다.
function getPickupPhotos({ query }) {
  const rows = all("SELECT * FROM unattended_pickup_photos WHERE image_path IS NOT NULL ORDER BY id DESC");
  const mapped = rows.map((r) => {
    let batchItems = [];
    try { batchItems = r.items_json ? JSON.parse(r.items_json) : []; } catch { batchItems = []; }
    return {
      id: r.id, occurredAt: r.created_at, summary: "무인 대여 확인",
      photo: r.image_path, thumb: r.image_path ? r.image_path.replace("/original-", "/thumb-") : r.image_path,
      items: batchItems.map((item) => ({
        itemLabel: item.itemLabel || item.itemName || "물품", borrower: item.borrower || item.borrowerName || "",
        location: item.location || "", borrowDate: item.borrowDate || "", qty: Number(item.qty ?? item.quantity) || 1,
        action: item.action || "대여 확인",
      })),
    };
  });
  const search = String(query.itemSearch || "").trim().toLowerCase();
  const filtered = search ? mapped.filter((row) => row.items.some((item) => String(item.itemLabel || "").toLowerCase().includes(search))) : mapped;
  const { items, hasMore } = paginate(filtered, query.limit, query.offset);
  return { items, hasMore };
}

function getSmSyncStatus() {
  return smSyncStatus();
}

function smMetadataIdsForChanges() {
  let ids = smMetadataDirtyIds();
  const lastMetadataSync = get("SELECT value FROM settings WHERE key = 'sm_metadata_sync_at'")?.value || "";
  // 이 기능을 처음 배포한 시점 이전의 변경에는 dirty 표시가 없다. 첫 실행에 한해서 최근 24시간
  // 편집 항목을 보태 사용자가 방금 바꾼 이름·사진 등이 빠지지 않게 한다.
  if (!lastMetadataSync) {
    const recent = all(
      "SELECT DISTINCT item_id FROM scenario_item_edits WHERE occurred_at >= datetime('now', 'localtime', '-1 day') AND item_id IS NOT NULL"
    ).map((row) => padSlot(row.item_id)).filter(Boolean);
    ids = [...new Set([...ids, ...recent])];
  }
  return [...new Set(ids.map(padSlot).filter(Boolean))];
}

async function syncSmChangesNow() {
  const stock = await runSmChangesNow();
  if (!stock?.ok) return stock;

  const ids = smMetadataIdsForChanges();

  const { metadataDone, metadataFailed } = await pushScenarioMetadataIds(ids);
  if (metadataDone.length) clearSmMetadataDirty(metadataDone);
  if (!metadataFailed.length) {
    run("INSERT INTO settings (key, value) VALUES ('sm_metadata_sync_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [nowIso()]);
  }
  return {
    ...stock,
    ok: stock.ok && metadataFailed.length === 0,
    metadata: metadataDone.length,
    metadataFailed: metadataFailed.length,
    metadataErrors: metadataFailed,
    reason: metadataFailed.length ? `물품 정보 ${metadataFailed.length}건을 SM에 적용하지 못했습니다.` : "",
  };
}

async function pushScenarioMetadataIds(ids, { onItem } = {}) {
  const metadataDone = [], metadataFailed = [];
  const queue = [...new Set(ids.map(padSlot).filter(Boolean))]
    .map((id) => ({ id, row: get("SELECT * FROM scenario_items WHERE id = ?", [id]) }))
    .filter((x) => x.row);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // SM은 간헐적으로 fetch 실패나 일시적인 HTTP 500을 낸다. 한 번의 흔들림 때문에 전체를
  // 실패 처리하지 않도록 항목마다 최대 3번 시도한다. 두 건씩만 병렬 처리해 버튼 응답성과
  // SM 서버 부하의 균형을 맞춘다.
  const worker = async () => {
    while (queue.length) {
      const { id, row } = queue.shift();
      let lastReason = "SM 반영 실패";
      let done = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const result = await pushScenarioMetadataRow(row);
          if (result?.ok) { metadataDone.push(id); done = true; break; }
          lastReason = result?.reason || lastReason;
        } catch (error) {
          lastReason = error?.message || lastReason;
        }
        if (attempt < 3) await wait(700 * attempt);
      }
      if (!done) metadataFailed.push({ id, name: row.name || "", reason: lastReason });
      if (onItem) onItem({ id, row, ok: done, reason: done ? "" : lastReason });
    }
  };
  const workerCount = Math.min(2, Math.max(1, queue.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return { metadataDone, metadataFailed };
}

const smUploadJobs = new Map();
function publicSmUploadJob(job) {
  if (!job) return null;
  const percent = job.total ? Math.round((job.processed / job.total) * 100) : (job.status === "done" ? 100 : 0);
  return {
    id: job.id,
    mode: job.mode,
    status: job.status,
    phase: job.phase,
    total: job.total,
    processed: job.processed,
    succeeded: job.succeeded,
    failed: job.failed,
    percent,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt || "",
    result: job.result || null,
    errors: job.errors || [],
  };
}

function updateSmUploadJob(job, patch) {
  Object.assign(job, patch, { updatedAt: nowIso() });
}

async function runSmUploadJob(job) {
  try {
    let stock = null;
    let ids = [];
    if (job.mode === "changes") {
      updateSmUploadJob(job, { phase: "변경 대상 집계 중" });
      stock = await runSmChangesNow();
      if (!stock?.ok) throw new Error(stock?.reason || "SM 재고/대여 동기화에 실패했습니다.");
      ids = smMetadataIdsForChanges();
    } else {
      updateSmUploadJob(job, { phase: "전체 대상 집계 중" });
      ids = all("SELECT id FROM scenario_items WHERE id IS NOT NULL ORDER BY id").map((row) => padSlot(row.id)).filter(Boolean);
    }

    updateSmUploadJob(job, { phase: "SM 업로드 중", total: ids.length, processed: 0, succeeded: 0, failed: 0, errors: [] });
    const { metadataDone, metadataFailed } = await pushScenarioMetadataIds(ids, {
      onItem: ({ id, row, ok, reason }) => {
        job.processed += 1;
        if (ok) job.succeeded += 1;
        else {
          job.failed += 1;
          job.errors.push({ id, name: row?.name || "", reason });
        }
        job.updatedAt = nowIso();
      },
    });

    if (metadataDone.length) clearSmMetadataDirty(metadataDone);
    if (!metadataFailed.length) {
      const key = job.mode === "all" ? "sm_metadata_full_sync_at" : "sm_metadata_sync_at";
      run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, nowIso()]);
    }

    const result = {
      ...(stock || {}),
      ok: metadataFailed.length === 0,
      manual: true,
      full: job.mode === "all",
      at: nowIso(),
      total: ids.length,
      metadata: metadataDone.length,
      metadataFailed: metadataFailed.length,
      metadataErrors: metadataFailed,
      reason: metadataFailed.length ? `SM 업로드 중 ${metadataFailed.length}건을 적용하지 못했습니다.` : "",
    };
    updateSmUploadJob(job, { status: metadataFailed.length ? "failed" : "done", phase: metadataFailed.length ? "오류 발생" : "완료", result, finishedAt: nowIso() });
  } catch (error) {
    const result = { ok: false, reason: error?.message || "SM 업로드에 실패했습니다.", metadataErrors: job.errors || [] };
    updateSmUploadJob(job, { status: "failed", phase: "오류 발생", result, finishedAt: nowIso() });
  }
}

function startSmMetadataUpload({ payload }) {
  const mode = payload?.mode === "all" ? "all" : "changes";
  for (const job of smUploadJobs.values()) {
    if (job.status === "running") return { ok: true, running: true, job: publicSmUploadJob(job) };
  }
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const job = {
    id,
    mode,
    status: "running",
    phase: "준비 중",
    total: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
    result: null,
    startedAt: nowIso(),
    updatedAt: nowIso(),
  };
  smUploadJobs.set(id, job);
  void runSmUploadJob(job);
  return { ok: true, running: true, job: publicSmUploadJob(job) };
}

function getSmUploadJob({ query }) {
  const id = String(query?.jobId || "").trim();
  return { job: publicSmUploadJob(smUploadJobs.get(id)) };
}

async function syncAllSmMetadataNow() {
  const rows = all("SELECT id FROM scenario_items WHERE id IS NOT NULL ORDER BY id");
  const ids = rows.map((row) => padSlot(row.id)).filter(Boolean);
  const { metadataDone, metadataFailed } = await pushScenarioMetadataIds(ids);
  if (metadataDone.length) clearSmMetadataDirty(metadataDone);
  if (!metadataFailed.length) {
    run("INSERT INTO settings (key, value) VALUES ('sm_metadata_full_sync_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [nowIso()]);
  }
  return {
    ok: metadataFailed.length === 0,
    manual: true,
    full: true,
    at: nowIso(),
    total: ids.length,
    metadata: metadataDone.length,
    metadataFailed: metadataFailed.length,
    metadataErrors: metadataFailed,
    reason: metadataFailed.length ? `전체 업로드 중 ${metadataFailed.length}건을 SM에 적용하지 못했습니다.` : "",
  };
}

async function retrySmObjectMetadata({ payload }) {
  const id = padSlot(payload?.id || "");
  const row = get("SELECT * FROM scenario_items WHERE id = ?", [id]);
  return pushScenarioMetadataRow(row);
}

async function previewSmObjectImports() {
  return smLocationSync.previewMissingImports();
}

async function previewSmObjectImport({ query }) {
  return smLocationSync.previewImportById(query?.id || "");
}

async function compareSmObjectItem({ query }) {
  return smLocationSync.compareItemById(query?.id || "");
}

async function inspectSmEditForm({ query }) {
  return smLocationSync.inspectEditForm(query?.id || "");
}

async function importSmObjects({ payload }) {
  return smLocationSync.importMissing(payload?.ids || [], payload?.manager || "");
}

// 세션 방식은 SM 등록 화면의 HTML에서 번호를 읽어낸다. 화면을 직접 확인하지 못한 채
// 만든 부분이라, 처음 한 번은 이걸로 실제 화면에서 무엇이 보이는지 확인한다. 쓰지 않는다.
// WMS 위치와 SM 위치가 어긋난 물품 목록. 읽기만 한다.
async function compareSmLocations() {
  return smLocationSync.compare();
}

// 한 건만 반영해 보고 사진·다른 값이 살아남았는지 전후를 비교한다. 전체 반영 전에 쓴다.
async function verifySmLocation({ payload }) {
  return smLocationSync.verifyOne(payload?.objectId);
}

// 어긋난 위치를 SM에 반영한다. limit으로 한 번에 나갈 건수를 묶는다.
async function applySmLocations({ payload }) {
  return smLocationSync.apply({ ids: payload?.ids || null, limit: payload?.limit ?? 25 });
}

// SM 목록을 한 번 훑는 데만 몇 분이 걸려서, 요청 하나로 끝내려 하면 호출한 쪽이 먼저 끊긴다.
// 시작만 시켜두고 진행 상황은 getSmLocationJob으로 물어본다.
function startSmLocationApply({ payload }) {
  return smLocationSync.startApply({ ids: payload?.ids || null, limit: payload?.limit ?? 1000 });
}

function getSmLocationJob() {
  return smLocationSync.jobStatus();
}

// 오브젝트 몇 개의 사진·위치 상태를 읽는다. 위치를 고친 뒤 사진이 살아남았는지 볼 때 쓴다.
async function inspectSmObjects({ query }) {
  const ids = String(query.ids || "").split(",").map((x) => x.trim()).filter(Boolean);
  return smLocationSync.inspect(ids, { fresh: query.fresh === "1" });
}

// 번호 하나로 오브젝트를 받아올 길이 있는지 확인한다. 읽기만 한다.
async function probeSmObjectLookup({ query }) {
  return smLocationSync.probeLookup(query.id || "");
}

async function probeSmObjectRegistration({ query }) {
  return smObjectsSession.probe(query.sector || "", query.locId || "", { full: query.full === "1" });
}

// ── 액션 라우팅 테이블 ───────────────────────────────────────

const GET_ACTIONS = {
  getAll, getBorrowAppInfo, getObjectItems, getWarehouseInventoryOnly, getScenarioDefinition,
  getUnreturnedItems, getMyBorrowedItems, isConfigDsRegistered, getRegisteredUser, searchRegisteredUsers, getWarehouseBorrowedItems,
  getScenarioObjectsForAdmin, getScenarioAllLogs, getBatchDetail, getWarehouseLogs,
  getPenalties, getActiveItemTypeCount, getStockChangeHistory, getStockAuditHistory, getStockFormulaStatus,
  getItemSets, getSeatMap, getSeatOccupancy, getNotices, getNotice, getBorrowLock,
  getScenarioChanges, getItemChangeHistory, getScenarioChangeSummary, getReturnPhotos, getUnattendedReturnPhotos, getPickupPhotos, getItemPhotos, getItemPhotosBulk,
  getTableclothItems, getTableclothUnreturned, getTableclothRentalLogs,
  getMyTableclothRentals, getTableclothBorrowers,
  getTableclothCategories, getTableclothCategoryUsage, getTableclothActiveBorrowers,
  getSmObjectStatus, getSmSyncStatus, getSmUploadJob, previewSmObjectImports, previewSmObjectImport, compareSmObjectItem, inspectSmEditForm, probeSmObjectRegistration, compareSmLocations, getSmLocationJob, inspectSmObjects, probeSmObjectLookup,
};

const POST_ACTIONS = {
  addInventoryItem, updateInventoryItem, updateMultipleInventoryItems, deleteInventoryItem,
  addDefectLog, rentInventoryItem, rentInventoryItemsBulk, saveSectorLayout, deleteSector,
  recordBorrow, processReturn, confirmPickup, swapBorrowItem, recordDamagedReturn, updateBorrowerSeat,
  updateScenarioObject, addScenarioObject, deleteScenarioObject, saveScenarioVariants, assignUnassignedStock, updateScenarioCategories,
  addTableclothItem, updateTableclothItem, updateTableclothLocations, updateTableclothCategories, updateTableclothArchived, saveTableclothCategories, deleteTableclothItem, deleteTableclothItems, duplicateTableclothItems,
  recordTableclothBorrow, confirmTableclothPickup, processTableclothReturn, swapTableclothRental,
  adjustStock, recordStockAudit, saveItemSet, deleteItemSet, saveSeatMap,
  saveNotices, saveNotice, setBorrowLock, publishAppVersion,
  setScenarioChangesCheckpoint, saveReturnPhoto, addItemPhoto, deleteItemPhoto,
  verifySmLocation, applySmLocations, startSmLocationApply, importSmObjects, syncSmChangesNow, syncAllSmMetadataNow, startSmMetadataUpload, retrySmObjectMetadata,
};

// 재고나 대여 상태를 바꾸는 동작들. 끝나는 대로 Scenario Manager를 맞춘다 —
// 정기 회차(기본 20초)를 기다리면 방금 고친 값이 한동안 양쪽에서 다르게 보인다.
const STOCK_CHANGING_ACTIONS = new Set([
  "addScenarioObject", "updateScenarioObject", "deleteScenarioObject",
  "saveScenarioVariants", "assignUnassignedStock", "adjustStock", "recordStockAudit",
  "recordBorrow", "processReturn", "confirmPickup", "swapBorrowItem", "recordDamagedReturn",
  "rentInventoryItem", "rentInventoryItemsBulk", "addDefectLog",
]);

async function dispatch(action, ctx, table) {
  const handler = table[action];
  if (!handler) return { success: false, error: `알 수 없는 액션입니다: ${action}` };
  try {
    const data = await handler(ctx);
    if (data && data.success === false) return data;
    // 응답을 붙잡아 두지 않는다. 짧게 모았다가 뒤에서 돈다.
    if (STOCK_CHANGING_ACTIONS.has(action)) smSyncNudge();
    return { success: true, ...data };
  } catch (err) {
    console.error(`[gas:${action}]`, err);
    return { success: false, error: err.message || "서버 오류가 발생했습니다." };
  }
}

gasRouter.get("/gas", async (req, res) => {
  const action = req.query.action;
  if (!action) return res.json({ success: true }); // 파라미터 없는 GET(외부 신청 폼)은 이 앱에서 쓰지 않음
  res.json(await dispatch(action, { query: req.query }, GET_ACTIONS));
});

// GAS 프론트는 CORS 프리플라이트를 피하려고 Content-Type: text/plain으로 POST 본문을 보낸다.
gasRouter.post("/gas", express.text({ type: ["text/plain", "application/json"], limit: "20mb" }), async (req, res) => {
  let body = {};
  try {
    body = req.body ? JSON.parse(req.body) : {};
  } catch (err) {
    return res.json({ success: false, error: "요청 본문을 해석할 수 없습니다." });
  }
  res.json(await dispatch(body.action, { payload: body.payload || {} }, POST_ACTIONS));
});
