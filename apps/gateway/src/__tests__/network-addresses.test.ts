import type { NetworkInterfaceInfo } from 'node:os';

import { describe, expect, it } from 'vitest';

import { gatewayUrls } from '../network-addresses.js';

describe('gatewayUrls', () => {
  it('returns sorted unique LAN IPv4 URLs for a wildcard listener', () => {
    const lan = (address: string): NetworkInterfaceInfo => ({
      address,
      netmask: '255.255.255.0',
      family: 'IPv4',
      mac: '00:00:00:00:00:00',
      internal: false,
      cidr: `${address}/24`,
    });
    const loopback: NetworkInterfaceInfo = {
      ...lan('127.0.0.1'),
      internal: true,
    };

    expect(
      gatewayUrls('0.0.0.0', 43110, {
        Ethernet: [lan('192.168.1.20'), loopback],
        WiFi: [lan('10.0.0.5'), lan('192.168.1.20')],
      }),
    ).toEqual(['http://10.0.0.5:43110', 'http://192.168.1.20:43110']);
  });

  it('returns the configured host when the listener is not wildcard', () => {
    expect(gatewayUrls('127.0.0.1', 43110, {})).toEqual(['http://127.0.0.1:43110']);
    expect(gatewayUrls('::1', 43110, {})).toEqual(['http://[::1]:43110']);
  });
});
