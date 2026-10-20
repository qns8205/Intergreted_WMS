import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
process.env.WMS_DB_PATH=':memory:';
const {db,run}=await import('../db.js');
const {requestLookupRouter,REQUEST_LOOKUP_PATH}=await import('./requestLookup.js');
const app=express();app.use(requestLookupRouter);
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base=`http://127.0.0.1:${server.address().port}${REQUEST_LOOKUP_PATH}/item-locations`;
const query=async(q,employeeId='1234')=>{
  const response=await fetch(base+'?'+new URLSearchParams({q,employeeId}));
  return {status:response.status,cache:response.headers.get('cache-control'),...await response.json()};
};
run("INSERT INTO registered_users(employee_id,name,active) VALUES('1234','Test',1),('5678','Inactive',0)");
run("INSERT INTO scenario_items(id,name,root_slot,image_path,is_storage,purchase_link,product_memo) VALUES('000001','테스트 컵','000120','/uploads/cup.jpg',NULL,'private-link','private-memo'),('000002','Plastic Cup (Small)','000121','https://outside.test/photo',NULL,'private-link','private-memo'),('000003','보관된 컵','000122',NULL,'Y',NULL,NULL),('000004','위치 없는 컵',NULL,NULL,NULL,NULL,NULL)");
run("INSERT INTO warehouse_items(name,location,image_path,archived,manager,note) VALUES('작업용 컵','A-02','/uploads/tool.jpg',NULL,'private-manager','private-note'),('폐기 컵','A-03',NULL,'Y',NULL,NULL)");

test('location lookup requires a valid active employee and a bounded name query',async()=>{
  for(const id of ['', '123','9999','5678'])assert.equal((await query('컵',id)).status,400);
  assert.equal((await query('')).status,400);
  assert.equal((await query('a'.repeat(81))).status,400);
});
test('name search returns scenario and COS locations without archived objects or private fields',async()=>{
  const result=await query('컵');assert.equal(result.status,200);assert.equal(result.cache,'no-store');
  assert.deepEqual(result.items.map(i=>i.name).sort(),['테스트 컵','위치 없는 컵','작업용 컵'].sort());
  assert.ok(result.items.some(i=>i.kind==='warehouse'&&i.location==='A-02'));
  assert.ok(result.items.some(i=>i.location==='000120'));
  for(const item of result.items)assert.deepEqual(Object.keys(item).sort(),['id','kind','name','location','image'].sort());
  assert.ok(!JSON.stringify(result).includes('private-'));
});
test('name matching supports case, spaces, multiword order and literal wildcard input',async()=>{
  assert.equal((await query('cup plastic')).items[0].name,'Plastic Cup (Small)');
  assert.equal((await query('PLASTICCUP')).items[0].location,'000121');
  assert.equal((await query('plastic')).items[0].image,'');
  assert.deepEqual((await query("' OR 1=1 --")).items,[]);
  assert.deepEqual((await query('%')).items,[]);
});
test('large match sets are limited and exact names are shown first',async()=>{
  for(let n=0;n<23;n++)run('INSERT INTO scenario_items(id,name,root_slot) VALUES(?,?,?)',[String(100+n).padStart(6,'0'),`테스트 컵 ${n}`,'000200']);
  const result=await query('테스트 컵');assert.equal(result.items.length,20);assert.equal(result.hasMore,true);
  assert.equal(result.items[0].name,'테스트 컵');
});
test.after(async()=>{await new Promise(r=>server.close(r));db.close();});
