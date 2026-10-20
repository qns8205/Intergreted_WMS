#!/bin/bash
set -euo pipefail
umask 077
test "$(id -un)" = configds
tls_dir=/home/configds/.local/share/wms-tls
openssl x509 -in "$tls_dir/wms.next.crt" -checkhost cos-management.duckdns.org -noout
openssl x509 -in "$tls_dir/wms.next.crt" -checkend 86400 -noout
cert_public=$(openssl x509 -in "$tls_dir/wms.next.crt" -pubkey -noout | openssl sha256)
key_public=$(openssl pkey -in "$tls_dir/wms.next.key" -pubout | openssl sha256)
test "$cert_public" = "$key_public"
chmod 600 "$tls_dir/wms.next.crt" "$tls_dir/wms.next.key"
# Keep staged paths present for subsequent --install-cert renewals; WMS reloads files every minute.
install -m 600 "$tls_dir/wms.next.key" "$tls_dir/wms.ready.key"
install -m 600 "$tls_dir/wms.next.crt" "$tls_dir/wms.ready.crt"
mv "$tls_dir/wms.ready.key" "$tls_dir/wms.key"
mv "$tls_dir/wms.ready.crt" "$tls_dir/wms.crt"
