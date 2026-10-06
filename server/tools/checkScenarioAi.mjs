// Read-only catalog indexing and search. Never submit a rental/return.
import { warmAllAiSearch, searchScenarioItems, liveSearchScenarios } from "../lib/warehouseSearchService.js";
import { get } from "../db.js";
const start = Date.now();
await warmAllAiSearch();
const result = { count: liveSearchScenarios().length, indexingMs: Date.now() - start, examples: [] };
for (const query of ["컵", "상자", "젠가", "곰인형", "작은 물건을 담는 상자"]) {
  const before = Date.now();
  const response = await searchScenarioItems(query, { request: "all" });
  const names = new Map(liveSearchScenarios().map(i => [i.id, i.name]));
  result.examples.push({ query, ms: Date.now() - before, mode: response.mode, top5: response.items.slice(0, 5).map(i => ({ id: i.id, name: names.get(i.id) })) });
}
console.log(JSON.stringify(result, null, 2));
if (process.argv.includes('--http')) {
  const employeeId = get("SELECT employee_id FROM registered_users WHERE active=1 AND employee_id!='0000' ORDER BY employee_id LIMIT 1")?.employee_id;
  if (!employeeId) throw Error('No registered borrower for read-only HTTP check');
  const status = await (await fetch('http://127.0.0.1:3000/api/unattended/status')).json();
  const response = await fetch(`http://127.0.0.1:3000/api/scenario-search?${new URLSearchParams({employeeId,q:'곰인형',request:'all'})}`);
  const data = await response.json();
  if (!response.ok || !data.success || data.mode !== 'ai') throw Error('Production AI HTTP search failed');
  console.log(JSON.stringify({httpStatus:response.status,unattendedEnabled:status.enabled,mode:data.mode,count:data.items.length,ids:data.items.slice(0,5).map(i=>i.id)}));
}
