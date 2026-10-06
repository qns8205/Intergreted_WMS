import fs from "node:fs/promises";
import path from "node:path";
import { nameWordScore } from "./searchNameScore.js";

const MODEL = "embeddinggemma-q8-b11333-v1";
const aliases = [
  ["망치", "hammer"], ["펜치", "뺀치", "pliers"], ["니퍼", "nipper", "wire cutter"],
  ["줄자", "tape measure", "measuring tape"], ["육각렌치", "육각 렌치", "allen key", "hex wrench"],
  ["드라이버", "screwdriver", "나사 조이는 도구", "나사를 조이는 도구"], ["십자드라이버", "십자 드라이버", "phillips screwdriver"],
  ["전동드릴", "전동 드릴", "power drill"], ["커터칼", "커터 칼", "utility knife", "종이 자르는 칼"],
  ["테이프", "tape"], ["스패너", "렌치", "wrench", "볼트 조이는 공구"],
];
const normalize = value => String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const groupsFor = value => aliases.filter(group => group.some(word => normalize(value).includes(normalize(word))));
export const toolDocument = item => `title: ${item.name} | text: ${item.name} ${item.subcategory || ""} ${item.keywords || ""} ${groupsFor(item.name).flat().join(" ")}`;
export function lexicalToolScore(query, item) {
  const q = normalize(query), name = normalize(item.name);
  if (!q) return 0;
  if (q === name) return 3;
  if (name.includes(q)) return 2;
  const nameWords = nameWordScore(query, item.name);
  if (nameWords === 2.7) return nameWords;
  const groups = groupsFor(query);
  if (groups.some(group => group.some(word => name.includes(normalize(word))))) return Math.max(nameWords, 1.3);
  if (normalize(`${item.keywords || ""} ${item.subcategory || ""}`).includes(q)) return Math.max(nameWords, .6);
  return nameWords;
}
const validVector = v => Array.isArray(v) && v.length === 768 && v.every(Number.isFinite) && v.some(x => x !== 0);
const unit = vector => {
  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
  return vector.map(x => x / norm);
};
export function rankTools(query, items, vectors = new Map(), queryVector = null) {
  // A known tool family absent from the catalog should not become an unrelated
  // semantic candidate (e.g. "tape measure" -> adhesive tape).
  const knownFamily = groupsFor(query).length > 0;
  return items.map(item => {
    const lex = lexicalToolScore(query, item);
    const cached = vectors.get(String(item.id));
    const vector = cached?.text === toolDocument(item) ? cached.vector : null;
    const similarity = queryVector && vector ? vector.reduce((sum, x, n) => sum + x * queryVector[n], 0) : -1;
    return { item, score: lex + Math.max(0, similarity), eligible: lex > 0 || (!knownFamily && similarity >= .30) };
  }).filter(x => x.eligible).sort((a, b) => b.score - a.score || Number(a.item.id) - Number(b.item.id)).slice(0, 5).map(({ item }) => ({
    id: Number(item.id), name: item.name, image: /^\/uploads\//.test(item.image_path || "") ? item.image_path : "",
    stock: item.stock != null && String(item.stock).trim() !== "" && Number.isFinite(Number(item.stock)) ? Number(item.stock) : null,
    consumable: !["", "false", "0", "x", "n", "no", "off"].includes(String(item.consumable ?? "").trim().toLowerCase()),
  }));
}

/** Only local, bounded inference. No rental or inventory mutations; unchanged vectors are reused. */
export function createToolSearch({ embed, cachePath, delay = 80, document = toolDocument, rank = rankTools,
  queryText = query => `${query} ${groupsFor(query).flat().join(" ")}`,
  fallbackMessage = "AI가 준비 중이거나 응답하지 않아 이름·유사어로 찾았습니다. 직접 입력으로도 신청할 수 있습니다." } = {}) {
  let vectors = new Map(), loaded = false, loading, indexing, inferenceBusy = false;
  async function load() {
    if (loaded) return;
    loading ||= (async () => {
      try {
        const data = JSON.parse(await fs.readFile(cachePath, "utf8"));
        if (data.model === MODEL) vectors = new Map(data.entries.filter(([, row]) => validVector(row.vector)));
      } catch { /* New or invalid cache: rebuild independently of the application. */ }
      loaded = true;
    })();
    await loading;
  }
  async function infer(text) {
    if (!embed || inferenceBusy) throw Error("AI 검색 준비 중");
    inferenceBusy = true;
    try {
      const vector = await embed(text);
      if (!validVector(vector)) throw Error("Invalid embedding");
      return unit(vector);
    } finally { inferenceBusy = false; }
  }
  async function warm(items) {
    await load();
    if (!embed || indexing) return indexing;
    indexing = (async () => {
      let changed = false;
      for (const item of items) {
        const key = String(item.id), text = document(item);
        if (vectors.get(key)?.text === text) continue;
        // Do not queue a search behind a full catalog rebuild.
        await new Promise(resolve => setTimeout(resolve, delay));
        if (inferenceBusy) continue;
        const vector = await infer(text);
        vectors.set(key, { text, vector }); changed = true;
      }
      const live = new Set(items.map(i => String(i.id)));
      for (const key of vectors.keys()) if (!live.has(key)) { vectors.delete(key); changed = true; }
      if (changed && cachePath) {
        await fs.mkdir(path.dirname(cachePath), { recursive: true });
        await fs.writeFile(`${cachePath}.tmp`, JSON.stringify({ model: MODEL, entries: [...vectors] }));
        await fs.rename(`${cachePath}.tmp`, cachePath);
      }
    })();
    try { await indexing; } finally { indexing = null; }
  }
  async function search(query, items, context) {
    await load();
    const hasVectors = items.some(i => vectors.get(String(i.id))?.text === document(i));
    let vector = null, mode = "keywords";
    if (hasVectors) {
      try { vector = await infer(`task: search result | query: ${queryText(query)}`); mode = "ai"; }
      catch { /* Keep name/alias search usable when the AI service is busy or offline. */ }
    }
    void warm(items).catch(() => {});
    return { items: rank(query, items, vectors, vector, context), mode,
      message: mode === "ai" ? "AI가 찾은 후보입니다. 사진과 이름을 확인한 뒤 선택해주세요." : fallbackMessage };
  }
  return { search, warm };
}

let localInferenceBusy = false;
export function localEmbeddingClient(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) throw Error("Embedding service must be local");
  return async text => {
    // Tool and scenario indexes share the same one-slot model; never queue them.
    if (localInferenceBusy) throw Error("AI inference busy");
    localInferenceBusy = true;
    try {
    const response = await fetch(new URL("/v1/embeddings", parsed), { method: "POST", redirect: "error", signal: AbortSignal.timeout(2500),
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: text, model: "embeddinggemma", encoding_format: "float" }) });
    if (!response.ok) throw Error(`Embedding HTTP ${response.status}`);
    return (await response.json()).data?.[0]?.embedding;
    } finally { localInferenceBusy = false; }
  };
}
