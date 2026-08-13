import { describe, expect, it } from 'vitest';

import {
  assertSessionTransition,
  canTransitionSession,
  InvalidSessionTransitionError,
} from '../sessions/session-state-machine.js';

describe('session state machine', () => {
  it.each([
    ['idle', 'running'],
    ['running', 'waiting_permission'],
    ['waiting_permission', 'running'],
    ['running', 'idle'],
    ['running', 'interrupted'],
    ['waiting_permission', 'interrupted'],
    ['interrupted', 'running'],
    ['idle', 'archived'],
    ['interrupted', 'archived'],
    ['error', 'archived'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(canTransitionSession(from, to)).toBe(true);
    expect(() => assertSessionTransition(from, to)).not.toThrow();
  });

  it.each([
    ['idle', 'waiting_permission'],
    ['idle', 'interrupted'],
    ['running', 'archived'],
    ['waiting_permission', 'archived'],
    ['archived', 'running'],
    ['error', 'running'],
  ] as const)('rejects %s -> %s', (from, to) => {
    expect(() => assertSessionTransition(from, to)).toThrowError(InvalidSessionTransitionError);
  });
});
