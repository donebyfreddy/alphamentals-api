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
exports.fetchCalendar = fetchCalendar;
const cache = __importStar(require("./cache.js"));
const BASE = 'https://finnhub.io/api/v1';
const COUNTRY_TO_CURRENCY = {
    US: 'USD', EU: 'EUR', EA: 'EUR', EMU: 'EUR',
    GB: 'GBP', JP: 'JPY', AU: 'AUD', CA: 'CAD',
    CH: 'CHF', NZ: 'NZD', CN: 'CNY', HK: 'HKD',
    SG: 'SGD', NO: 'NOK', SE: 'SEK', DK: 'DKK',
    MX: 'MXN', ZA: 'ZAR', TR: 'TRY', BR: 'BRL',
    IN: 'INR', KR: 'KRW', RU: 'RUB', DE: 'EUR',
    FR: 'EUR', IT: 'EUR', ES: 'EUR', PT: 'EUR',
};
const CURRENCY_FLAGS = {
    USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', JPY: '🇯🇵',
    AUD: '🇦🇺', CAD: '🇨🇦', CHF: '🇨🇭', NZD: '🇳🇿',
    CNY: '🇨🇳', HKD: '🇭🇰', SGD: '🇸🇬', NOK: '🇳🇴',
    SEK: '🇸🇪', DKK: '🇩🇰', MXN: '🇲🇽', ZAR: '🇿🇦',
    TRY: '🇹🇷', BRL: '🇧🇷', INR: '🇮🇳', KRW: '🇰🇷',
};
// Currency → pairs it directly affects
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
    // Oil-producing / commodity countries
    OIL: ['USOIL', 'USDCAD'],
};
function formatValue(v, unit) {
    if (v === null || v === undefined)
        return null;
    const suffix = unit && unit !== '' ? unit : '';
    return `${v}${suffix}`;
}
function normalizeImpact(impact) {
    const i = (impact ?? '').toLowerCase();
    if (i === 'high')
        return 'high';
    if (i === 'medium' || i === 'moderate')
        return 'medium';
    return 'low';
}
async function fetchCalendar(from, to) {
    const apiKey = process.env.FINNHUB_API_KEY;
    if (!apiKey)
        throw new Error('FINNHUB_API_KEY not set in .env');
    const cacheKey = `finnhub:calendar:${from}:${to}`;
    const cached = cache.get(cacheKey);
    if (cached)
        return cached;
    const url = `${BASE}/calendar/economic?from=${from}&to=${to}&token=${apiKey}`;
    const res = await fetch(url, { headers: { 'X-Finnhub-Token': apiKey } });
    if (!res.ok)
        throw new Error(`Finnhub error: ${res.status} ${res.statusText}`);
    const data = (await res.json());
    const raw = data.economicCalendar ?? [];
    const events = raw.map((e, i) => {
        const currency = COUNTRY_TO_CURRENCY[e.country?.toUpperCase()] ?? e.country;
        const [datePart, timePart] = (e.time ?? '').split(' ');
        const pairImpacts = CURRENCY_PAIR_MAP[currency] ?? [];
        return {
            id: `fh-${datePart}-${i}-${e.event.slice(0, 8).replace(/\s/g, '')}`,
            title: e.event,
            country: e.country,
            currency,
            flag: CURRENCY_FLAGS[currency] ?? '🌍',
            date: datePart ?? '',
            time: timePart ? timePart.slice(0, 5) : '00:00',
            impact: normalizeImpact(e.impact),
            forecast: formatValue(e.estimate, e.unit),
            previous: formatValue(e.prev, e.unit),
            actual: formatValue(e.actual, e.unit),
            pairImpacts,
        };
    });
    // Sort chronologically, filter out events with no date
    const sorted = events
        .filter((e) => e.date)
        .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
    cache.set(cacheKey, sorted, 5 * 60 * 1000);
    return sorted;
}
