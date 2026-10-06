import XLSX from "xlsx";
import bcrypt from "bcryptjs";
import { db, get, run, transaction } from "../db.js";
import { saveImage } from "./images.js";

const ERROR_VALUES = new Set(["#REF!", "#NUM!", "#VALUE!", "#N/A", "#DIV/0!", "#NAME?", "#NULL!"]);

function str(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function cleanErr(v) {
  const s = str(v);
  if (s && ERROR_VALUES.has(s)) return null;
  return s;
}

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function idStr(v) {
  const n = num(v);
  if (n !== null) return String(n);
  return str(v);
}

/** Scenario object IDs are zero-padded 6-digit codes (e.g. "000008"); xlsx sometimes stores them as a bare number. */
function padId6(v) {
  const s = idStr(v);
  if (s === null) return null;
  return /^\d+$/.test(s) ? s.padStart(6, "0") : s;
}

function dateStr(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) {
    const pad = (x) => String(x).padStart(2, "0");
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())} ${pad(v.getHours())}:${pad(v.getMinutes())}:${pad(v.getSeconds())}`;
  }
  return str(v);
}

function isBlankRow(row) {
  return row.every((v) => v === null || v === undefined || (typeof v === "string" && v.trim() === ""));
}

/** Reads a sheet as an array of arrays, drops the header row, and stops at the first fully-blank row (padding). */
function sheetRows(wb, name, { hasHeader = true } = {}) {
  const sheet = wb.Sheets[name];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const out = [];
  for (const row of dataRows) {
    if (isBlankRow(row)) break;
    out.push(row);
  }
  return out;
}

/**
 * 구글 드라이브(또는 googleusercontent) 이미지 링크면 실제 이미지 바이트를 직접 내려받을 수 있는
 * 형태로 정규화해서 반환한다. `drive.google.com/open?id=...`나 `/file/d/ID/view` 같은 "뷰어 페이지"
 * 링크는 fetch해도 HTML이 오기 때문에, 파일 ID를 뽑아 `thumbnail?id=` 형태로 바꿔준다.
 */
function driveImageUrl(v) {
  const s = str(v);
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) return null;
  if (!/drive\.google\.com|googleusercontent\.com/i.test(s)) return null;

  if (s.includes("googleusercontent.com")) return s; // 이미 직접 이미지 바이트를 주는 형태

  const idMatch = s.match(/[?&]id=([a-zA-Z0-9_-]{10,})/) || s.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  if (idMatch) return `https://drive.google.com/thumbnail?id=${idMatch[1]}&sz=w1600`;
  return s;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchImageWithRetry(url, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.startsWith("image/")) throw new Error(`not an image (${contentType})`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt === retries) throw err;
      // 대량 요청 시 구글 쪽에서 순간적으로 막는 경우가 있어, 짧게 쉬었다가 다시 시도한다.
      await sleep(500 + attempt * 800 + Math.random() * 300);
    }
  }
}

