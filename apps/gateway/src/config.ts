import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

import { z } from 'zod';

const projectConfigSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80),
    path: z.string().trim().min(1),
  })
  .strict();

const gatewayConfigFileSchema = z
  .object({
    host: z.string().trim().min(1).default('127.0.0.1'),
    port: z.number().int().min(1).max(65_535).default(43_110),
    databasePath: z.string().trim().min(1).optional(),
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

  return {
    ...parsed,
    host: process.env.GATEWAY_HOST ?? parsed.host,
    port: environmentPort,
    databasePath: process.env.GATEWAY_DATABASE_PATH
      ? resolve(process.env.GATEWAY_DATABASE_PATH)
      : parsed.databasePath
        ? resolve(configDirectory, parsed.databasePath)
        : resolve(defaultDataDirectory(), 'gateway.db'),
    configDirectory,
  };
}
