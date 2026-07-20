import React from "react";
import { Loader2 } from "lucide-react";

export const C = {
  bg: "#f4f6f9",
  text: "#1e293b",
  sub: "#64748b",
  card: "rgba(255, 255, 255, 0.75)",
  border: "rgba(226, 232, 240, 0.5)",
  inputBg: "rgba(244, 246, 249, 0.6)",
  primary: "#0f172a",
  primaryLight: "rgba(15, 23, 42, 0.08)",
  success: "#0d9488",
  successLight: "rgba(13, 148, 136, 0.08)",
  warn: "#d97706",
  warnLight: "rgba(217, 119, 6, 0.08)",
  danger: "#e11d48",
  dangerLight: "rgba(225, 29, 72, 0.08)",
};

export const cardStyle: React.CSSProperties = {
  background: C.card,
  backdropFilter: "blur(14px)",
  WebkitBackdropFilter: "blur(14px)",
  border: `1px solid ${C.border}`,
  borderRadius: 18,
  padding: 20,
  boxShadow: "0 8px 32px 0 rgba(15, 23, 42, 0.04)",
};

export const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "11px 13px",
  borderRadius: 10,
  border: `1.5px solid ${C.border}`,
  background: C.inputBg,
  color: C.text,
  fontSize: 14,
  outline: "none",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

export const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: C.sub,
  marginBottom: 6,
  display: "block",
};

export function primaryBtn(disabled?: boolean, bg?: string): React.CSSProperties {
  return {
    background: disabled ? C.border : bg || C.primary,
    color: "#fff",
    border: "none",
    borderRadius: 10,
    padding: "12px 18px",
    fontSize: 14,
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  };
}

export const secondaryBtnStyle: React.CSSProperties = {
  background: "#f1f5f9",
  color: C.sub,
  border: "none",
  borderRadius: 10,
  padding: "10px 16px",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
};

export const pillGroupStyle: React.CSSProperties = {
  display: "flex",
  gap: 6,
  background: "#f1f5f9",
  padding: 4,
  borderRadius: 10,
  flexWrap: "wrap",
};

export function pillBtn(active: boolean, activeColor?: string): React.CSSProperties {
  return {
    flex: 1,
    minWidth: 90,
    padding: "9px",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 700,
    border: "none",
    cursor: "pointer",
    background: active ? activeColor || C.primary : "transparent",
    color: active ? "#fff" : C.sub,
  };
}

export const qtyBtnStyle: React.CSSProperties = {
  width: 26,
  height: 26,
  border: "none",
  borderRadius: 7,
  background: "#fff",
  color: C.text,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

export function Spinner({ size = 16 }: { size?: number }) {
  return <Loader2 size={size} className="wms-spin" />;
}

export function Toast({ msg, type }: { msg: string; type: "ok" | "error" | "warn" | "info" }) {
  const colorMap = { ok: C.success, error: C.danger, warn: C.warn, info: C.primary };
  const bgMap = { ok: C.successLight, error: C.dangerLight, warn: C.warnLight, info: C.primaryLight };
  return (
    <div
      style={{
        marginBottom: 14,
        padding: "11px 16px",
        borderRadius: 12,
        fontSize: 13,
        fontWeight: 700,
        background: bgMap[type],
        color: colorMap[type],
      }}
    >
      {msg}
    </div>
  );
}

export function padSlot(raw: string | number | null | undefined): string {
  const s = String(raw ?? "").trim().replace(/\D/g, "");
  if (!s) return String(raw ?? "").trim();
  return s.length < 6 ? s.padStart(6, "0") : s;
}

const LOCATION_SORT_BANDS = [
  { start: 186, end: 251, dir: "asc" as const },
  { start: 120, end: 185, dir: "desc" as const },
  { start: 60, end: 119, dir: "asc" as const },
  { start: 0, end: 59, dir: "desc" as const },
  { start: 100000, end: 100025, dir: "asc" as const },
];

export function sortIdx(rootSlot: string | number | null | undefined): number {
  const n = parseInt(String(rootSlot ?? "").replace(/\D/g, ""), 10);
  if (isNaN(n)) return Number.MAX_SAFE_INTEGER;
  let offset = 0;
  for (const b of LOCATION_SORT_BANDS) {
    const size = b.end - b.start + 1;
    if (n >= b.start && n <= b.end) return offset + (b.dir === "asc" ? n - b.start : b.end - n);
    offset += size;
  }
  return offset + n;
}

export function fuzzy(text: string | null | undefined, q: string): boolean {
  if (!q) return true;
  if (!text) return false;
  return String(text).toLowerCase().replace(/\s+/g, "").includes(q.toLowerCase().replace(/\s+/g, ""));
}
