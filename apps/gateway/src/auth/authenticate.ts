import type { FastifyReply, FastifyRequest } from 'fastify';

import { sendError } from '../http-error.js';
import type { DeviceAuthService } from './device-auth-service.js';

const bearerTokenPattern = /^Bearer ([A-Za-z0-9_-]{20,})$/;

export function createAuthenticationHook(deviceAuth: DeviceAuthService) {
  return async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const authorization = request.headers.authorization;
    const match = authorization ? bearerTokenPattern.exec(authorization) : null;
    const device = match?.[1] ? deviceAuth.authenticate(match[1]) : null;

    if (!device) {
      sendError(request, reply, 401, 'UNAUTHORIZED', 'A valid paired-device token is required.');
      return;
    }

    request.device = device;
  };
}
