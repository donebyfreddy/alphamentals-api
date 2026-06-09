"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLatestAiAnalysisResponse = getLatestAiAnalysisResponse;
exports.getLatestAiAnalysisForSymbolResponse = getLatestAiAnalysisForSymbolResponse;
exports.getRunJobStatus = getRunJobStatus;
exports.runAiAnalysis = runAiAnalysis;
exports.canRunScheduledAiAnalysis = canRunScheduledAiAnalysis;
const memCache = __importStar(require("../lib/cache.js"));
const pairAnalysis_service_js_1 = require("./pairAnalysis.service.js");
const fundamentals_service_js_1 = require("./fundamentals.service.js");
const aiAnalysisStore_service_js_1 = require("./aiAnalysisStore.service.js");
const symbolNormalizer_js_1 = require("../../../src/services/pairs/symbolNormalizer.js");
const fundamentalsAiSchedule_service_js_1 = require("./fundamentalsAiSchedule.service.js");
const PROVIDER = 'openai';
const MANUAL_COOLDOWN_MS = 5 * 60_000;
function getAiAnalysisModel() {
    return process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
}
function getAiAnalysisTimezone() {
    return process.env.AI_ANALYSIS_TIMEZONE ?? (0, fundamentalsAiSchedule_service_js_1.getFundamentalsAiTimezone)();
}
let inFlightRun = null;
let inFlightSymbols = [];
let lastManualRunAt = 0;
const lastManualRunBySymbol = new Map();
let lastSavedFallback = null;
function uniqueStrings(values) {
    const seen = new Set();
    const output = [];
    for (const value of values) {
        const trimmed = typeof value === 'string' ? value.trim() : '';
        if (!trimmed)
            continue;
        const key = trimmed.toLowerCase();
        if (seen.has(key))
            continue;
        seen.add(key);
        output.push(trimmed);
    }
    return output;
}
function normalizeAnalysisSymbols(symbols) {
    const raw = symbols?.length ? symbols : (0, aiAnalysisStore_service_js_1.getAiAnalysisSymbols)();
    return [...new Set(raw.map((symbol) => (0, symbolNormalizer_js_1.normalizeApiSymbol)(symbol)).filter(Boolean))];
}
function toCalendarRiskLevel(payload) {
    if (payload.nextHighImpactEvent || payload.tradeStatus.status === 'high_risk')
        return 'high';
    if (payload.relevantEvents.some((event) => event.impact === 'high' || event.relevance === 'high'))
        return 'medium';
    return 'low';
}
function summarizeWatchEvents(payload) {
    return uniqueStrings([
        ...payload.relevantEvents
            .filter((event) => event.impact === 'high')
            .slice(0, 4)
            .map((event) => {
            const when = event.minutesUntil >= 0 ? ` in ${event.minutesUntil}m` : '';
            return `${event.currency ?? 'Macro'} ${event.eventName}${when}`;
        }),
        ...payload.topRelevantNews.slice(0, 2).map((item) => item.title),
    ]);
}
function deriveTradeMode(payload) {
    if (payload.fundamentals.tradeStatus === 'avoid')
        return 'avoid';
    if (payload.fundamentals.tradeStatus === 'wait')
        return 'wait';
    if (payload.tradeStatus.status === 'high_risk')
        return 'avoid';
    if (payload.intelligence.overallBias === 'bullish')
        return 'favor_buys';
    if (payload.intelligence.overallBias === 'bearish')
        return 'favor_sells';
    return 'wait';
}
function mapBias(value) {
    return value === 'bullish' || value === 'bearish' ? value : 'neutral';
}
function toSavedSymbolAnalysis(payload, generatedAt, sourceDataTimestamp, triggerSource) {
    const bias = mapBias(payload.intelligence.overallBias);
    const macroBias = mapBias(payload.intelligence.fundamentalBias.direction);
    const calendarRisk = toCalendarRiskLevel(payload);
    const watchEvents = summarizeWatchEvents(payload);
    const macroDrivers = uniqueStrings([
        ...payload.fundamentals.keyDrivers,
        ...payload.macroFocus,
        ...payload.fundamentalDriversList,
        ...payload.intelligence.bullishDrivers,
        ...payload.intelligence.bearishDrivers,
    ]).slice(0, 8);
    const riskFactors = uniqueStrings([
        ...payload.intelligence.risks,
        ...payload.fundamentals.risks,
    ]).slice(0, 6);
    return {
        symbol: payload.symbol,
        pairName: payload.displayName,
        provider: PROVIDER,
        model: getAiAnalysisModel(),
        bias,
        tradeMode: deriveTradeMode(payload),
        confidence: Math.max(0, Math.min(100, payload.intelligence.biasPercentage)),
        calendarRisk,
        decisionSummary: payload.intelligence.summary || payload.fundamentals.summary,
        technicalSummary: payload.technical.summary,
        fundamentalSummary: payload.fundamentals.summary,
        macroDrivers,
        watchEvents,
        riskFactors,
        generatedAt,
        generatedTimezone: getAiAnalysisTimezone(),
        sourceDataTimestamp,
        triggerSource,
        isLatest: true,
        summary: payload.intelligence.summary || payload.fundamentals.summary,
        macroFundamentals: {
            bias: macroBias,
            drivers: macroDrivers,
            reasoning: payload.intelligence.fundamentalBias.summary || payload.fundamentals.summary,
        },
        economicCalendarImpact: {
            highImpactEvents: watchEvents,
            expectedEffect: payload.newsImpactSummary.summary || payload.intelligence.summary,
            riskLevel: calendarRisk,
        },
        keyRisks: riskFactors,
    };
}
function toSavedPayload(items, generatedAt, sourceDataTimestamp, triggerSource) {
    return {
        ok: true,
        provider: PROVIDER,
        model: getAiAnalysisModel(),
        generatedAt,
        generatedTimezone: getAiAnalysisTimezone(),
        sourceDataTimestamp,
        triggerSource,
        symbols: Object.fromEntries(items.map((item) => [item.symbol, item])),
    };
}
function zonedDateParts(date) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: getAiAnalysisTimezone(),
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        weekday: 'short',
        hourCycle: 'h23',
    }).formatToParts(date);
    const get = (type) => Number(parts.find((part) => part.type === type)?.value ?? '0');
    const weekdayLabel = parts.find((part) => part.type === 'weekday')?.value ?? 'Mon';
    const weekdayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    return {
        year: get('year'),
        month: get('month'),
        day: get('day'),
        hour: get('hour'),
        minute: get('minute'),
        second: get('second'),
        weekday: weekdayMap[weekdayLabel] ?? 1,
    };
}
function utcDateForZonedTime(year, month, day, hour, minute, second = 0) {
    const approximateUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    const local = zonedDateParts(approximateUtc);
    const actualMinutes = local.hour * 60 + local.minute;
    const targetMinutes = hour * 60 + minute;
    const diffMinutes = targetMinutes - actualMinutes;
    return new Date(approximateUtc.getTime() + diffMinutes * 60_000);
}
function deriveTriggerSource(trigger, date = new Date()) {
    if (trigger === 'manual')
        return 'manual';
    if (trigger === 'startup')
        return 'startup';
    const parts = zonedDateParts(date);
    if (parts.hour >= 15)
        return 'scheduled_15';
    if (parts.hour >= 13)
        return 'scheduled_13';
    return 'scheduled_07';
}
function computeNextScheduledRun(now = new Date()) {
    return (0, fundamentalsAiSchedule_service_js_1.getNextFundamentalsAiRun)(now).toISOString();
}
function computeIsStale(generatedAt, now = new Date()) {
    if (!generatedAt)
        return true;
    const generated = new Date(generatedAt);
    if (Number.isNaN(generated.getTime()))
        return true;
    const currentParts = zonedDateParts(now);
    const scheduleHours = (0, fundamentalsAiSchedule_service_js_1.getFundamentalsAiScheduleHours)();
    const latestSlotToday = [...scheduleHours].reverse().find((hour) => currentParts.hour >= hour);
    if (latestSlotToday == null) {
        const previousDay = new Date(now.getTime() - 24 * 60 * 60_000);
        let cursor = previousDay;
        for (let i = 0; i < 7; i += 1) {
            const prev = zonedDateParts(cursor);
            if (prev.weekday >= 1 && prev.weekday <= 5) {
                const lastHour = scheduleHours[scheduleHours.length - 1] ?? 15;
                const previousExpected = utcDateForZonedTime(prev.year, prev.month, prev.day, lastHour, 0);
                return generated.getTime() < previousExpected.getTime();
            }
            cursor = new Date(cursor.getTime() - 24 * 60 * 60_000);
        }
        return true;
    }
    const latestExpected = utcDateForZonedTime(currentParts.year, currentParts.month, currentParts.day, latestSlotToday, 0);
    return generated.getTime() < latestExpected.getTime();
}
async function loadLatestAvailable() {
    const latest = await (0, aiAnalysisStore_service_js_1.getLatestSavedAiAnalysis)();
    if (latest)
        lastSavedFallback = latest;
    return latest ?? lastSavedFallback;
}
function isSymbolInFlight(symbol) {
    const normalized = (0, symbolNormalizer_js_1.normalizeApiSymbol)(symbol);
    return inFlightRun !== null && inFlightSymbols.includes(normalized);
}
function computeStatus(inflight, analysis) {
    if (inflight !== null)
        return 'running';
    if (analysis)
        return 'idle';
    return 'missing';
}
function invalidateAnalysisCaches() {
    memCache.delByPrefix('pair-intel-ai:');
    memCache.delByPrefix('tf-bias:');
}
async function getLatestSavedAnalysisForSymbols(symbols) {
    const rows = await Promise.all(symbols.map((symbol) => (0, aiAnalysisStore_service_js_1.getLatestSavedAiAnalysisForSymbol)(symbol)));
    return rows.filter((row) => Boolean(row));
}
async function getLatestAiAnalysisResponse() {
    const analysis = await loadLatestAvailable();
    const row = analysis ? null : await (0, aiAnalysisStore_service_js_1.getLatestSuccessfulAiAnalysisRun)();
    const generatedAt = analysis?.generatedAt ?? row?.generated_at ?? null;
    return {
        analysis,
        generatedAt,
        generatedTimezone: analysis?.generatedTimezone ?? null,
        sourceDataTimestamp: analysis?.sourceDataTimestamp ?? null,
        triggerSource: analysis?.triggerSource ?? null,
        provider: analysis?.provider ?? row?.provider ?? null,
        model: analysis?.model ?? row?.model ?? null,
        isStale: computeIsStale(generatedAt),
        nextScheduledRun: computeNextScheduledRun(),
        status: computeStatus(inFlightRun, analysis),
    };
}
async function getLatestAiAnalysisForSymbolResponse(symbol) {
    const normalized = (0, symbolNormalizer_js_1.normalizeApiSymbol)(symbol);
    const analysis = await (0, aiAnalysisStore_service_js_1.getLatestSavedAiAnalysisForSymbol)(normalized);
    return {
        symbol: normalized,
        analysis,
        generatedAt: analysis?.generatedAt ?? null,
        generatedTimezone: analysis?.generatedTimezone ?? null,
        sourceDataTimestamp: analysis?.sourceDataTimestamp ?? null,
        triggerSource: analysis?.triggerSource ?? null,
        provider: analysis?.provider ?? null,
        model: analysis?.model ?? null,
        isStale: computeIsStale(analysis?.generatedAt ?? null),
        nextScheduledRun: computeNextScheduledRun(),
        status: isSymbolInFlight(normalized) ? 'running' : analysis ? 'idle' : 'missing',
    };
}
function getRunJobStatus() {
    return {
        status: computeStatus(inFlightRun, lastSavedFallback),
        latestAvailable: lastSavedFallback,
        generatedAt: lastSavedFallback?.generatedAt ?? null,
        symbols: [...inFlightSymbols],
    };
}
async function getManualCooldownState(symbols) {
    if (symbols.length === 1) {
        const symbol = symbols[0];
        const dbRow = await (0, aiAnalysisStore_service_js_1.getLatestSavedAiAnalysisForSymbol)(symbol).catch(() => null);
        const dbRunTime = dbRow?.generatedAt ? new Date(dbRow.generatedAt).getTime() : 0;
        const localRunTime = lastManualRunBySymbol.get(symbol) ?? 0;
        const effectiveLastRunAt = Math.max(dbRunTime, localRunTime);
        return { symbol, effectiveLastRunAt };
    }
    const dbRow = await (0, aiAnalysisStore_service_js_1.getLatestSuccessfulAiAnalysisRun)().catch(() => null);
    const dbRunTime = dbRow?.generated_at ? new Date(dbRow.generated_at).getTime() : 0;
    return { symbol: null, effectiveLastRunAt: Math.max(lastManualRunAt, dbRunTime) };
}
async function runAiAnalysis(options) {
    const startedAt = new Date().toISOString();
    const triggerSource = deriveTriggerSource(options.trigger, new Date(startedAt));
    const symbols = normalizeAnalysisSymbols(options.symbols);
    if (inFlightRun !== null) {
        return {
            ...(await inFlightRun),
            reusedExistingRun: true,
        };
    }
    if (options.trigger === 'manual' && !options.bypassCooldown) {
        const { effectiveLastRunAt } = await getManualCooldownState(symbols);
        const msSinceLastRun = Date.now() - effectiveLastRunAt;
        if (msSinceLastRun < MANUAL_COOLDOWN_MS) {
            const cachedRows = await getLatestSavedAnalysisForSymbols(symbols);
            const cachedAnalysis = cachedRows.length
                ? toSavedPayload(cachedRows, cachedRows.reduce((latest, row) => (new Date(row.generatedAt).getTime() > new Date(latest).getTime() ? row.generatedAt : latest), cachedRows[0].generatedAt), cachedRows[0]?.sourceDataTimestamp ?? null, cachedRows[0]?.triggerSource ?? 'manual')
                : (await loadLatestAvailable()) ?? null;
            const expiresInSec = Math.round((MANUAL_COOLDOWN_MS - msSinceLastRun) / 1000);
            console.info('[ai-analysis] cooldown hit', {
                model: getAiAnalysisModel(),
                symbols: symbols.join(', '),
                expiresIn: `${expiresInSec}s`,
            });
            return {
                ok: true,
                startedAt,
                finishedAt: new Date().toISOString(),
                trigger: options.trigger,
                triggerSource,
                provider: PROVIDER,
                model: getAiAnalysisModel(),
                analysis: cachedAnalysis,
                latestAvailable: cachedAnalysis,
                symbols,
                cooldownActive: true,
                reusedExistingRun: true,
                error: 'Manual AI analysis cooldown is active. Please wait a few minutes before running it again.',
                timezone: getAiAnalysisTimezone(),
                nextRun: computeNextScheduledRun(),
            };
        }
    }
    inFlightSymbols = symbols;
    const runPromise = (async () => {
        const latestAvailable = await loadLatestAvailable();
        const dbRun = await (0, aiAnalysisStore_service_js_1.createAiAnalysisRun)({
            provider: PROVIDER,
            model: getAiAnalysisModel(),
            triggerSource: options.trigger,
            symbols,
        }).catch((error) => {
            console.warn('[ai-analysis] failed to create DB run row:', error instanceof Error ? error.message : String(error));
            return null;
        });
        try {
            if (!process.env.OPENAI_API_KEY) {
                throw new Error('OPENAI_API_KEY is not configured.');
            }
            console.info('[ai-analysis] run started', {
                provider: PROVIDER,
                model: getAiAnalysisModel(),
                trigger: options.trigger,
                triggerSource,
                symbols: symbols.join(', '),
            });
            const cachedOverview = (0, fundamentals_service_js_1.getFundamentalsOverview)();
            const overview = options.skipSourceRefresh && cachedOverview.lastUpdated
                ? cachedOverview
                : await (0, fundamentals_service_js_1.refreshFundamentalsData)({ triggeredBy: triggerSource });
            const results = await Promise.all(symbols.map((symbol) => (0, pairAnalysis_service_js_1.buildPairAnalysis)(symbol, {
                preferSavedAi: false,
                allowLiveAI: true,
            })));
            const generatedAt = new Date().toISOString();
            const items = results.map((payload) => toSavedSymbolAnalysis(payload, generatedAt, overview.lastUpdated, triggerSource));
            const analysis = toSavedPayload(items, generatedAt, overview.lastUpdated, triggerSource);
            await (0, aiAnalysisStore_service_js_1.saveAiFundamentalsBatch)({
                runId: dbRun?.id ?? null,
                provider: PROVIDER,
                model: getAiAnalysisModel(),
                generatedAt,
                generatedTimezone: getAiAnalysisTimezone(),
                sourceDataTimestamp: overview.lastUpdated,
                triggerSource,
                items,
            });
            const fullLatest = await loadLatestAvailable();
            lastSavedFallback = fullLatest ?? analysis;
            invalidateAnalysisCaches();
            if (dbRun) {
                await (0, aiAnalysisStore_service_js_1.updateAiAnalysisRun)(dbRun.id, {
                    status: 'success',
                    analysis,
                });
            }
            if (options.trigger === 'manual') {
                lastManualRunAt = Date.now();
                for (const symbol of symbols)
                    lastManualRunBySymbol.set(symbol, Date.now());
            }
            console.info('[ai-analysis] run completed', {
                provider: PROVIDER,
                model: getAiAnalysisModel(),
                trigger: options.trigger,
                triggerSource,
                generatedAt,
                symbolsProcessed: items.length,
            });
            return {
                ok: true,
                startedAt,
                finishedAt: new Date().toISOString(),
                trigger: options.trigger,
                triggerSource,
                provider: PROVIDER,
                model: getAiAnalysisModel(),
                analysis,
                latestAvailable: fullLatest ?? analysis,
                symbols,
                timezone: getAiAnalysisTimezone(),
                nextRun: computeNextScheduledRun(),
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (dbRun) {
                await (0, aiAnalysisStore_service_js_1.updateAiAnalysisRun)(dbRun.id, {
                    status: 'failed',
                    errorMessage: message,
                }).catch(() => undefined);
            }
            console.warn('[ai-analysis] run failed', {
                provider: PROVIDER,
                model: getAiAnalysisModel(),
                trigger: options.trigger,
                triggerSource,
                symbols: symbols.join(', '),
                error: message,
            });
            return {
                ok: false,
                startedAt,
                finishedAt: new Date().toISOString(),
                trigger: options.trigger,
                triggerSource,
                provider: PROVIDER,
                model: getAiAnalysisModel(),
                analysis: null,
                latestAvailable,
                symbols,
                error: message,
                timezone: getAiAnalysisTimezone(),
                nextRun: computeNextScheduledRun(),
            };
        }
        finally {
            inFlightRun = null;
            inFlightSymbols = [];
        }
    })();
    inFlightRun = runPromise;
    return runPromise;
}
function canRunScheduledAiAnalysis(now = new Date()) {
    return (0, fundamentalsAiSchedule_service_js_1.getFundamentalsAiScheduleStatus)(now);
}
