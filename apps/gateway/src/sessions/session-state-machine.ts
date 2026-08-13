export const sessionStatuses = [
  'idle',
  'running',
  'waiting_permission',
  'interrupted',
  'error',
  'archived',
] as const;

export type SessionStatus = (typeof sessionStatuses)[number];

const allowedTransitions: Readonly<Record<SessionStatus, readonly SessionStatus[]>> = {
  idle: ['running', 'archived'],
  running: ['idle', 'waiting_permission', 'interrupted', 'error'],
  waiting_permission: ['running', 'interrupted', 'error'],
  interrupted: ['running', 'archived'],
  error: ['archived'],
  archived: [],
};

export class InvalidSessionTransitionError extends Error {
  public constructor(from: SessionStatus, to: SessionStatus) {
    super(`Session cannot transition from ${from} to ${to}.`);
    this.name = 'InvalidSessionTransitionError';
  }
}

export function canTransitionSession(from: SessionStatus, to: SessionStatus): boolean {
  return allowedTransitions[from].includes(to);
}

export function assertSessionTransition(from: SessionStatus, to: SessionStatus): void {
  if (!canTransitionSession(from, to)) {
    throw new InvalidSessionTransitionError(from, to);
  }
}
