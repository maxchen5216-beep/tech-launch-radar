# 数据自动更新指令（供定时任务 / Claude 执行）

目标文件：`data/events-data.js`（页面 `index.html` 只读取该文件，不要改动页面代码）

## 「科技圈」范围定义
消费电子发布会（Apple/三星/华为/小米/Google 等）、AI 与开发者大会（WWDC/Build/DevDay/GTC/re:Invent/云栖等）、
行业大型展会（CES/MWC/IFA/WAIC/进博会等）、游戏与智能汽车（TGA/Gamescom/TGS/Direct/State of Play/特斯拉/蔚小理等）、
新兴前沿科技（智能穿戴、VR/AR/XR、机器人、无人机、商业航天等）。

## 每次更新执行以下步骤

1. **逐条复核现有条目**：对 `data/events-data.js` 中每个 `status` 为 `expected` / `rumored` 的条目，
   联网搜索官方是否已公布确切日期；如已官宣，升级为 `confirmed`、更新日期、`verified: true`，
   并在 `source_note_zh` 中注明官宣来源与核对日期。
2. **校验 confirmed 条目**：抽查官方信息源链接是否仍有效、日期是否有变（活动改期/取消时更新并注明）。
3. **移除已结束的活动**：`date_sort` 已过去超过 30 天的条目可以删除（页面对已过期条目会自动置灰，30 天内保留供回顾）。
4. **补充新事件**：搜索上述五个类别中新官宣或新传闻的发布会，按下方 schema 添加，时间窗口为未来 12 个月。
5. **信息校验要求（核心）**：
   - 每个条目必须与官方信息源（官网活动页、官方新闻稿、官方社交账号）交叉比对后才能写入；
   - `official_url` 必须指向权威页面（优先官方活动页/新闻稿；rumored 条目指向主办方官网/新闻室）；
   - 官方未定档的写模糊时间（如「预计2026年9月上旬」），status 用 `expected`（历史规律推断）或 `rumored`（媒体泄露）；
   - 不同信息源日期冲突时，降级为模糊时间并在 `source_note_zh` 中说明冲突。
6. **更新元数据**：把 `updated` 改为当天日期（YYYY-MM-DD），同步更新 `updated_note_zh` / `updated_note_en`。
7. **完整性检查**：用 `node -e "require('/path/to/check')"` 或直接 `node --check` 不适用于该文件（它是浏览器脚本），
   改用：`node -e "global.window={};require('<绝对路径>/data/events-data.js');console.log(window.EVENTS_DATA.events.length)"`
   验证语法正确且事件数量合理（≥ 30）。

8. **触发提醒系统同步**：数据重写完成后，如本地后端在运行，调用：
   `curl -s -X POST http://localhost:8787/internal/sync-events -H "x-internal-key: dev-internal-key"`
   这会把最新事件落库，并：
   - 检测 expected/rumored → confirmed 的官宣升级，为「关注官宣」订阅者发送通知；
   - **自动清理孤儿**：若本次从 data 文件移除了某事件，会连带删除该事件在数据库中的
     评论、订阅与事件行（用户的「我的提醒」里不会再残留已删除事件）。
   返回 JSON 含 `removed` 数组，列出被清理的 event_id。

## 条目 schema

```js
{
  "id": "kebab-case-id",
  "name_en": "Event Name",
  "name_zh": "中文名称",
  "organizer": "主办方",
  "category": "consumer | ai_dev | expo | gaming_auto | frontier",
  "date_display_en": "September 9, 2026 / Expected early September 2026",
  "date_display_zh": "2026年9月9日 / 预计2026年9月上旬",
  "date_sort": "YYYY-MM-DD",        // 模糊时间用估计的代表日期，仅用于排序
  "status": "confirmed | expected | rumored",
  "summary_en": "1-2 sentence summary",
  "summary_zh": "1-2句中文概要",
  "official_url": "https://...",    // 权威信息源，可点击跳转
  "source_note_zh": "信息来源与校验说明",
  "verified": true | false,         // 是否与官方信息源直接核对过
  "date_end": "YYYY-MM-DD",         // 可选：多日活动的结束日期（用于"进行中"判定与直播按钮显示）
  "live_url": "https://..."         // 可选：官方直播地址（仅官方确有直播的活动；活动进行中时页面显示"观看直播"按钮）
}
```

注意：更新条目时**保留已有的 `date_end` 与 `live_url` 字段**；新增已官宣的多日活动请补 `date_end`；
确认有官方直播的活动（厂商 Keynote、游戏直面会等）补 `live_url`（优先官方活动页/官方 YouTube 频道）。
