/**
 * Accounts MT5 bridge — wraps the existing FastAPI bridge endpoints
 * for account-centric operations (connect, reconnect, status, etc.).
 *
 * Uses the bridge at MT5_BRIDGE_URL/api/v1/* which already exists.
 * Maps connectionMode → passwordType before sending to bridge.
 */

import { mt5TradebotConnect, mt5TradebotDisconnect, mt5HealthCheck, mt5TerminalHealthCheck } from '../mt5TradebotApiProvider.js';
import { mt5GetAccountInfo } from '../metaTrader.service.js';

export interface BridgeConnectPayload {
  accountId: string;
  login: string;
  password: string;
  server: string;
  connectionMode: 'read_only' | 'trading';
  tradingEnabled: boolean;
  autoJournalingEnabled: boolean;
  accountType?: 'demo' | 'live';
}

export interface BridgeAccountInfo {
  balance?: number;
  equity?: number;
  margin?: number;
  freeMargin?: number;
  currency?: string;
  leverage?: string | number;
  name?: string;
  company?: string;
  server?: string;
  tradeMode?: number;
  tradeAllowed?: boolean;
}

export interface BridgeConnectResult {
  ok: boolean;
  accountInfo?: BridgeAccountInfo;
  diagnostics: BridgeDiagnostics;
  errorCode?: string;
  errorMessage?: string;
}

export interface BridgeDiagnostics {
  credentialsReceived: boolean;
  bridgeHealthy: boolean;
  terminalRunning: boolean;
  terminalConnected: boolean;
  brokerServerSelected: boolean;
  loginVerified: boolean;
  accountInfoFetched: boolean;
  tradingAllowed: boolean;
  autoJournalingReady: boolean;
}

export interface BridgeStatusResult {
  ok: boolean;
  status: string;
  diagnostics?: Partial<BridgeDiagnostics>;
  accountInfo?: BridgeAccountInfo;
}

const EMPTY_DIAGNOSTICS: BridgeDiagnostics = {
  credentialsReceived: false,
  bridgeHealthy: false,
  terminalRunning: false,
  terminalConnected: false,
  brokerServerSelected: false,
  loginVerified: false,
  accountInfoFetched: false,
  tradingAllowed: false,
  autoJournalingReady: false,
};

function connectionModeToPasswordType(connectionMode: 'read_only' | 'trading'): 'investor' | 'master' {
  return connectionMode === 'trading' ? 'master' : 'investor';
}

export async function checkBridgeHealth(): Promise<{ healthy: boolean; details?: unknown }> {
  const result = await mt5HealthCheck();
  return { healthy: result.healthy, details: result.message };
}

export async function bridgeConnectAccount(payload: BridgeConnectPayload): Promise<BridgeConnectResult> {
  const baseDiag: BridgeDiagnostics = { ...EMPTY_DIAGNOSTICS, credentialsReceived: true, bridgeHealthy: true };

  const connectResult = await mt5TradebotConnect({
    version: 'mt5',
    login: payload.login,
    password: payload.password,
    server: payload.server,
    accountType: payload.accountType ?? 'demo',
    passwordType: connectionModeToPasswordType(payload.connectionMode),
  });

  if (!connectResult.success) {
    const errorCode = connectResult.error?.code ?? 'MT5_LOGIN_FAILED';
    const errorMessage = connectResult.error?.message ?? 'MT5 connection failed';
    const isTerminal = errorCode === 'TERMINAL_NOT_RUNNING' || errorCode === 'TERMINAL_NOT_INSTALLED';
    return {
      ok: false,
      diagnostics: {
        ...baseDiag,
        terminalRunning: !isTerminal,
        loginVerified: false,
      },
      errorCode,
      errorMessage,
    };
  }

  const acct = connectResult.account;
  const accountInfo: BridgeAccountInfo = acct
    ? {
        balance: acct.balance,
        equity: acct.equity,
        currency: acct.currency,
        leverage: acct.leverage,
        name: acct.name,
        company: acct.broker,
        server: acct.server,
        tradeAllowed: acct.tradeAllowed,
      }
    : {};

  return {
    ok: true,
    accountInfo,
    diagnostics: {
      ...baseDiag,
      terminalRunning: true,
      terminalConnected: true,
      brokerServerSelected: true,
      loginVerified: true,
      accountInfoFetched: Boolean(acct),
      tradingAllowed: Boolean(acct?.tradeAllowed),
      autoJournalingReady: payload.autoJournalingEnabled,
    },
  };
}

export async function bridgeGetAccountStatus(accountId: string): Promise<BridgeStatusResult> {
  // The bridge is session-based (no persistent account IDs), so we just
  // check bridge health + terminal health to infer status.
  const bridgeHealth = await mt5HealthCheck();
  if (!bridgeHealth.healthy) {
    return { ok: false, status: 'vps_unreachable', diagnostics: { bridgeHealthy: false } };
  }

  const terminalHealth = await mt5TerminalHealthCheck();
  if (!terminalHealth.healthy) {
    return {
      ok: false,
      status: 'terminal_not_running',
      diagnostics: { bridgeHealthy: true, terminalRunning: false },
    };
  }

  const acct = await mt5GetAccountInfo();
  if (!acct) {
    return { ok: false, status: 'login_failed', diagnostics: { bridgeHealthy: true, terminalRunning: true, loginVerified: false } };
  }

  return {
    ok: true,
    status: acct.tradeAllowed ? 'trading_enabled' : 'read_only',
    diagnostics: { bridgeHealthy: true, terminalRunning: true, terminalConnected: true, loginVerified: true, tradingAllowed: Boolean(acct.tradeAllowed) },
    accountInfo: {
      balance: acct.balance,
      equity: acct.equity,
      currency: acct.currency,
      leverage: acct.leverage,
      tradeAllowed: acct.tradeAllowed,
    },
  };
}

export async function bridgeReconnectAccount(accountId: string, payload: BridgeConnectPayload): Promise<BridgeConnectResult> {
  return bridgeConnectAccount(payload);
}

export async function bridgeDisconnectAccount(accountId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await mt5TradebotDisconnect();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function bridgeVerifyTrading(accountId: string): Promise<{ ok: boolean; tradingAllowed: boolean; errorCode?: string; errorMessage?: string }> {
  const acct = await mt5GetAccountInfo();
  if (!acct) {
    return { ok: false, tradingAllowed: false, errorCode: 'MT5_ACCOUNT_NOT_FOUND', errorMessage: 'Could not retrieve account info from bridge' };
  }
  if (!acct.tradeAllowed) {
    return {
      ok: false,
      tradingAllowed: false,
      errorCode: 'MT5_TRADING_NOT_ALLOWED',
      errorMessage: 'Trading is not allowed on this account. This may be an investor password or terminal trading is disabled.',
    };
  }
  return { ok: true, tradingAllowed: true };
}

export async function bridgeGetPositions(accountId: string): Promise<unknown[]> {
  const { mt5GetPositions } = await import('../mt5TradebotApiProvider.js');
  try {
    const positions = await mt5GetPositions();
    return positions;
  } catch {
    return [];
  }
}

export async function bridgeGetOrders(accountId: string): Promise<unknown[]> {
  return [];
}

export async function bridgeGetDeals(accountId: string): Promise<unknown[]> {
  const { mt5GetHistory } = await import('../mt5TradebotApiProvider.js');
  try {
    const deals = await mt5GetHistory();
    return deals;
  } catch {
    return [];
  }
}
