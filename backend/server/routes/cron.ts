import { Router, type Request } from 'express';
import { canRunScheduledAiAnalysis, runAiAnalysis } from '../services/aiAnalysisRuns.service.js';
import { syncTelegramSignals } from '../services/telegramInfo.service.js';

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
    const message = error instanceof Error ? error.message : 'Telegram cron sync failed';
    console.error('[Telegram cron] Failed:', message);
    return res.status(500).json({
      ok: false,
      checkedChannels: 0,
      newMessages: 0,
      newSignals: 0,
      emailsSent: 0,
      errors: [message],
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
