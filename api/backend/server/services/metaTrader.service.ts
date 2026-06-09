import { spawn } from 'node:child_process';
import path from 'node:path';
import { mt5TradebotConnect, mt5TradebotDisconnect } from './mt5TradebotApiProvider.js';
export {
  mt5HealthCheck,
  mt5GetAccountInfo,
  mt5GetPositions,
  mt5GetSymbols,
  mt5GetTick,
  mt5GetHistoricalData,
  mt5PlaceOrder,
  mt5ClosePosition,
} from './mt5TradebotApiProvider.js';
export type { MT5Symbol, MT5Tick, MT5HistoricalBar, MT5PlaceOrderRequest, MT5PlaceOrderResult } from './mt5TradebotApiProvider.js';

export type MetaTraderVersion = 'mt4' | 'mt5';
export type MetaTraderConnectionStatus = 'connected' | 'failed' | 'syncing' | 'disconnected';

export interface MetaTraderCredentials {
  version: MetaTraderVersion;
  server: string;
  login: string;
  password: string;
  accountType: 'live' | 'demo';
  passwordType: 'master' | 'investor';
}

export interface MetaTraderPosition {
  ticket: string;
  symbol: string;
  type: 'buy' | 'sell';
  volume: number;
  profit: number;
  openPrice?: number;
  currentPrice?: number;
  openedAt?: string | null;
}

export interface MetaTraderHistoryDeal {
  ticket: string;
  order: string;
  positionId?: string;
  symbol: string;
  type: 'buy' | 'sell';
  entryType?: number | null;
  volume: number;
  price: number;
  profit: number;
  commission: number;
  swap: number;
  time?: string | null;
  comment?: string | null;
}

export interface MetaTraderAccountSnapshot {
  login: string;
  server: string;
  broker: string;
  name: string;
  balance: number;
  equity: number;
  currency: string;
  leverage: number;
  isInvestor?: boolean;
  tradeAllowed?: boolean;
  terminalVersion?: string;
}

export interface MetaTraderErrorPayload {
  code:
    | 'INVALID_LOGIN'
    | 'WRONG_PASSWORD'
    | 'WRONG_SERVER'
    | 'READ_ONLY_REQUIRED'
    | 'TERMINAL_NOT_INSTALLED'
    | 'TERMINAL_NOT_RUNNING'
    | 'CONNECTION_TIMEOUT'
    | 'UNSUPPORTED_SERVER'
    | 'CONNECTION_UNAVAILABLE'
    | 'BRIDGE_NOT_CONFIGURED'
    | 'FAILED_TO_CONNECT'
    | 'INVALID_PAYLOAD'
    | 'UNSUPPORTED_VERSION';
  message: string;
  details?: unknown;
}

export interface MetaTraderConnectResult {
  success: boolean;
  status: MetaTraderConnectionStatus;
  connectionKey?: string;
  account?: MetaTraderAccountSnapshot;
  positions?: MetaTraderPosition[];
  history?: MetaTraderHistoryDeal[];
  error?: MetaTraderErrorPayload;
}

export interface BridgeStatus {
  configured: boolean;
  provider: 'mt5_tradebot_api' | 'metaapi' | 'custom_bridge' | 'local_python' | 'none';
  providerLabel: string;
  ready: boolean;
  message: string;
}

type StoredConnection = {
  credentials: MetaTraderCredentials;
  metaApiAccountId?: string;
  connectedAt: string;
};

const connectionStore = new Map<string, StoredConnection>();

/* ─── Bridge selection ───────────────────────────────────────── */

