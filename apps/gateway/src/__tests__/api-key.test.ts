import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';

const apps: FastifyInstance[] = [];

function appWithKey(apiKey?: string): FastifyInstance {
  const app = buildApp({ apiKey });
  apps.push(app);
  return app;
}

afterEach(async () => {
  for (const app of apps.splice(0)) {
    await app.close();
  }
});

describe('API key hook', () => {
  it('rejects /v1 requests when the key is missing or wrong', async () => {
    const app = appWithKey('top-secret-key');

    const missing = await app.inject({ method: 'GET', url: '/v1/projects' });
    expect(missing.statusCode).toBe(401);

    const wrong = await app.inject({
      method: 'GET',
      url: '/v1/projects',
      headers: { 'x-api-key': 'wrong-key' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe('UNAUTHORIZED');
  });

  it('lets /v1 requests through with the correct key', async () => {
    const app = appWithKey('top-secret-key');
    const response = await app.inject({
      method: 'GET',
      url: '/v1/projects',
      headers: { 'x-api-key': 'top-secret-key' },
    });
    expect(response.statusCode).not.toBe(401);
  });

  it('leaves the health endpoint unauthenticated', async () => {
    const app = appWithKey('top-secret-key');
    const response = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(response.statusCode).toBe(200);
  });

  it('does not enforce a key when none is configured', async () => {
    const app = appWithKey(undefined);
    const response = await app.inject({ method: 'GET', url: '/v1/projects' });
    expect(response.statusCode).not.toBe(401);
  });
});
