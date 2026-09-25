import * as SecureStore from 'expo-secure-store';

const deviceTokenKey = 'claude-chat.device-token';
const legacyApiKeyKey = 'claude-chat.api-key';

export type StoredConnection = {
  deviceToken: string | null;
};

export async function loadStoredConnection(): Promise<StoredConnection> {
  const deviceToken = await SecureStore.getItemAsync(deviceTokenKey);
  return { deviceToken };
}

export async function saveDeviceToken(deviceToken: string): Promise<void> {
  await SecureStore.setItemAsync(deviceTokenKey, deviceToken, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  await SecureStore.deleteItemAsync(legacyApiKeyKey);
}

export async function clearDeviceToken(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(deviceTokenKey),
    SecureStore.deleteItemAsync(legacyApiKeyKey),
  ]);
}
