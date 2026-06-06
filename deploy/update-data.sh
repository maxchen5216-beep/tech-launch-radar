#!/usr/bin/env bash
# 数据更新脚本（服务器上执行）：拉取最新 events-data.js 并触发事件同步/官宣检测
# 流程：本地更新数据 → git push → 服务器跑本脚本
set -euo pipefail

APP_DIR="/opt/tlr"

cd "$APP_DIR"
git pull --ff-only

# 读取生产 INTERNAL_KEY 并触发同步
INTERNAL_KEY=$(grep '^INTERNAL_KEY=' "$APP_DIR/server/.env" | cut -d= -f2-)
curl -fsS -X POST http://127.0.0.1:8787/internal/sync-events -H "x-internal-key: $INTERNAL_KEY"
echo ""
echo "[$(date '+%F %T')] 数据已更新并同步"
