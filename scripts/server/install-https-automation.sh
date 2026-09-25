#!/usr/bin/env bash
set -euo pipefail

repo_root=${1:-/home/ubuntu/ClaudeChatAPP}

install -d -m 0755 /var/www/claudechat-acme/.well-known/acme-challenge
install -d -m 0755 /var/lib/claudechat-gateway/tls
install -m 0644 /etc/letsencrypt/live/gateway.example.com/fullchain.pem \
  /var/lib/claudechat-gateway/tls/fullchain.pem
install -m 0755 "$repo_root/scripts/server/claudechat-certbot-deploy-hook" \
  /usr/local/sbin/claudechat-certbot-deploy-hook
install -m 0755 "$repo_root/scripts/server/claudechat-certificate-health" \
  /usr/local/sbin/claudechat-certificate-health
install -m 0644 "$repo_root/ops/https/claudechat-certbot-renew.service" /etc/systemd/system/
install -m 0644 "$repo_root/ops/https/claudechat-certbot-renew.timer" /etc/systemd/system/
install -m 0644 "$repo_root/ops/https/claudechat-certificate-health.service" /etc/systemd/system/
install -m 0644 "$repo_root/ops/https/claudechat-certificate-health.timer" /etc/systemd/system/

systemctl daemon-reload
systemctl enable --now claudechat-certbot-renew.timer claudechat-certificate-health.timer
systemctl start claudechat-certificate-health.service
