import Constants from 'expo-constants';

export function expoPushProjectId(): string | null {
  const projectId =
    Constants.easConfig?.projectId ??
    (Constants.expoConfig?.extra?.eas as { projectId?: unknown } | undefined)?.projectId;
  return typeof projectId === 'string' && projectId.trim() ? projectId : null;
}
