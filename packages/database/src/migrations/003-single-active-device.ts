export const singleActiveDeviceMigration = `
  CREATE UNIQUE INDEX IF NOT EXISTS devices_single_active_idx
    ON devices((1))
    WHERE revoked_at IS NULL;
`;
