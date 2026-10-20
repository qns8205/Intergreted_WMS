import test from 'node:test';
import assert from 'node:assert/strict';
import { plannerReturnRecommendations as suggest } from './plannerReturnRecommendations.js';
const item = (requestNo, itemId, quantity, extra={}) => ({sheetType:'general',pickedUp:'2026-10-19',employeeId:'1001',rowIndex:requestNo,requestNo,itemId,quantity,...extra});
const ctx = (routine,keep=[],extra={}) => ({planId:1,employeeId:'1001',collectionName:'Collection',routine,returnRules:[{number:1,keep},{number:2,keep:[]}],...extra});
const keep = (id,quantity,variantId=0) => ({id,quantity,variantId});

test('keeps next routine needs and recommends real surplus; partial returns reduce recommendations',()=>{
  const contexts=new Map([[1,ctx(1,[keep('000001',2)])]]);
  assert.equal(suggest([item(1,'000001',5)],contexts).get(0).quantity,3);
  assert.equal(suggest([item(1,'000001',3)],contexts).get(0).quantity,1);
  assert.equal(suggest([item(1,'000001',2)],contexts).size,0);
});
test('older routine rows and extras are counted together, never duplicated per request',()=>{
  const contexts=new Map([[1,ctx(1)],[2,ctx(2,[],{returnRules:[{number:2,keep:[keep('000001',2)]}]})]]);
  const rows=[item(1,'000001',3),item(2,'000001',2)];
  const result=suggest(rows,contexts);
  assert.equal(result.get(0).quantity,3);assert.equal(result.has(1),false);
  assert.equal(result.get(0).routine,2);
  assert.equal(rows[0].quantity,3);
});
test('future unpicked reservations cannot move the current return rule forward',()=>{
  const result=suggest([item(1,'000001',2),item(2,'000002',1,{pickedUp:null})],new Map([[1,ctx(1,[keep('000001',2)])],[2,ctx(2)]]));
  assert.equal(result.size,0);
});
test('explicit variant needs are retained before generic object needs',()=>{
  const rows=[item(1,'000001',2,{variantId:7,rowIndex:1}),item(1,'000001',3,{variantId:8,rowIndex:2})];
  const result=suggest(rows,new Map([[1,ctx(1,[keep('000001',2),keep('000001',2,7)])]]));
  assert.equal(result.has(0),false);assert.equal(result.get(1).quantity,1);
});
test('held-only routine progress advances recommendations without a new WMS request',()=>{
  const result=suggest([item(1,'000001',2)],new Map([[1,ctx(1,[keep('000001',2)],{progressRoutine:2})]]));
  assert.equal(result.get(0).quantity,2);assert.equal(result.get(0).routine,2);
});
test('manual rentals, another employee, non-scenario rows and missing/archived planner rules stay unmarked',()=>{
  const rows=[item(1,'000001',1,{employeeId:'1002'}),item(99,'000001',1),item(1,'000001',1,{sheetType:'scenario'}),item(2,'000001',1)];
  assert.equal(suggest(rows,new Map([[1,ctx(1)],[2,ctx(1,[],{returnRules:null})]])).size,0);
});
test('separate plans for the same person keep independent quantities',()=>{
  const result=suggest([item(1,'000001',3),item(2,'000001',3)],new Map([[1,ctx(1,[keep('000001',2)])],[2,ctx(1,[keep('000001',3)],{planId:2})]]));
  assert.equal(result.get(0).quantity,1);assert.equal(result.has(1),false);
});
