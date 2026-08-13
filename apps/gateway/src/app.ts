import Fastify, { type FastifyInstance } from 'fastify';

import type { DeviceAuthService } from './auth/device-auth-service.js';
import type { PairingCodeService } from './auth/pairing-code-service.js';
import type { ProjectRegistry } from './projects/project-registry.js';
import type { EventStore } from './events/event-store.js';
import type { EventStream } from './events/event-stream.js';
import { registerHealthRoute } from './routes/health.js';
import { registerEventRoute } from './routes/events.js';
import { registerPairingRoute } from './routes/pairing.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerSessionRoutes } from './routes/sessions.js';
import type { SessionService } from './sessions/session-service.js';
import { GATEWAY_VERSION } from './version.js';

export type GatewayServices = {
  deviceAuth: DeviceAuthService;
  pairingCodes: PairingCodeService;
  projects: ProjectRegistry;
  events?: EventStore;
  eventStream?: EventStream;
  sessions?: SessionService;
};

export type BuildAppOptions = {
  logger?: boolean;
  gatewayVersion?: string;
  services?: GatewayServices;
};

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  registerHealthRoute(app, {
    gatewayVersion: options.gatewayVersion ?? GATEWAY_VERSION,
    pairingAvailable: () => options.services?.pairingCodes.isAvailable() ?? false,
  });

  if (options.services) {
    app.decorateRequest('device', null);
    registerPairingRoute(app, options.services);
    registerProjectRoutes(app, options.services);
    if (options.services.sessions) {
      registerSessionRoutes(app, {
        deviceAuth: options.services.deviceAuth,
        sessions: options.services.sessions,
      });
    }
    if (options.services.events && options.services.eventStream && options.services.sessions) {
      registerEventRoute(app, {
        deviceAuth: options.services.deviceAuth,
        events: options.services.events,
        eventStream: options.services.eventStream,
        sessions: options.services.sessions,
        gatewayVersion: options.gatewayVersion ?? GATEWAY_VERSION,
      });
    }
  }

  return app;
}
