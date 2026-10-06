import React, { useCallback, useEffect, useRef, useState } from "react";
import { X, RotateCcw, ChevronLeft, Package } from "lucide-react";
import { getThumbImageUrl } from "../utils/drive";

/**
 * 실측 치수(가로·세로·높이)를 육면체로 보여준다.
 *
 * three.js를 쓰지 않는다. 그릴 게 꼭짓점 8개·면 6개뿐이라 라이브러리를 넣으면 얻는 것보다
 * 번들이 커지는 손해가 크다. 캔버스에 직접 투영해 그리면 의존성이 늘지 않는다.
 *
 * 렌더링은 전부 보는 사람의 브라우저에서 일어난다 — 서버는 숫자 세 개만 내려준다.
 */

/** 치수를 어떤 형태로 그릴지. 안 고르면 육면체다(지금까지의 동작). */
export type ItemShape = "box" | "cylinder" | "pyramid";

export const SHAPE_LABEL: Record<ItemShape, string> = {
  box: "육면체",
  cylinder: "원통",
  pyramid: "피라미드",
};

type Dims = { widthMm?: number; depthMm?: number; heightMm?: number; shape?: ItemShape };
type CameraView = "left" | "center" | "right";

/** 세 값이 모두 있어야 육면체를 그릴 수 있다. */
export function hasDims(it: Dims | null | undefined): boolean {
  return !!(it && [it.widthMm, it.depthMm, it.heightMm].every((value) => Number.isFinite(Number(value)) && Number(value) > 0));
}

/** "30 × 20 × 15cm"처럼 사람이 읽는 한 줄. mm가 잘게 남으면 소수점 한 자리까지만 보여준다. */
export function dimsLabel(it: Dims): string {
  const cm = (v: any) => {
    const n = Number(v) / 10;
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  };
  return `${cm(it.widthMm)} × ${cm(it.depthMm)} × ${cm(it.heightMm)}cm`;
}

// 육면체의 꼭짓점 8개 (가로 x, 높이 y, 세로 z)
const CORNERS: [number, number, number][] = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
];
// 면 6개와 각 면의 바깥 방향(법선) — 법선으로 밝기를 정해 입체로 보이게 한다
const FACES: { v: number[]; n: [number, number, number] }[] = [
  { v: [4, 5, 6, 7], n: [0, 0, 1] },   // 앞
  { v: [1, 0, 3, 2], n: [0, 0, -1] },  // 뒤
  { v: [0, 4, 7, 3], n: [-1, 0, 0] },  // 왼쪽
  { v: [5, 1, 2, 6], n: [1, 0, 0] },   // 오른쪽
  { v: [7, 6, 2, 3], n: [0, 1, 0] },   // 위
  { v: [0, 1, 5, 4], n: [0, -1, 0] },  // 아래
];

type Geom = { verts: number[][]; faces: { idx: number[]; n: number[] }[] };

function boxGeom(hx: number, hy: number, hz: number): Geom {
  return {
    verts: CORNERS.map((c) => [c[0] * hx, c[1] * hy, c[2] * hz]),
    faces: FACES.map((f) => ({ idx: f.v, n: f.n as number[] })),
  };
}

/**
 * 원통. 확대 보기에서도 매끄럽게 보이도록 64개 면으로 그린다.
 * 가로와 세로를 따로 받아 타원 기둥까지 그린다 — 단면이 완전한 원이 아닌 물건도 있다.
 */
