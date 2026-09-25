import NetInfo from '@react-native-community/netinfo';
import type {
  CreateProjectRequest,
  CreateSessionRequest,
  EventEnvelope,
  ProjectSummary,
  SessionSummary,
} from '@claude-chat/protocol';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';

import { EventClient } from '@/api/event-client';
import { GatewayClient, GatewayRequestError, createRequestId } from '@/api/gateway-client';
import { loadEventCursor, saveEventCursor } from '@/storage/event-cursor';
import { useConnection } from '@/state/connection-store';
import { mergeSession, sortSessions } from '@/state/session-list';

type SessionState = {
  sessions: SessionSummary[];
  projects: ProjectSummary[];
  loading: boolean;
  error: string | null;
  eventState: 'idle' | 'connecting' | 'open' | 'closed';
  refresh: () => Promise<void>;
  create: (
    projectId: string,
    message: string,
    requestId?: string,
    workingDirectory?: string | null,
    attachmentIds?: string[],
  ) => Promise<string>;
  createProject: (
    displayName: string,
    parentProjectId: string,
    folderName: string,
  ) => Promise<ProjectSummary>;
  removeProject: (projectId: string) => Promise<void>;
  rename: (sessionId: string, title: string) => Promise<void>;
  archive: (sessionId: string) => Promise<void>;
  remove: (sessionId: string) => Promise<void>;
  subscribe: (listener: (event: EventEnvelope) => void) => () => void;
};

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const { gatewayUrl, deviceToken, resetConnection, setTransportOnline } = useConnection();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventState, setEventState] = useState<SessionState['eventState']>('idle');
  const eventClientRef = useRef<EventClient | null>(null);
  const persistedEventIdRef = useRef(0);
  const eventListenersRef = useRef(new Set<(event: EventEnvelope) => void>());

  const handleUnauthorized = useCallback(async () => {
    await resetConnection('设备授权已失效，请重新配对。');
  }, [resetConnection]);

  const refresh = useCallback(async () => {
    if (!gatewayUrl || !deviceToken) return;
    setLoading(true);
    try {
      const client = new GatewayClient(gatewayUrl);
      const [nextSessions, nextProjects] = await Promise.all([
        client.sessions(deviceToken),
        client.projects(deviceToken),
      ]);
      setSessions(sortSessions(nextSessions));
      setProjects(nextProjects);
      setError(null);
      setTransportOnline(true);
    } catch (caught) {
      if (caught instanceof GatewayRequestError && caught.code === 'UNAUTHORIZED') {
        await handleUnauthorized();
      } else {
        setError('无法刷新电脑上的会话。');
        setTransportOnline(false);
      }
    } finally {
      setLoading(false);
    }
  }, [gatewayUrl, deviceToken, handleUnauthorized, setTransportOnline]);

  const handleEvent = useCallback((event: EventEnvelope) => {
    // Deltas are transient and may reuse an event id. Resume only from durable events.
    if (event.type === 'session.snapshot') {
      persistedEventIdRef.current = Math.max(
        persistedEventIdRef.current,
        event.payload.currentEventId,
      );
      void saveEventCursor(persistedEventIdRef.current);
    } else if (
      event.type !== 'assistant.delta' &&
      event.type !== 'connection.ready' &&
      event.eventId > persistedEventIdRef.current
    ) {
      persistedEventIdRef.current = event.eventId;
      void saveEventCursor(event.eventId);
    }
    if (event.type === 'session.snapshot') {
      setSessions(sortSessions(event.payload.sessions));
    } else if (event.type === 'session.created' || event.type === 'session.updated') {
      setSessions((current) => mergeSession(current, event.payload.session));
    } else if (event.type === 'session.deleted') {
      setSessions((current) => current.filter(({ id }) => id !== event.payload.sessionId));
    } else if (event.type === 'turn.completed' || event.type === 'turn.failed') {
      setSessions((current) => mergeSession(current, event.payload.session));
    }
    eventListenersRef.current.forEach((listener) => listener(event));
  }, []);

  const subscribe = useCallback((listener: (event: EventEnvelope) => void) => {
    eventListenersRef.current.add(listener);
    return () => {
      eventListenersRef.current.delete(listener);
    };
  }, []);

  useEffect(() => {
    eventClientRef.current?.stop();
    eventClientRef.current = null;
    setEventState('idle');
    if (!gatewayUrl || !deviceToken) {
      setSessions([]);
      setProjects([]);
      return;
    }

    const client = new EventClient(gatewayUrl, deviceToken, {
      onEvent: handleEvent,
      onStateChange: (state) => {
        setEventState(state);
        setTransportOnline(state === 'open');
      },
    });
    eventClientRef.current = client;
    void loadEventCursor().then((cursor) => {
      persistedEventIdRef.current = cursor;
      client.start(cursor);
    });
    void refresh();

    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        client.reconnectNow();
        void refresh();
      }
    });
    const network = NetInfo.addEventListener((state) => {
      if (state.isConnected) {
        client.reconnectNow();
        void refresh();
      } else {
        setTransportOnline(false);
      }
    });
    return () => {
      appState.remove();
      network();
      client.stop();
    };
  }, [gatewayUrl, deviceToken, handleEvent, refresh, setTransportOnline]);

  const create = useCallback(
    async (
      projectId: string,
      message: string,
      requestId = createRequestId(),
      workingDirectory: string | null = null,
      attachmentIds: string[] = [],
    ) => {
      if (!gatewayUrl || !deviceToken) throw new Error('Gateway is not connected.');
      const request: CreateSessionRequest = {
        requestId,
        projectId,
        message: message.trim(),
        ...(workingDirectory ? { workingDirectory } : {}),
        ...(attachmentIds.length ? { attachmentIds } : {}),
      };
      const response = await new GatewayClient(gatewayUrl).createSession(deviceToken, request);
      setSessions((current) => mergeSession(current, response.session));
      return response.session.id;
    },
    [gatewayUrl, deviceToken],
  );

  const archive = useCallback(
    async (sessionId: string) => {
      if (!gatewayUrl || !deviceToken) throw new Error('Gateway is not connected.');
      await new GatewayClient(gatewayUrl).archiveSession(deviceToken, sessionId, createRequestId());
      setSessions((current) => current.filter(({ id }) => id !== sessionId));
    },
    [gatewayUrl, deviceToken],
  );

  const rename = useCallback(
    async (sessionId: string, title: string) => {
      if (!gatewayUrl || !deviceToken) throw new Error('Gateway is not connected.');
      const response = await new GatewayClient(gatewayUrl).renameSession(
        deviceToken,
        sessionId,
        title.trim(),
        createRequestId(),
      );
      setSessions((current) => mergeSession(current, response.session));
    },
    [gatewayUrl, deviceToken],
  );

  const remove = useCallback(
    async (sessionId: string) => {
      if (!gatewayUrl || !deviceToken) throw new Error('Gateway is not connected.');
      await new GatewayClient(gatewayUrl).deleteSession(deviceToken, sessionId, createRequestId());
      setSessions((current) => current.filter(({ id }) => id !== sessionId));
    },
    [gatewayUrl, deviceToken],
  );

  const removeProject = useCallback(
    async (projectId: string) => {
      if (!gatewayUrl || !deviceToken) throw new Error('Gateway is not connected.');
      await new GatewayClient(gatewayUrl).deleteProject(deviceToken, projectId, createRequestId());
      setProjects((current) => current.filter(({ id }) => id !== projectId));
    },
    [gatewayUrl, deviceToken],
  );

  const createProject = useCallback(
    async (displayName: string, parentProjectId: string, folderName: string) => {
      if (!gatewayUrl || !deviceToken) throw new Error('Gateway is not connected.');
      const request: CreateProjectRequest = {
        requestId: createRequestId(),
        displayName: displayName.trim(),
        parentProjectId,
        folderName: folderName.trim(),
      };
      const response = await new GatewayClient(gatewayUrl).createProject(deviceToken, request);
      setProjects((current) => [...current, response.project]);
      return response.project;
    },
    [gatewayUrl, deviceToken],
  );

  const value = useMemo(
    () => ({
      sessions,
      projects,
      loading,
      error,
      eventState,
      refresh,
      create,
      createProject,
      removeProject,
      rename,
      archive,
      remove,
      subscribe,
    }),
    [
      sessions,
      projects,
      loading,
      error,
      eventState,
      refresh,
      create,
      createProject,
      removeProject,
      rename,
      archive,
      remove,
      subscribe,
    ],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSessions(): SessionState {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSessions must be used inside SessionProvider.');
  return context;
}
