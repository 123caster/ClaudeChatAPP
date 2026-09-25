import { z } from 'zod';

import { protocolVersionSchema } from './envelope.js';
import {
  attachmentSummarySchema,
  entityIdSchema,
  messageSchema,
  modelSummarySchema,
  permissionDecisionSchema,
  permissionRequestSchema,
  pushSubscriptionSummarySchema,
  requestIdSchema,
  scheduleSchema,
  scheduledRunSchema,
  scheduledTaskDraftSchema,
  scheduledTaskSchema,
  scheduledTaskStatusSchema,
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
    certificate: z
      .object({
        status: z.enum(['disabled', 'ready', 'expiring', 'unavailable']),
        expiresAt: z.string().datetime().optional(),
        message: z.string().trim().min(1).optional(),
      })
      .strict()
      .optional(),
    push: z
      .object({
        status: z.enum(['disabled', 'ready', 'error']),
        message: z.string().trim().min(1).max(500).optional(),
      })
      .strict()
      .optional(),
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
    origin: z.enum(['config', 'user']),
  })
  .strict();

export const projectsResponseSchema = z
  .object({
    projects: z.array(projectSummarySchema),
  })
  .strict();

export const createProjectRequestSchema = z
  .object({
    requestId: requestIdSchema,
    displayName: z.string().trim().min(1).max(80),
    parentProjectId: z.string().trim().min(1).max(128),
    folderName: z.string().trim().min(1).max(200),
  })
  .strict();

export const createProjectResponseSchema = z
  .object({
    requestId: requestIdSchema,
    project: projectSummarySchema,
  })
  .strict();

export const deleteProjectRequestSchema = z
  .object({
    requestId: requestIdSchema,
  })
  .strict();

export const deleteProjectResponseSchema = z
  .object({
    requestId: requestIdSchema,
  })
  .strict();

export const deleteProjectFileRequestSchema = z
  .object({
    requestId: requestIdSchema,
    path: z.string().trim().min(1).max(4_000),
  })
  .strict();

export const createProjectFileRequestSchema = z
  .object({
    requestId: requestIdSchema,
    path: z.string().trim().min(1).max(4_000),
  })
  .strict();

export const createProjectFileResponseSchema = z
  .object({
    requestId: requestIdSchema,
    path: z.string().trim().min(1).max(4_000),
  })
  .strict();

export const deleteProjectFileResponseSchema = z
  .object({
    requestId: requestIdSchema,
    path: z.string().trim().min(1).max(4_000),
  })
  .strict();

export const directoryNodeSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    path: z.string().trim().min(1),
    relativePath: z.string().max(4_000),
    isDirectory: z.boolean(),
    projectId: z.string().trim().min(1).max(128).optional(),
  })
  .strict();

export const listDirectoryRequestSchema = z
  .object({
    projectId: z.string().trim().min(1).max(128),
  })
  .strict();

export const listDirectoryResponseSchema = z
  .object({
    entries: z.array(directoryNodeSchema),
  })
  .strict();

export const filePreviewResponseSchema = z
  .object({
    path: z.string().trim().min(1),
    relativePath: z.string().trim().min(1).max(4_000),
    content: z.string().nullable(),
    reason: z.enum(['binary', 'too_large']).nullable(),
  })
  .strict();

export const permissionModeSchema = z.enum(['default', 'acceptEdits', 'plan', 'bypassPermissions']);

export const getModeResponseSchema = z
  .object({
    mode: permissionModeSchema,
  })
  .strict();

export const setModeRequestSchema = z
  .object({
    requestId: requestIdSchema,
    mode: permissionModeSchema,
  })
  .strict();

export const setModeResponseSchema = z
  .object({
    requestId: requestIdSchema,
    mode: permissionModeSchema,
  })
  .strict();

export const skillSummarySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(500),
    kind: z.enum(['skill', 'command']),
  })
  .strict();

export const skillsResponseSchema = z
  .object({
    skills: z.array(skillSummarySchema),
  })
  .strict();

export const modelsResponseSchema = z
  .object({
    models: z.array(modelSummarySchema),
  })
  .strict();

export const createModelRequestSchema = z
  .object({
    requestId: requestIdSchema,
    name: z.string().trim().min(1).max(80),
    baseUrl: z.string().url(),
    apiKey: z.string().trim().min(1).max(256),
    model: z.string().trim().min(1).max(200),
    supportsImages: z.boolean().optional(),
    supportsDocuments: z.boolean().optional(),
    isMultimodalDefault: z.boolean().optional(),
  })
  .strict();

export const createModelResponseSchema = z
  .object({
    requestId: requestIdSchema,
    model: modelSummarySchema,
  })
  .strict();

