import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const SERVER_DIR = join(import.meta.dir, "..");
const DATA_DIR = join(SERVER_DIR, ".data");
mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(join(DATA_DIR, "app.db"), { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

// 启动时执行迁移（幂等）
const migration = await Bun.file(join(SERVER_DIR, "migrations", "001_init.sql")).text();
db.exec(migration);

// 轻量列迁移：老库补充 users 新列（向后兼容，网页版不受影响）
const userInfo = db.query("PRAGMA table_info(users)").all() as { name: string; notnull: number }[];
const userCols = userInfo.map((c) => c.name);
if (!userCols.includes("nickname")) db.exec("ALTER TABLE users ADD COLUMN nickname TEXT");
if (!userCols.includes("avatar")) db.exec("ALTER TABLE users ADD COLUMN avatar TEXT");
if (!userCols.includes("openid")) db.exec("ALTER TABLE users ADD COLUMN openid TEXT");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_openid ON users(openid) WHERE openid IS NOT NULL");

// 老库 email 为 NOT NULL → 重建表使其可空（小程序用户无 email）。SQLite 不能直接去 NOT NULL。
const emailCol = userInfo.find((c) => c.name === "email");
if (emailCol && emailCol.notnull === 1) {
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec(`
    CREATE TABLE users_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE, openid TEXT, nickname TEXT, avatar TEXT,
      created_at TEXT NOT NULL, last_login_at TEXT
    );
    INSERT INTO users_new (id, email, openid, nickname, avatar, created_at, last_login_at)
      SELECT id, email, openid, nickname, avatar, created_at, last_login_at FROM users;
    DROP TABLE users;
    ALTER TABLE users_new RENAME TO users;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_openid ON users(openid) WHERE openid IS NOT NULL;
  `);
  db.exec("PRAGMA foreign_keys = ON");
}

// 订阅表补 wx_credit（微信一次性订阅额度）
const subCols = (db.query("PRAGMA table_info(subscriptions)").all() as { name: string }[]).map((c) => c.name);
if (subCols.length && !subCols.includes("wx_credit")) db.exec("ALTER TABLE subscriptions ADD COLUMN wx_credit INTEGER NOT NULL DEFAULT 0");

// 用户上传头像目录
export const AVATAR_DIR = join(DATA_DIR, "avatars");
mkdirSync(AVATAR_DIR, { recursive: true });

export const now = () => new Date().toISOString();

/** 本地日期 YYYY-MM-DD（提醒触发以服务器本地时区为准） */
export function localDateStr(d: Date = new Date()): string {
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

/**
 * 当前本地日「零点」对应的 UTC ISO 时刻。
 * 用于与 created_at（UTC ISO）做「今天以来」的比较——无论服务器时区如何都正确，
 * 修复 localDateStr(本地) 与 created_at(UTC) 直接字符串比较的 8 小时错位。
 */
export function localDayStartISO(d: Date = new Date()): string {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).toISOString();
}

export function metaGet(key: string): string | null {
  const row = db.query("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | null;
  return row?.value ?? null;
}

export function metaSet(key: string, value: string): void {
  db.query("INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}
