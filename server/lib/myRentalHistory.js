import { all, get } from "../db.js";
import { parseItemLabel, padSlot, expectedEmailFor, matchesBorrowerIdentity } from "./borrowUtils.js";
import { employeeIdForRentalRow, registeredUser } from "./registeredUsers.js";
import { workdayDateKey, returnedThisWorkday, isRentalCancelled } from "./workday.js";
import { scenarioVariantInfo } from "./scenarioVariantDisplay.js";

// QR에 있던 이번 작업일 처리 내역. 조회 전용이며 위치/구매 링크/메모는 반환하지 않는다.
export function myRentalHistory(query, now = new Date()) {
  const name = String(query.name || "").trim();
  if (!name) return [];
  const employeeId = String(query.employeeId || "").trim();
  const expectedEmail = expectedEmailFor({ ...query, name });
  const workday = workdayDateKey(now);
  const items = [];
  for (const [table, sheetType] of [["sid_rentals", "scenario"], ["general_rentals", "general"]]) {
    for (const row of all(`SELECT * FROM ${table} WHERE returned = 'O' ORDER BY id DESC`)) {
      if (!returnedThisWorkday(row, workday)) continue;
      const rowEmployeeId = employeeIdForRentalRow(row);
      const borrowerName = registeredUser(rowEmployeeId)?.name || row.borrower_name;
      const samePerson = /^\d{4}$/.test(employeeId)
        ? rowEmployeeId === employeeId
        : matchesBorrowerIdentity({ borrowerName, email: row.email }, name, expectedEmail);
      if (!samePerson) continue;
      const parsed = sheetType === "scenario" ? parseItemLabel(row.item_label) : null;
      const itemId = padSlot(parsed ? parsed.id : row.item_id);
      const object = itemId ? get("SELECT name, image_path FROM scenario_items WHERE id = ?", [itemId]) : null;
      const itemName = parsed ? parsed.name : row.item_label;
      const quantity = parsed ? parsed.quantity || 1 : Number(row.qty) || 1;
      items.push({
        sheetType, rowIndex: row.id, borrowerName, employeeId: rowEmployeeId,
        itemId, itemName: itemName || object?.name || "물품",
        itemLabel: sheetType === "scenario" ? row.item_label : `${itemId ? `[${itemId}] ` : ""}${itemName || "물품"}${quantity > 1 ? ` x ${quantity}` : ""}`,
        quantity, scenarioId: row.sid || "", generalOption: row.category || "",
        borrowDate: row.applied_at || row.borrow_date || "", returnDate: row.return_date,
        returnSource: isRentalCancelled(row) ? "cancel" : row.return_source || "",
        cancelled: isRentalCancelled(row), image: object?.image_path || "",
        ...scenarioVariantInfo(itemId, row), location: "",
      });
    }
  }
  return items.sort((a, b) => String(b.returnDate).localeCompare(String(a.returnDate)) || b.rowIndex - a.rowIndex);
}
