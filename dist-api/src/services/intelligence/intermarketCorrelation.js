"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCorrelatedSymbols = getCorrelatedSymbols;
exports.buildCorrelationContext = buildCorrelationContext;
function getCorrelatedSymbols(_symbol) {
    return [];
}
function buildCorrelationContext(symbol, _bias, _entries) {
    return { symbol, signals: [], totalConfidenceDelta: 0, macroSummary: '', correlations: [] };
}
