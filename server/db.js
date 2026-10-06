import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_TABLECLOTH_CATEGORIES } from "./lib/tableclothCategoryDefaults.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dbPath = process.env.WMS_DB_PATH || path.join(__dirname, "data", "db.sqlite3");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = OFF;");

const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
db.exec(schema);

/** `CREATE TABLE IF NOT EXISTS` no-ops on a table that already exists, so new columns added to
 *  schema.sql later need to be backfilled onto existing databases explicitly. */
function ensureColumn(table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}
ensureColumn("scenario_items", "personal_owner", "TEXT");
// 불량 로그를 등록한 관리자. breaker(파손자)와 별개다. 알림에서 본인이 등록한 건을 빼는 데 쓴다.
ensureColumn("defect_logs", "reported_by", "TEXT");
// 명부에 어떻게 들어왔는지. 'signup'(가입 신청 승인)은 명부 파일을 다시 불러와도 비활성화하지 않는다.
ensureColumn("registered_users", "source", "TEXT");
// 같은 사번의 대기 중 신청은 하나만 둔다.
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_signup_pending ON signup_requests(employee_id) WHERE status = 'pending'");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_signup_pending ON admin_signup_requests(login_id) WHERE status = 'pending'");
ensureColumn("warehouse_items", "archived", "TEXT");
ensureColumn("return_photos", "items_json", "TEXT");
// 관리자 반납과 무인 반납을 사진함에서 별도 탭으로 나누기 위한 출처.
// 기존 행은 NULL이며 일반 반납으로 취급한다.
ensureColumn("return_photos", "source", "TEXT");
// source 열이 생기기 직전에 저장된 무인 반납 사진도 새 탭으로 옮긴다.
db.exec("UPDATE return_photos SET source='unattended' WHERE (source IS NULL OR TRIM(source)='') AND summary LIKE '무인 반납 ·%'");
// 반납 사진 저장은 Wi-Fi 경로에서 응답만 유실되는 일이 있다(라우터가 연결 상태를 잃는다).
// 그때 사람이 다시 눌러도 같은 사진이 두 번 쌓이지 않도록 시도마다 식별자를 받아 둔다.
ensureColumn("return_photos", "client_id", "TEXT");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_return_photos_client ON return_photos(client_id) WHERE client_id IS NOT NULL");
for (const t of ["sid_rentals", "general_rentals"]) {
  ensureColumn(t, "variant_id", "INTEGER");
  ensureColumn(t, "variant_pending", "TEXT");
  ensureColumn(t, "request_no", "INTEGER");
  ensureColumn(t, "employee_id", "TEXT");
  // 반납 없이 오래 보관되는 request 물품처럼, 관리자가 대여/반납 처리 화면에서
  // 건별로 "이 대여 줄은 종류 수 한도 계산에서 뺀다"고 지정할 수 있게 한다.
  ensureColumn(t, "type_limit_exempt", "TEXT");
  // 한도 제외는 나중에 봐도 판단 근거를 알 수 있어야 하므로 사유도 함께 보관한다.
  ensureColumn(t, "type_limit_exempt_reason", "TEXT");
  // 어떤 경로로 반납 처리됐는지. 'admin'(관리자 반납) / 'self'(본인이 대여 화면에서 반납)
  // / 'unattended'(무인 반납) / 'cancel'(대여 확인 전 반납·미수령 자동 취소) / 'transfer'(양도)
  // / 'swap'(관리자 물품 교체) / 'damage'(파손 반납). 이 열이 생기기 전 행은 NULL.
  // QR 위치 확인의 "미확인 반납"(선반에 되돌려 놓을 물품)은 admin/self/unattended만 보여준다.
  ensureColumn(t, "return_source", "TEXT");
  db.exec(`UPDATE ${t} SET return_source='cancel' WHERE return_source='pickup_timeout'`);
  db.exec(`UPDATE ${t} SET return_source='cancel' WHERE return_source IS NULL AND returned='O' AND purpose LIKE '%[미수령 자동 취소]%'`);
}
ensureColumn("rental_requests", "request_code", "TEXT");
ensureColumn("rental_requests", "employee_id", "TEXT");
ensureColumn("warehouse_rental_logs", "employee_id", "TEXT");
// request_code는 예전 데이터 호환용으로만 남긴다. 새 번호는 더 이상 발급하지 않는다.
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_rental_requests_code ON rental_requests(request_code)");
db.exec("CREATE INDEX IF NOT EXISTS idx_registered_users_name ON registered_users(name, active)");
db.exec("CREATE INDEX IF NOT EXISTS idx_sid_rentals_employee ON sid_rentals(employee_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_general_rentals_employee ON general_rentals(employee_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_warehouse_rental_logs_employee ON warehouse_rental_logs(employee_id)");
// 예전 공구 로그도 이름이 명부에서 한 사람에게만 일치하는 경우 사번을 안전하게 보강한다.
// 동명이인은 자동 추정하지 않는다.
db.exec(`UPDATE warehouse_rental_logs
  SET employee_id = (
    SELECT MIN(u.employee_id) FROM registered_users u
    WHERE u.active = 1 AND u.employee_id != '0000' AND TRIM(u.name) = TRIM(warehouse_rental_logs.manager)
  )
  WHERE (employee_id IS NULL OR TRIM(employee_id) = '')
    AND 1 = (
      SELECT COUNT(*) FROM registered_users u
      WHERE u.active = 1 AND u.employee_id != '0000' AND TRIM(u.name) = TRIM(warehouse_rental_logs.manager)
    )`);
