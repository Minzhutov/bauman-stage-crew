#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
KEEP_DAYS="${KEEP_DAYS:-7}"
STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="$BACKUP_DIR/bsc-backup-$STAMP.tar.gz"
STAGE_DIR="$PROJECT_DIR/.backup-stage-$STAMP"

mkdir -p "$BACKUP_DIR"

if [ ! -f "$PROJECT_DIR/data/bsc.sqlite" ]; then
  echo "[backup] $PROJECT_DIR/data/bsc.sqlite не найден — нечего бэкапить." >&2
  exit 1
fi

mkdir -p "$STAGE_DIR/data"
node -e "
const Database = require('$PROJECT_DIR/node_modules/better-sqlite3');
const db = new Database('$PROJECT_DIR/data/bsc.sqlite', { readonly: true });
db.backup('$STAGE_DIR/data/bsc.sqlite').then(() => { db.close(); }).catch((err) => { console.error(err); process.exit(1); });
"

tar -czf "$ARCHIVE" \
  -C "$STAGE_DIR" data \
  -C "$PROJECT_DIR" public/uploads

rm -rf "$STAGE_DIR"

echo "[backup] Готово: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"

find "$BACKUP_DIR" -name 'bsc-backup-*.tar.gz' -mtime "+$KEEP_DAYS" -print -delete
