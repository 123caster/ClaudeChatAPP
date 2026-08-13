import { describe, expect, it } from 'vitest';

import { FakeClaudeAdapter } from '../claude/fake-claude-adapter.js';

describe('FakeClaudeAdapter', () => {
  it('runs scripted text, tool and completion events', async () => {
    const adapter = new FakeClaudeAdapter();
    adapter.enqueue([
      { type: 'delta', text: 'hello' },
      { type: 'tool_start', toolCallId: 'tool-1', toolName: 'Read', input: { path: 'a.ts' } },
      { type: 'tool_complete', toolCallId: 'tool-1', output: 'source' },
      { type: 'complete_message', text: 'hello' },
      { type: 'complete_turn', claudeSessionId: 'claude-1' },
    ]);

    const events = [];
    for await (const event of adapter.runTurn({
      localSessionId: 'session-1',
      claudeSessionId: null,
      prompt: 'read',
      cwd: 'D:\\Projects\\test',
      signal: new AbortController().signal,
      requestPermission: async () => ({ decision: 'allow_once' }),
    })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      'assistant.delta',
      'tool.started',
      'tool.completed',
      'assistant.completed',
      'turn.completed',
    ]);
  });

  it('waits for permission and stops after denial', async () => {
    const adapter = new FakeClaudeAdapter();
    adapter.enqueue([
      {
        type: 'permission',
        request: { toolCallId: null, toolName: 'Bash', input: { command: 'pwd' } },
      },
      { type: 'complete_turn' },
    ]);

    const events = [];
    for await (const event of adapter.runTurn({
      localSessionId: 'session-1',
      claudeSessionId: null,
      prompt: 'run',
      cwd: 'D:\\Projects\\test',
      signal: new AbortController().signal,
      requestPermission: async () => ({ decision: 'deny', message: 'No' }),
    })) {
      events.push(event);
    }

    expect(events).toEqual([{ type: 'turn.failed', message: 'No' }]);
  });
});
