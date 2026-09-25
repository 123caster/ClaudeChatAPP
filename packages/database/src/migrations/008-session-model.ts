export const sessionModelMigration = `
  ALTER TABLE sessions ADD COLUMN model_id TEXT;
  CREATE INDEX IF NOT EXISTS sessions_model_id_idx ON sessions(model_id);
`;
