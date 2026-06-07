# 科技圈发布会雷达 · Tech Launch Radar

中英双语的未来科技发布会日历，支持邮箱验证码登录、发布会提醒订阅、评论互动。所有事件条目与官方信息源交叉校验；未定档活动按历史规律标注模糊时间，点击「官方信息源」跳转权威页面。

> 邮件驱动由环境变量 `MAIL_DRIVER` 决定：**生产环境用阿里云 DirectMail 真实发送**；**本地默认 mock**（验证码直接回显在登录框、提醒只记录到 `email_log` 不真实发送）。前端按 `/api/health` 的 `mail_driver` 字段自动调整文案。

## 「科技圈」定义

| 类别 | category | 内容 |
|---|---|---|
| 消费电子 | `consumer` | Apple、三星、华为、小米、Google 等硬件发布会 |
| AI · 开发者 | `ai_dev` | WWDC、OpenAI DevDay、GTC、re:Invent、云栖大会等 |
| 行业展会 | `expo` | CES、MWC、IFA、WAIC、进博会、Web Summit 等 |
| 游戏 · 智能汽车 | `gaming_auto` | TGA、Gamescom、TGS、Direct、特斯拉、蔚小理等 |
| 前沿科技 | `frontier` | 智能穿戴、VR/AR、机器人、无人机、商业航天等 |

## 文件结构

```
index.html              # 页面（纯静态，含时间线/筛选/双语/倒计时/直播按钮）
privacy.html            # 隐私政策
data/events-data.js     # 全部事件数据 + 更新时间戳（自动更新只重写此文件）
assets/auth.js          # 邮箱验证码登录/注册 + 资料（昵称/头像）
assets/reminders.js     # 提醒订阅（提醒按钮 / 我的提醒抽屉）
assets/comments.js      # 评论区（展开列表 / 发布 / 删除）
server/                 # 后端（Bun + Hono + SQLite）
  src/index.ts          #   入口：API + 静态托管 + 每日 cron + 生产密钥 fail-fast
  src/auth.ts           #   验证码/JWT/防刷、用户资料、头像上传（magic bytes 校验）
  src/subscriptions.ts  #   订阅 CRUD
  src/comments.ts       #   评论 CRUD（敏感词拦截 + 限频 + 管理员删除）
  src/sensitive.ts      #   敏感词引擎（归一化匹配，防空格/标点绕过）
  src/sync-events.ts    #   事件落库 + 官宣检测（expected/rumored → confirmed）
  src/scan-reminders.ts #   提醒扫描（幂等去重 + 日上限熔断）
  src/mail.ts           #   邮件抽象层（mock / directmail / resend）
  src/ratelimit.ts      #   固定窗口限频
  data/sensitive-words.json   # 敏感词库（可直接编辑，重启生效）
  migrations/001_init.sql
  .env.example
deploy/                 # 阿里云国内服务器部署（见 deploy/README.md）
UPDATE-INSTRUCTIONS.md  # 事件数据定时更新的执行指令
```

## 运行（本地开发）

```bash
cd server
bun install        # 首次
bun run dev        # 启动 http://localhost:8787（同源托管前端 + API，默认 mock 邮件）
```

打开 http://localhost:8787。也可直接双击 `index.html`（file:// 模式自动指向 localhost:8787 的 API；服务未启动时仅浏览功能可用，登录/提醒/评论入口自动隐藏）。

## 功能

- **浏览**：分类/状态筛选、搜索、按月时间线、下一场倒计时、进行中活动「观看直播」、中英切换
- **登录/注册**（合一）：邮箱 + 6位验证码（无密码）。新用户验证后引导设置用户名 + 头像（8 个卡通预设 / 自行上传 ≤1MB）。防刷：同邮箱 60s/1、1h/5、24h/10 条；同 IP 1h/10；验证码只存哈希、5 分钟有效、错 5 次作废
- **提醒订阅**：confirmed 事件「🔔 提醒我」开始前 1/3/7 天；expected/rumored 事件「📌 关注官宣」日期官宣时通知。事件改期后按新日期重新提醒。成本闸：全局日上限（`REMINDER_DAILY_CAP`，生产 180）+ 单用户每日 5 条
- **评论**：登录可评、≤200 字、可删自己的（管理员 `ADMIN_EMAILS` 可删任何）。敏感词命中时阻止发布并提示具体词条（词库 `server/data/sensitive-words.json`，归一化匹配防绕过）
- **合规**：隐私政策页、账号注销（删除邮箱/资料/订阅/评论）、ICP/公安备案号页脚占位

## 邮件驱动切换

`MAIL_DRIVER=directmail` + 阿里云 `ALIYUN_AK`/`ALIYUN_SK`/`MAIL_FROM`（生产，部署脚本默认）；
`MAIL_DRIVER=resend` + `RESEND_API_KEY`（海外备选）；
`MAIL_DRIVER=mock`（本地，验证码回显、不真实发送）。三者业务代码一致，仅切环境变量。

## 数据更新

按 `UPDATE-INSTRUCTIONS.md` 执行：复核 expected/rumored 是否已官宣 → 校验 confirmed → 清理过期 → 补充新事件 → 更新时间戳 → 触发 `POST /internal/sync-events` 同步落库与官宣检测。国内服务器用本地 `bash deploy/push-update.sh` 一键直推（不走 GitHub）。

## 部署

- **纯浏览版**：GitHub Pages（仅静态，登录/提醒/评论入口自动隐藏）
- **完整版**：阿里云国内服务器（nginx + systemd + DirectMail），见 `deploy/README.md`。生产环境 `INTERNAL_KEY`/`JWT_SECRET` 缺失或为默认值时服务拒绝启动（fail-fast）。
