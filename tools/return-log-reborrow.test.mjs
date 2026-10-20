import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = ts.createSourceFile("ScenarioLogsPage.tsx", await readFile(new URL("../src/components/ScenarioLogsPage.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let opener;
let returnClick;
let cancelClick;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "openReBorrowModal") opener = node.getText(source);
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    const attrs = node.attributes.properties;
    const title = attrs.find(a => a.name?.getText(source) === "title");
    const handler = attrs.find(a => a.name?.getText(source) === (node.tagName.getText(source) === "CancelLogsPanel" ? "onReborrow" : "onClick"));
    if (title?.initializer?.text?.startsWith("반납완료된 항목을 다시 대여")) returnClick = handler.initializer.expression.getText(source);
    if (node.tagName.getText(source) === "CancelLogsPanel") cancelClick = handler.initializer.expression.getText(source);
  }
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(opener && returnClick && cancelClick, "실제 화면의 재대여 함수와 두 진입점을 찾는다");

function setup(selected) {
  const state = { toasts: [] };
  const deps = { isAdmin: true, selEntries: selected, showToast: (...args) => state.toasts.push(args), variantLostEntries: () => [] };
  for (const key of ["ReborrowFrom", "ReborrowTargetName", "ReborrowTargetEmpId", "ReborrowTargetAffiliation", "ReborrowSameName", "ReborrowSeatMode", "ReborrowFloor", "ReborrowUnit", "ReborrowModalOpen"]) deps[`set${key}`] = value => { state[key] = value; };
  const code = ts.transpile(`${opener}\nreturn { returned: ${returnClick}, cancelled: ${cancelClick} };`, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None });
  return { state, handlers: new Function(...Object.keys(deps), code)(...Object.values(deps)) };
}

const row = { returned: true, borrowerName: "반납자", floor: "B1", unit: "Unit 1" };
test("반납 로그 버튼 클릭 이벤트를 품목 목록으로 해석하지 않고 선택한 반납 건으로 창을 연다", () => {
  const { state, handlers } = setup([row, { ...row, returned: false }]);
  handlers.returned({ type: "click", nativeEvent: {} });
  assert.deepEqual(state.toasts, []);
  assert.equal(state.ReborrowModalOpen, true);
  assert.equal(state.ReborrowFrom, null);
  assert.equal(state.ReborrowTargetName, "반납자");
  assert.equal(state.ReborrowSeatMode, "same");
});

test("반납 품목이 없으면 반납 품목 선택 안내를 표시한다", () => {
  const { state, handlers } = setup([]);
  handlers.returned({ type: "click" });
  assert.match(state.toasts[0][0], /반납완료/);
  assert.equal(state.ReborrowModalOpen, undefined);
});

test("취소 로그는 전달받은 선택 목록으로 재대여 창을 연다", () => {
  const { state, handlers } = setup([]);
  const cancelled = [{ ...row, borrowerName: "취소 신청자" }];
  handlers.cancelled(cancelled);
  assert.deepEqual(state.toasts, []);
  assert.equal(state.ReborrowFrom, cancelled);
  assert.equal(state.ReborrowModalOpen, true);
  assert.equal(state.ReborrowTargetName, "취소 신청자");
});
