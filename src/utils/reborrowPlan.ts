import type { BorrowEntry, ScenarioLogEntry } from "./borrowApi";

export type ReborrowTarget = { name: string; affiliation?: string; employeeId?: string };
export type ReborrowSeat = { floor: string; unit: string };

/** 한 사람의 반납 기록을 좌석별로 나눠 새 신청을 만든다. 원래 반납 기록은 변경하지 않는다. */
export function buildReborrowEntries(
  logs: ScenarioLogEntry[], borrowDate: string, target?: ReborrowTarget, seat?: ReborrowSeat,
): BorrowEntry[] {
  if (!logs.length) throw new Error("재대여할 반납 기록이 없습니다.");
  if (logs.some((log) => !log.returned)) throw new Error("반납 완료된 물품만 재대여할 수 있습니다.");
  const entries = new Map<string, BorrowEntry>();
  for (const log of logs) {
    const floor = String(seat ? seat.floor : log.floor || "").trim();
    const unit = String(seat ? seat.unit : log.unit || "").trim();
    if (!floor || !unit) throw new Error("기존 좌석이 없는 기록입니다. 새 좌석을 선택해주세요.");
    const borrowerName = target?.name.trim() || log.borrowerName;
    const employeeId = target ? (target.employeeId?.trim() || "") : (log.employeeId || "");
    const knownEmail = target ? undefined : (log.email || undefined);
    const key = JSON.stringify([employeeId || knownEmail || borrowerName, floor, unit]);
    let entry = entries.get(key);
    if (!entry) {
      entry = {
        itemType: "general", borrowerName, employeeId, knownEmail,
        affiliation: target?.affiliation || "", borrowDate,
        borrowPurpose: log.borrowPurpose || "재대여", generalOption: "재대여",
        floor, unit, borrowedItems: [],
      };
      entries.set(key, entry);
    }
    entry.borrowedItems!.push({ id: log.itemId, name: log.itemName, quantity: log.quantity,
      ...(log.variantId ? { variantId: log.variantId } : {}) });
  }
  // recordBorrow는 한 신청의 모든 줄을 첫 번째 대여자 명의로 저장하므로 혼합 명의를 막는다.
  if (!target && new Set(logs.map((log) => log.employeeId || log.email || log.borrowerName)).size > 1) {
    throw new Error("서로 다른 대여자는 별도 신청으로 처리해주세요.");
  }
  return [...entries.values()];
}
