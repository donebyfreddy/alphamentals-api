"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mt5BridgeService = exports.MT5BridgeService = void 0;
const node_crypto_1 = require("node:crypto");
const supabase_js_1 = require("../lib/supabase.js");
const mt5BridgeClient_js_1 = require("../lib/mt5BridgeClient.js");
class MT5BridgeService {
    isConfigured() {
        return mt5BridgeClient_js_1.mt5BridgeClient.isConfigured();
    }
    getConfigSummary() {
        return mt5BridgeClient_js_1.mt5BridgeClient.getConfigSummary();
    }
    async health() {
        return mt5BridgeClient_js_1.mt5BridgeClient.get('/health');
    }
    async connectAccount(payload) {
        return mt5BridgeClient_js_1.mt5BridgeClient.post('/accounts/connect', {
            accountId: payload.accountId ?? (0, node_crypto_1.randomUUID)(),
            login: payload.login,
            password: payload.password ?? '',
            server: payload.server,
            terminalPath: payload.terminalPath ?? null,
            accountType: payload.accountType ?? 'demo',
        });
    }
    async disconnectAccount(accountId) {
        return mt5BridgeClient_js_1.mt5BridgeClient.post('/accounts/disconnect', { accountId });
    }
    async getAccountStatus(accountId) {
        return mt5BridgeClient_js_1.mt5BridgeClient.get(`/accounts/${encodeURIComponent(accountId)}/status`);
    }
    async getAccountInfo(accountId) {
        return mt5BridgeClient_js_1.mt5BridgeClient.get(`/accounts/${encodeURIComponent(accountId)}/info`);
    }
    async getPositions(accountId) {
        return mt5BridgeClient_js_1.mt5BridgeClient.get(`/accounts/${encodeURIComponent(accountId)}/positions`);
    }
    async getOrders(accountId) {
        return mt5BridgeClient_js_1.mt5BridgeClient.get(`/accounts/${encodeURIComponent(accountId)}/orders`);
    }
    async getHistory(accountId) {
        return mt5BridgeClient_js_1.mt5BridgeClient.get(`/accounts/${encodeURIComponent(accountId)}/history`);
    }
    async getCandles(accountId, params) {
        const query = new URLSearchParams({
            symbol: params.symbol,
            timeframe: params.timeframe,
        });
        if (params.limit != null)
            query.set('limit', String(params.limit));
        return mt5BridgeClient_js_1.mt5BridgeClient.get(`/accounts/${encodeURIComponent(accountId)}/candles?${query.toString()}`);
    }
    async getPrice(accountId, symbol) {
        const query = new URLSearchParams({ symbol });
        return mt5BridgeClient_js_1.mt5BridgeClient.get(`/accounts/${encodeURIComponent(accountId)}/price?${query.toString()}`);
    }
    async executeTrade(accountId, payload) {
        return mt5BridgeClient_js_1.mt5BridgeClient.post(`/accounts/${encodeURIComponent(accountId)}/trade`, payload);
    }
    async closePosition(accountId, payload) {
        return mt5BridgeClient_js_1.mt5BridgeClient.post(`/accounts/${encodeURIComponent(accountId)}/close-position`, payload);
    }
    async closeAll(accountId, payload = {}) {
        return mt5BridgeClient_js_1.mt5BridgeClient.post(`/accounts/${encodeURIComponent(accountId)}/close-all`, payload);
    }
    async syncAccountSnapshot(accountId, userId) {
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
    async persistSnapshot(params) {
        const { accountId, userId, account, positions } = params;
        const now = new Date().toISOString();
        const existingResult = await supabase_js_1.supabase
            .from('mt5_connected_accounts')
            .select('id')
            .eq('userId', userId)
            .eq('accountLogin', account.login)
            .eq('serverName', account.server)
            .maybeSingle();
        if (existingResult.error)
            throw new Error(existingResult.error.message);
        const dbAccountId = String(existingResult.data?.id ?? accountId);
        if (existingResult.data) {
            const updateResult = await supabase_js_1.supabase
                .from('mt5_connected_accounts')
                .update({
                brokerName: account.broker || account.company || account.server,
                status: 'connected',
                lastSyncedAt: now,
            })
                .eq('id', dbAccountId);
            if (updateResult.error)
                throw new Error(updateResult.error.message);
        }
        else {
            const insertResult = await supabase_js_1.supabase
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
            if (insertResult.error)
                throw new Error(insertResult.error.message);
        }
        const equityResult = await supabase_js_1.supabase.from('mt5_equity_snapshots').insert({
            userId,
            accountId: dbAccountId,
            balance: account.balance,
            equity: account.equity,
            margin: account.margin,
            freeMargin: account.freeMargin,
            drawdown: account.balance > 0 ? Number((((account.balance - account.equity) / account.balance) * 100).toFixed(3)) : null,
        });
        if (equityResult.error)
            throw new Error(equityResult.error.message);
        const deleteResult = await supabase_js_1.supabase.from('mt5_open_positions').delete().eq('accountId', dbAccountId);
        if (deleteResult.error)
            throw new Error(deleteResult.error.message);
        if (!positions.length)
            return;
        const rows = positions.map((position) => ({
            id: (0, node_crypto_1.randomUUID)(),
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
        const positionsResult = await supabase_js_1.supabase.from('mt5_open_positions').insert(rows);
        if (positionsResult.error)
            throw new Error(positionsResult.error.message);
    }
}
exports.MT5BridgeService = MT5BridgeService;
exports.mt5BridgeService = new MT5BridgeService();
