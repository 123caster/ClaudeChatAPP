import type {
  AttachmentRecord,
  MessageRecord,
  PermissionRecord,
  ProjectRecord,
  SessionRecord,
  ToolCallRecord,
} from '@claude-chat/database';
import type {
  JsonValue,
  Message,
  PermissionRequest,
  SessionDetail,
  SessionSummary,
  ToolCall,
  AttachmentSummary,
} from '@claude-chat/protocol';

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function jsonObject(value: unknown): Record<string, JsonValue> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, JsonValue>;
  }
  return { value: value as JsonValue };
}

function serializeAttachment(record: AttachmentRecord): AttachmentSummary {
  return {
    id: record.id,
    kind: record.kind,
    name: record.name,
    mimeType: record.mimeType,
    size: record.size,
    status: record.status,
    previewAvailable: record.previewName !== null,
    createdAt: record.createdAt,
  };
}

export function serializeMessage(
  record: MessageRecord,
  attachments: readonly AttachmentRecord[] = [],
): Message {
  const content = parseJson(record.contentJson);
  const message: Message = {
    id: record.id,
    sessionId: record.sessionId,
    role: record.role as Message['role'],
    content:
      content !== null && typeof content === 'object' && 'text' in content
        ? String((content as { text: unknown }).text)
        : String(content ?? ''),
    isPartial: record.isPartial,
    createdAt: record.createdAt,
  };
  if (attachments.length > 0) {
    message.attachments = attachments.map(serializeAttachment);
  }
  return message;
}

export function serializeToolCall(record: ToolCallRecord): ToolCall {
  const base = {
    id: record.id,
    sessionId: record.sessionId,
    toolName: record.toolName,
    input: jsonObject(parseJson(record.inputJson)),
    createdAt: record.createdAt,
  };
  if (record.status === 'running') {
    return { ...base, status: 'running', output: null, completedAt: null };
  }
  if (!record.completedAt) {
    throw new Error(`Completed tool call ${record.id} is missing completedAt.`);
  }
  return {
    ...base,
    status: record.status === 'failed' ? 'failed' : 'completed',
    output: record.outputJson === null ? null : (parseJson(record.outputJson) as JsonValue),
    completedAt: record.completedAt,
  };
}

export function serializePermission(record: PermissionRecord): PermissionRequest {
  const request = jsonObject(parseJson(record.requestJson));
  const base = {
    id: record.id,
    sessionId: record.sessionId,
    toolCallId: record.toolCallId,
    toolName: String(request.toolName ?? 'Unknown'),
    description: typeof request.reason === 'string' ? request.reason : null,
    input: jsonObject(request.input),
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  };
  if (record.decision === null || record.resolvedAt === null) {
    return {
      ...base,
      status: 'pending',
      decision: null,
      decisionMessage: null,
      resolvedAt: null,
    };
  }
  return {
    ...base,
    status: 'resolved',
    decision: record.decision === 'allow_once' ? 'allow_once' : 'deny',
    decisionMessage: record.decisionMessage,
    resolvedAt: record.resolvedAt,
  };
}

export function serializeSessionSummary(
  session: SessionRecord,
  project: ProjectRecord,
  messages: readonly MessageRecord[],
): SessionSummary {
  const lastMessage = messages.at(-1);
  const preview = lastMessage ? serializeMessage(lastMessage).content.slice(0, 500) : null;
  return {
    id: session.id,
    projectId: session.projectId,
    projectDisplayName: project.displayName,
    workingDirectory: session.workingDirectory ?? null,
    modelId: session.modelId ?? null,
    title: session.title,
    status: session.status,
    lastMessagePreview: preview,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

export function serializeSessionDetail(
  session: SessionRecord,
  project: ProjectRecord,
  messages: readonly MessageRecord[],
  toolCalls: readonly ToolCallRecord[],
  permissions: readonly PermissionRecord[],
  attachments: readonly AttachmentRecord[] = [],
): SessionDetail {
  const attachmentsByMessage = new Map<string, AttachmentRecord[]>();
  for (const attachment of attachments) {
    if (!attachment.messageId) continue;
    const grouped = attachmentsByMessage.get(attachment.messageId) ?? [];
    grouped.push(attachment);
    attachmentsByMessage.set(attachment.messageId, grouped);
  }
  return {
    ...serializeSessionSummary(session, project, messages),
    messages: messages.map((message) =>
      serializeMessage(message, attachmentsByMessage.get(message.id) ?? []),
    ),
    toolCalls: toolCalls.map(serializeToolCall),
    permissions: permissions.map(serializePermission),
  };
}
