# 科技圈发布会雷达 · Tech Launch Radar

中英双语的未来科技发布会日历，支持邮箱验证码登录与发布会提醒订阅。所有事件条目与官方信息源交叉校验；未定档活动按历史规律标注模糊时间，点击「官方信息源」跳转权威页面。

> ⚠️ **邮件推送功能尚未上线**：当前为 mock 驱动——登录验证码在开发模式下直接回显，提醒/官宣通知只记录到数据库 `email_log` 表，不会真实发送邮件。上线方式见下文「上线邮件推送」。

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
index.html              # 页面（纯静态，含时间线/筛选/双语/倒计时）
data/events-data.js     # 全部事件数据 + 更新时间戳（自动更新只重写此文件）
assets/auth.js          # 邮箱验证码登录模块
assets/reminders.js     # 提醒订阅模块（提醒按钮 / 我的提醒抽屉）
server/                 # 后端（Bun + Hono + SQLite）
  src/index.ts          #   入口：API + 静态托管 + 每日 cron
  src/auth.ts           #   验证码发送/校验、JWT、防刷限频
  src/subscriptions.ts  #   订阅 CRUD
  src/sync-events.ts    #   事件落库 + 官宣检测（expected/rumored → confirmed）
  src/scan-reminders.ts #   提醒扫描（幂等去重 + 日上限熔断）
  src/mail.ts           #   邮件抽象层（当前 mock，不真实发送）
  migrations/001_init.sql
  .env.example
UPDATE-INSTRUCTIONS.md  # 事件数据定时更新的执行指令
```

## 运行

```bash
cd server
bun install        # 首次
bun run dev        # 启动 http://localhost:8787（同源托管前端 + API）
```

打开 http://localhost:8787 即可。也可直接双击 `index.html`（file:// 模式下前端自动指向 localhost:8787 的 API；服务未启动时仅浏览功能可用，登录/提醒静默降级）。

## 功能

- **浏览**：分类/状态筛选、搜索、按月时间线、下一场倒计时、中英切换
- **登录**：邮箱 + 6位验证码（无密码）。防刷：同邮箱 60s/1、1h/5、24h/10 条；同 IP 1h/10；验证码只存哈希、5 分钟有效、错 5 次作废
- **提醒订阅**（登录后）：
  - 🟢 confirmed 事件 → 「🔔 提醒我」：开始前 1/3/7 天提醒
  - 🟡🔴 expected/rumored 事件 → 「📌 关注官宣」：日期官宣时通知（由事件同步流程自动检测 status 升级）
  - 事件改期后按新日期重新提醒（幂等键含日期）
- **成本闸**：全局每日提醒上限（默认 500，`REMINDER_DAILY_CAP`）+ 单用户每日 5 条上限

## 上线邮件推送（当前未启用）

1. 准备一个自有域名并在邮件服务商完成发信域名验证（SPF/DKIM）：
   - 国内用户送达率优先：阿里云邮件推送 DirectMail（¥0.002/封）
   - 接入最简单：Resend（3000 封/月免费）
2. 在 `server/src/mail.ts` 补全对应驱动实现（已留 TODO 桩）
3. 设置环境变量 `MAIL_DRIVER=resend`（或 `directmail`）+ 对应密钥
4. 验证码不再回显（`dev_code` 仅 mock 模式返回），改为真实邮件送达

## 数据更新

按 `UPDATE-INSTRUCTIONS.md` 执行：复核 expected/rumored 条目是否已官宣 → 校验 confirmed 条目 → 清理过期 → 补充新事件 → 更新时间戳 → **调用 `POST /internal/sync-events`（带 `x-internal-key`）触发官宣检测**。

## 部署到线上（计划）

前端静态部分可托管 GitHub Pages / Cloudflare Pages；后端为 Hono 应用，可平移至 Cloudflare Workers（D1）或国内云函数。生产环境务必修改 `INTERNAL_KEY` 与 `JWT_SECRET`。
