import { z } from 'zod';

import { protocolVersionSchema } from './envelope.js';

export const claudeHealthStatusSchema = z.enum([
  'starting',
  'ready',
  'unavailable',
  'unauthenticated',
  'incompatible',
]);

export const healthResponseSchema = z
  .object({
    status: z.enum(['ok', 'degraded']),
    gatewayVersion: z.string().trim().min(1),
    protocolVersion: protocolVersionSchema,
    claude: z
      .object({
        status: claudeHealthStatusSchema,
        message: z.string().trim().min(1).optional(),
      })
      .strict(),
  })
  .strict();

export type ClaudeHealthStatus = z.infer<typeof claudeHealthStatusSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
