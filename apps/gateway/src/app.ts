import Fastify, { type FastifyInstance } from 'fastify';

import { registerHealthRoute } from './routes/health.js';
import { GATEWAY_VERSION } from './version.js';

export type BuildAppOptions = {
  logger?: boolean;
  gatewayVersion?: string;
};

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  registerHealthRoute(app, {
    gatewayVersion: options.gatewayVersion ?? GATEWAY_VERSION,
  });

  return app;
}
