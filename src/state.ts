export type BridgeAccountState = {
  accountId: string;
  login: string;
  server: string;
  terminalPath: string | null;
  accountType: 'demo' | 'live';
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  connected: boolean;
  createdAt: string;
  updatedAt: string;
  lastHeartbeatAt: string | null;
  lastError: string | null;
  accountInfo: BridgeAccountInfo | null;
  positions: BridgePosition[];
};

export type BridgeAccountInfo = {
  login: string;
  server: string;
  broker: string;
  name: string;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  profit: number;
  currency: string;
  leverage: number;
  tradeAllowed: boolean;
  company?: string | null;
  terminalName?: string | null;
  updatedAt: string;
};

export type BridgePosition = {
  ticket: string;
  symbol: string;
  type: 'buy' | 'sell';
  volume: number;
  profit: number;
  openPrice: number;
  currentPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  openedAt: string | null;
  swap?: number | null;
  commission?: number | null;
  magic?: number | null;
  comment?: string | null;
};

export type BridgeQuote = {
  symbol: string;
  bid: number | null;
  ask: number | null;
  last: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  updatedAt: string;
  source: 'mt5-bridge';
};

const accounts = new Map<string, BridgeAccountState>();
const latestQuotes = new Map<string, BridgeQuote>();

export function normalizeQuoteSymbol(symbol: string) {
  const normalized = symbol.trim().toUpperCase();

  if (normalized.includes('XAUUSD')) return 'XAUUSD';
  if (normalized.includes('EURUSD')) return 'EURUSD';
  if (normalized.includes('GBPUSD')) return 'GBPUSD';
  if (normalized.includes('DXY') || normalized.includes('USDX')) return 'DXY';
  if (
    normalized.includes('USOIL') ||
    normalized.includes('WTI') ||
    normalized.includes('OIL')
  ) {
    return 'USOIL';
  }

  return normalized;
}

export function saveAccountState(state: BridgeAccountState) {
  accounts.set(state.accountId, state);
  return state;
}

export function getAccountState(accountId: string) {
  return accounts.get(accountId) ?? null;
}

export function listAccountStates() {
  return [...accounts.values()];
}

export function updateLatestQuotes(quotes: BridgeQuote[]) {
  for (const quote of quotes) {
    const symbol = normalizeQuoteSymbol(quote.symbol);

    latestQuotes.set(symbol, {
      ...quote,
      symbol,
      source: 'mt5-bridge',
    });
  }
}

export function getLatestQuotes(symbols?: string[]) {
  if (!symbols?.length) {
    return Object.fromEntries(latestQuotes.entries());
  }

  const quotes: Record<string, BridgeQuote | undefined> = {};

  for (const symbol of symbols) {
    const normalized = normalizeQuoteSymbol(symbol);
    quotes[normalized] = latestQuotes.get(normalized);
  }

  return quotes;
}

export function updateAccountSnapshot(params: {
  accountId: string;
  accountInfo: BridgeAccountInfo;
  positions: BridgePosition[];
  lastError?: string | null;
}) {
  const now = new Date().toISOString();
  const existing = getAccountState(params.accountId);
  const state: BridgeAccountState = {
    accountId: params.accountId,
    login: params.accountInfo.login,
    server: params.accountInfo.server,
    terminalPath: existing?.terminalPath ?? null,
    accountType: existing?.accountType ?? 'demo',
    status: params.lastError ? 'error' : 'connected',
    connected: !params.lastError,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastHeartbeatAt: now,
    lastError: params.lastError ?? null,
    accountInfo: params.accountInfo,
    positions: params.positions,
  };

  return saveAccountState(state);
}
