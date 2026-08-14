import { normalizeGatewayUrl } from '@/api/gateway-client';

describe('normalizeGatewayUrl', () => {
  it('normalizes a trusted LAN Gateway origin', () => {
    expect(normalizeGatewayUrl('  http://192.168.1.20:4310/  ')).toBe('http://192.168.1.20:4310');
  });

  it.each([
    '192.168.1.20:4310',
    'ftp://192.168.1.20',
    'http://user:secret@192.168.1.20:4310',
    'http://192.168.1.20:4310/v1',
    'http://192.168.1.20:4310?token=secret',
  ])('rejects an unsafe or incomplete address: %s', (address) => {
    expect(() => normalizeGatewayUrl(address)).toThrow();
  });
});
