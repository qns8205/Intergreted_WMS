import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function plannerBridgeKey() {
  if (process.env.PLANNER_BRIDGE_KEY) return process.env.PLANNER_BRIDGE_KEY;
  const file = process.env.PLANNER_BRIDGE_KEY_FILE || fileURLToPath(new URL('../data/planner-bridge.key', import.meta.url));
  try { return readFileSync(file, 'utf8').trim(); } catch { return ''; }
}