/** 지정된 동시성으로 드라이브 이미지들을 내려받아 로컬에 저장하고, 해당 테이블의 image_path를 갱신한다. */
async function migrateImagesFromDrive(pending, { concurrency = 4 } = {}) {
  const result = { attempted: pending.length, succeeded: 0, failed: 0 };
  let idx = 0;
  async function worker() {
    while (idx < pending.length) {
      const job = pending[idx++];
      try {
        const buffer = await fetchImageWithRetry(job.url);
        const { url } = await saveImage(buffer, job.scope, job.id);
        run(`UPDATE ${job.scope} SET image_path = ? WHERE ${job.idColumn} = ?`, [url, job.id]);
        result.succeeded++;
      } catch (err) {
        result.failed++;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));
  return result;
}

/**
 * xlsx를 SQLite로 전체 덮어쓰기 임포트한다. 각 물품/불량로그에 로컬로 이미 업로드된 사진이 없고
 * xlsx의 사진 칸에 구글 드라이브 링크가 남아있으면, 임포트 직후 그 링크에서 이미지를 직접 내려받아
 * 정확히 그 항목에 매칭해 저장한다(사용자가 드라이브 폴더를 따로 내려받아 올릴 필요 없음).
 */
export async function importXlsx(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const summary = {};
  const pendingImages = [];

  transaction(() => {
    summary.scenario_items = importScenarioItems(wb, pendingImages);
    summary.warehouse_items = importWarehouseItems(wb, pendingImages);
    // rental_locations를 먼저 채워야 sid_rentals/general_rentals의 floor/unit 역채움(backfill)이 가능하다.
    summary.rental_locations = importRentalLocations(wb);
    summary.sid_rentals = importSidRentals(wb);
    summary.general_rentals = importGeneralRentals(wb);
    summary.warehouse_rental_logs = importWarehouseRentalLogs(wb);
    summary.defect_logs = importDefectLogs(wb, pendingImages);
    summary.inventory_history = importInventoryHistory(wb);
    summary.inventory_audits = importInventoryAudits(wb);
    summary.penalties = importPenalties(wb);
    summary.notices = importNotices(wb);
    summary.scenarios = importScenarios(wb);
    summary.admin_users = importAdminUsers(wb);
    summary.staff_accounts = importStaffAccounts(wb);
    summary.settings = importFloorPlan(wb);
  });

  if (pendingImages.length) {
    summary.drive_images = await migrateImagesFromDrive(pendingImages);
  }

  return summary;
}

// 시나리오 오브젝트: id가 자연 키(PK)이므로 있으면 갱신, 없으면 새로 추가한다. 시트에서 사라진
// id가 있어도 지우지 않는다(실사용 중인 데이터를 실수로 날리지 않기 위한 안전한 기본값).
// 파손/화재/보관처리/랭킹제외 등 속성 체크박스는 이제 앱 관리자 화면에서 직접 관리한다(시트 값은
// 신규 행을 처음 만들 때의 초기값으로만 쓰고, 이미 있는 행은 재임포트해도 건드리지 않는다) — 안 그러면
// 앱에서 체크해둔 값이 다음 시트 재업로드 때마다 시트의 옛 값으로 되돌아가 버린다.
// 시트의 K열(실사여부)·L열(SM 연동)은 앱에서 쓰이지 않는 죽은 컬럼이라 임포트하지 않는다.
function importScenarioItems(wb, pendingImages) {
  const rows = sheetRows(wb, "시나리오 오브젝트");
  const insert = db.prepare(`
    INSERT INTO scenario_items (id, name, sector, root_slot, category, subcategory, image_path, stock, rented, exclude_low_rent, fragile, fire, request, is_storage)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const update = db.prepare(`
    UPDATE scenario_items SET name=?, sector=?, root_slot=?, category=?, subcategory=?, stock=?, rented=? WHERE id=?
  `);
  let inserted = 0, updated = 0;
  for (const r of rows) {
    const id = padId6(r[0]);
    if (!id) continue;
    const existing = get("SELECT image_path FROM scenario_items WHERE id = ?", [id]);
    if (existing) {
      update.run(str(r[1]), str(r[2]), padId6(r[3]), str(r[4]), str(r[5]), num(r[7]), num(r[8]), id);
      updated++;
    } else {
      insert.run(
        id, str(r[1]), str(r[2]), padId6(r[3]), str(r[4]), str(r[5]), null,
        num(r[7]), num(r[8]), str(r[9]), str(r[12]), str(r[13]), str(r[14]), str(r[16])
      );
      inserted++;
    }
    const driveUrl = !existing?.image_path && driveImageUrl(r[6]);
    if (driveUrl) pendingImages.push({ scope: "scenario_items", idColumn: "id", id, url: driveUrl });
  }
  return { inserted, updated, total: rows.length };
}

// 창고물품: (위치, 품목명)을 자연 키로 삼아 갱신/추가한다.
function importWarehouseItems(wb, pendingImages) {
  const rows = sheetRows(wb, "창고물품");
  const insert = db.prepare(
    `INSERT INTO warehouse_items (location, subcategory, name, purchase_link, stock, updated_at, manager, manager2, note, image_path, keywords, consumable)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const update = db.prepare(
    `UPDATE warehouse_items SET subcategory=?, purchase_link=?, stock=?, updated_at=?, manager=?, manager2=?, note=?, keywords=?, consumable=? WHERE id=?`
  );
  let inserted = 0, updated = 0;
  for (const r of rows) {
    const location = str(r[0]);
    const name = str(r[2]);
    const existing = get("SELECT id, image_path FROM warehouse_items WHERE location = ? AND name = ?", [location, name]);
    if (existing) {
      update.run(str(r[1]), cleanErr(r[3]), cleanErr(r[4]), dateStr(r[5]), str(r[6]), str(r[9]), str(r[7]), str(r[10]), str(r[11]), existing.id);
      updated++;
      const driveUrl = !existing.image_path && driveImageUrl(r[8]);
      if (driveUrl) pendingImages.push({ scope: "warehouse_items", idColumn: "id", id: existing.id, url: driveUrl });
    } else {
      const result = insert.run(location, str(r[1]), name, cleanErr(r[3]), cleanErr(r[4]), dateStr(r[5]), str(r[6]), str(r[9]), str(r[7]), null, str(r[10]), str(r[11]));
      inserted++;
      const driveUrl = driveImageUrl(r[8]);
      if (driveUrl) pendingImages.push({ scope: "warehouse_items", idColumn: "id", id: result.lastInsertRowid, url: driveUrl });
    }
  }
  return { inserted, updated, total: rows.length };
}

// xlsx로 들어오는 과거 이력에는 "대여확인(픽업확인)" 개념 자체가 없었다 — 실제로는 전부 이미
// 수령이 끝난 상태다. picked_up_at을 비워두면 신규 기능(관리자 반납 화면의 "대여확인" 탭)이
// 이 과거 대여 건들을 전부 "아직 픽업 안 됨"으로 오인해 반납 처리 대상에서 빠지게 되므로,
// 확인/신청 시각 중 있는 값으로 채워 "이미 픽업됨" 상태로 가져온다.
function importedPickupTimestamp(confirmedAt, appliedAt, borrowDate) {
  return confirmedAt || appliedAt || borrowDate || null;
}

/** 이미 저장된 로그성 테이블의 "내용 지문" 집합을 미리 읽어, 재임포트 시 같은 행을 다시 넣지 않게 한다. */
function loadExistingKeys(table, columns) {
  const keys = new Set();
  for (const row of db.prepare(`SELECT ${columns.join(", ")} FROM ${table}`).all()) {
    keys.add(columns.map((c) => String(row[c] ?? "")).join("||"));
  }
  return keys;
}

function importSidRow(insert, existingKeys, r, status) {
  const confirmedAt = dateStr(r[12]);
  const appliedAt = dateStr(r[10]);
  const borrowDate = dateStr(r[3]);
  const borrowerName = str(r[0]);
  const sid = str(r[1]);
  const itemLabel = str(r[2]);
  const key = [borrowerName, sid, itemLabel, appliedAt].map((v) => String(v ?? "")).join("||");
  if (existingKeys.has(key)) return false;
  existingKeys.add(key);
  insert.run(
    borrowerName, sid, itemLabel, borrowDate, str(r[4]), str(r[5]), dateStr(r[6]),
    str(r[7]), str(r[9]), appliedAt, str(r[11]), confirmedAt, status,
    importedPickupTimestamp(confirmedAt, appliedAt, borrowDate)
  );
  return true;
}

// 대여 기록은 앱에서도 실시간으로 계속 쌓이므로, 재임포트 시 전체를 지우지 않고 "아직 없는 행만"
// 추가한다 (borrower/sid/item_label/신청시각 조합으로 이미 있는 행인지 판단).
function importSidRentals(wb) {
  const insert = db.prepare(
    `INSERT INTO sid_rentals (borrower_name, sid, item_label, borrow_date, purpose, returned, return_date, email, batch_id, applied_at, item_type, confirmed_at, status, picked_up_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const existingKeys = loadExistingKeys("sid_rentals", ["borrower_name", "sid", "item_label", "applied_at"]);
  const active = sheetRows(wb, "SID대여");
  const archived = sheetRows(wb, "SID대여_보관");
  let added = 0;
  for (const r of active) if (importSidRow(insert, existingKeys, r, "active")) added++;
  for (const r of archived) if (importSidRow(insert, existingKeys, r, "archived")) added++;
  backfillFloorUnit("sid_rentals");
  return { added, skipped: active.length + archived.length - added, total: active.length + archived.length };
}

function importGeneralRow(insert, existingKeys, r, status) {
  const confirmedAt = dateStr(r[13]);
  const appliedAt = dateStr(r[11]);
  const borrowDate = dateStr(r[4]);
  const borrowerName = str(r[0]);
  const itemId = padId6(r[1]);
  const itemLabel = str(r[2]);
  const key = [borrowerName, itemId, itemLabel, appliedAt].map((v) => String(v ?? "")).join("||");
  if (existingKeys.has(key)) return false;
  existingKeys.add(key);
  insert.run(
    borrowerName, itemId, itemLabel, num(r[3]), borrowDate, str(r[5]), str(r[6]), dateStr(r[7]),
    str(r[8]), str(r[10]), appliedAt, str(r[12]), confirmedAt, status,
    importedPickupTimestamp(confirmedAt, appliedAt, borrowDate)
  );
  return true;
}

function importGeneralRentals(wb) {
  const insert = db.prepare(
    `INSERT INTO general_rentals (borrower_name, item_id, item_label, qty, borrow_date, purpose, returned, return_date, email, batch_id, applied_at, category, confirmed_at, status, picked_up_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const existingKeys = loadExistingKeys("general_rentals", ["borrower_name", "item_id", "item_label", "applied_at"]);
  const active = sheetRows(wb, "일반대여");
  const archived = sheetRows(wb, "일반대여_보관");
  let added = 0;
  for (const r of active) if (importGeneralRow(insert, existingKeys, r, "active")) added++;
  for (const r of archived) if (importGeneralRow(insert, existingKeys, r, "archived")) added++;
  backfillFloorUnit("general_rentals");
  return { added, skipped: active.length + archived.length - added, total: active.length + archived.length };
}

/** 대여위치기록(batch_id별 floor/unit)을 sid_rentals/general_rentals에 역으로 채워 넣는다. */
function backfillFloorUnit(table) {
  db.exec(`
    UPDATE ${table} SET
      floor = (SELECT floor FROM rental_locations WHERE rental_locations.batch_id = ${table}.batch_id LIMIT 1),
      unit = (SELECT unit FROM rental_locations WHERE rental_locations.batch_id = ${table}.batch_id LIMIT 1)
    WHERE batch_id IN (SELECT batch_id FROM rental_locations)
  `);
}

// 대여위치기록은 더 이상 앱이 실시간으로 쓰지 않는 테이블(좌석 점유 조회는 sid_rentals/general_rentals을
// 직접 조회하도록 변경됨) — 순수 이력 참고용이라 매번 시트 내용으로 통째로 교체해도 안전하다.
//
// 예전 GAS 코드가 "일시"/"배치ID" 두 칸을 뒤바꿔 쓰던 시절의 흔적이 시트 자체에 남아있어서, 일부
// 행은 지금도 일시 칸에 UUID가, 배치ID 칸에 날짜가 들어있다(배치ID 칸의 날짜 문자열이 우연히 ISO
// 형식이면 xlsx 라이브러리가 그걸 실제 Date로 파싱해버려서 더 헷갈리게 저장되기도 한다). UUID
// 모양인지로 판별해서, 뒤바뀐 행은 가져오면서 바로잡는다.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function importRentalLocations(wb) {
  const rows = sheetRows(wb, "대여위치기록");
  db.exec("DELETE FROM rental_locations");
  const insert = db.prepare(
    `INSERT INTO rental_locations (occurred_at, borrower_name, floor, unit, batch_id, kind) VALUES (?, ?, ?, ?, ?, ?)`
  );
  let swapFixed = 0;
  for (const r of rows) {
    let occurredRaw = r[0], batchRaw = r[4];
    const col0IsUuid = UUID_RE.test(str(occurredRaw) || "");
    const col4IsUuid = UUID_RE.test(str(batchRaw) || "");
    if (col0IsUuid && !col4IsUuid) {
      [occurredRaw, batchRaw] = [batchRaw, occurredRaw];
      swapFixed++;
    }
    insert.run(dateStr(occurredRaw), str(r[1]), str(r[2]), str(r[3]), str(batchRaw), str(r[5]));
  }
  return { inserted: rows.length, swapFixed };
}

function importWarehouseRentalLogs(wb) {
  const rows = sheetRows(wb, "창고물품 대여로그", { hasHeader: false });
  const insert = db.prepare(
    `INSERT INTO warehouse_rental_logs (occurred_at, type, location, name, qty, manager, note) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const existingKeys = loadExistingKeys("warehouse_rental_logs", ["occurred_at", "type", "location", "name", "qty", "manager"]);
  let added = 0;
  for (const r of rows) {
    const occurredAt = dateStr(r[0]), type = str(r[1]), location = str(r[2]), name = str(r[3]), qty = num(r[4]), manager = str(r[5]);
    const key = [occurredAt, type, location, name, qty, manager].map((v) => String(v ?? "")).join("||");
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    insert.run(occurredAt, type, location, name, qty, manager, str(r[6]));
    added++;
  }
  return { added, skipped: rows.length - added, total: rows.length };
}

function importDefectLogs(wb, pendingImages) {
  const rows = sheetRows(wb, "불량로그");
  const insert = db.prepare(
    `INSERT INTO defect_logs (product, qty, occurred_date, defect_type, detail, action_taken, image_path, breaker) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const existingKeys = loadExistingKeys("defect_logs", ["product", "occurred_date", "breaker"]);
  let added = 0;
  for (const r of rows) {
    const product = str(r[0]);
    const occurredDate = dateStr(r[2]);
    const breaker = str(r[7]);
    const key = [product, occurredDate, breaker].map((v) => String(v ?? "")).join("||");
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    const result = insert.run(product, num(r[1]), occurredDate, str(r[3]), str(r[4]), str(r[5]), null, breaker);
    added++;
    const driveUrl = driveImageUrl(r[6]);
    if (driveUrl) pendingImages.push({ scope: "defect_logs", idColumn: "id", id: result.lastInsertRowid, url: driveUrl });
  }
  return { added, skipped: rows.length - added, total: rows.length };
}

function importInventoryHistory(wb) {
  const rows = sheetRows(wb, "재고변경이력");
  const insert = db.prepare(
    `INSERT INTO inventory_history (occurred_at, category, ref_id, item_name, before_val, after_val, diff, reason, manager)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const existingKeys = loadExistingKeys("inventory_history", ["occurred_at", "ref_id", "item_name", "before_val", "after_val"]);
  let added = 0;
  for (const r of rows) {
    const occurredAt = dateStr(r[0]), refId = padId6(r[2]), itemName = str(r[3]), before = num(r[4]), after = num(r[5]);
    const key = [occurredAt, refId, itemName, before, after].map((v) => String(v ?? "")).join("||");
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    insert.run(occurredAt, str(r[1]), refId, itemName, before, after, num(r[6]), str(r[7]), str(r[8]));
    added++;
  }
  return { added, skipped: rows.length - added, total: rows.length };
}

function importInventoryAudits(wb) {
  const rows = sheetRows(wb, "재고실사기록");
  const insert = db.prepare(
    `INSERT INTO inventory_audits (audited_at, item_id, item_name, system_stock, audited_stock, diff, auditor, memo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const existingKeys = loadExistingKeys("inventory_audits", ["audited_at", "item_id", "item_name"]);
  let added = 0;
  for (const r of rows) {
    const auditedAt = dateStr(r[0]), itemId = padId6(r[1]), itemName = str(r[2]);
    const key = [auditedAt, itemId, itemName].map((v) => String(v ?? "")).join("||");
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    insert.run(auditedAt, itemId, itemName, num(r[3]), num(r[4]), num(r[5]), str(r[6]), str(r[7]));
    added++;
  }
  return { added, skipped: rows.length - added, total: rows.length };
}

function importPenalties(wb) {
  const rows = sheetRows(wb, "페널티");
  const insert = db.prepare(`INSERT INTO penalties (name, max_types, reason, expires_at) VALUES (?, ?, ?, ?)`);
  const existingKeys = loadExistingKeys("penalties", ["name", "reason", "expires_at"]);
  let added = 0;
  for (const r of rows) {
    const name = str(r[0]), reason = str(r[2]), expiresAt = dateStr(r[3]);
    const key = [name, reason, expiresAt].map((v) => String(v ?? "")).join("||");
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    insert.run(name, num(r[1]), reason, expiresAt);
    added++;
  }
  return { added, skipped: rows.length - added, total: rows.length };
}

function importNotices(wb) {
  const rows = sheetRows(wb, "공지");
  const insert = db.prepare(`INSERT INTO notices (created_at, author, content, detail) VALUES (?, ?, ?, ?)`);
  const existingKeys = loadExistingKeys("notices", ["created_at", "author", "content"]);
  let added = 0;
  for (const r of rows) {
    const createdAt = dateStr(r[0]), author = str(r[1]), content = str(r[2]);
    const key = [createdAt, author, content].map((v) => String(v ?? "")).join("||");
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    insert.run(createdAt, author, content, str(r[3]));
    added++;
  }
  return { added, skipped: rows.length - added, total: rows.length };
}

// 시나리오 지시문: (sid, object_id)를 자연 키로 삼아 갱신/추가한다.
function importScenarios(wb) {
  return upsertScenarioRows(sheetRows(wb, "Scenario"));
}

/** [sid, en, ko, objectId, objectName, quantity] 형태의 행들을 (sid, object_id) 자연 키로 upsert한다.
 * xlsx 임포트뿐 아니라, 스크래퍼가 HTTP로 보내온 행을 반영할 때도 재사용한다(scenarioSync 라우트). */
export function upsertScenarioRows(rows) {
  const insert = db.prepare(
    `INSERT INTO scenarios (sid, instruction_en, instruction_ko, object_id, object_name, quantity) VALUES (?, ?, ?, ?, ?, ?)`
  );
  const update = db.prepare(`UPDATE scenarios SET instruction_en=?, instruction_ko=?, object_name=?, quantity=? WHERE id=?`);
  let inserted = 0, updated = 0;
  for (const r of rows) {
    const sid = str(r[0]), objectId = padId6(r[3]);
    const instructionEn = str(r[1]), instructionKo = str(r[2]), objectName = str(r[4]), quantity = num(r[5]);
    const existing = get("SELECT id FROM scenarios WHERE sid = ? AND object_id = ?", [sid, objectId]);
    if (existing) {
      update.run(instructionEn, instructionKo, objectName, quantity, existing.id);
      updated++;
    } else {
      insert.run(sid, instructionEn, instructionKo, objectId, objectName, quantity);
      inserted++;
    }
  }
  return { inserted, updated, total: rows.length };
}

// 관리자 계정: login_id를 자연 키로 삼아 갱신/추가한다(비밀번호는 매번 새로 해시).
function importAdminUsers(wb) {
  const rows = sheetRows(wb, "Admin");
  const insert = db.prepare(`INSERT INTO admin_users (login_id, password_hash, name) VALUES (?, ?, ?)`);
  const update = db.prepare(`UPDATE admin_users SET password_hash=?, name=? WHERE login_id=?`);
  let inserted = 0, updated = 0, skipped = 0;
  for (const r of rows) {
    const loginId = idStr(r[0]);
    const plain = idStr(r[1]);
    if (!loginId || !plain) { skipped++; continue; }
    const hash = bcrypt.hashSync(plain, 10);
    const name = str(r[2]);
    const existing = get("SELECT id FROM admin_users WHERE login_id = ?", [loginId]);
    if (existing) {
      update.run(hash, name, loginId);
      updated++;
    } else {
      insert.run(loginId, hash, name);
      inserted++;
    }
  }
  return { inserted, updated, skipped, total: rows.length };
}

// 직원 계정: 이름을 자연 키로 삼아 갱신/추가한다.
function importStaffAccounts(wb) {
  const rows = sheetRows(wb, "ConfigDS계정");
  const insert = db.prepare(`INSERT INTO staff_accounts (name, email) VALUES (?, ?)`);
  const update = db.prepare(`UPDATE staff_accounts SET email=? WHERE name=?`);
  let inserted = 0, updated = 0;
  for (const r of rows) {
    const name = str(r[0]), email = str(r[1]);
    const existing = get("SELECT id FROM staff_accounts WHERE name = ?", [name]);
    if (existing) {
      update.run(email, name);
      updated++;
    } else {
      insert.run(name, email);
      inserted++;
    }
  }
  return { inserted, updated, total: rows.length };
}

function importFloorPlan(wb) {
  const sheet = wb.Sheets["좌석배치도"];
  if (!sheet) return { inserted: 0 };
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  const dataRow = rows.slice(1).find((r) => !isBlankRow(r));
  const raw = dataRow ? str(dataRow[0]) : null;
  if (!raw) return { inserted: 0 };
  db.prepare(`INSERT INTO settings (key, value) VALUES ('floor_plan', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(raw);
  return { inserted: 1 };
}
