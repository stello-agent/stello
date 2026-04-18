-- 为 sessions 表新增 source_session_id 列，将 fork 来源从 metadata.sourceSessionId 提升为一等字段。
-- 旧数据仍保留 metadata 列中的 sourceSessionId，读取时回填。
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS source_session_id UUID REFERENCES sessions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_source ON sessions(source_session_id);
