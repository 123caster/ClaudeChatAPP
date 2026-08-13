import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { DeviceRecord, DeviceRepository } from '@claude-chat/database';

export class DeviceAlreadyPairedError extends Error {
  public constructor() {
    super('An active device is already paired.');
    this.name = 'DeviceAlreadyPairedError';
  }
}

export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class DeviceAuthService {
  public constructor(
    private readonly devices: DeviceRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly createToken: () => string = () => randomBytes(32).toString('base64url'),
  ) {}

  public hasActiveDevice(): boolean {
    return this.devices.countActive() > 0;
  }

  public pair(name: string): { device: DeviceRecord; token: string } {
    if (this.hasActiveDevice()) {
      throw new DeviceAlreadyPairedError();
    }

    const token = this.createToken();
    let device: DeviceRecord;
    try {
      device = this.devices.create({
        id: randomUUID(),
        name,
        tokenHash: hashDeviceToken(token),
        createdAt: this.now().toISOString(),
      });
    } catch (error) {
      if (this.hasActiveDevice()) {
        throw new DeviceAlreadyPairedError();
      }
      throw error;
    }
    return { device, token };
  }

  public authenticate(token: string): DeviceRecord | null {
    const device = this.devices.findActiveByTokenHash(hashDeviceToken(token));
    if (device) {
      this.devices.touch(device.id, this.now().toISOString());
    }
    return device;
  }
}
