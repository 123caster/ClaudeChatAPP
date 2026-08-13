export const projectEnabledMigration = `
  ALTER TABLE projects
    ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1));

  CREATE INDEX IF NOT EXISTS projects_enabled_name_idx
    ON projects(enabled, display_name COLLATE NOCASE, id);
`;
