import { Hono } from "hono";
import { sign } from "hono/jwt";
import { db, now } from "./db";
import { jwtSecret } from "./auth";

/**
 * 微信小程序后端：登录、access_token 缓存、内容安全、订阅消息。
 * 这是【共享后端】里小程序专属的追加模块，不影响网页端逻辑。
 *
 * 需要环境变量（在 mp.weixin.qq.com 注册小程序后获取）：
 *   WX_APPID、WX_SECRET、WX_TEMPLATE_ID（订阅消息模板）。
 * 未配置时 wxConfigured()=false，相关接口返回 503，网页端其余功能不受影响。
 */

const APPID = process.env.WX_APPID || "";
const SECRET = process.env.WX_SECRET || "";
const TEMPLATE_ID = process.env.WX_TEMPLATE_ID || "";
const JWT_TTL_SEC = 60 * 24 * 3600;

export function wxConfigured(): boolean {
  return !!(APPID && SECRET);
}

// ---------------- access_token 缓存（全局，~7200s）----------------
let tokenCache = { token: "", exp: 0 };
export async function getAccessToken(): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  if (tokenCache.token && tokenCache.exp > nowSec + 120) return tokenCache.token;
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${APPID}&secret=${SECRET}`;
  const r: any = await fetch(url).then((x) => x.json());
  if (!r.access_token) throw new Error(`获取 access_token 失败: ${r.errcode} ${r.errmsg}`);
  tokenCache = { token: r.access_token, exp: nowSec + (r.expires_in || 7200) };
  return tokenCache.token;
}

// ---------------- code2session 登录 ----------------
async function code2session(code: string): Promise<{ openid: string } | null> {
  const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${APPID}&secret=${SECRET}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
  const r: any = await fetch(url).then((x) => x.json());
  if (!r.openid) return null;
  return { openid: r.openid };
}

// ---------------- 内容安全检测（UGC 必过）----------------
/** 返回 true=通过，false=违规。openid 必填（v2 要求） */
export async function msgSecCheck(content: string, openid: string): Promise<boolean> {
  if (!wxConfigured()) return true; // 未配置微信时跳过（网页端走自有关键词过滤）
  try {
    const token = await getAccessToken();
    const r: any = await fetch(`https://api.weixin.qq.com/wxa/msg_sec_check?access_token=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: 2, scene: 2, openid, content }),
    }).then((x) => x.json());
    if (r.errcode === 0 && r.result) return r.result.suggest === "pass";
    return r.errcode === 0; // 兼容老返回
  } catch {
    return true; // 检测服务异常时不阻断（已有本地关键词过滤兜底）
  }
}

// ---------------- 订阅消息发送 ----------------
export async function sendSubscribeMessage(
  openid: string,
  data: Record<string, { value: string }>,
  page?: string
): Promise<{ ok: boolean; err?: string }> {
  if (!wxConfigured() || !TEMPLATE_ID) return { ok: false, err: "wx_not_configured" };
  try {
    const token = await getAccessToken();
    const body: any = { touser: openid, template_id: TEMPLATE_ID, data };
    if (page) body.page = page;
    const r: any = await fetch(`https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((x) => x.json());
    if (r.errcode === 0) return { ok: true };
    return { ok: false, err: `${r.errcode} ${r.errmsg}` };
  } catch (e) {
    return { ok: false, err: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------- 路由 ----------------
export const wxRoutes = new Hono();

// 微信一键登录：小程序 wx.login 拿 code → 换 openid → 签发 JWT
wxRoutes.post("/login", async (c) => {
  if (!wxConfigured()) return c.json({ error: "wx_not_configured", message: "微信登录暂未配置" }, 503);
  const body = await c.req.json().catch(() => ({}));
  const code = String(body.code || "");
  if (!code) return c.json({ error: "no_code", message: "缺少 code" }, 400);

  const sess = await code2session(code);
  if (!sess) return c.json({ error: "code_invalid", message: "登录失败，请重试" }, 400);

  // 显式 upsert（避开 openid 部分唯一索引在 ON CONFLICT 上的歧义）
  let user = db.query("SELECT id, nickname, avatar FROM users WHERE openid = ?").get(sess.openid) as
    | { id: number; nickname: string | null; avatar: string | null } | null;
  if (user) {
    db.query("UPDATE users SET last_login_at = ? WHERE id = ?").run(now(), user.id);
  } else {
    db.query("INSERT INTO users(openid, created_at, last_login_at) VALUES(?,?,?)").run(sess.openid, now(), now());
    user = db.query("SELECT id, nickname, avatar FROM users WHERE openid = ?").get(sess.openid) as {
      id: number; nickname: string | null; avatar: string | null;
    };
  }

  const token = await sign({ uid: user.id, exp: Math.floor(Date.now() / 1000) + JWT_TTL_SEC }, jwtSecret());
  return c.json({
    ok: true, token,
    profile: { nickname: user.nickname, avatar: user.avatar },
    needs_profile: !user.nickname,
  });
});
