import { all, get } from "../db.js";
import { padSlot, parseItemLabel } from "./borrowUtils.js";
import { registeredUser } from "./registeredUsers.js";

/** 신청 화면용 읽기 전용 조회. 연락처·사번·보관 위치·전체 이력은 반환하지 않는다. */
export function itemBorrowers({ category = "scenario", itemId, variantId } = {}) {
  if (!["scenario", "tablecloth"].includes(category)) throw new Error("조회할 물품 종류가 올바르지 않습니다.");
  if (!String(itemId ?? "").trim()) throw new Error("물품 번호가 필요합니다.");
  const hasVariant = variantId !== undefined && variantId !== "";
  const selectedVariant = hasVariant ? Number(variantId) : null;
  if (hasVariant && (!Number.isInteger(selectedVariant) || selectedVariant <= 0 || category !== "scenario")) {
    throw new Error("조회할 물품 종류 번호가 올바르지 않습니다.");
  }
  const id = category === "scenario" ? padSlot(itemId) : Number(itemId);
  if (category === "scenario" && !get("SELECT id FROM scenario_items WHERE id = ?", [id])) return [];
  if (category === "tablecloth" && !get("SELECT id FROM tablecloth_items WHERE id = ?", [id])) return [];
  const variants = category === "scenario" ? all("SELECT id, name FROM scenario_item_variants WHERE item_id = ?", [id]) : [];
  if (hasVariant && !variants.some((variant) => variant.id === selectedVariant)) return [];
  const active = "(returned IS NULL OR returned != 'O') AND (status = 'active' OR status IS NULL OR status = '')";
  const common = "id, borrower_name, employee_id, qty, variant_id, variant_pending, picked_up_at";
  const rows = category === "tablecloth"
    ? all(`SELECT id, borrower_name, employee_id, qty, picked_up_at FROM tablecloth_rentals WHERE item_id = ? AND ${active} ORDER BY id DESC`, [id])
    : [
        ...all(`SELECT id, borrower_name, employee_id, item_label, variant_id, variant_pending, picked_up_at FROM sid_rentals WHERE ${active} ORDER BY id DESC`)
          .filter((row) => padSlot(parseItemLabel(row.item_label).id) === id)
          .map((row) => ({ ...row, qty: parseItemLabel(row.item_label).quantity })),
        ...all(`SELECT ${common}, item_id FROM general_rentals WHERE ${active} ORDER BY id DESC`)
          .filter((row) => padSlot(row.item_id) === id),
      ];
  return rows
    .filter((row) => !hasVariant || Number(row.variant_id) === selectedVariant)
    .map((row) => ({
      borrowerName: registeredUser(row.employee_id)?.name || row.borrower_name || "이름 없음",
      quantity: row.qty == null ? 1 : Number(row.qty),
      pickedUp: !!row.picked_up_at,
      variantName: row.variant_pending === "Y" ? "종류 미정" : variants.find((variant) => variant.id === row.variant_id)?.name || "",
    }))
    .filter((row) => Number.isFinite(row.quantity) && row.quantity > 0);
}
