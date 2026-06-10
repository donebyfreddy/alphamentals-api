import { resolveMt5BridgeBaseUrl, resolveMt5BridgeApiKey } from '../lib/mt5BridgeEnv.js';
import { getLatestTick } from './eaStore.js';

const DISPLAY_NAMES: Record<string, string> = {
  XAUUSD: 'XAU/USD', EURUSD: 'EUR/USD', GBPUSD: 'GBP/USD',
  USDJPY: 'USD/JPY', USDCAD: 'USD/CAD', AUDUSD: 'AUD/USD',
  NZDUSD: 'NZD/USD', GBPJPY: 'GBP/JPY', EURJPY: 'EUR/JPY',
  EURGBP: 'EUR/GBP', DXY: 'DX/Y', USOIL: 'WTI/USD',
  NAS100: 'NAS100', US30: 'US30', US500: 'US500',
};

const EMPTY_SYMBOL_MAP: Record<string, never> = Object.create(null) as Record<string, never>;

export function getBridgeConfigDiagnostics() {
  const baseUrl = resolveMt5BridgeBaseUrl();
  const apiKey = resolveMt5BridgeApiKey();
  return {
    mt5BridgeUrlConfigured: Boolean(baseUrl),
    mt5BridgeApiKeyConfigured: Boolean(apiKey),
    mt5BridgeUrl: baseUrl ?? null,
    enableTwelveDataQuotes: false,
    bridgeSymbolMap: EMPTY_SYMBOL_MAP,
  };
}

export interface QuoteEntry {
  symbol: string;
  displaySymbol: string;
  price: number | null;
  bid: number | null;
  ask: number | null;
  timestamp: string;
  provider: string;
}

export interface QuotesResponse {
  ok: boolean;
  data: Record<string, QuoteEntry>;
  errors: Record<string, string>;
  cached?: boolean;
  timestamp: string;
}

function emptyEntry(sym: string, timestamp: string): QuoteEntry {
  return { symbol: sym, displaySymbol: DISPLAY_NAMES[sym] ?? sym, price: null, bid: null, ask: null, timestamp, provider: 'mt5-ea' };
}

export function getPreferredMarketPrices(symbols: string[]): Promise<QuotesResponse> {
  const timestamp = new Date().toISOString();
  const data: Record<string, QuoteEntry> = {};
  const errors: Record<string, string> = {};

  for (const sym of symbols) {
    const tick = getLatestTick(sym);
    if (tick?.price == null) {
      console.log(`[market-data] missing EA tick ${sym}`);
      data[sym] = emptyEntry(sym, timestamp);
      errors[sym] = 'Waiting for EA tick';
    } else {
      console.log(`[market-data] using EA tick ${sym} bid=${tick.bid} ask=${tick.ask} price=${tick.price}`);
      data[sym] = {
        symbol: sym,
        displaySymbol: DISPLAY_NAMES[sym] ?? sym,
        price: tick.price,
        bid: tick.bid,
        ask: tick.ask,
        timestamp: tick.timestamp,
        provider: 'mt5-ea',
      };
    }
  }

  return Promise.resolve({ ok: true, data, errors, cached: false, timestamp });
}

export async function debugMt5BridgeQuotes(symbols?: string[]): Promise<{ ok: boolean; diagnostics: ReturnType<typeof getBridgeConfigDiagnostics>; quotes?: QuotesResponse }> {
  const diag = getBridgeConfigDiagnostics();
  if (!symbols?.length) return { ok: true, diagnostics: diag };
  const quotes = await getPreferredMarketPrices(symbols);
  return { ok: quotes.ok, diagnostics: diag, quotes };
}
