import { join } from "node:path";
import { db, now } from "./db";
import { sendMail, alreadySent } from "./mail";

const DATA_FILE = join(import.meta.dir, "..", "..", "data", "events-data.js");

interface EventRow {
  id: string;
  name_zh: string;
  name_en: string;
  date_sort: string;
  status: string;
  official_url: string;
}

/** 从 data/events-data.js 中提取事件数组（文件为 window.EVENTS_DATA = {...}; 形式，对象体是合法 JSON） */
async function loadEventsFromFile(): Promise<EventRow[]> {
  const src = await Bun.file(DATA_FILE).text();
  const m = src.match(/window\.EVENTS_DATA\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
  if (!m) throw new Error("无法解析 events-data.js（未找到 window.EVENTS_DATA 赋值）");
  const data = JSON.parse(m[1]);
  if (!Array.isArray(data.events)) throw new Error("events-data.js 缺少 events 数组");
  return data.events as EventRow[];
}

/**
 * 同步事件到数据库，并检测「expected/rumored → confirmed」官宣升级，
 * 对 on_announce 订阅者发送官宣通知（mock 驱动下仅记录，不真实发送）。
 */
export async function syncEvents(): Promise<{ synced: number; announced: string[] }> {
  const events = await loadEventsFromFile();
  const announced: string[] = [];

  for (const e of events) {
    const old = db.query("SELECT status, date_sort FROM events WHERE id = ?").get(e.id) as
      | { status: string; date_sort: string }
      | null;

    db.query(
      `INSERT INTO events(id, name_zh, name_en, date_sort, status, prev_status, prev_date_sort, official_url, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         name_zh = excluded.name_zh, name_en = excluded.name_en,
         prev_status = events.status, prev_date_sort = events.date_sort,
         date_sort = excluded.date_sort, status = excluded.status,
         official_url = excluded.official_url, updated_at = excluded.updated_at`
    ).run(e.id, e.name_zh, e.name_en, e.date_sort, e.status, old?.status ?? null, old?.date_sort ?? null, e.official_url, now());

    // 官宣检测：原为 expected/rumored，现升级为 confirmed
    if (old && old.status !== "confirmed" && e.status === "confirmed") {
      announced.push(e.id);
      const subs = db
        .query(
          `SELECT u.email FROM subscriptions s JOIN users u ON u.id = s.user_id
           WHERE s.event_id = ? AND s.mode = 'on_announce' AND s.status = 'active'`
        )
        .all(e.id) as { email: string }[];

      for (const { email } of subs) {
        const msg = {
          to: email,
          type: "announce" as const,
          eventId: e.id,
          meta: e.date_sort,
          subject: `【科技圈发布会雷达】${e.name_zh} 已官宣定档`,
          text: `您关注的「${e.name_zh} / ${e.name_en}」已官宣，时间：${e.date_sort}。\n官方信息源：${e.official_url}\n回到网站可设置开始前提醒。`,
        };
        if (!alreadySent(msg)) await sendMail(msg);
      }
      db.query("UPDATE subscriptions SET status = 'fired' WHERE event_id = ? AND mode = 'on_announce' AND status = 'active'").run(e.id);
    }
  }

  return { synced: events.length, announced };
}
