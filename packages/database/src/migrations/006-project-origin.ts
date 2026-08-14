export const projectOriginMigration = `
  ALTER TABLE projects
    ADD COLUMN origin TEXT NOT NULL DEFAULT 'config' CHECK (origin IN ('config', 'user'));
`;
