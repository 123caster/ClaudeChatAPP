import {
  clearSessionRequestSchema,
  createSessionRequestSchema,
  permissionDecisionRequestSchema,
  renameSessionRequestSchema,
  permissionParamsSchema,
  sendMessageRequestSchema,
  setSessionModelRequestSchema,
  sessionParamsSchema,
  writeActionRequestSchema,
} from '@claude-chat/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { sendError } from '../http-error.js';
import { AttachmentError } from '../attachments/attachment-service.js';
import { ProjectPathError } from '../projects/path-policy.js';
import {
  IdempotencyConflictError,
  SessionConflictError,
  SessionNotFoundError,
  type SessionService,
} from '../sessions/session-service.js';
import { PermissionNotResolvableError } from '../sessions/permission-service.js';

type SessionRouteOptions = {
  sessions: SessionService;
};

function handleDomainError(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  if (error instanceof AttachmentError) {
    return sendError(request, reply, error.statusCode, error.code, error.message);
  }
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
  { sessions }: SessionRouteOptions,
): void {
  app.get('/v1/sessions', async () => ({ sessions: sessions.list() }));

  app.post('/v1/sessions', async (request, reply) => {
    const body = createSessionRequestSchema.safeParse(request.body);
    if (!body.success) {
      return sendError(request, reply, 400, 'VALIDATION_ERROR', 'Invalid session request.');
    }
    try {
      return reply.status(201).send(sessions.create(body.data, request.device?.id ?? null));
    } catch (error) {
      return handleDomainError(request, reply, error);
    }
  });

  app.get('/v1/sessions/:sessionId', async (request, reply) => {
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

  app.post('/v1/sessions/:sessionId/messages', async (request, reply) => {
    const params = sessionParamsSchema.safeParse(request.params);
    const body = sendMessageRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return sendError(request, reply, 400, 'VALIDATION_ERROR', 'Invalid message request.');
    }
    try {
      return sessions.sendMessage(params.data.sessionId, body.data, request.device?.id ?? null);
    } catch (error) {
      return handleDomainError(request, reply, error);
    }
  });

  app.post('/v1/sessions/:sessionId/model', async (request, reply) => {
    const params = sessionParamsSchema.safeParse(request.params);
    const body = setSessionModelRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return sendError(request, reply, 400, 'VALIDATION_ERROR', 'Invalid session model request.');
    }
    try {
      return sessions.setModel(params.data.sessionId, body.data);
    } catch (error) {
      return handleDomainError(request, reply, error);
    }
  });

  app.post('/v1/sessions/:sessionId/rename', async (request, reply) => {
    const params = sessionParamsSchema.safeParse(request.params);
    const body = renameSessionRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return sendError(request, reply, 400, 'VALIDATION_ERROR', 'Invalid rename request.');
    }
    try {
      return sessions.rename(params.data.sessionId, body.data);
    } catch (error) {
      return handleDomainError(request, reply, error);
    }
  });

  app.post('/v1/sessions/:sessionId/cancel', async (request, reply) => {
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

  app.post('/v1/sessions/:sessionId/clear', async (request, reply) => {
    const params = sessionParamsSchema.safeParse(request.params);
    const body = clearSessionRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return sendError(request, reply, 400, 'VALIDATION_ERROR', 'Invalid clear request.');
    }
    try {
      return sessions.clear(params.data.sessionId, body.data);
    } catch (error) {
      return handleDomainError(request, reply, error);
    }
  });

  app.post('/v1/sessions/:sessionId/archive', async (request, reply) => {
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

  app.post('/v1/sessions/:sessionId/delete', async (request, reply) => {
    const params = sessionParamsSchema.safeParse(request.params);
    const body = writeActionRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return sendError(request, reply, 400, 'VALIDATION_ERROR', 'Invalid delete request.');
    }
    try {
      sessions.delete(params.data.sessionId, body.data);
      return { requestId: body.data.requestId, sessionId: params.data.sessionId };
    } catch (error) {
      return handleDomainError(request, reply, error);
    }
  });

  app.post('/v1/permissions/:permissionId/decision', async (request, reply) => {
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
