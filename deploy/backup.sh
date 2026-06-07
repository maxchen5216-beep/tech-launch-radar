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

# 一并备份用户上传的头像（若有）
AVATARS="/opt/tlr/server/.data/avatars"
if [ -d "$AVATARS" ] && [ -n "$(ls -A "$AVATARS" 2>/dev/null)" ]; then
  tar -czf "$BACKUP_DIR/avatars-$STAMP.tar.gz" -C "$(dirname "$AVATARS")" avatars
fi

# 清理 30 天前的备份
find "$BACKUP_DIR" -name "app-*.db.gz" -mtime +30 -delete
find "$BACKUP_DIR" -name "avatars-*.tar.gz" -mtime +30 -delete

echo "[$(date '+%F %T')] 备份完成: app-$STAMP.db.gz"