export function getBridgeStatus(): BridgeStatus {
  const tradebotUrl = process.env.MT5_TRADEBOT_API_URL;
  const metaApiToken = process.env.METAAPI_TOKEN;
  const bridgeUrl = process.env.METATRADER_BRIDGE_URL;
  const pythonBin = process.env.METATRADER_PYTHON_BIN;

  if (metaApiToken) {
    return {
      configured: true,
      provider: 'metaapi',
      providerLabel: 'MetaApi Cloud',
      ready: true,
      message: 'MetaApi cloud bridge is configured and preferred for macOS, Linux, and Vercel deployments.',
    };
  }

  if (tradebotUrl) {
    return {
      configured: true,
      provider: 'mt5_tradebot_api',
      providerLabel: `MT5 TradeBot API (${tradebotUrl})`,
      ready: true,
      message: `Self-hosted MT5 TradeBot API configured at ${tradebotUrl}`,
    };
  }

  if (bridgeUrl) {
    return {
      configured: true,
      provider: 'custom_bridge',
      providerLabel: `Custom Bridge (${bridgeUrl})`,
      ready: true,
      message: `Custom bridge configured at ${bridgeUrl}`,
    };
  }

  if (pythonBin || process.platform === 'win32') {
    return {
      configured: true,
      provider: 'local_python',
      providerLabel: 'Local Python MT5 Bridge',
      ready: true,
      message: 'Local Python MT5 bridge available.',
    };
  }

  return {
    configured: false,
    provider: 'none',
    providerLabel: 'No bridge configured',
    ready: false,
    message:
      'No MetaTrader bridge is configured. On macOS/Linux, set METAAPI_TOKEN (MetaApi cloud) or METATRADER_BRIDGE_URL (custom bridge) in your .env file.',
  };
}

function buildConnectionKey(version: MetaTraderVersion, server: string, login: string) {
  return `${version}:${server.trim().toLowerCase()}:${login.trim()}`;
}

/* ─── MetaApi cloud bridge ───────────────────────────────────── */

const METAAPI_PROVISIONING = 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai';
const METAAPI_CLIENT_BASE = 'https://mt-client-api-v1.london.agiliumtrade.ai';
const METAAPI_TIMEOUT_MS = 60_000;
const METAAPI_CONNECT_WAIT_MS = Number(process.env.METAAPI_CONNECT_WAIT_MS ?? 120_000);

interface MetaApiAccount {
  id?: string;
  _id?: string;
  state: string;
  connectionStatus: string;
  login: string;
  server: string;
  platform: string;
  type: string;
  name: string;
}

function metaApiAccountId(account: Pick<MetaApiAccount, 'id' | '_id'>): string {
  return account.id ?? account._id ?? '';
}

interface MetaApiAccountInfo {
  login: number;
  name: string;
  server: string;
  broker: string;
  balance: number;
  equity: number;
  currency: string;
  leverage: number;
  tradeAllowed: boolean;
  investorMode: boolean;
  platform: string;
  terminalVersion?: number;
}

interface MetaApiPosition {
  id: string;
  type: string;
  symbol: string;
  volume: number;
  profit: number;
  openPrice: number;
  currentPrice: number;
  time: string;
}

interface MetaApiDeal {
  id: string;
  orderId: string;
  positionId: string;
  symbol: string;
  type: string;
  entryType: string;
  volume: number;
  price: number;
  profit: number;
  commission: number;
  swap: number;
  time: string;
  comment: string;
}

export interface MetaApiTradeOrderRequest {
  accountId: string;
  symbol: string;
  actionType: 'ORDER_TYPE_BUY' | 'ORDER_TYPE_SELL' | 'ORDER_TYPE_BUY_LIMIT' | 'ORDER_TYPE_SELL_LIMIT' | 'ORDER_TYPE_BUY_STOP' | 'ORDER_TYPE_SELL_STOP';
  volume: number;
  openPrice?: number;
  stopLoss: number;
  takeProfit: number;
  comment?: string;
  clientId?: string;
}

export interface MetaApiTradeOrderResult {
  success: boolean;
  orderId?: string;
  positionId?: string;
  raw?: unknown;
  message?: string;
}

