import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
process.env.WMS_DB_PATH = ':memory:';
process.env.SM_SYNC = 'off';
process.env.PLANNER_BRIDGE_KEY = 'test-bridge-key-0123456789abcdef';
const { run, get } = await import('../db.js');
const { attachPlannerRentalContexts } = await import('./plannerRentalContext.js');
let calls = 0, payload = [], fail = false;
const server = http.createServer((req, res) => {
  calls++;
  assert.equal(req.headers['x-planner-key'], process.env.PLANNER_BRIDGE_KEY);
  if (fail) { res.writeHead(503).end(); return; }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ contexts: payload }));
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
process.env.SHOOT_PLANNER_URL = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());
run("INSERT INTO scenario_items(id,name,stock,rented,root_slot) VALUES('000001','Apple',10,0,'000100')");
const item = (requestNo, employeeId = '1001') => ({ sheetType: 'general', requestNo, employeeId, quantity: 1 });
const context = (requestNo, extra = {}) => ({ requestNo, employeeId: '1001', planId: 1, collectionName: 'Collection', routine: 1,
  nextRoutine: { number: 2, shotCount: 3, rentalRefs: [], items: [{ id: '000001', name: 'Old name', quantity: 2, keptQuantity: 1 }] }, ...extra });

test('adds metadata without adding rows, changing rental totals, stock or matching another employee', async () => {
  payload = [context(101)];
  const input = [item(101), item(101, '1002'), { ...item(101), sheetType: 'scenario' }, item(999)];
  const output = await attachPlannerRentalContexts(input);
  assert.equal(output.length, input.length);
  assert.equal(output.reduce((n, i) => n + i.quantity, 0), 4);
  assert.equal(output[0].planner.collectionName, 'Collection');
  assert.deepEqual(output[0].planner.nextRoutine.items[0], { id: '000001', name: 'Apple', location: '000100', variantName: '', quantity: 2, keptQuantity: 1 });
  assert.ok(output.slice(1).every((i) => !i.planner));
  assert.equal(input[0].planner, undefined);
  assert.equal(get("SELECT stock FROM scenario_items WHERE id='000001'").stock, 10);
  const before = calls;
  await attachPlannerRentalContexts(input);
  assert.equal(calls, before);
});

test('reservation promotion maps to actual request even when planner request number is still zero', async () => {
  run("INSERT INTO item_reservations(id,employee_id,borrower_name,floor,unit,item_id,quantity,starts_at_ms,status,request_no,client_id,created_at_ms) VALUES(51,'1001','Kim','2F','Unit 1','000001',1,1,'fulfilled',201,'plan-test',1)");
  payload = [context(0, { reservationIds: [51] })];
  assert.equal((await attachPlannerRentalContexts([item(201)]))[0].planner.collectionName, 'Collection');
});

test('already requested, completed or reserved next routines are suppressed; cancelled requests can preview again', async () => {
  run("INSERT INTO general_rentals(request_no,employee_id,borrower_name,returned,return_source) VALUES(302,'1001','Kim','O',NULL),(304,'1001','Kim','O','cancel')");
  run("UPDATE item_reservations SET status='reserved' WHERE id=51");
  run("INSERT INTO item_reservations(id,employee_id,borrower_name,floor,unit,item_id,quantity,starts_at_ms,status,request_no,client_id,created_at_ms) VALUES(52,'1001','Kim','2F','Unit 1','000001',1,1,'fulfilled',304,'cancelled-promoted',1)");
  payload = [context(301), context(303), context(305)];
  payload[0].nextRoutine.rentalRefs = [{ requestNo: 302 }];
  payload[1].nextRoutine.rentalRefs = [{ requestNo: 304, reservationIds: [52] }];
  payload[2].nextRoutine.rentalRefs = [{ reservationIds: [51] }];
  const output = await attachPlannerRentalContexts([item(301), item(303), item(305)]);
  assert.equal(output[0].planner.nextRoutine, null);
  assert.equal(output[1].planner.nextRoutine.number, 2);
  assert.equal(output[2].planner.nextRoutine, null);
});

test('older routines retaining items never generate duplicate or outdated previews', async () => {
  payload = [context(401), context(402, { routine: 2, nextRoutine: { number: 3, shotCount: 1, items: [], rentalRefs: [] } })];
  const output = await attachPlannerRentalContexts([item(401), item(402)]);
  assert.equal(output[0].planner.nextRoutine, null);
  assert.equal(output[1].planner.nextRoutine.number, 3);
});

test('admin rental API receives contexts while borrower responses do not expose planner details', async (t) => {
  const { gasRouter } = await import('../routes/gas.js');
  const { issueAdminSession } = await import('./auth.js');
  run("INSERT INTO admin_users(id,login_id,password_hash,name) VALUES(500,'test-admin','unused','Test')");
  const token = issueAdminSession(500);
  run("INSERT INTO registered_users(employee_id,name,active) VALUES('1001','Kim',1)");
  run("INSERT INTO general_rentals(request_no,employee_id,borrower_name,item_id,item_label,qty,returned,status,category) VALUES(601,'1001','Kim','000001','Apple',1,'X','active','촬영 계획')");
  payload = [context(601)];
  const app = express();
  app.use('/api', gasRouter);
  const api = app.listen(0, '127.0.0.1');
  await new Promise((r) => api.once('listening', r));
  t.after(() => api.close());
  const url = `http://127.0.0.1:${api.address().port}/api/gas?action=getUnreturnedItems`;
  const admin = await (await fetch(url, { headers: { 'x-admin-token': token } })).json();
  assert.equal(admin.success, true);
  assert.equal(admin.items.find((i) => i.requestNo === 601).planner.collectionName, 'Collection');
  const borrower = await (await fetch(url)).json();
  assert.equal(borrower.success, true);
  assert.ok(borrower.items.every((i) => !i.planner));
});

test('real held rows receive return suggestions without adding rows or modifying their quantity',async()=>{
  payload=[context(701,{returnRules:[{number:1,keep:[{id:'000001',quantity:1,variantId:0}]}]})];
  const input=[{...item(701),itemId:'000001',pickedUp:'2026-10-19',quantity:3}];
  const result=await attachPlannerRentalContexts(input);
  assert.equal(result[0].plannerReturn.quantity,2);
  assert.equal(result[0].quantity,3);
  assert.equal(input[0].plannerReturn,undefined);
});

test('planner failure leaves real WMS rentals available and uses no stale preview', async () => {
  fail = true;
  const input = [item(501)];
  assert.deepEqual(await attachPlannerRentalContexts(input), input);
});
