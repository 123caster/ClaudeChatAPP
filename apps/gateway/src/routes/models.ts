import {
  createModelRequestSchema,
  createModelResponseSchema,
  createModelVariantsRequestSchema,
  createModelVariantsResponseSchema,
  createModelVariantRequestSchema,
  createModelVariantResponseSchema,
  deleteModelRequestSchema,
  deleteModelResponseSchema,
  modelParamsSchema,
  setActiveModelRequestSchema,
  setActiveModelResponseSchema,
  setDefaultMultimodalModelRequestSchema,
  setDefaultMultimodalModelResponseSchema,
  updateModelRequestSchema,
  updateModelResponseSchema,
  type ModelsResponse,
} from '@claude-chat/protocol';
import type { FastifyInstance } from 'fastify';

import { sendError } from '../http-error.js';
import {
  ModelCapabilityError,
  ModelInUseError,
  ModelNotFoundError,
  type ModelService,
} from '../models/model-service.js';

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
    try {
      const model = models.create(body.data);
      const response = { requestId: body.data.requestId, model };
      return reply.status(201).send(createModelResponseSchema.parse(response));
    } catch (error) {
      if (error instanceof ModelCapabilityError) {
        return sendError(request, reply, 409, 'CONFLICT', error.message);
      }
      throw error;
    }
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

  app.post('/v1/models/:modelId/multimodal-default', async (request, reply) => {
    const params = modelParamsSchema.safeParse(request.params);
    const body = setDefaultMultimodalModelRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return sendError(request, reply, 400, 'VALIDATION_ERROR', 'Invalid model request.');
    }
    try {
      const model = models.setMultimodalDefault(params.data.modelId);
      return reply.send(
        setDefaultMultimodalModelResponseSchema.parse({
          requestId: body.data.requestId,
          model,
        }),
      );
    } catch (error) {
      if (error instanceof ModelNotFoundError) {
        return sendError(request, reply, 404, 'NOT_FOUND', error.message);
      }
      if (error instanceof ModelCapabilityError) {
        return sendError(request, reply, 409, 'CONFLICT', error.message);
      }
      throw error;
    }
  });

  app.post('/v1/models/:modelId/variants', async (request, reply) => {
    const params = modelParamsSchema.safeParse(request.params);
    const body = createModelVariantRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return sendError(request, reply, 400, 'VALIDATION_ERROR', 'Invalid model variant request.');
    }
    try {
      const model = models.createVariant(params.data.modelId, body.data.model);
      return reply
        .status(201)
        .send(createModelVariantResponseSchema.parse({ requestId: body.data.requestId, model }));
    } catch (error) {
      if (error instanceof ModelNotFoundError) {
        return sendError(request, reply, 404, 'NOT_FOUND', error.message);
      }
      throw error;
    }
  });

  app.post('/v1/models/:modelId/variants/batch', async (request, reply) => {
    const params = modelParamsSchema.safeParse(request.params);
    const body = createModelVariantsRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return sendError(request, reply, 400, 'VALIDATION_ERROR', 'Invalid model variant request.');
    }
    try {
      const createdModels = models.createVariants(params.data.modelId, body.data.models);
      return reply.status(201).send(
        createModelVariantsResponseSchema.parse({
          requestId: body.data.requestId,
          models: createdModels,
        }),
      );
    } catch (error) {
      if (error instanceof ModelNotFoundError) {
        return sendError(request, reply, 404, 'NOT_FOUND', error.message);
      }
      throw error;
    }
  });

  app.post('/v1/models/:modelId/update', async (request, reply) => {
    const params = modelParamsSchema.safeParse(request.params);
    const body = updateModelRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return sendError(request, reply, 400, 'VALIDATION_ERROR', 'Invalid model update request.');
    }
    try {
      const model = models.update(params.data.modelId, body.data);
      return reply.send(updateModelResponseSchema.parse({ requestId: body.data.requestId, model }));
    } catch (error) {
      if (error instanceof ModelNotFoundError) {
        return sendError(request, reply, 404, 'NOT_FOUND', error.message);
      }
      if (error instanceof ModelCapabilityError) {
        return sendError(request, reply, 409, 'CONFLICT', error.message);
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
      if (error instanceof ModelInUseError) {
        return sendError(request, reply, 409, 'MODEL_IN_USE', error.message);
      }
      throw error;
    }
  });
}