async function metaApiFetch<T>(
  url: string,
  options: RequestInit,
  token: string,
): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'auth-token': token,
      ...options.headers,
    },
    signal: AbortSignal.timeout(METAAPI_TIMEOUT_MS),
  });
  const text = await res.text();
  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    console.error('[MetaApi] Non-JSON response', res.status, text.slice(0, 200));
    data = { message: `HTTP ${res.status}: ${text.slice(0, 100)}` } as T;
  }
  return { ok: res.ok, status: res.status, data };
}

function loginMatches(account: MetaApiAccount, login: string): boolean {
  // MetaApi returns `login` as a number in the list response; compare as strings to avoid
  // type-mismatch that caused "account not found → duplicate create → HTTP 400" failures.
  return String(account.login) === String(login);
}

function serverMatches(account: MetaApiAccount, server: string): boolean {
  return (account.server ?? '').toLowerCase() === server.toLowerCase();
}

function findByLoginServer(accounts: MetaApiAccount[], login: string, server: string): MetaApiAccount | undefined {
  return accounts.find(a => loginMatches(a, login) && serverMatches(a, server));
}

async function fetchAccountList(token: string, limit = 100): Promise<MetaApiAccount[]> {
  const res = await metaApiFetch<MetaApiAccount[]>(
    `${METAAPI_PROVISIONING}/users/current/accounts?limit=${limit}`,
    { method: 'GET' },
    token,
  );
  return res.ok && Array.isArray(res.data) ? res.data : [];
}

async function createNewMetaApiAccount(
  token: string,
  creds: MetaTraderCredentials,
): Promise<{ ok: boolean; accountId: string; status: number; error?: string }> {
  const res = await metaApiFetch<{ id?: string; _id?: string; message?: string; details?: unknown }>(
    `${METAAPI_PROVISIONING}/users/current/accounts`,
    {
      method: 'POST',
      body: JSON.stringify({
        login: creds.login,
        password: creds.password,
        server: creds.server,
        platform: creds.version,
        name: `${creds.server} ${creds.login}`,
        type: 'cloud-g2',
        magic: 0,
        application: 'MetaApi',
      }),
    },
    token,
  );

  if (!res.ok) {
    const body = res.data as { message?: string; details?: unknown };
    const msg = body.message ?? 'Failed to provision MetaApi account';
    const detail = body.details ? ' — ' + JSON.stringify(body.details) : '';
    console.error('[MetaApi] Account creation failed', { status: res.status, body: JSON.stringify(body) });
    return { ok: false, accountId: '', status: res.status, error: msg + detail };
  }

  const id = res.data.id ?? res.data._id ?? '';
  return { ok: true, accountId: id, status: res.status };
}

async function metaApiProvisionAccount(
  token: string,
  creds: MetaTraderCredentials,
): Promise<{ ok: boolean; accountId: string; error?: string }> {
  // 1. Look up existing account — MetaApi returns `login` as a number, so compare as strings.
  const initialList = await fetchAccountList(token, 100);
  const existing = findByLoginServer(initialList, creds.login, creds.server);
  if (existing) {
    const id = metaApiAccountId(existing);
    console.log(`[MetaApi] Found existing account id=${id} state=${existing.state} connectionStatus=${existing.connectionStatus}`);
    return { ok: true, accountId: id };
  }
  console.log(`[MetaApi] No existing account for login=${creds.login} server=${creds.server} — provisioning...`);

  // 2. Create. On 400/409 (duplicate), do a wider list pass before giving up.
  const created = await createNewMetaApiAccount(token, creds);
  if (created.ok) return { ok: true, accountId: created.accountId };

  if (created.status === 400 || created.status === 409) {
    console.log('[MetaApi] Creation rejected — recovering from wider list (limit=500)...');
    const wideList = await fetchAccountList(token, 500);
    const recovered = findByLoginServer(wideList, creds.login, creds.server);
    if (recovered) {
      const id = metaApiAccountId(recovered);
      console.log(`[MetaApi] Recovered existing account id=${id}`);
      return { ok: true, accountId: id };
    }
  }

  return { ok: false, accountId: '', error: created.error };
}

