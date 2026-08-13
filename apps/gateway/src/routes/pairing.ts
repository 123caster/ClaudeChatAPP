import { pairingExchangeRequestSchema, type PairingExchangeResponse } from '@claude-chat/protocol';
import type { FastifyInstance } from 'fastify';

import type { DeviceAuthService } from '../auth/device-auth-service.js';
import { DeviceAlreadyPairedError } from '../auth/device-auth-service.js';
import type { PairingCodeService } from '../auth/pairing-code-service.js';
import { PairingCodeError } from '../auth/pairing-code-service.js';
import { sendError } from '../http-error.js';

type PairingRouteOptions = {
  pairingCodes: PairingCodeService;
  deviceAuth: DeviceAuthService;
};

export function registerPairingRoute(
  app: FastifyInstance,
  { pairingCodes, deviceAuth }: PairingRouteOptions,
): void {
  app.post('/v1/pairing/exchange', async (request, reply) => {
    const parsed = pairingExchangeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(request, reply, 400, 'VALIDATION_ERROR', 'Invalid pairing request.');
    }

    if (deviceAuth.hasActiveDevice()) {
      return sendError(
        request,
        reply,
        409,
        'DEVICE_ALREADY_PAIRED',
        'An active device is already paired.',
      );
    }

    try {
      const { device, token } = pairingCodes.exchange(request.ip, parsed.data.code, () =>
        deviceAuth.pair(parsed.data.deviceName),
      );
      const response: PairingExchangeResponse = {
        device: { id: device.id, name: device.name },
        token,
        tokenType: 'Bearer',
      };
      return reply.status(201).send(response);
    } catch (error) {
      if (error instanceof PairingCodeError) {
        const statusCode = error.code === 'PAIRING_RATE_LIMITED' ? 429 : 401;
        return sendError(request, reply, statusCode, error.code, 'Pairing code was not accepted.');
      }
      if (error instanceof DeviceAlreadyPairedError) {
        return sendError(
          request,
          reply,
          409,
          'DEVICE_ALREADY_PAIRED',
          'An active device is already paired.',
        );
      }
      throw error;
    }
  });
}