function cylinderGeom(rx: number, hy: number, rz = rx, seg = 64): Geom {
  const verts: number[][] = [];
  for (const sign of [-1, 1]) {
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      verts.push([Math.cos(a) * rx, sign * hy, Math.sin(a) * rz]);
    }
  }
  const faces: { idx: number[]; n: number[] }[] = [];
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    const a = ((i + 0.5) / seg) * Math.PI * 2; // 옆면 법선은 그 면의 한가운데 방향
    // 타원이면 법선도 반지름 비율만큼 기울어야 밝기가 자연스럽다.
    const nx = Math.cos(a) * rz, nz = Math.sin(a) * rx;
    const len = Math.hypot(nx, nz) || 1;
    faces.push({ idx: [i, j, seg + j, seg + i], n: [nx / len, 0, nz / len] });
  }
  faces.push({ idx: Array.from({ length: seg }, (_, i) => seg + i), n: [0, 1, 0] });      // 윗면
  faces.push({ idx: Array.from({ length: seg }, (_, i) => seg - 1 - i), n: [0, -1, 0] }); // 아랫면
  return { verts, faces };
}

/** 사각뿔. 바닥은 가로×세로 직사각형이고 꼭대기는 한 점이다. */
function pyramidGeom(hx: number, hy: number, hz: number): Geom {
  // 0~3 = 바닥 네 귀퉁이(반시계), 4 = 꼭짓점
  const verts: number[][] = [
    [-hx, -hy, hz], [hx, -hy, hz], [hx, -hy, -hz], [-hx, -hy, -hz],
    [0, hy, 0],
  ];
  const faces: { idx: number[]; n: number[] }[] = [
    { idx: [3, 2, 1, 0], n: [0, -1, 0] }, // 바닥
  ];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const a = verts[i], b = verts[j], c = verts[4];
    // 두 모서리의 외적이 그 삼각형의 바깥 방향이다.
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    faces.push({ idx: [i, j, 4], n: [n[0] / len, n[1] / len, n[2] / len] });
  }
  return { verts, faces };
}

/** 지금 방향에 맞춰 물품 도형을 만든다. 원통·피라미드는 세운 축이 화면 높이(y)다. */
function itemGeom(shape: ItemShape, hx: number, hy: number, hz: number): Geom {
  if (shape === "cylinder") return cylinderGeom(hx, hy, hz);
  if (shape === "pyramid") return pyramidGeom(hx, hy, hz);
  return boxGeom(hx, hy, hz);
}

function rotate(p: number[], yaw: number, pitch: number) {
  const [x, y, z] = p;
  const x1 = x * Math.cos(yaw) + z * Math.sin(yaw);
  const z1 = -x * Math.sin(yaw) + z * Math.cos(yaw);
  const y2 = y * Math.cos(pitch) - z1 * Math.sin(pitch);
  const z2 = y * Math.sin(pitch) + z1 * Math.cos(pitch);
  return [x1, y2, z2];
}

/** 테이블은 실측 축척을 유지하고, 확대 보기에서는 물품을 화면 중앙에 맞춘다. */
const BOARD = { w: 1200, d: 600, h: 30 };
// 시점 조절 범위. 빈 곳을 끌어 돌리거나 휠로 확대할 때도 같은 범위를 지킨다.
const YAW_RANGE = { min: -180, max: 180 };
const PITCH_RANGE = { min: 15, max: 75 };
const ZOOM_RANGE = { min: 50, max: 300 };
const clampTo = (v: number, r: { min: number; max: number }) => Math.max(r.min, Math.min(r.max, v));

/** 점이 다각형 안에 있는지 (짝홀 규칙) */
function insidePolygon(x: number, y: number, poly: number[][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi) inside = !inside;
  }
  return inside;
}
const INITIAL_ORIENTATION = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function transformVector(p: number[], matrix: number[]) {
  return [0, 1, 2].map((row) => matrix[row * 3] * p[0] + matrix[row * 3 + 1] * p[1] + matrix[row * 3 + 2] * p[2]);
}

function orientGeometry(geom: Geom, matrix: number[]): Geom {
  const verts = geom.verts.map((p) => transformVector(p, matrix));
  const floor = Math.min(...verts.map((p) => p[1]));
  return {
    verts: verts.map(([x, y, z]) => [x, y - floor, z]),
    faces: geom.faces.map((f) => ({ idx: f.idx, n: transformVector(f.n, matrix) })),
  };
}

