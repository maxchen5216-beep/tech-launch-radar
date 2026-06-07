#!/usr/bin/env bash
# （服务器上执行）触发事件同步/官宣检测。
# 注意：国内服务器不走 git pull，代码与数据更新请在本地 Mac 执行 deploy/push-update.sh
set -euo pipefail

INTERNAL_KEY=$(grep '^INTERNAL_KEY=' /opt/tlr/server/.env | cut -d= -f2-)
curl -fsS -X POST http://127.0.0.1:8787/internal/sync-events -H "x-internal-key: $INTERNAL_KEY"
echo ""
echo "[$(date '+%F %T')] 事件同步完成"
