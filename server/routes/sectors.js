import { Router } from "express";
import { run, transaction } from "../db.js";

export const sectorsRouter = Router();

sectorsRouter.put("/sectors", (req, res) => {
  const sectors = req.body?.sectors || [];
  transaction(() => {
    for (const s of sectors) {
      run(
        `INSERT INTO sectors (id, name, x, y, width, height, rotation, color) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, x=excluded.x, y=excluded.y, width=excluded.width, height=excluded.height, rotation=excluded.rotation, color=excluded.color`,
        [s.id, s.name ?? null, s.x ?? 0, s.y ?? 0, s.width ?? 0, s.height ?? 0, s.rotation ?? 0, s.color ?? null]
      );
    }
  });
  res.json({ success: true });
});

sectorsRouter.delete("/sectors/:id", (req, res) => {
  run("DELETE FROM sectors WHERE id = ?", [req.params.id]);
  res.json({ success: true });
});
