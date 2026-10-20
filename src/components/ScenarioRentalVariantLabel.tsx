import React from "react";
import { ScenarioVariantDisplay, scenarioVariantText } from "../utils/scenarioVariant";

/** A separate line keeps the rental's actual type visible even with long names. */
export default function ScenarioRentalVariantLabel({ item, C }: {
  item: ScenarioVariantDisplay;
  C: { accentText: string; accentSoft: string };
}) {
  const name = scenarioVariantText(item);
  if (!name) return null;
  return <div style={{ marginTop: 5, fontSize: 11.5, fontWeight: 700, lineHeight: 1.5, overflowWrap: "anywhere" }}>
    <span style={{ display: "inline-block", maxWidth: "100%", boxSizing: "border-box", padding: "2px 8px", borderRadius: 7, color: C.accentText, background: C.accentSoft }}>종류: {name}</span>
  </div>;
}
