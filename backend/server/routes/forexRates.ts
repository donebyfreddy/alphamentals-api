import { Router } from 'express';
import { getTrackedPairRates, getAllRates, getSpotRate } from '../lib/exchangeRateApi.js';

export const forexRatesRouter = Router();

/**
 * GET /api/forex-rates
 * Returns all tracked forex pair rates (EUR/USD, GBP/USD, etc.)
 * Source: ExchangeRate-API (daily updates, low quota cost).
 */
forexRatesRouter.get('/', async (_req, res) => {
  try {
    const rates = await getTrackedPairRates();
    res.json({ rates, source: 'exchangerate-api', updatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[forex-rates]', err);
    res.status(500).json({ error: 'Failed to fetch forex rates' });
  }
});

/**
 * GET /api/forex-rates/all?base=USD
 * Returns the full rate table for a base currency.
 */
forexRatesRouter.get('/all', async (req, res) => {
  try {
    const base = ((req.query.base as string) ?? 'USD').toUpperCase();
    const rates = await getAllRates(base);
    res.json({ base, rates, source: 'exchangerate-api' });
  } catch (err) {
    console.error('[forex-rates/all]', err);
    res.status(500).json({ error: 'Failed to fetch rate table' });
  }
});

/**
 * GET /api/forex-rates/:from/:to
 * Single pair spot rate. e.g. /api/forex-rates/EUR/USD
 */
forexRatesRouter.get('/:from/:to', async (req, res) => {
  try {
    const { from, to } = req.params;
    const rate = await getSpotRate(from, to);
    res.json(rate);
  } catch (err) {
    console.error('[forex-rates/:from/:to]', err);
    res.status(500).json({ error: 'Failed to fetch spot rate' });
  }
});
