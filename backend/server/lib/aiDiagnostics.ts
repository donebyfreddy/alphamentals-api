/**
 * AI Diagnostics + Rate Limiter
 *
 * - Tracks requests per minute, cache hits/misses, last error, 429 cooldowns
 * - Provides a soft rate limiter that queues requests and respects 429 Retry-After headers
 * - Exposes a diagnostics snapshot for the /api/diagnostics endpoint
 */

export interface AIDiagnostics {
  provider: string;
  fastModel: string;
  deepModel: string;
  requestsThisMinute: number;
  maxRequestsPerMinute: number;
  totalRequests: number;
  totalCacheHits: number;
  totalCacheMisses: number;
  last429At: number | null;
  cooldownUntil: number | null;
  isCoolingDown: boolean;
  lastErrorAt: number | null;
  lastError: string | null;
  lastRequestDurationMs: number | null;
  lastRequestAt: number | null;
  lastSymbolsBatched: string[];
  cacheHitRate: string;
}

const MINUTE_MS = 60_000;
const MAX_RPM = Number(process.env.AI_MAX_REQUESTS_PER_MINUTE ?? '6');

const state = {
  requestTimestamps: [] as number[],
  totalRequests: 0,
  totalCacheHits: 0,
  totalCacheMisses: 0,
  last429At: null as number | null,
  cooldownUntil: null as number | null,
  lastErrorAt: null as number | null,
  lastError: null as string | null,
  lastRequestDurationMs: null as number | null,
  lastRequestAt: null as number | null,
  lastSymbolsBatched: [] as string[],
};

function pruneOldTimestamps() {
  const cutoff = Date.now() - MINUTE_MS;
  state.requestTimestamps = state.requestTimestamps.filter((t) => t > cutoff);
}

export function recordRequest(symbols: string[], durationMs: number) {
  const now = Date.now();
  state.requestTimestamps.push(now);
  state.totalRequests++;
  state.lastRequestAt = now;
  state.lastRequestDurationMs = durationMs;
  state.lastSymbolsBatched = symbols;
}

export function recordCacheHit() {
  state.totalCacheHits++;
}

export function recordCacheMiss() {
  state.totalCacheMisses++;
}

export function record429(retryAfterSeconds?: number) {
  const now = Date.now();
  state.last429At = now;
  const cooldownMs = retryAfterSeconds != null
    ? retryAfterSeconds * 1000
    : 60_000; // default 60s cooldown
  state.cooldownUntil = now + cooldownMs;
  console.warn(`[AI] 429 received — cooling down for ${Math.round(cooldownMs / 1000)}s`);
}

export function recordError(err: string) {
  state.lastErrorAt = Date.now();
  state.lastError = err;
}

export function clearCooldown() {
  state.cooldownUntil = null;
}

export function isCoolingDown(): boolean {
  if (state.cooldownUntil == null) return false;
  if (Date.now() > state.cooldownUntil) {
    state.cooldownUntil = null;
    return false;
  }
  return true;
}

/** Returns false if we're over the per-minute limit or in cooldown. */
export function canMakeRequest(): boolean {
  if (isCoolingDown()) return false;
  pruneOldTimestamps();
  return state.requestTimestamps.length < MAX_RPM;
}

/** Milliseconds until the oldest in-window request ages out (i.e. slot opens). */
export function msUntilNextSlot(): number {
  pruneOldTimestamps();
  if (state.requestTimestamps.length < MAX_RPM) return 0;
  if (isCoolingDown()) return Math.max(0, (state.cooldownUntil ?? 0) - Date.now());
  const oldest = state.requestTimestamps[0];
  return Math.max(0, oldest + MINUTE_MS - Date.now());
}

export function getDiagnostics(): AIDiagnostics {
  pruneOldTimestamps();
  const total = state.totalCacheHits + state.totalCacheMisses;
  return {
    provider: 'openai',
    fastModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    deepModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    requestsThisMinute: state.requestTimestamps.length,
    maxRequestsPerMinute: MAX_RPM,
    totalRequests: state.totalRequests,
    totalCacheHits: state.totalCacheHits,
    totalCacheMisses: state.totalCacheMisses,
    last429At: state.last429At,
    cooldownUntil: state.cooldownUntil,
    isCoolingDown: isCoolingDown(),
    lastErrorAt: state.lastErrorAt,
    lastError: state.lastError,
    lastRequestDurationMs: state.lastRequestDurationMs,
    lastRequestAt: state.lastRequestAt,
    lastSymbolsBatched: state.lastSymbolsBatched,
    cacheHitRate: total === 0 ? 'n/a' : `${Math.round((state.totalCacheHits / total) * 100)}%`,
  };
}
