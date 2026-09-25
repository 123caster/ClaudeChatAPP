import type { Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';

import { AgentSdkClaudeAdapter, resolveClaudeExecutablePath } from '../claude/agent-sdk-adapter.js';

describe('AgentSdkClaudeAdapter', () => {
  it('passes a structured user-message stream through to the Agent SDK', async () => {
    let capturedPrompt: string | AsyncIterable<SDKUserMessage> | undefined;
    const adapter = new AgentSdkClaudeAdapter({
      query: ({ prompt }) => {
        capturedPrompt = prompt;
        return (async function* (): AsyncIterable<SDKMessage> {
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'claude-session-1',
            result: 'Done',
          } as SDKMessage;
        })();
      },
    });
    const structured = (async function* (): AsyncIterable<SDKUserMessage> {
      yield {
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: 'Read the image.' }] },
        parent_tool_use_id: null,
      };
    })();

    const events = [];
    for await (const event of adapter.runTurn({
      localSessionId: 'local-1',
      claudeSessionId: null,
      prompt: structured,
      cwd: 'D:\\Projects\\sample',
      signal: new AbortController().signal,
      requestPermission: async () => ({ decision: 'deny' }),
    })) {
      events.push(event);
    }
    expect(capturedPrompt).toBe(structured);
    expect(events.at(-1)?.type).toBe('turn.completed');
  });

  it('uses isolated settings, resumes sessions and bridges permission decisions', async () => {
    let captured: Options | undefined;
    const adapter = new AgentSdkClaudeAdapter({
      executablePath: 'C:\\Claude\\claude.exe',
      model: 'test-model',
      query: ({ options }) => {
        captured = options;
        return (async function* (): AsyncIterable<SDKMessage> {
          const permission = await options.canUseTool?.(
            'Write',
            { file_path: 'a.ts' },
            {
              signal: new AbortController().signal,
              toolUseID: 'tool-1',
              requestId: 'permission-1',
              title: 'Write a.ts',
            },
          );
          expect(permission).toMatchObject({ behavior: 'allow', toolUseID: 'tool-1' });
          yield {
            type: 'system',
            subtype: 'init',
            session_id: 'claude-session-1',
          } as SDKMessage;
          yield {
            type: 'result',
            subtype: 'success',
            session_id: 'claude-session-1',
            result: 'Done',
          } as SDKMessage;
        })();
      },
    });

    const requests: unknown[] = [];
    const events = [];
    for await (const event of adapter.runTurn({
      localSessionId: 'local-1',
      claudeSessionId: 'claude-session-1',
      prompt: 'Continue',
      cwd: 'D:\\Projects\\sample',
      signal: new AbortController().signal,
      requestPermission: async (request) => {
        requests.push(request);
        return { decision: 'allow_once' };
      },
    })) {
      events.push(event);
    }

    expect(captured).toMatchObject({
      cwd: 'D:\\Projects\\sample',
      resume: 'claude-session-1',
      includePartialMessages: true,
      permissionMode: 'default',
      settingSources: [],
      pathToClaudeCodeExecutable: 'C:\\Claude\\claude.exe',
      model: 'test-model',
    });
    expect(requests).toEqual([
      {
        toolCallId: 'tool-1',
        toolName: 'Write',
        input: { file_path: 'a.ts' },
        reason: 'Write a.ts',
      },
    ]);
    expect(events.at(-1)).toEqual({
      type: 'turn.completed',
      claudeSessionId: 'claude-session-1',
    });
  });

  it('bridges interactive questions through the durable permission flow', async () => {
    const requests: unknown[] = [];
    const adapter = new AgentSdkClaudeAdapter({
      query: ({ options }) =>
        (async function* (): AsyncIterable<SDKMessage> {
          const decision = await options.canUseTool?.(
            'AskUserQuestion',
            { questions: [] },
            {
              signal: new AbortController().signal,
              toolUseID: 'question-1',
              requestId: 'permission-1',
            },
          );
          expect(decision).toMatchObject({
            behavior: 'deny',
            message: 'User response: Continue with the default plan',
            toolUseID: 'question-1',
          });
          yield { type: 'future_event' } as unknown as SDKMessage;
        })(),
    });
    const events = [];
    for await (const event of adapter.runTurn({
      localSessionId: 'local-1',
      claudeSessionId: null,
      prompt: 'Ask',
      cwd: 'D:\\Projects\\sample',
      signal: new AbortController().signal,
      requestPermission: async (request) => {
        requests.push(request);
        return { decision: 'deny', message: 'Continue with the default plan' };
      },
    })) {
      events.push(event);
    }
    expect(events).toEqual([]);
    expect(requests).toEqual([
      {
        input: { questions: [] },
        reason: undefined,
        toolCallId: 'question-1',
        toolName: 'AskUserQuestion',
      },
    ]);
  });

  it('sanitizes SDK startup and authentication failures', async () => {
    const adapter = new AgentSdkClaudeAdapter({
      query: () => {
        throw new Error('Not logged in token=secret C:\\private\\path');
      },
    });
    const events = [];
    for await (const event of adapter.runTurn({
      localSessionId: 'local-1',
      claudeSessionId: null,
      prompt: 'Hello',
      cwd: 'D:\\Projects\\sample',
      signal: new AbortController().signal,
      requestPermission: async () => ({ decision: 'deny' }),
    })) {
      events.push(event);
    }
    expect(events).toEqual([
      { type: 'turn.failed', message: 'Claude Agent SDK is not authenticated.' },
    ]);
  });

  it('resolves the npm Windows command wrapper to its native executable', () => {
    const command = 'C:\\npm\\claude.cmd';
    const expected = 'C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe';
    expect(resolveClaudeExecutablePath(command, (path) => path === expected, 'win32')).toBe(
      expected,
    );
  });
});
