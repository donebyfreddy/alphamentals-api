import { Router, type Request } from 'express';
import { runAiAnalysis } from '../services/aiAnalysisRuns.service.js';

export const adminRouter = Router();

function isAdminAuthorized(req: Request) {
  if (process.env.NODE_ENV !== 'production') return true;
  const secret = process.env.ADMIN_SECRET ?? process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
  const headerSecret = (req.headers['x-admin-secret'] as string | undefined) ?? '';
  return bearer === secret || headerSecret === secret;
}

adminRouter.post('/fundamentals-ai/run-now', async (req, res) => {
  if (!isAdminAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized admin request' });
  }

  try {
    const result = await runAiAnalysis({ trigger: 'manual', bypassCooldown: true });
    return res.json({
      success: result.ok,
      runType: 'manual',
      timezone: result.timezone ?? 'Europe/Madrid',
      symbolsAnalysed: result.symbols,
      generatedAt: result.analysis?.generatedAt ?? null,
      nextRun: result.nextRun ?? null,
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Manual AI analysis failed';
    return res.status(500).json({
      success: false,
      runType: 'manual',
      timezone: 'Europe/Madrid',
      symbolsAnalysed: [],
      error: message,
    });
  }
});
