#!/usr/bin/env bash
# ============================================================
# 科技圈发布会雷达 · 服务器初始化脚本（国内服务器友好版）
# 不依赖 GitHub/海外源：Bun 经 npmmirror 安装，反代用 Ubuntu 源里的 nginx。
# 前置：代码已通过 rsync 从本地电脑上传到 /opt/tlr（见 deploy/README.md）
# 用 root 执行：bash /opt/tlr/deploy/setup.sh   （幂等，可重复执行）
# ============================================================
set -euo pipefail

APP_DIR="/opt/tlr"
APP_USER="tlr"
NPM_REG="https://registry.npmmirror.com"

[ -f "$APP_DIR/server/package.json" ] || {
  echo "❌ 未找到 $APP_DIR/server/package.json"
  echo "   请先在本地电脑执行 rsync 上传代码（见 deploy/README.md「上传代码」一节）"
  exit 1
}

echo "==> [1/7] 安装基础依赖（阿里云 Ubuntu 镜像源，速度快）"
apt-get update -qq
apt-get install -y -qq curl unzip rsync git sqlite3 nginx nodejs npm

echo "==> [2/7] 创建运行用户 ${APP_USER}"
id -u "$APP_USER" &>/dev/null || useradd -r -m -s /bin/bash "$APP_USER"

echo "==> [3/7] 安装 Bun（经 npmmirror 国内镜像，约 1-2 分钟）"
if ! command -v bun &>/dev/null; then
  npm install -g bun --registry="$NPM_REG"
fi
# systemd 单元里用固定路径 /home/tlr/.bun/bin/bun，做个符号链接对齐
mkdir -p "/home/$APP_USER/.bun/bin"
ln -sf "$(command -v bun)" "/home/$APP_USER/.bun/bin/bun"
chown -R "$APP_USER:$APP_USER" "/home/$APP_USER/.bun"
echo "    bun $(bun --version)"

echo "==> [4/7] 安装后端依赖（npmmirror）"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
sudo -u "$APP_USER" bash -c "cd $APP_DIR/server && npm install --registry=$NPM_REG --omit=dev --no-audit --no-fund"

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
REMINDER_DAILY_CAP=180
# 允许的前端跨域来源（逗号分隔）。同源访问无需填；如用独立前端域名再加
CORS_ORIGINS=https://nextlaunch.cn,https://www.nextlaunch.cn
# 管理员邮箱（逗号分隔）：可删除任何用户的评论。请填你登录用的邮箱
ADMIN_EMAILS=
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

echo "==> [7/7] 配置 nginx 反向代理（80 端口）"
cp "$APP_DIR/deploy/nginx-tlr.conf" /etc/nginx/sites-available/tlr
ln -sf /etc/nginx/sites-available/tlr /etc/nginx/sites-enabled/tlr
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl enable nginx && systemctl reload nginx

echo "==> 配置每日数据库备份（凌晨4点，保留30天）"
chmod +x "$APP_DIR/deploy/backup.sh"
cat > /etc/cron.d/tlr-backup <<EOF
0 4 * * * $APP_USER $APP_DIR/deploy/backup.sh >> /var/log/tlr-backup.log 2>&1
EOF

echo ""
echo "✅ 初始化完成。后续步骤："
echo "   1. nano $APP_DIR/server/.env 填入 DirectMail 的 ALIYUN_AK/SK，然后 systemctl restart tlr"
echo "   2. 备案前：浏览器访问 http://<服务器IP> 测试"
echo "   3. 备案通过后：apt install -y python3-certbot-nginx && certbot --nginx -d nextlaunch.cn（自动上 HTTPS）"
echo "   状态：systemctl status tlr · 日志：journalctl -u tlr -f"
