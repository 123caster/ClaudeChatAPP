import { z } from 'zod';

export const entityIdSchema = z.string().uuid();
export const requestIdSchema = z.string().trim().min(1).max(128);
export const timestampSchema = z.string().datetime({ offset: true });

export const sessionStatusSchema = z.enum([
  'idle',
  'running',
  'waiting_permission',
  'interrupted',
  'error',
  'archived',
]);

export const messageRoleSchema = z.enum(['user', 'assistant', 'system', 'tool']);
export const toolCallStatusSchema = z.enum(['running', 'completed', 'failed']);
export const permissionDecisionSchema = z.enum(['allow_once', 'deny']);
export const permissionStatusSchema = z.enum(['pending', 'resolved', 'expired']);

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const jsonObjectSchema = z.record(z.string(), jsonValueSchema);

export const sessionSummarySchema = z
  .object({
    id: entityIdSchema,
    projectId: z.string().trim().min(1).max(128),
    projectDisplayName: z.string().trim().min(1).max(120),
    title: z.string().trim().min(1).max(200),
    status: sessionStatusSchema,
    lastMessagePreview: z.string().max(500).nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const messageSchema = z
  .object({
    id: entityIdSchema,
    sessionId: entityIdSchema,
    role: messageRoleSchema,
    content: z.string(),
    isPartial: z.boolean(),
    createdAt: timestampSchema,
  })
  .strict();

const toolCallBaseSchema = z
  .object({
    id: entityIdSchema,
    sessionId: entityIdSchema,
    toolName: z.string().trim().min(1).max(200),
    input: jsonObjectSchema,
    createdAt: timestampSchema,
  })
  .strict();

export const runningToolCallSchema = toolCallBaseSchema
  .extend({
    output: z.null(),
    status: z.literal('running'),
    completedAt: z.null(),
  })
  .strict();

export const completedToolCallSchema = toolCallBaseSchema
  .extend({
    output: jsonValueSchema.nullable(),
    status: z.literal('completed'),
    completedAt: timestampSchema,
  })
  .strict();

export const failedToolCallSchema = toolCallBaseSchema
  .extend({
    output: jsonValueSchema.nullable(),
    status: z.literal('failed'),
    completedAt: timestampSchema,
  })
  .strict();

export const toolCallSchema = z.discriminatedUnion('status', [
  runningToolCallSchema,
  completedToolCallSchema,
  failedToolCallSchema,
]);

const permissionRequestBaseSchema = z
  .object({
    id: entityIdSchema,
    sessionId: entityIdSchema,
    toolCallId: entityIdSchema.nullable(),
    toolName: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(2_000).nullable(),
    input: jsonObjectSchema,
    createdAt: timestampSchema,
    expiresAt: timestampSchema,
  })
  .strict();

export const pendingPermissionRequestSchema = permissionRequestBaseSchema
  .extend({
    status: z.literal('pending'),
    decision: z.null(),
    decisionMessage: z.null(),
    resolvedAt: z.null(),
  })
  .strict();

export const resolvedPermissionRequestSchema = permissionRequestBaseSchema
  .extend({
    status: z.literal('resolved'),
    decision: permissionDecisionSchema,
    decisionMessage: z.string().max(2_000).nullable(),
    resolvedAt: timestampSchema,
  })
  .strict();

export const expiredPermissionRequestSchema = permissionRequestBaseSchema
  .extend({
    status: z.literal('expired'),
    decision: z.literal('deny'),
    decisionMessage: z.string().max(2_000).nullable(),
    resolvedAt: timestampSchema,
  })
  .strict();

export const permissionRequestSchema = z.discriminatedUnion('status', [
  pendingPermissionRequestSchema,
  resolvedPermissionRequestSchema,
  expiredPermissionRequestSchema,
]);

export const sessionDetailSchema = sessionSummarySchema
  .extend({
    messages: z.array(messageSchema),
    toolCalls: z.array(toolCallSchema),
    permissions: z.array(permissionRequestSchema),
  })
  .strict();

export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export type MessageRole = z.infer<typeof messageRoleSchema>;
export type ToolCallStatus = z.infer<typeof toolCallStatusSchema>;
export type PermissionDecision = z.infer<typeof permissionDecisionSchema>;
export type PermissionStatus = z.infer<typeof permissionStatusSchema>;
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export type Message = z.infer<typeof messageSchema>;
export type ToolCall = z.infer<typeof toolCallSchema>;
export type PermissionRequest = z.infer<typeof permissionRequestSchema>;
export type SessionDetail = z.infer<typeof sessionDetailSchema>;