// 공구 미반납 목록이 위치를 빈 값으로 내려주던 동안(2026-10) 관리자 반납이 위치 없이 기록됐다.
// 그런 반납은 대여 기록(위치+품명+사람)과 짝이 안 맞아 미반납으로 남는다. 같은 사람이 같은 품명을
// 빌린 위치가 하나뿐이면 그 위치로 채운다. 재고도 그때 못 돌려받았으면(이력 없음) 여기서 돌려준다.
// 위치를 채운 행은 다시 대상이 되지 않으므로 여러 번 돌아도 안전하다.
{
  const orphans = db.prepare(`SELECT * FROM warehouse_rental_logs
    WHERE TRIM(COALESCE(location, '')) = '' AND TRIM(COALESCE(name, '')) != ''
      AND (type IN ('반납', '소모') OR note LIKE '%[소모완료]%')
      AND note IN ('관리자 반납 처리', '[소모완료] 관리자 반납 중 소모 처리')`).all();
  for (const o of orphans) {
    const emp = String(o.employee_id || "").trim();
    const locs = db.prepare(`SELECT DISTINCT TRIM(location) AS loc FROM warehouse_rental_logs
      WHERE type = '대여' AND TRIM(COALESCE(location, '')) != '' AND TRIM(name) = TRIM(?)
        AND ((? != '' AND employee_id = ?) OR TRIM(COALESCE(manager, '')) = TRIM(COALESCE(?, '')))`).all(o.name, emp, emp, o.manager);
    if (locs.length !== 1) { console.warn(`[db] 위치 없는 공구 반납 #${o.id} (${o.name}) — 대여 위치를 하나로 특정하지 못해 그대로 둠`); continue; }
    const loc = locs[0].loc;
    db.exec("BEGIN");
    try {
      db.prepare("UPDATE warehouse_rental_logs SET location = ? WHERE id = ?").run(loc, o.id);
      const restocks = o.type === "반납" && !String(o.note || "").includes("[소모완료]");
      const logged = db.prepare("SELECT 1 FROM inventory_history WHERE category = 'inventory' AND occurred_at = ? AND item_name = ? AND reason = '공구 반납'").get(o.occurred_at, o.name);
      const item = db.prepare("SELECT * FROM warehouse_items WHERE location = ? AND name = ?").get(loc, o.name);
      const qty = Number(o.qty) || 0;
      if (restocks && !logged && item && qty > 0 && !Number.isNaN(Number(item.stock))) {
        const before = Number(item.stock), after = before + qty;
        db.prepare("UPDATE warehouse_items SET stock = ? WHERE id = ?").run(String(after), item.id);
        db.prepare(`INSERT INTO inventory_history (occurred_at, category, ref_id, item_name, before_val, after_val, diff, reason, manager)
          VALUES (?, 'inventory', ?, ?, ?, ?, ?, '공구 반납', ?)`).run(o.occurred_at, String(item.id), item.name, before, after, qty, o.manager ?? null);
      }
      db.exec("COMMIT");
      console.log(`[db] 위치 없는 공구 반납 #${o.id} (${o.name}) → ${loc}${restocks && !logged && item ? " · 재고 복구" : ""}`);
    } catch (err) {
      db.exec("ROLLBACK");
      console.warn(`[db] 위치 없는 공구 반납 #${o.id} 보정 실패:`, err.message);
    }
  }
}
ensureColumn("scenario_item_variants", "image_path", "TEXT");
// 종류마다 크기가 다른 물품을 위한 치수. 비어 있으면 물품 자체의 치수를 쓴다.
ensureColumn("scenario_item_variants", "width_mm", "REAL");
ensureColumn("scenario_item_variants", "depth_mm", "REAL");
ensureColumn("scenario_item_variants", "height_mm", "REAL");
ensureColumn("scenario_item_variants", "shape", "TEXT");
// 종류가 나뉜 물품에서 "아직 어느 종류인지 확인되지 않은" 선반 재고.
// 종류 도입 전부터 나가 있다가 돌아온 물건이나 관리자가 아직 배분하지 못한 수량이 여기 쌓인다.
// 물품의 총재고 = 종류별 재고 합 + 이 값.
ensureColumn("scenario_items", "unassigned_stock", "REAL DEFAULT 0");
// 실측 치수(mm). 선택 항목이라 값이 없으면 NULL — "실제 크기 보기"는 세 값이 다 있을 때만 뜬다.
ensureColumn("scenario_items", "width_mm", "REAL");
ensureColumn("scenario_items", "depth_mm", "REAL");
ensureColumn("scenario_items", "height_mm", "REAL");
// 치수를 어떤 형태로 그릴지 — box(육면체, 기본) / cylinder(원통) / pyramid(피라미드).
// 값이 없으면 지금까지처럼 육면체로 본다.
ensureColumn("scenario_items", "shape", "TEXT");
// 구매 링크. 관리 화면에서만 입력·표시하고, 대여 화면으로 나가는 응답에는 싣지 않는다
// (SM의 오브젝트 product_link와 같은 값을 담는다).
ensureColumn("scenario_items", "purchase_link", "TEXT");
// Scenario Manager 등록 화면이 받는 값들. WMS에는 대응하는 개념이 없어서 새로 입력받는다.
// 크기(Extra-Small/Small/Medium/Large), 속성(Soft/Hard/Deformable/Fragile), 기타 메모.
ensureColumn("scenario_items", "sm_size", "TEXT");
ensureColumn("scenario_items", "sm_property", "TEXT");
ensureColumn("scenario_items", "product_memo", "TEXT");
// SM 오브젝트 등록 시도 기록. 세션 방식 등록에는 SM 쪽 중복 방지 장치가 없어서,
// "이 등록 시도로 몇 번이 났는지"를 여기에 남겨 같은 시도가 두 번 오면 SM을 다시 부르지 않는다.
// SM 오브젝트는 삭제가 안 되고 폐기만 되므로 중복은 되돌릴 수 없다.
db.exec(`CREATE TABLE IF NOT EXISTS sm_object_registrations (
  client_id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL,
  created_at TEXT
)`);
// 테이블보도 시나리오 물품과 같은 대여 흐름을 타므로 "대여 중" 수량이 필요하다.
ensureColumn("tablecloth_items", "rented", "REAL DEFAULT 0");
// 테이블보는 이름이 번호뿐이라 사진 말고는 무엇인지 알 길이 없다 — 무늬 종류(대분류)와
// 그 안의 결(소분류)을 적어 두어야 100장 넘는 목록에서 원하는 천을 골라낼 수 있다.
// 값은 src/utils/tableclothCategory.ts 의 key 문자열, 아직 분류 안 된 것은 NULL.
ensureColumn("tablecloth_items", "category", "TEXT");
ensureColumn("tablecloth_items", "subcategory", "TEXT");
// 같은 천을 다시 사거나 원단 정보를 찾아볼 일이 잦은데, 그 주소를 메모에 적어두면 눌러지지 않는다.
// 링크만 따로 받아 카드에서 바로 열 수 있게 한다. 여러 개면 줄바꿈으로 이어 붙인다.
ensureColumn("tablecloth_items", "link", "TEXT");
// ConfigDS 직원 사번. cfgw 인원은 대여할 때 사번을 직접 입력하지만 ConfigDS 인원은
// 이름만 받으므로, 사번이 필요한 곳(Scenario Manager 연동 등)에서 쓰려면 명부에 적어둬야 한다.
ensureColumn("staff_accounts", "employee_id", "TEXT");

