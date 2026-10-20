/** Only SID rentals have a SID; keep leading zeros from the original record. */
export function rentalSidLabel(item: { sheetType: string; scenarioId?: string | null }): string {
  const sid = item.sheetType === "scenario" ? String(item.scenarioId ?? "").trim() : "";
  return sid ? `SID ${sid}` : "";
}

export function rentalSidLabels(items: { sheetType: string; scenarioId?: string | null }[]): string[] {
  return [...new Set(items.map(rentalSidLabel).filter(Boolean))];
}
