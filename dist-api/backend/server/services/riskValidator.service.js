"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateTradeRisk = validateTradeRisk;
function validateTradeRisk(input) {
    const { entryPrice, stopLoss, takeProfit, lotSize } = input;
    const blockers = [];
    const warnings = [];
    if (stopLoss == null || stopLoss === entryPrice) {
        blockers.push('MISSING_STOP_LOSS');
    }
    if (takeProfit == null || takeProfit === entryPrice) {
        warnings.push('MISSING_TAKE_PROFIT');
    }
    if (lotSize == null || lotSize === 0) {
        blockers.push('LOT_SIZE_ZERO');
    }
    const hasValidSL = stopLoss != null && stopLoss !== entryPrice;
    const hasValidTP = takeProfit != null && takeProfit !== entryPrice;
    if (hasValidSL && hasValidTP) {
        const slDistance = Math.abs(entryPrice - stopLoss);
        const tpDistance = Math.abs(takeProfit - entryPrice);
        const actualRR = tpDistance / slDistance;
        if (actualRR < 1.0) {
            warnings.push('POOR_RR');
        }
    }
    return {
        isValid: blockers.length === 0,
        warnings,
        blockers,
    };
}
