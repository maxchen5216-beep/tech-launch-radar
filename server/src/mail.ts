import { db, now } from "./db";

/**
 * 邮件发送抽象层。
 *
 * 当前按用户要求【邮件推送功能暂不上线】：默认 mock 驱动 ——
 * 不发送任何真实邮件，仅打印到服务端日志并写入 email_log（status='mock'）。
 *
 * 上线时切换：设置环境变量 MAIL_DRIVER=resend（或 directmail）并配置对应密钥，
 * 在下方补全真实驱动实现即可，业务代码无需改动。
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

/** 已发送过相同 (email,type,event_id,meta) 则返回 true（幂等去重） */
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
    ? (db.query("SELECT COUNT(*) AS n FROM email_log WHERE type = ? AND created_at >= ?").get(type, today) as { n: number })
    : (db.query("SELECT COUNT(*) AS n FROM email_log WHERE created_at >= ?").get(today) as { n: number });
  return row.n;
}

export async function sendMail(msg: MailMessage): Promise<{ ok: boolean; status: string }> {
  let status = "mock";

  if (DRIVER === "mock") {
    console.log(`[mail:mock] to=${msg.to} type=${msg.type} subject="${msg.subject}"\n${msg.text}`);
  } else if (DRIVER === "resend") {
    // TODO(上线时实现): 调用 Resend API，需 RESEND_API_KEY 与已验证发信域名
    // https://resend.com/docs/api-reference/emails/send-email
    throw new Error("resend driver not configured yet — 邮件推送功能尚未上线");
  } else if (DRIVER === "directmail") {
    // TODO(上线时实现): 阿里云邮件推送 DirectMail，需 AK/SK 与已验证发信域名
    throw new Error("directmail driver not configured yet — 邮件推送功能尚未上线");
  } else {
    throw new Error(`unknown MAIL_DRIVER: ${DRIVER}`);
  }

  db.query(
    "INSERT INTO email_log(email, type, event_id, meta, subject, status, created_at) VALUES(?,?,?,?,?,?,?)"
  ).run(msg.to, msg.type, msg.eventId ?? null, msg.meta ?? null, msg.subject, status, now());

  return { ok: true, status };
}
