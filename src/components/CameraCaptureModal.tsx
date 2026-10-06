import React, { useCallback, useEffect, useRef, useState } from "react";
import { Camera, X, ZoomIn, ZoomOut, Maximize, RotateCcw } from "lucide-react";
import { cameraUrl, claimCameraStream, releaseCameraStream, fallbackToSameOrigin, resetCameraBase, hardResetCameraSession, restartCameraCapture } from "../utils/cameraSource";

const ZOOM_STEPS = [1, 1.5, 2, 3, 4];

/**
 * 서버 PC에 연결된 웹캠으로 사진을 찍는 모달.
 *
 * 브라우저 로컬 카메라(getUserMedia)가 아니라, 서버가 내려주는 MJPEG 스트림
 * (/api/camera/stream)을 <img>로 받아 그 프레임을 캔버스에 그린다.
 * 앱이 평문 HTTP로 서비스되고 있어 getUserMedia를 쓸 수 없기 때문이다
 * (보안 컨텍스트 전용 API라 HTTP에서는 아예 동작하지 않는다).
 *
 * 줌은 클라이언트에서 잘라내는 방식(디지털 줌)이다. 서버 쪽 ffmpeg는 프로세스 하나를
 * 모든 접속자가 나눠 쓰기 때문에, 거기서 줌을 걸면 보고 있는 모든 사람의 화면이 같이
 * 확대돼버린다. 잘라낸 영역을 그대로 캔버스에 그리고 그 캔버스를 저장하므로,
 * 화면에 보이는 것과 저장되는 사진이 항상 같다.
 */