export function BoxCanvas({
  widthMm, depthMm, heightMm, shape = "box", height = 260, accent = "#3b82f6", view = "center",
}: Dims & { height?: number; accent?: string; view?: CameraView }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; mode: "item" | "view" } | null>(null);
  const scaleRef = useRef(1);
  // 마지막으로 그린 물품 면들의 화면 위치. 누른 곳이 물품인지 빈 곳인지 가를 때 쓴다.
  const itemHitRef = useRef<number[][][]>([]);
  const [hoverItem, setHoverItem] = useState(false);
  const [pos, setPos] = useState({ x: 0, z: 0 });
  const [orientation, setOrientation] = useState(INITIAL_ORIENTATION);
  const [closeup, setCloseup] = useState(true);
  const [dragging, setDragging] = useState<false | "item" | "view">(false);
  const defaultYaw = view === "left" ? -38 : view === "right" ? 38 : -18;
  const [yawDegrees, setYawDegrees] = useState(defaultYaw);
  const [pitchDegrees, setPitchDegrees] = useState(40);
  const [zoom, setZoom] = useState(100);
  const yaw = yawDegrees * Math.PI / 180;
  const pitch = -pitchDegrees * Math.PI / 180;
  const w = Number(widthMm) || 0, d = Number(depthMm) || 0, h = Number(heightMm) || 0;
  const valid = hasDims({ widthMm, depthMm, heightMm });
  const geometry = orientGeometry(itemGeom(shape, w / 2, h / 2, d / 2), orientation);
  const xs = geometry.verts.map((p) => p[0]), ys = geometry.verts.map((p) => p[1]), zs = geometry.verts.map((p) => p[2]);
  const sizeX = Math.max(...xs) - Math.min(...xs);
  const sizeY = Math.max(...ys);
  const sizeZ = Math.max(...zs) - Math.min(...zs);
  const limitX = Math.max(0, (BOARD.w - sizeX) / 2);
  const limitZ = Math.max(0, (BOARD.d - sizeZ) / 2);
  const itemX = Math.max(-limitX, Math.min(limitX, pos.x));
  const itemZ = Math.max(-limitZ, Math.min(limitZ, pos.z));
  const cm = (n: number) => Number.isInteger(n / 10) ? String(n / 10) : (n / 10).toFixed(1);

  useEffect(() => {
    setPos({ x: 0, z: 0 });
    setOrientation([...INITIAL_ORIENTATION]);
    drag.current = null;
    setDragging(false);
  }, [widthMm, depthMm, heightMm, shape]);

  useEffect(() => {
    setYawDegrees(defaultYaw);
    setPitchDegrees(40);
    setZoom(100);
  }, [view]);

  const turn = (axis: "x" | "y", direction: number) => {
    setPos({ x: itemX, z: itemZ });
    setOrientation((matrix) => {
      const result = [...matrix];
      // 실제 꼭짓점과 법선을 90도 회전한다. 원통을 눕혀도 축이 보존된다.
      for (let col = 0; col < 3; col++) {
        if (axis === "y") {
          result[col] = direction * matrix[6 + col];
          result[6 + col] = -direction * matrix[col];
        } else {
          result[3 + col] = -direction * matrix[6 + col];
          result[6 + col] = direction * matrix[3 + col];
        }
      }
      return result;
    });
  };

  const draw = useCallback(() => {
    const cv = canvasRef.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const cssW = cv.clientWidth || 300, cssH = height;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(cssW * dpr);
    cv.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const background = ctx.createLinearGradient(0, 0, 0, cssH);
    background.addColorStop(0, "#f8fafc");
    background.addColorStop(1, "#edf2f7");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, cssW, cssH);
    if (!valid) return;

    const models = [
      { geom: boxGeom(BOARD.w / 2, BOARD.h / 2, BOARD.d / 2), cx: 0, cy: -BOARD.h / 2, cz: 0, color: "#e2e8f0", kind: "board" },
      { geom: geometry, cx: itemX, cy: 0, cz: itemZ, color: accent, kind: "item" },
    ];
    const worldPoints = (model: typeof models[number]) =>
      model.geom.verts.map((p) => [p[0] + model.cx, p[1] + model.cy, p[2] + model.cz]);
    const fitModels = closeup ? models.filter((model) => model.kind !== "board") : models;
    const points = fitModels.flatMap((model) => worldPoints(model).map((p) => rotate(p, yaw, pitch)));
    const minX = Math.min(...points.map((p) => p[0])), maxX = Math.max(...points.map((p) => p[0]));
    const minY = Math.min(...points.map((p) => p[1])), maxY = Math.max(...points.map((p) => p[1]));
    const padX = 28, padY = 30;
    const scale = Math.min((cssW - padX * 2) / Math.max(1, maxX - minX), (cssH - padY * 2) / Math.max(1, maxY - minY)) * zoom / 100;
    scaleRef.current = scale;
    const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
    const projectRotated = (p: number[]) => [cssW / 2 + (p[0] - centerX) * scale, cssH / 2 - (p[1] - centerY) * scale];
    const project = (p: number[]) => projectRotated(rotate(p, yaw, pitch));
    const path = (pts: number[][]) => {
      ctx.beginPath();
      pts.forEach((p, i) => i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1]));
      ctx.closePath();
    };
    const paint = (model: typeof models[number]) => {
      const points3d = worldPoints(model).map((p) => rotate(p, yaw, pitch));
      const points2d = points3d.map(projectRotated);
      const faces = model.geom.faces.map((f) => ({
        ...f, normal: rotate(f.n, yaw, pitch),
        depth: f.idx.reduce((sum, i) => sum + points3d[i][2], 0) / f.idx.length,
      })).filter((f) => f.normal[2] < -0.00001).sort((a, b) => b.depth - a.depth);
      const rgb = hexToRgb(model.color);
      if (model.kind === "item") itemHitRef.current = faces.map((f) => f.idx.map((i) => points2d[i]));
      faces.forEach((f) => {
        const lit = Math.min(1.1, 0.64 + 0.46 * Math.max(0, f.normal[0] * -0.3 + f.normal[1] * 0.7 - f.normal[2] * 0.6));
        path(f.idx.map((i) => points2d[i]));
        ctx.fillStyle = `rgb(${Math.min(255, Math.round(rgb.r * lit))},${Math.min(255, Math.round(rgb.g * lit))},${Math.min(255, Math.round(rgb.b * lit))})`;
        ctx.fill();
        // 인접한 곡면 사이의 안티앨리어싱 틈도 같은 색으로 채운다.
        if (model.kind === "item" && shape === "cylinder" && f.idx.length <= 4) {
          ctx.strokeStyle = ctx.fillStyle;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
        // 원통 옆면의 촘촘한 세로선을 없애 매끄러운 곡면으로 보이게 한다.
        if (model.kind === "board" || (model.kind === "item" && shape !== "cylinder") || f.idx.length > 4) {
          ctx.strokeStyle = model.kind === "board" ? "#cbd5e1" : "rgba(15,23,42,0.15)";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      });
    };

    paint(models[0]);
    // 기준면의 10cm 눈금은 물품 크기를 가늠할 때만 보조한다.
    ctx.strokeStyle = "rgba(148,163,184,0.22)";
    ctx.lineWidth = 0.7;
    for (let x = -BOARD.w / 2; x <= BOARD.w / 2; x += 100) {
      const a = project([x, 0, -BOARD.d / 2]), b = project([x, 0, BOARD.d / 2]);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    for (let z = -BOARD.d / 2; z <= BOARD.d / 2; z += 100) {
      const a = project([-BOARD.w / 2, 0, z]), b = project([BOARD.w / 2, 0, z]);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    const objects = models.slice(1).sort((a, b) =>
      rotate([b.cx, b.cy, b.cz], yaw, pitch)[2] - rotate([a.cx, a.cy, a.cz], yaw, pitch)[2]);
    objects.forEach((model) => {
      const shadowX = sizeX / 2;
      const shadowZ = sizeZ / 2;
      path(Array.from({ length: 40 }, (_, i) => {
        const angle = i / 40 * Math.PI * 2;
        return project([model.cx + Math.cos(angle) * shadowX, 0, model.cz + Math.sin(angle) * shadowZ]);
      }));
      ctx.fillStyle = "rgba(15,23,42,0.10)";
      ctx.fill();
    });
    objects.forEach(paint);
  }, [widthMm, depthMm, heightMm, shape, height, accent, yawDegrees, pitchDegrees, zoom, pos, orientation, closeup]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault(); // 3D 영역 위에서는 페이지 대신 모형을 확대·축소한다
      const factor = Math.exp(-e.deltaY * 0.0015);
      setZoom((z) => Math.round(clampTo(z * factor, ZOOM_RANGE)));
    };
    cv.addEventListener("wheel", onWheel, { passive: false });
    return () => cv.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    draw();
    const observer = new ResizeObserver(() => draw());
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [draw]);

  const buttonStyle: React.CSSProperties = {
    minHeight: 36, padding: "7px 10px", borderRadius: 8, border: "1px solid #dbe3ed",
    background: "#fff", color: "#334155", cursor: "pointer", fontSize: 11, fontWeight: 700,
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, fontFamily: "inherit",
  };
  return (
    <div style={{ background: "#f8fafc", color: "#334155" }}>
      <div style={{ padding: "10px 12px 0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: "#64748b" }}>{closeup ? "물품 확대" : "테이블 전체"} · 기준 테이블 120 × 60 cm</span>
        <button type="button" aria-pressed={closeup} onClick={() => { setCloseup((value) => !value); setZoom(100); }} style={buttonStyle}>
          {closeup ? "테이블 전체 보기" : "물품 확대 보기"}
        </button>
      </div>
      <canvas
        ref={canvasRef}
        aria-label={`${SHAPE_LABEL[shape]} 크기 미리보기. 가로 ${cm(sizeX)}, 세로 ${cm(sizeZ)}, 높이 ${cm(sizeY)} 센티미터`}
        style={{ width: "100%", height, cursor: dragging === "item" ? "grabbing" : dragging === "view" ? "grabbing" : hoverItem ? "move" : "grab", touchAction: "none", display: "block" }}
        onPointerDown={(e) => {
          if (e.button !== 0 || drag.current) return;
          const r = e.currentTarget.getBoundingClientRect();
          const onItem = itemHitRef.current.some((poly) => insidePolygon(e.clientX - r.left, e.clientY - r.top, poly));
          drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, mode: onItem ? "item" : "view" };
          setDragging(onItem ? "item" : "view");
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) {
            // 누르기 전: 물품 위면 이동 커서, 빈 곳이면 돌리기 커서
            const r = e.currentTarget.getBoundingClientRect();
            const over = itemHitRef.current.some((poly) => insidePolygon(e.clientX - r.left, e.clientY - r.top, poly));
            if (over !== hoverItem) setHoverItem(over);
            return;
          }
          if (drag.current.id !== e.pointerId) return;
          if (e.clientX === drag.current.x && e.clientY === drag.current.y) return;
          if (drag.current.mode === "view") {
            // 빈 곳을 끌면 책상을 돌린다: 좌우로 끌면 좌우 각도, 위아래로 끌면 내려다보는 각도.
            const mx = e.clientX - drag.current.x, my = e.clientY - drag.current.y;
            drag.current = { ...drag.current, x: e.clientX, y: e.clientY };
            setYawDegrees((v) => Math.round(clampTo(v + mx * 0.45, YAW_RANGE)));
            setPitchDegrees((v) => Math.round(clampTo(v + my * 0.35, PITCH_RANGE)));
            return;
          }
          const dx = (e.clientX - drag.current.x) / scaleRef.current;
          const dz = -(e.clientY - drag.current.y) / scaleRef.current / Math.sin(-pitch);
          drag.current = { ...drag.current, x: e.clientX, y: e.clientY };
          setPos(() => ({
            x: Math.max(-limitX, Math.min(limitX, itemX + dx * Math.cos(yaw) - dz * Math.sin(yaw))),
            z: Math.max(-limitZ, Math.min(limitZ, itemZ + dx * Math.sin(yaw) + dz * Math.cos(yaw))),
          }));
          // 확대 화면은 물품 중심을 따라가므로 이동할 때 테이블 전체로 전환한다.
          setCloseup(false);
        }}
        onPointerUp={(e) => {
          if (drag.current?.id !== e.pointerId) return;
          drag.current = null; setDragging(false);
          if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => { drag.current = null; setDragging(false); }}
        onLostPointerCapture={() => { drag.current = null; setDragging(false); }}
      />
      <div style={{ padding: "12px", borderTop: "1px solid #e2e8f0", background: "#fff" }}>
        <div style={{ display: "grid", gap: 10, paddingBottom: 12, marginBottom: 12, borderBottom: "1px solid #edf2f7" }}>
          {[
            { label: "좌우 각도", name: "책상 좌우 각도", min: YAW_RANGE.min, max: YAW_RANGE.max, value: yawDegrees, unit: "°", update: setYawDegrees },
            { label: "내려다보기", name: "책상 내려다보기 각도", min: PITCH_RANGE.min, max: PITCH_RANGE.max, value: pitchDegrees, unit: "°", update: setPitchDegrees },
            { label: "확대 정도", name: "3D 미리보기 확대 정도", min: ZOOM_RANGE.min, max: ZOOM_RANGE.max, value: zoom, unit: "%", update: setZoom },
          ].map((control) => (
            <label key={control.name} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11, color: "#64748b" }}>
              <span style={{ flex: "0 0 65px" }}>{control.label}</span>
              <input type="range" aria-label={control.name} aria-valuetext={`${control.value}${control.unit}`} min={control.min} max={control.max} step={1}
                value={control.value} onChange={(event) => control.update(Number(event.target.value))}
                style={{ flex: 1, minWidth: 0, margin: 0, height: 22, accentColor: accent, cursor: "pointer" }} />
              <span style={{ flex: "0 0 36px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#334155" }}>{control.value}{control.unit}</span>
            </label>
          ))}
        </div>
        <div style={{ fontSize: 12, fontWeight: 800, lineHeight: 1.6, overflowWrap: "anywhere" }}>
          {SHAPE_LABEL[shape]} · 가로 {cm(sizeX)} × 세로 {cm(sizeZ)} × 높이 {cm(sizeY)} cm
        </div>
        {(sizeX > BOARD.w || sizeZ > BOARD.d) && <div style={{ marginTop: 3, color: "#64748b", fontSize: 11, lineHeight: 1.6 }}>현재 방향에서는 물품이 기준 테이블보다 큽니다.</div>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
          <button type="button" onClick={() => turn("y", -1)} style={buttonStyle} aria-label="물품을 왼쪽으로 90도 회전">↶ 왼쪽</button>
          <button type="button" onClick={() => turn("y", 1)} style={buttonStyle} aria-label="물품을 오른쪽으로 90도 회전">↷ 오른쪽</button>
          <button type="button" onClick={() => turn("x", 1)} style={buttonStyle} title="물품을 앞뒤로 90도 회전">눕히기</button>
          <button type="button" aria-label="초기화" title="위치·방향·시점·확대 초기화" onClick={() => { setPos({ x: 0, z: 0 }); setOrientation([...INITIAL_ORIENTATION]); setCloseup(true); setYawDegrees(defaultYaw); setPitchDegrees(40); setZoom(100); }} style={{ ...buttonStyle, width: 36, padding: 0 }}>
            <RotateCcw size={14} />
          </button>
        </div>
        <div style={{ marginTop: 9, color: "#64748b", fontSize: 11, lineHeight: 1.6 }}>물품을 끌면 위치 이동 · 빈 곳을 끌면 책상 돌리기 · 휠로 확대/축소 · 버튼으로 물품 방향 변경</div>
      </div>
    </div>
  );
}

