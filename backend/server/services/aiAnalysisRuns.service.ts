import * as memCache from '../lib/cache.js';
import { buildPairAnalysis } from './pairAnalysis.service.js';
import { getFundamentalsOverview, refreshFundamentalsData } from './fundamentals.service.js';
import {
  createAiAnalysisRun,
  getAiAnalysisSymbols,
  getLatestSavedAiAnalysis,
  getLatestSavedAiAnalysisForSymbol,
  getLatestSuccessfulAiAnalysisRun,
  saveAiFundamentalsBatch,
  updateAiAnalysisRun,
  type AiAnalysisTriggerSource,
  type SavedAiAnalysisPayload,
  type SavedAiSymbolAnalysis,
} from './aiAnalysisStore.service.js';
import { normalizeApiSymbol } from '../../../src/services/pairs/symbolNormalizer.js';
import {
  getFundamentalsAiScheduleHours,
  getFundamentalsAiScheduleStatus,
  getFundamentalsAiTimezone,
  getNextFundamentalsAiRun,
} from './fundamentalsAiSchedule.service.js';

const PROVIDER = 'openai' as const;
const MANUAL_COOLDOWN_MS = 5 * 60_000;

function getAiAnalysisModel() {
  return process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
}

function getAiAnalysisTimezone() {
  return process.env.AI_ANALYSIS_TIMEZONE ?? getFundamentalsAiTimezone();
}

let inFlightRun: Promise<RunAiAnalysisResult> | null = null;
let inFlightSymbols: string[] = [];
let lastManualRunAt = 0;
const lastManualRunBySymbol = new Map<string, number>();
let lastSavedFallback: SavedAiAnalysisPayload | null = null;

export type AiRunStatus = 'idle' | 'running' | 'missing';
export type AiTrigger = 'manual' | 'cron' | 'startup';

export interface LatestAiAnalysisResponse {
  analysis: SavedAiAnalysisPayload | null;
  generatedAt: string | null;
  generatedTimezone: string | null;
  sourceDataTimestamp: string | null;
  triggerSource: AiAnalysisTriggerSource | null;
  provider: string | null;
  model: string | null;
  isStale: boolean;
  nextScheduledRun: string | null;
  status: AiRunStatus;
}

export interface SymbolAiAnalysisResponse {
  symbol: string;
  analysis: SavedAiSymbolAnalysis | null;
  generatedAt: string | null;
  generatedTimezone: string | null;
  sourceDataTimestamp: string | null;
  triggerSource: AiAnalysisTriggerSource | null;
  provider: string | null;
  model: string | null;
  isStale: boolean;
  nextScheduledRun: string | null;
  status: AiRunStatus;
}

export interface RunAiAnalysisResult {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  trigger: AiTrigger;
  triggerSource: AiAnalysisTriggerSource;
  provider: typeof PROVIDER;
  model: string;
  analysis: SavedAiAnalysisPayload | null;
  latestAvailable: SavedAiAnalysisPayload | null;
  symbols: string[];
  reusedExistingRun?: boolean;
  cooldownActive?: boolean;
  error?: string;
  timezone?: string;
  nextRun?: string | null;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(trimmed);
  }

  return output;
}

function normalizeAnalysisSymbols(symbols?: string[]) {
  const raw = symbols?.length ? symbols : getAiAnalysisSymbols();
  return [...new Set(raw.map((symbol) => normalizeApiSymbol(symbol)).filter(Boolean))];
}

function toCalendarRiskLevel(payload: Awaited<ReturnType<typeof buildPairAnalysis>>): 'low' | 'medium' | 'high' {
  if (payload.nextHighImpactEvent || payload.tradeStatus.status === 'high_risk') return 'high';
  if (payload.relevantEvents.some((event) => event.impact === 'high' || event.relevance === 'high')) return 'medium';
  return 'low';
}

