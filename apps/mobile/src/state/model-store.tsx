import type { ModelSummary } from '@claude-chat/protocol';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import { GatewayClient, GatewayRequestError, createRequestId } from '@/api/gateway-client';
import { useConnection } from '@/state/connection-store';

type ModelState = {
  models: ModelSummary[];
  activeModelId: string | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createModel: (name: string, baseUrl: string, apiKey: string, model: string) => Promise<ModelSummary>;
  setActive: (modelId: string) => Promise<void>;
  remove: (modelId: string) => Promise<void>;
};

const ModelContext = createContext<ModelState | null>(null);

export function ModelProvider({ children }: PropsWithChildren) {
  const { gatewayUrl, apiKey, resetConnection } = useConnection();
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!gatewayUrl || !apiKey) return;
    setLoading(true);
    try {
      const next = await new GatewayClient(gatewayUrl).models(apiKey);
      setModels(next);
      setError(null);
    } catch (caught) {
      if (caught instanceof GatewayRequestError && caught.code === 'UNAUTHORIZED') {
        await resetConnection('API Key 不正确或已失效，请重新连接。');
      } else {
        setError('无法加载模型列表。');
      }
    } finally {
      setLoading(false);
    }
  }, [gatewayUrl, apiKey, resetConnection]);

  useEffect(() => {
    if (gatewayUrl && apiKey) void refresh();
  }, [gatewayUrl, apiKey, refresh]);

  const createModel = useCallback(
    async (name: string, baseUrl: string, apiKeyValue: string, model: string) => {
      if (!gatewayUrl || !apiKey) throw new Error('Gateway is not connected.');
      const response = await new GatewayClient(gatewayUrl).createModel(apiKey, {
        requestId: createRequestId(),
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        apiKey: apiKeyValue.trim(),
        model: model.trim(),
      });
      setModels((current) => [...current, response.model]);
      return response.model;
    },
    [gatewayUrl, apiKey],
  );

  const setActive = useCallback(
    async (modelId: string) => {
      if (!gatewayUrl || !apiKey) throw new Error('Gateway is not connected.');
      await new GatewayClient(gatewayUrl).setActiveModel(apiKey, modelId, createRequestId());
      setModels((current) =>
        current.map((item) => ({ ...item, isActive: item.id === modelId })),
      );
    },
    [gatewayUrl, apiKey],
  );

  const remove = useCallback(
    async (modelId: string) => {
      if (!gatewayUrl || !apiKey) throw new Error('Gateway is not connected.');
      await new GatewayClient(gatewayUrl).deleteModel(apiKey, modelId, createRequestId());
      setModels((current) => current.filter((item) => item.id !== modelId));
    },
    [gatewayUrl, apiKey],
  );

  const activeModelId = useMemo(
    () => models.find((item) => item.isActive)?.id ?? null,
    [models],
  );

  const value = useMemo(
    () => ({
      models,
      activeModelId,
      loading,
      error,
      refresh,
      createModel,
      setActive,
      remove,
    }),
    [models, activeModelId, loading, error, refresh, createModel, setActive, remove],
  );

  return <ModelContext.Provider value={value}>{children}</ModelContext.Provider>;
}

export function useModels(): ModelState {
  const context = useContext(ModelContext);
  if (!context) throw new Error('useModels must be used inside ModelProvider.');
  return context;
}
