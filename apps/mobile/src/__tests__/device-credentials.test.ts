jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
  },
}));
jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly',
}));

import { loadStoredConnection, savePairedConnection } from '@/storage/device-credentials';

const mockAsyncStorage = jest.requireMock('@react-native-async-storage/async-storage').default as {
  getItem: jest.Mock;
  setItem: jest.Mock;
};
const mockSecureStore = jest.requireMock('expo-secure-store') as {
  getItemAsync: jest.Mock;
  setItemAsync: jest.Mock;
  deleteItemAsync: jest.Mock;
};

describe('device credentials', () => {
  beforeEach(() => jest.clearAllMocks());

  it('loads the address and token from separate storage backends', async () => {
    mockAsyncStorage.getItem.mockResolvedValue('http://192.168.1.20:4310');
    mockSecureStore.getItemAsync.mockResolvedValue('secret-token');
    await expect(loadStoredConnection()).resolves.toEqual({
      gatewayUrl: 'http://192.168.1.20:4310',
      token: 'secret-token',
    });
  });

  it('writes the token only to SecureStore', async () => {
    mockSecureStore.setItemAsync.mockResolvedValue(undefined);
    mockAsyncStorage.setItem.mockResolvedValue(undefined);
    await savePairedConnection('http://192.168.1.20:4310', 'secret-token');
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith(
      'claude-chat.device-token',
      'secret-token',
      { keychainAccessible: 'whenUnlockedThisDeviceOnly' },
    );
    expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
      'claude-chat.gateway-url',
      'http://192.168.1.20:4310',
    );
    expect(mockAsyncStorage.setItem).not.toHaveBeenCalledWith(expect.anything(), 'secret-token');
  });

  it('rolls back the secure token when address persistence fails', async () => {
    mockSecureStore.setItemAsync.mockResolvedValue(undefined);
    mockAsyncStorage.setItem.mockRejectedValue(new Error('disk full'));
    await expect(savePairedConnection('http://192.168.1.20:4310', 'secret-token')).rejects.toThrow(
      'disk full',
    );
    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith('claude-chat.device-token');
  });
});
