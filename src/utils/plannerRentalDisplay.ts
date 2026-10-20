import type { PlannerRentalContext } from './borrowApi';

export function plannerReturnQuantity(item: { plannerReturn?: { quantity: number } }): number {
  return Math.max(0, Number(item.plannerReturn?.quantity) || 0);
}

export function plannerContexts(items: { planner?: PlannerRentalContext }[]): PlannerRentalContext[] {
  const plans = new Map<number, PlannerRentalContext>();
  for (const { planner } of items) {
    if (planner && (!plans.has(planner.planId) || plans.get(planner.planId)!.routine < planner.routine)) plans.set(planner.planId, planner);
  }
  return [...plans.values()];
}

export function plannerCollectionNames(items: { planner?: PlannerRentalContext }[]): string[] {
  return [...new Set(plannerContexts(items).map((p) => p.collectionName).filter(Boolean))];
}
