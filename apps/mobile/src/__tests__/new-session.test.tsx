import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';

import { GatewayClient } from '@/api/gateway-client';
import { NewSessionScreen } from '@/screens/NewSessionScreen';
import { useConnection } from '@/state/connection-store';
import { useSessions } from '@/state/session-store';

const mockCreate = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    back: jest.fn(),
    replace: jest.fn(),
  },
}));

jest.mock('@/state/connection-store', () => ({ useConnection: jest.fn() }));
jest.mock('@/state/session-store', () => ({ useSessions: jest.fn() }));
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
}));

describe('new session working directory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(useConnection).mockReturnValue({
      phase: 'connected',
      gatewayUrl: 'https://gateway.example.com',
      deviceToken: 'device-token',
    } as ReturnType<typeof useConnection>);
    jest.mocked(useSessions).mockReturnValue({
      sessions: [],
      projects: [
        {
          id: 'home-project',
          displayName: 'home',
          rootPath: '/home/ubuntu',
          origin: 'config',
        },
      ],
      loading: false,
      error: null,
      eventState: 'open',
      create: mockCreate,
      createProject: jest.fn(),
      removeProject: jest.fn(),
      rename: jest.fn(),
      archive: jest.fn(),
      remove: jest.fn(),
      refresh: jest.fn(),
      subscribe: jest.fn(),
    } as ReturnType<typeof useSessions>);
    mockCreate.mockResolvedValue('session-1');
  });

  it('selects a project child directory and includes it when creating the session', async () => {
    const listDirectoryAt = jest
      .spyOn(GatewayClient.prototype, 'listDirectoryAt')
      .mockResolvedValueOnce([
        {
          name: 'myclaude',
          path: '/home/ubuntu/myclaude',
          relativePath: 'myclaude',
          isDirectory: true,
        },
      ])
      .mockResolvedValueOnce([]);
    const screen = await render(<NewSessionScreen />);

    expect(screen.getByText('工作目录')).toBeTruthy();
    await fireEvent.press(screen.getByText('工作目录'));

    await waitFor(() => expect(screen.getByText('myclaude')).toBeTruthy());
    await fireEvent.press(screen.getByText('myclaude'));
    await waitFor(() =>
      expect(listDirectoryAt).toHaveBeenLastCalledWith('device-token', 'home-project', 'myclaude'),
    );
    await fireEvent.press(screen.getByText('使用当前目录'));

    expect(screen.getByText('myclaude')).toBeTruthy();
    await fireEvent.changeText(
      screen.getByPlaceholderText('描述你想让 Claude 完成的任务'),
      '检查代码',
    );
    await fireEvent.press(screen.getByText('创建会话'));

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(
        'home-project',
        '检查代码',
        expect.any(String),
        'myclaude',
        [],
      ),
    );
  });

  it('uploads selected images and includes their IDs in the create request', async () => {
    jest.mocked(ImagePicker.requestMediaLibraryPermissionsAsync).mockResolvedValue({
      granted: true,
    } as Awaited<ReturnType<typeof ImagePicker.requestMediaLibraryPermissionsAsync>>);
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
      canceled: false,
      assets: [
        {
          uri: 'file:///photo.jpg',
          width: 1200,
          height: 900,
          fileName: 'photo.jpg',
          fileSize: 1024,
          mimeType: 'image/jpeg',
          type: 'image',
        },
      ],
    });
    const upload = jest.spyOn(GatewayClient.prototype, 'uploadAttachment').mockResolvedValue({
      id: '10000000-0000-4000-8000-000000000003',
      kind: 'image',
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      size: 1024,
      status: 'ready',
      previewAvailable: true,
      createdAt: '2026-09-14T00:00:00.000Z',
    });
    const screen = await render(<NewSessionScreen />);

    await fireEvent.press(screen.getByRole('button', { name: '添加图片或文件' }));
    await fireEvent.press(screen.getByText('从相册选择'));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    await fireEvent.changeText(
      screen.getByPlaceholderText('描述你想让 Claude 完成的任务'),
      '分析这张图片',
    );
    await fireEvent.press(screen.getByText('创建会话'));

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(
        'home-project',
        '分析这张图片',
        expect.any(String),
        null,
        ['10000000-0000-4000-8000-000000000003'],
      ),
    );
  });
});
