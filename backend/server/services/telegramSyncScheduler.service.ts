import { getTelegramEnvConfig } from '../config/telegram.js';
import { setSyncScheduleMetadata, syncTelegramSignals } from './telegramInfo.service.js';

const TELEGRAM_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const TELEGRAM_SYNC_LIMIT = 10;

let schedulerStarted = false;
let timer: NodeJS.Timeout | null = null;

function computeNextRun(from = Date.now()) {
  return new Date(from + TELEGRAM_SYNC_INTERVAL_MS);
}

async function runScheduledSync(trigger: 'startup' | 'interval') {
  try {
    console.log(`[Telegram] Automatic sync started (${trigger})`);
    const result = await syncTelegramSignals(TELEGRAM_SYNC_LIMIT, {
      source: 'scheduled',
      enforceRateLimit: false,
    });
    console.log('[Telegram] Automatic sync finished', result);
  } catch (error) {
    console.error('[Telegram] Automatic sync failed:', error instanceof Error ? error.message : 'Unknown error');
  } finally {
    setSyncScheduleMetadata(computeNextRun());
  }
}

export function startTelegramSyncScheduler() {
  if (schedulerStarted) return;

  const telegram = getTelegramEnvConfig();
  if (!telegram.configured || !telegram.targetChat) {
    console.warn('[Telegram] Automatic sync scheduler not started because Telegram is not fully configured.');
    return;
  }

  schedulerStarted = true;
  setSyncScheduleMetadata(computeNextRun());

  void runScheduledSync('startup');
  timer = setInterval(() => {
    void runScheduledSync('interval');
  }, TELEGRAM_SYNC_INTERVAL_MS);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  console.log('[Telegram] Automatic sync scheduler started (every 5 minutes)');
}
