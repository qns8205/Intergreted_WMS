import test from "node:test";
import assert from "node:assert/strict";
import { rentalSidLabel, rentalSidLabels } from "./rentalSid.ts";
import { smartMatch } from "./search.ts";

test("SID 대여만 원래 번호를 표시하고 일반·COS 대여와 빈 SID는 제외", () => {
  assert.equal(rentalSidLabel({sheetType:"scenario",scenarioId:" 000123 "}), "SID 000123");
  assert.equal(rentalSidLabel({sheetType:"scenario",scenarioId:"0"}), "SID 0");
  for (const item of [{sheetType:"general",scenarioId:"123"}, {sheetType:"warehouse",scenarioId:"123"},
    {sheetType:"scenario"}, {sheetType:"scenario",scenarioId:"   "}]) assert.equal(rentalSidLabel(item), "");
});

test("한 대여자의 여러 SID를 중복 없이 표시하며 SID 번호로 검색", () => {
  const items = [{sheetType:"scenario",scenarioId:"000123"}, {sheetType:"scenario",scenarioId:"000123"},
    {sheetType:"scenario",scenarioId:"000456"}, {sheetType:"general"}];
  assert.deepEqual(rentalSidLabels(items), ["SID 000123", "SID 000456"]);
  assert.equal(smartMatch(rentalSidLabels(items), "SID 000456"), true);
  assert.equal(smartMatch(rentalSidLabels(items), "999999"), false);
});
