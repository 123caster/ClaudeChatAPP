import AsyncStorage from '@react-native-async-storage/async-storage';

import type { AttachmentCandidate } from '@/state/attachment-upload-queue';

const prefix = 'claude-chat.composer-draft.';

export type StoredComposerDraft = {
  text: string;
  attachments: AttachmentCandidate[];
};

export async function loadComposerDraft(key: string): Promise<StoredComposerDraft | null> {
  const value = await AsyncStorage.getItem(`${prefix}${key}`);
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<StoredComposerDraft>;
    if (typeof parsed.text !== 'string' || !Array.isArray(parsed.attachments)) return null;
    const attachments = parsed.attachments.filter(
      (item): item is AttachmentCandidate =>
        typeof item === 'object' &&
        item !== null &&
        typeof item.localId === 'string' &&
        typeof item.uri === 'string' &&
        typeof item.name === 'string' &&
        typeof item.mimeType === 'string' &&
        typeof item.size === 'number' &&
        (item.kind === 'image' || item.kind === 'document'),
    );
    return { text: parsed.text, attachments };
  } catch {
    return null;
  }
}

export async function saveComposerDraft(key: string, draft: StoredComposerDraft): Promise<void> {
  if (!draft.text.trim() && draft.attachments.length === 0) {
    await clearComposerDraft(key);
    return;
  }
  await AsyncStorage.setItem(`${prefix}${key}`, JSON.stringify(draft));
}

export async function clearComposerDraft(key: string): Promise<void> {
  await AsyncStorage.removeItem(`${prefix}${key}`);
}
