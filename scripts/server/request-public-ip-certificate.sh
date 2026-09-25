#!/usr/bin/env bash
set -euo pipefail

mode=${1:-}
public_host=${CLAUDECHAT_PUBLIC_HOST:-}
webroot=/var/www/claudechat-acme

if [[ -z "$public_host" || ! "$public_host" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "Set CLAUDECHAT_PUBLIC_HOST to a valid public hostname or IPv4 address." >&2
  exit 2
fi
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
)

if [[ "$public_host" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
  arguments+=(--ip-address "$public_host")
else
  arguments+=(--domains "$public_host")
fi

if [[ "$mode" == "staging" ]]; then
  arguments+=(--staging --cert-name "${public_host}-staging")
else
  arguments+=(--cert-name "$public_host")
fi

/snap/bin/certbot "${arguments[@]}"
