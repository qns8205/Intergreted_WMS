-- WMS local SQLite schema.
-- Applied idempotently on server startup via `CREATE TABLE IF NOT EXISTS`.

CREATE TABLE IF NOT EXISTS scenario_items (
  id TEXT PRIMARY KEY,
  name TEXT,
  sector TEXT,
  root_slot TEXT,
  category TEXT,
  subcategory TEXT,
  image_path TEXT,
  stock REAL,
  rented REAL,
  exclude_low_rent TEXT,
  is_counted TEXT,
  sm_linked TEXT,
  fragile TEXT,
  fire TEXT,
  request TEXT,
  is_storage TEXT,
  personal_owner TEXT,
  purchase_link TEXT,
  sm_size TEXT,
  sm_property TEXT,
  product_memo TEXT
);

CREATE TABLE IF NOT EXISTS warehouse_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  location TEXT,
  subcategory TEXT,
  name TEXT,
  purchase_link TEXT,
  stock TEXT,
  updated_at TEXT,
  manager TEXT,
  manager2 TEXT,
  note TEXT,
  image_path TEXT,
  keywords TEXT,
  consumable TEXT,
  archived TEXT
);

CREATE TABLE IF NOT EXISTS sid_rentals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  borrower_name TEXT,
  employee_id TEXT,
  sid TEXT,
  item_label TEXT,
  borrow_date TEXT,
  purpose TEXT,
  returned TEXT,
  return_date TEXT,
  email TEXT,
  batch_id TEXT,
  applied_at TEXT,
  item_type TEXT,
  confirmed_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  floor TEXT,
  unit TEXT,
  picked_up_at TEXT,
  -- 종류가 있는 시나리오 물품을 빌린 경우 어떤 종류인지(scenario_item_variants.id).
  -- variant_pending='Y'는 신청자가 "종류 상관없음"을 골라 아직 확정되지 않은 줄 —
  -- 이 줄은 재고를 차감하지 않은 상태이며, 대여 확인 때 담당자가 종류를 지정하면 차감된다.
  variant_id INTEGER,
  variant_pending TEXT,
  type_limit_exempt TEXT,
  type_limit_exempt_reason TEXT
);

CREATE TABLE IF NOT EXISTS general_rentals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  borrower_name TEXT,
  employee_id TEXT,
  item_id TEXT,
  item_label TEXT,
  qty REAL,
  borrow_date TEXT,
  purpose TEXT,
  returned TEXT,
  return_date TEXT,
  email TEXT,
  batch_id TEXT,
  applied_at TEXT,
  category TEXT,
  confirmed_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  floor TEXT,
  unit TEXT,
  picked_up_at TEXT,
  -- 종류가 있는 시나리오 물품을 빌린 경우 어떤 종류인지(scenario_item_variants.id).
  -- variant_pending='Y'는 신청자가 "종류 상관없음"을 골라 아직 확정되지 않은 줄 —
  -- 이 줄은 재고를 차감하지 않은 상태이며, 대여 확인 때 담당자가 종류를 지정하면 차감된다.
  variant_id INTEGER,
  variant_pending TEXT,
  type_limit_exempt TEXT,
  type_limit_exempt_reason TEXT
);

-- 한 번의 대여 신청에 사람이 읽을 수 있는 연속 번호를 하나만 발급한다.
-- 시나리오 본품·추가 물품이 서로 다른 batch_id로 나뉘어도 request_no는 같아서
-- 관리자가 번호 하나로 그 신청 전체를 확인할 수 있다.
CREATE TABLE IF NOT EXISTS rental_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT,
  borrower_name TEXT,
  employee_id TEXT,
  request_code TEXT UNIQUE
);

-- 대여자 기준 명부. 외부 TSV의 1열(4자리 사번)과 2열(이름)을 가져온다.
CREATE TABLE IF NOT EXISTS registered_users (
  employee_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  imported_at TEXT
);

-- 명부에 없는 사람이 스스로 넣는 가입 신청. 관리자가 승인해야 registered_users에 들어간다.
CREATE TABLE IF NOT EXISTS signup_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT
);

-- 관리자 계정 가입 신청. Scenario Manager와 같은 아이디·비밀번호여야 신청이 들어오고,
-- 기존 관리자가 승인하면 admin_users에 들어간다. 비밀번호는 해시만 두고, 처리가 끝나면 비운다.
CREATE TABLE IF NOT EXISTS admin_signup_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login_id TEXT NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT
);

