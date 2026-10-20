#!/bin/bash
set -euo pipefail
umask 077
test "$(id -un)" = configds
wms_root=/home/configds/wms
node_bin=/home/configds/.nvm/versions/node/v24.19.0/bin/node
"$node_bin" --check "$wms_root/deploy/standard-https-index.js"
systemd-analyze verify "$wms_root/deploy/wms.socket"
test ! -e /etc/systemd/system/wms.socket
mkdir -p "$wms_root/deploy/backups"
backup_dir=$(mktemp -d "$wms_root/deploy/backups/standard-https-XXXXXX")
cp -p "$wms_root/server/index.js" "$backup_dir/index.js"
cp -p "$wms_root/server/data/https.json" "$backup_dir/https.json"
modified=false
rollback() {
  trap - ERR
  if "$modified"; then
    cp -p "$backup_dir/index.js" "$wms_root/server/index.js"
    cp -p "$backup_dir/https.json" "$wms_root/server/data/https.json"
    sudo -n systemctl disable --now wms.socket || true
    sudo -n systemctl restart wms || true
  fi
  printf '443 activation failed; original WMS configuration restored. Backup: %s\n' "$backup_dir" >&2
  exit 1
}
trap rollback ERR
# Replace the previously unused world-wide 443 allowance BEFORE opening a listener.
sudo -n ufw allow from 192.168.0.0/16 to any port 443 proto tcp comment 'WMS HTTPS'
sudo -n ufw --force delete allow 443/tcp
modified=true
cp "$wms_root/deploy/standard-https-index.js" "$wms_root/server/index.js"
cp "$wms_root/deploy/https.config.json" "$wms_root/server/data/https.json"
# A new systemd socket cannot be activated while its associated service is already active.
sudo -n systemctl stop wms
sudo -n systemctl enable --now "$wms_root/deploy/wms.socket"
sudo -n systemctl start wms
curl --fail --silent --show-error --retry 10 --retry-connrefused --retry-delay 1 --max-time 5 \
  https://cos-management.duckdns.org/https-info -o "$backup_dir/https-info.json"
"$node_bin" -e 'const fs=require("node:fs"); const info=JSON.parse(fs.readFileSync(process.argv[1])); if(info.origin!=="https://cos-management.duckdns.org") process.exit(1)' "$backup_dir/https-info.json"
curl --fail --silent --show-error --max-time 10 https://cos-management.duckdns.org:3443/ -o /dev/null
curl --fail --silent --show-error --max-time 10 https://cos-management.duckdns.org:3445/pickup/4e91c7b2a860 -o /dev/null
trap - ERR
printf 'Standard HTTPS active. Existing HTTPS and QR endpoints healthy. Backup: %s\n' "$backup_dir"
