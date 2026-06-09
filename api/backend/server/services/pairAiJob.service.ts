import { randomUUID } from 'node:crypto';
import { buildPairAnalysis, getPairAiDebugSnapshot, type PairAiStage, type PairAnalysisResponse } from './pairAnalysis.service.js';
import { getOpenAIModel, getPairAiTimeoutMs, isOpenAIConfigured } from '../lib/openaiConfig.js';

export type PairAiJobStatus = 'processing' | 'completed' | 'failed';

export interface PairAiJobRecord {
  jobId: string;
  symbol: string;
  status: PairAiJobStatus;
  stage: PairAiStage;
  analysis?: PairAnalysisResponse;
  error?: string;
  details?: string;
  diagnostics: {
    openaiKeyConfigured: boolean;
    model: string;
    symbol: string;
    pairContextLoaded: boolean;
    fundamentalsLoaded: boolean;
    promptSizeEstimate: number | null;
    pairAiTimeoutMs: number;
  };
  createdAt: string;
  updatedAt: string;
}

const jobs = new Map<string, PairAiJobRecord>();
const MAX_JOB_AGE_MS = 30 * 60_000;

function nowIso(): string {
  return new Date().toISOString();
}

function pruneJobs() {
  const cutoff = Date.now() - MAX_JOB_AGE_MS;
  for (const [jobId, job] of jobs) {
    if (new Date(job.updatedAt).getTime() < cutoff) jobs.delete(jobId);
  }
}

function updateJob(jobId: string, patch: Partial<PairAiJobRecord>) {
  const current = jobs.get(jobId);
  if (!current) return;
  jobs.set(jobId, {
    ...current,
    ...patch,
    diagnostics: {
      ...current.diagnostics,
      ...patch.diagnostics,
    },
    updatedAt: nowIso(),
  });
}

function defaultDiagnostics(symbol: string): PairAiJobRecord['diagnostics'] {
  return {
    openaiKeyConfigured: isOpenAIConfigured(),
    model: getOpenAIModel(),
    symbol,
    pairContextLoaded: false,
    fundamentalsLoaded: false,
    promptSizeEstimate: null,
    pairAiTimeoutMs: getPairAiTimeoutMs(),
  };
}

function formatTimedOutMessage(job: PairAiJobRecord): string {
  return job.diagnostics.pairContextLoaded && job.diagnostics.fundamentalsLoaded
    ? 'AI analysis timed out while waiting for OpenAI. Pair data and fundamentals loaded successfully, but the model response took too long. Try again or reduce analysis depth.'
    : 'AI analysis timed out before the full pair context finished loading. Try again in a moment.';
}

export async function createPairAiJob(symbol: string, forceRefresh = true): Promise<PairAiJobRecord> {
  pruneJobs();
  const normalizedSymbol = symbol.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const jobId = randomUUID();
  const initial: PairAiJobRecord = {
    jobId,
    symbol: normalizedSymbol,
    status: 'processing',
    stage: 'preparing_pair_snapshot',
    diagnostics: defaultDiagnostics(normalizedSymbol),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  jobs.set(jobId, initial);

  void (async () => {
    const startedAt = Date.now();
    try {
      const debug = await getPairAiDebugSnapshot(normalizedSymbol, { forceRefresh: false });
      updateJob(jobId, {
        diagnostics: {
          ...initial.diagnostics,
          pairContextLoaded: debug.pairContextLoaded,
          fundamentalsLoaded: debug.fundamentalsLoaded,
          promptSizeEstimate: debug.promptSizeEstimate,
        },
      });

      const analysis = await buildPairAnalysis(normalizedSymbol, {
        forceRefresh,
        allowLiveAI: true,
        preferSavedAi: false,
        onStageChange: (stage) => {
          updateJob(jobId, { stage });
        },
      });

      updateJob(jobId, {
        status: 'completed',
        stage: 'finalizing_verdict',
        analysis,
      });
    } catch (error) {
      const current = jobs.get(jobId) ?? initial;
      const err = error instanceof Error ? error : new Error(String(error));
      const durationMs = Date.now() - startedAt;
      console.error('[pair-ai] analysis failed', {
        symbol: normalizedSymbol,
        durationMs,
        errorName: err.name,
        errorMessage: err.message,
      });
      const timedOut = /timeout/i.test(err.name) || /timeout/i.test(err.message);
      updateJob(jobId, {
        status: 'failed',
        error: timedOut ? 'AI analysis timed out' : 'AI analysis failed',
        details: timedOut
          ? `OpenAI request exceeded ${current.diagnostics.pairAiTimeoutMs / 1000} seconds`
          : err.message,
      });
    }
  })();

  return initial;
}

export function getPairAiJob(jobId: string): PairAiJobRecord | null {
  const job = jobs.get(jobId);
  if (!job) return null;
  if (job.status === 'failed' && job.error === 'AI analysis timed out') {
    return {
      ...job,
      details: job.details ?? `OpenAI request exceeded ${job.diagnostics.pairAiTimeoutMs / 1000} seconds`,
      error: formatTimedOutMessage(job),
    };
  }
  return job;
}
