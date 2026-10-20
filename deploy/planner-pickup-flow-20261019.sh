#!/usr/bin/env bash
set -euo pipefail
root=/home/configds/shoot-planner
up=/tmp/planner-pickup-flow-20261019/output/planner-pickup-flow-20261019
node=/home/configds/.nvm/versions/node/v24.19.0/bin/node
echo 'df9eef1d3bad69b4a02d4fb74c68bf74909396d9348e6148e4c1bbe4725be001  /home/configds/shoot-planner/public/app.js' | sha256sum -c -
echo 'f07628f2ccf75d8f86066678553b39ed62881ff9c1f0f4fe098e78d81c5b1749  /home/configds/shoot-planner/server/server.cjs' | sha256sum -c -
"$node" --check "$up/public/app.js"
"$node" --check "$up/server/server.cjs"
backup="$root/releases/pickup-flow-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup/public" "$backup/server"
cp -a "$root/public/app.js" "$backup/public/"
cp -a "$root/server/server.cjs" "$backup/server/"
cp -a "$root/README.md" "$backup/"
rollback() {
  rc=$?
  trap - ERR
  cp -a "$backup/public/app.js" "$root/public/app.js"
  cp -a "$backup/server/server.cjs" "$root/server/server.cjs"
  cp -a "$backup/README.md" "$root/README.md"
  systemctl --user restart shoot-planner || true
  echo "Deployment failed; restored $backup" >&2
  exit "$rc"
}
trap rollback ERR
cp -a "$up/public/app.js" "$root/public/app.js"
cp -a "$up/server/server.cjs" "$root/server/server.cjs"
cp -a "$up/README.md" "$root/README.md"
systemctl --user restart shoot-planner
curl -fsS --retry 10 --retry-delay 1 --retry-connrefused --max-time 3 http://127.0.0.1:3010/ >/dev/null
systemctl --user is-active --quiet shoot-planner
systemctl is-active --quiet wms
"$node" --input-type=module <<'JS'
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
const response=await fetch('http://127.0.0.1:3010/app.js',{signal:AbortSignal.timeout(5000)});
assert.equal(response.status,200);
const text=await response.text();
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
assert.equal(hash(text),hash(fs.readFileSync('/home/configds/shoot-planner/public/app.js')));
assert.ok(text.includes('function chooseRentalSeat')&&text.includes('if (!receiptReady(rental))'));
const unauthorized=await fetch('http://127.0.0.1:3010/api/my-plans/1/progress',{method:'POST',headers:{'x-requested-with':'shoot-planner','Content-Type':'application/json'},body:'{"set":{"received:0":true}}',signal:AbortSignal.timeout(5000)});
assert.equal(unauthorized.status,401);
console.log(JSON.stringify({plannerHealth:'ok',servedClientHash:hash(text),unauthorizedReceipt:'blocked'}));
JS
trap - ERR
echo "Deployed. Backup: $backup"
sha256sum "$root/public/app.js" "$root/server/server.cjs"
