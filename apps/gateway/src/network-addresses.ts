import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

type Interfaces = NodeJS.Dict<NetworkInterfaceInfo[]>;

export function gatewayUrls(
  host: string,
  port: number,
  interfaces: Interfaces = networkInterfaces(),
): string[] {
  if (host !== '0.0.0.0' && host !== '::') {
    return [formatUrl(host, port)];
  }

  const addresses = Object.values(interfaces)
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);
  return [...new Set(addresses)].sort().map((address) => formatUrl(address, port));
}

function formatUrl(host: string, port: number): string {
  const formattedHost = host.includes(':') ? `[${host}]` : host;
  return `http://${formattedHost}:${port}`;
}
