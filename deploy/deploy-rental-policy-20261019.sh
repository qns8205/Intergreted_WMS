#!/usr/bin/env bash
set -euo pipefail
root=/home/configds/wms
stage=/tmp/wms-rental-policy-20261019
node=/home/configds/.nvm/versions/node/v24.19.0/bin/node
cd "$root"
# Refuse to replace files changed since the reviewed, on-server comparison.
python3 - "$root" "$stage" <<'PY'
import pathlib,hashlib,json,sys
root,stage=map(pathlib.Path,sys.argv[1:])
for item in json.loads((stage/'deploy/expected-production-hashes.json').read_text()):
    p=root/item['path'];current=hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
    assert current==item['before_sha256'], 'Production changed: '+item['path']
    assert hashlib.sha256((stage/item['path']).read_bytes()).hexdigest()==item['after_sha256'], 'Upload changed: '+item['path']
print('Reviewed source hashes verified')
PY
mapfile -t files < <(python3 - "$stage" <<'PY'
import pathlib,json,sys
print('\n'.join(json.loads((pathlib.Path(sys.argv[1])/'deploy/rental-policy-files.json').read_text())['files']))
PY
)
for file in "${files[@]}"; do "$node" --check "$stage/$file"; done
backup="$root/releases/rental-policy-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup"
chmod 700 "$backup"
for file in "${files[@]}"; do
  if [ -f "$root/$file" ]; then mkdir -p "$backup/$(dirname "$file")"; cp -a "$root/$file" "$backup/$file"; fi
done
cp -a "$root/dist" "$backup/dist"
"$node" --input-type=module - "$backup" <<'JS'
import {DatabaseSync,backup} from 'node:sqlite';
import path from 'node:path';
const db=new DatabaseSync('/home/configds/wms/server/data/db.sqlite3',{readOnly:true});
await backup(db,path.join(process.argv[2],'db.sqlite3'));db.close();
console.log('Consistent SQLite backup saved on server');
JS
chmod 600 "$backup/db.sqlite3"
rollback(){
  rc=$?
  trap - ERR
  for file in "${files[@]}"; do
    if [ -f "$backup/$file" ]; then cp -a "$backup/$file" "$root/$file"; fi
  done
  cp -a "$backup/dist/." "$root/dist/"
  sudo -n systemctl restart wms || true
  echo "Deployment failed; code restored. Database backup retained at $backup/db.sqlite3" >&2
  exit "$rc"
}
trap rollback ERR
for file in "${files[@]}"; do mkdir -p "$root/$(dirname "$file")"; cp -a "$stage/$file" "$root/$file"; done
"$node" "$stage/deploy/verify-rental-policy-20261019.mjs"
# Keep older hashed assets available to clients already working in the app.
cp -a "$stage/dist/assets/." "$root/dist/assets/"
cp -a "$stage/dist/index.html" "$root/dist/index.html"
sudo -n systemctl restart wms
curl -fsS --retry 15 --retry-delay 1 --retry-connrefused --max-time 3 https://cos-management.duckdns.org/api/gas >/dev/null
systemctl is-active --quiet wms
systemctl --user is-active --quiet shoot-planner
"$node" --input-type=module <<'JS'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const root='/home/configds/wms',base='https://cos-management.duckdns.org';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const page=await fetch(base+'/',{signal:AbortSignal.timeout(5000)});
assert.equal(page.status,200);const html=await page.text();assert.equal(html,fs.readFileSync(root+'/dist/index.html','utf8'));
const asset=html.match(/assets\/index-[^"']+\.js/)[0];
const response=await fetch(base+'/'+asset,{signal:AbortSignal.timeout(10000)});assert.equal(response.status,200);
assert.equal(hash(Buffer.from(await response.arrayBuffer())),hash(fs.readFileSync(root+'/dist/'+asset)));
const denied=await fetch(base+'/api/gas',{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({action:'convertRentalToGeneral',payload:{requestNo:0,reason:'배포 확인'}}),signal:AbortSignal.timeout(5000)});
const denial=await denied.json();assert.equal(denial.success,false);assert.match(denial.message || denial.error,/관리자/);
const planner=await fetch(base+'/api/planner-bridge/people',{signal:AbortSignal.timeout(5000)});assert.equal(planner.status,401);
const db=new DatabaseSync(root+'/server/data/db.sqlite3',{readOnly:true});
assert.ok(db.prepare('PRAGMA table_info(rental_requests)').all().some(c=>c.name==='rental_general_since'));
assert.ok(db.prepare('PRAGMA table_info(penalties)').all().some(c=>c.name==='deduction_types'));
assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='rental_terms_reviews'").get());
assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');db.close();
console.log(JSON.stringify({wms:'healthy',servedAsset:asset,hashMatches:true,adminConversionAuthorization:'ok',plannerAuthorization:'ok',databaseMigration:'ok'}));
JS
trap - ERR
printf 'Deployment verified. Server backup: %s\n' "$backup"
