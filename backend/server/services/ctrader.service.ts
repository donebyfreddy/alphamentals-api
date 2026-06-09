const CTRADER_BASE = 'https://api.spotware.com/connect';
const TIMEOUT_MS = 30_000;

export interface CTraderCredentials {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  accountId: string;
}

export interface CTraderAccountSnapshot {
  accountId: string;
  accountNumber: string;
  brokerName: string;
  traderName: string;
  balance: number;
  equity: number;
  currency: string;
  leverage: number;
  isDemo: boolean;
}

export interface CTraderPosition {
  positionId: string;
  symbol: string;
  type: 'buy' | 'sell';
  volume: number;
  profit: number;
  openPrice: number;
  currentPrice: number;
  openedAt: string;
}

export interface CTraderDeal {
  dealId: string;
  positionId: string;
  symbol: string;
  type: 'buy' | 'sell';
  volume: number;
  price: number;
  profit: number;
  commission: number;
  swap: number;
  closedAt: string;
  comment: string;
}

export interface CTraderConnectResult {
  success: boolean;
  connectionKey?: string;
  account?: CTraderAccountSnapshot;
  positions?: CTraderPosition[];
  history?: CTraderDeal[];
  error?: { code: string; message: string };
}

type StoredConnection = {
  credentials: CTraderCredentials;
  connectedAt: string;
};

const connectionStore = new Map<string, StoredConnection>();

function buildConnectionKey(accountId: string): string {
  return `ctrader:${accountId}`;
}

async function ctFetch<T>(path: string, token: string): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(`${CTRADER_BASE}${path}`, {
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
    data = { message: `HTTP ${res.status}: ${text.slice(0, 100)}` } as T;
  }
  return { ok: res.ok, status: res.status, data };
}

interface RawAccount {
  accountId: number;
  accountNumber: number;
  brokerName: string;
  traderName: string;
  balance: number;
  equity: number;
  currency: string;
  leverage: number;
  isLive: boolean;
}

interface RawPosition {
  positionId: number;
  symbolName: string;
  tradeSide: string;
  volume: number;
  unrealizedGrossProfit: number;
  price: number;
  currentPrice?: number;
  utcLastUpdateTimestamp: number;
}

interface RawDeal {
  dealId: number;
  positionId: number;
  symbolName: string;
  tradeSide: string;
  filledVolume: number;
  executionPrice: number;
  grossProfit: number;
  commission: number;
  swap: number;
  utcLastUpdateTimestamp: number;
  comment: string;
  closePositionDetail?: { grossProfit: number };
}

function mapPosition(p: RawPosition): CTraderPosition {
  return {
    positionId: String(p.positionId),
    symbol: p.symbolName,
    type: p.tradeSide === 'SELL' ? 'sell' : 'buy',
    volume: p.volume / 100,
    profit: p.unrealizedGrossProfit / 100,
    openPrice: p.price,
    currentPrice: p.currentPrice ?? p.price,
    openedAt: new Date(p.utcLastUpdateTimestamp).toISOString(),
  };
}

function mapDeal(d: RawDeal): CTraderDeal {
  return {
    dealId: String(d.dealId),
    positionId: String(d.positionId),
    symbol: d.symbolName,
    type: d.tradeSide === 'SELL' ? 'sell' : 'buy',
    volume: d.filledVolume / 100,
    price: d.executionPrice,
    profit: (d.closePositionDetail?.grossProfit ?? d.grossProfit) / 100,
    commission: d.commission / 100,
    swap: d.swap / 100,
    closedAt: new Date(d.utcLastUpdateTimestamp).toISOString(),
    comment: d.comment ?? '',
  };
}

async function fetchAccountInfo(token: string, accountId: string): Promise<RawAccount | null> {
  const res = await ctFetch<RawAccount>(`/tradingaccounts/${accountId}`, token);
  return res.ok ? res.data : null;
}

async function fetchPositions(token: string, accountId: string): Promise<CTraderPosition[]> {
  const res = await ctFetch<{ position: RawPosition[] }>(`/tradingaccounts/${accountId}/positions`, token);
  if (!res.ok) return [];
  return (res.data.position ?? []).map(mapPosition);
}

async function fetchDeals(token: string, accountId: string): Promise<CTraderDeal[]> {
  const from = Date.now() - 90 * 24 * 3600 * 1000;
  const to = Date.now();
  const res = await ctFetch<{ deal: RawDeal[] }>(
    `/tradingaccounts/${accountId}/deals?from=${from}&to=${to}&limit=500`,
    token,
  );
  if (!res.ok) return [];
  return (res.data.deal ?? []).map(mapDeal);
}

export async function connectCTrader(creds: CTraderCredentials): Promise<CTraderConnectResult> {
  try {
    const info = await fetchAccountInfo(creds.accessToken, creds.accountId);
    if (!info) {
      return {
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Could not retrieve account info. Check your Access Token and Account ID.',
        },
      };
    }

    const [positions, history] = await Promise.all([
      fetchPositions(creds.accessToken, creds.accountId),
      fetchDeals(creds.accessToken, creds.accountId),
    ]);

    const account: CTraderAccountSnapshot = {
      accountId: String(info.accountId),
      accountNumber: String(info.accountNumber),
      brokerName: info.brokerName,
      traderName: info.traderName,
      balance: info.balance / 100,
      equity: info.equity / 100,
      currency: info.currency,
      leverage: info.leverage,
      isDemo: !info.isLive,
    };

    const connectionKey = buildConnectionKey(creds.accountId);
    connectionStore.set(connectionKey, { credentials: creds, connectedAt: new Date().toISOString() });

    return { success: true, connectionKey, account, positions, history };
  } catch (err) {
    return {
      success: false,
      error: {
        code: 'CONNECTION_FAILED',
        message: err instanceof Error ? err.message : 'Unexpected error connecting to cTrader.',
      },
    };
  }
}

export async function syncCTrader(connectionKey: string): Promise<CTraderConnectResult> {
  const stored = connectionStore.get(connectionKey);
  if (!stored) {
    return {
      success: false,
      error: { code: 'SESSION_EXPIRED', message: 'Session expired. Please reconnect the account.' },
    };
  }
  return connectCTrader(stored.credentials);
}

export function disconnectCTrader(connectionKey: string): void {
  connectionStore.delete(connectionKey);
}
