import { locationSortIndex } from "../../server/lib/locationSort.js";

/** Same shelf route as QR, reversed (including ties), without mutating rental records. */
export function sortReverseQrLocation<T extends { location?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => locationSortIndex(a.location) - locationSortIndex(b.location)).reverse();
}
