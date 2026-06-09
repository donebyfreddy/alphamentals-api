import { resolveMt5BridgeBaseUrl, resolveMt5BridgeApiKey } from '../lib/mt5BridgeEnv.js';

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

function toMid(bid: number | null, ask: number | null): number | null {
  if (bid == null || ask == null) return null;
  return Number(((bid + ask) / 2).toFixed(8));
}

function emptyEntry(sym: string, timestamp: string): QuoteEntry {
  return { symbol: sym, displaySymbol: DISPLAY_NAMES[sym] ?? sym, price: null, bid: null, ask: null, timestamp, provider: 'mt5-bridge' };
}

function parseRawQuote(sym: string, raw: Record<string, unknown>, timestamp: string): QuoteEntry {
  const bid = typeof raw.bid === 'number' ? raw.bid : null;
  const ask = typeof raw.ask === 'number' ? raw.ask : null;
  const last = typeof raw.last === 'number' ? raw.last : null;
  return {
    symbol: sym,
    displaySymbol: DISPLAY_NAMES[sym] ?? sym,
    price: toMid(bid, ask) ?? last,
    bid,
    ask,
    timestamp: typeof raw.updatedAt === 'string' ? raw.updatedAt : timestamp,
    provider: 'mt5-bridge',
  };
}

async function fetchFromBridge(baseUrl: string, apiKey: string, symbols: string[]): Promise<QuotesResponse> {
  const timestamp = new Date().toISOString();
  const url = `${baseUrl}/quotes?symbols=${symbols.join(',')}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  let resp: Response;
  try {
    resp = await fetch(url, { signal: controller.signal, headers: { 'x-api-key': apiKey } });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const errMsg = `MT5 bridge returned HTTP ${resp.status}`;
    return {
      ok: true,
      data: Object.fromEntries(symbols.map((s) => [s, emptyEntry(s, timestamp)])),
      errors: Object.fromEntries(symbols.map((s) => [s, errMsg])),
      timestamp,
    };
  }

  const body = await resp.json() as { ok: boolean; data?: Record<string, unknown>; errors?: Record<string, string> };
  const data: Record<string, QuoteEntry> = {};
  const errors: Record<string, string> = body.errors ? { ...body.errors } : {};

  for (const sym of symbols) {
    const raw = body.data?.[sym] as Record<string, unknown> | undefined;
    if (raw) {
      data[sym] = parseRawQuote(sym, raw, timestamp);
    } else {
      data[sym] = emptyEntry(sym, timestamp);
      if (!errors[sym]) errors[sym] = 'Quote not available from MT5 bridge';
    }
  }

  return { ok: true, data, errors, timestamp };
}

export async function getPreferredMarketPrices(symbols: string[]): Promise<QuotesResponse> {
  const timestamp = new Date().toISOString();
  const baseUrl = resolveMt5BridgeBaseUrl();
  const apiKey = resolveMt5BridgeApiKey();

  if (!baseUrl || !apiKey) {
    return {
      ok: true,
      data: Object.fromEntries(symbols.map((s) => [s, emptyEntry(s, timestamp)])),
      errors: Object.fromEntries(symbols.map((s) => [s, 'MT5 bridge not configured'])),
      timestamp,
    };
  }

  try {
    return await fetchFromBridge(baseUrl, apiKey, symbols);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'MT5 bridge request failed';
    return {
      ok: false,
      data: Object.fromEntries(symbols.map((s) => [s, emptyEntry(s, timestamp)])),
      errors: Object.fromEntries(symbols.map((s) => [s, message])),
      timestamp,
    };
  }
}

export async function debugMt5BridgeQuotes(symbols?: string[]): Promise<{ ok: boolean; diagnostics: ReturnType<typeof getBridgeConfigDiagnostics>; quotes?: QuotesResponse }> {
  const diag = getBridgeConfigDiagnostics();
  if (!symbols?.length) return { ok: true, diagnostics: diag };
  const quotes = await getPreferredMarketPrices(symbols);
  return { ok: quotes.ok, diagnostics: diag, quotes };
}
