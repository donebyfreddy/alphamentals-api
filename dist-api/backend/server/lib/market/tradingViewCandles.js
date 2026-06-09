"use strict";
/**
 * TradingView historical candles service.
 *
 * Uses the @mathieuc/tradingview WebSocket client to fetch OHLCV data
 * centred around a specific trade timestamp.
 *
 * SECURITY: credentials (TRADINGVIEW_USERNAME / TRADINGVIEW_PASSWORD) are
 * only read here on the server. They are never returned to the client and
 * never logged.
 *
 * Usage:
 *   import { getTradingViewCandlesForReplay } from './tradingViewCandles.js'
 *   const { candles } = await getTradingViewCandlesForReplay({ symbol, timeframe, entryTime })
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTradingViewCandlesForReplay = getTradingViewCandlesForReplay;
const tradingview_1 = __importDefault(require("@mathieuc/tradingview"));
const symbolMapping_js_1 = require("./symbolMapping.js");
// @mathieuc/tradingview is a CommonJS module; ESM interop gives its module.exports as the default.
const TradingView = tradingview_1.default;
let sessionCache = null;
// Cookie-based sessions don't expire server-side; cache them for 23 hours.
// Password-based sessions expire in 28 minutes (TradingView refreshes them).
const SESSION_TTL_COOKIE_MS = 23 * 60 * 60 * 1000;
const SESSION_TTL_PASSWORD_MS = 28 * 60 * 1000;
async function getAuthenticatedSession() {
    const now = Date.now();
    if (sessionCache && sessionCache.expiresAt > now) {
        return { session: sessionCache.session, signature: sessionCache.signature };
    }
    // Preferred: direct session cookies (required for Google/SSO accounts).
    // Copy from browser DevTools → Application → Cookies → tradingview.com:
    //   sessionid       → TRADINGVIEW_SESSIONID
    //   sessionid_sign  → TRADINGVIEW_SIGNATURE
    const directSession = process.env.TRADINGVIEW_SESSIONID;
    const directSignature = process.env.TRADINGVIEW_SIGNATURE;
    if (directSession && directSignature) {
        sessionCache = { session: directSession, signature: directSignature, expiresAt: now + SESSION_TTL_COOKIE_MS };
        return { session: directSession, signature: directSignature };
    }
    // Fallback: username/password auth.
    // NOTE: accounts created via "Sign in with Google" do NOT have a TradingView
    // password and will receive "We're having a little trouble with that request."
    // Use the cookie method above for those accounts.
    const username = process.env.TRADINGVIEW_USERNAME;
    const password = process.env.TRADINGVIEW_PASSWORD;
    if (!username || !password) {
        throw new Error('TradingView session not configured. ' +
            'Set TRADINGVIEW_SESSIONID + TRADINGVIEW_SIGNATURE (preferred, works for Google accounts) ' +
            'or TRADINGVIEW_USERNAME + TRADINGVIEW_PASSWORD.');
    }
    let user;
    try {
        user = await TradingView.loginUser(username, password, true);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('little trouble') || msg.includes('trouble with that')) {
            throw new Error('TradingView rejected the username/password login. ' +
                'If your account uses "Sign in with Google", copy your sessionid and sessionid_sign ' +
                'cookies from the browser and set TRADINGVIEW_SESSIONID + TRADINGVIEW_SIGNATURE in .env instead.');
        }
        throw err;
    }
    sessionCache = { session: user.session, signature: user.signature, expiresAt: now + SESSION_TTL_PASSWORD_MS };
    return { session: user.session, signature: user.signature };
}
// ── Main export ───────────────────────────────────────────────────────────
const FETCH_TIMEOUT_MS = 15_000;
async function getTradingViewCandlesForReplay(input) {
    const { symbol, entryTime } = input;
    const beforeCandles = input.beforeCandles ?? 150;
    const afterCandles = input.afterCandles ?? 150;
    if (!entryTime) {
        throw new Error('Trade entry time is missing, cannot load historical replay candles.');
    }
    const entryMs = new Date(entryTime).getTime();
    if (Number.isNaN(entryMs)) {
        throw new Error(`Invalid entryTime: "${entryTime}"`);
    }
    const tvSymbol = (0, symbolMapping_js_1.mapToTradingViewSymbol)(symbol);
    const tvTimeframe = (0, symbolMapping_js_1.mapToTradingViewTimeframe)(input.timeframe);
    const { session, signature } = await getAuthenticatedSession();
    const candles = await fetchCandlesFromTV({
        tvSymbol,
        tvTimeframe,
        entryMs,
        beforeCandles,
        afterCandles,
        session,
        signature,
    });
    return {
        source: 'tradingview',
        symbol,
        tvSymbol,
        timeframe: input.timeframe,
        tvTimeframe,
        entryTime,
        beforeCandles,
        afterCandles,
        candles,
    };
}
function fetchCandlesFromTV(opts) {
    const { tvSymbol, tvTimeframe, entryMs, beforeCandles, afterCandles, session, signature } = opts;
    return new Promise((resolve, reject) => {
        let client = null;
        let settled = false;
        const timer = setTimeout(() => {
            settle(new Error(`TradingView fetch timed out after ${FETCH_TIMEOUT_MS / 1000}s for ${tvSymbol} ${tvTimeframe}`));
        }, FETCH_TIMEOUT_MS);
        function settle(errOrCandles) {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            try {
                client?.end();
            }
            catch { /* ignore cleanup errors */ }
            if (errOrCandles instanceof Error)
                reject(errOrCandles);
            else
                resolve(errOrCandles);
        }
        try {
            client = new TradingView.Client({ token: session, signature });
            const chart = new client.Session.Chart();
            chart.onError((...args) => {
                settle(new Error(`TradingView chart error: ${args.join(' ')}`));
            });
            // Strategy: fetch (beforeCandles + afterCandles) candles ending at
            // (entryTimestamp + afterCandles * candleDuration) so the entry is
            // roughly `beforeCandles` bars from the left.
            const candleDurationMs = tvCandleDurationMs(tvTimeframe);
            const toTimestamp = Math.floor((entryMs + afterCandles * candleDurationMs) / 1000);
            const totalRange = beforeCandles + afterCandles;
            chart.setMarket(tvSymbol, {
                timeframe: tvTimeframe,
                range: totalRange,
                to: toTimestamp,
            });
            // Wait for the first update that delivers candle data
            chart.onUpdate(() => {
                const periods = chart.periods;
                if (!periods?.length)
                    return;
                // TV library stores high as `max` and low as `min` (not high/low)
                const candles = periods
                    .map(p => ({
                    time: p.time,
                    open: p.open,
                    high: p.max ?? p.high,
                    low: p.min ?? p.low,
                    close: p.close,
                    volume: p.volume,
                }))
                    .filter(c => typeof c.time === 'number' &&
                    typeof c.open === 'number' &&
                    typeof c.high === 'number' &&
                    typeof c.low === 'number' &&
                    typeof c.close === 'number' &&
                    !Number.isNaN(c.open) && !Number.isNaN(c.high) &&
                    !Number.isNaN(c.low) && !Number.isNaN(c.close))
                    .sort((a, b) => a.time - b.time);
                settle(candles);
            });
        }
        catch (err) {
            settle(err instanceof Error ? err : new Error(String(err)));
        }
    });
}
function tvCandleDurationMs(tvTimeframe) {
    const mins = parseInt(tvTimeframe, 10);
    if (!Number.isNaN(mins))
        return mins * 60 * 1000;
    if (tvTimeframe === 'D')
        return 24 * 60 * 60 * 1000;
    if (tvTimeframe === 'W')
        return 7 * 24 * 60 * 60 * 1000;
    return 60 * 60 * 1000; // default 1h
}
