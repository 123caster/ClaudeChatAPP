import type { AttachmentRecord } from '@claude-chat/database';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { AttachmentContentService } from '../attachments/attachment-content-service.js';

function imageRecord(): AttachmentRecord {
  return {
    id: 'image-1',
    deviceId: 'device-1',
    draftId: 'draft-1',
    sessionId: 'session-1',
    messageId: 'message-1',
    kind: 'image',
    name: 'rotated-photo.jpg',
    mimeType: 'image/jpeg',
    size: 0,
    storageName: 'image-1.bin',
    previewName: 'image-1.webp',
    status: 'bound',
    originalExpiresAt: '2026-09-17T00:00:00.000Z',
    createdAt: '2026-09-16T00:00:00.000Z',
    boundAt: '2026-09-16T00:00:00.000Z',
  };
}

describe('attachment content service', () => {
  it('auto-rotates, bounds, converts, and strips metadata from model images', async () => {
    const original = await sharp({
      create: { width: 2_400, height: 1_200, channels: 3, background: '#159a8c' },
    })
      .jpeg({ quality: 95 })
      .withMetadata({ orientation: 6, density: 300 })
      .toBuffer();
    const sourceMetadata = await sharp(original).metadata();
    expect(sourceMetadata.orientation).toBe(6);
    expect(sourceMetadata.exif).toBeDefined();
    const service = new AttachmentContentService({ readOriginal: () => original });

    const [image] = await service.loadImages([imageRecord()]);
    const normalized = Buffer.from(image!.data, 'base64');
    const metadata = await sharp(normalized).metadata();

    expect(image).toMatchObject({
      attachmentId: 'image-1',
      mediaType: 'image/jpeg',
      originalBytes: original.length,
      normalizedBytes: normalized.length,
      width: 800,
      height: 1_600,
    });
    expect(metadata.format).toBe('jpeg');
    expect(metadata.width).toBe(800);
    expect(metadata.height).toBe(1_600);
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
  });
});
