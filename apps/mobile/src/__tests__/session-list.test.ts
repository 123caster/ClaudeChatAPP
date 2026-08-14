import type { SessionSummary } from '@claude-chat/protocol';

import { connectionBannerState, mergeSession, sortSessions } from '@/state/session-list';

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    projectId: 'project',
    projectDisplayName: 'Project',
    title: 'Session',
    status: 'idle',
    lastMessagePreview: null,
    createdAt: '2026-08-13T00:00:00.000Z',
    updatedAt: '2026-08-13T00:00:00.000Z',
    ...overrides,
  };
}

describe('session list state', () => {
  it('shows connecting until the socket explicitly closes', () => {
    expect(connectionBannerState('idle')).toBe('connecting');
    expect(connectionBannerState('connecting')).toBe('connecting');
    expect(connectionBannerState('open')).toBeNull();
    expect(connectionBannerState('closed')).toBe('offline');
  });

  it('sorts active sessions and omits archived sessions', () => {
    const result = sortSessions([
      session({ id: '00000000-0000-4000-8000-000000000001' }),
      session({
        id: '00000000-0000-4000-8000-000000000002',
        updatedAt: '2026-08-13T01:00:00.000Z',
      }),
      session({ id: '00000000-0000-4000-8000-000000000003', status: 'archived' }),
    ]);

    expect(result.map(({ id }) => id)).toEqual([
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000001',
    ]);
  });

  it('upserts event updates without duplicating a session', () => {
    const original = session();
    const result = mergeSession([original], { ...original, status: 'waiting_permission' });
    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe('waiting_permission');
  });

  it('removes a session after an archived event', () => {
    const original = session();
    expect(mergeSession([original], { ...original, status: 'archived' })).toEqual([]);
  });
});
