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

export type ClaudeHealthStatus = z.infer<typeof claudeHealthStatusSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type PairingExchangeRequest = z.infer<typeof pairingExchangeRequestSchema>;
export type PairedDevice = z.infer<typeof pairedDeviceSchema>;
export type PairingExchangeResponse = z.infer<typeof pairingExchangeResponseSchema>;
export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export type ProjectsResponse = z.infer<typeof projectsResponseSchema>;
