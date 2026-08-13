import { z } from 'zod';

export const errorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'NOT_FOUND',
  'CONFLICT',
  'CLAUDE_UNAVAILABLE',
  'PAIRING_CODE_INVALID',
  'PAIRING_CODE_EXPIRED',
  'PAIRING_RATE_LIMITED',
  'DEVICE_ALREADY_PAIRED',
  'PROJECT_PATH_INVALID',
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
