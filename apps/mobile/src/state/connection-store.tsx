import { PROTOCOL_VERSION, type HealthResponse } from '@claude-chat/protocol';
import * as Device from 'expo-device';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import {
  GatewayClient,
  GatewayRequestError,
  connectionErrorMessage,
  normalizeGatewayUrl,
} from '@/api/gateway-client';
import { clearEventCursor } from '@/storage/event-cursor';
import {
  clearDeviceToken,
  loadStoredConnection,
  saveGatewayUrl,
  savePairedConnection,
} from '@/storage/device-credentials';

export type ConnectionPhase = 'hydrating' | 'unpaired' | 'pairing' | 'connected' | 'offline';

type ConnectionState = {
  phase: ConnectionPhase;
  gatewayUrl: string;
  token: string | null;
  health: HealthResponse | null;
  error: string | null;
  pair: (gatewayUrl: string, code: string, apiKey?: string) => Promise<void>;
  retry: () => Promise<void>;
  resetPairing: (message?: string) => Promise<void>;
  setTransportOnline: (online: boolean) => void;
};

const ConnectionContext = createContext<ConnectionState | null>(null);

function defaultDeviceName(): string {
  return Device.deviceName?.trim() || Device.modelName?.trim() || 'Android phone';
}

export function ConnectionProvider({ children }: PropsWithChildren) {
  const [phase, setPhase] = useState<ConnectionPhase>('hydrating');
  const [gatewayUrl, setGatewayUrl] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const validateStoredConnection = useCallback(async (url: string, storedToken: string) => {
    try {
      const client = new GatewayClient(url);
      const [healthResponse] = await Promise.all([client.health(), client.sessions(storedToken)]);
      if (healthResponse.protocolVersion !== PROTOCOL_VERSION) {
        throw new GatewayRequestError('PROTOCOL_ERROR', 'Protocol version mismatch.', null);
      }
      setHealth(healthResponse);
      setPhase('connected');
      setError(null);
    } catch (caught) {
      if (caught instanceof GatewayRequestError && caught.code === 'UNAUTHORIZED') {
        await Promise.all([clearDeviceToken(), clearEventCursor()]);
        setToken(null);
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
        const url = stored.gatewayUrl ?? '';
        setGatewayUrl(url);
        setToken(stored.token);
        if (!url || !stored.token) {
          setPhase('unpaired');
          return;
        }
        await validateStoredConnection(url, stored.token);
      })
      .catch(() => {
        setPhase('unpaired');
        setError('无法读取本机保存的连接信息。');
      });
  }, [validateStoredConnection]);

  const pair = useCallback(async (inputUrl: string, code: string, apiKey?: string) => {
    const normalized = normalizeGatewayUrl(inputUrl);
    if (!/^\d{6}$/.test(code)) throw new Error('请输入 6 位配对码');
    setPhase('pairing');
    setError(null);
    setGatewayUrl(normalized);
    await saveGatewayUrl(normalized);
    try {
      const client = new GatewayClient(normalized);
      const healthResponse = await client.health();
      if (healthResponse.protocolVersion !== PROTOCOL_VERSION) {
        throw new GatewayRequestError('PROTOCOL_ERROR', 'Protocol version mismatch.', null);
      }
      const paired = await client.pair(code, defaultDeviceName(), apiKey);
      await savePairedConnection(normalized, paired.token);
      setToken(paired.token);
      setHealth(healthResponse);
      setPhase('connected');
    } catch (caught) {
      setPhase('unpaired');
      setError(connectionErrorMessage(caught));
      throw caught;
    }
  }, []);

  const retry = useCallback(async () => {
    if (!gatewayUrl || !token) {
      setPhase('unpaired');
      return;
    }
    setPhase('hydrating');
    await validateStoredConnection(gatewayUrl, token);
  }, [gatewayUrl, token, validateStoredConnection]);

  const resetPairing = useCallback(async (message?: string) => {
    await Promise.all([clearDeviceToken(), clearEventCursor()]);
    setToken(null);
    setHealth(null);
    setPhase('unpaired');
    setError(message ?? null);
  }, []);

  const setTransportOnline = useCallback(
    (online: boolean) => {
      if (!token) return;
      setPhase(online ? 'connected' : 'offline');
    },
    [token],
  );

  const value = useMemo(
    () => ({
      phase,
      gatewayUrl,
      token,
      health,
      error,
      pair,
      retry,
      resetPairing,
      setTransportOnline,
    }),
    [phase, gatewayUrl, token, health, error, pair, retry, resetPairing, setTransportOnline],
  );

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

export function useConnection(): ConnectionState {
  const context = useContext(ConnectionContext);
  if (!context) throw new Error('useConnection must be used inside ConnectionProvider.');
  return context;
}
