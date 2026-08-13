import { PROTOCOL_VERSION, type HealthResponse } from '@claude-chat/protocol';
import type { FastifyInstance } from 'fastify';

type HealthRouteOptions = {
  gatewayVersion: string;
  pairingAvailable: () => boolean;
  claudeHealth: () => HealthResponse['claude'] | Promise<HealthResponse['claude']>;
};

export function registerHealthRoute(
  app: FastifyInstance,
  { gatewayVersion, pairingAvailable, claudeHealth }: HealthRouteOptions,
): void {
  app.get('/v1/health', async (): Promise<HealthResponse> => {
    let claude: HealthResponse['claude'];
    try {
      claude = await claudeHealth();
    } catch {
      claude = { status: 'unavailable', message: 'Claude health check failed.' };
    }
    return {
      status: claude.status === 'ready' ? 'ok' : 'degraded',
      gatewayVersion,
      protocolVersion: PROTOCOL_VERSION,
      claude,
      database: { status: 'ready' },
      config: { status: 'ready' },
      pairing: { available: pairingAvailable() },
    };
  });
}
