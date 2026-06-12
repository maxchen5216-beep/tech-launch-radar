#!/usr/bin/env bun
/**
 * 自动更新发布会数据（通义千问 Qwen + enable_search 联网搜索）
 *
 * 安全设计（保护数据质量，本产品核心卖点）：
 *  - 只做两类有界更新，绝不重写整份精选数据：
 *      ① 复核 expected/rumored 事件是否已官宣 → 仅升级 status/日期
 *      ② 滚动维护「悄悄新品」：删超过 7 天的旧条目，补最近 7 天的新条目
 *  - 严格校验模型返回的 JSON，字段不合规的条目跳过
 *  - 默认打印变更摘要；加 --dry 只预览不写入
 *  - 不自动 git 提交（交由你/定时任务决定）
 *
 * 用法：
 *   bun scripts/update-events.ts          # 联网更新并写入 data/events-data.js
 *   bun scripts/update-events.ts --dry     # 只预览，不写文件
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_FILE = join(ROOT, "data", "events-data.js");
const DRY = process.argv.includes("--dry");

// ---- 读取 scripts/.env ----
const envText = await Bun.file(join(ROOT, "scripts", ".env")).text().catch(() => "");
const env: Record<string, string> = {};
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const API_KEY = env.DASHSCOPE_API_KEY || process.env.DASHSCOPE_API_KEY || "";
const MODEL = env.QWEN_MODEL || "qwen3.7-max";
if (!API_KEY) { console.error("❌ 缺少 DASHSCOPE_API_KEY（scripts/.env）"); process.exit(1); }

// ---- 载入现有数据 ----
const src = await Bun.file(DATA_FILE).text();
const m = src.match(/window\.EVENTS_DATA\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
if (!m) { console.error("❌ 无法解析 events-data.js"); process.exit(1); }
const header = src.slice(0, m.index);
const data = JSON.parse(m[1]);
const events: any[] = data.events;

const today = new Date();
const todayStr = (d = today) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const daysAgo = (n: number) => { const d = new Date(today); d.setDate(d.getDate() - n); return todayStr(d); };

// 待复核的未定档事件
const pending = events
  .filter((e) => e.status === "expected" || e.status === "rumored")
  .map((e) => ({ id: e.id, name_zh: e.name_zh, date_sort: e.date_sort, status: e.status }));
const existingQuietIds = events.filter((e) => e.category === "quiet_launch").map((e) => e.id);

// ---- 调用 Qwen（联网）----
const prompt = `今天是 ${todayStr()}。你是一个科技发布会数据维护助手，必须联网搜索并与官方信息源交叉校验。请完成两个任务，只返回一个 JSON 对象（不要任何多余文字、不要 markdown 代码块）。

任务一【复核未定档事件】：下面是当前数据库里"预计/传闻"状态的事件，逐个联网核实官方是否已公布确切日期。只返回**确有变化**的（已官宣定档或日期/状态变更）：
${JSON.stringify(pending, null, 0)}

任务二【悄悄新品】：联网搜索 ${daysAgo(7)} 至 ${todayStr()} 这一周内、**没有开发布会就悄悄上市/上线**的真实科技产品，找 4-8 个，必须真实可核实。
  要求：①必须是**具体的单一消费级/开发者产品**（手机、耳机、手表、相机或固件、AI模型、App、配件、芯片、显卡等）；
  ②**排除**：行业"产品矩阵"、B2B/企业采购平台、解决方案、概念、政策、行业分析这类非单品内容；
  ③优先全球知名厂商或有影响力的产品，不要凑数。不要与这些已有 id 重复：${JSON.stringify(existingQuietIds)}

返回 JSON 格式：
{
  "event_updates": [
    { "id": "已有事件id", "new_status": "confirmed", "new_date_sort": "2026-09-09", "new_date_display_zh": "2026年9月9日", "new_date_display_en": "September 9, 2026", "official_url": "官方源", "note": "校验说明" }
  ],
  "quiet_launches": [
    { "id": "kebab-id", "name_zh": "中文名", "name_en": "English name", "organizer": "厂商", "date_sort": "2026-06-xx", "date_display_zh": "2026年6月x日", "date_display_en": "June x, 2026", "summary_zh": "1-2句", "summary_en": "1-2 sentences", "official_url": "产品页/公告URL", "source_note_zh": "来源与校验说明" }
  ]
}
没有变化就返回空数组。务必保证 date_sort 为真实发布日期；official_url 必须填你联网搜索结果里**真实存在的来源网址**（官网或权威媒体报道链接），不得编造、不得留空。
【输出要求】完成联网搜索后，**只输出最终的 JSON 对象本身**，不要输出任何搜索过程、思考、工具调用语法、解释或 markdown 代码块。`;

console.log(`🔎 调用 ${MODEL}（联网）复核 ${pending.length} 个待定事件 + 搜索悄悄新品…`);
const res = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
  method: "POST",
  headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    model: MODEL,
    enable_search: true, // 只用 enable_search；加 forced_search 会让该模型进入智能体模式只吐工具调用
    messages: [
      { role: "system", content: "你可以联网搜索。完成搜索后直接输出最终的 JSON 结果，严禁输出任何工具调用语法、搜索过程或思考。" },
      { role: "user", content: prompt },
    ],
    max_tokens: 6000,
  }),
});
const j: any = await res.json();
if (!j.choices) { console.error("❌ 模型调用失败：", JSON.stringify(j).slice(0, 400)); process.exit(1); }
let content: string = j.choices[0].message.content;

// 健壮提取：模型可能在正文里夹杂搜索过程/工具调用语法，定位含目标键、括号配平的 JSON 对象
function balanceFrom(text: string, start: number): string | null {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}
function extractJSON(text: string): any | null {
  const keyIdx = Math.max(text.lastIndexOf('"quiet_launches"'), text.lastIndexOf('"event_updates"'));
  if (keyIdx === -1) return null;
  let start = text.lastIndexOf("{", keyIdx);
  while (start >= 0) {
    const cand = balanceFrom(text, start);
    if (cand) { try { const o = JSON.parse(cand); if (o.quiet_launches || o.event_updates) return o; } catch {} }
    start = text.lastIndexOf("{", start - 1);
  }
  return null;
}
const parsed = extractJSON(content);
if (!parsed) { console.error("❌ 未能从返回中提取有效 JSON。正文片段：", content.slice(0, 400)); process.exit(1); }

// ---- 应用变更（严格校验）----
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
let updatedCount = 0, addedQuiet = 0, prunedQuiet = 0;

// 任务一：仅更新已存在事件的 status/日期
for (const u of parsed.event_updates || []) {
  const ev = events.find((e) => e.id === u.id);
  if (!ev || (ev.status !== "expected" && ev.status !== "rumored")) continue;
  if (!DATE_RE.test(u.new_date_sort || "") || !u.official_url) continue;
  if (!["confirmed", "expected", "rumored"].includes(u.new_status)) continue;
  ev.status = u.new_status;
  ev.date_sort = u.new_date_sort;
  if (u.new_date_display_zh) ev.date_display_zh = u.new_date_display_zh;
  if (u.new_date_display_en) ev.date_display_en = u.new_date_display_en;
  ev.official_url = u.official_url;
  ev.source_note_zh = (u.note || ev.source_note_zh) + `（${todayStr()} 自动复核）`;
  ev.verified = false; // 自动更新标记为未人工核验
  updatedCount++;
  console.log(`  ✎ 事件更新: ${ev.name_zh} → ${u.new_status} ${u.new_date_sort}`);
}

// 任务二：滚动维护悄悄新品 —— 保留窗口 30 天（约一个月后再删）
const cutoff = daysAgo(30);
const before = events.length;
data.events = events.filter((e) => !(e.category === "quiet_launch" && e.date_sort < cutoff));
prunedQuiet = before - data.events.length;

// 再加新的（校验 + 去重）
const allIds = new Set(data.events.map((e: any) => e.id));
for (const q of parsed.quiet_launches || []) {
  if (!q.id || allIds.has(q.id)) continue;
  if (!DATE_RE.test(q.date_sort || "") || q.date_sort < cutoff || q.date_sort > todayStr()) continue; // 必须在最近7天内、不未来
  if (!q.name_zh || !q.official_url) continue;
  data.events.push({
    id: q.id, name_en: q.name_en || q.name_zh, name_zh: q.name_zh, organizer: q.organizer || "",
    category: "quiet_launch",
    date_display_en: q.date_display_en || q.date_sort, date_display_zh: q.date_display_zh || q.date_sort,
    date_sort: q.date_sort, status: "released",
    summary_en: q.summary_en || "", summary_zh: q.summary_zh || "",
    official_url: q.official_url, source_note_zh: (q.source_note_zh || "") + `（${todayStr()} 自动收录）`,
    verified: false,
  });
  allIds.add(q.id);
  addedQuiet++;
  console.log(`  ＋ 悄悄新品: ${q.name_zh} (${q.date_sort})`);
}

console.log(`\n📊 摘要：事件更新 ${updatedCount} · 悄悄新品 新增 ${addedQuiet}/清理 ${prunedQuiet} · 共 ${data.events.length} 条`);

if (DRY) { console.log("（--dry 预览模式，未写入文件）"); process.exit(0); }
if (updatedCount === 0 && addedQuiet === 0 && prunedQuiet === 0) { console.log("无变化，跳过写入。"); process.exit(0); }

// ---- 写回 ----
data.updated = todayStr();
data.updated_note_zh = `${todayStr()} 由 Qwen 联网自动更新（事件复核 + 悄悄新品滚动维护）`;
data.updated_note_en = `Auto-updated by Qwen with web search on ${todayStr()}`;
const out = header + "window.EVENTS_DATA = " + JSON.stringify(data, null, 2) + ";\n";
await Bun.write(DATA_FILE, out);
console.log("✅ 已写入 data/events-data.js");
