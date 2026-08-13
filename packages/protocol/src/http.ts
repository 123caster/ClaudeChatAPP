import { z } from 'zod';

import { protocolVersionSchema } from './envelope.js';
import {
  entityIdSchema,
  messageSchema,
  permissionDecisionSchema,
  permissionRequestSchema,
  requestIdSchema,
  sessionDetailSchema,
  sessionSummarySchema,
} from './models.js';

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
    config: z
      .object({
        status: z.literal('ready'),
      })
      .strict(),
    database: z
      .object({
        status: z.literal('ready'),
      })
      .strict(),
    pairing: z
      .object({
        available: z.boolean(),
      })
      .strict(),
    claude: z
      .object({
        status: claudeHealthStatusSchema,
        message: z.string().trim().min(1).optional(),
      })
      .strict(),
  })
  .strict();

export const pairingExchangeRequestSchema = z
  .object({
    code: z.string().regex(/^\d{6}$/),
    deviceName: z.string().trim().min(1).max(80),
  })
  .strict();

export const pairedDeviceSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    name: z.string().trim().min(1).max(80),
  })
  .strict();

export const pairingExchangeResponseSchema = z
  .object({
    device: pairedDeviceSchema,
    token: z.string().trim().min(1),
    tokenType: z.literal('Bearer'),
  })
  .strict();

export const projectSummarySchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    displayName: z.string().trim().min(1).max(120),
    rootPath: z.string().trim().min(1),
  })
  .strict();

export const projectsResponseSchema = z
  .object({
    projects: z.array(projectSummarySchema),
  })
  .strict();

export const sessionsResponseSchema = z
  .object({
    sessions: z.array(sessionSummarySchema),
  })
  .strict();

export const sessionDetailResponseSchema = z
  .object({
    session: sessionDetailSchema,
  })
  .strict();

export const createSessionRequestSchema = z
  .object({
    requestId: requestIdSchema,
    projectId: z.string().trim().min(1).max(128),
    message: z.string().trim().min(1).max(100_000),
    title: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const createSessionResponseSchema = z
  .object({
    requestId: requestIdSchema,
    session: sessionDetailSchema,
  })
  .strict();

export const sendMessageRequestSchema = z
  .object({
    requestId: requestIdSchema,
    message: z.string().trim().min(1).max(100_000),
  })
  .strict();

export const sendMessageResponseSchema = z
  .object({
    requestId: requestIdSchema,
    message: messageSchema,
    session: sessionSummarySchema,
  })
  .strict();

export const writeActionRequestSchema = z
  .object({
    requestId: requestIdSchema,
  })
  .strict();

export const cancelSessionRequestSchema = writeActionRequestSchema;

export const cancelSessionResponseSchema = z
  .object({
    requestId: requestIdSchema,
    session: sessionSummarySchema,
  })
  .strict();

export const archiveSessionRequestSchema = writeActionRequestSchema;

export const archiveSessionResponseSchema = z
  .object({
    requestId: requestIdSchema,
    session: sessionSummarySchema,
  })
  .strict();

export const permissionDecisionRequestSchema = z
  .object({
    requestId: requestIdSchema,
    decision: permissionDecisionSchema,
  })
  .strict();

export const permissionDecisionResponseSchema = z
  .object({
    requestId: requestIdSchema,
    permission: permissionRequestSchema,
    session: sessionSummarySchema,
  })
  .strict();

export const sessionParamsSchema = z
  .object({
    sessionId: entityIdSchema,
  })
  .strict();

export const permissionParamsSchema = z
  .object({
    permissionId: entityIdSchema,
  })
  .strict();

export type ClaudeHealthStatus = z.infer<typeof claudeHealthStatusSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type PairingExchangeRequest = z.infer<typeof pairingExchangeRequestSchema>;
export type PairedDevice = z.infer<typeof pairedDeviceSchema>;
export type PairingExchangeResponse = z.infer<typeof pairingExchangeResponseSchema>;
export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export type ProjectsResponse = z.infer<typeof projectsResponseSchema>;
export type SessionsResponse = z.infer<typeof sessionsResponseSchema>;
export type SessionDetailResponse = z.infer<typeof sessionDetailResponseSchema>;
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;
export type CreateSessionResponse = z.infer<typeof createSessionResponseSchema>;
export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;
export type SendMessageResponse = z.infer<typeof sendMessageResponseSchema>;
export type WriteActionRequest = z.infer<typeof writeActionRequestSchema>;
export type CancelSessionRequest = z.infer<typeof cancelSessionRequestSchema>;
export type CancelSessionResponse = z.infer<typeof cancelSessionResponseSchema>;
export type ArchiveSessionRequest = z.infer<typeof archiveSessionRequestSchema>;
export type ArchiveSessionResponse = z.infer<typeof archiveSessionResponseSchema>;
export type PermissionDecisionRequest = z.infer<typeof permissionDecisionRequestSchema>;
export type PermissionDecisionResponse = z.infer<typeof permissionDecisionResponseSchema>;
export type SessionParams = z.infer<typeof sessionParamsSchema>;
export type PermissionParams = z.infer<typeof permissionParamsSchema>;
