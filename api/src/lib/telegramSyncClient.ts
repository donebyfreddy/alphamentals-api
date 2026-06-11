export type TelegramSyncControlResponse =
  | {
      ok: false;
      code: 'RATE_LIMITED';
      message: string;
      retryAfterSeconds: number;
    }
  | {
      ok: false;
      code: 'SYNC_IN_PROGRESS';
      message: string;
    };

export type TelegramSyncSuccessResponse = {
  success: boolean;
  imported: number;
  skipped: number;
  errors: string[];
  messagesFetched: number;
  checkedChannels: number;
  newMessages: number;
  newSignals: number;
  emailsSent: number;
};

export type TelegramSyncResponse = TelegramSyncSuccessResponse | TelegramSyncControlResponse;

let syncInFlight: Promise<TelegramSyncResponse> | null = null;
let lastAttemptAt = 0;
let localRetryUntil = 0;

export async function syncTelegramWithThrottle(params?: {
  baseUrl?: string;
  limit?: number;
  minIntervalMs?: number;
}): Promise<TelegramSyncResponse> {
  const baseUrl = (params?.baseUrl ?? '').replace(/\/+$/, '');
  const limit = Math.min(Math.max(params?.limit ?? 10, 1), 10);
  const minIntervalMs = params?.minIntervalMs ?? 30_000;
  const now = Date.now();

  if (syncInFlight) {
    return {
      ok: false,
      code: 'SYNC_IN_PROGRESS',
      message: 'Telegram sync already running.',
    };
  }

  if (now < localRetryUntil) {
    return {
      ok: false,
      code: 'RATE_LIMITED',
      message: `Too many sync requests. Retry in ${Math.ceil((localRetryUntil - now) / 1000)} seconds.`,
      retryAfterSeconds: Math.ceil((localRetryUntil - now) / 1000),
    };
  }

  if (now - lastAttemptAt < minIntervalMs) {
    const retryAfterSeconds = Math.ceil((minIntervalMs - (now - lastAttemptAt)) / 1000);
    localRetryUntil = now + retryAfterSeconds * 1000;
    return {
      ok: false,
      code: 'RATE_LIMITED',
      message: `Too many sync requests. Retry in ${retryAfterSeconds} seconds.`,
      retryAfterSeconds,
    };
  }

  lastAttemptAt = now;
  syncInFlight = fetch(`${baseUrl}/api/telegram/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit }),
  })
    .then(async (response) => {
      const payload = await response.json() as TelegramSyncResponse;
      if (response.status === 429 && 'retryAfterSeconds' in payload) {
        localRetryUntil = Date.now() + payload.retryAfterSeconds * 1000;
      }
      return payload;
    })
    .finally(() => {
      syncInFlight = null;
    });

  return syncInFlight;
}
