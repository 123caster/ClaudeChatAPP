export const sessionWorkingDirectoryMigration = `
  ALTER TABLE sessions ADD COLUMN working_directory TEXT;
`;
