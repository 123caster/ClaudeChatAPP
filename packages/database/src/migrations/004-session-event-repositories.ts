export const sessionEventRepositoriesMigration = `
  CREATE INDEX IF NOT EXISTS sessions_updated_at_idx
    ON sessions(updated_at DESC, id);

  CREATE INDEX IF NOT EXISTS messages_session_created_at_idx
    ON messages(session_id, created_at, id);

  CREATE INDEX IF NOT EXISTS tool_calls_session_created_at_idx
    ON tool_calls(session_id, created_at, id);

  CREATE INDEX IF NOT EXISTS permission_requests_unresolved_idx
    ON permission_requests(expires_at, id)
    WHERE decision IS NULL AND resolved_at IS NULL;

  CREATE TABLE IF NOT EXISTS write_requests (
    request_id TEXT PRIMARY KEY,
    operation TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    completed_at TEXT NOT NULL
  ) STRICT;
`;
