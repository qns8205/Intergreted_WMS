import test from "node:test";
import assert from "node:assert/strict";
import { createRequestCache } from "./requestCache.ts";

test("중복 조회는 공유하고 만료·명시적 새로고침은 다시 조회", async () => {
  let time = 0, calls = 0;
  const cache = createRequestCache<number>(100, 3, () => time);
  const fetcher = async () => ++calls;
  const first = cache("30", fetcher);
  assert.equal(cache("30", fetcher, true), first);
  assert.equal(await first, 1);
  assert.equal(await cache("30", fetcher), 1);
  assert.equal(await cache("7", fetcher), 2);
  assert.equal(await cache("30", fetcher, true), 3);
  time = 101;
  assert.equal(await cache("30", fetcher), 4);
});
test("실패 후 재시도가 가능하고 오래된 항목은 제한 개수 이후 제거", async () => {
  const cache = createRequestCache<number>(10000, 2);
  await assert.rejects(cache("failed", async () => { throw Error("network"); }));
  assert.equal(await cache("failed", async () => 1), 1);
  await cache("b", async () => 2);
  await cache("c", async () => 3);
  assert.equal(await cache("failed", async () => 4), 4);
});
