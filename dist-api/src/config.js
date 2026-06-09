"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bridgeConfig = void 0;
exports.assertBridgeConfig = assertBridgeConfig;
require("dotenv/config");
function parseBoolean(value, fallback) {
    if (value == null)
        return fallback;
    return value.toLowerCase() === 'true';
}
exports.bridgeConfig = {
    port: Number(process.env.PORT ?? 3001),
    apiKey: process.env.BRIDGE_API_KEY ?? '',
    tradingEnabled: parseBoolean(process.env.TRADING_ENABLED, false),
    logLevel: process.env.LOG_LEVEL ?? 'info',
};
function assertBridgeConfig() {
    const missing = [];
    if (!exports.bridgeConfig.apiKey)
        missing.push('BRIDGE_API_KEY');
    if (!Number.isFinite(exports.bridgeConfig.port) || exports.bridgeConfig.port <= 0)
        missing.push('PORT');
    if (missing.length) {
        throw new Error(`Missing bridge environment variables: ${missing.join(', ')}`);
    }
}
