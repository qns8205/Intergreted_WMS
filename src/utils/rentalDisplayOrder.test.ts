import test from "node:test";
import assert from "node:assert/strict";
import { locationSortIndex } from "../../server/lib/locationSort.js";
import { sortReverseQrLocation } from "./rentalDisplayOrder.ts";

test("QR 창고 동선과 정확히 반대 순서: 맞은편 선반·낮은 번호·10만번대 포함", () => {
  const items = ['0','185','186','119','100000','180','114','59','251','120','60','100025'].map(location => ({location}));
  const qr = [...items].sort((a,b) => locationSortIndex(a.location)-locationSortIndex(b.location));
  assert.deepEqual(qr.map(i => i.location), ['186','251','185','180','119','114','60','120','0','59','100000','100025']);
  assert.deepEqual(sortReverseQrLocation(items), [...qr].reverse());
});

test("같은 위치·누락 위치도 QR 역순이며 원본·SID·수량을 그대로 보존", () => {
  const items = [{location:'000185',scenarioId:'00123',quantity:2}, {location:'185',scenarioId:'00456',quantity:3},
    {location:'',scenarioId:'00789',quantity:1}, {scenarioId:'01000',quantity:4}];
  const snapshot = structuredClone(items);
  const qr = [...items].sort((a,b) => locationSortIndex(a.location)-locationSortIndex(b.location));
  assert.deepEqual(sortReverseQrLocation(items), [...qr].reverse());
  assert.deepEqual(items, snapshot);
  assert.equal(sortReverseQrLocation(items).reduce((sum,it) => sum+it.quantity,0),10);
  assert.deepEqual(sortReverseQrLocation([]), []);
});
