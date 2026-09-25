export const attachmentsAndModelCapabilitiesMigration = `
  ALTER TABLE models
    ADD COLUMN supports_images INTEGER NOT NULL DEFAULT 0
    CHECK (supports_images IN (0, 1));

  ALTER TABLE models
    ADD COLUMN supports_documents INTEGER NOT NULL DEFAULT 0
    CHECK (supports_documents IN (0, 1));

  ALTER TABLE models
    ADD COLUMN is_multimodal_default INTEGER NOT NULL DEFAULT 0
    CHECK (is_multimodal_default IN (0, 1));

  CREATE UNIQUE INDEX models_one_multimodal_default_idx
    ON models(is_multimodal_default)
    WHERE is_multimodal_default = 1;

  CREATE TABLE attachments (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    draft_id TEXT NOT NULL,
    session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
    message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('image', 'document')),
    name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL CHECK (size >= 0 AND size <= 20971520),
    storage_name TEXT,
    preview_name TEXT,
    status TEXT NOT NULL CHECK (status IN ('ready', 'bound')),
    original_expires_at TEXT,
    created_at TEXT NOT NULL,
    bound_at TEXT,
    CHECK (
      (status = 'ready' AND message_id IS NULL AND bound_at IS NULL) OR
      (status = 'bound' AND session_id IS NOT NULL AND message_id IS NOT NULL AND bound_at IS NOT NULL)
    )
  ) STRICT;

  CREATE INDEX attachments_device_draft_status_idx
    ON attachments(device_id, draft_id, status, created_at);
  CREATE INDEX attachments_message_idx ON attachments(message_id);
  CREATE INDEX attachments_expiry_idx
    ON attachments(original_expires_at)
    WHERE storage_name IS NOT NULL AND original_expires_at IS NOT NULL;
`;
