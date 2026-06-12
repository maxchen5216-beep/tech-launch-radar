# 数据自动更新脚本（通义千问 Qwen + 联网搜索）

把"更新发布会数据"从人工/Claude 切换为 **Qwen `qwen3.7-max` 联网自动更新**。

## 用法

```bash
bun scripts/update-events.ts --dry   # 预览：联网复核 + 搜悄悄新品，打印变更但不写文件
bun scripts/update-events.ts         # 实际写入 data/events-data.js
```

写入后如需上线：
- GitHub Pages：`git add data/events-data.js && git commit -m "data: 自动更新" && git push`
- 阿里云完整版：`bash deploy/push-update.sh`

## 它做什么（有界、安全）

1. **复核未定档事件**：对所有 `expected`/`rumored` 事件联网核实，若已官宣定档 → 仅升级 status/日期（不动其他精选数据）
2. **滚动维护「悄悄新品」**：删除发布超过 7 天的旧条目，补入最近 7 天真实静默发布的单品（带来源 URL）
3. 严格校验：日期格式/范围、必须有 official_url，不合规条目自动跳过
4. 自动更新的条目标记 `verified: false`（页面不显示"已核验"徽章），与人工核验区分

## 配置

`scripts/.env`（**已 gitignore，切勿提交**）：
```
DASHSCOPE_API_KEY=sk-...     # 阿里百炼 API Key
QWEN_MODEL=qwen3.7-max
```
关键参数：调用时带 `enable_search:true` + `search_options:{forced_search:true, enable_source:true}` 才会真正联网并返回来源（否则模型用旧知识、不给 URL）。

## 数据质量说明（重要）

- Qwen 联网搜索以**中文信息源为主**，悄悄新品会偏向国内厂商/产品；全球性新品覆盖不如人工精选全面。
- 自动条目为 `verified:false`，建议**重要更新前** `--dry` 预览一遍，或定期人工抽查。
- 发布会"复核"部分（expected→confirmed）较可靠；"悄悄新品发现"质量中等，偶有偏行业/B2B内容（已用提示词收紧）。

## 定时自动跑（可选）

- 本机 cron / launchd：每天定时 `bun scripts/update-events.ts && git ...`
- 阿里云服务器 cron：同理（Qwen 是国内 API，服务器调用更快）
