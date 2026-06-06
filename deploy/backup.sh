#!/usr/bin/env bash
# SQLite 每日备份：用 sqlite3 .backup 保证一致性（WAL 模式下 cp 不安全），保留 30 天
set -euo pipefail

DB="/opt/tlr/server/.data/app.db"
BACKUP_DIR="/opt/tlr/backups"
mkdir -p "$BACKUP_DIR"

[ -f "$DB" ] || { echo "数据库不存在，跳过"; exit 0; }

STAMP=$(date +%Y%m%d-%H%M%S)
sqlite3 "$DB" ".backup '$BACKUP_DIR/app-$STAMP.db'"
gzip "$BACKUP_DIR/app-$STAMP.db"

# 清理 30 天前的备份
find "$BACKUP_DIR" -name "app-*.db.gz" -mtime +30 -delete

echo "[$(date '+%F %T')] 备份完成: app-$STAMP.db.gz"
