import {
  createModelRequestSchema,
  createModelResponseSchema,
  deleteModelRequestSchema,
  deleteModelResponseSchema,
  modelParamsSchema,
  setActiveModelRequestSchema,
  setActiveModelResponseSchema,
  type ModelsResponse,
} from '@claude-chat/protocol';
import type { FastifyInstance } from 'fastify';

import { sendError } from '../http-error.js';
import { ModelNotFoundError, type ModelService } from '../models/model-service.js';

type ModelRouteOptions = {
  models: ModelService;
};

export function registerModelRoutes(app: FastifyInstance, { models }: ModelRouteOptions): void {
  app.get('/v1/models', async (): Promise<ModelsResponse> => ({
    models: models.list(),
  }));

  app.post('/v1/models', async (request, reply) => {
    const body = createModelRequestSchema.safeParse(request.body);
    if (!body.success) {
      return sendError(request, reply, 400, 'VALIDATION_ERROR', 'Invalid model request.');
    }
    const model = models.create(body.data);
    const response = { requestId: body.data.requestId, model };
    return reply.status(201).send(createModelResponseSchema.parse(response));
  });

  app.post('/v1/models/:modelId/active', async (request, reply) => {
    const params = modelParamsSchema.safeParse(request.params);
    const body = setActiveModelRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return sendError(request, reply, 400, 'VALIDATION_ERROR', 'Invalid model request.');
    }
    try {
      const model = models.setActive(params.data.modelId);
      const response = { requestId: body.data.requestId, model };
      return reply.send(setActiveModelResponseSchema.parse(response));
    } catch (error) {
      if (error instanceof ModelNotFoundError) {
        return sendError(request, reply, 404, 'NOT_FOUND', error.message);
      }
      throw error;
    }
  });

  app.post('/v1/models/:modelId/delete', async (request, reply) => {
    const params = modelParamsSchema.safeParse(request.params);
    const body = deleteModelRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return sendError(request, reply, 400, 'VALIDATION_ERROR', 'Invalid model request.');
    }
    try {
      models.delete(params.data.modelId);
      return reply.send(deleteModelResponseSchema.parse({ requestId: body.data.requestId }));
    } catch (error) {
      if (error instanceof ModelNotFoundError) {
        return sendError(request, reply, 404, 'NOT_FOUND', error.message);
      }
      throw error;
    }
  });
}
