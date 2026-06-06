#!/usr/bin/env bash
# ============================================================
# 科技圈发布会雷达 · 服务器初始化脚本（阿里云轻量服务器，Ubuntu 22.04 / Debian 12）
# 用 root 执行：bash setup.sh
# 幂等：重复执行安全。
# ============================================================
set -euo pipefail

REPO_URL="https://github.com/maxchen5216-beep/tech-launch-radar.git"
APP_DIR="/opt/tlr"
APP_USER="tlr"

echo "==> [1/7] 安装基础依赖"
apt-get update -qq
apt-get install -y -qq curl unzip git sqlite3 ca-certificates debian-keyring debian-archive-keyring apt-transport-https gnupg

echo "==> [2/7] 创建运行用户 ${APP_USER}"
id -u "$APP_USER" &>/dev/null || useradd -r -m -s /bin/bash "$APP_USER"

echo "==> [3/7] 安装 Bun（${APP_USER} 用户）"
if ! sudo -u "$APP_USER" test -x "/home/$APP_USER/.bun/bin/bun"; then
  sudo -u "$APP_USER" bash -c 'curl -fsSL https://bun.sh/install | bash'
fi

echo "==> [4/7] 拉取代码到 ${APP_DIR}"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO_URL" "$APP_DIR"
else
  git -C "$APP_DIR" pull --ff-only
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
sudo -u "$APP_USER" bash -c "cd $APP_DIR/server && /home/$APP_USER/.bun/bin/bun install"

echo "==> [5/7] 生成生产配置 ${APP_DIR}/server/.env（已存在则跳过）"
if [ ! -f "$APP_DIR/server/.env" ]; then
  cat > "$APP_DIR/server/.env" <<EOF
PORT=8787
MAIL_DRIVER=directmail
# ↓↓↓ 填入 RAM 子账号的 AccessKey（仅授权 DirectMail）与已验证的发信地址 ↓↓↓
ALIYUN_AK=
ALIYUN_SK=
MAIL_FROM=noreply@mail.nextlaunch.cn
MAIL_FROM_ALIAS=科技圈发布会雷达
# 随机生成的生产密钥（请勿外泄）
JWT_SECRET=$(head -c 32 /dev/urandom | base64 | tr -d '=+/')
INTERNAL_KEY=$(head -c 24 /dev/urandom | base64 | tr -d '=+/')
REMINDER_DAILY_CAP=500
EOF
  chown "$APP_USER:$APP_USER" "$APP_DIR/server/.env"
  chmod 600 "$APP_DIR/server/.env"
  echo "    ⚠️  请编辑 $APP_DIR/server/.env 填入 ALIYUN_AK / ALIYUN_SK"
fi

echo "==> [6/7] 配置 systemd 服务（开机自启 + 崩溃自动重启）"
cp "$APP_DIR/deploy/tlr.service" /etc/systemd/system/tlr.service
systemctl daemon-reload
systemctl enable tlr
systemctl restart tlr

echo "==> [7/7] 安装 Caddy（反向代理 + 自动 HTTPS）"
if ! command -v caddy &>/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy
fi
cp "$APP_DIR/deploy/Caddyfile" /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy

echo "==> 配置每日数据库备份（凌晨4点，保留30天）"
chmod +x "$APP_DIR/deploy/backup.sh" "$APP_DIR/deploy/update-data.sh"
cat > /etc/cron.d/tlr-backup <<EOF
0 4 * * * $APP_USER $APP_DIR/deploy/backup.sh >> /var/log/tlr-backup.log 2>&1
EOF

echo ""
echo "✅ 初始化完成。后续步骤："
echo "   1. 编辑 $APP_DIR/server/.env 填入 DirectMail 的 AK/SK，然后 systemctl restart tlr"
echo "   2. 备案前：浏览器访问 http://<服务器IP> 测试（Caddyfile 默认 IP 模式）"
echo "   3. 备案通过后：编辑 /etc/caddy/Caddyfile 切换到域名模式，systemctl reload caddy"
echo "   状态检查：systemctl status tlr / journalctl -u tlr -f"