async function metaApiWaitForConnection(
  token: string,
  accountId: string,
): Promise<boolean> {
  // Fast-path: if the account is already deployed and connected skip the polling loop entirely.
  const initialCheck = await metaApiFetch<MetaApiAccount>(
    `${METAAPI_PROVISIONING}/users/current/accounts/${accountId}`,
    { method: 'GET' },
    token,
  );
  if (initialCheck.ok) {
    const { state, connectionStatus } = initialCheck.data;
    if (state === 'DEPLOYED' && connectionStatus === 'CONNECTED') return true;
    if (state === 'DEPLOY_FAILED') return false;
    console.log(`[MetaApi] Account not yet connected (state=${state} connectionStatus=${connectionStatus}) — polling...`);
  }

  const deadline = Date.now() + METAAPI_CONNECT_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000));
    const res = await metaApiFetch<MetaApiAccount>(
      `${METAAPI_PROVISIONING}/users/current/accounts/${accountId}`,
      { method: 'GET' },
      token,
    );
    if (!res.ok) continue;
    if (res.data.state === 'DEPLOYED' && res.data.connectionStatus === 'CONNECTED') return true;
    if (res.data.state === 'DEPLOY_FAILED') return false;
  }
  return false;
}

async function metaApiGetAccountInfo(
  token: string,
  accountId: string,
): Promise<MetaApiAccountInfo | null> {
  const res = await metaApiFetch<MetaApiAccountInfo>(
    `${METAAPI_CLIENT_BASE}/users/current/accounts/${accountId}/account-information`,
    { method: 'GET' },
    token,
  );
  return res.ok ? res.data : null;
}

async function metaApiGetPositions(
  token: string,
  accountId: string,
): Promise<MetaApiPosition[]> {
  const res = await metaApiFetch<MetaApiPosition[]>(
    `${METAAPI_CLIENT_BASE}/users/current/accounts/${accountId}/positions`,
    { method: 'GET' },
    token,
  );
  return res.ok && Array.isArray(res.data) ? res.data : [];
}

async function metaApiGetHistory(
  token: string,
  accountId: string,
): Promise<MetaApiDeal[]> {
  const startTime = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  const endTime = new Date().toISOString();
  const res = await metaApiFetch<MetaApiDeal[]>(
    `${METAAPI_CLIENT_BASE}/users/current/accounts/${accountId}/history-deals/time/${startTime}/${endTime}?limit=100`,
    { method: 'GET' },
    token,
  );
  return res.ok && Array.isArray(res.data) ? res.data : [];
}

export async function getMetaApiAccountRuntimeStatus(accountId: string): Promise<{
  connected: boolean;
  state: string | null;
  connectionStatus: string | null;
  tradeAllowed: boolean | null;
  accountInfo: MetaApiAccountInfo | null;
  message: string;
}> {
  const token = process.env.METAAPI_TOKEN;
  if (!token) {
    return {
      connected: false,
      state: null,
      connectionStatus: null,
      tradeAllowed: null,
      accountInfo: null,
      message: 'METAAPI_TOKEN is not configured.',
    };
  }

  const account = await metaApiFetch<MetaApiAccount>(
    `${METAAPI_PROVISIONING}/users/current/accounts/${accountId}`,
    { method: 'GET' },
    token,
  );
  if (!account.ok) {
    return {
      connected: false,
      state: null,
      connectionStatus: null,
      tradeAllowed: null,
      accountInfo: null,
      message: `MetaApi account lookup failed with HTTP ${account.status}.`,
    };
  }

  const connected = account.data.state === 'DEPLOYED' && account.data.connectionStatus === 'CONNECTED';
  const accountInfo = connected ? await metaApiGetAccountInfo(token, accountId) : null;
  return {
    connected,
    state: account.data.state,
    connectionStatus: account.data.connectionStatus,
    tradeAllowed: accountInfo?.tradeAllowed ?? null,
    accountInfo,
    message: connected ? 'MetaApi account is connected.' : 'MetaApi account is not deployed and connected.',
  };
}

