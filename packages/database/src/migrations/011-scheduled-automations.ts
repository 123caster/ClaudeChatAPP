export const scheduledAutomationsMigration = `
  ALTER TABLE sessions
    ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat'
    CHECK (kind IN ('chat', 'scheduled'));

  CREATE INDEX sessions_kind_updated_idx
    ON sessions(kind, updated_at DESC);

  CREATE TABLE scheduled_tasks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    prompt TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'completed', 'deleted')),
    trigger_type TEXT NOT NULL DEFAULT 'time' CHECK (trigger_type = 'time'),
    schedule_json TEXT NOT NULL CHECK (json_valid(schedule_json)),
    timezone TEXT NOT NULL,
    next_run_at TEXT,
    last_run_at TEXT,
    session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE RESTRICT,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    working_directory TEXT,
    model_id TEXT REFERENCES models(id) ON DELETE SET NULL,
    allow_auto_write INTEGER NOT NULL DEFAULT 0 CHECK (allow_auto_write IN (0, 1)),
    notification_policy TEXT NOT NULL DEFAULT 'all_results'
      CHECK (notification_policy = 'all_results'),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    CHECK (
      (status = 'deleted' AND deleted_at IS NOT NULL) OR
      (status <> 'deleted' AND deleted_at IS NULL)
    )
  ) STRICT;

  CREATE INDEX scheduled_tasks_status_next_run_idx
    ON scheduled_tasks(status, next_run_at)
    WHERE deleted_at IS NULL;
  CREATE INDEX scheduled_tasks_project_idx
    ON scheduled_tasks(project_id, updated_at DESC)
    WHERE deleted_at IS NULL;

  CREATE TABLE scheduled_runs (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
    scheduled_for TEXT NOT NULL,
    trigger_source TEXT NOT NULL CHECK (trigger_source IN ('scheduled', 'manual', 'recovery')),
    status TEXT NOT NULL CHECK (
      status IN ('queued', 'running', 'waiting_permission', 'succeeded', 'failed', 'skipped', 'cancelled')
    ),
    request_id TEXT NOT NULL UNIQUE,
    user_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
    assistant_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    started_at TEXT,
    completed_at TEXT,
    error_code TEXT,
    error_message TEXT,
    lease_owner TEXT,
    lease_expires_at TEXT,
    notification_status TEXT NOT NULL DEFAULT 'not_requested'
      CHECK (notification_status IN ('not_requested', 'pending', 'sent', 'failed')),
    read_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(task_id, scheduled_for),
    CHECK (
      (status IN ('succeeded', 'failed', 'skipped', 'cancelled') AND completed_at IS NOT NULL) OR
      (status IN ('queued', 'running', 'waiting_permission') AND completed_at IS NULL)
    )
  ) STRICT;

  CREATE INDEX scheduled_runs_task_time_idx
    ON scheduled_runs(task_id, scheduled_for DESC, id);
  CREATE UNIQUE INDEX scheduled_runs_one_active_per_task_idx
    ON scheduled_runs(task_id)
    WHERE status IN ('queued', 'running', 'waiting_permission');
  CREATE INDEX scheduled_runs_recovery_idx
    ON scheduled_runs(status, lease_expires_at)
    WHERE status IN ('running', 'waiting_permission');

  CREATE TABLE push_subscriptions (
    device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider = 'expo'),
    platform TEXT NOT NULL CHECK (platform = 'android'),
    token TEXT NOT NULL UNIQUE,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    disabled_at TEXT,
    CHECK (
      (enabled = 1 AND disabled_at IS NULL) OR
      (enabled = 0 AND disabled_at IS NOT NULL)
    )
  ) STRICT;

  CREATE INDEX push_subscriptions_enabled_idx
    ON push_subscriptions(enabled, updated_at DESC)
    WHERE enabled = 1;
`;
