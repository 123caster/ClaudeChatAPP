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
  createModel: (
    name: string,
    baseUrl: string,
    apiKey: string,
    model: string,
    capabilities?: {
      supportsImages?: boolean;
      supportsDocuments?: boolean;
      isMultimodalDefault?: boolean;
    },
  ) => Promise<ModelSummary>;
  createVariant: (sourceModelId: string, model: string) => Promise<ModelSummary>;
  createVariants: (sourceModelId: string, models: string[]) => Promise<ModelSummary[]>;
  update: (
    modelId: string,
    input: {
      name?: string;
      baseUrl?: string;
      apiKey?: string;
      model?: string;
      supportsImages?: boolean;
      supportsDocuments?: boolean;
      isMultimodalDefault?: boolean;
    },
  ) => Promise<ModelSummary>;
  setActive: (modelId: string) => Promise<void>;
  setMultimodalDefault: (modelId: string) => Promise<void>;
  remove: (modelId: string) => Promise<void>;
};

const ModelContext = createContext<ModelState | null>(null);

export function ModelProvider({ children }: PropsWithChildren) {
  const { gatewayUrl, deviceToken, resetConnection } = useConnection();
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!gatewayUrl || !deviceToken) return;
    setLoading(true);
    try {
      const next = await new GatewayClient(gatewayUrl).models(deviceToken);
      setModels(next);
      setError(null);
    } catch (caught) {
      if (caught instanceof GatewayRequestError && caught.code === 'UNAUTHORIZED') {
        await resetConnection('设备授权已失效，请重新配对。');
      } else {
        setError('无法加载模型列表。');
      }
    } finally {
      setLoading(false);
    }
  }, [gatewayUrl, deviceToken, resetConnection]);

  useEffect(() => {
    if (gatewayUrl && deviceToken) void refresh();
  }, [gatewayUrl, deviceToken, refresh]);

  const createModel = useCallback(
    async (
      name: string,
      baseUrl: string,
      apiKeyValue: string,
      model: string,
      capabilities: {
        supportsImages?: boolean;
        supportsDocuments?: boolean;
        isMultimodalDefault?: boolean;
      } = {},
    ) => {
      if (!gatewayUrl || !deviceToken) throw new Error('Gateway is not connected.');
      const response = await new GatewayClient(gatewayUrl).createModel(deviceToken, {
        requestId: createRequestId(),
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        apiKey: apiKeyValue.trim(),
        model: model.trim(),
        ...capabilities,
      });
      setModels((current) => [
        ...current.map((item) =>
          response.model.isMultimodalDefault ? { ...item, isMultimodalDefault: false } : item,
        ),
        response.model,
      ]);
      return response.model;
    },
    [gatewayUrl, deviceToken],
  );

  const setActive = useCallback(
    async (modelId: string) => {
      if (!gatewayUrl || !deviceToken) throw new Error('Gateway is not connected.');
      await new GatewayClient(gatewayUrl).setActiveModel(deviceToken, modelId, createRequestId());
      setModels((current) => current.map((item) => ({ ...item, isActive: item.id === modelId })));
    },
    [gatewayUrl, deviceToken],
  );

  const setMultimodalDefault = useCallback(
    async (modelId: string) => {
      if (!gatewayUrl || !deviceToken) throw new Error('Gateway is not connected.');
      const response = await new GatewayClient(gatewayUrl).setDefaultMultimodalModel(
        deviceToken,
        modelId,
        createRequestId(),
      );
      setModels((current) =>
        current.map((item) =>
          item.id === modelId ? response.model : { ...item, isMultimodalDefault: false },
        ),
      );
    },
    [gatewayUrl, deviceToken],
  );

  const createVariant = useCallback(
    async (sourceModelId: string, model: string) => {
      if (!gatewayUrl || !deviceToken) throw new Error('Gateway is not connected.');
      const response = await new GatewayClient(gatewayUrl).createModelVariant(
        deviceToken,
        sourceModelId,
        model.trim(),
        createRequestId(),
      );
      setModels((current) => [...current, response.model]);
      return response.model;
    },
    [gatewayUrl, deviceToken],
  );

  const createVariants = useCallback(
    async (sourceModelId: string, modelNames: string[]) => {
      if (!gatewayUrl || !deviceToken) throw new Error('Gateway is not connected.');
      const response = await new GatewayClient(gatewayUrl).createModelVariants(
        deviceToken,
        sourceModelId,
        modelNames,
        createRequestId(),
      );
      setModels((current) => [...current, ...response.models]);
      return response.models;
    },
    [gatewayUrl, deviceToken],
  );

  const update = useCallback(
    async (
      modelId: string,
      input: {
        name?: string;
        baseUrl?: string;
        apiKey?: string;
        model?: string;
        supportsImages?: boolean;
        supportsDocuments?: boolean;
        isMultimodalDefault?: boolean;
      },
    ) => {
      if (!gatewayUrl || !deviceToken) throw new Error('Gateway is not connected.');
      const response = await new GatewayClient(gatewayUrl).updateModel(
        deviceToken,
        modelId,
        input,
        createRequestId(),
      );
      setModels((current) =>
        current.map((item) => {
          if (item.id === modelId) return response.model;
          return response.model.isMultimodalDefault
            ? { ...item, isMultimodalDefault: false }
            : item;
        }),
      );
      return response.model;
    },
    [gatewayUrl, deviceToken],
  );

  const remove = useCallback(
    async (modelId: string) => {
      if (!gatewayUrl || !deviceToken) throw new Error('Gateway is not connected.');
      await new GatewayClient(gatewayUrl).deleteModel(deviceToken, modelId, createRequestId());
      setModels((current) => current.filter((item) => item.id !== modelId));
    },
    [gatewayUrl, deviceToken],
  );

  const activeModelId = useMemo(() => models.find((item) => item.isActive)?.id ?? null, [models]);

  const value = useMemo(
    () => ({
      models,
      activeModelId,
      loading,
      error,
      refresh,
      createModel,
      createVariant,
      createVariants,
      update,
      setActive,
      setMultimodalDefault,
      remove,
    }),
    [
      models,
      activeModelId,
      loading,
      error,
      refresh,
      createModel,
      createVariant,
      createVariants,
      update,
      setActive,
      setMultimodalDefault,
      remove,
    ],
  );

  return <ModelContext.Provider value={value}>{children}</ModelContext.Provider>;
}

export function useModels(): ModelState {
  const context = useContext(ModelContext);
  if (!context) throw new Error('useModels must be used inside ModelProvider.');
  return context;
}
