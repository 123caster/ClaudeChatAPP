import {
  MAX_ATTACHMENT_COUNT,
  MAX_DOCUMENT_BYTES,
  MAX_DRAFT_BYTES,
  MAX_IMAGE_BYTES,
  hasUnfinishedAttachments,
  readyAttachmentIds,
  validateAttachmentSelection,
  type AttachmentCandidate,
} from '@/state/attachment-upload-queue';

function candidate(
  name: string,
  kind: AttachmentCandidate['kind'],
  size = 1_024,
): AttachmentCandidate {
  return {
    localId: name,
    uri: `file:///${name}`,
    name,
    mimeType: kind === 'image' ? 'image/jpeg' : 'text/plain',
    size,
    kind,
  };
}

describe('attachment selection', () => {
  it('accepts supported images, documents and source files', () => {
    const selected = validateAttachmentSelection(
      [],
      [
        candidate('photo.jpg', 'image'),
        candidate('notes.md', 'document'),
        candidate('main.ts', 'document'),
        candidate('report.pdf', 'document'),
      ],
    );

    expect(selected).toHaveLength(4);
  });

  it('deduplicates an already selected local file', () => {
    const photo = candidate('photo.png', 'image');
    expect(validateAttachmentSelection([photo], [photo])).toEqual([]);
  });

  it('enforces the combined count and size limits', () => {
    const existing = Array.from({ length: MAX_ATTACHMENT_COUNT }, (_, index) =>
      candidate(`${index}.txt`, 'document'),
    );
    expect(() =>
      validateAttachmentSelection(existing, [candidate('extra.txt', 'document')]),
    ).toThrow('最多');
    expect(() =>
      validateAttachmentSelection([], [candidate('huge.jpg', 'image', MAX_IMAGE_BYTES + 1)]),
    ).toThrow('10 MB');
    expect(() =>
      validateAttachmentSelection(
        [],
        [
          candidate('a.pdf', 'document', MAX_DOCUMENT_BYTES),
          candidate('b.pdf', 'document', MAX_DOCUMENT_BYTES),
          candidate('c.txt', 'document', MAX_DRAFT_BYTES - MAX_DOCUMENT_BYTES * 2 + 1),
        ],
      ),
    ).toThrow('总大小');
  });

  it('rejects unsafe file types', () => {
    expect(() => validateAttachmentSelection([], [candidate('payload.exe', 'document')])).toThrow(
      '不支持',
    );
  });
});

describe('attachment send state', () => {
  it('returns only ready server IDs and detects pending work', () => {
    const base = candidate('a.txt', 'document');
    const ready = { ...base, status: 'ready' as const, progress: 1, serverId: 'server-a' };
    const uploading = {
      ...candidate('b.txt', 'document'),
      status: 'uploading' as const,
      progress: 0.5,
    };

    expect(readyAttachmentIds([ready, uploading])).toEqual(['server-a']);
    expect(hasUnfinishedAttachments([ready, uploading])).toBe(true);
    expect(hasUnfinishedAttachments([ready])).toBe(false);
  });
});
