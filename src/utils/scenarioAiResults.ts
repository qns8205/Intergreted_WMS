/** Existing cards/cart remain the authority. Never create phantom inventory from AI output. */
export function filterScenarioAiResults<T extends { id: string; category: string; subcategory: string; requestFor?: string }>(items: T[], ids: string[], filters: { category: string; subcategory: string; request: "all" | "normal" }): T[] {
  const order = new Map(ids.map((id, index) => [id, index]));
  return items.filter(i => order.has(i.id) && (!filters.category || i.category === filters.category) && (!filters.subcategory || i.subcategory === filters.subcategory)
    && (filters.request !== "normal" || i.requestFor === undefined)).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
}