-- 관리자별 알림 읽음 표시. notif_key는 "<원본 테이블>:<id>" (예: edit:1071, defect:42).
CREATE TABLE IF NOT EXISTS admin_notification_reads (
  admin_id INTEGER NOT NULL,
  notif_key TEXT NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY (admin_id, notif_key)
);

CREATE TABLE IF NOT EXISTS rental_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT,
  borrower_name TEXT,
  floor TEXT,
  unit TEXT,
  batch_id TEXT,
  kind TEXT
);

CREATE TABLE IF NOT EXISTS warehouse_rental_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT,
  type TEXT,
  location TEXT,
  name TEXT,
  qty REAL,
  manager TEXT,
  employee_id TEXT,
  note TEXT
);

CREATE TABLE IF NOT EXISTS warehouse_manual_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL UNIQUE,
  employee_id TEXT NOT NULL,
  borrower_name TEXT NOT NULL,
  floor TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  image_path TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS warehouse_manual_request_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES warehouse_manual_requests(id),
  entered_name TEXT NOT NULL,
  qty INTEGER NOT NULL,
  item_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT,
  rental_log_id INTEGER,
  resolved_at TEXT,
  resolver TEXT
);
CREATE INDEX IF NOT EXISTS idx_warehouse_manual_pending ON warehouse_manual_request_items(status, request_id);

-- 사진 보관 기간이 끝나도 반납의 중복 방지 기록은 남긴다.
CREATE TABLE IF NOT EXISTS warehouse_manual_returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL UNIQUE,
  employee_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  items_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS defect_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product TEXT,
  qty REAL,
  occurred_date TEXT,
  defect_type TEXT,
  detail TEXT,
  action_taken TEXT,
  image_path TEXT,
  breaker TEXT
);

CREATE TABLE IF NOT EXISTS inventory_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT,
  category TEXT,
  ref_id TEXT,
  item_name TEXT,
  before_val REAL,
  after_val REAL,
  diff REAL,
  reason TEXT,
  manager TEXT
);

-- 시나리오 오브젝트의 이름/카테고리/보관처리 등 "재고가 아닌" 정보 변경 이력.
-- 재고/대여중 변화는 inventory_history(수동 조정)와 sid_rentals/general_rentals(대여·반납)에
-- 이미 있으므로, 여기서는 그 외 필드 변경 + 신규 등록/삭제만 기록한다.
-- 기준 시점을 저장할 때, 그 순간의 모든 시나리오 물품 재고/대여중 값을 통째로 찍어둔다.
-- "변경 이력" 요약 화면이 이걸 지금 값과 비교해서 "재고 몇 개 줄고 대여중 몇 개 늘고"를 보여준다.
CREATE TABLE IF NOT EXISTS scenario_checkpoint_snapshot (
  item_id TEXT PRIMARY KEY,
  item_name TEXT,
  stock REAL,
  rented REAL,
  captured_at TEXT
);

CREATE TABLE IF NOT EXISTS scenario_item_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT,
  item_id TEXT,
  item_name TEXT,
  change_type TEXT,
  summary TEXT,
  manager TEXT
);

-- 관리자 화면에서 수행한 물품 정보 변경 감사 로그.
-- 대여/반납 장부와 분리해 두어 설정 화면에는 관리자가 직접 바꾼 내용만 노출한다.
CREATE TABLE IF NOT EXISTS item_change_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT NOT NULL,
  category TEXT NOT NULL, -- scenario | inventory | tablecloth
  item_id TEXT,
  item_name TEXT,
  change_type TEXT,
  summary TEXT,
  manager TEXT
);
CREATE INDEX IF NOT EXISTS idx_item_change_logs_category_time
  ON item_change_logs(category, occurred_at DESC);

CREATE TABLE IF NOT EXISTS return_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT,
  image_path TEXT,
  summary TEXT,
  items_json TEXT,
  source TEXT,
  -- 클라이언트가 한 번의 저장 시도에 붙이는 식별자. 응답만 유실되고 저장은 됐을 때
  -- 사람이 "다시 시도"를 눌러도 사진이 두 장 남지 않게 하는 열쇠다.
  client_id TEXT
);
-- client_id 인덱스는 db.js에서 만든다 — 이 파일은 기존 DB에도 통째로 실행되는데,
-- 그때는 아직 ensureColumn이 client_id를 붙이기 전이라 여기서 인덱스를 만들면 깨진다.

