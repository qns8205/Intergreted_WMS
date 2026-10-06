import test from "node:test";
import assert from "node:assert/strict";
import { paginateLogGroups } from "./logPages.ts";

test("26,000개 이력을 한 화면에 그리지 않고 모든 행·순서·묶음을 보존", () => {
  const groups = Array.from({ length: 2600 }, (_, n) => ({ key: String(n), items: Array.from({ length: 10 }, (_, i) => n * 10 + i) }));
  const pages = paginateLogGroups(groups);
  assert.equal(pages.flatMap(p => p.flatMap(g => g.items)).length, 26000);
  assert.deepEqual(pages.flatMap(p => p.flatMap(g => g.items)), groups.flatMap(g => g.items));
  for (const page of pages) {
    assert.ok(page.length <= 20);
    assert.ok(page.reduce((n, g) => n + g.items.length, 0) <= 150);
  }
});
test("한 반납 묶음이 큰 경우에도 행 수 제한을 지키고 중복 없이 나눔", () => {
  const rows = Array.from({ length: 400 }, (_, i) => i);
  const pages = paginateLogGroups([{ key: "big", items: rows }]);
  assert.equal(pages.length, 3);
  assert.deepEqual(pages.flatMap(p => p.flatMap(g => g.items)), rows);
  assert.equal(new Set(pages.flat().map(g => g.key)).size, 3);
  assert.deepEqual(paginateLogGroups([]), []);
});
