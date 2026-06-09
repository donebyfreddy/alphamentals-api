import { Router } from 'express';
import { generateSignal } from '../lib/claude.js';
import { fetchCandles, fetchQuote } from '../lib/yahoo.js';
import { aggregateCandles, buildSmcReport, normalizeSmcSymbol, type SmcTimeframe } from '../lib/smc.js';

export const aiInsightsRouter = Router();

aiInsightsRouter.post('/', async (req, res) => {
  try {
    const { symbol, timeframe = '1h' } = req.body as { symbol: string; timeframe?: string };
    if (!symbol) return res.status(400).json({ error: 'symbol required' });
    const smcSymbol = normalizeSmcSymbol(symbol);
    if (!smcSymbol) {
      return res.status(400).json({
        error: 'Unsupported instrument. Only EURUSD, GBPUSD (GDPUSD is treated as GBPUSD), and XAUUSD are supported.',
      });
    }

    // Fetch market data server-side; the client receives only analyzed structure.
    const [candles, quote] = await Promise.all([
      fetchCandles(smcSymbol, timeframe),
      fetchQuote(smcSymbol).catch(() => undefined),
    ]);

    if (candles.length < 5) {
      return res.status(502).json({ error: 'Insufficient market data for analysis' });
    }

    const signal = await generateSignal(smcSymbol, candles, quote);
    res.json(signal);
  } catch (err) {
    console.error('[ai-insights]', err);
    const message = err instanceof Error ? err.message : 'AI analysis failed';
    res.status(500).json({ error: message });
  }
});

aiInsightsRouter.post('/smc', async (req, res) => {
  try {
    const { symbol } = req.body as { symbol: string };
    if (!symbol) return res.status(400).json({ error: 'symbol required' });

    const smcSymbol = normalizeSmcSymbol(symbol);
    if (!smcSymbol) {
      return res.status(400).json({
        error: 'Unsupported instrument. Only EURUSD, GBPUSD (GDPUSD is treated as GBPUSD), and XAUUSD are supported.',
      });
    }

    const [m15, m30, h1, d1, quote] = await Promise.all([
      fetchCandles(smcSymbol, '15m'),
      fetchCandles(smcSymbol, '30m'),
      fetchCandles(smcSymbol, '1h'),
      fetchCandles(smcSymbol, '1d'),
      fetchQuote(smcSymbol).catch(() => undefined),
    ]);

    const candlesByTimeframe: Record<SmcTimeframe, Awaited<ReturnType<typeof fetchCandles>>> = {
      '15m': m15,
      '30m': m30,
      '1h': h1,
      '4h': aggregateCandles(h1, 4),
      '1d': d1,
    };

    const missingTimeframe = Object.entries(candlesByTimeframe).find(([, candles]) => candles.length < 10);
    if (missingTimeframe) {
      return res.status(502).json({
        error: `Insufficient market data for ${smcSymbol} ${missingTimeframe[0]} analysis`,
      });
    }

    res.json(buildSmcReport(smcSymbol, candlesByTimeframe, quote));
  } catch (err) {
    console.error('[ai-insights/smc]', err);
    const message = err instanceof Error ? err.message : 'SMC analysis failed';
    res.status(500).json({ error: message });
  }
});
