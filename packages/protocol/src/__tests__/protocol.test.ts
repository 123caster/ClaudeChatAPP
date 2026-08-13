import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
  PairingExchangeRequest,
  PairingExchangeResponse,
  ProjectsResponse,
} from '../index.js';

import {
  PROTOCOL_VERSION,
  errorCodeSchema,
  errorResponseSchema,
  eventEnvelopeSchema,
  healthResponseSchema,
  pairingExchangeRequestSchema,
  pairingExchangeResponseSchema,
  projectsResponseSchema,
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
  it('exports the fixed Gateway contract type names', () => {
    expectTypeOf<PairingExchangeRequest>().toMatchObjectType<{
      code: string;
      deviceName: string;
    }>();
    expectTypeOf<PairingExchangeResponse>().toHaveProperty('tokenType');
    expectTypeOf<ProjectsResponse>().toHaveProperty('projects');
  });

  it('accepts the bootstrap health response', () => {
    expect(
      healthResponseSchema.parse({
        status: 'ok',
        gatewayVersion: '0.1.0',
        protocolVersion: PROTOCOL_VERSION,
        config: {
          status: 'ready',
        },
        database: {
          status: 'ready',
        },
        pairing: {
          available: true,
        },
        claude: {
          status: 'starting',
        },
      }),
    ).toMatchObject({ status: 'ok' });
  });

  it('reports config and database readiness plus pairing availability', () => {
    for (const available of [true, false]) {
      expect(
        healthResponseSchema.safeParse({
          status: 'ok',
          gatewayVersion: '0.1.0',
          protocolVersion: PROTOCOL_VERSION,
          config: { status: 'ready' },
          database: { status: 'ready' },
          pairing: { available },
          claude: { status: 'ready' },
        }).success,
      ).toBe(true);
    }

    expect(
      healthResponseSchema.safeParse({
        status: 'ok',
        gatewayVersion: '0.1.0',
        protocolVersion: PROTOCOL_VERSION,
        config: { status: 'ready' },
        database: { status: 'ready', extra: true },
        pairing: { available: true },
        claude: { status: 'ready' },
      }).success,
    ).toBe(false);

    expect(
      healthResponseSchema.safeParse({
        status: 'ok',
        gatewayVersion: '0.1.0',
        protocolVersion: PROTOCOL_VERSION,
        config: { status: 'unavailable' },
        database: { status: 'ready' },
        pairing: { available: true },
        claude: { status: 'ready' },
      }).success,
    ).toBe(false);
  });

  it('validates a six-digit pairing exchange request', () => {
    expect(
      pairingExchangeRequestSchema.parse({
        code: '004281',
        deviceName: 'Pixel 9',
      }),
    ).toEqual({ code: '004281', deviceName: 'Pixel 9' });

    for (const code of ['4281', '1234567', '12345a', 123456]) {
      expect(
        pairingExchangeRequestSchema.safeParse({
          code,
          deviceName: 'Pixel 9',
        }).success,
      ).toBe(false);
    }
  });

  it('rejects invalid device names and unknown pairing request fields', () => {
    expect(
      pairingExchangeRequestSchema.safeParse({ code: '123456', deviceName: '   ' }).success,
    ).toBe(false);
    expect(
      pairingExchangeRequestSchema.safeParse({
        code: '123456',
        deviceName: 'Pixel 9',
        unexpected: true,
      }).success,
    ).toBe(false);
  });

  it('validates the pairing exchange response', () => {
    expect(
      pairingExchangeResponseSchema.parse({
        device: { id: 'device_123', name: 'Pixel 9' },
        token: 'secret-device-token',
        tokenType: 'Bearer',
      }),
    ).toMatchObject({ tokenType: 'Bearer' });

    expect(
      pairingExchangeResponseSchema.safeParse({
        device: { id: 'device_123', name: 'Pixel 9' },
        token: 'secret-device-token',
        tokenType: 'Basic',
      }).success,
    ).toBe(false);
  });

  it('validates a strict project list response', () => {
    expect(
      projectsResponseSchema.parse({
        projects: [
          {
            id: 'project_123',
            displayName: 'ClaudeChatAPP',
            rootPath: 'D:\\ouyang\\Projects\\ClaudeChatAPP',
          },
        ],
      }).projects,
    ).toHaveLength(1);

    expect(
      projectsResponseSchema.safeParse({
        projects: [
          {
            id: 'project_123',
            displayName: 'ClaudeChatAPP',
            rootPath: 'D:\\ouyang\\Projects\\ClaudeChatAPP',
            secret: 'not-allowed',
          },
        ],
      }).success,
    ).toBe(false);
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

  it('exposes the stable pairing and project error codes', () => {
    expect(errorCodeSchema.options).toEqual(
      expect.arrayContaining([
        'PAIRING_CODE_INVALID',
        'PAIRING_CODE_EXPIRED',
        'PAIRING_RATE_LIMITED',
        'DEVICE_ALREADY_PAIRED',
        'PROJECT_PATH_INVALID',
      ]),
    );

    for (const code of [
      'PAIRING_CODE_INVALID',
      'PAIRING_CODE_EXPIRED',
      'PAIRING_RATE_LIMITED',
      'DEVICE_ALREADY_PAIRED',
      'PROJECT_PATH_INVALID',
    ] as const) {
      expect(
        errorResponseSchema.safeParse({
          error: { code, message: 'Stable error', requestId: 'request_123' },
        }).success,
      ).toBe(true);
    }
  });
});
