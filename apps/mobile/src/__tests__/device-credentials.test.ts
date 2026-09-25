jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly',
}));

import {
  clearDeviceToken,
  loadStoredConnection,
  saveDeviceToken,
} from '@/storage/device-credentials';

const mockSecureStore = jest.requireMock('expo-secure-store') as {
  getItemAsync: jest.Mock;
  setItemAsync: jest.Mock;
  deleteItemAsync: jest.Mock;
};

describe('device credentials', () => {
  beforeEach(() => jest.clearAllMocks());

  it('loads the device token from SecureStore', async () => {
    mockSecureStore.getItemAsync.mockResolvedValue('secret-device-token');
    await expect(loadStoredConnection()).resolves.toEqual({ deviceToken: 'secret-device-token' });
    expect(mockSecureStore.getItemAsync).toHaveBeenCalledWith('claude-chat.device-token');
  });

  it('returns a null device token when nothing is stored', async () => {
    mockSecureStore.getItemAsync.mockResolvedValue(null);
    await expect(loadStoredConnection()).resolves.toEqual({ deviceToken: null });
  });

  it('writes the device token and removes the legacy api key', async () => {
    mockSecureStore.setItemAsync.mockResolvedValue(undefined);
    mockSecureStore.deleteItemAsync.mockResolvedValue(undefined);
    await saveDeviceToken('secret-device-token');
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith(
      'claude-chat.device-token',
      'secret-device-token',
      { keychainAccessible: 'whenUnlockedThisDeviceOnly' },
    );
    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith('claude-chat.api-key');
  });

  it('clears current and legacy credentials from SecureStore', async () => {
    mockSecureStore.deleteItemAsync.mockResolvedValue(undefined);
    await clearDeviceToken();
    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith('claude-chat.device-token');
    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith('claude-chat.api-key');
  });
});
