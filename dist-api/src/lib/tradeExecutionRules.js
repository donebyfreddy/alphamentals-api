"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_EXECUTION_SETTINGS = void 0;
exports.validateTradeExecutionPlan = validateTradeExecutionPlan;
exports.DEFAULT_EXECUTION_SETTINGS = {
    liveExecutionEnabled: false,
    maxRiskPercent: Number(process.env.TRADING_RISK_PERCENT ?? 1),
    maxPositions: 5,
    blockNewsMinutes: Number(process.env.TRADING_BLOCK_NEWS_MINUTES ?? 30),
    duplicateWindowMinutes: Number(process.env.TRADING_DUPLICATE_WINDOW_MINUTES ?? 180),
    minRR: Number(process.env.TRADING_MIN_RR ?? 2),
};
function validateTradeExecutionPlan(_plan, _settings) {
    return { allowed: false, blockers: ['Live execution disabled'], warnings: [], rr: null, riskPercent: null };
}
