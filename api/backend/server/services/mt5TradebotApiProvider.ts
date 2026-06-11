/**
 * MT5 TradeBot API provider — talks to the self-hosted FastAPI bridge
 * Default base URL: http://127.0.0.1:8001/api/v1
 */

import type {
  MetaTraderCredentials,
  MetaTraderConnectResult,
  MetaTraderErrorPayload,
  MetaTraderAccountSnapshot,
  MetaTraderPosition,
  MetaTraderHistoryDeal,
} from './metaTrader.service.js';

const DEFAULT_MT5_BRIDGE_ROOT = 'http://127.0.0.1:8001';

function bridgeRootUrl() {
  const configured = process.env.MT5_BRIDGE_URL?.trim() || process.env.MT5_TRADEBOT_ROOT_URL?.trim() || DEFAULT_MT5_BRIDGE_ROOT;
  return configured.replace(/\/+$/, '');
}

function apiBaseUrl() {
  const explicitApiUrl = process.env.MT5_TRADEBOT_API_URL?.trim();
  if (explicitApiUrl) return explicitApiUrl.replace(/\/+$/, '');
  const root = bridgeRootUrl();
  return root.endsWith('/api/v1') ? root : `${root}/api/v1`;
}

const TIMEOUT_MS = () => Number(process.env.MT5_TRADEBOT_API_TIMEOUT ?? 30_000);

export function getMt5TradebotDiagnostics() {
  return {
    rootUrl: bridgeRootUrl(),
    apiBaseUrl: apiBaseUrl(),
    healthEndpoint: `${bridgeRootUrl()}/health`,
    terminalHealthEndpoint: `${apiBaseUrl()}/terminal/health`,
    diagnosticsEndpoint: `${apiBaseUrl()}/diagnostics`,
    timeoutMs: TIMEOUT_MS(),
  };
}

export interface MT5Symbol {
  name: string;
  description?: string;
  digits?: number;
  trade_mode?: number;
}

export interface MT5Tick {
  symbol: string;
  bid: number;
  ask: number;
  last?: number;
  time?: string;
}

export interface MT5HistoricalBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface MT5PlaceOrderRequest {
  symbol: string;
  order_type: 'buy' | 'sell' | 'buy_limit' | 'sell_limit' | 'buy_stop' | 'sell_stop';
  volume: number;
  price?: number;
  sl?: number;
  tp?: number;
  comment?: string;
  magic?: number;
}

export interface MT5PlaceOrderResult {
  success: boolean;
  order_id?: number;
  message?: string;
}

function sanitizeMt5Payload(body: RequestInit['body']) {
  if (typeof body !== 'string') return body;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if ('password' in parsed) parsed.password = '[REDACTED]';
    return parsed;
  } catch {
    return body;
  }
}

// ── Error extraction ──────────────────────────────────────────────────────────

interface BridgeErrorInfo {
  code: string;
  message: string;
  details?: unknown;
}

function extractBridgeError(data: unknown): BridgeErrorInfo {
  if (typeof data !== 'object' || data === null) {
    return { code: 'UNKNOWN', message: String(data ?? 'Unknown error') };
  }

  const d = data as Record<string, unknown>;

  // FastAPI raises HTTPException with detail: { success, status, error: { code, message, details } }
  const detail = d.detail;
  if (typeof detail === 'object' && detail !== null) {
    const det = detail as Record<string, unknown>;
    const err = det.error;
    if (typeof err === 'object' && err !== null) {
      const e = err as Record<string, unknown>;
      return {
        code: typeof e.code === 'string' ? e.code : 'UNKNOWN',
        message: typeof e.message === 'string' ? e.message : 'Unknown bridge error',
        details: e.details,
      };
    }
    // detail is a plain string or a flat object
    if (typeof det.message === 'string') {
      return { code: typeof det.code === 'string' ? det.code : 'UNKNOWN', message: det.message, details: det.details };
    }
    if (typeof det.error === 'string') {
      return { code: det.error, message: det.error };
    }
    // Fallback: stringify detail safely
    return { code: 'UNKNOWN', message: JSON.stringify(det) };
  }

  if (typeof detail === 'string') return { code: 'UNKNOWN', message: detail };

  // Flat error shape: { code, message, ... }
  if (typeof d.message === 'string') {
    return { code: typeof d.code === 'string' ? d.code : 'UNKNOWN', message: d.message, details: d.details };
  }

  return { code: 'UNKNOWN', message: JSON.stringify(d) };
}

