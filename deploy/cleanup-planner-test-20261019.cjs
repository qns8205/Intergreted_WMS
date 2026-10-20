'use strict';
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {deleteUploadedCollection}=require('/home/configds/shoot-planner/server/planDeletion.cjs');
const db=new DatabaseSync('/home/configds/shoot-planner/data/planner.sqlite3');
try{
  const collection=db.prepare('SELECT id,name FROM upload_collections WHERE id=1').get();
  assert.equal(collection?.name,'Temp 261016','Test collection changed; inspect before deleting');
  const plans=db.prepare("SELECT id,title,shoot_date,collection_name FROM plans WHERE collection_id='xlsx:1' AND status!='deleted' ORDER BY id").all();
  assert.deepEqual(plans.map(p=>p.id),[1,2],'Linked plans changed; inspect before deleting');
  assert.deepEqual(plans.map(p=>p.shoot_date),['2026-10-16','2026-10-19']);
  for(const plan of plans){assert.equal(plan.collection_name,'Temp 261016');assert.ok(plan.title.startsWith('Temp 261016'));}
  const rentalCount=db.prepare('SELECT COUNT(*) n FROM plan_rentals').get().n;
  const progressCount=db.prepare('SELECT COUNT(*) n FROM plan_progress').get().n;
  const result=deleteUploadedCollection(db,1,{deletePlans:true});
  assert.equal(result.plans.length,2);
  assert.equal(db.prepare('SELECT deleted FROM upload_collections WHERE id=1').get().deleted,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM plans WHERE collection_id='xlsx:1' AND status!='deleted'").get().n,0);
  assert.ok(db.prepare('SELECT COUNT(*) n FROM plan_rentals').get().n>=rentalCount);
  assert.ok(db.prepare('SELECT COUNT(*) n FROM plan_progress').get().n>=progressCount);
  db.prepare('INSERT INTO history(action,detail,work_id,name,at) VALUES(?,?,?,?,?)').run('테스트 배포 항목 삭제','사용자 요청 · Temp 261016 컬렉션 및 연결 계획 1·2 삭제','','사용자 요청',new Date().toISOString());
  console.log(JSON.stringify({testCollection:'removed',linkedPlansRemoved:result.plans.length,rentalRowsRetained:rentalCount,progressRowsRetained:progressCount}));
}finally{db.close();}
