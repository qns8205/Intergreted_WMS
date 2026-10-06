import { Router } from "express";
import { get, run } from "../db.js";
import { toDefectLog } from "../lib/serialize.js";
import { maybeSaveImage } from "../lib/images.js";
import { nowKst } from "../lib/time.js";

export const defectLogsRouter = Router();

defectLogsRouter.post("/defect-logs", async (req, res, next) => {
  try {
    const log = req.body || {};
    const result = run(
      `INSERT INTO defect_logs (product, qty, occurred_date, defect_type, detail, action_taken, image_path, breaker)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        log.name ?? null, log.qty ?? null, log.timestamp ?? nowKst(),
        log.defectType ?? null, log.note ?? null, log.actionTaken ?? null, null, log.manager ?? null,
      ]
    );
    const id = result.lastInsertRowid;
    const imagePath = await maybeSaveImage(log.photo, "defect_logs", id);
    if (imagePath) run("UPDATE defect_logs SET image_path = ? WHERE id = ?", [imagePath, id]);
    const row = get("SELECT * FROM defect_logs WHERE id = ?", [id]);
    res.json({ success: true, log: toDefectLog(row) });
  } catch (err) {
    next(err);
  }
});
