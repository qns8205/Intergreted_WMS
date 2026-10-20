#!/usr/bin/env bash
set -euo pipefail
up=/tmp/wms-planner-return-20261019
wms=/home/configds/wms
planner=/home/configds/shoot-planner
node=/home/configds/.nvm/versions/node/v24.19.0/bin/node
echo '4d31886e736a0b21d209fbb4ac64756129611033b50b3a184628e1c997c1c866  /home/configds/wms/server/lib/plannerRentalContext.js' | sha256sum -c -
echo '7e3046158669dea1c0d675cff685c14f3c75ae0e15cfe6c4634ddebb6160853d  /home/configds/shoot-planner/server/wmsContext.cjs' | sha256sum -c -
"$node" --check "$up/server/lib/plannerRentalContext.js"
"$node" --check "$up/server/lib/plannerReturnRecommendations.js"
"$node" --check "$up/output/planner-return-highlight/server/wmsContext.cjs"
backup="$wms/releases/planner-return-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup/wms" "$backup/planner"
cp -a "$wms/server/lib/plannerRentalContext.js" "$backup/wms/"
cp -a "$planner/server/wmsContext.cjs" "$backup/planner/"
cp -a "$wms/dist" "$backup/dist"
rollback(){
  rc=$?; trap - ERR
  cp -a "$backup/wms/plannerRentalContext.js" "$wms/server/lib/"
  cp -a "$backup/planner/wmsContext.cjs" "$planner/server/"
  cp -a "$backup/dist/." "$wms/dist/"
  systemctl --user restart shoot-planner || true
  sudo -n systemctl restart wms || true
  echo "Deployment failed; restored $backup" >&2; exit "$rc"
}
trap rollback ERR
cp -a "$up/server/lib/plannerRentalContext.js" "$up/server/lib/plannerReturnRecommendations.js" "$wms/server/lib/"
cp -a "$up/output/planner-return-highlight/server/wmsContext.cjs" "$planner/server/"
cp -a "$up/dist/assets/." "$wms/dist/assets/"
systemctl --user restart shoot-planner
sudo -n systemctl restart wms
systemctl --user is-active --quiet shoot-planner
systemctl is-active --quiet wms
ready=0
for i in $(seq 1 15); do
  if curl -fsS --max-time 2 http://127.0.0.1:3010/ >/dev/null && curl -fsS --max-time 2 --resolve cos-management.duckdns.org:443:192.168.100.152 https://cos-management.duckdns.org/ >/dev/null; then ready=1; break; fi
  sleep 1
done
test "$ready" = 1
"$node" "$up/deploy/verify-planner-return-highlight.mjs"
cp -a "$up/dist/index.html" "$up/dist/build-version.json" "$wms/dist/"
trap - ERR
echo "Deployed; backup: $backup"
