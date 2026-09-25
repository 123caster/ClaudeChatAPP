export type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
  channelId: 'scheduled-results' | 'scheduled-attention' | 'scheduled-failures';
};

export type ExpoPushResult =
  | { status: 'ok'; ticketId: string }
  | { status: 'error'; code: string; message: string; permanent: boolean };

export type ExpoPushReceiptResult =
  | { ticketId: string; status: 'ok' }
  | { ticketId: string; status: 'pending' }
  | { ticketId: string; status: 'error'; code: string; message: string; permanent: boolean };

type FetchLike = typeof fetch;

export class ExpoPushClient {
  public constructor(
    private readonly accessToken?: string,
    private readonly fetcher: FetchLike = fetch,
    private readonly sleep: (milliseconds: number) => Promise<void> = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {}

  public async send(message: ExpoPushMessage): Promise<ExpoPushResult> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await this.fetcher('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
          },
          body: JSON.stringify(message),
        });
        if (response.status === 429 || response.status >= 500) {
          if (attempt < 2) {
            await this.sleep(250 * 2 ** attempt);
            continue;
          }
          return {
            status: 'error',
            code: `HTTP_${response.status}`,
            message: 'Expo Push Service is temporarily unavailable.',
            permanent: false,
          };
        }
        if (!response.ok) {
          return {
            status: 'error',
            code: `HTTP_${response.status}`,
            message: 'Expo Push Service rejected the request.',
            permanent: response.status >= 400 && response.status < 500,
          };
        }

        const payload = (await response.json()) as {
          data?: { status?: string; id?: string; message?: string; details?: { error?: string } };
        };
        if (payload.data?.status === 'ok' && payload.data.id) {
          return { status: 'ok', ticketId: payload.data.id };
        }
        const code = payload.data?.details?.error ?? 'EXPO_PUSH_ERROR';
        return {
          status: 'error',
          code,
          message: payload.data?.message ?? 'Expo Push Service returned an invalid ticket.',
          permanent: code === 'DeviceNotRegistered',
        };
      } catch {
        if (attempt < 2) {
          await this.sleep(250 * 2 ** attempt);
          continue;
        }
      }
    }
    return {
      status: 'error',
      code: 'NETWORK_ERROR',
      message: 'Expo Push Service could not be reached.',
      permanent: false,
    };
  }

  public async receipts(ticketIds: readonly string[]): Promise<ExpoPushReceiptResult[]> {
    if (ticketIds.length === 0) return [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await this.fetcher('https://exp.host/--/api/v2/push/getReceipts', {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
          },
          body: JSON.stringify({ ids: ticketIds }),
        });
        if (response.status === 429 || response.status >= 500) {
          if (attempt < 2) {
            await this.sleep(250 * 2 ** attempt);
            continue;
          }
          return ticketIds.map((ticketId) => ({
            ticketId,
            status: 'error',
            code: `HTTP_${response.status}`,
            message: 'Expo Push receipt service is temporarily unavailable.',
            permanent: false,
          }));
        }
        if (!response.ok) {
          return ticketIds.map((ticketId) => ({
            ticketId,
            status: 'error',
            code: `HTTP_${response.status}`,
            message: 'Expo Push receipt service rejected the request.',
            permanent: response.status >= 400 && response.status < 500,
          }));
        }
        const payload = (await response.json()) as {
          data?: Record<
            string,
            { status?: string; message?: string; details?: { error?: string } }
          >;
        };
        return ticketIds.map((ticketId) => {
          const receipt = payload.data?.[ticketId];
          if (!receipt) return { ticketId, status: 'pending' as const };
          if (receipt.status === 'ok') return { ticketId, status: 'ok' as const };
          const code = receipt.details?.error ?? 'EXPO_RECEIPT_ERROR';
          return {
            ticketId,
            status: 'error' as const,
            code,
            message: receipt.message ?? 'Expo Push Service reported a delivery failure.',
            permanent: code === 'DeviceNotRegistered',
          };
        });
      } catch {
        if (attempt < 2) {
          await this.sleep(250 * 2 ** attempt);
          continue;
        }
      }
    }
    return ticketIds.map((ticketId) => ({
      ticketId,
      status: 'error',
      code: 'NETWORK_ERROR',
      message: 'Expo Push receipt service could not be reached.',
      permanent: false,
    }));
  }
}
