export function taskIdFromNotificationData(data: unknown): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const taskId = (data as { taskId?: unknown }).taskId;
  return typeof taskId === 'string' && taskId.trim() ? taskId : null;
}