-- 물품(시나리오 오브젝트/공구 및 부품류) 하나에 대표 사진(scenario_items.image_path,
-- warehouse_items.image_path) 외에 추가로 등록하는 여러 장의 사진.
CREATE TABLE IF NOT EXISTS item_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,   -- 'scenario' | 'warehouse'
  item_id TEXT NOT NULL,    -- scenario_items.id 또는 warehouse_items.id(문자열)
  image_path TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS inventory_audits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audited_at TEXT,
  item_id TEXT,
  item_name TEXT,
  system_stock REAL,
  audited_stock REAL,
  diff REAL,
  auditor TEXT,
  memo TEXT
);

CREATE TABLE IF NOT EXISTS penalties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  max_types REAL,
  reason TEXT,
  expires_at TEXT
);

-- 페널티가 어느 대여·반납 기록의 어느 물품 때문에 생겼는지(관리자가 등록할 때 고른다).
-- 물품·신청 정보는 연결한 시점의 값을 두고, 대여·반납 상태는 원본 줄(sheet_type/row_id)에서 읽는다.
CREATE TABLE IF NOT EXISTS penalty_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  penalty_id INTEGER NOT NULL,
  sheet_type TEXT NOT NULL,      -- scenario(sid_rentals) | general(general_rentals)
  row_id INTEGER NOT NULL,
  cause TEXT NOT NULL,           -- rental(대여 때문) | return(반납 때문)
  item_id TEXT,
  item_name TEXT,
  variant_name TEXT,
  qty REAL,
  request_no INTEGER,
  applied_at TEXT,
  created_at TEXT,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_penalty_links_penalty ON penalty_links(penalty_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- 무인 반납은 관리자 반납과 달리 한 번의 제출을 하나의 원자적 작업으로 기록한다.
-- client_id는 Wi-Fi 끊김 뒤 재전송되어도 같은 반납이 두 번 처리되지 않게 한다.
CREATE TABLE IF NOT EXISTS unattended_return_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  borrower_name TEXT,
  request_codes_json TEXT,
  items_json TEXT,
  image_path TEXT
);

CREATE TABLE IF NOT EXISTS unattended_damage_pending (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL,
  sheet_type TEXT NOT NULL,
  rental_row_id INTEGER NOT NULL,
  item_id TEXT,
  item_name TEXT,
  qty REAL NOT NULL,
  reason TEXT,
  image_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolver TEXT
);

CREATE TABLE IF NOT EXISTS unattended_pickup_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL UNIQUE,
  request_no INTEGER,
  created_at TEXT NOT NULL,
  image_path TEXT NOT NULL,
  items_json TEXT
);

-- 무인 모드 자동 페널티가 같은 대여 신청에 반복 부과되지 않도록 위반 자체를 별도 장부에 남긴다.
-- event_key는 "미수령/미반납 + 신청번호" 조합이라, 서버가 주기적으로 다시 검사해도 한 번만 생성된다.
CREATE TABLE IF NOT EXISTS unattended_penalty_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  employee_id TEXT,
  borrower_name TEXT,
  request_no INTEGER,
  source_at TEXT,
  occurred_at TEXT NOT NULL,
  penalty_id INTEGER,
  details TEXT
);

CREATE TABLE IF NOT EXISTS notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT,
  author TEXT,
  content TEXT,
  detail TEXT,
  title TEXT
);

CREATE TABLE IF NOT EXISTS scenarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sid TEXT,
  instruction_en TEXT,
  instruction_ko TEXT,
  object_id TEXT,
  object_name TEXT,
  quantity REAL
);

CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login_id TEXT UNIQUE,
  password_hash TEXT,
  name TEXT,
  slack_id TEXT
);

-- 관리자 로그인 세션. 원문 토큰은 브라우저만 갖고, 여기엔 sha256 해시만 둔다.
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  email TEXT,
  slack_user_id TEXT
);

CREATE TABLE IF NOT EXISTS sectors (
  id TEXT PRIMARY KEY,
  name TEXT,
  x REAL,
  y REAL,
  width REAL,
  height REAL,
  rotation REAL,
  color TEXT
);

