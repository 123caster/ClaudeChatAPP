import { z } from 'zod';

import { eventEnvelopeBaseSchema } from './envelope.js';
import {
  entityIdSchema,
  messageSchema,
  completedToolCallSchema,
  failedToolCallSchema,
  pendingPermissionRequestSchema,
  resolvedPermissionRequestSchema,
  runningToolCallSchema,
  sessionDetailSchema,
  sessionSummarySchema,
} from './models.js';

const connectionEventBaseSchema = eventEnvelopeBaseSchema
  .extend({
    sessionId: z.null(),
  })
  .strict();

const sessionEventBaseSchema = eventEnvelopeBaseSchema
  .extend({
    sessionId: entityIdSchema,
  })
  .strict();

export const connectionReadyEventSchema = connectionEventBaseSchema
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

export const sessionSnapshotEventSchema = connectionEventBaseSchema
  .extend({
    type: z.literal('session.snapshot'),
    payload: z
      .object({
        currentEventId: z.number().int().nonnegative(),
        sessions: z.array(sessionDetailSchema),
      })
      .strict(),
  })
  .strict();

export const sessionCreatedEventSchema = sessionEventBaseSchema
  .extend({
    type: z.literal('session.created'),
    payload: z.object({ session: sessionSummarySchema }).strict(),
  })
  .strict();

export const sessionUpdatedEventSchema = sessionEventBaseSchema
  .extend({
    type: z.literal('session.updated'),
    payload: z.object({ session: sessionSummarySchema }).strict(),
  })
  .strict();

export const messageCreatedEventSchema = sessionEventBaseSchema
  .extend({
    type: z.literal('message.created'),
    payload: z.object({ message: messageSchema }).strict(),
  })
  .strict();

export const assistantDeltaEventSchema = sessionEventBaseSchema
  .extend({
    type: z.literal('assistant.delta'),
    payload: z
      .object({
        messageId: entityIdSchema,
        delta: z.string().min(1),
        sequence: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export const toolStartedEventSchema = sessionEventBaseSchema
  .extend({
    type: z.literal('tool.started'),
    payload: z.object({ toolCall: runningToolCallSchema }).strict(),
  })
  .strict();

export const toolCompletedEventSchema = sessionEventBaseSchema
  .extend({
    type: z.literal('tool.completed'),
    payload: z
      .object({
        toolCall: z.discriminatedUnion('status', [completedToolCallSchema, failedToolCallSchema]),
      })
      .strict(),
  })
  .strict();

export const permissionRequestedEventSchema = sessionEventBaseSchema
  .extend({
    type: z.literal('permission.requested'),
    payload: z.object({ permission: pendingPermissionRequestSchema }).strict(),
  })
  .strict();

export const permissionResolvedEventSchema = sessionEventBaseSchema
  .extend({
    type: z.literal('permission.resolved'),
    payload: z.object({ permission: resolvedPermissionRequestSchema }).strict(),
  })
  .strict();

export const turnCompletedEventSchema = sessionEventBaseSchema
  .extend({
    type: z.literal('turn.completed'),
    payload: z
      .object({
        session: sessionSummarySchema.extend({ status: z.literal('idle') }).strict(),
        assistantMessageId: entityIdSchema.nullable(),
      })
      .strict(),
  })
  .strict();

export const turnFailedEventSchema = sessionEventBaseSchema
  .extend({
    type: z.literal('turn.failed'),
    payload: z
      .object({
        session: sessionSummarySchema.extend({ status: z.enum(['interrupted', 'error']) }).strict(),
        code: z.string().trim().min(1).max(128),
        message: z.string().trim().min(1).max(2_000),
        retryable: z.boolean(),
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
  sessionSnapshotEventSchema,
  sessionCreatedEventSchema,
  sessionUpdatedEventSchema,
  messageCreatedEventSchema,
  assistantDeltaEventSchema,
  toolStartedEventSchema,
  toolCompletedEventSchema,
  permissionRequestedEventSchema,
  permissionResolvedEventSchema,
  turnCompletedEventSchema,
  turnFailedEventSchema,
  serverNoticeEventSchema,
]);

export type ConnectionReadyEvent = z.infer<typeof connectionReadyEventSchema>;
export type SessionSnapshotEvent = z.infer<typeof sessionSnapshotEventSchema>;
export type SessionCreatedEvent = z.infer<typeof sessionCreatedEventSchema>;
export type SessionUpdatedEvent = z.infer<typeof sessionUpdatedEventSchema>;
export type MessageCreatedEvent = z.infer<typeof messageCreatedEventSchema>;
export type AssistantDeltaEvent = z.infer<typeof assistantDeltaEventSchema>;
export type ToolStartedEvent = z.infer<typeof toolStartedEventSchema>;
export type ToolCompletedEvent = z.infer<typeof toolCompletedEventSchema>;
export type PermissionRequestedEvent = z.infer<typeof permissionRequestedEventSchema>;
export type PermissionResolvedEvent = z.infer<typeof permissionResolvedEventSchema>;
export type TurnCompletedEvent = z.infer<typeof turnCompletedEventSchema>;
export type TurnFailedEvent = z.infer<typeof turnFailedEventSchema>;
export type ServerNoticeEvent = z.infer<typeof serverNoticeEventSchema>;
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