export async function placeMetaApiTradeOrder(order: MetaApiTradeOrderRequest): Promise<MetaApiTradeOrderResult> {
  const token = process.env.METAAPI_TOKEN;
  if (!token) {
    return { success: false, message: 'METAAPI_TOKEN is not configured.' };
  }

  const body: Record<string, unknown> = {
    actionType: order.actionType,
    symbol: order.symbol,
    volume: order.volume,
    stopLoss: order.stopLoss,
    takeProfit: order.takeProfit,
    comment: order.comment ?? 'AlphaMentals validated trade',
    clientId: order.clientId,
  };
  if (order.openPrice != null) body.openPrice = order.openPrice;

  const res = await metaApiFetch<Record<string, unknown>>(
    `${METAAPI_CLIENT_BASE}/users/current/accounts/${order.accountId}/trade`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
    token,
  );

  if (!res.ok) {
    const message = typeof res.data.message === 'string'
      ? res.data.message
      : `MetaApi order failed with HTTP ${res.status}.`;
    return { success: false, message, raw: res.data };
  }

  const orderId = String(res.data.orderId ?? res.data.order ?? res.data.id ?? '');
  const positionId = String(res.data.positionId ?? '');
  return {
    success: true,
    orderId: orderId || undefined,
    positionId: positionId || undefined,
    raw: res.data,
    message: 'MetaApi order accepted.',
  };
}

function mapMetaApiPositions(positions: MetaApiPosition[]): MetaTraderPosition[] {
  return positions.map(p => ({
    ticket: p.id,
    symbol: p.symbol,
    type: p.type === 'POSITION_TYPE_BUY' ? 'buy' : 'sell',
    volume: p.volume,
    profit: p.profit,
    openPrice: p.openPrice,
    currentPrice: p.currentPrice,
    openedAt: p.time,
  }));
}

function mapMetaApiDeals(deals: MetaApiDeal[]): MetaTraderHistoryDeal[] {
  return deals.map(d => ({
    ticket: d.id,
    order: d.orderId,
    positionId: d.positionId,
    symbol: d.symbol,
    type: d.type === 'DEAL_TYPE_BUY' ? 'buy' : 'sell',
    entryType: d.entryType === 'DEAL_ENTRY_IN' ? 0 : 1,
    volume: d.volume,
    price: d.price,
    profit: d.profit,
    commission: d.commission,
    swap: d.swap,
    time: d.time,
    comment: d.comment,
  }));
}

async function callMetaApiBridge(creds: MetaTraderCredentials): Promise<MetaTraderConnectResult> {
  const token = process.env.METAAPI_TOKEN;
  if (!token) {
    console.error('[MetaApi] METAAPI_TOKEN is not set — cannot connect.');
    return {
      success: false,
      status: 'failed',
      error: { code: 'BRIDGE_NOT_CONFIGURED', message: 'METAAPI_TOKEN is not configured. Add it to your .env file.' },
    };
  }
  console.log(`[MetaApi] Connecting login=${creds.login} server=${creds.server} platform=${creds.version} accountType=${creds.accountType}`);
  try {
    return await _callMetaApiBridge(token, creds);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[MetaApi] Unexpected error during bridge call:', msg);
    return {
      success: false,
      status: 'failed',
      error: { code: 'FAILED_TO_CONNECT', message: msg },
    };
  }
}

