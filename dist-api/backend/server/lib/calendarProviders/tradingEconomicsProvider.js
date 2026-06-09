"use strict";
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
exports.TradingEconomicsProvider = void 0;
const cache = __importStar(require("../cache.js"));
// Trading Economics free tier: https://api.tradingeconomics.com/calendar
// Requires TRADING_ECONOMICS_API_KEY in .env
const BASE = 'https://api.tradingeconomics.com';
const COUNTRY_TO_CURRENCY = {
    'united states': 'USD', 'euro area': 'EUR', 'united kingdom': 'GBP',
    'japan': 'JPY', 'australia': 'AUD', 'canada': 'CAD', 'switzerland': 'CHF',
    'new zealand': 'NZD', 'china': 'CNY', 'germany': 'EUR', 'france': 'EUR',
    'italy': 'EUR', 'spain': 'EUR',
};
const CURRENCY_PAIR_MAP = {
    USD: ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD', 'XAUUSD', 'DXY', 'USOIL'],
    EUR: ['EURUSD', 'EURJPY', 'EURGBP'],
    GBP: ['GBPUSD', 'GBPJPY', 'EURGBP'],
    JPY: ['USDJPY', 'EURJPY', 'GBPJPY'],
    AUD: ['AUDUSD'],
    CAD: ['USDCAD', 'USOIL'],
    CHF: ['USDCHF'],
    NZD: ['NZDUSD'],
    XAU: ['XAUUSD'],
};
function importanceToImpact(importance) {
    if (importance >= 3)
        return 'high';
    if (importance === 2)
        return 'medium';
    return 'low';
}
function resolveCurrency(event) {
    if (event.Currency)
        return event.Currency.toUpperCase();
    return COUNTRY_TO_CURRENCY[event.Country?.toLowerCase()] ?? event.Country?.slice(0, 3).toUpperCase() ?? 'UNK';
}
class TradingEconomicsProvider {
    name = 'trading-economics';
    isAvailable() {
        return Boolean(process.env.TRADING_ECONOMICS_API_KEY);
    }
    async fetchEvents(from, to) {
        const apiKey = process.env.TRADING_ECONOMICS_API_KEY;
        if (!apiKey)
            throw new Error('TRADING_ECONOMICS_API_KEY not set');
        const cacheKey = `te:calendar:${from}:${to}`;
        const cached = cache.get(cacheKey);
        if (cached)
            return cached;
        const url = `${BASE}/calendar?c=${apiKey}&d1=${from}&d2=${to}&f=json`;
        const res = await fetch(url);
        if (!res.ok)
            throw new Error(`Trading Economics error: ${res.status} ${res.statusText}`);
        const raw = await res.json();
        const events = raw.map((e, i) => {
            const currency = resolveCurrency(e);
            const dateStr = e.Date.split('T')[0];
            const timeStr = e.Date.includes('T') ? e.Date.split('T')[1].slice(0, 5) : '00:00';
            const timeUtc = `${dateStr}T${timeStr}:00Z`;
            return {
                id: `te-${dateStr}-${i}-${e.CalendarId}`,
                source: 'trading-economics',
                timeUtc,
                localTime: null,
                currency,
                country: e.Country ?? '',
                title: e.Event,
                impact: importanceToImpact(e.Importance),
                forecast: e.Forecast ?? e.TEForecast ?? null,
                previous: e.Previous ?? null,
                actual: e.Actual ?? null,
                unit: e.Unit ?? null,
                affectedPairs: CURRENCY_PAIR_MAP[currency] ?? [],
                category: e.Category ?? null,
                sourceUrl: e.URL ? `https://tradingeconomics.com${e.URL}` : null,
                raw: e,
                // Legacy compat
                flag: '',
                date: dateStr,
                time: timeStr,
                pairImpacts: CURRENCY_PAIR_MAP[currency] ?? [],
            };
        });
        const sorted = events
            .filter((e) => e.timeUtc)
            .sort((a, b) => a.timeUtc.localeCompare(b.timeUtc));
        cache.set(cacheKey, sorted, 5 * 60 * 1000);
        return sorted;
    }
}
exports.TradingEconomicsProvider = TradingEconomicsProvider;
