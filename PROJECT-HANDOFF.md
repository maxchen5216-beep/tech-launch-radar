# 项目交接文档 ·「下一场发布会 / THE NEXT LAUNCH」

> 本文档面向接手本项目的 AI 助手（Claude）或开发者，浓缩了项目从 0 到当前状态的全部关键信息：产品定义、架构、决策原因、部署、运维、踩过的坑、当前卡点。
> 最后更新：2026-06-07

---

## 1. 项目是什么

**中英双语的科技发布会日历网站 + 微信小程序**：聚合未来 12 个月的科技圈重大发布会（时间、概要、官方信息源链接），支持邮箱/微信登录、发布会提醒（邮件/微信订阅消息）、评论（敏感词过滤）。

- 品牌名：**「下一场发布会 / THE NEXT LAUNCH」**（曾用名「科技圈发布会雷达 / Tech Launch Radar」，2026-06-06 改名以呼应域名）
- 域名：**fabushike.com**（阿里云购买，曾短暂用 maxchen.fun 后弃用）
- 运营定位：**面向中国大陆用户、公开运营、企业主体（公司）**（这决定了大量合规设计，见 §8）

### 「科技圈」范围定义（用户确认）
| category | 内容 |
|---|---|
| `consumer` | Apple/三星/华为/小米/Google 等硬件发布会 |
| `ai_dev` | WWDC、OpenAI DevDay、GTC、re:Invent、云栖大会等 |
| `expo` | CES、MWC、IFA、WAIC、进博会、Web Summit 等 |
| `gaming_auto` | TGA、Gamescom、TGS、Direct、State of Play、特斯拉、蔚小理等 |
| `frontier` | 智能穿戴、VR/AR、机器人、无人机、商业航天等 |

---

## 2. 技术架构总览

```
┌── 网页前端（纯静态，零框架）────────────────┐
│ index.html（内嵌全部渲染逻辑/CSS/i18n）      │
│ assets/auth.js      邮箱验证码登录+资料弹窗   │
│ assets/reminders.js 提醒订阅按钮+抽屉        │
│ assets/comments.js  评论区                   │
│ data/events-data.js 事件数据（window.EVENTS_DATA，AI 定期重写）│
│ privacy.html        隐私政策                  │
└──────────────┬──────────────────────────────┘
               │ fetch + JWT（同源 /api/*）
┌── 共享后端 server/（Bun + Hono + SQLite）────┐
│ src/index.ts        入口/静态托管/CORS/cron/生产fail-fast │
│ src/auth.ts         邮箱验证码/JWT/资料/头像上传          │
│ src/wx.ts           微信登录/access_token/msgSecCheck/订阅消息 │
│ src/subscriptions.ts 订阅 CRUD（含 wx_credit）            │
│ src/comments.ts     评论（敏感词+微信内容安全+限频）       │
│ src/sensitive.ts    敏感词引擎（归一化匹配防绕过）          │
│ src/sync-events.ts  事件落库+官宣检测+孤儿清理             │
│ src/scan-reminders.ts 提醒扫描+分流送达（邮件/订阅消息）    │
│ src/mail.ts         邮件抽象（mock/directmail/resend）     │
│ src/ratelimit.ts    固定窗口限频                           │
│ src/db.ts           SQLite 初始化+轻量迁移                 │
│ data/sensitive-words.json 敏感词库（67条，6类，用户确认）   │
└──────────────┬──────────────────────────────┘
┌── 微信小程序 miniprogram/（原生 WXML，独立文件夹）─┐
│ pages: index(时间线)/detail(详情+评论+订阅)/        │
│        reminders(我的提醒)/profile(登录+资料)       │
│ config.js: API_BASE + 订阅消息模板ID（上线前改）     │
└─────────────────────────────────────────────┘
deploy/   阿里云部署物（setup.sh/nginx/systemd/备份/push-update）
assets/icons/  小程序图标候选 6 款（288×288 PNG，用户未定稿）
```

**核心数据流**：AI 定期联网校验官方信息 → 重写 `data/events-data.js` → 网页直接读取渲染；后端 `sync-events` 解析该文件落库（官宣检测 expected/rumored→confirmed、清理已移除事件的评论/订阅）→ `scan-reminders` 每日按 `date_sort - lead_days == today` 触发提醒。

