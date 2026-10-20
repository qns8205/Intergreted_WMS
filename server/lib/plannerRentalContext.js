import { all, get } from '../db.js';
import { plannerBridgeKey } from './plannerConnection.js';
import { plannerReturnRecommendations } from './plannerReturnRecommendations.js';

// The deployed planner runs on the same machine. Override for a separate host/test server.
const cache = new Map();
let retryAfter = 0;
async function loadContexts(requestNos, reservationIds) {
  const key = plannerBridgeKey();
  if (key.length < 24 || Date.now() < retryAfter) return [];
  const base = process.env.SHOOT_PLANNER_URL || 'http://127.0.0.1:3010';
  const url = new URL('/api/wms/rental-context', base);
  url.searchParams.set('requestNos', requestNos.join(','));
  url.searchParams.set('reservationIds', reservationIds.join(','));
  const cacheKey = url.href;
  const saved = cache.get(cacheKey);
  if (saved && Date.now() - saved.at < 5000) return saved.promise;
  if (cache.size >= 32) cache.delete(cache.keys().next().value);
  const promise = (async () => {
    try {
      const response = await fetch(url, { headers: { 'x-planner-key': key }, signal: AbortSignal.timeout(1500), redirect: 'error' });
      if (!response.ok) throw Error('Planner unavailable');
      const data = await response.json();
      if (!Array.isArray(data.contexts)) throw Error('Invalid planner context');
      return data.contexts;
    } catch {
      // A planner outage must not stop normal WMS pickup/return operations or show stale previews.
      retryAfter = Date.now() + 5000;
      return [];
    }
  })();
  cache.set(cacheKey, { at: Date.now(), promise });
  return promise;
}

function alreadyStarted(ref, employeeId) {
  if (ref.heldOnly) return true;
  const hasRental = (requestNo) => requestNo && !!get(`SELECT 1 FROM general_rentals WHERE request_no = ? AND employee_id = ?
    AND COALESCE(return_source, '') != 'cancel' LIMIT 1`, [requestNo, employeeId]);
  if (hasRental(ref.requestNo)) return true;
  return (ref.reservationIds || []).some((id) => {
    const reservation = get('SELECT status, request_no FROM item_reservations WHERE id = ? AND employee_id = ?', [id, employeeId]);
    // A promoted reservation stays fulfilled even if its resulting rental is later cancelled.
    return reservation?.status === 'reserved' || (reservation?.status === 'fulfilled' && hasRental(reservation.request_no));
  });
}

function previewOf(next, employeeId) {
  if (!next || !Number.isInteger(next.number) || (next.rentalRefs || []).some((r) => alreadyStarted(r, employeeId))) return null;
  return {
    number: next.number, shotCount: Number(next.shotCount) || 0,
    items: (next.items || []).map((item) => {
      const object = get('SELECT name, root_slot FROM scenario_items WHERE id = ?', [item.id]);
      const variant = item.variantId ? get('SELECT name FROM scenario_item_variants WHERE id = ? AND item_id = ?', [item.variantId, item.id]) : null;
      return { id: item.id, name: object?.name || item.name || item.id, location: object?.root_slot || '',
        variantName: variant?.name || '', quantity: Number(item.quantity) || 0, keptQuantity: Number(item.keptQuantity) || 0 };
    }).filter((i) => i.quantity > 0 || i.keptQuantity > 0),
  };
}

/** Attach display metadata to real rental rows only; previews never become rental rows. */
export async function attachPlannerRentalContexts(items) {
  const nos = [...new Set(items.filter((i) => i.sheetType === 'general' && i.requestNo).map((i) => i.requestNo))].sort((a, b) => a - b);
  if (!nos.length) return items;
  const matched = new Map();
  for (let start = 0; start < nos.length; start += 200) {
    const batch = nos.slice(start, start + 200);
    const reservations = all(`SELECT id, request_no FROM item_reservations WHERE request_no IN (${batch.map(() => '?').join(',')})`, batch);
    const reservationRequests = new Map(reservations.map((r) => [r.id, r.request_no]));
    const contexts = await loadContexts(batch, reservations.map((r) => r.id));
    for (const ctx of contexts) {
      const requestNo = batch.includes(ctx.requestNo) ? ctx.requestNo : (ctx.reservationIds || []).map((id) => reservationRequests.get(id)).find(Boolean);
      if (!requestNo) continue;
      matched.set(requestNo, { ...ctx, nextRoutine: previewOf(ctx.nextRoutine, ctx.employeeId) });
    }
  }
  // Rows from earlier routines can remain borrowed for reuse; preview only the latest active routine.
  const latest = new Map();
  for (const item of items) {
    const ctx = matched.get(item.requestNo);
    if (item.sheetType !== 'general' || !ctx || ctx.employeeId !== item.employeeId) continue;
    const key = `${ctx.planId}:${ctx.employeeId}`;
    latest.set(key, Math.max(latest.get(key) || 0, ctx.routine));
  }
  const returns = plannerReturnRecommendations(items, matched);
  return items.map((item, index) => {
    const ctx = matched.get(item.requestNo);
    if (item.sheetType !== 'general' || !ctx || ctx.employeeId !== item.employeeId) return item;
    return { ...item, ...(returns.has(index) ? {plannerReturn:returns.get(index)} : {}), planner: { planId: ctx.planId, collectionName: ctx.collectionName, routine: ctx.routine,
      nextRoutine: latest.get(`${ctx.planId}:${ctx.employeeId}`) === ctx.routine ? ctx.nextRoutine : null } };
  });
}
