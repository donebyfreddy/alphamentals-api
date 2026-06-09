"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeQuoteSymbol = normalizeQuoteSymbol;
exports.saveAccountState = saveAccountState;
exports.getAccountState = getAccountState;
exports.listAccountStates = listAccountStates;
exports.updateLatestQuotes = updateLatestQuotes;
exports.getLatestQuotes = getLatestQuotes;
exports.updateAccountSnapshot = updateAccountSnapshot;
const accounts = new Map();
const latestQuotes = new Map();
function normalizeQuoteSymbol(symbol) {
    const normalized = symbol.trim().toUpperCase();
    if (normalized.includes('XAUUSD'))
        return 'XAUUSD';
    if (normalized.includes('EURUSD'))
        return 'EURUSD';
    if (normalized.includes('GBPUSD'))
        return 'GBPUSD';
    if (normalized.includes('DXY') || normalized.includes('USDX'))
        return 'DXY';
    if (normalized.includes('USOIL') ||
        normalized.includes('WTI') ||
        normalized.includes('OIL')) {
        return 'USOIL';
    }
    return normalized;
}
function saveAccountState(state) {
    accounts.set(state.accountId, state);
    return state;
}
function getAccountState(accountId) {
    return accounts.get(accountId) ?? null;
}
function listAccountStates() {
    return [...accounts.values()];
}
function updateLatestQuotes(quotes) {
    for (const quote of quotes) {
        const symbol = normalizeQuoteSymbol(quote.symbol);
        latestQuotes.set(symbol, {
            ...quote,
            symbol,
            source: 'mt5-bridge',
        });
    }
}
function getLatestQuotes(symbols) {
    if (!symbols?.length) {
        return Object.fromEntries(latestQuotes.entries());
    }
    const quotes = {};
    for (const symbol of symbols) {
        const normalized = normalizeQuoteSymbol(symbol);
        quotes[normalized] = latestQuotes.get(normalized);
    }
    return quotes;
}
function updateAccountSnapshot(params) {
    const now = new Date().toISOString();
    const existing = getAccountState(params.accountId);
    const state = {
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