### 事件数据 schema（data/events-data.js）
```
id(稳定kebab-case) name_zh/en organizer category
date_display_zh/en date_sort(YYYY-MM-DD,排序/触发用) date_end(可选,多日活动)
status: confirmed(官方确认)|expected(历史规律推断)|rumored(媒体泄露)
summary_zh/en official_url(权威信息源) live_url(可选,官方直播)
source_note_zh(校验说明) verified(是否与官方核对)
```
更新规则详见 `UPDATE-INSTRUCTIONS.md`（复核未定档条目→校验confirmed→清过期→补新→更新时间戳→调 `/internal/sync-events`）。**对我说"更新发布会数据"即按此执行**。

---

## 3. 关键决策史（为什么是现在这样）

1. **登录方式**：原计划手机号+短信 → 因大陆公开运营的短信签名需企业资质/备案归属（个人很难过审）→ **改邮箱+验证码**（网页）；小程序用**微信一键登录**（openid）
2. **提醒通道**：网页用户=邮件（阿里云 DirectMail，¥0.002/封，免费200封/天）；小程序用户=**微信订阅消息**（一次性授权模式）
3. **邮件曾长期 mock**：开发期 `MAIL_DRIVER=mock` 验证码回显前端；生产已切 directmail。**mock 模式绝不能公网开放**（回显=无鉴权）
4. **部署演进**：本地 → GitHub Pages 纯浏览版（保留，登录/提醒/评论入口自动隐藏）→ 阿里云国内服务器完整版（用户要求国内访问快）
5. **小程序架构**（2026-06-07）：原生重写（非web-view）+ 个人主体 + **共享网页版后端**（数据互通）；前端独立放 `miniprogram/`，**网页前端代码零改动**（用户明确要求）
6. **品牌/文案**：主标题「下一场发布会」、小标题「科技前沿 · 一手掌握」（用户自拟）、英文 THE NEXT LAUNCH

---

## 4. 部署与基础设施

| 项 | 值 |
|---|---|
| 生产服务器 | 阿里云 ECS 经济型e（2C2G，Ubuntu 24.04，杭州）**121.40.54.69** |
| 域名 | fabushike.com（**ICP 备案进行中**，企业主体；nextlaunch.cn(个人备案)拟撤换） |
| GitHub | `maxchen5216-beep/tech-launch-radar`（公开）；Pages 纯浏览版：maxchen5216-beep.github.io/tech-launch-radar |
| 进程管理 | systemd `tlr.service`（开机自启/崩溃重启/TZ=Asia/Shanghai/资源限制） |
| 反代 | nginx（80端口；`/internal/* deny`；XFF 覆盖防伪造；2m 上传上限）。备案后 `certbot --nginx -d fabushike.com` 上 HTTPS |
| 邮件 | DirectMail 发信域名 `mail.nextlaunch.cn` 已验证（DKIM/SPF/DMARC/MX 四条DNS已配），发信地址 `noreply@mail.nextlaunch.cn`，RAM 子账号 AK/SK 已配在服务器 .env |
| 备份 | 每日 4 点 SQLite `.backup` + 头像 tar，保留 30 天（/opt/tlr/backups） |
| SSH | 本机已配免密（`~/.ssh/id_ed25519` → root@121.40.54.69），**Claude 可直接远程操作服务器** |

### ⚠️ 国内服务器三大特殊性（踩坑实录）
1. **服务器访问不了 GitHub**（GnuTLS 错误）→ 代码部署用 **`bash deploy/push-update.sh`**（本地 rsync 直推 + 重启 + 触发同步），不走 git pull；Bun 经 npmmirror 装（`npm i -g bun --registry=https://registry.npmmirror.com`）
2. **未备案实例被阿里云拦截全部 80/443 公网访问（连 IP 直访都拦）**→ 备案前测试用 SSH 隧道：`ssh -L 8080:127.0.0.1:80 root@121.40.54.69` 后访问 localhost:8080
3. nginx/systemd 配置改动 push-update **不会**自动应用，需手动 `cp /opt/tlr/deploy/{nginx-tlr.conf,tlr.service} ...` + reload

