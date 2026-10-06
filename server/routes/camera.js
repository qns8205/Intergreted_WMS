import { Router } from "express";
import { spawn } from "node:child_process";

export const cameraRouter = Router();

// 카메라는 앱과 다른 포트(기본 3002)에서도 서비스된다 — MJPEG 스트림은 끝나지 않는 응답이라
// 앱과 같은 오리진에 두면 브라우저의 "오리진당 연결 6개" 한도를 잡아먹는다. 6개가 다 스트림이
// 되는 순간 그 PC에서는 앱 전체가 무한 로딩에 빠진다(실측으로 재현). 포트를 갈라 두면
// 스트림이 아무리 열려 있어도 앱 요청은 자기 몫의 연결을 그대로 쓴다.
//
// 다만 오리진이 갈리면 <img>로 받은 프레임을 캔버스에 그릴 때 캔버스가 오염되어(tainted)
// toDataURL()이 막힌다 — 그래서 CORS를 열어 두고, 프런트는 crossOrigin="anonymous"로 받는다.
cameraRouter.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
});

// 카메라 포트가 살아 있는지 확인하는 용도. 카메라(ffmpeg)를 건드리지 않는 게 핵심이다 —
// 확인만 하려다 웹캠이 켜지면 안 된다.
cameraRouter.get("/camera/ping", (req, res) => {
  res.json({ success: true });
});

const DEVICE = process.env.WMS_CAMERA_DEVICE || "/dev/video0";
// 웹캠이 지원하는 크기 그대로 받아 스케일 없이 내보낸다.
// 예전엔 1280x720으로 받아 800x450으로 줄였는데, 큰 프레임을 디코딩하고 다시 스케일하는
// 비용이 커서 ffmpeg가 코어 하나의 29%를 계속 먹었다. 800x600으로 직접 받으면 그 과정이
// 통째로 사라져 12%대로 떨어지고, 화소수는 오히려 늘어난다(36만 → 48만).
const CAPTURE_SIZE = process.env.WMS_CAMERA_CAPTURE_SIZE || "800x600";
// 8fps. 입력이 MJPEG라 ffmpeg가 매 프레임을 디코딩→스케일→재인코딩하므로 프레임레이트가
// 그대로 CPU 사용량이자 대역폭이 된다(30fps일 때 코어 하나의 30%를 계속 먹었다).
// 이 스트림은 카메라를 겨냥하기 위한 미리보기일 뿐이고, 저장되는 사진은 셔터를 누를 때
// /camera/snapshot으로 따로 받는 원본이라 여기 프레임레이트는 화질과 아무 상관이 없다.
// 15fps에서 8fps로 낮추면 CPU와 대역폭이 거의 절반이 되고, 구도를 잡는 데는 지장이 없다.
const FRAMERATE = process.env.WMS_CAMERA_FPS || "8";
const CAPTURE_FPS = process.env.WMS_CAMERA_CAPTURE_FPS || "30"; // 웹캠에 요청하는 값 (실제 제한은 위 FRAMERATE로 한다)
const QUALITY = process.env.WMS_CAMERA_QUALITY || "10"; // mjpeg qscale: 2(고화질/고용량)~31(저화질/저용량)

