import { Router, type Request } from 'express';
import {
  canRunScheduledAiAnalysis,
  getLatestAiAnalysisResponse,
  getRunJobStatus,
  runAiAnalysis,
} from '../services/aiAnalysisRuns.service.js';

export const aiAnalysisRouter = Router();

function isAuthorizedCron(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const headerSecret = req.headers['x-cron-secret'];
  return bearer === secret || headerSecret === secret;
}

// Fast read — never calls AI, returns last saved result instantly
aiAnalysisRouter.get('/latest', async (_req, res) => {
  try {
    const latest = await getLatestAiAnalysisResponse();
    res.json(latest);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load latest AI analysis';
    res.status(500).json({ error: message });
  }
});

// Fast read — returns in-flight job status + latest saved analysis
aiAnalysisRouter.get('/status', (_req, res) => {
  res.json(getRunJobStatus());
});

// Fire-and-forget — starts analysis in background, returns immediately with latest saved data.
// This prevents the 12 s proxy timeout from marking the backend unhealthy.
aiAnalysisRouter.post('/run', async (_req, res) => {
  try {
    const startedAt = new Date().toISOString();
    const { status, latestAvailable, generatedAt } = getRunJobStatus();

    if (status === 'running') {
      res.json({ ok: true, status: 'running', startedAt, latestAvailable, generatedAt, message: 'Analysis already running.' });
      return;
    }

    // Kick off analysis without awaiting — responds in <100 ms
    runAiAnalysis({ trigger: 'manual' }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[ai-analysis] background run failed:', msg);
    });

    res.json({ ok: true, status: 'queued', startedAt, latestAvailable, generatedAt, message: 'Analysis started. Poll /api/ai-analysis/latest for results.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to start AI analysis';
    res.status(500).json({ error: message });
  }
});

aiAnalysisRouter.post('/cron', async (req, res) => {
  if (!isAuthorizedCron(req)) {
    return res.status(401).json({ error: 'Unauthorized cron request' });
  }

  const scheduleStatus = canRunScheduledAiAnalysis();
  if (!scheduleStatus.allowed) {
    return res.json({
      skipped: true,
      reason: scheduleStatus.reason,
      timezone: 'Europe/Madrid',
      currentMadridIso: scheduleStatus.currentMadridIso,
    });
  }

  try {
    const result = await runAiAnalysis({ trigger: 'cron', bypassCooldown: true });
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to run scheduled AI analysis';
    res.status(500).json({ error: message });
  }
});
