"use strict";
/**
 * AI Diagnostics + Rate Limiter
 *
 * - Tracks requests per minute, cache hits/misses, last error, 429 cooldowns
 * - Provides a soft rate limiter that queues requests and respects 429 Retry-After headers
 * - Exposes a diagnostics snapshot for the /api/diagnostics endpoint
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordRequest = recordRequest;
exports.recordCacheHit = recordCacheHit;
exports.recordCacheMiss = recordCacheMiss;
exports.record429 = record429;
exports.recordError = recordError;
exports.clearCooldown = clearCooldown;
exports.isCoolingDown = isCoolingDown;
exports.canMakeRequest = canMakeRequest;
exports.msUntilNextSlot = msUntilNextSlot;
exports.getDiagnostics = getDiagnostics;
const MINUTE_MS = 60_000;
const MAX_RPM = Number(process.env.AI_MAX_REQUESTS_PER_MINUTE ?? '6');
const state = {
    requestTimestamps: [],
    totalRequests: 0,
    totalCacheHits: 0,
    totalCacheMisses: 0,
    last429At: null,
    cooldownUntil: null,
    lastErrorAt: null,
    lastError: null,
    lastRequestDurationMs: null,
    lastRequestAt: null,
    lastSymbolsBatched: [],
};
function pruneOldTimestamps() {
    const cutoff = Date.now() - MINUTE_MS;
    state.requestTimestamps = state.requestTimestamps.filter((t) => t > cutoff);
}
function recordRequest(symbols, durationMs) {
    const now = Date.now();
    state.requestTimestamps.push(now);
    state.totalRequests++;
    state.lastRequestAt = now;
    state.lastRequestDurationMs = durationMs;
    state.lastSymbolsBatched = symbols;
}
function recordCacheHit() {
    state.totalCacheHits++;
}
function recordCacheMiss() {
    state.totalCacheMisses++;
}
function record429(retryAfterSeconds) {
    const now = Date.now();
    state.last429At = now;
    const cooldownMs = retryAfterSeconds != null
        ? retryAfterSeconds * 1000
        : 60_000; // default 60s cooldown
    state.cooldownUntil = now + cooldownMs;
    console.warn(`[AI] 429 received — cooling down for ${Math.round(cooldownMs / 1000)}s`);
}
function recordError(err) {
    state.lastErrorAt = Date.now();
    state.lastError = err;
}
function clearCooldown() {
    state.cooldownUntil = null;
}
function isCoolingDown() {
    if (state.cooldownUntil == null)
        return false;
    if (Date.now() > state.cooldownUntil) {
        state.cooldownUntil = null;
        return false;
    }
    return true;
}
/** Returns false if we're over the per-minute limit or in cooldown. */
function canMakeRequest() {
    if (isCoolingDown())
        return false;
    pruneOldTimestamps();
    return state.requestTimestamps.length < MAX_RPM;
}
/** Milliseconds until the oldest in-window request ages out (i.e. slot opens). */
function msUntilNextSlot() {
    pruneOldTimestamps();
    if (state.requestTimestamps.length < MAX_RPM)
        return 0;
    if (isCoolingDown())
        return Math.max(0, (state.cooldownUntil ?? 0) - Date.now());
    const oldest = state.requestTimestamps[0];
    return Math.max(0, oldest + MINUTE_MS - Date.now());
}
function getDiagnostics() {
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
