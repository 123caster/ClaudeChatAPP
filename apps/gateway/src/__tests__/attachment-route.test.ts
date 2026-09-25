import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { closeDatabase, createDatabase, type DatabaseClient } from '@claude-chat/database';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { AttachmentService } from '../attachments/attachment-service.js';
import { AttachmentStorage } from '../attachments/attachment-storage.js';
import { DeviceAuthService } from '../auth/device-auth-service.js';
import { ProjectRegistry } from '../projects/project-registry.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

type TestContext = {
  app: FastifyInstance;
  attachments: AttachmentService;
  database: DatabaseClient;
  directory: string;
  token: string;
};

const contexts: TestContext[] = [];

function multipart(
  fields: Record<string, string>,
  file: { name: string; mimeType: string; data: Buffer },
): { body: Buffer; contentType: string } {
  const boundary = `----ClaudeChat${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.mimeType}\r\n\r\n`,
    ),
    file.data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function createContext(): TestContext {
  const database = createDatabase(':memory:');
  const deviceAuth = new DeviceAuthService(
    database.devices,
    () => new Date('2026-09-14T06:00:00.000Z'),
    () => 'paired-device-token-1234567890',
  );
  const { token } = deviceAuth.pair('Android');
  const directory = mkdtempSync(join(tmpdir(), 'claude-chat-attachments-'));
  const attachments = new AttachmentService(database, new AttachmentStorage(directory), {
    now: () => new Date('2026-09-14T06:00:00.000Z'),
  });
  const app = buildApp({
    services: {
      projects: new ProjectRegistry(database.projects),
      attachments,
      deviceAuth,
    },
  });
  const context = { app, attachments, database, directory, token };
  contexts.push(context);
  return context;
}

async function upload(
  context: TestContext,
  requestId: string,
  file = { name: 'pixel.png', mimeType: 'image/png', data: png },
) {
  const form = multipart({ requestId, draftId: '00000000-0000-4000-8000-000000000001' }, file);
  return context.app.inject({
    method: 'POST',
    url: '/v1/attachments',
    headers: {
      authorization: `Bearer ${context.token}`,
      'content-type': form.contentType,
    },
    payload: form.body,
  });
}

afterEach(async () => {
  for (const context of contexts.splice(0)) {
    await context.app.close();
    closeDatabase(context.database);
    rmSync(context.directory, { recursive: true, force: true });
  }
});

describe('attachment routes', () => {
  it('requires a paired device, stores a valid image and serves its stripped preview', async () => {
    const context = createContext();
    const form = multipart(
      {
        requestId: 'upload-unauthorized',
        draftId: '00000000-0000-4000-8000-000000000001',
      },
      { name: 'pixel.png', mimeType: 'image/png', data: png },
    );
    const unauthorized = await context.app.inject({
      method: 'POST',
      url: '/v1/attachments',
      headers: { 'content-type': form.contentType },
      payload: form.body,
    });
    expect(unauthorized.statusCode).toBe(401);

    const response = await upload(context, 'upload-image');
    expect(response.statusCode).toBe(201);
    const attachment = (response.json() as { attachment: { id: string } }).attachment;
    expect(attachment).toMatchObject({
      kind: 'image',
      name: 'pixel.png',
      mimeType: 'image/png',
      status: 'ready',
      previewAvailable: true,
    });

    const preview = await context.app.inject({
      method: 'GET',
      url: `/v1/attachments/${attachment.id}/preview`,
      headers: { authorization: `Bearer ${context.token}` },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers['content-type']).toContain('image/webp');
    expect(preview.rawPayload.length).toBeGreaterThan(0);
  });

  it('rejects executable and forged image content without leaving metadata', async () => {
    const context = createContext();
    const executable = await upload(context, 'upload-exe', {
      name: 'report.pdf.exe',
      mimeType: 'application/octet-stream',
      data: Buffer.from('MZ fake executable'),
    });
    expect(executable.statusCode).toBe(415);
    expect(executable.json()).toMatchObject({ error: { code: 'ATTACHMENT_TYPE_UNSUPPORTED' } });

    const forged = await upload(context, 'upload-forged', {
      name: 'photo.png',
      mimeType: 'image/png',
      data: Buffer.from('%PDF-1.7\nnot an image'),
    });
    expect(forged.statusCode).toBe(415);
    expect(context.database.attachments.listAll()).toEqual([]);
  });

  it('enforces the combined nine-item draft limit and deletes an unbound upload', async () => {
    const context = createContext();
    let firstId = '';
    for (let index = 0; index < 9; index += 1) {
      const response = await upload(context, `upload-${index}`);
      expect(response.statusCode).toBe(201);
      firstId ||= (response.json() as { attachment: { id: string } }).attachment.id;
    }

    const tenth = await upload(context, 'upload-10');
    expect(tenth.statusCode).toBe(413);
    expect(tenth.json()).toMatchObject({ error: { code: 'ATTACHMENT_LIMIT_EXCEEDED' } });

    const removed = await context.app.inject({
      method: 'POST',
      url: `/v1/attachments/${firstId}/delete`,
      headers: { authorization: `Bearer ${context.token}` },
      payload: { requestId: 'delete-upload' },
    });
    expect(removed.statusCode).toBe(200);
    expect(context.database.attachments.get(firstId)).toBeNull();
  });
});
