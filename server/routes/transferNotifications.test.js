import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
process.env.WMS_DB_PATH = ':memory:';
const { db, run, get } = await import('../db.js');
const { notificationsRouter } = await import('./notifications.js');
const { issueAdminSession } = await import('../lib/auth.js');
const { transferItems } = await import('../lib/borrowerTransfer.js');
for (const id of [1,2]) run("INSERT INTO admin_users (id,login_id,name,password_hash) VALUES (?,?,?,'unused')",[id,`admin${id}`,`관리자${id}`]);
const tokens = [issueAdminSession(1), issueAdminSession(2)];
const app = express(); app.use(express.json()); app.use('/api',notificationsRouter);
const server = app.listen(0,'127.0.0.1');
await new Promise(resolve => server.once('listening',resolve));
const base = `http://127.0.0.1:${server.address().port}/api/admin/transfer-notifications`;
async function request(path='', admin=0, ids) {
  const response = await fetch(base+path,{method:ids?'POST':'GET',headers:{'x-admin-token':tokens[admin] || '', 'Content-Type':'application/json'},...(ids?{body:JSON.stringify({ids})}:{})});
  return response.json();
}
test('양도 알림은 성공한 작업만 저장하고 누구든 확인하면 모든 관리자에게 확인 완료로 표시한다',async () => {
  run("INSERT INTO registered_users (employee_id,name,active) VALUES ('1111','주는사람',1),('2222','받는사람',1)");
  run("INSERT INTO scenario_items (id,name,stock,rented) VALUES ('000001','Scanner',5,3)");
  run("INSERT INTO general_rentals (id,borrower_name,employee_id,item_id,item_label,qty,returned,status,picked_up_at) VALUES (1,'주는사람','1111','000001','Scanner',3,'X','active','2026-10-16 10:00:00')");
  const payload = {fromEmployeeId:'1111',toEmployeeId:'2222',items:[{key:'general:1',quantity:2}],floor:'B1',unit:'Unit 5',rentalTerms:{mode:'general'}};
  assert.throws(()=>transferItems({...payload,checkTypeLimit:()=>{throw Error('한도');}}),/한도/);
  assert.equal(get('SELECT COUNT(*) AS n FROM transfer_notifications').n,0);
  transferItems(payload);
  const entries = (await request()).entries;
  assert.equal(entries.length,1);
  assert.equal(entries[0].fromName,'주는사람');
  assert.equal(entries[0].toEmployeeId,'2222');
  assert.equal(entries[0].items[0].quantity,2);
  assert.equal(entries[0].read,false);
  assert.equal((await request('/count')).unread,1);
  assert.equal((await request('',9)).success,false);
  assert.equal((await request('/read',9,[entries[0].id])).success,false);
  await request('/read',0,[entries[0].id,entries[0].id,-1,'oops']);
  assert.equal((await request('/count')).unread,0);
  assert.equal((await request('/count',1)).unread,0);
  assert.equal((await request()).entries[0].read,true);
  assert.equal((await request('',1)).entries[0].read,true);
  assert.equal(get("SELECT COUNT(*) AS n FROM admin_notification_reads WHERE admin_id=2 AND notif_key=?",[`transfer:${entries[0].id}`]).n,0);
  // 확인한 사람의 기록을 복제하지 않아도 나중에 생성한 관리자에게 동일하게 적용된다.
  run("INSERT INTO admin_users (id,login_id,name,password_hash) VALUES (3,'admin3','관리자3','unused')");
  tokens.push(issueAdminSession(3));
  assert.equal((await request('/count',2)).unread,0);
  assert.equal((await request('',2)).entries[0].read,true);
  await request('/read',1,[entries[0].id]);
  assert.equal((await request('/count',0)).unread,0);
  // 목록을 조회한 뒤 도착한 새 알림은 이전 목록의 읽음 처리에 포함되지 않는다.
  for(let n=0;n<101;n++) run("INSERT INTO transfer_notifications (occurred_at,from_employee_id,from_name,to_employee_id,to_name,items_json) VALUES ('2026-10-16','1111','주는사람','2222','받는사람','[]')");
  await request('/read',0,[entries[0].id]);
  assert.equal((await request('/count')).unread,101);
  assert.equal((await request('/count',1)).unread,101);
  const page1=await request(); const page2=await request(`?before=${page1.nextBefore}`);
  assert.equal(page1.entries.length,100);
  assert.equal(page2.entries.length,2);
  assert.equal(page2.nextBefore,null);
  assert.equal(new Set([...page1.entries,...page2.entries].map(e=>e.id)).size,102);
  // 다른 관리자가 목록의 일부를 확인해도 나중에 도착한 알림은 계속 미확인으로 남는다.
  await request('/read',1,[page1.entries[0].id]);
  assert.equal((await request('/count',0)).unread,100);
  assert.equal((await request('/count',2)).unread,100);
  assert.equal((await request('',0)).entries[0].read,true);
});
test.after(async()=>{await new Promise(resolve=>server.close(resolve)); db.close();});
