"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPairAiJob = createPairAiJob;
exports.getPairAiJob = getPairAiJob;
const node_crypto_1 = require("node:crypto");
const pairAnalysis_service_js_1 = require("./pairAnalysis.service.js");
const openaiConfig_js_1 = require("../lib/openaiConfig.js");
const jobs = new Map();
const MAX_JOB_AGE_MS = 30 * 60_000;
function nowIso() {
    return new Date().toISOString();
}
function pruneJobs() {
    const cutoff = Date.now() - MAX_JOB_AGE_MS;
    for (const [jobId, job] of jobs) {
        if (new Date(job.updatedAt).getTime() < cutoff)
            jobs.delete(jobId);
    }
}
function updateJob(jobId, patch) {
    const current = jobs.get(jobId);
    if (!current)
        return;
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
function defaultDiagnostics(symbol) {
    return {
        openaiKeyConfigured: (0, openaiConfig_js_1.isOpenAIConfigured)(),
        model: (0, openaiConfig_js_1.getOpenAIModel)(),
        symbol,
        pairContextLoaded: false,
        fundamentalsLoaded: false,
        promptSizeEstimate: null,
        pairAiTimeoutMs: (0, openaiConfig_js_1.getPairAiTimeoutMs)(),
    };
}
function formatTimedOutMessage(job) {
    return job.diagnostics.pairContextLoaded && job.diagnostics.fundamentalsLoaded
        ? 'AI analysis timed out while waiting for OpenAI. Pair data and fundamentals loaded successfully, but the model response took too long. Try again or reduce analysis depth.'
        : 'AI analysis timed out before the full pair context finished loading. Try again in a moment.';
}
async function createPairAiJob(symbol, forceRefresh = true) {
    pruneJobs();
    const normalizedSymbol = symbol.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const jobId = (0, node_crypto_1.randomUUID)();
    const initial = {
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
            const debug = await (0, pairAnalysis_service_js_1.getPairAiDebugSnapshot)(normalizedSymbol, { forceRefresh: false });
            updateJob(jobId, {
                diagnostics: {
                    ...initial.diagnostics,
                    pairContextLoaded: debug.pairContextLoaded,
                    fundamentalsLoaded: debug.fundamentalsLoaded,
                    promptSizeEstimate: debug.promptSizeEstimate,
                },
            });
            const analysis = await (0, pairAnalysis_service_js_1.buildPairAnalysis)(normalizedSymbol, {
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
        }
        catch (error) {
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
function getPairAiJob(jobId) {
    const job = jobs.get(jobId);
    if (!job)
        return null;
    if (job.status === 'failed' && job.error === 'AI analysis timed out') {
        return {
            ...job,
            details: job.details ?? `OpenAI request exceeded ${job.diagnostics.pairAiTimeoutMs / 1000} seconds`,
            error: formatTimedOutMessage(job),
        };
    }
    return job;
}
