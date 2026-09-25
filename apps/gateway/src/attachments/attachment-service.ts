import { createHash, randomUUID } from 'node:crypto';

import {
  IdempotencyConflictError,
  type AttachmentRecord,
  type DatabaseClient,
} from '@claude-chat/database';
import type {
  AttachmentSummary,
  DeleteAttachmentResponse,
  ErrorCode,
  UploadAttachmentResponse,
} from '@claude-chat/protocol';
import sharp from 'sharp';

import {
  AttachmentPolicyError,
  inspectAttachment,
  MAX_ATTACHMENT_COUNT,
  MAX_DRAFT_BYTES,
} from './attachment-policy.js';
import type { AttachmentStorage } from './attachment-storage.js';

const DEFAULT_ORIGINAL_TTL_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_ORPHAN_GRACE_MS = 60 * 60 * 1_000;

export class AttachmentError extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'AttachmentError';
  }
}

export type UploadAttachmentInput = {
  requestId: string;
  deviceId: string;
  draftId: string;
  sessionId?: string;
  name: string;
  declaredMimeType: string;
  data: Buffer;
};

export type AttachmentServiceOptions = {
  now?: () => Date;
  originalTtlMs?: number;
  orphanGraceMs?: number;
};

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function summarize(record: AttachmentRecord): AttachmentSummary {
  return {
    id: record.id,
    kind: record.kind,
    name: record.name,
    mimeType: record.mimeType,
    size: record.size,
    status: record.status,
    previewAvailable: record.previewName !== null,
    createdAt: record.createdAt,
  };
}

export class AttachmentService {
  private readonly now: () => Date;
  private readonly originalTtlMs: number;
  private readonly orphanGraceMs: number;

  public constructor(
    private readonly database: DatabaseClient,
    private readonly storage: AttachmentStorage,
    options: AttachmentServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.originalTtlMs = options.originalTtlMs ?? DEFAULT_ORIGINAL_TTL_MS;
    this.orphanGraceMs = options.orphanGraceMs ?? DEFAULT_ORPHAN_GRACE_MS;
  }

  public async upload(input: UploadAttachmentInput): Promise<UploadAttachmentResponse> {
    const inspected = await this.inspect(input);
    const fileHash = createHash('sha256').update(input.data).digest('hex');
    const operationFingerprint = fingerprint({
      deviceId: input.deviceId,
      draftId: input.draftId,
      sessionId: input.sessionId ?? null,
      name: input.name,
      mimeType: inspected.mimeType,
      size: input.data.length,
      fileHash,
    });
    const replay = this.database.idempotency.get(input.requestId);
    if (replay) {
      if (replay.operation !== 'attachment.upload' || replay.fingerprint !== operationFingerprint) {
        throw new IdempotencyConflictError(input.requestId);
      }
      return JSON.parse(replay.resultJson) as UploadAttachmentResponse;
    }

    if (input.sessionId && !this.database.sessions.get(input.sessionId)) {
      throw new AttachmentError(404, 'NOT_FOUND', 'The target conversation no longer exists.');
    }
    const existing = this.database.attachments.listReadyByDraft(input.deviceId, input.draftId);
    if (existing.length >= MAX_ATTACHMENT_COUNT) {
      throw new AttachmentError(
        413,
        'ATTACHMENT_LIMIT_EXCEEDED',
        'A message may contain at most 9 attachments.',
      );
    }
    if (
      existing.reduce((total, item) => total + item.size, 0) + input.data.length >
      MAX_DRAFT_BYTES
    ) {
      throw new AttachmentError(
        413,
        'ATTACHMENT_LIMIT_EXCEEDED',
        'The combined attachment size may not exceed 40 MB.',
      );
    }

    let storageName: string | null = null;
    let previewName: string | null = null;
    try {
      storageName = this.storage.storeOriginal(input.data);
      if (inspected.kind === 'image') {
        const preview = await sharp(input.data, {
          animated: false,
          failOn: 'warning',
          limitInputPixels: 40_000_000,
        })
          .rotate()
          .resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 78 })
          .toBuffer();
        previewName = this.storage.storePreview(preview);
      }

