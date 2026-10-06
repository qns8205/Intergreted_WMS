import { Router } from "express";
import { requireAdmin } from "../lib/auth.js";
import { printerStatus, printRentalRequest, printLookupQr, printReturnedItems, printScanMeQr, scanMeQrPreview } from "../lib/labelPrinter.js";

export const labelPrinterRouter = Router();

labelPrinterRouter.get("/label-printer/status", requireAdmin, (req, res) => {
  res.json({ success: true, ...printerStatus() });
});

labelPrinterRouter.post("/label-printer/print-request", requireAdmin, async (req, res) => {
  try {
    const result = await printRentalRequest(req.body?.requestNo);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message || "라벨 출력에 실패했습니다." });
  }
});

labelPrinterRouter.post("/label-printer/print-lookup-qr", requireAdmin, async (req, res) => {
  try {
    const result = await printLookupQr();
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message || "QR 라벨 출력에 실패했습니다." });
  }
});

labelPrinterRouter.post("/label-printer/print-returned-items", requireAdmin, async (req, res) => {
  try {
    const result = await printReturnedItems(req.body?.items);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message || "반납 위치표 출력에 실패했습니다." });
  }
});

labelPrinterRouter.get("/label-printer/scan-me-qr/preview", requireAdmin, async (req, res) => {
  try {
    res.type("png").set("Cache-Control", "no-store").send(await scanMeQrPreview());
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || "미리보기를 만들지 못했습니다." });
  }
});

labelPrinterRouter.post("/label-printer/print-scan-me-qr", requireAdmin, async (req, res) => {
  try {
    const result = await printScanMeQr(req.body?.copies);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message || "SCAN ME QR 출력에 실패했습니다." });
  }
});