CREATE INDEX IF NOT EXISTS idx_sid_rentals_status ON sid_rentals(status);
CREATE INDEX IF NOT EXISTS idx_general_rentals_status ON general_rentals(status);
CREATE INDEX IF NOT EXISTS idx_sid_rentals_batch ON sid_rentals(batch_id);
CREATE INDEX IF NOT EXISTS idx_general_rentals_batch ON general_rentals(batch_id);
CREATE INDEX IF NOT EXISTS idx_scenarios_sid ON scenarios(sid);

-- 시나리오 오브젝트 하나 안에서 구분되는 "종류"(예: 같은 의자의 색상/모델 차이).
-- 종류가 하나도 없는 물품은 지금까지와 똑같이 scenario_items.stock/rented만으로 동작한다.
-- 종류가 정의된 물품은 종류 재고의 합이 곧 물품의 총재고이며, 관리자가 종류별 수량을
-- 저장할 때 scenario_items.stock/rented를 그 합계로 덮어쓴다.
CREATE TABLE IF NOT EXISTS scenario_item_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL,
  name TEXT NOT NULL,
  stock REAL NOT NULL DEFAULT 0,
  rented REAL NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  image_path TEXT,
  -- 종류마다 크기가 다른 물품이 있다(같은 상자인데 대·중·소 같은 식).
  -- 값이 없으면 물품 자체의 치수를 쓴다 — 종류를 나눠도 크기는 같은 경우가 대부분이라
  -- 굳이 종류마다 다시 재게 하지 않는다.
  width_mm REAL,
  depth_mm REAL,
  height_mm REAL,
  shape TEXT
);

CREATE INDEX IF NOT EXISTS idx_scenario_item_variants_item ON scenario_item_variants(item_id);

-- 테이블보. 시나리오 물품과 별개로 관리한다(촬영용 천이라 재고·위치·크기만 보면 된다).
-- 천은 두께가 의미 없어 가로·세로만 받는다.
CREATE TABLE IF NOT EXISTS tablecloth_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  location TEXT,
  image_path TEXT,
  stock REAL DEFAULT 0,
  width_mm REAL,
  depth_mm REAL,
  -- 무늬 분류(대분류/소분류). key 목록은 src/utils/tableclothCategory.ts 가 원본이다.
  category TEXT,
  subcategory TEXT,
  -- 참고 링크(구매처·원단 정보 등). 여러 개면 줄바꿈으로 이어 붙인다.
  link TEXT,
  note TEXT,
  archived TEXT,
  updated_at TEXT
);

-- 테이블보 무늬 분류표. 화면에서 고칠 수 있어야 하므로 코드가 아니라 여기에 산다.
-- parent_key가 ''이면 대분류, 값이 있으면 그 대분류의 소분류다(NULL을 안 쓰는 이유: SQLite는
-- PRIMARY KEY 안의 NULL을 중복으로 보지 않아 대분류 key가 겹쳐도 막지 못한다).
-- 물품에는 key만 적히므로 라벨·이모지·색을 바꿔도 이미 분류된 테이블보는 그대로 따라온다.
CREATE TABLE IF NOT EXISTS tablecloth_categories (
  key TEXT NOT NULL,
  parent_key TEXT NOT NULL DEFAULT '',
  label TEXT,
  emoji TEXT,
  color TEXT,
  sort_order INTEGER DEFAULT 0,
  PRIMARY KEY (key, parent_key)
);

-- 테이블보 대여 기록. 공구(창고) 대여와 같은 방식이다 — 재고를 더하고 빼며 줄을 남긴다.
CREATE TABLE IF NOT EXISTS tablecloth_rental_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT,
  type TEXT,
  item_id INTEGER,
  name TEXT,
  qty REAL,
  borrower TEXT,
  purpose TEXT
);

-- 테이블보 대여 장부. 시나리오 물품과 "흐름"은 같지만(신청 → 대여 확인 → 반납)
-- 장부는 따로 둔다 — 대여/반납 화면에서 별도 항목으로 다뤄야 하기 때문이다.
CREATE TABLE IF NOT EXISTS tablecloth_rentals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  borrower_name TEXT,
  affiliation TEXT,
  employee_id TEXT,
  email TEXT,
  floor TEXT,
  unit TEXT,
  item_id INTEGER,
  item_label TEXT,
  qty REAL,
  purpose TEXT,
  applied_at TEXT,
  picked_up_at TEXT,
  returned TEXT,
  return_date TEXT,
  status TEXT,
  batch_id TEXT
);
