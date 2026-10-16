#!/usr/bin/env bash
# Запускается на сервере после копирования проекта в /opt/finance (из GitHub Actions).
#   первый запуск (нет /etc/finance/finance.env) или FULL_SETUP=1 — полная настройка через setup.sh;
#   иначе — только перезапуск службы и проверка /healthz.
set -euo pipefail
APP_DIR=/opt/finance
DOMAIN="${1:-}"

chown -R root:root "$APP_DIR"
chmod -R go-w "$APP_DIR"

if [[ ! -f /etc/finance/finance.env || "${FULL_SETUP:-0}" == "1" ]]; then
  bash "$APP_DIR/deploy/setup.sh" $DOMAIN
else
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
