import {
  createSessionRequestSchema,
  permissionDecisionRequestSchema,
  permissionParamsSchema,
  sendMessageRequestSchema,
  sessionParamsSchema,
  writeActionRequestSchema,
} from '@claude-chat/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { createAuthenticationHook } from '../auth/authenticate.js';
import type { DeviceAuthService } from '../auth/device-auth-service.js';
import { sendError } from '../http-error.js';
import { ProjectPathError } from '../projects/path-policy.js';
import {
  IdempotencyConflictError,
  SessionConflictError,
  SessionNotFoundError,
  type SessionService,
} from '../sessions/session-service.js';
import { PermissionNotResolvableError } from '../sessions/permission-service.js';

type SessionRouteOptions = {
  deviceAuth: DeviceAuthService;
  sessions: SessionService;
};

function handleDomainError(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  if (error instanceof SessionNotFoundError) {
    return sendError(request, reply, 404, 'NOT_FOUND', error.message);
  }
  if (error instanceof IdempotencyConflictError || error instanceof SessionConflictError) {
    return sendError(request, reply, 409, 'CONFLICT', error.message);
  }
  if (error instanceof PermissionNotResolvableError) {
    const statusCode = error.reason === 'not_found' ? 404 : 409;
    return sendError(
      request,
      reply,
      statusCode,
      error.reason === 'not_found' ? 'NOT_FOUND' : 'CONFLICT',
      error.message,
    );
  }
  if (error instanceof ProjectPathError) {
    return sendError(request, reply, 400, 'PROJECT_PATH_INVALID', error.message);
  }
  throw error;
}

export function registerSessionRoutes(
  app: FastifyInstance,
  { deviceAuth, sessions }: SessionRouteOptions,
): void {
  const preHandler = createAuthenticationHook(deviceAuth);

  app.get('/v1/sessions', { preHandler }, async () => ({ sessions: sessions.list() }));

  app.post('/v1/sessions', { preHandler }, async (request, reply) => {
    const body = createSessionRequestSchema.safeParse(request.body);
    if (!body.success) {
      return sendError(request, reply, 400, 'VALIDATION_ERROR', 'Invalid session request.');
    }
    try {
      return reply.status(201).send(sessions.create(body.data));
    } catch (error) {
      return handleDomainError(request, reply, error);
    }
  });

  app.get('/v1/sessions/:sessionId', { preHandler }, async (request, reply) => {
    const params = sessionParamsSchema.safeParse(request.params);
    if (!params.success) {
      return sendError(request, reply, 400, 'VALIDATION_ERROR', 'Invalid session ID.');
    }
    try {
      return { session: sessions.detail(params.data.sessionId) };
    } catch (error) {
      return handleDomainError(request, reply, error);
    }
  });

  app.post('/v1/sessions/:sessionId/messages', { preHandler }, async (request, reply) => {
    const params = sessionParamsSchema.safeParse(request.params);
    const body = sendMessageRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return sendError(request, reply, 400, 'VALIDATION_ERROR', 'Invalid message request.');
    }
    try {
      return sessions.sendMessage(params.data.sessionId, body.data);
    } catch (error) {
      return handleDomainError(request, reply, error);
    }
  });

  app.post('/v1/sessions/:sessionId/cancel', { preHandler }, async (request, reply) => {
    const params = sessionParamsSchema.safeParse(request.params);
    const body = writeActionRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return sendError(request, reply, 400, 'VALIDATION_ERROR', 'Invalid cancel request.');
    }
    try {
      return {
        requestId: body.data.requestId,
        session: sessions.cancel(params.data.sessionId, body.data),
      };
    } catch (error) {
      return handleDomainError(request, reply, error);
    }
  });

  app.post('/v1/sessions/:sessionId/archive', { preHandler }, async (request, reply) => {
    const params = sessionParamsSchema.safeParse(request.params);
    const body = writeActionRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return sendError(request, reply, 400, 'VALIDATION_ERROR', 'Invalid archive request.');
    }
    try {
      return {
        requestId: body.data.requestId,
        session: sessions.archive(params.data.sessionId, body.data),
      };
    } catch (error) {
      return handleDomainError(request, reply, error);
    }
  });

  app.post('/v1/permissions/:permissionId/decision', { preHandler }, async (request, reply) => {
    const params = permissionParamsSchema.safeParse(request.params);
    const body = permissionDecisionRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return sendError(request, reply, 400, 'VALIDATION_ERROR', 'Invalid permission decision.');
    }
    try {
      return sessions.decidePermission(params.data.permissionId, body.data);
    } catch (error) {
      return handleDomainError(request, reply, error);
    }
  });
}
