import test from "node:test";
import assert from "node:assert/strict";
import { buildReborrowEntries } from "./reborrowPlan.ts";
import type { ScenarioLogEntry } from "./borrowApi";

const row = (overrides: Partial<ScenarioLogEntry> = {}): ScenarioLogEntry => ({
  sheetType: "general", rowIndex: 1, borrowerName: "검증 사용자", employeeId: "1111", itemLabel: "테스트",
  location: "000007", itemId: "000001", itemName: "테스트", quantity: 2, borrowDate: "2026-10-01",
  borrowPurpose: "촬영", email: "", batchId: "b1", floor: "B2", unit: "Unit 1", returned: true,
  image: "", stock: 10, rented: 0, ...overrides,
});
test("기존 좌석·사번·종류·수량을 유지하고 원본 반납 기록은 바꾸지 않음", () => {
  const logs = [row({ variantId: 7, variantName: "빨강" })];
  const original = structuredClone(logs);
  const [entry] = buildReborrowEntries(logs, "2026-10-01 12:00");
  assert.equal(entry.floor, "B2"); assert.equal(entry.unit, "Unit 1"); assert.equal(entry.employeeId, "1111");
  assert.deepEqual(entry.borrowedItems, [{ id: "000001", name: "테스트", quantity: 2, variantId: 7 }]);
  assert.deepEqual(logs, original);
});
test("한 사람이 여러 좌석에서 반납했다면 기존 좌석별로 나눠 같은 신청에 담음", () => {
  const entries = buildReborrowEntries([row(), row({ rowIndex: 2, floor: "2F", unit: "Unit 3" })], "now");
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((e) => [e.floor, e.unit]), [["B2", "Unit 1"], ["2F", "Unit 3"]]);
});
test("새 좌석을 선택하면 모든 물품의 새 대여 좌석만 바뀜", () => {
  const entries = buildReborrowEntries([row(), row({ floor: "2F", unit: "Unit 3" })], "now", undefined, { floor: "B1", unit: "Unit 9" });
  assert.equal(entries.length, 1); assert.equal(entries[0].borrowedItems!.length, 2);
  assert.equal(entries[0].floor, "B1"); assert.equal(entries[0].unit, "Unit 9");
});
test("기존 좌석이 없는 기록은 새 좌석을 지정해야 처리됨", () => {
  assert.throws(() => buildReborrowEntries([row({ floor: "", unit: "" })], "now"), /새 좌석/);
  assert.equal(buildReborrowEntries([row({ floor: "", unit: "" })], "now", undefined, { floor: "B2", unit: "Unit 2" })[0].unit, "Unit 2");
});
test("다른 사람 명의에도 새 좌석이 적용되고 이전 이메일은 전달하지 않음", () => {
  const [entry] = buildReborrowEntries([row({ email: "old@example.com" })], "now", { name: "다른 사용자", employeeId: "2222", affiliation: "cfgw" }, { floor: "2F", unit: "Unit 4" });
  assert.equal(entry.employeeId, "2222"); assert.equal(entry.borrowerName, "다른 사용자");
  assert.equal(entry.knownEmail, undefined); assert.equal(entry.unit, "Unit 4");
});
test("미반납·빈 기록·다른 대여자 혼합 신청은 차단", () => {
  assert.throws(() => buildReborrowEntries([], "now"), /기록이 없습니다/);
  assert.throws(() => buildReborrowEntries([row({ returned: false })], "now"), /반납 완료/);
  assert.throws(() => buildReborrowEntries([row(), row({ employeeId: "2222" })], "now"), /별도 신청/);
});
