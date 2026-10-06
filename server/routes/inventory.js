import { Router } from "express";
import { get, run, transaction } from "../db.js";
import { toInventoryItem } from "../lib/serialize.js";
import { maybeSaveImage } from "../lib/images.js";
import { nowKst } from "../lib/time.js";

export const inventoryRouter = Router();

inventoryRouter.post("/inventory", async (req, res, next) => {
  try {
    const item = req.body || {};
    const result = run(
      `INSERT INTO warehouse_items (location, subcategory, name, purchase_link, stock, updated_at, manager, manager2, note, image_path, keywords, consumable)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.location ?? null, item.spec ?? null, item.name ?? null, item.link ?? null,
        item.stock ?? null, item.updatedAt ?? nowKst(), item.manager ?? null,
        item.manager2 ?? null, item.note ?? null, null, item.keywords ?? null, item.consumable ?? null,
      ]
    );
    const id = result.lastInsertRowid;
    const imagePath = await maybeSaveImage(item.photo, "warehouse_items", id);
    if (imagePath) run("UPDATE warehouse_items SET image_path = ? WHERE id = ?", [imagePath, id]);
    const row = get("SELECT * FROM warehouse_items WHERE id = ?", [id]);
    res.json({ success: true, item: toInventoryItem(row) });
  } catch (err) {
    next(err);
  }
});

inventoryRouter.put("/inventory/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const item = req.body || {};
    const existing = get("SELECT * FROM warehouse_items WHERE id = ?", [id]);
    if (!existing) return res.status(404).json({ success: false, error: "물품을 찾을 수 없습니다." });
    if (item.stock !== undefined && String(item.stock ?? "") !== String(existing.stock ?? "")) {
      return res.status(400).json({ success: false, error: "등록된 물품의 재고는 편집에서 바꿀 수 없습니다. '재고 변경'을 이용해주세요." });
    }
    const imagePath = await maybeSaveImage(item.photo, "warehouse_items", id);
    run(
      `UPDATE warehouse_items SET location=?, subcategory=?, name=?, purchase_link=?, stock=?, updated_at=?, manager=?, manager2=?, note=?, image_path=?, keywords=?, consumable=? WHERE id=?`,
      [
        item.location ?? null, item.spec ?? null, item.name ?? null, item.link ?? null,
        existing.stock, item.updatedAt ?? nowKst(), item.manager ?? null,
        item.manager2 ?? null, item.note ?? null, imagePath, item.keywords ?? null, item.consumable ?? null, id,
      ]
    );
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

inventoryRouter.patch("/inventory/bulk", (req, res) => {
  const items = req.body?.items || [];
  for (const item of items) {
    const existing = get("SELECT stock FROM warehouse_items WHERE id = ?", [Number(item.rowIndex)]);
    if (existing && item.stock !== undefined && String(item.stock ?? "") !== String(existing.stock ?? "")) {
      return res.status(400).json({ success: false, error: `'${item.name || item.rowIndex}'의 재고는 일괄 편집에서 바꿀 수 없습니다. '재고 변경'을 이용해주세요.` });
    }
  }
  transaction(() => {
    for (const item of items) {
      const existing = get("SELECT stock FROM warehouse_items WHERE id = ?", [Number(item.rowIndex)]);
      run(
        `UPDATE warehouse_items SET location=?, subcategory=?, name=?, purchase_link=?, stock=?, updated_at=?, manager=?, manager2=?, note=?, keywords=?, consumable=? WHERE id=?`,
        [
          item.location ?? null, item.spec ?? null, item.name ?? null, item.link ?? null,
          existing?.stock ?? null, item.updatedAt ?? nowKst(), item.manager ?? null,
          item.manager2 ?? null, item.note ?? null, item.keywords ?? null, item.consumable ?? null,
          item.rowIndex,
        ]
      );
    }
  });
  res.json({ success: true });
});

inventoryRouter.delete("/inventory/:id", (req, res) => {
  run("DELETE FROM warehouse_items WHERE id = ?", [Number(req.params.id)]);
  res.json({ success: true });
});