// 고해상도 모드(물품 등록·불량 로그 촬영). 카메라가 내보내는 MJPEG를 재인코딩 없이
// 그대로 흘려보내므로 CPU를 거의 안 쓴다 — 측정상 800x600 재인코딩(33%)보다도 싸다.
// 대신 비트레이트가 ~36Mbps로 올라가서(기본 모드는 ~2Mbps) 기본값으로는 쓰지 않는다.
//
// 이 웹캠의 실측 프레임레이트: 1280x960·1600x1200·1920x1080은 30fps,
// 2048x1536·2592x1944는 20fps, 3264x2448은 15fps.
// "24fps 이상"을 만족하는 가장 큰 4:3 해상도라 1600x1200을 기본으로 잡았다
// (16:9인 1920x1080은 화소수는 조금 더 많지만 위아래가 잘려 화각이 달라진다).
const HQ_CAPTURE_SIZE = process.env.WMS_CAMERA_HQ_SIZE || "1600x1200";
// 고해상도는 카메라가 주는 30fps를 그대로 흘리면 뷰어 1명당 ~36Mbps다. 구도를 잡는 용도라
// 초당 8장이면 충분하고, 촬영되는 사진은 어차피 원본 프레임이라 화질은 그대로다.
// (이걸 안 걸었을 때 378Mbps까지 나가면서 이미지 로딩이 0.2~0.5초로 늘어졌다.)
const HQ_FANOUT_FPS = Number(process.env.WMS_CAMERA_HQ_FANOUT_FPS || 8);
let lastSentAt = 0;
const BOUNDARY = "wmsframe";
// 보는 사람이 없어지면 곧바로 캡처를 끈다. 아무도 안 보는데 켜두면 ffmpeg가 계속
// CPU를 먹을 뿐 얻는 게 없고, 다시 여는 비용은 ~350ms로 한 번만 든다.
// 0이 아니라 5초를 두는 이유는 화면 이동·새로고침처럼 곧바로 다시 붙는 경우까지
// 껐다 켜면 오히려 USB 장치를 헛되이 재설정하게 되기 때문이다.
const IDLE_SHUTDOWN_MS = Number(process.env.WMS_CAMERA_IDLE_MS || 5000);

// USB 웹캠이 미니 PC(반납 데스크 옆)에 직접 꽂혀 있어, 반납 처리를 여는 각 PC/노트북마다
// 카메라를 물릴 필요 없이 서버가 대신 실시간 영상을 내려준다.
//
// 처음엔 "요청마다 ffmpeg를 새로 띄웠다 껐다" 하는 방식이었는데, 두 가지 문제가 있었다:
// (1) 매번 장치를 새로 여는 데 ~350ms가 걸려 모달을 열 때마다 초반 지연이 났고,
// (2) 카메라 원본을 그대로 복사하면 1280x720/30fps가 ~13Mbps라 미니 PC 밖으로 나가는
//     경로가 못 받쳐주면 못 나간 프레임이 쌓여 "찍을수록 지연이 늘어나는" 증상이 났다.
// (2)는 작게 재인코딩(800x450, ~2Mbps)해서 이미 해결했고, (1)은 여기서 캡처 프로세스를
// 하나만 계속 띄워두고(첫 접속 때만 뜸을 들이고, 그 뒤로는 이미 돌고 있는 걸 그대로 씀)
// 새로 붙는 뷰어에게는 방금 찍힌 최신 프레임을 곧바로 하나 먼저 보여주는 방식으로 없앤다.
// 보는 사람이 아무도 없는 채로 일정 시간이 지나면 그때 캡처를 끈다.
let proc = null;
let procHq = false; // 지금 돌고 있는 캡처가 고해상도 모드인지
const hqViewers = new Set(); // 고해상도를 요청한 뷰어들
let starting = null; // ensureCapture() 진행 중인 Promise (동시 요청이 중복으로 새 프로세스를 띄우지 않게)
let startingProc = null; // 첫 프레임이 오기 전이라 proc에 아직 못 들어간 ffmpeg도 강제 재시작할 수 있게 보관
let startingHq = false; // 그 진행 중인 시작이 고해상도인지
let latestFramePacket = null; // 가장 최근 완성된 프레임 (새 뷰어에게 즉시 보여줄 용도)
const viewers = new Set(); // 지금 스트림을 받고 있는 express Response들
let idleTimer = null;

// 프레임 하나가 대략 8~15KB 정도라, 그 몇 배 이상 밀려 있으면 그 뷰어는 못 따라오고
// 있다는 뜻이다 — 밀린 프레임을 계속 쌓아서 보내는 대신, 그 프레임은 건너뛰고 다음
// 프레임(더 최신)을 기다린다. 어차피 실시간 미리보기라 중간 프레임 몇 개 빠지는 것보다
// 지연이 계속 쌓이는 쪽이 훨씬 나쁘다.
const MAX_QUEUED_BYTES = 32 * 1024;

