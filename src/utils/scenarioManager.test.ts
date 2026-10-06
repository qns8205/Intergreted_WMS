import test from "node:test";
import assert from "node:assert/strict";
import { scenarioManagerObjectUrl } from "./scenarioManager.ts";

test("SM 상세 링크는 오브젝트 ID와 앞자리 0을 유지", () => {
  assert.equal(scenarioManagerObjectUrl("003449"), "https://sm.config.inc/object_detail/003449");
  assert.equal(scenarioManagerObjectUrl(" 000008 "), "https://sm.config.inc/object_detail/000008");
  assert.equal(scenarioManagerObjectUrl(""), "");
});
test("ID는 URL 경로 한 구간으로 안전하게 인코딩", () => {
  assert.equal(scenarioManagerObjectUrl("123/456?x=1"), "https://sm.config.inc/object_detail/123%2F456%3Fx%3D1");
});
