import { describe, expect, it, vi } from 'vitest';

import { ClaudeHealthMonitor } from '../claude/claude-health.js';

describe('ClaudeHealthMonitor', () => {
  it('reports login state and coalesces concurrent probes', async () => {
    const probe = vi.fn(async () => ({ loggedIn: true }));
    const monitor = new ClaudeHealthMonitor('claude', probe, () => true);
    expect(monitor.snapshot()).toEqual({ status: 'starting' });
    expect(await Promise.all([monitor.refresh(), monitor.refresh()])).toEqual([
      { status: 'ready' },
      { status: 'ready' },
    ]);
    expect(probe).toHaveBeenCalledOnce();
    expect(monitor.snapshot()).toEqual({ status: 'ready' });
  });

  it('uses fixed safe messages for unauthenticated and failed probes', async () => {
    const signedOut = new ClaudeHealthMonitor(
      'claude',
      async () => ({ loggedIn: false }),
      () => true,
    );
    const failed = new ClaudeHealthMonitor(
      'claude',
      async () => {
        throw new Error('token=secret local stderr');
      },
      () => true,
    );
    expect(await signedOut.refresh()).toEqual({
      status: 'unauthenticated',
      message: 'Claude Code is not signed in.',
    });
    expect(await failed.refresh()).toEqual({
      status: 'unavailable',
      message: 'Claude Code is unavailable on this computer.',
    });
  });

  it('reports an incompatible status response', async () => {
    const monitor = new ClaudeHealthMonitor(
      'claude',
      async () => ({}),
      () => true,
    );
    expect(await monitor.refresh()).toEqual({
      status: 'incompatible',
      message: 'Claude Code returned an unsupported status.',
    });
  });

  it('does not treat an interactive Claude login as an Agent SDK credential', async () => {
    const probe = vi.fn(async () => ({ loggedIn: true }));
    const monitor = new ClaudeHealthMonitor('claude', probe, () => false);
    expect(await monitor.refresh()).toEqual({
      status: 'unauthenticated',
      message: 'Configure an Agent SDK credential on this computer.',
    });
    expect(probe).not.toHaveBeenCalled();
  });
});
