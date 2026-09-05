#!/usr/bin/env bash
# Резервная копия базы (data/db.json) и загруженных файлов (public/uploads/).
# Это единственные данные проекта, которые не восстановить из git — всё
# остальное (код) и так лежит в репозитории.
#
# Использование:
#   ./scripts/backup.sh                    # бэкап в ./backups/
#   BACKUP_DIR=/mnt/backups ./scripts/backup.sh
#   KEEP_DAYS=14 ./scripts/backup.sh        # хранить бэкапы дольше 7 дней по умолчанию
#
# Пример строки в crontab (ежедневно в 03:00):
#   0 3 * * * cd /var/www/bauman-stage-crew && ./scripts/backup.sh >> logs/backup.log 2>&1

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
KEEP_DAYS="${KEEP_DAYS:-7}"
STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="$BACKUP_DIR/bsc-backup-$STAMP.tar.gz"

mkdir -p "$BACKUP_DIR"

if [ ! -f "$PROJECT_DIR/data/db.json" ]; then
  echo "[backup] $PROJECT_DIR/data/db.json не найден — нечего бэкапить." >&2
  exit 1
fi

tar -czf "$ARCHIVE" \
  -C "$PROJECT_DIR" \
  data/db.json \
  public/uploads

echo "[backup] Готово: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"

# Удаляем архивы старше KEEP_DAYS дней
find "$BACKUP_DIR" -name 'bsc-backup-*.tar.gz' -mtime "+$KEEP_DAYS" -print -delete
