import { closeDatabase, createDatabase } from '@claude-chat/database';

import { buildApp } from './app.js';
import { DeviceAuthService } from './auth/device-auth-service.js';
import { PairingCodeService } from './auth/pairing-code-service.js';
import { AgentSdkClaudeAdapter } from './claude/agent-sdk-adapter.js';
import type { ClaudeAdapter } from './claude/claude-adapter.js';
import { ClaudeHealthMonitor } from './claude/claude-health.js';
import { FakeClaudeAdapter } from './claude/fake-claude-adapter.js';
import { loadGatewayConfig } from './config.js';
import { EventStore } from './events/event-store.js';
import { EventStream } from './events/event-stream.js';
import { gatewayUrls } from './network-addresses.js';
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
const adapter: ClaudeAdapter =
  config.claude.adapter === 'agent-sdk'
    ? new AgentSdkClaudeAdapter({
        ...(config.claude.executablePath ? { executablePath: config.claude.executablePath } : {}),
        ...(config.claude.model ? { model: config.claude.model } : {}),
      })
    : new FakeClaudeAdapter();
const claudeHealth = new ClaudeHealthMonitor(
  config.claude.executablePath ?? (process.platform === 'win32' ? 'claude.cmd' : 'claude'),
);
void claudeHealth.refresh();
const sessions = new SessionService(database, projects, adapter, events);
const recovery = sessions.recoverOnStartup();

const app = buildApp({
  logger: true,
  apiKey: config.apiKey,
  claudeHealth: () =>
    config.claude.adapter === 'fake'
      ? { status: 'ready', message: 'Fake Claude adapter is active.' }
      : claudeHealth.snapshot(),
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

if (config.claude.adapter !== 'fake' && config.host === '0.0.0.0' && !config.apiKey) {
  process.stderr.write(
    'WARNING: The gateway is accepting network connections without an API key. ' +
      'Set GATEWAY_API_KEY before exposing it outside your local network.\n',
  );
}

await app.listen({ host: config.host, port: config.port });

const addresses = gatewayUrls(config.host, config.port);
if (addresses.length === 0) {
  process.stdout.write(
    `Gateway is listening on port ${config.port}, but no LAN IPv4 address was detected.\n`,
  );
} else {
  process.stdout.write(`Enter this Gateway address on the phone:\n${addresses.join('\n')}\n`);
}

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
