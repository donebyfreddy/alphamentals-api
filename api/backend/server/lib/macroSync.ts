import { fetchFredSeries, fetchYoYChange, extractValues } from './fred.js';
import {
  FRED_SERIES,
  DERIVED_INDICATORS,
  ALL_CURRENCIES,
  type Currency,
  type IndicatorType,
  type SeriesConfig,
} from './fredSeries.js';

type IndicatorValue = { current: number | null; previous: number | null; source: string };
type IndicatorMap = Record<string, IndicatorValue>;

async function fetchFromFred(config: SeriesConfig): Promise<IndicatorValue> {
  if (config.fetchMode === 'yoy') {
    const res = await fetchYoYChange(config.seriesId);
    return { current: res.current, previous: res.previous, source: res.current === null ? 'none' : 'FRED' };
  }
  const raw = await fetchFredSeries(config.seriesId, 2);
  const { current, previous } = extractValues(raw);
  return { current, previous, source: current === null ? 'none' : 'FRED' };
}

async function fetchWithFallback(config: SeriesConfig, currency: Currency): Promise<IndicatorValue> {
  try {
    const val = await fetchFromFred(config);
    if (val.current !== null) return val;
  } catch (err) {
    console.warn(`[macroSync] FRED ${currency}:${config.seriesId} failed:`, (err as Error).message);
  }

  if (!config.fallback) return { current: null, previous: null, source: 'none' };

  try {
    const fb = await config.fallback();
    if (fb.current !== null) {
      console.info(`[macroSync] ${currency}:${config.indicatorType} using fallback (${fb.source})`);
      return { current: fb.current, previous: fb.previous, source: fb.source };
    }
  } catch (err) {
    console.warn(`[macroSync] Fallback ${currency}:${config.indicatorType} failed:`, (err as Error).message);
  }

  return { current: null, previous: null, source: 'none' };
}

function applyDerived(currency: Currency, result: IndicatorMap): void {
  const derived = DERIVED_INDICATORS[currency] ?? [];
  const flatCurrents: Record<string, number | null> = Object.fromEntries(
    Object.entries(result).map(([k, v]) => [k, v.current]),
  );
  for (const d of derived) {
    if (result[d.indicatorType]?.current !== null) continue;
    const computed = d.compute(flatCurrents);
    if (computed !== null) {
      result[d.indicatorType] = { current: computed, previous: null, source: 'derived' };
    }
  }
}

export interface MacroCurrencySnapshot {
  interest_rate: number | null;
  inflation: number | null;
  core_inflation: number | null;
  yield_2y: number | null;
  yield_10y: number | null;
  real_yield_10y: number | null;
  yield_curve: number | null; // 10y - 2y
  unemployment: number | null;
  gdp_growth: number | null;
}

export type MacroSnapshot = Record<Currency, MacroCurrencySnapshot>;

// In-memory store — no database needed.
let cachedSnapshot: MacroSnapshot | null = null;
let lastSyncedAt: number | null = null;

export function getCachedSnapshot(): MacroSnapshot | null {
  return cachedSnapshot;
}

export function getLastSyncedAt(): number | null {
  return lastSyncedAt;
}

function computeYieldCurve(y10: number | null, y2: number | null): number | null {
  if (y10 == null || y2 == null) return null;
  return Number.parseFloat((y10 - y2).toFixed(4));
}

/**
 * Fetch all indicators for one currency.
 * Priority: FRED → configured local fallback → null.
 * Returns a flat map of indicatorType → { current, previous, source }.
 */
async function fetchCurrencyIndicators(currency: Currency): Promise<
  Record<IndicatorType, { current: number | null; previous: number | null; source: string }>
> {
  const series = FRED_SERIES[currency] ?? [];
  const result: Record<string, { current: number | null; previous: number | null; source: string }> = {};

  for (const config of series) {
    let current: number | null = null;
    let previous: number | null = null;
    let source = 'none';

    // 1. Try FRED
    try {
      if (config.fetchMode === 'yoy') {
        const res = await fetchYoYChange(config.seriesId);
        current = res.current;
        previous = res.previous;
      } else {
        const raw = await fetchFredSeries(config.seriesId, 2);
        ({ current, previous } = extractValues(raw));
      }
      if (current !== null) source = 'FRED';
    } catch (err) {
      console.warn(`[macroSync] FRED ${currency}:${config.seriesId} failed:`, (err as Error).message);
    }

    // 2. Try fallback if FRED yielded nothing
    if (current === null && config.fallback) {
      try {
        const fb = await config.fallback();
        current = fb.current;
        previous = fb.previous;
        if (current !== null) {
          source = fb.source;
          console.info(`[macroSync] ${currency}:${config.indicatorType} using fallback (${source})`);
        }
      } catch (err) {
        console.warn(`[macroSync] Fallback ${currency}:${config.indicatorType} failed:`, (err as Error).message);
      }
    }

    result[config.indicatorType] = { current, previous, source };
  }

  // 3. Derived indicators (e.g. real yield = nominal - inflation) when primary is still null
  const derived = DERIVED_INDICATORS[currency] ?? [];
  for (const d of derived) {
    if (result[d.indicatorType]?.current !== null) continue;
    const flatCurrents: Record<string, number | null> = {};
    for (const [k, v] of Object.entries(result)) flatCurrents[k] = v.current;
    const computed = d.compute(flatCurrents);
    if (computed !== null) {
      result[d.indicatorType] = { current: computed, previous: null, source: 'derived' };
    }
  }

  return result as Record<IndicatorType, { current: number | null; previous: number | null; source: string }>;
}

/**
 * Fetch all macro indicators for all currencies and store in memory.
 */
export async function syncMacroIndicators(): Promise<MacroSnapshot> {
  console.log('[macroSync] Starting sync…');
  const snapshot: Partial<MacroSnapshot> = {};

  for (const currency of ALL_CURRENCIES) {
    console.log(`[macroSync] Fetching ${currency}…`);
    const indicators = await fetchCurrencyIndicators(currency);

    const y10 = indicators.yield_10y?.current ?? null;
    const y2  = indicators.yield_2y?.current ?? null;

    snapshot[currency] = {
      interest_rate:   indicators.interest_rate?.current   ?? null,
      inflation:       indicators.inflation?.current       ?? null,
      core_inflation:  indicators.core_inflation?.current  ?? null,
      yield_2y:        y2,
      yield_10y:       y10,
      real_yield_10y:  indicators.real_yield_10y?.current  ?? null,
      yield_curve:     computeYieldCurve(y10, y2),
      unemployment:    indicators.unemployment?.current    ?? null,
      gdp_growth:      indicators.gdp_growth?.current      ?? null,
    };
  }

  cachedSnapshot = snapshot as MacroSnapshot;
  lastSyncedAt = Date.now();
  console.log('[macroSync] Sync complete.');
  return cachedSnapshot;
}

/**
 * Return the in-memory snapshot (fast path — no external calls).
 * Throws if sync has never run.
 */
export function getMacroSnapshot(): MacroSnapshot {
  if (cachedSnapshot === null) {
    throw new Error('Macro data not yet available — sync in progress');
  }
  return cachedSnapshot;
}
