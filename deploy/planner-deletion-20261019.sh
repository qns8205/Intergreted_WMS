#!/usr/bin/env bash
set -euo pipefail
root=/home/configds/shoot-planner
base=/tmp/planner-deletion-20261019
up="$base/output/planner-deletion-20261019"
node=/home/configds/.nvm/versions/node/v24.19.0/bin/node
echo 'd4ca087b3429fb011ca82dd88920a40f46122f8b3d0ca8a17d69564d132be2f0  /home/configds/shoot-planner/public/app.js' | sha256sum -c -
echo '06a5602323f85575ac7df6dd25adbd884cad73ece642951489850520d03ec14f  /home/configds/shoot-planner/server/server.cjs' | sha256sum -c -
for f in "$up/public/app.js" "$up/server/server.cjs" "$up/server/planDeletion.cjs" "$base/deploy/cleanup-planner-test-20261019.cjs"; do "$node" --check "$f"; done
backup="$root/releases/plan-deletion-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup/public" "$backup/server"
chmod 700 "$backup"
cp -a "$root/public/app.js" "$backup/public/"
cp -a "$root/server/server.cjs" "$backup/server/"
cp -a "$root/README.md" "$backup/"
"$node" --input-type=module - "$backup" <<'JS'
import {DatabaseSync,backup} from 'node:sqlite';
import path from 'node:path';
const db=new DatabaseSync('/home/configds/shoot-planner/data/planner.sqlite3',{readOnly:true});
await backup(db,path.join(process.argv[2],'planner.sqlite3'));db.close();
console.log('Database backup complete');
JS
chmod 600 "$backup/planner.sqlite3"
rollback(){
  rc=$?
  trap - ERR
  cp -a "$backup/public/app.js" "$root/public/app.js"
  cp -a "$backup/server/server.cjs" "$root/server/server.cjs"
  cp -a "$backup/README.md" "$root/README.md"
  systemctl --user restart shoot-planner || true
  echo "Deployment failed; restored code. Data backup: $backup/planner.sqlite3" >&2
  exit "$rc"
}
trap rollback ERR
cp -a "$up/server/planDeletion.cjs" "$root/server/planDeletion.cjs"
cp -a "$up/server/server.cjs" "$root/server/server.cjs"
cp -a "$up/public/app.js" "$root/public/app.js"
cp -a "$up/README.md" "$root/README.md"
systemctl --user restart shoot-planner
curl -fsS --retry 10 --retry-delay 1 --retry-connrefused --max-time 3 http://127.0.0.1:3010/ >/dev/null
systemctl --user is-active --quiet shoot-planner
systemctl is-active --quiet wms
"$node" --input-type=module <<'JS'
import assert from 'node:assert/strict';
import fs from 'node:fs';
const response=await fetch('http://127.0.0.1:3010/app.js',{signal:AbortSignal.timeout(5000)});
assert.equal(response.status,200);assert.equal(await response.text(),fs.readFileSync('/home/configds/shoot-planner/public/app.js','utf8'));
const unauthorized=await fetch('http://127.0.0.1:3010/api/plans/1',{method:'DELETE',headers:{'x-requested-with':'shoot-planner'},signal:AbortSignal.timeout(5000)});
assert.equal(unauthorized.status,401);
console.log('Deployed client and deletion authorization verified');
JS
trap - ERR
"$node" "$base/deploy/cleanup-planner-test-20261019.cjs"
echo "Deployed and test items removed. Backup: $backup"
sha256sum "$root/public/app.js" "$root/server/server.cjs" "$root/server/planDeletion.cjs"
