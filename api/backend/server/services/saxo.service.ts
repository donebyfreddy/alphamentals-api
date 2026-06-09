// Saxo Bank OpenAPI — read-only account tracking
// Docs: https://www.developer.saxo/openapi/learn
// SIM base: https://gateway.saxobank.com/sim/openapi
// LIVE base: https://gateway.saxobank.com/openapi

const SIM_BASE  = 'https://gateway.saxobank.com/sim/openapi';
const LIVE_BASE = 'https://gateway.saxobank.com/openapi';
const TIMEOUT_MS = 30_000;

export interface SaxoCredentials {
  accessToken: string;
  accountKey?: string; // optional — auto-detected from /accounts if omitted
  environment: 'sim' | 'live';
}

export interface SaxoAccountSnapshot {
  accountKey: string;
  accountId: string;
  clientKey: string;
  displayName: string;
  currency: string;
  balance: number;
  equity: number;
  unrealisedPnl: number;
  marginUsed: number;
  leverage: number;
  isDemo: boolean;
}

export interface SaxoPosition {
  positionId: string;
  symbol: string;
  type: 'buy' | 'sell';
  amount: number;
  profit: number;
  openPrice: number;
  currentPrice: number;
  openedAt: string;
}

export interface SaxoTrade {
  tradeId: string;
  symbol: string;
  type: 'buy' | 'sell';
  amount: number;
  openPrice: number;
  closePrice: number;
  profit: number;
  commission: number;
  openedAt: string;
  closedAt: string;
}

export interface SaxoConnectResult {
  success: boolean;
  connectionKey?: string;
  account?: SaxoAccountSnapshot;
  positions?: SaxoPosition[];
  history?: SaxoTrade[];
  error?: { code: string; message: string };
}

type StoredConnection = {
  credentials: SaxoCredentials;
  connectedAt: string;
};

const connectionStore = new Map<string, StoredConnection>();

function base(env: 'sim' | 'live'): string {
  return env === 'live' ? LIVE_BASE : SIM_BASE;
}

