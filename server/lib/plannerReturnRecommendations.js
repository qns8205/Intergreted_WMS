/** Read-only suggestions: keep next routine's needs and recommend the remaining
 * actual holdings, including extras and rows retained from earlier routines. */
export function plannerReturnRecommendations(items, contexts) {
  const plans = new Map(), result = new Map();
  items.forEach((item,index) => {
    const ctx = contexts.get(item.requestNo);
    if (item.sheetType !== 'general' || !item.pickedUp || !ctx || ctx.employeeId !== item.employeeId || !Array.isArray(ctx.returnRules)) return;
    const key = `${ctx.planId}:${ctx.employeeId}`;
    if (!plans.has(key)) plans.set(key,{ctx, rows:[], routine:0});
    const plan = plans.get(key);
    if (Number(ctx.routine) > Number(plan.ctx.routine)) plan.ctx = ctx;
    plan.routine = Math.max(plan.routine, Number(ctx.routine) || 0, Number(ctx.progressRoutine) || 0);
    plan.rows.push({item,index,routine:ctx.routine,keep:0});
  });
  for (const plan of plans.values()) {
    const rule = plan.ctx.returnRules.find(r => r.number === plan.routine);
    if (!rule || !Array.isArray(rule.keep)) continue;
    // Retain newer rows first; suggestions on older rows stay stable after partial returns.
    const rows = [...plan.rows].sort((a,b) => b.routine-a.routine || (Number(b.item.rowIndex)||0)-(Number(a.item.rowIndex)||0));
    const needs = [...rule.keep].sort((a,b) => Number(!!b.variantId)-Number(!!a.variantId));
    for (const need of needs) {
      let left = Math.max(0,Number(need.quantity)||0);
      for (const row of rows) {
        if (!left || row.item.itemId !== need.id || (need.variantId && Number(row.item.variantId)!==Number(need.variantId))) continue;
        const qty = Math.max(0,(Number(row.item.quantity)||0)-row.keep);
        const kept = Math.min(left,qty); row.keep+=kept; left-=kept;
      }
    }
    for (const row of rows) {
      const quantity = Math.max(0,(Number(row.item.quantity)||0)-row.keep);
      if (quantity > 0) result.set(row.index,{quantity,planId:plan.ctx.planId,routine:plan.routine,collectionName:plan.ctx.collectionName});
    }
  }
  return result;
}
