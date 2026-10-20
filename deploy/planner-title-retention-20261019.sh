#!/usr/bin/env bash
set -euo pipefail
root=/home/configds/shoot-planner
up=/tmp/planner-title-retention-20261019/output/planner-title-display-20261019
node=/home/configds/.nvm/versions/node/v24.19.0/bin/node
echo 'ff6c633bbf05bfe5fc69f9a2c5182c72d583f393fa024df114d51be913424c2f  /home/configds/shoot-planner/public/app.js' | sha256sum -c -
echo '6904a2c4e45e3c5b13b0447480e174124f51066c0f0b817a7b9f38ba76ba9a2d  /home/configds/shoot-planner/server/server.cjs' | sha256sum -c -
for f in "$up/public/app.js" "$up/server/server.cjs" "$up/server/uploadRetention.cjs"; do "$node" --check "$f"; done
backup="$root/releases/title-retention-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup/public" "$backup/server"
chmod 700 "$backup"
cp -a "$root/public/app.js" "$backup/public/"
cp -a "$root/server/server.cjs" "$backup/server/"
cp -a "$root/README.md" "$backup/"
"$node" --input-type=module - "$backup" <<'JS'
import { DatabaseSync, backup } from 'node:sqlite';
import path from 'node:path';
const db=new DatabaseSync('/home/configds/shoot-planner/data/planner.sqlite3',{readOnly:true});
await backup(db,path.join(process.argv[2],'planner.sqlite3'));
console.log(JSON.stringify({backup:'ok',uploads:db.prepare('SELECT COUNT(*) n FROM upload_collections WHERE deleted=0').get().n,
  expired:db.prepare("SELECT COUNT(*) n FROM upload_collections WHERE deleted=0 AND julianday(created_at)<=julianday('now','-14 days')").get().n}));
db.close();
JS
chmod 600 "$backup/planner.sqlite3"
rollback() {
  rc=$?
  trap - ERR
  cp -a "$backup/public/app.js" "$root/public/app.js"
  cp -a "$backup/server/server.cjs" "$root/server/server.cjs"
  cp -a "$backup/README.md" "$root/README.md"
  systemctl --user restart shoot-planner || true
  echo "Deployment failed; restored code. Collection backup: $backup/planner.sqlite3" >&2
  exit "$rc"
}
trap rollback ERR
cp -a "$up/server/uploadRetention.cjs" "$root/server/uploadRetention.cjs"
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
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
const response=await fetch('http://127.0.0.1:3010/app.js',{signal:AbortSignal.timeout(5000)});
assert.equal(response.status,200);
const text=await response.text();
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
assert.equal(hash(text),hash(fs.readFileSync('/home/configds/shoot-planner/public/app.js')));
assert.ok(text.includes('function defaultPlanTitle')&&text.includes('function rentalSeatUnits'));
assert.ok(!text.includes('신청 번호'));
const db=new DatabaseSync('/home/configds/shoot-planner/data/planner.sqlite3',{readOnly:true});
const expired=db.prepare("SELECT COUNT(*) n FROM upload_collections WHERE deleted=0 AND julianday(created_at)<=julianday('now','-14 days')").get().n;
assert.equal(expired,0);
console.log(JSON.stringify({plannerHealth:'ok',clientHash:hash(text),expiredUploadsRemaining:expired,
  plansPreserved:db.prepare('SELECT COUNT(*) n FROM plans').get().n}));
db.close();
JS
trap - ERR
echo "Deployed. Backup: $backup"
sha256sum "$root/public/app.js" "$root/server/server.cjs" "$root/server/uploadRetention.cjs"
