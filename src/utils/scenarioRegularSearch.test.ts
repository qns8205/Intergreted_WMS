import test from "node:test";
import assert from "node:assert/strict";
import { scenarioRegularScore } from "./scenarioRegularSearch.ts";
const item = { id: '000013', name: 'Plastic Cup', rootSlot: '123456', category: '장난감', requestFor: '곰인형', personalOwner: '곰인형' };
test('일반 검색은 문자 일치만 사용: 번역·부가 분류·Request·개인 소유자 제외', () => {
  assert.equal(scenarioRegularScore(item, '곰인형', false), null);
  assert.equal(scenarioRegularScore(item, '장난감', false), null);
  assert.equal(scenarioRegularScore(item, '컵', false), null);
  assert.equal(scenarioRegularScore(item, 'plastic cup', false), 120);
  assert.equal(scenarioRegularScore(item, 'CUP', false), 70);
  assert.equal(scenarioRegularScore(item, 'plastic 123456', false), 40);
});
test('일반 검색은 정확한 ID·이름·위치를 우선하며 무인 위치 비공개 유지', () => {
  assert.equal(scenarioRegularScore(item, '13', false), 130);
  assert.equal(scenarioRegularScore(item, '123456', false), 110);
  assert.equal(scenarioRegularScore(item, '123456', true), null);
  const related = { ...item, id: '000999', name: 'Plastic Cup Set' };
  assert.ok(scenarioRegularScore(item, 'plastic cup', false)! > scenarioRegularScore(related, 'plastic cup', false)!);
});
