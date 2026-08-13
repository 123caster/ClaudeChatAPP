import { describe, expect, it } from 'vitest';

import {
  PROTOCOL_VERSION,
  errorResponseSchema,
  eventEnvelopeSchema,
  healthResponseSchema,
} from '../index.js';

const baseEnvelope = {
  protocolVersion: PROTOCOL_VERSION,
  eventId: 12,
  sessionId: null,
  requestId: null,
  emittedAt: '2026-08-13T08:00:00.000Z',
};

describe('eventEnvelopeSchema', () => {
  it('accepts a valid connection-ready event', () => {
    const parsed = eventEnvelopeSchema.parse({
      ...baseEnvelope,
      type: 'connection.ready',
      payload: {
        gatewayVersion: '0.1.0',
        currentEventId: 12,
      },
    });

    expect(parsed.type).toBe('connection.ready');
  });

  it('rejects a different protocol version', () => {
    const result = eventEnvelopeSchema.safeParse({
      ...baseEnvelope,
      protocolVersion: 2,
      type: 'connection.ready',
      payload: {
        gatewayVersion: '0.1.0',
        currentEventId: 12,
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects an unknown event type instead of accepting unvalidated payloads', () => {
    const result = eventEnvelopeSchema.safeParse({
      ...baseEnvelope,
      type: 'unknown.event',
      payload: {},
    });

    expect(result.success).toBe(false);
  });

  it('rejects unknown fields', () => {
    const result = eventEnvelopeSchema.safeParse({
      ...baseEnvelope,
      type: 'server.notice',
      payload: {
        level: 'info',
        code: 'GATEWAY_STARTED',
        message: 'Gateway started.',
        leakedField: true,
      },
    });

    expect(result.success).toBe(false);
  });
});

describe('HTTP schemas', () => {
  it('accepts the bootstrap health response', () => {
    expect(
      healthResponseSchema.parse({
        status: 'ok',
        gatewayVersion: '0.1.0',
        protocolVersion: PROTOCOL_VERSION,
        claude: {
          status: 'starting',
        },
      }),
    ).toMatchObject({ status: 'ok' });
  });

  it('requires stable error codes and a request id field', () => {
    expect(
      errorResponseSchema.safeParse({
        error: {
          code: 'RANDOM_ERROR',
          message: 'Nope',
          requestId: null,
        },
      }).success,
    ).toBe(false);
  });
});
