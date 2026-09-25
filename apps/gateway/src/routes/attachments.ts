import {
  attachmentParamsSchema,
  deleteAttachmentRequestSchema,
  deleteAttachmentResponseSchema,
  uploadAttachmentFieldsSchema,
  uploadAttachmentResponseSchema,
} from '@claude-chat/protocol';
import multipart from '@fastify/multipart';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { AttachmentError, type AttachmentService } from '../attachments/attachment-service.js';
import { MAX_DOCUMENT_BYTES } from '../attachments/attachment-policy.js';
import { IdempotencyConflictError } from '@claude-chat/database';
import { sendError } from '../http-error.js';

type AttachmentRouteOptions = {
  attachments: AttachmentService;
};

function handleAttachmentError(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  if (error instanceof AttachmentError) {
    return sendError(request, reply, error.statusCode, error.code, error.message);
  }
  if (error instanceof IdempotencyConflictError) {
    return sendError(request, reply, 409, 'CONFLICT', error.message);
  }
  if (
    error instanceof Error &&
    ('code' in error
      ? error.code === 'FST_REQ_FILE_TOO_LARGE'
      : /file.*too large/i.test(error.message))
  ) {
    return sendError(request, reply, 413, 'ATTACHMENT_TOO_LARGE', 'Files may not exceed 20 MB.');
  }
  throw error;
}

export function registerAttachmentRoutes(
  app: FastifyInstance,
  { attachments }: AttachmentRouteOptions,
): void {
  void app.register(multipart, {
    limits: { files: 1, fields: 3, parts: 4, fileSize: MAX_DOCUMENT_BYTES },
  });

  app.post('/v1/attachments', async (request, reply) => {
    if (!request.device) {
      return sendError(request, reply, 401, 'UNAUTHORIZED', 'A paired device is required.');
    }
    if (!request.isMultipart()) {
      return sendError(request, reply, 400, 'VALIDATION_ERROR', 'A multipart upload is required.');
    }

    try {
      const fields: Record<string, string> = {};
      let file: { name: string; mimeType: string; data: Buffer } | null = null;
      for await (const part of request.parts()) {
        if (part.type === 'file') {
          if (file || part.fieldname !== 'file' || !part.filename) {
            part.file.resume();
            throw new AttachmentError(
              400,
              'VALIDATION_ERROR',
              'Exactly one attachment file is required.',
            );
          }
          file = {
            name: part.filename,
            mimeType: part.mimetype,
            data: await part.toBuffer(),
          };
        } else {
          if (fields[part.fieldname] !== undefined || typeof part.value !== 'string') {
            throw new AttachmentError(400, 'VALIDATION_ERROR', 'Invalid attachment fields.');
          }
          fields[part.fieldname] = part.value;
        }
      }
      const parsed = uploadAttachmentFieldsSchema.safeParse(fields);
      if (!parsed.success || !file) {
        return sendError(request, reply, 400, 'VALIDATION_ERROR', 'Invalid attachment upload.');
      }
      const response = await attachments.upload({
        ...parsed.data,
        deviceId: request.device.id,
        name: file.name,
        declaredMimeType: file.mimeType,
        data: file.data,
      });
      return reply.status(201).send(uploadAttachmentResponseSchema.parse(response));
    } catch (error) {
      return handleAttachmentError(request, reply, error);
    }
  });

  app.get('/v1/attachments/:attachmentId/preview', async (request, reply) => {
    const params = attachmentParamsSchema.safeParse(request.params);
    if (!params.success || !request.device) {
      return sendError(
        request,
        reply,
        params.success ? 401 : 400,
        params.success ? 'UNAUTHORIZED' : 'VALIDATION_ERROR',
        params.success ? 'A paired device is required.' : 'Invalid attachment ID.',
      );
    }
    try {
      const preview = attachments.getPreview(request.device.id, params.data.attachmentId);
      return reply
        .header('Cache-Control', 'private, max-age=31536000, immutable')
        .type('image/webp')
        .send(preview.stream);
    } catch (error) {
      return handleAttachmentError(request, reply, error);
    }
  });

  app.post('/v1/attachments/:attachmentId/delete', async (request, reply) => {
    const params = attachmentParamsSchema.safeParse(request.params);
    const body = deleteAttachmentRequestSchema.safeParse(request.body);
    if (!params.success || !body.success || !request.device) {
      return sendError(
        request,
        reply,
        !request.device ? 401 : 400,
        !request.device ? 'UNAUTHORIZED' : 'VALIDATION_ERROR',
        !request.device ? 'A paired device is required.' : 'Invalid attachment delete request.',
      );
    }
    try {
      return reply.send(
        deleteAttachmentResponseSchema.parse(
          attachments.removeReady(request.device.id, params.data.attachmentId, body.data.requestId),
        ),
      );
    } catch (error) {
      return handleAttachmentError(request, reply, error);
    }
  });
}
