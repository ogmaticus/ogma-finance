#!/usr/bin/env bash
# Конфигурация Caddy: с доменом — HTTPS (сертификат Let's Encrypt получается сам),
# без домена — только http по IP (для тестов). Перезагружает Caddy, только если конфиг изменился.
set -euo pipefail
DOMAIN="${1:-}"
APP_DIR="${APP_DIR:-/opt/finance}"
tmp="$(mktemp)"
if [[ -n "$DOMAIN" ]]; then
  sed "s/__SITE__/$DOMAIN/" "$APP_DIR/deploy/Caddyfile" > "$tmp"
else
  sed "s/__SITE__/:80/" "$APP_DIR/deploy/Caddyfile" | sed '/Strict-Transport-Security/d' > "$tmp"
fi
if cmp -s "$tmp" /etc/caddy/Caddyfile; then rm -f "$tmp"; echo "Caddy: без изменений (${DOMAIN:-:80})"; exit 0; fi
caddy validate --config "$tmp" --adapter caddyfile >/dev/null
install -m 644 "$tmp" /etc/caddy/Caddyfile; rm -f "$tmp"
systemctl enable caddy >/dev/null 2>&1 || true
systemctl reload caddy || systemctl restart caddy
echo "Caddy: сайт ${DOMAIN:-:80}"
