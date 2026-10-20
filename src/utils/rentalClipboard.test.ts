import test from "node:test";
import assert from "node:assert/strict";
import { copyRentalText, rentalItemName, rentalNamesText, rentalItemId, rentalIdsText } from "./rentalClipboard.ts";

test("물품 이름만 복사하며 ID·수량을 제외하고 괄호/종류 이름은 보존한다", () => {
  assert.equal(rentalItemName({ itemLabel: "[000202] Package Box (Extra Small) x 2" }), "Package Box (Extra Small)");
  assert.equal(rentalItemName({ itemLabel: "[000001] Box × 3" }), "Box");
  assert.equal(rentalItemName({ itemName: "Original Name", itemLabel: "[000001] Label x 2" }), "Original Name");
  assert.equal(rentalItemName({ name: "공구", itemLabel: "공구 x 3" }), "공구");
  assert.equal(rentalNamesText([{ itemLabel: "[000001] Box x 2" }, { itemLabel: "[000001] Box x 3" }, { itemName: "Bottle (White)" }]), "Box, Bottle (White)");
  assert.equal(rentalNamesText([]), "");
  assert.equal(rentalNamesText([{ itemName: "Box" }]), "Box");
});

test("HTTPS 복사 및 사내 HTTP/권한 거부 시 호환 복사 경로는 이름 그대로 전달하고 정리한다", async () => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  const elementDescriptor = Object.getOwnPropertyDescriptor(globalThis, "HTMLElement");
  try {
    let copied = "", removed = false, restored = false;
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async (text: string) => { copied = text; } } } });
    await copyRentalText("Box (Small)");
    assert.equal(copied, "Box (Small)");
    class Element { focus() { restored = true; } }
    Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: Element });
    const field = { value: "", readOnly: false, style: {}, focus() {}, select() {}, remove() { removed = true; } };
    Object.defineProperty(globalThis, "document", { configurable: true, value: {
      activeElement: new Element(), body: { appendChild() {} }, createElement() { return field; },
      execCommand(command: string) { assert.equal(command, "copy"); copied = field.value; return true; },
    } });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    await copyRentalText(rentalNamesText([{ itemName: "Pepsi Coke" }, { itemName: "Box (Small)" }]));
    assert.equal(copied, "Pepsi Coke, Box (Small)");
    assert.ok(removed && restored);
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async () => { throw new Error("denied"); } } } });
    await copyRentalText("Hammer");
    assert.equal(copied, "Hammer");
    await assert.rejects(copyRentalText(""), /복사할/);
  } finally {
    for (const [key, descriptor] of [["navigator", navigatorDescriptor], ["document", documentDescriptor], ["HTMLElement", elementDescriptor]] as const) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test("물품 ID는 itemId를 우선하고 없으면 라벨의 [번호]에서 뽑으며 6자리로 맞춘다", () => {
  assert.equal(rentalItemId({ itemId: "000045", itemLabel: "[000045] 텀블러 x 2" }), "000045");
  assert.equal(rentalItemId({ itemId: "45" }), "000045", "서버와 같은 규칙으로 6자리 맞춤");
  assert.equal(rentalItemId({ itemId: " 202 " }), "000202");
  assert.equal(rentalItemId({ itemLabel: "[000202] Package Box (Extra Small) x 2" }), "000202", "itemId가 없으면 라벨에서");
  assert.equal(rentalItemId({ itemLabel: "[7] Box" }), "000007");
  assert.equal(rentalItemId({ itemId: "000045", itemLabel: "[000099] 다른 번호" }), "000045", "itemId가 우선");
});

test("ID가 없는 물품(COS 공구 등)은 빈 문자열이다 — 이름을 ID처럼 내보내지 않는다", () => {
  assert.equal(rentalItemId({ sheetType: "warehouse", name: "전동 드라이버", itemLabel: "전동 드라이버 x 3" }), "");
  assert.equal(rentalItemId({ itemLabel: "공구 x 3" }), "");
  assert.equal(rentalItemId({ itemId: "", itemLabel: "" }), "");
  assert.equal(rentalItemId({}), "");
  assert.equal(rentalItemId({ itemId: "abc" }), "", "숫자가 없는 값은 ID로 보지 않는다");
});

test("목록 ID 복사: 중복을 제거하고 순서를 유지하며, 몇 종이 빠졌는지 알려준다", () => {
  const items = [
    { itemId: "000045", itemLabel: "[000045] 텀블러 x 2" },
    { itemId: "000046", itemLabel: "[000046] 접시 x 1" },
    { itemId: "000045", itemLabel: "[000045] 텀블러 x 1" },
    { sheetType: "warehouse", name: "전동 드라이버", itemLabel: "전동 드라이버 x 3" },
  ];
  assert.deepEqual(rentalIdsText(items), { text: "000045, 000046", count: 2, skipped: 1 });
  assert.deepEqual(rentalIdsText([]), { text: "", count: 0, skipped: 0 });
  assert.deepEqual(rentalIdsText([{ name: "공구", itemLabel: "공구" }]), { text: "", count: 0, skipped: 1 });
  assert.deepEqual(rentalIdsText([{ itemLabel: "[000001] A x 1" }, { itemLabel: "[000001] A x 2" }]), { text: "000001", count: 1, skipped: 0 });
});

test("ID 없는 물품이 여럿이어도 종류 수만큼 센다(같은 이름은 한 종류)", () => {
  const items = [
    { sheetType: "warehouse", name: "드라이버", itemLabel: "드라이버 x 1" },
    { sheetType: "warehouse", name: "드라이버", itemLabel: "드라이버 x 2" },
    { sheetType: "warehouse", name: "망치", itemLabel: "망치 x 1" },
  ];
  assert.equal(rentalIdsText(items).skipped, 2);
});

test("ID로 담기용 복사: 수량과 종류를 붙이고, 같은 물품·종류는 합치며, ID 없는 물품은 센다", async () => {
  const { rentalCartText } = await import("./rentalClipboard.ts");
  const { parseBulkIds } = await import("./bulkIdCart.ts");
  const result = rentalCartText([
    { itemId: "101", itemLabel: "[000101] Mug x 2", quantity: 2 },
    { itemLabel: "[000101] Mug", quantity: 1 },
    { itemId: "000103", itemLabel: "[000103] Shirt x 3", quantity: 3, variantName: "Red, Large" },
    { itemId: "000103", itemLabel: "[000103] Shirt", quantity: 1, variantName: "종류 미확인" },
    { itemId: "000104", itemLabel: "[000104] Cup", quantity: 1, variantName: "Blue", variantPending: true },
    { name: "드라이버", itemLabel: "드라이버 x 2", quantity: 2 },
  ]);
  assert.equal(result.text, "000101*3, 000103(Red Large)*3, 000103, 000104");
  assert.equal(result.count, 4);
  assert.equal(result.skipped, 1);
  // 복사한 그대로 "ID로 담기"에 붙여 넣으면 같은 수량·종류로 읽힌다.
  const pad = (id: string) => id.padStart(6, "0");
  assert.deepEqual(parseBulkIds(result.text, pad).tokens.map((t) => [t.id, t.variant ?? "", t.qty]),
    [["000101", "", 3], ["000103", "Red Large", 3], ["000103", "", 1], ["000104", "", 1]]);
});
