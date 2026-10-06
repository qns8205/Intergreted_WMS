import test from "node:test";
import assert from "node:assert/strict";
import { createToolSearch, rankTools, lexicalToolScore, localEmbeddingClient } from "./warehouseToolSearch.js";

const vector = index => Array.from({ length: 768 }, (_, n) => n === index ? 1 : 0);
const items = [
  { id: 1, name: "줄칼 세트", keywords: "파일", stock: "3", image_path: "/uploads/1.webp" },
  { id: 2, name: "줄자", stock: "0", image_path: "https://unsafe.example/photo" },
  { id: 3, name: "Hammer", stock: "", consumable: "Y" },
];

test("AI 공구 검색도 분류보다 이름의 단어 일치를 우선", () => {
  const tools = [{ id: 1, name: 'Other Tool', subcategory: 'Steel Hammer' }, { id: 2, name: 'Hammer Steel' }];
  assert.equal(lexicalToolScore('Steel Hammer', tools[1]), 2.7);
  assert.equal(rankTools('Steel Hammer', tools)[0].id, 2);
});
test("정확한 이름과 한영 유사어를 우선하며 재고·사진의 안전한 표시", () => {
  assert.equal(rankTools("줄자", items)[0].id, 2);
  assert.equal(lexicalToolScore("망치", items[2]), 1.3);
  assert.equal(rankTools("망치", items)[0].stock, null);
  assert.equal(rankTools("망치", items)[0].consumable, true);
  assert.equal(rankTools("줄자", items)[0].image, "");
  assert.deepEqual(rankTools("없는 공구", items), []);
});
test("실제 인덱스 캐시 재사용·변경 항목만 재계산·삭제 항목 제외", async () => {
  let calls = 0;
  const service = createToolSearch({ embed: async () => { calls++; return vector(0); }, delay: 0 });
  await service.warm(items); assert.equal(calls, 3);
  await service.warm(items); assert.equal(calls, 3);
  const result = await service.search("줄자", items);
  assert.equal(result.mode, "ai"); assert.equal(result.items[0].id, 2); assert.equal(calls, 4);
  const absent = await service.search("줄자", items.filter(i => i.id !== 2));
  assert.deepEqual(absent.items, []); assert.equal(calls, 5);
  await service.warm([{ ...items[0], name: "새 이름" }, items[2]]);
  assert.equal(calls, 6);
  assert.equal((await service.search("줄자", [items[2]])).items.some(i => i.id === 2), false);
});
test("모델 미연결·오류·잘못된 벡터는 이름 검색으로 대체", async () => {
  for (const embed of [undefined, async () => { throw Error("offline"); }, async () => [NaN]]) {
    const service = createToolSearch({ embed, delay: 0 });
    await service.warm(items).catch(() => {});
    const result = await service.search("망치", items);
    assert.equal(result.mode, "keywords"); assert.equal(result.items[0].id, 3);
  }
});
test("모델 동시 추론은 대기열을 쌓지 않고 검색을 대체", async () => {
  let release;
  const service = createToolSearch({ embed: async () => vector(0), delay: 0 });
  await service.warm(items);
  const blocked = createToolSearch({ embed: () => new Promise(resolve => { release = resolve; }), delay: 0 });
  const warming = blocked.warm(items.slice(0, 1));
  while (!release) await new Promise(resolve => setTimeout(resolve, 1));
  const result = await blocked.search("망치", items);
  assert.equal(result.mode, "keywords"); assert.equal(result.items[0].id, 3);
  release(vector(0)); await warming;
});
test("외부 주소·HTTPS·파일 주소의 모델 연결은 거부", () => {
  for (const url of ["http://external.example", "https://127.0.0.1", "file:///tmp/model"]) assert.throws(() => localEmbeddingClient(url));
  assert.equal(typeof localEmbeddingClient("http://127.0.0.1:18087"), "function");
});
