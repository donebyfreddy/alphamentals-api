"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCachedSnapshot = getCachedSnapshot;
exports.getLastSyncedAt = getLastSyncedAt;
exports.syncMacroIndicators = syncMacroIndicators;
exports.getMacroSnapshot = getMacroSnapshot;
const fred_js_1 = require("./fred.js");
const fredSeries_js_1 = require("./fredSeries.js");
async function fetchFromFred(config) {
    if (config.fetchMode === 'yoy') {
        const res = await (0, fred_js_1.fetchYoYChange)(config.seriesId);
        return { current: res.current, previous: res.previous, source: res.current === null ? 'none' : 'FRED' };
    }
    const raw = await (0, fred_js_1.fetchFredSeries)(config.seriesId, 2);
    const { current, previous } = (0, fred_js_1.extractValues)(raw);
    return { current, previous, source: current === null ? 'none' : 'FRED' };
}
async function fetchWithFallback(config, currency) {
    try {
        const val = await fetchFromFred(config);
        if (val.current !== null)
            return val;
    }
    catch (err) {
        console.warn(`[macroSync] FRED ${currency}:${config.seriesId} failed:`, err.message);
    }
    if (!config.fallback)
        return { current: null, previous: null, source: 'none' };
    try {
        const fb = await config.fallback();
        if (fb.current !== null) {
            console.info(`[macroSync] ${currency}:${config.indicatorType} using fallback (${fb.source})`);
            return { current: fb.current, previous: fb.previous, source: fb.source };
        }
    }
    catch (err) {
        console.warn(`[macroSync] Fallback ${currency}:${config.indicatorType} failed:`, err.message);
    }
    return { current: null, previous: null, source: 'none' };
}
function applyDerived(currency, result) {
    const derived = fredSeries_js_1.DERIVED_INDICATORS[currency] ?? [];
    const flatCurrents = Object.fromEntries(Object.entries(result).map(([k, v]) => [k, v.current]));
    for (const d of derived) {
        if (result[d.indicatorType]?.current !== null)
            continue;
        const computed = d.compute(flatCurrents);
        if (computed !== null) {
            result[d.indicatorType] = { current: computed, previous: null, source: 'derived' };
        }
    }
}
// In-memory store — no database needed.
let cachedSnapshot = null;
let lastSyncedAt = null;
function getCachedSnapshot() {
    return cachedSnapshot;
}
function getLastSyncedAt() {
    return lastSyncedAt;
}
function computeYieldCurve(y10, y2) {
    if (y10 == null || y2 == null)
        return null;
    return Number.parseFloat((y10 - y2).toFixed(4));
}
/**
 * Fetch all indicators for one currency.
 * Priority: FRED → configured local fallback → null.
 * Returns a flat map of indicatorType → { current, previous, source }.
 */
async function fetchCurrencyIndicators(currency) {
    const series = fredSeries_js_1.FRED_SERIES[currency] ?? [];
    const result = {};
    for (const config of series) {
        let current = null;
        let previous = null;
        let source = 'none';
        // 1. Try FRED
        try {
            if (config.fetchMode === 'yoy') {
                const res = await (0, fred_js_1.fetchYoYChange)(config.seriesId);
                current = res.current;
                previous = res.previous;
            }
            else {
                const raw = await (0, fred_js_1.fetchFredSeries)(config.seriesId, 2);
                ({ current, previous } = (0, fred_js_1.extractValues)(raw));
            }
            if (current !== null)
                source = 'FRED';
        }
        catch (err) {
            console.warn(`[macroSync] FRED ${currency}:${config.seriesId} failed:`, err.message);
        }
        // 2. Try fallback if FRED yielded nothing
        if (current === null && config.fallback) {
            try {
                const fb = await config.fallback();
                current = fb.current;
                previous = fb.previous;
                if (current !== null) {
                    source = fb.source;
                    console.info(`[macroSync] ${currency}:${config.indicatorType} using fallback (${source})`);
                }
            }
            catch (err) {
                console.warn(`[macroSync] Fallback ${currency}:${config.indicatorType} failed:`, err.message);
            }
        }
        result[config.indicatorType] = { current, previous, source };
    }
    // 3. Derived indicators (e.g. real yield = nominal - inflation) when primary is still null
    const derived = fredSeries_js_1.DERIVED_INDICATORS[currency] ?? [];
    for (const d of derived) {
        if (result[d.indicatorType]?.current !== null)
            continue;
        const flatCurrents = {};
        for (const [k, v] of Object.entries(result))
            flatCurrents[k] = v.current;
        const computed = d.compute(flatCurrents);
        if (computed !== null) {
            result[d.indicatorType] = { current: computed, previous: null, source: 'derived' };
        }
    }
    return result;
}
/**
 * Fetch all macro indicators for all currencies and store in memory.
 */
async function syncMacroIndicators() {
    console.log('[macroSync] Starting sync…');
    const snapshot = {};
    for (const currency of fredSeries_js_1.ALL_CURRENCIES) {
        console.log(`[macroSync] Fetching ${currency}…`);
        const indicators = await fetchCurrencyIndicators(currency);
        const y10 = indicators.yield_10y?.current ?? null;
        const y2 = indicators.yield_2y?.current ?? null;
        snapshot[currency] = {
            interest_rate: indicators.interest_rate?.current ?? null,
            inflation: indicators.inflation?.current ?? null,
            core_inflation: indicators.core_inflation?.current ?? null,
            yield_2y: y2,
            yield_10y: y10,
            real_yield_10y: indicators.real_yield_10y?.current ?? null,
            yield_curve: computeYieldCurve(y10, y2),
            unemployment: indicators.unemployment?.current ?? null,
            gdp_growth: indicators.gdp_growth?.current ?? null,
        };
    }
    cachedSnapshot = snapshot;
    lastSyncedAt = Date.now();
    console.log('[macroSync] Sync complete.');
    return cachedSnapshot;
}
/**
 * Return the in-memory snapshot (fast path — no external calls).
 * Throws if sync has never run.
 */
function getMacroSnapshot() {
    if (cachedSnapshot === null) {
        throw new Error('Macro data not yet available — sync in progress');
    }
    return cachedSnapshot;
}
