import type {
  CreateScheduledTaskRequest,
  EventEnvelope,
  ScheduledTask,
  UpdateScheduledTaskRequest,
} from '@claude-chat/protocol';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { createRequestId, GatewayClient, GatewayRequestError } from '@/api/gateway-client';
import { useConnection } from '@/state/connection-store';
import { mergeScheduledTask } from '@/state/scheduled-task-state';
import { useSessions } from '@/state/session-store';

type ScheduledTaskState = {
  tasks: ScheduledTask[];
  pushStatus: 'disabled' | 'ready' | 'error' | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  create: (input: Omit<CreateScheduledTaskRequest, 'requestId'>) => Promise<ScheduledTask>;
  update: (
    taskId: string,
    input: Omit<UpdateScheduledTaskRequest, 'requestId'>,
  ) => Promise<ScheduledTask>;
  runNow: (taskId: string) => Promise<void>;
  markRead: (taskId: string) => Promise<void>;
  remove: (taskId: string) => Promise<void>;
};

const ScheduledTaskContext = createContext<ScheduledTaskState | null>(null);

export function ScheduledTaskProvider({ children }: PropsWithChildren) {
  const connection = useConnection();
  const { subscribe } = useSessions();
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [pushStatus, setPushStatus] = useState<ScheduledTaskState['pushStatus']>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const client = useCallback(() => {
    if (!connection.gatewayUrl || !connection.deviceToken) {
      throw new Error('Gateway is not connected.');
    }
    return {
      api: new GatewayClient(connection.gatewayUrl),
      token: connection.deviceToken,
    };
  }, [connection.deviceToken, connection.gatewayUrl]);

  const refresh = useCallback(async () => {
    if (!connection.gatewayUrl || !connection.deviceToken) return;
    setLoading(true);
    try {
      const api = new GatewayClient(connection.gatewayUrl);
      const [nextTasks, health] = await Promise.all([
        api.scheduledTasks(connection.deviceToken),
        api.health(connection.deviceToken),
      ]);
      setTasks(nextTasks);
      setPushStatus(health.push?.status ?? 'disabled');
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof GatewayRequestError && caught.code === 'UNAUTHORIZED'
          ? '设备授权已失效。'
          : '无法加载定时任务。',
      );
    } finally {
      setLoading(false);
    }
  }, [connection.deviceToken, connection.gatewayUrl]);

  useEffect(() => {
    if (!connection.deviceToken) {
      setTasks([]);
      setPushStatus(null);
      return;
    }
    void refresh();
    return subscribe((event: EventEnvelope) => {
      if (event.type === 'scheduled-task.created' || event.type === 'scheduled-task.updated') {
        setTasks((current) => mergeScheduledTask(current, event.payload.task));
      } else if (event.type === 'scheduled-task.deleted') {
        setTasks((current) => current.filter(({ id }) => id !== event.payload.taskId));
      } else if (
        event.type === 'scheduled-run.needs-attention' ||
        event.type === 'scheduled-run.updated'
      ) {
        void refresh();
      }
    });
  }, [connection.deviceToken, refresh, subscribe]);

  const create = useCallback(
    async (input: Omit<CreateScheduledTaskRequest, 'requestId'>) => {
      const { api, token } = client();
      const response = await api.createScheduledTask(token, {
        ...input,
        requestId: createRequestId(),
      });
      setTasks((current) => mergeScheduledTask(current, response.task));
      return response.task;
    },
    [client],
  );

  const update = useCallback(
    async (taskId: string, input: Omit<UpdateScheduledTaskRequest, 'requestId'>) => {
      const { api, token } = client();
      const response = await api.updateScheduledTask(token, taskId, {
        ...input,
        requestId: createRequestId(),
      });
      setTasks((current) => mergeScheduledTask(current, response.task));
      return response.task;
    },
    [client],
  );

  const runNow = useCallback(
    async (taskId: string) => {
      const { api, token } = client();
      await api.runScheduledTask(token, taskId, createRequestId());
      await refresh();
    },
    [client, refresh],
  );

  const markRead = useCallback(
    async (taskId: string) => {
      const { api, token } = client();
      const response = await api.markScheduledTaskRead(token, taskId, createRequestId());
      setTasks((current) => mergeScheduledTask(current, response.task));
    },
    [client],
  );

  const remove = useCallback(
    async (taskId: string) => {
      const { api, token } = client();
      await api.deleteScheduledTask(token, taskId, createRequestId());
      setTasks((current) => current.filter(({ id }) => id !== taskId));
    },
    [client],
  );

  const value = useMemo(
    () => ({
      tasks,
      pushStatus,
      loading,
      error,
      refresh,
      create,
      update,
      runNow,
      markRead,
      remove,
    }),
    [tasks, pushStatus, loading, error, refresh, create, update, runNow, markRead, remove],
  );
  return <ScheduledTaskContext.Provider value={value}>{children}</ScheduledTaskContext.Provider>;
}

export function useScheduledTasks(): ScheduledTaskState {
  const context = useContext(ScheduledTaskContext);
  if (!context) throw new Error('useScheduledTasks must be used inside ScheduledTaskProvider.');
  return context;
}
