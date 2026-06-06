import { Hono } from "hono";
import { sign, verify } from "hono/jwt";
import type { Context, Next } from "hono";
import { db, now } from "./db";
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
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "local";
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
    subject: "【科技圈发布会雷达】登录验证码",
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

  // 成功：验证码一次性失效，登记用户
  db.query("DELETE FROM auth_codes WHERE email = ?").run(email);
  db.query(
    "INSERT INTO users(email, created_at, last_login_at) VALUES(?,?,?) ON CONFLICT(email) DO UPDATE SET last_login_at = excluded.last_login_at"
  ).run(email, now(), now());
  const user = db.query("SELECT id FROM users WHERE email = ?").get(email) as { id: number };

  const token = await sign({ uid: user.id, exp: Math.floor(Date.now() / 1000) + JWT_TTL_SEC }, jwtSecret());
  return c.json({ ok: true, token, email });
});

// 注销账号（删除用户与全部订阅）
authRoutes.delete("/account", requireAuth, async (c) => {
  const uid = c.get("uid" as never) as number;
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