async function _callMetaApiBridge(token: string, creds: MetaTraderCredentials): Promise<MetaTraderConnectResult> {
  // Step 1: Provision or find existing MetaApi account
  console.log('[MetaApi] Step 1 — provisioning account on MetaApi cloud...');
  const provision = await metaApiProvisionAccount(token, creds);
  if (!provision.ok) {
    const err = provision.error ?? '';
    console.error('[MetaApi] Account provisioning failed:', err);
    if (err.toLowerCase().includes('invalid') || err.toLowerCase().includes('login')) {
      return { success: false, status: 'failed', error: { code: 'INVALID_LOGIN', message: 'Invalid login number or broker server.' } };
    }
    if (err.toLowerCase().includes('password')) {
      return { success: false, status: 'failed', error: { code: 'WRONG_PASSWORD', message: 'Incorrect password.' } };
    }
    return { success: false, status: 'failed', error: { code: 'FAILED_TO_CONNECT', message: err } };
  }
  console.log(`[MetaApi] Step 1 — account provisioned: id=${provision.accountId}`);

  const accountId = provision.accountId;

  // Step 2: Wait for terminal to connect to broker
  console.log('[MetaApi] Step 2 — waiting for terminal to connect to broker...');
  const connected = await metaApiWaitForConnection(token, accountId);
  if (!connected) {
    console.error('[MetaApi] Step 2 — connection timed out. Check broker server name and credentials.');
    return {
      success: false,
      status: 'failed',
      error: {
        code: 'CONNECTION_TIMEOUT',
        message: 'Connection timeout. The broker server did not respond in time. Check the server name and try again.',
      },
    };
  }
  console.log('[MetaApi] Step 2 — terminal connected.');

  // Step 3: Fetch account information
  console.log('[MetaApi] Step 3 — fetching account information...');
  const info = await metaApiGetAccountInfo(token, accountId);
  if (!info) {
    console.error('[MetaApi] Step 3 — failed to retrieve account info from MetaApi.');
    return { success: false, status: 'failed', error: { code: 'FAILED_TO_CONNECT', message: 'Failed to retrieve account information.' } };
  }
  console.log(`[MetaApi] Step 3 — account info: login=${info.login} balance=${info.balance} ${info.currency}`);

  // Step 4: Fetch open positions and trade history
  console.log('[MetaApi] Step 4 — fetching open positions and trade history...');
  const [positions, deals] = await Promise.all([
    metaApiGetPositions(token, accountId),
    metaApiGetHistory(token, accountId),
  ]);
  console.log(`[MetaApi] Step 4 — fetched ${positions.length} open positions, ${deals.length} history deals.`);

  const account: MetaTraderAccountSnapshot = {
    login: String(info.login),
    server: info.server,
    broker: info.broker,
    name: info.name,
    balance: info.balance,
    equity: info.equity,
    currency: info.currency,
    leverage: info.leverage,
    isInvestor: info.investorMode,
    tradeAllowed: info.tradeAllowed,
    terminalVersion: info.terminalVersion ? String(info.terminalVersion) : undefined,
  };

  const result = {
    success: true,
    status: 'connected' as const,
    account,
    positions: mapMetaApiPositions(positions),
    history: mapMetaApiDeals(deals),
  };
  console.log(`[MetaApi] Connected successfully. login=${account.login} broker=${account.broker} balance=${account.balance} ${account.currency}`);
  return result;
}

/* ─── Custom remote bridge ───────────────────────────────────── */

