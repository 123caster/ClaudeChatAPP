import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const gatewayUrlKey = 'claude-chat.gateway-url';
const deviceTokenKey = 'claude-chat.device-token';

export type StoredConnection = {
  gatewayUrl: string | null;
  token: string | null;
};

export async function loadStoredConnection(): Promise<StoredConnection> {
  const [gatewayUrl, token] = await Promise.all([
    AsyncStorage.getItem(gatewayUrlKey),
    SecureStore.getItemAsync(deviceTokenKey),
  ]);
  return { gatewayUrl, token };
}

export async function saveGatewayUrl(gatewayUrl: string): Promise<void> {
  await AsyncStorage.setItem(gatewayUrlKey, gatewayUrl);
}

export async function saveDeviceToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(deviceTokenKey, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearDeviceToken(): Promise<void> {
  await SecureStore.deleteItemAsync(deviceTokenKey);
}

export async function savePairedConnection(gatewayUrl: string, token: string): Promise<void> {
  await saveDeviceToken(token);
  try {
    await saveGatewayUrl(gatewayUrl);
  } catch (error) {
    await clearDeviceToken();
    throw error;
  }
}
