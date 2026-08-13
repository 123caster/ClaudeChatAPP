export type ClaudePermissionDecision = {
  decision: 'allow_once' | 'deny';
  message?: string;
};

export type ClaudePermissionRequest = {
  toolCallId: string | null;
  toolName: string;
  input: unknown;
  reason?: string;
};

export type ClaudeDomainEvent =
  | { type: 'assistant.delta'; text: string }
  | { type: 'assistant.completed'; text: string }
  | { type: 'tool.started'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool.completed'; toolCallId: string; output: unknown; isError: boolean }
  | { type: 'turn.completed'; claudeSessionId?: string }
  | { type: 'turn.failed'; message: string };

export type ClaudeTurnRequest = {
  localSessionId: string;
  claudeSessionId: string | null;
  prompt: string;
  cwd: string;
  signal: AbortSignal;
  requestPermission(request: ClaudePermissionRequest): Promise<ClaudePermissionDecision>;
};

export interface ClaudeAdapter {
  runTurn(request: ClaudeTurnRequest): AsyncIterable<ClaudeDomainEvent>;
}
