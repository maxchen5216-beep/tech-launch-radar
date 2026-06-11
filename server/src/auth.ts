import { Hono } from "hono";
import { sign, verify } from "hono/jwt";
import type { Context, Next } from "hono";
import { join } from "node:path";
import { db, now, AVATAR_DIR } from "./db";
import { allow } from "./ratelimit";
import { sendMail, mailDriver } from "./mail";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// 常见一次性邮箱域名黑名单（可扩充）
const DISPOSABLE = new Set(["mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "yopmail.com"]);

const JWT_TTL_SEC = 60 * 24 * 3600; // 60 天
const CODE_TTL_MS = 5 * 60 * 1000; // 5 分钟

export function jwtSecret(): string {
  // 优先用环境变量；否则生成并持久化一个随机密钥（重启后登录态不失效）
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  let s = db.query("SELECT value FROM meta WHERE key = 'jwt_secret'").get() as { value: string } | null;
  if (!s) {
    const v = crypto.randomUUID() + crypto.randomUUID();
    db.query("INSERT INTO meta(key, value) VALUES('jwt_secret', ?)").run(v);
    s = { value: v };
  }
  return s.value;
}

async function hashCode(email: string, code: string): Promise<string> {
  const data = new TextEncoder().encode(`${jwtSecret()}:${email}:${code}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function clientIp(c: Context): string {
  // 优先用 nginx 设置的 x-real-ip（=$remote_addr，可信）；x-forwarded-for 客户端可伪造
  return c.req.header("x-real-ip") || c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export const authRoutes = new Hono();

// 发送验证码
authRoutes.post("/send-code", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();

  if (!EMAIL_RE.test(email) || email.length > 254) {
    return c.json({ error: "invalid_email", message: "邮箱格式不正确" }, 400);
  }
  if (DISPOSABLE.has(email.split("@")[1])) {
    return c.json({ error: "disposable_email", message: "不支持一次性邮箱" }, 400);
  }

  // 防刷：同邮箱 60s/1、1小时/5、24小时/10；同 IP 1小时/10
  const ip = clientIp(c);
  if (!allow(`code:email:${email}:min`, 1, 60)) return c.json({ error: "rate_limited", message: "发送过于频繁，请 60 秒后再试" }, 429);
  if (!allow(`code:email:${email}:hour`, 5, 3600)) return c.json({ error: "rate_limited", message: "本小时发送次数已达上限" }, 429);
  if (!allow(`code:email:${email}:day`, 10, 86400)) return c.json({ error: "rate_limited", message: "今日发送次数已达上限" }, 429);
  if (!allow(`code:ip:${ip}:hour`, 10, 3600)) return c.json({ error: "rate_limited", message: "请求过于频繁，请稍后再试" }, 429);

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = await hashCode(email, code);

  db.query("DELETE FROM auth_codes WHERE email = ?").run(email);
  db.query("INSERT INTO auth_codes(email, code_hash, expires_at, attempts, created_at) VALUES(?,?,?,0,?)").run(
    email,
    codeHash,
    new Date(Date.now() + CODE_TTL_MS).toISOString(),
    now()
  );

  const sent = await sendMail({
    to: email,
    subject: "【发布时刻】登录验证码",
    text: `您的登录验证码为 ${code}，5 分钟内有效。如非本人操作请忽略。`,
    type: "code",
  });
  if (!sent.ok) {
    db.query("DELETE FROM auth_codes WHERE email = ?").run(email); // 发送失败的验证码作废
    return c.json({ error: "mail_failed", message: "邮件发送失败，请稍后再试" }, 502);
  }

  // 邮件推送未上线（mock 驱动）：开发模式下直接回显验证码，便于本地走通流程
  const dev = mailDriver() === "mock";
  return c.json({ ok: true, ...(dev ? { dev: true, dev_code: code, dev_note: "邮件推送未上线，验证码仅在开发模式回显" } : {}) });
});

// 校验验证码 → 签发 JWT
authRoutes.post("/verify", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const code = String(body.code || "").trim();

  if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) {
    return c.json({ error: "invalid_input", message: "邮箱或验证码格式不正确" }, 400);
  }
  if (!allow(`verify:email:${email}:hour`, 20, 3600)) {
    return c.json({ error: "rate_limited", message: "尝试过于频繁，请稍后再试" }, 429);
  }

  const row = db
    .query("SELECT id, code_hash, expires_at, attempts FROM auth_codes WHERE email = ? ORDER BY id DESC LIMIT 1")
    .get(email) as { id: number; code_hash: string; expires_at: string; attempts: number } | null;

  if (!row || row.expires_at < now()) return c.json({ error: "code_expired", message: "验证码已过期，请重新获取" }, 400);
  if (row.attempts >= 5) return c.json({ error: "too_many_attempts", message: "错误次数过多，请重新获取验证码" }, 400);

  if ((await hashCode(email, code)) !== row.code_hash) {
    db.query("UPDATE auth_codes SET attempts = attempts + 1 WHERE id = ?").run(row.id);
    return c.json({ error: "wrong_code", message: "验证码错误" }, 400);
  }

  // 成功：验证码一次性失效，登记用户（注册与登录一体）
  db.query("DELETE FROM auth_codes WHERE email = ?").run(email);
  db.query(
    "INSERT INTO users(email, created_at, last_login_at) VALUES(?,?,?) ON CONFLICT(email) DO UPDATE SET last_login_at = excluded.last_login_at"
  ).run(email, now(), now());
  const user = db.query("SELECT id, nickname, avatar FROM users WHERE email = ?").get(email) as {
    id: number; nickname: string | null; avatar: string | null;
  };

  const token = await sign({ uid: user.id, exp: Math.floor(Date.now() / 1000) + JWT_TTL_SEC }, jwtSecret());
  return c.json({
    ok: true, token, email,
    profile: { nickname: user.nickname, avatar: user.avatar },
    needs_profile: !user.nickname, // 新用户（或未完善资料）→ 前端进入「完善资料」步骤
  });
});

// ---- 用户资料 ----

const AVATAR_RE = /^(p:\d{1,2}|u:[A-Za-z0-9-]+\.(png|jpg|webp))$/;

authRoutes.get("/me", requireAuth, (c) => {
  const uid = c.get("uid" as never) as number;
  const u = db.query("SELECT email, nickname, avatar FROM users WHERE id = ?").get(uid) as
    | { email: string; nickname: string | null; avatar: string | null }
    | null;
  if (!u) return c.json({ error: "not_found" }, 404);
  return c.json({ email: u.email, nickname: u.nickname, avatar: u.avatar, needs_profile: !u.nickname });
});

authRoutes.post("/me", requireAuth, async (c) => {
  const uid = c.get("uid" as never) as number;
  const body = await c.req.json().catch(() => ({}));
  const nickname = String(body.nickname || "").trim();
  const avatar = body.avatar != null ? String(body.avatar) : null;

  if (nickname.length < 1 || nickname.length > 20) {
    return c.json({ error: "invalid_nickname", message: "用户名需为 1-20 个字符" }, 400);
  }
  if (avatar !== null && avatar !== "" && !AVATAR_RE.test(avatar)) {
    return c.json({ error: "invalid_avatar", message: "头像参数不合法" }, 400);
  }

  db.query("UPDATE users SET nickname = ?, avatar = ? WHERE id = ?").run(nickname, avatar || null, uid);
  return c.json({ ok: true, profile: { nickname, avatar: avatar || null } });
});

/** 校验图片文件头魔数（不能只信 Content-Type） */
function sniffImage(buf: Uint8Array): "png" | "jpg" | "webp" | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  // RIFF....WEBP
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return "webp";
  return null;
}

// 头像上传（multipart 字段名 file；≤1MB；png/jpg/webp，按文件头校验）
authRoutes.post("/me/avatar", requireAuth, async (c) => {
  const uid = c.get("uid" as never) as number;
  if (!allow(`avatar:${uid}:hour`, 10, 3600)) return c.json({ error: "rate_limited", message: "上传过于频繁，请稍后再试" }, 429);

  const body = await c.req.parseBody();
  const f = body.file;
  if (!(f instanceof File)) return c.json({ error: "no_file", message: "未收到文件" }, 400);
  if (f.size > 1024 * 1024) return c.json({ error: "too_large", message: "图片不能超过 1MB" }, 400);

  const bytes = new Uint8Array(await f.arrayBuffer());
  const ext = sniffImage(bytes); // 以真实文件头为准，忽略客户端声明的 Content-Type
  if (!ext) return c.json({ error: "bad_type", message: "仅支持 PNG / JPG / WebP 图片" }, 400);

  // 删除该用户的旧头像文件，避免孤儿堆积
  const old = db.query("SELECT avatar FROM users WHERE id = ?").get(uid) as { avatar: string | null } | null;
  if (old?.avatar?.startsWith("u:")) {
    try { await Bun.file(join(AVATAR_DIR, old.avatar.slice(2))).delete(); } catch {}
  }

  const fname = `${uid}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  await Bun.write(join(AVATAR_DIR, fname), bytes);
  return c.json({ ok: true, avatar: `u:${fname}` });
});

// 注销账号（删除用户与全部订阅）
authRoutes.delete("/account", requireAuth, async (c) => {
  const uid = c.get("uid" as never) as number;
  // 删除该用户上传的头像文件（避免孤儿文件）
  const u = db.query("SELECT avatar FROM users WHERE id = ?").get(uid) as { avatar: string | null } | null;
  if (u?.avatar?.startsWith("u:")) {
    try { await Bun.file(join(AVATAR_DIR, u.avatar.slice(2))).delete(); } catch {}
  }
  // 必须先删依赖（foreign_keys=ON，否则 DELETE users 会因评论/订阅外键约束 500）
  db.query("DELETE FROM comments WHERE user_id = ?").run(uid);
  db.query("DELETE FROM subscriptions WHERE user_id = ?").run(uid);
  db.query("DELETE FROM users WHERE id = ?").run(uid);
  return c.json({ ok: true });
});

// JWT 中间件
export async function requireAuth(c: Context, next: Next) {
  const auth = c.req.header("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return c.json({ error: "unauthorized", message: "请先登录" }, 401);
  try {
    const payload = await verify(token, jwtSecret(), "HS256");
    c.set("uid" as never, payload.uid as never);
  } catch {
    return c.json({ error: "unauthorized", message: "登录已过期，请重新登录" }, 401);
  }
  await next();
}
