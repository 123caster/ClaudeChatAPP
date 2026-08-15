import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

import { z } from 'zod';

// Load a detachable per-environment .env file (if present) so vendor creds and
// model choice follow the machine the gateway runs on. Anthropic-compatible
// providers (DeepSeek, Kimi, GLM, Qwen, etc.) are switched by editing the
// ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_MODEL triple.
function loadEnvironmentFile(): void {
  const envPath = process.env.GATEWAY_ENV_FILE
    ? resolve(process.env.GATEWAY_ENV_FILE)
    : resolve(process.cwd(), '.env');
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}
loadEnvironmentFile();

const projectConfigSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80),
    path: z.string().trim().min(1),
  })
  .strict();

const claudeConfigSchema = z
  .object({
    adapter: z.enum(['fake', 'agent-sdk']).default('fake'),
    executablePath: z.string().trim().min(1).optional(),
    model: z.string().trim().min(1).optional(),
  })
  .strict()
  .default({ adapter: 'fake' });

const gatewayConfigFileSchema = z
  .object({
    host: z.string().trim().min(1).default('127.0.0.1'),
    port: z.number().int().min(1).max(65_535).default(43_110),
    apiKey: z.string().trim().min(1).max(256).optional(),
    databasePath: z.string().trim().min(1).optional(),
    claude: claudeConfigSchema,
    projects: z.array(projectConfigSchema).min(1),
    pairing: z
      .object({
        expiresInSeconds: z.number().int().min(60).max(3_600).default(300),
        maxFailures: z.number().int().min(1).max(20).default(5),
        failureWindowSeconds: z.number().int().min(60).max(86_400).default(300),
      })
      .strict()
      .default({
        expiresInSeconds: 300,
        maxFailures: 5,
        failureWindowSeconds: 300,
      }),
  })
  .strict();

export type GatewayProjectConfig = z.infer<typeof projectConfigSchema>;
export type GatewayConfig = Omit<z.infer<typeof gatewayConfigFileSchema>, 'databasePath'> & {
  databasePath: string;
  configDirectory: string;
};

function defaultDataDirectory(): string {
  const localAppData = process.env.LOCALAPPDATA;
  return resolve(localAppData ?? resolve(homedir(), 'AppData', 'Local'), 'ClaudeChatAPP');
}

export function loadGatewayConfig(
  configPath = process.env.GATEWAY_CONFIG ?? 'config.json',
): GatewayConfig {
  const absoluteConfigPath = resolve(configPath);
  const parsedJson: unknown = JSON.parse(readFileSync(absoluteConfigPath, 'utf8'));
  const parsed = gatewayConfigFileSchema.parse(parsedJson);
  const configDirectory = dirname(absoluteConfigPath);
  const environmentPort = process.env.GATEWAY_PORT
    ? z.coerce.number().int().min(1).max(65_535).parse(process.env.GATEWAY_PORT)
    : parsed.port;
  const environmentApiKey = process.env.GATEWAY_API_KEY
    ? z.string().trim().min(1).max(256).parse(process.env.GATEWAY_API_KEY)
    : parsed.apiKey;

  return {
    ...parsed,
    host: process.env.GATEWAY_HOST ?? parsed.host,
    port: environmentPort,
    apiKey: environmentApiKey,
    claude: {
      ...parsed.claude,
      ...(process.env.CLAUDE_CODE_EXECUTABLE
        ? { executablePath: resolve(process.env.CLAUDE_CODE_EXECUTABLE) }
        : {}),
      // Model can be swapped per-environment via CLAUDE_MODEL or ANTHROPIC_MODEL.
      // ANTHROPIC_MODEL is the canonical vendor-agnostic name used by the Agent SDK.
      ...(process.env.CLAUDE_MODEL || process.env.ANTHROPIC_MODEL
        ? { model: process.env.CLAUDE_MODEL ?? process.env.ANTHROPIC_MODEL }
        : {}),
    },
    databasePath: process.env.GATEWAY_DATABASE_PATH
      ? resolve(process.env.GATEWAY_DATABASE_PATH)
      : parsed.databasePath
        ? resolve(configDirectory, parsed.databasePath)
        : resolve(defaultDataDirectory(), 'gateway.db'),
    configDirectory,
  };
}
