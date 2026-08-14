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
  create: (projectId: string, message: string, requestId?: string) => Promise<string>;
  createProject: (
    displayName: string,
    parentProjectId: string,
    folderName: string,
  ) => Promise<ProjectSummary>;
  archive: (sessionId: string) => Promise<void>;
  subscribe: (listener: (event: EventEnvelope) => void) => () => void;
};

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const { gatewayUrl, token, resetPairing, setTransportOnline } = useConnection();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventState, setEventState] = useState<SessionState['eventState']>('idle');
  const eventClientRef = useRef<EventClient | null>(null);
  const persistedEventIdRef = useRef(0);
  const eventListenersRef = useRef(new Set<(event: EventEnvelope) => void>());

  const handleUnauthorized = useCallback(async () => {
    await resetPairing('设备授权已失效，请在电脑上生成新的配对码。');
  }, [resetPairing]);

  const refresh = useCallback(async () => {
    if (!gatewayUrl || !token) return;
    setLoading(true);
    try {
      const client = new GatewayClient(gatewayUrl);
      const [nextSessions, nextProjects] = await Promise.all([
        client.sessions(token),
        client.projects(token),
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
  }, [gatewayUrl, token, handleUnauthorized, setTransportOnline]);

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
    if (!gatewayUrl || !token) {
      setSessions([]);
      setProjects([]);
      return;
    }

    const client = new EventClient(gatewayUrl, token, {
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
  }, [gatewayUrl, token, handleEvent, refresh, setTransportOnline]);

  const create = useCallback(
    async (projectId: string, message: string, requestId = createRequestId()) => {
      if (!gatewayUrl || !token) throw new Error('Gateway is not connected.');
      const request: CreateSessionRequest = { requestId, projectId, message: message.trim() };
      const response = await new GatewayClient(gatewayUrl).createSession(token, request);
      setSessions((current) => mergeSession(current, response.session));
      return response.session.id;
    },
    [gatewayUrl, token],
  );

  const archive = useCallback(
    async (sessionId: string) => {
      if (!gatewayUrl || !token) throw new Error('Gateway is not connected.');
      await new GatewayClient(gatewayUrl).archiveSession(token, sessionId, createRequestId());
      setSessions((current) => current.filter(({ id }) => id !== sessionId));
    },
    [gatewayUrl, token],
  );

  const createProject = useCallback(
    async (displayName: string, parentProjectId: string, folderName: string) => {
      if (!gatewayUrl || !token) throw new Error('Gateway is not connected.');
      const request: CreateProjectRequest = {
        requestId: createRequestId(),
        displayName: displayName.trim(),
        parentProjectId,
        folderName: folderName.trim(),
      };
      const response = await new GatewayClient(gatewayUrl).createProject(token, request);
      setProjects((current) => [...current, response.project]);
      return response.project;
    },
    [gatewayUrl, token],
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
      archive,
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
      archive,
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