// Tailscale Funnel처럼 relay를 거치는 경로에서 상대가 갑자기 사라지면(창을 그냥 닫아버림,
// 네트워크가 끊김 등) TCP FIN이 우리 쪽에 안 오는 경우가 있다 — 그러면 req/res의 "close"
// 이벤트가 영영 안 떠서 viewers에서 안 빠지고, viewers.size가 0이 안 돼 유휴 종료도 못 하고
// 카메라가 계속 켜진 채로 남는다(실측: 죽은 연결이 20개 넘게 쌓인 적 있음). 그래서 프레임을
// 계속 못 받아가는(=밀려 있는) 상태가 일정 시간 넘게 지속되면 죽은 연결로 보고 강제로 끊는다.
const DEAD_VIEWER_BACKUP_MS = 15000;
const backedUpSince = new Map(); // res -> 처음 밀리기 시작한 시각

// /camera/snapshot이 "지금 막 찍힌 원본 프레임"을 기다리는 곳.
// 해상도를 바꾼 직후 첫 프레임은 노출이 덜 잡혀 어둡거나 번지므로 몇 장 흘려보낸다.
const frameWaiters = new Set();

// 촬영 직후 곧바로 기본 해상도로 되돌리면, 연달아 찍을 때 장마다 카메라를 두 번씩
// (기본→고해상도→기본) 다시 여느라 한 장에 ~0.9초가 걸리고 그동안 미리보기가 멈춘다.
// 그래서 마지막 촬영 후 잠깐은 고해상도를 붙들어 둔다 — 연사의 두 번째 장부터는
// 재설정 없이 바로 받아온다. 이 동안에도 미리보기는 계속 흐르되, 고해상도 프레임은
// 장당 ~650KB라 아래에서 초당 4장으로 묶어 내보낸다.
const SNAPSHOT_HOLD_MS = Number(process.env.WMS_CAMERA_SNAPSHOT_HOLD_MS || 6000);
let snapshotHoldTimer = null;
function holdHqForBurst() {
  if (snapshotHoldTimer) clearTimeout(snapshotHoldTimer);
  snapshotHoldTimer = setTimeout(() => {
    snapshotHoldTimer = null;
    // 보는 사람이 아무도 없으면 기본 모드로 되돌릴 이유가 없다. 되돌리면 곧 끌 프로세스를
    // 굳이 새로 띄우는 셈이라 USB 장치만 헛되이 한 번 더 연다 — 그냥 끄면 된다.
    if (viewers.size === 0) { scheduleIdleShutdown(); return; }
    // 붙들고 있는 사이에 유휴 종료가 이미 카메라를 껐을 수도 있다. 그때도 새로 켜지 않는다.
    if (proc) ensureCapture(hqViewers.size > 0).catch(() => {});
  }, SNAPSHOT_HOLD_MS);
}
function nextFrame(skip = 3, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let left = skip;
    const w = (jpeg) => { if (left-- > 0) return true; clearTimeout(t); frameWaiters.delete(w); resolve(jpeg); return false; };
    const t = setTimeout(() => { frameWaiters.delete(w); reject(new Error("카메라에서 사진을 받지 못했습니다.")); }, timeoutMs);
    frameWaiters.add(w);
  });
}

function broadcast(packet) {
  const now = Date.now();
  for (const res of viewers) {
    if (res.writableLength > MAX_QUEUED_BYTES) {
      const since = backedUpSince.get(res);
      if (since === undefined) {
        backedUpSince.set(res, now);
      } else if (now - since > DEAD_VIEWER_BACKUP_MS) {
        viewers.delete(res);
        backedUpSince.delete(res);
        hqViewers.delete(res);
        try { res.destroy(); } catch { /* 이미 끊긴 연결 */ }
      }
      continue; // 이번 프레임은 건너뛴다
    }
    backedUpSince.delete(res); // 정상적으로 받아가고 있으면 밀림 상태 해제
    res.write(packet, (err) => { if (err) { viewers.delete(res); backedUpSince.delete(res); } });
  }
}

function scheduleIdleShutdown() {
  if (idleTimer) return;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (viewers.size === 0 && proc) { try { proc.kill("SIGKILL"); } catch { /* 이미 종료됨 */ } }
  }, IDLE_SHUTDOWN_MS);
}
function cancelIdleShutdown() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
}

