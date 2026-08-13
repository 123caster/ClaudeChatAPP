import { healthResponseSchema } from '@claude-chat/protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe('GET /v1/health', () => {
  it('returns a protocol-validated bootstrap response', async () => {
    const app = buildApp({ gatewayVersion: 'test-version' });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/v1/health' });
    const body = healthResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(body).toEqual({
      status: 'degraded',
      gatewayVersion: 'test-version',
      protocolVersion: 1,
      claude: {
        status: 'starting',
      },
      config: {
        status: 'ready',
      },
      database: {
        status: 'ready',
      },
      pairing: {
        available: false,
      },
    });
  });

  it('reports ready Claude as healthy and sanitizes probe failures', async () => {
    const ready = buildApp({
      gatewayVersion: 'test-version',
      claudeHealth: () => ({ status: 'ready' }),
    });
    const failed = buildApp({
      gatewayVersion: 'test-version',
      claudeHealth: () => Promise.reject(new Error('secret stderr')),
    });
    apps.push(ready, failed);

    expect((await ready.inject({ method: 'GET', url: '/v1/health' })).json()).toMatchObject({
      status: 'ok',
      claude: { status: 'ready' },
    });
    expect((await failed.inject({ method: 'GET', url: '/v1/health' })).json()).toMatchObject({
      status: 'degraded',
      claude: { status: 'unavailable', message: 'Claude health check failed.' },
    });
  });
});
