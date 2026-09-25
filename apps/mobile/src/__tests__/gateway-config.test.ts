import { resolveGatewayUrl } from '@/config/gateway';

describe('gateway configuration', () => {
  it('normalizes an HTTPS root URL', () => {
    expect(resolveGatewayUrl('  https://gateway.example.com/  ')).toBe(
      'https://gateway.example.com',
    );
  });

  it.each([
    undefined,
    '',
    'http://gateway.example.com',
    'https://user:password@gateway.example.com',
    'https://gateway.example.com/api',
    'https://gateway.example.com?token=value',
    'not-a-url',
  ])('rejects an unsafe or invalid value: %s', (value) => {
    expect(resolveGatewayUrl(value)).toBe('');
  });
});
