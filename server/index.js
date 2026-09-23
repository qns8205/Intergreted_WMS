import express from "express";
import compression from "compression";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./db.js";
import { bootstrapRouter } from "./routes/bootstrap.js";
import { inventoryRouter } from "./routes/inventory.js";
import { defectLogsRouter } from "./routes/defectLogs.js";
import { rentalsRouter } from "./routes/rentals.js";
import { sectorsRouter } from "./routes/sectors.js";
import { borrowRouter } from "./routes/borrow.js";
import { uploadsRouter } from "./routes/uploads.js";
import { adminRouter } from "./routes/admin.js";
import { gasRouter } from "./routes/gas.js";
import { scenarioSyncRouter } from "./routes/scenarioSync.js";
import { cameraRouter } from "./routes/camera.js";
import { requestLookupRouter } from "./routes/requestLookup.js";
import { locationLookupRouter } from "./routes/locationLookup.js";
import { labelPrinterRouter } from "./routes/labelPrinter.js";
import { unattendedRouter } from "./routes/unattended.js";
import { uploadsDir } from "./lib/images.js";
import { cleanupOldReturnPhotos } from "./lib/returnPhotoRetention.js";
import { cancelUnclaimedPickups } from "./lib/pickupTimeout.js";
import { startSmSync } from "./lib/smSync.js";
import { applyUnattendedOverduePenalties } from "./lib/unattendedPenalties.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 3001;
// 카메라 스트림 전용 포트. 앱과 오리진을 갈라 놓기 위한 것이라 앱 포트와 반드시 달라야 한다.
const cameraPort = Number(process.env.WMS_CAMERA_PORT) || 3002;

const app = express();

// 응답 gzip 압축. JS 번들과 JSON 응답이 압축 없이 나가면서 전송량이 컸다 —
// 실측으로 번들 951KB→235KB, 목록 API 응답들이 86~90% 줄어든다.
// 라우트보다 먼저 등록해야 그 응답까지 압축된다. 이미지(webp)는 이미 압축된 포맷이라
// compression이 알아서 건너뛴다.
app.use(compression());

app.use(express.json({ limit: "20mb" }));

const api = express.Router();
api.use(bootstrapRouter);
api.use(inventoryRouter);
api.use(defectLogsRouter);
api.use(rentalsRouter);
api.use(sectorsRouter);
api.use(borrowRouter);
api.use(uploadsRouter);
// adminRouter보다 먼저 마운트해야 한다 — adminRouter의 GET /scenarios/:sid 가
// /scenarios/sync-status 를 sid="sync-status" 로 삼켜 requireAdmin 401을 내보내기 때문.
api.use(scenarioSyncRouter);
api.use(unattendedRouter);
api.use(adminRouter);
api.use(gasRouter);
api.use(cameraRouter);
api.use(labelPrinterRouter);
app.use("/api", api);

app.use("/uploads", express.static(uploadsDir, { maxAge: "365d", immutable: true }));

const distDir = path.join(__dirname, "..", "dist");
// 빌드 산출물(assets/*)은 파일명에 내용 해시가 붙어 있어(index-BDn7xuLC.js) 내용이 바뀌면
// 파일명도 바뀐다 — 따라서 영구 캐시해도 안전하고, 재방문 시 재검증 요청조차 없앨 수 있다.
// 반면 index.html은 그 해시를 가리키는 입구라 항상 새로 확인해야 배포가 즉시 반영된다.
app.use("/assets", express.static(path.join(distDir, "assets"), { maxAge: "365d", immutable: true }));
app.use(express.static(distDir, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
  },
}));
app.get(/^(?!\/api|\/uploads).*/, (req, res, next) => {
  res.setHeader("Cache-Control", "no-cache"); // SPA 진입점도 캐시되면 배포가 반영되지 않는다
  res.sendFile(path.join(distDir, "index.html"), (err) => {
    if (err) next();
  });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ success: false, error: "서버 오류가 발생했습니다." });
});

cleanupOldReturnPhotos();
setInterval(cleanupOldReturnPhotos, 6 * 60 * 60 * 1000); // 6시간마다 오래된 반납 사진 정리
// 신청만 하고 안 가져간 대여를 되돌려 재고를 풀어준다. 5분마다 훑으므로 실제 취소 시각은
// 설정한 제한시간 + 최대 5분이 된다.
setInterval(() => {
  try { cancelUnclaimedPickups(); }
  catch (err) { console.error("[pickup-timeout] 자동 취소 확인 실패", err); }
}, 5 * 60 * 1000);
// 무인 모드에서 수령 후 24시간 동안 반납 처리를 하지 않은 신청을 10분마다 확인한다.
// 위반 장부의 UNIQUE event_key 덕분에 같은 신청은 서버가 재시작돼도 한 번만 차감된다.
const checkUnattendedPenalties = () => {
  try { applyUnattendedOverduePenalties(); }
  catch (err) { console.error("[unattended-penalty] 자동 페널티 확인 실패", err); }
};
setInterval(checkUnattendedPenalties, 10 * 60 * 1000);
setTimeout(checkUnattendedPenalties, 15 * 1000);

