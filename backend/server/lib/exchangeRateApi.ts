/**
 * ExchangeRate-API client (EXCHANGE_RATE_API_KEY).
 * https://www.exchangerate-api.com/docs
 *
 * Free plan: 1 500 requests/month, updates daily.
 * Used for broad multi-currency spot rates with long cache windows.
 */

import * as cache from './cache.js';

const ERA_BASE = 'https://v6.exchangerate-api.com/v6';

// Cache full rate tables for 1 hour (API updates daily; no need to hit it more often)
const TABLE_TTL_MS = 60 * 60_000;

interface ERAResponse {
  result: string;
  base_code: string;
  conversion_rates: Record<string, number>;
  time_last_update_utc: string;
}

async function fetchRateTable(baseCurrency: string): Promise<ERAResponse> {
  const apiKey = process.env.EXCHANGE_RATE_API_KEY;
  if (!apiKey) throw new Error('EXCHANGE_RATE_API_KEY not set');

  const cacheKey = `era:${baseCurrency}`;
  const cached = cache.get<ERAResponse>(cacheKey);
  if (cached) return cached;

  const url = `${ERA_BASE}/${apiKey}/latest/${baseCurrency.toUpperCase()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ExchangeRate-API HTTP ${res.status}`);

  const data = (await res.json()) as ERAResponse;
  if (data.result !== 'success') throw new Error(`ExchangeRate-API error: ${data.result}`);

  cache.set(cacheKey, data, TABLE_TTL_MS);
  return data;
}

export interface SpotRate {
  from: string;
  to: string;
  rate: number;
  lastUpdated: string;
}

/**
 * Get a single spot rate.
 */
export async function getSpotRate(from: string, to: string): Promise<SpotRate> {
  const table = await fetchRateTable(from.toUpperCase());
  const rate = table.conversion_rates[to.toUpperCase()];
  if (rate == null) throw new Error(`Currency ${to} not found in rate table`);
  return { from: from.toUpperCase(), to: to.toUpperCase(), rate, lastUpdated: table.time_last_update_utc };
}

/**
 * Get all major forex pair rates relative to a base currency.
 * Returns the full conversion_rates map.
 */
export async function getAllRates(baseCurrency = 'USD'): Promise<Record<string, number>> {
  const table = await fetchRateTable(baseCurrency.toUpperCase());
  return table.conversion_rates;
}

/** The forex pairs this app tracks. */
export const TRACKED_FOREX_PAIRS = [
  { from: 'EUR', to: 'USD' },
  { from: 'GBP', to: 'USD' },
  { from: 'USD', to: 'JPY' },
  { from: 'USD', to: 'CHF' },
  { from: 'AUD', to: 'USD' },
  { from: 'USD', to: 'CAD' },
  { from: 'NZD', to: 'USD' },
  { from: 'EUR', to: 'GBP' },
  { from: 'EUR', to: 'JPY' },
  { from: 'GBP', to: 'JPY' },
  { from: 'EUR', to: 'CHF' },
  { from: 'AUD', to: 'JPY' },
];

/**
 * Fetch all tracked pair rates in two calls (USD base + EUR base).
 * Efficient: one API call covers all USD-quoted pairs.
 */
export async function getTrackedPairRates(): Promise<SpotRate[]> {
  const [usdTable, eurTable] = await Promise.all([
    fetchRateTable('USD'),
    fetchRateTable('EUR'),
  ]);

  return TRACKED_FOREX_PAIRS.map(({ from, to }) => {
    let rate: number;
    if (from === 'USD') {
      rate = usdTable.conversion_rates[to] ?? 0;
    } else if (to === 'USD') {
      rate = eurTable.conversion_rates[to] ?? 0;
      // Actually look up from USD table: 1/USD->FROM
      const usdToFrom = usdTable.conversion_rates[from];
      rate = usdToFrom ? parseFloat((1 / usdToFrom).toFixed(6)) : 0;
    } else {
      // Cross rate via USD
      const usdToFrom = usdTable.conversion_rates[from];
      const usdToTo = usdTable.conversion_rates[to];
      rate = usdToFrom && usdToTo ? parseFloat((usdToTo / usdToFrom).toFixed(6)) : 0;
    }
    return {
      from,
      to,
      rate,
      lastUpdated: usdTable.time_last_update_utc,
    };
  });
}
