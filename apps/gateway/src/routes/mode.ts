import {
  setModeRequestSchema,
  setModeResponseSchema,
  type GetModeResponse,
  type SetModeResponse,
} from '@claude-chat/protocol';
import type { FastifyInstance } from 'fastify';

import { sendError } from '../http-error.js';
import type { ModeService } from '../mode/mode-service.js';

type ModeRouteOptions = {
  mode: ModeService;
};

export function registerModeRoutes(app: FastifyInstance, { mode }: ModeRouteOptions): void {
  app.get('/v1/mode', async (): Promise<GetModeResponse> => ({
    mode: mode.get(),
  }));

  app.post('/v1/mode', async (request, reply) => {
    const body = setModeRequestSchema.safeParse(request.body);
    if (!body.success) {
      return sendError(request, reply, 400, 'VALIDATION_ERROR', 'Invalid mode request.');
    }
    const next = mode.set(body.data.mode);
    const response: SetModeResponse = { requestId: body.data.requestId, mode: next };
    return reply.send(setModeResponseSchema.parse(response));
  });
}
