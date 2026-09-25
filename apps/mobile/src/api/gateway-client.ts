import {
  archiveSessionResponseSchema,
  createScheduledTaskResponseSchema,
  cancelSessionResponseSchema,
  clearSessionResponseSchema,
  createModelResponseSchema,
  createModelVariantsResponseSchema,
  createModelVariantResponseSchema,
  createProjectResponseSchema,
  createProjectFileResponseSchema,
  createSessionResponseSchema,
  deleteModelResponseSchema,
  deleteAttachmentResponseSchema,
  deleteProjectResponseSchema,
  deleteProjectFileResponseSchema,
  deleteSessionResponseSchema,
  deleteScheduledTaskResponseSchema,
  errorResponseSchema,
  filePreviewResponseSchema,
  getModeResponseSchema,
  healthResponseSchema,
  listDirectoryResponseSchema,
  markScheduledTaskReadResponseSchema,
  modelsResponseSchema,
  permissionDecisionResponseSchema,
  pairingExchangeResponseSchema,
  projectsResponseSchema,
  sessionDetailResponseSchema,
  sessionsResponseSchema,
  sendMessageResponseSchema,
  setActiveModelResponseSchema,
  setDefaultMultimodalModelResponseSchema,
  setSessionModelResponseSchema,
  renameSessionResponseSchema,
  runScheduledTaskResponseSchema,
  scheduledTaskDetailResponseSchema,
  scheduledTaskDraftResponseSchema,
  scheduledTasksResponseSchema,
  updateModelResponseSchema,
  updateScheduledTaskResponseSchema,
  upsertPushSubscriptionResponseSchema,
  deletePushSubscriptionResponseSchema,
  uploadAttachmentResponseSchema,
  setModeResponseSchema,
  skillsResponseSchema,
  type CreateModelRequest,
  type CreateModelResponse,
  type CreateModelVariantsResponse,
  type CreateModelVariantResponse,
  type CreateProjectRequest,
  type CreateProjectResponse,
  type CreateProjectFileResponse,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type CreateScheduledTaskRequest,
  type CreateScheduledTaskResponse,
  type ClearSessionResponse,
  type DeleteModelResponse,
  type DeleteAttachmentResponse,
  type DeleteProjectFileResponse,
  type DirectoryNode,
  type HealthResponse,
  type ModelSummary,
  type AttachmentSummary,
  type PermissionDecision,
  type PermissionDecisionResponse,
  type PermissionMode,
  type PairingExchangeResponse,
  type ProjectSummary,
  type SessionDetail,
  type SessionSummary,
  type ScheduledTask,
  type ScheduledTaskDetailResponse,
  type ScheduledTaskDraftResponse,
  type SendMessageResponse,
  type SetActiveModelResponse,
  type SetDefaultMultimodalModelResponse,
  type SetSessionModelResponse,
  type RenameSessionResponse,
  type UpdateModelResponse,
  type UpdateScheduledTaskRequest,
  type UpdateScheduledTaskResponse,
  type UploadAttachmentResponse,
  type SkillSummary,
} from '@claude-chat/protocol';

type Parser<T> = {
  safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: unknown };
};

export class GatewayRequestError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly status: number | null,
  ) {
    super(message);
    this.name = 'GatewayRequestError';
  }
}

export function normalizeGatewayUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('请输入 Gateway 地址');

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('请输入有效的 Gateway 地址');
  }

  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    throw new Error('Gateway 地址必须以 http:// 或 https:// 开头');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Gateway 地址不能包含账号、查询参数或锚点');
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error('Gateway 地址不能包含接口路径');
  }
  return url.origin;
}

