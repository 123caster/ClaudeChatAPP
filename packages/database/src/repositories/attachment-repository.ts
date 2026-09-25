import type { DatabaseConnection } from '../connection.js';

export type AttachmentKind = 'image' | 'document';
export type AttachmentStatus = 'ready' | 'bound';

export type AttachmentRecord = {
  id: string;
  deviceId: string;
  draftId: string;
  sessionId: string | null;
  messageId: string | null;
  kind: AttachmentKind;
  name: string;
  mimeType: string;
  size: number;
  storageName: string | null;
  previewName: string | null;
  status: AttachmentStatus;
  originalExpiresAt: string | null;
  createdAt: string;
  boundAt: string | null;
};

type AttachmentRow = {
  id: string;
  device_id: string;
  draft_id: string;
  session_id: string | null;
  message_id: string | null;
  kind: AttachmentKind;
  name: string;
  mime_type: string;
  size: number;
  storage_name: string | null;
  preview_name: string | null;
  status: AttachmentStatus;
  original_expires_at: string | null;
  created_at: string;
  bound_at: string | null;
};

function mapAttachment(row: AttachmentRow): AttachmentRecord {
  return {
    id: row.id,
    deviceId: row.device_id,
    draftId: row.draft_id,
    sessionId: row.session_id,
    messageId: row.message_id,
    kind: row.kind,
    name: row.name,
    mimeType: row.mime_type,
    size: row.size,
    storageName: row.storage_name,
    previewName: row.preview_name,
    status: row.status,
    originalExpiresAt: row.original_expires_at,
    createdAt: row.created_at,
    boundAt: row.bound_at,
  };
}

const attachmentColumns = `
  id, device_id, draft_id, session_id, message_id, kind, name, mime_type,
  size, storage_name, preview_name, status, original_expires_at, created_at, bound_at
`;

export interface AttachmentRepository {
  create(record: AttachmentRecord): AttachmentRecord;
  get(id: string): AttachmentRecord | null;
  listReadyByDraft(deviceId: string, draftId: string): AttachmentRecord[];
  listReadyForDraft(deviceId: string, draftId: string, ids: readonly string[]): AttachmentRecord[];
  listByMessageIds(messageIds: readonly string[]): AttachmentRecord[];
  listBySession(sessionId: string): AttachmentRecord[];
  listAll(): AttachmentRecord[];
  listExpiredOriginals(now: string): AttachmentRecord[];
  bindToMessage(
    ids: readonly string[],
    deviceId: string,
    draftId: string,
    sessionId: string,
    messageId: string,
    boundAt: string,
  ): number;
  releaseOriginal(id: string): boolean;
  delete(id: string): boolean;
}

class SqliteAttachmentRepository implements AttachmentRepository {
  public constructor(private readonly database: DatabaseConnection) {}

  public create(record: AttachmentRecord): AttachmentRecord {
    this.database
      .prepare(
        `INSERT INTO attachments(
           id, device_id, draft_id, session_id, message_id, kind, name, mime_type,
           size, storage_name, preview_name, status, original_expires_at, created_at, bound_at
         ) VALUES (
           $id, $deviceId, $draftId, $sessionId, $messageId, $kind, $name, $mimeType,
           $size, $storageName, $previewName, $status, $originalExpiresAt, $createdAt, $boundAt
         )`,
      )
      .run({
        $id: record.id,
        $deviceId: record.deviceId,
        $draftId: record.draftId,
        $sessionId: record.sessionId,
        $messageId: record.messageId,
        $kind: record.kind,
        $name: record.name,
        $mimeType: record.mimeType,
        $size: record.size,
        $storageName: record.storageName,
        $previewName: record.previewName,
        $status: record.status,
        $originalExpiresAt: record.originalExpiresAt,
        $createdAt: record.createdAt,
        $boundAt: record.boundAt,
      });
    return record;
  }

  public get(id: string): AttachmentRecord | null {
    const row = this.database
      .prepare(`SELECT ${attachmentColumns} FROM attachments WHERE id = $id`)
      .get({ $id: id }) as AttachmentRow | undefined;
    return row ? mapAttachment(row) : null;
  }

  public listReadyByDraft(deviceId: string, draftId: string): AttachmentRecord[] {
    const rows = this.database
      .prepare(
        `SELECT ${attachmentColumns}
         FROM attachments
         WHERE device_id = $deviceId AND draft_id = $draftId AND status = 'ready'
         ORDER BY created_at ASC, id ASC`,
      )
      .all({ $deviceId: deviceId, $draftId: draftId }) as AttachmentRow[];
    return rows.map(mapAttachment);
  }

