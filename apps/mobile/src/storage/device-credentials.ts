import * as SecureStore from 'expo-secure-store';

const apiKeyKey = 'claude-chat.api-key';

export type StoredConnection = {
  apiKey: string | null;
};

export async function loadStoredConnection(): Promise<StoredConnection> {
  const apiKey = await SecureStore.getItemAsync(apiKeyKey);
  return { apiKey };
}

export async function saveApiKey(apiKey: string): Promise<void> {
  await SecureStore.setItemAsync(apiKeyKey, apiKey, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearApiKey(): Promise<void> {
  await SecureStore.deleteItemAsync(apiKeyKey);
}
