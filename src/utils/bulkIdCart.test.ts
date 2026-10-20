import test from "node:test";
import assert from "node:assert/strict";
import { matchVariant, parseBulkIds, planBulkAdd } from "./bulkIdCart.ts";

const pad = (id: string) => /^\d+$/.test(id) ? id.padStart(6, "0") : id;
const catalog = [
  { id: "000101", name: "Mug", stock: 3 },
  { id: "000102", name: "Plate", stock: 0 },
  { id: "000103", name: "Shirt", stock: 5, variants: [
    { id: 1, name: "Red", stock: 2 }, { id: 2, name: "Blue Large", stock: 4 }, { id: 3, name: "Blue Small", stock: 1 },
  ] },
];

test("콤마·줄바꿈으로 나누고 수량·종류 표기를 읽는다", () => {
  const { tokens, invalid } = parseBulkIds("101, 000101*2\n103/red x3; 103(Blue Large) 2개, 104×4, abc, 105*0", pad);
  assert.deepEqual(invalid, ["abc", "105*0"]);
  assert.deepEqual(tokens.map((t) => [t.id, t.variant ?? "", t.qty]), [
    ["000101", "", 3], ["000103", "red", 3], ["000103", "Blue Large", 2], ["000104", "", 4],
  ]);
});

test("종류 이름은 대소문자·공백을 무시하고, 겹치면 고르지 않는다", () => {
  assert.equal(matchVariant(catalog[2].variants!, "blue large")?.id, 2);
  assert.equal(matchVariant(catalog[2].variants!, "red")?.id, 1);
  assert.equal(matchVariant(catalog[2].variants!, "Blue"), null);
  assert.equal(matchVariant(catalog[2].variants!, "small")?.id, 3);
});

test("재고와 장바구니에 이미 담긴 수량을 넘지 않게 줄이고, 못 담는 것은 이유별로 모은다", () => {
  const { tokens } = parseBulkIds("101*5, 102, 103/red*3, 103, 103/Blue*2, 999", pad);
  const plan = planBulkAdd(tokens, catalog, [{ id: "000101", quantity: 1 }, { id: "000103", variantId: 1, quantity: 1 }], pad);
  assert.deepEqual(plan.add.map((l) => [l.item.id, l.variantId ?? null, l.qty, l.requested]), [
    ["000101", null, 2, 5],   // 재고 3 - 장바구니 1
    ["000103", 1, 1, 3],      // Red 재고 2 - 장바구니 1
  ]);
  assert.deepEqual(plan.noStock.map((x) => x.name), ["Plate"]);
  assert.deepEqual(plan.needVariant.map((x) => [x.item.id, x.qty, x.hint ?? ""]), [["000103", 1, ""], ["000103", 2, "Blue"]]);
  assert.deepEqual(plan.unknown, ["999"]);
});

test("같은 입력 안에서 같은 줄을 나눠 적어도 재고를 두 번 쓰지 않는다", () => {
  const { tokens } = parseBulkIds("103/Red*1, 103/RED*5", pad);
  assert.equal(tokens.length, 1);
  const plan = planBulkAdd(tokens, catalog, [], pad);
  assert.deepEqual(plan.add.map((l) => l.qty), [2]);
});