export default function CameraCaptureModal({
  open,
  onCapture,
  onClose,
  title = "카메라로 촬영",
  isLightMode = false,
  highRes = true,
}: {
  open: boolean;
  onCapture: (dataUrl: string) => void;
  onClose: () => void;
  title?: string;
  isLightMode?: boolean;
  /** 사진으로 남길 화면이라 고해상도(1600x1200)로 받는다. 서버가 재인코딩 없이
   *  카메라 원본을 그대로 흘려보내므로 CPU는 오히려 기본 모드보다 싸고, 대역폭만 올라간다. */
  highRes?: boolean;
}) {
  const [streamUrl, setStreamUrl] = useState("");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [cameraAttempt, setCameraAttempt] = useState(0);
  const [zoom, setZoom] = useState(1);
  // 잘라낼 영역의 중심 (0~1, 원본 기준). 줌이 1이면 의미가 없다.
  const [center, setCenter] = useState({ x: 0.5, y: 0.5 });
  const [capturing, setCapturing] = useState(false);
  // 찍은 사진을 바로 쓰지 않고 한 번 보여준 뒤 "이 사진 사용"을 눌러야 확정한다 —
  // 흔들리거나 잘못 찍었을 때 다시 찍을 기회가 있어야 한다.
  const [captured, setCaptured] = useState<string | null>(null);
  // 다른 탭이 카메라를 가져가서 이 화면의 미리보기를 놓은 상태. 다시 가져올 수 있게 안내한다.
  const [revoked, setRevoked] = useState(false);
  // 카메라 전용 포트로 스트림을 못 열었을 때 딱 한 번 예전 방식(같은 오리진)으로 다시 시도한다.
  const retriedSameOrigin = useRef(false);
  const autoRefreshCount = useRef(0);
  // 연결을 다시 시작할 때 이전 비동기 주소 조회가 늦게 끝나 새 스트림을 덮지 못하게 한다.
  const connectionSeq = useRef(0);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const C = {
    card: isLightMode ? "#ffffff" : "#161f30",
    cardSub: isLightMode ? "#f4f6f9" : "#0f172a",
    border: isLightMode ? "#e6e9ef" : "#26324a",
    text: isLightMode ? "#111827" : "#f1f5f9",
    label: isLightMode ? "#64748b" : "#94a3b8",
    accent: "#2563eb",
    accentSoft: isLightMode ? "rgba(37,99,235,0.09)" : "rgba(37,99,235,0.16)",
    error: isLightMode ? "#dc2626" : "#f87171",
  };

  // MJPEG는 한 번 열면 계속 열려 있는 연결이라, 확실히 끊어주지 않으면 창을 닫아도
  // 서버가 계속 프레임을 쏜다(실제로 PC 3대가 14개 연결을 물고 378Mbps를 쓰고 있었다).
  // React가 <img>를 걷어내는 것에만 기대지 않고 src를 직접 비워 연결을 닫는다.
  useEffect(() => () => { if (imgRef.current) imgRef.current.src = ""; releaseCameraStream(); }, []);

  // 모달이 열려 있는 동안만 스트림을 연다.
  useEffect(() => {
    let cleanupUrl: (() => void) | null = null;
    if (open) {
      const seq = ++connectionSeq.current;
      setReady(false);
      setError("");
      setZoom(1);
      setCenter({ x: 0.5, y: 0.5 });
      setCapturing(false);
      setCaptured(null);
      setRevoked(false);
      retriedSameOrigin.current = false;
      autoRefreshCount.current = 0;
      resetCameraBase();
      setCameraAttempt((n) => n + 1);
      // 다른 탭이 카메라를 보고 있으면 그쪽이 놓게 한다 — 한 브라우저에 스트림은 하나만 둔다.
      // (스트림은 끝나지 않는 응답이라 여러 개가 열리면 연결 한도를 먹어 앱이 멎는다)
      claimCameraStream(() => { if (connectionSeq.current === seq) { setStreamUrl(""); setRevoked(true); } });
      // 미리보기는 언제나 기본 해상도로 받는다. 고해상도를 계속 흘리면 뷰어 1명당
      // ~42Mbps라 사무실 망이 포화된다 — 원본은 셔터를 누를 때 한 장만 받아온다.
      let alive = true;
      cameraUrl(`/api/camera/stream?t=${Date.now()}`).then((u) => { if (alive && connectionSeq.current === seq) setStreamUrl(u); });
      cleanupUrl = () => { alive = false; };
    } else {
      connectionSeq.current += 1;
      if (imgRef.current) imgRef.current.src = "";
      setStreamUrl("");
      setReady(false);
      setError("");
      setRevoked(false);
      setCaptured(null);
      releaseCameraStream();
    }
    return () => { cleanupUrl?.(); };
  }, [open, highRes]);

  const reconnectCamera = useCallback((strategy: "probe" | "same-origin" | "hard" = "hard") => {
    const seq = ++connectionSeq.current;
    if (imgRef.current) { imgRef.current.src = ""; imgRef.current.removeAttribute("src"); }
    if (strategy === "hard") hardResetCameraSession();
    else releaseCameraStream();
    if (strategy === "same-origin") fallbackToSameOrigin();
    else resetCameraBase();
    retriedSameOrigin.current = false;
    setStreamUrl("");
    setReady(false);
    setError("");
    setRevoked(false);
    setCameraAttempt((n) => n + 1);
    claimCameraStream(() => {
      if (connectionSeq.current !== seq) return;
      if (imgRef.current) imgRef.current.src = "";
      setStreamUrl("");
      setReady(false);
      setRevoked(true);
    });
    cameraUrl(`/api/camera/stream?t=${Date.now()}`)
      .then((u) => { if (connectionSeq.current === seq) setStreamUrl(u); })
      .catch(() => { if (connectionSeq.current === seq) setError("카메라 서버에 다시 연결하지 못했습니다."); });
  }, []);

  const restartCameraServer = useCallback(async () => {
    connectionSeq.current += 1;
    if (imgRef.current) { imgRef.current.src = ""; imgRef.current.removeAttribute("src"); }
    releaseCameraStream();
    autoRefreshCount.current = 0;
    setStreamUrl("");
    setReady(false);
    setError("");
    setRevoked(false);
    try {
      await restartCameraCapture();
      reconnectCamera("hard");
    } catch (e: any) {
      setError(e?.message || "카메라 프로세스를 재시작하지 못했습니다.");
    }
  }, [reconnectCamera]);

  // 오류 이벤트 없이 MJPEG 요청이 계속 대기하는 경우도 있으므로 첫 프레임을 3초만 기다린다.
  // 입력 중인 내용을 잃는 window.reload() 대신 같은 오리진 우회 → 카메라 세션 하드 리셋 순으로 복구한다.
  useEffect(() => {
    if (!open || ready || revoked) return;
    const watchedAttempt = cameraAttempt;
    const timer = window.setTimeout(() => {
      if (!open || ready || revoked || cameraAttempt !== watchedAttempt) return;
      const next = autoRefreshCount.current + 1;
      autoRefreshCount.current = next;
      if (next === 1) reconnectCamera("same-origin");
      else if (next === 2) reconnectCamera("hard");
      else setError("카메라 자동 새로고침 후에도 연결되지 않았습니다. 서버 PC의 웹캠을 확인해주세요.");
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [open, ready, revoked, cameraAttempt, reconnectCamera]);

  // 지금 줌·위치에서 원본의 어느 사각형을 쓸지. 화면 밖으로 나가지 않게 가둔다.
  const cropRect = useCallback(
    (img: HTMLImageElement) => {
      const w = img.naturalWidth / zoom;
      const h = img.naturalHeight / zoom;
      const x = Math.min(img.naturalWidth - w, Math.max(0, center.x * img.naturalWidth - w / 2));
      const y = Math.min(img.naturalHeight - h, Math.max(0, center.y * img.naturalHeight - h / 2));
      return { x, y, w, h };
    },
    [zoom, center]
  );

  // 스트림 프레임을 매번 캔버스에 잘라 그린다 — 이 캔버스가 곧 저장될 사진이다.
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    // 서버가 보내주는 것보다 자주 그릴 이유가 없다. rAF는 초당 60번 돌지만 프레임은
    // 고해상도 8fps · 기본 15fps로만 온다. 고해상도 캔버스는 1600x1200이라 60fps로
    // 다시 그리면 초당 1억 화소를 헛되이 칠하게 되고, 사무실 PC에서는 그것만으로
    // 탭 전체가 멎는다(촬영 화면이 "서버가 멈춘 것처럼" 보이던 원인).
    const minGap = 1000 / 10; // 서버가 8fps로 보내므로 그보다 조금만 자주 그리면 충분하다
    let lastDraw = 0;
    const draw = () => {
      const now = performance.now();
      if (now - lastDraw < minGap) { raf = requestAnimationFrame(draw); return; }
      lastDraw = now;
      const img = imgRef.current;
      const cv = canvasRef.current;
      if (img && cv && img.naturalWidth) {
        const { x, y, w, h } = cropRect(img);
        if (cv.width !== Math.round(w) || cv.height !== Math.round(h)) {
          cv.width = Math.round(w);
          cv.height = Math.round(h);
        }
        cv.getContext("2d")?.drawImage(img, x, y, w, h, 0, 0, cv.width, cv.height);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [open, cropRect, highRes]);

  if (!open) return null;

  const capture = async () => {
    const cv = canvasRef.current;
    if (!cv || !cv.width) { setError("아직 카메라 미리보기가 준비되지 않았습니다."); return; }
    // 기본(저해상도)로 충분한 화면이면 미리보기 캔버스를 그대로 쓴다.
    if (!highRes) { setCaptured(cv.toDataURL("image/jpeg", 0.9)); return; }

    // 물품 등록·불량 로그는 원본 해상도가 필요하다. 그 한 장만 서버에 따로 청한다.
    setCapturing(true);
    setError("");
    try {
      const r = await fetch(await cameraUrl(`/api/camera/snapshot?t=${Date.now()}`));
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "촬영에 실패했습니다.");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      try {
        const img = await new Promise<HTMLImageElement>((res, rej) => {
          const im = new Image();
          im.onload = () => res(im);
          im.onerror = () => rej(new Error("촬영한 사진을 읽지 못했습니다."));
          im.src = url;
        });
        // 미리보기에서 잡아둔 줌·위치는 원본 비율로 저장돼 있어 해상도가 달라도 그대로 맞는다.
        const { x, y, w, h } = cropRect(img);
        const out = document.createElement("canvas");
        out.width = Math.round(w);
        out.height = Math.round(h);
        out.getContext("2d")?.drawImage(img, x, y, w, h, 0, 0, out.width, out.height);
        setCaptured(out.toDataURL("image/jpeg", 0.9));
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (e: any) {
      setError(e?.message || "촬영에 실패했습니다.");
    } finally {
      setCapturing(false);
    }
  };

  const retake = () => { setCaptured(null); setError(""); };
  const confirmCapture = () => {
    if (!captured) return;
    onCapture(captured);
    onClose();
  };

  const stepZoom = (dir: 1 | -1) => {
    const i = ZOOM_STEPS.indexOf(zoom);
    const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, (i < 0 ? 0 : i) + dir))];
    setZoom(next);
    if (next === 1) setCenter({ x: 0.5, y: 0.5 }); // 원래대로 돌아오면 중앙으로
  };

  // 확대한 상태에서 끌어서 보고 싶은 곳으로 옮긴다 (안 그러면 중앙만 찍을 수 있다).
  const onPointerDown = (e: React.PointerEvent) => {
    if (zoom === 1) return;
    dragRef.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const start = dragRef.current;
    const cv = canvasRef.current;
    if (!start || !cv) return;
    const rect = cv.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    // 화면에서 끈 거리를 원본 비율로 환산한다. 끄는 방향과 반대로 영역이 움직여야
    // "사진을 손으로 미는" 느낌이 된다.
    const dx = ((e.clientX - start.x) / rect.width) / zoom;
    const dy = ((e.clientY - start.y) / rect.height) / zoom;
    setCenter((c) => ({
      x: Math.min(1, Math.max(0, c.x - dx)),
      y: Math.min(1, Math.max(0, c.y - dy)),
    }));
    dragRef.current = { x: e.clientX, y: e.clientY };
  };
  const endDrag = () => { dragRef.current = null; };

  const btn = (active: boolean): React.CSSProperties => ({
    width: 34, height: 34, borderRadius: "8px", flexShrink: 0,
    border: `1px solid ${C.border}`, background: active ? C.accentSoft : C.cardSub,
    color: active ? C.accent : C.label, cursor: active ? "pointer" : "not-allowed",
    display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
  });

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 5000, background: "rgba(15,23,42,0.65)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", backdropFilter: "blur(2px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(520px, 100%)", background: C.card, borderRadius: "16px", border: `1px solid ${C.border}`, padding: "18px" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
          <Camera size={18} style={{ color: C.accent }} />
          <span style={{ flex: 1, fontSize: "15px", fontWeight: 800, color: C.text }}>{title}</span>
          <button onClick={restartCameraServer} title="브라우저 연결과 서버의 카메라 프로세스를 모두 재시작합니다" style={{ display: "inline-flex", alignItems: "center", gap: "5px", padding: "7px 10px", borderRadius: "8px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.accent, cursor: "pointer", fontSize: "11.5px", fontWeight: 800 }}>
            <RotateCcw size={13} /> 다시 연결
          </button>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: C.label, cursor: "pointer" }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ borderRadius: "10px", overflow: "hidden", border: `1px solid ${C.border}`, background: C.cardSub, minHeight: "160px", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {captured ? (
            <img src={captured} alt="촬영한 사진" style={{ width: "100%", maxHeight: "320px", objectFit: "contain", display: "block" }} />
          ) : <>
          {/* 스트림 원본. 화면에는 안 보이고 캔버스에 그리는 원천으로만 쓴다. */}
          {streamUrl ? (
            <img
              key={streamUrl}
              ref={imgRef}
              src={streamUrl}
              alt=""
              // 스트림을 다른 포트(오리진)에서 받기 때문에 이게 없으면 캔버스가 오염돼
              // toDataURL()이 막힌다 — 즉 찍은 사진을 저장할 수 없게 된다.
              crossOrigin="anonymous"
              onLoad={() => { autoRefreshCount.current = 0; setReady(true); }}
              onError={() => {
                if (!retriedSameOrigin.current) {
                  retriedSameOrigin.current = true;
                  fallbackToSameOrigin();
                  setStreamUrl(`/api/camera/stream?t=${Date.now()}`);
                  return;
                }
                setError("카메라 스트림을 불러오지 못했습니다. 서버 PC의 웹캠 연결을 확인해주세요.");
              }}
              style={{ display: "none" }}
            />
          ) : null}
          {revoked ? (
            <div style={{ padding: "22px 16px", textAlign: "center", fontSize: "12.5px", color: C.label, lineHeight: 1.6 }}>
              다른 화면에서 카메라를 열어 이 미리보기를 멈췄습니다.<br />
              카메라는 한 번에 한 곳에서만 볼 수 있습니다.
              <div>
                <button
                  onClick={() => {
                    autoRefreshCount.current = 0;
                    reconnectCamera("hard");
                  }}
                  style={{ marginTop: "12px", padding: "8px 16px", borderRadius: "9px", border: "none", background: C.accent, color: "#fff", fontSize: "12.5px", fontWeight: 800, cursor: "pointer" }}
                >
                  여기서 다시 보기
                </button>
              </div>
            </div>
          ) : null}
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            style={{
              width: "100%", maxHeight: "320px", objectFit: "contain",
              display: ready ? "block" : "none",
              cursor: zoom > 1 ? "grab" : "default",
              touchAction: "none",
            }}
          />
          {!ready ? <span style={{ fontSize: "12.5px", color: C.label, padding: "40px" }}>카메라 준비 중…</span> : null}
          </>}
        </div>

        {!captured ? (
          <>
            {/* 줌 — 서버가 아니라 이 화면에서만 잘라 확대한다 */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "10px" }}>
              <button onClick={() => stepZoom(-1)} disabled={zoom <= ZOOM_STEPS[0]} style={btn(zoom > ZOOM_STEPS[0])} title="축소">
                <ZoomOut size={16} />
              </button>
              <div style={{ minWidth: "46px", textAlign: "center", fontSize: "13px", fontWeight: 800, color: C.text }}>{zoom}×</div>
              <button onClick={() => stepZoom(1)} disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]} style={btn(zoom < ZOOM_STEPS[ZOOM_STEPS.length - 1])} title="확대">
                <ZoomIn size={16} />
              </button>
              <button
                onClick={() => { setZoom(1); setCenter({ x: 0.5, y: 0.5 }); }}
                disabled={zoom === 1}
                style={{ ...btn(zoom !== 1), width: "auto", padding: "0 10px", gap: "5px", fontSize: "12px", fontWeight: 700 }}
                title="원래 크기로"
              >
                <Maximize size={14} /> 전체
              </button>
              <span style={{ flex: 1, textAlign: "right", fontSize: "11px", color: C.label }}>
                {zoom > 1 ? "끌어서 위치 이동" : "확대하면 끌어서 옮길 수 있습니다"}
              </span>
            </div>

            {error ? <div style={{ marginTop: "8px", fontSize: "11.5px", color: C.error }}>{error}</div> : null}

            <div style={{ fontSize: "11.5px", color: C.label, marginTop: "8px" }}>
              서버 PC에 연결된 카메라 화면입니다. 보이는 그대로 저장됩니다.
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "12px" }}>
              <button
                onClick={onClose}
                style={{ flex: 1, padding: "12px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.text, fontSize: "13px", fontWeight: 700, cursor: "pointer" }}
              >
                취소
              </button>
              <button
                onClick={capture}
                disabled={!ready || capturing}
                style={{
                  flex: 2, padding: "12px", borderRadius: "10px", border: "none",
                  background: ready && !capturing ? C.accent : C.border, color: ready && !capturing ? "#fff" : C.label,
                  fontSize: "13px", fontWeight: 800, cursor: ready && !capturing ? "pointer" : "not-allowed",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                }}
              >
                <Camera size={15} /> {capturing ? "원본 사진 받는 중…" : "이 화면으로 촬영"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: "11.5px", color: C.label, marginTop: "10px", textAlign: "center" }}>
              이 사진으로 괜찮은지 확인해주세요.
            </div>
            <div style={{ display: "flex", gap: "10px", marginTop: "12px" }}>
              <button
                onClick={retake}
                style={{ flex: 1, padding: "12px", borderRadius: "10px", border: `1px solid ${C.border}`, background: C.cardSub, color: C.text, fontSize: "13px", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}
              >
                <RotateCcw size={15} /> 다시 찍기
              </button>
              <button
                onClick={confirmCapture}
                style={{ flex: 2, padding: "12px", borderRadius: "10px", border: "none", background: C.accent, color: "#fff", fontSize: "13px", fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}
              >
                <Camera size={15} /> 이 사진 사용
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
