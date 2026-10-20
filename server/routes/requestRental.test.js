import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { fileURLToPath } from "node:url";

process.env.WMS_DB_PATH = ":memory:";
process.env.SM_SYNC = "off";
process.env.WMS_HTTPS_CONFIG = fileURLToPath(new URL("../fixtures/https-auth-test.json", import.meta.url));
const { db, run, all } = await import("../db.js");
const { createBorrowerAuthRouter } = await import("./borrowerAuth.js");
const { gasRouter } = await import("./gas.js");
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.socket.encrypted = true; next(); });
app.use("/api", createBorrowerAuthRouter({ verify: async () => ({ ok: true }) }));
app.use("/api", gasRouter);
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
run("INSERT INTO registered_users (employee_id,name,active) VALUES ('1234','Request 사용자',1)");
run("INSERT INTO scenario_items (id,name,stock,request) VALUES ('000001','Request Box',30,''),('000002','Normal Box',30,NULL)");
const login = await fetch(origin + "/api/borrower-auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeId: "1234", password: "test" }) });
const cookie = login.headers.get("set-cookie").split(";")[0];
const entry = { itemType: "general", borrowerName: "Request 사용자", employeeId: "1234", affiliation: "cfgw", borrowPurpose: "기존 목적", borrowedItems: [{ id: "000001", name: "Request Box", quantity: 1 }, { id: "000002", name: "Normal Box", quantity: 1 }] };
async function borrow(info) {
  const result = await (await fetch(origin + "/api/gas", { method: "POST", headers: { "Content-Type": "text/plain", Cookie: cookie }, body: JSON.stringify({ action: "recordBorrow", payload: { borrowList: [info] } }) })).json();
  return result;
}

test("Request 물품은 방식 선택 및 공백이 아닌 사유가 필요하다", async () => {
  assert.match((await borrow(entry)).message, /대여 방식을 선택/);
  assert.match((await borrow({ ...entry, requestRental: { mode: "request", reason: "   " } })).message, /사유를 입력/);
  assert.equal(all("SELECT * FROM general_rentals").length, 0);
});

test("Request 대여는 request 줄에만 한도 제외와 사유를 저장한다", async () => {
  assert.equal((await borrow({ ...entry, requestRental: { mode: "request", reason: "  업체 전달용  " } })).success, true);
  const rows = all("SELECT * FROM general_rentals ORDER BY id");
  assert.equal(rows[0].type_limit_exempt, "Y");
  assert.equal(rows[0].type_limit_exempt_reason, "업체 전달용");
  assert.equal(rows[0].purpose, "업체 전달용");
  assert.equal(rows[1].type_limit_exempt, null);
  assert.equal(rows[1].purpose, "기존 목적");
  const active = await (await fetch(origin + "/api/gas?action=getActiveItemTypeCount&employeeId=1234", { headers: { Cookie: cookie } })).json();
  assert.equal(active.success, true);
  assert.equal(active.count, 1);
  assert.deepEqual(active.items.map((item) => item.id), ["000002"]);
});

test("일반 대여는 request 물품도 한도에서 제외하지 않는다", async () => {
  assert.equal((await borrow({ ...entry, requestRental: { mode: "general", reason: "" } })).success, true);
  const rows = all("SELECT * FROM general_rentals ORDER BY id DESC LIMIT 2");
  assert.ok(rows.every((row) => row.type_limit_exempt === null && row.type_limit_exempt_reason === null));
});

test("시나리오 필요 물품과 추가 request 물품에도 같은 사유를 저장한다", async () => {
  run("INSERT INTO scenarios (sid) VALUES ('S1')");
  const result = await borrow({ ...entry, itemType: "scenario", borrowedItems: undefined, scenarioId: "S1", requiredObjects: [entry.borrowedItems[0]], additionalItems: [entry.borrowedItems[0]], requestRental: { mode: "request", reason: "시나리오 업체 요청" } });
  assert.equal(result.success, true);
  assert.equal(all("SELECT type_limit_exempt, type_limit_exempt_reason FROM sid_rentals")[0].type_limit_exempt, "Y");
  const last = all("SELECT * FROM general_rentals ORDER BY id DESC LIMIT 1")[0];
  assert.equal(last.type_limit_exempt_reason, "시나리오 업체 요청");
});

test('장기대여 예정일·사유가 관리자 미반납 목록과 본인 내역에 유지된다',async()=>{
  const dueDate=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
  const result=await borrow({...entry,requestRental:{mode:'request',reason:'프로젝트 사용'},rentalTerms:{mode:'long_term',reason:'프로젝트 사용',dueDate}});
  assert.equal(result.success,true,result.message);
  const request=all('SELECT * FROM rental_requests WHERE id=?',[result.requestNo])[0];
  assert.equal(request.rental_mode,'long_term');assert.equal(request.rental_due_date,dueDate);
  const mine=await(await fetch(origin+'/api/gas?action=getMyBorrowedItems&employeeId=1234',{headers:{Cookie:cookie}})).json();
  const rows=mine.items.filter(item=>item.requestNo===result.requestNo);
  assert.equal(rows.length,2);
  assert.ok(rows.every(row=>row.rentalTerms.mode==='long_term' && row.rentalTerms.dueDate===dueDate && row.rentalTerms.reason==='프로젝트 사용'));
});
test('일반 신청에서 Planner 면제를 위조하거나 사유·날짜를 생략할 수 없다',async()=>{
  const base={...entry,requestRental:{mode:'general'}};
  for(const terms of [{mode:'planner'},{mode:'reason',reason:' '},{mode:'long_term',reason:'사용',dueDate:'2026-02-30'}]) {
    assert.equal((await borrow({...base,rentalTerms:terms})).success,false);
  }
});
test('장기대여 예약이 자동 전환되어도 사유와 예정일이 모든 물품에 유지된다',async()=>{
  const {createReservations}=await import('../lib/itemReservations.js');
  const {promoteDueReservations}=await import('../lib/reservationPromotion.js');
  const {recordBorrow}=await import('./gas.js');
  const dueDate=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
  const terms={mode:'long_term',reason:'장기 실험',dueDate};
  const {ids}=createReservations('1234',{floor:'2F',unit:'Unit 1',clientId:'long-term-policy-test',startsAt:new Date(Math.ceil((Date.now()+2*60000)/60000)*60000).toISOString(),items:entry.borrowedItems,rentalTerms:terms});
  await promoteDueReservations(recordBorrow);
  const stored=all('SELECT * FROM item_reservations WHERE id=?',[ids[0]])[0];
  assert.equal(stored.status,'fulfilled');
  const request=all('SELECT * FROM rental_requests WHERE id=?',[stored.request_no])[0];
  assert.equal(request.rental_mode,terms.mode);assert.equal(request.rental_due_date,dueDate);assert.equal(request.rental_reason,terms.reason);
});
test('대여자는 사유 검토와 일반 대여 전환 API를 호출할 수 없다',async()=>{
  const result=await(await fetch(origin+'/api/gas',{method:'POST',headers:{'Content-Type':'text/plain',Cookie:cookie},body:JSON.stringify({action:'convertRentalToGeneral',payload:{requestNo:1,reason:'불인정'}})})).json();
  assert.equal(result.success,false);
});
test.after(async () => { await new Promise((resolve) => server.close(resolve)); db.close(); });
