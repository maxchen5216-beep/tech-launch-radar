-- 科技圈发布会雷达 · 后端数据库初始化
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE NOT NULL,
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);

-- 验证码：只存哈希，5 分钟有效，最多尝试 5 次
CREATE TABLE IF NOT EXISTS auth_codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_codes_email ON auth_codes(email);

-- 事件：由 sync-events 从 data/events-data.js 同步；prev_* 用于官宣检测
CREATE TABLE IF NOT EXISTS events (
  id             TEXT PRIMARY KEY,
  name_zh        TEXT,
  name_en        TEXT,
  date_sort      TEXT,
  status         TEXT,
  prev_status    TEXT,
  prev_date_sort TEXT,
  official_url   TEXT,
  updated_at     TEXT
);

-- 订阅：mode = before_event(confirmed, 提前 lead_days 天) | on_announce(expected/rumored, 官宣时通知)
CREATE TABLE IF NOT EXISTS subscriptions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  event_id    TEXT NOT NULL,
  mode        TEXT NOT NULL CHECK (mode IN ('before_event','on_announce')),
  lead_days   INTEGER,
  status      TEXT NOT NULL DEFAULT 'active',  -- active | fired
  created_at  TEXT NOT NULL,
  UNIQUE(user_id, event_id)
);

-- 邮件日志：幂等去重 + 成本闸依据。mock 驱动下 status='mock'（未真实发送）
CREATE TABLE IF NOT EXISTS email_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL,
  type        TEXT NOT NULL,   -- code | reminder | announce
  event_id    TEXT,
  meta        TEXT,            -- reminder: "lead_days:date_sort"（改期后会再次提醒）
  subject     TEXT,
  status      TEXT NOT NULL,   -- mock | sent | failed
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_log_dedupe ON email_log(email, type, event_id, meta);

-- 频率限制桶
CREATE TABLE IF NOT EXISTS rate_limit (
  bucket_key  TEXT PRIMARY KEY,
  count       INTEGER NOT NULL DEFAULT 0,
  window_end  INTEGER NOT NULL  -- unix 秒
);

-- 任务元数据（cron 每日只跑一次的守卫等）
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