/** "실제 크기 보기" 버튼이 여는 모달. */
/**
 * 실제 크기 보기.
 *
 * 종류가 나뉜 물품은 종류마다 크기가 다를 수 있다(대·중·소 같은). 볼 것이 둘 이상이면
 * 아무거나 먼저 띄우지 않고 "무엇의 크기를 볼지" 먼저 고르게 한다 — 어느 것을 보고 있는지
 * 모른 채 숫자만 읽으면 엉뚱한 크기로 오해하기 때문이다.
 * 고를 것이 하나뿐이거나 종류에 치수가 없으면 곧바로 그것을 보여준다(지금까지와 같다).
 */
export function SizeViewerModal({
  open, onClose, item, C, variants,
}: {
  open: boolean;
  onClose: () => void;
  item: (Dims & { name?: string }) | null;
  C: { card: string; border: string; text: string; label: string; accent: string };
  /** 이 물품의 종류들. 자기 치수를 가진 종류만 선택지로 뜬다. */
  variants?: (Dims & { id?: number; name?: string })[];
}) {
  const sized = (variants || []).filter((v) => hasDims(v));
  // undefined = 아직 안 고름(고르는 화면), null = 물품 전체, 숫자 = 그 종류.
  const [pick, setPick] = useState<number | null | undefined>(undefined);
  const [cameraView, setCameraView] = useState<CameraView>("center");
  // 고를 것이 둘 이상일 때만 고르는 화면을 거친다. 하나뿐이면 그걸 바로 연다.
  const optionCount = (hasDims(item) ? 1 : 0) + sized.length;
  useEffect(() => {
    if (optionCount > 1) { setPick(undefined); return; }
    setPick(hasDims(item) ? null : (sized.length ? 0 : null));
  }, [item]);
  useEffect(() => { if (open) setCameraView("center"); }, [open, item]);
  // 돌려보는 화면이라 드래그가 바깥에서 끝나기 쉽다 — 바깥 클릭으로는 닫지 않고
  // 닫기 버튼이나 Esc로만 닫는다.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !item) return null;
  const choosing = pick === undefined;
  const shown: Dims & { name?: string } = pick === null || pick === undefined ? item : (sized[pick] as any) || item;
  const shownLabel = pick === null ? "물품 전체" : pick === undefined ? "" : (sized[pick]?.name || "종류");
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1200, padding: "16px" }}
    >
      <div
        role="dialog" aria-modal="true" aria-label="물품 크기 보기"
        style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "16px", width: "min(440px, 100%)", maxHeight: "90dvh", overflowY: "auto" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: `1px solid ${C.border}` }}>
          <div>
            <div style={{ fontSize: "14px", fontWeight: 800, color: C.text }}>물품 크기 비교</div>
            <div style={{ fontSize: "11.5px", color: C.label, marginTop: "2px" }}>
              {/* 고를 것이 하나뿐이면 무엇을 보는지가 자명하므로 굳이 덧붙이지 않는다. */}
              {item.name}{optionCount > 1 && shownLabel ? ` · ${shownLabel}` : ""}
            </div>
          </div>
          <button onClick={onClose} aria-label="닫기" style={{ background: "none", border: "none", color: C.label, cursor: "pointer", padding: "4px" }}>
            <X size={18} />
          </button>
        </div>
        {/* ── 무엇의 크기를 볼지 고르는 화면 ── */}
        {choosing ? (
          <div style={{ padding: "14px 16px" }}>
            <div style={{ fontSize: "12px", color: C.label, marginBottom: "10px", lineHeight: 1.6 }}>
              종류마다 크기가 다릅니다. 어떤 것의 크기를 보시겠어요?
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
              {hasDims(item) ? (
                <SizePickRow C={C} label="물품 전체" sub={dimsLabel(item)} onClick={() => setPick(null)} />
              ) : null}
              {sized.map((v, i) => (
                // Fragment로 key를 준다 — 이 프로젝트의 타입 설정에서는 일반 함수 컴포넌트에
                // key를 직접 넘기면 타입 오류가 난다.
                <React.Fragment key={v.id ?? i}>
                <SizePickRow
                  C={C}
                  label={v.name || `종류 ${i + 1}`}
                  sub={dimsLabel(v)}
                  image={(v as any).image}
                  onClick={() => setPick(i)}
                />
                </React.Fragment>
              ))}
            </div>
          </div>
        ) : (
        <>
        {/* 고르는 화면을 거쳐 왔으면 되돌아갈 길을 둔다. */}
        {optionCount > 1 ? (
          <div style={{ padding: "9px 16px", borderBottom: `1px solid ${C.border}` }}>
            <button
              onClick={() => setPick(undefined)}
              style={{
                display: "inline-flex", alignItems: "center", gap: "4px",
                padding: "4px 10px", borderRadius: "999px", cursor: "pointer",
                fontSize: "11.5px", fontWeight: 700,
                border: `1px solid ${C.border}`, background: "transparent", color: C.label,
              }}
            >
              <ChevronLeft size={13} /> 다른 종류 보기
            </button>
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 6, padding: "9px 12px", borderBottom: `1px solid ${C.border}`, background: C.card }}>
          {(["left", "center", "right"] as CameraView[]).map((v) => (
            <button
              key={v}
              onClick={() => setCameraView(v)}
              style={{
                flex: 1, padding: "7px 10px", borderRadius: "8px", cursor: "pointer",
                border: `1px solid ${cameraView === v ? C.accent : C.border}`,
                background: cameraView === v ? `${C.accent}1f` : "transparent",
                color: cameraView === v ? C.accent : C.label,
                fontSize: "12px", fontWeight: 800,
              }}
            >
              {v === "left" ? "왼쪽 시점" : v === "right" ? "오른쪽 시점" : "기본 시점"}
            </button>
          ))}
        </div>
        <div style={{ background: "rgba(0,0,0,0.25)" }}>
          <BoxCanvas
            widthMm={shown.widthMm}
            depthMm={shown.depthMm}
            heightMm={shown.heightMm}
            shape={shown.shape}
            height={280}
            accent={C.accent}
            view={cameraView}
          />
        </div>
        <div style={{ padding: "10px 16px", fontSize: "11px", color: C.label, lineHeight: 1.6 }}>
          실측 치수를 바탕으로 단순화한 모형입니다.
        </div>
        </>
        )}
      </div>
    </div>
  );
}