async function tradebotFetch<T>(path: string, options: RequestInit = {}): Promise<{ ok: boolean; status: number; data: T }> {
  const url = path.startsWith('http://') || path.startsWith('https://')
    ? path
    : `${apiBaseUrl()}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS());
  try {
    if (path === '/connect') {
      console.log('[MT5] Calling bridge endpoint:', url);
      console.log('[MT5] Request payload:', sanitizeMt5Payload(options.body));
    }
    const res = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await res.text();
    const contentType = res.headers.get('content-type');

    let data: T;
    if (!contentType?.toLowerCase().includes('application/json')) {
      console.warn('[MT5] JSON parse skipped because response is not JSON. status:', res.status, 'url:', url);
      data = {
        success: false,
        error: 'MT5_BRIDGE_UNAVAILABLE',
        message: 'MT5 bridge returned HTML or is not reachable',
        details: { status: res.status, endpoint: url, contentType },
      } as T;
      return { ok: false, status: res.status, data };
    }

    try {
      data = JSON.parse(text) as T;
    } catch {
      data = {
        success: false,
        error: 'MT5_INVALID_JSON',
        message: 'MT5 bridge returned invalid JSON',
        details: { status: res.status, endpoint: url },
      } as T;
      return { ok: false, status: res.status, data };
    }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    clearTimeout(timer);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    if (isAbort) {
      throw new Error(`MT5 API request timed out while calling ${url}`);
    }
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`MT5 API unreachable at ${url}. ${reason}`);
  }
}

/* ─── Health ─────────────────────────────────────────────────── */

export async function mt5HealthCheck(): Promise<{ healthy: boolean; message: string }> {
  const healthUrl = `${bridgeRootUrl()}/health`;
  try {
    const res = await tradebotFetch<{ status?: string; ok?: boolean; message?: string }>(healthUrl);
    if (res.ok) return { healthy: true, message: res.data.message ?? 'MT5 bridge is online' };
    return { healthy: false, message: `MT5 bridge returned HTTP ${res.status}. URL: ${healthUrl}` };
  } catch (err) {
    const details = err instanceof Error ? err.message : 'MT5 bridge unreachable';
    return {
      healthy: false,
      message: `MT5 bridge is not running. Start it with: pm2 restart mt5-bridge. Expected: ${healthUrl}. ${details}`,
    };
  }
}

export async function mt5TerminalHealthCheck(): Promise<{ healthy: boolean; code?: string; message: string; details?: unknown }> {
  const terminalHealthUrl = `${apiBaseUrl()}/terminal/health`;
  try {
    const res = await tradebotFetch<{ ok?: boolean; code?: string; message?: string; details?: unknown }>(terminalHealthUrl);
    if (res.ok && res.data.ok !== false) {
      return { healthy: true, message: res.data.message ?? 'MT5 terminal is running' };
    }
    return {
      healthy: false,
      code: res.data.code ?? 'TERMINAL_NOT_RUNNING',
      message: res.data.message ?? 'MT5 terminal is not running',
      details: res.data.details,
    };
  } catch {
    // Bridge is online but endpoint doesn't exist yet — degrade gracefully
    return { healthy: false, code: 'TERMINAL_STATUS_UNKNOWN', message: 'Terminal health endpoint not available on bridge' };
  }
}

/* ─── Connect ────────────────────────────────────────────────── */

export async function mt5TradebotConnect(creds: MetaTraderCredentials): Promise<MetaTraderConnectResult> {
  // Health check first
  const health = await mt5HealthCheck();
  if (!health.healthy) {
    return {
      success: false,
      status: 'failed',
      error: {
        code: 'CONNECTION_UNAVAILABLE',
        message: health.message,
      },
    };
  }

  const res = await tradebotFetch<{
    success?: boolean;
    message?: string;
    detail?: unknown;
    error?: string;
    details?: Record<string, unknown>;
    account?: Record<string, unknown>;
    connectionKey?: string;
  }>('/connect', {
    method: 'POST',
    body: JSON.stringify({
      version: creds.version,
      login: creds.login,
      password: creds.password,
      server: creds.server,
      accountType: creds.accountType,
      passwordType: creds.passwordType,
    }),
  });

  if (!res.ok) {
    const errInfo = extractBridgeError(res.data);
    const errCode = errInfo.code;
    const errMsg = errInfo.message;

    console.error(`[MT5] connect failed. code=${errCode} message=${errMsg}`, errInfo.details ? { details: errInfo.details } : '');

    if (res.data.error === 'MT5_BRIDGE_UNAVAILABLE' || res.data.error === 'MT5_INVALID_JSON') {
      return {
        success: false,
        status: 'failed',
        error: { code: 'CONNECTION_UNAVAILABLE', message: 'MT5 bridge returned HTML or is not reachable', details: errInfo },
      };
    }
    if (errCode === 'TERMINAL_NOT_RUNNING') {
      return { success: false, status: 'failed', error: { code: 'TERMINAL_NOT_RUNNING', message: errMsg, details: errInfo.details } };
    }
    if (errCode === 'TERMINAL_NOT_INSTALLED') {
      return { success: false, status: 'failed', error: { code: 'TERMINAL_NOT_INSTALLED', message: errMsg } };
    }
    if (errCode === 'WRONG_PASSWORD' || errMsg.toLowerCase().includes('password') || errMsg.toLowerCase().includes('authorization')) {
      return { success: false, status: 'failed', error: { code: 'WRONG_PASSWORD', message: 'Invalid credentials. Check your login and password.' } };
    }
    if (errCode === 'WRONG_SERVER' || errMsg.toLowerCase().includes('server') || errMsg.toLowerCase().includes('not found')) {
      return { success: false, status: 'failed', error: { code: 'WRONG_SERVER', message: 'Broker server not found. Check the server name.' } };
    }
    return {
      success: false,
      status: 'failed',
      error: { code: (errCode === 'UNKNOWN' ? 'FAILED_TO_CONNECT' : errCode) as MetaTraderErrorPayload['code'], message: errMsg, details: errInfo.details },
    };
  }

  // Fetch account info, positions, and closed history after successful connect.
  const [accountResult, positionsResult, historyResult] = await Promise.all([
    mt5GetAccountInfo(),
    mt5GetPositions(),
    mt5GetHistory(),
  ]);

  if (!accountResult) {
    return { success: false, status: 'failed', error: { code: 'FAILED_TO_CONNECT', message: 'Connected but could not retrieve account info.' } };
  }

  return {
    success: true,
    status: 'connected',
    account: accountResult,
    positions: positionsResult,
    history: historyResult,
  };
}

/* ─── Disconnect ─────────────────────────────────────────────── */

export async function mt5TradebotDisconnect(): Promise<void> {
  try {
    await tradebotFetch('/disconnect', { method: 'POST' });
  } catch {
    // ignore errors on disconnect
  }
}

/* ─── Account info ───────────────────────────────────────────── */

export async function mt5GetAccountInfo(): Promise<MetaTraderAccountSnapshot | null> {
  try {
    const res = await tradebotFetch<{
      login?: number;
      server?: string;
      company?: string;
      name?: string;
      balance?: number;
      equity?: number;
      currency?: string;
      leverage?: number;
      trade_allowed?: boolean;
      margin?: number;
      free_margin?: number;
    }>('/account');
    if (!res.ok) return null;
    const d = res.data;
    return {
      login: String(d.login ?? ''),
      server: d.server ?? '',
      broker: d.company ?? '',
      name: d.name ?? '',
      balance: d.balance ?? 0,
      equity: d.equity ?? 0,
      currency: d.currency ?? 'USD',
      leverage: d.leverage ?? 0,
      tradeAllowed: d.trade_allowed,
    };
  } catch { return null; }
}

/* ─── Positions ──────────────────────────────────────────────── */

export async function mt5GetPositions(): Promise<MetaTraderPosition[]> {
  try {
    const res = await tradebotFetch<Array<{
      ticket?: number;
      symbol?: string;
      type?: number | string;
      volume?: number;
      profit?: number;
      price_open?: number;
      price_current?: number;
      time?: number | string;
    }>>('/positions');
    if (!res.ok || !Array.isArray(res.data)) return [];
    return res.data.map(p => ({
      ticket: String(p.ticket ?? ''),
      symbol: p.symbol ?? '',
      type: (p.type === 0 || p.type === 'buy') ? 'buy' : 'sell',
      volume: p.volume ?? 0,
      profit: p.profit ?? 0,
      openPrice: p.price_open,
      currentPrice: p.price_current,
      openedAt: p.time ? new Date(typeof p.time === 'number' ? p.time * 1000 : p.time).toISOString() : null,
    }));
  } catch { return []; }
}

export async function mt5GetHistory(): Promise<MetaTraderHistoryDeal[]> {
  try {
    const res = await tradebotFetch<Array<{
      ticket?: number | string;
      order?: number | string;
      positionId?: number | string;
      symbol?: string;
      type?: number | string;
      entryType?: number | null;
      volume?: number;
      price?: number;
      profit?: number;
      commission?: number;
      swap?: number;
      time?: number | string;
      comment?: string | null;
    }>>('/history');
    if (!res.ok || !Array.isArray(res.data)) return [];
    return res.data.map((deal) => ({
      ticket: String(deal.ticket ?? ''),
      order: String(deal.order ?? deal.ticket ?? ''),
      positionId: deal.positionId != null ? String(deal.positionId) : undefined,
      symbol: deal.symbol ?? '',
      type: (deal.type === 0 || deal.type === 'buy') ? 'buy' : 'sell',
      entryType: deal.entryType ?? null,
      volume: deal.volume ?? 0,
      price: deal.price ?? 0,
      profit: deal.profit ?? 0,
      commission: deal.commission ?? 0,
      swap: deal.swap ?? 0,
      time: deal.time ? new Date(typeof deal.time === 'number' ? deal.time * 1000 : deal.time).toISOString() : null,
      comment: deal.comment ?? null,
    }));
  } catch {
    return [];
  }
}

/* ─── Symbols ────────────────────────────────────────────────── */

export async function mt5GetSymbols(): Promise<MT5Symbol[]> {
  const res = await tradebotFetch<MT5Symbol[] | { symbols?: MT5Symbol[] }>('/symbols');
  if (!res.ok) throw new Error(`Failed to fetch symbols: HTTP ${res.status}`);
  return Array.isArray(res.data) ? res.data : (res.data.symbols ?? []);
}

/* ─── Tick ───────────────────────────────────────────────────── */

export async function mt5GetTick(symbol: string): Promise<MT5Tick> {
  const res = await tradebotFetch<MT5Tick>(`/symbol/${encodeURIComponent(symbol)}/tick`);
  if (!res.ok) throw new Error(`Symbol '${symbol}' not found or unavailable`);
  return res.data;
}

/* ─── Historical data ────────────────────────────────────────── */

export async function mt5GetHistoricalData(
  symbol: string,
  timeframe: string,
  startDate: string,
  endDate: string,
): Promise<MT5HistoricalBar[]> {
  const res = await tradebotFetch<MT5HistoricalBar[] | { data?: MT5HistoricalBar[] }>('/historical-data', {
    method: 'POST',
    body: JSON.stringify({ symbol, timeframe, start_date: startDate, end_date: endDate }),
  });
  if (!res.ok) throw new Error(`Historical data fetch failed: HTTP ${res.status}`);
  return Array.isArray(res.data) ? res.data : (res.data.data ?? []);
}

/* ─── Place order ────────────────────────────────────────────── */

export async function mt5PlaceOrder(order: MT5PlaceOrderRequest): Promise<MT5PlaceOrderResult> {
  const res = await tradebotFetch<MT5PlaceOrderResult>('/order/place', {
    method: 'POST',
    body: JSON.stringify(order),
  });
  if (!res.ok) {
    const errInfo = extractBridgeError(res.data);
    return { success: false, message: errInfo.message };
  }
  return res.data;
}

/* ─── Close position ─────────────────────────────────────────── */

export async function mt5ClosePosition(positionId: string): Promise<{ success: boolean; message?: string }> {
  const res = await tradebotFetch<{ success?: boolean; message?: string; detail?: unknown }>(
    `/position/close/${encodeURIComponent(positionId)}`,
    { method: 'POST' },
  );
  if (!res.ok) {
    const errInfo = extractBridgeError(res.data);
    return { success: false, message: errInfo.message };
  }
  return { success: true, message: res.data.message };
}
