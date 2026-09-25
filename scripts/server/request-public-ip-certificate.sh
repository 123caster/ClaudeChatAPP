#!/usr/bin/env bash
set -euo pipefail

mode=${1:-}
ip_address=gateway.example.com
webroot=/var/www/claudechat-acme

if [[ "$mode" != "staging" && "$mode" != "production" ]]; then
  echo "Usage: $0 staging|production" >&2
  exit 2
fi
if ! command -v /snap/bin/certbot >/dev/null 2>&1; then
  echo "Certbot 5.4 or newer must be installed at /snap/bin/certbot." >&2
  exit 1
fi
version=$(/snap/bin/certbot --version | awk '{print $2}')
if ! printf '5.4\n%s\n' "$version" | sort -V -C; then
  echo "Certbot $version is too old; version 5.4 or newer is required." >&2
  exit 1
fi

mkdir -p "$webroot/.well-known/acme-challenge"
arguments=(
  certonly
  --non-interactive
  --agree-tos
  --register-unsafely-without-email
  --preferred-profile shortlived
  --webroot
  --webroot-path "$webroot"
  --ip-address "$ip_address"
)

if [[ "$mode" == "staging" ]]; then
  arguments+=(--staging --cert-name "${ip_address}-staging")
else
  arguments+=(--cert-name "$ip_address")
fi

/snap/bin/certbot "${arguments[@]}"
