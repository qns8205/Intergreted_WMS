import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { plannerReturnRecommendations } from '/home/configds/wms/server/lib/plannerReturnRecommendations.js';

const key=readFileSync('/home/configds/wms/server/data/planner-bridge.key','utf8').trim();
const db=new DatabaseSync('/home/configds/wms/server/data/db.sqlite3',{readOnly:true});
const items=db.prepare(`SELECT id AS rowIndex, request_no AS requestNo, employee_id AS employeeId,
  item_id AS itemId, qty AS quantity, picked_up_at AS pickedUp, variant_id AS variantId
  FROM general_rentals WHERE COALESCE(returned,'X')!='O' AND request_no>0`).all().map(row=>({...row,sheetType:'general'}));
const nos=[...new Set(items.map(row=>row.requestNo))], matched=new Map();
const endpoint='http://127.0.0.1:3010/api/wms/rental-context';
assert.equal((await fetch(endpoint+'?requestNos=1',{signal:AbortSignal.timeout(5000)})).status,401);
let contextCount=0;
for(let offset=0;offset<nos.length;offset+=200){
  const batch=nos.slice(offset,offset+200);
  const reservations=db.prepare(`SELECT id,request_no FROM item_reservations WHERE request_no IN (${batch.map(()=>'?').join(',')})`).all(...batch);
  const url=new URL(endpoint);url.searchParams.set('requestNos',batch.join(','));url.searchParams.set('reservationIds',reservations.map(r=>r.id).join(','));
  const response=await fetch(url,{headers:{'x-planner-key':key},signal:AbortSignal.timeout(5000)});
  assert.equal(response.status,200);const data=await response.json();assert.ok(Array.isArray(data.contexts));
  for(const ctx of data.contexts){
    assert.ok(ctx.returnRules===null || Array.isArray(ctx.returnRules));
    assert.equal(typeof ctx.progressRoutine,'number');
    const requestNo=batch.includes(ctx.requestNo)?ctx.requestNo:reservations.find(r=>(ctx.reservationIds||[]).includes(r.id))?.request_no;
    if(requestNo)matched.set(requestNo,ctx);
    contextCount++;
  }
}
const suggested=plannerReturnRecommendations(items,matched);
for(const [index,rec] of suggested){assert.ok(rec.quantity>0 && rec.quantity<=items[index].quantity);assert.ok(items[index].pickedUp);}
console.log(JSON.stringify({plannerAuth:'ok',contexts:contextCount,actualRentalRows:items.length,recommendedRows:suggested.size,recommendedQuantity:[...suggested.values()].reduce((sum,r)=>sum+r.quantity,0)}));
db.close();
