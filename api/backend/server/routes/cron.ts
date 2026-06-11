import { Router, type Request } from 'express';
import { canRunScheduledAiAnalysis, runAiAnalysis } from '../services/aiAnalysisRuns.service.js';
import { normalizeTelegramRouteError, syncTelegramSignals } from '../services/telegramInfo.service.js';

export const cronRouter = Router();

function isAuthorizedCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
  const headerSecret = (req.headers['x-cron-secret'] as string | undefined) ?? '';
  return bearer === secret || headerSecret === secret;
}

cronRouter.post('/telegram-sync', async (req, res) => {
  if (!isAuthorizedCron(req)) {
    return res.status(401).json({ error: 'Unauthorized cron request' });
  }

  const limit = typeof req.body?.limit === 'number' ? Math.min(Math.max(req.body.limit, 1), 10) : 10;

  try {
    const result = await syncTelegramSignals(limit, {
      source: 'cron',
      enforceRateLimit: false,
    });
    return res.json(result);
  } catch (error) {
    const normalized = normalizeTelegramRouteError(error);
    if (normalized.retryAfterSeconds) {
      res.setHeader('Retry-After', String(normalized.retryAfterSeconds));
    }
    console.error('[Telegram cron] Failed:', {
      code: normalized.code ?? 'TELEGRAM_UNAVAILABLE',
      message: normalized.message,
      phase: normalized.phase ?? 'unknown',
      retryAfterSeconds: normalized.retryAfterSeconds ?? null,
    });
    if (normalized.code === 'RATE_LIMITED') {
      return res.status(429).json({
        ok: false,
        code: 'RATE_LIMITED',
        message: normalized.message,
        retryAfterSeconds: normalized.retryAfterSeconds ?? 0,
      });
    }
    if (normalized.code === 'SYNC_IN_PROGRESS') {
      return res.status(409).json({
        ok: false,
        code: 'SYNC_IN_PROGRESS',
        message: 'Telegram sync already running.',
      });
    }
    return res.status(normalized.status).json({
      ok: false,
      checkedChannels: 0,
      newMessages: 0,
      newSignals: 0,
      emailsSent: 0,
      errors: [normalized.message],
      errorCode: normalized.code ?? 'TELEGRAM_UNAVAILABLE',
    });
  }
});

cronRouter.post('/fundamentals-ai', async (req, res) => {
  if (!isAuthorizedCron(req)) {
    return res.status(401).json({ error: 'Unauthorized cron request' });
  }

  try {
    const scheduleStatus = canRunScheduledAiAnalysis();
    const force = req.body?.force === true;
    if (!force && !scheduleStatus.allowed) {
      return res.json({
        success: false,
        skipped: true,
        runType: 'scheduled',
        timezone: 'Europe/Madrid',
        reason: scheduleStatus.reason,
        currentMadridIso: scheduleStatus.currentMadridIso,
      });
    }

    const result = await runAiAnalysis({ trigger: force ? 'manual' : 'cron', bypassCooldown: true });
    return res.json({
      success: result.ok,
      runType: force ? 'manual' : 'scheduled',
      timezone: result.timezone ?? 'Europe/Madrid',
      symbolsAnalysed: result.symbols,
      generatedAt: result.analysis?.generatedAt ?? null,
      nextRun: result.nextRun ?? null,
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Fundamentals cron AI run failed';
    console.error('[fundamentals cron] Failed:', message);
    return res.status(500).json({
      success: false,
      runType: 'scheduled',
      timezone: 'Europe/Madrid',
      symbolsAnalysed: [],
      error: message,
    });
  }
});
