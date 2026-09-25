#!/usr/bin/env bash
set -euo pipefail

repo_root=${1:-/home/ubuntu/ClaudeChatAPP}
public_host=${CLAUDECHAT_PUBLIC_HOST:-}

if [[ -z "$public_host" || ! "$public_host" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "Set CLAUDECHAT_PUBLIC_HOST to a valid public hostname or IPv4 address." >&2
  exit 2
fi

install -d -m 0755 /var/www/claudechat-acme/.well-known/acme-challenge
install -d -m 0755 /var/lib/claudechat-gateway/tls
install -m 0644 "/etc/letsencrypt/live/$public_host/fullchain.pem" \
  /var/lib/claudechat-gateway/tls/fullchain.pem
printf 'CLAUDECHAT_PUBLIC_HOST=%s\n' "$public_host" > /etc/claudechat-certificate.env
chmod 0600 /etc/claudechat-certificate.env
install -m 0755 "$repo_root/scripts/server/claudechat-certbot-deploy-hook" \
  /usr/local/sbin/claudechat-certbot-deploy-hook
install -m 0755 "$repo_root/scripts/server/claudechat-certificate-health" \
  /usr/local/sbin/claudechat-certificate-health
install -m 0644 "$repo_root/ops/https/claudechat-certbot-renew.service" /etc/systemd/system/
install -m 0644 "$repo_root/ops/https/claudechat-certbot-renew.timer" /etc/systemd/system/
install -m 0644 "$repo_root/ops/https/claudechat-certificate-health.service" /etc/systemd/system/
install -m 0644 "$repo_root/ops/https/claudechat-certificate-health.timer" /etc/systemd/system/
sed "s/__CLAUDECHAT_PUBLIC_HOST__/$public_host/g" \
  "$repo_root/ops/https/nginx-secure.conf" > /etc/nginx/sites-available/claudechat
ln -sfn /etc/nginx/sites-available/claudechat /etc/nginx/sites-enabled/claudechat

nginx -t
systemctl reload nginx.service
systemctl daemon-reload
systemctl enable --now claudechat-certbot-renew.timer claudechat-certificate-health.timer
systemctl start claudechat-certificate-health.service
