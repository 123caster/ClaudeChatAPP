import type {
  ClaudeAdapter,
  ClaudeDomainEvent,
  ClaudePermissionRequest,
  ClaudeTurnRequest,
} from './claude-adapter.js';

export type FakeClaudeStep =
  | { type: 'delta'; text: string }
  | { type: 'complete_message'; text: string }
  | { type: 'tool_start'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool_complete'; toolCallId: string; output: unknown; isError?: boolean }
  | { type: 'permission'; request: ClaudePermissionRequest }
  | { type: 'fail'; message: string }
  | { type: 'complete_turn'; claudeSessionId?: string };

export class FakeClaudeAdapter implements ClaudeAdapter {
  private readonly scripts: FakeClaudeStep[][] = [];

  public enqueue(script: readonly FakeClaudeStep[]): void {
    this.scripts.push([...script]);
  }

  public async *runTurn(request: ClaudeTurnRequest): AsyncIterable<ClaudeDomainEvent> {
    const script = this.scripts.shift() ?? [
      { type: 'delta', text: `Echo: ${request.prompt}` },
      { type: 'complete_message', text: `Echo: ${request.prompt}` },
      { type: 'complete_turn' },
    ];

    for (const step of script) {
      if (request.signal.aborted) {
        return;
      }

      switch (step.type) {
        case 'delta':
          yield { type: 'assistant.delta', text: step.text };
          break;
        case 'complete_message':
          yield { type: 'assistant.completed', text: step.text };
          break;
        case 'tool_start':
          yield {
            type: 'tool.started',
            toolCallId: step.toolCallId,
            toolName: step.toolName,
            input: step.input,
          };
          break;
        case 'tool_complete':
          yield {
            type: 'tool.completed',
            toolCallId: step.toolCallId,
            output: step.output,
            isError: step.isError ?? false,
          };
          break;
        case 'permission': {
          const decision = await request.requestPermission(step.request);
          if (decision.decision === 'deny') {
            yield { type: 'turn.failed', message: decision.message ?? 'Permission denied.' };
            return;
          }
          break;
        }
        case 'fail':
          yield { type: 'turn.failed', message: step.message };
          return;
        case 'complete_turn':
          yield { type: 'turn.completed', claudeSessionId: step.claudeSessionId };
          return;
      }
    }
  }
}
