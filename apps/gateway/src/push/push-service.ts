import { randomUUID } from 'node:crypto';

import type {
  DatabaseClient,
  PushSubscriptionRecord,
  ScheduledRunRecord,
  ScheduledTaskRecord,
} from '@claude-chat/database';
import type { PushSubscriptionSummary } from '@claude-chat/protocol';

import type { ScheduledRunService } from '../scheduled/scheduled-run-service.js';
import { ExpoPushClient } from './expo-push-client.js';

export class PushSubscriptionError extends Error {}

export type PushServiceOptions = {
  receiptDelayMs?: number;
  receiptRetryMs?: number;
  receiptPollIntervalMs?: number;
  maxReceiptAttempts?: number;
};

function publicSubscription(record: PushSubscriptionRecord): PushSubscriptionSummary {
  return {
    deviceId: record.deviceId,
    provider: record.provider,
    platform: record.platform,
    enabled: record.enabled,
    updatedAt: record.updatedAt,
  };
}

export class PushService {
  private configurationError: string | null = null;

  public constructor(
    private readonly database: DatabaseClient,
    private readonly runs: ScheduledRunService,
    private readonly enabled: boolean,
    private readonly client: ExpoPushClient,
    private readonly now: () => Date = () => new Date(),
    private readonly options: PushServiceOptions = {},
  ) {}

  public health(): { status: 'disabled' | 'ready' | 'error'; message?: string } {
    if (!this.enabled) {
      return { status: 'disabled', message: 'System push notifications are not configured.' };
    }
    return this.configurationError
      ? { status: 'error', message: this.configurationError }
      : { status: 'ready' };
  }

  public upsert(
    deviceId: string,
    input: { provider: 'expo'; platform: 'android'; token: string },
  ): PushSubscriptionSummary {
    if (!/^Expo(nent)?PushToken\[[^\]]+\]$/.test(input.token)) {
      throw new PushSubscriptionError('Invalid Expo push token.');
    }
    const timestamp = this.now().toISOString();
    return publicSubscription(
      this.database.pushSubscriptions.upsert({
        deviceId,
        provider: input.provider,
        platform: input.platform,
        token: input.token,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
  }

  public delete(deviceId: string): boolean {
    return this.database.pushSubscriptions.delete(deviceId);
  }

  public async notifyTerminal(run: ScheduledRunRecord, task: ScheduledTaskRecord): Promise<void> {
    if (!this.enabled) {
      this.runs.transition(run.id, { notificationStatus: 'failed' });
      return;
    }
    const subscriptions = this.database.pushSubscriptions.listEnabled();
    if (subscriptions.length === 0) {
      this.runs.transition(run.id, { notificationStatus: 'failed' });
      return;
    }

    let submitted = false;
    for (const subscription of subscriptions) {
      const result = await this.client.send({
        to: subscription.token,
        title: task.name,
        body:
          run.status === 'succeeded'
            ? '定时任务已完成'
            : run.status === 'waiting_permission'
              ? '定时任务需要你的确认'
              : '定时任务执行失败',
        data: {
          taskId: task.id,
          runId: run.id,
          sessionId: task.sessionId,
        },
        channelId:
          run.status === 'succeeded'
            ? 'scheduled-results'
            : run.status === 'waiting_permission'
              ? 'scheduled-attention'
              : 'scheduled-failures',
      });
      if (result.status === 'ok') {
        submitted = true;
        const timestamp = this.now();
        this.database.pushDeliveries.create({
          id: randomUUID(),
          runId: run.id,
          deviceId: subscription.deviceId,
          ticketId: result.ticketId,
          status: 'pending',
          errorCode: null,
          attemptCount: 0,
          nextCheckAt: new Date(
            timestamp.getTime() + (this.options.receiptDelayMs ?? 15 * 60_000),
          ).toISOString(),
          createdAt: timestamp.toISOString(),
          updatedAt: timestamp.toISOString(),
        });
      } else if (result.permanent) {
        this.database.pushSubscriptions.disable(subscription.deviceId, this.now().toISOString());
        if (result.code === 'HTTP_401' || result.code === 'HTTP_403') {
          this.configurationError = 'Expo Push credentials were rejected.';
        }
      }
    }
    this.runs.transition(run.id, { notificationStatus: submitted ? 'pending' : 'failed' });
  }

  public async processReceipts(): Promise<number> {
    if (!this.enabled) return 0;
    const now = this.now();
    const deliveries = this.database.pushDeliveries.listDue(now.toISOString());
    if (deliveries.length === 0) return 0;
    const results = await this.client.receipts(deliveries.map(({ ticketId }) => ticketId));
    const byTicket = new Map(results.map((result) => [result.ticketId, result]));
    const touchedRuns = new Set<string>();

    for (const delivery of deliveries) {
      const result = byTicket.get(delivery.ticketId);
      if (!result) continue;
      touchedRuns.add(delivery.runId);
      if (result.status === 'ok') {
        this.database.pushDeliveries.update(
          delivery.id,
          { status: 'delivered', errorCode: null, nextCheckAt: null },
          now.toISOString(),
        );
      } else if (result.status === 'pending') {
        const attemptCount = delivery.attemptCount + 1;
        const failed = attemptCount >= (this.options.maxReceiptAttempts ?? 12);
        this.database.pushDeliveries.update(
          delivery.id,
          {
            status: failed ? 'failed' : 'pending',
            errorCode: failed ? 'RECEIPT_TIMEOUT' : null,
            attemptCount,
            nextCheckAt: failed
              ? null
              : new Date(now.getTime() + (this.options.receiptRetryMs ?? 5 * 60_000)).toISOString(),
          },
          now.toISOString(),
        );
      } else {
        this.database.pushDeliveries.update(
          delivery.id,
          {
            status: 'failed',
            errorCode: result.code,
            attemptCount: delivery.attemptCount + 1,
            nextCheckAt: null,
          },
          now.toISOString(),
        );
        if (result.permanent) {
          this.database.pushSubscriptions.disable(delivery.deviceId, now.toISOString());
        }
        if (result.code === 'HTTP_401' || result.code === 'HTTP_403') {
          this.configurationError = 'Expo Push credentials were rejected.';
        }
      }
    }

    for (const runId of touchedRuns) {
      const states = this.database.pushDeliveries.listByRun(runId);
      this.runs.transition(runId, {
        notificationStatus: states.some(({ status }) => status === 'delivered')
          ? 'sent'
          : states.some(({ status }) => status === 'pending')
            ? 'pending'
            : 'failed',
      });
    }
    return deliveries.length;
  }

  public startReceiptPolling(): () => void {
    if (!this.enabled) return () => undefined;
    void this.processReceipts();
    const timer = setInterval(
      () => void this.processReceipts(),
      this.options.receiptPollIntervalMs ?? 60_000,
    );
    timer.unref();
    return () => clearInterval(timer);
  }
}
