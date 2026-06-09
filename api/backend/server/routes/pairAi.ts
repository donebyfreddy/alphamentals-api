import { Router } from 'express';
import { createPairAiJob, getPairAiJob } from '../services/pairAiJob.service.js';

export const pairAiRouter = Router();

pairAiRouter.post('/analyze', async (req, res) => {
  const symbol = typeof req.body?.symbol === 'string' ? req.body.symbol : '';
  const forceRefresh = Boolean(req.body?.forceRefresh ?? true);

  if (!symbol.trim()) {
    return res.status(400).json({ error: 'symbol is required' });
  }

  const job = await createPairAiJob(symbol, forceRefresh);
  return res.json({
    jobId: job.jobId,
    status: job.status,
    stage: job.stage,
  });
});

pairAiRouter.get('/analyze/status', (req, res) => {
  const jobId = typeof req.query.jobId === 'string' ? req.query.jobId : '';
  if (!jobId.trim()) {
    return res.status(400).json({ error: 'jobId is required' });
  }

  const job = getPairAiJob(jobId);
  if (!job) {
    return res.status(404).json({ error: 'job not found' });
  }

  if (job.status === 'failed') {
    return res.json({
      status: job.status,
      error: job.error,
      details: job.details,
      diagnostics: job.diagnostics,
    });
  }

  return res.json({
    jobId: job.jobId,
    status: job.status,
    stage: job.stage,
    analysis: job.analysis,
    diagnostics: job.diagnostics,
  });
});
