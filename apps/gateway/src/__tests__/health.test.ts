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
      status: 'ok',
      gatewayVersion: 'test-version',
      protocolVersion: 1,
      claude: {
        status: 'starting',
      },
    });
  });
});
