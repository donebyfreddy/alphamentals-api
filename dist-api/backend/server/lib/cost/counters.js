"use strict";
/**
 * In-memory operational counters for subscription-based providers.
 *
 * These counters reset when the server restarts. They are exposed via
 * /api/cost/summary alongside the DB-persisted ledger.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.incrementTwelveData = incrementTwelveData;
exports.incrementResend = incrementResend;
exports.incrementMetaApi = incrementMetaApi;
exports.getTwelveDataCounters = getTwelveDataCounters;
exports.getResendCounters = getResendCounters;
exports.getMetaApiCounters = getMetaApiCounters;
const store = {
    twelvedata: { requestCount: 0, failedCount: 0, lastActivityAt: null, symbolCounts: {} },
    resend: { requestCount: 0, failedCount: 0, lastActivityAt: null, symbolCounts: {} },
    metaapi: { requestCount: 0, failedCount: 0, lastActivityAt: null, symbolCounts: {} },
};
function now() { return new Date().toISOString(); }
function incrementTwelveData(symbol, failed = false) {
    const c = store.twelvedata;
    c.requestCount++;
    if (failed)
        c.failedCount++;
    c.lastActivityAt = now();
    if (symbol)
        c.symbolCounts[symbol] = (c.symbolCounts[symbol] ?? 0) + 1;
}
function incrementResend(failed = false) {
    const c = store.resend;
    c.requestCount++;
    if (failed)
        c.failedCount++;
    c.lastActivityAt = now();
}
function incrementMetaApi(failed = false) {
    const c = store.metaapi;
    c.requestCount++;
    if (failed)
        c.failedCount++;
    c.lastActivityAt = now();
}
function getTwelveDataCounters() { return { ...store.twelvedata }; }
function getResendCounters() { return { ...store.resend }; }
function getMetaApiCounters() { return { ...store.metaapi }; }
