"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.forexRatesRouter = void 0;
const express_1 = require("express");
const exchangeRateApi_js_1 = require("../lib/exchangeRateApi.js");
exports.forexRatesRouter = (0, express_1.Router)();
/**
 * GET /api/forex-rates
 * Returns all tracked forex pair rates (EUR/USD, GBP/USD, etc.)
 * Source: ExchangeRate-API (daily updates, low quota cost).
 */
exports.forexRatesRouter.get('/', async (_req, res) => {
    try {
        const rates = await (0, exchangeRateApi_js_1.getTrackedPairRates)();
        res.json({ rates, source: 'exchangerate-api', updatedAt: new Date().toISOString() });
    }
    catch (err) {
        console.error('[forex-rates]', err);
        res.status(500).json({ error: 'Failed to fetch forex rates' });
    }
});
/**
 * GET /api/forex-rates/all?base=USD
 * Returns the full rate table for a base currency.
 */
exports.forexRatesRouter.get('/all', async (req, res) => {
    try {
        const base = (req.query.base ?? 'USD').toUpperCase();
        const rates = await (0, exchangeRateApi_js_1.getAllRates)(base);
        res.json({ base, rates, source: 'exchangerate-api' });
    }
    catch (err) {
        console.error('[forex-rates/all]', err);
        res.status(500).json({ error: 'Failed to fetch rate table' });
    }
});
/**
 * GET /api/forex-rates/:from/:to
 * Single pair spot rate. e.g. /api/forex-rates/EUR/USD
 */
exports.forexRatesRouter.get('/:from/:to', async (req, res) => {
    try {
        const { from, to } = req.params;
        const rate = await (0, exchangeRateApi_js_1.getSpotRate)(from, to);
        res.json(rate);
    }
    catch (err) {
        console.error('[forex-rates/:from/:to]', err);
        res.status(500).json({ error: 'Failed to fetch spot rate' });
    }
});
