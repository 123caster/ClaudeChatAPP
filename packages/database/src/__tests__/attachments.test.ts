import { describe, expect, it } from 'vitest';

import { closeDatabase, createDatabase, type AttachmentRecord } from '../index.js';

const createdAt = '2026-09-14T05:00:00.000Z';

function setup() {
  const database = createDatabase(':memory:');
  database.devices.create({
    id: 'device-1',
    name: 'Android',
    tokenHash: 'hash-1',
    createdAt,
  });
  database.projects.upsert({
    id: 'project-1',
    displayName: 'Project',
    rootPath: 'D:\\Projects\\project',
    createdAt,
  });
  database.sessions.create({
    id: 'session-1',
    claudeSessionId: null,
    projectId: 'project-1',
    workingDirectory: null,
    modelId: null,
    title: 'Attachments',
    status: 'idle',
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
  });
  return database;
}

function attachment(id: string): AttachmentRecord {
  return {
    id,
    deviceId: 'device-1',
    draftId: 'draft-1',
    sessionId: 'session-1',
    messageId: null,
    kind: 'image',
    name: `${id}.png`,
    mimeType: 'image/png',
    size: 1024,
    storageName: `${id}.bin`,
    previewName: `${id}.webp`,
    status: 'ready',
    originalExpiresAt: '2026-09-15T05:00:00.000Z',
    createdAt,
    boundAt: null,
  };
}

describe('attachment repository', () => {
  it('creates, scopes and binds ready attachments to one message', () => {
    const database = setup();
    database.attachments.create(attachment('attachment-1'));
    database.attachments.create(attachment('attachment-2'));

    expect(
      database.attachments.listReadyForDraft('device-1', 'draft-1', [
        'attachment-2',
        'attachment-1',
      ]),
    ).toHaveLength(2);
    expect(
      database.attachments.listReadyForDraft('another-device', 'draft-1', ['attachment-1']),
    ).toEqual([]);

    database.messages.create({
      id: 'message-1',
      sessionId: 'session-1',
      role: 'user',
      contentJson: '{"text":"Review"}',
      isPartial: false,
      createdAt,
    });
    expect(
      database.attachments.bindToMessage(
        ['attachment-1', 'attachment-2'],
        'device-1',
        'draft-1',
        'session-1',
        'message-1',
        '2026-09-14T05:01:00.000Z',
      ),
    ).toBe(2);
    expect(database.attachments.listByMessageIds(['message-1'])).toHaveLength(2);
    expect(database.attachments.listReadyForDraft('device-1', 'draft-1', ['attachment-1'])).toEqual(
      [],
    );
    closeDatabase(database);
  });

  it('releases originals without deleting history previews and finds expired uploads', () => {
    const database = setup();
    database.attachments.create(attachment('attachment-1'));

    expect(database.attachments.listExpiredOriginals('2026-09-16T00:00:00.000Z')).toHaveLength(1);
    expect(database.attachments.releaseOriginal('attachment-1')).toBe(true);
    expect(database.attachments.get('attachment-1')).toMatchObject({
      storageName: null,
      previewName: 'attachment-1.webp',
      originalExpiresAt: null,
    });
    expect(database.attachments.listExpiredOriginals('2026-09-16T00:00:00.000Z')).toEqual([]);
    closeDatabase(database);
  });

  it('cascades attachment metadata when its session is deleted', () => {
    const database = setup();
    database.attachments.create(attachment('attachment-1'));
    expect(database.sessions.delete('session-1')).toBe(true);
    expect(database.attachments.get('attachment-1')).toBeNull();
    closeDatabase(database);
  });
});
