"use strict";
/**
 * ExchangeRate-API client (EXCHANGE_RATE_API_KEY).
 * https://www.exchangerate-api.com/docs
 *
 * Free plan: 1 500 requests/month, updates daily.
 * Used for broad multi-currency spot rates with long cache windows.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TRACKED_FOREX_PAIRS = void 0;
exports.getSpotRate = getSpotRate;
exports.getAllRates = getAllRates;
exports.getTrackedPairRates = getTrackedPairRates;
const cache = __importStar(require("./cache.js"));
const ERA_BASE = 'https://v6.exchangerate-api.com/v6';
// Cache full rate tables for 1 hour (API updates daily; no need to hit it more often)
const TABLE_TTL_MS = 60 * 60_000;
async function fetchRateTable(baseCurrency) {
    const apiKey = process.env.EXCHANGE_RATE_API_KEY;
    if (!apiKey)
        throw new Error('EXCHANGE_RATE_API_KEY not set');
    const cacheKey = `era:${baseCurrency}`;
    const cached = cache.get(cacheKey);
    if (cached)
        return cached;
    const url = `${ERA_BASE}/${apiKey}/latest/${baseCurrency.toUpperCase()}`;
    const res = await fetch(url);
    if (!res.ok)
        throw new Error(`ExchangeRate-API HTTP ${res.status}`);
    const data = (await res.json());
    if (data.result !== 'success')
        throw new Error(`ExchangeRate-API error: ${data.result}`);
    cache.set(cacheKey, data, TABLE_TTL_MS);
    return data;
}
/**
 * Get a single spot rate.
 */
async function getSpotRate(from, to) {
    const table = await fetchRateTable(from.toUpperCase());
    const rate = table.conversion_rates[to.toUpperCase()];
    if (rate == null)
        throw new Error(`Currency ${to} not found in rate table`);
    return { from: from.toUpperCase(), to: to.toUpperCase(), rate, lastUpdated: table.time_last_update_utc };
}
/**
 * Get all major forex pair rates relative to a base currency.
 * Returns the full conversion_rates map.
 */
async function getAllRates(baseCurrency = 'USD') {
    const table = await fetchRateTable(baseCurrency.toUpperCase());
    return table.conversion_rates;
}
/** The forex pairs this app tracks. */
exports.TRACKED_FOREX_PAIRS = [
    { from: 'EUR', to: 'USD' },
    { from: 'GBP', to: 'USD' },
    { from: 'USD', to: 'JPY' },
    { from: 'USD', to: 'CHF' },
    { from: 'AUD', to: 'USD' },
    { from: 'USD', to: 'CAD' },
    { from: 'NZD', to: 'USD' },
    { from: 'EUR', to: 'GBP' },
    { from: 'EUR', to: 'JPY' },
    { from: 'GBP', to: 'JPY' },
    { from: 'EUR', to: 'CHF' },
    { from: 'AUD', to: 'JPY' },
];
/**
 * Fetch all tracked pair rates in two calls (USD base + EUR base).
 * Efficient: one API call covers all USD-quoted pairs.
 */
async function getTrackedPairRates() {
    const [usdTable, eurTable] = await Promise.all([
        fetchRateTable('USD'),
        fetchRateTable('EUR'),
    ]);
    return exports.TRACKED_FOREX_PAIRS.map(({ from, to }) => {
        let rate;
        if (from === 'USD') {
            rate = usdTable.conversion_rates[to] ?? 0;
        }
        else if (to === 'USD') {
            rate = eurTable.conversion_rates[to] ?? 0;
            // Actually look up from USD table: 1/USD->FROM
            const usdToFrom = usdTable.conversion_rates[from];
            rate = usdToFrom ? parseFloat((1 / usdToFrom).toFixed(6)) : 0;
        }
        else {
            // Cross rate via USD
            const usdToFrom = usdTable.conversion_rates[from];
            const usdToTo = usdTable.conversion_rates[to];
            rate = usdToFrom && usdToTo ? parseFloat((usdToTo / usdToFrom).toFixed(6)) : 0;
        }
        return {
            from,
            to,
            rate,
            lastUpdated: usdTable.time_last_update_utc,
        };
    });
}
