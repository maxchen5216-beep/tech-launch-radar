import { db, localDateStr, localDayStartISO, now } from "./db";
import { sendMail, alreadySent, sentToday } from "./mail";
import { sendSubscribeMessage } from "./wx";

// 成本闸：全局每日提醒上限 / 单用户每日提醒上限
const DAILY_GLOBAL_CAP = Number(process.env.REMINDER_DAILY_CAP || 500);
const DAILY_PER_USER_CAP = 5;

/**
 * 发送一条「事件提醒」：邮箱用户走 DirectMail，小程序用户走微信订阅消息（消耗一次性额度）。
 * 复用 email_log 做幂等（小程序用户的 recipient 列存 openid）。返回是否真的发出。
 */
export async function deliverReminder(p: {
  email: string | null; openid: string | null; wxCredit: number; subId: number;
  eventId: string; name_zh: string; name_en: string; date_sort: string; official_url: string;
  type: "reminder" | "announce"; meta: string; leadDaysText: string;
}): Promise<"sent" | "skipped"> {
  if (p.openid) {
    // 小程序：微信订阅消息（一次性，需有额度）
    const recip = p.openid;
    if (alreadySent({ to: recip, type: p.type, eventId: p.eventId, meta: p.meta })) return "skipped";
    if (p.wxCredit <= 0) return "skipped"; // 用户未授权/额度用尽
    // 订阅消息模板字段需与你在 mp 后台申请的模板一致，下面 key 为占位，按实际模板调整
    const data = {
      thing1: { value: (p.name_zh || "发布会").slice(0, 20) },
      time2: { value: p.date_sort },
      thing3: { value: (p.type === "announce" ? "已官宣定档" : p.leadDaysText).slice(0, 20) },
    };
    const r = await sendSubscribeMessage(recip, data, `pages/detail/detail?id=${p.eventId}`);
    db.query("INSERT INTO email_log(email, type, event_id, meta, subject, status, created_at) VALUES(?,?,?,?,?,?,?)")
      .run(recip, p.type, p.eventId, p.meta, p.name_zh, r.ok ? "sent" : "failed", now());
    if (r.ok) db.query("UPDATE subscriptions SET wx_credit = wx_credit - 1 WHERE id = ?").run(p.subId);
    return r.ok ? "sent" : "skipped";
  }
  if (p.email) {
    const msg = {
      to: p.email, type: p.type, eventId: p.eventId, meta: p.meta,
      subject: p.type === "announce" ? `【发布时刻】${p.name_zh} 已官宣定档` : `【发布时刻】${p.name_zh} ${p.leadDaysText}`,
      text: p.type === "announce"
        ? `您关注的「${p.name_zh} / ${p.name_en}」已官宣，时间：${p.date_sort}。\n官方信息源：${p.official_url}`
        : `您订阅的「${p.name_zh} / ${p.name_en}」将于 ${p.date_sort} 举行（${p.leadDaysText}）。\n官方信息源：${p.official_url}`,
    };
    if (alreadySent(msg)) return "skipped";
    const r = await sendMail(msg);
    return r.ok ? "sent" : "skipped";
  }
  return "skipped";
}

/**
 * 扫描临近事件并发送提醒（mock 驱动下仅记录到 email_log，不真实发送）。
 * 触发条件：event.status = confirmed 且 date_sort - lead_days == today。
 * 幂等键含 lead_days 与 date_sort：事件改期后会按新日期再次提醒。
 */
export async function scanReminders(today: string = localDateStr()): Promise<{ checked: number; sent: number; skipped: number }> {
  const rows = db
    .query(
      `SELECT s.id AS sub_id, s.lead_days, s.wx_credit, u.email, u.openid,
              e.id AS event_id, e.name_zh, e.name_en, e.date_sort, e.official_url
       FROM subscriptions s
       JOIN users u ON u.id = s.user_id
       JOIN events e ON e.id = s.event_id
       WHERE s.mode = 'before_event' AND s.status = 'active' AND e.status = 'confirmed'`
    )
    .all() as {
    sub_id: number; lead_days: number; wx_credit: number;
    email: string | null; openid: string | null;
    event_id: string; name_zh: string; name_en: string; date_sort: string; official_url: string;
  }[];

  let sent = 0;
  let skipped = 0;

  for (const r of rows) {
    // 目标提醒日 = 事件日期 - lead_days
    const target = new Date(r.date_sort + "T00:00:00");
    target.setDate(target.getDate() - r.lead_days);
    if (localDateStr(target) !== today) continue;

    const meta = `${r.lead_days}:${r.date_sort}`;
    const recip = r.openid || r.email || "";
    if (alreadySent({ to: recip, type: "reminder", eventId: r.event_id, meta })) { skipped++; continue; }
    if (sentToday("reminder") >= DAILY_GLOBAL_CAP) {
      console.warn(`[reminders] 已达全局日上限 ${DAILY_GLOBAL_CAP}，熔断剩余发送`);
      break;
    }
    const userToday = db
      .query("SELECT COUNT(*) AS n FROM email_log WHERE email = ? AND type = 'reminder' AND created_at >= ? AND status != 'failed'")
      .get(recip, localDayStartISO()) as { n: number };
    if (userToday.n >= DAILY_PER_USER_CAP) { skipped++; continue; }

    const result = await deliverReminder({
      email: r.email, openid: r.openid, wxCredit: r.wx_credit, subId: r.sub_id,
      eventId: r.event_id, name_zh: r.name_zh, name_en: r.name_en, date_sort: r.date_sort, official_url: r.official_url,
      type: "reminder", meta, leadDaysText: `还有 ${r.lead_days} 天`,
    });
    if (result === "sent") sent++; else skipped++;
  }

  return { checked: rows.length, sent, skipped };
}
