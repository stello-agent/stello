-- Session 事件日志：append-only memory / insight 事件流
CREATE TABLE IF NOT EXISTS session_events (
  id              BIGSERIAL PRIMARY KEY,
  space_id        UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  stream          TEXT NOT NULL,
  session_id      UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  content         TEXT NOT NULL,
  event_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (stream IN ('memory', 'insight'))
);

CREATE INDEX IF NOT EXISTS idx_session_events_stream_id
  ON session_events(space_id, stream, id);

CREATE INDEX IF NOT EXISTS idx_session_events_session_stream_id
  ON session_events(session_id, stream, id);
