import type { SessionSummary } from '@claude-chat/protocol';

export function connectionBannerState(
  eventState: 'idle' | 'connecting' | 'open' | 'closed',
): 'connecting' | 'offline' | null {
  if (eventState === 'open') return null;
  return eventState === 'closed' ? 'offline' : 'connecting';
}

export function sortSessions(sessions: SessionSummary[]): SessionSummary[] {
  return sessions
    .filter((session) => session.status !== 'archived')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function mergeSession(
  sessions: SessionSummary[],
  incoming: SessionSummary,
): SessionSummary[] {
  if (incoming.status === 'archived') return sessions.filter(({ id }) => id !== incoming.id);
  const existing = sessions.findIndex(({ id }) => id === incoming.id);
  if (existing === -1) return sortSessions([...sessions, incoming]);
  const next = [...sessions];
  next[existing] = incoming;
  return sortSessions(next);
}