export function createRequestId(): string {
  const cryptoObject = globalThis.crypto as { randomUUID?: () => string } | undefined;
  return cryptoObject?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createEntityId(): string {
  const cryptoObject = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoObject?.randomUUID) return cryptoObject.randomUUID();
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type UploadAttachmentInput = {
  uri: string;
  name: string;
  mimeType: string;
  draftId: string;
  sessionId?: string;
  requestId?: string;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
};

type RequestOptions<T> = {
  method?: 'GET' | 'POST';
  body?: unknown;
  apiKey?: string;
  schema: Parser<T>;
};

export class GatewayClient {
  public constructor(private readonly gatewayUrl: string) {}

  public health(apiKey?: string): Promise<HealthResponse> {
    return this.request('/v1/health', { apiKey, schema: healthResponseSchema });
  }

  public connect(apiKey: string): Promise<HealthResponse> {
    return this.health(apiKey);
  }

  public pair(code: string, deviceName: string): Promise<PairingExchangeResponse> {
    return this.request('/v1/pairing/exchange', {
      method: 'POST',
      body: { code, deviceName },
      schema: pairingExchangeResponseSchema,
    });
  }

  public async projects(apiKey: string): Promise<ProjectSummary[]> {
    const response = await this.request('/v1/projects', { apiKey, schema: projectsResponseSchema });
    return response.projects;
  }

  public async listDirectory(apiKey: string, projectId: string): Promise<DirectoryNode[]> {
    return this.listDirectoryAt(apiKey, projectId, '');
  }

  public async listDirectoryAt(
    apiKey: string,
    projectId: string,
    relativePath: string,
  ): Promise<DirectoryNode[]> {
    const search = relativePath ? `?path=${encodeURIComponent(relativePath)}` : '';
    const response = await this.request(
      `/v1/projects/${encodeURIComponent(projectId)}/tree${search}`,
      {
        apiKey,
        schema: listDirectoryResponseSchema,
      },
    );
    return response.entries;
  }

  public previewFile(apiKey: string, projectId: string, relativePath: string) {
    return this.request(
      `/v1/projects/${encodeURIComponent(projectId)}/file?path=${encodeURIComponent(relativePath)}`,
      { apiKey, schema: filePreviewResponseSchema },
    );
  }

  public async mode(apiKey: string): Promise<PermissionMode> {
    const response = await this.request('/v1/mode', { apiKey, schema: getModeResponseSchema });
    return response.mode;
  }

  public async setMode(
    apiKey: string,
    mode: PermissionMode,
    requestId: string,
  ): Promise<PermissionMode> {
    const response = await this.request('/v1/mode', {
      method: 'POST',
      apiKey,
      body: { requestId, mode },
      schema: setModeResponseSchema,
    });
    return response.mode;
  }

  public async skills(apiKey: string): Promise<SkillSummary[]> {
    const response = await this.request('/v1/skills', { apiKey, schema: skillsResponseSchema });
    return response.skills;
  }

  public createProject(
    apiKey: string,
    input: CreateProjectRequest,
  ): Promise<CreateProjectResponse> {
    return this.request('/v1/projects', {
      method: 'POST',
      apiKey,
      body: input,
      schema: createProjectResponseSchema,
    });
  }

  public deleteProject(apiKey: string, projectId: string, requestId: string): Promise<void> {
    return this.request(`/v1/projects/${encodeURIComponent(projectId)}/delete`, {
      method: 'POST',
      apiKey,
      body: { requestId },
      schema: deleteProjectResponseSchema,
    }).then(() => undefined);
  }

  public deleteProjectFile(
    apiKey: string,
    projectId: string,
    relativePath: string,
    requestId: string,
  ): Promise<DeleteProjectFileResponse> {
    return this.request(`/v1/projects/${encodeURIComponent(projectId)}/files/delete`, {
      method: 'POST',
      apiKey,
      body: { requestId, path: relativePath },
      schema: deleteProjectFileResponseSchema,
    });
  }

  public createProjectFile(
    apiKey: string,
    projectId: string,
    relativePath: string,
    requestId: string,
  ): Promise<CreateProjectFileResponse> {
    return this.request(`/v1/projects/${encodeURIComponent(projectId)}/files`, {
      method: 'POST',
      apiKey,
      body: { requestId, path: relativePath },
      schema: createProjectFileResponseSchema,
    });
  }

  public async models(apiKey: string): Promise<ModelSummary[]> {
    const response = await this.request('/v1/models', { apiKey, schema: modelsResponseSchema });
    return response.models;
  }

  public createModel(apiKey: string, input: CreateModelRequest): Promise<CreateModelResponse> {
    return this.request('/v1/models', {
      method: 'POST',
      apiKey,
      body: input,
      schema: createModelResponseSchema,
    });
  }

  public setActiveModel(
    apiKey: string,
    modelId: string,
    requestId: string,
  ): Promise<SetActiveModelResponse> {
    return this.request(`/v1/models/${encodeURIComponent(modelId)}/active`, {
      method: 'POST',
      apiKey,
      body: { requestId },
      schema: setActiveModelResponseSchema,
    });
  }

  public setDefaultMultimodalModel(
    apiKey: string,
    modelId: string,
    requestId: string,
  ): Promise<SetDefaultMultimodalModelResponse> {
    return this.request(`/v1/models/${encodeURIComponent(modelId)}/multimodal-default`, {
      method: 'POST',
      apiKey,
      body: { requestId },
      schema: setDefaultMultimodalModelResponseSchema,
    });
  }

  public createModelVariant(
    apiKey: string,
    modelId: string,
    model: string,
    requestId: string,
  ): Promise<CreateModelVariantResponse> {
    return this.request(`/v1/models/${encodeURIComponent(modelId)}/variants`, {
      method: 'POST',
      apiKey,
      body: { requestId, model },
      schema: createModelVariantResponseSchema,
    });
  }

  public createModelVariants(
    apiKey: string,
    modelId: string,
    models: string[],
    requestId: string,
  ): Promise<CreateModelVariantsResponse> {
    return this.request(`/v1/models/${encodeURIComponent(modelId)}/variants/batch`, {
      method: 'POST',
      apiKey,
      body: { requestId, models },
      schema: createModelVariantsResponseSchema,
    });
  }

  public updateModel(
    apiKey: string,
    modelId: string,
    input: {
      name?: string;
      baseUrl?: string;
      apiKey?: string;
      model?: string;
      supportsImages?: boolean;
      supportsDocuments?: boolean;
      isMultimodalDefault?: boolean;
    },
    requestId: string,
  ): Promise<UpdateModelResponse> {
    return this.request(`/v1/models/${encodeURIComponent(modelId)}/update`, {
      method: 'POST',
      apiKey,
      body: { requestId, ...input },
      schema: updateModelResponseSchema,
    });
  }

  public deleteModel(
    apiKey: string,
    modelId: string,
    requestId: string,
  ): Promise<DeleteModelResponse> {
    return this.request(`/v1/models/${encodeURIComponent(modelId)}/delete`, {
      method: 'POST',
      apiKey,
      body: { requestId },
      schema: deleteModelResponseSchema,
    });
  }

  public async sessions(apiKey: string): Promise<SessionSummary[]> {
    const response = await this.request('/v1/sessions', { apiKey, schema: sessionsResponseSchema });
    return response.sessions;
  }

  public async scheduledTasks(apiKey: string): Promise<ScheduledTask[]> {
    const response = await this.request('/v1/scheduled-tasks', {
      apiKey,
      schema: scheduledTasksResponseSchema,
    });
    return response.tasks;
  }

  public scheduledTask(apiKey: string, taskId: string): Promise<ScheduledTaskDetailResponse> {
    return this.request(`/v1/scheduled-tasks/${encodeURIComponent(taskId)}`, {
      apiKey,
      schema: scheduledTaskDetailResponseSchema,
    });
  }

  public createScheduledTask(
    apiKey: string,
    input: CreateScheduledTaskRequest,
  ): Promise<CreateScheduledTaskResponse> {
    return this.request('/v1/scheduled-tasks', {
      method: 'POST',
      apiKey,
      body: input,
      schema: createScheduledTaskResponseSchema,
    });
  }

  public updateScheduledTask(
    apiKey: string,
    taskId: string,
    input: UpdateScheduledTaskRequest,
  ): Promise<UpdateScheduledTaskResponse> {
    return this.request(`/v1/scheduled-tasks/${encodeURIComponent(taskId)}/update`, {
      method: 'POST',
      apiKey,
      body: input,
      schema: updateScheduledTaskResponseSchema,
    });
  }

  public runScheduledTask(apiKey: string, taskId: string, requestId: string) {
    return this.request(`/v1/scheduled-tasks/${encodeURIComponent(taskId)}/run`, {
      method: 'POST',
      apiKey,
      body: { requestId },
      schema: runScheduledTaskResponseSchema,
    });
  }

  public deleteScheduledTask(apiKey: string, taskId: string, requestId: string): Promise<void> {
    return this.request(`/v1/scheduled-tasks/${encodeURIComponent(taskId)}/delete`, {
      method: 'POST',
      apiKey,
      body: { requestId },
      schema: deleteScheduledTaskResponseSchema,
    }).then(() => undefined);
  }

  public markScheduledTaskRead(apiKey: string, taskId: string, requestId: string) {
    return this.request(`/v1/scheduled-tasks/${encodeURIComponent(taskId)}/read`, {
      method: 'POST',
      apiKey,
      body: { requestId },
      schema: markScheduledTaskReadResponseSchema,
    });
  }

  public scheduledTaskDraft(
    apiKey: string,
    input: {
      requestId: string;
      text: string;
      timeZone: string;
      projectId?: string | null;
      workingDirectory?: string | null;
      modelId?: string | null;
    },
  ): Promise<ScheduledTaskDraftResponse> {
    return this.request('/v1/scheduled-tasks/draft', {
      method: 'POST',
      apiKey,
      body: input,
      schema: scheduledTaskDraftResponseSchema,
    });
  }

  public registerPushSubscription(apiKey: string, token: string, requestId: string) {
    return this.request('/v1/push-subscriptions', {
      method: 'POST',
      apiKey,
      body: { requestId, provider: 'expo', platform: 'android', token },
      schema: upsertPushSubscriptionResponseSchema,
    });
  }

  public deletePushSubscription(apiKey: string, requestId: string): Promise<void> {
    return this.request('/v1/push-subscriptions/delete', {
      method: 'POST',
      apiKey,
      body: { requestId },
      schema: deletePushSubscriptionResponseSchema,
    }).then(() => undefined);
  }

  public setSessionModel(
    apiKey: string,
    sessionId: string,
    modelId: string,
    requestId: string,
  ): Promise<SetSessionModelResponse> {
    return this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/model`, {
      method: 'POST',
      apiKey,
      body: { requestId, modelId },
      schema: setSessionModelResponseSchema,
    });
  }

  public renameSession(
    apiKey: string,
    sessionId: string,
    title: string,
    requestId: string,
  ): Promise<RenameSessionResponse> {
    return this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/rename`, {
      method: 'POST',
      apiKey,
      body: { requestId, title },
      schema: renameSessionResponseSchema,
    });
  }

  public async session(apiKey: string, sessionId: string): Promise<SessionDetail> {
    const response = await this.request(`/v1/sessions/${encodeURIComponent(sessionId)}`, {
      apiKey,
      schema: sessionDetailResponseSchema,
    });
    return response.session;
  }

  public createSession(
    apiKey: string,
    input: CreateSessionRequest,
  ): Promise<CreateSessionResponse> {
    return this.request('/v1/sessions', {
      method: 'POST',
      apiKey,
      body: input,
      schema: createSessionResponseSchema,
    });
  }

  public archiveSession(apiKey: string, sessionId: string, requestId: string): Promise<void> {
    return this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/archive`, {
      method: 'POST',
      apiKey,
      body: { requestId },
      schema: archiveSessionResponseSchema,
    }).then(() => undefined);
  }

  public deleteSession(apiKey: string, sessionId: string, requestId: string): Promise<void> {
    return this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/delete`, {
      method: 'POST',
      apiKey,
      body: { requestId },
      schema: deleteSessionResponseSchema,
    }).then(() => undefined);
  }

  public sendMessage(
    apiKey: string,
    sessionId: string,
    message: string,
    requestId: string,
    attachmentIds: string[] = [],
  ): Promise<SendMessageResponse> {
    return this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: 'POST',
      apiKey,
      body: { requestId, message, ...(attachmentIds.length ? { attachmentIds } : {}) },
      schema: sendMessageResponseSchema,
    });
  }

  public uploadAttachment(
    apiKey: string,
    input: UploadAttachmentInput,
  ): Promise<AttachmentSummary> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const requestId = input.requestId ?? createRequestId();
      const abort = () => xhr.abort();
      const cleanup = () => input.signal?.removeEventListener('abort', abort);
      const fail = (code: string, message: string, status: number | null) => {
        cleanup();
        reject(new GatewayRequestError(code, message, status));
      };

      xhr.open('POST', `${this.gatewayUrl}/v1/attachments`);
      xhr.timeout = 90_000;
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.setRequestHeader('Authorization', `Bearer ${apiKey}`);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          input.onProgress?.(Math.min(1, Math.max(0, event.loaded / event.total)));
        }
      };
      xhr.onerror = () => fail('NETWORK_ERROR', 'Gateway could not be reached.', null);
      xhr.ontimeout = () => fail('NETWORK_TIMEOUT', 'Gateway upload timed out.', null);
      xhr.onabort = () => fail('UPLOAD_CANCELLED', 'Attachment upload was cancelled.', null);
      xhr.onload = () => {
        let payload: unknown = null;
        try {
          payload = xhr.responseText ? JSON.parse(xhr.responseText) : null;
        } catch {
          // The protocol error below gives the user a useful recovery action.
        }
        if (xhr.status < 200 || xhr.status >= 300) {
          const parsedError = errorResponseSchema.safeParse(payload);
          fail(
            parsedError.success ? parsedError.data.error.code : 'HTTP_ERROR',
            parsedError.success
              ? parsedError.data.error.message
              : `Gateway returned HTTP ${xhr.status}.`,
            xhr.status,
          );
          return;
        }
        const parsed = uploadAttachmentResponseSchema.safeParse(payload);
        if (!parsed.success) {
          fail('PROTOCOL_ERROR', 'Gateway returned an incompatible response.', xhr.status);
          return;
        }
        cleanup();
        input.onProgress?.(1);
        resolve((parsed.data as UploadAttachmentResponse).attachment);
      };

      if (input.signal?.aborted) {
        fail('UPLOAD_CANCELLED', 'Attachment upload was cancelled.', null);
        return;
      }
      input.signal?.addEventListener('abort', abort, { once: true });
      const form = new FormData();
      form.append('requestId', requestId);
      form.append('draftId', input.draftId);
      if (input.sessionId) form.append('sessionId', input.sessionId);
      form.append('file', {
        uri: input.uri,
        name: input.name,
        type: input.mimeType,
      } as unknown as Blob);
      xhr.send(form);
    });
  }

  public deleteAttachment(
    apiKey: string,
    attachmentId: string,
    requestId = createRequestId(),
  ): Promise<DeleteAttachmentResponse> {
    return this.request(`/v1/attachments/${encodeURIComponent(attachmentId)}/delete`, {
      method: 'POST',
      apiKey,
      body: { requestId },
      schema: deleteAttachmentResponseSchema,
    });
  }

  public attachmentPreviewSource(apiKey: string, attachmentId: string) {
    return {
      uri: `${this.gatewayUrl}/v1/attachments/${encodeURIComponent(attachmentId)}/preview`,
      headers: { Authorization: `Bearer ${apiKey}` },
    };
  }

  public cancelSession(
    apiKey: string,
    sessionId: string,
    requestId: string,
  ): Promise<SessionSummary> {
    return this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/cancel`, {
      method: 'POST',
      apiKey,
      body: { requestId },
      schema: cancelSessionResponseSchema,
    }).then((response) => response.session);
  }

  public clearSession(
    apiKey: string,
    sessionId: string,
    requestId: string,
  ): Promise<ClearSessionResponse> {
    return this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/clear`, {
      method: 'POST',
      apiKey,
      body: { requestId },
      schema: clearSessionResponseSchema,
    });
  }

  public decidePermission(
    apiKey: string,
    permissionId: string,
    decision: PermissionDecision,
    requestId: string,
    answer?: string,
  ): Promise<PermissionDecisionResponse> {
    return this.request(`/v1/permissions/${encodeURIComponent(permissionId)}/decision`, {
      method: 'POST',
      apiKey,
      body: { requestId, decision, ...(answer?.trim() ? { answer: answer.trim() } : {}) },
      schema: permissionDecisionResponseSchema,
    });
  }

  private async request<T>(path: string, options: RequestOptions<T>): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(`${this.gatewayUrl}${path}`, {
        method: options.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const error = errorResponseSchema.safeParse(payload);
        throw new GatewayRequestError(
          error.success
            ? error.data.error.code
            : response.status === 404
              ? 'ROUTE_NOT_FOUND'
              : 'HTTP_ERROR',
          error.success ? error.data.error.message : `Gateway returned HTTP ${response.status}.`,
          response.status,
        );
      }
      const parsed = options.schema.safeParse(payload);
      if (!parsed.success) {
        throw new GatewayRequestError(
          'PROTOCOL_ERROR',
          'Gateway returned an incompatible response.',
          response.status,
        );
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof GatewayRequestError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new GatewayRequestError('NETWORK_TIMEOUT', 'Gateway request timed out.', null);
      }
      throw new GatewayRequestError('NETWORK_ERROR', 'Gateway could not be reached.', null);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function connectionErrorMessage(error: unknown): string {
  if (!(error instanceof GatewayRequestError)) {
    return error instanceof Error ? error.message : '连接失败，请稍后重试';
  }
  const messages: Record<string, string> = {
    NETWORK_ERROR: '无法连接电脑。请确认 Gateway 已启动，且手机与电脑连接同一 Wi-Fi。',
    NETWORK_TIMEOUT: '连接电脑超时，请确认网络正常后重试。',
    PAIRING_CODE_INVALID: '配对码不正确，请查看电脑上显示的最新配对码。',
    PAIRING_CODE_EXPIRED: '配对码已过期，请在电脑上重新生成。',
    PAIRING_RATE_LIMITED: '尝试次数过多，请稍后再试。',
    DEVICE_ALREADY_PAIRED: '已有设备完成配对。请先在电脑上撤销原设备。',
    PROTOCOL_ERROR: 'App 与 Gateway 版本不兼容，请更新后重试。',
    ROUTE_NOT_FOUND: 'Gateway 未提供此功能，服务器可能仍是旧版本。',
    UNAUTHORIZED: '设备授权已失效，请重新配对。',
    AUTH_RATE_LIMITED: '授权失败次数过多，请稍后再试。',
    MODEL_IN_USE: '该模型仍被会话使用，请先在相关会话中切换模型。',
    NOT_FOUND: '目标模型或会话不存在，可能已被删除。',
    CONFLICT: '当前会话正在运行，请等待回复结束后再切换模型。',
    ATTACHMENT_TOO_LARGE: '附件超过大小限制，请压缩或减少后重试。',
    ATTACHMENT_TYPE_UNSUPPORTED: '该附件类型不受支持。',
    ATTACHMENT_LIMIT_EXCEEDED: '附件数量或总大小超过限制。',
    ATTACHMENT_EXPIRED: '附件已过期，请重新选择后发送。',
    ATTACHMENT_NOT_READY: '附件尚未上传完成，请稍后重试。',
    MULTIMODAL_MODEL_UNAVAILABLE: '未配置可识别图片的模型，请在模型页设置。',
    UPLOAD_CANCELLED: '附件上传已取消。',
  };
  return messages[error.code] ?? '连接失败，请稍后重试。';
}
