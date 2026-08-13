import type { DeviceRecord } from '@claude-chat/database';

declare module 'fastify' {
  interface FastifyRequest {
    device: DeviceRecord | null;
  }
}
