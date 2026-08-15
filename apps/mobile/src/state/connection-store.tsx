import { PROTOCOL_VERSION, type HealthResponse } from '@claude-chat/protocol';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import { GatewayClient, GatewayRequestError, connectionErrorMessage } from '@/api/gateway-client';
import { GATEWAY_URL } from '@/config/gateway';
import { clearEventCursor } from '@/storage/event-cursor';
import { clearApiKey, loadStoredConnection, saveApiKey } from '@/storage/device-credentials';

export type ConnectionPhase = 'hydrating' | 'unpaired' | 'connecting' | 'connected' | 'offline';

type ConnectionState = {
  phase: ConnectionPhase;
  gatewayUrl: string;
  apiKey: string | null;
  health: HealthResponse | null;
  error: string | null;
  connect: (apiKey: string) => Promise<void>;
  retry: () => Promise<void>;
  resetConnection: (message?: string) => Promise<void>;
  setTransportOnline: (online: boolean) => void;
};

const ConnectionContext = createContext<ConnectionState | null>(null);

export function ConnectionProvider({ children }: PropsWithChildren) {
  const [phase, setPhase] = useState<ConnectionPhase>('hydrating');
  const [gatewayUrl] = useState(GATEWAY_URL);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const validateStoredConnection = useCallback(async (storedApiKey: string) => {
    try {
      const client = new GatewayClient(GATEWAY_URL);
      const [healthResponse] = await Promise.all([
        client.connect(storedApiKey),
        client.sessions(storedApiKey),
      ]);
      if (healthResponse.protocolVersion !== PROTOCOL_VERSION) {
        throw new GatewayRequestError('PROTOCOL_ERROR', 'Protocol version mismatch.', null);
      }
      setHealth(healthResponse);
      setPhase('connected');
      setError(null);
    } catch (caught) {
      if (caught instanceof GatewayRequestError && caught.code === 'UNAUTHORIZED') {
        await Promise.all([clearApiKey(), clearEventCursor()]);
        setApiKey(null);
        setPhase('unpaired');
      } else {
        setPhase('offline');
      }
      setError(connectionErrorMessage(caught));
    }
  }, []);

  useEffect(() => {
    void loadStoredConnection()
      .then(async (stored) => {
        const key = stored.apiKey ?? '';
        setApiKey(stored.apiKey);
        if (!key) {
          setPhase('unpaired');
          return;
        }
        await validateStoredConnection(key);
      })
      .catch(() => {
        setPhase('unpaired');
        setError('无法读取本机保存的连接信息。');
      });
  }, [validateStoredConnection]);

  const connect = useCallback(async (key: string) => {
    const trimmed = key.trim();
    if (!trimmed) throw new Error('请输入 API Key');
    setPhase('connecting');
    setError(null);
    try {
      const client = new GatewayClient(GATEWAY_URL);
      const healthResponse = await client.connect(trimmed);
      if (healthResponse.protocolVersion !== PROTOCOL_VERSION) {
        throw new GatewayRequestError('PROTOCOL_ERROR', 'Protocol version mismatch.', null);
      }
      await saveApiKey(trimmed);
      setApiKey(trimmed);
      setHealth(healthResponse);
      setPhase('connected');
    } catch (caught) {
      setPhase('unpaired');
      setError(connectionErrorMessage(caught));
      throw caught;
    }
  }, []);

  const retry = useCallback(async () => {
    if (!apiKey) {
      setPhase('unpaired');
      return;
    }
    setPhase('hydrating');
    await validateStoredConnection(apiKey);
  }, [apiKey, validateStoredConnection]);

  const resetConnection = useCallback(async (message?: string) => {
    await Promise.all([clearApiKey(), clearEventCursor()]);
    setApiKey(null);
    setHealth(null);
    setPhase('unpaired');
    setError(message ?? null);
  }, []);

  const setTransportOnline = useCallback(
    (online: boolean) => {
      if (!apiKey) return;
      setPhase(online ? 'connected' : 'offline');
    },
    [apiKey],
  );

  const value = useMemo(
    () => ({
      phase,
      gatewayUrl,
      apiKey,
      health,
      error,
      connect,
      retry,
      resetConnection,
      setTransportOnline,
    }),
    [phase, gatewayUrl, apiKey, health, error, connect, retry, resetConnection, setTransportOnline],
  );

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

export function useConnection(): ConnectionState {
  const context = useContext(ConnectionContext);
  if (!context) throw new Error('useConnection must be used inside ConnectionProvider.');
  return context;
}
