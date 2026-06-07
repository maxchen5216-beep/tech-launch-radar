import { db, localDateStr, localDayStartISO } from "./db";
import { sendMail, alreadySent, sentToday } from "./mail";

// 成本闸：全局每日提醒上限 / 单用户每日提醒上限
const DAILY_GLOBAL_CAP = Number(process.env.REMINDER_DAILY_CAP || 500);
const DAILY_PER_USER_CAP = 5;

/**
 * 扫描临近事件并发送提醒（mock 驱动下仅记录到 email_log，不真实发送）。
 * 触发条件：event.status = confirmed 且 date_sort - lead_days == today。
 * 幂等键含 lead_days 与 date_sort：事件改期后会按新日期再次提醒。
 */
export async function scanReminders(today: string = localDateStr()): Promise<{ checked: number; sent: number; skipped: number }> {
  const rows = db
    .query(
      `SELECT s.id AS sub_id, s.lead_days, u.email,
              e.id AS event_id, e.name_zh, e.name_en, e.date_sort, e.official_url
       FROM subscriptions s
       JOIN users u ON u.id = s.user_id
       JOIN events e ON e.id = s.event_id
       WHERE s.mode = 'before_event' AND s.status = 'active' AND e.status = 'confirmed'`
    )
    .all() as {
    sub_id: number;
    lead_days: number;
    email: string;
    event_id: string;
    name_zh: string;
    name_en: string;
    date_sort: string;
    official_url: string;
  }[];

  let sent = 0;
  let skipped = 0;

  for (const r of rows) {
    // 目标提醒日 = 事件日期 - lead_days
    const target = new Date(r.date_sort + "T00:00:00");
    target.setDate(target.getDate() - r.lead_days);
    if (localDateStr(target) !== today) continue;

    const msg = {
      to: r.email,
      type: "reminder" as const,
      eventId: r.event_id,
      meta: `${r.lead_days}:${r.date_sort}`,
      subject: `【科技圈发布会雷达】${r.name_zh} 还有 ${r.lead_days} 天开始`,
      text: `您订阅的「${r.name_zh} / ${r.name_en}」将于 ${r.date_sort} 举行（还有 ${r.lead_days} 天）。\n官方信息源：${r.official_url}`,
    };

    if (alreadySent(msg)) { skipped++; continue; }
    if (sentToday("reminder") >= DAILY_GLOBAL_CAP) {
      console.warn(`[reminders] 已达全局日上限 ${DAILY_GLOBAL_CAP}，熔断剩余发送`);
      break;
    }
    const userToday = db
      .query("SELECT COUNT(*) AS n FROM email_log WHERE email = ? AND type = 'reminder' AND created_at >= ? AND status != 'failed'")
      .get(r.email, localDayStartISO()) as { n: number };
    if (userToday.n >= DAILY_PER_USER_CAP) { skipped++; continue; }

    await sendMail(msg);
    sent++;
  }

  return { checked: rows.length, sent, skipped };
}
