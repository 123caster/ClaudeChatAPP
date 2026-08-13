import { AgentSdkClaudeAdapter } from '../src/claude/agent-sdk-adapter.js';
import type { ClaudeDomainEvent } from '../src/claude/claude-adapter.js';

const adapter = new AgentSdkClaudeAdapter({
  ...(process.env.CLAUDE_CODE_EXECUTABLE
    ? { executablePath: process.env.CLAUDE_CODE_EXECUTABLE }
    : {}),
  ...(process.env.CLAUDE_MODEL ? { model: process.env.CLAUDE_MODEL } : {}),
});

const events: ClaudeDomainEvent[] = [];
for await (const event of adapter.runTurn({
  localSessionId: 'smoke-test',
  claudeSessionId: null,
  prompt: 'Reply with exactly CLAUDE_CHAT_READY. Do not use any tools.',
  cwd: process.cwd(),
  signal: new AbortController().signal,
  requestPermission: async () => ({
    decision: 'deny',
    message: 'Tools are disabled during the read-only smoke test.',
  }),
})) {
  events.push(event);
}

const completed = events.find(
  (event): event is Extract<(typeof events)[number], { type: 'assistant.completed' }> =>
    event.type === 'assistant.completed',
);
const turnCompleted = events.some((event) => event.type === 'turn.completed');

if (!turnCompleted || completed?.text.trim() !== 'CLAUDE_CHAT_READY') {
  throw new Error('Claude Agent SDK smoke test did not return the expected result.');
}

process.stdout.write('Claude Agent SDK smoke test passed.\n');
