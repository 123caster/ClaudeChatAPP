import { closeDatabase, createDatabase } from '@claude-chat/database';

import { buildApp } from './app.js';
import { DeviceAuthService } from './auth/device-auth-service.js';
import { PairingCodeService } from './auth/pairing-code-service.js';
import { loadGatewayConfig } from './config.js';
import { ProjectRegistry } from './projects/project-registry.js';

const config = loadGatewayConfig();
const database = createDatabase(config.databasePath);
const projects = new ProjectRegistry(database.projects);
projects.synchronize(config.projects);

const deviceAuth = new DeviceAuthService(database.devices);
const pairingCodes = new PairingCodeService(config.pairing);
const pairing = deviceAuth.hasActiveDevice() ? null : pairingCodes.issue();

const app = buildApp({ logger: true, services: { deviceAuth, pairingCodes, projects } });
app.addHook('onClose', async () => {
  closeDatabase(database);
});

const shutdown = async (): Promise<void> => {
  await app.close();
  process.exit(0);
};

process.once('SIGINT', () => {
  void shutdown();
});

process.once('SIGTERM', () => {
  void shutdown();
});

await app.listen({ host: config.host, port: config.port });

if (pairing) {
  process.stdout.write(
    `ClaudeChatAPP pairing code: ${pairing.code} (expires ${pairing.expiresAt.toISOString()})\n`,
  );
}