  public listReadyForDraft(
    deviceId: string,
    draftId: string,
    ids: readonly string[],
  ): AttachmentRecord[] {
    if (ids.length === 0) return [];
    const { placeholders, parameters } = createNamedList('id', ids);
    const rows = this.database
      .prepare(
        `SELECT ${attachmentColumns}
         FROM attachments
         WHERE device_id = $deviceId
           AND draft_id = $draftId
           AND status = 'ready'
           AND id IN (${placeholders})
         ORDER BY created_at ASC, id ASC`,
      )
      .all({ $deviceId: deviceId, $draftId: draftId, ...parameters }) as AttachmentRow[];
    return rows.map(mapAttachment);
  }

  public listByMessageIds(messageIds: readonly string[]): AttachmentRecord[] {
    if (messageIds.length === 0) return [];
    const { placeholders, parameters } = createNamedList('messageId', messageIds);
    const rows = this.database
      .prepare(
        `SELECT ${attachmentColumns}
         FROM attachments
         WHERE message_id IN (${placeholders})
         ORDER BY created_at ASC, id ASC`,
      )
      .all(parameters) as AttachmentRow[];
    return rows.map(mapAttachment);
  }

  public listBySession(sessionId: string): AttachmentRecord[] {
    const rows = this.database
      .prepare(
        `SELECT ${attachmentColumns}
         FROM attachments
         WHERE session_id = $sessionId
         ORDER BY created_at ASC, id ASC`,
      )
      .all({ $sessionId: sessionId }) as AttachmentRow[];
    return rows.map(mapAttachment);
  }

  public listAll(): AttachmentRecord[] {
    const rows = this.database
      .prepare(`SELECT ${attachmentColumns} FROM attachments ORDER BY created_at ASC, id ASC`)
      .all() as AttachmentRow[];
    return rows.map(mapAttachment);
  }

  public listExpiredOriginals(now: string): AttachmentRecord[] {
    const rows = this.database
      .prepare(
        `SELECT ${attachmentColumns}
         FROM attachments
         WHERE storage_name IS NOT NULL
           AND original_expires_at IS NOT NULL
           AND original_expires_at <= $now
         ORDER BY original_expires_at ASC, id ASC`,
      )
      .all({ $now: now }) as AttachmentRow[];
    return rows.map(mapAttachment);
  }

  public bindToMessage(
    ids: readonly string[],
    deviceId: string,
    draftId: string,
    sessionId: string,
    messageId: string,
    boundAt: string,
  ): number {
    const statement = this.database.prepare(
      `UPDATE attachments
       SET session_id = $sessionId,
           message_id = $messageId,
           status = 'bound',
           bound_at = $boundAt
       WHERE id = $id
         AND device_id = $deviceId
         AND draft_id = $draftId
         AND status = 'ready'`,
    );
    let changed = 0;
    for (const id of ids) {
      const result = statement.run({
        $id: id,
        $deviceId: deviceId,
        $draftId: draftId,
        $sessionId: sessionId,
        $messageId: messageId,
        $boundAt: boundAt,
      });
      changed += Number(result.changes);
    }
    return changed;
  }

  public releaseOriginal(id: string): boolean {
    const result = this.database
      .prepare(
        `UPDATE attachments
         SET storage_name = NULL, original_expires_at = NULL
         WHERE id = $id AND storage_name IS NOT NULL`,
      )
      .run({ $id: id });
    return result.changes === 1 || result.changes === 1n;
  }

  public delete(id: string): boolean {
    const result = this.database.prepare('DELETE FROM attachments WHERE id = $id').run({ $id: id });
    return result.changes === 1 || result.changes === 1n;
  }
}

function createNamedList(
  prefix: string,
  values: readonly string[],
): { placeholders: string; parameters: Record<string, string> } {
  const parameters: Record<string, string> = {};
  const placeholders = values.map((value, index) => {
    const name = `$${prefix}${index}`;
    parameters[name] = value;
    return name;
  });
  return { placeholders: placeholders.join(', '), parameters };
}

export function createAttachmentRepository(database: DatabaseConnection): AttachmentRepository {
  return new SqliteAttachmentRepository(database);
}
