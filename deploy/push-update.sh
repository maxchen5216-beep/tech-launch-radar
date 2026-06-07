#!/usr/bin/env bash
# ============================================================
# 在【本地 Mac】上执行：把项目同步到国内服务器并重启 + 触发数据同步
# 用途：国内服务器访问不了 GitHub，代码/数据更新都从本地直推
# 用法：bash deploy/push-update.sh
# ============================================================
set -euo pipefail

SERVER="root@121.40.54.69"
LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> 同步代码到 $SERVER:/opt/tlr/"
rsync -avz --delete \
  --exclude .git --exclude .gstack --exclude .claude --exclude .DS_Store \
  --exclude server/node_modules --exclude server/.data --exclude server/.env \
  --exclude server/package-lock.json \
  "$LOCAL_DIR/" "$SERVER:/opt/tlr/"

echo "==> 重启服务并触发事件同步（官宣检测）"
ssh "$SERVER" '
  chown -R tlr:tlr /opt/tlr
  systemctl restart tlr
  sleep 2
  INTERNAL_KEY=$(grep "^INTERNAL_KEY=" /opt/tlr/server/.env | cut -d= -f2-)
  curl -fsS -X POST http://127.0.0.1:8787/internal/sync-events -H "x-internal-key: $INTERNAL_KEY" && echo
'
echo "✅ 完成"
