import { taskIdFromNotificationData } from '@/notifications/notification-routing';

describe('scheduled notification routing', () => {
  it('extracts only a non-empty task id', () => {
    expect(taskIdFromNotificationData({ taskId: 'task-1', runId: 'run-1' })).toBe('task-1');
    expect(taskIdFromNotificationData({ taskId: '' })).toBeNull();
    expect(taskIdFromNotificationData({ taskId: 1 })).toBeNull();
    expect(taskIdFromNotificationData(null)).toBeNull();
  });
});
