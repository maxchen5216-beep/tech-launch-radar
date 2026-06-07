import { Hono } from "hono";
import { cors } from "hono/cors";
import { join } from "node:path";
import { db, localDateStr, metaGet, metaSet, AVATAR_DIR } from "./db";
import { authRoutes } from "./auth";
import { subRoutes } from "./subscriptions";
import { syncEvents } from "./sync-events";
import { scanReminders } from "./scan-reminders";
import { mailDriver } from "./mail";

const PORT = Number(process.env.PORT || 8787);
const INTERNAL_KEY = process.env.INTERNAL_KEY || "dev-internal-key";
const PROJECT_ROOT = join(import.meta.dir, "..", "..");

const app = new Hono();

// CORS：开发期放开（页面可能从 file:// 打开，origin 为 null）
app.use("/api/*", cors({ origin: (o) => o || "*", allowHeaders: ["Content-Type", "Authorization"], allowMethods: ["GET", "POST", "DELETE", "OPTIONS"] }));

app.route("/api/auth", authRoutes);
app.route("/api/subscriptions", subRoutes);

app.get("/api/health", (c) =>
  c.json({ ok: true, mail_driver: mailDriver(), events: (db.query("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n })
);

// 内部接口：数据更新流程结束后调用，立即同步事件并检测官宣
app.post("/internal/sync-events", async (c) => {
  if (c.req.header("x-internal-key") !== INTERNAL_KEY) return c.json({ error: "forbidden" }, 403);
  const result = await syncEvents();
  return c.json({ ok: true, ...result });
});

// 内部接口：手动触发提醒扫描（QA/调试用，可传 ?today=YYYY-MM-DD 模拟日期）
app.post("/internal/scan-reminders", async (c) => {
  if (c.req.header("x-internal-key") !== INTERNAL_KEY) return c.json({ error: "forbidden" }, 403);
  const today = c.req.query("today") || localDateStr();
  const result = await scanReminders(today);
  return c.json({ ok: true, today, ...result });
});

// ---- 静态托管（同源提供前端，免 CORS）----
const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".md": "text/markdown; charset=utf-8" };
async function serveFile(rel: string) {
  const path = join(PROJECT_ROOT, rel);
  if (!path.startsWith(PROJECT_ROOT)) return new Response("forbidden", { status: 403 });
  const f = Bun.file(path);
  if (!(await f.exists())) return new Response("not found", { status: 404 });
  const ext = rel.slice(rel.lastIndexOf("."));
  return new Response(f, { headers: { "content-type": MIME[ext] || "application/octet-stream", "cache-control": "no-cache" } });
}
app.get("/", () => serveFile("index.html"));
app.get("/index.html", () => serveFile("index.html"));
app.get("/data/:file", (c) => serveFile(`data/${c.req.param("file").replace(/[^\w.-]/g, "")}`));
app.get("/assets/:file", (c) => serveFile(`assets/${c.req.param("file").replace(/[^\w.-]/g, "")}`));

// 用户上传的头像
app.get("/avatars/:file", async (c) => {
  const name = c.req.param("file").replace(/[^\w.-]/g, "");
  const f = Bun.file(join(AVATAR_DIR, name));
  if (!(await f.exists())) return new Response("not found", { status: 404 });
  const ext = name.slice(name.lastIndexOf(".") + 1);
  const type = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return new Response(f, { headers: { "content-type": type, "cache-control": "public, max-age=86400" } });
});

// ---- 每日定时任务（每小时检查一次，按日期守卫保证每天只跑一次）----
async function cronTick() {
  const today = localDateStr();
  try {
    if (metaGet("last_sync_date") !== today) {
      const r = await syncEvents();
      metaSet("last_sync_date", today);
      console.log(`[cron] sync-events: ${r.synced} 个事件已同步, 官宣 ${r.announced.length} 个`);
    }
    if (metaGet("last_scan_date") !== today) {
      const r = await scanReminders(today);
      metaSet("last_scan_date", today);
      console.log(`[cron] scan-reminders: 检查 ${r.checked}, 应发 ${r.sent}, 跳过 ${r.skipped}（驱动: ${mailDriver()}）`);
    }
  } catch (err) {
    console.error("[cron] error:", err);
  }
}
setInterval(cronTick, 60 * 60 * 1000);
cronTick(); // 启动即跑一次（含首次事件落库）

console.log(`科技圈发布会雷达 · 后端启动 http://localhost:${PORT}（邮件驱动: ${mailDriver()}${mailDriver() === "mock" ? " — 推送未上线，仅记录日志" : ""}）`);

export default { port: PORT, fetch: app.fetch };