/** 크기를 볼 대상을 고르는 한 줄. 사진이 있으면 같이 보여준다 — 이름만으로는 어느 것인지 헷갈린다. */
function SizePickRow({
  C, label, sub, image, onClick,
}: {
  C: { card: string; border: string; text: string; label: string; accent: string };
  label: string; sub: string; image?: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: "11px", width: "100%",
        padding: "9px 11px", borderRadius: "11px", cursor: "pointer", textAlign: "left",
        border: `1px solid ${C.border}`, background: "transparent", color: C.text,
        fontFamily: "inherit",
      }}
    >
      <span style={{ width: "38px", height: "38px", flexShrink: 0, borderRadius: "9px", overflow: "hidden", background: `${C.border}55`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {image
          ? <img src={image.startsWith("data:") ? image : getThumbImageUrl(image)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <Package size={16} style={{ color: C.label, opacity: 0.5 }} />}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: "13px", fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <span style={{ display: "block", fontSize: "11.5px", color: C.label, fontWeight: 600, marginTop: "1px" }}>{sub}</span>
      </span>
      <span style={{ fontSize: "13px", color: C.label, flexShrink: 0 }}>›</span>
    </button>
  );
}

function hexToRgb(hex: string) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return { r: 59, g: 130, b: 246 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}
