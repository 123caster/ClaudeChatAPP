import type { ErrorCode, ErrorResponse } from '@claude-chat/protocol';
import type { FastifyReply, FastifyRequest } from 'fastify';

export function sendError(
  request: FastifyRequest,
  reply: FastifyReply,
  statusCode: number,
  code: ErrorCode,
  message: string,
): FastifyReply {
  const response: ErrorResponse = {
    error: {
      code,
      message,
      requestId: request.id,
    },
  };
  return reply.status(statusCode).send(response);
}
