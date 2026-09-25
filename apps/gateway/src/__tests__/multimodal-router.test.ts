import { once } from 'node:events';
import { createServer } from 'node:http';

import type { AttachmentRecord } from '@claude-chat/database';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import { AttachmentContentService } from '../attachments/attachment-content-service.js';
import { MultimodalRouter, type MultimodalModelConfig } from '../claude/multimodal-router.js';

const createdAt = '2026-09-14T06:00:00.000Z';

function record(id: string, overrides: Partial<AttachmentRecord> = {}): AttachmentRecord {
  return {
    id,
    deviceId: 'device-1',
    draftId: 'draft-1',
    sessionId: 'session-1',
    messageId: 'message-1',
    kind: 'image',
    name: `${id}.png`,
    mimeType: 'image/png',
    size: 12,
    storageName: `${id}.bin`,
    previewName: `${id}.webp`,
    status: 'bound',
    originalExpiresAt: '2026-09-15T06:00:00.000Z',
    createdAt,
    boundAt: createdAt,
    ...overrides,
  };
}

async function firstUserMessage(prompt: string | AsyncIterable<SDKUserMessage>) {
  if (typeof prompt === 'string') throw new Error('Expected a structured prompt.');
  for await (const message of prompt) return message;
  throw new Error('Prompt did not contain a user message.');
}

async function imageBytes(): Promise<Buffer> {
  return sharp({
    create: { width: 320, height: 240, channels: 3, background: '#159a8c' },
  })
    .jpeg()
    .toBuffer();
}

