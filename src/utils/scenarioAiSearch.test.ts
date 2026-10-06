import test from "node:test";
import assert from "node:assert/strict";
import { filterScenarioAiResults } from "./scenarioAiResults.ts";
const items = [
  { id: '000001', category: 'A', subcategory: 'a', name: 'first' },
  { id: '000002', category: 'A', subcategory: 'a', name: 'second', requestFor: '' },
  { id: '000003', category: 'B', subcategory: 'b', name: 'third' },
];
test('AI 추천 ID의 앞자리 0/순서 보존, 없는 ID를 생성하지 않고 필터 유지', () => {
  const result = filterScenarioAiResults(items, ['000002', '000003', 'missing', '000001'], { category: 'A', subcategory: 'a', request: 'all' });
  assert.deepEqual(result.map(i => i.id), ['000002', '000001']);
  assert.deepEqual(filterScenarioAiResults(items, ['000002', '000001'], { category: '', subcategory: '', request: 'normal' }).map(i => i.id), ['000001']);
  assert.deepEqual(filterScenarioAiResults(items, [], { category: '', subcategory: '', request: 'all' }), []);
});
