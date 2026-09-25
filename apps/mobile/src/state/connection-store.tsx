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
import {
  clearDeviceToken,
  loadStoredConnection,
  saveDeviceToken,
} from '@/storage/device-credentials';

export type ConnectionPhase = 'hydrating' | 'unpaired' | 'connecting' | 'connected' | 'offline';

type ConnectionState = {
  phase: ConnectionPhase;
  gatewayUrl: string;
  deviceToken: string | null;
  health: HealthResponse | null;
  error: string | null;
  connect: (pairingCode: string) => Promise<void>;
  retry: () => Promise<void>;
  resetConnection: (message?: string) => Promise<void>;
  setTransportOnline: (online: boolean) => void;
};

const ConnectionContext = createContext<ConnectionState | null>(null);

export function ConnectionProvider({ children }: PropsWithChildren) {
  const [phase, setPhase] = useState<ConnectionPhase>('hydrating');
  const [gatewayUrl] = useState(GATEWAY_URL);
  const [deviceToken, setDeviceToken] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const validateStoredConnection = useCallback(async (storedDeviceToken: string) => {
    try {
      const client = new GatewayClient(GATEWAY_URL);
      const [healthResponse] = await Promise.all([
        client.connect(storedDeviceToken),
        client.sessions(storedDeviceToken),
      ]);
      if (healthResponse.protocolVersion !== PROTOCOL_VERSION) {
        throw new GatewayRequestError('PROTOCOL_ERROR', 'Protocol version mismatch.', null);
      }
      setHealth(healthResponse);
      setPhase('connected');
      setError(null);
    } catch (caught) {
      if (caught instanceof GatewayRequestError && caught.code === 'UNAUTHORIZED') {
        await Promise.all([clearDeviceToken(), clearEventCursor()]);
        setDeviceToken(null);
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
        const key = stored.deviceToken ?? '';
        setDeviceToken(stored.deviceToken);
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

  const connect = useCallback(async (pairingCode: string) => {
    const trimmed = pairingCode.trim();
    if (!/^\d{6}$/.test(trimmed)) throw new Error('请输入 6 位配对码');
    setPhase('connecting');
    setError(null);
    let pairedToken: string | null = null;
    try {
      const client = new GatewayClient(GATEWAY_URL);
      const paired = await client.pair(trimmed, 'Ouyang Android');
      pairedToken = paired.token;
      await saveDeviceToken(paired.token);
      setDeviceToken(paired.token);
      const [healthResponse] = await Promise.all([
        client.connect(paired.token),
        client.sessions(paired.token),
      ]);
      if (healthResponse.protocolVersion !== PROTOCOL_VERSION) {
        throw new GatewayRequestError('PROTOCOL_ERROR', 'Protocol version mismatch.', null);
      }
      setHealth(healthResponse);
      setPhase('connected');
    } catch (caught) {
      if (caught instanceof GatewayRequestError && caught.code === 'UNAUTHORIZED') {
        await clearDeviceToken();
        setDeviceToken(null);
        pairedToken = null;
      }
      setPhase(pairedToken ? 'offline' : 'unpaired');
      setError(connectionErrorMessage(caught));
      throw caught;
    }
  }, []);

  const retry = useCallback(async () => {
    if (!deviceToken) {
      setPhase('unpaired');
      return;
    }
    setPhase('hydrating');
    await validateStoredConnection(deviceToken);
  }, [deviceToken, validateStoredConnection]);

  const resetConnection = useCallback(async (message?: string) => {
    await Promise.all([clearDeviceToken(), clearEventCursor()]);
    setDeviceToken(null);
    setHealth(null);
    setPhase('unpaired');
    setError(message ?? null);
  }, []);

  const setTransportOnline = useCallback(
    (online: boolean) => {
      if (!deviceToken) return;
      setPhase(online ? 'connected' : 'offline');
    },
    [deviceToken],
  );

  const value = useMemo(
    () => ({
      phase,
      gatewayUrl,
      deviceToken,
      health,
      error,
      connect,
      retry,
      resetConnection,
      setTransportOnline,
    }),
    [
      phase,
      gatewayUrl,
      deviceToken,
      health,
      error,
      connect,
      retry,
      resetConnection,
      setTransportOnline,
    ],
  );

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

export function useConnection(): ConnectionState {
  const context = useContext(ConnectionContext);
  if (!context) throw new Error('useConnection must be used inside ConnectionProvider.');
  return context;
}