describe('multimodal router', () => {
  it('builds image and extracted text content for a capable conversation model', async () => {
    const image = record('image-1');
    const text = record('text-1', {
      kind: 'document',
      name: 'notes.md',
      mimeType: 'text/plain',
      previewName: null,
    });
    const bytes = new Map([
      ['image-1', await imageBytes()],
      ['text-1', Buffer.from('# Notes\nImportant')],
    ]);
    const content = new AttachmentContentService({
      readOriginal: (attachment) => bytes.get(attachment.id)!,
    });
    const router = new MultimodalRouter(content, { getMultimodalDefault: () => null });

    const prompt = await router.prepare('Please review these files.', [image, text], {
      id: 'current',
      baseUrl: 'https://api.example.com',
      apiKey: 'secret',
      model: 'vision-model',
      supportsImages: true,
      supportsDocuments: true,
    });
    const message = await firstUserMessage(prompt);
    expect(message.message.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'text', text: 'Please review these files.' }),
        expect.objectContaining({ type: 'image' }),
        expect.objectContaining({ type: 'text', text: expect.stringContaining('# Notes') }),
      ]),
    );
  });

  it('uses the configured multimodal model for images without switching the conversation model', async () => {
    const image = record('image-1');
    const original = await imageBytes();
    const content = new AttachmentContentService({
      readOriginal: () => original,
    });
    const fallback: MultimodalModelConfig = {
      id: 'fallback',
      baseUrl: 'https://vision.example.com',
      apiKey: 'vision-secret',
      model: 'vision-model',
      supportsImages: true,
      supportsDocuments: true,
    };
    const identifyImages = vi.fn(async () => 'Image 1 contains a database diagram.');
    const router = new MultimodalRouter(
      content,
      { getMultimodalDefault: () => fallback },
      identifyImages,
    );
    const current: MultimodalModelConfig = {
      id: 'text-only',
      baseUrl: 'https://text.example.com',
      apiKey: 'text-secret',
      model: 'text-model',
      supportsImages: false,
      supportsDocuments: false,
    };

    const prompt = await router.prepare('Explain it.', [image], current);
    expect(identifyImages).toHaveBeenCalledWith(fallback, 'Explain it.', [
      expect.objectContaining({
        attachmentId: 'image-1',
        name: 'image-1.png',
        mediaType: 'image/jpeg',
        width: 320,
        height: 240,
      }),
    ]);
    const message = await firstUserMessage(prompt);
    expect(message.message.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('Image 1 contains a database diagram.'),
      }),
    ]);
    expect(current.model).toBe('text-model');
  });

  it('uses the same bearer authentication as the conversation model adapter', async () => {
    const original = await imageBytes();
    const content = new AttachmentContentService({ readOriginal: () => original });
    let authorization: string | undefined;
    let apiKeyHeader: string | undefined;
    const server = createServer((request, response) => {
      authorization = request.headers.authorization;
      apiKeyHeader = request.headers['x-api-key'] as string | undefined;
      request.resume();
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          model: 'vision-model',
          content: [{ type: 'text', text: 'The image contains a diagram.' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Missing test server port.');
    const fallback: MultimodalModelConfig = {
      id: 'fallback',
      baseUrl: `http://127.0.0.1:${address.port}`,
      apiKey: 'vision-secret',
      model: 'vision-model',
      supportsImages: true,
      supportsDocuments: false,
    };
    const router = new MultimodalRouter(content, { getMultimodalDefault: () => fallback });

    try {
      await router.prepare('Explain it.', [record('image-1')], {
        id: 'text-only',
        baseUrl: 'https://text.example.com',
        apiKey: 'text-secret',
        model: 'text-model',
        supportsImages: false,
        supportsDocuments: false,
      });
    } finally {
      server.close();
      await once(server, 'close');
    }

    expect(authorization).toBe('Bearer vision-secret');
    expect(apiKeyHeader).toBeUndefined();
  });

  it('fails clearly when image fallback is required but not configured', async () => {
    const content = new AttachmentContentService({
      readOriginal: () => Buffer.from('image bytes'),
    });
    const router = new MultimodalRouter(content, { getMultimodalDefault: () => null });
    const current: MultimodalModelConfig = {
      id: 'text-only',
      baseUrl: 'https://text.example.com',
      apiKey: 'secret',
      model: 'text-model',
      supportsImages: false,
      supportsDocuments: false,
    };
    expect(() => router.assertConfigured([record('image-1')], current)).toThrowError(
      'Configure a default multimodal model before sending images to this model.',
    );
    await expect(router.prepare('Explain it.', [record('image-1')], current)).rejects.toMatchObject(
      {
        code: 'MULTIMODAL_MODEL_UNAVAILABLE',
        statusCode: 503,
      },
    );
  });

  it('retries one explicit provider outage and records only safe diagnostics', async () => {
    const original = await imageBytes();
    const content = new AttachmentContentService({ readOriginal: () => original });
    const fallback: MultimodalModelConfig = {
      id: 'fallback',
      baseUrl: 'https://vision.example.com',
      apiKey: 'vision-secret',
      model: 'vision-model',
      supportsImages: true,
      supportsDocuments: false,
    };
    const outage = Object.assign(new Error('sensitive provider response'), {
      name: 'APIError',
      status: 503,
      code: 'overloaded_error',
    });
    const identifyImages = vi
      .fn()
      .mockRejectedValueOnce(outage)
      .mockResolvedValueOnce('The image contains a diagram.');
    const diagnostics: unknown[] = [];
    const router = new MultimodalRouter(
      content,
      { getMultimodalDefault: () => fallback },
      identifyImages,
      (diagnostic) => diagnostics.push(diagnostic),
    );

    await router.prepare('Explain it.', [record('image-1')], {
      id: 'text-only',
      baseUrl: 'https://text.example.com',
      apiKey: 'text-secret',
      model: 'text-model',
      supportsImages: false,
      supportsDocuments: false,
    });

    expect(identifyImages).toHaveBeenCalledTimes(2);
    expect(diagnostics).toEqual([
      expect.objectContaining({
        attempt: 1,
        status: 503,
        providerCode: 'overloaded_error',
        retryable: true,
        images: [
          expect.objectContaining({
            attachmentId: 'image-1',
            width: 320,
            height: 240,
          }),
        ],
      }),
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain('vision-secret');
    expect(JSON.stringify(diagnostics)).not.toContain('sensitive provider response');
  });

  it('does not retry a provider request rejected with a non-retryable 4xx error', async () => {
    const original = await imageBytes();
    const content = new AttachmentContentService({ readOriginal: () => original });
    const fallback: MultimodalModelConfig = {
      id: 'fallback',
      baseUrl: 'https://vision.example.com',
      apiKey: 'vision-secret',
      model: 'vision-model',
      supportsImages: true,
      supportsDocuments: false,
    };
    const identifyImages = vi.fn().mockRejectedValue(
      Object.assign(new Error('invalid image'), {
        name: 'BadRequestError',
        status: 400,
        code: 'invalid_request_error',
      }),
    );
    const router = new MultimodalRouter(
      content,
      { getMultimodalDefault: () => fallback },
      identifyImages,
    );

    await expect(
      router.prepare('Explain it.', [record('image-1')], {
        id: 'text-only',
        baseUrl: 'https://text.example.com',
        apiKey: 'text-secret',
        model: 'text-model',
        supportsImages: false,
        supportsDocuments: false,
      }),
    ).rejects.toMatchObject({
      code: 'MULTIMODAL_MODEL_UNAVAILABLE',
      retryable: false,
    });
    expect(identifyImages).toHaveBeenCalledTimes(1);
  });
});
