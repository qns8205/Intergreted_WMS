/** Preserve the object's ID (including leading zeroes), not its storage location. */
export function scenarioManagerObjectUrl(id: string): string {
  const objectId = String(id || "").trim();
  return objectId ? `https://sm.config.inc/object_detail/${encodeURIComponent(objectId)}` : "";
}
