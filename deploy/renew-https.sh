#!/bin/bash
# User-level DNS-01 issuance/renewal. No public port, DNS A/AAAA or Tailscale changes.
set -euo pipefail
set +x
umask 077
test "$(id -un)" = configds
tls_dir=/home/configds/.local/share/wms-tls
acme_dir=/home/configds/.local/share/wms-acme
domain=cos-management.duckdns.org
test -f "$tls_dir/duckdns.token"
test "$(stat -c %a "$tls_dir/duckdns.token")" = 600
test "$(stat -c %U "$tls_dir/duckdns.token")" = configds
test -f "$acme_dir/acme.sh"
exec 9>"$tls_dir/renew.lock"
flock -n 9 || exit 0
export DuckDNS_Token
IFS= read -r DuckDNS_Token <"$tls_dir/duckdns.token"
test -n "$DuckDNS_Token"
# Detailed output stays private: DNS API request URLs may contain account credentials.
private_log="$tls_dir/acme-renew.log"
if [ "${1:-}" = --initial ]; then
  result=0
  bash "$acme_dir/acme.sh" --home "$acme_dir" --server letsencrypt --issue \
    --dns dns_duckdns --dnssleep 60 --keylength ec-256 -d "$domain" >"$private_log" 2>&1 || result=$?
  # acme.sh uses 2 for a certificate that is not due for renewal.
  if [ "$result" != 0 ] && [ "$result" != 2 ]; then
    echo 'DNS certificate issuance failed. Inspect the private log locally; do not share it unredacted.' >&2
    exit 1
  fi
  bash "$acme_dir/acme.sh" --home "$acme_dir" --install-cert --ecc -d "$domain" \
    --key-file "$tls_dir/wms.next.key" --fullchain-file "$tls_dir/wms.next.crt" \
    --reloadcmd 'bash /home/configds/wms/deploy/activate-https-certificate.sh' >>"$private_log" 2>&1
else
  if ! bash "$acme_dir/acme.sh" --home "$acme_dir" --cron >"$private_log" 2>&1; then
    echo 'Certificate renewal failed; the existing certificate remains active.' >&2
    exit 1
  fi
fi
unset DuckDNS_Token
echo 'WMS DNS certificate check complete.'
