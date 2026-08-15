jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly',
}));

import { clearApiKey, loadStoredConnection, saveApiKey } from '@/storage/device-credentials';

const mockSecureStore = jest.requireMock('expo-secure-store') as {
  getItemAsync: jest.Mock;
  setItemAsync: jest.Mock;
  deleteItemAsync: jest.Mock;
};

describe('device credentials', () => {
  beforeEach(() => jest.clearAllMocks());

  it('loads the api key from SecureStore', async () => {
    mockSecureStore.getItemAsync.mockResolvedValue('secret-api-key');
    await expect(loadStoredConnection()).resolves.toEqual({ apiKey: 'secret-api-key' });
  });

  it('returns a null api key when nothing is stored', async () => {
    mockSecureStore.getItemAsync.mockResolvedValue(null);
    await expect(loadStoredConnection()).resolves.toEqual({ apiKey: null });
  });

  it('writes the api key only to SecureStore', async () => {
    mockSecureStore.setItemAsync.mockResolvedValue(undefined);
    await saveApiKey('secret-api-key');
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith(
      'claude-chat.api-key',
      'secret-api-key',
      { keychainAccessible: 'whenUnlockedThisDeviceOnly' },
    );
  });

  it('clears the api key from SecureStore', async () => {
    mockSecureStore.deleteItemAsync.mockResolvedValue(undefined);
    await clearApiKey();
    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith('claude-chat.api-key');
  });
});
