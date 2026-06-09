"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiInsightsRouter = void 0;
const express_1 = require("express");
const claude_js_1 = require("../lib/claude.js");
const yahoo_js_1 = require("../lib/yahoo.js");
const smc_js_1 = require("../lib/smc.js");
exports.aiInsightsRouter = (0, express_1.Router)();
exports.aiInsightsRouter.post('/', async (req, res) => {
    try {
        const { symbol, timeframe = '1h' } = req.body;
        if (!symbol)
            return res.status(400).json({ error: 'symbol required' });
        const smcSymbol = (0, smc_js_1.normalizeSmcSymbol)(symbol);
        if (!smcSymbol) {
            return res.status(400).json({
                error: 'Unsupported instrument. Only EURUSD, GBPUSD (GDPUSD is treated as GBPUSD), and XAUUSD are supported.',
            });
        }
        // Fetch market data server-side; the client receives only analyzed structure.
        const [candles, quote] = await Promise.all([
            (0, yahoo_js_1.fetchCandles)(smcSymbol, timeframe),
            (0, yahoo_js_1.fetchQuote)(smcSymbol).catch(() => undefined),
        ]);
        if (candles.length < 5) {
            return res.status(502).json({ error: 'Insufficient market data for analysis' });
        }
        const signal = await (0, claude_js_1.generateSignal)(smcSymbol, candles, quote);
        res.json(signal);
    }
    catch (err) {
        console.error('[ai-insights]', err);
        const message = err instanceof Error ? err.message : 'AI analysis failed';
        res.status(500).json({ error: message });
    }
});
exports.aiInsightsRouter.post('/smc', async (req, res) => {
    try {
        const { symbol } = req.body;
        if (!symbol)
            return res.status(400).json({ error: 'symbol required' });
        const smcSymbol = (0, smc_js_1.normalizeSmcSymbol)(symbol);
        if (!smcSymbol) {
            return res.status(400).json({
                error: 'Unsupported instrument. Only EURUSD, GBPUSD (GDPUSD is treated as GBPUSD), and XAUUSD are supported.',
            });
        }
        const [m15, m30, h1, d1, quote] = await Promise.all([
            (0, yahoo_js_1.fetchCandles)(smcSymbol, '15m'),
            (0, yahoo_js_1.fetchCandles)(smcSymbol, '30m'),
            (0, yahoo_js_1.fetchCandles)(smcSymbol, '1h'),
            (0, yahoo_js_1.fetchCandles)(smcSymbol, '1d'),
            (0, yahoo_js_1.fetchQuote)(smcSymbol).catch(() => undefined),
        ]);
        const candlesByTimeframe = {
            '15m': m15,
            '30m': m30,
            '1h': h1,
            '4h': (0, smc_js_1.aggregateCandles)(h1, 4),
            '1d': d1,
        };
        const missingTimeframe = Object.entries(candlesByTimeframe).find(([, candles]) => candles.length < 10);
        if (missingTimeframe) {
            return res.status(502).json({
                error: `Insufficient market data for ${smcSymbol} ${missingTimeframe[0]} analysis`,
            });
        }
        res.json((0, smc_js_1.buildSmcReport)(smcSymbol, candlesByTimeframe, quote));
    }
    catch (err) {
        console.error('[ai-insights/smc]', err);
        const message = err instanceof Error ? err.message : 'SMC analysis failed';
        res.status(500).json({ error: message });
    }
});
