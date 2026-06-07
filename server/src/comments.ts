import { Hono } from "hono";
import { verify } from "hono/jwt";
import type { Context } from "hono";
import { db, now } from "./db";
import { allow } from "./ratelimit";
import { requireAuth, jwtSecret } from "./auth";
import { checkSensitive } from "./sensitive";

const MAX_LEN = 200;

/** 管理员邮箱列表（ADMIN_EMAILS 逗号分隔），管理员可删除任何评论 */
function isAdmin(uid: number): boolean {
  const admins = (process.env.ADMIN_EMAILS || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
  if (!admins.length) return false;
  const u = db.query("SELECT email FROM users WHERE id = ?").get(uid) as { email: string } | null;
  return !!u && admins.includes(u.email.toLowerCase());
}

/** 可选鉴权：带了有效 token 则取 uid，否则 null（用于公开的评论列表标记 mine/可删） */
async function optionalUid(c: Context): Promise<number | null> {
  const auth = c.req.header("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  try {
    const payload = await verify(token, jwtSecret(), "HS256");
    return payload.uid as number;
  } catch {
    return null;
  }
}

export const commentRoutes = new Hono();

// 各活动评论数（公开；页面加载时一次拉全量）
commentRoutes.get("/counts", (c) => {
  const rows = db.query("SELECT event_id, COUNT(*) AS n FROM comments GROUP BY event_id").all() as { event_id: string; n: number }[];
  const counts: Record<string, number> = {};
  rows.forEach((r) => (counts[r.event_id] = r.n));
  return c.json({ counts });
});

// 某活动的评论列表（公开可读；登录时标记可删）
commentRoutes.get("/:eventId", async (c) => {
  const uid = await optionalUid(c);
  const admin = uid != null && isAdmin(uid);
  const rows = db
    .query(
      `SELECT cm.id, cm.user_id, cm.content, cm.created_at, u.nickname, u.avatar
       FROM comments cm JOIN users u ON u.id = cm.user_id
       WHERE cm.event_id = ? ORDER BY cm.id DESC LIMIT 100`
    )
    .all(c.req.param("eventId")) as { id: number; user_id: number; content: string; created_at: string; nickname: string | null; avatar: string | null }[];

  return c.json({
    comments: rows.map((r) => ({
      id: r.id,
      content: r.content,
      created_at: r.created_at,
      nickname: r.nickname || "用户",
      avatar: r.avatar,
      can_delete: uid != null && (r.user_id === uid || admin),
    })),
  });
});

// 发布评论（登录 + 敏感词拦截 + 限频）
commentRoutes.post("/", requireAuth, async (c) => {
  const uid = c.get("uid" as never) as number;
  const body = await c.req.json().catch(() => ({}));
  const eventId = String(body.event_id || "");
  const content = String(body.content || "").trim();

  if (!content || content.length > MAX_LEN) {
    return c.json({ error: "invalid_content", message: `评论需为 1-${MAX_LEN} 个字符` }, 400);
  }
  const event = db.query("SELECT id FROM events WHERE id = ?").get(eventId);
  if (!event) return c.json({ error: "event_not_found", message: "活动不存在" }, 404);

  // 敏感词检测（用户已确认的词库；阻止发布并提示命中词）
  const hits = checkSensitive(content);
  if (hits.length) {
    return c.json({ error: "sensitive_words", words: hits, message: "评论包含敏感词：" + hits.join("、") + "，请修改后再发布" }, 400);
  }

  // 限频：每人每分钟 1 条、每天 5 条
  if (!allow(`comment:${uid}:min`, 1, 60)) return c.json({ error: "rate_limited", message: "发布太频繁，请 1 分钟后再试" }, 429);
  if (!allow(`comment:${uid}:day`, 5, 86400)) return c.json({ error: "rate_limited", message: "今日评论数已达上限（5条）" }, 429);

  db.query("INSERT INTO comments(event_id, user_id, content, created_at) VALUES(?,?,?,?)").run(eventId, uid, content, now());
  return c.json({ ok: true });
});

// 删除评论（本人或管理员）
commentRoutes.delete("/:id", requireAuth, (c) => {
  const uid = c.get("uid" as never) as number;
  const id = Number(c.req.param("id"));
  const row = db.query("SELECT user_id FROM comments WHERE id = ?").get(id) as { user_id: number } | null;
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.user_id !== uid && !isAdmin(uid)) return c.json({ error: "forbidden", message: "只能删除自己的评论" }, 403);
  db.query("DELETE FROM comments WHERE id = ?").run(id);
  return c.json({ ok: true });
});
