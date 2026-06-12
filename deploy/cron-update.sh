#!/usr/bin/env bash
# ============================================================
# 定时内容更新（服务器 cron 调用）：Qwen 联网更新数据 → 触发 sync-events
# 由 /etc/cron.d/tlr-update 每天 8:00 / 18:00（Asia/Shanghai）以 tlr 用户运行
# ============================================================
set -uo pipefail
export PATH="/home/tlr/.bun/bin:$PATH"
APP=/opt/tlr
LOG="$APP/logs/update.log"
mkdir -p "$APP/logs"

echo "===== $(date '+%F %T') 开始更新 =====" >> "$LOG"
cd "$APP" || exit 1

# 1. Qwen 联网更新 data/events-data.js
bun scripts/update-events.ts >> "$LOG" 2>&1

# 2. 触发后端事件同步（落库 + 官宣检测 + 孤儿清理）
KEY=$(grep '^INTERNAL_KEY=' server/.env | cut -d= -f2-)
curl -fsS -X POST http://127.0.0.1:8787/internal/sync-events -H "x-internal-key: $KEY" >> "$LOG" 2>&1
echo "" >> "$LOG"
echo "===== $(date '+%F %T') 完成 =====" >> "$LOG"

# 日志保留最近 500 行
tail -n 500 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
