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

const accounts = new Map<string, BridgeAccountState>();

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