// 재고 동기화 — Scenario Manager와 수량·대여 상태를 맞춘다(관리자 로그인 세션으로 처리).
startSmSync();
// 예전에는 여기서 SM 목록을 미리 받아뒀다. 첫 수정을 빠르게 하려던 것인데, 서버가 뜰 때마다
// 3천여 개를 훑어 SM과 서버 양쪽에 부담이 됐다. 물품 수정은 이제 응답을 붙잡지 않고 뒤에서
// 도므로 미리 받아둘 이유가 없다 — 필요할 때만 받는다.

/**
 * 유휴 연결을 다루는 방식 — 사무실 Wi-Fi 경로 때문에 기본값을 그대로 쓰면 안 된다.
 *
 * Wi-Fi PC들은 공유기에서 주소가 바뀌어(NAT) 들어온다. 그런데 그 공유기가 연결 상태를
 * 도중에 잃어버려서, 서버가 보내는 종료 신호(FIN)가 PC까지 가지 못하는 일이 잦다
 * (실측: 8일간 버려진 패킷 1,677건 중 1,432건이 FIN, 새 연결 요청(SYN)은 0건).
 *
 * 그러면 이런 일이 벌어진다 —
 *   서버가 유휴 연결을 정리하며 FIN을 보낸다 → 그 FIN이 중간에서 사라진다 →
 *   브라우저는 연결이 아직 살아 있다고 믿는다 → 다음 요청을 그 죽은 연결로 보낸다 →
 *   응답이 영영 오지 않는다 → 화면은 무한 로딩.
 *
 * 그래서 두 가지를 바꾼다.
 *   1) keepAliveTimeout을 65초로 — 서버가 먼저 끊는 일을 줄인다. 끊지 않으면 잃어버릴
 *      FIN도 없다. (Node 기본값은 5초라 몇 초만 놀아도 바로 끊는다)
 *   2) TCP keepalive를 20초로 — 조용한 연결에도 주기적으로 신호를 흘려 공유기가 NAT 표를
 *      잊지 않게 한다. 리눅스 기본값은 2시간이라 사실상 아무 도움이 안 된다.
 *
 * headersTimeout은 keepAliveTimeout보다 커야 한다(그렇지 않으면 요청을 받다 말고 끊는다).
 */
function tuneForFlakyNat(server) {
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 70000;
  server.on("connection", (socket) => socket.setKeepAlive(true, 20000));
  return server;
}

tuneForFlakyNat(app.listen(port, () => {
  console.log(`WMS server listening on http://localhost:${port}`);
}));

// 카메라 스트림만 따로 듣는 두 번째 서버.
//
// MJPEG 스트림은 끝나지 않는 HTTP 응답이라, 열려 있는 동안 브라우저의 "오리진당 연결 6개"
// 중 한 칸을 계속 차지한다. 촬영 화면을 여러 탭에 띄워 두면 6칸이 모두 스트림으로 차고,
// 그 순간부터 그 PC에서는 앱의 모든 요청이 연결을 못 받아 무한 로딩에 빠진다
// (2026-09-08 실측: 스트림 5개까지는 13ms, 6개째부터 응답 없음, 스트림을 놓자 11ms로 복구).
//
// 포트를 나누면 오리진이 달라져 연결 한도를 따로 쓰므로 이 간섭이 원천적으로 사라진다.
// 3000번의 /api/camera/* 도 그대로 남겨 둔다 — 예전 번들을 캐시로 들고 있는 브라우저가
// 새 포트를 모르기 때문이고, 그쪽으로 붙어도 최소한 지금까지처럼은 동작해야 한다.
if (cameraPort !== port) {
  const cameraApp = express();
  // 메인 앱(:3000)과 분리된 QR 전용 조회 화면. 긴 경로를 아는 QR 사용자만 접근하고,
  // 사진도 같은 :3002 오리진에서 읽게 해 메인 앱 화면이나 API를 노출하지 않는다.
  cameraApp.use(requestLookupRouter);
  cameraApp.use(locationLookupRouter);
  cameraApp.use("/uploads", express.static(uploadsDir, { maxAge: "1h" }));
  cameraApp.use("/api", cameraRouter);
  cameraApp.use(cameraRouter); // /api 접두사 없이도 받는다
  tuneForFlakyNat(cameraApp.listen(cameraPort, () => {
    console.log(`WMS camera stream listening on http://localhost:${cameraPort}`);
  }));
}
