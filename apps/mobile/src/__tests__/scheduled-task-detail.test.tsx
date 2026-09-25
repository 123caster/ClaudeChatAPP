import type { ScheduledTask } from '@claude-chat/protocol';
import { render, waitFor } from '@testing-library/react-native';

import { GatewayClient } from '@/api/gateway-client';
import { ScheduledTaskDetailScreen } from '@/screens/ScheduledTaskDetailScreen';
import { useConnection } from '@/state/connection-store';
import { useScheduledTasks } from '@/state/scheduled-task-store';
import { useSessions } from '@/state/session-store';

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
}));
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));
jest.mock('@/state/connection-store', () => ({ useConnection: jest.fn() }));
jest.mock('@/state/scheduled-task-store', () => ({ useScheduledTasks: jest.fn() }));
jest.mock('@/state/session-store', () => ({ useSessions: jest.fn() }));

const task: ScheduledTask = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'GitHub 日报',
  prompt: '每天输出 GitHub Java AI 项目榜单',
  status: 'active',
  triggerType: 'time',
  schedule: { kind: 'daily', hour: 9, minute: 0 },
  timeZone: 'Asia/Shanghai',
  nextRunAt: '2026-09-19T01:00:00.000Z',
  lastRunAt: null,
  sessionId: '22222222-2222-4222-8222-222222222222',
  projectId: 'home',
  workingDirectory: null,
  modelId: null,
  allowAutoWrite: false,
  notificationPolicy: 'all_results',
  unreadCount: 0,
  needsAttention: false,
  createdAt: '2026-09-17T01:00:00.000Z',
  updatedAt: '2026-09-17T01:00:00.000Z',
  deletedAt: null,
};

describe('ScheduledTaskDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(GatewayClient.prototype, 'scheduledTask').mockResolvedValue({ task, runs: [] });
    jest.mocked(useConnection).mockReturnValue({
      phase: 'connected',
      gatewayUrl: 'https://gateway.example.com',
      deviceToken: 'device-token',
    } as ReturnType<typeof useConnection>);
    jest.mocked(useScheduledTasks).mockReturnValue({
      tasks: [task],
      pushStatus: 'disabled',
      loading: false,
      error: null,
      refresh: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      runNow: jest.fn(),
      markRead: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn(),
    });
    jest.mocked(useSessions).mockReturnValue({
      subscribe: jest.fn(() => jest.fn()),
    } as unknown as ReturnType<typeof useSessions>);
  });

  it('keeps a delete action visible in the task header', async () => {
    const screen = await render(<ScheduledTaskDetailScreen taskId={task.id} />);

    await waitFor(() => expect(screen.getByRole('button', { name: '删除定时任务' })).toBeTruthy());
  });
});