function summarizeWatchEvents(payload: Awaited<ReturnType<typeof buildPairAnalysis>>) {
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

function deriveTradeMode(payload: Awaited<ReturnType<typeof buildPairAnalysis>>): SavedAiSymbolAnalysis['tradeMode'] {
  if (payload.fundamentals.tradeStatus === 'avoid') return 'avoid';
  if (payload.fundamentals.tradeStatus === 'wait') return 'wait';
  if (payload.tradeStatus.status === 'high_risk') return 'avoid';
  if (payload.intelligence.overallBias === 'bullish') return 'favor_buys';
  if (payload.intelligence.overallBias === 'bearish') return 'favor_sells';
  return 'wait';
}

function mapBias(value: string): SavedAiSymbolAnalysis['bias'] {
  return value === 'bullish' || value === 'bearish' ? value : 'neutral';
}

function toSavedSymbolAnalysis(
  payload: Awaited<ReturnType<typeof buildPairAnalysis>>,
  generatedAt: string,
  sourceDataTimestamp: string | null,
  triggerSource: AiAnalysisTriggerSource,
): SavedAiSymbolAnalysis {
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

function toSavedPayload(
  items: SavedAiSymbolAnalysis[],
  generatedAt: string,
  sourceDataTimestamp: string | null,
  triggerSource: AiAnalysisTriggerSource,
): SavedAiAnalysisPayload {
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

function zonedDateParts(date: Date) {
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

  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');
  const weekdayLabel = parts.find((part) => part.type === 'weekday')?.value ?? 'Mon';
  const weekdayMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
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

function utcDateForZonedTime(year: number, month: number, day: number, hour: number, minute: number, second = 0) {
  const approximateUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const local = zonedDateParts(approximateUtc);
  const actualMinutes = local.hour * 60 + local.minute;
  const targetMinutes = hour * 60 + minute;
  const diffMinutes = targetMinutes - actualMinutes;
  return new Date(approximateUtc.getTime() + diffMinutes * 60_000);
}

function deriveTriggerSource(trigger: AiTrigger, date = new Date()): AiAnalysisTriggerSource {
  if (trigger === 'manual') return 'manual';
  if (trigger === 'startup') return 'startup';
  const parts = zonedDateParts(date);
  if (parts.hour >= 15) return 'scheduled_15' as AiAnalysisTriggerSource;
  if (parts.hour >= 13) return 'scheduled_13' as AiAnalysisTriggerSource;
  return 'scheduled_07';
}

function computeNextScheduledRun(now = new Date()): string {
  return getNextFundamentalsAiRun(now).toISOString();
}

function computeIsStale(generatedAt: string | null, now = new Date()): boolean {
  if (!generatedAt) return true;
  const generated = new Date(generatedAt);
  if (Number.isNaN(generated.getTime())) return true;
  const currentParts = zonedDateParts(now);
  const scheduleHours = getFundamentalsAiScheduleHours();
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
  const latest = await getLatestSavedAiAnalysis();
  if (latest) lastSavedFallback = latest;
  return latest ?? lastSavedFallback;
}

function isSymbolInFlight(symbol: string) {
  const normalized = normalizeApiSymbol(symbol);
  return inFlightRun !== null && inFlightSymbols.includes(normalized);
}

function computeStatus(
  inflight: Promise<RunAiAnalysisResult> | null,
  analysis: SavedAiAnalysisPayload | null,
): AiRunStatus {
  if (inflight !== null) return 'running';
  if (analysis) return 'idle';
  return 'missing';
}

function invalidateAnalysisCaches() {
  memCache.delByPrefix('pair-intel-ai:');
  memCache.delByPrefix('tf-bias:');
}

async function getLatestSavedAnalysisForSymbols(symbols: string[]) {
  const rows = await Promise.all(symbols.map((symbol) => getLatestSavedAiAnalysisForSymbol(symbol)));
  return rows.filter((row): row is SavedAiSymbolAnalysis => Boolean(row));
}

export async function getLatestAiAnalysisResponse(): Promise<LatestAiAnalysisResponse> {
  const analysis = await loadLatestAvailable();
  const row = analysis ? null : await getLatestSuccessfulAiAnalysisRun();
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

export async function getLatestAiAnalysisForSymbolResponse(symbol: string): Promise<SymbolAiAnalysisResponse> {
  const normalized = normalizeApiSymbol(symbol);
  const analysis = await getLatestSavedAiAnalysisForSymbol(normalized);

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

export interface RunJobStatus {
  status: AiRunStatus;
  latestAvailable: SavedAiAnalysisPayload | null;
  generatedAt: string | null;
  symbols: string[];
}

export function getRunJobStatus(): RunJobStatus {
  return {
    status: computeStatus(inFlightRun, lastSavedFallback),
    latestAvailable: lastSavedFallback,
    generatedAt: lastSavedFallback?.generatedAt ?? null,
    symbols: [...inFlightSymbols],
  };
}

async function getManualCooldownState(symbols: string[]) {
  if (symbols.length === 1) {
    const symbol = symbols[0];
    const dbRow = await getLatestSavedAiAnalysisForSymbol(symbol).catch(() => null);
    const dbRunTime = dbRow?.generatedAt ? new Date(dbRow.generatedAt).getTime() : 0;
    const localRunTime = lastManualRunBySymbol.get(symbol) ?? 0;
    const effectiveLastRunAt = Math.max(dbRunTime, localRunTime);
    return { symbol, effectiveLastRunAt };
  }

  const dbRow = await getLatestSuccessfulAiAnalysisRun().catch(() => null);
  const dbRunTime = dbRow?.generated_at ? new Date(dbRow.generated_at).getTime() : 0;
  return { symbol: null, effectiveLastRunAt: Math.max(lastManualRunAt, dbRunTime) };
}

export async function runAiAnalysis(options: {
  trigger: AiTrigger;
  bypassCooldown?: boolean;
  symbols?: string[];
  skipSourceRefresh?: boolean;
}): Promise<RunAiAnalysisResult> {
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
        ? toSavedPayload(
            cachedRows,
            cachedRows.reduce((latest, row) => (
              new Date(row.generatedAt).getTime() > new Date(latest).getTime() ? row.generatedAt : latest
            ), cachedRows[0].generatedAt),
            cachedRows[0]?.sourceDataTimestamp ?? null,
            cachedRows[0]?.triggerSource ?? 'manual',
          )
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

  const runPromise = (async (): Promise<RunAiAnalysisResult> => {
    const latestAvailable = await loadLatestAvailable();
    const dbRun = await createAiAnalysisRun({
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

      const cachedOverview = getFundamentalsOverview();
      const overview = options.skipSourceRefresh && cachedOverview.lastUpdated
        ? cachedOverview
        : await refreshFundamentalsData({ triggeredBy: triggerSource });
      const results = await Promise.all(
        symbols.map((symbol) =>
          buildPairAnalysis(symbol, {
            preferSavedAi: false,
            allowLiveAI: true,
          }),
        ),
      );

      const generatedAt = new Date().toISOString();
      const items = results.map((payload) =>
        toSavedSymbolAnalysis(payload, generatedAt, overview.lastUpdated, triggerSource),
      );
      const analysis = toSavedPayload(items, generatedAt, overview.lastUpdated, triggerSource);

      await saveAiFundamentalsBatch({
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
        await updateAiAnalysisRun(dbRun.id, {
          status: 'success',
          analysis,
        });
      }

      if (options.trigger === 'manual') {
        lastManualRunAt = Date.now();
        for (const symbol of symbols) lastManualRunBySymbol.set(symbol, Date.now());
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (dbRun) {
        await updateAiAnalysisRun(dbRun.id, {
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
    } finally {
      inFlightRun = null;
      inFlightSymbols = [];
    }
  })();

  inFlightRun = runPromise;
  return runPromise;
}

export function canRunScheduledAiAnalysis(now = new Date()) {
  return getFundamentalsAiScheduleStatus(now);
}
