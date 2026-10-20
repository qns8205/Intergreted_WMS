// One-request Linux integration check; does not load the WMS database or change user data.
import https from "node:https";
import fs from "node:fs";
import { consumeHttpsSocket } from "../server/lib/systemdSocket.js";
const fd = consumeHttpsSocket();
if (fd === null) throw Error("systemd-socket-activate로 실행해주세요.");
const server = https.createServer({
  cert: fs.readFileSync("/home/configds/.local/share/wms-tls/wms.crt"),
  key: fs.readFileSync("/home/configds/.local/share/wms-tls/wms.key"), minVersion: "TLSv1.2",
}, (req, res) => {
  res.setHeader("Connection", "close");
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ encrypted: !!req.socket.encrypted, port: req.socket.localPort }));
  server.close(() => process.exit(0));
});
server.listen({ fd }, () => console.log("HTTPS socket activation check ready"));
setTimeout(() => process.exit(1), 20000).unref();
