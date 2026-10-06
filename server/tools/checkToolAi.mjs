// Read-only inventory search smoke test. Does not submit rental/return requests.
import { warmWarehouseToolSearch, searchWarehouseTools, liveSearchTools } from "../lib/warehouseSearchService.js";
const started = Date.now();
await warmWarehouseToolSearch();
const output = { count: liveSearchTools().length, indexingMs: Date.now() - started, examples: [] };
for (const query of ["육각 렌치", "전동 드릴", "망치", "줄자", "나사 조이는 도구", "존재하지않는공구zzqq"]) {
  const begin = Date.now(), result = await searchWarehouseTools(query);
  output.examples.push({ query, ms: Date.now() - begin, mode: result.mode, candidates: result.items.map(i => ({ id: i.id, name: i.name })) });
}
console.log(JSON.stringify(output, null, 2));
