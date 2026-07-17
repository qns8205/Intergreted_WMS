import React from "react";

interface ConnectionBadgeProps {
  connected: boolean;
  dirty: boolean;
  saving: boolean;
  lastSync: Date | null;
}

const OK_COLOR = "#10b981";
const WARN_COLOR = "#f59e0b";
const TEXT_DIM = "#94a3b8";
const PANEL_BORDER = "#334155";

export default function ConnectionBadge({ connected, dirty, saving, lastSync }: ConnectionBadgeProps) {
  let label = "";
  let color = "";
  if (saving) {
    label = "저장 중...";
    color = WARN_COLOR;
  } else if (!connected) {
    label = "로컬 모드 (미연동)";
    color = TEXT_DIM;
  } else if (dirty) {
    label = "저장 대기 중";
    color = WARN_COLOR;
  } else {
    label = "시트 동기화됨";
    color = OK_COLOR;
  }

  return (
    <div
      className="mono"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: "11px",
        color,
        padding: "6px 10px",
        border: `1px solid ${PANEL_BORDER}`,
        borderRadius: "6px",
      }}
      title={lastSync ? `마지막 동기화: ${lastSync.toLocaleTimeString("ko-KR")}` : ""}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: color,
          display: "inline-block",
        }}
      />
      {label}
    </div>
  );
}
