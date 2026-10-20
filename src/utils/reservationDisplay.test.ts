import test from "node:test";
import assert from "node:assert/strict";
import { filterReservations, groupReservationBorrowers, reservationTime, reservationBadgesForItem, isReservationDue } from "./reservationDisplay.ts";
import type { AdminItemReservation } from "./borrowApi";
const make = (patch: Partial<AdminItemReservation>): AdminItemReservation => ({id:1,employeeId:"1234",borrowerName:"테스트 사용자",itemId:"000001",itemName:"박스",variantName:"빨강",quantity:2,floor:"B1",unit:"Human Unit 7",image:"",startsAt:"2026-10-13T15:00:00+09:00",createdAt:"2026-10-13T09:00:00+09:00",stock:3,available:true,mine:false,status:"reserved",...patch});
test("재고가 있으면 예약 수량·소유자와 무관하게 목록의 예약 시각 문구를 숨긴다",()=>{
  const rows=[make({quantity:99}),make({id:2,mine:true})];
  assert.deepEqual(reservationBadgesForItem("000001",1,rows),[]);
  assert.deepEqual(reservationBadgesForItem("000001",5,rows),[]);
});
test("재고가 없을 때는 해당 물품의 예약만 표시하고 재고 회복·취소 시 사라진다",()=>{
  const rows=[make({}),make({id:2,mine:true}),make({id:3,itemId:"000002"})];
  const snapshot=JSON.stringify(rows);
  assert.deepEqual(reservationBadgesForItem("000001",0,rows).map(row=>row.id),[1,2]);
  assert.deepEqual(reservationBadgesForItem("000001",2,rows),[]);
  assert.deepEqual(reservationBadgesForItem("000001",0,[]),[]);
  assert.equal(JSON.stringify(rows),snapshot);
});
test("동명이인은 사번으로 분리하고 종류·수량과 예정 시각별 물품을 묶는다",()=>{
  const rows=[make({id:3,startsAt:"2026-10-14T01:00:00+09:00",itemId:"000002",quantity:1}),make({id:2,employeeId:"5678"}),make({}),make({id:4,variantName:"파랑",quantity:3})];
  const snapshot=JSON.stringify(rows);
  const groups=groupReservationBorrowers(rows);
  assert.deepEqual(groups.map(group=>group.employeeId),["1234","5678"]);
  assert.equal(groups[0].types,2);assert.equal(groups[0].quantity,6);
  assert.deepEqual(groups[0].times.map(group=>group.items.length),[2,1]);
  assert.equal(JSON.stringify(rows),snapshot);
});
test("예약 시각 전·도래를 나누고 이름·사번·물품·좌석을 함께 검색한다",()=>{
  const now=Date.parse("2026-10-13T15:00:00+09:00");
  const rows=[make({}),make({id:2,startsAt:"2026-10-14T01:00:00+09:00"})];
  assert.deepEqual(filterReservations(rows,"1234 박스 B1","all",now).map(row=>row.id),[1,2]);
  assert.deepEqual(filterReservations(rows,"","due",now).map(row=>row.id),[1]);
  assert.deepEqual(filterReservations(rows,"","upcoming",now).map(row=>row.id),[2]);
  assert.equal(filterReservations(rows,"5678","all",now).length,0);
  assert.ok(reservationTime(rows[1].startsAt).includes("01:00"));
});
test("도래는 정확히 10분 전부터이며 10분 전 직전·예약 시각·경과 시각을 구분한다",()=>{
  const item=make({});
  const threshold=Date.parse("2026-10-13T14:50:00+09:00");
  assert.equal(isReservationDue(item.startsAt,threshold-1),false);
  assert.equal(isReservationDue(item.startsAt,threshold),true);
  assert.equal(isReservationDue(item.startsAt,Date.parse(item.startsAt)),true);
  assert.equal(isReservationDue(item.startsAt,Date.parse(item.startsAt)+60000),true);
  assert.deepEqual(filterReservations([item],"","due",threshold-1),[]);
  assert.deepEqual(filterReservations([item],"","upcoming",threshold-1),[item]);
  assert.deepEqual(filterReservations([item],"","due",threshold),[item]);
  assert.deepEqual(filterReservations([item],"","upcoming",threshold),[]);
  assert.deepEqual(filterReservations([item],"","all",threshold),[item]);
});
test("자정을 넘는 예약도 한국 시간 기준 10분 전을 동일하게 판정한다",()=>{
  const startsAt="2026-10-14T00:05:00+09:00";
  const threshold=Date.parse("2026-10-13T23:55:00+09:00");
  assert.equal(isReservationDue(startsAt,threshold-1),false);
  assert.equal(isReservationDue(startsAt,threshold),true);
  assert.equal(isReservationDue("2026-10-13T15:05:00Z",threshold),true);
  assert.equal(isReservationDue("잘못된 시각",threshold),false);
});
test("대여 신청으로 전환된 예약은 시각과 무관하게 미수령 탭에만 남는다",()=>{
  const item=make({status:"fulfilled"});
  const now=Date.parse(item.startsAt)-3600000;
  assert.deepEqual(filterReservations([item],"","upcoming",now),[]);
  assert.deepEqual(filterReservations([item],"","due",now),[item]);
});
