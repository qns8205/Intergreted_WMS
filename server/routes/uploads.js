import { Router } from "express";
import multer from "multer";
import { saveImage, randomId } from "../lib/images.js";

export const uploadsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

uploadsRouter.post("/uploads/image", upload.single("file"), async (req, res) => {
  try {
    const scope = req.body?.scope || "misc";
    const id = req.body?.id || randomId();
    const input = req.file ? req.file.buffer : req.body?.dataUrl;
    if (!input) return res.status(400).json({ success: false, error: "이미지가 없습니다." });
    const { url, thumbUrl } = await saveImage(input, scope, id);
    res.json({ success: true, url, thumbUrl });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
