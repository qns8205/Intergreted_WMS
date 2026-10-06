import { Router } from "express";
import { all } from "../db.js";
import { toInventoryItem, toDefectLog, toRentLog, toSector } from "../lib/serialize.js";

export const bootstrapRouter = Router();

bootstrapRouter.get("/bootstrap", (req, res) => {
  const inventory = all("SELECT * FROM warehouse_items ORDER BY id").map(toInventoryItem);
  const sectors = all("SELECT * FROM sectors ORDER BY id").map(toSector);
  const defectLogs = all("SELECT * FROM defect_logs ORDER BY id DESC").map(toDefectLog);
  const rentLogs = all("SELECT * FROM warehouse_rental_logs ORDER BY id DESC").map(toRentLog);
  const users = all("SELECT id, login_id, name FROM admin_users").map((r) => ({
    id: r.id,
    name: r.name,
  }));

  res.json({
    success: true,
    inventory,
    sectors,
    defectLogs,
    rentLogs,
    users,
    robotObjects: [],
  });
});
