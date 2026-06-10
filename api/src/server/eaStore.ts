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
  symbol: string;
  bid: number | null;
  ask: number | null;
  price: number | null;
  timestamp: string;
  receivedAt: string;
}

let _heartbeat: EaHeartbeat | null = null;
const _ticks = new Map<string, EaTick>();

export function storeHeartbeat(data: Omit<EaHeartbeat, 'receivedAt'>): void {
  _heartbeat = { ...data, receivedAt: new Date().toISOString() };
}

export function storeTick(data: Omit<EaTick, 'receivedAt'>): void {
  _ticks.set(data.symbol.toUpperCase(), { ...data, receivedAt: new Date().toISOString() });
}

export function getLatestHeartbeat(): EaHeartbeat | null {
  return _heartbeat;
}

export function getLatestTick(symbol: string): EaTick | null {
  return _ticks.get(symbol.toUpperCase()) ?? null;
}

export function isEaConnected(maxAgeMs = 30_000): boolean {
  if (!_heartbeat) return false;
  return Date.now() - new Date(_heartbeat.receivedAt).getTime() <= maxAgeMs;
}
