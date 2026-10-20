import test from "node:test";
import assert from "node:assert/strict";
import { recentNotices, carryNoticeTimes, NOTICE_POPUP_HOURS } from "./notices.js";

// 서울 시각 문자열("YYYY-MM-DD HH:mm:ss")을 서버가 읽는 방식과 같게 만들어 쓴다.
const at = (s) => new Date(s.replace(" ", "T")).getTime();
const row = (createdAt, extra = {}) => ({ created_at: createdAt, title: "제목", content: "내용", author: "관리자", ...extra });

test("48시간 이내 공지만 팝업 대상이다", () => {
  const now = at("2026-10-08 12:00:00");
  const rows = [
    row("2026-10-08 11:59:00", { content: "방금" }),
    row("2026-10-06 12:00:01", { content: "47시간 59분 전" }),
    row("2026-10-06 12:00:00", { content: "정확히 48시간 전" }),
    row("2026-10-06 11:59:59", { content: "48시간 1초 전" }),
    row("2026-09-01 09:00:00", { content: "한 달 전" }),
  ];
  assert.deepEqual(recentNotices(rows, now).map((n) => n.text), ["방금", "47시간 59분 전", "정확히 48시간 전"]);
  assert.equal(NOTICE_POPUP_HOURS, 48);
});

test("작성 시각이 비었거나 읽을 수 없으면 오래된 공지로 본다(팝업에 띄우지 않는다)", () => {
  const now = at("2026-10-08 12:00:00");
  assert.deepEqual(recentNotices([row(null), row(""), row("어제쯤")], now), []);
});

test("예전에 UTC(Z)로 저장된 시각도 실제 시각으로 비교한다", () => {
  // 2026-10-08 02:30:00Z = 서울 11:30 → 12시 기준 30분 전
  const now = at("2026-10-08 12:00:00");
  assert.equal(recentNotices([row("2026-10-08T02:30:00Z")], now).length, 1);
  // 2026-10-05 02:30:00Z = 서울 10/05 11:30 → 72시간 전
  assert.equal(recentNotices([row("2026-10-05T02:30:00Z")], now).length, 0);
});

test("공지는 제목·내용·시각·작성자를 화면용 모양으로 돌려준다", () => {
  const [n] = recentNotices([row("2026-10-08 11:00:00", { title: "점검", content: "오늘 밤 점검", author: "홍길동" })], at("2026-10-08 12:00:00"));
  assert.deepEqual(n, { title: "점검", text: "오늘 밤 점검", updatedAt: "2026-10-08 11:00:00", author: "홍길동" });
});

test("저장할 때 바뀌지 않은 공지는 원래 작성 시각을 이어받는다", () => {
  const existing = [row("2026-10-01 09:00:00", { title: "A", content: "옛 공지", author: "김관리" })];
  const out = carryNoticeTimes(existing, [{ title: "A", text: "옛 공지" }, { title: "B", text: "새 공지" }], "2026-10-08 12:00:00", "박관리");
  assert.deepEqual(out, [
    { createdAt: "2026-10-01 09:00:00", author: "김관리" },
    { createdAt: "2026-10-08 12:00:00", author: "박관리" },
  ]);
});

test("내용을 고친 공지는 새로 작성한 것으로 보고 지금 시각을 찍는다", () => {
  const existing = [row("2026-10-01 09:00:00", { title: "A", content: "오타 있는 공지" })];
  const out = carryNoticeTimes(existing, [{ title: "A", text: "오타 고친 공지" }], "2026-10-08 12:00:00", "관리자");
  assert.deepEqual(out, [{ createdAt: "2026-10-08 12:00:00", author: "관리자" }]);
});

test("앞뒤 공백 차이는 같은 공지로 본다", () => {
  const existing = [row("2026-10-01 09:00:00", { title: "A", content: "내용" })];
  const [out] = carryNoticeTimes(existing, [{ title: " A ", text: "내용\n" }], "2026-10-08 12:00:00", "관리자");
  assert.equal(out.createdAt, "2026-10-01 09:00:00");
});

test("같은 내용이 여러 개여도 기존 행을 하나씩만 짝짓는다", () => {
  const existing = [row("2026-10-01 09:00:00", { title: "A", content: "같음" })];
  const out = carryNoticeTimes(existing, [{ title: "A", text: "같음" }, { title: "A", text: "같음" }], "2026-10-08 12:00:00", "관리자");
  assert.deepEqual(out.map((o) => o.createdAt), ["2026-10-01 09:00:00", "2026-10-08 12:00:00"]);
});

test("기존 공지가 없으면 모두 지금 시각이다", () => {
  const out = carryNoticeTimes([], [{ text: "새" }], "2026-10-08 12:00:00", null);
  assert.deepEqual(out, [{ createdAt: "2026-10-08 12:00:00", author: null }]);
});

import { popupStatus, noticesForEditor } from "./notices.js";

test("팝업 상태: 남은 시간·종료 여부를 분 단위로 계산한다", () => {
  const now = at("2026-10-08 12:00:00");
  assert.deepEqual(popupStatus("2026-10-08 11:00:00", now), { active: true, remainingMinutes: 47 * 60, ageMinutes: 60 });
  assert.deepEqual(popupStatus("2026-10-06 12:00:00", now), { active: true, remainingMinutes: 0, ageMinutes: 48 * 60 }, "정확히 48시간 = 마지막 순간까지는 대상");
  assert.deepEqual(popupStatus("2026-10-06 11:00:00", now), { active: false, remainingMinutes: 0, ageMinutes: 49 * 60 });
  assert.deepEqual(popupStatus("", now), { active: false, remainingMinutes: 0, ageMinutes: null });
});

test("팝업 상태 판정은 recentNotices와 항상 같은 결과다(편집기 표시와 실제 팝업이 어긋나지 않는다)", () => {
  const now = at("2026-10-08 12:00:00");
  for (const created of ["2026-10-08 11:59:59", "2026-10-06 12:00:00", "2026-10-06 11:59:59", "2026-10-01 00:00:00", "", "어제"]) {
    assert.equal(popupStatus(created, now).active, recentNotices([row(created)], now).length === 1, `불일치: ${created}`);
  }
});

test("편집기용 공지 목록은 순서를 바꾸지 않고 팝업 상태를 붙인다", () => {
  const now = at("2026-10-08 12:00:00");
  const out = noticesForEditor([row("2026-10-08 11:00:00", { title: "A" }), row("2026-09-01 09:00:00", { title: "B" })], now);
  assert.deepEqual(out.map((n) => [n.title, n.popup.active]), [["A", true], ["B", false]]);
});
