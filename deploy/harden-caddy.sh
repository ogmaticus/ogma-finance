#!/usr/bin/env bash
# Изоляция Caddy через systemd drop-in. Если после перезапуска сайт не отвечает —
# ограничения снимаются и Caddy возвращается к прежней работе.
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/finance}"
SRC="$APP_DIR/deploy/caddy-hardening.conf"
DIR=/etc/systemd/system/caddy.service.d
DST="$DIR/10-ogma-hardening.conf"

command -v caddy >/dev/null || { echo "Caddy: не установлен — пропускаем изоляцию"; exit 0; }
if [[ -f "$DST" ]] && cmp -s "$SRC" "$DST"; then echo "Caddy: изоляция без изменений"; exit 0; fi

# Как проверять: по домену (HTTPS) или по IP (:80) — смотрим действующий Caddyfile.
check() {
  local site
  site="$(awk 'NF && $1 !~ /^#/ && $NF=="{" {print $1; exit}' /etc/caddy/Caddyfile)"
  site="${site%,}"
  if [[ "$site" == ":80" || -z "$site" ]]; then
    curl -fsS -m 10 -o /dev/null http://127.0.0.1/healthz
  else
    curl -fsS -m 10 -o /dev/null --resolve "$site:443:127.0.0.1" "https://$site/healthz"
  fi
}

install -d -m 755 "$DIR"
install -m 644 "$SRC" "$DST.new"
mv "$DST.new" "$DST"
systemctl daemon-reload
systemctl restart caddy

for i in $(seq 1 15); do
  if systemctl is-active --quiet caddy && check; then
    echo "Caddy: изоляция включена ($(systemd-analyze security caddy.service 2>/dev/null | tail -1 | awk '{print $(NF-1), $NF}'))"
    exit 0
  fi
  sleep 2
done

echo "Caddy: после изоляции сайт не отвечает — откатываю" >&2
journalctl -u caddy --no-pager -n 30 >&2 || true
rm -f "$DST"
systemctl daemon-reload
systemctl restart caddy
exit 0
