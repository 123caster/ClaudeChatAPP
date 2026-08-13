import Fastify, { type FastifyInstance } from 'fastify';

import type { DeviceAuthService } from './auth/device-auth-service.js';
import type { PairingCodeService } from './auth/pairing-code-service.js';
import type { ProjectRegistry } from './projects/project-registry.js';
import { registerHealthRoute } from './routes/health.js';
import { registerPairingRoute } from './routes/pairing.js';
import { registerProjectRoutes } from './routes/projects.js';
import { GATEWAY_VERSION } from './version.js';

export type GatewayServices = {
  deviceAuth: DeviceAuthService;
  pairingCodes: PairingCodeService;
  projects: ProjectRegistry;
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
  }

  return app;
}
