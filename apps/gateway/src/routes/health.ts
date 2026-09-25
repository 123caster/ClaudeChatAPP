import { PROTOCOL_VERSION, type HealthResponse } from '@claude-chat/protocol';
import type { FastifyInstance } from 'fastify';

type HealthRouteOptions = {
  gatewayVersion: string;
  pairingAvailable: () => boolean;
  claudeHealth: () => HealthResponse['claude'] | Promise<HealthResponse['claude']>;
  certificateHealth?: () =>
    | NonNullable<HealthResponse['certificate']>
    | Promise<NonNullable<HealthResponse['certificate']>>;
  pushHealth?: () =>
    NonNullable<HealthResponse['push']> | Promise<NonNullable<HealthResponse['push']>>;
};

export function registerHealthRoute(
  app: FastifyInstance,
  {
    gatewayVersion,
    pairingAvailable,
    claudeHealth,
    certificateHealth,
    pushHealth,
  }: HealthRouteOptions,
): void {
  app.get('/v1/health', async (): Promise<HealthResponse> => {
    let claude: HealthResponse['claude'];
    try {
      claude = await claudeHealth();
    } catch {
      claude = { status: 'unavailable', message: 'Claude health check failed.' };
    }
    let certificate: HealthResponse['certificate'];
    try {
      certificate = certificateHealth ? await certificateHealth() : undefined;
    } catch {
      certificate = { status: 'unavailable', message: 'Certificate health check failed.' };
    }
    const certificateDegraded =
      certificate?.status === 'expiring' || certificate?.status === 'unavailable';
    let push: HealthResponse['push'];
    try {
      push = pushHealth ? await pushHealth() : undefined;
    } catch {
      push = { status: 'error', message: 'Push notification health check failed.' };
    }
    return {
      status:
        claude.status === 'ready' && !certificateDegraded && push?.status !== 'error'
          ? 'ok'
          : 'degraded',
      gatewayVersion,
      protocolVersion: PROTOCOL_VERSION,
      claude,
      database: { status: 'ready' },
      config: { status: 'ready' },
      pairing: { available: pairingAvailable() },
      ...(certificate ? { certificate } : {}),
      ...(push ? { push } : {}),
    };
  });
}
