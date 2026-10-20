import { all } from '../db.js';
import { locationSortIndex } from './locationSort.js';

const normalize = (text) => String(text || '').normalize('NFKC').toLowerCase().replace(/[\s\-_()[\].,/]+/g, '');
const archived = (value) => !['', 'false', '0', 'x', 'n'].includes(String(value ?? '').trim().toLowerCase());

/** Only public warehouse wayfinding fields; no rental, purchase or personnel details. */
export function lookupItemLocations(query, { limit = 20, hiddenScenarioIds = new Set() } = {}) {
  const q = normalize(query), words = String(query).trim().split(/\s+/).map(normalize).filter(Boolean);
  if (!q) return { items: [], hasMore: false };
  const candidates = [
    ...all('SELECT id,name,root_slot AS location,image_path AS image,is_storage AS archived FROM scenario_items').map((item) => ({ ...item, kind: 'scenario' })),
    ...all('SELECT id,name,location,image_path AS image,archived FROM warehouse_items').map((item) => ({ ...item, kind: 'warehouse' })),
  ].filter((item) => item.name && !archived(item.archived) && !(item.kind === 'scenario' && hiddenScenarioIds.has(item.id))).map((item) => {
    const name = normalize(item.name);
    const score = name === q ? 4 : name.startsWith(q) ? 3 : name.includes(q) ? 2 : words.length > 1 && words.every((word) => name.includes(word)) ? 1 : 0;
    return { item, score };
  }).filter((match) => match.score > 0).sort((a, b) => b.score - a.score
    || a.item.name.localeCompare(b.item.name, 'ko', { numeric: true })
    || locationSortIndex(a.item.location) - locationSortIndex(b.item.location));
  return { items: candidates.slice(0, limit).map(({ item }) => ({
    id: String(item.id), kind: item.kind, name: item.name, location: item.location || '',
    image: /^\/uploads\//.test(item.image || '') ? item.image : '',
  })), hasMore: candidates.length > limit };
}