async function callRemoteBridge(credentials: MetaTraderCredentials): Promise<MetaTraderConnectResult> {
  const bridgeUrl = process.env.METATRADER_BRIDGE_URL!;
  try {
    const response = await fetch(`${bridgeUrl.replace(/\/$/, '')}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
      signal: AbortSignal.timeout(30_000),
    });
    return await response.json() as MetaTraderConnectResult;
  } catch (err) {
    return {
      success: false,
      status: 'failed',
      error: {
        code: 'CONNECTION_TIMEOUT',
        message: 'Bridge connection timed out or returned an invalid response.',
        details: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

/* ─── Local Python bridge (Windows / configured Python) ──────── */

async function callLocalBridge(credentials: MetaTraderCredentials): Promise<MetaTraderConnectResult> {
  const scriptPath = path.resolve(process.cwd(), 'backend/scripts/metatrader_bridge.py');
  const pythonCommand = process.env.METATRADER_PYTHON_BIN || 'python3';

  return await new Promise<MetaTraderConnectResult>((resolve) => {
    const child = spawn(pythonCommand, [scriptPath], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on('error', () => {
      resolve({
        success: false,
        status: 'disconnected',
        error: {
          code: 'CONNECTION_UNAVAILABLE',
          message: 'Failed to start the local MetaTrader bridge. Make sure the MetaTrader5 Python package is installed.',
        },
      });
    });

    child.on('close', () => {
      if (!stdout.trim()) {
        resolve({
          success: false,
          status: 'failed',
          error: {
            code: 'FAILED_TO_CONNECT',
            message: 'MetaTrader bridge returned an empty response. Check that MetaTrader 5 terminal is running.',
            details: stderr.trim() || undefined,
          },
        });
        return;
      }
      try {
        resolve(JSON.parse(stdout) as MetaTraderConnectResult);
      } catch {
        resolve({
          success: false,
          status: 'failed',
          error: { code: 'FAILED_TO_CONNECT', message: 'MetaTrader bridge returned an invalid response.' },
        });
      }
    });

    child.stdin.write(JSON.stringify(credentials));
    child.stdin.end();
  });
}

/* ─── Bridge dispatcher ──────────────────────────────────────── */

async function runBridgeConnection(credentials: MetaTraderCredentials): Promise<MetaTraderConnectResult> {
  // Priority 0: MetaApi cloud (best fit for macOS, Linux, and Vercel)
  if (process.env.METAAPI_TOKEN) {
    return callMetaApiBridge(credentials);
  }

  // Priority 1: MT5 TradeBot API (self-hosted FastAPI bridge)
  if (process.env.MT5_TRADEBOT_API_URL) {
    return mt5TradebotConnect(credentials);
  }

  // Priority 2: Custom remote bridge (Windows VPS, Docker, etc.)
  if (process.env.METATRADER_BRIDGE_URL) {
    return callRemoteBridge(credentials);
  }

  // Priority 3: Local Python bridge (Windows with MT5 terminal, or METATRADER_PYTHON_BIN set)
  if (process.env.METATRADER_PYTHON_BIN || process.platform === 'win32') {
    return callLocalBridge(credentials);
  }

  // No bridge available — return actionable message
  return {
    success: false,
    status: 'disconnected',
    error: {
      code: 'BRIDGE_NOT_CONFIGURED',
      message:
        'BRIDGE_NOT_CONFIGURED: MetaTrader connection requires a bridge. On macOS, set METAAPI_TOKEN in your .env file to connect via MetaApi cloud (free at metaapi.cloud), or set METATRADER_BRIDGE_URL to point to a Windows VPS bridge.',
    },
  };
}

/* ─── Public API ─────────────────────────────────────────────── */

export async function connectMetaTrader(credentials: MetaTraderCredentials): Promise<MetaTraderConnectResult> {
  const result = await runBridgeConnection(credentials);
  if (!result.success || !result.account) return result;

  const connectionKey = buildConnectionKey(credentials.version, credentials.server, credentials.login);
  connectionStore.set(connectionKey, {
    credentials,
    connectedAt: new Date().toISOString(),
  });

  return { ...result, connectionKey, status: 'connected' };
}

export async function syncMetaTrader(connectionKey: string): Promise<MetaTraderConnectResult> {
  const stored = connectionStore.get(connectionKey);
  if (!stored) {
    return {
      success: false,
      status: 'disconnected',
      error: {
        code: 'CONNECTION_UNAVAILABLE',
        message: 'Session expired. Please reconnect the account.',
      },
    };
  }

  const result = await runBridgeConnection(stored.credentials);
  if (!result.success) return result;

  return { ...result, connectionKey, status: 'connected' };
}

export function disconnectMetaTrader(connectionKey: string) {
  connectionStore.delete(connectionKey);
  if (process.env.MT5_TRADEBOT_API_URL) {
    void mt5TradebotDisconnect();
  }
}
