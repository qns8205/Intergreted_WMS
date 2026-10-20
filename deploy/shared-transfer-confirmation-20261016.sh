#!/usr/bin/env bash
set -euo pipefail
root=/home/configds/wms
node=/home/configds/.nvm/versions/node/v24.19.0/bin/node
incoming=/tmp/wms-shared-transfer-notifications-20261016.js
echo 'df11fb31c0b3608d67ea9271e3c12901622a3a92217d376ac27a64af72724226  /home/configds/wms/server/routes/notifications.js' | sha256sum -c -
"$node" --check "$incoming"
backup="$root/releases/shared-transfer-confirmation-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup"
cp -a "$root/server/routes/notifications.js" "$backup/notifications.js"
rollback() {
  rc=$?
  trap - ERR
  cp -a "$backup/notifications.js" "$root/server/routes/notifications.js"
  sudo -n systemctl restart wms || true
  echo "Deployment failed; restored $backup" >&2
  exit "$rc"
}
trap rollback ERR
cp -a "$incoming" "$root/server/routes/notifications.js"
sudo -n systemctl restart wms
healthy=0
for i in $(seq 1 15); do
  if curl -fsS --max-time 2 https://cos-management.duckdns.org/api/gas >/dev/null; then healthy=1; break; fi
  sleep 1
done
test "$healthy" = 1
systemctl is-active --quiet wms
"$node" --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('/home/configds/wms/server/data/db.sqlite3', { readOnly: true });
const stats = db.prepare(`SELECT COUNT(*) AS total,
  SUM(CASE WHEN 'transfer:'||id IN (SELECT notif_key FROM admin_notification_reads WHERE notif_key LIKE 'transfer:%') THEN 1 ELSE 0 END) AS confirmed
  FROM transfer_notifications`).get();
const response = await fetch('http://127.0.0.1:3000/api/admin/transfer-notifications/count', {redirect:'manual',signal:AbortSignal.timeout(5000)});
assert.ok([401,301,302,307,308].includes(response.status));
console.log(JSON.stringify({health:'ok',total:stats.total,sharedConfirmed:stats.confirmed || 0,sharedUnread:stats.total-(stats.confirmed || 0)}));
db.close();
JS
trap - ERR
echo "Deployed. Backup: $backup"
sha256sum "$root/server/routes/notifications.js"
