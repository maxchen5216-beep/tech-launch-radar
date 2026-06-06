import { createHmac, randomUUID } from "node:crypto";
import { db, now } from "./db";

/**
 * 邮件发送抽象层。
 *
 * 驱动由环境变量 MAIL_DRIVER 决定：
 *   - mock（默认）：不发送任何真实邮件，仅打印日志并写 email_log（status='mock'）。
 *     开发模式下验证码会回显给前端（dev_code），生产环境严禁使用。
 *   - directmail：阿里云邮件推送 DirectMail（SingleSendMail API，HMAC-SHA1 签名直调 HTTP）。
 *     需要环境变量：ALIYUN_AK、ALIYUN_SK、MAIL_FROM（已验证的发信地址，如 noreply@mail.nextlaunch.cn）、
 *     可选 MAIL_FROM_ALIAS（发件人昵称，默认"科技圈发布会雷达"）。
 *   - resend：Resend API。需要 RESEND_API_KEY、MAIL_FROM（已验证发信域名下的地址）。
 *
 * sendMail 不抛异常：发送失败时写 email_log（status='failed'）并返回 { ok: false }，
 * 由调用方决定如何处理（登录接口返回 502；提醒扫描下轮自动重试——failed 不计入幂等去重）。
 */

export type MailType = "code" | "reminder" | "announce";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  type: MailType;
  eventId?: string;
  /** 幂等去重键的附加部分（如 "lead_days:date_sort"） */
  meta?: string;
}

const DRIVER = process.env.MAIL_DRIVER || "mock";

export function mailDriver(): string {
  return DRIVER;
}

/** 已成功发送过相同 (email,type,event_id,meta) 则返回 true（幂等去重；failed 不计入，可重试） */
export function alreadySent(msg: Pick<MailMessage, "to" | "type" | "eventId" | "meta">): boolean {
  const row = db
    .query(
      "SELECT id FROM email_log WHERE email = ? AND type = ? AND ifnull(event_id,'') = ifnull(?,'') AND ifnull(meta,'') = ifnull(?,'') AND status != 'failed' LIMIT 1"
    )
    .get(msg.to, msg.type, msg.eventId ?? null, msg.meta ?? null);
  return !!row;
}

/** 当日已发送总量（成本闸） */
export function sentToday(type?: MailType): number {
  const today = new Date().toISOString().slice(0, 10);
  const row = type
    ? (db.query("SELECT COUNT(*) AS n FROM email_log WHERE type = ? AND created_at >= ? AND status != 'failed'").get(type, today) as { n: number })
    : (db.query("SELECT COUNT(*) AS n FROM email_log WHERE created_at >= ? AND status != 'failed'").get(today) as { n: number });
  return row.n;
}

// ---------------- 阿里云 DirectMail ----------------

/** 阿里云 POP 签名规范的 percent-encode */
function aliyunEncode(s: string): string {
  return encodeURIComponent(s).replace(/\*/g, "%2A").replace(/%7E/g, "~").replace(/\+/g, "%20");
}

async function sendViaDirectMail(msg: MailMessage): Promise<void> {
  const ak = process.env.ALIYUN_AK;
  const sk = process.env.ALIYUN_SK;
  const from = process.env.MAIL_FROM;
  if (!ak || !sk || !from) throw new Error("DirectMail 未配置：需要 ALIYUN_AK / ALIYUN_SK / MAIL_FROM");

  const params: Record<string, string> = {
    // 公共参数
    Format: "JSON",
    Version: "2015-11-23",
    AccessKeyId: ak,
    SignatureMethod: "HMAC-SHA1",
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    SignatureVersion: "1.0",
    SignatureNonce: randomUUID(),
    // SingleSendMail 业务参数
    Action: "SingleSendMail",
    AccountName: from,
    AddressType: "1",
    ReplyToAddress: "false",
    ToAddress: msg.to,
    FromAlias: process.env.MAIL_FROM_ALIAS || "科技圈发布会雷达",
    Subject: msg.subject,
    TextBody: msg.text,
  };

  const sorted = Object.keys(params).sort();
  const canonical = sorted.map((k) => `${aliyunEncode(k)}=${aliyunEncode(params[k])}`).join("&");
  const stringToSign = `POST&${aliyunEncode("/")}&${aliyunEncode(canonical)}`;
  const signature = createHmac("sha1", sk + "&").update(stringToSign).digest("base64");

  const body = `Signature=${aliyunEncode(signature)}&${canonical}`;
  const res = await fetch("https://dm.aliyuncs.com/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json.EnvelopeId) {
    throw new Error(`DirectMail 发送失败: ${json.Code || res.status} ${json.Message || ""}`.trim());
  }
}

// ---------------- Resend ----------------

async function sendViaResend(msg: MailMessage): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from) throw new Error("Resend 未配置：需要 RESEND_API_KEY / MAIL_FROM");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${process.env.MAIL_FROM_ALIAS || "Tech Launch Radar"} <${from}>`,
      to: [msg.to],
      subject: msg.subject,
      text: msg.text,
    }),
  });
  if (!res.ok) {
    const j: any = await res.json().catch(() => ({}));
    throw new Error(`Resend 发送失败: ${res.status} ${j.message || ""}`.trim());
  }
}

// ---------------- 统一入口 ----------------

export async function sendMail(msg: MailMessage): Promise<{ ok: boolean; status: string }> {
  let status: string;

  try {
    if (DRIVER === "mock") {
      console.log(`[mail:mock] to=${msg.to} type=${msg.type} subject="${msg.subject}"\n${msg.text}`);
      status = "mock";
    } else if (DRIVER === "directmail") {
      await sendViaDirectMail(msg);
      status = "sent";
    } else if (DRIVER === "resend") {
      await sendViaResend(msg);
      status = "sent";
    } else {
      throw new Error(`unknown MAIL_DRIVER: ${DRIVER}`);
    }
  } catch (err) {
    console.error(`[mail:${DRIVER}] 发送失败 to=${msg.to} type=${msg.type}:`, err instanceof Error ? err.message : err);
    status = "failed";
  }

  db.query(
    "INSERT INTO email_log(email, type, event_id, meta, subject, status, created_at) VALUES(?,?,?,?,?,?,?)"
  ).run(msg.to, msg.type, msg.eventId ?? null, msg.meta ?? null, msg.subject, status, now());

  return { ok: status !== "failed", status };
}
