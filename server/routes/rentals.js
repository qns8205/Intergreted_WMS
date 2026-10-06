import { Router } from "express";
import { get, run, transaction } from "../db.js";
import { toRentLog } from "../lib/serialize.js";
import { nowKst } from "../lib/time.js";
import { normalizeEmployeeId, registeredUsersByName, resolveRegisteredIdentity } from "../lib/registeredUsers.js";

export const rentalsRouter = Router();

const DELTA_BY_TYPE = { "대여": -1, "반납": 1, "소모": -1 };

rentalsRouter.post("/rentals", (req, res) => {
  const { type, location, name, qty, user, employeeId, note } = req.body || {};
  const sign = DELTA_BY_TYPE[type] ?? 0;
  const qtyNum = Number(qty) || 0;
  const now = nowKst();

  const logRow = transaction(() => {
    const item = get("SELECT * FROM warehouse_items WHERE location = ? AND name = ?", [location, name]);
    let stockChange = null;
    if (item) {
      const currentStock = Number(item.stock);
      if (!Number.isNaN(currentStock) && sign !== 0 && qtyNum !== 0) {
        const nextStock = currentStock + sign * qtyNum;
        run("UPDATE warehouse_items SET stock = ? WHERE id = ?", [String(nextStock), item.id]);
        stockChange = { before: currentStock, after: nextStock, diff: nextStock - currentStock };
      }
    }
    let identity = resolveRegisteredIdentity(employeeId, user);
    if (!identity.ok && !String(employeeId || "").trim()) {
      const matches = registeredUsersByName(user);
      if (matches.length === 1) identity = { ok: true, employeeId: matches[0].employee_id, name: matches[0].name };
    }
    const manager = identity.ok ? identity.name : (user ?? null);
    if (item && stockChange) {
      run(
        `INSERT INTO inventory_history (occurred_at, category, ref_id, item_name, before_val, after_val, diff, reason, manager) VALUES (?, 'inventory', ?, ?, ?, ?, ?, ?, ?)`,
        [now, String(item.id), item.name, stockChange.before, stockChange.after, stockChange.diff, `공구 ${type || "재고 변경"}`, manager]
      );
    }
    const result = run(
      `INSERT INTO warehouse_rental_logs (occurred_at, type, location, name, qty, manager, employee_id, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [now, type ?? null, location ?? null, name ?? null, qtyNum, manager, identity.ok ? identity.employeeId : (normalizeEmployeeId(employeeId) || null), note ?? null]
    );
    return get("SELECT * FROM warehouse_rental_logs WHERE id = ?", [result.lastInsertRowid]);
  });

  res.json({ success: true, log: toRentLog(logRow) });
});
