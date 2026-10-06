import fs from "node:fs";
import { run, transaction } from "../db.js";
import { backfillRentalEmployeeIds, normalizeEmployeeId } from "../lib/registeredUsers.js";

const inputPath = process.argv[2];
if (!inputPath) throw new Error("사용법: node server/scripts/import-registered-users.js <명부.tsv>");

const rows = fs.readFileSync(inputPath, "utf8")
  .replace(/^\uFEFF/, "")
  .split(/\r?\n/)
  .map((line) => line.split("\t"))
  .map(([employeeId, name]) => ({ employeeId: normalizeEmployeeId(employeeId), name: String(name || "").trim() }))
  .filter((row) => row.employeeId && row.name && row.employeeId !== "0000");

const ids = new Set();
for (const row of rows) {
  if (ids.has(row.employeeId)) throw new Error(`중복 사번이 있습니다: ${row.employeeId}`);
  ids.add(row.employeeId);
}

const importedAt = new Date().toISOString();
transaction(() => {
  // 가입 신청으로 승인된 사람은 명부 파일에 아직 없을 수 있으니 그대로 둔다.
  run("UPDATE registered_users SET active = 0 WHERE COALESCE(source, '') != 'signup'");
  for (const row of rows) {
    run(
      `INSERT INTO registered_users (employee_id, name, active, imported_at) VALUES (?, ?, 1, ?)
       ON CONFLICT(employee_id) DO UPDATE SET name=excluded.name, active=1, imported_at=excluded.imported_at`,
      [row.employeeId, row.name, importedAt]
    );
  }
});

const backfill = backfillRentalEmployeeIds();
console.log(JSON.stringify({ imported: rows.length, ...backfill }));
