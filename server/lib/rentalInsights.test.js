import test from "node:test";
import assert from "node:assert/strict";
import { sampledStockoutRate } from "./insightsMath.js";

const naive = (intervals, samples, owned) => !owned || !samples.length ? 0 : samples.filter(t =>
  intervals.reduce((out, [a, b, q]) => out + (a <= t && t < b ? q : 0), 0) >= owned).length / samples.length;

test("품절 계산은 경계·수량 중첩을 포함해 기존 방식과 동일", () => {
  const samples = [0, 10, 20, 30, 40];
  const intervals = [[0, 20, 1], [10, 30, 2], [-10, 0, 9], [40, 50, 1]];
  for (const owned of [1, 2, 3, 10]) assert.equal(sampledStockoutRate(intervals, samples, owned), naive(intervals, samples, owned));
  assert.equal(sampledStockoutRate([], samples, 1), 0);
  assert.equal(sampledStockoutRate(intervals, [], 1), 0);
  assert.equal(sampledStockoutRate(intervals, samples, 0), 0);
});
test("무작위 구간에서도 기존 결과 보존", () => {
  let seed = 71;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const samples = Array.from({ length: 300 }, (_, n) => n * 10);
  for (let n = 0; n < 30; n++) {
    const intervals = Array.from({ length: 250 }, () => {
      const a = Math.floor(random() * 3500) - 200;
      return [a, a + Math.floor(random() * 500), Math.ceil(random() * 4)];
    });
    const owned = Math.ceil(random() * 35);
    assert.equal(sampledStockoutRate(intervals, samples, owned), naive(intervals, samples, owned));
  }
});
test("26,000개 대여·1,800개 샘플 성능 비교", () => {
  const samples = Array.from({ length: 1800 }, (_, n) => n * 1800000);
  const intervals = Array.from({ length: 26000 }, (_, n) => [n * 60000, n * 60000 + 3600000, 1]);
  const start = performance.now();
  const optimized = sampledStockoutRate(intervals, samples, 10);
  const optimizedMs = performance.now() - start;
  const oldStart = performance.now();
  assert.equal(optimized, naive(intervals, samples, 10));
  console.log(`stockout benchmark: optimized=${optimizedMs.toFixed(1)}ms naive=${(performance.now() - oldStart).toFixed(1)}ms`);
});
test("분석은 동시 요청·결과를 공유하고 재고 변경시 캐시를 무효화", async () => {
  process.env.WMS_DB_PATH = ":memory:";
  process.env.SM_SYNC = "off";
  const { run } = await import("../db.js");
  const { rentalInsights } = await import("./rentalInsights.js");
  const timestamp = new Date(Date.now() + 9 * 36e5 - 3600000).toISOString().slice(0, 19).replace("T", " ");
  run("INSERT INTO scenario_items (id,name,stock,rented) VALUES ('000001','성능 테스트 물품',5,1)");
  run("INSERT INTO general_rentals (item_id,item_label,qty,borrower_name,borrow_date,picked_up_at,returned) VALUES ('000001','[000001] 테스트',1,'테스트 사용자',?,?,'X')", [timestamp, timestamp]);
  const pending = rentalInsights({ days: 7 });
  assert.equal(rentalInsights({ days: 7 }), pending);
  const data = await pending;
  assert.equal(data.summary.rentals, 1);
  assert.equal(data.summary.open, 1);
  assert.equal(await rentalInsights({ days: 7 }), data);
  assert.notEqual(await rentalInsights({ days: 7, fresh: true }), data);
  run("UPDATE general_rentals SET returned='O', return_date=?", [timestamp]);
  assert.equal((await rentalInsights({ days: 7 })).summary.open, 0);
});
test("시간대 수요 칸 상세: 개수·대여자·발생 일수·대표 물품을 요일×시 키로 돌려준다", async () => {
  process.env.WMS_DB_PATH = ":memory:";
  process.env.SM_SYNC = "off";
  const { run } = await import("../db.js");
  const { rentalInsights } = await import("./rentalInsights.js");
  run("DELETE FROM general_rentals"); run("DELETE FROM sid_rentals");
  run("INSERT OR IGNORE INTO scenario_items (id,name,stock,rented) VALUES ('000001','성능 테스트 물품',5,1)");
  run("INSERT OR IGNORE INTO scenario_items (id,name,stock,rented) VALUES ('000002','두번째 물품',5,0)");
  // 이틀 전 같은 시(서울 시각)에 세 건 — 요일×시 키는 그 시각에서 구한다.
  const at = new Date(Date.now() + 9 * 36e5 - 2 * 864e5);
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = (min) => `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())} ${pad(at.getUTCHours())}:${pad(min)}:00`;
  const key = `${at.getUTCDay()}-${at.getUTCHours()}`;
  const add = (id, qty, who, min) => run("INSERT INTO general_rentals (item_id,item_label,qty,borrower_name,borrow_date,picked_up_at,returned) VALUES (?,?,?,?,?,?,'X')", [id, `[${id}] x`, qty, who, stamp(min), stamp(min)]);
  add("000001", 2, "가나다", 5); add("000001", 1, "라마바", 20); add("000002", 1, "가나다", 40);
  const data = await rentalInsights({ days: 7, fresh: true });
  const cell = data.timeDemand.borrowCells[key];
  assert.equal(data.timeDemand.borrow[at.getUTCDay()][at.getUTCHours()], 3);          // 건수(기존 격자)
  assert.equal(cell.qty, 4); assert.equal(cell.borrowers, 2); assert.equal(cell.days, 1);
  assert.deepEqual(cell.top.map((t) => [t.id, t.name, t.qty]), [["000001", "성능 테스트 물품", 3], ["000002", "두번째 물품", 1]]);
  assert.equal(cell.moreTypes, 0);
  assert.equal(Object.keys(data.timeDemand.borrowCells).length, 1);                   // 비어 있는 칸은 싣지 않는다
  assert.deepEqual(data.timeDemand.returnCells, {});
});
