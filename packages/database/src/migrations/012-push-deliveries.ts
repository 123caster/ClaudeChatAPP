export const pushDeliveriesMigration = `
  CREATE TABLE push_deliveries (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES scheduled_runs(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL REFERENCES push_subscriptions(device_id) ON DELETE CASCADE,
    ticket_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'delivered', 'failed')),
    error_code TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_check_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (
      (status = 'pending' AND next_check_at IS NOT NULL) OR
      (status <> 'pending' AND next_check_at IS NULL)
    )
  ) STRICT;

  CREATE INDEX push_deliveries_due_idx
    ON push_deliveries(next_check_at, id)
    WHERE status = 'pending';
  CREATE INDEX push_deliveries_run_idx
    ON push_deliveries(run_id, created_at DESC);
`;
