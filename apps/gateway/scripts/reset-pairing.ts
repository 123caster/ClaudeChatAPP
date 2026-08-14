import { closeDatabase, createDatabase } from '@claude-chat/database';

import { loadGatewayConfig } from '../src/config.js';

const config = loadGatewayConfig();
const database = createDatabase(config.databasePath);

try {
  const revoked = database.devices.revokeAllActive(new Date().toISOString());
  process.stdout.write(
    revoked > 0
      ? `Revoked ${revoked} paired device. Restart Gateway to generate a new pairing code.\n`
      : 'No active paired device was found. Gateway will issue a pairing code when it starts.\n',
  );
} finally {
  closeDatabase(database);
}
