import { describe, expect, it, vi } from 'vitest';

import { ExpoPushClient } from '../push/expo-push-client.js';

const message = {
  to: 'ExponentPushToken[test]',
  title: 'Task',
  body: 'Done',
  data: { taskId: 'task-1' },
  channelId: 'scheduled-results' as const,
};

describe('ExpoPushClient', () => {
  it('returns a ticket without exposing the push token in its result', async () => {
    let requestInit: RequestInit | undefined;
    const fetcher: typeof fetch = vi.fn(async (_input, init) => {
      requestInit = init;
      return new Response(JSON.stringify({ data: { status: 'ok', id: 'ticket-1' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const client = new ExpoPushClient('access-token', fetcher);

    expect(await client.send(message)).toEqual({ status: 'ok', ticketId: 'ticket-1' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((requestInit!.headers as Record<string, string>).Authorization).toBe(
      'Bearer access-token',
    );
  });

  it('retries bounded transient failures and marks invalid devices permanent', async () => {
    const sleep = vi.fn(async () => undefined);
    const transient = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { status: 'ok', id: 'ticket-2' } }), {
          status: 200,
        }),
      );
    expect(
      await new ExpoPushClient(undefined, transient as typeof fetch, sleep).send(message),
    ).toEqual({ status: 'ok', ticketId: 'ticket-2' });
    expect(sleep).toHaveBeenCalledTimes(2);

    const invalid = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              status: 'error',
              message: 'Device is not registered',
              details: { error: 'DeviceNotRegistered' },
            },
          }),
          { status: 200 },
        ),
    );
    expect(
      await new ExpoPushClient(undefined, invalid as typeof fetch).send(message),
    ).toMatchObject({
      status: 'error',
      code: 'DeviceNotRegistered',
      permanent: true,
    });
  });

  it('parses delivered, pending and permanently failed receipts', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              delivered: { status: 'ok' },
              invalid: {
                status: 'error',
                message: 'Device is not registered',
                details: { error: 'DeviceNotRegistered' },
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );

    expect(
      await new ExpoPushClient(undefined, fetcher as typeof fetch).receipts([
        'delivered',
        'not-ready',
        'invalid',
      ]),
    ).toEqual([
      { ticketId: 'delivered', status: 'ok' },
      { ticketId: 'not-ready', status: 'pending' },
      {
        ticketId: 'invalid',
        status: 'error',
        code: 'DeviceNotRegistered',
        message: 'Device is not registered',
        permanent: true,
      },
    ]);
  });
});
