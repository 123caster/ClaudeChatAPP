import AsyncStorage from '@react-native-async-storage/async-storage';

const eventCursorKey = 'claude-chat.event-cursor';

export async function loadEventCursor(): Promise<number> {
  const stored = await AsyncStorage.getItem(eventCursorKey);
  const parsed = stored === null ? 0 : Number(stored);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export async function saveEventCursor(cursor: number): Promise<void> {
  await AsyncStorage.setItem(eventCursorKey, String(cursor));
}

export async function clearEventCursor(): Promise<void> {
  await AsyncStorage.removeItem(eventCursorKey);
}
