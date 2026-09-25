import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { GatewayClient, connectionErrorMessage, createEntityId } from '@/api/gateway-client';
import {
  hasUnfinishedAttachments,
  readyAttachmentIds,
  validateAttachmentSelection,
  type AttachmentCandidate,
  type ComposerAttachment,
} from '@/state/attachment-upload-queue';

type UploadQueueOptions = {
  apiKey: string | null;
  client: GatewayClient | null;
  sessionId?: string;
  onError?: (message: string) => void;
};

export type AttachmentUploadQueue = {
  items: ComposerAttachment[];
  attachmentIds: string[];
  isUploading: boolean;
  hasFailed: boolean;
  canSendAttachments: boolean;
  add: (candidates: AttachmentCandidate[]) => void;
  remove: (localId: string) => void;
  retry: (localId: string) => void;
  clearAfterSend: () => void;
  discardAll: () => void;
};

export function useAttachmentUploadQueue({
  apiKey,
  client,
  sessionId,
  onError,
}: UploadQueueOptions): AttachmentUploadQueue {
  const [items, setItems] = useState<ComposerAttachment[]>([]);
  const itemsRef = useRef(items);
  const draftIdRef = useRef(createEntityId());
  const controllersRef = useRef(new Map<string, AbortController>());

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const upload = useCallback(
    async (candidate: AttachmentCandidate) => {
      if (!client || !apiKey) {
        setItems((current) =>
          current.map((item) =>
            item.localId === candidate.localId
              ? { ...item, status: 'failed', error: '电脑离线，连接恢复后可重试。' }
              : item,
          ),
        );
        return;
      }
      const controller = new AbortController();
      controllersRef.current.set(candidate.localId, controller);
      setItems((current) =>
        current.map((item) =>
          item.localId === candidate.localId
            ? { ...item, status: 'uploading', progress: 0, error: undefined }
            : item,
        ),
      );
      try {
        const uploaded = await client.uploadAttachment(apiKey, {
          ...candidate,
          draftId: draftIdRef.current,
          sessionId,
          signal: controller.signal,
          onProgress: (progress) =>
            setItems((current) =>
              current.map((item) =>
                item.localId === candidate.localId ? { ...item, progress } : item,
              ),
            ),
        });
        setItems((current) =>
          current.map((item) =>
            item.localId === candidate.localId
              ? {
                  ...item,
                  status: 'ready',
                  progress: 1,
                  serverId: uploaded.id,
                  mimeType: uploaded.mimeType,
                  size: uploaded.size,
                  error: undefined,
                }
              : item,
          ),
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        const message = connectionErrorMessage(error);
        setItems((current) =>
          current.map((item) =>
            item.localId === candidate.localId
              ? { ...item, status: 'failed', progress: 0, error: message }
              : item,
          ),
        );
        onError?.(`“${candidate.name}”上传失败：${message}`);
      } finally {
        controllersRef.current.delete(candidate.localId);
      }
    },
    [apiKey, client, onError, sessionId],
  );

  const add = useCallback(
    (candidates: AttachmentCandidate[]) => {
      let accepted: AttachmentCandidate[];
      try {
        accepted = validateAttachmentSelection(itemsRef.current, candidates);
      } catch (error) {
        onError?.(error instanceof Error ? error.message : '无法添加附件。');
        return;
      }
      if (accepted.length === 0) return;
      setItems((current) => [
        ...current,
        ...accepted.map((candidate) => ({
          ...candidate,
          status: 'queued' as const,
          progress: 0,
        })),
      ]);
      accepted.forEach((candidate) => void upload(candidate));
    },
    [onError, upload],
  );

  const remove = useCallback(
    (localId: string) => {
      const item = itemsRef.current.find((candidate) => candidate.localId === localId);
      controllersRef.current.get(localId)?.abort();
      controllersRef.current.delete(localId);
      setItems((current) => current.filter((candidate) => candidate.localId !== localId));
      if (item?.serverId && client && apiKey) {
        void client.deleteAttachment(apiKey, item.serverId).catch(() => undefined);
      }
    },
    [apiKey, client],
  );

  const retry = useCallback(
    (localId: string) => {
      const item = itemsRef.current.find((candidate) => candidate.localId === localId);
      if (!item || item.status === 'uploading' || item.status === 'ready') return;
      void upload(item);
    },
    [upload],
  );

  const reset = useCallback(() => {
    controllersRef.current.forEach((controller) => controller.abort());
    controllersRef.current.clear();
    setItems([]);
    draftIdRef.current = createEntityId();
  }, []);

  const discardAll = useCallback(() => {
    const ready = itemsRef.current.filter((item) => item.serverId);
    reset();
    if (client && apiKey) {
      ready.forEach((item) => {
        if (item.serverId)
          void client.deleteAttachment(apiKey, item.serverId).catch(() => undefined);
      });
    }
  }, [apiKey, client, reset]);

  useEffect(
    () => () => {
      controllersRef.current.forEach((controller) => controller.abort());
      controllersRef.current.clear();
    },
    [],
  );

  return useMemo(
    () => ({
      items,
      attachmentIds: readyAttachmentIds(items),
      isUploading: items.some((item) => item.status === 'uploading' || item.status === 'queued'),
      hasFailed: items.some((item) => item.status === 'failed'),
      canSendAttachments: items.length > 0 && !hasUnfinishedAttachments(items),
      add,
      remove,
      retry,
      clearAfterSend: reset,
      discardAll,
    }),
    [add, discardAll, items, remove, reset, retry],
  );
}
