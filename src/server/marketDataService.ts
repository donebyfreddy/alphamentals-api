import { getPreferredMarketPrices } from './mt5BridgeQuotes.js';

export function validateMarketDataEnv(): void {
  const url = process.env.MT5_BRIDGE_URL;
  const key = process.env.MT5_BRIDGE_API_KEY;
  if (!url) console.warn('[market-data] MT5_BRIDGE_URL not set — market data will return null prices');
  if (!key) console.warn('[market-data] MT5_BRIDGE_API_KEY not set — MT5 bridge calls will be skipped');
}

export function startMarketDataScheduler(): void {
  // MT5 bridge push-feeds quotes via /ea/heartbeat — no polling needed here.
}

export interface MarketPrice {
  price: number | null;
  bid: number | null;
  ask: number | null;
  timestamp: string;
  timestampMs: number | null;
  change: number | null;
  changePercent: number | null;
  high: number | null;
  low: number | null;
  provider: string;
  error?: string;
  warning?: string;
}

export async function getLatestMarketPrice(symbol: string): Promise<MarketPrice | null> {
  try {
    const result = await getPreferredMarketPrices([symbol]);
    const entry = result.data[symbol];
    if (!entry) return null;
    return {
      price: entry.price,
      bid: entry.bid,
      ask: entry.ask,
      timestamp: entry.timestamp,
      timestampMs: entry.timestamp ? new Date(entry.timestamp).getTime() : null,
      change: null,
      changePercent: null,
      high: null,
      low: null,
      provider: entry.provider,
    };
  } catch (err) {
    console.warn('[market-data] getLatestMarketPrice failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
