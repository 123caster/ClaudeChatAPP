export const sessionInterruptionReasonMigration = `
  ALTER TABLE sessions ADD COLUMN interruption_reason TEXT;
`;
