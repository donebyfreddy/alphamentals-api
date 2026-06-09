"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectCTrader = connectCTrader;
exports.syncCTrader = syncCTrader;
exports.disconnectCTrader = disconnectCTrader;
const CTRADER_BASE = 'https://api.spotware.com/connect';
const TIMEOUT_MS = 30_000;
const connectionStore = new Map();
function buildConnectionKey(accountId) {
    return `ctrader:${accountId}`;
}
async function ctFetch(path, token) {
    const res = await fetch(`${CTRADER_BASE}${path}`, {
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    let data;
    try {
        data = JSON.parse(text);
    }
    catch {
        data = { message: `HTTP ${res.status}: ${text.slice(0, 100)}` };
    }
    return { ok: res.ok, status: res.status, data };
}
function mapPosition(p) {
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
function mapDeal(d) {
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
async function fetchAccountInfo(token, accountId) {
    const res = await ctFetch(`/tradingaccounts/${accountId}`, token);
    return res.ok ? res.data : null;
}
async function fetchPositions(token, accountId) {
    const res = await ctFetch(`/tradingaccounts/${accountId}/positions`, token);
    if (!res.ok)
        return [];
    return (res.data.position ?? []).map(mapPosition);
}
async function fetchDeals(token, accountId) {
    const from = Date.now() - 90 * 24 * 3600 * 1000;
    const to = Date.now();
    const res = await ctFetch(`/tradingaccounts/${accountId}/deals?from=${from}&to=${to}&limit=500`, token);
    if (!res.ok)
        return [];
    return (res.data.deal ?? []).map(mapDeal);
}
async function connectCTrader(creds) {
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
        const account = {
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
    }
    catch (err) {
        return {
            success: false,
            error: {
                code: 'CONNECTION_FAILED',
                message: err instanceof Error ? err.message : 'Unexpected error connecting to cTrader.',
            },
        };
    }
}
async function syncCTrader(connectionKey) {
    const stored = connectionStore.get(connectionKey);
    if (!stored) {
        return {
            success: false,
            error: { code: 'SESSION_EXPIRED', message: 'Session expired. Please reconnect the account.' },
        };
    }
    return connectCTrader(stored.credentials);
}
function disconnectCTrader(connectionKey) {
    connectionStore.delete(connectionKey);
}
