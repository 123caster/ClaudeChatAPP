import { z } from 'zod';

export const errorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'AUTH_RATE_LIMITED',
  'NOT_FOUND',
  'CONFLICT',
  'MODEL_IN_USE',
  'ATTACHMENT_LIMIT_EXCEEDED',
  'ATTACHMENT_TOO_LARGE',
  'ATTACHMENT_TYPE_UNSUPPORTED',
  'ATTACHMENT_EXPIRED',
  'ATTACHMENT_NOT_READY',
  'DOCUMENT_PARSE_FAILED',
  'MULTIMODAL_MODEL_UNAVAILABLE',
  'CLAUDE_UNAVAILABLE',
  'PAIRING_CODE_INVALID',
  'PAIRING_CODE_EXPIRED',
  'PAIRING_RATE_LIMITED',
  'DEVICE_ALREADY_PAIRED',
  'PROJECT_PATH_INVALID',
  'CANNOT_DELETE_CONFIG_ROOT',
  'CANNOT_DELETE_HOME',
  'SCHEDULE_INVALID',
  'TASK_ALREADY_RUNNING',
  'TASK_CONFIG_INVALID',
  'PUSH_UNAVAILABLE',
  'INTERNAL_ERROR',
]);

export const errorResponseSchema = z
  .object({
    error: z
      .object({
        code: errorCodeSchema,
        message: z.string().trim().min(1),
        requestId: z.string().trim().min(1).max(128).nullable(),
      })
      .strict(),
  })
  .strict();

export type ErrorCode = z.infer<typeof errorCodeSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
