import { all } from '../db.js';
import { warehouseIsConsumable } from './warehouseRentals.js';
import { nameWordScore } from './searchNameScore.js';

const aliases = [
  ['망치', 'hammer'], ['펜치', '뺀치', 'pliers'], ['니퍼', 'nipper', 'wire cutter'],
  ['줄자', 'tape measure', 'measuring tape'], ['육각렌치', '육각 렌치', 'allen key', 'hex wrench'],
  ['드라이버', 'screwdriver', '나사 조이는 도구', '나사를 조이는 도구'], ['십자드라이버', '십자 드라이버', 'phillips screwdriver'],
  ['전동드릴', '전동 드릴', 'power drill'], ['커터칼', '커터 칼', 'utility knife', '종이 자르는 칼'],
  ['테이프', 'tape'], ['스패너', '렌치', 'wrench', '볼트 조이는 공구'],
];
const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
export function lexicalToolScore(query, item) {
  const q = normalize(query), name = normalize(item.name);
  if (!q) return 0;
  if (q === name) return 3;
  if (name.includes(q)) return 2;
  const nameWords = nameWordScore(query, item.name);
  if (nameWords === 2.7) return nameWords;
  const groups = aliases.filter(group => group.some(word => normalize(query).includes(normalize(word))));
  if (groups.some(group => group.some(word => name.includes(normalize(word))))) return Math.max(nameWords, 1.3);
  if (normalize(`${item.keywords || ''} ${item.subcategory || ''}`).includes(q)) return Math.max(nameWords, .6);
  return nameWords;
}

/** 모델·벡터 캐시 없이 이름·키워드만 비교한다. 무인 화면의 보관 위치 비공개 유지. */
export function suggestWarehouseTools(query, limit = 6) {
  return all('SELECT id,name,subcategory,keywords,stock,consumable,image_path,archived FROM warehouse_items')
    .filter(item => item.name && !warehouseIsConsumable(item.archived))
    .map(item => ({ item, score: lexicalToolScore(query, item) }))
    .filter(row => row.score > 0)
    .sort((a,b) => b.score - a.score || Number(a.item.id) - Number(b.item.id))
    .slice(0,limit)
    .map(({item}) => ({ id: Number(item.id), name: item.name,
      image: /^\/uploads\//.test(item.image_path || '') ? item.image_path : '',
      stock: item.stock != null && String(item.stock).trim() !== '' && Number.isFinite(Number(item.stock)) ? Number(item.stock) : null,
      consumable: warehouseIsConsumable(item.consumable),
    }));
}
