import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { all } from "../db.js";
import { warehouseIsConsumable } from "./warehouseRentals.js";
import { toScenarioObject } from "./serialize.js";
import { createToolSearch, lexicalToolScore, localEmbeddingClient } from "./warehouseToolSearch.js";
import { scenarioDocument, scenarioQueryText, rankScenarios } from "./scenarioAiSearch.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let config = {};
try { config = JSON.parse(fs.readFileSync(path.join(root, "server/data/tool-ai-config.json"), "utf8")); } catch { /* Optional local feature configuration. */ }
export const toolAiConfigured = Boolean(process.env.WMS_TOOL_AI_URL || config.enabled === true);
export const liveSearchTools = () => all("SELECT id,name,subcategory,keywords,stock,consumable,image_path,archived,location FROM warehouse_items")
  .filter(i => i.name && !warehouseIsConsumable(i.archived));
/** 공구 이름을 적는 동안 바로 아래 띄우는 후보. AI 없이 이름·유사어만 보므로 즉시 돌아온다. */
export const suggestWarehouseTools = (query, limit = 6) => liveSearchTools()
  .map(item => ({ item, score: lexicalToolScore(query, item) }))
  .filter(x => x.score > 0)
  .sort((a, b) => b.score - a.score || Number(a.item.id) - Number(b.item.id))
  .slice(0, limit)
  .map(({ item }) => ({
    id: Number(item.id), name: item.name, location: item.location || "",
    image: /^\/uploads\//.test(item.image_path || "") ? item.image_path : "",
    stock: item.stock != null && String(item.stock).trim() !== "" && Number.isFinite(Number(item.stock)) ? Number(item.stock) : null,
    consumable: warehouseIsConsumable(item.consumable),
  }));
const service = createToolSearch({
  embed: toolAiConfigured ? localEmbeddingClient(process.env.WMS_TOOL_AI_URL || "http://127.0.0.1:18087") : undefined,
  cachePath: path.join(root, "server/data/tool-search-vectors.json"),
});
export const searchWarehouseTools = query => service.search(query, liveSearchTools());
export const warmWarehouseToolSearch = () => service.warm(liveSearchTools());
export const liveSearchScenarios = () => {
  const names = new Map();
  for (const row of all("SELECT item_id,name FROM scenario_item_variants ORDER BY sort_order,id")) {
    names.set(row.item_id, `${names.get(row.item_id) || ""} ${row.name || ""}`);
  }
  return all("SELECT id,name,category,subcategory,is_storage,request FROM scenario_items")
    .filter(i => i.name && !toScenarioObject(i).archived).map(i => ({ ...i, variantNames: names.get(i.id) || "" }));
};
const scenarioService = createToolSearch({
  embed: toolAiConfigured ? localEmbeddingClient(process.env.WMS_TOOL_AI_URL || "http://127.0.0.1:18087") : undefined,
  cachePath: path.join(root, "server/data/scenario-search-vectors.json"),
  document: scenarioDocument, rank: rankScenarios, queryText: scenarioQueryText,
  fallbackMessage: "AI가 준비 중이거나 응답하지 않아 이름·유사어로 찾았습니다. 일반 검색도 계속 사용할 수 있습니다.",
});
// Always index the entire live catalog. Filtered searches must not prune unrelated cached vectors.
export const searchScenarioItems = async (query, filters) => {
  const items = liveSearchScenarios();
  // Search receives the full catalog and applies filters only at ranking time.
  return scenarioService.search(query, items, filters);
};
export const warmAllAiSearch = async () => { await warmWarehouseToolSearch(); await scenarioService.warm(liveSearchScenarios()); };
