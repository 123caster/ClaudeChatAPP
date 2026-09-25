export type ModelPreset = {
  provider: string;
  baseUrl: string;
  models: string[];
};

// Built-in Anthropic-compatible providers and their common model names.
// `baseUrl` is the default endpoint shown in the add-model form; it stays
// editable so the user can point at any /anthropic-compatible gateway.
export const MODEL_PRESETS: ModelPreset[] = [
  {
    provider: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/anthropic',
    models: ['deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner'],
  },
  {
    provider: 'Kimi (Moonshot)',
    baseUrl: 'https://api.moonshot.cn/anthropic',
    models: ['kimi-k2', 'kimi-k2-turbo', 'moonshot-v1-8k'],
  },
  {
    provider: 'GLM (智谱)',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    models: ['glm-4-plus', 'glm-4-flash', 'glm-4.5'],
  },
  {
    provider: 'Qwen (通义千问)',
    baseUrl: 'https://dashscope.aliyuncs.com/api/v2/apps/anthropic',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo'],
  },
  {
    provider: 'Anthropic (Claude)',
    baseUrl: 'https://api.anthropic.com',
    models: ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'],
  },
];
