#!/usr/bin/env bash
# Конфигурация Caddy: с доменом — HTTPS (сертификат Let's Encrypt получается сам),
# без домена — только http по IP (для тестов). Перезагружает Caddy, только если конфиг изменился.
# Аргументы: домен приложения, домены-переадресации (через пробел), домен лендинга.
set -euo pipefail
DOMAIN="${1:-}"
# Дополнительные домены, которые переадресуются на лендинг (если он есть) или на приложение.
REDIRECTS="${2:-}"
# Домен лендинга (статические файлы из landing/). Пусто — лендинг не публикуется.
LANDING="${3:-}"
APP_DIR="${APP_DIR:-/opt/finance}"
tmp="$(mktemp)"
if [[ -n "$DOMAIN" ]]; then
  sed "s/__SITE__/$DOMAIN/" "$APP_DIR/deploy/Caddyfile" > "$tmp"
  if [[ -n "$LANDING" && -f "$APP_DIR/landing/index.html" ]]; then
    sed -e "s/__LANDING__/$LANDING/" -e "s/__SITE__/$DOMAIN/" "$APP_DIR/deploy/Caddyfile.landing" >> "$tmp"
    TARGET="$LANDING"
  else
    LANDING=""
    TARGET="$DOMAIN"
  fi
  if [[ -n "$REDIRECTS" ]]; then
    printf '\n%s {\n\tredir https://%s{uri} permanent\n}\n' "$(echo $REDIRECTS | sed 's/ /, /g')" "$TARGET" >> "$tmp"
  fi
else
  sed "s/__SITE__/:80/" "$APP_DIR/deploy/Caddyfile" | sed '/Strict-Transport-Security/d' > "$tmp"
fi
if cmp -s "$tmp" /etc/caddy/Caddyfile; then rm -f "$tmp"; echo "Caddy: без изменений (${DOMAIN:-:80})"; exit 0; fi
caddy validate --config "$tmp" --adapter caddyfile >/dev/null
install -m 644 "$tmp" /etc/caddy/Caddyfile; rm -f "$tmp"
systemctl enable caddy >/dev/null 2>&1 || true
systemctl reload caddy || systemctl restart caddy
echo "Caddy: сайт ${DOMAIN:-:80}${LANDING:+, лендинг: $LANDING}${REDIRECTS:+, переадресация: $REDIRECTS}"
