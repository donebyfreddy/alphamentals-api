"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateRulesBasedBias = calculateRulesBasedBias;
function calculateRulesBasedBias(input) {
    return {
        symbol: input.symbol,
        bias: 'neutral',
        confidence: 0,
        impact: 'unknown',
        tradeStatus: 'wait',
        reason: '',
        reasons: [],
        keyDrivers: [],
        articleIds: [],
        eventIds: [],
    };
}