### 服务器关键路径与 .env
- 代码：`/opt/tlr`；数据库：`/opt/tlr/server/.data/app.db`；`.env`：`/opt/tlr/server/.env`（600 权限）
- `.env` 键：`MAIL_DRIVER=directmail ALIYUN_AK/SK MAIL_FROM JWT_SECRET INTERNAL_KEY REMINDER_DAILY_CAP CORS_ORIGINS ADMIN_EMAILS(空,待填) ADMIN_OPENIDS WX_APPID/WX_SECRET/WX_TEMPLATE_ID(空,待小程序注册)`
- 生产 fail-fast：`MAIL_DRIVER!=mock` 时缺 `JWT_SECRET` 或 `INTERNAL_KEY` 为默认值 → 拒绝启动

### 常用运维命令
```bash
# 本地更新代码/数据到服务器（唯一部署方式）
bash deploy/push-update.sh
# 服务器上
systemctl status tlr · journalctl -u tlr -f · systemctl restart tlr
bash /opt/tlr/deploy/update-data.sh           # 手动触发事件同步
curl -s localhost:8787/api/health             # {ok,mail_driver,events}
# 调试用内部接口（需 .env 里的 INTERNAL_KEY）
curl -X POST 'localhost:8787/internal/scan-reminders?today=YYYY-MM-DD' -H "x-internal-key: $KEY"
```

---

## 5. 数据模型（SQLite，WAL，外键开启）

```
users(id, email UNIQUE可空, openid 部分唯一索引可空, nickname, avatar, created_at, last_login_at)
  -- 网页用户有email、小程序用户有openid；avatar: 'p:N'=8款emoji预设 | 'u:文件名'=上传(.data/avatars/)
auth_codes(email, code_hash哈希存储, expires_at 5分钟, attempts ≤5)
events(id PK, name_zh/en, date_sort, status, prev_status, prev_date_sort, official_url, updated_at)
  -- prev_* 用于官宣检测；注意 date_end/live_url 不落库（仅前端/API 直读数据文件）
subscriptions(user_id, event_id, mode, lead_days, status active|fired, wx_credit, UNIQUE(user_id,event_id))
  -- mode: before_event(confirmed,提前1/3/7天) | on_announce(expected/rumored,官宣时通知)
  -- wx_credit: 微信一次性订阅消息剩余额度（requestSubscribeMessage 授权一次=1）
comments(event_id, user_id, content ≤200字, created_at)
email_log(email列存邮箱或openid, type code|reminder|announce, event_id, meta, status mock|sent|failed)
  -- 幂等去重键 (recipient,type,event_id,meta)；meta="lead_days:date_sort" 故改期会重新提醒
rate_limit(bucket_key, count, window_end) · meta(key,value: jwt_secret/last_sync_date等)
```
迁移机制：启动时跑 `migrations/001_init.sql`（IF NOT EXISTS）+ `db.ts` 内轻量列迁移（含 email NOT NULL→可空的重建表迁移，已测安全保数据）。

---

## 6. API 一览（Hono，/api/*）

```
公开: GET /api/health · GET /api/events(完整字段,5分钟缓存) · GET /api/comments/counts · GET /api/comments/:eventId
邮箱认证: POST /api/auth/send-code(限频:邮箱60s/1h5/24h10,IP1h10) · POST /api/auth/verify → JWT(HS256,60天)
微信认证: POST /api/wx/login {code} → openid → JWT（未配WX_APPID时503）
资料(JWT): GET/POST /api/auth/me · POST /api/auth/me/avatar(multipart,1MB,magic bytes校验,限频10/h)
        · DELETE /api/auth/account(级联删评论/订阅/头像文件)
订阅(JWT): GET/POST /api/subscriptions(POST可带wx_authorized置额度) · DELETE /api/subscriptions/:eventId
评论(JWT): POST /api/comments(敏感词+小程序用户叠加msgSecCheck+限频1/分5/天) · DELETE /api/comments/:id(本人或管理员)
内部(x-internal-key): POST /internal/sync-events · POST /internal/scan-reminders?today=
静态: / /privacy.html /data/* /assets/* /avatars/*(nosniff)
```
**JWT 注意**：hono 4.12 的 `verify(token, secret, "HS256")` 第三参必填（曾因缺它全员 401）。

---

## 7. 安全与合规要点（公开运营+个人主体）

