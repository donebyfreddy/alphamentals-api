"use strict";
/**
 * Maps broker/app symbols to TradingView fully-qualified symbols.
 * TradingView requires exchange-prefixed symbols for most instruments.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapToTradingViewSymbol = mapToTradingViewSymbol;
exports.mapToTradingViewTimeframe = mapToTradingViewTimeframe;
const TV_SYMBOL_MAP = {
    // Forex majors
    EURUSD: 'FX_IDC:EURUSD',
    GBPUSD: 'FX_IDC:GBPUSD',
    USDJPY: 'FX_IDC:USDJPY',
    USDCHF: 'FX_IDC:USDCHF',
    AUDUSD: 'FX_IDC:AUDUSD',
    USDCAD: 'FX_IDC:USDCAD',
    NZDUSD: 'FX_IDC:NZDUSD',
    // Crosses
    GBPJPY: 'FX_IDC:GBPJPY',
    EURJPY: 'FX_IDC:EURJPY',
    EURGBP: 'FX_IDC:EURGBP',
    AUDJPY: 'FX_IDC:AUDJPY',
    CADJPY: 'FX_IDC:CADJPY',
    CHFJPY: 'FX_IDC:CHFJPY',
    GBPAUD: 'FX_IDC:GBPAUD',
    EURAUD: 'FX_IDC:EURAUD',
    EURCAD: 'FX_IDC:EURCAD',
    // Metals
    XAUUSD: 'OANDA:XAUUSD',
    XAGUSD: 'OANDA:XAGUSD',
    // Indices
    US30: 'FOREXCOM:DJI',
    NAS100: 'FOREXCOM:NSXUSD',
    US500: 'FOREXCOM:SPXUSD',
    UK100: 'FOREXCOM:UK100',
    GER40: 'FOREXCOM:DE30EUR',
    // Crypto
    BTCUSD: 'BINANCE:BTCUSDT',
    ETHUSD: 'BINANCE:ETHUSDT',
};
/**
 * Timeframe mapping: app timeframes → TradingView interval strings.
 * TradingView uses minutes as integers, or D/W/M for daily/weekly/monthly.
 */
const TV_TIMEFRAME_MAP = {
    // Standard app names
    M1: '1',
    M5: '5',
    M15: '15',
    M30: '30',
    H1: '60',
    H4: '240',
    D1: 'D',
    W1: 'W',
    // Twelve Data / Yahoo style
    '1m': '1',
    '5m': '5',
    '15m': '15',
    '15min': '15',
    '30m': '30',
    '1h': '60',
    '4h': '240',
    '1d': 'D',
    // Bare numbers pass through
    '1': '1',
    '5': '5',
    '15': '15',
    '30': '30',
    '60': '60',
    '240': '240',
    'D': 'D',
};
function mapToTradingViewSymbol(symbol) {
    const key = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const mapped = TV_SYMBOL_MAP[key];
    if (!mapped) {
        // Unknown symbol: try FX_IDC prefix as best guess for forex
        console.warn(`[symbolMapping] No TradingView mapping for "${symbol}", defaulting to FX_IDC:${key}`);
        return `FX_IDC:${key}`;
    }
    return mapped;
}
function mapToTradingViewTimeframe(timeframe) {
    const mapped = TV_TIMEFRAME_MAP[timeframe];
    if (!mapped) {
        console.warn(`[symbolMapping] Unknown timeframe "${timeframe}", defaulting to 60 (1h)`);
        return '60';
    }
    return mapped;
}
