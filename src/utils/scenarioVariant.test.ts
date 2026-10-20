import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { scenarioVariantText } from "./scenarioVariant.ts";

test("종류 표시에서 미정·미확인을 구분하고 종류 없는 물품에는 빈 값을 반환한다", () => {
  assert.equal(scenarioVariantText({variantName:'화이트'}), '화이트');
  assert.equal(scenarioVariantText({variantName:'이전 이름',variantPending:true}), '미정');
  assert.equal(scenarioVariantText({variantUnassigned:true}), '미확인');
  assert.equal(scenarioVariantText({variantName:'종류 미정'}), '미정');
  assert.equal(scenarioVariantText({}), '');
});

test("사진·대여자·내 대여·무인·로그·반납 확인에 종류 표시가 연결된다", async () => {
  for (const file of ['ReturnPhotosPage','ItemBorrowersModal','MyRentalList','UnattendedReturnPage','ScenarioLogsPage','AdminReturnPage']) {
    const source = await readFile(`src/components/${file}.tsx`, 'utf8');
    assert.ok(source.includes('종류:'), `${file} 종류 라벨`);
  }
  const source = await readFile('src/components/AdminReturnPage.tsx', 'utf8');
  assert.match(source, /variantId: c.variantId,[\s\S]*itemLabel: c.itemLabel/);
});
