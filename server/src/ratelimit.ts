import { db } from "./db";

/**
 * 固定窗口限频。返回 true = 放行，false = 超限。
 * bucketKey 示例: "code:email:foo@bar.com:hour" / "code:ip:1.2.3.4:hour"
 */
export function allow(bucketKey: string, limit: number, windowSec: number): boolean {
  const nowSec = Math.floor(Date.now() / 1000);
  const row = db.query("SELECT count, window_end FROM rate_limit WHERE bucket_key = ?").get(bucketKey) as
    | { count: number; window_end: number }
    | null;

  if (!row || row.window_end <= nowSec) {
    db.query(
      "INSERT INTO rate_limit(bucket_key, count, window_end) VALUES(?, 1, ?) ON CONFLICT(bucket_key) DO UPDATE SET count = 1, window_end = excluded.window_end"
    ).run(bucketKey, nowSec + windowSec);
    return true;
  }
  if (row.count >= limit) return false;
  db.query("UPDATE rate_limit SET count = count + 1 WHERE bucket_key = ?").run(bucketKey);
  return true;
}
