#!/usr/bin/env bash
# Первичная настройка сервера Ubuntu 24.04 для «Финансов» (сервер v2).
# Запуск от root:  bash deploy/setup.sh [домен]
#   без домена — приложение доступно по http://IP (только для тестов: без HTTPS
#   не работает установка на главный экран и офлайн-режим);
#   с доменом — Caddy сам получит сертификат Let's Encrypt.
# Скрипт можно запускать повторно: существующие секреты и база не перезаписываются.
set -euo pipefail

DOMAIN="${1:-}"
APP_DIR=/opt/finance
DATA_DIR=/var/lib/finance
ENV_FILE=/etc/finance/finance.env
BACKUP_DIR=/var/backups/finance

if [[ $EUID -ne 0 ]]; then echo "Запустите от root" >&2; exit 1; fi
if [[ ! -f "$APP_DIR/backend/main.mjs" ]]; then echo "Сначала скопируйте проект в $APP_DIR" >&2; exit 1; fi

echo "==> Пакеты системы"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get upgrade -yq
apt-get install -yq ca-certificates curl gnupg ufw postgresql caddy unattended-upgrades openssl age

echo "==> Node.js 22"
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -yq nodejs
fi
node --version

echo "==> Пользователь и каталоги"
id finance >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin finance
install -d -o finance -g finance -m 700 "$DATA_DIR" "$DATA_DIR/files"
install -d -o root -g finance -m 750 /etc/finance
install -d -o postgres -g postgres -m 700 "$BACKUP_DIR"
chown -R root:root "$APP_DIR"
chmod -R go-w "$APP_DIR"

echo "==> PostgreSQL"
if [[ ! -f "$ENV_FILE" ]]; then
  DB_PASSWORD="$(openssl rand -hex 24)"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'finance') THEN
    CREATE ROLE finance LOGIN PASSWORD '${DB_PASSWORD}';
  ELSE
    ALTER ROLE finance PASSWORD '${DB_PASSWORD}';
  END IF;
END \$\$;
SQL
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='finance'" | grep -q 1 ||
    sudo -u postgres createdb -O finance finance

  if [[ -n "$DOMAIN" ]]; then ORIGIN="https://$DOMAIN"; else
    IP="$(curl -fsS4 https://ifconfig.me || hostname -I | awk '{print $1}')"
    ORIGIN="http://$IP"
  fi
  umask 027
  cat > "$ENV_FILE" <<ENV
# Секреты сервера. Не публикуйте этот файл и не храните его в репозитории.
DATABASE_URL=postgres://finance:${DB_PASSWORD}@127.0.0.1:5432/finance
APP_SECRET=$(openssl rand -hex 32)
FILES_KEY=$(openssl rand -hex 32)
FILES_DIR=${DATA_DIR}/files
PUBLIC_ORIGIN=${ORIGIN}
HOST=127.0.0.1
PORT=3000
TRUST_PROXY=1
# Почта: console — письма НЕ отправляются (в журнал пишутся только адрес и тема, без кода),
# поэтому войти в приложение нельзя. Для входа: MAIL_TRANSPORT=smtp и параметры SMTP ниже.
MAIL_TRANSPORT=console
MAIL_FROM=no-reply@example.ru
MAIL_FROM_NAME=Финансы
#SMTP_HOST=smtp.yandex.ru
#SMTP_PORT=465
#SMTP_SECURE=true
#SMTP_USER=
#SMTP_PASSWORD=
# Куда слать оповещения о сбоях (бэкап, служба приложения).
#ALERT_EMAIL=
ENV
  chown root:finance "$ENV_FILE"
  chmod 640 "$ENV_FILE"
  echo "Создан $ENV_FILE. СОХРАНИТЕ копию FILES_KEY в надёжном месте: без него скриншоты не расшифровать."
fi

echo "==> Служба приложения"
install -m 644 "$APP_DIR/deploy/finance.service" /etc/systemd/system/finance.service
systemctl daemon-reload
systemctl enable finance
systemctl restart finance
sleep 2
systemctl --no-pager --lines=5 status finance || true

echo "==> Caddy (HTTPS и обратный прокси)"
if [[ -n "$DOMAIN" ]]; then
  sed "s/__SITE__/$DOMAIN/" "$APP_DIR/deploy/Caddyfile" > /etc/caddy/Caddyfile
else
  sed "s/__SITE__/:80/" "$APP_DIR/deploy/Caddyfile" | sed '/Strict-Transport-Security/d' > /etc/caddy/Caddyfile
fi
caddy validate --config /etc/caddy/Caddyfile
systemctl enable caddy
systemctl reload caddy || systemctl restart caddy

echo "==> Резервные копии базы (ежедневно, 14 дней)"
install -m 755 "$APP_DIR/deploy/finance-backup.sh" /usr/local/bin/finance-backup
install -m 644 "$APP_DIR/deploy/finance-backup.service" /etc/systemd/system/finance-backup.service
install -m 644 "$APP_DIR/deploy/finance-backup.timer" /etc/systemd/system/finance-backup.timer
install -m 644 "$APP_DIR/deploy/finance-alert@.service" /etc/systemd/system/finance-alert@.service
install -m 755 "$APP_DIR/deploy/finance-restore.sh" /usr/local/bin/finance-restore
if [[ ! -f /etc/finance/backup.env ]]; then
  install -m 600 -o root -g root "$APP_DIR/deploy/backup.env.example" /etc/finance/backup.env.example
fi
systemctl daemon-reload
systemctl enable --now finance-backup.timer

echo "==> Межсетевой экран и обновления безопасности"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> SSH только по ключам"
if grep -q "^ssh-" /root/.ssh/authorized_keys 2>/dev/null; then
  cat > /etc/ssh/sshd_config.d/90-finance.conf <<'SSH'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
SSH
  systemctl reload ssh || systemctl reload sshd || true
else
  echo "В /root/.ssh/authorized_keys нет ключей — вход по паролю НЕ отключён."
fi

echo "==> Проверка"
for i in 1 2 3 4 5; do
  if curl -fsS http://127.0.0.1:3000/healthz >/dev/null; then echo "Приложение отвечает"; break; fi
  sleep 2
done
echo "Готово. Адрес: $(grep ^PUBLIC_ORIGIN "$ENV_FILE" | cut -d= -f2)/finance"
