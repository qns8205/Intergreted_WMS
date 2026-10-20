import test from 'node:test';
import assert from 'node:assert/strict';
import { plannerCollectionNames, plannerContexts } from './plannerRentalDisplay.ts';

test('same plan is shown once; latest routine wins even when final routine has no preview', () => {
  const old = { planId: 1, collectionName: 'Collection A', routine: 1, nextRoutine: { number: 2, shotCount: 1, items: [] } };
  const latest = { ...old, routine: 2, nextRoutine: null };
  const other = { ...old, planId: 2, collectionName: 'Collection B' };
  assert.deepEqual(plannerContexts([{ planner: old }, { planner: latest }, { planner: old }, { planner: other }, {}]), [latest, other]);
  assert.deepEqual(plannerCollectionNames([{ planner: old }, { planner: latest }, { planner: other }, {}]), ['Collection A', 'Collection B']);
});
