import { run } from "../db.js";
import { parseItemLabel, restoreRentalStock } from "./borrowUtils.js";

/** caller의 트랜잭션 안에서 미수령 줄을 한 번만 닫고, 차감한 재고를 복구한다. */
export function cancelUnclaimedRental(table, row, now, reason = "[미수령 자동 취소]", {cancelBy="auto",cancelActor=null} = {}) {
  if (!["sid_rentals","general_rentals"].includes(table)) throw Error("대여 장부를 확인해주세요.");
  const parsed = table === "sid_rentals" ? parseItemLabel(row.item_label) : null;
  if (parsed && !parsed.id && !parsed.name) return false;
  const purpose = `${row.purpose || ""}${row.purpose ? " " : ""}${reason}`;
  if (!["auto","admin","self"].includes(cancelBy)) throw Error("취소 처리자를 확인해주세요.");
  const result = run(`UPDATE ${table} SET returned='O',return_date=?,status='archived',purpose=?,return_source='cancel',cancel_by=?,cancel_actor=?
    WHERE id=? AND status='active' AND picked_up_at IS NULL AND (returned IS NULL OR returned!='O')`,[now,purpose,cancelBy,cancelActor,row.id]);
  if (!result.changes) return false;
  restoreRentalStock(row, parsed ? parsed.id : row.item_id, parsed ? parsed.quantity || 1 : row.qty || 1);
  return true;
}
