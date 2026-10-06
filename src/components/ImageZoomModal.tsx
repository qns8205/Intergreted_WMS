import React, { useEffect, useState } from "react";
import { X, RotateCcw, Sun, Droplet } from "lucide-react";

/**
 * 사진 확대 보기. 명도·채도를 그 자리에서 조절할 수 있다.
 *
 * 창고 사진은 조명이 고르지 않아 어둡게 찍힌 게 많고, 색상만 다른 종류를 구분할 때는
 * 채도를 올리는 쪽이 훨씬 빨리 판별된다. 원본 파일은 건드리지 않고 보는 동안에만
 * CSS 필터로 바꾸므로 서버도 저장된 사진도 전혀 영향을 받지 않는다.
 */
export default function ImageZoomModal({
  url, onClose, alt = "",
}: {
  /** 빈 문자열이면 닫힌 상태 */
  url: string;
  onClose: () => void;
  alt?: string;
}) {
  const [bright, setBright] = useState(1);
  const [sat, setSat] = useState(1);

  // 사진을 새로 열 때마다 초기값으로 — 앞 사진에서 만진 값이 따라오면 헷갈린다
  useEffect(() => { if (url) { setBright(1); setSat(1); } }, [url]);

  useEffect(() => {
    if (!url) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [url, onClose]);

  if (!url) return null;

  const touched = bright !== 1 || sat !== 1;
  const slider = (
    icon: React.ReactNode, label: string, value: number,
    set: (v: number) => void, min: number, max: number,
  ) => (
    <div style={{ display: "flex", alignItems: "center", gap: "9px", flex: 1, minWidth: "180px" }}>
      <span style={{ color: "rgba(226,232,240,0.85)", display: "flex", alignItems: "center", gap: "5px", fontSize: "11.5px", fontWeight: 700, flex: "none" }}>
        {icon} {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={0.05}
        value={value}
        onChange={(e) => set(Number(e.target.value))}
        style={{ flex: 1, accentColor: "#60a5fa", cursor: "pointer" }}
        aria-label={label}
      />
      <span style={{ color: "rgba(226,232,240,0.65)", fontSize: "11px", fontFamily: "monospace", minWidth: "34px", textAlign: "right", flex: "none" }}>
        {Math.round(value * 100)}%
      </span>
    </div>
  );

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.88)",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "16px",
      }}
    >
      <button
        onClick={onClose}
        aria-label="닫기"
        style={{ position: "absolute", top: "16px", right: "20px", background: "none", border: "none", color: "#fff", cursor: "pointer", padding: "4px" }}
      >
        <X size={30} />
      </button>

      <img
        src={url}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "92%", maxHeight: "calc(100% - 92px)", borderRadius: "8px", objectFit: "contain",
          filter: `brightness(${bright}) saturate(${sat})`,
        }}
      />

      {/* 조절 막대는 사진 위가 아니라 아래에 둔다 — 사진을 가리면 조절하는 의미가 없다 */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          marginTop: "14px", display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap",
          background: "rgba(15,23,42,0.9)", border: "1px solid rgba(255,255,255,0.14)",
          borderRadius: "12px", padding: "11px 15px", maxWidth: "min(620px, 100%)", width: "100%",
        }}
      >
        {slider(<Sun size={13} />, "명도", bright, setBright, 0.3, 2.5)}
        {slider(<Droplet size={13} />, "채도", sat, setSat, 0, 2.5)}
        <button
          onClick={() => { setBright(1); setSat(1); }}
          disabled={!touched}
          title="원본 그대로 보기"
          style={{
            display: "flex", alignItems: "center", gap: "5px", padding: "6px 10px", borderRadius: "8px",
            border: "1px solid rgba(255,255,255,0.18)", background: "none",
            color: touched ? "rgba(226,232,240,0.9)" : "rgba(226,232,240,0.35)",
            cursor: touched ? "pointer" : "default", fontSize: "11.5px", fontWeight: 700, flex: "none",
          }}
        >
          <RotateCcw size={12} /> 원본
        </button>
      </div>
    </div>
  );
}
