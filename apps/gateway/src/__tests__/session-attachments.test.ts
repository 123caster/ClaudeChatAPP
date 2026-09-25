import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { closeDatabase, createDatabase } from '@claude-chat/database';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { AttachmentContentService } from '../attachments/attachment-content-service.js';
import { AttachmentService } from '../attachments/attachment-service.js';
import { AttachmentStorage } from '../attachments/attachment-storage.js';
import { DeviceAuthService } from '../auth/device-auth-service.js';
import { FakeClaudeAdapter } from '../claude/fake-claude-adapter.js';
import { MultimodalRouter } from '../claude/multimodal-router.js';
import { EventStore } from '../events/event-store.js';
import { EventStream } from '../events/event-stream.js';
import { ModelService } from '../models/model-service.js';
import { ProjectRegistry } from '../projects/project-registry.js';
import { SessionService } from '../sessions/session-service.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('session attachments', () => {
  it('binds attachments atomically, exposes history metadata and releases originals after the turn', async () => {
    const database = createDatabase(':memory:');
    const projectRoot = mkdtempSync(join(tmpdir(), 'claude-chat-project-'));
    const attachmentRoot = mkdtempSync(join(tmpdir(), 'claude-chat-content-'));
    roots.push(projectRoot, attachmentRoot);
    const projects = new ProjectRegistry(database.projects);
    const [project] = projects.synchronize([{ displayName: 'Project', path: projectRoot }]);
    const deviceAuth = new DeviceAuthService(
      database.devices,
      () => new Date('2026-09-14T06:00:00.000Z'),
      () => 'paired-device-token-1234567890',
    );
    const { device, token } = deviceAuth.pair('Android');
    const storage = new AttachmentStorage(attachmentRoot);
    const attachmentService = new AttachmentService(database, storage);
    const original = await sharp({
      create: { width: 320, height: 240, channels: 3, background: '#159a8c' },
    })
      .png()
      .toBuffer();
    const originalName = storage.storeOriginal(original);
    const previewName = storage.storePreview(Buffer.from('preview bytes'));
    const attachmentId = '00000000-0000-4000-8000-000000000009';
    database.attachments.create({
      id: attachmentId,
      deviceId: device.id,
      draftId: '00000000-0000-4000-8000-000000000008',
      sessionId: null,
      messageId: null,
      kind: 'image',
      name: 'diagram.png',
      mimeType: 'image/png',
      size: original.length,
      storageName: originalName,
      previewName,
      status: 'ready',
      originalExpiresAt: '2026-09-15T06:00:00.000Z',
      createdAt: '2026-09-14T06:00:00.000Z',
      boundAt: null,
    });

    const models = new ModelService(database.models);
    const adapter = new FakeClaudeAdapter();
    adapter.enqueue([
      { type: 'complete_message', text: 'I can read the diagram.' },
      { type: 'complete_turn' },
    ]);
    const events = new EventStore(database.events, new EventStream());
    const multimodal = new MultimodalRouter(
      new AttachmentContentService(attachmentService),
      models,
    );
    const sessions = new SessionService(
      database,
      projects,
      adapter,
      events,
      undefined,
      models,
      undefined,
      attachmentService,
      multimodal,
    );
    const app = buildApp({
      services: { projects, sessions, attachments: attachmentService, deviceAuth },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        requestId: 'create-with-attachment',
        projectId: project!.id,
        message: 'Explain this diagram.',
        attachmentIds: [attachmentId],
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      session: {
        messages: [
          {
            content: 'Explain this diagram.',
            attachments: [
              {
                id: attachmentId,
                name: 'diagram.png',
                status: 'bound',
                previewAvailable: true,
              },
            ],
          },
        ],
      },
    });

    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (database.attachments.get(attachmentId)?.storageName === null) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(database.attachments.get(attachmentId)).toMatchObject({
      status: 'bound',
      storageName: null,
      previewName,
    });
    expect(typeof adapter.requests[0]?.prompt).not.toBe('string');
    const prompt = adapter.requests[0]?.prompt as AsyncIterable<SDKUserMessage>;
    for await (const message of prompt) {
      expect(message.message.content).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'image' })]),
      );
    }

    await app.close();
    closeDatabase(database);
  });

  it('rejects unsupported images before changing the conversation or attachment', async () => {
    const database = createDatabase(':memory:');
    const projectRoot = mkdtempSync(join(tmpdir(), 'claude-chat-project-'));
    const attachmentRoot = mkdtempSync(join(tmpdir(), 'claude-chat-content-'));
    roots.push(projectRoot, attachmentRoot);
    const projects = new ProjectRegistry(database.projects);
    const [project] = projects.synchronize([{ displayName: 'Project', path: projectRoot }]);
    const deviceAuth = new DeviceAuthService(
      database.devices,
      () => new Date('2026-09-14T06:00:00.000Z'),
      () => 'paired-device-token-1234567890',
    );
    const { device, token } = deviceAuth.pair('Android');
    const storage = new AttachmentStorage(attachmentRoot);
    const attachmentService = new AttachmentService(database, storage);
    const models = new ModelService(database.models);
    const textModel = models.create({
      name: 'Text only',
      baseUrl: 'https://text.example.com',
      apiKey: 'secret',
      model: 'text-model',
      supportsImages: false,
    });
    const sessionId = '00000000-0000-4000-8000-000000000021';
    database.sessions.create({
      id: sessionId,
      claudeSessionId: null,
      projectId: project!.id,
      workingDirectory: null,
      modelId: textModel.id,
      title: 'Text conversation',
      status: 'idle',
      createdAt: '2026-09-14T06:00:00.000Z',
      updatedAt: '2026-09-14T06:00:00.000Z',
      archivedAt: null,
    });

    const originalName = storage.storeOriginal(Buffer.from('fake image bytes'));
    const attachmentId = '00000000-0000-4000-8000-000000000022';
    database.attachments.create({
      id: attachmentId,
      deviceId: device.id,
      draftId: '00000000-0000-4000-8000-000000000023',
      sessionId,
      messageId: null,
      kind: 'image',
      name: 'unsupported.png',
      mimeType: 'image/png',
      size: 16,
      storageName: originalName,
      previewName: null,
      status: 'ready',
      originalExpiresAt: '2026-09-15T06:00:00.000Z',
      createdAt: '2026-09-14T06:00:00.000Z',
      boundAt: null,
    });

    const adapter = new FakeClaudeAdapter();
    const events = new EventStore(database.events, new EventStream());
    const multimodal = new MultimodalRouter(
      new AttachmentContentService(attachmentService),
      models,
    );
    const sessions = new SessionService(
      database,
      projects,
      adapter,
      events,
      undefined,
      models,
      undefined,
      attachmentService,
      multimodal,
    );
    const app = buildApp({
      services: { projects, sessions, attachments: attachmentService, deviceAuth },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/messages`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        requestId: 'send-unsupported-image',
        message: 'Explain this image.',
        attachmentIds: [attachmentId],
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: { code: 'MULTIMODAL_MODEL_UNAVAILABLE' },
    });
    expect(database.sessions.get(sessionId)?.status).toBe('idle');
    expect(database.messages.listBySession(sessionId)).toEqual([]);
    expect(database.attachments.get(attachmentId)).toMatchObject({
      messageId: null,
      status: 'ready',
      storageName: originalName,
    });
    expect(adapter.requests).toHaveLength(0);

    await app.close();
    closeDatabase(database);
  });
});
