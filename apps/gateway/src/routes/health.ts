import { PROTOCOL_VERSION, type HealthResponse } from '@claude-chat/protocol';
import type { FastifyInstance } from 'fastify';

type HealthRouteOptions = {
  gatewayVersion: string;
  pairingAvailable: () => boolean;
};

export function registerHealthRoute(
  app: FastifyInstance,
  { gatewayVersion, pairingAvailable }: HealthRouteOptions,
): void {
  app.get('/v1/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    gatewayVersion,
    protocolVersion: PROTOCOL_VERSION,
    claude: {
      status: 'starting',
    },
    database: {
      status: 'ready',
    },
    config: {
      status: 'ready',
    },
    pairing: {
      available: pairingAvailable(),
    },
  }));
}
