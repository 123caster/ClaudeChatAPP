import { timingSafeEqual } from 'node:crypto';

import type { FastifyInstance } from 'fastify';

import { sendError } from '../http-error.js';

function safeEqual(configured: string, supplied: string): boolean {
  const configuredBuffer = Buffer.from(configured);
  const suppliedBuffer = Buffer.from(supplied);
  if (configuredBuffer.length !== suppliedBuffer.length) return false;
  return timingSafeEqual(configuredBuffer, suppliedBuffer);
}

export function registerApiKeyHook(app: FastifyInstance, apiKey: string | undefined): void {
  if (!apiKey) return;

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/v1/')) return;
    if (request.url === '/v1/health') return;
    const supplied = request.headers['x-api-key'];
    if (typeof supplied !== 'string' || !safeEqual(apiKey, supplied)) {
      sendError(request, reply, 401, 'UNAUTHORIZED', 'A valid API key is required.');
    }
  });
}
