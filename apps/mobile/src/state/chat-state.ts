import type {
  EventEnvelope,
  Message,
  PermissionRequest,
  SessionDetail,
  SessionSummary,
  ToolCall,
} from '@claude-chat/protocol';

export type ChatState = {
  detail: SessionDetail | null;
  lastDeltaSequence: Record<string, number>;
  lastPersistentEventId: number;
  notice: string | null;
};

export type ChatAction =
  | { type: 'loaded'; detail: SessionDetail }
  | { type: 'event'; event: EventEnvelope }
  | { type: 'session'; session: SessionSummary }
  | { type: 'message'; message: Message }
  | { type: 'permission'; permission: PermissionRequest }
  | { type: 'notice'; message: string | null };

export const initialChatState: ChatState = {
  detail: null,
  lastDeltaSequence: {},
  lastPersistentEventId: 0,
  notice: null,
};

function upsert<T extends { id: string }>(items: T[], incoming: T): T[] {
  const index = items.findIndex(({ id }) => id === incoming.id);
  if (index === -1) return [...items, incoming];
  const next = [...items];
  next[index] = incoming;
  return next;
}

function applySummary(detail: SessionDetail, session: SessionSummary): SessionDetail {
  return { ...detail, ...session };
}

function applyEvent(state: ChatState, event: EventEnvelope): ChatState {
  if (event.type === 'server.notice') return { ...state, notice: event.payload.message };
  if (event.type === 'connection.ready') return state;
  if (event.type === 'session.snapshot') {
    const detail = event.payload.sessions.find(({ id }) => id === state.detail?.id);
    return detail
      ? {
          ...state,
          detail,
          lastDeltaSequence: {},
          lastPersistentEventId: event.payload.currentEventId,
        }
      : state;
  }
  if (!state.detail || event.sessionId !== state.detail.id) return state;

  if (event.type === 'message.created') {
    if (event.eventId <= state.lastPersistentEventId) return state;
    return {
      ...state,
      lastPersistentEventId: event.eventId,
      detail: { ...state.detail, messages: upsert(state.detail.messages, event.payload.message) },
    };
  }
  if (event.type === 'assistant.delta') {
    const previous = state.lastDeltaSequence[event.payload.messageId] ?? -1;
    if (event.payload.sequence <= previous) return state;
    const current = state.detail.messages.find(({ id }) => id === event.payload.messageId);
    const message: Message = current
      ? { ...current, content: `${current.content}${event.payload.delta}`, isPartial: true }
      : {
          id: event.payload.messageId,
          sessionId: event.sessionId,
          role: 'assistant',
          content: event.payload.delta,
          isPartial: true,
          createdAt: event.emittedAt,
        };
    return {
      ...state,
      detail: { ...state.detail, messages: upsert(state.detail.messages, message) },
      lastDeltaSequence: {
        ...state.lastDeltaSequence,
        [event.payload.messageId]: event.payload.sequence,
      },
    };
  }
  if (event.eventId <= state.lastPersistentEventId) return state;
  const durableState = { ...state, lastPersistentEventId: event.eventId };
  if (event.type === 'tool.started' || event.type === 'tool.completed') {
    return {
      ...durableState,
      detail: {
        ...state.detail,
        toolCalls: upsert(state.detail.toolCalls, event.payload.toolCall),
      },
    };
  }
  if (event.type === 'permission.requested' || event.type === 'permission.resolved') {
    return {
      ...durableState,
      detail: {
        ...state.detail,
        permissions: upsert(state.detail.permissions, event.payload.permission),
      },
    };
  }
  if (
    event.type === 'session.created' ||
    event.type === 'session.updated' ||
    event.type === 'turn.completed' ||
    event.type === 'turn.failed'
  ) {
    return { ...durableState, detail: applySummary(state.detail, event.payload.session) };
  }
  return durableState;
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  if (action.type === 'loaded')
    return {
      detail: action.detail,
      lastDeltaSequence: {},
      lastPersistentEventId: state.lastPersistentEventId,
      notice: null,
    };
  if (action.type === 'event') return applyEvent(state, action.event);
  if (action.type === 'notice') return { ...state, notice: action.message };
  if (!state.detail) return state;
  if (action.type === 'session')
    return { ...state, detail: applySummary(state.detail, action.session) };
  if (action.type === 'message') {
    return {
      ...state,
      detail: { ...state.detail, messages: upsert(state.detail.messages, action.message) },
    };
  }
  return {
    ...state,
    detail: { ...state.detail, permissions: upsert(state.detail.permissions, action.permission) },
  };
}

export type TimelineItem =
  | { kind: 'message'; id: string; createdAt: string; value: Message }
  | { kind: 'tool'; id: string; createdAt: string; value: ToolCall }
  | { kind: 'permission'; id: string; createdAt: string; value: PermissionRequest };

export function buildTimeline(detail: SessionDetail): TimelineItem[] {
  return [
    ...detail.messages.map((value) => ({
      kind: 'message' as const,
      id: value.id,
      createdAt: value.createdAt,
      value,
    })),
    ...detail.toolCalls.map((value) => ({
      kind: 'tool' as const,
      id: value.id,
      createdAt: value.createdAt,
      value,
    })),
    ...detail.permissions.map((value) => ({
      kind: 'permission' as const,
      id: value.id,
      createdAt: value.createdAt,
      value,
    })),
  ].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}
