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
export const attachmentKindSchema = z.enum(['image', 'document']);
export const attachmentStatusSchema = z.enum(['ready', 'bound']);
export const scheduledTaskStatusSchema = z.enum(['active', 'paused', 'completed', 'deleted']);
export const scheduledRunStatusSchema = z.enum([
  'queued',
  'running',
  'waiting_permission',
  'succeeded',
  'failed',
  'skipped',
  'cancelled',
]);
export const scheduledRunTriggerSchema = z.enum(['scheduled', 'manual', 'recovery']);
export const scheduledNotificationStatusSchema = z.enum([
  'not_requested',
  'pending',
  'sent',
  'failed',
]);

const scheduledTimeFields = {
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
};

export const onceScheduleSchema = z
  .object({
    kind: z.literal('once'),
    localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    ...scheduledTimeFields,
  })
  .strict();

export const dailyScheduleSchema = z
  .object({
    kind: z.literal('daily'),
    ...scheduledTimeFields,
  })
  .strict();

export const weekdaysScheduleSchema = z
  .object({
    kind: z.literal('weekdays'),
    ...scheduledTimeFields,
  })
  .strict();

export const weeklyScheduleSchema = z
  .object({
    kind: z.literal('weekly'),
    weekday: z.number().int().min(1).max(7),
    ...scheduledTimeFields,
  })
  .strict();

export const monthlyScheduleSchema = z
  .object({
    kind: z.literal('monthly'),
    day: z.number().int().min(1).max(31),
    ...scheduledTimeFields,
  })
  .strict();

export const scheduleSchema = z.discriminatedUnion('kind', [
  onceScheduleSchema,
  dailyScheduleSchema,
  weekdaysScheduleSchema,
  weeklyScheduleSchema,
  monthlyScheduleSchema,
]);

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
    workingDirectory: z.string().trim().min(1).max(4_000).nullable().optional(),
    modelId: entityIdSchema.nullable().optional(),
    title: z.string().trim().min(1).max(200),
    status: sessionStatusSchema,
    lastMessagePreview: z.string().max(500).nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const attachmentSummarySchema = z
  .object({
    id: entityIdSchema,
    kind: attachmentKindSchema,
    name: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().min(1).max(200),
    size: z
      .number()
      .int()
      .nonnegative()
      .max(20 * 1024 * 1024),
    status: attachmentStatusSchema,
    previewAvailable: z.boolean(),
    createdAt: timestampSchema,
  })
  .strict();

export const messageSchema = z
  .object({
    id: entityIdSchema,
    sessionId: entityIdSchema,
    role: messageRoleSchema,
    content: z.string(),
    attachments: z.array(attachmentSummarySchema).max(9).optional(),
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

export const modelSummarySchema = z
  .object({
    id: entityIdSchema,
    name: z.string().trim().min(1).max(80),
    baseUrl: z.string().url(),
    model: z.string().trim().min(1).max(200),
    isActive: z.boolean(),
    supportsImages: z.boolean().optional(),
    supportsDocuments: z.boolean().optional(),
    isMultimodalDefault: z.boolean().optional(),
    createdAt: timestampSchema,
  })
  .strict();

export const scheduledTaskSchema = z
  .object({
    id: entityIdSchema,
    name: z.string().trim().min(1).max(120),
    prompt: z.string().trim().min(1).max(100_000),
    status: scheduledTaskStatusSchema,
    triggerType: z.literal('time'),
    schedule: scheduleSchema,
    timeZone: z.string().trim().min(1).max(100),
    nextRunAt: timestampSchema.nullable(),
    lastRunAt: timestampSchema.nullable(),
    sessionId: entityIdSchema,
    projectId: z.string().trim().min(1).max(128),
    workingDirectory: z.string().trim().min(1).max(4_000).nullable(),
    modelId: entityIdSchema.nullable(),
    allowAutoWrite: z.boolean(),
    notificationPolicy: z.literal('all_results'),
    unreadCount: z.number().int().nonnegative(),
    needsAttention: z.boolean(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    deletedAt: timestampSchema.nullable(),
  })
  .strict();

export const scheduledRunSchema = z
  .object({
    id: entityIdSchema,
    taskId: entityIdSchema,
    scheduledFor: timestampSchema,
    triggerSource: scheduledRunTriggerSchema,
    status: scheduledRunStatusSchema,
    requestId: requestIdSchema,
    userMessageId: entityIdSchema.nullable(),
    assistantMessageId: entityIdSchema.nullable(),
    attemptCount: z.number().int().nonnegative(),
    startedAt: timestampSchema.nullable(),
    completedAt: timestampSchema.nullable(),
    errorCode: z.string().trim().min(1).max(128).nullable(),
    errorMessage: z.string().trim().min(1).max(2_000).nullable(),
    notificationStatus: scheduledNotificationStatusSchema,
    isRead: z.boolean(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const pushSubscriptionSummarySchema = z
  .object({
    deviceId: z.string().trim().min(1).max(128),
    provider: z.literal('expo'),
    platform: z.literal('android'),
    enabled: z.boolean(),
    updatedAt: timestampSchema,
  })
  .strict();

export const scheduledDraftMissingFieldSchema = z.enum([
  'name',
  'prompt',
  'schedule',
  'timeZone',
  'projectId',
]);

export const scheduledTaskDraftSchema = z
  .object({
    name: z.string().trim().min(1).max(120).nullable(),
    prompt: z.string().trim().min(1).max(100_000),
    schedule: scheduleSchema.nullable(),
    timeZone: z.string().trim().min(1).max(100),
    projectId: z.string().trim().min(1).max(128).nullable(),
    workingDirectory: z.string().trim().min(1).max(4_000).nullable(),
    modelId: entityIdSchema.nullable(),
    allowAutoWrite: z.boolean(),
    missingFields: z.array(scheduledDraftMissingFieldSchema),
  })
  .strict();

export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export type MessageRole = z.infer<typeof messageRoleSchema>;
export type ToolCallStatus = z.infer<typeof toolCallStatusSchema>;
export type PermissionDecision = z.infer<typeof permissionDecisionSchema>;
export type PermissionStatus = z.infer<typeof permissionStatusSchema>;
export type AttachmentKind = z.infer<typeof attachmentKindSchema>;
export type AttachmentStatus = z.infer<typeof attachmentStatusSchema>;
export type ScheduledTaskStatus = z.infer<typeof scheduledTaskStatusSchema>;
export type ScheduledRunStatus = z.infer<typeof scheduledRunStatusSchema>;
export type ScheduledRunTrigger = z.infer<typeof scheduledRunTriggerSchema>;
export type ScheduledNotificationStatus = z.infer<typeof scheduledNotificationStatusSchema>;
export type Schedule = z.infer<typeof scheduleSchema>;
export type AttachmentSummary = z.infer<typeof attachmentSummarySchema>;
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export type Message = z.infer<typeof messageSchema>;
export type ToolCall = z.infer<typeof toolCallSchema>;
export type PermissionRequest = z.infer<typeof permissionRequestSchema>;
export type SessionDetail = z.infer<typeof sessionDetailSchema>;
export type ModelSummary = z.infer<typeof modelSummarySchema>;
export type ScheduledTask = z.infer<typeof scheduledTaskSchema>;
export type ScheduledRun = z.infer<typeof scheduledRunSchema>;
export type PushSubscriptionSummary = z.infer<typeof pushSubscriptionSummarySchema>;
export type ScheduledTaskDraft = z.infer<typeof scheduledTaskDraftSchema>;
