import { randomUUID } from 'node:crypto';
import { supabase } from '../lib/supabase.js';
import { mt5BridgeClient } from '../lib/mt5BridgeClient.js';

export type Mt5BridgeConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

export interface Mt5BridgeConnectPayload {
  accountId?: string;
  login: string;
  password?: string;
  server: string;
  terminalPath?: string;
  accountType?: 'demo' | 'live';
}

export interface Mt5BridgeAccountStatus {
  accountId: string;
  status: Mt5BridgeConnectionStatus;
  connected: boolean;
  lastHeartbeatAt: string | null;
  lastError?: string | null;
  login?: string;
  server?: string;
}

export interface Mt5BridgeAccountInfo {
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
}

export interface Mt5BridgePosition {
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
}

export interface Mt5BridgeSyncResult {
  ok: boolean;
  accountId: string;
  account: Mt5BridgeAccountInfo;
  positions: Mt5BridgePosition[];
  persisted: boolean;
  syncedAt: string;
}

type JsonRecord = Record<string, unknown>;

export class MT5BridgeService {
  isConfigured() {
    return mt5BridgeClient.isConfigured();
  }

  getConfigSummary() {
    return mt5BridgeClient.getConfigSummary();
  }

  async health() {
    return mt5BridgeClient.get<{ ok?: boolean; service?: string; status?: string }>('/health');
  }

  async connectAccount(payload: Mt5BridgeConnectPayload) {
    return mt5BridgeClient.post<JsonRecord>('/accounts/connect', {
      accountId: payload.accountId ?? randomUUID(),
      login: payload.login,
      password: payload.password ?? '',
      server: payload.server,
      terminalPath: payload.terminalPath ?? null,
      accountType: payload.accountType ?? 'demo',
    });
  }

  async disconnectAccount(accountId: string) {
    return mt5BridgeClient.post<JsonRecord>('/accounts/disconnect', { accountId });
  }

  async getAccountStatus(accountId: string) {
    return mt5BridgeClient.get<Mt5BridgeAccountStatus>(`/accounts/${encodeURIComponent(accountId)}/status`);
  }

  async getAccountInfo(accountId: string) {
    return mt5BridgeClient.get<Mt5BridgeAccountInfo>(`/accounts/${encodeURIComponent(accountId)}/info`);
  }

  async getPositions(accountId: string) {
    return mt5BridgeClient.get<Mt5BridgePosition[]>(`/accounts/${encodeURIComponent(accountId)}/positions`);
  }

  async getOrders(accountId: string) {
    return mt5BridgeClient.get<JsonRecord[]>(`/accounts/${encodeURIComponent(accountId)}/orders`);
  }

  async getHistory(accountId: string) {
    return mt5BridgeClient.get<JsonRecord[]>(`/accounts/${encodeURIComponent(accountId)}/history`);
  }

  async getCandles(accountId: string, params: { symbol: string; timeframe: string; limit?: number }) {
    const query = new URLSearchParams({
      symbol: params.symbol,
      timeframe: params.timeframe,
    });
    if (params.limit != null) query.set('limit', String(params.limit));
    return mt5BridgeClient.get<JsonRecord[]>(`/accounts/${encodeURIComponent(accountId)}/candles?${query.toString()}`);
  }

  async getPrice(accountId: string, symbol: string) {
    const query = new URLSearchParams({ symbol });
    return mt5BridgeClient.get<JsonRecord>(`/accounts/${encodeURIComponent(accountId)}/price?${query.toString()}`);
  }

  async executeTrade(accountId: string, payload: JsonRecord) {
    return mt5BridgeClient.post<JsonRecord>(`/accounts/${encodeURIComponent(accountId)}/trade`, payload);
  }

  async closePosition(accountId: string, payload: JsonRecord) {
    return mt5BridgeClient.post<JsonRecord>(`/accounts/${encodeURIComponent(accountId)}/close-position`, payload);
  }

  async closeAll(accountId: string, payload: JsonRecord = {}) {
    return mt5BridgeClient.post<JsonRecord>(`/accounts/${encodeURIComponent(accountId)}/close-all`, payload);
  }

  async syncAccountSnapshot(accountId: string, userId?: string): Promise<Mt5BridgeSyncResult> {
    const [account, positions] = await Promise.all([
      this.getAccountInfo(accountId),
      this.getPositions(accountId),
    ]);

    if (userId) {
      await this.persistSnapshot({ accountId, userId, account, positions });
    }

    return {
      ok: true,
      accountId,
      account,
      positions,
      persisted: Boolean(userId),
      syncedAt: new Date().toISOString(),
    };
  }

  private async persistSnapshot(params: {
    accountId: string;
    userId: string;
    account: Mt5BridgeAccountInfo;
    positions: Mt5BridgePosition[];
  }) {
    const { accountId, userId, account, positions } = params;
    const now = new Date().toISOString();

    const existingResult = await supabase
      .from('mt5_connected_accounts')
      .select('id')
      .eq('userId', userId)
      .eq('accountLogin', account.login)
      .eq('serverName', account.server)
      .maybeSingle();
    if (existingResult.error) throw new Error(existingResult.error.message);

    const dbAccountId = String((existingResult.data as { id?: string } | null)?.id ?? accountId);

    if (existingResult.data) {
      const updateResult = await supabase
        .from('mt5_connected_accounts')
        .update({
          brokerName: account.broker || account.company || account.server,
          status: 'connected',
          lastSyncedAt: now,
        })
        .eq('id', dbAccountId);
      if (updateResult.error) throw new Error(updateResult.error.message);
    } else {
      const insertResult = await supabase
        .from('mt5_connected_accounts')
        .insert({
          id: dbAccountId,
          userId,
          brokerName: account.broker || account.company || account.server,
          accountLogin: account.login,
          serverName: account.server,
          accountType: 'demo',
          status: 'connected',
          lastSyncedAt: now,
        });
      if (insertResult.error) throw new Error(insertResult.error.message);
    }

    const equityResult = await supabase.from('mt5_equity_snapshots').insert({
      userId,
      accountId: dbAccountId,
      balance: account.balance,
      equity: account.equity,
      margin: account.margin,
      freeMargin: account.freeMargin,
      drawdown: account.balance > 0 ? Number((((account.balance - account.equity) / account.balance) * 100).toFixed(3)) : null,
    });
    if (equityResult.error) throw new Error(equityResult.error.message);

    const deleteResult = await supabase.from('mt5_open_positions').delete().eq('accountId', dbAccountId);
    if (deleteResult.error) throw new Error(deleteResult.error.message);

    if (!positions.length) return;

    const rows = positions.map((position) => ({
      id: randomUUID(),
      userId,
      accountId: dbAccountId,
      ticket: position.ticket,
      symbol: position.symbol,
      type: position.type,
      volume: position.volume,
      openPrice: position.openPrice,
      currentPrice: position.currentPrice,
      profit: position.profit,
      openTime: position.openedAt,
      rawPayload: position,
      updatedAt: now,
    }));

    const positionsResult = await supabase.from('mt5_open_positions').insert(rows);
    if (positionsResult.error) throw new Error(positionsResult.error.message);
  }
}

export const mt5BridgeService = new MT5BridgeService();
