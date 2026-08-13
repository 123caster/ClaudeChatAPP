import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';

import { mapAgentMessage } from '../claude/agent-event-mapper.js';

function fixture(value: unknown): SDKMessage {
  return value as SDKMessage;
}

describe('mapAgentMessage', () => {
  it('maps init and partial text without persisting final text twice', () => {
    expect(
      mapAgentMessage(fixture({ type: 'system', subtype: 'init', session_id: 'claude-session-1' })),
    ).toEqual([{ type: 'session.started', claudeSessionId: 'claude-session-1' }]);
    expect(
      mapAgentMessage(
        fixture({
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
        }),
      ),
    ).toEqual([{ type: 'assistant.delta', text: 'Hello' }]);
  });

  it('maps tool use, tool result and permission denial', () => {
    expect(
      mapAgentMessage(
        fixture({
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: 'a.ts' } },
            ],
          },
        }),
      ),
    ).toEqual([
      {
        type: 'tool.started',
        toolCallId: 'tool-1',
        toolName: 'Read',
        input: { file_path: 'a.ts' },
      },
    ]);
    expect(
      mapAgentMessage(
        fixture({
          type: 'user',
          message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'source' }] },
          tool_use_result: { content: 'source' },
        }),
      ),
    ).toEqual([
      {
        type: 'tool.completed',
        toolCallId: 'tool-1',
        output: { content: 'source' },
        isError: false,
      },
    ]);
    expect(
      mapAgentMessage(
        fixture({
          type: 'system',
          subtype: 'permission_denied',
          tool_use_id: 'tool-2',
          decision_reason: 'Denied by policy',
        }),
      ),
    ).toEqual([
      {
        type: 'tool.completed',
        toolCallId: 'tool-2',
        output: { message: 'Denied by policy' },
        isError: true,
      },
    ]);
  });

  it('maps success and error results as exactly one terminal event', () => {
    expect(
      mapAgentMessage(
        fixture({
          type: 'result',
          subtype: 'success',
          session_id: 'claude-session-1',
          result: 'Done',
        }),
      ),
    ).toEqual([
      { type: 'session.started', claudeSessionId: 'claude-session-1' },
      { type: 'assistant.completed', text: 'Done' },
      { type: 'turn.completed', claudeSessionId: 'claude-session-1' },
    ]);
    expect(
      mapAgentMessage(
        fixture({
          type: 'result',
          subtype: 'error_during_execution',
          session_id: 'claude-session-1',
          errors: ['Authentication failed'],
        }),
      ),
    ).toEqual([
      { type: 'session.started', claudeSessionId: 'claude-session-1' },
      { type: 'turn.failed', message: 'Authentication failed' },
    ]);
  });

  it('ignores unknown diagnostic events', () => {
    expect(mapAgentMessage(fixture({ type: 'future_event', value: 'ignored' }))).toEqual([]);
  });
});
