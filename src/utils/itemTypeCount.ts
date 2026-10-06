/**
 * 색상·형태 등 variant가 달라도 같은 카탈로그 물품 ID면 한 종류로 센다.
 * variant별 행과 수량은 재고·반납 처리를 위해 그대로 유지하고, 화면의 "N종" 요약에만 쓴다.
 */
export function countDistinctItemTypes(items: Array<{
  id?: string | number | null;
  itemId?: string | number | null;
  sheetType?: string;
  rowIndex?: string | number;
  itemLabel?: string;
  name?: string;
  location?: string;
}>): number {
  const keys = new Set<string>();

  for (const item of items || []) {
    const rawId = String(item?.itemId ?? item?.id ?? "").trim();
    if (rawId) {
      const normalizedId = /^\d+$/.test(rawId) ? rawId.padStart(6, "0") : rawId.toUpperCase();
      keys.add(`catalog:${normalizedId}`);
      continue;
    }

    if (item?.sheetType === "warehouse" && item.rowIndex !== undefined) {
      keys.add(`warehouse:${item.rowIndex}`);
      continue;
    }

    keys.add([
      item?.sheetType || "item",
      item?.itemLabel || item?.name || "",
      item?.location || "",
      item?.rowIndex ?? "",
    ].join(":"));
  }

  return keys.size;
}