// 분류표가 비어 있을 때만 기본 목록을 깔아 준다. 화면에서 지운 분류가 재시작마다 되살아나면
// 안 되므로, "한 줄이라도 있으면" 손대지 않는다.
{
  const n = db.prepare("SELECT COUNT(*) AS n FROM tablecloth_categories").get().n;
  if (!n) {
    const ins = db.prepare(
      "INSERT INTO tablecloth_categories (key, parent_key, label, emoji, color, sort_order) VALUES (?, ?, ?, ?, ?, ?)"
    );
    DEFAULT_TABLECLOTH_CATEGORIES.forEach((c, ci) => {
      ins.run(c.key, "", c.label, c.emoji, c.color, ci);
      c.subs.forEach((sub, si) => ins.run(sub.key, c.key, sub.label, "", "", si));
    });
  }
}

/** Runs `fn` inside a transaction, rolling back on throw. */
export function transaction(fn) {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** Convenience: prepare + run/get/all with a plain object or array of params. */
export function run(sql, params = []) {
  return db.prepare(sql).run(...toParams(params));
}
export function get(sql, params = []) {
  return db.prepare(sql).get(...toParams(params));
}
export function all(sql, params = []) {
  return db.prepare(sql).all(...toParams(params));
}

function toParams(params) {
  return Array.isArray(params) ? params : [params];
}
