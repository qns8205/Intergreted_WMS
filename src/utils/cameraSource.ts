/**
 * 카메라 스트림을 "앱과 다른 오리진에서, 브라우저당 한 개만" 받게 하는 곳.
 *
 * 왜 이런 게 필요한가 —
 * MJPEG 스트림(/api/camera/stream)은 끝나지 않는 HTTP 응답이라, 열려 있는 동안 브라우저의
 * "오리진당 연결 6개" 중 한 칸을 계속 붙잡는다. 촬영 화면을 여러 탭에 띄워 두면 6칸이 전부
 * 스트림으로 차고, 그때부터 그 PC에서는 앱의 모든 요청이 연결을 못 받아 무한 로딩에 빠진다.
 * (2026-09-08 실측: 스트림 5개까지 13ms, 6개째부터 무응답, 놓자마자 11ms로 복구)
 *
 * 그래서 두 가지를 건다.
 *   1) 스트림은 별도 포트(기본 3002)에서 받는다 → 오리진이 달라 앱 연결을 잠식하지 못한다.
 *   2) 그래도 한 브라우저에 스트림은 하나만 둔다 → 탭을 여러 개 열어도 카메라는 한 곳만 본다.
 */

const CAMERA_PORT = 3002;
/** 새 포트 확인에 이 이상 걸리면 그냥 같은 오리진으로 간다 — 확인하느라 촬영이 늦어지면 안 된다. */
const PROBE_TIMEOUT_MS = 1500;

let resolved: Promise<string> | null = null;

/**
 * 스트림을 받을 기준 주소를 정한다. 카메라 포트가 응답하면 그쪽을, 아니면 지금 오리진을 쓴다.
 *
 * 서버를 아직 새 버전으로 올리지 않았거나 방화벽이 새 포트를 막고 있어도 촬영은 되어야 하므로
 * 확인에 실패하면 조용히 예전 방식(같은 오리진)으로 돌아간다.
 */
export function cameraBase(): Promise<string> {
  if (resolved) return resolved;
  resolved = (async () => {
    const here = window.location;
    // 개발 서버(vite)나 https 환경에서는 굳이 손대지 않는다 — 프록시 설정이 따로 있다.
    if (here.protocol !== "http:") return "";
    const candidate = `${here.protocol}//${here.hostname}:${CAMERA_PORT}`;
    try {
      const c = new AbortController();
      const timer = setTimeout(() => c.abort(), PROBE_TIMEOUT_MS);
      const res = await fetch(`${candidate}/api/camera/ping`, { signal: c.signal, cache: "no-store" });
      clearTimeout(timer);
      if (res.ok) return candidate;
    } catch { /* 새 포트가 없거나 막혀 있다 — 같은 오리진으로 간다 */ }
    return "";
  })();
  return resolved;
}

/**
 * 카메라 포트로 받는 걸 포기하고 예전처럼 같은 오리진에서 받는다.
 *
 * ping은 통했는데 정작 스트림이 안 열리는 경우(중간 장비가 그 포트만 막았다든지, 브라우저가
 * 교차 오리진 이미지를 거부한다든지)를 위한 비상구다. 연결 한도 문제는 되돌아오지만,
 * 촬영이 아예 안 되는 것보다는 낫다.
 */
export function fallbackToSameOrigin(): void {
  resolved = Promise.resolve("");
}

/**
 * 카메라만 새로 연결할 때 이전 주소 판별 결과를 버린다.
 * 순간적인 ping 지연이나 스트림 오류 때문에 같은 오리진으로 고정된 상태를
 * 브라우저 전체 새로고침 없이 다시 검사하기 위한 함수다.
 */
export function resetCameraBase(): void {
  resolved = null;
}

/**
 * 브라우저 새로고침 없이 카메라 연결 상태만 처음부터 다시 만든다.
 * MJPEG 요청이 오류도 내지 않고 걸려 있으면 주소 캐시뿐 아니라 탭 간 잠금 채널의 소유권도
 * 오래된 상태로 남을 수 있다. 반납 입력을 잃는 전체 페이지 reload 대신 이 함수를 사용한다.
 */
export function hardResetCameraSession(): void {
  resolved = null;
  onRevoke = null;
  myId = "";
  if (channel) {
    channel.close();
    channel = null;
  }
}

/** `/api/camera/stream?...` 같은 경로를 실제로 요청할 주소로 바꾼다. */
export async function cameraUrl(path: string): Promise<string> {
  const base = await cameraBase();
  return base + path;
}

/** 서버가 USB 웹캠을 잡고 있는 ffmpeg까지 내렸다가 다시 열 준비를 시킨다.
 * 일반 재연결보다 훨씬 강한 수동 복구라 다른 사용자의 카메라 화면도 잠깐 끊길 수 있다. */
export async function restartCameraCapture(): Promise<void> {
  resetCameraBase();
  const url = await cameraUrl(`/api/camera/restart?t=${Date.now()}`);
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { method: "POST", cache: "no-store", signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) throw new Error(data.error || "카메라 서버 재시작에 실패했습니다.");
  } finally {
    window.clearTimeout(timer);
  }
  hardResetCameraSession();
}

// ── 브라우저당 스트림 하나 ────────────────────────────────────
// 탭이 달라도 연결 한도는 공유되므로, 잠금도 탭을 건너 걸어야 한다.

const CHANNEL = "wms-camera-stream";
type Revoke = () => void;

let channel: BroadcastChannel | null = null;
let myId = "";
let onRevoke: Revoke | null = null;

function ensureChannel() {
  if (channel || typeof BroadcastChannel === "undefined") return channel;
  channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (e) => {
    // 다른 화면이 카메라를 가져갔다 — 내 스트림은 놓는다.
    if (e.data?.type === "claim" && e.data.id !== myId && onRevoke) {
      const revoke = onRevoke;
      onRevoke = null;
      myId = "";
      revoke();
    }
  };
  return channel;
}

/**
 * 카메라 스트림을 이 화면이 쓰겠다고 알린다. 다른 탭·다른 화면이 보고 있었다면 그쪽이 스스로 놓는다.
 * `revoke`는 나중에 누군가 카메라를 가져갔을 때 불린다 — 그때 스트림 <img>를 비우면 된다.
 */
export function claimCameraStream(revoke: Revoke): void {
  myId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  onRevoke = revoke;
  ensureChannel()?.postMessage({ type: "claim", id: myId });
}

/** 촬영 화면을 닫을 때 부른다. 안 불러도 다음 claim이 정리하지만, 빨리 놓을수록 좋다. */
export function releaseCameraStream(): void {
  onRevoke = null;
  myId = "";
}
