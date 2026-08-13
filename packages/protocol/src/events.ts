import { z } from 'zod';

import { eventEnvelopeBaseSchema } from './envelope.js';

export const connectionReadyEventSchema = eventEnvelopeBaseSchema
  .extend({
    type: z.literal('connection.ready'),
    payload: z
      .object({
        gatewayVersion: z.string().trim().min(1),
        currentEventId: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export const serverNoticeEventSchema = eventEnvelopeBaseSchema
  .extend({
    type: z.literal('server.notice'),
    payload: z
      .object({
        level: z.enum(['info', 'warning', 'error']),
        code: z.string().trim().min(1),
        message: z.string().trim().min(1),
      })
      .strict(),
  })
  .strict();

export const eventEnvelopeSchema = z.discriminatedUnion('type', [
  connectionReadyEventSchema,
  serverNoticeEventSchema,
]);

export type ConnectionReadyEvent = z.infer<typeof connectionReadyEventSchema>;
export type ServerNoticeEvent = z.infer<typeof serverNoticeEventSchema>;
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
