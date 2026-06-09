"use strict";
/**
 * Calendar provider orchestrator.
 *
 * Priority order: Trading Economics > Finnhub > Forex Factory
 * Events from multiple providers are merged and deduplicated.
 * Higher-priority provider data wins on duplicates.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchCalendarFromProviders = fetchCalendarFromProviders;
exports.getActiveProviders = getActiveProviders;
const finnhubProvider_js_1 = require("./finnhubProvider.js");
const tradingEconomicsProvider_js_1 = require("./tradingEconomicsProvider.js");
const forexFactoryProvider_js_1 = require("./forexFactoryProvider.js");
const fundamentalEvents_js_1 = require("../../../../src/lib/fundamentalEvents.js");
const PROVIDERS = [
    new tradingEconomicsProvider_js_1.TradingEconomicsProvider(),
    new finnhubProvider_js_1.FinnhubProvider(),
    new forexFactoryProvider_js_1.ForexFactoryProvider(),
];
const CURRENCY_FLAGS = {
    USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', JPY: '🇯🇵',
    AUD: '🇦🇺', CAD: '🇨🇦', CHF: '🇨🇭', NZD: '🇳🇿',
    CNY: '🇨🇳', HKD: '🇭🇰', SGD: '🇸🇬', NOK: '🇳🇴',
    SEK: '🇸🇪', DKK: '🇩🇰', MXN: '🇲🇽', ZAR: '🇿🇦',
    XAU: '🥇',
};
/**
 * Deduplication key: same currency + same UTC minute + similar title.
 * Allows a small title mismatch since providers name events differently.
 */
function dedupeKey(e) {
    const minute = e.timeUtc.slice(0, 16); // "2026-06-02T13:30"
    const titleKey = e.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
    return `${e.currency}:${minute}:${titleKey}`;
}
function attachFlag(e) {
    return { ...e, flag: CURRENCY_FLAGS[e.currency] ?? '🌍' };
}
async function fetchCalendarFromProviders(from, to) {
    const available = PROVIDERS.filter((p) => p.isAvailable());
    if (available.length === 0) {
        throw new Error('No calendar providers configured. Set FINNHUB_API_KEY, TRADING_ECONOMICS_API_KEY, or FOREX_FACTORY_ENABLED=true.');
    }
    const results = await Promise.allSettled(available.map((p) => p.fetchEvents(from, to).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[calendar] ${p.name} failed: ${msg}`);
        return [];
    })));
    // Merge: higher-priority provider wins on duplicates (first-write-wins)
    const seen = new Map();
    for (const result of results) {
        if (result.status !== 'fulfilled')
            continue;
        for (const event of result.value) {
            const key = dedupeKey(event);
            if (!seen.has(key))
                seen.set(key, event);
        }
    }
    return Array.from(seen.values())
        .filter((e) => e.timeUtc)
        .sort((a, b) => a.timeUtc.localeCompare(b.timeUtc))
        .map((e) => {
        const withFlag = attachFlag(e);
        const ext = e;
        const [rawDatePart, rawTimeFull] = e.timeUtc.split('T');
        const rawTime = rawTimeFull ? rawTimeFull.slice(0, 5) : '00:00';
        const timing = (0, fundamentalEvents_js_1.deriveFundamentalEventTiming)({
            rawDateTime: e.timeUtc,
            providerTimezone: 'UTC',
            appTimezone: fundamentalEvents_js_1.APP_EVENT_TIMEZONE,
        });
        const date = timing?.date ?? ext.date ?? rawDatePart ?? '';
        const time = timing?.time ?? ext.time ?? rawTime;
        const debugPayload = {
            source: e.source,
            title: e.title,
            rawProviderTime: e.timeUtc,
            parsedUtcTime: timing?.datetimeUtc ?? e.timeUtc,
            displayedMadridTime: timing ? `${timing.dateTimeLabel} ${timing.timezone}` : `${date} ${time} ${fundamentalEvents_js_1.APP_EVENT_TIMEZONE}`,
        };
        console.debug('[economic-calendar:timezone]', debugPayload);
        return {
            ...withFlag,
            date,
            time,
            pairImpacts: ext.pairImpacts ?? e.affectedPairs,
            datetimeUtc: timing?.datetimeUtc ?? e.timeUtc,
            datetimeLocal: timing?.datetimeLocal ?? `${date}T${time}:00`,
            timezone: timing?.timezone ?? fundamentalEvents_js_1.APP_EVENT_TIMEZONE,
            dateTimeLabel: timing?.dateTimeLabel ?? `${date}, ${time}`,
            rawProviderTime: e.timeUtc,
        };
    });
}
function getActiveProviders() {
    return PROVIDERS.map((p) => ({ name: p.name, available: p.isAvailable() }));
}
