#!/usr/bin/env bash
# Запускается на сервере после копирования проекта в /opt/finance (из GitHub Actions).
#   первый запуск (нет /etc/finance/finance.env) или FULL_SETUP=1 — полная настройка через setup.sh;
#   иначе — только перезапуск службы и проверка /healthz.
set -euo pipefail
APP_DIR=/opt/finance
DOMAIN="${1:-}"

chown -R root:root "$APP_DIR"
chmod -R go-w "$APP_DIR"

ENV_FILE=/etc/finance/finance.env
INCOMING=/etc/finance/settings.incoming

# Задаёт KEY=VALUE в finance.env (заменяет строку, в том числе закомментированную, или дописывает).
set_env() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  awk -v k="$key" -v v="$value" '
    BEGIN { done = 0 }
    $0 ~ "^#?" k "=" { if (!done) { print k "=" v; done = 1 }; next }
    { print }
    END { if (!done) print k "=" v }' "$ENV_FILE" > "$tmp"
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
}

# Настройки из секретов GitHub (почта и т. п.) — применяются после того, как finance.env создан.
apply_incoming() {
  [[ -f "$INCOMING" && -f "$ENV_FILE" ]] || return 0
  local changed=0 key value
  while IFS='=' read -r key value; do
    [[ "$key" =~ ^[A-Z_]+$ && -n "$value" ]] || continue
    if ! grep -qxF "$key=$value" "$ENV_FILE"; then set_env "$key" "$value"; changed=1; fi
  done < "$INCOMING"
  shred -u "$INCOMING" 2>/dev/null || rm -f "$INCOMING"
  if (( changed )); then echo "Настройки обновлены из секретов GitHub"; fi
  return 0
}

if [[ ! -f /etc/finance/finance.env || "${FULL_SETUP:-0}" == "1" ]]; then
  bash "$APP_DIR/deploy/setup.sh" $DOMAIN
  apply_incoming
  systemctl restart finance
else
  apply_incoming
  command -v age >/dev/null || apt-get install -yq age
  install -m 644 "$APP_DIR/deploy/finance.service" /etc/systemd/system/finance.service
  install -m 755 "$APP_DIR/deploy/finance-backup.sh" /usr/local/bin/finance-backup
  install -m 755 "$APP_DIR/deploy/finance-restore.sh" /usr/local/bin/finance-restore
  install -m 644 "$APP_DIR/deploy/finance-backup.service" /etc/systemd/system/finance-backup.service
  install -m 644 "$APP_DIR/deploy/finance-backup.timer" /etc/systemd/system/finance-backup.timer
  install -m 644 "$APP_DIR/deploy/finance-alert@.service" /etc/systemd/system/finance-alert@.service
  systemctl daemon-reload
  systemctl restart finance
fi

# Образ хостинга открывает порт панели ispmanager — она не используется.
ufw delete allow ispmanager >/dev/null 2>&1 || true

for i in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3000/healthz >/dev/null; then
    echo "OK: приложение отвечает"
    exit 0
  fi
  sleep 1
done
echo "Приложение не ответило на /healthz" >&2
journalctl -u finance --no-pager -n 50 >&2 || true
exit 1
