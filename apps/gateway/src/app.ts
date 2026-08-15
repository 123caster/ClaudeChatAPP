import Fastify, { type FastifyInstance } from 'fastify';
import type { HealthResponse } from '@claude-chat/protocol';

import { registerApiKeyHook } from './auth/api-key.js';
import type { ProjectRegistry } from './projects/project-registry.js';
import type { ModelService } from './models/model-service.js';
import type { EventStore } from './events/event-store.js';
import type { EventStream } from './events/event-stream.js';
import { registerHealthRoute } from './routes/health.js';
import { registerEventRoute } from './routes/events.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerModelRoutes } from './routes/models.js';
import type { SessionService } from './sessions/session-service.js';
import { GATEWAY_VERSION } from './version.js';

export type GatewayServices = {
  projects: ProjectRegistry;
  models?: ModelService;
  events?: EventStore;
  eventStream?: EventStream;
  sessions?: SessionService;
};

export type BuildAppOptions = {
  logger?: boolean;
  gatewayVersion?: string;
  apiKey?: string;
  claudeHealth?: () => HealthResponse['claude'] | Promise<HealthResponse['claude']>;
  services?: GatewayServices;
};

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  registerApiKeyHook(app, options.apiKey);

  registerHealthRoute(app, {
    gatewayVersion: options.gatewayVersion ?? GATEWAY_VERSION,
    pairingAvailable: () => false,
    claudeHealth: options.claudeHealth ?? (() => ({ status: 'starting' })),
  });

  if (options.services) {
    registerProjectRoutes(app, options.services);
    if (options.services.models) {
      registerModelRoutes(app, { models: options.services.models });
    }
    if (options.services.sessions) {
      registerSessionRoutes(app, { sessions: options.services.sessions });
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
