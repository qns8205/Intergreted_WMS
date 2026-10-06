import test from "node:test";
import assert from "node:assert/strict";
import { parsePenaltyInput } from "./penaltyInput.js";

test("정상 입력은 다듬어서 돌려준다", () => {
  assert.deepEqual(
    parsePenaltyInput({ name: "  홍길동 ", maxTypes: "5", reason: " 장비 분실 ", expiresAt: "2026-10-20" }),
    { name: "홍길동", maxTypes: 5, reason: "장비 분실", expiresAt: "2026-10-20" },
  );
  assert.equal(parsePenaltyInput({ name: "a", maxTypes: 0 }).maxTypes, 0, "0종(대여 금지)도 허용");
});

test("비어 있는 선택 항목은 null이다(기한 없음·사유 없음·무제한)", () => {
  assert.deepEqual(parsePenaltyInput({ name: "홍길동", maxTypes: "", reason: "  ", expiresAt: "" }), { name: "홍길동", maxTypes: null, reason: null, expiresAt: null });
  assert.deepEqual(parsePenaltyInput({ name: "홍길동" }), { name: "홍길동", maxTypes: null, reason: null, expiresAt: null });
});

test("이름은 필수이고 50자 이내", () => {
  assert.throws(() => parsePenaltyInput({ name: "   " }), /이름/);
  assert.throws(() => parsePenaltyInput({}), /이름/);
  assert.throws(() => parsePenaltyInput({ name: "가".repeat(51) }), /50자/);
});

test("최대 종류는 0 이상의 정수", () => {
  for (const bad of ["-1", "2.5", "abc", "1000", "NaN"]) assert.throws(() => parsePenaltyInput({ name: "a", maxTypes: bad }), /정수/, `거절돼야 함: ${bad}`);
});

test("해제일은 실제로 있는 날짜(YYYY-MM-DD)만 받는다", () => {
  assert.equal(parsePenaltyInput({ name: "a", expiresAt: "2028-02-29" }).expiresAt, "2028-02-29", "윤년");
  for (const bad of ["내일쯤", "2026-02-30", "2026-13-01", "2027-02-29", "26-10-20", "2026/10/20", "2026-10-20 12:00", "2026-1-5"]) {
    assert.throws(() => parsePenaltyInput({ name: "a", expiresAt: bad }), /해제일/, `거절돼야 함: ${bad}`);
  }
});

test("수정할 때 예전 형식의 해제일이 그대로면 통과하고, 바꾸면 검증한다", () => {
  const legacy = "2026-10-20 12:00:00";
  assert.equal(parsePenaltyInput({ name: "a", expiresAt: legacy }, { keepExpiresAt: legacy }).expiresAt, legacy);
  assert.throws(() => parsePenaltyInput({ name: "a", expiresAt: "곧" }, { keepExpiresAt: legacy }), /해제일/);
  // 저장된 값과 다르면 예전 형식이라도 새로 넣을 수 없다.
  assert.throws(() => parsePenaltyInput({ name: "a", expiresAt: "2026-10-21 12:00:00" }, { keepExpiresAt: legacy }), /해제일/);
});

test("사유는 500자 이내", () => {
  assert.equal(parsePenaltyInput({ name: "a", reason: "가".repeat(500) }).reason.length, 500);
  assert.throws(() => parsePenaltyInput({ name: "a", reason: "가".repeat(501) }), /500자/);
});
