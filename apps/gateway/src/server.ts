import { buildApp } from './app.js';

const host = process.env.GATEWAY_HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.GATEWAY_PORT ?? '43110', 10);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('GATEWAY_PORT must be an integer between 1 and 65535.');
}

const app = buildApp({ logger: true });

const shutdown = async (): Promise<void> => {
  await app.close();
  process.exit(0);
};

process.once('SIGINT', () => {
  void shutdown();
});

process.once('SIGTERM', () => {
  void shutdown();
});

await app.listen({ host, port });
