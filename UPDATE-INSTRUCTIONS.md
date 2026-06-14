# 数据自动更新指令（供定时任务 / Claude 执行）

目标文件：`data/events-data.js`（页面 `index.html` 只读取该文件，不要改动页面代码）

## 「科技圈」范围定义 + 6 大分类与归类规则

**内容边界（含上新）**：不仅收录发布会/大会，也收录科技圈一切重要"上新时刻"——有发布会的产品/活动按下表归类；无发布会、近一月静默上市的产品进「悄悄新品」。

**6 大领域分类（category，互斥单标签，问题1采用独立feed逻辑）**：

| category | 名称 | 涵盖 |
|---|---|---|
| `consumer` | 消费电子 | 手机/耳机/手表/影像相机/TV/PC笔电/智能家居/消费芯片(骁龙/苹果A) |
| `ai_software` | AI · 软件 | AI 大模型与产品(GPT/Claude/Gemini/通义/豆包)、操作系统(鸿蒙/iOS/安卓/Win)、开发者大会(WWDC/IO/Build/DevDay/GTC/re:Invent/云栖) |
| `expo` | 行业展会 | 跨界大展(CES/MWC/IFA/WAIC/进博会/Web Summit) |
| `gaming` | 游戏 | 游戏/主机/直面会(TGA/Gamescom/TGS/ChinaJoy/Nintendo Direct/State of Play/GDC) |
| `auto` | 智能汽车 | 新车/车展/自动驾驶(特斯拉/蔚小理/广州车展) |
| `frontier` | 前沿科技 | 机器人/具身智能/VR-AR/无人机/商业航天/智能穿戴/AI硬科技芯片(NVIDIA数据中心) |

**归类规则（处理跨域/歧义，人工与 Qwen 都照此）**：
- 厂商发布会**按主导品类**归：华为发手机为主→consumer，纯鸿蒙→ai_software
- **开发者大会/系统/软件**（含苹果 WWDC）→ ai_software；**硬件首发**（苹果秋季 iPhone）→ consumer
- **同厂不同活动分开**：特斯拉新车→auto，特斯拉 Optimus 机器人→frontier
- **芯片**：消费芯片→consumer，AI/数据中心芯片→frontier 或 ai_software，跟产品语境走
- **跨界大展**（什么都有）统一进 expo，不拆到各领域

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
  "category": "consumer | ai_software | expo | gaming | auto | frontier | quiet_launch",
  // recap（可选）：往期总结的长文回顾；有此字段的事件会移入「往期总结」栏目、永久保留
  "recap": "多段回顾文字，段落用空行分隔",
  "date_display_en": "September 9, 2026 / Expected early September 2026",
  "date_display_zh": "2026年9月9日 / 预计2026年9月上旬",
  "date_sort": "YYYY-MM-DD",        // 模糊时间用估计的代表日期，仅用于排序
  "status": "confirmed | expected | rumored | released",
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

## 「悄悄新品」分类（quiet_launch / status=released）

- **定义**：**没有开发布会、但最近一周内已悄悄上市/上线的科技产品**（厂商直接上架、博客/官网公告，没有 Keynote）。
- 该分类条目固定用 `"category": "quiet_launch"` + `"status": "released"`。
- `date_sort` / `date_display_*` 填**实际发布/上市日期**（近一周内的日期）；不要填未来。
- 无需 `live_url`；`official_url` 指向产品页或官方公告。
- **滚动维护**：每次更新时，**移除发布已超过 30 天（约一个月）的旧条目**，补入最近一周的新品（自动脚本 scripts/update-events.ts 的保留窗口即 30 天）。
- 页面上这类条目用蓝色「悄悄上新」徽章、不会被置灰（与即将到来的发布会区分）。
- 示例来源：手机/耳机/手表/配件的静默上架、AI 模型/App 的低调上线、相机固件大版本、开发板/硬件小批量发售等。

## 「往期总结」栏目（recap 字段）

- 发布会在 5 大栏目中**结束后**，由人工为其撰写 `recap` 长文回顾 → 该事件**移入「往期总结」**（有 recap 的事件不再出现在主时间线/原栏目，只在「往期总结」里）。
- 点击往期条目的「查看总结」会打开 `recap.html?id=<事件id>` 单独页面展示全文。
- **永久保留，不做删除**；按发布日期倒序展示（最近的在前）。
- recap 文本用中文多段、段落间空行分隔；保持客观回顾，具体数据以官方为准。
- ⚠️ 此栏目由**人工维护**（撰写回顾需要判断力），**不交给自动脚本/Qwen**。
