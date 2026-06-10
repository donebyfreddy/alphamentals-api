/**
 * Price snapshot — computes real price movement from MT5 data.
 *
 * Current price comes from the live MT5 feed (EA tick or bridge quote).
 * The reference price comes from MT5 D1 candles, in priority order:
 *   1. previous daily close (yesterday's D1 close)
 *   2. today's session open (current D1 open)
 *   3. first candle of the day
 *   4. last cached close
 *
 * Never uses the current price as its own reference (which produced +0.00%).
 */

import { getLatestMarketPrice } from '../../../src/server/marketDataService.js';
import { getMt5Candles } from './mt5Candles.service.js';

export type PriceReferenceType = 'previous_close' | 'session_open' | 'first_tick' | 'cached_close';

export interface PriceSnapshot {
  ok: boolean;
  symbol: string;
  price: number | null;
  bid: number | null;
  ask: number | null;
  source: 'mt5-ea' | 'mt5-python-bridge' | null;
  lastTickAt: string | null;
  referencePrice: number | null;
  referenceType: PriceReferenceType | null;
  absoluteChange: number | null;
  percentChange: number | null;
  spread: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  error?: string;
  message?: string;
}

function classifySource(provider: string | undefined): PriceSnapshot['source'] {
  if (!provider) return null;
  const p = provider.toLowerCase();
  if (p.includes('ea')) return 'mt5-ea';
  if (p.includes('bridge') || p.includes('python') || p.includes('mt5')) return 'mt5-python-bridge';
  return 'mt5-python-bridge';
}

export async function buildPriceSnapshot(
  symbol: string,
  options?: { forceRefresh?: boolean },
): Promise<PriceSnapshot> {
  const compact = symbol.replace(/[/\s]/g, '').toUpperCase();

  const empty: PriceSnapshot = {
    ok: false,
    symbol: compact,
    price: null,
    bid: null,
    ask: null,
    source: null,
    lastTickAt: null,
    referencePrice: null,
    referenceType: null,
    absoluteChange: null,
    percentChange: null,
    spread: null,
    dayHigh: null,
    dayLow: null,
  };

  // 1. Live price from MT5 (EA tick or bridge quote)
  const live = await getLatestMarketPrice(compact);
  const price = live?.price ?? live?.bid ?? null;

  if (price == null) {
    return {
      ...empty,
      error: 'PRICE_UNAVAILABLE',
      message: `No live MT5 price for ${compact}. Ensure the EA is sending ticks or the MT5 bridge is reachable.`,
    };
  }

  const source = classifySource(live?.provider);
  const bid = live?.bid ?? null;
  const ask = live?.ask ?? null;
  const spread = bid != null && ask != null ? ask - bid : null;

  // 2. Reference price from MT5 D1 candles
  let referencePrice: number | null = null;
  let referenceType: PriceReferenceType | null = null;
  let dayHigh: number | null = null;
  let dayLow: number | null = null;

  try {
    const d1 = await getMt5Candles(compact, 'D1', { count: 10, forceRefresh: options?.forceRefresh });
    if (d1.status === 'ok' || d1.candles.length >= 2) {
      const candles = d1.candles;
      const today = candles[candles.length - 1];
      const prev = candles[candles.length - 2];

      dayHigh = today?.high ?? null;
      dayLow = today?.low ?? null;

      if (prev?.close != null) {
        referencePrice = prev.close;
        referenceType = 'previous_close';
      } else if (today?.open != null) {
        referencePrice = today.open;
        referenceType = 'session_open';
      } else if (today?.close != null) {
        referencePrice = today.close;
        referenceType = 'cached_close';
      }
    }
  } catch (err) {
    console.warn(`[price-snapshot] ${compact} D1 reference fetch failed:`, err instanceof Error ? err.message : err);
  }

  if (referencePrice == null || referencePrice === 0) {
    return {
      ...empty,
      price,
      bid,
      ask,
      source,
      spread,
      lastTickAt: live?.timestamp ?? null,
      error: 'PRICE_REFERENCE_MISSING',
      message: 'Movement unavailable: missing MT5 previous close/session open. Open the D1 chart in MT5 to download history.',
    };
  }

  const absoluteChange = price - referencePrice;
  const percentChange = (absoluteChange / referencePrice) * 100;

  return {
    ok: true,
    symbol: compact,
    price,
    bid,
    ask,
    source,
    lastTickAt: live?.timestamp ?? null,
    referencePrice,
    referenceType,
    absoluteChange,
    percentChange,
    spread,
    dayHigh,
    dayLow,
  };
}
