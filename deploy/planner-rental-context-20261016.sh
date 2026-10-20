#!/usr/bin/env bash
set -euo pipefail
up=/tmp/wms-planner-context-20261016
wms=/home/configds/wms
planner=/home/configds/shoot-planner
node=/home/configds/.nvm/versions/node/v24.19.0/bin/node

# Do not overwrite code changed by another deployment since it was inspected.
echo 'c19bc0251a6fd27fca90ac3a51a1d3a380f68c5308b20efd59ebedac19ae2019  /home/configds/wms/server/routes/gas.js' | sha256sum -c -
echo '991ba3c7eb3ede25bd27a8ebc938735ba020a9865c9aeda3ec7c42e3961a9bf2  /home/configds/wms/server/routes/plannerBridge.js' | sha256sum -c -
echo '968cd8b6ebf8b03ea1b559860d90523806d0b88505365f0b410cd42d18f4369a  /home/configds/shoot-planner/server/server.cjs' | sha256sum -c -
for f in "$up"/server/routes/*.js "$up"/server/lib/*.js "$up"/output/planner-context-work/server/*.cjs; do "$node" --check "$f"; done
backup="$wms/releases/planner-context-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup/wms/routes" "$backup/planner"
cp -a "$wms/server/routes/gas.js" "$wms/server/routes/plannerBridge.js" "$backup/wms/routes/"
cp -a "$wms/dist" "$backup/wms/dist"
cp -a "$planner/server/server.cjs" "$backup/planner/"

rollback() {
  rc=$?
  trap - ERR
  cp -a "$backup/wms/routes/"*.js "$wms/server/routes/"
  cp -a "$backup/wms/dist/." "$wms/dist/"
  cp -a "$backup/planner/server.cjs" "$planner/server/server.cjs"
  systemctl --user restart shoot-planner || true
  sudo -n systemctl restart wms || true
  echo "Deployment failed; restored backup: $backup" >&2
  exit "$rc"
}
trap rollback ERR
cp -a "$up/output/planner-context-work/server/server.cjs" "$up/output/planner-context-work/server/wmsContext.cjs" "$planner/server/"
cp -a "$up/server/lib/plannerConnection.js" "$up/server/lib/plannerRentalContext.js" "$wms/server/lib/"
cp -a "$up/server/routes/gas.js" "$up/server/routes/plannerBridge.js" "$wms/server/routes/"
# Upload assets first; switch the document/build marker only after services are healthy.
cp -a "$up/dist/assets/." "$wms/dist/assets/"
systemctl --user restart shoot-planner
sudo -n systemctl restart wms
systemctl --user is-active --quiet shoot-planner
systemctl is-active --quiet wms
for i in $(seq 1 15); do
  if curl -fsS --max-time 2 http://127.0.0.1:3010/ >/dev/null && curl -fsS --max-time 2 --resolve cos-management.duckdns.org:3443:127.0.0.1 https://cos-management.duckdns.org:3443/api/gas >/dev/null; then break; fi
  sleep 1
done
"$node" "$up/deploy/verify-planner-rental-context.mjs"
cp -a "$up/dist/index.html" "$up/dist/build-version.json" "$wms/dist/"
trap - ERR
echo "Deployed. Backup: $backup"
sha256sum "$wms/dist/index.html" "$wms/server/routes/gas.js" "$planner/server/server.cjs"
