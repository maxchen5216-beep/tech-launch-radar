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

export function metaGet(key: string): string | null {
  const row = db.query("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | null;
  return row?.value ?? null;
}

export function metaSet(key: string, value: string): void {
  db.query("INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}
