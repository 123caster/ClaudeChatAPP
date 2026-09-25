import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { closeDatabase, createDatabase } from '@claude-chat/database';
import { afterEach, describe, expect, it } from 'vitest';

import { AttachmentService } from '../attachments/attachment-service.js';
import { AttachmentStorage } from '../attachments/attachment-storage.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('attachment cleanup', () => {
  it('deletes expired drafts but preserves bound preview metadata', async () => {
    const database = createDatabase(':memory:');
    database.devices.create({
      id: 'device-1',
      name: 'Android',
      tokenHash: 'hash',
      createdAt: '2026-09-12T06:00:00.000Z',
    });
    database.projects.upsert({
      id: 'project-1',
      displayName: 'Project',
      rootPath: 'D:\\Projects\\project',
      createdAt: '2026-09-12T06:00:00.000Z',
    });
    database.sessions.create({
      id: 'session-1',
      claudeSessionId: null,
      projectId: 'project-1',
      workingDirectory: null,
      modelId: null,
      title: 'Attachment cleanup',
      status: 'idle',
      createdAt: '2026-09-12T06:00:00.000Z',
      updatedAt: '2026-09-12T06:00:00.000Z',
      archivedAt: null,
    });
    database.messages.create({
      id: 'message-1',
      sessionId: 'session-1',
      role: 'user',
      contentJson: '{"text":"image"}',
      isPartial: false,
      createdAt: '2026-09-12T06:00:00.000Z',
    });

    const directory = mkdtempSync(join(tmpdir(), 'claude-chat-cleanup-'));
    directories.push(directory);
    const storage = new AttachmentStorage(directory);
    const expiredDraft = await storage.storeOriginal('draft bytes');
    const boundOriginal = await storage.storeOriginal('bound bytes');
    const boundPreview = await storage.storePreview(Buffer.from('preview'));
    database.attachments.create({
      id: 'draft-attachment',
      deviceId: 'device-1',
      draftId: 'draft-1',
      sessionId: null,
      messageId: null,
      kind: 'document',
      name: 'draft.txt',
      mimeType: 'text/plain',
      size: 11,
      storageName: expiredDraft,
      previewName: null,
      status: 'ready',
      originalExpiresAt: '2026-09-13T06:00:00.000Z',
      createdAt: '2026-09-12T06:00:00.000Z',
      boundAt: null,
    });
    database.attachments.create({
      id: 'bound-attachment',
      deviceId: 'device-1',
      draftId: 'draft-2',
      sessionId: 'session-1',
      messageId: 'message-1',
      kind: 'image',
      name: 'bound.png',
      mimeType: 'image/png',
      size: 11,
      storageName: boundOriginal,
      previewName: boundPreview,
      status: 'bound',
      originalExpiresAt: '2026-09-13T06:00:00.000Z',
      createdAt: '2026-09-12T06:00:00.000Z',
      boundAt: '2026-09-12T06:01:00.000Z',
    });

    const service = new AttachmentService(database, storage, {
      now: () => new Date('2026-09-14T06:00:00.000Z'),
    });
    const result = await service.cleanupExpired();

    expect(result).toMatchObject({ deletedDrafts: 1, releasedOriginals: 1 });
    expect(database.attachments.get('draft-attachment')).toBeNull();
    expect(database.attachments.get('bound-attachment')).toMatchObject({
      storageName: null,
      previewName: boundPreview,
    });
    expect(existsSync(storage.originalPath(expiredDraft))).toBe(false);
    expect(existsSync(storage.originalPath(boundOriginal))).toBe(false);
    expect(existsSync(storage.previewPath(boundPreview))).toBe(true);

    closeDatabase(database);
  });
});
