const DISPLAY_MAP: Record<string, string> = {
  XAUUSD: 'XAU/USD', EURUSD: 'EUR/USD', GBPUSD: 'GBP/USD',
  USDJPY: 'USD/JPY', USDCAD: 'USD/CAD', AUDUSD: 'AUD/USD',
  NZDUSD: 'NZD/USD', GBPJPY: 'GBP/JPY', EURJPY: 'EUR/JPY',
  EURGBP: 'EUR/GBP', DXY: 'US Dollar Index', USOIL: 'WTI Crude Oil',
  NAS100: 'Nasdaq 100', US30: 'Dow Jones', US500: 'S&P 500',
};

const ASSET_CLASSES: Record<string, 'forex' | 'commodity' | 'index' | 'crypto'> = {
  XAUUSD: 'commodity', USOIL: 'commodity',
  DXY: 'index', NAS100: 'index', US30: 'index', US500: 'index',
};

export function normalizeApiSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function normalizeDisplaySymbol(symbol: string): string {
  const key = normalizeApiSymbol(symbol);
  return DISPLAY_MAP[key] ?? key;
}

export function getDisplayName(symbol: string): string {
  return normalizeDisplaySymbol(symbol);
}

export function getAssetClass(symbol: string): 'forex' | 'commodity' | 'index' | 'crypto' {
  const key = normalizeApiSymbol(symbol);
  return ASSET_CLASSES[key] ?? 'forex';
}

export function getBaseCurrency(symbol: string): string {
  const key = normalizeApiSymbol(symbol);
  if (key.length >= 6) return key.slice(0, 3);
  return key;
}

export function getQuoteCurrency(symbol: string): string {
  const key = normalizeApiSymbol(symbol);
  if (key.length >= 6) return key.slice(3, 6);
  return 'USD';
}

export function isEnabledPair(symbol: string): boolean {
  const key = normalizeApiSymbol(symbol);
  return Boolean(DISPLAY_MAP[key]);
}
