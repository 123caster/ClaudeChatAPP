import { z } from 'zod';

export const PROTOCOL_VERSION = 1 as const;

export const protocolVersionSchema = z.literal(PROTOCOL_VERSION);

export const nullableRequestIdSchema = z.string().trim().min(1).max(128).nullable();

export const eventEnvelopeBaseSchema = z
  .object({
    protocolVersion: protocolVersionSchema,
    eventId: z.number().int().nonnegative(),
    sessionId: z.string().uuid().nullable(),
    requestId: nullableRequestIdSchema,
    emittedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type EventEnvelopeBase = z.infer<typeof eventEnvelopeBaseSchema>;
