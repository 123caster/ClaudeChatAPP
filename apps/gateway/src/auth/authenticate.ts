import { timingSafeEqual } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';

import { sendError } from '../http-error.js';
import type { AuthFailureLimiter } from './auth-failure-limiter.js';
import type { DeviceAuthService } from './device-auth-service.js';

const bearerTokenPattern = /^Bearer ([A-Za-z0-9_-]{20,})$/;

export type AuthenticationOptions = {
  deviceAuth?: DeviceAuthService;
  legacyApiKey?: string;
  limiter: AuthFailureLimiter;
};

function safeEqual(configured: string, supplied: string): boolean {
  const configuredBuffer = Buffer.from(configured);
  const suppliedBuffer = Buffer.from(supplied);
  if (configuredBuffer.length !== suppliedBuffer.length) return false;
  return timingSafeEqual(configuredBuffer, suppliedBuffer);
}

function isPublicRoute(url: string): boolean {
  return url === '/v1/health' || url === '/v1/pairing/exchange';
}

export function createAuthenticationHook({
  deviceAuth,
  legacyApiKey,
  limiter,
}: AuthenticationOptions) {
  return async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.url.startsWith('/v1/') || isPublicRoute(request.url)) return;
    if (!deviceAuth && !legacyApiKey) return;

    const clientKey = request.ip;
    if (limiter.isBlocked(clientKey)) {
      sendError(
        request,
        reply,
        429,
        'AUTH_RATE_LIMITED',
        'Too many failed authentication attempts. Try again later.',
      );
      return;
    }

    const authorization = request.headers.authorization;
    const bearer = authorization ? bearerTokenPattern.exec(authorization)?.[1] : undefined;
    const device = bearer && deviceAuth ? deviceAuth.authenticate(bearer) : null;
    const suppliedLegacy = request.headers['x-api-key'];
    const legacyAccepted =
      legacyApiKey && typeof suppliedLegacy === 'string' && safeEqual(legacyApiKey, suppliedLegacy);

    if (!device && !legacyAccepted) {
      limiter.recordFailure(clientKey);
      sendError(request, reply, 401, 'UNAUTHORIZED', 'A valid paired-device token is required.');
      return;
    }

    limiter.clear(clientKey);
    request.device = device;
  };
}
