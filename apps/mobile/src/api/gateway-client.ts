import {
  archiveSessionResponseSchema,
  cancelSessionResponseSchema,
  createModelResponseSchema,
  createProjectResponseSchema,
  createSessionResponseSchema,
  deleteModelResponseSchema,
  errorResponseSchema,
  healthResponseSchema,
  modelsResponseSchema,
  permissionDecisionResponseSchema,
  projectsResponseSchema,
  sessionDetailResponseSchema,
  sessionsResponseSchema,
  sendMessageResponseSchema,
  setActiveModelResponseSchema,
  type CreateModelRequest,
  type CreateModelResponse,
  type CreateProjectRequest,
  type CreateProjectResponse,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type DeleteModelResponse,
  type HealthResponse,
  type ModelSummary,
  type PermissionDecision,
  type PermissionDecisionResponse,
  type ProjectSummary,
  type SessionDetail,
  type SessionSummary,
  type SendMessageResponse,
  type SetActiveModelResponse,
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

  public async projects(apiKey: string): Promise<ProjectSummary[]> {
    const response = await this.request('/v1/projects', { apiKey, schema: projectsResponseSchema });
    return response.projects;
  }

  public createProject(apiKey: string, input: CreateProjectRequest): Promise<CreateProjectResponse> {
    return this.request('/v1/projects', {
      method: 'POST',
      apiKey,
      body: input,
      schema: createProjectResponseSchema,
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

  public deleteModel(apiKey: string, modelId: string, requestId: string): Promise<DeleteModelResponse> {
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

  public async session(apiKey: string, sessionId: string): Promise<SessionDetail> {
    const response = await this.request(`/v1/sessions/${encodeURIComponent(sessionId)}`, {
      apiKey,
      schema: sessionDetailResponseSchema,
    });
    return response.session;
  }

  public createSession(apiKey: string, input: CreateSessionRequest): Promise<CreateSessionResponse> {
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

  public sendMessage(
    apiKey: string,
    sessionId: string,
    message: string,
    requestId: string,
  ): Promise<SendMessageResponse> {
    return this.request(`/v1/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: 'POST',
      apiKey,
      body: { requestId, message },
      schema: sendMessageResponseSchema,
    });
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

  public decidePermission(
    apiKey: string,
    permissionId: string,
    decision: PermissionDecision,
    requestId: string,
  ): Promise<PermissionDecisionResponse> {
    return this.request(`/v1/permissions/${encodeURIComponent(permissionId)}/decision`, {
      method: 'POST',
      apiKey,
      body: { requestId, decision },
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
          ...(options.apiKey ? { 'X-API-Key': options.apiKey } : {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const error = errorResponseSchema.safeParse(payload);
        throw new GatewayRequestError(
          error.success ? error.data.error.code : 'HTTP_ERROR',
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
    UNAUTHORIZED: '设备授权已失效或 API Key 不正确，请检查后重试。',
  };
  return messages[error.code] ?? '连接失败，请稍后重试。';
}
