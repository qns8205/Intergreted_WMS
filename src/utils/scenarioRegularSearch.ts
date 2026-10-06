const norm = (value: unknown) => String(value ?? "").normalize("NFKC").toLowerCase().replace(/[\s\-_()[\].,/]+/g, "");
const padded = (value: string) => /^\d+$/.test(value) ? value.padStart(6, "0") : value;

/** Literal matching only. No AI, synonym expansion, category or owner matches. */
export function scenarioRegularScore(item: { id: string; name: string; rootSlot: string }, query: string, hideLocation: boolean): number | null {
  const raw = query.trim();
  if (!raw) return 0;
  const q = norm(raw);
  if (!q) return null;
  const name = norm(item.name), id = norm(item.id);
  const location = hideLocation ? "" : norm(item.rootSlot);
  if (id === q || (/^\d+$/.test(raw) && padded(item.id) === padded(raw))) return 130;
  if (name === q) return 120;
  if (location && (location === q || (/^\d+$/.test(raw) && padded(item.rootSlot) === padded(raw)))) return 110;
  if (name.startsWith(q)) return 100;
  if (id.startsWith(q)) return 90;
  if (location && location.startsWith(q)) return 80;
  if (name.includes(q)) return 70;
  if (location && location.includes(q)) return 60;
  if (id.includes(q)) return 50;
  const words = raw.split(/\s+/).map(norm).filter(Boolean);
  if (words.length > 1 && words.every(word => name.includes(word))) return 65;
  if (words.length > 1 && words.every(word => [name, id, location].some(part => part && part.includes(word)))) return 40;
  return null;
}
export const scenarioAiResultActive = (mode: "normal" | "ai", resultQuery: string | undefined, query: string, hasResult: boolean) =>
  mode === "ai" && hasResult && resultQuery === query.trim();
