import { all, get } from "../db.js";
import { padSlot, parseItemLabel } from "./borrowUtils.js";

// A rental's type comes from its own variant ID, never another rental of the same item.
export function scenarioVariantInfo(itemId, row = {}) {
  const variants = all("SELECT id, name FROM scenario_item_variants WHERE item_id = ?", [padSlot(itemId)]);
  const pending = row.variant_pending === "Y" || row.variantPending === true;
  const id = Number(row.variant_id ?? row.variantId) || null;
  const chosen = variants.find((variant) => variant.id === id);
  return {
    variantId: chosen?.id || null,
    variantName: pending ? "" : chosen?.name || "",
    variantPending: pending,
    variantUnassigned: !pending && !chosen && (!!id || variants.length > 0),
  };
}

// Preserve names captured with a photo, even when a type is renamed later.
// Old photos without a type ID cannot be matched to a specific rental safely.
export function photoItemVariant(item, { snapshot = false } = {}) {
  if (["warehouse", "tablecloth"].includes(item.sheetType || item.category)) return item;
  let itemId = item.itemId || parseItemLabel(item.itemLabel || "").id;
  if (!itemId) {
    const matches = all("SELECT id FROM scenario_items WHERE name = ?", [item.itemLabel || item.itemName || ""]);
    if (matches.length === 1) itemId = matches[0].id;
  }
  if (!snapshot && (item.variantName || item.variantPending || item.variantUnassigned)) return item;
  if (!itemId) return item;
  let row = item;
  if (snapshot && ["scenario", "general"].includes(item.sheetType) && item.rowIndex) {
    const table = item.sheetType === "scenario" ? "sid_rentals" : "general_rentals";
    const rental = get(`SELECT * FROM ${table} WHERE id = ?`, [Number(item.rowIndex)]);
    const rentalItemId = rental && (item.sheetType === "scenario" ? parseItemLabel(rental.item_label).id : rental.item_id);
    if (padSlot(rentalItemId || "") === padSlot(itemId)) row = rental;
  }
  // A valid explicitly chosen type takes precedence over a pending rental row.
  const chosen = !row.variant_id && item.variantId ? get("SELECT id FROM scenario_item_variants WHERE id = ? AND item_id = ?", [Number(item.variantId), padSlot(itemId)]) : null;
  const info = scenarioVariantInfo(itemId, chosen ? { variantId: chosen.id } : row);
  return { ...item, itemId: padSlot(itemId), ...info };
}

export function photoItemMatches(item, search) {
  return `${item.itemLabel || ""} ${item.variantName || ""}`.toLowerCase().includes(search);
}