function killAndWait(ff) {
  if (!ff) return Promise.resolve();
  ff.retired = true;
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    ff.once("exit", finish);
    try { ff.kill("SIGKILL"); } catch { finish(); }
    setTimeout(finish, 800);
  });
}

/** 브라우저 재연결로도 풀리지 않는 USB/ffmpeg 정지를 위한 가장 강한 복구.
 * 기존 뷰어를 모두 종료하고 캡처 프로세스가 실제로 내려간 뒤, 다음 stream 요청이 새로 띄우게 한다. */
async function forceRestartCapture() {
  cancelIdleShutdown();
  if (snapshotHoldTimer) { clearTimeout(snapshotHoldTimer); snapshotHoldTimer = null; }
  for (const res of viewers) { try { res.end(); } catch { /* 이미 끊긴 연결 */ } }
  viewers.clear();
  backedUpSince.clear();
  hqViewers.clear();

  const targets = [...new Set([proc, startingProc].filter(Boolean))];
  proc = null;
  latestFramePacket = null;
  lastSentAt = 0;
  await Promise.all(targets.map(killAndWait));
  starting = null;
  startingProc = null;
}

// ffmpeg가 내보내는 "--wmsframe\r\nContent-type: ...\r\nContent-length: N\r\n\r\n<JPEG bytes>" 형식을
// 파싱해 완성된 프레임 하나씩 뽑아낸다. Content-length가 있어 다음 바이트가 몇 개인지 정확히 알 수
// 있다(중간에 우연히 바이너리 JPEG 데이터 안에 boundary와 같은 바이트열이 섞여도 안전하다).
function tryExtractFrame(buf) {
  const marker = Buffer.from(`--${BOUNDARY}\r\n`);
  const start = buf.indexOf(marker);
  if (start === -1) {
    if (buf.length > 65536) return { skip: buf.length }; // 비정상적으로 쌓이면 버린다 (평소엔 일어나지 않음)
    return null;
  }
  const headerEnd = buf.indexOf("\r\n\r\n", start + marker.length);
  if (headerEnd === -1) return null;
  const headerText = buf.slice(start, headerEnd).toString("latin1");
  const m = headerText.match(/content-length:\s*(\d+)/i);
  if (!m) return { skip: start + marker.length }; // 헤더가 이상하면 이 마커는 건너뛰고 다음 걸 찾는다
  const len = parseInt(m[1], 10);
  const bodyStart = headerEnd + 4;
  const bodyEnd = bodyStart + len;
  if (buf.length < bodyEnd) return null; // 아직 다 안 왔다
  const packet = Buffer.concat([
    Buffer.from(`--${BOUNDARY}\r\nContent-type: image/jpeg\r\nContent-length: ${len}\r\n\r\n`),
    buf.slice(bodyStart, bodyEnd),
    Buffer.from("\r\n"),
  ]);
  return { packet, body: buf.slice(bodyStart, bodyEnd), rest: buf.slice(bodyEnd) };
}

