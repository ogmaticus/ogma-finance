#!/usr/bin/env bash
# Восстановление «Финансов» из зашифрованной копии.
#   finance-restore <копия.tar.age> <файл-закрытого-ключа-age> [--yes]
# Копию скачайте из S3 (панель Selectel или любой S3-клиент), ключ — из менеджера паролей.
# Закрытый ключ после восстановления удалите с сервера: shred -u <файл>.
# Без --yes скрипт только расшифрует и проверит копию, ничего не меняя (пробный прогон).
set -euo pipefail

ARCHIVE="${1:?Укажите файл копии .tar.age}"
IDENTITY="${2:?Укажите файл закрытого ключа age}"
APPLY="${3:-}"
DB="${RESTORE_DB:-finance}"
FILES_DIR="${FILES_DIR:-/var/lib/finance/files}"
read -r -a PG <<< "${PG_RUN-runuser -u postgres --}"

[[ $EUID -eq 0 || -n "${PG_RUN+x}" ]] || { echo "Запустите от root" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
chmod 755 "$WORK"

echo "==> Расшифровка"
age -d -i "$IDENTITY" "$ARCHIVE" | tar -C "$WORK" -xf -
DUMP="$(find "$WORK" -name 'db-*.dump' | head -n1)"
[[ -n "$DUMP" ]] || { echo "В копии нет дампа базы" >&2; exit 1; }
chmod 644 "$DUMP"
SRC_FILES="$WORK/files"
echo "    дамп: $(basename "$DUMP"), файлов скриншотов: $(find "$SRC_FILES" -type f 2>/dev/null | wc -l)"

echo "==> Проверка дампа во временной базе"
CHECK="${DB}_restore_check"
"${PG[@]}" dropdb --if-exists "$CHECK"
"${PG[@]}" createdb "$CHECK"
"${PG[@]}" pg_restore --no-owner --exit-on-error -d "$CHECK" < "$DUMP"
"${PG[@]}" psql -X -tA -d "$CHECK" -c \
  "SELECT 'пользователей: '||(SELECT count(*) FROM users)||', бюджетов: '||(SELECT count(*) FROM budget_documents)"
"${PG[@]}" dropdb "$CHECK"

if [[ "$APPLY" != "--yes" ]]; then
  echo "Пробный прогон завершён: копия читается и восстанавливается. Для замены рабочих данных добавьте --yes."
  exit 0
fi

echo "==> Замена рабочих данных"
systemctl stop finance 2>/dev/null || true
"${PG[@]}" pg_restore --clean --if-exists --no-owner --role=finance --exit-on-error -d "$DB" < "$DUMP"
if [[ -d "$SRC_FILES" ]]; then
  mkdir -p "$FILES_DIR"
  cp -a "$SRC_FILES/." "$FILES_DIR/"
  chown -R finance:finance "$FILES_DIR" 2>/dev/null || true
fi
systemctl start finance 2>/dev/null || true
echo "Готово. Удалите ключ с сервера: shred -u $IDENTITY"
