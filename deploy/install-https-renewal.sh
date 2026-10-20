#!/bin/bash
# Preserve existing user jobs and add one private daily certificate check.
set -euo pipefail
umask 077
test "$(id -un)" = configds
cron_tmp=$(mktemp /home/configds/.local/share/wms-tls/.cron.XXXXXX)
trap 'rm -f -- "$cron_tmp"' EXIT
crontab -l >"$cron_tmp" 2>/dev/null || true
if ! grep -Fq '/home/configds/wms/deploy/renew-https.sh' "$cron_tmp"; then
  printf '\n15 3 * * * /bin/bash /home/configds/wms/deploy/renew-https.sh > /home/configds/.local/share/wms-tls/cron.log 2>&1\n' >>"$cron_tmp"
  crontab "$cron_tmp"
fi
echo 'Daily certificate renewal check installed; existing jobs preserved.'