function ensureCapture(wantHq = false) {
  // 이미 원하는 모드로 돌고 있으면 그대로 쓴다.
  if (proc && procHq === wantHq) return Promise.resolve();
  // 모드가 다르면 껐다가 새로 띄운다. 보고 있던 사람은 잠깐(~350ms) 끊겼다 이어지는데,
  // 카메라 장치를 서로 다른 해상도로 동시에 열 수는 없어서 다른 방법이 없다.
  if (proc && procHq !== wantHq) {
    // 죽인 뒤에도 파이프에 남은 데이터가 stdout 핸들러로 더 들어온다. 표식을 달아
    // 그 데이터를 무시하게 한다(아래 handler 참고).
    proc.retired = true;
    try { proc.kill("SIGKILL"); } catch { /* 이미 죽었다 */ }
    proc = null;
    latestFramePacket = null;
    lastSentAt = 0; // 새 모드의 첫 프레임은 솎지 않고 바로 내보낸다
  }
  if (starting) {
    // 원하는 모드로 시작 중이면 그걸 같이 기다린다. 모드가 다르면 그 promise를 그대로
    // 돌려주면 엉뚱한 해상도로 붙으므로, 끝나기를 기다렸다가 다시 판단한다.
    if (startingHq === wantHq) return starting;
    return starting.then(() => ensureCapture(wantHq), () => ensureCapture(wantHq));
  }

  const hq = wantHq;
  startingHq = hq;
  starting = new Promise((resolve, reject) => {
    let resolved = false;
    let stderrTail = "";

    const ff = spawn("ffmpeg", [
      "-fflags", "nobuffer",
      "-flags", "low_delay",
      "-probesize", "32",
      "-analyzeduration", "0",
      "-f", "v4l2",
      "-input_format", "mjpeg",
      "-video_size", hq ? HQ_CAPTURE_SIZE : CAPTURE_SIZE,
      "-framerate", CAPTURE_FPS,
      "-i", DEVICE,
      // 고해상도 모드는 카메라가 만든 JPEG를 손대지 않고 그대로 내보낸다(디코딩·인코딩 없음).
      // 필터(-vf)는 디코딩을 전제로 하므로 여기서는 쓸 수 없고, 그래서 프레임레이트도
      // 카메라가 주는 그대로(이 해상도에서 30fps)가 된다.
      ...(hq
        ? ["-c:v", "copy"]
        : [
            // 프레임레이트는 반드시 출력 필터로 제한한다. 입력 -framerate는 이 웹캠이 무시해서
            // (15를 요청해도 29fps로 들어왔다) 실제로 줄어들지 않는다.
            "-vf", `fps=${FRAMERATE}`,
            "-c:v", "mjpeg",
            "-q:v", QUALITY,
          ]),
      "-flush_packets", "1",
      "-f", "mpjpeg",
      "-boundary_tag", BOUNDARY,
      "pipe:1",
    ]);
    startingProc = ff;

    ff.stderr.on("data", (d) => { stderrTail = (stderrTail + d.toString()).slice(-4000); });

    // 파싱 버퍼는 반드시 프로세스별로 둔다. 전역으로 공유하면 모드 전환 때 밀려난
    // 프로세스가 마지막으로 뱉는 바이트가 새 프로세스의 바이트와 한 버퍼에 섞여
    // Content-length와 실제 본문이 어긋난다. 그렇게 깨진 프레임을 받은 브라우저는
    // 오지 않을 바이트를 기다리며 미리보기가 그대로 멈춘다.
    let buf = Buffer.alloc(0);
    ff.stdout.on("data", (chunk) => {
      if (ff.retired) return; // 이미 밀려난 프로세스의 잔여 출력
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const r = tryExtractFrame(buf);
        if (!r) break;
        buf = r.skip !== undefined ? buf.slice(r.skip) : r.rest;
        if (!r.packet) continue;
        latestFramePacket = r.packet;
        if (frameWaiters.size) for (const w of [...frameWaiters]) w(r.body);
        // 고해상도일 때만 솎아낸다. 기본 모드는 이미 15fps/2Mbps라 그대로 내보낸다.
        // (최신 프레임은 latestFramePacket에 계속 갱신되므로, 새로 붙는 뷰어는 바로 최신 화면을 본다.)
        const now = Date.now();
        // 고해상도 뷰어가 실제로 있으면 8fps, 연사 때문에 잠깐 붙들고 있는 것뿐이면
        // 4fps로 더 성기게 내보낸다(장당 ~650KB라 대역폭이 그대로 곱해진다).
        const fanoutFps = hqViewers.size > 0 ? HQ_FANOUT_FPS : 4;
        if (!hq || now - lastSentAt >= 1000 / fanoutFps) {
          lastSentAt = now;
          broadcast(r.packet);
        }
        if (!resolved) { resolved = true; proc = ff; procHq = hq; if (startingProc === ff) startingProc = null; starting = null; resolve(); }
      }
    });

    ff.on("error", (err) => {
      if (startingProc === ff) startingProc = null;
      if (!resolved) { resolved = true; starting = null; reject(err); }
    });

    ff.on("exit", () => {
      if (startingProc === ff) startingProc = null;
      const wasCurrent = proc === ff;
      if (wasCurrent) { proc = null; latestFramePacket = null; }
      if (!resolved) {
        resolved = true;
        starting = null;
        const lastLine = stderrTail.trim().split("\n").pop() || "";
        console.error("[camera:stream]", lastLine);
        reject(new Error("카메라 스트림을 열 수 없습니다. 웹캠 연결을 확인하거나 다른 곳에서 사용 중인지 확인해주세요."));
      } else if (wasCurrent) {
        // 스트리밍 도중 죽었다(예: USB 분리) — 보고 있던 뷰어들의 연결도 정리해준다
        for (const res of viewers) { try { res.end(); } catch { /* 이미 끊긴 연결 */ } }
        viewers.clear();
        backedUpSince.clear();
        hqViewers.clear();
      }
    });
  });

  return starting;
}

