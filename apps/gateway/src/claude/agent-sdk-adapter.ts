import { existsSync } from 'node:fs';
import { win32 } from 'node:path';

import {
  query,
  type CanUseTool,
  type Options,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';

import type { ClaudeAdapter, ClaudeDomainEvent, ClaudeTurnRequest } from './claude-adapter.js';
import { mapAgentMessage } from './agent-event-mapper.js';

export type AgentSdkQuery = (params: {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options: Options;
}) => AsyncIterable<SDKMessage>;

export type AgentSdkAdapterOptions = {
  executablePath?: string;
  model?: string;
  query?: AgentSdkQuery;
};

export function resolveClaudeExecutablePath(
  path: string | undefined,
  exists: (candidate: string) => boolean = existsSync,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (!path || platform !== 'win32' || !path.toLowerCase().endsWith('.cmd')) return path;
  const nativePath = win32.resolve(
    win32.dirname(path),
    'node_modules',
    '@anthropic-ai',
    'claude-code',
    'bin',
    'claude.exe',
  );
  if (!exists(nativePath)) {
    throw new Error('The configured Claude command does not have a native Windows executable.');
  }
  return nativePath;
}

function safeAgentError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/not logged in|authentication/i.test(message)) {
    return 'Claude Agent SDK is not authenticated.';
  }
  if (/spawn|executable|ENOENT|EINVAL/i.test(message)) {
    return 'Claude Code could not be started.';
  }
  return 'Claude Agent SDK turn failed.';
}

function abortError(): Error {
  return new DOMException('Claude turn aborted.', 'AbortError');
}

export class AgentSdkClaudeAdapter implements ClaudeAdapter {
  private readonly runQuery: AgentSdkQuery;

  public constructor(private readonly options: AgentSdkAdapterOptions = {}) {
    this.runQuery = options.query ?? query;
  }

  public async *runTurn(request: ClaudeTurnRequest): AsyncIterable<ClaudeDomainEvent> {
    const abortController = new AbortController();
    const onAbort = (): void => abortController.abort(request.signal.reason);
    request.signal.addEventListener('abort', onAbort, { once: true });

    const canUseTool: CanUseTool = async (toolName, input, context) => {
      if (request.signal.aborted || context.signal.aborted) throw abortError();
      const decision = await request.requestPermission({
        toolCallId: context.toolUseID,
        toolName,
        input,
        reason: context.title ?? context.description ?? context.decisionReason,
      });
      if (decision.decision === 'allow_once') {
        return { behavior: 'allow', updatedInput: input, toolUseID: context.toolUseID };
      }
      return {
        behavior: 'deny',
        message:
          toolName === 'AskUserQuestion' && decision.message
            ? `User response: ${decision.message}`
            : (decision.message ?? 'Tool use denied from the mobile client.'),
        toolUseID: context.toolUseID,
      };
    };

    try {
      const modelConfig = request.modelConfig;
      const options: Options = {
        abortController,
        canUseTool,
        cwd: request.cwd,
        includePartialMessages: true,
        permissionMode: request.permissionMode ?? 'default',
        ...(request.permissionMode === 'bypassPermissions'
          ? { allowDangerouslySkipPermissions: true }
          : {}),
        settingSources: [],
        tools: { type: 'preset', preset: 'claude_code' },
        // Pass the gateway process environment through to the Claude Code child
        // process explicitly. Anthropic-compatible vendor creds are injected here
        // (ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_MODEL), so swapping
        // models/providers is just changing those vars in the running environment.
        env: modelConfig
          ? {
              ...process.env,
              ANTHROPIC_BASE_URL: modelConfig.baseUrl,
              ANTHROPIC_AUTH_TOKEN: modelConfig.apiKey,
            }
          : { ...process.env },
        ...(request.claudeSessionId ? { resume: request.claudeSessionId } : {}),
        ...(this.options.executablePath
          ? { pathToClaudeCodeExecutable: resolveClaudeExecutablePath(this.options.executablePath) }
          : {}),
        ...(modelConfig
          ? { model: modelConfig.model }
          : this.options.model
            ? { model: this.options.model }
            : {}),
      };
      for await (const message of this.runQuery({ prompt: request.prompt, options })) {
        if (request.signal.aborted) return;
        for (const event of mapAgentMessage(message)) yield event;
      }
    } catch (error) {
      if (!request.signal.aborted) yield { type: 'turn.failed', message: safeAgentError(error) };
    } finally {
      request.signal.removeEventListener('abort', onAbort);
    }
  }
}
