# 阿里云国内服务器部署手册（nextlaunch.cn · 121.40.54.69）

> 完整版部署：静态页 + 后端（登录/提醒）+ DirectMail 真实邮件。
> **国内服务器访问不了 GitHub**，所以代码从本地 Mac 用 rsync 直推；Bun 走 npmmirror 国内镜像；反代用 nginx（Ubuntu 官方源）。

## 部署流程

### 第 1 步：上传代码（在本地 Mac 终端执行）

```bash
cd /Users/maxchen/Desktop/fahui/00006
rsync -avz --exclude .git --exclude .gstack --exclude .claude \
  --exclude server/node_modules --exclude server/.data \
  ./ root@121.40.54.69:/opt/tlr/
```

（输入服务器 root 密码；以后每次更新代码/数据都用 `bash deploy/push-update.sh` 一键完成）

### 第 2 步：初始化服务器（SSH 到服务器执行）

```bash
ssh root@121.40.54.69
bash /opt/tlr/deploy/setup.sh
```

约 3-5 分钟：装 Bun（npmmirror）、nginx、systemd 自启、每日备份。

### 第 3 步：填 DirectMail 密钥（服务器上）

```bash
nano /opt/tlr/server/.env     # 填 ALIYUN_AK= 和 ALIYUN_SK=
systemctl restart tlr
curl -s http://127.0.0.1:8787/api/health   # 应输出 mail_driver":"directmail","events":49
```

### 第 4 步：备案前测试（SSH 隧道）

> ⚠️ 实测：阿里云对未备案实例**拦截全部 80/443 公网访问（包括 IP 直访）**，备案通过前外部无法打开网站。
> 测试用 SSH 隧道绕过（流量走 22 端口，仅自己可见，合规）：

```bash
# 在本地 Mac 终端执行（保持窗口开着）：
ssh -L 8080:127.0.0.1:80 root@121.40.54.69
# 然后浏览器访问 http://localhost:8080
```

- 真实邮箱登录 → 应收到验证码邮件（QQ/163/Gmail 都测；垃圾箱也看）
- 订阅事件 → 服务器上模拟触发提醒：
  ```bash
  bash /opt/tlr/deploy/update-data.sh   # 触发事件同步
  INTERNAL_KEY=$(grep '^INTERNAL_KEY=' /opt/tlr/server/.env | cut -d= -f2-)
  curl -X POST "http://127.0.0.1:8787/internal/scan-reminders?today=<事件日期前N天>" -H "x-internal-key: $INTERNAL_KEY"
  ```

### 第 5 步：备案通过后（上线日）

```bash
# 1. 云解析 DNS：nextlaunch.cn 加 A 记录 → 121.40.54.69（www 加 CNAME → nextlaunch.cn）
# 2. 服务器上配 HTTPS（certbot 自动申请并续期 Let's Encrypt 证书）：
apt-get install -y python3-certbot-nginx
certbot --nginx -d nextlaunch.cn -d www.nextlaunch.cn
# 3. 浏览器验证 https://nextlaunch.cn
```

- 30 天内做**公安备案**：beian.mps.gov.cn
- 把 ICP 备案号告诉 Claude，填入页脚（index.html 已留占位）

## 日常运维

| 操作 | 在哪执行 | 命令 |
|---|---|---|
| **更新代码/数据** | 本地 Mac | `bash deploy/push-update.sh`（rsync + 重启 + 触发同步）|
| 看服务状态 | 服务器 | `systemctl status tlr` |
| 看实时日志 | 服务器 | `journalctl -u tlr -f` |
| 重启服务 | 服务器 | `systemctl restart tlr` |
| 手动触发事件同步 | 服务器 | `bash /opt/tlr/deploy/update-data.sh` |
| 手动备份 | 服务器 | `bash /opt/tlr/deploy/backup.sh`（每日 4 点自动，留 30 天）|
| 恢复备份 | 服务器 | `gunzip -k 备份.gz`，停服后替换 `server/.data/app.db` |

## 费用

服务器约 ¥99/年（e实例）· 域名续费约 ¥30/年 · 邮件 200封/天内免费 · HTTPS 证书免费

## 你的准备清单（资质类，与部署并行）

- **ICP 备案**（关键路径 7-20 工作日）：个人主体、网站名称用个人化名字（如「麦琛的科技日历」）、人脸核验、注意 24h 内回工信部短信；备案通过前域名不能解析到服务器（`mail.` 子域的邮件 DNS 记录不受影响）
- **公安备案**：上线后 30 天内
- **DirectMail**：发信域名 `mail.nextlaunch.cn` 验证 ✅（已完成）→ 发信地址 `noreply@` → RAM 子账号 AccessKey
