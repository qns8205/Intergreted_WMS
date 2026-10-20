#!/bin/bash
# Run interactively as configds. Never pass the token as a command argument.
set -euo pipefail
set +x
umask 077
if [ "$(id -un)" != configds ]; then
  echo 'Run this script as configds, without sudo.' >&2
  exit 1
fi
tls_dir=/home/configds/.local/share/wms-tls
if [ -L "$tls_dir" ]; then
  echo 'Refusing a symlinked credential directory.' >&2
  exit 1
fi
install -d -m 700 "$tls_dir"
IFS= read -r -s -p 'Paste Duck DNS token (input hidden): ' duck_token </dev/tty
printf '\n' >/dev/tty
if [[ ! "$duck_token" =~ ^[a-zA-Z0-9-]{16,128}$ ]]; then
  unset duck_token
  echo 'Invalid token format; nothing was saved.' >&2
  exit 1
fi
token_tmp=$(mktemp "$tls_dir/.duckdns-token.XXXXXX")
trap 'rm -f -- "$token_tmp"' EXIT
printf '%s\n' "$duck_token" >"$token_tmp"
unset duck_token
chmod 600 "$token_tmp"
mv -T -- "$token_tmp" "$tls_dir/duckdns.token"
echo 'Token saved securely. HTTPS is not activated yet.'
