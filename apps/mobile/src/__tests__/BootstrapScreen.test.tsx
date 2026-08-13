import { render } from '@testing-library/react-native';

import { BootstrapScreen } from '@/screens/BootstrapScreen';

describe('BootstrapScreen', () => {
  it('shows the Gateway bootstrap state and protocol version', async () => {
    const screen = await render(<BootstrapScreen />);

    expect(screen.getByText('Claude')).toBeTruthy();
    expect(screen.getByText('本机 Gateway 尚未连接')).toBeTruthy();
    expect(screen.getByText('协议版本 1')).toBeTruthy();
  });
});
