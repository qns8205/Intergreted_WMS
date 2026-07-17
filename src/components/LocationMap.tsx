import React from "react";
import { GRID_COLUMNS, GRID_ROWS, RACK_ZONES, RackZone } from "../rackConfig";
import { C } from "../ui";

interface Props {
  onZoneClick: (zone: RackZone) => void;
  activeZoneId?: string | null;
  /** zone.id -> 해당 위치에 물품이 있는지 여부 (있으면 점 표시) */
  hasItemsMap?: Record<string, boolean>;
}

export default function LocationMap({ onZoneClick, activeZoneId, hasItemsMap }: Props) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${GRID_COLUMNS}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${GRID_ROWS}, minmax(34px, auto))`,
        gap: 4,
        background: "#fff",
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        padding: 10,
      }}
    >
      {RACK_ZONES.map((zone) => {
        const clickable = zone.kind === "numeric" || zone.kind === "letter";
        const active = activeZoneId === zone.id;
        const hasItems = hasItemsMap?.[zone.id];
        return (
          <div
            key={zone.id}
            onClick={() => clickable && onZoneClick(zone)}
            style={{
              gridColumn: zone.gridColumn,
              gridRow: zone.gridRow,
              background: zone.color === "transparent" ? "transparent" : active ? C.primaryLight : zone.color,
              border: zone.kind === "label" ? `1px solid ${C.border}` : zone.color === "transparent" ? "none" : `1.5px solid ${active ? C.primary : "#d8dee8"}`,
              borderRadius: 8,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              padding: 6,
              cursor: clickable ? "pointer" : "default",
              position: "relative",
              minHeight: 0,
              transition: "background 0.12s, border-color 0.12s",
            }}
          >
            <span
              style={{
                fontSize: zone.kind === "info" || zone.kind === "label" ? 11 : 10,
                fontWeight: zone.kind === "label" ? 800 : 600,
                color: zone.id === "door-notice" ? "#dc2626" : C.text,
                whiteSpace: "pre-line",
                lineHeight: 1.3,
                fontFamily: zone.kind === "numeric" ? "monospace" : "inherit",
              }}
            >
              {zone.label}
            </span>
            {clickable && hasItems && (
              <span
                style={{
                  position: "absolute",
                  top: 4,
                  right: 4,
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: C.success,
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
