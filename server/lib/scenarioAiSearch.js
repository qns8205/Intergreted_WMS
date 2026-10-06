import { nameWordScore } from "./searchNameScore.js";
const normalize = value => String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const synonyms = [
  ["곰인형", "봉제인형", "인형", "plush toy", "stuffed animal"], ["젠가", "jenga"],
  ["컵", "cup"], ["접시", "plate"], ["상자", "box"], ["책", "book"], ["병", "bottle"],
  ["트레이", "쟁반", "tray"], ["의자", "chair"], ["테이블", "책상", "table", "desk"],
  ["사과", "apple"], ["공", "ball"], ["장난감", "toy"],
];
const wordsFor = text => {
  const value = normalize(text);
  const matches = synonyms.map(group => ({ group, length: Math.max(0, ...group.filter(word => value.includes(normalize(word))).map(word => normalize(word).length)) }));
  const longest = Math.max(0, ...matches.map(m => m.length));
  return matches.filter(m => m.length > 0 && m.length === longest).flatMap(m => m.group);
};
export const scenarioQueryText = query => `${query} ${wordsFor(query).join(" ")}`;
export const scenarioDocument = item => `title: ${String(item.name).slice(0, 150)} | text: ${[item.name, item.category, item.subcategory, item.variantNames, ...wordsFor(item.name)].filter(Boolean).join(" ").slice(0, 1200)}`;
export function scenarioLexicalScore(query, item) {
  const q = normalize(query), name = normalize(item.name);
  if (!q) return 0;
  if (/^\d+$/.test(query.trim()) && String(item.id).padStart(6, "0") === query.trim().padStart(6, "0")) return 3.5;
  if (q === name) return 3;
  if (name.includes(q)) return name.endsWith(q) || name.endsWith(`${q}s`) ? 2.4 : 2;
  const nameWords = nameWordScore(query, item.name);
  if (nameWords === 2.7) return nameWords;
  if (normalize(item.variantNames).includes(q)) return Math.max(nameWords, 1.8);
  const matchedWords = wordsFor(query).map(normalize).filter(word => name.includes(word));
  if (matchedWords.length) {
    // Descriptions such as "small box for storing things" should be ranked by
    // their full meaning, not dominated by a generic "box" suffix match.
    if (!wordsFor(query).some(word => normalize(word) === q)) return Math.max(nameWords, .35);
    return Math.max(nameWords, matchedWords.some(word => name.endsWith(word) || name.endsWith(`${word}s`)) ? 1.8 : 1.3);
  }
  // Names are the primary lexical evidence; broad classifications are supplementary.
  if (normalize(`${item.category || ""} ${item.subcategory || ""}`).includes(q)) return Math.max(nameWords, .6);
  return nameWords;
}
export function rankScenarios(query, items, vectors = new Map(), queryVector = null, filters) {
  return filterScenarioSearchItems(items, filters).map(item => {
    const lex = scenarioLexicalScore(query, item), cached = vectors.get(String(item.id));
    const vector = cached?.text === scenarioDocument(item) ? cached.vector : null;
    const similarity = queryVector && vector ? vector.reduce((sum, x, n) => sum + x * queryVector[n], 0) : -1;
    return { item, score: lex + Math.max(0, similarity), eligible: lex > 0 || similarity >= .35 };
  }).filter(x => x.eligible).sort((a, b) => b.score - a.score || String(a.item.id).localeCompare(String(b.item.id)))
    .slice(0, 20).map(({ item }) => ({ id: String(item.id) }));
}
export function filterScenarioSearchItems(items, { category = "", subcategory = "", request = "all" } = {}) {
  return items.filter(i => (!category || i.category === category) && (!subcategory || i.subcategory === subcategory)
    && (request !== "normal" || i.request == null));
}
