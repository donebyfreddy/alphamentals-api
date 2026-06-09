"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.economicCalendarRouter = void 0;
const express_1 = require("express");
const index_js_1 = require("../lib/calendarProviders/index.js");
const claude_js_1 = require("../lib/claude.js");
exports.economicCalendarRouter = (0, express_1.Router)();
function fmt(d) {
    return d.toISOString().split('T')[0];
}
exports.economicCalendarRouter.get('/', async (req, res) => {
    try {
        const now = new Date();
        const from = req.query.from ?? fmt(new Date(now.getTime() - 2 * 86400000));
        const to = req.query.to ?? fmt(new Date(now.getTime() + 7 * 86400000));
        const events = await (0, index_js_1.fetchCalendarFromProviders)(from, to);
        const data = Array.isArray(events) ? events : events?.data ?? [];
        res.json({ ok: true, data });
    }
    catch (err) {
        console.error('[economic-calendar]', err);
        const message = err instanceof Error ? err.message : 'Economic calendar unavailable';
        res.json({ ok: false, error: 'ECONOMIC_CALENDAR_UNAVAILABLE', message });
    }
});
exports.economicCalendarRouter.get('/providers', (_req, res) => {
    res.json((0, index_js_1.getActiveProviders)());
});
exports.economicCalendarRouter.post('/day-summary', async (req, res) => {
    try {
        const { date, events } = req.body;
        if (!date || !Array.isArray(events) || events.length === 0) {
            return res.status(400).json({ error: 'date and events required' });
        }
        const summary = await (0, claude_js_1.generateDaySummary)(date, events);
        res.json(summary);
    }
    catch (err) {
        console.error('[calendar-day-summary]', err);
        res.status(500).json({ error: 'Day summary failed' });
    }
});
exports.economicCalendarRouter.post('/ai-rec', async (req, res) => {
    try {
        const { title, currency, impact, forecast, previous, actual } = req.body;
        const rec = await (0, claude_js_1.generateCalendarRec)({ title, currency, impact, forecast, previous, actual });
        res.json(rec);
    }
    catch (err) {
        console.error('[calendar-ai-rec]', err);
        res.status(500).json({ error: 'AI recommendation failed' });
    }
});
function getDemoEvents() {
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    return [
        { id: 'demo-1', title: 'Federal Reserve Interest Rate Decision', country: 'US', currency: 'USD', flag: '🇺🇸', date: today, time: '18:00', impact: 'high', forecast: '5.25%', previous: '5.25%', actual: null, pairImpacts: ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'NAS100', 'US30'] },
        { id: 'demo-2', title: 'US Non-Farm Payrolls', country: 'US', currency: 'USD', flag: '🇺🇸', date: today, time: '12:30', impact: 'high', forecast: '185K', previous: '175K', actual: '203K', pairImpacts: ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD'] },
        { id: 'demo-3', title: 'ECB Monetary Policy Statement', country: 'EU', currency: 'EUR', flag: '🇪🇺', date: today, time: '13:45', impact: 'high', forecast: null, previous: null, actual: null, pairImpacts: ['EURUSD', 'EURJPY', 'EURGBP'] },
        { id: 'demo-4', title: 'UK CPI y/y', country: 'GB', currency: 'GBP', flag: '🇬🇧', date: tomorrow, time: '06:00', impact: 'medium', forecast: '2.3%', previous: '2.6%', actual: null, pairImpacts: ['GBPUSD', 'GBPJPY', 'EURGBP'] },
        { id: 'demo-5', title: 'Bank of Japan Rate Decision', country: 'JP', currency: 'JPY', flag: '🇯🇵', date: tomorrow, time: '03:00', impact: 'high', forecast: '0.25%', previous: '0.10%', actual: null, pairImpacts: ['USDJPY', 'GBPJPY', 'EURJPY'] },
        { id: 'demo-6', title: 'US ISM Manufacturing PMI', country: 'US', currency: 'USD', flag: '🇺🇸', date: tomorrow, time: '14:00', impact: 'medium', forecast: '49.5', previous: '48.7', actual: null, pairImpacts: ['EURUSD', 'GBPUSD', 'XAUUSD'] },
        { id: 'demo-7', title: 'Australia Employment Change', country: 'AU', currency: 'AUD', flag: '🇦🇺', date: tomorrow, time: '01:30', impact: 'medium', forecast: '30.0K', previous: '22.1K', actual: null, pairImpacts: ['AUDUSD'] },
        { id: 'demo-8', title: 'Canada Retail Sales m/m', country: 'CA', currency: 'CAD', flag: '🇨🇦', date: tomorrow, time: '12:30', impact: 'low', forecast: '0.4%', previous: '0.2%', actual: null, pairImpacts: ['USDCAD'] },
    ];
}
