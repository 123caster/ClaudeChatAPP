import { dirname, resolve } from 'node:path';

import { closeDatabase, createDatabase } from '@claude-chat/database';

import { buildApp } from './app.js';
import { AttachmentContentService } from './attachments/attachment-content-service.js';
import { AttachmentService } from './attachments/attachment-service.js';
import { AttachmentStorage } from './attachments/attachment-storage.js';
import { DeviceAuthService } from './auth/device-auth-service.js';
import { PairingCodeService } from './auth/pairing-code-service.js';
import { AgentSdkClaudeAdapter } from './claude/agent-sdk-adapter.js';
import type { ClaudeAdapter } from './claude/claude-adapter.js';
import { ClaudeHealthMonitor } from './claude/claude-health.js';
import { FakeClaudeAdapter } from './claude/fake-claude-adapter.js';
import { MultimodalRouter, type MultimodalDiagnosticSink } from './claude/multimodal-router.js';
import { loadGatewayConfig } from './config.js';
import { EventStore } from './events/event-store.js';
import { EventStream } from './events/event-stream.js';
import { gatewayUrls } from './network-addresses.js';
import { ProjectRegistry } from './projects/project-registry.js';
import { ExpoPushClient } from './push/expo-push-client.js';
import { PushService } from './push/push-service.js';
import { ModelService } from './models/model-service.js';
import { ModeService } from './mode/mode-service.js';
import { gatewayLoggerOptions, startGatewayLogRetention } from './logging/gateway-logs.js';
import { SkillService } from './skills/skill-service.js';
import { ScheduledRunService } from './scheduled/scheduled-run-service.js';
import { ScheduledTaskRunner } from './scheduled/scheduled-task-runner.js';
import { ScheduledTaskService } from './scheduled/scheduled-task-service.js';
import { TaskScheduler } from './scheduled/task-scheduler.js';
import { SessionService } from './sessions/session-service.js';
import { readCertificateHealth } from './tls/certificate-health.js';

const config = loadGatewayConfig();
const database = createDatabase(config.databasePath);
const projects = new ProjectRegistry(database.projects);
projects.synchronize(config.projects);
const models = new ModelService(database.models, undefined, database.sessions);
const mode = new ModeService();
const skills = new SkillService();
const deviceAuth = new DeviceAuthService(database.devices);
const pairingCodes = new PairingCodeService(config.pairing);
const attachments = new AttachmentService(
  database,
  new AttachmentStorage(resolve(dirname(config.databasePath), 'attachments')),
);
let writeMultimodalDiagnostic: MultimodalDiagnosticSink = () => undefined;
const multimodal = new MultimodalRouter(
  new AttachmentContentService(attachments),
  models,
  undefined,
  (diagnostic) => writeMultimodalDiagnostic(diagnostic),
);

const issuePairingCode = (): void => {
  if (deviceAuth.hasActiveDevice()) {
    process.stdout.write('Pairing code was not issued because an active device already exists.\n');
    return;
  }
  const pairing = pairingCodes.issue();
  process.stdout.write(
    `One-time pairing code: ${pairing.code} (expires ${pairing.expiresAt.toISOString()})\n`,
  );
};

if (!deviceAuth.hasActiveDevice()) issuePairingCode();

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
const sessions = new SessionService(
  database,
  projects,
  adapter,
  events,
  undefined,
  models,
  mode,
  attachments,
  multimodal,
);
const recovery = sessions.recoverOnStartup();
const scheduledTasks = new ScheduledTaskService(database, projects, events, undefined, models);
const scheduledTaskRunnerRef: { current: ScheduledTaskRunner | null } = { current: null };
const scheduledRuns = new ScheduledRunService(database, events, undefined, (run, task) => {
  if (!scheduledTaskRunnerRef.current) throw new Error('Scheduled task runner is unavailable.');
  scheduledTaskRunnerRef.current.start(run, task);
});
const push = new PushService(
  database,
  scheduledRuns,
  config.push.enabled,
  new ExpoPushClient(config.push.expoAccessToken),
);
const stopPushReceiptPolling = push.startReceiptPolling();
const scheduledTaskRunner = new ScheduledTaskRunner(
  database,
  sessions,
  scheduledRuns,
  scheduledTasks,
  eventStream,
  undefined,
  {
    onAttention: (run, task) => push.notifyTerminal(run, task),
    onTerminal: (run, task) => push.notifyTerminal(run, task),
  },
);
scheduledTaskRunnerRef.current = scheduledTaskRunner;
const logDirectory = `${config.configDirectory}${process.platform === 'win32' ? '\\' : '/'}logs`;
const stopLogRetention = startGatewayLogRetention(logDirectory);
const stopAttachmentCleanup = attachments.startCleanup();

const app = buildApp({
  logger: gatewayLoggerOptions(logDirectory),
  apiKey: config.apiKey,
  claudeHealth: () =>
    config.claude.adapter === 'fake'
      ? { status: 'ready', message: 'Fake Claude adapter is active.' }
      : claudeHealth.snapshot(),
  certificateHealth: () => readCertificateHealth(config.tlsCertificatePath),
  pushHealth: () => push.health(),
  services: {
    projects,
    attachments,
    models,
    mode,
    skills,
    events,
    eventStream,
    sessions,
    scheduledRuns,
    scheduledTasks,
    push,
    deviceAuth,
    pairingCodes,
  },
});
const taskScheduler = new TaskScheduler(database, scheduledRuns, scheduledTasks, undefined, {
  onError: (error) => app.log.error({ error }, 'Scheduled task tick failed.'),
});
writeMultimodalDiagnostic = (diagnostic) => {
  app.log.warn({ multimodal: diagnostic }, 'Multimodal provider attempt failed.');
};
const stopTaskScheduler = taskScheduler.start();
app.addHook('onClose', async () => {
  stopTaskScheduler();
  stopPushReceiptPolling();
  scheduledTaskRunner.dispose();
  stopAttachmentCleanup();
  stopLogRetention();
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

if (process.platform !== 'win32') {
  process.on('SIGUSR2', issuePairingCode);
}

if (config.host === '0.0.0.0') {
  process.stderr.write(
    'WARNING: The gateway is bound to every interface. Bind it to 127.0.0.1 behind the HTTPS reverse proxy.\n',
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

if (recovery.sessions > 0 || recovery.permissions > 0) {
  process.stdout.write(
    `Recovered ${recovery.sessions} interrupted session(s) and ${recovery.permissions} permission request(s).\n`,
  );
}
