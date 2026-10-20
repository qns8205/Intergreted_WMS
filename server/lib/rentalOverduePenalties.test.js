import test from 'node:test';
import assert from 'node:assert/strict';
process.env.WMS_DB_PATH=':memory:';
process.env.TZ='Asia/Seoul';
const {db,run,get}=await import('../db.js');
const {applyRentalOverduePenalties}=await import('./rentalOverduePenalties.js');
const {rentalTypeLimitPolicy}=await import('./rentalTypeLimitPolicy.js');
const {rentalTermsForRow,convertRentalToGeneral,convertRentalToReason}=await import('./rentalTerms.js');
const {penaltyDetails,applyUnattendedOverduePenalties}=await import('./unattendedPenalties.js');
const {validateRentalTerms,kstTimestamp}=await import('../../shared/rentalTerms.js');
const realNow=Date.now;
let now=Date.parse('2026-10-19T22:00:00+09:00');
const HOUR=3600000;
test.beforeEach(()=>{
  now=Date.parse('2026-10-19T22:00:00+09:00'); Date.now=()=>now;
  for(const t of ['rental_terms_reviews','rental_overdue_events','penalties','penalty_links','unattended_operations','rental_requests','sid_rentals','general_rentals','settings']) db.exec(`DELETE FROM ${t}`);
  run("INSERT INTO settings(key,value) VALUES ('max_item_types_default','15')");
});
test.after(()=>{Date.now=realNow;db.close();});
function request(mode='general') {
  return Number(run('INSERT INTO rental_requests(borrower_name,employee_id,rental_mode,rental_reason,rental_due_date) VALUES (?,?,?,?,?)',['테스트','1234',mode,mode==='reason'?'사유':'',mode==='long_term'?'2026-10-25':'']).lastInsertRowid);
}
function loan(q,{hours=5,returnedHours,source='',table='general_rentals',picked=true}={}) {
  const pickup=picked?kstTimestamp(now-hours*HOUR):null;
  const end=returnedHours==null?null:kstTimestamp(now-returnedHours*HOUR);
  return Number(run(`INSERT INTO ${table}(borrower_name,employee_id,request_no,picked_up_at,returned,return_date,return_source,status,item_label) VALUES (?,?,?,?,?,?,?,?,?)`,['테스트','1234',q,pickup,end?'O':'X',end,source,end?'archived':'active','박스']).lastInsertRowid);
}
test('4시간 경계 전후와 신청당 한 번: SID·일반·부분 반납 행이 여러 개여도 한 번 차감',()=>{
  const q=request();loan(q,{hours:4});assert.equal(applyRentalOverduePenalties().penalized,0);
  now+=1000;loan(q,{hours:5,table:'sid_rentals'});loan(q,{hours:6});
  assert.equal(applyRentalOverduePenalties().penalized,1);
  assert.equal(applyRentalOverduePenalties().penalized,0);
  assert.equal(rentalTypeLimitPolicy({name:'테스트'}).max,10);
  assert.equal(get('SELECT COUNT(*) n FROM penalties').n,1);
  assert.equal(get('SELECT expires_at FROM penalties').expires_at,kstTimestamp(now+48*HOUR));
  const details=penaltyDetails(get('SELECT id FROM penalties').id);
  assert.equal(details.events[0].eventType,'rental_return_overdue_4h');
  assert.ok(details.events[0].items.some(item=>item.missed));
});
test('사유·장기·Planner·기존 대여·미수령·취소는 새 차감에서 제외',()=>{
  for(const mode of ['reason','long_term','planner',null])loan(request(mode),{hours:100});
  loan(request(),{picked:false});loan(request(),{source:'cancel'});
  assert.equal(applyRentalOverduePenalties().penalized,0);
});
test('기한 내 반납은 제외하고 점검 사이 늦게 반납한 건도 한 번 기록',()=>{
  loan(request(),{hours:6,returnedHours:3}); // 3시간 사용
  const q=request();loan(q,{hours:6,returnedHours:1}); // 5시간 사용
  assert.equal(applyRentalOverduePenalties().penalized,1);
  assert.equal(get('SELECT request_no FROM rental_overdue_events').request_no,q);
});
test('서로 다른 신청의 48시간 차감은 독립적으로 만료하고 다시 차감하지 않는다',()=>{
  loan(request());applyRentalOverduePenalties();
  now+=HOUR;loan(request());applyRentalOverduePenalties();
  assert.equal(rentalTypeLimitPolicy({name:'테스트'}).max,5);
  now+=47*HOUR;assert.equal(rentalTypeLimitPolicy({name:'테스트'}).max,10);
  now+=HOUR;assert.equal(rentalTypeLimitPolicy({name:'테스트'}).max,15);
  assert.equal(applyRentalOverduePenalties().penalized,0);
});
test('기존 관리자 페널티와 합산하고 0 미만으로 차감하지 않는다',()=>{
  run("INSERT INTO penalties(name,max_types,expires_at) VALUES ('테스트',7,?)",[kstTimestamp(now+72*HOUR)]);
  loan(request());loan(request());applyRentalOverduePenalties();
  assert.equal(rentalTypeLimitPolicy({name:'테스트'}).max,0);
  now+=48*HOUR;assert.equal(rentalTypeLimitPolicy({name:'테스트'}).max,7);
});
test('예정일·사유 검증과 Planner 위조 차단, 수령 전후의 기한 표시',()=>{
  assert.throws(()=>validateRentalTerms({mode:'reason',reason:' '}),/사유/);
  for(const dueDate of ['2026-02-30','2026-10-18','bad'])assert.throws(()=>validateRentalTerms({mode:'long_term',reason:'장기',dueDate}),/예정일/);
  assert.throws(()=>validateRentalTerms({mode:'planner'}),/방식/);
  assert.equal(validateRentalTerms(undefined,{planner:true}).mode,'planner');
  assert.deepEqual(validateRentalTerms({mode:'long_term',reason:' 장기 ',dueDate:'2026-10-25'}),{mode:'long_term',reason:'장기',dueDate:'2026-10-25'});
  const q=request();assert.equal(rentalTermsForRow({request_no:q}).deadlineAt,'');
  assert.equal(rentalTermsForRow({request_no:q,picked_up_at:'2026-10-19 10:00:00'}).deadlineAt,'2026-10-19 15:00:00');
});
test('새 정책의 신청과 과거 Planner 대여에는 기존 무인 24시간 페널티를 중복 부과하지 않는다',()=>{
  run("INSERT INTO settings(key,value) VALUES ('unattended_enabled','1')");
  for(const mode of ['general','reason','long_term','planner'])loan(request(mode),{hours:30});
  const legacy=loan(request(null),{hours:30});run("UPDATE general_rentals SET category='촬영 계획' WHERE id=?",[legacy]);
  assert.equal(applyUnattendedOverduePenalties().penalized,0);
});
test('사유 부적절 일반 전환은 변경 시점부터 4시간을 주고 기존 사유와 검토 이력을 보존',()=>{
  const q=request('reason');const id=loan(q,{hours:24});
  const ended=loan(q,{hours:30,returnedHours:2});
  run("UPDATE general_rentals SET type_limit_exempt='Y',type_limit_exempt_reason='사유' WHERE id=?",[id]);
  const args={admin:{name:'관리자'},payload:{requestNo:q,reason:'단순 보관은 면제 사유가 아님'}};
  assert.equal(convertRentalToGeneral(args).changed,true);
  assert.equal(get('SELECT rental_mode FROM rental_requests WHERE id=?',[q]).rental_mode,'general');
  assert.equal(get('SELECT type_limit_exempt FROM general_rentals WHERE id=?',[id]).type_limit_exempt,null);
  const audit=get('SELECT * FROM rental_terms_reviews WHERE request_no=?',[q]);
  assert.equal(audit.previous_reason,'사유');assert.equal(audit.reviewed_by,'관리자');
  assert.equal(rentalTermsForRow(get('SELECT * FROM general_rentals WHERE id=?',[id])).deadlineAt,kstTimestamp(now+4*HOUR));
  assert.equal(applyRentalOverduePenalties().penalized,0);
  now+=HOUR;assert.equal(convertRentalToGeneral(args).changed,false);
  now+=3*HOUR;assert.equal(applyRentalOverduePenalties().penalized,0);
  now+=1000;assert.equal(applyRentalOverduePenalties().penalized,1);
  const details=penaltyDetails(get('SELECT id FROM penalties').id);
  assert.equal(details.events[0].items.find(item=>item.rowId===ended).missed,false);
});
test('장기대여 일반 전환 후 미수령 물품의 기한은 실제 수령 시각부터 계산',()=>{
  const q=request('long_term'),id=loan(q,{picked:false});
  convertRentalToGeneral({admin:{name:'관리자'},payload:{requestNo:q,reason:'기간 불인정'}});
  assert.equal(get('SELECT rental_due_date FROM rental_requests WHERE id=?',[q]).rental_due_date,null);
  now+=2*HOUR;run('UPDATE general_rentals SET picked_up_at=? WHERE id=?',[kstTimestamp(now),id]);
  assert.equal(rentalTermsForRow(get('SELECT * FROM general_rentals WHERE id=?',[id])).deadlineAt,kstTimestamp(now+4*HOUR));
});
test('관리자 외 변경·빈 검토 사유·Planner 및 종료된 신청 변경은 거부',()=>{
  const q=request('reason');loan(q);
  assert.throws(()=>convertRentalToGeneral({payload:{requestNo:q,reason:'불인정'}}),/관리자/);
  assert.throws(()=>convertRentalToGeneral({admin:{name:'관리자'},payload:{requestNo:q,reason:' '}}),/사유/);
  const planner=request('planner');loan(planner);
  assert.throws(()=>convertRentalToGeneral({admin:{name:'관리자'},payload:{requestNo:planner,reason:'불인정'}}),/사유 대여와 장기대여만/);
  const closed=request('reason');loan(closed,{returnedHours:1});
  assert.throws(()=>convertRentalToGeneral({admin:{name:'관리자'},payload:{requestNo:closed,reason:'불인정'}}),/종료/);
});
test('일반 대여를 사유 대여로 바꾸면 4시간 제한이 사라지고, 다시 일반으로 바꿀 수도 있다',()=>{
  const q=request('general');loan(q,{hours:3});
  const admin={name:'관리자'};
  assert.throws(()=>convertRentalToReason({admin,payload:{requestNo:q,reason:''}}));
  assert.equal(convertRentalToReason({admin,payload:{requestNo:q,reason:'KTL'}}).changed,true);
  assert.deepEqual({...get('SELECT rental_mode,rental_reason FROM rental_requests WHERE id=?',[q])},{rental_mode:'reason',rental_reason:'KTL'});
  now+=2*HOUR;assert.equal(applyRentalOverduePenalties().penalized,0);
  assert.throws(()=>convertRentalToReason({admin,payload:{requestNo:q,reason:'KTL'}}),/일반 대여만/);
  convertRentalToGeneral({admin,payload:{requestNo:q,reason:'불인정'}});
  convertRentalToReason({admin,payload:{requestNo:q,reason:'재인정'}});
  assert.equal(convertRentalToGeneral({admin,payload:{requestNo:q,reason:'다시 불인정'}}).changed,true);
});
test('점심시간(12:00~13:00)은 4시간 기한에서 빠진다',async()=>{
  const {rentalDeadlineMs}=await import('../../shared/rentalTerms.js');
  const at=(pickup)=>kstTimestamp(rentalDeadlineMs(pickup));
  assert.equal(at('2026-10-20 08:00:00'),'2026-10-20 12:00:00');
  assert.equal(at('2026-10-20 10:00:00'),'2026-10-20 15:00:00');
  assert.equal(at('2026-10-20 12:30:00'),'2026-10-20 17:00:00');
  assert.equal(at('2026-10-20 13:00:00'),'2026-10-20 17:00:00');
  assert.equal(at('2026-10-20 22:00:00'),'2026-10-21 02:00:00');
  // 10:00 수령은 14:30에 아직 기한 전이고, 15:00이 지나야 차감된다.
  now=Date.parse('2026-10-20T14:30:00+09:00');
  const q=request();loan(q,{hours:4.5});
  assert.equal(applyRentalOverduePenalties().penalized,0);
  now=Date.parse('2026-10-20T15:00:01+09:00');
  assert.equal(applyRentalOverduePenalties().penalized,1);
});
test('반납 타이머의 남은 시간은 점심시간 동안 줄지 않는다',async()=>{
  const {rentalTimeLeftMs,isRentalLunchBreak,rentalTimeMs}=await import('../../shared/rentalTerms.js');
  const deadline=rentalTimeMs('2026-10-20 15:00:00'),left=(t)=>rentalTimeLeftMs(rentalTimeMs('2026-10-20 '+t),deadline)/1000;
  assert.equal(left('10:00:00'),4*3600);
  assert.equal(left('12:00:00'),2*3600);assert.equal(left('12:59:59'),2*3600);assert.equal(left('13:00:01'),2*3600-1);
  assert.equal(left('15:10:00'),-600);
  assert.equal(isRentalLunchBreak(rentalTimeMs('2026-10-20 12:30:00')),true);
  assert.equal(isRentalLunchBreak(rentalTimeMs('2026-10-20 13:00:00')),false);
});
