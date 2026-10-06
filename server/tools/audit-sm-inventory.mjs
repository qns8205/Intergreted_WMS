// 조회 전용 운영 검증. WMS DB를 읽기 전용으로 열고 SM 수량/사람별 대여 차이를 집계한다.
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const root = process.env.WMS_AUDIT_ROOT || "/home/configds/wms";
const db = new DatabaseSync(`${root}/server/data/db.sqlite3`, { readOnly: true });
const base = process.env.SM_URL || "http://100.92.161.29";
const credentials = JSON.parse(fs.readFileSync(`${root}/server/data/sm-login.json`, "utf8"));
const login = await fetch(base + "/login", {
  method: "POST", headers: { Host: "scenario-manager", "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ username: credentials.loginId, password: credentials.password }),
  redirect: "manual", signal: AbortSignal.timeout(15000),
});
const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
if (!cookie) throw new Error("SM 로그인 실패");
const sm = new Map();
for (let page = 1; page <= 200; page++) {
  const response = await fetch(`${base}/api/objects?page=${page}&per_page=200`, {
    headers: { Host: "scenario-manager", Cookie: cookie }, redirect: "manual", signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`SM 목록 HTTP ${response.status}`);
  const data = await response.json();
  if (data.success === false || !Array.isArray(data.objects)) throw new Error("SM 목록 응답 오류");
  for (const row of data.objects) sm.set(String(row.id).padStart(6, "0"), row);
  if (!data.objects.length || data.has_next === false || data.has_more === false || (data.total_pages && page >= data.total_pages)) break;
}
const snapshotIndex = process.argv.indexOf("--snapshot");
if (snapshotIndex >= 0) fs.writeFileSync(process.argv[snapshotIndex + 1], JSON.stringify([...sm.values()]), { mode: 0o600, flag: "wx" });

const users = db.prepare("SELECT employee_id,name FROM registered_users WHERE active=1 AND employee_id!='0000'").all();
const normalizeName = (name) => String(name || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
const validId = (id) => /^\d{4}$/.test(String(id || "").trim()) ? String(id).trim() : "";
const identity = (row) => {
  let id = validId(row.employee_id);
  const emailId = validId(String(row.email || "").split("@")[0]);
  if (!id && users.some((u) => u.employee_id === emailId && normalizeName(u.name) === normalizeName(row.borrower_name))) id = emailId;
  if (!id && row.request_no) id = validId(db.prepare("SELECT employee_id FROM rental_requests WHERE id=?").get(row.request_no)?.employee_id);
  if (!id) {
    const matches = users.filter((u) => normalizeName(u.name) === normalizeName(row.borrower_name));
    if (matches.length === 1) id = matches[0].employee_id;
  }
  return id || (String(row.email || "").match(/^(\d+)@/) || [])[1] || String(row.borrower_name || "").trim() || "이름 없음";
};
const desired = new Map();
for (const table of ["sid_rentals", "general_rentals"]) {
  const rows = db.prepare(`SELECT * FROM ${table} WHERE (returned!='O' OR returned IS NULL OR status='damage_pending') AND COALESCE(variant_pending,'')!='Y'`).all();
  for (const row of rows) {
    const match = /^\[(\d+)\]\s*(.*)$/.exec(String(row.item_label || ""));
    const id = table === "sid_rentals" ? match?.[1] : row.item_id;
    if (!id) continue;
    const qty = table === "sid_rentals" ? Number(/\s*[x×]\s*(\d+)\s*$/i.exec(match[2])?.[1]) || 1 : Number(row.qty) || 1;
    if (!desired.has(id)) desired.set(id, {});
    const who = identity(row), people = desired.get(id);
    people[who] = (people[who] || 0) + qty;
  }
}
const mismatches = [];
let tracked = 0, missing = 0, untracked = 0;
const objects = db.prepare("SELECT id,stock,rented FROM scenario_items").all();
for (const object of objects) {
  const inv = sm.get(object.id)?._inventory;
  if (!inv) { missing++; continue; }
  if (inv.is_tracked !== true) { untracked++; continue; }
  tracked++;
  const want = desired.get(object.id) || {}, have = inv.borrowers || {};
  const qtyMismatch = Number(inv.total) !== (Number(object.stock) || 0) + (Number(object.rented) || 0);
  const borrowMismatch = [...new Set([...Object.keys(want), ...Object.keys(have)])].some((k) => (Number(want[k]) || 0) !== (Number(have[k]) || 0));
  const stockMismatch = Number(inv.available) !== (Number(object.stock) || 0);
  const rentedMismatch = Number(inv.borrowed) !== (Number(object.rented) || 0);
  if (qtyMismatch || borrowMismatch || stockMismatch || rentedMismatch) mismatches.push({ id: object.id, quantity: qtyMismatch, borrow: borrowMismatch, stock: stockMismatch, rented: rentedMismatch });
}
const baseline = JSON.parse(db.prepare("SELECT value FROM settings WHERE key='sm_sync_baseline'").get()?.value || "null");
console.log(JSON.stringify({ wmsItems: objects.length, smItems: sm.size, tracked, missing, untracked,
  mismatchedItems: mismatches.length, quantityMismatches: mismatches.filter((r) => r.quantity).length,
  borrowMismatches: mismatches.filter((r) => r.borrow).length, sample: mismatches.slice(0, 15),
  stockMismatches: mismatches.filter((r) => r.stock).length, rentedMismatches: mismatches.filter((r) => r.rented).length,
  baselineItems: baseline ? Object.keys(baseline).length : null }));
db.close();
