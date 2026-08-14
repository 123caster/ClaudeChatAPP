import AsyncStorage from '@react-native-async-storage/async-storage';
import { sessionDetailSchema, type SessionDetail } from '@claude-chat/protocol';

const prefix = 'claude-chat.session-detail.';

export async function loadCachedSession(sessionId: string): Promise<SessionDetail | null> {
  const value = await AsyncStorage.getItem(`${prefix}${sessionId}`);
  if (!value) return null;
  try {
    const parsed = sessionDetailSchema.safeParse(JSON.parse(value) as unknown);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function saveCachedSession(detail: SessionDetail): Promise<void> {
  const compact: SessionDetail = {
    ...detail,
    messages: detail.messages.slice(-100),
    toolCalls: detail.toolCalls.slice(-50),
    permissions: detail.permissions.slice(-50),
  };
  await AsyncStorage.setItem(`${prefix}${detail.id}`, JSON.stringify(compact));
}
