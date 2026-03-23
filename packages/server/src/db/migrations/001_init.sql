-- Stello Server 初始 schema
-- 7 张表：users, spaces, sessions, records, session_data, session_refs, core_data

-- 用户
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key     TEXT UNIQUE NOT NULL,
  name        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Space（每个 space = 一棵 session 树 + 独立配置）
CREATE TABLE IF NOT EXISTS spaces (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label               TEXT NOT NULL,
  system_prompt       TEXT,
  consolidate_prompt  TEXT,
  config              JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Session（core SessionMeta + session SessionMeta 的超集）
-- core 的 children/refs 是派生字段，不存列
CREATE TABLE IF NOT EXISTS sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id        UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  parent_id       UUID REFERENCES sessions(id) ON DELETE SET NULL,
  label           TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'standard',
  status          TEXT NOT NULL DEFAULT 'active',
  scope           TEXT,
  depth           INT NOT NULL DEFAULT 0,
  "index"         INT NOT NULL DEFAULT 0,
  turn_count      INT NOT NULL DEFAULT 0,
  tags            TEXT[] NOT NULL DEFAULT '{}',
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_space ON sessions(space_id);
CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_id);

-- L3 对话记录（session 层和 core 层共享同一张表）
CREATE TABLE IF NOT EXISTS records (
  id           BIGSERIAL PRIMARY KEY,
  session_id   UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role         TEXT NOT NULL,
  content      TEXT NOT NULL DEFAULT '',
  tool_call_id TEXT,
  "timestamp"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata     JSONB
);
CREATE INDEX IF NOT EXISTS idx_records_session ON records(session_id);

-- Session 数据槽位（统一存 system_prompt / insight / memory / scope / index）
CREATE TABLE IF NOT EXISTS session_data (
  session_id  UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, key)
);

-- 跨分支引用
CREATE TABLE IF NOT EXISTS session_refs (
  from_id  UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  to_id    UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  PRIMARY KEY (from_id, to_id)
);

-- Space 级全局键值（L1-structured + globals）
CREATE TABLE IF NOT EXISTS core_data (
  space_id  UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  path      TEXT NOT NULL,
  value     JSONB,
  PRIMARY KEY (space_id, path)
);
