import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const file = process.env.WMS_HTTPS_CONFIG || path.resolve(here, "../data/https.json");
export const httpsConfig = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
if (httpsConfig.enabled) {
  for (const key of ["origin", "qrOrigin"]) {
    const url = new URL(httpsConfig[key]);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/") throw Error("잘못된 WMS HTTPS 설정입니다.");
  }
  if (!httpsConfig.certFile || !httpsConfig.keyFile) throw Error("WMS HTTPS 인증서 경로가 필요합니다.");
}
export function borrowerAuthRequired() { return httpsConfig.borrowerSmAuth === true; }
