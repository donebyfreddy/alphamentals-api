"use strict";
/**
 * FRED series mapping per currency.
 *
 * Active currencies: USD, EUR, GBP — matching the three supported pairs
 * (XAU/USD, EUR/USD, GBP/USD). JPY, AUD, CAD, CHF, NZD are excluded
 * to prevent unnecessary FRED fetches on startup.
 *
 * External macro fallbacks removed — FRED is the sole source for macro data.
 * If a FRED series is unavailable the indicator stays null; no external
 * API calls are made as a fallback.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_CURRENCIES = exports.DERIVED_INDICATORS = exports.FRED_SERIES = void 0;
exports.FRED_SERIES = {
    USD: [
        { seriesId: 'FEDFUNDS', name: 'Fed Funds Rate', indicatorType: 'interest_rate', fetchMode: 'latest', unit: '%' },
        { seriesId: 'CPIAUCSL', name: 'CPI YoY', indicatorType: 'inflation', fetchMode: 'yoy', unit: '%' },
        { seriesId: 'CPILFESL', name: 'Core CPI YoY', indicatorType: 'core_inflation', fetchMode: 'yoy', unit: '%' },
        { seriesId: 'DGS2', name: '2Y Treasury Yield', indicatorType: 'yield_2y', fetchMode: 'latest', unit: '%' },
        { seriesId: 'DGS10', name: '10Y Treasury Yield', indicatorType: 'yield_10y', fetchMode: 'latest', unit: '%' },
        { seriesId: 'DFII10', name: '10Y Real Yield (TIPS)', indicatorType: 'real_yield_10y', fetchMode: 'latest', unit: '%' },
        { seriesId: 'UNRATE', name: 'Unemployment Rate', indicatorType: 'unemployment', fetchMode: 'latest', unit: '%' },
        { seriesId: 'A191RL1Q225SBEA', name: 'GDP Growth QoQ', indicatorType: 'gdp_growth', fetchMode: 'latest', unit: '%' },
    ],
    EUR: [
        { seriesId: 'ECBDFR', name: 'ECB Deposit Facility Rate', indicatorType: 'interest_rate', fetchMode: 'latest', unit: '%' },
        { seriesId: 'CP0000EZ19M086NEST', name: 'Euro Area HICP YoY', indicatorType: 'inflation', fetchMode: 'yoy', unit: '%' },
        { seriesId: 'IRLTLT01EZM156N', name: 'Euro Area 10Y Bond Yield', indicatorType: 'yield_10y', fetchMode: 'latest', unit: '%' },
        { seriesId: 'IRSTCI01EZM156N', name: 'Euro Area Short-term Rate', indicatorType: 'yield_2y', fetchMode: 'latest', unit: '%' },
        { seriesId: 'LRHUTTTTEZM156S', name: 'Euro Area Unemployment', indicatorType: 'unemployment', fetchMode: 'latest', unit: '%' },
        { seriesId: 'CLVMNACSCAB1GQEA19', name: 'Euro Area GDP Growth QoQ', indicatorType: 'gdp_growth', fetchMode: 'yoy', unit: '%' },
    ],
    GBP: [
        { seriesId: 'IUDSOIA', name: 'BoE SONIA Rate', indicatorType: 'interest_rate', fetchMode: 'latest', unit: '%' },
        { seriesId: 'GBRCPIALLMINMEI', name: 'UK CPI YoY', indicatorType: 'inflation', fetchMode: 'yoy', unit: '%' },
        { seriesId: 'IRLTLT01GBM156N', name: 'UK 10Y Gilt Yield', indicatorType: 'yield_10y', fetchMode: 'latest', unit: '%' },
        { seriesId: 'IRSTCI01GBM156N', name: 'UK Short-term Rate', indicatorType: 'yield_2y', fetchMode: 'latest', unit: '%' },
        { seriesId: 'LRHUTTTTGBM156S', name: 'UK Unemployment Rate', indicatorType: 'unemployment', fetchMode: 'latest', unit: '%' },
    ],
};
exports.DERIVED_INDICATORS = {
    USD: [
        {
            indicatorType: 'real_yield_10y',
            name: 'USD Real Yield 10Y (nominal - inflation)',
            unit: '%',
            compute: (ind) => {
                const y = ind['yield_10y'];
                const i = ind['inflation'];
                if (y == null || i == null)
                    return null;
                return Number.parseFloat((y - i).toFixed(4));
            },
        },
    ],
};
// Only the three currencies relevant to the active pairs (XAU/USD, EUR/USD, GBP/USD).
exports.ALL_CURRENCIES = ['USD', 'EUR', 'GBP'];
