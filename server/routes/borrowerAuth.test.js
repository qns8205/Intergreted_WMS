import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { fileURLToPath } from "node:url";

process.env.WMS_DB_PATH = ":memory:";
process.env.WMS_HTTPS_CONFIG = fileURLToPath(new URL("../fixtures/https-auth-test.json", import.meta.url));
const { db, run, all } = await import("../db.js");
const { createBorrowerAuthRouter } = await import("./borrowerAuth.js");
const { gasRouter } = await import("./gas.js");
const { requireBorrowerIdentity } = await import("../lib/borrowerAuth.js");
const app = express();
app.use(express.json());
// TLS가 끝난 요청/일반 HTTP 요청을 단위 테스트 안에서만 시뮬레이션한다.
app.use((req, _res, next) => { req.socket.encrypted = req.headers['x-test-tls'] === '1'; next(); });
app.use('/api', createBorrowerAuthRouter({ verify: async (_id, password) => password === 'outage' ? { ok:false,unavailable:true } : { ok:password === 'test-only-password' } }));
app.use('/api', gasRouter);
const server = app.listen(0,'127.0.0.1');
await new Promise((resolve)=>server.once('listening',resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const request = (path, body, cookie = '', secure = true) => fetch(origin + path, {
  method: body ? 'POST' : 'GET', headers: { 'Content-Type':'application/json', ...(secure ? {'x-test-tls':'1'} : {}), ...(cookie ? {Cookie:cookie} : {}) },
  body: body ? JSON.stringify(body) : undefined,
});
let cookie = '';

test('HTTP·가짜 HTTPS 헤더·SM 실패·장애는 세션을 발급하지 않는다', async () => {
  run("INSERT INTO registered_users (employee_id,name,active) VALUES ('1234','인증 사용자',1),('5678','다른 사용자',1)");
  const body={employeeId:'1234',password:'test-only-password'};
  assert.equal((await request('/api/borrower-auth/login',body,'',false)).status,426);
  const spoofed = await fetch(origin + '/api/borrower-auth/login',{method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-Proto':'https'},body:JSON.stringify(body)});
  assert.equal(spoofed.status,426);
  assert.equal((await request('/api/borrower-auth/login',{employeeId:'1234',password:'wrong'})).status,401);
  assert.equal((await request('/api/borrower-auth/login',{employeeId:'1234',password:'outage'})).status,503);
  assert.equal(all('SELECT * FROM borrower_sessions').length,0);
});

test('인증 성공 시 비밀번호 대신 해시 토큰만 저장하고 HttpOnly·Secure·SameSite 쿠키를 발급한다', async () => {
  const response=await request('/api/borrower-auth/login',{employeeId:'1234',password:'test-only-password'});
  assert.equal(response.status,200);
  const header=response.headers.get('set-cookie');
  assert.ok(header.includes('HttpOnly') && header.includes('Secure') && header.includes('SameSite=Strict') && !header.includes('Max-Age'));
  cookie=header.split(';')[0];
  const row=all('SELECT * FROM borrower_sessions')[0];
  assert.ok(!JSON.stringify(row).includes('test-only-password') && !JSON.stringify(row).includes(cookie.split('=')[1]));
  const session=await (await request('/api/borrower-auth/session',undefined,cookie)).json();
  assert.equal(session.user.employeeId,'1234');
  const insecureSession=await (await request('/api/borrower-auth/session',undefined,cookie,false)).json();
  assert.equal(insecureSession.user,null);
});

test('화면 우회·다른 사번·다른 사람 반납·CSRF를 거부하고 본인 조회를 허용한다', async () => {
  run("INSERT INTO scenario_items (id,name,stock) VALUES ('000001','Box',3)");
  const mine=run("INSERT INTO general_rentals (employee_id,borrower_name,item_id,item_label,qty,returned) VALUES ('1234','인증 사용자','000001','Box',1,'X')").lastInsertRowid;
  const theirs=run("INSERT INTO general_rentals (employee_id,borrower_name,item_id,item_label,qty,returned) VALUES ('5678','다른 사용자','000001','Box',1,'X')").lastInsertRowid;
  const anonymous=await (await request('/api/gas?action=getMyBorrowedItems&name=test&employeeId=1234')).json();
  assert.equal(anonymous.success,false);
  const foreign=await (await request('/api/gas?action=getMyBorrowedItems&name=test&employeeId=5678',undefined,cookie)).json();
  assert.equal(foreign.success,false);
  const mineResult=await (await request('/api/gas?action=getMyBorrowedItems&name=test&employeeId=1234',undefined,cookie)).json();
  assert.equal(mineResult.success,true);
  assert.equal(mineResult.items.length,1);
  assert.equal(mineResult.items[0].rowIndex,Number(mine));
  const returned=await (await request('/api/gas',{action:'processReturn',payload:{returnRequests:[{sheetType:'general',rowIndex:Number(theirs),quantity:1}]}},cookie)).json();
  assert.equal(returned.success,false);
  assert.equal(all('SELECT returned FROM general_rentals WHERE id=?',[theirs])[0].returned,'X');
  const anonymousPost=await (await request('/api/gas',{action:'recordBorrow',payload:{borrowList:[]}})).json();
  assert.equal(anonymousPost.success,false);
  assert.throws(()=>requireBorrowerIdentity({headers:{cookie,origin:'https://attacker.invalid',host:'wms.invalid'}},{}),/다른 사이트/);
});

test('로그아웃과 4시간 미사용 세션은 재사용할 수 없다', async () => {
  await request('/api/borrower-auth/logout',{},cookie);
  assert.equal((await (await request('/api/borrower-auth/session',undefined,cookie)).json()).user,null);
  const response=await request('/api/borrower-auth/login',{employeeId:'1234',password:'test-only-password'});
  cookie=response.headers.get('set-cookie').split(';')[0];
  run('UPDATE borrower_sessions SET last_seen_ms=?',[Date.now()-4*60*60*1000-1]);
  assert.equal((await (await request('/api/borrower-auth/session',undefined,cookie)).json()).user,null);
});

test('로그인 전에는 최근 공개 공지 팝업만 조회하고 관리자 편집기와 개인 정보는 차단한다', async () => {
  run("INSERT INTO notices (title,content,created_at) VALUES ('공개 공지','로그인 입력 전에 표시',datetime('now','+9 hours'))");
  const notice = await (await request('/api/gas?action=getNoticePopup')).json();
  assert.equal(notice.success, true);
  assert.equal(notice.items.length, 1);
  assert.equal(notice.items[0].text, '로그인 입력 전에 표시');
  const editor = await (await request('/api/gas?action=getNoticesForEditor')).json();
  assert.equal(editor.success, false);
  const person = await (await request('/api/gas?action=getRegisteredUser&employeeId=1234')).json();
  assert.equal(person.success, false);
});

test.after(async () => { await new Promise((resolve)=>server.close(resolve)); db.close(); });
