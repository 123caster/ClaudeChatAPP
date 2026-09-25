import {
  deletePushSubscriptionRequestSchema,
  deletePushSubscriptionResponseSchema,
  upsertPushSubscriptionRequestSchema,
  upsertPushSubscriptionResponseSchema,
} from '@claude-chat/protocol';
import type { FastifyInstance } from 'fastify';

import { sendError } from '../http-error.js';
import { PushSubscriptionError, type PushService } from '../push/push-service.js';

export function registerPushSubscriptionRoutes(
  app: FastifyInstance,
  { push }: { push: PushService },
): void {
  app.post('/v1/push-subscriptions', async (request, reply) => {
    const body = upsertPushSubscriptionRequestSchema.safeParse(request.body);
    if (!body.success) {
      return sendError(request, reply, 400, 'VALIDATION_ERROR', 'Invalid push subscription.');
    }
    if (!request.device) {
      return sendError(request, reply, 401, 'UNAUTHORIZED', 'A paired device is required.');
    }
    try {
      return upsertPushSubscriptionResponseSchema.parse({
        requestId: body.data.requestId,
        subscription: push.upsert(request.device.id, body.data),
      });
    } catch (error) {
      if (error instanceof PushSubscriptionError) {
        return sendError(request, reply, 400, 'VALIDATION_ERROR', error.message);
      }
      throw error;
    }
  });

  app.post('/v1/push-subscriptions/delete', async (request, reply) => {
    const body = deletePushSubscriptionRequestSchema.safeParse(request.body);
    if (!body.success) {
      return sendError(request, reply, 400, 'VALIDATION_ERROR', 'Invalid push request.');
    }
    if (!request.device) {
      return sendError(request, reply, 401, 'UNAUTHORIZED', 'A paired device is required.');
    }
    push.delete(request.device.id);
    return deletePushSubscriptionResponseSchema.parse({
      requestId: body.data.requestId,
      deviceId: request.device.id,
    });
  });
}