async function saxoFetch<T>(path: string, token: string, env: 'sim' | 'live'): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(`${base(env)}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    data = { message: `HTTP ${res.status}: ${text.slice(0, 200)}` } as T;
  }
  return { ok: res.ok, status: res.status, data };
}

// ─── Raw API shapes ───────────────────────────────────────────────────────────

interface RawMe {
  ClientKey: string;
  Name: string;
}

interface RawAccountItem {
  AccountKey: string;
  AccountId: string;
  ClientKey: string;
  DisplayName?: string;
  Currency: string;
  AccountType: string;
}

interface RawAccountListResponse {
  Data?: RawAccountItem[];
}

interface RawBalanceResponse {
  TotalValue?: number;
  NetEquityForMargin?: number;
  UnrealizedPositionsValue?: number;
  MarginUsedByCurrentPositions?: number;
  InitialMargin?: { MarginAvailable?: number };
}

interface RawPositionItem {
  PositionId?: string;
  PositionBase?: {
    Amount?: number;
    OpenPrice?: number;
    BuySell?: string;
    OpenDateTime?: string;
    Uic?: number;
  };
  PositionView?: {
    ProfitLossOnTrade?: number;
    CurrentPrice?: number;
  };
  DisplayAndFormat?: { Description?: string; Symbol?: string };
}

interface RawPositionListResponse {
  Data?: RawPositionItem[];
}

interface RawClosedPositionItem {
  ClosedPositionUniqueId?: string;
  TradeId?: string;
  DisplayAndFormat?: { Description?: string; Symbol?: string };
  ClosedPosition?: {
    BuySell?: string;
    Amount?: number;
    OpenPrice?: number;
    ClosingPrice?: number;
    ProfitLoss?: number;
    OpenDateTime?: string;
    CloseDateTime?: string;
    Commission?: number;
  };
}

interface RawClosedPositionListResponse {
  Data?: RawClosedPositionItem[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildConnectionKey(accountKey: string, env: 'sim' | 'live'): string {
  return `saxo:${env}:${accountKey}`;
}

function mapPosition(raw: RawPositionItem): SaxoPosition | null {
  const base = raw.PositionBase;
  const view = raw.PositionView;
  if (!base || !raw.PositionId) return null;
  const symbol = raw.DisplayAndFormat?.Symbol ?? raw.DisplayAndFormat?.Description ?? 'UNKNOWN';
  return {
    positionId: raw.PositionId,
    symbol,
    type: base.BuySell?.toLowerCase() === 'sell' ? 'sell' : 'buy',
    amount: base.Amount ?? 0,
    profit: view?.ProfitLossOnTrade ?? 0,
    openPrice: base.OpenPrice ?? 0,
    currentPrice: view?.CurrentPrice ?? base.OpenPrice ?? 0,
    openedAt: base.OpenDateTime ?? new Date().toISOString(),
  };
}

function mapClosedPosition(raw: RawClosedPositionItem): SaxoTrade | null {
  const cp = raw.ClosedPosition;
  if (!cp) return null;
  const symbol = raw.DisplayAndFormat?.Symbol ?? raw.DisplayAndFormat?.Description ?? 'UNKNOWN';
  const tradeId = raw.TradeId ?? raw.ClosedPositionUniqueId ?? crypto.randomUUID();
  return {
    tradeId,
    symbol,
    type: cp.BuySell?.toLowerCase() === 'sell' ? 'sell' : 'buy',
    amount: cp.Amount ?? 0,
    openPrice: cp.OpenPrice ?? 0,
    closePrice: cp.ClosingPrice ?? 0,
    profit: cp.ProfitLoss ?? 0,
    commission: cp.Commission ?? 0,
    openedAt: cp.OpenDateTime ?? new Date().toISOString(),
    closedAt: cp.CloseDateTime ?? new Date().toISOString(),
  };
}

// ─── Core connection logic ────────────────────────────────────────────────────

async function fetchAccountData(creds: SaxoCredentials): Promise<SaxoConnectResult> {
  const { accessToken, environment } = creds;
  const env = environment ?? 'sim';

  // 1. Verify token + get client key
  const meRes = await saxoFetch<RawMe>('/port/v1/users/me', accessToken, env);
  if (!meRes.ok) {
    return {
      success: false,
      error: {
        code: meRes.status === 401 ? 'UNAUTHORIZED' : 'AUTH_FAILED',
        message: meRes.status === 401
          ? 'Access token is invalid or expired. Generate a new token from developer.saxo.com.'
          : `Failed to authenticate with Saxo (${meRes.status}).`,
      },
    };
  }
  const clientKey = meRes.data.ClientKey;

  // 2. List accounts and pick the target
  const accsRes = await saxoFetch<RawAccountListResponse>(`/port/v1/accounts?ClientKey=${clientKey}`, accessToken, env);
  if (!accsRes.ok || !accsRes.data.Data?.length) {
    return { success: false, error: { code: 'NO_ACCOUNTS', message: 'No accounts found for this Saxo client.' } };
  }

  const accounts = accsRes.data.Data;
  const target = creds.accountKey
    ? accounts.find(a => a.AccountKey === creds.accountKey || a.AccountId === creds.accountKey)
    : accounts[0];

  if (!target) {
    return { success: false, error: { code: 'ACCOUNT_NOT_FOUND', message: `Account ${creds.accountKey} not found.` } };
  }

  // 3. Balance
  const balRes = await saxoFetch<RawBalanceResponse>(
    `/port/v1/balances?AccountKey=${target.AccountKey}&ClientKey=${clientKey}`,
    accessToken,
    env,
  );
  const bal = balRes.ok ? balRes.data : {};
  const balance = bal.TotalValue ?? 0;
  const equity = bal.NetEquityForMargin ?? balance;
  const unrealisedPnl = bal.UnrealizedPositionsValue ?? 0;
  const marginUsed = bal.MarginUsedByCurrentPositions ?? 0;

  const account: SaxoAccountSnapshot = {
    accountKey: target.AccountKey,
    accountId: target.AccountId,
    clientKey,
    displayName: target.DisplayName ?? meRes.data.Name ?? target.AccountId,
    currency: target.Currency,
    balance,
    equity,
    unrealisedPnl,
    marginUsed,
    leverage: 0,
    isDemo: env === 'sim',
  };

  // 4. Open positions
  const posRes = await saxoFetch<RawPositionListResponse>(
    `/port/v1/positions?AccountKey=${target.AccountKey}&ClientKey=${clientKey}&FieldGroups=PositionBase,PositionView,DisplayAndFormat`,
    accessToken,
    env,
  );
  const positions: SaxoPosition[] = (posRes.ok ? posRes.data.Data ?? [] : [])
    .map(mapPosition)
    .filter((p): p is SaxoPosition => p !== null);

  // 5. Closed positions (last 90 days)
  const from = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const cpRes = await saxoFetch<RawClosedPositionListResponse>(
    `/port/v1/closedpositions?AccountKey=${target.AccountKey}&ClientKey=${clientKey}&FromDateTime=${from}&FieldGroups=ClosedPosition,DisplayAndFormat`,
    accessToken,
    env,
  );
  const history: SaxoTrade[] = (cpRes.ok ? cpRes.data.Data ?? [] : [])
    .map(mapClosedPosition)
    .filter((t): t is SaxoTrade => t !== null);

  return { success: true, account, positions, history };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function connectSaxo(creds: SaxoCredentials): Promise<SaxoConnectResult> {
  const result = await fetchAccountData(creds);
  if (!result.success || !result.account) return result;

  const key = buildConnectionKey(result.account.accountKey, creds.environment);
  connectionStore.set(key, { credentials: creds, connectedAt: new Date().toISOString() });

  return { ...result, connectionKey: key };
}

export async function syncSaxo(connectionKey: string): Promise<SaxoConnectResult> {
  const stored = connectionStore.get(connectionKey);
  if (!stored) {
    return { success: false, error: { code: 'NOT_CONNECTED', message: 'Saxo session not found. Please reconnect the account.' } };
  }
  const result = await fetchAccountData(stored.credentials);
  if (result.success) {
    connectionStore.set(connectionKey, { ...stored, credentials: stored.credentials });
  }
  return { ...result, connectionKey };
}

export function disconnectSaxo(connectionKey: string): void {
  connectionStore.delete(connectionKey);
}