// 원본 해상도가 필요한 건 "촬영" 그 순간 한 장뿐이다. 미리보기까지 고해상도로 계속
// 흘리면 뷰어 1명당 ~42Mbps가 나가 사무실 망이 포화된다(3명이면 127Mbps 실측). 그래서
// 미리보기는 가벼운 기본 모드로 두고, 셔터를 누를 때만 잠깐 고해상도로 올려 한 장 받고
// 곧바로 되돌린다. 왕복 ~1초가 들지만 나가는 양은 한 장(~650KB)뿐이다.
cameraRouter.get("/camera/snapshot", async (req, res) => {
  const alreadyHq = !!proc && procHq;
  try {
    cancelIdleShutdown();
    await ensureCapture(true);
    // 이미 고해상도로 돌고 있으면(연사 중) 노출은 이미 잡혀 있으니 버릴 프레임이 없다.
    const jpeg = await nextFrame(alreadyHq ? 0 : 3);
    res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "no-store", "Content-Length": jpeg.length });
    res.end(jpeg);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
  } finally {
    // 곧바로 되돌리지 않는다 — 연달아 찍는 경우가 흔해서, 잠깐 붙들어 두면
    // 두 번째 장부터는 카메라 재설정 없이 바로 나온다.
    holdHqForBurst();
  }
});

// 수동 "다시 연결"의 최종 복구 수단. 단순히 URL만 바꾸는 것이 아니라 서버가 USB 카메라를
// 잡고 있는 ffmpeg 자체를 내렸다가 다음 스트림 요청에서 새로 연다.
cameraRouter.post("/camera/restart", async (req, res) => {
  try {
    await forceRestartCapture();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || "카메라를 재시작하지 못했습니다." });
  }
});

cameraRouter.get("/camera/stream", async (req, res) => {
  // 물품 등록·불량 로그 촬영처럼 사진을 남기는 화면만 고해상도를 요청한다.
  const wantHq = req.query.hq === "1" || req.query.hq === "true";
  try {
    // 지금 고해상도를 원하는 사람이 하나라도 있으면 고해상도로 돌린다.
    await ensureCapture(wantHq || hqViewers.size > 0);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
    return;
  }

  cancelIdleShutdown();
  req.socket?.setNoDelay(true);
  res.writeHead(200, {
    "Content-Type": `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
    "Cache-Control": "no-cache, no-store, must-revalidate",
    Pragma: "no-cache",
    Connection: "close",
  });
  if (latestFramePacket) res.write(latestFramePacket); // 기다리지 않고 방금 찍힌 프레임을 바로 보여준다
  viewers.add(res);
  if (wantHq) hqViewers.add(res);

  const cleanup = () => {
    viewers.delete(res);
    backedUpSince.delete(res);
    hqViewers.delete(res);
    if (viewers.size === 0) scheduleIdleShutdown();
    // 고해상도를 원하던 사람이 다 빠졌는데 아직 고해상도로 돌고 있으면 기본 모드로 되돌린다
    // (계속 켜두면 대역폭만 낭비한다). 남은 뷰어가 없으면 어차피 곧 꺼지므로 그냥 둔다.
    else if (procHq && hqViewers.size === 0) ensureCapture(false).catch(() => {});
  };
  req.on("close", cleanup);
  res.on("close", cleanup);
});
