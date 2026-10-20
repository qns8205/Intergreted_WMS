#!/usr/bin/env bash
set -euo pipefail
root=/home/configds/wms
up=/tmp/qr-forgotten-items-20261019
node=/home/configds/.nvm/versions/node/v24.19.0/bin/node
echo '2921440851125b1339ccfdfaae60eacd29aee7c6c49e2acd1e6daba22cf66963  /home/configds/wms/request-lookup/public/index.html' | sha256sum -c -
echo 'a78d59ff7e0cae7e64777287b648885d4799a370132003489ef3c314b33a886c  /home/configds/wms/server/routes/requestLookup.js' | sha256sum -c -
"$node" --check "$up/server/routes/requestLookup.js"
"$node" --check "$up/server/lib/lookupItemLocations.js"
backup="$root/releases/qr-forgotten-items-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup"
cp -a "$root/request-lookup/public/index.html" "$backup/index.html"
cp -a "$root/server/routes/requestLookup.js" "$backup/requestLookup.js"
rollback(){
  rc=$?
  trap - ERR
  cp -a "$backup/index.html" "$root/request-lookup/public/index.html"
  cp -a "$backup/requestLookup.js" "$root/server/routes/requestLookup.js"
  sudo -n systemctl restart wms || true
  echo "Deployment failed; restored $backup" >&2
  exit "$rc"
}
trap rollback ERR
cp -a "$up/server/lib/lookupItemLocations.js" "$root/server/lib/lookupItemLocations.js"
cp -a "$up/server/routes/requestLookup.js" "$root/server/routes/requestLookup.js"
cp -a "$up/request-lookup/public/index.html" "$root/request-lookup/public/index.html"
sudo -n systemctl restart wms
curl -fsS --retry 10 --retry-delay 1 --retry-connrefused --max-time 3 https://cos-management.duckdns.org/api/gas >/dev/null
systemctl is-active --quiet wms
"$node" --input-type=module <<'JS'
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
const base='https://cos-management.duckdns.org:3445/pickup/4e91c7b2a860';
const page=await fetch(base,{signal:AbortSignal.timeout(5000)});assert.equal(page.status,200);
const html=await page.text();assert.ok(html.includes('혹시 놓친 것이 있나요?')&&html.includes('forgotten-form'));
const invalid=await fetch(base+'/item-locations?employeeId=bad&q=cup',{signal:AbortSignal.timeout(5000)});assert.equal(invalid.status,400);
const db=new DatabaseSync('/home/configds/wms/server/data/db.sqlite3',{readOnly:true});
const person=db.prepare('SELECT employee_id FROM registered_users WHERE active=1 ORDER BY employee_id LIMIT 1').get();db.close();
if(person){
  const url=new URL(base+'/item-locations');url.searchParams.set('employeeId',person.employee_id);url.searchParams.set('q','__qr_check_no_results_20261019__');
  const result=await fetch(url,{signal:AbortSignal.timeout(5000)});assert.equal(result.status,200);
  const body=await result.json();assert.equal(body.success,true);assert.ok(Array.isArray(body.items));
}
console.log(JSON.stringify({wmsHealth:'ok',completionQuestion:'ok',locationSearch:'ok'}));
JS
trap - ERR
echo "Deployed. Backup: $backup"
sha256sum "$root/request-lookup/public/index.html" "$root/server/routes/requestLookup.js" "$root/server/lib/lookupItemLocations.js"
