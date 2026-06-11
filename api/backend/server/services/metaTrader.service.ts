import {
  mt5TradebotConnect,
  mt5TradebotDisconnect,
  mt5HealthCheck,
} from './mt5TradebotApiProvider.js';

export {
  mt5GetAccountInfo,
  mt5GetPositions,
  mt5GetHistory,
  mt5GetSymbols,
  mt5GetTick,
  mt5GetHistoricalData,
  mt5PlaceOrder,
  mt5ClosePosition,
} from './mt5TradebotApiProvider.js';
export type {
  MT5HistoricalBar,
  MT5PlaceOrderRequest,
  MT5PlaceOrderResult,
  MT5Symbol,
  MT5Tick,
} from './mt5TradebotApiProvider.js';

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
  provider: 'mt5_tradebot_api' | 'custom_bridge' | 'local_python' | 'none';
  providerLabel: string;
  ready: boolean;
  message: string;
}

type StoredConnection = {
  credentials: MetaTraderCredentials;
  connectedAt: string;
};

const connectionStore = new Map<string, StoredConnection>();

function buildConnectionKey(version: MetaTraderVersion, server: string, login: string) {
  return `${version}:${server.trim().toLowerCase()}:${login.trim()}`;
}

function localBridgeConfigured() {
  return Boolean(
    process.env.MT5_TRADEBOT_API_URL
    || process.env.MT5_BRIDGE_URL
    || process.env.MT5_ENABLED === 'true'
    || process.env.MT5_BRIDGE_ENABLED === 'true'
  );
}

export function getBridgeStatus(): BridgeStatus {
  const tradebotUrl = process.env.MT5_TRADEBOT_API_URL?.trim();
  const bridgeUrl = process.env.MT5_BRIDGE_URL?.trim();

  if (tradebotUrl) {
    return {
      configured: true,
      provider: 'mt5_tradebot_api',
      providerLabel: `Windows VPS MT5 Bridge (${tradebotUrl})`,
      ready: true,
      message: `Windows VPS MT5 bridge configured at ${tradebotUrl}.`,
    };
  }

  if (bridgeUrl) {
    return {
      configured: true,
      provider: 'custom_bridge',
      providerLabel: `Windows VPS MT5 Bridge (${bridgeUrl})`,
      ready: true,
      message: `Windows VPS MT5 bridge configured at ${bridgeUrl}.`,
    };
  }

  if (process.platform === 'win32' || process.env.MT5_ENABLED === 'true' || process.env.MT5_BRIDGE_ENABLED === 'true') {
    return {
      configured: true,
      provider: 'local_python',
      providerLabel: 'Windows VPS MT5 Local Bridge',
      ready: true,
      message: 'Windows VPS MT5 local bridge is enabled.',
    };
  }

  return {
    configured: false,
    provider: 'none',
    providerLabel: 'Windows VPS MT5 Bridge',
    ready: false,
    message: 'MT5 bridge is not configured. Set MT5_BRIDGE_URL and MT5_BRIDGE_API_KEY for the local Windows VPS MT5 stack.',
  };
}

export async function connectMetaTrader(credentials: MetaTraderCredentials): Promise<MetaTraderConnectResult> {
  if (!localBridgeConfigured()) {
    return {
      success: false,
      status: 'failed',
      error: {
        code: 'BRIDGE_NOT_CONFIGURED',
        message: 'Windows VPS MT5 bridge is not configured. Set MT5_BRIDGE_URL and MT5_BRIDGE_API_KEY.',
      },
    };
  }

  const result = await mt5TradebotConnect(credentials);
  if (result.success) {
    const connectionKey = buildConnectionKey(credentials.version, credentials.server, credentials.login);
    connectionStore.set(connectionKey, {
      credentials,
      connectedAt: new Date().toISOString(),
    });
    return {
      ...result,
      connectionKey,
    };
  }

  return result;
}

export async function syncMetaTrader(connectionKey: string): Promise<MetaTraderConnectResult> {
  const connection = connectionStore.get(connectionKey);
  if (!connection) {
    return {
      success: false,
      status: 'failed',
      error: {
        code: 'FAILED_TO_CONNECT',
        message: 'Connection key not found. Reconnect the MT5 account through the local Windows VPS bridge.',
      },
    };
  }

  const result = await mt5TradebotConnect(connection.credentials);
  if (result.success) {
    connectionStore.set(connectionKey, {
      credentials: connection.credentials,
      connectedAt: new Date().toISOString(),
    });
  }
  return {
    ...result,
    connectionKey,
  };
}

export function disconnectMetaTrader(connectionKey: string): void {
  connectionStore.delete(connectionKey);
  void mt5TradebotDisconnect();
}

export async function getLocalMt5Diagnostics() {
  const bridge = getBridgeStatus();
  const health = await mt5HealthCheck().catch((error: unknown) => ({
    healthy: false,
    message: error instanceof Error ? error.message : String(error),
  }));

  return {
    provider: 'windows-vps-mt5' as const,
    metaapiEnabled: false,
    bridgeConfigured: bridge.configured,
    bridgeReady: bridge.ready,
    bridgeMessage: bridge.message,
    bridgeReachable: health.healthy,
    bridgeHealthMessage: health.message,
  };
}
