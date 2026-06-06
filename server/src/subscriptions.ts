import { Hono } from "hono";
import { db, now } from "./db";
import { requireAuth } from "./auth";

const MAX_SUBS_PER_USER = 50;
const LEAD_DAYS_ALLOWED = new Set([1, 3, 7]);

export const subRoutes = new Hono();
subRoutes.use("*", requireAuth);

// 我的订阅列表
subRoutes.get("/", (c) => {
  const uid = c.get("uid" as never) as number;
  const rows = db
    .query(
      `SELECT s.event_id, s.mode, s.lead_days, s.status, s.created_at,
              e.name_zh, e.name_en, e.date_sort, e.status AS event_status
       FROM subscriptions s LEFT JOIN events e ON e.id = s.event_id
       WHERE s.user_id = ? ORDER BY e.date_sort`
    )
    .all(uid);
  return c.json({ subscriptions: rows });
});

// 新增/更新订阅
subRoutes.post("/", async (c) => {
  const uid = c.get("uid" as never) as number;
  const body = await c.req.json().catch(() => ({}));
  const eventId = String(body.event_id || "");
  const mode = String(body.mode || "");
  const leadDays = body.lead_days != null ? Number(body.lead_days) : null;

  const event = db.query("SELECT id, status FROM events WHERE id = ?").get(eventId) as { id: string; status: string } | null;
  if (!event) return c.json({ error: "event_not_found", message: "事件不存在（可能需要先同步事件数据）" }, 404);

  if (mode === "before_event") {
    if (event.status !== "confirmed") return c.json({ error: "not_confirmed", message: "该事件尚未官宣定档，请使用「关注官宣」" }, 400);
    if (!leadDays || !LEAD_DAYS_ALLOWED.has(leadDays)) return c.json({ error: "invalid_lead_days", message: "提前天数仅支持 1/3/7" }, 400);
  } else if (mode === "on_announce") {
    if (event.status === "confirmed") return c.json({ error: "already_confirmed", message: "该事件已官宣，请直接设置开始前提醒" }, 400);
  } else {
    return c.json({ error: "invalid_mode", message: "mode 仅支持 before_event / on_announce" }, 400);
  }

  const count = (db.query("SELECT COUNT(*) AS n FROM subscriptions WHERE user_id = ?").get(uid) as { n: number }).n;
  const exists = db.query("SELECT id FROM subscriptions WHERE user_id = ? AND event_id = ?").get(uid, eventId);
  if (!exists && count >= MAX_SUBS_PER_USER) {
    return c.json({ error: "too_many_subscriptions", message: `订阅数量已达上限（${MAX_SUBS_PER_USER}）` }, 400);
  }

  db.query(
    `INSERT INTO subscriptions(user_id, event_id, mode, lead_days, status, created_at)
     VALUES(?,?,?,?,'active',?)
     ON CONFLICT(user_id, event_id) DO UPDATE SET mode = excluded.mode, lead_days = excluded.lead_days, status = 'active'`
  ).run(uid, eventId, mode, mode === "before_event" ? leadDays : null, now());

  return c.json({ ok: true });
});

// 取消订阅
subRoutes.delete("/:eventId", (c) => {
  const uid = c.get("uid" as never) as number;
  db.query("DELETE FROM subscriptions WHERE user_id = ? AND event_id = ?").run(uid, c.req.param("eventId"));
  return c.json({ ok: true });
});
