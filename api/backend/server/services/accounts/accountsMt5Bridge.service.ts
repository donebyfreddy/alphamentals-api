import { mt5BridgeClient } from '../../lib/mt5BridgeClient.js';

export interface BridgeConnectPayload {
  accountId: string;
  login: string;
  password: string;
  server: string;
  connectionMode: 'read_only' | 'trading';
  tradingEnabled: boolean;
  autoJournalingEnabled: boolean;
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

export async function checkBridgeHealth(): Promise<{ healthy: boolean; details?: unknown }> {
  try {
    const result = await mt5BridgeClient.get<unknown>('/health');
    return { healthy: true, details: result };
  } catch (error) {
    return { healthy: false, details: error instanceof Error ? error.message : String(error) };
  }
}

export async function bridgeConnectAccount(payload: BridgeConnectPayload): Promise<BridgeConnectResult> {
  const baseDiag: BridgeDiagnostics = { ...EMPTY_DIAGNOSTICS, credentialsReceived: true, bridgeHealthy: true };
  try {
    const result = await mt5BridgeClient.post<{
      ok?: boolean;
      account_info?: BridgeAccountInfo;
      accountInfo?: BridgeAccountInfo;
      diagnostics?: Partial<BridgeDiagnostics>;
      error_code?: string;
      errorCode?: string;
      error_message?: string;
      errorMessage?: string;
    }>('/accounts/connect', {
      account_id: payload.accountId,
      login: payload.login,
      password: payload.password,
      server: payload.server,
      connection_mode: payload.connectionMode,
      trading_enabled: payload.tradingEnabled,
      auto_journaling_enabled: payload.autoJournalingEnabled,
    });

    const accountInfo = result.account_info ?? result.accountInfo;
    const diagnostics: BridgeDiagnostics = {
      ...baseDiag,
      ...result.diagnostics,
    };

    if (result.ok === false) {
      return {
        ok: false,
        diagnostics,
        errorCode: result.error_code ?? result.errorCode ?? 'MT5_LOGIN_FAILED',
        errorMessage: result.error_message ?? result.errorMessage ?? 'MT5 login failed',
      };
    }

    return {
      ok: true,
      accountInfo,
      diagnostics: {
        ...diagnostics,
        loginVerified: true,
        accountInfoFetched: Boolean(accountInfo),
        tradingAllowed: Boolean(accountInfo?.tradeAllowed),
        autoJournalingReady: payload.autoJournalingEnabled,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isLoginFail = message.toLowerCase().includes('login') || message.toLowerCase().includes('auth');
    return {
      ok: false,
      diagnostics: { ...baseDiag },
      errorCode: isLoginFail ? 'MT5_LOGIN_FAILED' : 'MT5_BRIDGE_UNAVAILABLE',
      errorMessage: message,
    };
  }
}

export async function bridgeGetAccountStatus(accountId: string): Promise<BridgeStatusResult> {
  try {
    const result = await mt5BridgeClient.get<BridgeStatusResult>(`/accounts/${accountId}/status`);
    return result;
  } catch (error) {
    return {
      ok: false,
      status: 'error',
      diagnostics: { bridgeHealthy: false },
    };
  }
}

export async function bridgeReconnectAccount(accountId: string, payload: BridgeConnectPayload): Promise<BridgeConnectResult> {
  try {
    const result = await mt5BridgeClient.post<{
      ok?: boolean;
      account_info?: BridgeAccountInfo;
      accountInfo?: BridgeAccountInfo;
      diagnostics?: Partial<BridgeDiagnostics>;
      error_code?: string;
      error_message?: string;
    }>(`/accounts/${accountId}/reconnect`, {
      login: payload.login,
      password: payload.password,
      server: payload.server,
      connection_mode: payload.connectionMode,
      trading_enabled: payload.tradingEnabled,
      auto_journaling_enabled: payload.autoJournalingEnabled,
    });

    const accountInfo = result.account_info ?? result.accountInfo;
    const diagnostics: BridgeDiagnostics = {
      ...EMPTY_DIAGNOSTICS,
      credentialsReceived: true,
      bridgeHealthy: true,
      ...result.diagnostics,
    };

    if (result.ok === false) {
      return {
        ok: false,
        diagnostics,
        errorCode: result.error_code ?? 'MT5_LOGIN_FAILED',
        errorMessage: result.error_message ?? 'MT5 reconnect failed',
      };
    }

    return {
      ok: true,
      accountInfo,
      diagnostics: {
        ...diagnostics,
        loginVerified: true,
        accountInfoFetched: Boolean(accountInfo),
        tradingAllowed: Boolean(accountInfo?.tradeAllowed),
      },
    };
  } catch (error) {
    return {
      ok: false,
      diagnostics: { ...EMPTY_DIAGNOSTICS, bridgeHealthy: false },
      errorCode: 'MT5_BRIDGE_UNAVAILABLE',
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function bridgeDisconnectAccount(accountId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await mt5BridgeClient.post<unknown>(`/accounts/${accountId}/disconnect`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function bridgeVerifyTrading(accountId: string): Promise<{ ok: boolean; tradingAllowed: boolean; errorCode?: string; errorMessage?: string }> {
  try {
    const result = await mt5BridgeClient.post<{
      ok?: boolean;
      trading_allowed?: boolean;
      tradingAllowed?: boolean;
      error_code?: string;
      error_message?: string;
    }>(`/accounts/${accountId}/verify-trading`);

    const tradingAllowed = result.trading_allowed ?? result.tradingAllowed ?? false;
    if (result.ok === false || !tradingAllowed) {
      return {
        ok: false,
        tradingAllowed: false,
        errorCode: result.error_code ?? 'MT5_TRADING_NOT_ALLOWED',
        errorMessage: result.error_message ?? 'Trading is not allowed on this account',
      };
    }
    return { ok: true, tradingAllowed: true };
  } catch (error) {
    return {
      ok: false,
      tradingAllowed: false,
      errorCode: 'MT5_BRIDGE_UNAVAILABLE',
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function bridgeGetPositions(accountId: string): Promise<unknown[]> {
  try {
    const result = await mt5BridgeClient.get<unknown[] | { positions?: unknown[]; data?: unknown[] }>(`/accounts/${accountId}/positions`);
    if (Array.isArray(result)) return result;
    return (result as { positions?: unknown[]; data?: unknown[] }).positions ?? (result as { data?: unknown[] }).data ?? [];
  } catch {
    return [];
  }
}

export async function bridgeGetOrders(accountId: string): Promise<unknown[]> {
  try {
    const result = await mt5BridgeClient.get<unknown[] | { orders?: unknown[]; data?: unknown[] }>(`/accounts/${accountId}/orders`);
    if (Array.isArray(result)) return result;
    return (result as { orders?: unknown[]; data?: unknown[] }).orders ?? (result as { data?: unknown[] }).data ?? [];
  } catch {
    return [];
  }
}

export async function bridgeGetDeals(accountId: string): Promise<unknown[]> {
  try {
    const result = await mt5BridgeClient.get<unknown[] | { deals?: unknown[]; data?: unknown[] }>(`/accounts/${accountId}/deals`);
    if (Array.isArray(result)) return result;
    return (result as { deals?: unknown[]; data?: unknown[] }).deals ?? (result as { data?: unknown[] }).data ?? [];
  } catch {
    return [];
  }
}
