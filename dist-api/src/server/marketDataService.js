"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateMarketDataEnv = validateMarketDataEnv;
exports.startMarketDataScheduler = startMarketDataScheduler;
exports.getLatestMarketPrice = getLatestMarketPrice;
const mt5BridgeQuotes_js_1 = require("./mt5BridgeQuotes.js");
function validateMarketDataEnv() {
    const url = process.env.MT5_BRIDGE_URL;
    const key = process.env.MT5_BRIDGE_API_KEY;
    if (!url)
        console.warn('[market-data] MT5_BRIDGE_URL not set — market data will return null prices');
    if (!key)
        console.warn('[market-data] MT5_BRIDGE_API_KEY not set — MT5 bridge calls will be skipped');
}
function startMarketDataScheduler() {
    // MT5 bridge push-feeds quotes via /ea/heartbeat — no polling needed here.
}
async function getLatestMarketPrice(symbol) {
    try {
        const result = await (0, mt5BridgeQuotes_js_1.getPreferredMarketPrices)([symbol]);
        const entry = result.data[symbol];
        if (!entry)
            return null;
        return {
            price: entry.price,
            bid: entry.bid,
            ask: entry.ask,
            timestamp: entry.timestamp,
            timestampMs: entry.timestamp ? new Date(entry.timestamp).getTime() : null,
            change: null,
            changePercent: null,
            high: null,
            low: null,
            provider: entry.provider,
        };
    }
    catch (err) {
        console.warn('[market-data] getLatestMarketPrice failed:', err instanceof Error ? err.message : err);
        return null;
    }
}
