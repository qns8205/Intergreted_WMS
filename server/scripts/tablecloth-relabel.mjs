/**
 * 테이블보를 이름 대신 번호(TC-0007)로 부르기로 하면서, 이미 쌓여 있던 이름들을 정리한다.
 * 화면 표시는 코드에서 id로 파생하지만(serialize.tableclothLabel), 대여 장부에 박혀 있는
 * item_label 은 대여 시점의 문자열이라 여기서 직접 바꿔야 옛 이름이 사라진다.
 *
 * 실행: node server/scripts/tablecloth-relabel.mjs [--apply]
 *   --apply 없이 실행하면 무엇이 바뀌는지만 보여준다(기본값).
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.WMS_DB_PATH || path.join(__dirname, "..", "data", "db.sqlite3");
const apply = process.argv.includes("--apply");

const db = new DatabaseSync(dbPath);
const label = (id) => `TC-${String(Number(id) || 0).padStart(4, "0")}`;

const items = db.prepare("SELECT id, name FROM tablecloth_items ORDER BY id").all();
const rentals = db.prepare("SELECT id, item_id, item_label FROM tablecloth_rentals ORDER BY id").all();

const itemHits = items.filter((r) => (r.name || "") !== label(r.id));
const rentalHits = rentals.filter((r) => (r.item_label || "") !== label(r.item_id));

console.log(`DB: ${dbPath}`);
console.log(`테이블보 ${items.length}종 · 대여 줄 ${rentals.length}건`);
console.log(`\n[물품 이름] ${itemHits.length}건`);
for (const r of itemHits) console.log(`  #${r.id}  "${r.name || ""}" → ${label(r.id)}`);
console.log(`\n[대여 장부 품명] ${rentalHits.length}건`);
for (const r of rentalHits) console.log(`  rental#${r.id} (item ${r.item_id})  "${r.item_label || ""}" → ${label(r.item_id)}`);

if (!apply) {
  console.log("\n확인용 실행입니다. 실제로 바꾸려면 --apply 를 붙이세요.");
  process.exit(0);
}

db.exec("BEGIN");
try {
  const ui = db.prepare("UPDATE tablecloth_items SET name = ? WHERE id = ?");
  for (const r of itemHits) ui.run(label(r.id), r.id);
  const ur = db.prepare("UPDATE tablecloth_rentals SET item_label = ? WHERE id = ?");
  for (const r of rentalHits) ur.run(label(r.item_id), r.id);
  db.exec("COMMIT");
} catch (err) {
  db.exec("ROLLBACK");
  throw err;
}
console.log(`\n적용 완료 — 물품 ${itemHits.length}건, 대여 줄 ${rentalHits.length}건`);
