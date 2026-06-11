import { Router } from 'express';
import { getPlaywrightStatus } from '../services/system/playwrightStatus.service.js';
import { getSourcesStatusPayload } from '../services/marketIntelligence/marketIntelligenceHub.service.js';

export const systemRouter = Router();

systemRouter.get('/playwright-status', async (_req, res) => {
  const playwright = await getPlaywrightStatus();
  res.json(playwright);
});

systemRouter.get('/status', async (_req, res) => {
  const playwright = await getPlaywrightStatus();
  res.json({
    ok: true,
    time: new Date().toISOString(),
    playwright,
    sources: getSourcesStatusPayload().sources,
  });
});
