import { closeDatabase, createDatabase } from '@claude-chat/database';

import { buildApp } from './app.js';
import { DeviceAuthService } from './auth/device-auth-service.js';
import { PairingCodeService } from './auth/pairing-code-service.js';
import { FakeClaudeAdapter } from './claude/fake-claude-adapter.js';
import { loadGatewayConfig } from './config.js';
import { EventStore } from './events/event-store.js';
import { EventStream } from './events/event-stream.js';
import { ProjectRegistry } from './projects/project-registry.js';
import { SessionService } from './sessions/session-service.js';

const config = loadGatewayConfig();
const database = createDatabase(config.databasePath);
const projects = new ProjectRegistry(database.projects);
projects.synchronize(config.projects);

const deviceAuth = new DeviceAuthService(database.devices);
const pairingCodes = new PairingCodeService(config.pairing);
const pairing = deviceAuth.hasActiveDevice() ? null : pairingCodes.issue();
const eventStream = new EventStream();
const events = new EventStore(database.events, eventStream);
const sessions = new SessionService(database, projects, new FakeClaudeAdapter(), events);
const recovery = sessions.recoverOnStartup();

const app = buildApp({
  logger: true,
  services: { deviceAuth, pairingCodes, projects, events, eventStream, sessions },
});
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

if (recovery.sessions > 0 || recovery.permissions > 0) {
  process.stdout.write(
    `Recovered ${recovery.sessions} interrupted session(s) and ${recovery.permissions} permission request(s).\n`,
  );
}
