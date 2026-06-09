import * as cache from './cache.js';

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

// Simple serial request queue to respect FRED rate limit (120 req/min)
let lastRequestAt = 0;
const MIN_INTERVAL_MS = 520; // ~115 req/min

async function throttle(): Promise<void> {
  const now = Date.now();
  const wait = MIN_INTERVAL_MS - (now - lastRequestAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

export interface FredObservation {
  date: string;       // YYYY-MM-DD
  value: number | null;
}

export interface FredSeriesResult {
  seriesId: string;
  observations: FredObservation[];
  available: boolean;
}

/**
 * Fetch the latest N observations for a FRED series.
 * Returns the most-recent observations first (sort_order=desc).
 */
export async function fetchFredSeries(
  seriesId: string,
  limit = 2,
  startDate?: string,
): Promise<FredSeriesResult> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) throw new Error('FRED_API_KEY not set');

  const cacheKey = `fred:${seriesId}:${limit}:${startDate ?? ''}`;
  const cached = cache.get<FredSeriesResult>(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: 'json',
    sort_order: 'desc',
    limit: String(limit),
  });
  if (startDate) params.set('observation_start', startDate);

  const url = `${FRED_BASE}?${params.toString()}`;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await throttle();
      const res = await fetch(url);

      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
      if (!res.ok) {
        const body = await res.text();
        // FRED returns 400 for unknown series
        if (res.status === 400 || res.status === 404) {
          const result: FredSeriesResult = { seriesId, observations: [], available: false };
          cache.set(cacheKey, result, CACHE_TTL_MS);
          return result;
        }
        throw new Error(`FRED HTTP ${res.status}: ${body}`);
      }

      const json = (await res.json()) as { observations: Array<{ date: string; value: string }> };
      const observations: FredObservation[] = json.observations
        .filter((o) => o.value !== '.')
        .map((o) => ({ date: o.date, value: parseFloat(o.value) }));

      const result: FredSeriesResult = { seriesId, observations, available: true };
      cache.set(cacheKey, result, CACHE_TTL_MS);
      return result;
    } catch (err) {
      lastErr = err;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw lastErr;
}

/** Return latest value and previous value from a series result. */
export function extractValues(result: FredSeriesResult): {
  current: number | null;
  previous: number | null;
} {
  if (!result.available || result.observations.length === 0) {
    return { current: null, previous: null };
  }
  const current = result.observations[0]?.value ?? null;
  const previous = result.observations[1]?.value ?? null;
  return { current, previous };
}

/**
 * Compute YoY change for monthly level series (e.g. CPI).
 * Fetches 13 observations so we have current + 12-months-ago.
 */
export async function fetchYoYChange(seriesId: string): Promise<{
  current: number | null;
  previous: number | null;
  yoy: number | null;
}> {
  const result = await fetchFredSeries(seriesId, 14);
  if (!result.available || result.observations.length < 13) {
    const { current, previous } = extractValues(result);
    return { current, previous, yoy: null };
  }
  const latest = result.observations[0].value;
  const yearAgo = result.observations[12].value;
  const prev = result.observations[1].value;
  const prevYearAgo = result.observations[13]?.value ?? null;

  const yoy = latest != null && yearAgo != null ? ((latest - yearAgo) / yearAgo) * 100 : null;
  const previousYoy =
    prev != null && prevYearAgo != null ? ((prev - prevYearAgo) / prevYearAgo) * 100 : null;

  return { current: yoy, previous: previousYoy, yoy };
}
