// Read-only production API check: no rentals, returns or inventory changes.
import assert from 'node:assert/strict';
import { get } from '../db.js';
import { liveSearchScenarios } from '../lib/warehouseSearchService.js';

const [query, expectedName] = process.argv.slice(2);
if (!query || !expectedName) throw Error('Usage: checkAiNameRanking.mjs <query> <expected first name>');
const employeeId = get("SELECT employee_id FROM registered_users WHERE active=1 AND employee_id!='0000' ORDER BY employee_id LIMIT 1")?.employee_id;
if (!employeeId) throw Error('No registered borrower for read-only HTTP check');
const before = Date.now();
const response = await fetch(`http://127.0.0.1:3000/api/scenario-search?${new URLSearchParams({employeeId,q:query,request:'all'})}`);
const result = await response.json();
assert.equal(response.status, 200);
assert.equal(result.mode, 'ai');
const names = new Map(liveSearchScenarios().map(i => [i.id, i.name]));
const top = result.items.slice(0, 5).map(i => ({id:i.id,name:names.get(i.id)}));
assert.equal(top[0]?.name.toLowerCase(), expectedName.toLowerCase());
console.log(JSON.stringify({query,httpStatus:response.status,mode:result.mode,ms:Date.now()-before,top},null,2));