- **敏感词**：`server/data/sensitive-words.json` 67条6类（辱骂/色情/赌诈/违法/政治有害/广告引流，用户逐类确认过）；匹配前归一化（去空格标点转小写），"傻 逼/TMD"等变体可拦；命中→阻止发布并提示具体词
- **小程序 UGC**：微信强制要求叠加官方 `msgSecCheck`（已实现，openid 用户路径）
- **限频/成本闸**：验证码/评论/上传/提醒全覆盖；提醒全局日上限 `REMINDER_DAILY_CAP=180`（对齐 DirectMail 免费额度）+ 单用户日5条
- **隐私合规（PIPL）**：privacy.html + 登录同意链接 + 注销账号入口（网页在编辑资料弹窗、小程序在 profile 页）
- **页脚占位**：ICP 备案号 + 公安备案号（`index.html` 中 hidden，备案通过后填号去 hidden）
- **曾做过三路全项目审查**（安全/质量/合规）并修复全部高危项：CORS白名单、上传magic bytes+nosniff、/internal nginx拦截、生产默认密钥fail-fast、时区统一(localDayStartISO)、XFF伪造、注销外键500、前端脚本加载顺序等

---

## 8. 当前状态与卡点（接手必读）

### ✅ 已完成上线
- GitHub Pages 纯浏览版（线上正常）
- 阿里云完整版部署完毕：服务 active、DirectMail 真实邮件已通（曾有 EnvId 字段误判 bug 已修）、评论/头像/订阅全功能
- 微信小程序代码完成（前端 miniprogram/ + 后端 wx 支持），**已推 GitHub**

### ⏳ 卡点/待办（按优先级）
1. **ICP 备案审核中**（个人主体，fabushike.com）——唯一长等待。通过后执行：DNS A记录→服务器IP；`certbot --nginx -d fabushike.com`；页脚填备案号；30天内公安备案。**备案前公网无法访问（阿里云拦截），测试走 SSH 隧道**
2. **小程序后端改动未部署到服务器**（涉及生产库 users 表重建迁移，已测安全，等用户确认后 `bash deploy/push-update.sh`）
3. **用户需注册微信小程序**（个人主体）拿 AppID/AppSecret → 填 `miniprogram/project.config.json` + `miniprogram/config.js` + 服务器 .env 的 WX_*；申请订阅消息模板拿 template_id（模板字段需与 `scan-reminders.ts` 的 data keys 对齐）
4. **ADMIN_EMAILS 未配置**（服务器 .env 空）——配置前没人能删违规评论。等用户提供其登录邮箱
5. **DirectMail 修复后的真实邮件登录未经用户最终确认**（修复已部署但用户没回测）
6. 小程序图标 6 款候选在 `assets/icons/`（3款纯图形+3款带字），用户未定稿
7. 低优遗留：英文模式「校验说明」仍显示中文（source_note 无英文字段）

### 测试方式速查
- 本地：`cd server && bun run dev` → localhost:8787（mock 模式，验证码回显）
- 生产（备案前）：`ssh -L 8080:127.0.0.1:80 root@121.40.54.69` → http://localhost:8080
- 小程序：微信开发者工具导入 `miniprogram/`，开「不校验合法域名」，API_BASE 指向 http://121.40.54.69

---

## 9. 历史踩坑备忘（防止重蹈）

1. 阿里云未备案实例**拦截全部 80/443（含 IP 直访）**——别再尝试"IP 先上线"
2. 国内服务器 git clone GitHub 必败——一切部署走 rsync（push-update.sh）
3. DirectMail SingleSendMail 成功响应字段是 **EnvId**（非 EnvelopeId）；判断失败看 `json.Code`
4. hono/jwt `verify` 必须传第三参 `"HS256"`
5. SQLite：ALTER 不能去 NOT NULL（须重建表）、ON CONFLICT 配部分唯一索引有歧义（用显式 select-then-insert）、加列不能带 UNIQUE（用部分索引）
6. `created_at` 是 UTC ISO，与本地日期比较必须用 `localDayStartISO()`（时区差8小时曾致限额绕过）
7. 网页前端三个模块 JS 必须在主内联脚本**之前**加载（钩子链时序）
8. 自动化流程重写 `data/events-data.js` 时保持 `window.EVENTS_DATA = {纯JSON};` 结构（后端用正则+JSON.parse 解析），并保留 date_end/live_url 字段
9. mock 模式验证码回显给前端——公网部署前必须确认 MAIL_DRIVER 非 mock
