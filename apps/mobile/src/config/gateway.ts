export const GATEWAY_CONFIGURATION_ERROR =
  '未配置服务器地址。请在本地构建环境中设置 EXPO_PUBLIC_GATEWAY_URL。';

export function resolveGatewayUrl(value: string | undefined): string {
  const candidate = value?.trim();
  if (!candidate) return '';

  try {
    const url = new URL(candidate);
    if (
      url.protocol !== 'https:' ||
      !url.hostname ||
      url.username ||
      url.password ||
      (url.pathname !== '/' && url.pathname !== '') ||
      url.search ||
      url.hash
    ) {
      return '';
    }
    return `${url.protocol}//${url.host}`;
  } catch {
    return '';
  }
}

export const GATEWAY_URL = resolveGatewayUrl(process.env.EXPO_PUBLIC_GATEWAY_URL);
