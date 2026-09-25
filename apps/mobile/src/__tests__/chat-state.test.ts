import type { EventEnvelope, SessionDetail } from '@claude-chat/protocol';

import { buildTimeline, chatReducer, initialChatState } from '@/state/chat-state';

const sessionId = '11111111-1111-4111-8111-111111111111';
const messageId = '22222222-2222-4222-8222-222222222222';

const detail: SessionDetail = {
  id: sessionId,
  projectId: 'project',
  projectDisplayName: 'Project',
  title: 'Chat',
  status: 'running',
  lastMessagePreview: null,
  createdAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:00.000Z',
  messages: [],
  toolCalls: [],
  permissions: [],
};

function delta(sequence: number, text: string): EventEnvelope {
  return {
    protocolVersion: 1,
    eventId: 5,
    sessionId,
    requestId: null,
    emittedAt: '2026-08-13T00:00:01.000Z',
    type: 'assistant.delta',
    payload: { messageId, sequence, delta: text },
  };
}

describe('chatReducer', () => {
  it('merges ordered assistant deltas and ignores duplicates', () => {
    let state = chatReducer(initialChatState, { type: 'loaded', detail });
    state = chatReducer(state, { type: 'event', event: delta(0, '你') });
    state = chatReducer(state, { type: 'event', event: delta(0, '重复') });
    state = chatReducer(state, { type: 'event', event: delta(1, '好') });
    expect(state.detail?.messages[0]?.content).toBe('你好');
  });

  it('replaces a transient partial response with the durable completed message', () => {
    let state = chatReducer(initialChatState, { type: 'loaded', detail });
    state = chatReducer(state, { type: 'event', event: delta(0, '正在') });
    state = chatReducer(state, {
      type: 'event',
      event: {
        protocolVersion: 1,
        eventId: 6,
        sessionId,
        requestId: null,
        emittedAt: '2026-08-13T00:00:02.000Z',
        type: 'message.created',
        payload: {
          message: {
            id: messageId,
            sessionId,
            role: 'assistant',
            content: '正在完成回答。',
            isPartial: false,
            createdAt: '2026-08-13T00:00:01.000Z',
          },
        },
      },
    });
    expect(state.detail?.messages[0]).toMatchObject({
      content: '正在完成回答。',
      isPartial: false,
    });
  });

  it('ends the running state when a turn failure arrives', () => {
    const state = chatReducer(chatReducer(initialChatState, { type: 'loaded', detail }), {
      type: 'event',
      event: {
        protocolVersion: 1,
        eventId: 7,
        sessionId,
        requestId: 'image-request',
        emittedAt: '2026-08-13T00:00:03.000Z',
        type: 'turn.failed',
        payload: {
          session: {
            id: sessionId,
            projectId: 'project',
            projectDisplayName: 'Project',
            title: 'Chat',
            status: 'interrupted',
            lastMessagePreview: null,
            createdAt: '2026-08-13T00:00:00.000Z',
            updatedAt: '2026-08-13T00:00:03.000Z',
          },
          code: 'MULTIMODAL_MODEL_UNAVAILABLE',
          message: 'No image model is configured.',
          retryable: false,
        },
      },
    });

    expect(state.detail?.status).toBe('interrupted');
  });

  it('orders messages, tools, and permissions by creation time', () => {
    const timeline = buildTimeline({
      ...detail,
      messages: [
        {
          id: messageId,
          sessionId,
          role: 'user',
          content: 'go',
          isPartial: false,
          createdAt: '2026-08-13T00:00:03.000Z',
        },
      ],
      toolCalls: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          sessionId,
          toolName: 'Read',
          input: {},
          output: null,
          status: 'running',
          createdAt: '2026-08-13T00:00:01.000Z',
          completedAt: null,
        },
      ],
    });
    expect(timeline.map(({ kind }) => kind)).toEqual(['tool', 'message']);
  });
});
