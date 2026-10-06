import React from "react";
import { ExternalLink } from "lucide-react";
import { scenarioManagerObjectUrl } from "../utils/scenarioManager";

export default function ScenarioManagerObjectLink({ id, color, children }: { id: string; color: string; children?: React.ReactNode }) {
  const href = scenarioManagerObjectUrl(id);
  if (!href) return <span>{children || id}</span>;
  return <a href={href} target="_blank" rel="noopener noreferrer"
    onClick={(event) => event.stopPropagation()}
    title="Scenario Manager에서 이 오브젝트 열기 (새 탭)"
    aria-label={`${id} 오브젝트 Scenario Manager에서 열기 (새 탭)`}
    style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 0", color, textDecoration: "none", fontFamily: "inherit", fontSize: "inherit", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
    {children || id}<ExternalLink size={11} aria-hidden="true" style={{ opacity: 0.65, flexShrink: 0 }} />
  </a>;
}
