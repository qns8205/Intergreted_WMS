import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregateHumanRequests,filterHumanAuditDates} from './human-unit-rental-audit.mjs';
const base={source:'sid_rentals',id:1,borrower_name:'테스트',employee_id:'1111',floor:'2F',unit:'Human Unit 1',applied_at:'2026-10-07 10:00:00',request_no:10,picked_up_at:'2026-10-07 10:01:00',item_label:'[000045] Cup x 3'};
test('8~10월은 신청일 기준 8/1 포함·11/1 제외, 반납일 기준으로 옮기지 않음',()=>{
  const rows=[{...base,id:1,applied_at:'2026-07-31 23:59:59',return_date:'2026-08-01'},
    {...base,id:2,applied_at:'2026-08-01 00:00:00'}, {...base,id:3,applied_at:'2026-10-31 23:59:59'},
    {...base,id:4,applied_at:'2026-11-01 00:00:00'}, {...base,id:5,applied_at:'',borrow_date:'8/1/2026 12:00:00'}];
  assert.deepEqual(filterHumanAuditDates(rows,{from:'2026-08-01',toExclusive:'2026-11-01'}).map(row=>row.id),[2,3,5]);
  assert.equal(filterHumanAuditDates(rows).length,5);
});
test('신청·부분 반납·종류 행은 한 건/한 물품 ID로 묶고 수량만 합산',()=>{
  const result=aggregateHumanRequests([{...base,item_label:'[000045] Cup x 2'},
    {...base,id:2,picked_up_at:null,returned:'O',return_source:'admin',item_label:'[000045] Cup x 1'},
    {...base,source:'general_rentals',id:3,item_id:'45',qty:4,item_label:'Cup'},
    {...base,id:4,item_label:'[000046] Toy x 1'}]);
  assert.equal(result.overall.requests,1);assert.equal(result.overall.avgTypes,2);assert.equal(result.overall.avgQuantity,8);
});
test('취소·교체된 원래 물품·미수령은 제외하며 다른 사람은 구분, 좌석 이동은 같은 신청으로 유지',()=>{
  const result=aggregateHumanRequests([base,{...base,id:2,return_source:'cancel'},
    {...base,id:3,return_source:'swap'}, {...base,id:4,picked_up_at:null},
    {...base,id:5,employee_id:'2222'}, {...base,id:6,unit:'Human Unit 2'}]);
  assert.equal(result.overall.requests,2);assert.equal(result.people.length,2);
  assert.equal(result.people[0].units.length,2);
  assert.deepEqual(result.excluded,{cancel:1,swap:1,unconfirmed:1,invalidItem:0});
});
test('옛 SID/일반 대여의 서로 다른 batch는 같은 신청 시각으로 합치되 날짜만 있는 것은 합치지 않음',()=>{
  const result=aggregateHumanRequests([{...base,request_no:null,batch_id:'sid'},
    {...base,id:2,request_no:null,batch_id:'general',source:'general_rentals',item_id:'46',qty:1},
    {...base,id:3,request_no:null,applied_at:'',borrow_date:'2026-07-23',batch_id:'a'},
    {...base,id:4,request_no:null,applied_at:'',borrow_date:'2026-07-23',batch_id:'b'}]);
  assert.equal(result.overall.requests,3);assert.equal(result.overall.maxTypes,2);
});
