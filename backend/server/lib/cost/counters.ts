/**
 * In-memory operational counters for subscription-based providers.
 *
 * These counters reset when the server restarts. They are exposed via
 * /api/cost/summary alongside the DB-persisted ledger.
 */

interface ProviderCounters {
  requestCount: number;
  failedCount: number;
  lastActivityAt: string | null;
  symbolCounts: Record<string, number>;
}

const store: Record<string, ProviderCounters> = {
  twelvedata: { requestCount: 0, failedCount: 0, lastActivityAt: null, symbolCounts: {} },
  resend:     { requestCount: 0, failedCount: 0, lastActivityAt: null, symbolCounts: {} },
  metaapi:    { requestCount: 0, failedCount: 0, lastActivityAt: null, symbolCounts: {} },
};

function now() { return new Date().toISOString(); }

export function incrementTwelveData(symbol: string, failed = false): void {
  const c = store.twelvedata;
  c.requestCount++;
  if (failed) c.failedCount++;
  c.lastActivityAt = now();
  if (symbol) c.symbolCounts[symbol] = (c.symbolCounts[symbol] ?? 0) + 1;
}

export function incrementResend(failed = false): void {
  const c = store.resend;
  c.requestCount++;
  if (failed) c.failedCount++;
  c.lastActivityAt = now();
}

export function incrementMetaApi(failed = false): void {
  const c = store.metaapi;
  c.requestCount++;
  if (failed) c.failedCount++;
  c.lastActivityAt = now();
}

export function getTwelveDataCounters() { return { ...store.twelvedata }; }
export function getResendCounters()     { return { ...store.resend };     }
export function getMetaApiCounters()    { return { ...store.metaapi };    }
