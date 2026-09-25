import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { HealthResponse } from '@claude-chat/protocol';

import type { AttachmentService } from './attachments/attachment-service.js';
import { AuthFailureLimiter } from './auth/auth-failure-limiter.js';
import { createAuthenticationHook } from './auth/authenticate.js';
import type { DeviceAuthService } from './auth/device-auth-service.js';
import type { PairingCodeService } from './auth/pairing-code-service.js';
import type { ProjectRegistry } from './projects/project-registry.js';
import type { ModelService } from './models/model-service.js';
import type { ModeService } from './mode/mode-service.js';
import type { SkillService } from './skills/skill-service.js';
import type { EventStore } from './events/event-store.js';
import type { EventStream } from './events/event-stream.js';
import { registerHealthRoute } from './routes/health.js';
import { registerEventRoute } from './routes/events.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerModelRoutes } from './routes/models.js';
import { registerModeRoutes } from './routes/mode.js';
import { registerPairingRoute } from './routes/pairing.js';
import { registerSkillRoutes } from './routes/skills.js';
import { registerAttachmentRoutes } from './routes/attachments.js';
import { registerScheduledTaskRoutes } from './routes/scheduled-tasks.js';
import type { ScheduledRunService } from './scheduled/scheduled-run-service.js';
import type { ScheduledTaskService } from './scheduled/scheduled-task-service.js';
import type { PushService } from './push/push-service.js';
import { registerPushSubscriptionRoutes } from './routes/push-subscriptions.js';
import type { SessionService } from './sessions/session-service.js';
import { GATEWAY_VERSION } from './version.js';

export type GatewayServices = {
  projects: ProjectRegistry;
  attachments?: AttachmentService;
  models?: ModelService;
  mode?: ModeService;
  skills?: SkillService;
  events?: EventStore;
  eventStream?: EventStream;
  sessions?: SessionService;
  deviceAuth?: DeviceAuthService;
  pairingCodes?: PairingCodeService;
  scheduledRuns?: ScheduledRunService;
  scheduledTasks?: ScheduledTaskService;
  push?: PushService;
};

export type BuildAppOptions = {
  logger?: FastifyServerOptions['logger'];
  gatewayVersion?: string;
  apiKey?: string;
  claudeHealth?: () => HealthResponse['claude'] | Promise<HealthResponse['claude']>;
  certificateHealth?: () =>
    | NonNullable<HealthResponse['certificate']>
    | Promise<NonNullable<HealthResponse['certificate']>>;
  pushHealth?: () =>
    NonNullable<HealthResponse['push']> | Promise<NonNullable<HealthResponse['push']>>;
  authFailureLimiter?: AuthFailureLimiter;
  services?: GatewayServices;
};

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false, trustProxy: '127.0.0.1' });
  app.decorateRequest('device', null);

  const authenticate = createAuthenticationHook({
    deviceAuth: options.services?.deviceAuth,
    legacyApiKey: options.apiKey,
    limiter:
      options.authFailureLimiter ??
      new AuthFailureLimiter({ maxFailures: 5, failureWindowMs: 5 * 60 * 1_000 }),
  });
  app.addHook('onRequest', async (request, reply) => {
    if (request.headers.upgrade === 'websocket') return;
    await authenticate(request, reply);
  });
  app.addHook('preValidation', async (request, reply) => {
    if (request.ws !== true) return;
    await authenticate(request, reply);
  });

  registerHealthRoute(app, {
    gatewayVersion: options.gatewayVersion ?? GATEWAY_VERSION,
    pairingAvailable: () => options.services?.pairingCodes?.isAvailable() ?? false,
    claudeHealth: options.claudeHealth ?? (() => ({ status: 'starting' })),
    ...(options.certificateHealth ? { certificateHealth: options.certificateHealth } : {}),
    ...(options.pushHealth ? { pushHealth: options.pushHealth } : {}),
  });

  if (options.services) {
    if (options.services.deviceAuth && options.services.pairingCodes) {
      registerPairingRoute(app, {
        deviceAuth: options.services.deviceAuth,
        pairingCodes: options.services.pairingCodes,
      });
    }
    registerProjectRoutes(app, options.services);
    if (options.services.attachments) {
      registerAttachmentRoutes(app, { attachments: options.services.attachments });
    }
    if (options.services.models) {
      registerModelRoutes(app, { models: options.services.models });
    }
    if (options.services.mode) {
      registerModeRoutes(app, { mode: options.services.mode });
    }
    if (options.services.skills) {
      registerSkillRoutes(app, { skills: options.services.skills });
    }
    if (options.services.sessions) {
      registerSessionRoutes(app, { sessions: options.services.sessions });
    }
    if (options.services.scheduledTasks && options.services.scheduledRuns) {
      registerScheduledTaskRoutes(app, {
        tasks: options.services.scheduledTasks,
        runs: options.services.scheduledRuns,
      });
    }
    if (options.services.push) {
      registerPushSubscriptionRoutes(app, { push: options.services.push });
    }
    if (options.services.events && options.services.eventStream && options.services.sessions) {
      registerEventRoute(app, {
        events: options.services.events,
        eventStream: options.services.eventStream,
        sessions: options.services.sessions,
        gatewayVersion: options.gatewayVersion ?? GATEWAY_VERSION,
      });
    }
  }

  return app;
}
