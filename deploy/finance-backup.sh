#!/usr/bin/env bash
# Ночной бэкап «Финансов».
#  1. Дамп базы (pg_dump) в /var/backups/finance, локально хранится 14 дней.
#  2. Проверка дампа: восстановление во временную базу и сверка таблиц.
#  3. Если настроен /etc/finance/backup.env — архив (дамп + каталог зашифрованных
#     скриншотов) шифруется открытым ключом age и отправляется в S3 другого провайдера.
#     Закрытого ключа на сервере нет: расшифровать копию можно только у владельца.
# Любая ошибка завершает скрипт с ненулевым кодом -> systemd запускает оповещение.
set -euo pipefail

DIR="${BACKUP_DIR:-/var/backups/finance}"
FILES_DIR="${FILES_DIR:-/var/lib/finance/files}"
DB="${BACKUP_DB:-finance}"
CHECK_DB="${DB}_restore_check"
CONF="${BACKUP_CONF:-/etc/finance/backup.env}"
KEEP_LOCAL_DAYS="${KEEP_LOCAL_DAYS:-14}"
# Команды PostgreSQL выполняются от пользователя postgres (в тестах переопределяется).
read -r -a PG <<< "${PG_RUN-runuser -u postgres --}"

STAMP="$(date -u +%Y%m%d-%H%M%S)"
DUMP="$DIR/db-$STAMP.dump"
umask 077
mkdir -p "$DIR"

log() { echo "[backup] $*"; }

# 1. Дамп
"${PG[@]}" pg_dump -Fc "$DB" > "$DUMP"
log "дамп: $DUMP ($(du -h "$DUMP" | cut -f1))"

# 2. Проверка восстановлением
cleanup_check() { "${PG[@]}" dropdb --if-exists "$CHECK_DB" >/dev/null 2>&1 || true; }
trap cleanup_check EXIT
cleanup_check
"${PG[@]}" createdb "$CHECK_DB"
"${PG[@]}" pg_restore --no-owner --exit-on-error -d "$CHECK_DB" < "$DUMP"
q() { "${PG[@]}" psql -X -tA -d "$1" -c "$2"; }
for t in schema_migrations users budget_documents screenshot_files; do
  src="$(q "$DB" "SELECT count(*) FROM $t")"
  dst="$(q "$CHECK_DB" "SELECT count(*) FROM $t")"
  if [[ "$src" != "$dst" ]]; then
    # Между дампом и проверкой могли появиться новые строки; меньше быть не может.
    if (( dst > src )); then log "ОШИБКА: $t: в копии $dst строк, в базе $src"; exit 1; fi
  fi
done
migrations="$(q "$CHECK_DB" "SELECT count(*) FROM schema_migrations")"
(( migrations >= 1 )) || { log "ОШИБКА: в копии нет миграций"; exit 1; }
cleanup_check
trap - EXIT
log "проверка восстановления пройдена"

find "$DIR" -name 'db-*.dump' -mtime +"$KEEP_LOCAL_DAYS" -delete

# 3. Внешняя зашифрованная копия
if [[ ! -f "$CONF" ]]; then
  log "внешняя копия не настроена ($CONF нет) — только локальный бэкап"
  exit 0
fi
# shellcheck disable=SC1090
source "$CONF"
: "${AGE_RECIPIENT:?AGE_RECIPIENT не задан}" "${S3_ENDPOINT:?}" "${S3_BUCKET:?}" \
  "${S3_REGION:?}" "${S3_ACCESS_KEY:?}" "${S3_SECRET_KEY:?}"
S3_PREFIX="${S3_PREFIX:-finance}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
ARCHIVE="$TMP/finance-$STAMP.tar.age"
# В архиве: db-*.dump и каталог files/ со скриншотами (они и так зашифрованы FILES_KEY).
tar -cf - -C "$DIR" "$(basename "$DUMP")" \
  -C "$(dirname "$FILES_DIR")" --transform "s,^$(basename "$FILES_DIR"),files," \
  "$(basename "$FILES_DIR")" | age -r "$AGE_RECIPIENT" > "$ARCHIVE"
SIZE="$(stat -c %s "$ARCHIVE")"

OBJ="$S3_PREFIX/finance-$STAMP.tar.age"
code="$(curl -sS -o "$TMP/resp" -w '%{http_code}' --fail-with-body \
  --aws-sigv4 "aws:amz:$S3_REGION:s3" --user "$S3_ACCESS_KEY:$S3_SECRET_KEY" \
  -H "x-amz-content-sha256: UNSIGNED-PAYLOAD" \
  -T "$ARCHIVE" "${S3_ENDPOINT%/}/$S3_BUCKET/$OBJ" || true)"
if [[ "$code" != "200" ]]; then
  log "ОШИБКА загрузки в S3: HTTP $code $(head -c 300 "$TMP/resp" 2>/dev/null)"
  exit 1
fi
log "внешняя копия: $S3_BUCKET/$OBJ ($SIZE байт)"
