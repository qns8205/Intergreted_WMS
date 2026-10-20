import assert from 'node:assert/strict';
process.env.WMS_DB_PATH=':memory:';
process.env.SM_SYNC='off';
process.env.TZ='Asia/Seoul';
const root='/home/configds/wms';
const {db,run,get}=await import(`${root}/server/db.js`);
const {applyRentalOverduePenalties}=await import(`${root}/server/lib/rentalOverduePenalties.js`);
const {rentalTypeLimitPolicy}=await import(`${root}/server/lib/rentalTypeLimitPolicy.js`);
const {rentalTermsForRow,convertRentalToGeneral}=await import(`${root}/server/lib/rentalTerms.js`);
const {kstTimestamp,validateRentalTerms}=await import(`${root}/shared/rentalTerms.js`);
const now=Date.now();
run("INSERT INTO settings(key,value) VALUES ('max_item_types_default','15')");
function loan(mode,hours=5){
  const q=Number(run('INSERT INTO rental_requests(borrower_name,employee_id,rental_mode,rental_reason,rental_due_date) VALUES (?,?,?,?,?)',['배포 검증','0000',mode,mode==='reason'?'검토 사유':'',mode==='long_term'?'2026-12-31':'']).lastInsertRowid);
  const id=Number(run("INSERT INTO general_rentals(borrower_name,employee_id,request_no,item_id,item_label,qty,picked_up_at,returned,status) VALUES ('배포 검증','0000',?,'000001','검증',1,?,'X','active')",[q,kstTimestamp(now-hours*3600000)]).lastInsertRowid);
  return {q,id};
}
loan('general');const reason=loan('reason',100);loan('long_term',100);loan('planner',100);loan(null,100);
assert.equal(applyRentalOverduePenalties(now).penalized,1);
assert.equal(applyRentalOverduePenalties(now).penalized,0);
assert.equal(rentalTypeLimitPolicy({name:'배포 검증'}).max,10);
assert.equal(get('SELECT expires_at FROM penalties').expires_at,kstTimestamp(now+48*3600000));
assert.throws(()=>validateRentalTerms({mode:'planner'}));
assert.equal(convertRentalToGeneral({admin:{name:'검증 관리자'},payload:{requestNo:reason.q,reason:'사유 불인정'}},now).changed,true);
assert.equal(rentalTermsForRow(get('SELECT * FROM general_rentals WHERE id=?',[reason.id])).deadlineAt,kstTimestamp(now+4*3600000));
assert.equal(applyRentalOverduePenalties(now).penalized,0);
assert.equal(convertRentalToGeneral({admin:{name:'검증 관리자'},payload:{requestNo:reason.q,reason:'재시도'}},now+3600000).changed,false);
db.close();
console.log(JSON.stringify({isolatedDatabase:true,overdueDeduction:'ok',idempotency:'ok',reasonAndLongTermExempt:'ok',plannerExempt:'ok',reviewGracePeriod:'ok'}));
