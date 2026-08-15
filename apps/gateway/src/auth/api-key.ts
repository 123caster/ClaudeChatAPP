import { timingSafeEqual } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

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
    // Skip WebSocket upgrades here: rejecting an upgrade in onRequest leaves the raw
    // socket dangling (see preValidation hook below). Let preValidation handle it.
    if (request.headers.upgrade === 'websocket') return;
    const supplied = request.headers['x-api-key'];
    if (typeof supplied !== 'string' || !safeEqual(apiKey, supplied)) {
      sendError(request, reply, 401, 'UNAUTHORIZED', 'A valid API key is required.');
    }
  });

  // The global onRequest hook above cannot clean up an aborted WebSocket upgrade:
  // @fastify/websocket only destroys the raw socket from its own onResponse hook,
  // which never fires for a request that was rejected before its onRequest hook ran.
  // Reject WebSocket handshakes in preValidation instead, where normal reply lifecycle
  // (and thus socket teardown) applies.
  app.addHook('preValidation', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.ws !== true) return;
    if (!request.url.startsWith('/v1/')) return;
    const supplied = request.headers['x-api-key'];
    if (typeof supplied !== 'string' || !safeEqual(apiKey, supplied)) {
      sendError(request, reply, 401, 'UNAUTHORIZED', 'A valid API key is required.');
    }
  });
}