export const createModelVariantsRequestSchema = z
  .object({
    requestId: requestIdSchema,
    models: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
  })
  .strict();

export const createModelVariantsResponseSchema = z
  .object({
    requestId: requestIdSchema,
    models: z.array(modelSummarySchema).min(1),
  })
  .strict();

export const updateModelRequestSchema = z
  .object({
    requestId: requestIdSchema,
    name: z.string().trim().min(1).max(80).optional(),
    baseUrl: z.string().url().optional(),
    apiKey: z.string().trim().min(1).max(256).optional(),
    model: z.string().trim().min(1).max(200).optional(),
    supportsImages: z.boolean().optional(),
    supportsDocuments: z.boolean().optional(),
    isMultimodalDefault: z.boolean().optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.name !== undefined ||
      input.baseUrl !== undefined ||
      input.apiKey !== undefined ||
      input.model !== undefined ||
      input.supportsImages !== undefined ||
      input.supportsDocuments !== undefined ||
      input.isMultimodalDefault !== undefined,
    {
      message: 'At least one model field must be provided.',
    },
  );

export const updateModelResponseSchema = z
  .object({
    requestId: requestIdSchema,
    model: modelSummarySchema,
  })
  .strict();

export const setActiveModelRequestSchema = z
  .object({
    requestId: requestIdSchema,
  })
  .strict();

export const setActiveModelResponseSchema = z
  .object({
    requestId: requestIdSchema,
    model: modelSummarySchema,
  })
  .strict();

export const setDefaultMultimodalModelRequestSchema = z
  .object({
    requestId: requestIdSchema,
  })
  .strict();

export const setDefaultMultimodalModelResponseSchema = z
  .object({
    requestId: requestIdSchema,
    model: modelSummarySchema,
  })
  .strict();

export const createModelVariantRequestSchema = z
  .object({
    requestId: requestIdSchema,
    model: z.string().trim().min(1).max(200),
  })
  .strict();

export const createModelVariantResponseSchema = z
  .object({
    requestId: requestIdSchema,
    model: modelSummarySchema,
  })
  .strict();

export const deleteModelRequestSchema = z
  .object({
    requestId: requestIdSchema,
  })
  .strict();

export const deleteModelResponseSchema = z
  .object({
    requestId: requestIdSchema,
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

const attachmentIdsSchema = z
  .array(entityIdSchema)
  .max(9)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: 'Attachment ids must be unique.',
  });

const hasMessageContent = (input: { message: string; attachmentIds?: string[] }): boolean =>
  input.message.length > 0 || (input.attachmentIds?.length ?? 0) > 0;

export const createSessionRequestSchema = z
  .object({
    requestId: requestIdSchema,
    projectId: z.string().trim().min(1).max(128),
    workingDirectory: z.string().trim().min(1).max(4_000).optional(),
    message: z.string().trim().max(100_000),
    attachmentIds: attachmentIdsSchema.optional(),
    title: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .refine(hasMessageContent, {
    message: 'A message or at least one attachment is required.',
    path: ['message'],
  });

export const createSessionResponseSchema = z
  .object({
    requestId: requestIdSchema,
    session: sessionDetailSchema,
  })
  .strict();

export const sendMessageRequestSchema = z
  .object({
    requestId: requestIdSchema,
    message: z.string().trim().max(100_000),
    attachmentIds: attachmentIdsSchema.optional(),
  })
  .strict()
  .refine(hasMessageContent, {
    message: 'A message or at least one attachment is required.',
    path: ['message'],
  });

export const sendMessageResponseSchema = z
  .object({
    requestId: requestIdSchema,
    message: messageSchema,
    session: sessionSummarySchema,
  })
  .strict();

export const setSessionModelRequestSchema = z
  .object({
    requestId: requestIdSchema,
    modelId: entityIdSchema,
  })
  .strict();

export const setSessionModelResponseSchema = z
  .object({
    requestId: requestIdSchema,
    session: sessionSummarySchema,
  })
  .strict();

export const renameSessionRequestSchema = z
  .object({
    requestId: requestIdSchema,
    title: z.string().trim().min(1).max(200),
  })
  .strict();

export const renameSessionResponseSchema = z
  .object({
    requestId: requestIdSchema,
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

export const clearSessionRequestSchema = writeActionRequestSchema;

export const clearSessionResponseSchema = z
  .object({
    requestId: requestIdSchema,
    session: sessionDetailSchema,
  })
  .strict();

export const archiveSessionRequestSchema = writeActionRequestSchema;

export const archiveSessionResponseSchema = z
  .object({
    requestId: requestIdSchema,
    session: sessionSummarySchema,
  })
  .strict();

export const deleteSessionRequestSchema = writeActionRequestSchema;

export const deleteSessionResponseSchema = z
  .object({
    requestId: requestIdSchema,
    sessionId: entityIdSchema,
  })
  .strict();

export const permissionDecisionRequestSchema = z
  .object({
    requestId: requestIdSchema,
    decision: permissionDecisionSchema,
    answer: z.string().trim().min(1).max(4_000).optional(),
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

export const projectParamsSchema = z
  .object({
    projectId: z.string().trim().min(1).max(128),
  })
  .strict();

export const permissionParamsSchema = z
  .object({
    permissionId: entityIdSchema,
  })
  .strict();

export const modelParamsSchema = z
  .object({
    modelId: entityIdSchema,
  })
  .strict();

export const attachmentParamsSchema = z
  .object({
    attachmentId: entityIdSchema,
  })
  .strict();

export const uploadAttachmentFieldsSchema = z
  .object({
    requestId: requestIdSchema,
    draftId: entityIdSchema,
    sessionId: entityIdSchema.optional(),
  })
  .strict();

export const uploadAttachmentResponseSchema = z
  .object({
    requestId: requestIdSchema,
    attachment: attachmentSummarySchema,
  })
  .strict();

export const deleteAttachmentRequestSchema = z
  .object({
    requestId: requestIdSchema,
  })
  .strict();

export const deleteAttachmentResponseSchema = z
  .object({
    requestId: requestIdSchema,
    attachmentId: entityIdSchema,
  })
  .strict();

export const scheduledTasksResponseSchema = z
  .object({
    tasks: z.array(scheduledTaskSchema),
  })
  .strict();

export const scheduledTaskDetailResponseSchema = z
  .object({
    task: scheduledTaskSchema,
    runs: z.array(scheduledRunSchema),
  })
  .strict();

export const createScheduledTaskRequestSchema = z
  .object({
    requestId: requestIdSchema,
    name: z.string().trim().min(1).max(120),
    prompt: z.string().trim().min(1).max(100_000),
    schedule: scheduleSchema,
    timeZone: z.string().trim().min(1).max(100),
    projectId: z.string().trim().min(1).max(128),
    workingDirectory: z.string().trim().min(1).max(4_000).nullable().optional(),
    modelId: entityIdSchema.nullable().optional(),
    allowAutoWrite: z.boolean(),
  })
  .strict();

export const createScheduledTaskResponseSchema = z
  .object({
    requestId: requestIdSchema,
    task: scheduledTaskSchema,
  })
  .strict();

export const updateScheduledTaskRequestSchema = z
  .object({
    requestId: requestIdSchema,
    name: z.string().trim().min(1).max(120).optional(),
    prompt: z.string().trim().min(1).max(100_000).optional(),
    status: scheduledTaskStatusSchema.exclude(['deleted']).optional(),
    schedule: scheduleSchema.optional(),
    timeZone: z.string().trim().min(1).max(100).optional(),
    projectId: z.string().trim().min(1).max(128).optional(),
    workingDirectory: z.string().trim().min(1).max(4_000).nullable().optional(),
    modelId: entityIdSchema.nullable().optional(),
    allowAutoWrite: z.boolean().optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.name !== undefined ||
      input.prompt !== undefined ||
      input.status !== undefined ||
      input.schedule !== undefined ||
      input.timeZone !== undefined ||
      input.projectId !== undefined ||
      input.workingDirectory !== undefined ||
      input.modelId !== undefined ||
      input.allowAutoWrite !== undefined,
    { message: 'At least one scheduled task field must be provided.' },
  );

export const updateScheduledTaskResponseSchema = createScheduledTaskResponseSchema;

export const runScheduledTaskRequestSchema = writeActionRequestSchema;

export const runScheduledTaskResponseSchema = z
  .object({
    requestId: requestIdSchema,
    task: scheduledTaskSchema,
    run: scheduledRunSchema,
  })
  .strict();

export const deleteScheduledTaskRequestSchema = writeActionRequestSchema;

export const deleteScheduledTaskResponseSchema = z
  .object({
    requestId: requestIdSchema,
    taskId: entityIdSchema,
  })
  .strict();

export const markScheduledTaskReadRequestSchema = writeActionRequestSchema;

export const markScheduledTaskReadResponseSchema = z
  .object({
    requestId: requestIdSchema,
    task: scheduledTaskSchema,
  })
  .strict();

export const scheduledTaskRunsResponseSchema = z
  .object({
    runs: z.array(scheduledRunSchema),
  })
  .strict();

export const scheduledTaskDraftRequestSchema = z
  .object({
    requestId: requestIdSchema,
    text: z.string().trim().min(1).max(100_000),
    timeZone: z.string().trim().min(1).max(100),
    projectId: z.string().trim().min(1).max(128).nullable().optional(),
    workingDirectory: z.string().trim().min(1).max(4_000).nullable().optional(),
    modelId: entityIdSchema.nullable().optional(),
  })
  .strict();

export const scheduledTaskDraftResponseSchema = z
  .object({
    requestId: requestIdSchema,
    draft: scheduledTaskDraftSchema,
  })
  .strict();

export const scheduledTaskParamsSchema = z
  .object({
    taskId: entityIdSchema,
  })
  .strict();

export const upsertPushSubscriptionRequestSchema = z
  .object({
    requestId: requestIdSchema,
    provider: z.literal('expo'),
    platform: z.literal('android'),
    token: z.string().trim().min(1).max(500),
  })
  .strict();

export const upsertPushSubscriptionResponseSchema = z
  .object({
    requestId: requestIdSchema,
    subscription: pushSubscriptionSummarySchema,
  })
  .strict();

export const deletePushSubscriptionRequestSchema = writeActionRequestSchema;

export const deletePushSubscriptionResponseSchema = z
  .object({
    requestId: requestIdSchema,
    deviceId: z.string().trim().min(1).max(128),
  })
  .strict();

export type ClaudeHealthStatus = z.infer<typeof claudeHealthStatusSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type PairingExchangeRequest = z.infer<typeof pairingExchangeRequestSchema>;
export type PairedDevice = z.infer<typeof pairedDeviceSchema>;
export type PairingExchangeResponse = z.infer<typeof pairingExchangeResponseSchema>;
export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export type ProjectsResponse = z.infer<typeof projectsResponseSchema>;
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;
export type CreateProjectResponse = z.infer<typeof createProjectResponseSchema>;
export type DeleteProjectRequest = z.infer<typeof deleteProjectRequestSchema>;
export type DeleteProjectResponse = z.infer<typeof deleteProjectResponseSchema>;
export type DeleteProjectFileRequest = z.infer<typeof deleteProjectFileRequestSchema>;
export type DeleteProjectFileResponse = z.infer<typeof deleteProjectFileResponseSchema>;
export type CreateProjectFileRequest = z.infer<typeof createProjectFileRequestSchema>;
export type CreateProjectFileResponse = z.infer<typeof createProjectFileResponseSchema>;
export type DirectoryNode = z.infer<typeof directoryNodeSchema>;
export type ListDirectoryRequest = z.infer<typeof listDirectoryRequestSchema>;
export type ListDirectoryResponse = z.infer<typeof listDirectoryResponseSchema>;
export type FilePreviewResponse = z.infer<typeof filePreviewResponseSchema>;
export type PermissionMode = z.infer<typeof permissionModeSchema>;
export type GetModeResponse = z.infer<typeof getModeResponseSchema>;
export type SetModeRequest = z.infer<typeof setModeRequestSchema>;
export type SetModeResponse = z.infer<typeof setModeResponseSchema>;
export type SkillSummary = z.infer<typeof skillSummarySchema>;
export type SkillsResponse = z.infer<typeof skillsResponseSchema>;
export type ModelsResponse = z.infer<typeof modelsResponseSchema>;
export type CreateModelRequest = z.infer<typeof createModelRequestSchema>;
export type CreateModelResponse = z.infer<typeof createModelResponseSchema>;
export type CreateModelVariantsRequest = z.infer<typeof createModelVariantsRequestSchema>;
export type CreateModelVariantsResponse = z.infer<typeof createModelVariantsResponseSchema>;
export type UpdateModelRequest = z.infer<typeof updateModelRequestSchema>;
export type UpdateModelResponse = z.infer<typeof updateModelResponseSchema>;
export type SetActiveModelRequest = z.infer<typeof setActiveModelRequestSchema>;
export type SetActiveModelResponse = z.infer<typeof setActiveModelResponseSchema>;
export type SetDefaultMultimodalModelRequest = z.infer<
  typeof setDefaultMultimodalModelRequestSchema
>;
export type SetDefaultMultimodalModelResponse = z.infer<
  typeof setDefaultMultimodalModelResponseSchema
>;
export type CreateModelVariantRequest = z.infer<typeof createModelVariantRequestSchema>;
export type CreateModelVariantResponse = z.infer<typeof createModelVariantResponseSchema>;
export type DeleteModelRequest = z.infer<typeof deleteModelRequestSchema>;
export type DeleteModelResponse = z.infer<typeof deleteModelResponseSchema>;
export type SessionsResponse = z.infer<typeof sessionsResponseSchema>;
export type SessionDetailResponse = z.infer<typeof sessionDetailResponseSchema>;
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;
export type CreateSessionResponse = z.infer<typeof createSessionResponseSchema>;
export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;
export type SendMessageResponse = z.infer<typeof sendMessageResponseSchema>;
export type SetSessionModelRequest = z.infer<typeof setSessionModelRequestSchema>;
export type SetSessionModelResponse = z.infer<typeof setSessionModelResponseSchema>;
export type RenameSessionRequest = z.infer<typeof renameSessionRequestSchema>;
export type RenameSessionResponse = z.infer<typeof renameSessionResponseSchema>;
export type WriteActionRequest = z.infer<typeof writeActionRequestSchema>;
export type CancelSessionRequest = z.infer<typeof cancelSessionRequestSchema>;
export type CancelSessionResponse = z.infer<typeof cancelSessionResponseSchema>;
export type ClearSessionRequest = z.infer<typeof clearSessionRequestSchema>;
export type ClearSessionResponse = z.infer<typeof clearSessionResponseSchema>;
export type ArchiveSessionRequest = z.infer<typeof archiveSessionRequestSchema>;
export type ArchiveSessionResponse = z.infer<typeof archiveSessionResponseSchema>;
export type DeleteSessionRequest = z.infer<typeof deleteSessionRequestSchema>;
export type DeleteSessionResponse = z.infer<typeof deleteSessionResponseSchema>;
export type PermissionDecisionRequest = z.infer<typeof permissionDecisionRequestSchema>;
export type PermissionDecisionResponse = z.infer<typeof permissionDecisionResponseSchema>;
export type SessionParams = z.infer<typeof sessionParamsSchema>;
export type ProjectParams = z.infer<typeof projectParamsSchema>;
export type PermissionParams = z.infer<typeof permissionParamsSchema>;
export type ModelParams = z.infer<typeof modelParamsSchema>;
export type AttachmentParams = z.infer<typeof attachmentParamsSchema>;
export type UploadAttachmentFields = z.infer<typeof uploadAttachmentFieldsSchema>;
export type UploadAttachmentResponse = z.infer<typeof uploadAttachmentResponseSchema>;
export type DeleteAttachmentRequest = z.infer<typeof deleteAttachmentRequestSchema>;
export type DeleteAttachmentResponse = z.infer<typeof deleteAttachmentResponseSchema>;
export type ScheduledTasksResponse = z.infer<typeof scheduledTasksResponseSchema>;
export type ScheduledTaskDetailResponse = z.infer<typeof scheduledTaskDetailResponseSchema>;
export type CreateScheduledTaskRequest = z.infer<typeof createScheduledTaskRequestSchema>;
export type CreateScheduledTaskResponse = z.infer<typeof createScheduledTaskResponseSchema>;
export type UpdateScheduledTaskRequest = z.infer<typeof updateScheduledTaskRequestSchema>;
export type UpdateScheduledTaskResponse = z.infer<typeof updateScheduledTaskResponseSchema>;
export type RunScheduledTaskRequest = z.infer<typeof runScheduledTaskRequestSchema>;
export type RunScheduledTaskResponse = z.infer<typeof runScheduledTaskResponseSchema>;
export type DeleteScheduledTaskRequest = z.infer<typeof deleteScheduledTaskRequestSchema>;
export type DeleteScheduledTaskResponse = z.infer<typeof deleteScheduledTaskResponseSchema>;
export type MarkScheduledTaskReadRequest = z.infer<typeof markScheduledTaskReadRequestSchema>;
export type MarkScheduledTaskReadResponse = z.infer<typeof markScheduledTaskReadResponseSchema>;
export type ScheduledTaskRunsResponse = z.infer<typeof scheduledTaskRunsResponseSchema>;
export type ScheduledTaskDraftRequest = z.infer<typeof scheduledTaskDraftRequestSchema>;
export type ScheduledTaskDraftResponse = z.infer<typeof scheduledTaskDraftResponseSchema>;
export type ScheduledTaskParams = z.infer<typeof scheduledTaskParamsSchema>;
export type UpsertPushSubscriptionRequest = z.infer<typeof upsertPushSubscriptionRequestSchema>;
export type UpsertPushSubscriptionResponse = z.infer<typeof upsertPushSubscriptionResponseSchema>;
export type DeletePushSubscriptionRequest = z.infer<typeof deletePushSubscriptionRequestSchema>;
export type DeletePushSubscriptionResponse = z.infer<typeof deletePushSubscriptionResponseSchema>;
