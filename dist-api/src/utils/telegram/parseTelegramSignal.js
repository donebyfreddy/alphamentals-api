"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseTelegramSignal = parseTelegramSignal;
exports.isTelegramLimitOrderSignal = isTelegramLimitOrderSignal;
function parseTelegramSignal(text) {
    return {
        type: 'unknown',
        direction: 'UNKNOWN',
        symbol: null,
        entryPrice: null,
        stopLoss: null,
        takeProfits: [],
        rawText: text,
        confidence: 0,
        isLimitOrder: false,
    };
}
function isTelegramLimitOrderSignal(signal) {
    return signal.isLimitOrder;
}
