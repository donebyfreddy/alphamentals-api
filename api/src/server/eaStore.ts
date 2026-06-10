export interface EaAccount {
  login: string;
  server: string;
  broker: string;
  name: string;
  balance: number;
  equity: number;
}

export interface EaHeartbeat {
  accountId: string;
  account: EaAccount;
  receivedAt: string;
}

export interface EaTick {
  symbol: string;     // normalized (e.g. XAUUSD)
  rawSymbol: string;  // as received from EA (e.g. XAUUSD.)
  bid: number | null;
  ask: number | null;
  price: number | null;
  timestamp: string;
  receivedAt: string;
  provider: string;
}

let _heartbeat: EaHeartbeat | null = null;
const _ticks = new Map<string, EaTick>();

// Strips common broker suffixes so XAUUSD., XAUUSDm all map to XAUUSD.
function normalizeTickSymbol(sym: string): string {
  return sym.toUpperCase().trim().replace(/\.+$/, '');
}

export function storeHeartbeat(data: Omit<EaHeartbeat, 'receivedAt'>): void {
  _heartbeat = { ...data, receivedAt: new Date().toISOString() };
}

export interface EaTickInput {
  symbol: string;
  bid: number | null;
  ask: number | null;
  price: number | null;
  timestamp: string;
}

export function storeTick(data: EaTickInput): void {
  const normalized = normalizeTickSymbol(data.symbol);
  _ticks.set(normalized, {
    ...data,
    symbol: normalized,
    rawSymbol: data.symbol,
    receivedAt: new Date().toISOString(),
    provider: 'mt5-ea',
  });
}

export function getLatestHeartbeat(): EaHeartbeat | null {
  return _heartbeat;
}

export function getLatestTick(symbol: string): EaTick | null {
  return _ticks.get(normalizeTickSymbol(symbol)) ?? null;
}

export function getAllTicks(): Record<string, EaTick> {
  return Object.fromEntries(_ticks);
}

export function getTickCount(): number {
  return _ticks.size;
}

export function getTickSymbols(): string[] {
  return [..._ticks.keys()];
}

export function isEaConnected(maxAgeMs = 30_000): boolean {
  if (!_heartbeat) return false;
  return Date.now() - new Date(_heartbeat.receivedAt).getTime() <= maxAgeMs;
}
