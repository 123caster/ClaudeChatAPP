import type { AttachmentSummary } from '@claude-chat/protocol';
import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet, View as MockView } from 'react-native';

import { GatewayClient } from '@/api/gateway-client';
import { MessageAttachments } from '@/components/chat/MessageAttachments';

jest.mock('expo-image', () => ({
  Image: ({ testID, ...props }: { testID?: string }) => <MockView testID={testID} {...props} />,
}));

jest.mock('expo-symbols', () => ({
  SymbolView: () => null,
}));

const imageAttachment: AttachmentSummary = {
  createdAt: '2026-09-16T00:00:00.000Z',
  id: '10000000-0000-4000-8000-000000000004',
  kind: 'image',
  mimeType: 'image/jpeg',
  name: 'photo.jpg',
  previewAvailable: true,
  size: 1024,
  status: 'ready',
};

describe('MessageAttachments', () => {
  const client = {
    attachmentPreviewSource: jest.fn(() => ({
      headers: { Authorization: 'Bearer device-token' },
      uri: 'https://gateway.example.com/v1/attachments/image/preview',
    })),
  } as unknown as GatewayClient;

  beforeEach(() => jest.clearAllMocks());

  it('keeps image messages in a fixed compact frame', async () => {
    const screen = await render(
      <MessageAttachments apiKey="device-token" attachments={[imageAttachment]} client={client} />,
    );

    expect(StyleSheet.flatten(screen.getByTestId('message-image-frame').props.style)).toMatchObject(
      {
        height: 98,
        width: 132,
      },
    );
  });

  it('opens a contain-mode full-screen preview and closes it from the backdrop', async () => {
    const screen = await render(
      <MessageAttachments apiKey="device-token" attachments={[imageAttachment]} client={client} />,
    );

    await fireEvent.press(screen.getByRole('button', { name: '查看图片 photo.jpg' }));

    expect(screen.getByTestId('full-screen-image').props.contentFit).toBe('contain');
    expect(screen.getByRole('button', { name: '关闭图片预览' })).toBeTruthy();

    await fireEvent.press(screen.getByTestId('image-preview-backdrop'));
    expect(screen.queryByTestId('full-screen-image')).toBeNull();
  });

  it('keeps the frame stable and offers retry after an image load error', async () => {
    const screen = await render(
      <MessageAttachments apiKey="device-token" attachments={[imageAttachment]} client={client} />,
    );

    await fireEvent(screen.getByTestId('message-image-content'), 'error');

    const frame = screen.getByTestId('message-image-frame');
    expect(StyleSheet.flatten(frame.props.style)).toMatchObject({ height: 98, width: 132 });
    expect(screen.getByText('重新加载')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: '重新加载图片 photo.jpg' }));
    expect(screen.getByTestId('message-image-content')).toBeTruthy();
  });
});