      const timestamp = this.now();
      const record: AttachmentRecord = {
        id: randomUUID(),
        deviceId: input.deviceId,
        draftId: input.draftId,
        sessionId: input.sessionId ?? null,
        messageId: null,
        kind: inspected.kind,
        name: input.name,
        mimeType: inspected.mimeType,
        size: input.data.length,
        storageName,
        previewName,
        status: 'ready',
        originalExpiresAt: new Date(timestamp.getTime() + this.originalTtlMs).toISOString(),
        createdAt: timestamp.toISOString(),
        boundAt: null,
      };
      const result = this.database.idempotency.execute<UploadAttachmentResponse>(
        {
          requestId: input.requestId,
          operation: 'attachment.upload',
          fingerprint: operationFingerprint,
          createdAt: record.createdAt,
          completedAt: this.now().toISOString(),
        },
        () => ({
          requestId: input.requestId,
          attachment: summarize(this.database.attachments.create(record)),
        }),
      );
      if (result.replayed) {
        this.storage.deleteOriginal(storageName);
        this.storage.deletePreview(previewName);
      }
      return result.value;
    } catch (error) {
      this.storage.deleteOriginal(storageName);
      this.storage.deletePreview(previewName);
      throw error;
    }
  }

  public removeReady(
    deviceId: string,
    attachmentId: string,
    requestId: string,
  ): DeleteAttachmentResponse {
    const candidate = this.database.attachments.get(attachmentId);
    const result = this.database.idempotency.execute<DeleteAttachmentResponse>(
      {
        requestId,
        operation: `attachment.delete:${attachmentId}`,
        fingerprint: fingerprint({ deviceId, attachmentId }),
        createdAt: this.now().toISOString(),
        completedAt: this.now().toISOString(),
      },
      () => {
        const attachment = this.requireOwned(deviceId, attachmentId);
        if (attachment.status !== 'ready') {
          throw new AttachmentError(
            409,
            'ATTACHMENT_NOT_READY',
            'Sent attachments cannot be removed.',
          );
        }
        this.database.attachments.delete(attachmentId);
        return { requestId, attachmentId };
      },
    );
    if (!result.replayed && candidate?.deviceId === deviceId) {
      this.storage.deleteOriginal(candidate.storageName);
      this.storage.deletePreview(candidate.previewName);
    }
    return result.value;
  }

  public getPreview(deviceId: string, attachmentId: string): { stream: NodeJS.ReadableStream } {
    const attachment = this.requireOwned(deviceId, attachmentId);
    if (!attachment.previewName) {
      throw new AttachmentError(404, 'NOT_FOUND', 'This attachment has no preview.');
    }
    return { stream: this.storage.previewStream(attachment.previewName) };
  }

  public selectForMessage(
    deviceId: string,
    sessionId: string | null,
    ids: readonly string[],
  ): AttachmentRecord[] {
    if (ids.length === 0) return [];
    const records = ids.map((id) => this.database.attachments.get(id));
    if (
      records.some(
        (record) =>
          !record ||
          record.deviceId !== deviceId ||
          record.status !== 'ready' ||
          record.sessionId !== sessionId,
      )
    ) {
      throw new AttachmentError(
        409,
        'ATTACHMENT_NOT_READY',
        'One or more attachments are unavailable or belong to another draft.',
      );
    }
    const ready = records as AttachmentRecord[];
    if (new Set(ready.map((record) => record.draftId)).size !== 1) {
      throw new AttachmentError(
        409,
        'ATTACHMENT_NOT_READY',
        'Attachments must belong to one draft.',
      );
    }
    return ready;
  }

  public bindToMessage(
    records: readonly AttachmentRecord[],
    sessionId: string,
    messageId: string,
    boundAt: string,
  ): void {
    if (records.length === 0) return;
    const first = records[0]!;
    const changed = this.database.attachments.bindToMessage(
      records.map((record) => record.id),
      first.deviceId,
      first.draftId,
      sessionId,
      messageId,
      boundAt,
    );
    if (changed !== records.length) {
      throw new AttachmentError(
        409,
        'ATTACHMENT_NOT_READY',
        'Attachment binding changed concurrently.',
      );
    }
  }

  public async releaseOriginals(records: readonly AttachmentRecord[]): Promise<void> {
    for (const record of records) {
      try {
        this.storage.deleteOriginal(record.storageName);
        this.database.attachments.releaseOriginal(record.id);
      } catch {
        // The periodic cleanup retries any original that could not be released here.
      }
    }
  }

  public deleteFiles(records: readonly AttachmentRecord[]): void {
    for (const record of records) {
      try {
        this.storage.deleteOriginal(record.storageName);
        this.storage.deletePreview(record.previewName);
      } catch {
        // Orphan cleanup removes any file that survives a metadata cascade.
      }
    }
  }

  public readOriginal(record: AttachmentRecord): Buffer {
    if (!record.storageName) {
      throw new AttachmentError(
        410,
        'ATTACHMENT_EXPIRED',
        `${record.name} is no longer available.`,
      );
    }
    try {
      return this.storage.readOriginal(record.storageName);
    } catch {
      throw new AttachmentError(
        410,
        'ATTACHMENT_EXPIRED',
        `${record.name} is no longer available.`,
      );
    }
  }

  public async cleanupExpired(): Promise<{
    deletedDrafts: number;
    releasedOriginals: number;
    deletedOrphans: number;
    failures: number;
  }> {
    let deletedDrafts = 0;
    let releasedOriginals = 0;
    let deletedOrphans = 0;
    let failures = 0;
    for (const record of this.database.attachments.listExpiredOriginals(this.now().toISOString())) {
      try {
        this.storage.deleteOriginal(record.storageName);
        if (record.status === 'ready') {
          this.storage.deletePreview(record.previewName);
          this.database.attachments.delete(record.id);
          deletedDrafts += 1;
        } else {
          this.database.attachments.releaseOriginal(record.id);
          releasedOriginals += 1;
        }
      } catch {
        failures += 1;
      }
    }

    const records = this.database.attachments.listAll();
    const referencedOriginals = new Set(records.flatMap((record) => record.storageName ?? []));
    const referencedPreviews = new Set(records.flatMap((record) => record.previewName ?? []));
    const cutoff = this.now().getTime() - this.orphanGraceMs;
    for (const file of this.storage.listOriginals()) {
      if (!referencedOriginals.has(file.name) && file.modifiedAtMs <= cutoff) {
        try {
          this.storage.deleteOriginal(file.name);
          deletedOrphans += 1;
        } catch {
          failures += 1;
        }
      }
    }
    for (const file of this.storage.listPreviews()) {
      if (!referencedPreviews.has(file.name) && file.modifiedAtMs <= cutoff) {
        try {
          this.storage.deletePreview(file.name);
          deletedOrphans += 1;
        } catch {
          failures += 1;
        }
      }
    }
    return { deletedDrafts, releasedOriginals, deletedOrphans, failures };
  }

  public startCleanup(intervalMs = 60 * 60 * 1_000): () => void {
    void this.cleanupExpired();
    const timer = setInterval(() => void this.cleanupExpired(), intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }

  private async inspect(input: UploadAttachmentInput) {
    try {
      return await inspectAttachment({
        name: input.name,
        declaredMimeType: input.declaredMimeType,
        data: input.data,
      });
    } catch (error) {
      if (error instanceof AttachmentPolicyError) {
        throw new AttachmentError(
          error.reason === 'too_large' ? 413 : 415,
          error.reason === 'too_large' ? 'ATTACHMENT_TOO_LARGE' : 'ATTACHMENT_TYPE_UNSUPPORTED',
          error.message,
        );
      }
      throw error;
    }
  }

  private requireOwned(deviceId: string, attachmentId: string): AttachmentRecord {
    const attachment = this.database.attachments.get(attachmentId);
    if (!attachment || attachment.deviceId !== deviceId) {
      throw new AttachmentError(404, 'NOT_FOUND', 'Attachment not found.');
    }
    return attachment;
  }
}
