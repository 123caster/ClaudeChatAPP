import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { closeDatabase, createDatabase } from '@claude-chat/database';
import { describe, expect, it } from 'vitest';

import { FakeClaudeAdapter } from '../claude/fake-claude-adapter.js';
import { EventStore } from '../events/event-store.js';
import { EventStream } from '../events/event-stream.js';
import { ProjectRegistry } from '../projects/project-registry.js';
import { SessionService } from '../sessions/session-service.js';

describe('Gateway restart recovery', () => {
  it('interrupts active sessions and cancels unresolved permissions after reopening SQLite', () => {
    const directory = mkdtempSync(join(tmpdir(), 'claude-chat-restart-'));
    const filename = join(directory, 'gateway.db');
    let database = createDatabase(filename);
    database.projects.upsert({
      id: 'project-1',
      displayName: 'Project',
      rootPath: 'D:\\Projects\\test',
      createdAt: '2026-08-13T08:00:00.000Z',
    });
    database.sessions.create({
      id: '00000000-0000-4000-8000-000000000001',
      claudeSessionId: 'claude-session-1',
      projectId: 'project-1',
      title: 'Active session',
      status: 'waiting_permission',
      createdAt: '2026-08-13T08:00:00.000Z',
      updatedAt: '2026-08-13T08:00:00.000Z',
      archivedAt: null,
    });
    database.permissions.create({
      id: '00000000-0000-4000-8000-000000000002',
      sessionId: '00000000-0000-4000-8000-000000000001',
      toolCallId: null,
      requestJson: JSON.stringify({ toolName: 'Bash', input: { command: 'pwd' } }),
      decision: null,
      decisionMessage: null,
      createdAt: '2026-08-13T08:00:00.000Z',
      expiresAt: '2026-08-13T08:10:00.000Z',
      resolvedAt: null,
    });
    closeDatabase(database);

    database = createDatabase(filename);
    const service = new SessionService(
      database,
      new ProjectRegistry(database.projects),
      new FakeClaudeAdapter(),
      new EventStore(database.events, new EventStream()),
      () => new Date('2026-08-13T08:05:00.000Z'),
    );
    expect(service.recoverOnStartup()).toEqual({ sessions: 1, permissions: 1 });
    expect(database.sessions.get('00000000-0000-4000-8000-000000000001')).toMatchObject({
      status: 'interrupted',
    });
    expect(database.permissions.get('00000000-0000-4000-8000-000000000002')).toMatchObject({
      decision: 'cancelled',
      resolvedAt: '2026-08-13T08:05:00.000Z',
    });

    closeDatabase(database);
    rmSync(directory, { recursive: true, force: true });
  });
});
