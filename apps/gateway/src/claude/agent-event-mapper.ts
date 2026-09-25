import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import type { ClaudeDomainEvent } from './claude-adapter.js';

type ContentBlock = {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
};

function blocks(message: unknown): ContentBlock[] {
  if (!message || typeof message !== 'object' || !('content' in message)) return [];
  const content = (message as { content: unknown }).content;
  return Array.isArray(content) ? (content as ContentBlock[]) : [];
}

function errorMessage(message: Extract<SDKMessage, { type: 'result' }>): string {
  if (message.subtype === 'success') return '';
  return message.errors.filter(Boolean).join('\n') || `Claude stopped: ${message.subtype}.`;
}

export function mapAgentMessage(message: SDKMessage): ClaudeDomainEvent[] {
  if (message.type === 'conversation_reset') {
    return [{ type: 'turn.completed', claudeSessionId: message.new_conversation_id }];
  }

  if (message.type === 'system' && message.subtype === 'init') {
    return [{ type: 'session.started', claudeSessionId: message.session_id }];
  }

  if (message.type === 'system' && message.subtype === 'local_command_output') {
    return message.content ? [{ type: 'assistant.delta', text: message.content }] : [];
  }

  if (message.type === 'system' && message.subtype === 'permission_denied') {
    return [
      {
        type: 'tool.completed',
        toolCallId: message.tool_use_id,
        output: { message: message.decision_reason ?? 'Tool use denied.' },
        isError: true,
      },
    ];
  }

  if (message.type === 'stream_event') {
    const event = message.event;
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      return [{ type: 'assistant.delta', text: event.delta.text }];
    }
    return [];
  }

  if (message.type === 'assistant') {
    return blocks(message.message).flatMap((block): ClaudeDomainEvent[] => {
      if (block.type === 'tool_use' && block.id && block.name) {
        return [
          {
            type: 'tool.started',
            toolCallId: block.id,
            toolName: block.name,
            input: block.input ?? {},
          },
        ];
      }
      return [];
    });
  }

  if (message.type === 'user') {
    return blocks(message.message).flatMap((block): ClaudeDomainEvent[] => {
      if (block.type === 'tool_result' && block.tool_use_id) {
        return [
          {
            type: 'tool.completed',
            toolCallId: block.tool_use_id,
            output: message.tool_use_result ?? block.content ?? null,
            isError: block.is_error ?? false,
          },
        ];
      }
      return [];
    });
  }

  if (message.type === 'result') {
    const started: ClaudeDomainEvent = {
      type: 'session.started',
      claudeSessionId: message.session_id,
    };
    if (message.subtype === 'success') {
      const result: ClaudeDomainEvent[] = [
        started,
        ...(message.permission_denials ?? []).map((denial): ClaudeDomainEvent => ({
          type: 'tool.completed',
          toolCallId: denial.tool_use_id,
          output: { message: 'Tool use denied.' },
          isError: true,
        })),
      ];
      if (message.result) result.push({ type: 'assistant.completed', text: message.result });
      result.push({ type: 'turn.completed', claudeSessionId: message.session_id });
      return result;
    }
    return [
      started,
      ...(message.permission_denials ?? []).map((denial): ClaudeDomainEvent => ({
        type: 'tool.completed',
        toolCallId: denial.tool_use_id,
        output: { message: 'Tool use denied.' },
        isError: true,
      })),
      { type: 'turn.failed', message: errorMessage(message) },
    ];
  }

  return [];
}
