#!/usr/bin/env bash
# Ежедневная копия базы. Скриншоты в /var/lib/finance/files уже зашифрованы;
# для полного восстановления нужны дамп базы, каталог files и ключ FILES_KEY.
set -euo pipefail
DIR=/var/backups/finance
STAMP="$(date -u +%Y%m%d-%H%M%S)"
umask 077
pg_dump -Fc finance > "$DIR/db-$STAMP.dump"
find "$DIR" -name 'db-*.dump' -mtime +14 -delete
echo "backup ok: $DIR/db-$STAMP.dump ($(du -h "$DIR/db-$STAMP.dump" | cut -f1))"
