import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const key = readFileSync('/home/configds/wms/server/data/planner-bridge.key', 'utf8').trim();
const db = new DatabaseSync('/home/configds/wms/server/data/db.sqlite3', { readOnly: true });
const rows = db.prepare(`SELECT DISTINCT request_no AS requestNo, employee_id AS employeeId FROM general_rentals
  WHERE COALESCE(returned,'') != 'O' AND request_no > 0 ORDER BY request_no DESC LIMIT 200`).all();
const nos = rows.map((r) => r.requestNo);
const reservations = nos.length ? db.prepare(`SELECT id FROM item_reservations WHERE request_no IN (${nos.map(() => '?').join(',')})`).all(...nos) : [];
const url = new URL('http://127.0.0.1:3010/api/wms/rental-context');
url.searchParams.set('requestNos', nos.join(','));
url.searchParams.set('reservationIds', reservations.map((r) => r.id).join(','));
assert.equal((await fetch(url, { signal: AbortSignal.timeout(5000) })).status, 401);
const response = await fetch(url, { headers: { 'x-planner-key': key }, signal: AbortSignal.timeout(5000) });
assert.equal(response.status, 200);
const data = await response.json();
assert.ok(Array.isArray(data.contexts));
for (const ctx of data.contexts) {
  assert.equal(typeof ctx.collectionName, 'string');
  assert.ok(ctx.employeeId && ctx.planId && ctx.routine);
}
// Exercise WMS's deployed enrichment using actual rows, without submitting rentals or creating admin sessions.
process.env.WMS_DB_PATH = '/home/configds/wms/server/data/db.sqlite3';
process.env.SM_SYNC = 'off';
const { attachPlannerRentalContexts } = await import('/home/configds/wms/server/lib/plannerRentalContext.js');
const enriched = await attachPlannerRentalContexts(rows.map((r) => ({ ...r, sheetType: 'general' })));
assert.equal(enriched.length, rows.length);
const matched = enriched.filter((r) => r.planner);
if (data.contexts.length) assert.ok(matched.length > 0);
const wmsResponse = await fetch('http://127.0.0.1:3000/api/gas', { redirect: 'manual', signal: AbortSignal.timeout(5000) });
assert.ok([200, 301, 302, 307, 308].includes(wmsResponse.status));
console.log(JSON.stringify({ plannerAuth: 'ok', wmsHealth: 'ok', activeRequests: rows.length, matchedRequests: matched.length,
  previews: matched.filter((r) => r.planner.nextRoutine).length }));
db.close();
