"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeApiSymbol = normalizeApiSymbol;
exports.normalizeDisplaySymbol = normalizeDisplaySymbol;
exports.getDisplayName = getDisplayName;
exports.getAssetClass = getAssetClass;
exports.getBaseCurrency = getBaseCurrency;
exports.getQuoteCurrency = getQuoteCurrency;
exports.isEnabledPair = isEnabledPair;
const DISPLAY_MAP = {
    XAUUSD: 'XAU/USD', EURUSD: 'EUR/USD', GBPUSD: 'GBP/USD',
    USDJPY: 'USD/JPY', USDCAD: 'USD/CAD', AUDUSD: 'AUD/USD',
    NZDUSD: 'NZD/USD', GBPJPY: 'GBP/JPY', EURJPY: 'EUR/JPY',
    EURGBP: 'EUR/GBP', DXY: 'US Dollar Index', USOIL: 'WTI Crude Oil',
    NAS100: 'Nasdaq 100', US30: 'Dow Jones', US500: 'S&P 500',
};
const ASSET_CLASSES = {
    XAUUSD: 'commodity', USOIL: 'commodity',
    DXY: 'index', NAS100: 'index', US30: 'index', US500: 'index',
};
function normalizeApiSymbol(symbol) {
    return symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}
function normalizeDisplaySymbol(symbol) {
    const key = normalizeApiSymbol(symbol);
    return DISPLAY_MAP[key] ?? key;
}
function getDisplayName(symbol) {
    return normalizeDisplaySymbol(symbol);
}
function getAssetClass(symbol) {
    const key = normalizeApiSymbol(symbol);
    return ASSET_CLASSES[key] ?? 'forex';
}
function getBaseCurrency(symbol) {
    const key = normalizeApiSymbol(symbol);
    if (key.length >= 6)
        return key.slice(0, 3);
    return key;
}
function getQuoteCurrency(symbol) {
    const key = normalizeApiSymbol(symbol);
    if (key.length >= 6)
        return key.slice(3, 6);
    return 'USD';
}
function isEnabledPair(symbol) {
    const key = normalizeApiSymbol(symbol);
    return Boolean(DISPLAY_MAP[key]);
}
