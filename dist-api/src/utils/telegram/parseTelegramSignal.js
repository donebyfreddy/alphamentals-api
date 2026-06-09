"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseTelegramSignal = parseTelegramSignal;
exports.isTelegramLimitOrderSignal = isTelegramLimitOrderSignal;
function parseTelegramSignal(text, _context) {
    return {
        messageType: 'UNKNOWN',
        type: 'unknown',
        direction: 'UNKNOWN',
        symbol: null,
        entry: null,
        entryPrice: null,
        stopLoss: null,
        takeProfit: null,
        takeProfits: [],
        orderType: null,
        timeframe: null,
        rawText: text,
        confidence: 0,
        isLimitOrder: false,
    };
}
function isTelegramLimitOrderSignal(_textOrSignal, _signal) {
    return false;
}
