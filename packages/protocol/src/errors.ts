import { z } from 'zod';

export const errorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'NOT_FOUND',
  'CONFLICT',
  'CLAUDE_UNAVAILABLE',
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
