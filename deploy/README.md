# 阿里云国内服务器部署手册（maxchen.fun）

> 完整版部署：静态页 + 后端（登录/提醒）+ DirectMail 真实邮件。
> 关键路径是 ICP 备案（7-20 个工作日），其余都可以在备案等待期内完成。

## 你的准备清单（按顺序）

### 第 0 天，三件事并行启动

**① 购买轻量应用服务器**（阿里云控制台 → 轻量应用服务器）
- 地域：国内（杭州/上海等）；镜像：**Ubuntu 22.04**；规格：2核2G 起步
- **时长买 1 年**（备案要求服务器剩余时长 ≥3 个月）
- 买完记下：公网 IP、root 密码（或设置密钥）

**② 提交 ICP 备案**（阿里云控制台 → ICP 备案）
- 个人主体；关联刚买的服务器；域名 maxchen.fun
- 资料：身份证正反面、本人手机号
- 网站名称用**个人化、非经营性**的名字（如「麦琛的科技日历」），不要带行业/公司字样；服务内容选"个人空间/其他"
- 阿里云 APP 人脸核验后提交；管局电话回访时如实说"个人网站，展示科技活动日历"
- ⚠️ 备案通过前，域名**不能**解析到服务器；测试用 IP 访问（合规）

**③ 配置发信域名**（阿里云控制台 → 邮件推送 DirectMail，不受备案限制）
1. 发信域名 → 新建 `mail.maxchen.fun` → 按页面提示去"云解析 DNS"加 4 条记录（SPF/MX/CNAME/TXT）→ 回来点验证
2. 发信地址 → 新建 `noreply@mail.maxchen.fun`，类型选**触发邮件**
3. RAM 访问控制 → 创建子用户（勾选 OpenAPI 调用）→ 授权 `AliyunDirectMailFullAccess` → 记下 AccessKey ID / Secret

### 服务器初始化（买好服务器就能做）

```bash
# 1. SSH 登录服务器
ssh root@<服务器IP>

# 2. 一键初始化（安装 Bun/Caddy、拉代码、配 systemd 自启、备份 cron）
apt-get update && apt-get install -y git   # 新系统先装 git
git clone https://github.com/maxchen5216-beep/tech-launch-radar.git /opt/tlr
bash /opt/tlr/deploy/setup.sh

# 3. 填入 DirectMail 密钥
nano /opt/tlr/server/.env     # 填 ALIYUN_AK= 和 ALIYUN_SK= 两行
systemctl restart tlr

# 4. 验证
systemctl status tlr          # 应为 active (running)
curl http://127.0.0.1:8787/api/health   # mail_driver 应为 directmail
```

阿里云控制台 → 服务器防火墙：放行 **80、443**（22 默认已开，建议限制来源 IP）。

### 备案前测试（IP 模式，Caddyfile 默认就是）

浏览器打开 `http://<服务器IP>`：
- 用自己真实邮箱登录 → 应收到**真实验证码邮件**（QQ/163/Gmail 都测一遍）
- 订阅一个事件 → 服务器上模拟触发：
  ```bash
  INTERNAL_KEY=$(grep '^INTERNAL_KEY=' /opt/tlr/server/.env | cut -d= -f2-)
  curl -X POST "http://127.0.0.1:8787/internal/scan-reminders?today=<事件日期前3天>" -H "x-internal-key: $INTERNAL_KEY"
  ```
  → 应收到真实提醒邮件

### 备案通过后（上线日）

```bash
# 1. 云解析 DNS：maxchen.fun 添加 A 记录 → 服务器IP（www 可加 CNAME → maxchen.fun）
# 2. 切换 Caddy 到域名模式：
nano /etc/caddy/Caddyfile     # 注释 :80 块，取消 maxchen.fun 块的注释
systemctl reload caddy        # 自动申请 HTTPS 证书，约1分钟
# 3. 浏览器验证 https://maxchen.fun
```

- 30 天内做**公安备案**：beian.mps.gov.cn
- 把 ICP 备案号告诉 Claude，填入页脚（index.html 里已留占位）

## 日常运维

| 操作 | 命令 |
|---|---|
| 看服务状态 | `systemctl status tlr` |
| 看实时日志 | `journalctl -u tlr -f` |
| 重启服务 | `systemctl restart tlr` |
| 更新数据/代码 | 本地 push 后，服务器跑 `/opt/tlr/deploy/update-data.sh` |
| 手动备份 | `/opt/tlr/deploy/backup.sh`（每天凌晨4点自动跑，保留30天） |
| 恢复备份 | `gunzip -k 备份文件.gz`，停服后替换 `server/.data/app.db` |

## 费用

服务器约 ¥30-60/月（年付有优惠档）· 域名续费约 ¥30/年 · 邮件 200封/天内免费 · HTTPS 证书免费
