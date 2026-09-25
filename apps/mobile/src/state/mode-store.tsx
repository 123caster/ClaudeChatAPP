import type { PermissionMode } from '@claude-chat/protocol';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import { GatewayClient, createRequestId } from '@/api/gateway-client';
import { useConnection } from '@/state/connection-store';

type ModeState = {
  mode: PermissionMode;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setMode: (mode: PermissionMode) => Promise<void>;
};

const ModeContext = createContext<ModeState | null>(null);

export function ModeProvider({ children }: PropsWithChildren) {
  const { gatewayUrl, deviceToken } = useConnection();
  const [mode, setModeState] = useState<PermissionMode>('default');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!gatewayUrl || !deviceToken) return;
    setLoading(true);
    try {
      setModeState(await new GatewayClient(gatewayUrl).mode(deviceToken));
      setError(null);
    } catch {
      setError('无法加载当前模式。');
    } finally {
      setLoading(false);
    }
  }, [gatewayUrl, deviceToken]);

  useEffect(() => {
    if (gatewayUrl && deviceToken) void refresh();
  }, [gatewayUrl, deviceToken, refresh]);

  const setMode = useCallback(
    async (next: PermissionMode) => {
      if (!gatewayUrl || !deviceToken) throw new Error('Gateway is not connected.');
      const updated = await new GatewayClient(gatewayUrl).setMode(
        deviceToken,
        next,
        createRequestId(),
      );
      setModeState(updated);
    },
    [gatewayUrl, deviceToken],
  );

  const value = useMemo(
    () => ({ mode, loading, error, refresh, setMode }),
    [mode, loading, error, refresh, setMode],
  );

  return <ModeContext.Provider value={value}>{children}</ModeContext.Provider>;
}

export function useMode(): ModeState {
  const context = useContext(ModeContext);
  if (!context) throw new Error('useMode must be used inside ModeProvider.');
  return context;
}
