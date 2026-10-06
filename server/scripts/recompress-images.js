import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { uploadsDir } from "../lib/images.js";

/** Re-encodes every already-saved image at the new, smaller size/quality settings (see images.js).
 * Run once after tightening those settings, so existing photos shrink too, not just future uploads. */
async function main() {
  if (!fs.existsSync(uploadsDir)) {
    console.log("uploads dir not found:", uploadsDir);
    return;
  }
  let originals = 0, thumbs = 0, savedBytes = 0;
  for (const scope of fs.readdirSync(uploadsDir)) {
    const scopeDir = path.join(uploadsDir, scope);
    if (!fs.statSync(scopeDir).isDirectory()) continue;
    for (const id of fs.readdirSync(scopeDir)) {
      const dir = path.join(scopeDir, id);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const file of fs.readdirSync(dir)) {
        const filePath = path.join(dir, file);
        const before = fs.statSync(filePath).size;
        if (file.startsWith("original-")) {
          const buf = fs.readFileSync(filePath);
          await sharp(buf).resize({ width: 1400, height: 1400, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toFile(filePath + ".tmp");
          fs.renameSync(filePath + ".tmp", filePath);
          originals++;
        } else if (file.startsWith("thumb-")) {
          const buf = fs.readFileSync(filePath);
          await sharp(buf).resize({ width: 240, height: 240, fit: "inside", withoutEnlargement: true }).webp({ quality: 68 }).toFile(filePath + ".tmp");
          fs.renameSync(filePath + ".tmp", filePath);
          thumbs++;
        } else {
          continue;
        }
        savedBytes += before - fs.statSync(filePath).size;
      }
    }
  }
  console.log(JSON.stringify({ originals, thumbs, savedMB: (savedBytes / 1024 / 1024).toFixed(1) }, null, 2));
}

main();
