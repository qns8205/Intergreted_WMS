import test from "node:test";
import assert from "node:assert/strict";
import { rankBorrowerSeats } from "./borrowerSeatRecommendations.js";

test("한 신청의 SID/추가 물품과 여러 행은 유닛 이용 한 번으로 센다", () => {
  const rows = [
    { sheetType: "sid", id: 1, request_no: 11, batch_id: "sid", floor: "B2", unit: "Unit 1", borrow_date: "2026-09-01 10:00" },
    { sheetType: "general", id: 2, request_no: 11, batch_id: "extra", floor: "B2", unit: "Unit 1", borrow_date: "2026-09-01 10:00" },
    { sheetType: "general", id: 3, batch_id: "next", floor: "2F", unit: "Unit 1", borrow_date: "2026-09-02 10:00" },
    { sheetType: "general", id: 4, batch_id: "next", floor: "2F", unit: "Unit 1", borrow_date: "2026-09-02 10:00" },
    { sheetType: "general", id: 5, batch_id: "again", floor: "B2", unit: "Unit 1", borrow_date: "2026-09-03 10:00" },
  ];
  assert.deepEqual(rankBorrowerSeats(rows).map(({ floor, count }) => [floor, count]), [["B2", 2], ["2F", 1]]);
});

test("동률은 최근 이용순으로 추천하고 빈 좌석과 취소 신청은 제외한다", () => {
  const rows = [
    { sheetType: "general", id: 1, floor: "B1", unit: "Unit 1", borrow_date: "2026-09-01" },
    { sheetType: "general", id: 2, floor: "B2", unit: "Unit 1", borrow_date: "2026-09-02" },
    { sheetType: "general", id: 3, floor: "B2", unit: "", borrow_date: "2026-09-03" },
    { sheetType: "general", id: 4, floor: "2F", unit: "Unit 1", return_source: "cancel", borrow_date: "2026-09-04" },
  ];
  assert.deepEqual(rankBorrowerSeats(rows, 1), [{ floor: "B2", unit: "Unit 1", count: 1, lastUsedAt: "2026-09-02" }]);
});

test("옛 유닛명과 현재 유닛명을 연결하여 이용 횟수를 합산한다", () => {
  const rows = [
    { id: 1, sheetType: "general", batch_id: "old", floor: "2F", unit: "Unit 6", borrow_date: "2026-09-01" },
    { id: 2, sheetType: "general", batch_id: "new", floor: "2F", unit: "Unit 6 (Franka)", borrow_date: "2026-09-02" },
    { id: 3, sheetType: "general", batch_id: "human", floor: "2F", unit: "Human Unit 6", borrow_date: "2026-09-03" },
    { id: 4, sheetType: "general", batch_id: "removed", floor: "2F", unit: "Unit 1", borrow_date: "2026-09-04" },
  ];
  const floors = [{ id: "2F", units: [{ label: "Unit 6 (Franka)" }, { label: "Human Unit 6" }] }];
  assert.deepEqual(rankBorrowerSeats(rows, 3, floors), [
    { floor: "2F", unit: "Unit 6 (Franka)", count: 2, lastUsedAt: "2026-09-02" },
    { floor: "2F", unit: "Human Unit 6", count: 1, lastUsedAt: "2026-09-03" },
  ]);
});

test("옛 이름이 여러 유닛과 대응하거나 다른 층의 유닛이면 임의로 추천하지 않는다", () => {
  const floors = [{ id: "B2", units: [{ label: "Unit 6 (Franka)" }, { label: "Unit 6 (Vega)" }] }];
  const rows = [
    { id: 1, floor: "B2", unit: "Unit 6", borrow_date: "2026-09-01" },
    { id: 2, floor: "2F", unit: "Unit 6 (Franka)", borrow_date: "2026-09-02" },
  ];
  assert.deepEqual(rankBorrowerSeats(rows, 3, floors), []);
});
