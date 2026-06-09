"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// backend/server/index.ts
var import_express34 = __toESM(require("express"));
var import_cors = __toESM(require("cors"));
var import_dotenv2 = __toESM(require("dotenv"));
var import_node_net = __toESM(require("node:net"));
var import_promises2 = __toESM(require("node:fs/promises"));

// backend/server/routes/marketData.ts
var import_express = require("express");

// backend/server/lib/market/tradingViewCandles.ts
var import_tradingview = __toESM(require("@mathieuc/tradingview"));

// backend/server/lib/market/symbolMapping.ts
var TV_SYMBOL_MAP = {
  // Forex majors
  EURUSD: "FX_IDC:EURUSD",
  GBPUSD: "FX_IDC:GBPUSD",
  USDJPY: "FX_IDC:USDJPY",
  USDCHF: "FX_IDC:USDCHF",
  AUDUSD: "FX_IDC:AUDUSD",
  USDCAD: "FX_IDC:USDCAD",
  NZDUSD: "FX_IDC:NZDUSD",
  // Crosses
  GBPJPY: "FX_IDC:GBPJPY",
  EURJPY: "FX_IDC:EURJPY",
  EURGBP: "FX_IDC:EURGBP",
  AUDJPY: "FX_IDC:AUDJPY",
  CADJPY: "FX_IDC:CADJPY",
  CHFJPY: "FX_IDC:CHFJPY",
  GBPAUD: "FX_IDC:GBPAUD",
  EURAUD: "FX_IDC:EURAUD",
  EURCAD: "FX_IDC:EURCAD",
  // Metals
  XAUUSD: "OANDA:XAUUSD",
  XAGUSD: "OANDA:XAGUSD",
  // Indices
  US30: "FOREXCOM:DJI",
  NAS100: "FOREXCOM:NSXUSD",
  US500: "FOREXCOM:SPXUSD",
  UK100: "FOREXCOM:UK100",
  GER40: "FOREXCOM:DE30EUR",
  // Crypto
  BTCUSD: "BINANCE:BTCUSDT",
  ETHUSD: "BINANCE:ETHUSDT"
};
var TV_TIMEFRAME_MAP = {
  // Standard app names
  M1: "1",
  M5: "5",
  M15: "15",
  M30: "30",
  H1: "60",
  H4: "240",
  D1: "D",
  W1: "W",
  // Twelve Data / Yahoo style
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "15min": "15",
  "30m": "30",
  "1h": "60",
  "4h": "240",
  "1d": "D",
  // Bare numbers pass through
  "1": "1",
  "5": "5",
  "15": "15",
  "30": "30",
  "60": "60",
  "240": "240",
  "D": "D"
};
function mapToTradingViewSymbol(symbol) {
  const key = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const mapped = TV_SYMBOL_MAP[key];
  if (!mapped) {
    console.warn(`[symbolMapping] No TradingView mapping for "${symbol}", defaulting to FX_IDC:${key}`);
    return `FX_IDC:${key}`;
  }
  return mapped;
}
function mapToTradingViewTimeframe(timeframe) {
  const mapped = TV_TIMEFRAME_MAP[timeframe];
  if (!mapped) {
    console.warn(`[symbolMapping] Unknown timeframe "${timeframe}", defaulting to 60 (1h)`);
    return "60";
  }
  return mapped;
}

// backend/server/lib/market/tradingViewCandles.ts
var TradingView = import_tradingview.default;
var sessionCache = null;
var SESSION_TTL_COOKIE_MS = 23 * 60 * 60 * 1e3;
var SESSION_TTL_PASSWORD_MS = 28 * 60 * 1e3;
async function getAuthenticatedSession() {
  const now2 = Date.now();
  if (sessionCache && sessionCache.expiresAt > now2) {
    return { session: sessionCache.session, signature: sessionCache.signature };
  }
  const directSession = process.env.TRADINGVIEW_SESSIONID;
  const directSignature = process.env.TRADINGVIEW_SIGNATURE;
  if (directSession && directSignature) {
    sessionCache = { session: directSession, signature: directSignature, expiresAt: now2 + SESSION_TTL_COOKIE_MS };
    return { session: directSession, signature: directSignature };
  }
  const username = process.env.TRADINGVIEW_USERNAME;
  const password = process.env.TRADINGVIEW_PASSWORD;
  if (!username || !password) {
    throw new Error(
      "TradingView session not configured. Set TRADINGVIEW_SESSIONID + TRADINGVIEW_SIGNATURE (preferred, works for Google accounts) or TRADINGVIEW_USERNAME + TRADINGVIEW_PASSWORD."
    );
  }
  let user;
  try {
    user = await TradingView.loginUser(username, password, true);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("little trouble") || msg.includes("trouble with that")) {
      throw new Error(
        'TradingView rejected the username/password login. If your account uses "Sign in with Google", copy your sessionid and sessionid_sign cookies from the browser and set TRADINGVIEW_SESSIONID + TRADINGVIEW_SIGNATURE in .env instead.'
      );
    }
    throw err;
  }
  sessionCache = { session: user.session, signature: user.signature, expiresAt: now2 + SESSION_TTL_PASSWORD_MS };
  return { session: user.session, signature: user.signature };
}
var FETCH_TIMEOUT_MS = 15e3;
async function getTradingViewCandlesForReplay(input) {
  const { symbol, entryTime } = input;
  const beforeCandles = input.beforeCandles ?? 150;
  const afterCandles = input.afterCandles ?? 150;
  if (!entryTime) {
    throw new Error("Trade entry time is missing, cannot load historical replay candles.");
  }
  const entryMs = new Date(entryTime).getTime();
  if (Number.isNaN(entryMs)) {
    throw new Error(`Invalid entryTime: "${entryTime}"`);
  }
  const tvSymbol = mapToTradingViewSymbol(symbol);
  const tvTimeframe = mapToTradingViewTimeframe(input.timeframe);
  const { session, signature } = await getAuthenticatedSession();
  const candles = await fetchCandlesFromTV({
    tvSymbol,
    tvTimeframe,
    entryMs,
    beforeCandles,
    afterCandles,
    session,
    signature
  });
  return {
    source: "tradingview",
    symbol,
    tvSymbol,
    timeframe: input.timeframe,
    tvTimeframe,
    entryTime,
    beforeCandles,
    afterCandles,
    candles
  };
}
function fetchCandlesFromTV(opts) {
  const { tvSymbol, tvTimeframe, entryMs, beforeCandles, afterCandles, session, signature } = opts;
  return new Promise((resolve, reject) => {
    let client = null;
    let settled = false;
    const timer2 = setTimeout(() => {
      settle(new Error(`TradingView fetch timed out after ${FETCH_TIMEOUT_MS / 1e3}s for ${tvSymbol} ${tvTimeframe}`));
    }, FETCH_TIMEOUT_MS);
    function settle(errOrCandles) {
      if (settled) return;
      settled = true;
      clearTimeout(timer2);
      try {
        client?.end();
      } catch {
      }
      if (errOrCandles instanceof Error) reject(errOrCandles);
      else resolve(errOrCandles);
    }
    try {
      client = new TradingView.Client({ token: session, signature });
      const chart = new client.Session.Chart();
      chart.onError((...args) => {
        settle(new Error(`TradingView chart error: ${args.join(" ")}`));
      });
      const candleDurationMs = tvCandleDurationMs(tvTimeframe);
      const toTimestamp = Math.floor((entryMs + afterCandles * candleDurationMs) / 1e3);
      const totalRange = beforeCandles + afterCandles;
      chart.setMarket(tvSymbol, {
        timeframe: tvTimeframe,
        range: totalRange,
        to: toTimestamp
      });
      chart.onUpdate(() => {
        const periods = chart.periods;
        if (!periods?.length) return;
        const candles = periods.map((p) => ({
          time: p.time,
          open: p.open,
          high: p.max ?? p.high,
          low: p.min ?? p.low,
          close: p.close,
          volume: p.volume
        })).filter(
          (c) => typeof c.time === "number" && typeof c.open === "number" && typeof c.high === "number" && typeof c.low === "number" && typeof c.close === "number" && !Number.isNaN(c.open) && !Number.isNaN(c.high) && !Number.isNaN(c.low) && !Number.isNaN(c.close)
        ).sort((a, b) => a.time - b.time);
        settle(candles);
      });
    } catch (err) {
      settle(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
function tvCandleDurationMs(tvTimeframe) {
  const mins = parseInt(tvTimeframe, 10);
  if (!Number.isNaN(mins)) return mins * 60 * 1e3;
  if (tvTimeframe === "D") return 24 * 60 * 60 * 1e3;
  if (tvTimeframe === "W") return 7 * 24 * 60 * 60 * 1e3;
  return 60 * 60 * 1e3;
}

// src/lib/mt5BridgeEnv.ts
function resolveMt5BridgeBaseUrl() {
  return process.env.MT5_BRIDGE_URL?.trim() || null;
}
function resolveMt5BridgeApiKey() {
  return process.env.MT5_BRIDGE_API_KEY?.trim() || null;
}
function getMt5BridgeAuthDiagnostics(urlOrEndpoint) {
  const baseUrl = resolveMt5BridgeBaseUrl();
  const apiKey = resolveMt5BridgeApiKey();
  return {
    baseUrlConfigured: Boolean(baseUrl),
    apiKeyConfigured: Boolean(apiKey),
    baseUrl: baseUrl ?? null,
    endpoint: urlOrEndpoint ?? null,
    authHeader: "x-api-key"
  };
}

// src/server/mt5BridgeQuotes.ts
var DISPLAY_NAMES = {
  XAUUSD: "XAU/USD",
  EURUSD: "EUR/USD",
  GBPUSD: "GBP/USD",
  USDJPY: "USD/JPY",
  USDCAD: "USD/CAD",
  AUDUSD: "AUD/USD",
  NZDUSD: "NZD/USD",
  GBPJPY: "GBP/JPY",
  EURJPY: "EUR/JPY",
  EURGBP: "EUR/GBP",
  DXY: "DX/Y",
  USOIL: "WTI/USD",
  NAS100: "NAS100",
  US30: "US30",
  US500: "US500"
};
var EMPTY_SYMBOL_MAP = /* @__PURE__ */ Object.create(null);
function getBridgeConfigDiagnostics() {
  const baseUrl = resolveMt5BridgeBaseUrl();
  const apiKey = resolveMt5BridgeApiKey();
  return {
    mt5BridgeUrlConfigured: Boolean(baseUrl),
    mt5BridgeApiKeyConfigured: Boolean(apiKey),
    mt5BridgeUrl: baseUrl ?? null,
    enableTwelveDataQuotes: false,
    bridgeSymbolMap: EMPTY_SYMBOL_MAP
  };
}
function toMid(bid, ask) {
  if (bid == null || ask == null) return null;
  return Number(((bid + ask) / 2).toFixed(8));
}
function emptyEntry(sym, timestamp) {
  return { symbol: sym, displaySymbol: DISPLAY_NAMES[sym] ?? sym, price: null, bid: null, ask: null, timestamp, provider: "mt5-bridge" };
}
function parseRawQuote(sym, raw, timestamp) {
  const bid = typeof raw.bid === "number" ? raw.bid : null;
  const ask = typeof raw.ask === "number" ? raw.ask : null;
  const last = typeof raw.last === "number" ? raw.last : null;
  return {
    symbol: sym,
    displaySymbol: DISPLAY_NAMES[sym] ?? sym,
    price: toMid(bid, ask) ?? last,
    bid,
    ask,
    timestamp: typeof raw.updatedAt === "string" ? raw.updatedAt : timestamp,
    provider: "mt5-bridge"
  };
}
async function fetchFromBridge(baseUrl, apiKey, symbols) {
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const url = `${baseUrl}/quotes?symbols=${symbols.join(",")}`;
  const controller = new AbortController();
  const timer2 = setTimeout(() => controller.abort(), 1e4);
  let resp;
  try {
    resp = await fetch(url, { signal: controller.signal, headers: { "x-api-key": apiKey } });
  } finally {
    clearTimeout(timer2);
  }
  if (!resp.ok) {
    const errMsg = `MT5 bridge returned HTTP ${resp.status}`;
    return {
      ok: true,
      data: Object.fromEntries(symbols.map((s) => [s, emptyEntry(s, timestamp)])),
      errors: Object.fromEntries(symbols.map((s) => [s, errMsg])),
      timestamp
    };
  }
  const body = await resp.json();
  const data = {};
  const errors = body.errors ? { ...body.errors } : {};
  for (const sym of symbols) {
    const raw = body.data?.[sym];
    if (raw) {
      data[sym] = parseRawQuote(sym, raw, timestamp);
    } else {
      data[sym] = emptyEntry(sym, timestamp);
      if (!errors[sym]) errors[sym] = "Quote not available from MT5 bridge";
    }
  }
  return { ok: true, data, errors, timestamp };
}
async function getPreferredMarketPrices(symbols) {
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const baseUrl = resolveMt5BridgeBaseUrl();
  const apiKey = resolveMt5BridgeApiKey();
  if (!baseUrl || !apiKey) {
    return {
      ok: true,
      data: Object.fromEntries(symbols.map((s) => [s, emptyEntry(s, timestamp)])),
      errors: Object.fromEntries(symbols.map((s) => [s, "MT5 bridge not configured"])),
      timestamp
    };
  }
  try {
    return await fetchFromBridge(baseUrl, apiKey, symbols);
  } catch (err) {
    const message = err instanceof Error ? err.message : "MT5 bridge request failed";
    return {
      ok: false,
      data: Object.fromEntries(symbols.map((s) => [s, emptyEntry(s, timestamp)])),
      errors: Object.fromEntries(symbols.map((s) => [s, message])),
      timestamp
    };
  }
}
async function debugMt5BridgeQuotes(symbols) {
  const diag = getBridgeConfigDiagnostics();
  if (!symbols?.length) return { ok: true, diagnostics: diag };
  const quotes = await getPreferredMarketPrices(symbols);
  return { ok: quotes.ok, diagnostics: diag, quotes };
}

// src/services/pairs/symbolNormalizer.ts
var DISPLAY_MAP = {
  XAUUSD: "XAU/USD",
  EURUSD: "EUR/USD",
  GBPUSD: "GBP/USD",
  USDJPY: "USD/JPY",
  USDCAD: "USD/CAD",
  AUDUSD: "AUD/USD",
  NZDUSD: "NZD/USD",
  GBPJPY: "GBP/JPY",
  EURJPY: "EUR/JPY",
  EURGBP: "EUR/GBP",
  DXY: "US Dollar Index",
  USOIL: "WTI Crude Oil",
  NAS100: "Nasdaq 100",
  US30: "Dow Jones",
  US500: "S&P 500"
};
var ASSET_CLASSES = {
  XAUUSD: "commodity",
  USOIL: "commodity",
  DXY: "index",
  NAS100: "index",
  US30: "index",
  US500: "index"
};
function normalizeApiSymbol(symbol) {
  return symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function normalizeDisplaySymbol(symbol) {
  const key = normalizeApiSymbol(symbol);
  return DISPLAY_MAP[key] ?? key;
}
function getDisplayName(symbol) {
  return normalizeDisplaySymbol(symbol);
}
function getAssetClass(symbol) {
  const key = normalizeApiSymbol(symbol);
  return ASSET_CLASSES[key] ?? "forex";
}

// backend/server/routes/marketData.ts
var marketDataRouter = (0, import_express.Router)();
var SYMBOL_ALIASES = {
  USDX: "DXY",
  TVCDXY: "DXY",
  TVCUSOIL: "USOIL",
  WTI: "USOIL",
  WTIUSD: "USOIL",
  OIL: "USOIL",
  OILUSD: "USOIL"
};
function normalizeSymbol(input) {
  return normalizeApiSymbol(SYMBOL_ALIASES[input.toUpperCase().replace(/[^A-Z0-9]/g, "")] ?? input);
}
function providerFailureBody(err, symbol) {
  const detail = err instanceof Error ? err.message : "Unknown provider error";
  const isHtml = /non-json|<!doctype|<html/i.test(detail);
  return {
    success: false,
    error: isHtml ? "NON_JSON_RESPONSE" : "PROVIDER_ERROR",
    message: isHtml ? "Trading data provider returned HTML instead of JSON" : "Trading data provider request failed",
    pair: symbol,
    status: 502,
    detail
  };
}
var SHORT_SYMBOL_ALLOWLIST = /* @__PURE__ */ new Set(["DXY", "USOIL", "WTI", "OIL", "NAS100", "US30", "US500"]);
function isSupportedSymbol(symbol) {
  if (SHORT_SYMBOL_ALLOWLIST.has(symbol)) return true;
  return /^[A-Z0-9]{6,12}$/.test(symbol);
}
marketDataRouter.get("/quotes", async (req, res) => {
  const symbolsParam = req.query.symbols;
  const symbols = symbolsParam ? symbolsParam.split(",").map((s) => normalizeSymbol(s.trim())).filter((symbol) => isSupportedSymbol(symbol)) : [];
  try {
    if (!symbolsParam) return res.status(400).json({ error: "symbols param required" });
    if (!symbols.length) return res.status(400).json({ error: "No supported symbols requested" });
    const quotes = await getPreferredMarketPrices(symbols);
    res.status(quotes.ok ? 200 : 502).json(quotes);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch MT5 bridge quotes";
    console.error("[Market Data] quotes route failed:", message);
    res.status(502).json({
      ok: false,
      data: {},
      errors: Object.fromEntries(symbols.map((symbol) => [symbol, message])),
      cached: false,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      message
    });
  }
});
marketDataRouter.get("/candles", async (req, res) => {
  try {
    const rawSymbol = req.query.symbol?.toUpperCase();
    const timeframe = req.query.timeframe ?? "1h";
    if (!rawSymbol) return res.status(400).json({ error: "symbol param required" });
    const symbol = normalizeSymbol(rawSymbol);
    if (!isSupportedSymbol(symbol)) return res.status(404).json({ error: "symbol not enabled" });
    const message = `MT5 bridge candles unavailable for ${symbol} ${timeframe}. Live chart candles are no longer served from TwelveData or Yahoo.`;
    return res.status(501).json({
      success: false,
      provider: "mt5-bridge",
      symbol,
      timeframe,
      error: "MT5_BRIDGE_CANDLES_UNAVAILABLE",
      message
    });
  } catch (err) {
    console.error("[Market Data] candles fetch failed:", err instanceof Error ? err.message : err);
    res.status(502).json(providerFailureBody(err, req.query.symbol ?? null));
  }
});
var HOUR_MS = 60 * 60 * 1e3;
function pickTimeframe(entryTime, exitTime) {
  const entryMs = new Date(entryTime).getTime();
  const exitMs = exitTime ? new Date(exitTime).getTime() : entryMs;
  const durationMs = exitMs - entryMs;
  if (durationMs < 4 * HOUR_MS) return "M15";
  if (durationMs < 24 * HOUR_MS) return "H1";
  return "H4";
}
marketDataRouter.get("/candles-for-trade", async (req, res) => {
  const symbol = req.query.symbol?.toUpperCase();
  const entryTime = req.query.entryTime;
  const exitTime = req.query.exitTime;
  const beforeCandles = req.query.before ? Number(req.query.before) : 150;
  const afterCandles = req.query.after ? Number(req.query.after) : 150;
  if (!symbol) {
    res.status(400).json({ error: "symbol param required" });
    return;
  }
  if (!entryTime) {
    res.status(400).json({ error: "entryTime param required \u2014 cannot load historical candles without trade timestamp" });
    return;
  }
  if (Number.isNaN(new Date(entryTime).getTime())) {
    res.status(400).json({ error: `Invalid entryTime: "${entryTime}"` });
    return;
  }
  const timeframe = req.query.timeframe ?? pickTimeframe(entryTime, exitTime);
  const tvTimeframe = mapToTradingViewTimeframe(timeframe);
  try {
    const result = await getTradingViewCandlesForReplay({
      symbol,
      timeframe,
      entryTime,
      beforeCandles,
      afterCandles
    });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[Market Data] candles-for-trade TradingView failed \u2014 symbol=${symbol} tf=${tvTimeframe} entry=${entryTime}: ${message}`);
    res.status(502).json({
      error: "Could not load TradingView historical candles for this trade.",
      reason: message,
      symbol,
      timeframe,
      tvTimeframe,
      entryTime
    });
  }
});
marketDataRouter.get("/technicals", async (req, res) => {
  try {
    const rawSymbol = req.query.symbol?.toUpperCase();
    const timeframe = req.query.interval ?? "1d";
    if (!rawSymbol) return res.status(400).json({ error: "symbol param required" });
    const symbol = normalizeSymbol(rawSymbol);
    if (!isSupportedSymbol(symbol)) return res.status(404).json({ error: "symbol not enabled" });
    res.json({
      symbol,
      timeframe,
      available: false,
      source: "mt5-bridge",
      error: `Technical candle context unavailable for ${symbol}. No MT5 candle feed is configured for this route.`
    });
  } catch (err) {
    console.error("[market-data/technicals]", err);
    res.status(502).json(providerFailureBody(err, req.query.symbol ?? null));
  }
});
marketDataRouter.get("/debug/market-provider", (_req, res) => {
  const diagnostics = getBridgeConfigDiagnostics();
  res.json({
    provider: "mt5-bridge",
    liveQuotes: {
      provider: "mt5-bridge",
      fallbackEnabled: false,
      twelvedataEnabled: diagnostics.enableTwelveDataQuotes,
      twelvedataUsedForLiveQuotes: false
    },
    candles: {
      provider: "unavailable",
      message: "Candle routes no longer fall back to TwelveData or Yahoo."
    },
    bridge: {
      configured: diagnostics.mt5BridgeUrlConfigured && diagnostics.mt5BridgeApiKeyConfigured,
      bridgeUrl: diagnostics.mt5BridgeUrl,
      symbolMap: diagnostics.bridgeSymbolMap
    },
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
});

// backend/server/routes/aiInsights.ts
var import_express2 = require("express");

// backend/server/services/aiAnalysis.service.ts
var import_zod = require("zod");
var import_crypto = require("crypto");

// backend/server/lib/aiDiagnostics.ts
var MINUTE_MS = 6e4;
var MAX_RPM = Number(process.env.AI_MAX_REQUESTS_PER_MINUTE ?? "6");
var state = {
  requestTimestamps: [],
  totalRequests: 0,
  totalCacheHits: 0,
  totalCacheMisses: 0,
  last429At: null,
  cooldownUntil: null,
  lastErrorAt: null,
  lastError: null,
  lastRequestDurationMs: null,
  lastRequestAt: null,
  lastSymbolsBatched: []
};
function pruneOldTimestamps() {
  const cutoff = Date.now() - MINUTE_MS;
  state.requestTimestamps = state.requestTimestamps.filter((t) => t > cutoff);
}
function recordRequest(symbols, durationMs) {
  const now2 = Date.now();
  state.requestTimestamps.push(now2);
  state.totalRequests++;
  state.lastRequestAt = now2;
  state.lastRequestDurationMs = durationMs;
  state.lastSymbolsBatched = symbols;
}
function recordCacheHit() {
  state.totalCacheHits++;
}
function recordCacheMiss() {
  state.totalCacheMisses++;
}
function record429(retryAfterSeconds) {
  const now2 = Date.now();
  state.last429At = now2;
  const cooldownMs = retryAfterSeconds != null ? retryAfterSeconds * 1e3 : 6e4;
  state.cooldownUntil = now2 + cooldownMs;
  console.warn(`[AI] 429 received \u2014 cooling down for ${Math.round(cooldownMs / 1e3)}s`);
}
function recordError(err) {
  state.lastErrorAt = Date.now();
  state.lastError = err;
}
function clearCooldown() {
  state.cooldownUntil = null;
}
function isCoolingDown() {
  if (state.cooldownUntil == null) return false;
  if (Date.now() > state.cooldownUntil) {
    state.cooldownUntil = null;
    return false;
  }
  return true;
}
function canMakeRequest() {
  if (isCoolingDown()) return false;
  pruneOldTimestamps();
  return state.requestTimestamps.length < MAX_RPM;
}
function msUntilNextSlot() {
  pruneOldTimestamps();
  if (state.requestTimestamps.length < MAX_RPM) return 0;
  if (isCoolingDown()) return Math.max(0, (state.cooldownUntil ?? 0) - Date.now());
  const oldest = state.requestTimestamps[0];
  return Math.max(0, oldest + MINUTE_MS - Date.now());
}
function getDiagnostics() {
  pruneOldTimestamps();
  const total = state.totalCacheHits + state.totalCacheMisses;
  return {
    provider: "openai",
    fastModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    deepModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    requestsThisMinute: state.requestTimestamps.length,
    maxRequestsPerMinute: MAX_RPM,
    totalRequests: state.totalRequests,
    totalCacheHits: state.totalCacheHits,
    totalCacheMisses: state.totalCacheMisses,
    last429At: state.last429At,
    cooldownUntil: state.cooldownUntil,
    isCoolingDown: isCoolingDown(),
    lastErrorAt: state.lastErrorAt,
    lastError: state.lastError,
    lastRequestDurationMs: state.lastRequestDurationMs,
    lastRequestAt: state.lastRequestAt,
    lastSymbolsBatched: state.lastSymbolsBatched,
    cacheHitRate: total === 0 ? "n/a" : `${Math.round(state.totalCacheHits / total * 100)}%`
  };
}

// backend/server/lib/supabase.ts
var import_supabase_js = require("@supabase/supabase-js");
function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return {
    url: url.trim(),
    key: key.trim()
  };
}
var cachedClient = null;
var cachedSignature = "";
function buildSignature(url, key) {
  return `${url}::${key.slice(0, 8)}`;
}
function createSupabaseClient(url, key) {
  return (0, import_supabase_js.createClient)(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}
function getSupabase() {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  const nextSignature = buildSignature(url, key);
  if (!cachedClient || cachedSignature !== nextSignature) {
    cachedClient = createSupabaseClient(url, key);
    cachedSignature = nextSignature;
  }
  return cachedClient;
}
var supabase = new Proxy({}, {
  get(_target, prop, receiver) {
    return Reflect.get(getSupabase(), prop, receiver);
  }
});
function isDatabaseConfigured() {
  const { url, key } = getSupabaseConfig();
  return Boolean(url && key);
}

// backend/server/lib/cost/ledger.ts
function recordCost(event) {
  if (!isDatabaseConfigured()) return;
  const promptTokens = event.promptTokens ?? 0;
  const completionTokens = event.completionTokens ?? 0;
  const totalTokens = event.totalTokens ?? promptTokens + completionTokens;
  const row = {
    provider: event.provider,
    service: event.service,
    model: event.model ?? "",
    feature: event.feature ?? "",
    operation: event.operation ?? "",
    request_id: event.requestId ?? "",
    status: event.status,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    input_cost_usd: event.inputCostUsd ?? 0,
    output_cost_usd: event.outputCostUsd ?? 0,
    total_cost_usd: event.totalCostUsd ?? 0,
    currency: "USD",
    metadata_json: event.metadata ?? {}
  };
  supabase.from("api_cost_ledger").insert(row).then(({ error }) => {
    if (error) {
      console.warn("[cost-ledger] insert failed:", error.message);
    } else {
      const cost = event.totalCostUsd ?? 0;
      console.info("[cost-ledger] recorded", {
        provider: event.provider,
        feature: event.feature ?? "-",
        model: event.model ?? "-",
        cost: `$${cost.toFixed(6)}`,
        status: event.status
      });
    }
  }).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[cost-ledger] unexpected error:", message);
  });
}
function rangeStart(range) {
  const now2 = /* @__PURE__ */ new Date();
  if (range === "today") {
    now2.setHours(0, 0, 0, 0);
    return now2.toISOString();
  }
  if (range === "7d") {
    now2.setDate(now2.getDate() - 7);
    return now2.toISOString();
  }
  if (range === "30d") {
    now2.setDate(now2.getDate() - 30);
    return now2.toISOString();
  }
  if (range === "month") {
    now2.setDate(1);
    now2.setHours(0, 0, 0, 0);
    return now2.toISOString();
  }
  now2.setDate(1);
  now2.setHours(0, 0, 0, 0);
  return now2.toISOString();
}
async function queryLedger(opts = {}) {
  if (!isDatabaseConfigured()) return { rows: [], total: 0 };
  const from = rangeStart(opts.range ?? "month");
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = opts.offset ?? 0;
  let q = supabase.from("api_cost_ledger").select("*", { count: "exact" }).gte("created_at", from).order("created_at", { ascending: false }).range(offset, offset + limit - 1);
  if (opts.provider && opts.provider !== "all") q = q.eq("provider", opts.provider);
  if (opts.feature && opts.feature !== "all") q = q.eq("feature", opts.feature);
  const { data, error, count } = await q;
  if (error) throw new Error(`Cost ledger query failed: ${error.message}`);
  return { rows: data ?? [], total: count ?? 0 };
}
async function aggregateCosts(provider, range = "month") {
  if (!isDatabaseConfigured()) {
    return {
      totalRequests: 0,
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      byModel: [],
      byFeature: []
    };
  }
  const from = rangeStart(range);
  const { data, error } = await supabase.from("api_cost_ledger").select("model, feature, prompt_tokens, completion_tokens, total_tokens, total_cost_usd").eq("provider", provider).gte("created_at", from);
  if (error) throw new Error(`Cost aggregate query failed: ${error.message}`);
  const rows = data ?? [];
  let totalRequests = 0, totalTokens = 0, promptTokens = 0, completionTokens = 0, costUsd = 0;
  const modelMap = /* @__PURE__ */ new Map();
  const featureMap = /* @__PURE__ */ new Map();
  for (const row of rows) {
    totalRequests++;
    promptTokens += row.prompt_tokens;
    completionTokens += row.completion_tokens;
    totalTokens += row.total_tokens;
    costUsd += Number(row.total_cost_usd);
    const m = modelMap.get(row.model) ?? { costUsd: 0, requests: 0, tokens: 0 };
    m.costUsd += Number(row.total_cost_usd);
    m.requests += 1;
    m.tokens += row.total_tokens;
    modelMap.set(row.model, m);
    const key = row.feature || "unknown";
    const f = featureMap.get(key) ?? { costUsd: 0, requests: 0, tokens: 0 };
    f.costUsd += Number(row.total_cost_usd);
    f.requests += 1;
    f.tokens += row.total_tokens;
    featureMap.set(key, f);
  }
  return {
    totalRequests,
    totalTokens,
    promptTokens,
    completionTokens,
    costUsd,
    byModel: Array.from(modelMap.entries()).map(([model, v]) => ({ model, ...v })).sort((a, b) => b.costUsd - a.costUsd),
    byFeature: Array.from(featureMap.entries()).map(([feature, v]) => ({ feature, ...v })).sort((a, b) => b.costUsd - a.costUsd)
  };
}

// backend/server/lib/cost/pricing.ts
var DEFAULT_INPUT_PER_1M = 0.15;
var DEFAULT_OUTPUT_PER_1M = 0.6;
var OPENAI_MODELS = [
  {
    provider: "openai",
    model: "gpt-4o-mini",
    inputPer1M: Number(process.env.OPENAI_PRICING_INPUT_PER_1M ?? DEFAULT_INPUT_PER_1M),
    outputPer1M: Number(process.env.OPENAI_PRICING_OUTPUT_PER_1M ?? DEFAULT_OUTPUT_PER_1M)
  },
  {
    provider: "openai",
    model: "gpt-4o",
    inputPer1M: 5,
    outputPer1M: 15
  },
  // Anthropic Claude (used by aiCoach)
  {
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    inputPer1M: 0.8,
    outputPer1M: 4
  },
  {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    inputPer1M: 3,
    outputPer1M: 15
  }
];
function getModelPricing(provider, model) {
  const key = model.toLowerCase();
  const providerKey = provider.toLowerCase();
  const exact = OPENAI_MODELS.find(
    (p) => p.provider === providerKey && p.model === key
  );
  if (exact) return exact;
  return OPENAI_MODELS.find(
    (p) => p.provider === providerKey && key.startsWith(p.model)
  );
}
function calculateCost(provider, model, promptTokens, completionTokens) {
  const pricing = getModelPricing(provider, model);
  if (!pricing) {
    return { inputCostUsd: 0, outputCostUsd: 0, totalCostUsd: 0 };
  }
  const inputCostUsd = promptTokens / 1e6 * pricing.inputPer1M;
  const outputCostUsd = completionTokens / 1e6 * pricing.outputPer1M;
  return { inputCostUsd, outputCostUsd, totalCostUsd: inputCostUsd + outputCostUsd };
}
function getMonthlyFixedCost(envVar) {
  const raw = process.env[envVar];
  if (!raw) return null;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

// backend/server/lib/openaiConfig.ts
var DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
var DEFAULT_PAIR_AI_TIMEOUT_MS = 6e4;
function firstNonEmpty(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
function getConfiguredOpenAIApiKey() {
  return firstNonEmpty([process.env.OPENAI_API_KEY, process.env.OPEN_AI_KEY]);
}
function isOpenAIConfigured() {
  return Boolean(getConfiguredOpenAIApiKey());
}
function getOpenAIModel() {
  return firstNonEmpty([process.env.OPENAI_MODEL]) ?? DEFAULT_OPENAI_MODEL;
}
function getPairAiTimeoutMs() {
  const raw = firstNonEmpty([process.env.PAIR_AI_TIMEOUT_MS, process.env.OPENAI_TIMEOUT_MS]);
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed >= DEFAULT_PAIR_AI_TIMEOUT_MS) return parsed;
  return DEFAULT_PAIR_AI_TIMEOUT_MS;
}
var startupLogged = false;
function logOpenAIConfiguration() {
  if (startupLogged) return;
  startupLogged = true;
  console.log("[openai] OPENAI_API_KEY configured:", isOpenAIConfigured());
}

// backend/server/lib/gemini.ts
function getConfig() {
  const apiKey = getConfiguredOpenAIApiKey();
  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  if (!apiKey) throw new Error("OPENAI_API_KEY must be set");
  return { apiKey, baseUrl };
}
var DEFAULT_MODEL = getOpenAIModel();
function extractTextContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text).join("");
  }
  return "";
}
async function chatComplete(messages, options = {}) {
  if (isCoolingDown()) {
    const msLeft = msUntilNextSlot();
    throw new Error(`AI rate limit cooldown active \u2014 retry in ${Math.ceil(msLeft / 1e3)}s`);
  }
  const { apiKey, baseUrl } = getConfig();
  const { maxTokens = 512, temperature = 0.1 } = options;
  const modelName = options.model ?? DEFAULT_MODEL;
  const startMs = Date.now();
  const timeoutMs = getPairAiTimeoutMs();
  logOpenAIConfiguration();
  try {
    const body = {
      model: modelName,
      messages,
      temperature,
      max_tokens: maxTokens
    };
    if (options.jsonMode) body.response_format = { type: "json_object" };
    const controller = new AbortController();
    const timer2 = setTimeout(() => controller.abort(new DOMException(`timeout after ${timeoutMs}ms`, "TimeoutError")), timeoutMs);
    let res;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer2);
    }
    const text = await res.text();
    if (!res.ok) {
      const retryAfter = res.headers.get("retry-after");
      if (res.status === 429) {
        record429(retryAfter ? Number(retryAfter) : void 0);
      }
      throw new Error(`OpenAI ${res.status}: ${text}`);
    }
    const json = JSON.parse(text);
    const content = extractTextContent(json.choices[0]?.message?.content);
    const usage = json.usage;
    const durationMs = Date.now() - startMs;
    recordRequest(options.symbols ?? [], durationMs);
    const promptTokens = usage?.prompt_tokens ?? 0;
    const completionTokens = usage?.completion_tokens ?? 0;
    const { inputCostUsd, outputCostUsd, totalCostUsd } = calculateCost("openai", modelName, promptTokens, completionTokens);
    recordCost({
      provider: "openai",
      service: "ai",
      model: modelName,
      feature: options.feature ?? "unknown",
      operation: options.operation ?? "chat_complete",
      status: "success",
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      inputCostUsd,
      outputCostUsd,
      totalCostUsd,
      metadata: { symbols: options.symbols ?? [], durationMs, estimated: promptTokens === 0 }
    });
    return {
      content,
      usage: { promptTokens, completionTokens }
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("429") || message.toLowerCase().includes("rate") || message.toLowerCase().includes("quota")) {
      const retryMatch = /retry[ -]?after[^\d]*(\d+)/i.exec(message);
      const retrySeconds = retryMatch ? Number(retryMatch[1]) : void 0;
      record429(retrySeconds);
    }
    recordError(message);
    throw err;
  }
}
async function chatCompleteJSON(messages, options) {
  const response = await chatComplete(messages, { ...options, jsonMode: true });
  const match = /\{[\s\S]*\}/.exec(response.content);
  if (!match) {
    const retry = await chatComplete(messages, { ...options, jsonMode: false });
    const retryMatch = /\{[\s\S]*\}/.exec(retry.content);
    if (!retryMatch) throw new Error("No JSON object in model response after retry");
    return JSON.parse(retryMatch[0]);
  }
  return JSON.parse(match[0]);
}

// backend/server/lib/cache.ts
var store = /* @__PURE__ */ new Map();
function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.data;
}
function getStale(key, gracePeriodMs = 0) {
  const entry = store.get(key);
  if (!entry) return null;
  const now2 = Date.now();
  if (now2 > entry.expiresAt + gracePeriodMs) return null;
  return { data: entry.data, isStale: now2 > entry.expiresAt };
}
function set(key, data, ttlMs) {
  store.set(key, { data, expiresAt: Date.now() + ttlMs, setAt: Date.now() });
}
function delByPrefix(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
function stats() {
  const now2 = Date.now();
  for (const [k, v] of store) {
    if (now2 > v.expiresAt) store.delete(k);
  }
  return { size: store.size, keys: Array.from(store.keys()) };
}

// backend/server/services/aiAnalysis.service.ts
var ClaudeSignalSchema = import_zod.z.object({
  bias: import_zod.z.enum(["bullish", "bearish", "neutral"]),
  confidence: import_zod.z.number().int().min(0).max(100),
  structure: import_zod.z.enum(["BOS", "CHoCH", "ranging"]),
  liquidity: import_zod.z.enum(["buy-side", "sell-side", "balanced"]),
  fundamentals: import_zod.z.enum(["risk-on", "risk-off", "hawkish", "dovish"]),
  newsImpact: import_zod.z.number().int().min(0).max(100),
  sentimentScore: import_zod.z.number().int().min(-100).max(100),
  volatility: import_zod.z.enum(["low", "medium", "high"]),
  tradeReady: import_zod.z.boolean(),
  reasoning: import_zod.z.string()
});
var DaySummarySchema = import_zod.z.object({
  overallVolatility: import_zod.z.enum(["low", "medium", "high", "extreme"]),
  traderVerdict: import_zod.z.enum(["safe-to-trade", "trade-with-caution", "stay-away"]),
  verdictReason: import_zod.z.string(),
  keyEvents: import_zod.z.array(import_zod.z.string()),
  avoidWindows: import_zod.z.array(import_zod.z.string()),
  bestTradingWindows: import_zod.z.array(import_zod.z.string()),
  affectedPairs: import_zod.z.array(import_zod.z.string()),
  reasoning: import_zod.z.string()
});
var CalendarAIRecSchema = import_zod.z.object({
  bias: import_zod.z.string(),
  volatilityExpected: import_zod.z.enum(["low", "medium", "high"]),
  riskLevel: import_zod.z.enum(["low", "medium", "high"]),
  suggestedAction: import_zod.z.string(),
  confidence: import_zod.z.number().int().min(0).max(100),
  reasoning: import_zod.z.string()
});
var TTL_BY_TIMEFRAME = {
  m1: 30 * 6e4,
  m5: 30 * 6e4,
  m15: 60 * 6e4,
  h1: 3 * 60 * 6e4,
  h4: 6 * 60 * 6e4,
  d1: 18 * 60 * 6e4,
  macro: 6 * 60 * 6e4,
  default: 60 * 6e4
};
function ttlFor(timeframe) {
  return TTL_BY_TIMEFRAME[timeframe] ?? TTL_BY_TIMEFRAME.default;
}
var inFlight = /* @__PURE__ */ new Map();
function dedupe(key, fn) {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const p = fn().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}
function hash(data) {
  return (0, import_crypto.createHash)("sha1").update(JSON.stringify(data)).digest("hex").slice(0, 16);
}
async function getDbCache(symbol, timeframe, analysisType, inputHash) {
  try {
    const { data: row } = await supabase.from("market_analysis_cache").select("*").eq("symbol", symbol).eq("timeframe", timeframe).eq("analysisType", analysisType).eq("inputHash", inputHash).maybeSingle();
    if (!row) return null;
    if (new Date(row.expiresAt) < /* @__PURE__ */ new Date()) {
      await supabase.from("market_analysis_cache").delete().eq("symbol", symbol).eq("timeframe", timeframe).eq("analysisType", analysisType).eq("inputHash", inputHash);
      return null;
    }
    return row.aiResponse;
  } catch {
    return null;
  }
}
async function setDbCache(symbol, timeframe, analysisType, inputHash, data, ttlMs, extras) {
  try {
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    await supabase.from("market_analysis_cache").upsert(
      { symbol, timeframe, analysisType, inputHash, aiResponse: data, expiresAt, ...extras },
      { onConflict: "symbol,timeframe,analysisType,inputHash" }
    );
  } catch {
  }
}
function localSmcSignal(candles, quote) {
  const recent = candles.filter((c) => c.close > 0).slice(-40);
  const current = quote?.mid ?? recent.at(-1)?.close ?? 0;
  const previous = recent.at(-8)?.close ?? recent.at(0)?.close ?? current;
  const highs = recent.map((c) => c.high);
  const lows = recent.map((c) => c.low);
  const recentHigh = Math.max(...highs.slice(-12));
  const recentLow = Math.min(...lows.slice(-12));
  const priorHigh = Math.max(...highs.slice(0, -12));
  const priorLow = Math.min(...lows.slice(0, -12));
  const range = Math.max(recentHigh - recentLow, Number.EPSILON);
  const move = current - previous;
  const movePct = Math.abs(move / Math.max(previous, Number.EPSILON));
  const bullishBreak = current > priorHigh;
  const bearishBreak = current < priorLow;
  const bias = bullishBreak || move > range * 0.2 ? "bullish" : bearishBreak || move < -range * 0.2 ? "bearish" : "neutral";
  const structure = bullishBreak || bearishBreak ? "BOS" : Math.abs(move) > range * 0.35 ? "CHoCH" : "ranging";
  const liquidity = current > recentHigh - range * 0.2 ? "buy-side" : current < recentLow + range * 0.2 ? "sell-side" : "balanced";
  const volatility = movePct > 4e-3 ? "high" : movePct > 15e-4 ? "medium" : "low";
  const confidence = bias === "neutral" ? 52 : Math.min(82, Math.max(58, Math.round(58 + Math.min(movePct * 4e3, 24))));
  return {
    bias,
    confidence,
    structure,
    liquidity,
    fundamentals: bias === "bullish" ? "risk-on" : bias === "bearish" ? "risk-off" : "hawkish",
    newsImpact: 0,
    sentimentScore: bias === "bullish" ? confidence - 50 : bias === "bearish" ? 50 - confidence : 0,
    volatility,
    tradeReady: structure !== "ranging" && bias !== "neutral",
    reasoning: "Local SMC fallback: Azure AI unavailable."
  };
}
async function generateSignal(symbol, candles, quote) {
  const timeframe = "h1";
  const inputData = { symbol, closes: candles.slice(-20).map((c) => c.close), price: quote?.mid };
  const inputHash = hash(inputData);
  const memKey = `signal:${symbol}:${inputHash}`;
  const fromMem = get(memKey);
  if (fromMem) return fromMem;
  return dedupe(memKey, async () => {
    const fromDb = await getDbCache(symbol, timeframe, "signal", inputHash);
    if (fromDb) {
      const result = { ...fromDb, cachedAt: Date.now() };
      set(memKey, result, ttlFor(timeframe));
      return result;
    }
    const recent = candles.slice(-20);
    const closes = recent.map((c) => c.close);
    const price = quote?.mid ?? closes.at(-1) ?? 0;
    const high = recent.reduce((m, c) => Math.max(m, c.high), 0);
    const low = recent.reduce((m, c) => Math.min(m, c.low), Infinity);
    const prompt = `SMC/ICT analysis for ${symbol}. Price:${price.toFixed(5)} Change:${(quote?.changePct ?? 0).toFixed(3)}% H:${high.toFixed(5)} L:${low.toFixed(5)} Closes:[${closes.slice(-10).map((c) => c.toFixed(5)).join(",")}]

Return JSON only:
{"bias":"bullish"|"bearish"|"neutral","confidence":0-100,"structure":"BOS"|"CHoCH"|"ranging","liquidity":"buy-side"|"sell-side"|"balanced","fundamentals":"risk-on"|"risk-off"|"hawkish"|"dovish","newsImpact":0-100,"sentimentScore":-100-100,"volatility":"low"|"medium"|"high","tradeReady":true|false,"reasoning":"<2 sentences>"}`;
    let parsed;
    try {
      const raw = await chatCompleteJSON([
        { role: "system", content: "You are a JSON-only SMC trading analysis engine. Output valid JSON." },
        { role: "user", content: prompt }
      ], { maxTokens: 300, temperature: 0.1, feature: "ai_analysis", operation: "generate_signal" });
      parsed = ClaudeSignalSchema.parse(raw);
    } catch {
      parsed = localSmcSignal(candles, quote);
    }
    const ttl = ttlFor(timeframe);
    set(memKey, { ...parsed, cachedAt: Date.now() }, ttl);
    await setDbCache(symbol, timeframe, "signal", inputHash, parsed, ttl, {
      confidence: parsed.confidence,
      sentiment: parsed.bias,
      structure: parsed.structure,
      liquidity: parsed.liquidity,
      reasoning: parsed.reasoning
    });
    return { ...parsed, cachedAt: Date.now() };
  });
}
async function generateDaySummary(date, events) {
  const inputHash = hash({ date, events: events.map((e) => e.title) });
  const memKey = `day-summary:${date}:${inputHash}`;
  const fromMem = get(memKey);
  if (fromMem) return fromMem;
  return dedupe(memKey, async () => {
    const fromDb = await getDbCache("macro", "macro", "day-summary", inputHash);
    if (fromDb) {
      set(memKey, fromDb, ttlFor("macro"));
      return fromDb;
    }
    const eventList = events.sort((a, b) => a.time.localeCompare(b.time)).map((e) => `${e.time}[${e.impact.toUpperCase()}]${e.title}(${e.currency})${e.actual ? ` actual:${e.actual}` : e.forecast ? ` fcst:${e.forecast}` : ""}`).join("; ");
    const prompt = `Forex trading risk brief for ${date}. Events: ${eventList}

Return JSON only:
{"overallVolatility":"low"|"medium"|"high"|"extreme","traderVerdict":"safe-to-trade"|"trade-with-caution"|"stay-away","verdictReason":"<1 sentence>","keyEvents":["..."],"avoidWindows":["..."],"bestTradingWindows":["..."],"affectedPairs":["..."],"reasoning":"<3 sentences>"}`;
    const raw = await chatCompleteJSON([
      { role: "system", content: "You are a JSON-only forex risk analyst." },
      { role: "user", content: prompt }
    ], { maxTokens: 400, temperature: 0.1, feature: "ai_analysis", operation: "day_summary" });
    const parsed = DaySummarySchema.parse(raw);
    const ttl = ttlFor("macro");
    set(memKey, parsed, ttl);
    await setDbCache("macro", "macro", "day-summary", inputHash, parsed, ttl);
    return parsed;
  });
}
async function generateCalendarRec(event) {
  const inputHash = hash(event);
  const memKey = `cal-rec:${event.title}:${event.currency}:${inputHash}`;
  const fromMem = get(memKey);
  if (fromMem) return fromMem;
  return dedupe(memKey, async () => {
    const fromDb = await getDbCache(event.currency, "macro", "cal-rec", inputHash);
    if (fromDb) {
      set(memKey, fromDb, 6e5);
      return fromDb;
    }
    const context = event.actual ? `actual:${event.actual} forecast:${event.forecast ?? "N/A"} prev:${event.previous ?? "N/A"}` : `forecast:${event.forecast ?? "N/A"} prev:${event.previous ?? "N/A"} (pending)`;
    const prompt = `Event: ${event.title} | Currency: ${event.currency} | Impact: ${event.impact} | ${context}

Return JSON only:
{"bias":"<e.g. Bullish USD>","volatilityExpected":"low"|"medium"|"high","riskLevel":"low"|"medium"|"high","suggestedAction":"<1 sentence>","confidence":0-100,"reasoning":"<2 sentences>"}`;
    const raw = await chatCompleteJSON([
      { role: "system", content: "You are a JSON-only forex economic event analyst." },
      { role: "user", content: prompt }
    ], { maxTokens: 200, temperature: 0.1, feature: "ai_analysis", operation: "calendar_recommendation" });
    const parsed = CalendarAIRecSchema.parse(raw);
    set(memKey, parsed, 6e5);
    await setDbCache(event.currency, "macro", "cal-rec", inputHash, parsed, 6e5);
    return parsed;
  });
}

// backend/server/lib/yahoo.ts
var YAHOO_BASE = "https://query1.finance.yahoo.com";
var SYMBOL_MAP = {
  EURUSD: "EURUSD=X",
  GBPUSD: "GBPUSD=X",
  USDJPY: "USDJPY=X",
  USDCHF: "USDCHF=X",
  AUDUSD: "AUDUSD=X",
  USDCAD: "USDCAD=X",
  NZDUSD: "NZDUSD=X",
  GBPJPY: "GBPJPY=X",
  EURJPY: "EURJPY=X",
  XAUUSD: "XAUUSD=X",
  XAGUSD: "SI=F",
  NAS100: "NQ=F",
  US30: "YM=F",
  US500: "ES=F",
  BTCUSD: "BTC-USD",
  ETHUSD: "ETH-USD"
};
var SYMBOL_FALLBACKS = {
  XAUUSD: ["XAUUSD=X", "GC=F"],
  XAGUSD: ["XAGUSD=X", "SI=F"]
};
function toYahoo(symbol, fallbackIndex = 0) {
  const fallbacks = SYMBOL_FALLBACKS[symbol.toUpperCase()];
  if (fallbacks?.[fallbackIndex]) return fallbacks[fallbackIndex];
  return SYMBOL_MAP[symbol.toUpperCase()] ?? `${symbol}=X`;
}
async function yahooFetch(path4, ttlMs) {
  const cached = get(path4);
  if (cached) return cached;
  const res = await fetch(`${YAHOO_BASE}${path4}`, {
    headers: { "User-Agent": "Mozilla/5.0" }
  });
  if (!res.ok) throw new Error(`Yahoo Finance error: ${res.status}`);
  const data = await res.json();
  set(path4, data, ttlMs);
  return data;
}
async function fetchQuoteForYahooSymbol(symbol, ySymbol) {
  const path4 = `/v8/finance/chart/${encodeURIComponent(ySymbol)}?interval=1d&range=1d`;
  const data = await yahooFetch(path4, 15e3);
  const result = data.chart.result?.[0];
  if (!result) throw new Error(`No data for ${symbol}`);
  const meta = result.meta;
  const price = meta.regularMarketPrice;
  const prev = meta.previousClose || price;
  const change = price - prev;
  const spread = price * 2e-4;
  return {
    symbol,
    bid: price - spread / 2,
    ask: price + spread / 2,
    mid: price,
    spread,
    change,
    changePct: change / prev * 100,
    high: meta.regularMarketDayHigh || price,
    low: meta.regularMarketDayLow || price,
    timestamp: meta.regularMarketTime * 1e3
  };
}
async function fetchQuote(symbol) {
  const fallbacks = SYMBOL_FALLBACKS[symbol.toUpperCase()] ?? [toYahoo(symbol)];
  let lastErr;
  for (const ySymbol of fallbacks) {
    try {
      return await fetchQuoteForYahooSymbol(symbol, ySymbol);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`No data for ${symbol}`);
}
async function fetchCandlesForYahooSymbol(ySymbol, timeframe = "1h") {
  const rangeMap = { "1m": "1d", "5m": "5d", "15m": "5d", "1h": "60d", "4h": "60d", "1d": "1y" };
  const range = rangeMap[timeframe] ?? "60d";
  const path4 = `/v8/finance/chart/${encodeURIComponent(ySymbol)}?interval=${timeframe}&range=${range}`;
  const data = await yahooFetch(path4, 6e4);
  const result = data.chart.result?.[0];
  if (!result?.timestamp) return [];
  const q = result.indicators?.quote?.[0];
  if (!q) return [];
  return result.timestamp.map((t, i) => ({
    time: t,
    open: q.open[i] ?? 0,
    high: q.high[i] ?? 0,
    low: q.low[i] ?? 0,
    close: q.close[i] ?? 0,
    volume: q.volume[i] ?? 0
  })).filter((c) => c.close > 0);
}
async function fetchCandles(symbol, timeframe = "1h") {
  const fallbacks = SYMBOL_FALLBACKS[symbol.toUpperCase()] ?? [toYahoo(symbol)];
  let lastErr;
  for (const ySymbol of fallbacks) {
    try {
      const candles = await fetchCandlesForYahooSymbol(ySymbol, timeframe);
      if (candles.length) return candles;
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr) throw lastErr instanceof Error ? lastErr : new Error(`No candles for ${symbol}`);
  return [];
}

// backend/server/lib/smc.ts
var VALID_SMC_SYMBOLS = ["EURUSD", "GBPUSD", "XAUUSD"];
var TIMEFRAMES = ["15m", "30m", "1h", "4h", "1d"];
function normalizeSmcSymbol(symbol) {
  const normalized = symbol.toUpperCase().replace(/[^A-Z]/g, "");
  const corrected = normalized === "GDPUSD" ? "GBPUSD" : normalized;
  return VALID_SMC_SYMBOLS.includes(corrected) ? corrected : null;
}
function aggregateCandles(candles, groupSize) {
  if (groupSize <= 1) return candles;
  const aggregated = [];
  for (let i = 0; i < candles.length; i += groupSize) {
    const group = candles.slice(i, i + groupSize);
    if (group.length < groupSize) continue;
    aggregated.push({
      time: group[0].time,
      open: group[0].open,
      high: Math.max(...group.map((c) => c.high)),
      low: Math.min(...group.map((c) => c.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((sum, c) => sum + (c.volume || 0), 0)
    });
  }
  return aggregated;
}
function round(price) {
  return Number(price.toFixed(price > 100 ? 2 : 5));
}
function candleBody(c) {
  return Math.abs(c.close - c.open);
}
function averageBody(candles) {
  const sample = candles.slice(-30);
  return sample.reduce((sum, c) => sum + candleBody(c), 0) / Math.max(sample.length, 1);
}
function findSwings(candles, lookback = 2) {
  const highs = [];
  const lows = [];
  for (let i = lookback; i < candles.length - lookback; i += 1) {
    const c = candles[i];
    const left = candles.slice(i - lookback, i);
    const right = candles.slice(i + 1, i + 1 + lookback);
    if ([...left, ...right].every((x) => c.high > x.high)) {
      highs.push({ side: "buy-side", level: round(c.high), time: c.time });
    }
    if ([...left, ...right].every((x) => c.low < x.low)) {
      lows.push({ side: "sell-side", level: round(c.low), time: c.time });
    }
  }
  return { highs, lows };
}
function determineBias(highs, lows, candles) {
  const lastHighs = highs.slice(-2);
  const lastLows = lows.slice(-2);
  if (lastHighs.length < 2 || lastLows.length < 2) return "neutral";
  const higherHigh = lastHighs[1].level > lastHighs[0].level;
  const higherLow = lastLows[1].level > lastLows[0].level;
  const lowerHigh = lastHighs[1].level < lastHighs[0].level;
  const lowerLow = lastLows[1].level < lastLows[0].level;
  const close = candles[candles.length - 1]?.close ?? 0;
  if (higherHigh && higherLow && close >= lastLows[1].level) return "bullish";
  if (lowerHigh && lowerLow && close <= lastHighs[1].level) return "bearish";
  return "neutral";
}
function structureEvents(candles, bias, highs, lows) {
  const close = candles[candles.length - 1]?.close;
  const time = candles[candles.length - 1]?.time;
  const previousHigh = highs[highs.length - 1];
  const previousLow = lows[lows.length - 1];
  const bosEvents = [];
  const chochEvents = [];
  if (!close || !time) return { bosEvents, chochEvents };
  if (previousHigh && close > previousHigh.level) {
    const event = { type: bias === "bearish" ? "CHoCH" : "BOS", direction: "bullish", level: previousHigh.level, time };
    (event.type === "CHoCH" ? chochEvents : bosEvents).push(event);
  }
  if (previousLow && close < previousLow.level) {
    const event = { type: bias === "bullish" ? "CHoCH" : "BOS", direction: "bearish", level: previousLow.level, time };
    (event.type === "CHoCH" ? chochEvents : bosEvents).push(event);
  }
  return { bosEvents, chochEvents };
}
function findFvgs(candles) {
  const bullishFvgs = [];
  const bearishFvgs = [];
  for (let i = 2; i < candles.length; i += 1) {
    const first = candles[i - 2];
    const third = candles[i];
    if (first.high < third.low) {
      bullishFvgs.push({ direction: "bullish", low: round(first.high), high: round(third.low), sourceTime: third.time });
    }
    if (first.low > third.high) {
      bearishFvgs.push({ direction: "bearish", low: round(third.high), high: round(first.low), sourceTime: third.time });
    }
  }
  return { bullishFvgs: bullishFvgs.slice(-5), bearishFvgs: bearishFvgs.slice(-5) };
}
function findZonesAndOrderBlocks(candles) {
  const supplyZones = [];
  const demandZones = [];
  const orderBlocks = [];
  const avgBody = averageBody(candles);
  for (let i = 1; i < candles.length; i += 1) {
    const previous = candles[i - 1];
    const current = candles[i];
    const body = candleBody(current);
    const displacement = body > avgBody * 1.5;
    if (displacement && current.close > current.open) {
      demandZones.push({ low: round(current.low), high: round(Math.min(current.open, current.close)), sourceTime: current.time });
      if (previous.close < previous.open) {
        orderBlocks.push({ direction: "buy", low: round(previous.low), high: round(previous.high), sourceTime: previous.time });
      }
    }
    if (displacement && current.close < current.open) {
      supplyZones.push({ low: round(Math.max(current.open, current.close)), high: round(current.high), sourceTime: current.time });
      if (previous.close > previous.open) {
        orderBlocks.push({ direction: "sell", low: round(previous.low), high: round(previous.high), sourceTime: previous.time });
      }
    }
  }
  return {
    supplyZones: supplyZones.slice(-5),
    demandZones: demandZones.slice(-5),
    orderBlocks: orderBlocks.slice(-6)
  };
}
function detectLiquiditySweep(candles, highs, lows) {
  const last = candles[candles.length - 1];
  const previousHigh = highs[highs.length - 1];
  const previousLow = lows[lows.length - 1];
  if (!last) return void 0;
  if (previousHigh && last.high > previousHigh.level && last.close < previousHigh.level) {
    return { side: "buy-side", level: previousHigh.level, time: last.time };
  }
  if (previousLow && last.low < previousLow.level && last.close > previousLow.level) {
    return { side: "sell-side", level: previousLow.level, time: last.time };
  }
  return void 0;
}
function containsPrice(zone, price) {
  return price >= zone.low && price <= zone.high;
}
function analyzeTimeframe(timeframe, candles) {
  const clean2 = candles.filter((c) => c.close > 0).slice(-180);
  const { highs, lows } = findSwings(clean2);
  const bias = determineBias(highs, lows, clean2);
  const { bosEvents, chochEvents } = structureEvents(clean2, bias, highs, lows);
  const { bullishFvgs, bearishFvgs } = findFvgs(clean2);
  const { supplyZones, demandZones, orderBlocks } = findZonesAndOrderBlocks(clean2);
  const lastHighs = highs.slice(-2);
  const lastLows = lows.slice(-2);
  const structure = lastHighs.length >= 2 && lastLows.length >= 2 ? `${lastHighs[1].level > lastHighs[0].level ? "Higher Highs" : "Lower Highs"} / ${lastLows[1].level > lastLows[0].level ? "Higher Lows" : "Lower Lows"}` : "Insufficient confirmed swings";
  return {
    timeframe,
    bias,
    structure,
    bosEvents,
    chochEvents,
    buySideLiquidity: highs.slice(-5),
    sellSideLiquidity: lows.slice(-5),
    supplyZones,
    demandZones,
    orderBlocks,
    bullishFvgs,
    bearishFvgs,
    liquiditySweep: detectLiquiditySweep(clean2, highs, lows)
  };
}
function makeTradeIdea(report, price) {
  const higher = [report["1d"].bias, report["4h"].bias, report["1h"].bias];
  const bullishVotes = higher.filter((b) => b === "bullish").length;
  const bearishVotes = higher.filter((b) => b === "bearish").length;
  const execution = report["1h"];
  if (bullishVotes >= 2) {
    const zone = [...execution.demandZones, ...execution.bullishFvgs, ...execution.orderBlocks.filter((ob) => ob.direction === "buy")].sort((a, b) => Math.abs(price - (a.low + a.high) / 2) - Math.abs(price - (b.low + b.high) / 2))[0];
    if (zone) {
      return [{
        entryType: "buy",
        entryZone: zone,
        stopLossLogic: `Below sell-side liquidity under ${round(zone.low)}`,
        targetLogic: `First target buy-side liquidity near ${execution.buySideLiquidity.at(-1)?.level ?? "next swing high"}`,
        confidence: Math.min(100, 55 + bullishVotes * 10 + (execution.chochEvents.length ? 10 : 0))
      }];
    }
  }
  if (bearishVotes >= 2) {
    const zone = [...execution.supplyZones, ...execution.bearishFvgs, ...execution.orderBlocks.filter((ob) => ob.direction === "sell")].sort((a, b) => Math.abs(price - (a.low + a.high) / 2) - Math.abs(price - (b.low + b.high) / 2))[0];
    if (zone) {
      return [{
        entryType: "sell",
        entryZone: zone,
        stopLossLogic: `Above buy-side liquidity over ${round(zone.high)}`,
        targetLogic: `First target sell-side liquidity near ${execution.sellSideLiquidity.at(-1)?.level ?? "next swing low"}`,
        confidence: Math.min(100, 55 + bearishVotes * 10 + (execution.chochEvents.length ? 10 : 0))
      }];
    }
  }
  return [];
}
function makeAlerts(symbol, report, price) {
  const alerts = [];
  for (const tf of TIMEFRAMES) {
    const analysis = report[tf];
    if (["1h", "4h", "1d"].includes(tf) && analysis.chochEvents.length) {
      alerts.push({ instrument: symbol, eventType: "CHoCH", timeframe: tf, directionalBias: analysis.chochEvents.at(-1)?.direction ?? analysis.bias, suggestedAction: "prepare entry" });
    }
    if (analysis.bosEvents.length) {
      alerts.push({ instrument: symbol, eventType: "BOS", timeframe: tf, directionalBias: analysis.bosEvents.at(-1)?.direction ?? analysis.bias, suggestedAction: "watch" });
    }
    if ([...analysis.bullishFvgs, ...analysis.bearishFvgs].some((fvg) => containsPrice(fvg, price))) {
      alerts.push({ instrument: symbol, eventType: "FVG touch", timeframe: tf, directionalBias: analysis.bias, suggestedAction: "prepare entry" });
    }
    if ([...analysis.supplyZones, ...analysis.demandZones].some((zone) => containsPrice(zone, price))) {
      alerts.push({ instrument: symbol, eventType: "zone entry", timeframe: tf, directionalBias: analysis.bias, suggestedAction: "prepare entry" });
    }
    if (analysis.liquiditySweep) {
      alerts.push({ instrument: symbol, eventType: "liquidity sweep", timeframe: tf, directionalBias: analysis.bias, suggestedAction: "watch" });
    }
  }
  const biases = TIMEFRAMES.map((tf) => report[tf].bias);
  if (biases.every((bias) => bias === "bullish") || biases.every((bias) => bias === "bearish")) {
    alerts.push({ instrument: symbol, eventType: "bias alignment", timeframe: "M15-D1", directionalBias: biases[0], suggestedAction: "watch" });
  }
  return alerts;
}
function buildSmcReport(symbol, candlesByTimeframe, quote) {
  const timeframeAnalysis = TIMEFRAMES.reduce((acc, tf) => {
    acc[tf] = analyzeTimeframe(tf, candlesByTimeframe[tf] ?? []);
    return acc;
  }, {});
  const price = quote?.mid ?? candlesByTimeframe["1h"].at(-1)?.close ?? 0;
  const tradeIdeas = makeTradeIdea(timeframeAnalysis, price);
  const d1 = timeframeAnalysis["1d"].bias;
  const h4 = timeframeAnalysis["4h"].bias;
  const h1 = timeframeAnalysis["1h"].bias;
  const alignment = [d1, h4, h1].filter((bias) => bias !== "neutral");
  const overallAlignment = alignment.length >= 2 && alignment[0] === alignment[1] ? `${alignment[0]} higher-timeframe alignment` : "mixed or neutral higher-timeframe alignment";
  return {
    instrument: symbol,
    biasSummary: {
      "1d": d1,
      "4h": h4,
      "1h": h1,
      "30m": timeframeAnalysis["30m"].bias,
      "15m": timeframeAnalysis["15m"].bias,
      overallAlignment
    },
    keyLevels: {
      supplyZones: [...timeframeAnalysis["4h"].supplyZones, ...timeframeAnalysis["1h"].supplyZones].slice(-6),
      demandZones: [...timeframeAnalysis["4h"].demandZones, ...timeframeAnalysis["1h"].demandZones].slice(-6),
      orderBlocks: [...timeframeAnalysis["4h"].orderBlocks, ...timeframeAnalysis["1h"].orderBlocks].slice(-6),
      liquidityPools: [
        ...timeframeAnalysis["4h"].buySideLiquidity,
        ...timeframeAnalysis["4h"].sellSideLiquidity,
        ...timeframeAnalysis["1h"].buySideLiquidity,
        ...timeframeAnalysis["1h"].sellSideLiquidity
      ].slice(-10)
    },
    structureAnalysis: {
      bosEvents: TIMEFRAMES.flatMap((tf) => timeframeAnalysis[tf].bosEvents),
      chochEvents: TIMEFRAMES.flatMap((tf) => timeframeAnalysis[tf].chochEvents)
    },
    fvgMap: {
      bullishFvgs: [...timeframeAnalysis["4h"].bullishFvgs, ...timeframeAnalysis["1h"].bullishFvgs, ...timeframeAnalysis["30m"].bullishFvgs].slice(-8),
      bearishFvgs: [...timeframeAnalysis["4h"].bearishFvgs, ...timeframeAnalysis["1h"].bearishFvgs, ...timeframeAnalysis["30m"].bearishFvgs].slice(-8)
    },
    tradeIdeas,
    alerts: makeAlerts(symbol, timeframeAnalysis, price),
    timeframeAnalysis
  };
}

// backend/server/routes/aiInsights.ts
var aiInsightsRouter = (0, import_express2.Router)();
aiInsightsRouter.post("/", async (req, res) => {
  try {
    const { symbol, timeframe = "1h" } = req.body;
    if (!symbol) return res.status(400).json({ error: "symbol required" });
    const smcSymbol = normalizeSmcSymbol(symbol);
    if (!smcSymbol) {
      return res.status(400).json({
        error: "Unsupported instrument. Only EURUSD, GBPUSD (GDPUSD is treated as GBPUSD), and XAUUSD are supported."
      });
    }
    const [candles, quote] = await Promise.all([
      fetchCandles(smcSymbol, timeframe),
      fetchQuote(smcSymbol).catch(() => void 0)
    ]);
    if (candles.length < 5) {
      return res.status(502).json({ error: "Insufficient market data for analysis" });
    }
    const signal = await generateSignal(smcSymbol, candles, quote);
    res.json(signal);
  } catch (err) {
    console.error("[ai-insights]", err);
    const message = err instanceof Error ? err.message : "AI analysis failed";
    res.status(500).json({ error: message });
  }
});
aiInsightsRouter.post("/smc", async (req, res) => {
  try {
    const { symbol } = req.body;
    if (!symbol) return res.status(400).json({ error: "symbol required" });
    const smcSymbol = normalizeSmcSymbol(symbol);
    if (!smcSymbol) {
      return res.status(400).json({
        error: "Unsupported instrument. Only EURUSD, GBPUSD (GDPUSD is treated as GBPUSD), and XAUUSD are supported."
      });
    }
    const [m15, m30, h1, d1, quote] = await Promise.all([
      fetchCandles(smcSymbol, "15m"),
      fetchCandles(smcSymbol, "30m"),
      fetchCandles(smcSymbol, "1h"),
      fetchCandles(smcSymbol, "1d"),
      fetchQuote(smcSymbol).catch(() => void 0)
    ]);
    const candlesByTimeframe = {
      "15m": m15,
      "30m": m30,
      "1h": h1,
      "4h": aggregateCandles(h1, 4),
      "1d": d1
    };
    const missingTimeframe = Object.entries(candlesByTimeframe).find(([, candles]) => candles.length < 10);
    if (missingTimeframe) {
      return res.status(502).json({
        error: `Insufficient market data for ${smcSymbol} ${missingTimeframe[0]} analysis`
      });
    }
    res.json(buildSmcReport(smcSymbol, candlesByTimeframe, quote));
  } catch (err) {
    console.error("[ai-insights/smc]", err);
    const message = err instanceof Error ? err.message : "SMC analysis failed";
    res.status(500).json({ error: message });
  }
});

// backend/server/routes/economicCalendar.ts
var import_express3 = require("express");

// backend/server/lib/calendarProviders/finnhubProvider.ts
var BASE = "https://finnhub.io/api/v1";
var COUNTRY_TO_CURRENCY = {
  US: "USD",
  EU: "EUR",
  EA: "EUR",
  EMU: "EUR",
  GB: "GBP",
  JP: "JPY",
  AU: "AUD",
  CA: "CAD",
  CH: "CHF",
  NZ: "NZD",
  CN: "CNY",
  HK: "HKD",
  SG: "SGD",
  NO: "NOK",
  SE: "SEK",
  DK: "DKK",
  MX: "MXN",
  ZA: "ZAR",
  TR: "TRY",
  BR: "BRL",
  IN: "INR",
  KR: "KRW",
  RU: "RUB",
  DE: "EUR",
  FR: "EUR",
  IT: "EUR",
  ES: "EUR",
  PT: "EUR"
};
var CURRENCY_FLAGS = {
  USD: "\u{1F1FA}\u{1F1F8}",
  EUR: "\u{1F1EA}\u{1F1FA}",
  GBP: "\u{1F1EC}\u{1F1E7}",
  JPY: "\u{1F1EF}\u{1F1F5}",
  AUD: "\u{1F1E6}\u{1F1FA}",
  CAD: "\u{1F1E8}\u{1F1E6}",
  CHF: "\u{1F1E8}\u{1F1ED}",
  NZD: "\u{1F1F3}\u{1F1FF}",
  CNY: "\u{1F1E8}\u{1F1F3}",
  HKD: "\u{1F1ED}\u{1F1F0}",
  SGD: "\u{1F1F8}\u{1F1EC}",
  NOK: "\u{1F1F3}\u{1F1F4}",
  SEK: "\u{1F1F8}\u{1F1EA}",
  DKK: "\u{1F1E9}\u{1F1F0}",
  MXN: "\u{1F1F2}\u{1F1FD}",
  ZAR: "\u{1F1FF}\u{1F1E6}",
  TRY: "\u{1F1F9}\u{1F1F7}",
  BRL: "\u{1F1E7}\u{1F1F7}",
  INR: "\u{1F1EE}\u{1F1F3}",
  KRW: "\u{1F1F0}\u{1F1F7}"
};
var CURRENCY_PAIR_MAP = {
  USD: ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD", "XAUUSD", "DXY", "USOIL"],
  EUR: ["EURUSD", "EURJPY", "EURGBP"],
  GBP: ["GBPUSD", "GBPJPY", "EURGBP"],
  JPY: ["USDJPY", "EURJPY", "GBPJPY"],
  AUD: ["AUDUSD"],
  CAD: ["USDCAD", "USOIL"],
  CHF: ["USDCHF"],
  NZD: ["NZDUSD"],
  XAU: ["XAUUSD"]
};
function formatValue(v, unit) {
  if (v === null || v === void 0) return null;
  return `${v}${unit ?? ""}`;
}
function normalizeImpact(impact) {
  const i = (impact ?? "").toLowerCase();
  if (i === "high") return "high";
  if (i === "medium" || i === "moderate") return "medium";
  return "low";
}
var FinnhubProvider = class {
  name = "finnhub";
  isAvailable() {
    return Boolean(process.env.FINNHUB_API_KEY);
  }
  async fetchEvents(from, to) {
    const apiKey = process.env.FINNHUB_API_KEY;
    if (!apiKey) throw new Error("FINNHUB_API_KEY not set in .env");
    const cacheKey2 = `finnhub:calendar:${from}:${to}`;
    const cached = get(cacheKey2);
    if (cached) return cached;
    const url = `${BASE}/calendar/economic?from=${from}&to=${to}&token=${apiKey}`;
    const res = await fetch(url, { headers: { "X-Finnhub-Token": apiKey } });
    if (!res.ok) throw new Error(`Finnhub error: ${res.status} ${res.statusText}`);
    const data = await res.json();
    const raw = data.economicCalendar ?? [];
    const events = raw.map((e, i) => {
      const currency = COUNTRY_TO_CURRENCY[e.country?.toUpperCase()] ?? e.country;
      const [datePart, timePart] = (e.time ?? "").split(" ");
      const time = timePart ? timePart.slice(0, 5) : "00:00";
      return {
        id: `fh-${datePart}-${i}-${e.event.slice(0, 8).replace(/\s/g, "")}`,
        source: "finnhub",
        timeUtc: datePart && time ? `${datePart}T${time}:00Z` : "",
        localTime: null,
        currency,
        country: e.country ?? "",
        title: e.event,
        impact: normalizeImpact(e.impact),
        forecast: formatValue(e.estimate, e.unit),
        previous: formatValue(e.prev, e.unit),
        actual: formatValue(e.actual, e.unit),
        unit: e.unit ?? null,
        affectedPairs: CURRENCY_PAIR_MAP[currency] ?? [],
        category: null,
        sourceUrl: null,
        raw: e,
        // Legacy compat fields consumed by the route mapper
        flag: CURRENCY_FLAGS[currency] ?? "\u{1F30D}",
        date: datePart ?? "",
        time,
        pairImpacts: CURRENCY_PAIR_MAP[currency] ?? []
      };
    });
    const sorted = events.filter((e) => e.timeUtc).sort((a, b) => a.timeUtc.localeCompare(b.timeUtc));
    set(cacheKey2, sorted, 5 * 60 * 1e3);
    return sorted;
  }
};

// backend/server/lib/calendarProviders/tradingEconomicsProvider.ts
var BASE2 = "https://api.tradingeconomics.com";
var COUNTRY_TO_CURRENCY2 = {
  "united states": "USD",
  "euro area": "EUR",
  "united kingdom": "GBP",
  "japan": "JPY",
  "australia": "AUD",
  "canada": "CAD",
  "switzerland": "CHF",
  "new zealand": "NZD",
  "china": "CNY",
  "germany": "EUR",
  "france": "EUR",
  "italy": "EUR",
  "spain": "EUR"
};
var CURRENCY_PAIR_MAP2 = {
  USD: ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD", "XAUUSD", "DXY", "USOIL"],
  EUR: ["EURUSD", "EURJPY", "EURGBP"],
  GBP: ["GBPUSD", "GBPJPY", "EURGBP"],
  JPY: ["USDJPY", "EURJPY", "GBPJPY"],
  AUD: ["AUDUSD"],
  CAD: ["USDCAD", "USOIL"],
  CHF: ["USDCHF"],
  NZD: ["NZDUSD"],
  XAU: ["XAUUSD"]
};
function importanceToImpact(importance) {
  if (importance >= 3) return "high";
  if (importance === 2) return "medium";
  return "low";
}
function resolveCurrency(event) {
  if (event.Currency) return event.Currency.toUpperCase();
  return COUNTRY_TO_CURRENCY2[event.Country?.toLowerCase()] ?? event.Country?.slice(0, 3).toUpperCase() ?? "UNK";
}
var TradingEconomicsProvider = class {
  name = "trading-economics";
  isAvailable() {
    return Boolean(process.env.TRADING_ECONOMICS_API_KEY);
  }
  async fetchEvents(from, to) {
    const apiKey = process.env.TRADING_ECONOMICS_API_KEY;
    if (!apiKey) throw new Error("TRADING_ECONOMICS_API_KEY not set");
    const cacheKey2 = `te:calendar:${from}:${to}`;
    const cached = get(cacheKey2);
    if (cached) return cached;
    const url = `${BASE2}/calendar?c=${apiKey}&d1=${from}&d2=${to}&f=json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Trading Economics error: ${res.status} ${res.statusText}`);
    const raw = await res.json();
    const events = raw.map((e, i) => {
      const currency = resolveCurrency(e);
      const dateStr = e.Date.split("T")[0];
      const timeStr = e.Date.includes("T") ? e.Date.split("T")[1].slice(0, 5) : "00:00";
      const timeUtc = `${dateStr}T${timeStr}:00Z`;
      return {
        id: `te-${dateStr}-${i}-${e.CalendarId}`,
        source: "trading-economics",
        timeUtc,
        localTime: null,
        currency,
        country: e.Country ?? "",
        title: e.Event,
        impact: importanceToImpact(e.Importance),
        forecast: e.Forecast ?? e.TEForecast ?? null,
        previous: e.Previous ?? null,
        actual: e.Actual ?? null,
        unit: e.Unit ?? null,
        affectedPairs: CURRENCY_PAIR_MAP2[currency] ?? [],
        category: e.Category ?? null,
        sourceUrl: e.URL ? `https://tradingeconomics.com${e.URL}` : null,
        raw: e,
        // Legacy compat
        flag: "",
        date: dateStr,
        time: timeStr,
        pairImpacts: CURRENCY_PAIR_MAP2[currency] ?? []
      };
    });
    const sorted = events.filter((e) => e.timeUtc).sort((a, b) => a.timeUtc.localeCompare(b.timeUtc));
    set(cacheKey2, sorted, 5 * 60 * 1e3);
    return sorted;
  }
};

// backend/server/lib/calendarProviders/forexFactoryProvider.ts
var FF_FEED_URL = "https://cdn-nfs.faireconomy.media/ff_calendar_thisweek.xml";
var COUNTRY_TO_CURRENCY3 = {
  USD: "USD",
  EUR: "EUR",
  GBP: "GBP",
  JPY: "JPY",
  AUD: "AUD",
  CAD: "CAD",
  CHF: "CHF",
  NZD: "NZD",
  CNY: "CNY"
};
var CURRENCY_PAIR_MAP3 = {
  USD: ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD", "XAUUSD", "DXY", "USOIL"],
  EUR: ["EURUSD", "EURJPY", "EURGBP"],
  GBP: ["GBPUSD", "GBPJPY", "EURGBP"],
  JPY: ["USDJPY", "EURJPY", "GBPJPY"],
  AUD: ["AUDUSD"],
  CAD: ["USDCAD", "USOIL"],
  CHF: ["USDCHF"],
  NZD: ["NZDUSD"],
  XAU: ["XAUUSD"]
};
var FF_IMPACT_MAP = {
  High: "high",
  Medium: "medium",
  Low: "low",
  Holiday: "low"
};
function parseXmlText(xml, tag) {
  const m = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}[^>]*>([^<]*)</${tag}>`).exec(xml);
  return m ? (m[1] ?? m[2] ?? "").trim() : "";
}
function parseFFXml(xml) {
  const events = [];
  const itemRegex = /<event>([\s\S]*?)<\/event>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    events.push({
      title: parseXmlText(block, "title"),
      country: parseXmlText(block, "country"),
      date: parseXmlText(block, "date"),
      time: parseXmlText(block, "time"),
      impact: parseXmlText(block, "impact"),
      forecast: parseXmlText(block, "forecast"),
      previous: parseXmlText(block, "previous")
    });
  }
  return events;
}
function parseFFDate(date, time) {
  const [month, day, year] = date.split("-");
  const dateStr = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  let timeStr = "00:00";
  if (time && !["tentative", "all day", "all-day"].includes(time.toLowerCase())) {
    const m = /(\d+):(\d+)(am|pm)/i.exec(time);
    if (m) {
      let h = parseInt(m[1], 10);
      const min = m[2];
      if (m[3].toLowerCase() === "pm" && h !== 12) h += 12;
      if (m[3].toLowerCase() === "am" && h === 12) h = 0;
      timeStr = `${String(h).padStart(2, "0")}:${min}`;
    }
  }
  return { dateStr, timeStr, timeUtc: `${dateStr}T${timeStr}:00Z` };
}
var ForexFactoryProvider = class {
  name = "forex-factory";
  isAvailable() {
    return process.env.FOREX_FACTORY_ENABLED === "true";
  }
  async fetchEvents(from, to) {
    if (!this.isAvailable()) return [];
    const now2 = /* @__PURE__ */ new Date();
    const weekStart = new Date(now2);
    weekStart.setDate(now2.getDate() - now2.getDay());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (toDate < weekStart || fromDate > weekEnd) return [];
    const cacheKey2 = `ff:calendar:this-week`;
    const cached = get(cacheKey2);
    if (cached) return cached;
    const res = await fetch(FF_FEED_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AlphaMentals/1.0)" },
      signal: AbortSignal.timeout(1e4)
    });
    if (!res.ok) throw new Error(`Forex Factory feed error: ${res.status}`);
    const xml = await res.text();
    const raw = parseFFXml(xml);
    const events = raw.filter((e) => e.title && e.country).map((e, i) => {
      const currency = COUNTRY_TO_CURRENCY3[e.country.toUpperCase()] ?? e.country.toUpperCase().slice(0, 3);
      const { dateStr, timeStr, timeUtc } = parseFFDate(e.date, e.time);
      const impact = FF_IMPACT_MAP[e.impact] ?? "low";
      return {
        id: `ff-${dateStr}-${i}-${e.title.slice(0, 8).replace(/\s/g, "")}`,
        source: "forex-factory",
        timeUtc,
        localTime: null,
        currency,
        country: e.country,
        title: e.title,
        impact,
        forecast: e.forecast || null,
        previous: e.previous || null,
        actual: null,
        unit: null,
        affectedPairs: CURRENCY_PAIR_MAP3[currency] ?? [],
        category: null,
        sourceUrl: "https://www.forexfactory.com/calendar",
        raw: e,
        // Legacy compat
        flag: "",
        date: dateStr,
        time: timeStr,
        pairImpacts: CURRENCY_PAIR_MAP3[currency] ?? []
      };
    }).sort((a, b) => a.timeUtc.localeCompare(b.timeUtc));
    set(cacheKey2, events, 30 * 60 * 1e3);
    return events;
  }
};

// src/lib/fundamentalEvents.ts
var APP_EVENT_TIMEZONE = "America/New_York";
function getWeekWindow(date, _timezone) {
  const d = date ?? /* @__PURE__ */ new Date();
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day + 6) % 7);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  const from = monday.toISOString().split("T")[0];
  const to = sunday.toISOString().split("T")[0];
  return { from, to, weekKey: `${from}/${to}`, label: `Week of ${from}` };
}
function deriveFundamentalEventTiming(_event) {
  const raw = _event.rawDateTime ?? (_event.rawDate ? `${_event.rawDate}T${_event.rawTime ?? "00:00"}:00Z` : null) ?? (_event.date ? `${_event.date}T${_event.time ?? "00:00"}:00Z` : null);
  if (!raw) return null;
  const date = raw.split("T")[0] ?? raw.slice(0, 10);
  const time = raw.includes("T") ? raw.split("T")[1]?.slice(0, 5) ?? "00:00" : "00:00";
  const providerTimezone = _event.providerTimezone ?? "UTC";
  const appTimezone = _event.appTimezone ?? APP_EVENT_TIMEZONE;
  return {
    date,
    time,
    datetimeUtc: raw,
    datetimeLocal: raw,
    timezone: appTimezone,
    providerTimezone,
    dateLabel: date,
    dateTimeLabel: `${date} ${time}`,
    status: "upcoming",
    isPast: false,
    isToday: false,
    isThisWeek: false,
    isUpcoming: true,
    isNext4Hours: false,
    rawDateTime: _event.rawDateTime ?? null,
    rawDate: _event.rawDate ?? null,
    rawTime: _event.rawTime ?? null
  };
}

// backend/server/lib/calendarProviders/index.ts
var PROVIDERS = [
  new TradingEconomicsProvider(),
  new FinnhubProvider(),
  new ForexFactoryProvider()
];
var CURRENCY_FLAGS2 = {
  USD: "\u{1F1FA}\u{1F1F8}",
  EUR: "\u{1F1EA}\u{1F1FA}",
  GBP: "\u{1F1EC}\u{1F1E7}",
  JPY: "\u{1F1EF}\u{1F1F5}",
  AUD: "\u{1F1E6}\u{1F1FA}",
  CAD: "\u{1F1E8}\u{1F1E6}",
  CHF: "\u{1F1E8}\u{1F1ED}",
  NZD: "\u{1F1F3}\u{1F1FF}",
  CNY: "\u{1F1E8}\u{1F1F3}",
  HKD: "\u{1F1ED}\u{1F1F0}",
  SGD: "\u{1F1F8}\u{1F1EC}",
  NOK: "\u{1F1F3}\u{1F1F4}",
  SEK: "\u{1F1F8}\u{1F1EA}",
  DKK: "\u{1F1E9}\u{1F1F0}",
  MXN: "\u{1F1F2}\u{1F1FD}",
  ZAR: "\u{1F1FF}\u{1F1E6}",
  XAU: "\u{1F947}"
};
function dedupeKey(e) {
  const minute = e.timeUtc.slice(0, 16);
  const titleKey = e.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
  return `${e.currency}:${minute}:${titleKey}`;
}
function attachFlag(e) {
  return { ...e, flag: CURRENCY_FLAGS2[e.currency] ?? "\u{1F30D}" };
}
async function fetchCalendarFromProviders(from, to) {
  const available = PROVIDERS.filter((p) => p.isAvailable());
  if (available.length === 0) {
    throw new Error("No calendar providers configured. Set FINNHUB_API_KEY, TRADING_ECONOMICS_API_KEY, or FOREX_FACTORY_ENABLED=true.");
  }
  const results = await Promise.allSettled(
    available.map(
      (p) => p.fetchEvents(from, to).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[calendar] ${p.name} failed: ${msg}`);
        return [];
      })
    )
  );
  const seen = /* @__PURE__ */ new Map();
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const event of result.value) {
      const key = dedupeKey(event);
      if (!seen.has(key)) seen.set(key, event);
    }
  }
  return Array.from(seen.values()).filter((e) => e.timeUtc).sort((a, b) => a.timeUtc.localeCompare(b.timeUtc)).map((e) => {
    const withFlag = attachFlag(e);
    const ext = e;
    const [rawDatePart, rawTimeFull] = e.timeUtc.split("T");
    const rawTime = rawTimeFull ? rawTimeFull.slice(0, 5) : "00:00";
    const timing = deriveFundamentalEventTiming({
      rawDateTime: e.timeUtc,
      providerTimezone: "UTC",
      appTimezone: APP_EVENT_TIMEZONE
    });
    const date = timing?.date ?? ext.date ?? rawDatePart ?? "";
    const time = timing?.time ?? ext.time ?? rawTime;
    const debugPayload = {
      source: e.source,
      title: e.title,
      rawProviderTime: e.timeUtc,
      parsedUtcTime: timing?.datetimeUtc ?? e.timeUtc,
      displayedMadridTime: timing ? `${timing.dateTimeLabel} ${timing.timezone}` : `${date} ${time} ${APP_EVENT_TIMEZONE}`
    };
    console.debug("[economic-calendar:timezone]", debugPayload);
    return {
      ...withFlag,
      date,
      time,
      pairImpacts: ext.pairImpacts ?? e.affectedPairs,
      datetimeUtc: timing?.datetimeUtc ?? e.timeUtc,
      datetimeLocal: timing?.datetimeLocal ?? `${date}T${time}:00`,
      timezone: timing?.timezone ?? APP_EVENT_TIMEZONE,
      dateTimeLabel: timing?.dateTimeLabel ?? `${date}, ${time}`,
      rawProviderTime: e.timeUtc
    };
  });
}
function getActiveProviders() {
  return PROVIDERS.map((p) => ({ name: p.name, available: p.isAvailable() }));
}

// backend/server/routes/economicCalendar.ts
var economicCalendarRouter = (0, import_express3.Router)();
function fmt(d) {
  return d.toISOString().split("T")[0];
}
economicCalendarRouter.get("/", async (req, res) => {
  try {
    const now2 = /* @__PURE__ */ new Date();
    const from = req.query.from ?? fmt(new Date(now2.getTime() - 2 * 864e5));
    const to = req.query.to ?? fmt(new Date(now2.getTime() + 7 * 864e5));
    const events = await fetchCalendarFromProviders(from, to);
    const data = Array.isArray(events) ? events : events?.data ?? [];
    res.json({ ok: true, data });
  } catch (err) {
    console.error("[economic-calendar]", err);
    const message = err instanceof Error ? err.message : "Economic calendar unavailable";
    res.json({ ok: false, error: "ECONOMIC_CALENDAR_UNAVAILABLE", message });
  }
});
economicCalendarRouter.get("/providers", (_req, res) => {
  res.json(getActiveProviders());
});
economicCalendarRouter.post("/day-summary", async (req, res) => {
  try {
    const { date, events } = req.body;
    if (!date || !Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: "date and events required" });
    }
    const summary = await generateDaySummary(date, events);
    res.json(summary);
  } catch (err) {
    console.error("[calendar-day-summary]", err);
    res.status(500).json({ error: "Day summary failed" });
  }
});
economicCalendarRouter.post("/ai-rec", async (req, res) => {
  try {
    const { title, currency, impact, forecast, previous, actual } = req.body;
    const rec = await generateCalendarRec({ title, currency, impact, forecast, previous, actual });
    res.json(rec);
  } catch (err) {
    console.error("[calendar-ai-rec]", err);
    res.status(500).json({ error: "AI recommendation failed" });
  }
});

// backend/server/routes/macroData.ts
var import_express4 = require("express");

// backend/server/lib/fred.ts
var FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";
var CACHE_TTL_MS = 4 * 60 * 60 * 1e3;
var lastRequestAt = 0;
var MIN_INTERVAL_MS = 520;
async function throttle() {
  const now2 = Date.now();
  const wait = MIN_INTERVAL_MS - (now2 - lastRequestAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}
async function fetchFredSeries(seriesId, limit = 2, startDate) {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) throw new Error("FRED_API_KEY not set");
  const cacheKey2 = `fred:${seriesId}:${limit}:${startDate ?? ""}`;
  const cached = get(cacheKey2);
  if (cached) return cached;
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: "json",
    sort_order: "desc",
    limit: String(limit)
  });
  if (startDate) params.set("observation_start", startDate);
  const url = `${FRED_BASE}?${params.toString()}`;
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await throttle();
      const res = await fetch(url);
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 2e3 * attempt));
        continue;
      }
      if (!res.ok) {
        const body = await res.text();
        if (res.status === 400 || res.status === 404) {
          const result2 = { seriesId, observations: [], available: false };
          set(cacheKey2, result2, CACHE_TTL_MS);
          return result2;
        }
        throw new Error(`FRED HTTP ${res.status}: ${body}`);
      }
      const json = await res.json();
      const observations = json.observations.filter((o) => o.value !== ".").map((o) => ({ date: o.date, value: parseFloat(o.value) }));
      const result = { seriesId, observations, available: true };
      set(cacheKey2, result, CACHE_TTL_MS);
      return result;
    } catch (err) {
      lastErr = err;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1e3 * attempt));
    }
  }
  throw lastErr;
}
function extractValues(result) {
  if (!result.available || result.observations.length === 0) {
    return { current: null, previous: null };
  }
  const current = result.observations[0]?.value ?? null;
  const previous = result.observations[1]?.value ?? null;
  return { current, previous };
}
async function fetchYoYChange(seriesId) {
  const result = await fetchFredSeries(seriesId, 14);
  if (!result.available || result.observations.length < 13) {
    const { current, previous } = extractValues(result);
    return { current, previous, yoy: null };
  }
  const latest = result.observations[0].value;
  const yearAgo = result.observations[12].value;
  const prev = result.observations[1].value;
  const prevYearAgo = result.observations[13]?.value ?? null;
  const yoy = latest != null && yearAgo != null ? (latest - yearAgo) / yearAgo * 100 : null;
  const previousYoy = prev != null && prevYearAgo != null ? (prev - prevYearAgo) / prevYearAgo * 100 : null;
  return { current: yoy, previous: previousYoy, yoy };
}

// backend/server/lib/fredSeries.ts
var FRED_SERIES = {
  USD: [
    { seriesId: "FEDFUNDS", name: "Fed Funds Rate", indicatorType: "interest_rate", fetchMode: "latest", unit: "%" },
    { seriesId: "CPIAUCSL", name: "CPI YoY", indicatorType: "inflation", fetchMode: "yoy", unit: "%" },
    { seriesId: "CPILFESL", name: "Core CPI YoY", indicatorType: "core_inflation", fetchMode: "yoy", unit: "%" },
    { seriesId: "DGS2", name: "2Y Treasury Yield", indicatorType: "yield_2y", fetchMode: "latest", unit: "%" },
    { seriesId: "DGS10", name: "10Y Treasury Yield", indicatorType: "yield_10y", fetchMode: "latest", unit: "%" },
    { seriesId: "DFII10", name: "10Y Real Yield (TIPS)", indicatorType: "real_yield_10y", fetchMode: "latest", unit: "%" },
    { seriesId: "UNRATE", name: "Unemployment Rate", indicatorType: "unemployment", fetchMode: "latest", unit: "%" },
    { seriesId: "A191RL1Q225SBEA", name: "GDP Growth QoQ", indicatorType: "gdp_growth", fetchMode: "latest", unit: "%" }
  ],
  EUR: [
    { seriesId: "ECBDFR", name: "ECB Deposit Facility Rate", indicatorType: "interest_rate", fetchMode: "latest", unit: "%" },
    { seriesId: "CP0000EZ19M086NEST", name: "Euro Area HICP YoY", indicatorType: "inflation", fetchMode: "yoy", unit: "%" },
    { seriesId: "IRLTLT01EZM156N", name: "Euro Area 10Y Bond Yield", indicatorType: "yield_10y", fetchMode: "latest", unit: "%" },
    { seriesId: "IRSTCI01EZM156N", name: "Euro Area Short-term Rate", indicatorType: "yield_2y", fetchMode: "latest", unit: "%" },
    { seriesId: "LRHUTTTTEZM156S", name: "Euro Area Unemployment", indicatorType: "unemployment", fetchMode: "latest", unit: "%" },
    { seriesId: "CLVMNACSCAB1GQEA19", name: "Euro Area GDP Growth QoQ", indicatorType: "gdp_growth", fetchMode: "yoy", unit: "%" }
  ],
  GBP: [
    { seriesId: "IUDSOIA", name: "BoE SONIA Rate", indicatorType: "interest_rate", fetchMode: "latest", unit: "%" },
    { seriesId: "GBRCPIALLMINMEI", name: "UK CPI YoY", indicatorType: "inflation", fetchMode: "yoy", unit: "%" },
    { seriesId: "IRLTLT01GBM156N", name: "UK 10Y Gilt Yield", indicatorType: "yield_10y", fetchMode: "latest", unit: "%" },
    { seriesId: "IRSTCI01GBM156N", name: "UK Short-term Rate", indicatorType: "yield_2y", fetchMode: "latest", unit: "%" },
    { seriesId: "LRHUTTTTGBM156S", name: "UK Unemployment Rate", indicatorType: "unemployment", fetchMode: "latest", unit: "%" }
  ]
};
var DERIVED_INDICATORS = {
  USD: [
    {
      indicatorType: "real_yield_10y",
      name: "USD Real Yield 10Y (nominal - inflation)",
      unit: "%",
      compute: (ind) => {
        const y = ind["yield_10y"];
        const i = ind["inflation"];
        if (y == null || i == null) return null;
        return Number.parseFloat((y - i).toFixed(4));
      }
    }
  ]
};
var ALL_CURRENCIES = ["USD", "EUR", "GBP"];

// backend/server/lib/macroSync.ts
var cachedSnapshot = null;
var lastSyncedAt = null;
function computeYieldCurve(y10, y2) {
  if (y10 == null || y2 == null) return null;
  return Number.parseFloat((y10 - y2).toFixed(4));
}
async function fetchCurrencyIndicators(currency) {
  const series = FRED_SERIES[currency] ?? [];
  const result = {};
  for (const config of series) {
    let current = null;
    let previous = null;
    let source = "none";
    try {
      if (config.fetchMode === "yoy") {
        const res = await fetchYoYChange(config.seriesId);
        current = res.current;
        previous = res.previous;
      } else {
        const raw = await fetchFredSeries(config.seriesId, 2);
        ({ current, previous } = extractValues(raw));
      }
      if (current !== null) source = "FRED";
    } catch (err) {
      console.warn(`[macroSync] FRED ${currency}:${config.seriesId} failed:`, err.message);
    }
    if (current === null && config.fallback) {
      try {
        const fb = await config.fallback();
        current = fb.current;
        previous = fb.previous;
        if (current !== null) {
          source = fb.source;
          console.info(`[macroSync] ${currency}:${config.indicatorType} using fallback (${source})`);
        }
      } catch (err) {
        console.warn(`[macroSync] Fallback ${currency}:${config.indicatorType} failed:`, err.message);
      }
    }
    result[config.indicatorType] = { current, previous, source };
  }
  const derived = DERIVED_INDICATORS[currency] ?? [];
  for (const d of derived) {
    if (result[d.indicatorType]?.current !== null) continue;
    const flatCurrents = {};
    for (const [k, v] of Object.entries(result)) flatCurrents[k] = v.current;
    const computed = d.compute(flatCurrents);
    if (computed !== null) {
      result[d.indicatorType] = { current: computed, previous: null, source: "derived" };
    }
  }
  return result;
}
async function syncMacroIndicators() {
  console.log("[macroSync] Starting sync\u2026");
  const snapshot = {};
  for (const currency of ALL_CURRENCIES) {
    console.log(`[macroSync] Fetching ${currency}\u2026`);
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
      gdp_growth: indicators.gdp_growth?.current ?? null
    };
  }
  cachedSnapshot = snapshot;
  lastSyncedAt = Date.now();
  console.log("[macroSync] Sync complete.");
  return cachedSnapshot;
}
function getMacroSnapshot() {
  if (cachedSnapshot === null) {
    throw new Error("Macro data not yet available \u2014 sync in progress");
  }
  return cachedSnapshot;
}

// backend/server/routes/macroData.ts
var macroDataRouter = (0, import_express4.Router)();
var SNAPSHOT_CACHE_KEY = "macro:snapshot";
var SNAPSHOT_TTL_MS = 60 * 60 * 1e3;
macroDataRouter.get("/", async (_req, res) => {
  try {
    const cached = get(SNAPSHOT_CACHE_KEY);
    if (cached) return res.json(cached);
    const snapshot = await getMacroSnapshot();
    set(SNAPSHOT_CACHE_KEY, snapshot, SNAPSHOT_TTL_MS);
    res.json(snapshot);
  } catch (err) {
    console.error("[macro/GET]", err);
    res.status(500).json({ error: "Failed to load macro snapshot" });
  }
});
macroDataRouter.get("/:currency", async (req, res) => {
  try {
    const currency = req.params.currency.toUpperCase();
    const cached = get(SNAPSHOT_CACHE_KEY);
    const snapshot = cached ?? await getMacroSnapshot();
    if (!cached) set(SNAPSHOT_CACHE_KEY, snapshot, SNAPSHOT_TTL_MS);
    const data = snapshot[currency];
    if (!data) return res.status(404).json({ error: `Currency ${currency} not found` });
    res.json({ [currency]: data });
  } catch (err) {
    console.error("[macro/GET/:currency]", err);
    res.status(500).json({ error: "Failed to load macro snapshot" });
  }
});
macroDataRouter.post("/sync", async (_req, res) => {
  try {
    console.log("[macro/sync] Manual sync triggered via API");
    const snapshot = await syncMacroIndicators();
    set(SNAPSHOT_CACHE_KEY, snapshot, SNAPSHOT_TTL_MS);
    res.json({ ok: true, syncedAt: (/* @__PURE__ */ new Date()).toISOString(), currencies: Object.keys(snapshot) });
  } catch (err) {
    console.error("[macro/sync]", err);
    res.status(500).json({ error: "Sync failed", detail: err.message });
  }
});

// backend/server/routes/forexRates.ts
var import_express5 = require("express");

// backend/server/lib/exchangeRateApi.ts
var ERA_BASE = "https://v6.exchangerate-api.com/v6";
var TABLE_TTL_MS = 60 * 6e4;
async function fetchRateTable(baseCurrency) {
  const apiKey = process.env.EXCHANGE_RATE_API_KEY;
  if (!apiKey) throw new Error("EXCHANGE_RATE_API_KEY not set");
  const cacheKey2 = `era:${baseCurrency}`;
  const cached = get(cacheKey2);
  if (cached) return cached;
  const url = `${ERA_BASE}/${apiKey}/latest/${baseCurrency.toUpperCase()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ExchangeRate-API HTTP ${res.status}`);
  const data = await res.json();
  if (data.result !== "success") throw new Error(`ExchangeRate-API error: ${data.result}`);
  set(cacheKey2, data, TABLE_TTL_MS);
  return data;
}
async function getSpotRate(from, to) {
  const table = await fetchRateTable(from.toUpperCase());
  const rate = table.conversion_rates[to.toUpperCase()];
  if (rate == null) throw new Error(`Currency ${to} not found in rate table`);
  return { from: from.toUpperCase(), to: to.toUpperCase(), rate, lastUpdated: table.time_last_update_utc };
}
async function getAllRates(baseCurrency = "USD") {
  const table = await fetchRateTable(baseCurrency.toUpperCase());
  return table.conversion_rates;
}
var TRACKED_FOREX_PAIRS = [
  { from: "EUR", to: "USD" },
  { from: "GBP", to: "USD" },
  { from: "USD", to: "JPY" },
  { from: "USD", to: "CHF" },
  { from: "AUD", to: "USD" },
  { from: "USD", to: "CAD" },
  { from: "NZD", to: "USD" },
  { from: "EUR", to: "GBP" },
  { from: "EUR", to: "JPY" },
  { from: "GBP", to: "JPY" },
  { from: "EUR", to: "CHF" },
  { from: "AUD", to: "JPY" }
];
async function getTrackedPairRates() {
  const [usdTable, eurTable] = await Promise.all([
    fetchRateTable("USD"),
    fetchRateTable("EUR")
  ]);
  return TRACKED_FOREX_PAIRS.map(({ from, to }) => {
    let rate;
    if (from === "USD") {
      rate = usdTable.conversion_rates[to] ?? 0;
    } else if (to === "USD") {
      rate = eurTable.conversion_rates[to] ?? 0;
      const usdToFrom = usdTable.conversion_rates[from];
      rate = usdToFrom ? parseFloat((1 / usdToFrom).toFixed(6)) : 0;
    } else {
      const usdToFrom = usdTable.conversion_rates[from];
      const usdToTo = usdTable.conversion_rates[to];
      rate = usdToFrom && usdToTo ? parseFloat((usdToTo / usdToFrom).toFixed(6)) : 0;
    }
    return {
      from,
      to,
      rate,
      lastUpdated: usdTable.time_last_update_utc
    };
  });
}

// backend/server/routes/forexRates.ts
var forexRatesRouter = (0, import_express5.Router)();
forexRatesRouter.get("/", async (_req, res) => {
  try {
    const rates = await getTrackedPairRates();
    res.json({ rates, source: "exchangerate-api", updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
  } catch (err) {
    console.error("[forex-rates]", err);
    res.status(500).json({ error: "Failed to fetch forex rates" });
  }
});
forexRatesRouter.get("/all", async (req, res) => {
  try {
    const base2 = (req.query.base ?? "USD").toUpperCase();
    const rates = await getAllRates(base2);
    res.json({ base: base2, rates, source: "exchangerate-api" });
  } catch (err) {
    console.error("[forex-rates/all]", err);
    res.status(500).json({ error: "Failed to fetch rate table" });
  }
});
forexRatesRouter.get("/:from/:to", async (req, res) => {
  try {
    const { from, to } = req.params;
    const rate = await getSpotRate(from, to);
    res.json(rate);
  } catch (err) {
    console.error("[forex-rates/:from/:to]", err);
    res.status(500).json({ error: "Failed to fetch spot rate" });
  }
});

// backend/server/routes/journal.ts
var import_express6 = require("express");

// backend/server/services/tradeScoring.service.ts
var NEGATIVE_EMOTIONS = /* @__PURE__ */ new Set([
  "FEARFUL",
  "GREEDY",
  "REVENGE",
  "FOMO",
  "ANGRY",
  "FRUSTRATED",
  "IMPATIENT",
  "STRESSED",
  "EMOTIONAL",
  "OVERCONFIDENT",
  "ANXIOUS",
  "REGRETFUL",
  "DISAPPOINTED"
]);
var GRADE_BASE = {
  A_PLUS: 95,
  A: 85,
  B: 68,
  C: 50,
  FORCED: 25,
  NO_SETUP: 15
};
function clamp(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}
function hasTag(tags, ...names) {
  if (!tags) return false;
  return names.some((n) => tags.includes(n));
}
function isNegativeEmotion(emotion) {
  return emotion != null && NEGATIVE_EMOTIONS.has(emotion);
}
function stopLossMissing(input) {
  if (input.stopLoss == null || input.stopLoss === 0) return true;
  if (input.entryPrice != null && input.stopLoss === input.entryPrice) return true;
  return false;
}
function computeBlueprintMatch(input) {
  const followed = input.blueprintRulesFollowed?.length ?? 0;
  const broken = input.blueprintRulesBroken?.length ?? 0;
  const total = followed + broken;
  if (total === 0) return null;
  return Math.round(followed / total * 100);
}
function blueprintGradeFromScore(score) {
  if (score == null) return null;
  if (score >= 90) return "A+";
  if (score >= 75) return "A";
  if (score >= 60) return "B";
  return "C";
}
function scoreSetup(input, blueprintMatch) {
  const grade = typeof input.setupQualityGrade === "string" ? input.setupQualityGrade : null;
  const gradeBase = grade != null && grade in GRADE_BASE ? GRADE_BASE[grade] : 55;
  if (blueprintMatch == null) return clamp(gradeBase);
  return clamp(gradeBase * 0.6 + blueprintMatch * 0.4);
}
function scoreExecution(input) {
  let s = 70;
  if (hasTag(input.mistakeTags, "LATE_ENTRY", "CHASED_PRICE", "NO_CONFIRMATION")) s -= 12;
  if (hasTag(input.mistakeTags, "EARLY_EXIT", "EMOTIONAL_EXIT")) s -= 10;
  if (input.movedStopLoss === true) s -= 12;
  if (input.closedEarly === true) s -= 10;
  if (input.hesitation === true) s -= 6;
  if (input.followedPlan === true) s += 10;
  else if (input.followedPlan === false) s -= 15;
  return clamp(s);
}
function scorePsychology(input) {
  let s = 78;
  if (input.isRevengeTrade === true) s -= 30;
  if (input.isFomo === true) s -= 20;
  if (isNegativeEmotion(input.preTradeEmotion)) s -= 10;
  if (isNegativeEmotion(input.duringTradeEmotion)) s -= 8;
  if (isNegativeEmotion(input.postTradeEmotion)) s -= 4;
  if (input.preTradeEmotion === "TIRED" || input.duringTradeEmotion === "TIRED") s -= 8;
  if (input.hesitation === true) s -= 5;
  if (hasTag(input.mistakeTags, "TRADED_EMOTIONAL", "REVENGE_TRADE", "FOMO_ENTRY")) s -= 10;
  return clamp(s);
}
function scoreDiscipline(input, blueprintMatch) {
  let s = 80;
  if (hasTag(input.mistakeTags, "NO_PLAN")) s -= 40;
  if (input.followedPlan === false) s -= 25;
  else if (input.followedPlan === true) s += 8;
  const broken = input.blueprintRulesBroken?.length ?? 0;
  s -= broken * 6;
  if (hasTag(input.mistakeTags, "WRONG_SESSION", "TRADED_RED_NEWS")) s -= 10;
  if (hasTag(input.mistakeTags, "BROKE_DAILY_LOSS_LIMIT", "BROKE_MAX_RISK")) s -= 15;
  if (blueprintMatch != null && blueprintMatch < 60) s -= 8;
  return clamp(s);
}
function scoreRisk(input, flags) {
  let s = 75;
  if (stopLossMissing(input)) {
    s -= 40;
    flags.push("NO_STOP_LOSS");
  }
  if (input.riskPercent == null || input.riskPercent === 0) {
    s -= 15;
    flags.push("RISK_UNKNOWN");
  } else if (input.maxRiskPercent != null && input.riskPercent > input.maxRiskPercent) {
    s -= 20;
    flags.push("RISK_ABOVE_PLAN");
  }
  if (input.takeProfit == null || input.takeProfit === 0) {
    s -= 8;
    flags.push("NO_TAKE_PROFIT");
  }
  if (input.rrPlanned != null && input.rrPlanned < 1) {
    s -= 15;
    flags.push("POOR_RR");
  }
  if (hasTag(input.mistakeTags, "OVER_LEVERAGED", "RISK_TOO_HIGH")) s -= 20;
  if (hasTag(input.mistakeTags, "BAD_RR")) s -= 12;
  if (hasTag(input.mistakeTags, "MOVED_STOP", "WIDENED_STOP") || input.movedStopLoss === true) s -= 15;
  return clamp(s);
}
function scorePatience(input) {
  let s = 78;
  if (hasTag(input.mistakeTags, "LATE_ENTRY", "CHASED_PRICE", "FOMO_ENTRY") || input.isFomo === true) s -= 15;
  if (hasTag(input.mistakeTags, "EARLY_EXIT") || input.closedEarly === true) s -= 15;
  if (hasTag(input.mistakeTags, "OVERTRADED")) s -= 15;
  if (hasTag(input.mistakeTags, "NO_CONFIRMATION")) s -= 10;
  if (input.hesitation === true) s -= 5;
  if (input.preTradeEmotion === "IMPATIENT" || input.duringTradeEmotion === "IMPATIENT") s -= 10;
  return clamp(s);
}
function suggestLossClassification(input, blueprintMatch, riskScore, disciplineScore, psychologyScore) {
  const isLoss = (input.pnl ?? 0) < 0;
  if (!isLoss) return null;
  const noMistakes = (input.mistakeTags?.length ?? 0) === 0;
  const planFollowed = input.followedPlan === true;
  const goodBlueprint = blueprintMatch == null || blueprintMatch >= 80;
  if (planFollowed && noMistakes && goodBlueprint) return "VALID_LOSS";
  if (hasTag(input.mistakeTags, "NO_PLAN") || input.followedPlan === false) return "RULE_VIOLATION";
  if (riskScore < 50) return "RISK";
  if (psychologyScore < 50 || input.isRevengeTrade === true || input.isFomo === true) return "PSYCHOLOGY";
  if (disciplineScore < 50) return "STRATEGY";
  return "EXECUTION";
}
function computeScores(input) {
  const flags = [];
  const blueprintMatchScore = computeBlueprintMatch(input);
  const setupQuality = scoreSetup(input, blueprintMatchScore);
  const executionScore = scoreExecution(input);
  const psychologyScore = scorePsychology(input);
  const disciplineScore = scoreDiscipline(input, blueprintMatchScore);
  const riskScore = scoreRisk(input, flags);
  const patienceScore = scorePatience(input);
  if (blueprintMatchScore != null && blueprintMatchScore < 60) flags.push("LOW_BLUEPRINT_MATCH");
  if ((input.pnl ?? 0) > 0 && (input.followedPlan === false || hasTag(input.mistakeTags, "NO_PLAN"))) {
    flags.push("PROFITABLE_BUT_UNDISCIPLINED");
  }
  if (input.setupQualityGrade === "FORCED" || input.setupQualityGrade === "NO_SETUP") {
    flags.push("FORCED_TRADE");
  }
  const overallScore = clamp(
    setupQuality * 0.2 + executionScore * 0.2 + psychologyScore * 0.2 + disciplineScore * 0.2 + riskScore * 0.15 + patienceScore * 0.05
  );
  const suggestedLossClassification = suggestLossClassification(
    input,
    blueprintMatchScore,
    riskScore,
    disciplineScore,
    psychologyScore
  );
  return {
    setupQuality,
    executionScore,
    psychologyScore,
    disciplineScore,
    riskScore,
    patienceScore,
    overallScore,
    blueprintMatchScore,
    blueprintGrade: blueprintGradeFromScore(blueprintMatchScore),
    flags,
    suggestedLossClassification
  };
}

// backend/server/services/playbook.service.ts
var BLUEPRINT_CATEGORIES = /* @__PURE__ */ new Set(["A_PLUS", "A", "B", "C"]);
var DIRECTIONAL_NAMES = /* @__PURE__ */ new Set([
  "A+ Sell \u2014 Supply + High Sweep + Bearish CHOCH",
  "A+ Buy \u2014 Demand + Low Sweep + Bullish CHOCH",
  "A Sell \u2014 POI + Sweep + Bearish CHOCH",
  "A Buy \u2014 POI + Sweep + Bullish CHOCH",
  "B Sell \u2014 Strong POI + Bearish CHOCH (Weak Sweep)",
  "B Buy \u2014 Strong POI + Bullish CHOCH (Weak Sweep)"
]);
var DEFAULT_SETUPS = [
  {
    name: "A+ Setup \u2014 Premium POI + Liquidity Sweep + CHOCH",
    category: "A_PLUS",
    description: "Highest quality setup. Price reaches a valid HTF POI, sweeps liquidity, rejects strongly, confirms CHOCH with displacement, and provides FVG or retest entry confirmation.",
    tags: ["DYNAMIC", "HTF_ALIGNED", "SWEEP_REQUIRED", "CHOCH_REQUIRED", "A_PLUS"],
    timeframes: ["W", "D", "4H", "1H", "5M", "1M"],
    sessions: ["LONDON", "NEW_YORK", "OVERLAP"],
    rules: [
      "HTF bias is clearly defined",
      "LTF aligns with selected trade direction",
      "Price reaches valid HTF supply or demand zone",
      "Relevant Asian or London liquidity is swept",
      "Strong rejection from POI",
      "CHOCH confirmed on 1M or 5M",
      "CHOCH candle closes clearly beyond structure",
      "Displacement candle present",
      "FVG or retest of CHOCH level confirms entry",
      "Stop loss placed beyond sweep extreme",
      "Take profit targets opposite liquidity",
      "RR minimum 2R confirmed",
      "No high-impact news within 30 minutes",
      "No revenge trade \u2014 one setup at a time"
    ],
    confirmations: [
      "CHOCH on 1M or 5M after liquidity sweep",
      "CHOCH candle fully closed",
      "FVG present in displacement move",
      "Retest of CHOCH level holds",
      "Displacement momentum is clear"
    ],
    invalidations: [
      "No CHOCH confirmation \u2014 no trade",
      "CHOCH candle has not closed",
      "HTF bias not clearly defined",
      "No valid POI or supply/demand zone",
      "No liquidity sweep",
      "High-impact news within 30 minutes",
      "RR below 2R",
      "Stop loss not beyond sweep extreme",
      "Revenge trade or emotional state",
      "Second trade already open"
    ],
    notes: "Best quality setup. All conditions must be present. Direction is dynamic: use buy logic at demand after low sweep and bullish CHOCH; use sell logic at supply after high sweep and bearish CHOCH.",
    isActive: true
  },
  {
    name: "A Setup \u2014 POI + Sweep + CHOCH",
    category: "A",
    description: "High quality setup. Price reaches a valid POI, liquidity sweep is present, CHOCH confirms the direction, and FVG or retest provides entry confirmation.",
    tags: ["DYNAMIC", "HTF_ALIGNED", "SWEEP_REQUIRED", "CHOCH_REQUIRED", "A"],
    timeframes: ["D", "4H", "1H", "5M", "1M"],
    sessions: ["LONDON", "NEW_YORK", "OVERLAP"],
    rules: [
      "HTF bias is clear",
      "LTF aligns with selected trade direction",
      "Price reaches valid POI or supply/demand zone",
      "Liquidity sweep is present",
      "CHOCH confirmed after sweep",
      "CHOCH candle closes beyond structure",
      "FVG or retest confirms entry",
      "Stop loss beyond sweep or structure extreme",
      "Take profit targets opposite liquidity",
      "RR minimum 2R",
      "No revenge trade"
    ],
    confirmations: [
      "CHOCH confirmed",
      "CHOCH candle closed",
      "FVG or retest present",
      "HTF bias supports selected direction"
    ],
    invalidations: [
      "No CHOCH confirmation",
      "CHOCH candle not closed",
      "HTF bias not clear",
      "No POI or supply/demand zone",
      "High-impact news within 30 minutes",
      "RR below 2R"
    ],
    notes: "Valid tradable setup. Direction is dynamic and determined by the chart: buy from demand after low sweep and bullish CHOCH; sell from supply after high sweep and bearish CHOCH.",
    isActive: true
  },
  {
    name: "B Setup \u2014 Strong POI + CHOCH",
    category: "B",
    description: "Minimum tradable setup. Strong supply/demand POI reaction with CHOCH. Liquidity sweep may be weak or missing, so confidence is reduced.",
    tags: ["DYNAMIC", "CHOCH_REQUIRED", "B", "REDUCED_CONFIDENCE"],
    timeframes: ["4H", "1H", "5M", "1M"],
    sessions: ["LONDON", "NEW_YORK"],
    rules: [
      "HTF bias is clear or mostly clear",
      "Price reacts from strong supply/demand, premium/discount zone, or POI",
      "Sweep may be missing or not clean",
      "CHOCH confirmed \u2014 mandatory",
      "CHOCH candle closes beyond structure \u2014 mandatory",
      "At least one confirmation: FVG, retest, or mini supply/demand",
      "Stop loss beyond structure extreme",
      "RR minimum 2R \u2014 mandatory",
      "No revenge trade"
    ],
    confirmations: [
      "CHOCH confirmed and candle closed",
      "At least one of: FVG, retest, or mini supply/demand",
      "Strong POI reaction visible"
    ],
    invalidations: [
      "No CHOCH \u2014 invalid regardless of setup",
      "CHOCH candle not closed",
      "RR below 2R",
      "HTF and LTF strongly conflict",
      "No confirmation at all (no FVG, no retest)"
    ],
    notes: "Reduced confidence \u2014 minimum tradable. Direction is dynamic and determined by whether price reacts from supply with bearish CHOCH or demand with bullish CHOCH.",
    isActive: true
  },
  {
    name: "C Setup \u2014 Invalid / Do Not Trade",
    category: "C",
    description: "This setup is invalid. One or more mandatory conditions are missing. Do not risk capital.",
    tags: ["DYNAMIC", "DO_NOT_TRADE", "C", "INVALID"],
    timeframes: [],
    sessions: [],
    rules: [
      "No clear HTF bias OR HTF/LTF conflict",
      "No valid POI identified",
      "No liquidity sweep and weak POI reaction",
      "No CHOCH \u2014 trade is invalid",
      "CHOCH candle has not closed \u2014 wait",
      "No displacement candle",
      "No FVG or retest confirmation",
      "RR below 2R \u2014 do not trade",
      "Stop loss not beyond valid invalidation",
      "High-impact news nearby",
      "Emotional state \u2014 revenge or FOMO detected",
      "Multiple trades already open"
    ],
    confirmations: [],
    invalidations: [
      "No CHOCH = immediate invalidation",
      "RR below 2R = immediate invalidation",
      "News risk present = wait",
      "Emotional state = do not trade"
    ],
    notes: "C Setup \u2014 DO NOT TRADE. Close the charts, step away, and wait for a valid setup.",
    isActive: true
  }
];
async function listSetups(userId2, includeInactive = false) {
  let query2 = supabase.from("playbook_setups").select("*").eq("userId", userId2);
  if (!includeInactive) query2 = query2.eq("isActive", true);
  const { data, error } = await query2.order("createdAt", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}
async function getSetup(userId2, id) {
  const { data, error } = await supabase.from("playbook_setups").select("*").eq("id", id).eq("userId", userId2).single();
  if (error || !data) throw new Error("Setup not found");
  return data;
}
function toRow(userId2, input) {
  return {
    userId: userId2,
    name: input.name,
    description: input.description ?? null,
    category: input.category ?? "CUSTOM",
    rules: input.rules ?? [],
    confirmations: input.confirmations ?? [],
    invalidations: input.invalidations ?? [],
    timeframes: input.timeframes ?? [],
    sessions: input.sessions ?? [],
    tags: input.tags ?? [],
    notes: input.notes ?? null,
    isActive: input.isActive ?? true
  };
}
async function createSetup(userId2, input) {
  const { data, error } = await supabase.from("playbook_setups").insert(toRow(userId2, input)).select().single();
  if (error) throw new Error(error.message);
  return data;
}
async function updateSetup(userId2, id, input) {
  await getSetup(userId2, id);
  const patch = { updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
  const keys = [
    "name",
    "description",
    "category",
    "rules",
    "confirmations",
    "invalidations",
    "timeframes",
    "sessions",
    "tags",
    "notes",
    "isActive"
  ];
  for (const k of keys) {
    if (input[k] !== void 0) patch[k] = input[k];
  }
  const { data, error } = await supabase.from("playbook_setups").update(patch).eq("id", id).eq("userId", userId2).select().single();
  if (error) throw new Error(error.message);
  return data;
}
async function deleteSetup(userId2, id) {
  await getSetup(userId2, id);
  const { error } = await supabase.from("playbook_setups").delete().eq("id", id).eq("userId", userId2);
  if (error) throw new Error(error.message);
}
async function archiveSetupIds(userId2, ids) {
  if (ids.length === 0) return;
  const { error } = await supabase.from("playbook_setups").update({ isActive: false, updatedAt: (/* @__PURE__ */ new Date()).toISOString() }).in("id", ids).eq("userId", userId2);
  if (error) throw new Error(error.message);
}
async function upsertCanonicalSetup(userId2, existing, setup) {
  const found = existing.find((s) => s.name === setup.name);
  if (found) {
    const { error } = await supabase.from("playbook_setups").update({ ...toRow(userId2, setup), updatedAt: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", found.id).eq("userId", userId2);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("playbook_setups").insert(toRow(userId2, setup));
    if (error) throw new Error(error.message);
  }
}
async function seedDefaultSetups(userId2) {
  const existing = await listSetups(userId2, true);
  const canonicalNames = new Set(DEFAULT_SETUPS.map((s) => s.name));
  const activeCanonical = existing.filter((s) => s.isActive && canonicalNames.has(s.name));
  if (activeCanonical.length === DEFAULT_SETUPS.length) {
    return existing.filter((s) => s.isActive);
  }
  const directionalIds = existing.filter((s) => s.isActive && DIRECTIONAL_NAMES.has(s.name)).map((s) => s.id);
  await archiveSetupIds(userId2, directionalIds);
  const legacyIds = existing.filter((s) => s.isActive && !BLUEPRINT_CATEGORIES.has(s.category)).map((s) => s.id);
  await archiveSetupIds(userId2, legacyIds);
  for (const setup of DEFAULT_SETUPS) {
    await upsertCanonicalSetup(userId2, existing, setup);
  }
  const { data: refreshed, error: refreshErr } = await supabase.from("playbook_setups").select("*").eq("userId", userId2).eq("isActive", true).order("createdAt", { ascending: true });
  if (refreshErr) throw new Error(refreshErr.message);
  return refreshed ?? [];
}
async function recomputeSetupStats(userId2, setupId) {
  const { data: trades } = await supabase.from("trades").select("pnl, rrActual, status").eq("userId", userId2).eq("setupId", setupId).eq("status", "CLOSED");
  const t = trades ?? [];
  const total = t.length;
  if (total === 0) {
    await supabase.from("playbook_setups").update({ totalTrades: 0, winRate: 0, avgRR: 0, profitFactor: 0, expectancy: 0, updatedAt: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", setupId).eq("userId", userId2);
    return;
  }
  const wins = t.filter((x) => (x.pnl ?? 0) > 0);
  const rr = t.filter((x) => x.rrActual != null).map((x) => x.rrActual);
  const winRate = wins.length / total;
  const avgRR = rr.length ? rr.reduce((a, b) => a + b, 0) / rr.length : 0;
  const grossWin = t.filter((x) => (x.pnl ?? 0) > 0).reduce((s, x) => s + (x.pnl ?? 0), 0);
  const grossLoss = Math.abs(t.filter((x) => (x.pnl ?? 0) < 0).reduce((s, x) => s + (x.pnl ?? 0), 0));
  let profitFactor;
  if (grossLoss > 0) {
    profitFactor = grossWin / grossLoss;
  } else {
    profitFactor = grossWin > 0 ? 999 : 0;
  }
  const expectancy = winRate * avgRR - (1 - winRate);
  await supabase.from("playbook_setups").update({
    totalTrades: total,
    winRate: Math.round(winRate * 1e3) / 10,
    avgRR: Math.round(avgRR * 100) / 100,
    profitFactor: Math.round(profitFactor * 100) / 100,
    expectancy: Math.round(expectancy * 100) / 100,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  }).eq("id", setupId).eq("userId", userId2);
}

// backend/server/lib/cost/counters.ts
var store2 = {
  twelvedata: { requestCount: 0, failedCount: 0, lastActivityAt: null, symbolCounts: {} },
  resend: { requestCount: 0, failedCount: 0, lastActivityAt: null, symbolCounts: {} },
  metaapi: { requestCount: 0, failedCount: 0, lastActivityAt: null, symbolCounts: {} }
};
function now() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function incrementResend(failed = false) {
  const c = store2.resend;
  c.requestCount++;
  if (failed) c.failedCount++;
  c.lastActivityAt = now();
}
function getTwelveDataCounters() {
  return { ...store2.twelvedata };
}
function getResendCounters() {
  return { ...store2.resend };
}
function getMetaApiCounters() {
  return { ...store2.metaapi };
}

// backend/server/lib/mailer.ts
function hasResend() {
  return Boolean(process.env.RESEND_API_KEY);
}
function getMailMode() {
  return hasResend() ? "resend" : "none";
}
function isEmailConfigured() {
  return hasResend();
}
function getSenderEmail() {
  return process.env.RESEND_FROM_EMAIL ?? null;
}
var RESEND_API_URL = "https://api.resend.com/emails";
var SEND_TIMEOUT_MS = 3e4;
var RETRY_DELAYS_MS = [0, 5e3, 15e3, 45e3];
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function sendMailOnce(input, fromEmail, apiKey) {
  const fromName = input.fromName ?? process.env.RESEND_FROM_NAME ?? "AlphaMentals";
  const logCtx = {
    provider: "resend",
    signal: input.context?.signal ?? null,
    messageId: input.context?.messageId ?? null,
    to: input.to
  };
  console.log("[mailer] Sending email", { ...logCtx, stage: "sending" });
  const body = {
    from: `${fromName} <${fromEmail}>`,
    to: [input.to],
    subject: input.subject,
    html: input.html
  };
  if (input.cc) body.cc = [input.cc];
  if (input.text) body.text = input.text;
  const controller = new AbortController();
  const timer2 = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer2);
  }
  const rawText = await response.text().catch(() => "");
  if (!response.ok) {
    let detail = rawText;
    try {
      const parsed = JSON.parse(rawText);
      detail = parsed.message ?? parsed.name ?? rawText;
    } catch {
    }
    const error = `HTTP ${response.status}: ${detail}`;
    console.error("[mailer] Resend API failed", { ...logCtx, stage: "failed", status: response.status, error });
    return { ok: false, mode: "resend", error };
  }
  let emailId;
  try {
    const data = JSON.parse(rawText);
    emailId = data.id;
  } catch {
  }
  console.log("[mailer] Email sent", { ...logCtx, stage: "sent", emailId: emailId ?? null });
  return { ok: true, mode: "resend", emailId };
}
async function sendMail(input) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[mailer] RESEND_API_KEY is not set");
    return { ok: false, mode: "none", error: "Email is not configured. Set RESEND_API_KEY." };
  }
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  if (!fromEmail) {
    console.error("[mailer] RESEND_FROM_EMAIL is not set");
    return { ok: false, mode: "resend", error: "RESEND_FROM_EMAIL is not set. Add a verified sender address." };
  }
  let lastResult = { ok: false, mode: "resend", error: "Not attempted" };
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay > 0) {
      console.log(`[mailer] Retry ${attempt}/${RETRY_DELAYS_MS.length - 1} in ${delay}ms`, {
        provider: "resend",
        signal: input.context?.signal ?? null,
        attempt
      });
      await sleep(delay);
    }
    try {
      lastResult = await sendMailOnce(input, fromEmail, apiKey);
      if (lastResult.ok) {
        incrementResend(false);
        recordCost({ provider: "resend", service: "email", feature: "notifications", operation: "send_email", status: "success" });
        return lastResult;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastResult = { ok: false, mode: "resend", error: message };
      console.error(`[mailer] Send attempt ${attempt + 1} threw:`, {
        provider: "resend",
        signal: input.context?.signal ?? null,
        stage: "failed",
        error: message
      });
    }
  }
  incrementResend(true);
  recordCost({
    provider: "resend",
    service: "email",
    feature: "notifications",
    operation: "send_email",
    status: "failed",
    metadata: { error: lastResult.error }
  });
  console.error("[mailer] All send attempts exhausted", {
    provider: "resend",
    signal: input.context?.signal ?? null,
    stage: "failed",
    error: lastResult.error,
    attempts: RETRY_DELAYS_MS.length
  });
  return lastResult;
}

// backend/server/lib/webhook.ts
function isValidWebhookUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
async function sendWebhook(url, secret, payload) {
  if (!isValidWebhookUrl(url)) {
    return { ok: false, error: "Invalid webhook URL" };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8e3);
  try {
    const headers = { "Content-Type": "application/json" };
    if (secret) headers["X-Webhook-Secret"] = secret;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!res.ok) {
      return { ok: false, status: res.status, error: `Webhook responded ${res.status}` };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown webhook error";
    console.error("[webhook] send failed:", message);
    return { ok: false, error: message };
  } finally {
    clearTimeout(timeout);
  }
}

// backend/server/services/notification.service.ts
var NOTIFICATION_CATEGORIES = [
  "economic_calendar",
  "market_intelligence",
  "high_impact_news",
  "fundamentals",
  "telegram_signals",
  "account_sync",
  "journal_trade",
  "dashboard_alert",
  "risk_management",
  "ai_coach",
  "system_error"
];
var CATEGORY_LABELS = {
  economic_calendar: "Economic Calendar",
  market_intelligence: "Market Intelligence",
  high_impact_news: "High-Impact News",
  fundamentals: "Fundamentals",
  telegram_signals: "Telegram Signals",
  account_sync: "Account Sync",
  journal_trade: "Journal / Trade",
  dashboard_alert: "Dashboard Alert",
  risk_management: "Risk Management",
  ai_coach: "AI Coach",
  system_error: "System Error"
};
var SEVERITY_RANK = { info: 0, warning: 1, critical: 2 };
function defaultPreferences(userId2) {
  return {
    userId: userId2,
    notificationsEnabled: true,
    emailEnabled: false,
    dailyFundamentalEventsEmail: true,
    weeklyFundamentalEventsEmail: true,
    emailRecipient: null,
    emailCc: null,
    emailSenderName: "AlphaMentals",
    emailFrequency: "instant",
    emailMinSeverity: "warning",
    enabledEmailCategories: [...NOTIFICATION_CATEGORIES],
    webhookEnabled: false,
    webhookUrl: null,
    webhookSecret: null,
    enabledWebhookCategories: [...NOTIFICATION_CATEGORIES]
  };
}
async function getPreferences(userId2) {
  try {
    const { data } = await supabase.from("notification_preferences").select("*").eq("userId", userId2).maybeSingle();
    if (!data) return defaultPreferences(userId2);
    return { ...defaultPreferences(userId2), ...data, userId: userId2 };
  } catch {
    return defaultPreferences(userId2);
  }
}
var EDITABLE_PREF_KEYS = [
  "notificationsEnabled",
  "emailEnabled",
  "dailyFundamentalEventsEmail",
  "weeklyFundamentalEventsEmail",
  "emailRecipient",
  "emailCc",
  "emailSenderName",
  "emailFrequency",
  "emailMinSeverity",
  "enabledEmailCategories",
  "webhookEnabled",
  "webhookUrl",
  "webhookSecret",
  "enabledWebhookCategories"
];
async function savePreferences(userId2, patch) {
  const payload = { userId: userId2, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
  for (const key of EDITABLE_PREF_KEYS) {
    if (patch[key] !== void 0) payload[key] = patch[key];
  }
  const { data, error } = await supabase.from("notification_preferences").upsert(payload, { onConflict: "userId" }).select().single();
  if (error) throw new Error(error.message);
  return { ...defaultPreferences(userId2), ...data, userId: userId2 };
}
var SEVERITY_COLOR = {
  info: "#3b82f6",
  warning: "#f59e0b",
  critical: "#ef4444"
};
function buildEmailSubject(category, severity, title) {
  const sev = severity === "critical" ? "Critical " : "";
  return `[AlphaMentals] ${sev}${title}`.slice(0, 180);
}
function metadataRows(metadata) {
  if (!metadata || Object.keys(metadata).length === 0) return "";
  const rows = Object.entries(metadata).filter(([, v]) => v != null && v !== "").map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#9ca3af;">${k}</td><td style="padding:2px 0;">${String(v)}</td></tr>`).join("");
  if (!rows) return "";
  return `<table style="font-size:13px;margin-top:8px;border-collapse:collapse;">${rows}</table>`;
}
function buildEmailHtml(ctx) {
  const color = SEVERITY_COLOR[ctx.severity];
  const when = new Date(ctx.createdAt).toUTCString();
  const linkBtn = ctx.link ? `<a href="${ctx.link}" style="display:inline-block;margin-top:16px;padding:10px 16px;background:#7c6af7;color:#fff;border-radius:6px;text-decoration:none;font-size:13px;">Open in AlphaMentals</a>` : "";
  const symbolRow = ctx.symbol ? `<span style="margin-left:8px;color:#9ca3af;">\xB7 ${ctx.symbol}</span>` : "";
  return `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:28px;background:#0f1117;color:#e5e7eb;border-radius:10px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <h2 style="color:#7c6af7;margin:0;font-size:18px;">AlphaMentals</h2>
        <span style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:${color};border:1px solid ${color};padding:3px 8px;border-radius:999px;">${ctx.severity}</span>
      </div>
      <p style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af;margin:0 0 4px;">${CATEGORY_LABELS[ctx.category]}${symbolRow}</p>
      <h3 style="margin:0 0 10px;font-size:16px;color:#f3f4f6;">${ctx.title}</h3>
      <p style="margin:0;line-height:1.5;color:#d1d5db;">${ctx.message}</p>
      ${metadataRows(ctx.metadata)}
      ${linkBtn}
      <p style="color:#6b7280;font-size:12px;margin:20px 0 0;border-top:1px solid #1f2937;padding-top:12px;">${when} \xB7 Sent by AlphaMentals notifications</p>
    </div>`;
}
function resolveUserId(userId2) {
  return userId2 || process.env.DEFAULT_USER_ID || "";
}
async function createNotification(input) {
  const userId2 = resolveUserId(input.userId);
  const severity = input.severity ?? "info";
  try {
    const prefs = await getPreferences(userId2);
    if (!prefs.notificationsEnabled) return null;
    if (input.dedupeKey) {
      const since = new Date(Date.now() - 6 * 60 * 60 * 1e3).toISOString();
      const { data: dupes } = await supabase.from("notifications").select("id").eq("userId", userId2).eq("dedupeKey", input.dedupeKey).eq("read", false).gte("createdAt", since).limit(1);
      if (dupes && dupes.length > 0) return null;
    }
    const meetsSeverity = SEVERITY_RANK[severity] >= SEVERITY_RANK[prefs.emailMinSeverity];
    const emailEligible = prefs.emailEnabled && !!prefs.emailRecipient && meetsSeverity && prefs.emailFrequency === "instant" && prefs.enabledEmailCategories.includes(input.category);
    const webhookEligible = prefs.webhookEnabled && isValidWebhookUrl(prefs.webhookUrl) && prefs.enabledWebhookCategories.includes(input.category);
    const createdAt = (/* @__PURE__ */ new Date()).toISOString();
    const { data: row, error } = await supabase.from("notifications").insert({
      userId: userId2,
      title: input.title,
      message: input.message,
      category: input.category,
      severity,
      source: input.source ?? null,
      symbol: input.symbol ?? null,
      link: input.link ?? null,
      metadata: input.metadata ?? {},
      dedupeKey: input.dedupeKey ?? null,
      emailStatus: emailEligible ? "skipped" : prefs.emailEnabled ? "skipped" : "disabled",
      webhookStatus: webhookEligible ? "skipped" : prefs.webhookEnabled ? "skipped" : "disabled",
      createdAt
    }).select().single();
    if (error) throw new Error(error.message);
    let emailStatus = emailEligible ? "skipped" : prefs.emailEnabled ? "skipped" : "disabled";
    let emailError;
    let webhookStatus = webhookEligible ? "skipped" : prefs.webhookEnabled ? "skipped" : "disabled";
    let webhookError;
    if (emailEligible) {
      const html = buildEmailHtml({ ...input, severity, createdAt });
      const result = await sendMail({
        to: prefs.emailRecipient,
        cc: prefs.emailCc ?? void 0,
        subject: buildEmailSubject(input.category, severity, input.title),
        html,
        text: input.message,
        fromName: prefs.emailSenderName
      });
      emailStatus = result.ok ? "sent" : "failed";
      emailError = result.ok ? void 0 : result.error;
    }
    if (webhookEligible) {
      const result = await sendWebhook(prefs.webhookUrl, prefs.webhookSecret ?? void 0, {
        app: "AlphaMentals",
        title: input.title,
        message: input.message,
        category: input.category,
        severity,
        source: input.source ?? input.category,
        symbol: input.symbol ?? null,
        link: input.link ?? null,
        metadata: input.metadata ?? {},
        createdAt
      });
      webhookStatus = result.ok ? "sent" : "failed";
      webhookError = result.ok ? void 0 : result.error;
    }
    if (emailEligible || webhookEligible) {
      await supabase.from("notifications").update({
        emailStatus,
        emailError: emailError ?? null,
        webhookStatus,
        webhookError: webhookError ?? null
      }).eq("id", row.id);
    }
    return { ...row, emailStatus, webhookStatus };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown notification error";
    console.error("[notifications] createNotification failed:", message);
    return null;
  }
}
async function listNotifications(userId2, limit = 50) {
  const { data, error } = await supabase.from("notifications").select("*").eq("userId", userId2).order("createdAt", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}
async function markRead(userId2, id) {
  const { error } = await supabase.from("notifications").update({ read: true }).eq("id", id).eq("userId", userId2);
  if (error) throw new Error(error.message);
}
async function markAllRead(userId2) {
  const { error } = await supabase.from("notifications").update({ read: true }).eq("userId", userId2).eq("read", false);
  if (error) throw new Error(error.message);
}
async function clearHistory(userId2) {
  const { error } = await supabase.from("notifications").delete().eq("userId", userId2);
  if (error) throw new Error(error.message);
}
var DEFAULT_ALERT_RECIPIENT = "fo.mencuccini@gmail.com";
async function sendTestEmail(userId2, recipientOverride) {
  const prefs = await getPreferences(userId2);
  const recipient = recipientOverride || prefs.emailRecipient || DEFAULT_ALERT_RECIPIENT;
  if (!isEmailConfigured()) {
    return { success: false, provider: "resend", message: "Email is not configured on the server. Set RESEND_API_KEY." };
  }
  const createdAt = (/* @__PURE__ */ new Date()).toISOString();
  console.log("[notification] Sending test email", { provider: "resend", to: recipient, stage: "sending" });
  const result = await sendMail({
    to: recipient,
    cc: prefs.emailCc ?? void 0,
    subject: buildEmailSubject("dashboard_alert", "info", "Test Notification"),
    html: buildEmailHtml({
      title: "Test Notification",
      message: "Your AlphaMentals email notifications are configured correctly.",
      category: "dashboard_alert",
      severity: "info",
      createdAt,
      metadata: { mode: getMailMode(), provider: "resend" }
    }),
    text: "Your AlphaMentals email notifications are configured correctly.",
    fromName: prefs.emailSenderName,
    context: { signal: "TEST" }
  });
  if (result.ok) {
    console.log("[notification] Test email sent", { provider: "resend", emailId: result.emailId ?? null, to: recipient, stage: "sent" });
    return {
      success: true,
      provider: "resend",
      emailId: result.emailId ?? null,
      message: `Test email delivered to ${recipient}.`
    };
  }
  console.error("[notification] Test email failed", { provider: "resend", to: recipient, stage: "failed", error: result.error });
  return { success: false, provider: "resend", message: result.error ?? "Failed to send test email." };
}
async function sendTestWebhook(userId2, urlOverride, secretOverride) {
  const prefs = await getPreferences(userId2);
  const url = urlOverride || prefs.webhookUrl;
  const secret = secretOverride ?? prefs.webhookSecret ?? void 0;
  if (!isValidWebhookUrl(url)) return { success: false, message: "No valid webhook URL set." };
  const result = await sendWebhook(url, secret, {
    app: "AlphaMentals",
    title: "Test Webhook",
    message: "Your AlphaMentals n8n webhook is configured correctly.",
    category: "dashboard_alert",
    severity: "info",
    source: "test",
    symbol: null,
    metadata: { test: true },
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  return result.ok ? { success: true, message: "Test webhook delivered successfully." } : { success: false, message: result.error ?? "Failed to deliver test webhook." };
}

// backend/server/services/tradeJournal.service.ts
function isReviewComplete(t) {
  const baseComplete = Boolean(
    t.setupId && t.setupQualityGrade && t.reasonForEntry && t.reasonForExit && t.preTradeEmotion && t.followedPlan != null
  );
  if (!baseComplete) return false;
  const pnl = t.pnl ?? 0;
  if (pnl < 0) {
    const hasMistakeOrLoss = (t.mistakeTags?.length ?? 0) > 0 || !!t.lossClassification;
    return hasMistakeOrLoss;
  }
  return true;
}
async function getNextTradeNumber(userId2) {
  const { data } = await supabase.from("trades").select("tradeNumber").eq("userId", userId2).order("tradeNumber", { ascending: false }).limit(1).maybeSingle();
  return (data?.tradeNumber ?? 0) + 1;
}
async function createTrade(userId2, input) {
  const rrPlanned = Math.abs(input.takeProfit - input.entryPrice) / Math.abs(input.entryPrice - input.stopLoss);
  const tradeNumber = await getNextTradeNumber(userId2);
  const { data, error } = await supabase.from("trades").insert({
    userId: userId2,
    tradeNumber,
    symbol: input.symbol.toUpperCase(),
    direction: input.direction,
    entryPrice: input.entryPrice,
    stopLoss: input.stopLoss,
    takeProfit: input.takeProfit,
    positionSize: input.positionSize,
    riskPercent: input.riskPercent,
    rrPlanned: Math.round(rrPlanned * 100) / 100,
    session: input.session,
    timeframe: input.timeframe,
    setupType: input.setupType,
    confluences: input.confluences ?? [],
    tags: input.tags ?? [],
    preTradeEmotion: input.preTradeEmotion ?? "NEUTRAL",
    confidenceLevel: input.confidenceLevel ?? 5,
    tradePlan: input.tradePlan,
    reasonForEntry: input.reasonForEntry,
    entryTime: new Date(input.entryTime).toISOString(),
    checklistId: input.checklistId,
    isRevengeTrade: input.isRevengeTrade ?? false,
    isFomo: input.isFomo ?? false,
    status: "OPEN"
  }).select().single();
  if (error) throw new Error(error.message);
  return data;
}
async function closeTrade(userId2, tradeId, input) {
  const { data: trade, error: fetchErr } = await supabase.from("trades").select("*").eq("id", tradeId).eq("userId", userId2).single();
  if (fetchErr || !trade) throw new Error("Trade not found");
  const pnlPips = trade.direction === "LONG" ? input.closePrice - trade.entryPrice : trade.entryPrice - input.closePrice;
  const pnlPercent = pnlPips / trade.entryPrice * 100;
  const pnl = pnlPips * trade.positionSize;
  const rrActual = pnlPips > 0 ? pnlPips / Math.abs(trade.entryPrice - trade.stopLoss) : -(Math.abs(pnlPips) / Math.abs(trade.entryPrice - trade.stopLoss));
  const { data, error } = await supabase.from("trades").update({
    closePrice: input.closePrice,
    exitTime: new Date(input.exitTime).toISOString(),
    status: "CLOSED",
    pnl: Math.round(pnl * 100) / 100,
    pnlPercent: Math.round(pnlPercent * 100) / 100,
    pnlPips: Math.round(pnlPips * 1e4) / 100,
    rrActual: Math.round(rrActual * 100) / 100,
    postTradeEmotion: input.postTradeEmotion,
    reasonForExit: input.reasonForExit,
    lessonsLearned: input.lessonsLearned,
    mistakeTags: input.mistakeTags ?? [],
    followedPlan: input.followedPlan,
    screenshotUrls: input.screenshotUrls ?? []
  }).eq("id", tradeId).select().single();
  if (error) throw new Error(error.message);
  const closedPnl = Math.round(pnl * 100) / 100;
  void createNotification({
    userId: userId2,
    title: `Trade closed: ${trade.symbol} ${trade.direction}`,
    message: `${trade.symbol} closed at ${input.closePrice} for ${closedPnl >= 0 ? "+" : ""}${closedPnl} (${Math.round(rrActual * 100) / 100}R).`,
    category: "journal_trade",
    severity: closedPnl < 0 ? "warning" : "info",
    source: "journal",
    symbol: trade.symbol,
    link: `/journal/trades/${tradeId}`,
    metadata: { pnl: closedPnl, rrActual: Math.round(rrActual * 100) / 100 },
    dedupeKey: `trade-close-${tradeId}`
  });
  return data;
}
async function getTrades(userId2, filter = {}) {
  const { page = 1, limit = 20, from, to, ...rest } = filter;
  const skip = (page - 1) * limit;
  let query2 = supabase.from("trades").select("*", { count: "exact" }).eq("userId", userId2);
  if (rest.symbol) query2 = query2.eq("symbol", rest.symbol);
  if (rest.direction) query2 = query2.eq("direction", rest.direction);
  if (rest.status) query2 = query2.eq("status", rest.status);
  if (rest.session) query2 = query2.eq("session", rest.session);
  if (rest.setupType) query2 = query2.eq("setupType", rest.setupType);
  if (rest.reviewStatus) query2 = query2.eq("reviewStatus", rest.reviewStatus);
  if (rest.setupId) query2 = query2.eq("setupId", rest.setupId);
  if (rest.setupQualityGrade) query2 = query2.eq("setupQualityGrade", rest.setupQualityGrade);
  if (from) query2 = query2.gte("entryTime", new Date(from).toISOString());
  if (to) query2 = query2.lte("entryTime", new Date(to).toISOString());
  query2 = query2.order("entryTime", { ascending: false }).range(skip, skip + limit - 1);
  const { data: trades, count, error } = await query2;
  if (error) throw new Error(error.message);
  const total = count ?? 0;
  return { trades: trades ?? [], total, page, limit, pages: Math.ceil(total / limit) };
}
async function getTradeById(userId2, tradeId) {
  const { data, error } = await supabase.from("trades").select("*").eq("id", tradeId).eq("userId", userId2).single();
  if (error || !data) throw new Error("Trade not found");
  return data;
}
async function updateTradeReview(userId2, tradeId, input) {
  const { data: trade, error: fetchErr } = await supabase.from("trades").select("*").eq("id", tradeId).eq("userId", userId2).single();
  if (fetchErr || !trade) throw new Error("Trade not found");
  const { data: profile } = await supabase.from("user_profiles").select("riskPerTradePercent").eq("userId", userId2).maybeSingle();
  const merged = { ...trade };
  for (const [k, v] of Object.entries(input)) {
    if (v !== void 0) merged[k] = v;
  }
  const scores = computeScores({
    stopLoss: merged.stopLoss,
    takeProfit: merged.takeProfit,
    entryPrice: merged.entryPrice,
    riskPercent: merged.riskPercent,
    rrPlanned: merged.rrPlanned,
    pnl: merged.pnl,
    session: merged.session,
    setupQualityGrade: merged.setupQualityGrade,
    blueprintRulesFollowed: merged.blueprintRulesFollowed,
    blueprintRulesBroken: merged.blueprintRulesBroken,
    preTradeEmotion: merged.preTradeEmotion,
    duringTradeEmotion: merged.duringTradeEmotion,
    postTradeEmotion: merged.postTradeEmotion,
    isRevengeTrade: merged.isRevengeTrade,
    isFomo: merged.isFomo,
    hesitation: merged.hesitation,
    movedStopLoss: merged.movedStopLoss,
    closedEarly: merged.closedEarly,
    followedPlan: merged.followedPlan,
    mistakeTags: merged.mistakeTags,
    maxRiskPercent: profile?.riskPerTradePercent ?? null
  });
  const complete = isReviewComplete(merged);
  const reviewStatus = complete ? "COMPLETE" : "IN_PROGRESS";
  const updatePayload = {
    // review fields (only defined ones)
    ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== void 0)),
    // engine scores (source of truth)
    setupQuality: scores.setupQuality,
    executionScore: scores.executionScore,
    psychologyScore: scores.psychologyScore,
    disciplineScore: scores.disciplineScore,
    riskScore: scores.riskScore,
    patienceScore: scores.patienceScore,
    overallScore: scores.overallScore,
    aiScore: scores.overallScore,
    blueprintMatchScore: scores.blueprintMatchScore,
    reviewStatus,
    reviewCompletedAt: complete ? (/* @__PURE__ */ new Date()).toISOString() : null,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  const { data, error } = await supabase.from("trades").update(updatePayload).eq("id", tradeId).eq("userId", userId2).select().single();
  if (error) throw new Error(error.message);
  if (merged.setupId) {
    try {
      await recomputeSetupStats(userId2, merged.setupId);
    } catch {
    }
  }
  return { trade: data, scores };
}
async function deleteTrade(userId2, tradeId) {
  const { data: trade } = await supabase.from("trades").select("id").eq("id", tradeId).eq("userId", userId2).single();
  if (!trade) throw new Error("Trade not found");
  const { error } = await supabase.from("trades").delete().eq("id", tradeId);
  if (error) throw new Error(error.message);
}
function calcMaxDrawdown(trades) {
  let peak = 0, equity = 0, maxDD = 0;
  for (const x of trades) {
    equity += x.pnl ?? 0;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}
function calcConsecutiveStreaks(trades) {
  let cW = 0, mW = 0, cL = 0, mL = 0;
  for (const x of trades) {
    const p = x.pnl ?? 0;
    if (p > 0) {
      cW++;
      cL = 0;
      mW = Math.max(mW, cW);
    } else if (p < 0) {
      cL++;
      cW = 0;
      mL = Math.max(mL, cL);
    }
  }
  return { maxConsecWins: mW, maxConsecLosses: mL };
}
function calcAvgHoldTime(trades) {
  const holdTimes = trades.filter((x) => x.exitTime).map((x) => (new Date(x.exitTime).getTime() - new Date(x.entryTime).getTime()) / 6e4);
  return holdTimes.length ? holdTimes.reduce((a, b) => a + b, 0) / holdTimes.length : 0;
}
function calcProfitFactor(grossWin, grossLoss) {
  if (grossLoss > 0) return grossWin / grossLoss;
  if (grossWin > 0) return Infinity;
  return 0;
}
async function getPerformanceStats(userId2, from, to) {
  let query2 = supabase.from("trades").select("*").eq("userId", userId2).eq("status", "CLOSED").order("entryTime", { ascending: true });
  if (from) query2 = query2.gte("entryTime", new Date(from).toISOString());
  if (to) query2 = query2.lte("entryTime", new Date(to).toISOString());
  const { data: trades } = await query2;
  const t = trades ?? [];
  if (!t.length) {
    return { totalTrades: 0, winCount: 0, lossCount: 0, breakEvenCount: 0, winRate: 0, totalPnl: 0, totalPnlPercent: 0, avgRR: 0, avgWin: 0, avgLoss: 0, profitFactor: 0, expectancy: 0, maxDrawdown: 0, maxConsecWins: 0, maxConsecLosses: 0, bestTrade: 0, worstTrade: 0, avgHoldTime: 0 };
  }
  const wins = t.filter((x) => (x.pnl ?? 0) > 0);
  const losses = t.filter((x) => (x.pnl ?? 0) < 0);
  const pnlValues = t.map((x) => x.pnl ?? 0);
  const totalPnl = pnlValues.reduce((s, v) => s + v, 0);
  const totalPnlPercent = t.reduce((s, x) => s + (x.pnlPercent ?? 0), 0);
  const avgRR = t.reduce((s, x) => s + (x.rrActual ?? 0), 0) / t.length;
  const grossWin = wins.reduce((s, x) => s + (x.pnl ?? 0), 0);
  const grossLoss = Math.abs(losses.reduce((s, x) => s + (x.pnl ?? 0), 0));
  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const profitFactor = calcProfitFactor(grossWin, grossLoss);
  const winRate = wins.length / t.length;
  const expectancy = winRate * avgWin - (1 - winRate) * avgLoss;
  const maxDD = calcMaxDrawdown(t);
  const { maxConsecWins, maxConsecLosses } = calcConsecutiveStreaks(t);
  const avgHoldTime = calcAvgHoldTime(t);
  return {
    totalTrades: t.length,
    winCount: wins.length,
    lossCount: losses.length,
    breakEvenCount: t.filter((x) => (x.pnl ?? 0) === 0).length,
    winRate: Math.round(winRate * 1e3) / 10,
    totalPnl: Math.round(totalPnl * 100) / 100,
    totalPnlPercent: Math.round(totalPnlPercent * 100) / 100,
    avgRR: Math.round(avgRR * 100) / 100,
    avgWin: Math.round(avgWin * 100) / 100,
    avgLoss: Math.round(avgLoss * 100) / 100,
    profitFactor: Math.round(profitFactor * 100) / 100,
    expectancy: Math.round(expectancy * 100) / 100,
    maxDrawdown: Math.round(maxDD * 100) / 100,
    maxConsecWins,
    maxConsecLosses,
    bestTrade: Math.max(...pnlValues),
    worstTrade: Math.min(...pnlValues),
    avgHoldTime: Math.round(avgHoldTime)
  };
}

// backend/server/services/aiCoach.service.ts
var import_sdk = __toESM(require("@anthropic-ai/sdk"));

// backend/server/services/analytics.service.ts
var GRADE_LABELS = {
  A_PLUS: "A+ Setup",
  A: "A Setup",
  B: "B Setup",
  C: "C Setup",
  FORCED: "Forced Trade",
  NO_SETUP: "No Valid Setup"
};
function avg(nums) {
  return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 0;
}
function winRatePct(wins, total) {
  return total > 0 ? Math.round(wins / total * 1e3) / 10 : 0;
}
async function getEquityCurve(userId2, from, to) {
  let query2 = supabase.from("trades").select("entryTime, pnl").eq("userId", userId2).eq("status", "CLOSED").order("entryTime", { ascending: true });
  if (from) query2 = query2.gte("entryTime", new Date(from).toISOString());
  if (to) query2 = query2.lte("entryTime", new Date(to).toISOString());
  const { data: trades } = await query2;
  let equity = 0, peak = 0;
  const points = [];
  const byDate = /* @__PURE__ */ new Map();
  for (const t of trades ?? []) {
    const date = new Date(t.entryTime).toISOString().slice(0, 10);
    const existing = byDate.get(date) ?? { pnl: 0, count: 0 };
    byDate.set(date, { pnl: existing.pnl + (t.pnl ?? 0), count: existing.count + 1 });
  }
  for (const [date, { pnl, count }] of byDate) {
    equity += pnl;
    if (equity > peak) peak = equity;
    const drawdown = peak > 0 ? (peak - equity) / peak * 100 : 0;
    points.push({ date, equity: Math.round(equity * 100) / 100, drawdown: Math.round(drawdown * 100) / 100, tradeCount: count });
  }
  return points;
}
async function getSessionHeatmap(userId2) {
  const { data: trades } = await supabase.from("trades").select("session, pnl").eq("userId", userId2).eq("status", "CLOSED").eq("reviewStatus", "COMPLETE");
  const map = /* @__PURE__ */ new Map();
  for (const t of trades ?? []) {
    const s = t.session;
    const e = map.get(s) ?? { pnl: 0, wins: 0, total: 0 };
    map.set(s, { pnl: e.pnl + (t.pnl ?? 0), wins: e.wins + ((t.pnl ?? 0) > 0 ? 1 : 0), total: e.total + 1 });
  }
  return Array.from(map.entries()).map(([label, { pnl, wins, total }]) => ({
    label,
    value: Math.round(pnl * 100) / 100,
    count: total,
    winRate: total > 0 ? Math.round(wins / total * 1e3) / 10 : 0
  }));
}
async function getDayOfWeekHeatmap(userId2) {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const { data: trades } = await supabase.from("trades").select("entryTime, pnl").eq("userId", userId2).eq("status", "CLOSED").eq("reviewStatus", "COMPLETE");
  const map = /* @__PURE__ */ new Map();
  for (const t of trades ?? []) {
    const d = new Date(t.entryTime).getDay();
    const e = map.get(d) ?? { pnl: 0, wins: 0, total: 0 };
    map.set(d, { pnl: e.pnl + (t.pnl ?? 0), wins: e.wins + ((t.pnl ?? 0) > 0 ? 1 : 0), total: e.total + 1 });
  }
  return days.map((label, i) => {
    const e = map.get(i) ?? { pnl: 0, wins: 0, total: 0 };
    return { label, value: Math.round(e.pnl * 100) / 100, count: e.total, winRate: e.total > 0 ? Math.round(e.wins / e.total * 1e3) / 10 : 0 };
  });
}
async function getMistakeBreakdown(userId2) {
  const { data: trades } = await supabase.from("trades").select("mistakeTags, pnl, executionScore").eq("userId", userId2).eq("status", "CLOSED").eq("reviewStatus", "COMPLETE").not("mistakeTags", "eq", "{}");
  const map = /* @__PURE__ */ new Map();
  for (const t of trades ?? []) {
    for (const tag of t.mistakeTags ?? []) {
      const e = map.get(tag) ?? { count: 0, pnl: 0, scores: [] };
      e.count++;
      e.pnl += t.pnl ?? 0;
      if (t.executionScore != null) e.scores.push(t.executionScore);
      map.set(tag, e);
    }
  }
  return Array.from(map.entries()).map(([tag, { count, pnl, scores }]) => ({
    tag,
    count,
    pnlImpact: Math.round(pnl * 100) / 100,
    avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0
  })).sort((a, b) => b.count - a.count);
}
async function getSetupPerformance(userId2) {
  const { data: trades } = await supabase.from("trades").select("setupType, pnl, rrActual").eq("userId", userId2).eq("status", "CLOSED").eq("reviewStatus", "COMPLETE");
  const map = /* @__PURE__ */ new Map();
  for (const t of trades ?? []) {
    const s = t.setupType;
    const e = map.get(s) ?? { wins: 0, total: 0, pnl: 0, rr: [] };
    e.total++;
    e.pnl += t.pnl ?? 0;
    if ((t.pnl ?? 0) > 0) e.wins++;
    if (t.rrActual != null) e.rr.push(t.rrActual);
    map.set(s, e);
  }
  return Array.from(map.entries()).map(([setup, { wins, total, pnl, rr }]) => {
    const winRate = wins / total;
    const avgRR = rr.length ? rr.reduce((a, b) => a + b, 0) / rr.length : 0;
    const grossWin = rr.filter((r) => r > 0).reduce((a, b) => a + b, 0);
    const grossLoss = Math.abs(rr.filter((r) => r < 0).reduce((a, b) => a + b, 0));
    return {
      setup,
      trades: total,
      winRate: Math.round(winRate * 1e3) / 10,
      avgRR: Math.round(avgRR * 100) / 100,
      expectancy: Math.round((winRate * avgRR - (1 - winRate)) * 100) / 100,
      profitFactor: grossLoss > 0 ? Math.round(grossWin / grossLoss * 100) / 100 : 0
    };
  }).sort((a, b) => b.trades - a.trades);
}
async function getPsychologyCorrelations(userId2) {
  const { data: trades } = await supabase.from("trades").select("preTradeEmotion, pnl, psychologyScore").eq("userId", userId2).eq("status", "CLOSED").eq("reviewStatus", "COMPLETE");
  const map = /* @__PURE__ */ new Map();
  for (const t of trades ?? []) {
    const e = t.preTradeEmotion;
    const entry = map.get(e) ?? { wins: 0, total: 0, pnl: 0, scores: [] };
    entry.total++;
    entry.pnl += t.pnl ?? 0;
    if ((t.pnl ?? 0) > 0) entry.wins++;
    if (t.psychologyScore != null) entry.scores.push(t.psychologyScore);
    map.set(e, entry);
  }
  return Array.from(map.entries()).map(([emotion, { wins, total, pnl, scores }]) => ({
    emotion,
    avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
    winRate: total > 0 ? Math.round(wins / total * 1e3) / 10 : 0,
    count: total,
    avgPnl: total > 0 ? Math.round(pnl / total * 100) / 100 : 0
  })).sort((a, b) => b.count - a.count);
}
async function detectMistakePatterns(userId2) {
  const last30 = /* @__PURE__ */ new Date();
  last30.setDate(last30.getDate() - 30);
  const { data: trades } = await supabase.from("trades").select("pnl, isRevengeTrade, isFomo, mistakeTags, rrActual, rrPlanned, entryTime").eq("userId", userId2).eq("status", "CLOSED").eq("reviewStatus", "COMPLETE").gte("entryTime", last30.toISOString()).order("entryTime", { ascending: true });
  const t = trades ?? [];
  const warnings = [];
  const revengeCount = t.filter((x) => x.isRevengeTrade).length;
  if (revengeCount >= 2) warnings.push(`Revenge trading detected: ${revengeCount} trades in 30 days`);
  const byDay = /* @__PURE__ */ new Map();
  for (const x of t) {
    const d = new Date(x.entryTime).toISOString().slice(0, 10);
    byDay.set(d, (byDay.get(d) ?? 0) + 1);
  }
  const overtradedDays = Array.from(byDay.values()).filter((c) => c > 3).length;
  if (overtradedDays >= 2) warnings.push(`Overtrading pattern: ${overtradedDays} days with 3+ trades`);
  const rrViolations = t.filter((x) => x.rrActual != null && x.rrPlanned > 0 && x.rrActual / x.rrPlanned < 0.5).length;
  if (rrViolations >= 3) warnings.push(`RR violation: cutting winners early ${rrViolations} times`);
  const fomoCount = t.filter((x) => x.isFomo).length;
  if (fomoCount >= 2) warnings.push(`FOMO trading: ${fomoCount} FOMO entries detected`);
  let streak = 0;
  for (const x of t) {
    if ((x.pnl ?? 0) < 0) {
      streak++;
    } else {
      streak = 0;
    }
  }
  if (streak >= 3) warnings.push(`Active loss streak: ${streak} consecutive losses \u2014 consider a break`);
  return warnings;
}
async function getSetupQualityPerformance(userId2) {
  const { data: trades } = await supabase.from("trades").select("setupQualityGrade, pnl, rrActual, disciplineScore, psychologyScore").eq("userId", userId2).eq("status", "CLOSED").eq("reviewStatus", "COMPLETE").not("setupQualityGrade", "is", null);
  const map = /* @__PURE__ */ new Map();
  for (const t of trades ?? []) {
    const g = t.setupQualityGrade;
    const e = map.get(g) ?? { wins: 0, total: 0, pnl: 0, rr: [], disc: [], psy: [] };
    e.total++;
    e.pnl += t.pnl ?? 0;
    if ((t.pnl ?? 0) > 0) e.wins++;
    if (t.rrActual != null) e.rr.push(t.rrActual);
    if (t.disciplineScore != null) e.disc.push(t.disciplineScore);
    if (t.psychologyScore != null) e.psy.push(t.psychologyScore);
    map.set(g, e);
  }
  const order = ["A_PLUS", "A", "B", "C", "FORCED", "NO_SETUP"];
  return Array.from(map.entries()).map(([grade, e]) => ({
    grade: GRADE_LABELS[grade] ?? grade,
    trades: e.total,
    winRate: winRatePct(e.wins, e.total),
    pnl: Math.round(e.pnl * 100) / 100,
    avgRR: e.rr.length ? Math.round(e.rr.reduce((a, b) => a + b, 0) / e.rr.length * 100) / 100 : 0,
    avgDiscipline: avg(e.disc),
    avgPsychology: avg(e.psy),
    _sort: order.indexOf(grade)
  })).sort((a, b) => a._sort - b._sort).map(({ _sort, ...rest }) => rest);
}
async function getMistakeCost(userId2) {
  const { data: trades } = await supabase.from("trades").select("mistakeTags, pnl").eq("userId", userId2).eq("status", "CLOSED").eq("reviewStatus", "COMPLETE");
  const map = /* @__PURE__ */ new Map();
  for (const t of trades ?? []) {
    for (const tag of t.mistakeTags ?? []) {
      const e = map.get(tag) ?? { count: 0, pnl: 0, wins: 0 };
      e.count++;
      e.pnl += t.pnl ?? 0;
      if ((t.pnl ?? 0) > 0) e.wins++;
      map.set(tag, e);
    }
  }
  return Array.from(map.entries()).map(([tag, e]) => ({
    tag,
    count: e.count,
    totalCost: Math.round(e.pnl * 100) / 100,
    winRate: winRatePct(e.wins, e.count),
    avgPnl: e.count > 0 ? Math.round(e.pnl / e.count * 100) / 100 : 0
  })).sort((a, b) => a.totalCost - b.totalCost);
}
async function getDisciplineStats(userId2) {
  const { data: trades } = await supabase.from("trades").select("followedPlan, blueprintMatchScore, blueprintRulesBroken, pnl").eq("userId", userId2).eq("status", "CLOSED").eq("reviewStatus", "COMPLETE");
  const t = trades ?? [];
  const bucket = (rows) => {
    const total = rows.length;
    const wins = rows.filter((x) => (x.pnl ?? 0) > 0).length;
    const pnl = rows.reduce((s, x) => s + (x.pnl ?? 0), 0);
    return { trades: total, winRate: winRatePct(wins, total), pnl: Math.round(pnl * 100) / 100 };
  };
  const brokenCount = /* @__PURE__ */ new Map();
  for (const x of t) {
    for (const r of x.blueprintRulesBroken ?? []) brokenCount.set(r, (brokenCount.get(r) ?? 0) + 1);
  }
  let mostBrokenRule = null;
  let maxBroken = 0;
  for (const [rule, c] of brokenCount) {
    if (c > maxBroken) {
      maxBroken = c;
      mostBrokenRule = rule;
    }
  }
  return {
    followedPlan: bucket(t.filter((x) => x.followedPlan === true)),
    brokePlan: bucket(t.filter((x) => x.followedPlan === false)),
    highBlueprint: bucket(t.filter((x) => (x.blueprintMatchScore ?? 0) >= 80)),
    lowBlueprint: bucket(t.filter((x) => x.blueprintMatchScore != null && x.blueprintMatchScore < 60)),
    mostBrokenRule
  };
}
async function getRiskFlagStats(userId2) {
  const { data: trades } = await supabase.from("trades").select("stopLoss, entryPrice, takeProfit, rrPlanned, movedStopLoss, mistakeTags, riskPercent, pnl").eq("userId", userId2).eq("status", "CLOSED").eq("reviewStatus", "COMPLETE");
  const t = trades ?? [];
  const tally = (predicate) => {
    const rows = t.filter(predicate);
    return { count: rows.length, pnl: Math.round(rows.reduce((s, x) => s + (x.pnl ?? 0), 0) * 100) / 100 };
  };
  const slMissing = (x) => x.stopLoss == null || x.stopLoss === 0 || x.stopLoss === x.entryPrice;
  const hasTag2 = (x, ...names) => (x.mistakeTags ?? []).some((m) => names.includes(m));
  const missingStopLoss = tally(slMissing);
  const poorRR = tally((x) => x.rrPlanned != null && x.rrPlanned < 1);
  const movedStop = tally((x) => x.movedStopLoss === true || hasTag2(x, "MOVED_STOP", "WIDENED_STOP"));
  const overLeveraged = tally((x) => hasTag2(x, "OVER_LEVERAGED", "RISK_TOO_HIGH"));
  const riskAbovePlan = tally((x) => hasTag2(x, "BROKE_MAX_RISK"));
  const lostRows = t.filter((x) => (x.pnl ?? 0) < 0 && (slMissing(x) || hasTag2(x, "MOVED_STOP", "WIDENED_STOP", "OVER_LEVERAGED", "BAD_RR", "RISK_TOO_HIGH")));
  const totalLostToRiskIssues = Math.round(lostRows.reduce((s, x) => s + (x.pnl ?? 0), 0) * 100) / 100;
  return { missingStopLoss, poorRR, movedStop, overLeveraged, riskAbovePlan, totalLostToRiskIssues };
}
async function getTimeOfDayPerformance(userId2) {
  const { data: trades } = await supabase.from("trades").select("entryTime, pnl").eq("userId", userId2).eq("status", "CLOSED").eq("reviewStatus", "COMPLETE");
  const map = /* @__PURE__ */ new Map();
  for (const t of trades ?? []) {
    const hour = new Date(t.entryTime).getUTCHours();
    const e = map.get(hour) ?? { pnl: 0, wins: 0, total: 0 };
    e.pnl += t.pnl ?? 0;
    if ((t.pnl ?? 0) > 0) e.wins++;
    e.total++;
    map.set(hour, e);
  }
  const cells = [];
  for (let hour = 0; hour < 24; hour++) {
    const e = map.get(hour);
    if (!e) continue;
    const hh = `${hour}`.padStart(2, "0");
    cells.push({
      hour,
      label: `${hh}:00 UTC`,
      value: Math.round(e.pnl * 100) / 100,
      count: e.total,
      winRate: winRatePct(e.wins, e.total)
    });
  }
  return cells;
}
async function getPsychologyByPhase(userId2, phase) {
  const columnByPhase = {
    during: "duringTradeEmotion",
    post: "postTradeEmotion",
    pre: "preTradeEmotion"
  };
  const column = columnByPhase[phase];
  const { data: trades } = await supabase.from("trades").select(`${column}, pnl, psychologyScore`).eq("userId", userId2).eq("status", "CLOSED").eq("reviewStatus", "COMPLETE");
  const map = /* @__PURE__ */ new Map();
  for (const t of trades ?? []) {
    const emotion = t[column];
    if (!emotion) continue;
    const e = map.get(emotion) ?? { wins: 0, total: 0, pnl: 0, scores: [] };
    e.total++;
    e.pnl += t.pnl ?? 0;
    if ((t.pnl ?? 0) > 0) e.wins++;
    if (t.psychologyScore != null) e.scores.push(t.psychologyScore);
    map.set(emotion, e);
  }
  return Array.from(map.entries()).map(([emotion, e]) => ({
    emotion,
    avgScore: avg(e.scores),
    winRate: winRatePct(e.wins, e.total),
    count: e.total,
    avgPnl: e.total > 0 ? Math.round(e.pnl / e.total * 100) / 100 : 0,
    phase
  })).sort((a, b) => b.count - a.count);
}
async function getPerformanceBySymbol(userId2) {
  const { data: trades } = await supabase.from("trades").select("symbol, pnl, rrActual").eq("userId", userId2).eq("status", "CLOSED").eq("reviewStatus", "COMPLETE");
  const map = /* @__PURE__ */ new Map();
  for (const t of trades ?? []) {
    const sym = t.symbol;
    const e = map.get(sym) ?? { wins: 0, total: 0, pnl: 0, rr: [] };
    e.total++;
    e.pnl += t.pnl ?? 0;
    if ((t.pnl ?? 0) > 0) e.wins++;
    if (t.rrActual != null) e.rr.push(t.rrActual);
    map.set(sym, e);
  }
  return Array.from(map.entries()).map(([symbol, e]) => {
    const avgRR = e.rr.length ? e.rr.reduce((a, b) => a + b, 0) / e.rr.length : 0;
    const grossWin = e.rr.filter((r) => r > 0).reduce((a, b) => a + b, 0);
    const grossLoss = Math.abs(e.rr.filter((r) => r < 0).reduce((a, b) => a + b, 0));
    return {
      symbol,
      tradeCount: e.total,
      winRate: winRatePct(e.wins, e.total),
      totalPnl: Math.round(e.pnl * 100) / 100,
      avgRR: Math.round(avgRR * 100) / 100,
      profitFactor: grossLoss > 0 ? Math.round(grossWin / grossLoss * 100) / 100 : 0
    };
  }).sort((a, b) => b.tradeCount - a.tradeCount);
}
async function getGoodVsBadLossStats(userId2) {
  const { data: trades } = await supabase.from("trades").select("lossClassification, followedPlan, pnl").eq("userId", userId2).eq("status", "CLOSED").eq("reviewStatus", "COMPLETE");
  const t = trades ?? [];
  const buildBucket = (rows) => {
    const count = rows.length;
    const totalPnl = Math.round(rows.reduce((s, x) => s + (x.pnl ?? 0), 0) * 100) / 100;
    const avgPnl = count > 0 ? Math.round(totalPnl / count * 100) / 100 : 0;
    return { count, totalPnl, avgPnl };
  };
  const validRows = t.filter((x) => x.lossClassification === "VALID");
  const badRows = t.filter((x) => x.lossClassification === "BAD" || x.lossClassification === "AVOIDABLE");
  const undisciplinedWins = t.filter((x) => x.followedPlan === false && (x.pnl ?? 0) > 0).length;
  return {
    validLosses: buildBucket(validRows),
    badLosses: buildBucket(badRows),
    undisciplinedWins
  };
}
async function getPsychologyFlagCost(userId2) {
  const { data: trades } = await supabase.from("trades").select("isFomo, isRevengeTrade, movedStopLoss, closedEarly, hesitation, pnl").eq("userId", userId2).eq("status", "CLOSED").eq("reviewStatus", "COMPLETE");
  const t = trades ?? [];
  const flags = [
    { key: "isFomo", label: "FOMO" },
    { key: "isRevengeTrade", label: "Revenge Trade" },
    { key: "movedStopLoss", label: "Moved Stop Loss" },
    { key: "closedEarly", label: "Closed Early" },
    { key: "hesitation", label: "Hesitation" }
  ];
  return flags.map(({ key, label }) => {
    const rows = t.filter((x) => x[key] === true);
    const count = rows.length;
    const totalPnl = Math.round(rows.reduce((s, x) => s + (x.pnl ?? 0), 0) * 100) / 100;
    const avgPnl = count > 0 ? Math.round(totalPnl / count * 100) / 100 : 0;
    const wins = rows.filter((x) => (x.pnl ?? 0) > 0).length;
    return {
      flag: label,
      tradeCount: count,
      totalPnl,
      avgPnl,
      winRate: winRatePct(wins, count)
    };
  }).filter((x) => x.tradeCount > 0);
}
async function getReviewCoverage(userId2) {
  const { data: trades } = await supabase.from("trades").select("reviewStatus").eq("userId", userId2).eq("status", "CLOSED");
  const t = trades ?? [];
  const total = t.length;
  const reviewed = t.filter((x) => x.reviewStatus === "COMPLETE").length;
  const inProgress = t.filter((x) => x.reviewStatus === "IN_PROGRESS").length;
  const needsReview = t.filter((x) => x.reviewStatus == null || x.reviewStatus === "PENDING").length;
  const coveragePct = total > 0 ? Math.round(reviewed / total * 1e3) / 10 : 0;
  return { total, reviewed, needsReview, inProgress, coveragePct };
}

// backend/server/services/aiCoach.service.ts
var anthropic = new import_sdk.default({ apiKey: process.env.ANTHROPIC_API_KEY });
var MARKET_GUARDRAIL = "Never predict future market movements or price targets.";
async function reviewTrade(userId2, tradeId) {
  const { data: trade, error } = await supabase.from("trades").select("*").eq("id", tradeId).eq("userId", userId2).single();
  if (error || !trade) throw new Error("Trade not found");
  const { data: profile } = await supabase.from("user_profiles").select("*").eq("userId", userId2).single();
  const scores = computeScores({
    stopLoss: trade.stopLoss,
    takeProfit: trade.takeProfit,
    entryPrice: trade.entryPrice,
    riskPercent: trade.riskPercent,
    rrPlanned: trade.rrPlanned,
    pnl: trade.pnl,
    session: trade.session,
    setupQualityGrade: trade.setupQualityGrade,
    blueprintRulesFollowed: trade.blueprintRulesFollowed,
    blueprintRulesBroken: trade.blueprintRulesBroken,
    preTradeEmotion: trade.preTradeEmotion,
    duringTradeEmotion: trade.duringTradeEmotion,
    postTradeEmotion: trade.postTradeEmotion,
    isRevengeTrade: trade.isRevengeTrade,
    isFomo: trade.isFomo,
    hesitation: trade.hesitation,
    movedStopLoss: trade.movedStopLoss,
    closedEarly: trade.closedEarly,
    followedPlan: trade.followedPlan,
    mistakeTags: trade.mistakeTags,
    maxRiskPercent: profile?.riskPerTradePercent ?? null
  });
  const pnlValue = trade.pnl ?? 0;
  let result = "BREAKEVEN";
  if (pnlValue > 0) result = "WIN";
  else if (pnlValue < 0) result = "LOSS";
  const prompt = `You are an elite discretionary trading coach reviewing one trade. ${MARKET_GUARDRAIL}
The process scores below were already computed objectively from the trader's review data \u2014 do NOT restate or invent scores. Write only honest, specific prose that explains the scores and tells the trader what to fix. Score the PROCESS, not the result.

TRADE: ${trade.symbol} ${trade.direction} | ${result} | P&L:${trade.pnl ?? "N/A"} (${trade.pnlPercent ?? "N/A"}%) | RR planned:${trade.rrPlanned} actual:${trade.rrActual ?? "N/A"}
SETUP: ${trade.setupName ?? trade.setupType} | grade:${trade.setupQualityGrade ?? "N/A"} | blueprint match:${scores.blueprintMatchScore ?? "N/A"}%
PSYCH: pre:${trade.preTradeEmotion} during:${trade.duringTradeEmotion ?? "N/A"} post:${trade.postTradeEmotion ?? "N/A"} | confidence:${trade.confidenceLevel}/10 | revenge:${trade.isRevengeTrade} fomo:${trade.isFomo} hesitation:${trade.hesitation ?? false} movedSL:${trade.movedStopLoss ?? false} closedEarly:${trade.closedEarly ?? false}
PLAN FOLLOWED: ${trade.followedPlan ?? "N/A"} | mistakes:${(trade.mistakeTags ?? []).join(",") || "none"} | lossClass:${trade.lossClassification ?? "N/A"}
NARRATIVE: entry="${trade.reasonForEntry ?? "N/A"}" exit="${trade.reasonForExit ?? "N/A"}"
COMPUTED SCORES: setup:${scores.setupQuality} execution:${scores.executionScore} psychology:${scores.psychologyScore} discipline:${scores.disciplineScore} risk:${scores.riskScore} patience:${scores.patienceScore} overall:${scores.overallScore}
FLAGS: ${scores.flags.join(",") || "none"}
Trader rules: ${(profile?.tradingRules ?? []).join(";") || "none"}

Respond EXACTLY in this format (no extra lines):
COMMENT: [2-4 sentence honest coach comment explaining the scores]
MAIN MISTAKE: [one sentence \u2014 the single biggest issue, or "None \u2014 disciplined trade" if clean]
NEXT IMPROVEMENT: [one concrete, actionable thing to do on the next trade]`;
  let comment = "";
  let mainMistake = "";
  let nextImprovement = "";
  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 350,
      temperature: 0.3,
      messages: [{ role: "user", content: prompt }]
    });
    const firstBlock = response.content[0];
    const text = firstBlock.type === "text" ? firstBlock.text : "";
    const grab = (label) => {
      const match = new RegExp(String.raw`${label}:\s*(.+?)(?=\n[A-Z ]+:|$)`, "s").exec(text);
      return match ? match[1].trim() : "";
    };
    comment = grab("COMMENT") || text.trim();
    mainMistake = grab("MAIN MISTAKE");
    nextImprovement = grab("NEXT IMPROVEMENT");
  } catch {
    comment = "AI commentary unavailable. Scores were computed from your review data.";
  }
  const { error: updErr } = await supabase.from("trades").update({
    setupQuality: scores.setupQuality,
    executionScore: scores.executionScore,
    psychologyScore: scores.psychologyScore,
    disciplineScore: scores.disciplineScore,
    riskScore: scores.riskScore,
    patienceScore: scores.patienceScore,
    overallScore: scores.overallScore,
    aiScore: scores.overallScore,
    blueprintMatchScore: scores.blueprintMatchScore,
    aiReview: comment,
    aiMainMistake: mainMistake || null,
    aiNextImprovement: nextImprovement || null
  }).eq("id", tradeId).eq("userId", userId2);
  if (updErr) throw new Error(updErr.message);
  return comment;
}
async function generateWeeklyCoaching(userId2, weekStr) {
  const now2 = /* @__PURE__ */ new Date();
  const weekStart = new Date(now2);
  weekStart.setDate(now2.getDate() - now2.getDay() - 7);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const period = weekStr ?? `${weekStart.toISOString().slice(0, 10)}_${weekEnd.toISOString().slice(0, 10)}`;
  const { data: existing } = await supabase.from("coaching_sessions").select("content").eq("userId", userId2).eq("period", period).eq("type", "WEEKLY").single();
  if (existing) return existing.content;
  const { trades: tradesResult } = await getTrades(userId2, { from: weekStart.toISOString(), to: weekEnd.toISOString(), limit: 50 });
  const stats2 = await getPerformanceStats(userId2, weekStart.toISOString(), weekEnd.toISOString());
  const patterns = await detectMistakePatterns(userId2);
  const { data: profile } = await supabase.from("user_profiles").select("*").eq("userId", userId2).single();
  const systemPrompt = `You are an elite discretionary trading coach writing a weekly coaching letter. ${MARKET_GUARDRAIL} Focus on process, behavior, and mindset only. Mentor tone, honest, actionable.`;
  const userPrompt = `Weekly trading coaching letter (300-500 words).

Week ${period}: ${stats2.totalTrades} trades | ${stats2.winCount}W/${stats2.lossCount}L | WR:${stats2.winRate}% | PnL:${stats2.totalPnl} | PF:${stats2.profitFactor} | AvgRR:${stats2.avgRR}
Trades: ${tradesResult?.slice(0, 10).map((t) => `${t.symbol}${t.direction}(${t.preTradeEmotion},${(t.mistakeTags ?? []).join(",") || "ok"})`).join(" | ") || "none"}
Patterns: ${patterns.join("; ") || "none"} | Rules: ${(profile?.tradingRules ?? []).join(";") || "none"}

Cover: performance reality, behavioral patterns, top 3 strengths, top 3 fixes, one drill for next week, mindset note.`;
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 700,
    temperature: 0.3,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }]
  });
  const firstBlock = response.content[0];
  const content = firstBlock.type === "text" ? firstBlock.text : "";
  await supabase.from("coaching_sessions").insert({
    userId: userId2,
    type: "WEEKLY",
    period,
    title: `Week of ${weekStart.toISOString().slice(0, 10)}`,
    content,
    tradesAnalyzed: stats2.totalTrades,
    keyInsights: patterns,
    warningFlags: patterns.filter((p) => p.includes("streak") || p.includes("Revenge"))
  });
  return content;
}
async function generateDailyDebrief(userId2, date) {
  const day = date ?? (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const from = `${day}T00:00:00.000Z`;
  const to = `${day}T23:59:59.999Z`;
  const { trades: tradesResult } = await getTrades(userId2, { from, to, limit: 20 });
  const stats2 = await getPerformanceStats(userId2, from, to);
  const patterns = await detectMistakePatterns(userId2);
  if (stats2.totalTrades === 0) return "No trades today. Rest days are part of the process.";
  const systemPrompt = `You are an elite discretionary trading coach writing an end-of-day debrief. ${MARKET_GUARDRAIL} Focus on process, behavior, and mindset only. Be direct and actionable.`;
  const userPrompt = `End-of-day debrief (150-200 words).

${day}: ${stats2.totalTrades} trades ${stats2.winCount}W/${stats2.lossCount}L WR:${stats2.winRate}% PnL:${stats2.totalPnl} AvgRR:${stats2.avgRR}
${tradesResult?.map((t) => `${t.symbol}${t.direction} pnl:${t.pnl ?? "open"} emotion:${t.preTradeEmotion} mistakes:${(t.mistakeTags ?? []).join(",") || "none"}`).join(" | ") || ""}
Warnings: ${patterns.join(";") || "none"}

Cover: what worked, one fix for tomorrow, one focus for next session.`;
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 350,
    temperature: 0.2,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }]
  });
  const firstBlock = response.content[0];
  return firstBlock.type === "text" ? firstBlock.text : "";
}
async function askCoach(userId2, question) {
  const stats2 = await getPerformanceStats(userId2);
  const patterns = await detectMistakePatterns(userId2);
  const { data: profile } = await supabase.from("user_profiles").select("*").eq("userId", userId2).single();
  const system = `You are an elite discretionary trading coach. Never predict markets or give trade signals. ${MARKET_GUARDRAIL} Focus on process, behavior, and mindset.
Trader: WR:${stats2.winRate}% AvgRR:${stats2.avgRR} PF:${stats2.profitFactor} Trades:${stats2.totalTrades}
Patterns: ${patterns.join(";") || "none"} | Rules: ${(profile?.tradingRules ?? []).join(";") || "none"}`;
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 500,
    temperature: 0.3,
    system,
    messages: [{ role: "user", content: question }]
  });
  const firstBlock = response.content[0];
  return firstBlock.type === "text" ? firstBlock.text : "";
}

// backend/server/services/riskValidator.service.ts
function validateTradeRisk(input) {
  const { entryPrice, stopLoss, takeProfit, lotSize } = input;
  const blockers = [];
  const warnings = [];
  if (stopLoss == null || stopLoss === entryPrice) {
    blockers.push("MISSING_STOP_LOSS");
  }
  if (takeProfit == null || takeProfit === entryPrice) {
    warnings.push("MISSING_TAKE_PROFIT");
  }
  if (lotSize == null || lotSize === 0) {
    blockers.push("LOT_SIZE_ZERO");
  }
  const hasValidSL = stopLoss != null && stopLoss !== entryPrice;
  const hasValidTP = takeProfit != null && takeProfit !== entryPrice;
  if (hasValidSL && hasValidTP) {
    const slDistance = Math.abs(entryPrice - stopLoss);
    const tpDistance = Math.abs(takeProfit - entryPrice);
    const actualRR = tpDistance / slDistance;
    if (actualRR < 1) {
      warnings.push("POOR_RR");
    }
  }
  return {
    isValid: blockers.length === 0,
    warnings,
    blockers
  };
}

// backend/server/routes/journal.ts
var import_zod2 = require("zod");
var router = (0, import_express6.Router)();
function param(value) {
  return Array.isArray(value) ? value[0] : value;
}
var CreateTradeSchema = import_zod2.z.object({
  symbol: import_zod2.z.string().min(3).max(10),
  direction: import_zod2.z.enum(["LONG", "SHORT"]),
  entryPrice: import_zod2.z.number().positive(),
  stopLoss: import_zod2.z.number().positive(),
  takeProfit: import_zod2.z.number().positive(),
  positionSize: import_zod2.z.number().positive(),
  riskPercent: import_zod2.z.number().min(0.01).max(10),
  session: import_zod2.z.enum(["LONDON", "NEW_YORK", "ASIA", "LONDON_NY_OVERLAP", "CUSTOM"]),
  timeframe: import_zod2.z.string(),
  setupType: import_zod2.z.string().min(1),
  confluences: import_zod2.z.array(import_zod2.z.string()).optional(),
  tags: import_zod2.z.array(import_zod2.z.string()).optional(),
  preTradeEmotion: import_zod2.z.enum(["CALM", "CONFIDENT", "ANXIOUS", "FEARFUL", "GREEDY", "REVENGE", "FOMO", "NEUTRAL", "EXCITED", "FRUSTRATED"]).optional(),
  confidenceLevel: import_zod2.z.number().min(1).max(10).optional(),
  tradePlan: import_zod2.z.string().optional(),
  reasonForEntry: import_zod2.z.string().optional(),
  entryTime: import_zod2.z.string(),
  checklistId: import_zod2.z.string().optional(),
  isRevengeTrade: import_zod2.z.boolean().optional(),
  isFomo: import_zod2.z.boolean().optional()
});
var EMOTIONS = ["CALM", "CONFIDENT", "ANXIOUS", "FEARFUL", "GREEDY", "REVENGE", "FOMO", "NEUTRAL", "EXCITED", "FRUSTRATED", "FOCUSED", "ANGRY", "IMPATIENT", "TIRED", "OVERCONFIDENT", "HESITANT", "STRESSED", "DETACHED", "EMOTIONAL", "SATISFIED", "DISAPPOINTED", "MOTIVATED", "REGRETFUL"];
var CloseTradeSchema = import_zod2.z.object({
  closePrice: import_zod2.z.number().positive(),
  exitTime: import_zod2.z.string(),
  postTradeEmotion: import_zod2.z.enum(EMOTIONS).optional(),
  reasonForExit: import_zod2.z.string().optional(),
  lessonsLearned: import_zod2.z.string().optional(),
  mistakeTags: import_zod2.z.array(import_zod2.z.string()).optional(),
  followedPlan: import_zod2.z.boolean().optional(),
  screenshotUrls: import_zod2.z.array(import_zod2.z.string()).optional()
});
var ReviewSchema = import_zod2.z.object({
  setupId: import_zod2.z.string().optional(),
  setupName: import_zod2.z.string().optional(),
  setupQualityGrade: import_zod2.z.enum(["A_PLUS", "A", "B", "C", "FORCED", "NO_SETUP"]).optional(),
  blueprintRulesFollowed: import_zod2.z.array(import_zod2.z.string()).optional(),
  blueprintRulesBroken: import_zod2.z.array(import_zod2.z.string()).optional(),
  reasonForEntry: import_zod2.z.string().optional(),
  reasonForExit: import_zod2.z.string().optional(),
  tradePlan: import_zod2.z.string().optional(),
  postTradeNotes: import_zod2.z.string().optional(),
  lessonsLearned: import_zod2.z.string().optional(),
  whatToImprove: import_zod2.z.string().optional(),
  preTradeEmotion: import_zod2.z.enum(EMOTIONS).optional(),
  duringTradeEmotion: import_zod2.z.enum(EMOTIONS).optional(),
  postTradeEmotion: import_zod2.z.enum(EMOTIONS).optional(),
  confidenceLevel: import_zod2.z.number().min(1).max(10).optional(),
  followedPlan: import_zod2.z.boolean().optional(),
  isFomo: import_zod2.z.boolean().optional(),
  isRevengeTrade: import_zod2.z.boolean().optional(),
  hesitation: import_zod2.z.boolean().optional(),
  movedStopLoss: import_zod2.z.boolean().optional(),
  closedEarly: import_zod2.z.boolean().optional(),
  mistakeTags: import_zod2.z.array(import_zod2.z.string()).optional(),
  lossClassification: import_zod2.z.enum(["VALID_LOSS", "EXECUTION", "PSYCHOLOGY", "RISK", "STRATEGY", "RULE_VIOLATION"]).optional(),
  screenshotUrls: import_zod2.z.array(import_zod2.z.string()).optional()
});
var TRADES_FALLBACK = {
  ok: true,
  data: [],
  pagination: { page: 1, limit: 25, total: 0, totalPages: 0 }
};
router.get("/trades", async (req, res) => {
  const pageNum = req.query.page ? Number(req.query.page) : 1;
  const limitNum = req.query.limit ? Number(req.query.limit) : 20;
  try {
    const userId2 = process.env.DEFAULT_USER_ID ?? "";
    const { symbol, direction, status, session, setupType, from, to, reviewStatus, setupId, setupQualityGrade } = req.query;
    const result = await getTrades(userId2, {
      page: pageNum,
      limit: limitNum,
      symbol,
      direction,
      status,
      session,
      setupType,
      reviewStatus,
      setupId,
      setupQualityGrade,
      from,
      to
    });
    res.json({
      ok: true,
      data: result.trades ?? [],
      pagination: {
        page: result.page ?? pageNum,
        limit: result.limit ?? limitNum,
        total: result.total ?? 0,
        totalPages: result.pages ?? 0
      }
    });
  } catch (err) {
    console.error("[journal/trades]", err.message);
    res.json({ ...TRADES_FALLBACK, pagination: { ...TRADES_FALLBACK.pagination, page: pageNum, limit: limitNum } });
  }
});
router.post("/trades", async (req, res) => {
  try {
    const userId2 = process.env.DEFAULT_USER_ID ?? "";
    const parsed = CreateTradeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      return;
    }
    const validation = validateTradeRisk({
      entryPrice: parsed.data.entryPrice,
      stopLoss: parsed.data.stopLoss,
      takeProfit: parsed.data.takeProfit,
      lotSize: void 0
    });
    if (!validation.isValid) {
      res.status(400).json({ error: "Trade blocked by risk rules", blockers: validation.blockers });
      return;
    }
    const trade = await createTrade(userId2, parsed.data);
    if (validation.warnings.length > 0) {
      res.status(201).json({ trade, warnings: validation.warnings });
      return;
    }
    res.status(201).json(trade);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router.get("/trades/:id", async (req, res) => {
  try {
    const userId2 = process.env.DEFAULT_USER_ID ?? "";
    const trade = await getTradeById(userId2, param(req.params.id));
    res.json(trade);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});
router.patch("/trades/:id/close", async (req, res) => {
  try {
    const userId2 = process.env.DEFAULT_USER_ID ?? "";
    const parsed = CloseTradeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      return;
    }
    const trade = await closeTrade(userId2, param(req.params.id), parsed.data);
    res.json(trade);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router.delete("/trades/:id", async (req, res) => {
  try {
    const userId2 = process.env.DEFAULT_USER_ID ?? "";
    await deleteTrade(userId2, param(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router.patch("/trades/:id/review", async (req, res) => {
  try {
    const userId2 = process.env.DEFAULT_USER_ID ?? "";
    const parsed = ReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      return;
    }
    const result = await updateTradeReview(userId2, param(req.params.id), parsed.data);
    if (result.trade?.reviewStatus === "COMPLETE") {
      reviewTrade(userId2, param(req.params.id)).catch(() => {
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router.post("/trades/:id/ai-review", async (req, res) => {
  try {
    const userId2 = process.env.DEFAULT_USER_ID ?? "";
    const review = await reviewTrade(userId2, param(req.params.id));
    res.json({ review });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
var STATS_FALLBACK = { totalTrades: 0, winRate: 0, profitFactor: 0, netPnl: 0, needsReview: 0 };
router.get("/stats", async (req, res) => {
  try {
    const userId2 = process.env.DEFAULT_USER_ID ?? "";
    const { from, to } = req.query;
    const stats2 = await getPerformanceStats(userId2, from, to);
    res.json({ ok: true, data: stats2 });
  } catch (err) {
    console.error("[journal/stats]", err.message);
    res.json({ ok: true, data: STATS_FALLBACK });
  }
});
var journal_default = router;

// backend/server/routes/playbook.ts
var import_express7 = require("express");
var import_zod3 = require("zod");
var router2 = (0, import_express7.Router)();
var SetupSchema = import_zod3.z.object({
  name: import_zod3.z.string().min(1).max(120),
  description: import_zod3.z.string().max(2e3).optional(),
  category: import_zod3.z.string().max(60).optional(),
  rules: import_zod3.z.array(import_zod3.z.string()).optional(),
  confirmations: import_zod3.z.array(import_zod3.z.string()).optional(),
  invalidations: import_zod3.z.array(import_zod3.z.string()).optional(),
  timeframes: import_zod3.z.array(import_zod3.z.string()).optional(),
  sessions: import_zod3.z.array(import_zod3.z.string()).optional(),
  tags: import_zod3.z.array(import_zod3.z.string()).optional(),
  notes: import_zod3.z.string().max(2e3).optional(),
  isActive: import_zod3.z.boolean().optional()
});
router2.get("/setups", async (req, res) => {
  try {
    const userId2 = process.env.DEFAULT_USER_ID ?? "";
    const includeInactive = req.query.all === "true";
    res.json(await listSetups(userId2, includeInactive));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router2.post("/setups", async (req, res) => {
  try {
    const userId2 = process.env.DEFAULT_USER_ID ?? "";
    const parsed = SetupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      return;
    }
    const setup = await createSetup(userId2, parsed.data);
    res.status(201).json(setup);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router2.post("/setups/seed", async (req, res) => {
  try {
    const userId2 = process.env.DEFAULT_USER_ID ?? "";
    res.json(await seedDefaultSetups(userId2));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router2.patch("/setups/:id", async (req, res) => {
  try {
    const userId2 = process.env.DEFAULT_USER_ID ?? "";
    const parsed = SetupSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      return;
    }
    const setup = await updateSetup(userId2, req.params.id, parsed.data);
    res.json(setup);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router2.delete("/setups/:id", async (req, res) => {
  try {
    const userId2 = process.env.DEFAULT_USER_ID ?? "";
    await deleteSetup(userId2, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
var playbook_default = router2;

// backend/server/routes/analytics.ts
var import_express8 = require("express");
var router3 = (0, import_express8.Router)();
var dbAvailable = () => {
  return isDatabaseConfigured();
};
router3.get("/equity-curve", async (req, res) => {
  if (!dbAvailable()) return res.json([]);
  try {
    const userId2 = process.env.DEFAULT_USER_ID ?? "";
    const { from, to } = req.query;
    res.json(await getEquityCurve(userId2, from, to));
  } catch {
    res.json([]);
  }
});
router3.get("/session-heatmap", async (req, res) => {
  if (!dbAvailable()) return res.json([]);
  try {
    const userId2 = process.env.DEFAULT_USER_ID ?? "";
    res.json(await getSessionHeatmap(userId2));
  } catch {
    res.json([]);
  }
});
router3.get("/day-heatmap", async (req, res) => {
  if (!dbAvailable()) return res.json([]);
  try {
    const userId2 = process.env.DEFAULT_USER_ID ?? "";
    res.json(await getDayOfWeekHeatmap(userId2));
  } catch {
    res.json([]);
  }
});
router3.get("/mistakes", async (req, res) => {
  if (!dbAvailable()) return res.json([]);
  try {
    const userId2 = process.env.DEFAULT_USER_ID ?? "";
    res.json(await getMistakeBreakdown(userId2));
  } catch {
    res.json([]);
  }
});
router3.get("/setups", async (req, res) => {
  if (!dbAvailable()) return res.json([]);
  try {
    const userId2 = process.env.DEFAULT_USER_ID ?? "";
    res.json(await getSetupPerformance(userId2));
  } catch {
    res.json([]);
  }
});
router3.get("/psychology", async (req, res) => {
  if (!dbAvailable()) return res.json([]);
  try {
    const userId2 = process.env.DEFAULT_USER_ID ?? "";
    res.json(await getPsychologyCorrelations(userId2));
  } catch {
    res.json([]);
  }
});
router3.get("/patterns", async (req, res) => {
  if (!dbAvailable()) return res.json({ ok: true, data: [] });
  try {
    const userId2 = process.env.DEFAULT_USER_ID ?? "";
    const patterns = await detectMistakePatterns(userId2);
    res.json({ ok: true, data: patterns });
  } catch {
    res.json({ ok: true, data: [] });
  }
});
router3.get("/setup-quality", async (req, res) => {
  if (!dbAvailable()) return res.json([]);
  try {
    const userId2 = process.env.DEFAULT_USER_ID ?? "";
    res.json(await getSetupQualityPerformance(userId2));
  } catch {
    res.json([]);
  }
});
router3.get("/mistake-cost", async (req, res) => {
  if (!dbAvailable()) return res.json([]);
  try {
    const userId2 = process.env.DEFAULT_USER_ID ?? "";
    res.json(await getMistakeCost(userId2));
  } catch {
    res.json([]);
  }
});
router3.get("/discipline", async (req, res) => {
  if (!dbAvailable()) return res.json(null);
  try {
    const userId2 = process.env.DEFAULT_USER_ID ?? "";
    res.json(await getDisciplineStats(userId2));
  } catch {
    res.json(null);
  }
});
router3.get("/risk-flags", async (req, res) => {
  if (!dbAvailable()) return res.json(null);
  try {
    const userId2 = process.env.DEFAULT_USER_ID ?? "";
    res.json(await getRiskFlagStats(userId2));
  } catch {
    res.json(null);
  }
});
router3.get("/time-of-day", async (req, res) => {
  if (!dbAvailable()) return res.json([]);
  try {
    const userId2 = process.env.DEFAULT_USER_ID ?? "";
    res.json(await getTimeOfDayPerformance(userId2));
  } catch {
    res.json([]);
  }
});
router3.get("/psychology-phase", async (req, res) => {
  if (!dbAvailable()) return res.json([]);
  try {
    const userId2 = process.env.DEFAULT_USER_ID ?? "";
    const phaseParam = req.query.phase;
    const phase = phaseParam === "during" || phaseParam === "post" ? phaseParam : "pre";
    res.json(await getPsychologyByPhase(userId2, phase));
  } catch {
    res.json([]);
  }
});
router3.get("/by-symbol", async (req, res) => {
  if (!dbAvailable()) return res.json([]);
  try {
    const userId2 = process.env.DEFAULT_USER_ID ?? "";
    res.json(await getPerformanceBySymbol(userId2));
  } catch {
    res.json([]);
  }
});
router3.get("/good-vs-bad-loss", async (req, res) => {
  if (!dbAvailable()) return res.json(null);
  try {
    const userId2 = process.env.DEFAULT_USER_ID ?? "";
    res.json(await getGoodVsBadLossStats(userId2));
  } catch {
    res.json(null);
  }
});
router3.get("/psychology-cost", async (req, res) => {
  if (!dbAvailable()) return res.json([]);
  try {
    const userId2 = process.env.DEFAULT_USER_ID ?? "";
    res.json(await getPsychologyFlagCost(userId2));
  } catch {
    res.json([]);
  }
});
router3.get("/review-coverage", async (req, res) => {
  if (!dbAvailable()) return res.json(null);
  try {
    const userId2 = process.env.DEFAULT_USER_ID ?? "";
    res.json(await getReviewCoverage(userId2));
  } catch {
    res.json(null);
  }
});
var analytics_default = router3;

// backend/server/routes/coach.ts
var import_express9 = require("express");

// backend/server/services/journalInsights.service.ts
var FALLBACK = {
  doingWell: "Not enough reviewed trades yet \u2014 complete a few post-trade reviews to unlock insights.",
  biggestMistake: "N/A",
  focusSetup: "N/A",
  avoidSetup: "N/A",
  worstEmotion: "N/A",
  bestSession: "N/A",
  carefulDay: "N/A",
  oneRuleToFix: "Complete a post-trade review on every closed trade.",
  weeklyFocus: "Build the habit of reviewing every trade against your blueprint."
};
async function generateJournalInsights(userId2) {
  const [stats2, setups, setupQuality, mistakeCost, psychology, discipline, sessions, days, patterns] = await Promise.all([
    getPerformanceStats(userId2),
    getSetupPerformance(userId2),
    getSetupQualityPerformance(userId2),
    getMistakeCost(userId2),
    getPsychologyByPhase(userId2, "pre"),
    getDisciplineStats(userId2),
    getSessionHeatmap(userId2),
    getDayOfWeekHeatmap(userId2),
    detectMistakePatterns(userId2)
  ]);
  if (stats2.totalTrades < 3) return FALLBACK;
  const summary = {
    stats: stats2,
    setups,
    setupQuality,
    topMistakesByCost: mistakeCost.slice(0, 5),
    psychologyByEmotion: psychology,
    discipline,
    sessions,
    days,
    patterns
  };
  const system = `You are an elite discretionary trading performance analyst. Analyse the trader's aggregated journal data and answer concisely. Be specific and quote real numbers from the data (win rates, P/L, counts). Never predict markets. Score process over outcome. Respond ONLY with a JSON object using these exact keys: doingWell, biggestMistake, focusSetup, avoidSetup, worstEmotion, bestSession, carefulDay, oneRuleToFix, weeklyFocus. Each value is one or two sentences.`;
  try {
    const result = await chatCompleteJSON(
      [
        { role: "system", content: system },
        { role: "user", content: `Journal data:
${JSON.stringify(summary)}` }
      ],
      { maxTokens: 900, temperature: 0.3, feature: "journal", operation: "generate_insights" }
    );
    return { ...FALLBACK, ...result };
  } catch {
    return FALLBACK;
  }
}

// backend/server/routes/coach.ts
var import_zod4 = require("zod");
var router4 = (0, import_express9.Router)();
router4.get("/insights", async (req, res) => {
  try {
    const userId2 = process.env.DEFAULT_USER_ID ?? "";
    res.json(await generateJournalInsights(userId2));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router4.get("/sessions", async (req, res) => {
  if (!isDatabaseConfigured()) {
    return res.json([]);
  }
  try {
    const userId2 = process.env.DEFAULT_USER_ID ?? "";
    const { data, error } = await supabase.from("coaching_sessions").select("*").eq("userId", userId2).order("createdAt", { ascending: false }).limit(20);
    if (error) throw error;
    res.json(data ?? []);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load coaching sessions" });
  }
});
router4.post("/weekly", async (req, res) => {
  try {
    const userId2 = process.env.DEFAULT_USER_ID ?? "";
    const content = await generateWeeklyCoaching(userId2, req.body.week);
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router4.post("/daily", async (req, res) => {
  try {
    const userId2 = process.env.DEFAULT_USER_ID ?? "";
    const content = await generateDailyDebrief(userId2, req.body.date);
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router4.post("/ask", async (req, res) => {
  try {
    const userId2 = process.env.DEFAULT_USER_ID ?? "";
    const { question } = import_zod4.z.object({ question: import_zod4.z.string().min(1).max(1e3) }).parse(req.body);
    const answer = await askCoach(userId2, question);
    res.json({ answer });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router4.patch("/sessions/:id/acknowledge", async (req, res) => {
  if (!isDatabaseConfigured()) {
    return res.json({ ok: true });
  }
  try {
    const userId2 = process.env.DEFAULT_USER_ID ?? "";
    const { error } = await supabase.from("coaching_sessions").update({ acknowledged: true }).eq("id", req.params.id).eq("userId", userId2);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to acknowledge coaching session" });
  }
});
var coach_default = router4;

// backend/server/routes/checklist.ts
var import_express10 = require("express");

// backend/server/services/checklist.service.ts
function computeReadinessScore(input) {
  const weights = {
    htfBiasAligned: 15,
    bosChochConfirmed: 15,
    liquiditySweepConfirmed: 12,
    rrMeetsMinimum: 12,
    notRevengeTrade: 10,
    notFomo: 10,
    emotionalStateOk: 8,
    newsRiskChecked: 8,
    sessionValid: 7,
    riskSizedCorrectly: 7,
    entryTimeframeAligned: 5,
    keyLevelPresent: 5
  };
  let score = 0;
  for (const [key, weight] of Object.entries(weights)) {
    if (input[key]) score += weight;
  }
  return score;
}
async function createChecklist(userId2, input) {
  const readinessScore = computeReadinessScore(input);
  let aiValidation;
  if (readinessScore < 80) {
    const failed = Object.entries(input).filter(([k, v]) => typeof v === "boolean" && !v).map(([k]) => k);
    const prompt = `A trader wants to enter a ${input.symbol} trade but failed these checklist items: ${failed.join(", ")}.
Readiness score: ${readinessScore}/100.
Give a 2-sentence coaching note. Should they take this trade? Be direct.`;
    const msg = await chatComplete(
      [{ role: "user", content: prompt }],
      { maxTokens: 150, temperature: 0.2, jsonMode: false, feature: "checklist", operation: "validate_trade" }
    );
    aiValidation = msg.content || void 0;
  } else {
    aiValidation = `Checklist passed with ${readinessScore}/100. All critical conditions met. Proceed with your plan and manage risk precisely.`;
  }
  const { data, error } = await supabase.from("pre_trade_checklists").insert({ userId: userId2, ...input, readinessScore, aiValidation }).select().single();
  if (error) throw new Error(error.message);
  return data;
}
async function getChecklists(userId2, limit = 10) {
  const { data, error } = await supabase.from("pre_trade_checklists").select("*").eq("userId", userId2).order("createdAt", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}
async function getChecklistById(userId2, id) {
  const { data, error } = await supabase.from("pre_trade_checklists").select("*").eq("id", id).eq("userId", userId2).single();
  if (error || !data) throw new Error("Checklist not found");
  return data;
}

// backend/server/routes/checklist.ts
var import_zod5 = require("zod");
var router5 = (0, import_express10.Router)();
var ChecklistSchema = import_zod5.z.object({
  symbol: import_zod5.z.string().min(3),
  htfBiasAligned: import_zod5.z.boolean(),
  liquiditySweepConfirmed: import_zod5.z.boolean(),
  bosChochConfirmed: import_zod5.z.boolean(),
  sessionValid: import_zod5.z.boolean(),
  rrMeetsMinimum: import_zod5.z.boolean(),
  newsRiskChecked: import_zod5.z.boolean(),
  emotionalStateOk: import_zod5.z.boolean(),
  notRevengeTrade: import_zod5.z.boolean(),
  notFomo: import_zod5.z.boolean(),
  riskSizedCorrectly: import_zod5.z.boolean(),
  entryTimeframeAligned: import_zod5.z.boolean(),
  keyLevelPresent: import_zod5.z.boolean(),
  notes: import_zod5.z.string().optional()
});
router5.post("/", async (req, res) => {
  try {
    const userId2 = process.env.DEFAULT_USER_ID;
    const parsed = ChecklistSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
      return;
    }
    const checklist = await createChecklist(userId2, parsed.data);
    res.status(201).json(checklist);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router5.get("/", async (req, res) => {
  const userId2 = process.env.DEFAULT_USER_ID;
  const limit = req.query.limit ? Number(req.query.limit) : 10;
  res.json(await getChecklists(userId2, limit));
});
router5.get("/:id", async (req, res) => {
  try {
    const userId2 = process.env.DEFAULT_USER_ID;
    res.json(await getChecklistById(userId2, req.params.id));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});
var checklist_default = router5;

// backend/server/routes/riskManager.ts
var import_express11 = require("express");

// backend/server/services/riskManager.service.ts
function calculateRisk(input) {
  const { accountSize, riskPercent, entryPrice, stopLoss, takeProfit, instrument } = input;
  const dollarRisk = accountSize * riskPercent / 100;
  const slDistance = Math.abs(entryPrice - stopLoss);
  const tpDistance = Math.abs(takeProfit - entryPrice);
  const rrRatio = tpDistance / slDistance;
  let lotSize;
  let pipValue;
  let pips;
  if (instrument === "forex") {
    const pipSize = entryPrice > 50 ? 0.01 : 1e-4;
    pips = slDistance / pipSize;
    pipValue = 10;
    lotSize = dollarRisk / (pips * pipValue);
  } else if (instrument === "gold") {
    pips = slDistance;
    pipValue = 100;
    lotSize = dollarRisk / (slDistance * pipValue);
  } else {
    pips = slDistance;
    pipValue = 1;
    lotSize = dollarRisk / slDistance;
  }
  const units = lotSize * 1e5;
  const dollarTarget = dollarRisk * rrRatio;
  let suggestion = "";
  if (rrRatio < 1) suggestion = "WARNING: RR below 1:1 \u2014 this trade does not meet minimum standards.";
  else if (rrRatio < 2) suggestion = "Acceptable RR. Consider if the setup justifies a sub-2R trade.";
  else if (rrRatio >= 3) suggestion = "Excellent RR. Ensure entry is precise \u2014 wide stops dilute quality.";
  else suggestion = "Good RR. Risk is well-defined.";
  if (riskPercent > 2) suggestion += " CAUTION: Risk exceeds 2% per trade recommendation.";
  return {
    dollarRisk: Math.round(dollarRisk * 100) / 100,
    lotSize: Math.round(lotSize * 100) / 100,
    units: Math.round(units),
    pipValue,
    pips: Math.round(pips * 10) / 10,
    rrRatio: Math.round(rrRatio * 100) / 100,
    dollarTarget: Math.round(dollarTarget * 100) / 100,
    breakEvenPercent: Math.round(1 / (rrRatio + 1) * 1e3) / 10,
    suggestion
  };
}

// backend/server/routes/riskManager.ts
var import_zod6 = require("zod");
var router6 = (0, import_express11.Router)();
var RiskSchema = import_zod6.z.object({
  accountSize: import_zod6.z.number().positive(),
  riskPercent: import_zod6.z.number().min(0.01).max(10),
  entryPrice: import_zod6.z.number().positive(),
  stopLoss: import_zod6.z.number().positive(),
  takeProfit: import_zod6.z.number().positive(),
  instrument: import_zod6.z.enum(["forex", "gold", "indices"]).default("forex")
});
router6.post("/calculate", (req, res) => {
  const parsed = RiskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  res.json(calculateRisk(parsed.data));
});
var riskManager_default = router6;

// backend/server/routes/metatrader.ts
var import_express12 = require("express");
var import_zod7 = require("zod");

// backend/server/services/metaTrader.service.ts
var import_node_child_process = require("node:child_process");
var import_node_path = __toESM(require("node:path"));

// backend/server/services/mt5TradebotApiProvider.ts
var BASE_URL = () => (process.env.MT5_TRADEBOT_API_URL ?? "http://127.0.0.1:8001/api/v1").replace(/\/$/, "");
var TIMEOUT_MS = () => Number(process.env.MT5_TRADEBOT_API_TIMEOUT ?? 3e4);
function sanitizeMt5Payload(body) {
  if (typeof body !== "string") return body;
  try {
    const parsed = JSON.parse(body);
    if ("password" in parsed) parsed.password = "[REDACTED]";
    return parsed;
  } catch {
    return body;
  }
}
async function tradebotFetch(path4, options = {}) {
  const url = `${BASE_URL()}${path4}`;
  const controller = new AbortController();
  const timer2 = setTimeout(() => controller.abort(), TIMEOUT_MS());
  try {
    if (path4 === "/connect") {
      console.log("[MT5] Calling bridge endpoint:", url);
      console.log("[MT5] Request payload:", sanitizeMt5Payload(options.body));
    }
    const res = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
      signal: controller.signal
    });
    clearTimeout(timer2);
    const text = await res.text();
    const contentType = res.headers.get("content-type");
    const preview = text.slice(0, 500);
    console.log("[MT5] Response status:", res.status);
    console.log("[MT5] Response content-type:", contentType ?? "unknown");
    console.log("[MT5] Response preview:", preview || "[empty]");
    let data;
    if (!contentType?.toLowerCase().includes("application/json")) {
      console.warn("[MT5] JSON parse skipped because response is not JSON");
      data = {
        success: false,
        error: "MT5_BRIDGE_UNAVAILABLE",
        message: "MT5 bridge returned HTML or is not reachable",
        details: {
          status: res.status,
          endpoint: url,
          contentType,
          responsePreview: preview
        }
      };
      return { ok: false, status: res.status, data };
    }
    try {
      data = JSON.parse(text);
    } catch {
      data = {
        success: false,
        error: "MT5_INVALID_JSON",
        message: "MT5 bridge returned invalid JSON",
        details: {
          status: res.status,
          endpoint: url,
          contentType,
          responsePreview: preview
        }
      };
      return { ok: false, status: res.status, data };
    }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    clearTimeout(timer2);
    const isAbort = err instanceof Error && err.name === "AbortError";
    if (isAbort) {
      throw new Error(`MT5 API request timed out while calling ${url}`);
    }
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`MT5 API unreachable at ${url}. ${reason}`);
  }
}
async function mt5HealthCheck() {
  try {
    const res = await tradebotFetch("/health");
    if (res.ok) return { healthy: true, message: res.data.message ?? "MT5 API is healthy" };
    return { healthy: false, message: `MT5 API returned ${res.status}` };
  } catch (err) {
    return { healthy: false, message: err instanceof Error ? err.message : "MT5 API unreachable" };
  }
}
async function mt5TradebotConnect(creds) {
  if (creds.passwordType !== "investor") {
    return {
      success: false,
      status: "failed",
      error: {
        code: "READ_ONLY_REQUIRED",
        message: "Use the investor read-only password. Trading passwords are not accepted by this dashboard."
      }
    };
  }
  const health = await mt5HealthCheck();
  if (!health.healthy) {
    return {
      success: false,
      status: "failed",
      error: {
        code: "CONNECTION_UNAVAILABLE",
        message: `MT5 TradeBot API is not running. Start it on Windows with 'python main.py' or 'python3 backend/main.py'. (${health.message})`
      }
    };
  }
  const res = await tradebotFetch("/connect", {
    method: "POST",
    body: JSON.stringify({
      version: creds.version,
      login: creds.login,
      password: creds.password,
      server: creds.server,
      accountType: creds.accountType,
      passwordType: creds.passwordType
    })
  });
  if (!res.ok) {
    const msg = String(res.data.detail ?? res.data.message ?? `HTTP ${res.status}`).toLowerCase();
    const diagnosticDetails = {
      ...res.data.details ?? {},
      account: creds.login,
      server: creds.server
    };
    if (res.data.error === "MT5_BRIDGE_UNAVAILABLE" || res.data.error === "MT5_INVALID_JSON") {
      return {
        success: false,
        status: "failed",
        error: {
          code: "CONNECTION_UNAVAILABLE",
          message: "MT5 bridge returned HTML or is not reachable",
          details: diagnosticDetails
        }
      };
    }
    if (msg.includes("password") || msg.includes("invalid")) {
      return { success: false, status: "failed", error: { code: "WRONG_PASSWORD", message: "Invalid credentials. Check your login and password." } };
    }
    if (msg.includes("server") || msg.includes("not found")) {
      return { success: false, status: "failed", error: { code: "WRONG_SERVER", message: "Broker server not found. Check the server name." } };
    }
    if (msg.includes("terminal path") || msg.includes("installed")) {
      return { success: false, status: "failed", error: { code: "TERMINAL_NOT_INSTALLED", message: "MetaTrader 5 terminal is not installed or MT5_TERMINAL_PATH is wrong." } };
    }
    if (msg.includes("ipc") || msg.includes("terminal is not running") || msg.includes("cannot be reached")) {
      return { success: false, status: "failed", error: { code: "TERMINAL_NOT_RUNNING", message: "MetaTrader 5 terminal is not running on the Windows machine." } };
    }
    if (msg.includes("terminal") || msg.includes("initialize")) {
      return { success: false, status: "failed", error: { code: "CONNECTION_UNAVAILABLE", message: "MetaTrader 5 terminal is unavailable on the Windows machine." } };
    }
    return {
      success: false,
      status: "failed",
      error: {
        code: "FAILED_TO_CONNECT",
        message: String(res.data.detail ?? res.data.message ?? "Connection failed"),
        details: diagnosticDetails
      }
    };
  }
  const [accountResult, positionsResult, historyResult] = await Promise.all([
    mt5GetAccountInfo(),
    mt5GetPositions(),
    mt5GetHistory()
  ]);
  if (!accountResult) {
    return { success: false, status: "failed", error: { code: "FAILED_TO_CONNECT", message: "Connected but could not retrieve account info." } };
  }
  return {
    success: true,
    status: "connected",
    account: accountResult,
    positions: positionsResult,
    history: historyResult
  };
}
async function mt5TradebotDisconnect() {
  try {
    await tradebotFetch("/disconnect", { method: "POST" });
  } catch {
  }
}
async function mt5GetAccountInfo() {
  try {
    const res = await tradebotFetch("/account");
    if (!res.ok) return null;
    const d = res.data;
    return {
      login: String(d.login ?? ""),
      server: d.server ?? "",
      broker: d.company ?? "",
      name: d.name ?? "",
      balance: d.balance ?? 0,
      equity: d.equity ?? 0,
      currency: d.currency ?? "USD",
      leverage: d.leverage ?? 0,
      tradeAllowed: d.trade_allowed
    };
  } catch {
    return null;
  }
}
async function mt5GetPositions() {
  try {
    const res = await tradebotFetch("/positions");
    if (!res.ok || !Array.isArray(res.data)) return [];
    return res.data.map((p) => ({
      ticket: String(p.ticket ?? ""),
      symbol: p.symbol ?? "",
      type: p.type === 0 || p.type === "buy" ? "buy" : "sell",
      volume: p.volume ?? 0,
      profit: p.profit ?? 0,
      openPrice: p.price_open,
      currentPrice: p.price_current,
      openedAt: p.time ? new Date(typeof p.time === "number" ? p.time * 1e3 : p.time).toISOString() : null
    }));
  } catch {
    return [];
  }
}
async function mt5GetHistory() {
  try {
    const res = await tradebotFetch("/history");
    if (!res.ok || !Array.isArray(res.data)) return [];
    return res.data.map((deal) => ({
      ticket: String(deal.ticket ?? ""),
      order: String(deal.order ?? deal.ticket ?? ""),
      positionId: deal.positionId != null ? String(deal.positionId) : void 0,
      symbol: deal.symbol ?? "",
      type: deal.type === 0 || deal.type === "buy" ? "buy" : "sell",
      entryType: deal.entryType ?? null,
      volume: deal.volume ?? 0,
      price: deal.price ?? 0,
      profit: deal.profit ?? 0,
      commission: deal.commission ?? 0,
      swap: deal.swap ?? 0,
      time: deal.time ? new Date(typeof deal.time === "number" ? deal.time * 1e3 : deal.time).toISOString() : null,
      comment: deal.comment ?? null
    }));
  } catch {
    return [];
  }
}
async function mt5GetSymbols() {
  const res = await tradebotFetch("/symbols");
  if (!res.ok) throw new Error(`Failed to fetch symbols: HTTP ${res.status}`);
  return Array.isArray(res.data) ? res.data : res.data.symbols ?? [];
}
async function mt5GetTick(symbol) {
  const res = await tradebotFetch(`/symbol/${encodeURIComponent(symbol)}/tick`);
  if (!res.ok) throw new Error(`Symbol '${symbol}' not found or unavailable`);
  return res.data;
}
async function mt5GetHistoricalData(symbol, timeframe, startDate, endDate) {
  const res = await tradebotFetch("/historical-data", {
    method: "POST",
    body: JSON.stringify({ symbol, timeframe, start_date: startDate, end_date: endDate })
  });
  if (!res.ok) throw new Error(`Historical data fetch failed: HTTP ${res.status}`);
  return Array.isArray(res.data) ? res.data : res.data.data ?? [];
}

// backend/server/services/metaTrader.service.ts
var connectionStore = /* @__PURE__ */ new Map();
function getBridgeStatus() {
  const tradebotUrl = process.env.MT5_TRADEBOT_API_URL;
  const metaApiToken = process.env.METAAPI_TOKEN;
  const bridgeUrl = process.env.METATRADER_BRIDGE_URL;
  const pythonBin = process.env.METATRADER_PYTHON_BIN;
  if (metaApiToken) {
    return {
      configured: true,
      provider: "metaapi",
      providerLabel: "MetaApi Cloud",
      ready: true,
      message: "MetaApi cloud bridge is configured and preferred for macOS, Linux, and Vercel deployments."
    };
  }
  if (tradebotUrl) {
    return {
      configured: true,
      provider: "mt5_tradebot_api",
      providerLabel: `MT5 TradeBot API (${tradebotUrl})`,
      ready: true,
      message: `Self-hosted MT5 TradeBot API configured at ${tradebotUrl}`
    };
  }
  if (bridgeUrl) {
    return {
      configured: true,
      provider: "custom_bridge",
      providerLabel: `Custom Bridge (${bridgeUrl})`,
      ready: true,
      message: `Custom bridge configured at ${bridgeUrl}`
    };
  }
  if (pythonBin || process.platform === "win32") {
    return {
      configured: true,
      provider: "local_python",
      providerLabel: "Local Python MT5 Bridge",
      ready: true,
      message: "Local Python MT5 bridge available."
    };
  }
  return {
    configured: false,
    provider: "none",
    providerLabel: "No bridge configured",
    ready: false,
    message: "No MetaTrader bridge is configured. On macOS/Linux, set METAAPI_TOKEN (MetaApi cloud) or METATRADER_BRIDGE_URL (custom bridge) in your .env file."
  };
}
function buildConnectionKey(version, server, login) {
  return `${version}:${server.trim().toLowerCase()}:${login.trim()}`;
}
var METAAPI_PROVISIONING = "https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai";
var METAAPI_CLIENT_BASE = "https://mt-client-api-v1.london.agiliumtrade.ai";
var METAAPI_TIMEOUT_MS = 6e4;
var METAAPI_CONNECT_WAIT_MS = Number(process.env.METAAPI_CONNECT_WAIT_MS ?? 12e4);
function metaApiAccountId(account) {
  return account.id ?? account._id ?? "";
}
async function metaApiFetch(url, options, token) {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "auth-token": token,
      ...options.headers
    },
    signal: AbortSignal.timeout(METAAPI_TIMEOUT_MS)
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    console.error("[MetaApi] Non-JSON response", res.status, text.slice(0, 200));
    data = { message: `HTTP ${res.status}: ${text.slice(0, 100)}` };
  }
  return { ok: res.ok, status: res.status, data };
}
function loginMatches(account, login) {
  return String(account.login) === String(login);
}
function serverMatches(account, server) {
  return (account.server ?? "").toLowerCase() === server.toLowerCase();
}
function findByLoginServer(accounts, login, server) {
  return accounts.find((a) => loginMatches(a, login) && serverMatches(a, server));
}
async function fetchAccountList(token, limit = 100) {
  const res = await metaApiFetch(
    `${METAAPI_PROVISIONING}/users/current/accounts?limit=${limit}`,
    { method: "GET" },
    token
  );
  return res.ok && Array.isArray(res.data) ? res.data : [];
}
async function createNewMetaApiAccount(token, creds) {
  const res = await metaApiFetch(
    `${METAAPI_PROVISIONING}/users/current/accounts`,
    {
      method: "POST",
      body: JSON.stringify({
        login: creds.login,
        password: creds.password,
        server: creds.server,
        platform: creds.version,
        name: `${creds.server} ${creds.login}`,
        type: "cloud-g2",
        magic: 0,
        application: "MetaApi"
      })
    },
    token
  );
  if (!res.ok) {
    const body = res.data;
    const msg = body.message ?? "Failed to provision MetaApi account";
    const detail = body.details ? " \u2014 " + JSON.stringify(body.details) : "";
    console.error("[MetaApi] Account creation failed", { status: res.status, body: JSON.stringify(body) });
    return { ok: false, accountId: "", status: res.status, error: msg + detail };
  }
  const id = res.data.id ?? res.data._id ?? "";
  return { ok: true, accountId: id, status: res.status };
}
async function metaApiProvisionAccount(token, creds) {
  const initialList = await fetchAccountList(token, 100);
  const existing = findByLoginServer(initialList, creds.login, creds.server);
  if (existing) {
    const id = metaApiAccountId(existing);
    console.log(`[MetaApi] Found existing account id=${id} state=${existing.state} connectionStatus=${existing.connectionStatus}`);
    return { ok: true, accountId: id };
  }
  console.log(`[MetaApi] No existing account for login=${creds.login} server=${creds.server} \u2014 provisioning...`);
  const created = await createNewMetaApiAccount(token, creds);
  if (created.ok) return { ok: true, accountId: created.accountId };
  if (created.status === 400 || created.status === 409) {
    console.log("[MetaApi] Creation rejected \u2014 recovering from wider list (limit=500)...");
    const wideList = await fetchAccountList(token, 500);
    const recovered = findByLoginServer(wideList, creds.login, creds.server);
    if (recovered) {
      const id = metaApiAccountId(recovered);
      console.log(`[MetaApi] Recovered existing account id=${id}`);
      return { ok: true, accountId: id };
    }
  }
  return { ok: false, accountId: "", error: created.error };
}
async function metaApiWaitForConnection(token, accountId) {
  const initialCheck = await metaApiFetch(
    `${METAAPI_PROVISIONING}/users/current/accounts/${accountId}`,
    { method: "GET" },
    token
  );
  if (initialCheck.ok) {
    const { state: state2, connectionStatus } = initialCheck.data;
    if (state2 === "DEPLOYED" && connectionStatus === "CONNECTED") return true;
    if (state2 === "DEPLOY_FAILED") return false;
    console.log(`[MetaApi] Account not yet connected (state=${state2} connectionStatus=${connectionStatus}) \u2014 polling...`);
  }
  const deadline = Date.now() + METAAPI_CONNECT_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3e3));
    const res = await metaApiFetch(
      `${METAAPI_PROVISIONING}/users/current/accounts/${accountId}`,
      { method: "GET" },
      token
    );
    if (!res.ok) continue;
    if (res.data.state === "DEPLOYED" && res.data.connectionStatus === "CONNECTED") return true;
    if (res.data.state === "DEPLOY_FAILED") return false;
  }
  return false;
}
async function metaApiGetAccountInfo(token, accountId) {
  const res = await metaApiFetch(
    `${METAAPI_CLIENT_BASE}/users/current/accounts/${accountId}/account-information`,
    { method: "GET" },
    token
  );
  return res.ok ? res.data : null;
}
async function metaApiGetPositions(token, accountId) {
  const res = await metaApiFetch(
    `${METAAPI_CLIENT_BASE}/users/current/accounts/${accountId}/positions`,
    { method: "GET" },
    token
  );
  return res.ok && Array.isArray(res.data) ? res.data : [];
}
async function metaApiGetHistory(token, accountId) {
  const startTime = new Date(Date.now() - 90 * 24 * 3600 * 1e3).toISOString();
  const endTime = (/* @__PURE__ */ new Date()).toISOString();
  const res = await metaApiFetch(
    `${METAAPI_CLIENT_BASE}/users/current/accounts/${accountId}/history-deals/time/${startTime}/${endTime}?limit=100`,
    { method: "GET" },
    token
  );
  return res.ok && Array.isArray(res.data) ? res.data : [];
}
async function getMetaApiAccountRuntimeStatus(accountId) {
  const token = process.env.METAAPI_TOKEN;
  if (!token) {
    return {
      connected: false,
      state: null,
      connectionStatus: null,
      tradeAllowed: null,
      accountInfo: null,
      message: "METAAPI_TOKEN is not configured."
    };
  }
  const account = await metaApiFetch(
    `${METAAPI_PROVISIONING}/users/current/accounts/${accountId}`,
    { method: "GET" },
    token
  );
  if (!account.ok) {
    return {
      connected: false,
      state: null,
      connectionStatus: null,
      tradeAllowed: null,
      accountInfo: null,
      message: `MetaApi account lookup failed with HTTP ${account.status}.`
    };
  }
  const connected = account.data.state === "DEPLOYED" && account.data.connectionStatus === "CONNECTED";
  const accountInfo = connected ? await metaApiGetAccountInfo(token, accountId) : null;
  return {
    connected,
    state: account.data.state,
    connectionStatus: account.data.connectionStatus,
    tradeAllowed: accountInfo?.tradeAllowed ?? null,
    accountInfo,
    message: connected ? "MetaApi account is connected." : "MetaApi account is not deployed and connected."
  };
}
async function placeMetaApiTradeOrder(order) {
  const token = process.env.METAAPI_TOKEN;
  if (!token) {
    return { success: false, message: "METAAPI_TOKEN is not configured." };
  }
  const body = {
    actionType: order.actionType,
    symbol: order.symbol,
    volume: order.volume,
    stopLoss: order.stopLoss,
    takeProfit: order.takeProfit,
    comment: order.comment ?? "AlphaMentals validated trade",
    clientId: order.clientId
  };
  if (order.openPrice != null) body.openPrice = order.openPrice;
  const res = await metaApiFetch(
    `${METAAPI_CLIENT_BASE}/users/current/accounts/${order.accountId}/trade`,
    {
      method: "POST",
      body: JSON.stringify(body)
    },
    token
  );
  if (!res.ok) {
    const message = typeof res.data.message === "string" ? res.data.message : `MetaApi order failed with HTTP ${res.status}.`;
    return { success: false, message, raw: res.data };
  }
  const orderId = String(res.data.orderId ?? res.data.order ?? res.data.id ?? "");
  const positionId = String(res.data.positionId ?? "");
  return {
    success: true,
    orderId: orderId || void 0,
    positionId: positionId || void 0,
    raw: res.data,
    message: "MetaApi order accepted."
  };
}
function mapMetaApiPositions(positions) {
  return positions.map((p) => ({
    ticket: p.id,
    symbol: p.symbol,
    type: p.type === "POSITION_TYPE_BUY" ? "buy" : "sell",
    volume: p.volume,
    profit: p.profit,
    openPrice: p.openPrice,
    currentPrice: p.currentPrice,
    openedAt: p.time
  }));
}
function mapMetaApiDeals(deals) {
  return deals.map((d) => ({
    ticket: d.id,
    order: d.orderId,
    positionId: d.positionId,
    symbol: d.symbol,
    type: d.type === "DEAL_TYPE_BUY" ? "buy" : "sell",
    entryType: d.entryType === "DEAL_ENTRY_IN" ? 0 : 1,
    volume: d.volume,
    price: d.price,
    profit: d.profit,
    commission: d.commission,
    swap: d.swap,
    time: d.time,
    comment: d.comment
  }));
}
async function callMetaApiBridge(creds) {
  const token = process.env.METAAPI_TOKEN;
  if (!token) {
    console.error("[MetaApi] METAAPI_TOKEN is not set \u2014 cannot connect.");
    return {
      success: false,
      status: "failed",
      error: { code: "BRIDGE_NOT_CONFIGURED", message: "METAAPI_TOKEN is not configured. Add it to your .env file." }
    };
  }
  console.log(`[MetaApi] Connecting login=${creds.login} server=${creds.server} platform=${creds.version} accountType=${creds.accountType}`);
  try {
    return await _callMetaApiBridge(token, creds);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[MetaApi] Unexpected error during bridge call:", msg);
    return {
      success: false,
      status: "failed",
      error: { code: "FAILED_TO_CONNECT", message: msg }
    };
  }
}
async function _callMetaApiBridge(token, creds) {
  console.log("[MetaApi] Step 1 \u2014 provisioning account on MetaApi cloud...");
  const provision = await metaApiProvisionAccount(token, creds);
  if (!provision.ok) {
    const err = provision.error ?? "";
    console.error("[MetaApi] Account provisioning failed:", err);
    if (err.toLowerCase().includes("invalid") || err.toLowerCase().includes("login")) {
      return { success: false, status: "failed", error: { code: "INVALID_LOGIN", message: "Invalid login number or broker server." } };
    }
    if (err.toLowerCase().includes("password")) {
      return { success: false, status: "failed", error: { code: "WRONG_PASSWORD", message: "Incorrect password." } };
    }
    return { success: false, status: "failed", error: { code: "FAILED_TO_CONNECT", message: err } };
  }
  console.log(`[MetaApi] Step 1 \u2014 account provisioned: id=${provision.accountId}`);
  const accountId = provision.accountId;
  console.log("[MetaApi] Step 2 \u2014 waiting for terminal to connect to broker...");
  const connected = await metaApiWaitForConnection(token, accountId);
  if (!connected) {
    console.error("[MetaApi] Step 2 \u2014 connection timed out. Check broker server name and credentials.");
    return {
      success: false,
      status: "failed",
      error: {
        code: "CONNECTION_TIMEOUT",
        message: "Connection timeout. The broker server did not respond in time. Check the server name and try again."
      }
    };
  }
  console.log("[MetaApi] Step 2 \u2014 terminal connected.");
  console.log("[MetaApi] Step 3 \u2014 fetching account information...");
  const info = await metaApiGetAccountInfo(token, accountId);
  if (!info) {
    console.error("[MetaApi] Step 3 \u2014 failed to retrieve account info from MetaApi.");
    return { success: false, status: "failed", error: { code: "FAILED_TO_CONNECT", message: "Failed to retrieve account information." } };
  }
  console.log(`[MetaApi] Step 3 \u2014 account info: login=${info.login} balance=${info.balance} ${info.currency}`);
  console.log("[MetaApi] Step 4 \u2014 fetching open positions and trade history...");
  const [positions, deals] = await Promise.all([
    metaApiGetPositions(token, accountId),
    metaApiGetHistory(token, accountId)
  ]);
  console.log(`[MetaApi] Step 4 \u2014 fetched ${positions.length} open positions, ${deals.length} history deals.`);
  const account = {
    login: String(info.login),
    server: info.server,
    broker: info.broker,
    name: info.name,
    balance: info.balance,
    equity: info.equity,
    currency: info.currency,
    leverage: info.leverage,
    isInvestor: info.investorMode,
    tradeAllowed: info.tradeAllowed,
    terminalVersion: info.terminalVersion ? String(info.terminalVersion) : void 0
  };
  const result = {
    success: true,
    status: "connected",
    account,
    positions: mapMetaApiPositions(positions),
    history: mapMetaApiDeals(deals)
  };
  console.log(`[MetaApi] Connected successfully. login=${account.login} broker=${account.broker} balance=${account.balance} ${account.currency}`);
  return result;
}
async function callRemoteBridge(credentials) {
  const bridgeUrl = process.env.METATRADER_BRIDGE_URL;
  try {
    const response = await fetch(`${bridgeUrl.replace(/\/$/, "")}/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
      signal: AbortSignal.timeout(3e4)
    });
    return await response.json();
  } catch (err) {
    return {
      success: false,
      status: "failed",
      error: {
        code: "CONNECTION_TIMEOUT",
        message: "Bridge connection timed out or returned an invalid response.",
        details: err instanceof Error ? err.message : String(err)
      }
    };
  }
}
async function callLocalBridge(credentials) {
  const scriptPath = import_node_path.default.resolve(process.cwd(), "backend/scripts/metatrader_bridge.py");
  const pythonCommand = process.env.METATRADER_PYTHON_BIN || "python3";
  return await new Promise((resolve) => {
    const child = (0, import_node_child_process.spawn)(pythonCommand, [scriptPath], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", () => {
      resolve({
        success: false,
        status: "disconnected",
        error: {
          code: "CONNECTION_UNAVAILABLE",
          message: "Failed to start the local MetaTrader bridge. Make sure the MetaTrader5 Python package is installed."
        }
      });
    });
    child.on("close", () => {
      if (!stdout.trim()) {
        resolve({
          success: false,
          status: "failed",
          error: {
            code: "FAILED_TO_CONNECT",
            message: "MetaTrader bridge returned an empty response. Check that MetaTrader 5 terminal is running.",
            details: stderr.trim() || void 0
          }
        });
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve({
          success: false,
          status: "failed",
          error: { code: "FAILED_TO_CONNECT", message: "MetaTrader bridge returned an invalid response." }
        });
      }
    });
    child.stdin.write(JSON.stringify(credentials));
    child.stdin.end();
  });
}
async function runBridgeConnection(credentials) {
  if (process.env.METAAPI_TOKEN) {
    return callMetaApiBridge(credentials);
  }
  if (process.env.MT5_TRADEBOT_API_URL) {
    return mt5TradebotConnect(credentials);
  }
  if (process.env.METATRADER_BRIDGE_URL) {
    return callRemoteBridge(credentials);
  }
  if (process.env.METATRADER_PYTHON_BIN || process.platform === "win32") {
    return callLocalBridge(credentials);
  }
  return {
    success: false,
    status: "disconnected",
    error: {
      code: "BRIDGE_NOT_CONFIGURED",
      message: "BRIDGE_NOT_CONFIGURED: MetaTrader connection requires a bridge. On macOS, set METAAPI_TOKEN in your .env file to connect via MetaApi cloud (free at metaapi.cloud), or set METATRADER_BRIDGE_URL to point to a Windows VPS bridge."
    }
  };
}
async function connectMetaTrader(credentials) {
  const result = await runBridgeConnection(credentials);
  if (!result.success || !result.account) return result;
  const connectionKey = buildConnectionKey(credentials.version, credentials.server, credentials.login);
  connectionStore.set(connectionKey, {
    credentials,
    connectedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
  return { ...result, connectionKey, status: "connected" };
}
async function syncMetaTrader(connectionKey) {
  const stored = connectionStore.get(connectionKey);
  if (!stored) {
    return {
      success: false,
      status: "disconnected",
      error: {
        code: "CONNECTION_UNAVAILABLE",
        message: "Session expired. Please reconnect the account."
      }
    };
  }
  const result = await runBridgeConnection(stored.credentials);
  if (!result.success) return result;
  return { ...result, connectionKey, status: "connected" };
}
function disconnectMetaTrader(connectionKey) {
  connectionStore.delete(connectionKey);
  if (process.env.MT5_TRADEBOT_API_URL) {
    void mt5TradebotDisconnect();
  }
}

// backend/server/routes/metatrader.ts
var metaTraderRouter = (0, import_express12.Router)();
var credentialsSchema = import_zod7.z.object({
  version: import_zod7.z.enum(["mt4", "mt5"]),
  server: import_zod7.z.string().trim().min(1),
  login: import_zod7.z.string().trim().min(1),
  password: import_zod7.z.string().min(1),
  accountType: import_zod7.z.enum(["live", "demo"]),
  passwordType: import_zod7.z.enum(["master", "investor"])
});
metaTraderRouter.post("/connect", async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      status: "failed",
      error: {
        code: "INVALID_PAYLOAD",
        message: "Invalid MetaTrader connection details.",
        details: parsed.error.flatten()
      }
    });
    return;
  }
  try {
    const result = await connectMetaTrader(parsed.data);
    res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      status: "failed",
      error: {
        code: "FAILED_TO_CONNECT",
        message: "Unexpected MetaTrader connection failure.",
        details: error instanceof Error ? error.message : String(error)
      }
    });
  }
});
metaTraderRouter.post("/sync", async (req, res) => {
  const parsed = import_zod7.z.object({ connectionKey: import_zod7.z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      status: "failed",
      error: {
        code: "INVALID_PAYLOAD",
        message: "A MetaTrader connection key is required.",
        details: parsed.error.flatten()
      }
    });
    return;
  }
  try {
    const result = await syncMetaTrader(parsed.data.connectionKey);
    res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      status: "failed",
      error: {
        code: "FAILED_TO_CONNECT",
        message: "Unexpected MetaTrader sync failure.",
        details: error instanceof Error ? error.message : String(error)
      }
    });
  }
});
metaTraderRouter.post("/disconnect", (req, res) => {
  const parsed = import_zod7.z.object({ connectionKey: import_zod7.z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      status: "failed",
      error: {
        code: "INVALID_PAYLOAD",
        message: "A MetaTrader connection key is required.",
        details: parsed.error.flatten()
      }
    });
    return;
  }
  disconnectMetaTrader(parsed.data.connectionKey);
  res.json({ success: true, status: "disconnected" });
});
metaTraderRouter.get("/bridge-status", async (_req, res) => {
  const status = getBridgeStatus();
  res.status(status.ready ? 200 : 503).json(status);
});
metaTraderRouter.get("/health", async (_req, res) => {
  const status = getBridgeStatus();
  res.status(status.ready ? 200 : 503).json({
    healthy: status.ready,
    message: status.message,
    provider: status.provider
  });
});
metaTraderRouter.post("/test-connection", async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      status: "failed",
      error: {
        code: "INVALID_PAYLOAD",
        message: "Invalid MetaTrader connection details.",
        details: parsed.error.flatten()
      }
    });
    return;
  }
  try {
    const result = await connectMetaTrader(parsed.data);
    res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      status: "failed",
      error: {
        code: "FAILED_TO_CONNECT",
        message: "Unexpected MetaTrader connection failure.",
        details: error instanceof Error ? error.message : String(error)
      }
    });
  }
});
metaTraderRouter.get("/symbols", async (_req, res) => {
  try {
    const symbols = await mt5GetSymbols();
    res.json({ success: true, symbols });
  } catch (err) {
    res.status(500).json({ success: false, message: err instanceof Error ? err.message : String(err) });
  }
});
metaTraderRouter.get("/tick/:symbol", async (req, res) => {
  try {
    const tick = await mt5GetTick(req.params.symbol);
    res.json({ success: true, tick });
  } catch (err) {
    res.status(404).json({ success: false, message: err instanceof Error ? err.message : String(err) });
  }
});
var historicalSchema = import_zod7.z.object({
  symbol: import_zod7.z.string().min(1),
  timeframe: import_zod7.z.string().min(1),
  startDate: import_zod7.z.string().min(1),
  endDate: import_zod7.z.string().min(1)
});
metaTraderRouter.post("/historical-data", async (req, res) => {
  const parsed = historicalSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: "Invalid payload", details: parsed.error.flatten() });
    return;
  }
  try {
    const { symbol, timeframe, startDate, endDate } = parsed.data;
    const bars = await mt5GetHistoricalData(symbol, timeframe, startDate, endDate);
    res.json({ success: true, bars });
  } catch (err) {
    res.status(500).json({ success: false, message: err instanceof Error ? err.message : String(err) });
  }
});
var placeOrderSchema = import_zod7.z.object({
  symbol: import_zod7.z.string().min(1),
  order_type: import_zod7.z.enum(["buy", "sell", "buy_limit", "sell_limit", "buy_stop", "sell_stop"]),
  volume: import_zod7.z.number().positive(),
  price: import_zod7.z.number().optional(),
  sl: import_zod7.z.number().optional(),
  tp: import_zod7.z.number().optional(),
  comment: import_zod7.z.string().optional(),
  magic: import_zod7.z.number().optional()
});
metaTraderRouter.post("/order/place", (_req, res) => {
  res.status(403).json({ success: false, message: "Trade execution is disabled. This dashboard is read-only. Place trades from your MT5 app." });
});
metaTraderRouter.post("/position/close/:positionId", (_req, res) => {
  res.status(403).json({ success: false, message: "Trade execution is disabled. This dashboard is read-only. Close positions from your MT5 app." });
});

// backend/server/routes/ctrader.ts
var import_express13 = require("express");
var import_zod8 = require("zod");

// backend/server/services/ctrader.service.ts
var CTRADER_BASE = "https://api.spotware.com/connect";
var TIMEOUT_MS2 = 3e4;
var connectionStore2 = /* @__PURE__ */ new Map();
function buildConnectionKey2(accountId) {
  return `ctrader:${accountId}`;
}
async function ctFetch(path4, token) {
  const res = await fetch(`${CTRADER_BASE}${path4}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    signal: AbortSignal.timeout(TIMEOUT_MS2)
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { message: `HTTP ${res.status}: ${text.slice(0, 100)}` };
  }
  return { ok: res.ok, status: res.status, data };
}
function mapPosition(p) {
  return {
    positionId: String(p.positionId),
    symbol: p.symbolName,
    type: p.tradeSide === "SELL" ? "sell" : "buy",
    volume: p.volume / 100,
    profit: p.unrealizedGrossProfit / 100,
    openPrice: p.price,
    currentPrice: p.currentPrice ?? p.price,
    openedAt: new Date(p.utcLastUpdateTimestamp).toISOString()
  };
}
function mapDeal(d) {
  return {
    dealId: String(d.dealId),
    positionId: String(d.positionId),
    symbol: d.symbolName,
    type: d.tradeSide === "SELL" ? "sell" : "buy",
    volume: d.filledVolume / 100,
    price: d.executionPrice,
    profit: (d.closePositionDetail?.grossProfit ?? d.grossProfit) / 100,
    commission: d.commission / 100,
    swap: d.swap / 100,
    closedAt: new Date(d.utcLastUpdateTimestamp).toISOString(),
    comment: d.comment ?? ""
  };
}
async function fetchAccountInfo(token, accountId) {
  const res = await ctFetch(`/tradingaccounts/${accountId}`, token);
  return res.ok ? res.data : null;
}
async function fetchPositions(token, accountId) {
  const res = await ctFetch(`/tradingaccounts/${accountId}/positions`, token);
  if (!res.ok) return [];
  return (res.data.position ?? []).map(mapPosition);
}
async function fetchDeals(token, accountId) {
  const from = Date.now() - 90 * 24 * 3600 * 1e3;
  const to = Date.now();
  const res = await ctFetch(
    `/tradingaccounts/${accountId}/deals?from=${from}&to=${to}&limit=500`,
    token
  );
  if (!res.ok) return [];
  return (res.data.deal ?? []).map(mapDeal);
}
async function connectCTrader(creds) {
  try {
    const info = await fetchAccountInfo(creds.accessToken, creds.accountId);
    if (!info) {
      return {
        success: false,
        error: {
          code: "INVALID_CREDENTIALS",
          message: "Could not retrieve account info. Check your Access Token and Account ID."
        }
      };
    }
    const [positions, history] = await Promise.all([
      fetchPositions(creds.accessToken, creds.accountId),
      fetchDeals(creds.accessToken, creds.accountId)
    ]);
    const account = {
      accountId: String(info.accountId),
      accountNumber: String(info.accountNumber),
      brokerName: info.brokerName,
      traderName: info.traderName,
      balance: info.balance / 100,
      equity: info.equity / 100,
      currency: info.currency,
      leverage: info.leverage,
      isDemo: !info.isLive
    };
    const connectionKey = buildConnectionKey2(creds.accountId);
    connectionStore2.set(connectionKey, { credentials: creds, connectedAt: (/* @__PURE__ */ new Date()).toISOString() });
    return { success: true, connectionKey, account, positions, history };
  } catch (err) {
    return {
      success: false,
      error: {
        code: "CONNECTION_FAILED",
        message: err instanceof Error ? err.message : "Unexpected error connecting to cTrader."
      }
    };
  }
}
async function syncCTrader(connectionKey) {
  const stored = connectionStore2.get(connectionKey);
  if (!stored) {
    return {
      success: false,
      error: { code: "SESSION_EXPIRED", message: "Session expired. Please reconnect the account." }
    };
  }
  return connectCTrader(stored.credentials);
}
function disconnectCTrader(connectionKey) {
  connectionStore2.delete(connectionKey);
}

// backend/server/routes/ctrader.ts
var ctraderRouter = (0, import_express13.Router)();
var credentialsSchema2 = import_zod8.z.object({
  clientId: import_zod8.z.string().trim().min(1),
  clientSecret: import_zod8.z.string().trim().min(1),
  accessToken: import_zod8.z.string().trim().min(1),
  accountId: import_zod8.z.string().trim().min(1)
});
ctraderRouter.post("/connect", async (req, res) => {
  const parsed = credentialsSchema2.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_PAYLOAD", message: "Invalid cTrader credentials.", details: parsed.error.flatten() }
    });
    return;
  }
  try {
    const result = await connectCTrader(parsed.data);
    res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: { code: "CONNECTION_FAILED", message: error instanceof Error ? error.message : "Unexpected error." }
    });
  }
});
ctraderRouter.post("/sync", async (req, res) => {
  const parsed = import_zod8.z.object({ connectionKey: import_zod8.z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: "INVALID_PAYLOAD", message: "Connection key required." } });
    return;
  }
  try {
    const result = await syncCTrader(parsed.data.connectionKey);
    res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: { code: "SYNC_FAILED", message: error instanceof Error ? error.message : "Unexpected error." }
    });
  }
});
ctraderRouter.post("/disconnect", (req, res) => {
  const parsed = import_zod8.z.object({ connectionKey: import_zod8.z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: "INVALID_PAYLOAD", message: "Connection key required." } });
    return;
  }
  disconnectCTrader(parsed.data.connectionKey);
  res.json({ success: true });
});

// backend/server/routes/saxo.ts
var import_express14 = require("express");
var import_zod9 = require("zod");

// backend/server/services/saxo.service.ts
var SIM_BASE = "https://gateway.saxobank.com/sim/openapi";
var LIVE_BASE = "https://gateway.saxobank.com/openapi";
var TIMEOUT_MS3 = 3e4;
var connectionStore3 = /* @__PURE__ */ new Map();
function base(env) {
  return env === "live" ? LIVE_BASE : SIM_BASE;
}
async function saxoFetch(path4, token, env) {
  const res = await fetch(`${base(env)}${path4}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    signal: AbortSignal.timeout(TIMEOUT_MS3)
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { message: `HTTP ${res.status}: ${text.slice(0, 200)}` };
  }
  return { ok: res.ok, status: res.status, data };
}
function buildConnectionKey3(accountKey, env) {
  return `saxo:${env}:${accountKey}`;
}
function mapPosition2(raw) {
  const base2 = raw.PositionBase;
  const view = raw.PositionView;
  if (!base2 || !raw.PositionId) return null;
  const symbol = raw.DisplayAndFormat?.Symbol ?? raw.DisplayAndFormat?.Description ?? "UNKNOWN";
  return {
    positionId: raw.PositionId,
    symbol,
    type: base2.BuySell?.toLowerCase() === "sell" ? "sell" : "buy",
    amount: base2.Amount ?? 0,
    profit: view?.ProfitLossOnTrade ?? 0,
    openPrice: base2.OpenPrice ?? 0,
    currentPrice: view?.CurrentPrice ?? base2.OpenPrice ?? 0,
    openedAt: base2.OpenDateTime ?? (/* @__PURE__ */ new Date()).toISOString()
  };
}
function mapClosedPosition(raw) {
  const cp = raw.ClosedPosition;
  if (!cp) return null;
  const symbol = raw.DisplayAndFormat?.Symbol ?? raw.DisplayAndFormat?.Description ?? "UNKNOWN";
  const tradeId = raw.TradeId ?? raw.ClosedPositionUniqueId ?? crypto.randomUUID();
  return {
    tradeId,
    symbol,
    type: cp.BuySell?.toLowerCase() === "sell" ? "sell" : "buy",
    amount: cp.Amount ?? 0,
    openPrice: cp.OpenPrice ?? 0,
    closePrice: cp.ClosingPrice ?? 0,
    profit: cp.ProfitLoss ?? 0,
    commission: cp.Commission ?? 0,
    openedAt: cp.OpenDateTime ?? (/* @__PURE__ */ new Date()).toISOString(),
    closedAt: cp.CloseDateTime ?? (/* @__PURE__ */ new Date()).toISOString()
  };
}
async function fetchAccountData(creds) {
  const { accessToken, environment } = creds;
  const env = environment ?? "sim";
  const meRes = await saxoFetch("/port/v1/users/me", accessToken, env);
  if (!meRes.ok) {
    return {
      success: false,
      error: {
        code: meRes.status === 401 ? "UNAUTHORIZED" : "AUTH_FAILED",
        message: meRes.status === 401 ? "Access token is invalid or expired. Generate a new token from developer.saxo.com." : `Failed to authenticate with Saxo (${meRes.status}).`
      }
    };
  }
  const clientKey = meRes.data.ClientKey;
  const accsRes = await saxoFetch(`/port/v1/accounts?ClientKey=${clientKey}`, accessToken, env);
  if (!accsRes.ok || !accsRes.data.Data?.length) {
    return { success: false, error: { code: "NO_ACCOUNTS", message: "No accounts found for this Saxo client." } };
  }
  const accounts = accsRes.data.Data;
  const target = creds.accountKey ? accounts.find((a) => a.AccountKey === creds.accountKey || a.AccountId === creds.accountKey) : accounts[0];
  if (!target) {
    return { success: false, error: { code: "ACCOUNT_NOT_FOUND", message: `Account ${creds.accountKey} not found.` } };
  }
  const balRes = await saxoFetch(
    `/port/v1/balances?AccountKey=${target.AccountKey}&ClientKey=${clientKey}`,
    accessToken,
    env
  );
  const bal = balRes.ok ? balRes.data : {};
  const balance = bal.TotalValue ?? 0;
  const equity = bal.NetEquityForMargin ?? balance;
  const unrealisedPnl = bal.UnrealizedPositionsValue ?? 0;
  const marginUsed = bal.MarginUsedByCurrentPositions ?? 0;
  const account = {
    accountKey: target.AccountKey,
    accountId: target.AccountId,
    clientKey,
    displayName: target.DisplayName ?? meRes.data.Name ?? target.AccountId,
    currency: target.Currency,
    balance,
    equity,
    unrealisedPnl,
    marginUsed,
    leverage: 0,
    isDemo: env === "sim"
  };
  const posRes = await saxoFetch(
    `/port/v1/positions?AccountKey=${target.AccountKey}&ClientKey=${clientKey}&FieldGroups=PositionBase,PositionView,DisplayAndFormat`,
    accessToken,
    env
  );
  const positions = (posRes.ok ? posRes.data.Data ?? [] : []).map(mapPosition2).filter((p) => p !== null);
  const from = new Date(Date.now() - 90 * 864e5).toISOString();
  const cpRes = await saxoFetch(
    `/port/v1/closedpositions?AccountKey=${target.AccountKey}&ClientKey=${clientKey}&FromDateTime=${from}&FieldGroups=ClosedPosition,DisplayAndFormat`,
    accessToken,
    env
  );
  const history = (cpRes.ok ? cpRes.data.Data ?? [] : []).map(mapClosedPosition).filter((t) => t !== null);
  return { success: true, account, positions, history };
}
async function connectSaxo(creds) {
  const result = await fetchAccountData(creds);
  if (!result.success || !result.account) return result;
  const key = buildConnectionKey3(result.account.accountKey, creds.environment);
  connectionStore3.set(key, { credentials: creds, connectedAt: (/* @__PURE__ */ new Date()).toISOString() });
  return { ...result, connectionKey: key };
}
async function syncSaxo(connectionKey) {
  const stored = connectionStore3.get(connectionKey);
  if (!stored) {
    return { success: false, error: { code: "NOT_CONNECTED", message: "Saxo session not found. Please reconnect the account." } };
  }
  const result = await fetchAccountData(stored.credentials);
  if (result.success) {
    connectionStore3.set(connectionKey, { ...stored, credentials: stored.credentials });
  }
  return { ...result, connectionKey };
}
function disconnectSaxo(connectionKey) {
  connectionStore3.delete(connectionKey);
}

// backend/server/routes/saxo.ts
var saxoRouter = (0, import_express14.Router)();
var credentialsSchema3 = import_zod9.z.object({
  accessToken: import_zod9.z.string().trim().min(1),
  accountKey: import_zod9.z.string().trim().optional(),
  environment: import_zod9.z.enum(["sim", "live"]).default("sim")
});
saxoRouter.post("/connect", async (req, res) => {
  const parsed = credentialsSchema3.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "INVALID_PAYLOAD", message: "Invalid Saxo credentials.", details: parsed.error.flatten() }
    });
    return;
  }
  try {
    const result = await connectSaxo(parsed.data);
    res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: { code: "CONNECTION_FAILED", message: error instanceof Error ? error.message : "Unexpected error." }
    });
  }
});
saxoRouter.post("/sync", async (req, res) => {
  const parsed = import_zod9.z.object({ connectionKey: import_zod9.z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: "INVALID_PAYLOAD", message: "Connection key required." } });
    return;
  }
  try {
    const result = await syncSaxo(parsed.data.connectionKey);
    res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: { code: "SYNC_FAILED", message: error instanceof Error ? error.message : "Unexpected error." }
    });
  }
});
saxoRouter.post("/disconnect", (req, res) => {
  const parsed = import_zod9.z.object({ connectionKey: import_zod9.z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: "INVALID_PAYLOAD", message: "Connection key required." } });
    return;
  }
  disconnectSaxo(parsed.data.connectionKey);
  res.json({ success: true });
});

// backend/server/routes/mt5Tracking.ts
var import_express15 = require("express");
var import_zod10 = require("zod");
var mt5TrackingRouter = (0, import_express15.Router)();
mt5TrackingRouter.get("/accounts", async (req, res) => {
  const userId2 = req.query.userId;
  if (!userId2) {
    res.status(400).json({ error: "userId required" });
    return;
  }
  const { data, error } = await supabase.from("mt5_connected_accounts").select("*").eq("userId", userId2).order("createdAt", { ascending: false });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data ?? []);
});
mt5TrackingRouter.get("/accounts/:accountId", async (req, res) => {
  const { data, error } = await supabase.from("mt5_connected_accounts").select("*").eq("id", req.params.accountId).single();
  if (error || !data) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  res.json(data);
});
mt5TrackingRouter.get("/accounts/:accountId/positions", async (req, res) => {
  const { data, error } = await supabase.from("mt5_open_positions").select("*").eq("accountId", req.params.accountId).order("openTime", { ascending: false });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data ?? []);
});
mt5TrackingRouter.get("/accounts/:accountId/trades", async (req, res) => {
  const { limit = "100", offset = "0", symbol } = req.query;
  const take = Math.min(Number(limit), 500);
  const skip = Number(offset);
  let query2 = supabase.from("mt5_trades").select("*").eq("accountId", req.params.accountId).order("closeTime", { ascending: false }).range(skip, skip + take - 1);
  if (symbol) query2 = query2.eq("symbol", symbol);
  const { data, error } = await query2;
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json(data ?? []);
});
mt5TrackingRouter.get("/accounts/:accountId/equity", async (req, res) => {
  const { limit = "200" } = req.query;
  const take = Math.min(Number(limit), 1e3);
  const { data, error } = await supabase.from("mt5_equity_snapshots").select("*").eq("accountId", req.params.accountId).order("recordedAt", { ascending: false }).limit(take);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json((data ?? []).reverse());
});
mt5TrackingRouter.get("/accounts/:accountId/stats", async (req, res) => {
  const { accountId } = req.params;
  const [tradesResult, equityResult] = await Promise.all([
    supabase.from("mt5_trades").select("*").eq("accountId", accountId),
    supabase.from("mt5_equity_snapshots").select("*").eq("accountId", accountId).order("recordedAt", { ascending: false }).limit(1).maybeSingle()
  ]);
  const trades = tradesResult.data ?? [];
  const latestEquity = equityResult.data;
  const closed = trades.filter((t) => t.closePrice != null);
  const wins = closed.filter((t) => t.profit > 0);
  const losses = closed.filter((t) => t.profit < 0);
  const totalPnl = closed.reduce((s, t) => s + t.profit, 0);
  const grossWin = wins.reduce((s, t) => s + t.profit, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.profit, 0));
  const winRate = closed.length ? wins.length / closed.length : 0;
  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  let profitFactor;
  if (grossLoss > 0) {
    profitFactor = grossWin / grossLoss;
  } else if (grossWin > 0) {
    profitFactor = Infinity;
  } else {
    profitFactor = 0;
  }
  res.json({
    totalTrades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: Math.round(winRate * 1e4) / 100,
    totalPnl: Math.round(totalPnl * 100) / 100,
    avgWin: Math.round(avgWin * 100) / 100,
    avgLoss: Math.round(avgLoss * 100) / 100,
    profitFactor: Math.round(profitFactor * 100) / 100,
    balance: latestEquity?.balance ?? null,
    equity: latestEquity?.equity ?? null,
    lastSyncedAt: latestEquity?.recordedAt ?? null
  });
});
var createAccountSchema = import_zod10.z.object({
  userId: import_zod10.z.string().min(1),
  brokerName: import_zod10.z.string().default(""),
  accountLogin: import_zod10.z.string().min(1),
  serverName: import_zod10.z.string().min(1),
  accountType: import_zod10.z.enum(["demo", "live"]).default("demo")
});
mt5TrackingRouter.post("/accounts", async (req, res) => {
  const parsed = createAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const { data, error } = await supabase.from("mt5_connected_accounts").upsert(
      { ...parsed.data, status: "disconnected" },
      { onConflict: "userId,accountLogin,serverName" }
    ).select().single();
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// backend/server/routes/tradingAccounts.ts
var import_express16 = require("express");
var import_zod11 = require("zod");
var tradingAccountsRouter = (0, import_express16.Router)();
var accountStatusSchema = import_zod11.z.enum([
  "connected",
  "connecting",
  "error",
  "failed",
  "pending",
  "unavailable",
  "invalid_credentials",
  "disconnected",
  "syncing",
  "demo"
]);
var accountSchema = import_zod11.z.object({
  id: import_zod11.z.string().uuid(),
  userId: import_zod11.z.string().uuid(),
  name: import_zod11.z.string().min(1),
  broker: import_zod11.z.string().default(""),
  platform: import_zod11.z.string().min(1),
  metatraderVersion: import_zod11.z.enum(["mt4", "mt5"]).optional().nullable(),
  mt5AccountNumber: import_zod11.z.string().optional().nullable(),
  mt5Server: import_zod11.z.string().optional().nullable(),
  mtConnectionKey: import_zod11.z.string().optional().nullable(),
  onboardingMode: import_zod11.z.enum(["connect_existing", "create_demo"]).optional().nullable(),
  ctraderAccountId: import_zod11.z.string().optional().nullable(),
  ctraderConnectionKey: import_zod11.z.string().optional().nullable(),
  saxoAccountKey: import_zod11.z.string().optional().nullable(),
  saxoConnectionKey: import_zod11.z.string().optional().nullable(),
  saxoEnvironment: import_zod11.z.enum(["sim", "live"]).optional().nullable(),
  accountType: import_zod11.z.enum(["demo", "live", "prop"]),
  accountSubType: import_zod11.z.enum(["live", "demo", "prop_challenge", "funded"]),
  sourceType: import_zod11.z.enum(["manual", "csv", "mt4", "mt5", "ctrader", "saxo", "tradingview", "broker_api", "demo"]),
  currency: import_zod11.z.string().default("USD"),
  startingBalance: import_zod11.z.number(),
  currentBalance: import_zod11.z.number(),
  equity: import_zod11.z.number(),
  leverage: import_zod11.z.number().int().optional().nullable(),
  margin: import_zod11.z.number().optional().nullable(),
  freeMargin: import_zod11.z.number().optional().nullable(),
  lastConnectionError: import_zod11.z.string().optional().nullable(),
  lastConnectionDetails: import_zod11.z.record(import_zod11.z.string(), import_zod11.z.unknown()).optional().nullable(),
  propFirmName: import_zod11.z.string().optional().nullable(),
  maxDailyLossPercent: import_zod11.z.number().optional().nullable(),
  maxTotalDrawdownPercent: import_zod11.z.number().optional().nullable(),
  notes: import_zod11.z.string().optional().nullable(),
  autoJournalingEnabled: import_zod11.z.boolean(),
  status: accountStatusSchema,
  connectedAt: import_zod11.z.string().datetime().optional().nullable(),
  lastCheckedAt: import_zod11.z.string().datetime().optional().nullable(),
  lastSyncAt: import_zod11.z.string().datetime().optional().nullable(),
  totalImportedTrades: import_zod11.z.number().int(),
  openPositions: import_zod11.z.number().int(),
  todayPnl: import_zod11.z.number(),
  weeklyPnl: import_zod11.z.number(),
  closedTrades: import_zod11.z.number().int().optional().nullable(),
  onboardingSummary: import_zod11.z.string().optional().nullable(),
  autoHealingEnabled: import_zod11.z.boolean().optional().nullable(),
  serviceDiagnostics: import_zod11.z.record(import_zod11.z.string(), import_zod11.z.unknown()).optional().nullable(),
  openTradesPreview: import_zod11.z.array(import_zod11.z.record(import_zod11.z.string(), import_zod11.z.unknown())).optional().nullable(),
  createdAt: import_zod11.z.string().datetime(),
  updatedAt: import_zod11.z.string().datetime()
});
function toRow2(account) {
  const row = {
    id: account.id,
    user_id: account.userId,
    name: account.name,
    broker: account.broker,
    platform: account.platform,
    metatrader_version: account.metatraderVersion ?? null,
    mt5_account_number: account.mt5AccountNumber ?? null,
    mt5_server: account.mt5Server ?? null,
    mt_connection_key: account.mtConnectionKey ?? null,
    ctrader_account_id: account.ctraderAccountId ?? null,
    ctrader_connection_key: account.ctraderConnectionKey ?? null,
    saxo_account_key: account.saxoAccountKey ?? null,
    saxo_connection_key: account.saxoConnectionKey ?? null,
    saxo_environment: account.saxoEnvironment ?? null,
    account_type: account.accountType,
    account_sub_type: account.accountSubType,
    source_type: account.sourceType,
    currency: account.currency,
    starting_balance: account.startingBalance,
    current_balance: account.currentBalance,
    equity: account.equity,
    leverage: account.leverage ?? null,
    last_connection_error: account.lastConnectionError ?? null,
    last_connection_details: account.lastConnectionDetails ?? null,
    prop_firm_name: account.propFirmName ?? null,
    max_daily_loss_percent: account.maxDailyLossPercent ?? null,
    max_total_drawdown_percent: account.maxTotalDrawdownPercent ?? null,
    notes: account.notes ?? null,
    auto_journaling_enabled: account.autoJournalingEnabled,
    status: account.status,
    last_checked_at: account.lastCheckedAt ?? null,
    last_sync_at: account.lastSyncAt ?? null,
    total_imported_trades: account.totalImportedTrades,
    open_positions: account.openPositions,
    today_pnl: account.todayPnl,
    weekly_pnl: account.weeklyPnl,
    open_trades_preview: account.openTradesPreview ?? null,
    created_at: account.createdAt,
    updated_at: account.updatedAt
  };
  if (account.onboardingMode != null) row.onboarding_mode = account.onboardingMode;
  if (account.margin != null) row.margin = account.margin;
  if (account.freeMargin != null) row.free_margin = account.freeMargin;
  if (account.connectedAt != null) row.connected_at = account.connectedAt;
  if (account.closedTrades != null) row.closed_trades = account.closedTrades;
  if (account.onboardingSummary != null) row.onboarding_summary = account.onboardingSummary;
  if (account.autoHealingEnabled != null) row.auto_healing_enabled = account.autoHealingEnabled;
  if (account.serviceDiagnostics != null) row.service_diagnostics = account.serviceDiagnostics;
  return row;
}
function toResponse(row) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    broker: row.broker,
    platform: row.platform,
    metatraderVersion: row.metatrader_version,
    mt5AccountNumber: row.mt5_account_number,
    mt5Server: row.mt5_server,
    mtConnectionKey: row.mt_connection_key,
    onboardingMode: row.onboarding_mode,
    ctraderAccountId: row.ctrader_account_id,
    ctraderConnectionKey: row.ctrader_connection_key,
    saxoAccountKey: row.saxo_account_key,
    saxoConnectionKey: row.saxo_connection_key,
    saxoEnvironment: row.saxo_environment,
    accountType: row.account_type,
    accountSubType: row.account_sub_type,
    sourceType: row.source_type,
    currency: row.currency,
    startingBalance: Number(row.starting_balance ?? 0),
    currentBalance: Number(row.current_balance ?? 0),
    equity: Number(row.equity ?? 0),
    leverage: typeof row.leverage === "number" ? row.leverage : row.leverage ? Number(row.leverage) : void 0,
    margin: typeof row.margin === "number" ? row.margin : row.margin ? Number(row.margin) : null,
    freeMargin: typeof row.free_margin === "number" ? row.free_margin : row.free_margin ? Number(row.free_margin) : null,
    lastConnectionError: row.last_connection_error,
    lastConnectionDetails: row.last_connection_details,
    propFirmName: row.prop_firm_name,
    maxDailyLossPercent: row.max_daily_loss_percent ? Number(row.max_daily_loss_percent) : void 0,
    maxTotalDrawdownPercent: row.max_total_drawdown_percent ? Number(row.max_total_drawdown_percent) : void 0,
    notes: row.notes,
    autoJournalingEnabled: Boolean(row.auto_journaling_enabled),
    status: row.status,
    connectedAt: row.connected_at,
    lastCheckedAt: row.last_checked_at,
    lastSyncAt: row.last_sync_at,
    totalImportedTrades: Number(row.total_imported_trades ?? 0),
    openPositions: Number(row.open_positions ?? 0),
    todayPnl: Number(row.today_pnl ?? 0),
    weeklyPnl: Number(row.weekly_pnl ?? 0),
    closedTrades: row.closed_trades != null ? Number(row.closed_trades) : void 0,
    onboardingSummary: typeof row.onboarding_summary === "string" ? row.onboarding_summary : void 0,
    autoHealingEnabled: row.auto_healing_enabled == null ? void 0 : Boolean(row.auto_healing_enabled),
    serviceDiagnostics: row.service_diagnostics,
    openTradesPreview: row.open_trades_preview,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
tradingAccountsRouter.get("/", async (req, res) => {
  const userId2 = req.query.userId;
  if (!userId2) {
    res.status(400).json({ error: "userId required" });
    return;
  }
  const { data, error } = await supabase.from("trading_accounts").select("*").eq("user_id", userId2).order("created_at", { ascending: false });
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json((data ?? []).map((row) => toResponse(row)));
});
tradingAccountsRouter.post("/", async (req, res) => {
  const parsed = accountSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { data, error } = await supabase.from("trading_accounts").upsert(toRow2(parsed.data), { onConflict: "id" }).select("*").single();
  if (error || !data) {
    res.status(500).json({ error: error?.message ?? "Failed to save trading account." });
    return;
  }
  res.json(toResponse(data));
});
tradingAccountsRouter.patch("/:accountId", async (req, res) => {
  const parsed = accountSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const row = toRow2({
    id: req.params.accountId,
    userId: parsed.data.userId ?? "",
    name: parsed.data.name ?? "",
    broker: parsed.data.broker ?? "",
    platform: parsed.data.platform ?? "",
    metatraderVersion: parsed.data.metatraderVersion,
    mt5AccountNumber: parsed.data.mt5AccountNumber,
    mt5Server: parsed.data.mt5Server,
    mtConnectionKey: parsed.data.mtConnectionKey,
    onboardingMode: parsed.data.onboardingMode,
    ctraderAccountId: parsed.data.ctraderAccountId,
    ctraderConnectionKey: parsed.data.ctraderConnectionKey,
    saxoAccountKey: parsed.data.saxoAccountKey,
    saxoConnectionKey: parsed.data.saxoConnectionKey,
    saxoEnvironment: parsed.data.saxoEnvironment,
    accountType: parsed.data.accountType ?? "live",
    accountSubType: parsed.data.accountSubType ?? "live",
    sourceType: parsed.data.sourceType ?? "manual",
    currency: parsed.data.currency ?? "USD",
    startingBalance: parsed.data.startingBalance ?? 0,
    currentBalance: parsed.data.currentBalance ?? 0,
    equity: parsed.data.equity ?? 0,
    leverage: parsed.data.leverage,
    margin: parsed.data.margin,
    freeMargin: parsed.data.freeMargin,
    lastConnectionError: parsed.data.lastConnectionError,
    lastConnectionDetails: parsed.data.lastConnectionDetails,
    propFirmName: parsed.data.propFirmName,
    maxDailyLossPercent: parsed.data.maxDailyLossPercent,
    maxTotalDrawdownPercent: parsed.data.maxTotalDrawdownPercent,
    notes: parsed.data.notes,
    autoJournalingEnabled: parsed.data.autoJournalingEnabled ?? false,
    status: parsed.data.status ?? "pending",
    connectedAt: parsed.data.connectedAt,
    lastCheckedAt: parsed.data.lastCheckedAt,
    lastSyncAt: parsed.data.lastSyncAt,
    totalImportedTrades: parsed.data.totalImportedTrades ?? 0,
    openPositions: parsed.data.openPositions ?? 0,
    todayPnl: parsed.data.todayPnl ?? 0,
    weeklyPnl: parsed.data.weeklyPnl ?? 0,
    closedTrades: parsed.data.closedTrades,
    onboardingSummary: parsed.data.onboardingSummary,
    autoHealingEnabled: parsed.data.autoHealingEnabled,
    serviceDiagnostics: parsed.data.serviceDiagnostics,
    openTradesPreview: parsed.data.openTradesPreview,
    createdAt: parsed.data.createdAt ?? (/* @__PURE__ */ new Date()).toISOString(),
    updatedAt: parsed.data.updatedAt ?? (/* @__PURE__ */ new Date()).toISOString()
  });
  const updates = Object.fromEntries(Object.entries(row).filter(([, value]) => value !== "" && value !== void 0));
  delete updates.id;
  delete updates.created_at;
  const { data, error } = await supabase.from("trading_accounts").update(updates).eq("id", req.params.accountId).select("*").single();
  if (error || !data) {
    res.status(500).json({ error: error?.message ?? "Failed to update trading account." });
    return;
  }
  res.json(toResponse(data));
});
tradingAccountsRouter.delete("/:accountId", async (req, res) => {
  const { error } = await supabase.from("trading_accounts").delete().eq("id", req.params.accountId);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ success: true });
});

// backend/server/routes/accountOnboarding.ts
var import_express17 = require("express");
var import_zod12 = require("zod");

// backend/server/lib/mt5BridgeClient.ts
var DEFAULT_TIMEOUT_MS = 15e3;
var DEFAULT_RETRY_ATTEMPTS = 3;
var RETRYABLE_STATUS_CODES = /* @__PURE__ */ new Set([408, 429, 502, 503, 504]);
var MT5BridgeHttpError = class extends Error {
  endpoint;
  status;
  responseBody;
  constructor(params) {
    super(params.message);
    this.name = "MT5BridgeHttpError";
    this.endpoint = params.endpoint;
    this.status = params.status;
    this.responseBody = params.responseBody;
  }
};
var MT5BridgeClient = class {
  baseUrl;
  apiKey;
  timeoutMs;
  retryAttempts;
  constructor() {
    this.baseUrl = resolveMt5BridgeBaseUrl() || null;
    this.apiKey = resolveMt5BridgeApiKey() || null;
    this.timeoutMs = Number(process.env.MT5_BRIDGE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
    this.retryAttempts = Number(process.env.MT5_BRIDGE_RETRY_ATTEMPTS ?? DEFAULT_RETRY_ATTEMPTS);
  }
  isConfigured() {
    return Boolean(this.baseUrl && this.apiKey);
  }
  getConfigSummary() {
    return {
      configured: this.isConfigured(),
      baseUrl: this.baseUrl,
      timeoutMs: this.timeoutMs,
      retryAttempts: this.retryAttempts,
      usesHeader: "x-api-key",
      auth: getMt5BridgeAuthDiagnostics(this.baseUrl)
    };
  }
  async get(path4, init = {}) {
    return this.request(path4, { ...init, method: "GET" });
  }
  async post(path4, body, init = {}) {
    return this.request(path4, {
      ...init,
      method: "POST",
      body: body === void 0 ? init.body : JSON.stringify(body)
    });
  }
  async request(path4, init = {}) {
    if (!this.baseUrl || !this.apiKey) {
      throw new Error("MT5 bridge is not configured. Set MT5_BRIDGE_URL and MT5_BRIDGE_API_KEY.");
    }
    const endpoint = `${this.baseUrl}${path4}`;
    console.info("[api-proxy] auth_config", getMt5BridgeAuthDiagnostics(endpoint));
    let lastError = null;
    for (let attempt = 1; attempt <= this.retryAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(endpoint, {
          ...init,
          signal: controller.signal,
          headers: {
            "x-api-key": this.apiKey,
            "Content-Type": "application/json",
            ...init.headers
          }
        });
        const bodyText = await response.text();
        if (!response.ok) {
          const error = this.buildHttpError(path4, response.status, bodyText);
          this.logFailure(path4, response.status, bodyText, attempt);
          if (attempt < this.retryAttempts && RETRYABLE_STATUS_CODES.has(response.status)) {
            lastError = error;
            await this.waitBeforeRetry(attempt);
            continue;
          }
          throw error;
        }
        if (!bodyText) return {};
        return JSON.parse(bodyText);
      } catch (error) {
        const normalizedError = this.normalizeTransportError(path4, error);
        const isRetryable = this.isRetryableTransportError(normalizedError);
        this.logFailure(path4, null, normalizedError.message, attempt);
        if (attempt < this.retryAttempts && isRetryable) {
          lastError = normalizedError;
          await this.waitBeforeRetry(attempt);
          continue;
        }
        throw normalizedError;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError ?? new Error(`MT5 bridge request failed for ${path4}.`);
  }
  buildHttpError(path4, status, responseBody) {
    const suffix = responseBody ? ` Response: ${responseBody}` : "";
    if (status === 401) {
      return new MT5BridgeHttpError({
        endpoint: path4,
        status,
        responseBody,
        message: `MT5 bridge unauthorized for ${path4}. Check MT5_BRIDGE_API_KEY.${suffix}`
      });
    }
    if (status === 403) {
      return new MT5BridgeHttpError({
        endpoint: path4,
        status,
        responseBody,
        message: `MT5 bridge forbidden for ${path4}. Access was denied.${suffix}`
      });
    }
    if (status === 404) {
      return new MT5BridgeHttpError({
        endpoint: path4,
        status,
        responseBody,
        message: `MT5 bridge endpoint not found for ${path4}.${suffix}`
      });
    }
    if (status >= 500) {
      return new MT5BridgeHttpError({
        endpoint: path4,
        status,
        responseBody,
        message: `MT5 bridge server error for ${path4} (HTTP ${status}).${suffix}`
      });
    }
    return new MT5BridgeHttpError({
      endpoint: path4,
      status,
      responseBody,
      message: `MT5 bridge request failed for ${path4} (HTTP ${status}).${suffix}`
    });
  }
  normalizeTransportError(path4, error) {
    if (error instanceof MT5BridgeHttpError) return error;
    if (error instanceof Error && error.name === "AbortError") {
      return new Error(`MT5 bridge request timed out for ${path4} after ${this.timeoutMs}ms.`);
    }
    if (error instanceof Error) {
      return new Error(`MT5 bridge network failure for ${path4}: ${error.message}`);
    }
    return new Error(`MT5 bridge network failure for ${path4}.`);
  }
  isRetryableTransportError(error) {
    return !(error instanceof MT5BridgeHttpError);
  }
  async waitBeforeRetry(attempt) {
    const delayMs = Math.min(250 * 2 ** (attempt - 1), 2e3);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  logFailure(path4, status, body, attempt) {
    const statusLabel = status == null ? "NETWORK_ERROR" : String(status);
    console.error("[mt5-bridge-client] request failed", {
      endpoint: path4,
      status: statusLabel,
      attempt,
      responseBody: body
    });
  }
};
var mt5BridgeClient = new MT5BridgeClient();

// backend/server/routes/accountOnboarding.ts
var accountOnboardingRouter = (0, import_express17.Router)();
var serviceStateSchema = import_zod12.z.enum(["connected", "connecting", "error", "disconnected", "unavailable"]);
var connectExistingSchema = import_zod12.z.object({
  broker: import_zod12.z.string().trim().min(1),
  platform: import_zod12.z.literal("MT5"),
  login: import_zod12.z.string().trim().min(1),
  password: import_zod12.z.string().min(1),
  server: import_zod12.z.string().trim().min(1)
});
var createDemoSchema = import_zod12.z.object({
  broker: import_zod12.z.enum(["Admirals", "XM", "ActivTrades", "Tickmill", "Pepperstone", "IC Markets", "FP Markets", "Eightcap"]),
  firstName: import_zod12.z.string().trim().min(1),
  lastName: import_zod12.z.string().trim().min(1),
  email: import_zod12.z.string().email(),
  country: import_zod12.z.string().trim().min(1),
  leverage: import_zod12.z.string().trim().min(1),
  startingBalance: import_zod12.z.number().positive().optional()
});
function serviceStatus(params) {
  return {
    state: params.state,
    label: params.label,
    message: params.message,
    updatedAt: params.updatedAt ?? (/* @__PURE__ */ new Date()).toISOString()
  };
}
async function getQuoteFeedStatus() {
  if (!mt5BridgeClient.isConfigured()) {
    return serviceStatus({
      state: "unavailable",
      label: "Quotes Not Updating",
      message: "MT5 bridge quote feed is not configured."
    });
  }
  try {
    await mt5BridgeClient.get("/quotes?symbols=XAUUSD");
    return serviceStatus({
      state: "connected",
      label: "Quotes Streaming",
      message: "MT5 bridge quote feed responded successfully."
    });
  } catch (error) {
    return serviceStatus({
      state: "error",
      label: "Quotes Not Updating",
      message: error instanceof Error ? error.message : "Failed to reach MT5 bridge quote feed."
    });
  }
}
function bridgeServiceStatus(now2) {
  const bridge = getBridgeStatus();
  if (bridge.ready) {
    return serviceStatus({
      state: "connected",
      label: "Bridge Connected",
      message: bridge.message,
      updatedAt: now2
    });
  }
  return serviceStatus({
    state: "error",
    label: "Bridge Disconnected",
    message: bridge.message,
    updatedAt: now2
  });
}
function metaApiServiceStatus(result, now2) {
  if (result.success) {
    return serviceStatus({
      state: "connected",
      label: "MetaApi Connected",
      message: "MetaApi account deployment and terminal connectivity succeeded.",
      updatedAt: now2
    });
  }
  return serviceStatus({
    state: "error",
    label: "MetaApi Error",
    message: result.error?.message ?? "MetaApi onboarding failed.",
    updatedAt: now2
  });
}
function heartbeatServiceStatus(success, now2, message) {
  return serviceStatus({
    state: success ? "connected" : "error",
    label: success ? "Heartbeat Active" : "Heartbeat Missing",
    message: success ? "Account synchronization heartbeat started." : message ?? "Account synchronization heartbeat could not be started.",
    updatedAt: now2
  });
}
function buildExistingAccountProcessSteps(params) {
  const errorDetail = params.connectResult.error?.message;
  const steps = [
    { key: "credentials", label: "Credentials sent securely to VPS", status: "completed" },
    {
      key: "metaapi",
      label: "VPS creates or connects a MetaApi account",
      status: params.success ? "completed" : "failed",
      detail: params.success ? "MetaApi account is ready." : errorDetail
    },
    {
      key: "bridge",
      label: "VPS deploys the MT5 bridge connection",
      status: params.success ? "completed" : "failed",
      detail: params.success ? "Bridge connection deployed." : errorDetail
    },
    {
      key: "terminal",
      label: "VPS verifies terminal connection",
      status: params.success ? "completed" : "failed",
      detail: params.success ? "Broker terminal responded successfully." : errorDetail
    },
    {
      key: "sync",
      label: "VPS starts account synchronization",
      status: params.success ? "completed" : "failed",
      detail: params.success ? "Open positions and history loaded." : errorDetail
    },
    {
      key: "journal",
      label: "VPS enables auto-journaling",
      status: params.success ? "completed" : "pending",
      detail: params.success ? "Auto-journaling can begin immediately." : "Will be enabled after a successful connection."
    },
    {
      key: "quotes",
      label: "VPS validates quote feed",
      status: params.quoteFeed.state === "connected" ? "completed" : "failed",
      detail: params.quoteFeed.message
    }
  ];
  return steps;
}
accountOnboardingRouter.post("/mt5/connect-existing", async (req, res) => {
  const parsed = connectExistingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Invalid existing account onboarding payload.",
      errors: parsed.error.flatten()
    });
    return;
  }
  const now2 = (/* @__PURE__ */ new Date()).toISOString();
  const connectResult = await connectMetaTrader({
    version: "mt5",
    server: parsed.data.server,
    login: parsed.data.login,
    password: parsed.data.password,
    accountType: "live",
    passwordType: "master"
  });
  const quoteFeed = await getQuoteFeedStatus();
  const bridgeStatus = bridgeServiceStatus(now2);
  const metaApiStatus = metaApiServiceStatus(connectResult, now2);
  const heartbeatStatus = heartbeatServiceStatus(connectResult.success, now2, connectResult.error?.message);
  const process2 = buildExistingAccountProcessSteps({
    success: connectResult.success,
    connectResult,
    quoteFeed
  });
  if (!connectResult.success || !connectResult.account) {
    res.status(400).json({
      success: false,
      status: "error",
      message: connectResult.error?.message ?? "Failed to connect the MT5 account.",
      process: process2,
      diagnostics: {
        bridgeStatus,
        metaApiStatus,
        quoteFeedStatus: quoteFeed,
        heartbeatStatus
      },
      autoHealingEnabled: true,
      lastSyncTime: null
    });
    return;
  }
  const account = connectResult.account;
  res.json({
    success: true,
    status: "connected",
    message: "Trading account connected and synchronized successfully.",
    process: process2,
    account: {
      broker: parsed.data.broker || account.broker,
      platform: "MT5",
      server: account.server,
      login: account.login,
      balance: account.balance,
      equity: account.equity,
      margin: null,
      freeMargin: null,
      leverage: account.leverage,
      accountNumber: account.login,
      connectedTime: now2,
      openPositions: connectResult.positions?.length ?? 0,
      closedTrades: connectResult.history?.filter((deal) => deal.entryType === 1 || deal.entryType == null).length ?? 0
    },
    diagnostics: {
      bridgeStatus,
      metaApiStatus,
      quoteFeedStatus: quoteFeed,
      heartbeatStatus
    },
    lastSyncTime: now2,
    autoHealingEnabled: true,
    connectionKey: connectResult.connectionKey,
    importedHistoryCount: connectResult.history?.length ?? 0
  });
});
accountOnboardingRouter.post("/mt5/create-demo", async (req, res) => {
  const parsed = createDemoSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Invalid demo account onboarding payload.",
      errors: parsed.error.flatten()
    });
    return;
  }
  const automationBaseUrl = process.env.MT5_VPS_AUTOMATION_URL?.replace(/\/$/, "") ?? "";
  const automationApiKey = process.env.MT5_VPS_AUTOMATION_API_KEY ?? "";
  if (!automationBaseUrl) {
    res.status(503).json({
      success: false,
      status: "error",
      message: "Demo account provisioning is not configured on the VPS yet. Set MT5_VPS_AUTOMATION_URL to enable broker demo creation.",
      process: [
        { key: "request", label: "Request sent to VPS", status: "failed", detail: "MT5_VPS_AUTOMATION_URL is missing." },
        { key: "provision", label: "VPS creates MT5 demo account", status: "pending" },
        { key: "bridge", label: "VPS installs and configures bridge connection", status: "pending" },
        { key: "sync", label: "VPS attaches synchronization and journaling", status: "pending" }
      ],
      diagnostics: {
        bridgeStatus: bridgeServiceStatus((/* @__PURE__ */ new Date()).toISOString()),
        metaApiStatus: serviceStatus({ state: "unavailable", label: "MetaApi Unavailable", message: "Demo broker onboarding endpoint is not configured." }),
        quoteFeedStatus: await getQuoteFeedStatus(),
        heartbeatStatus: serviceStatus({ state: "unavailable", label: "Heartbeat Missing", message: "No demo account heartbeat until provisioning is configured." })
      },
      autoHealingEnabled: true
    });
    return;
  }
  try {
    const response = await fetch(`${automationBaseUrl}/demo-account`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...automationApiKey ? { "x-api-key": automationApiKey } : {}
      },
      body: JSON.stringify(parsed.data)
    });
    const bodyText = await response.text();
    const payload = bodyText ? JSON.parse(bodyText) : {};
    if (!response.ok) {
      res.status(response.status).json({
        success: false,
        status: "error",
        message: typeof payload.message === "string" ? payload.message : `Demo account provisioning failed with HTTP ${response.status}.`,
        process: payload.process ?? [],
        diagnostics: payload.diagnostics ?? null,
        raw: payload
      });
      return;
    }
    res.json(payload);
  } catch (error) {
    res.status(502).json({
      success: false,
      status: "error",
      message: error instanceof Error ? error.message : "Failed to reach VPS automation service.",
      process: [
        { key: "request", label: "Request sent to VPS", status: "failed", detail: error instanceof Error ? error.message : "Network error" }
      ],
      diagnostics: {
        bridgeStatus: bridgeServiceStatus((/* @__PURE__ */ new Date()).toISOString()),
        metaApiStatus: serviceStatus({ state: "error", label: "MetaApi Error", message: "Failed to reach the VPS automation service." }),
        quoteFeedStatus: await getQuoteFeedStatus(),
        heartbeatStatus: serviceStatus({ state: "error", label: "Heartbeat Missing", message: "No provisioning heartbeat was returned." })
      },
      autoHealingEnabled: true
    });
  }
});

// backend/server/routes/fundamentals.ts
var import_express18 = require("express");

// backend/server/lib/finnhub.ts
var BASE3 = "https://finnhub.io/api/v1";
var COUNTRY_TO_CURRENCY4 = {
  US: "USD",
  EU: "EUR",
  EA: "EUR",
  EMU: "EUR",
  GB: "GBP",
  JP: "JPY",
  AU: "AUD",
  CA: "CAD",
  CH: "CHF",
  NZ: "NZD",
  CN: "CNY",
  HK: "HKD",
  SG: "SGD",
  NO: "NOK",
  SE: "SEK",
  DK: "DKK",
  MX: "MXN",
  ZA: "ZAR",
  TR: "TRY",
  BR: "BRL",
  IN: "INR",
  KR: "KRW",
  RU: "RUB",
  DE: "EUR",
  FR: "EUR",
  IT: "EUR",
  ES: "EUR",
  PT: "EUR"
};
var CURRENCY_FLAGS3 = {
  USD: "\u{1F1FA}\u{1F1F8}",
  EUR: "\u{1F1EA}\u{1F1FA}",
  GBP: "\u{1F1EC}\u{1F1E7}",
  JPY: "\u{1F1EF}\u{1F1F5}",
  AUD: "\u{1F1E6}\u{1F1FA}",
  CAD: "\u{1F1E8}\u{1F1E6}",
  CHF: "\u{1F1E8}\u{1F1ED}",
  NZD: "\u{1F1F3}\u{1F1FF}",
  CNY: "\u{1F1E8}\u{1F1F3}",
  HKD: "\u{1F1ED}\u{1F1F0}",
  SGD: "\u{1F1F8}\u{1F1EC}",
  NOK: "\u{1F1F3}\u{1F1F4}",
  SEK: "\u{1F1F8}\u{1F1EA}",
  DKK: "\u{1F1E9}\u{1F1F0}",
  MXN: "\u{1F1F2}\u{1F1FD}",
  ZAR: "\u{1F1FF}\u{1F1E6}",
  TRY: "\u{1F1F9}\u{1F1F7}",
  BRL: "\u{1F1E7}\u{1F1F7}",
  INR: "\u{1F1EE}\u{1F1F3}",
  KRW: "\u{1F1F0}\u{1F1F7}"
};
var CURRENCY_PAIR_MAP4 = {
  USD: ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD", "XAUUSD", "DXY", "USOIL"],
  EUR: ["EURUSD", "EURJPY", "EURGBP"],
  GBP: ["GBPUSD", "GBPJPY", "EURGBP"],
  JPY: ["USDJPY", "EURJPY", "GBPJPY"],
  AUD: ["AUDUSD"],
  CAD: ["USDCAD", "USOIL"],
  CHF: ["USDCHF"],
  NZD: ["NZDUSD"],
  XAU: ["XAUUSD"],
  // Oil-producing / commodity countries
  OIL: ["USOIL", "USDCAD"]
};
function formatValue2(v, unit) {
  if (v === null || v === void 0) return null;
  const suffix = unit && unit !== "" ? unit : "";
  return `${v}${suffix}`;
}
function normalizeImpact2(impact) {
  const i = (impact ?? "").toLowerCase();
  if (i === "high") return "high";
  if (i === "medium" || i === "moderate") return "medium";
  return "low";
}
async function fetchCalendar(from, to) {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) throw new Error("FINNHUB_API_KEY not set in .env");
  const cacheKey2 = `finnhub:calendar:${from}:${to}`;
  const cached = get(cacheKey2);
  if (cached) return cached;
  const url = `${BASE3}/calendar/economic?from=${from}&to=${to}&token=${apiKey}`;
  const res = await fetch(url, { headers: { "X-Finnhub-Token": apiKey } });
  if (!res.ok) throw new Error(`Finnhub error: ${res.status} ${res.statusText}`);
  const data = await res.json();
  const raw = data.economicCalendar ?? [];
  const events = raw.map((e, i) => {
    const currency = COUNTRY_TO_CURRENCY4[e.country?.toUpperCase()] ?? e.country;
    const [datePart, timePart] = (e.time ?? "").split(" ");
    const pairImpacts = CURRENCY_PAIR_MAP4[currency] ?? [];
    return {
      id: `fh-${datePart}-${i}-${e.event.slice(0, 8).replace(/\s/g, "")}`,
      title: e.event,
      country: e.country,
      currency,
      flag: CURRENCY_FLAGS3[currency] ?? "\u{1F30D}",
      date: datePart ?? "",
      time: timePart ? timePart.slice(0, 5) : "00:00",
      impact: normalizeImpact2(e.impact),
      forecast: formatValue2(e.estimate, e.unit),
      previous: formatValue2(e.prev, e.unit),
      actual: formatValue2(e.actual, e.unit),
      pairImpacts
    };
  });
  const sorted = events.filter((e) => e.date).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  set(cacheKey2, sorted, 5 * 60 * 1e3);
  return sorted;
}

// src/config/fundamentalSources.ts
var FUNDAMENTAL_SOURCES = [];

// src/config/economicEvents.ts
var MANUAL_ECONOMIC_EVENTS = [];

// src/services/news/fmpNewsService.ts
async function fetchForexNews(_symbols) {
  return [];
}
async function fetchGeneralMarketNews() {
  return [];
}

// src/services/news/rssNewsService.ts
async function fetchRssArticles(_sources) {
  return [];
}

// src/services/news/playwrightNewsScraper.ts
async function scrapeFallbackNews(_opts) {
  return [];
}

// src/services/news/newsDeduplicator.ts
function deduplicateArticles(articles) {
  const seen = /* @__PURE__ */ new Set();
  return articles.filter((a) => {
    const key = a.url ?? a.title ?? "";
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// src/services/fundamentals/politicalInfluenceService.ts
async function fetchPoliticalHeadlines() {
  return [];
}

// src/services/fundamentals/centralBankService.ts
async function fetchFedNews() {
  return [];
}
async function fetchEcbNews() {
  return [];
}
async function fetchBoeNews() {
  return [];
}

// src/services/fundamentals/currencyImpactMapper.ts
function detectAffectedSymbols(_input) {
  return [];
}
function detectImpactLevel(_input) {
  return "low";
}
function detectMacroCategories(_input) {
  return ["other"];
}
function generateMarketImpactExplanation(_categories, _symbols) {
  return "";
}

// src/services/fundamentals/rulesBasedBiasEngine.ts
function calculateRulesBasedBias(input) {
  return {
    symbol: input.symbol,
    bias: "neutral",
    confidence: 0,
    impact: "unknown",
    tradeStatus: "wait",
    reason: "",
    reasons: [],
    keyDrivers: [],
    articleIds: [],
    eventIds: []
  };
}

// src/services/fundamentals/tradeWarningService.ts
function deriveTradeStatus(_input) {
  return "safe";
}

// backend/server/services/fundamentals.service.ts
function getFundamentalsAiModel() {
  return process.env.OPENAI_MODEL ?? "gpt-4o-mini";
}
var SUPPORTED_SYMBOLS = [
  "XAU/USD",
  "XAG/USD",
  "EUR/USD",
  "GBP/USD",
  "USD/JPY",
  "AUD/USD",
  "NZD/USD",
  "USD/CAD",
  "USD/CHF",
  "GBP/JPY",
  "EUR/JPY",
  "EUR/GBP",
  "DXY",
  "USOIL",
  "NAS100",
  "SPX500",
  "US30",
  "US100",
  "GER40",
  "BTC/USD",
  "ETH/USD"
];
var SCHEDULE_TZ = APP_EVENT_TIMEZONE;
var memoryStore = {
  articles: [],
  events: [],
  pairBiases: [],
  sourceStatus: FUNDAMENTAL_SOURCES.map((source) => ({
    id: source.id,
    name: source.name,
    type: source.type,
    enabled: source.enabled,
    categories: source.categories,
    status: "idle",
    articleCount: 0,
    lastFetchedAt: null,
    lastError: null,
    fallbackUsed: false
  })),
  lastUpdated: null,
  lastWarning: null,
  lastErrors: [],
  scheduleMetadata: {
    generatedAt: null,
    generatedTimezone: SCHEDULE_TZ,
    nextScheduledRun: null,
    triggeredBy: null
  }
};
var dbUnavailableLogged = false;
function logDbUnavailable(error) {
  if (dbUnavailableLogged) return;
  dbUnavailableLogged = true;
  console.warn("[fundamentals] DB unavailable, using in-memory store only:", error instanceof Error ? error.message : error);
}
async function ensureTables() {
  if (!isDatabaseConfigured()) {
    logDbUnavailable("Supabase not configured");
    return false;
  }
  try {
    const { error } = await supabase.from("news_articles").select("id").limit(1);
    if (error) {
      logDbUnavailable(error.message);
      return false;
    }
    dbUnavailableLogged = false;
    return true;
  } catch (error) {
    logDbUnavailable(error);
    return false;
  }
}
function updateSourceStatus(id, patch) {
  const index = memoryStore.sourceStatus.findIndex((row) => row.id === id);
  if (index === -1) return;
  memoryStore.sourceStatus[index] = { ...memoryStore.sourceStatus[index], ...patch };
}
function logSourceStart(source) {
  console.info(`[fundamentals] source started: ${source.name}`);
  updateSourceStatus(source.id, { status: "idle", lastError: null, fallbackUsed: false });
}
function logSourceSuccess(source, count) {
  console.info(`[fundamentals] source succeeded: ${source.name} (${count} articles/items)`);
  updateSourceStatus(source.id, {
    status: "ok",
    articleCount: count,
    lastFetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
    lastError: null
  });
}
function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function logSourceFailed(source, error, fallbackUsed = false) {
  const message = toErrorMessage(error);
  console.warn(`[fundamentals] source failed: ${source.name} -> ${message}`);
  updateSourceStatus(source.id, {
    status: fallbackUsed ? "ok" : "failed",
    articleCount: 0,
    lastFetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
    lastError: message,
    fallbackUsed
  });
  memoryStore.lastErrors.push(`${source.name}: ${message}`);
}
function makeArticleId(article) {
  const raw = article.url ?? [article.title, article.publishedAt].join("|");
  return `news_${Buffer.from(raw).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`;
}
function inferTopicTags(article) {
  const text = [article.title, article.summary, article.contentSnippet].filter(Boolean).join(" ").toLowerCase();
  const tags = [];
  if (text.includes("powell") || text.includes("federal reserve") || text.includes("fomc")) tags.push("fed");
  if (text.includes("hawkish")) tags.push("hawkish-fed");
  if (text.includes("dovish")) tags.push("dovish-fed");
  if (text.includes("treasury yields") || text.includes("yield")) tags.push("rising-yields");
  if (text.includes("geopolitical") || text.includes("war") || text.includes("sanctions")) tags.push("geopolitical", "risk-off");
  if (text.includes("tariff") || text.includes("trade war") || text.includes("donald trump") || text.includes("trump")) tags.push("politics");
  if (article.affectedCurrencies.includes("XAU")) tags.push("gold");
  return Array.from(new Set(tags));
}
function computeRelevanceScore(article) {
  let impactWeight;
  if (article.impact === "high") {
    impactWeight = 100;
  } else if (article.impact === "medium") {
    impactWeight = 60;
  } else {
    impactWeight = 20;
  }
  const ageMs = Date.now() - new Date(article.publishedAt).getTime();
  const ageHours = ageMs / (1e3 * 60 * 60);
  let recencyFactor;
  if (ageHours <= 6) {
    recencyFactor = 1;
  } else if (ageHours <= 24) {
    recencyFactor = 0.7;
  } else if (ageHours <= 72) {
    recencyFactor = 0.3;
  } else {
    recencyFactor = 0.05;
  }
  const macroBonus = article.macroCategory.length * 5;
  return Math.round(impactWeight * recencyFactor + macroBonus);
}
function normalizeArticle(article) {
  const affectedSymbols = article.affectedSymbols.filter((item) => SUPPORTED_SYMBOLS.includes(item));
  const macroCategory = detectMacroCategories({
    title: article.title,
    summary: article.summary,
    contentSnippet: article.contentSnippet
  });
  const marketImpactExplanation = generateMarketImpactExplanation(macroCategory, affectedSymbols);
  const normalized = {
    id: makeArticleId({ url: article.url, title: article.title, publishedAt: article.publishedAt }),
    source: article.source,
    sourceType: article.sourceType,
    title: article.title,
    summary: article.summary,
    contentSnippet: article.contentSnippet,
    url: article.url,
    publishedAt: article.publishedAt,
    fetchedAt: article.fetchedAt,
    affectedCurrencies: article.affectedCurrencies,
    affectedSymbols,
    impact: article.impact,
    sentiment: article.sentiment,
    topicTags: [],
    macroCategory,
    marketImpactExplanation,
    relevanceScore: 0,
    aiSummary: article.summary ?? null,
    rawData: article.rawData
  };
  normalized.topicTags = inferTopicTags(normalized);
  normalized.relevanceScore = computeRelevanceScore(normalized);
  return normalized;
}
var FRESHNESS_CUTOFF_MS = 72 * 60 * 60 * 1e3;
var HIGH_IMPACT_FRESHNESS_MS = 7 * 24 * 60 * 60 * 1e3;
function dedupeAndSortArticles(articles) {
  const deduped = deduplicateArticles(articles).map((article) => normalizeArticle(article));
  const byId = /* @__PURE__ */ new Map();
  for (const article of deduped) {
    byId.set(article.id, article);
  }
  const now2 = Date.now();
  const fresh = Array.from(byId.values()).filter((article) => {
    const ageMs = now2 - new Date(article.publishedAt).getTime();
    const cutoff = article.impact === "high" ? HIGH_IMPACT_FRESHNESS_MS : FRESHNESS_CUTOFF_MS;
    return ageMs <= cutoff;
  });
  return fresh.sort((a, b) => b.relevanceScore - a.relevanceScore);
}
function dedupeAndClassifyEvents(events) {
  const byId = /* @__PURE__ */ new Map();
  for (const event of events) {
    if (!event.datetimeUtc) continue;
    byId.set(event.id, event);
  }
  return Array.from(byId.values()).sort((a, b) => +new Date(a.datetimeUtc) - +new Date(b.datetimeUtc));
}
function categorizeEconomicEvent(name) {
  const text = name.toLowerCase();
  if (/(cpi|ppi|inflation|pce)/.test(text)) return "inflation";
  if (/(employment|payroll|jobless|unemployment|wage|labor)/.test(text)) return "employment";
  if (/(fed|ecb|boe|boj|rba|boc|speech|minutes|rate decision|central bank)/.test(text)) return "central bank";
  if (/pmi/.test(text)) return "PMI";
  if (/gdp/.test(text)) return "GDP";
  if (/retail sales/.test(text)) return "retail sales";
  if (/(housing|home sales|building permits|starts)/.test(text)) return "housing";
  if (/(sentiment|confidence)/.test(text)) return "sentiment";
  return "other";
}
function describeEconomicEvent(eventName, category) {
  const name = eventName.trim();
  const defaults = {
    inflation: {
      description: `${name} tracks inflation pressure and price growth trends.`,
      why: "Inflation surprises can quickly change rate expectations, yields, and the USD or local currency.",
      impact: "Higher-than-expected inflation can support the currency if markets expect tighter policy. Softer data can pressure yields and the currency.",
      volatility: "Typically medium to high volatility, especially for USD pairs and gold."
    },
    employment: {
      description: `${name} measures labour-market conditions, hiring strength, or wage pressure.`,
      why: "Employment data is a core central-bank input and can reshape growth and rate expectations.",
      impact: "Strong labour data can strengthen the local currency and pressure gold if yields rise. Weak data can do the opposite.",
      volatility: "Often high volatility for major FX pairs around the release."
    },
    "central bank": {
      description: `${name} reflects central-bank communication or policy direction.`,
      why: "Central-bank speeches, minutes, and decisions can directly move rate expectations, yields, indices, and FX.",
      impact: "Watch for comments on inflation, rates, liquidity, banking conditions, and economic outlook.",
      volatility: "Can trigger sharp intraday volatility in the affected currency, gold, and risk assets."
    },
    PMI: {
      description: `${name} measures business activity and momentum in manufacturing or services.`,
      why: "PMI data helps traders gauge growth momentum before harder macro data is released.",
      impact: "A strong surprise can lift the currency and risk sentiment. A weak print can hurt growth-sensitive assets.",
      volatility: "Usually medium volatility, but can rise when growth is a dominant market theme."
    },
    GDP: {
      description: `${name} measures the pace of economic growth.`,
      why: "GDP releases shape macro growth expectations and can influence monetary policy expectations.",
      impact: "Stronger GDP can support the currency and yields. Weak GDP can increase easing expectations.",
      volatility: "Usually medium to high volatility depending on the surprise size."
    },
    "retail sales": {
      description: `${name} measures consumer spending momentum.`,
      why: "Consumer demand is a major driver of growth and inflation persistence.",
      impact: "Strong retail sales can support the currency and risk sentiment; weak sales can weigh on growth expectations.",
      volatility: "Usually medium volatility."
    },
    housing: {
      description: `${name} tracks housing-market activity or construction demand.`,
      why: "Housing is sensitive to rates and can signal how restrictive financial conditions are becoming.",
      impact: "Stronger housing data can support growth expectations; weak housing data can reinforce slowdown concerns.",
      volatility: "Usually low to medium volatility."
    },
    sentiment: {
      description: `${name} measures confidence among consumers or businesses.`,
      why: "Confidence data helps frame spending and investment appetite before harder data arrives.",
      impact: "Strong sentiment can support growth-sensitive assets; weak sentiment can hurt risk appetite.",
      volatility: "Usually low to medium volatility unless sentiment is a key macro focus."
    },
    other: {
      description: `${name} is a scheduled macro event that can influence the related currency and correlated assets.`,
      why: "Unexpected macro outcomes can affect rate expectations, relative growth, and short-term risk sentiment.",
      impact: "Watch how the result changes expectations for the currency, yields, and correlated instruments.",
      volatility: "Volatility impact depends on the size of the surprise and the current macro theme."
    }
  };
  return defaults[category];
}
function formatTimeUntil(datetimeUtc, now2 = /* @__PURE__ */ new Date()) {
  const diffMs = new Date(datetimeUtc).getTime() - now2.getTime();
  if (diffMs <= 0) return "expired";
  const minutes = Math.floor(diffMs / 6e4);
  if (minutes < 1) return "today";
  if (minutes < 60) return `in ${minutes}m`;
  if (minutes < 24 * 60) return `in ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  if (minutes < 48 * 60) return "tomorrow";
  return `in ${Math.floor(minutes / 1440)}d ${Math.floor(minutes % 1440 / 60)}h`;
}
function normalizeManualEvent(event) {
  const affectedSymbols = detectAffectedSymbols({
    eventName: event.eventName,
    currency: event.currency,
    impact: event.impact,
    title: event.eventName
  }).filter((symbol) => SUPPORTED_SYMBOLS.includes(symbol));
  return {
    id: event.id,
    source: event.source,
    sourceUrl: null,
    eventName: event.eventName,
    country: event.country ?? null,
    currency: event.currency,
    impact: event.impact,
    category: categorizeEconomicEvent(event.eventName),
    date: "",
    time: "",
    timezone: SCHEDULE_TZ,
    providerTimezone: "UTC",
    datetimeUtc: event.dateTime,
    datetimeLocal: event.dateTime,
    dateLabel: "",
    dateTimeLabel: "",
    previous: event.previous ?? null,
    forecast: event.forecast ?? null,
    actual: event.actual ?? null,
    eventTime: event.dateTime,
    fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
    description: null,
    whyItMatters: null,
    potentialImpact: null,
    volatilityImpact: null,
    aiInterpretation: null,
    status: "upcoming",
    affectedSymbols,
    timeUntil: "today",
    blocksTrading: event.impact === "high",
    blockWindow: event.impact === "high" ? "30 minutes before/after" : null,
    tradeWarning: deriveTradeStatus({
      bias: "neutral",
      confidence: 50,
      impact: event.impact,
      events: [{ impact: event.impact, eventTime: event.dateTime }]
    }) === "avoid" ? "avoid" : "wait",
    rawData: { source: "manual" },
    debug: {
      rawDateTime: event.dateTime,
      rawDate: null,
      rawTime: null,
      parsedDateTimeUtc: event.dateTime,
      appTimezone: SCHEDULE_TZ,
      nowUtc: (/* @__PURE__ */ new Date()).toISOString(),
      classification: {
        status: "upcoming",
        isToday: false,
        isThisWeek: false,
        isUpcoming: true,
        isPast: false,
        isNext4Hours: false
      }
    }
  };
}
function enrichEconomicEvent(base2, timingInput) {
  const now2 = timingInput.now ?? /* @__PURE__ */ new Date();
  const timing = deriveFundamentalEventTiming({
    rawDateTime: timingInput.rawDateTime,
    rawDate: timingInput.rawDate,
    rawTime: timingInput.rawTime,
    providerTimezone: timingInput.providerTimezone ?? "UTC",
    appTimezone: SCHEDULE_TZ,
    now: now2
  });
  if (!timing) return null;
  const description = describeEconomicEvent(base2.eventName, base2.category);
  const released = timing.isPast && Boolean(base2.actual);
  const event = {
    ...base2,
    date: timing.date,
    time: timing.time,
    timezone: timing.timezone,
    providerTimezone: timing.providerTimezone,
    datetimeUtc: timing.datetimeUtc,
    datetimeLocal: timing.datetimeLocal,
    dateLabel: timing.dateLabel,
    dateTimeLabel: timing.dateTimeLabel,
    eventTime: timing.datetimeUtc,
    fetchedAt: now2.toISOString(),
    description: description.description,
    whyItMatters: description.why,
    potentialImpact: description.impact,
    volatilityImpact: description.volatility,
    aiInterpretation: description.impact,
    status: released ? "released" : timing.status,
    timeUntil: formatTimeUntil(timing.datetimeUtc, now2),
    blocksTrading: base2.impact === "high",
    blockWindow: base2.impact === "high" ? "30 minutes before/after" : null,
    debug: {
      rawDateTime: timing.rawDateTime,
      rawDate: timing.rawDate,
      rawTime: timing.rawTime,
      parsedDateTimeUtc: timing.datetimeUtc,
      appTimezone: timing.timezone,
      nowUtc: now2.toISOString(),
      classification: {
        status: released ? "released" : timing.status,
        isToday: timing.isToday,
        isThisWeek: timing.isThisWeek,
        isUpcoming: timing.isUpcoming,
        isPast: timing.isPast,
        isNext4Hours: timing.isNext4Hours
      }
    }
  };
  console.log("[fundamentals/events] classified", {
    id: event.id,
    source: event.source,
    eventName: event.eventName,
    rawDateTime: event.debug.rawDateTime,
    rawDate: event.debug.rawDate,
    rawTime: event.debug.rawTime,
    parsedDateTimeUtc: event.datetimeUtc,
    datetimeLocal: event.datetimeLocal,
    appTimezone: event.timezone,
    currentDateTimeUtc: event.debug.nowUtc,
    status: event.status,
    isToday: event.debug.classification.isToday,
    isThisWeek: event.debug.classification.isThisWeek,
    isUpcoming: event.debug.classification.isUpcoming,
    isPast: event.debug.classification.isPast,
    isNext4Hours: event.debug.classification.isNext4Hours
  });
  return event;
}
async function loadRssSources() {
  const rssSources = FUNDAMENTAL_SOURCES.filter((source) => source.enabled && source.type === "rss");
  const results = [];
  for (const source of rssSources) {
    logSourceStart(source);
    try {
      const articles = await fetchRssArticles([source]);
      const normalized = articles.map((article) => normalizeArticle(article));
      results.push(...normalized);
      logSourceSuccess(source, normalized.length);
    } catch (error) {
      logSourceFailed(source, error);
    }
  }
  return results;
}
async function loadApiSources() {
  const apiResults = [];
  const fmpSource = FUNDAMENTAL_SOURCES.find((source) => source.id === "fmp-forex-news");
  if (fmpSource) {
    logSourceStart(fmpSource);
    if (process.env.FMP_API_KEY) {
      try {
        const [forex, general] = await Promise.all([fetchForexNews(), fetchGeneralMarketNews()]);
        const normalized = [...forex, ...general].map(normalizeArticle);
        apiResults.push(...normalized);
        logSourceSuccess(fmpSource, normalized.length);
      } catch (error) {
        logSourceFailed(fmpSource, error, true);
      }
    }
  }
  return apiResults;
}
async function loadPoliticalAndCentralBankSources() {
  const results = [];
  const political = await fetchPoliticalHeadlines().catch(() => []);
  const fed = await fetchFedNews().catch(() => []);
  const ecb = await fetchEcbNews().catch(() => []);
  const boe = await fetchBoeNews().catch(() => []);
  for (const article of [...political, ...fed, ...ecb, ...boe]) {
    results.push(normalizeArticle(article));
  }
  return results;
}
async function loadPlaywrightFallback(enable) {
  const source = FUNDAMENTAL_SOURCES.find((item) => item.id === "playwright-fallback");
  if (!source) return [];
  if (!enable) {
    updateSourceStatus(source.id, { status: "skipped", lastError: "Disabled by settings", articleCount: 0 });
    return [];
  }
  logSourceStart(source);
  try {
    const articles = await scrapeFallbackNews({ enabled: true });
    const normalized = articles.map((article) => normalizeArticle(article));
    logSourceSuccess(source, normalized.length);
    return normalized;
  } catch (error) {
    logSourceFailed(source, error);
    return [];
  }
}
async function loadEconomicEvents() {
  const manualSource = FUNDAMENTAL_SOURCES.find((source) => source.id === "manual-economic-events");
  const events = [];
  const shouldUseManualEvents = process.env.ENABLE_MANUAL_ECONOMIC_EVENTS === "true" && !process.env.FINNHUB_API_KEY;
  if (manualSource) {
    logSourceStart(manualSource);
    if (shouldUseManualEvents) {
      const manualEvents = MANUAL_ECONOMIC_EVENTS.map(normalizeManualEvent).map((event) => enrichEconomicEvent(event, { rawDateTime: event.eventTime, providerTimezone: "UTC" })).filter((event) => Boolean(event));
      events.push(...manualEvents);
      logSourceSuccess(manualSource, manualEvents.length);
    } else {
      updateSourceStatus(manualSource.id, {
        status: "skipped",
        articleCount: 0,
        lastFetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
        lastError: shouldUseManualEvents ? null : "Manual economic events disabled when live provider data is available."
      });
    }
  }
  try {
    const from = new Date(Date.now() - 6 * 60 * 6e4).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 3 * 24 * 60 * 6e4).toISOString().slice(0, 10);
    const finnhubEvents = await fetchCalendar(from, to);
    for (const event of finnhubEvents) {
      const affectedSymbols = detectAffectedSymbols({
        title: event.title,
        eventName: event.title,
        currency: event.currency,
        impact: event.impact
      }).filter((symbol) => SUPPORTED_SYMBOLS.includes(symbol));
      const normalized = enrichEconomicEvent({
        id: `finnhub_${Buffer.from([event.title, event.date, event.time].join("|")).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`,
        source: "Finnhub",
        sourceUrl: null,
        eventName: event.title,
        country: event.country ?? null,
        currency: event.currency ?? null,
        impact: event.impact,
        category: categorizeEconomicEvent(event.title),
        previous: event.previous ?? null,
        forecast: event.forecast ?? null,
        actual: event.actual ?? null,
        affectedSymbols,
        tradeWarning: deriveTradeStatus({
          bias: "neutral",
          confidence: 50,
          impact: detectImpactLevel({ title: event.title, currency: event.currency, impact: event.impact }),
          events: [{ impact: event.impact, eventTime: `${event.date}T${event.time}:00Z` }]
        }) === "avoid" ? "avoid" : "wait",
        rawData: event
      }, {
        rawDate: event.date,
        rawTime: event.time,
        providerTimezone: "UTC"
      });
      if (normalized) events.push(normalized);
    }
  } catch (error) {
    memoryStore.lastErrors.push(`Finnhub calendar: ${error instanceof Error ? error.message : String(error)}`);
  }
  return dedupeAndClassifyEvents(events);
}
function buildEmptyPair(symbol) {
  return {
    id: `pair_${symbol.replace("/", "")}`,
    symbol,
    bias: "unknown",
    confidence: 0,
    impact: "unknown",
    tradeStatus: "unknown",
    reason: `No fundamentals data yet for ${symbol}. Click Refresh Fundamentals to fetch latest news.`,
    keyDrivers: [],
    relatedArticleIds: [],
    relatedEventIds: [],
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function inferTradeModeFromBias(bias) {
  if (bias === "bullish") return "favor_buys";
  if (bias === "bearish") return "favor_sells";
  return "wait";
}
function inferDataFreshness(articles, events) {
  const timestamps = [
    ...articles.map((article) => article.publishedAt || article.fetchedAt),
    ...events.map((event) => event.datetimeUtc || event.fetchedAt)
  ].map((value) => new Date(value).getTime()).filter((value) => Number.isFinite(value));
  if (!timestamps.length) return "unknown";
  const newest = Math.max(...timestamps);
  const ageHours = (Date.now() - newest) / (1e3 * 60 * 60);
  if (ageHours <= 6) return "fresh";
  if (ageHours <= 24) return "aging";
  return "stale";
}
var AI_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 12 * 6e4 : 5 * 6e4;
var aiState = {
  cachedBiases: null,
  cacheExpiresAt: 0,
  lastAiRefresh: null,
  inFlight: null,
  rateLimitedUntil: null,
  rateLimitRetryAfter: null,
  requestsThisMinute: 0,
  requestWindowStart: Date.now()
};
function tickRequestCounter() {
  const now2 = Date.now();
  if (now2 - aiState.requestWindowStart > 6e4) {
    aiState.requestsThisMinute = 0;
    aiState.requestWindowStart = now2;
  }
  aiState.requestsThisMinute += 1;
}
function isRateLimited() {
  if (aiState.rateLimitedUntil == null) return false;
  if (Date.now() < aiState.rateLimitedUntil) return true;
  aiState.rateLimitedUntil = null;
  aiState.rateLimitRetryAfter = null;
  return false;
}
function extractRetryAfterMs(error) {
  const msg = toErrorMessage(error);
  const match = /retry.*?after[^\d]*(\d+)/i.exec(msg) ?? /(\d+)\s*second/i.exec(msg);
  if (match) return Number.parseInt(match[1], 10) * 1e3;
  return 6e4;
}
function buildBatchPrompt(rulesResults, articles, events) {
  const INSTRUMENT_CONTEXT = {
    "EUR/USD": "Professional focus: ECB vs Fed divergence, Eurozone inflation/PMI/growth, US CPI/NFP, DXY direction, yield spreads, and risk sentiment. Separate intraday catalyst risk from swing bias.",
    "GBP/USD": "Professional focus: BoE vs Fed divergence, UK inflation/jobs/GDP, US macro surprise risk, DXY direction, gilt vs Treasury yield spread, and political headlines.",
    "XAU/USD": "Professional focus: US real yields, nominal yields, DXY direction, Fed expectations, inflation, labor data, safe-haven demand, and geopolitical headline risk. Treat stale macro narratives conservatively.",
    "DXY": "Professional focus: Fed path, US CPI/NFP/GDP, Treasury yields, positioning, and global risk sentiment. Explain inverse or confirming pressure on EUR, GBP, Gold, and Oil.",
    "USOIL": "Professional focus: OPEC+ supply discipline, EIA/API inventory flow, China/global demand, USD strength, inflation transmission, and geopolitical supply risk."
  };
  const symbolBlocks = rulesResults.map((r) => {
    const compactKey = r.symbol.replace("/", "");
    const matchedArticles = articles.filter((a) => r.articleIds.includes(a.id));
    const matchedEvents = events.filter((e) => r.eventIds.includes(e.id));
    const relArticles = matchedArticles.slice(0, 6).map((a) => ({
      title: a.title,
      sentiment: a.sentiment,
      impact: a.impact,
      publishedAt: a.publishedAt,
      source: a.source
    }));
    const relEvents = matchedEvents.slice(0, 5).map((e) => ({
      eventName: e.eventName,
      impact: e.impact,
      currency: e.currency,
      date: e.date,
      time: e.time,
      actual: e.actual,
      forecast: e.forecast,
      previous: e.previous
    }));
    const sourceQuality = {
      articleCount: matchedArticles.length,
      eventCount: matchedEvents.length,
      dataFreshness: inferDataFreshness(matchedArticles, matchedEvents)
    };
    return `### ${compactKey} (${r.symbol})
Instrument context: ${INSTRUMENT_CONTEXT[r.symbol] ?? "Macro instrument."}
Rules-based context: ${r.reason}
Source quality baseline: ${JSON.stringify(sourceQuality)}
Related articles: ${JSON.stringify(relArticles)}
Related events: ${JSON.stringify(relEvents)}`;
  }).join("\n\n");
  const keyShape = rulesResults.map((r) => `"${r.symbol.replace("/", "")}": {
    "bias":"bullish|bearish|neutral|mixed",
    "confidence":0-100,
    "impact":"low|medium|high",
    "tradeStatus":"safe|wait|avoid",
    "reason":"<2 sentences, include macro/intermarket context>",
    "keyDrivers":["..."],
    "tradeMode":"favor_buys|favor_sells|wait|avoid",
    "calendarRisk":"low|medium|high",
    "headlineRisk":"low|medium|high|unavailable",
    "timeHorizon":{"intraday":"...","swing":"..."},
    "decisionSummary":"...",
    "fundamentalSummary":"...",
    "technicalMacroBridge":"...",
    "macroDrivers":["..."],
    "watchEvents":["..."],
    "keyRisks":["..."],
    "invalidationConditions":["..."],
    "whatToDo":["..."],
    "intermarketContext":{"dxy":"...","yields":"...","riskSentiment":"...","geopolitics":"..."},
    "sourceQuality":{"articleCount":0,"eventCount":0,"dataFreshness":"fresh|aging|stale|unknown","confidencePenaltyReason":"..."}
  }`).join(",\n  ");
  return `You are the AlphaMentals professional macro/fundamental analyst.

Analyze the fundamental bias for ALL instruments below in one response.
Use only:
- the rules-based context,
- the related articles,
- the related events,
- the instrument context.

Do not invent headlines, events, price action, technical levels, or macro drivers that are not grounded in the provided context.
If the source set is thin, mixed, or stale, lower confidence and explain the penalty.
Separate intraday bias from swing bias.
Be practical for traders: explain what matters now, what can invalidate the view, and what the trader should do next.
Use intermarket reasoning when supported by the data, especially DXY, yields, risk sentiment, oil, and geopolitics.
Never promise outcomes. Never overstate certainty.

${symbolBlocks}

Return JSON only with this exact shape:
{
  ${keyShape}
}`;
}
async function callBatchAI(rulesResults, articles, events) {
  tickRequestCounter();
  const startMs = Date.now();
  console.info("[Fundamentals AI] batch request start", {
    provider: "openai",
    model: getFundamentalsAiModel(),
    symbols: rulesResults.map((r) => r.symbol).join(", "),
    requestsThisMinute: aiState.requestsThisMinute
  });
  const prompt = buildBatchPrompt(
    rulesResults.map((r) => ({ symbol: r.symbol, reason: r.reason, articleIds: r.relatedArticleIds, eventIds: r.relatedEventIds })),
    articles,
    events
  );
  const raw = await chatCompleteJSON([
    {
      role: "system",
      content: "You are the AlphaMentals professional macro/fundamental analyst. Return JSON only. Use only the provided rules-based context, related articles, related events, and instrument context. Do not invent macro drivers, events, headlines, or technical structure. Lower confidence when source quality is weak, mixed, or stale. Separate intraday and swing thinking, include intermarket context when supported, and keep trader guidance practical but not promotional."
    },
    { role: "user", content: prompt }
  ], { temperature: 0.1, maxTokens: 1500, model: getFundamentalsAiModel(), feature: "fundamentals", operation: "generate_pair_fundamentals" });
  const durationMs = Date.now() - startMs;
  console.info("[Fundamentals AI] batch request success", { provider: "openai", model: getFundamentalsAiModel(), durationMs, status: "success" });
  const now2 = (/* @__PURE__ */ new Date()).toISOString();
  return rulesResults.map((row) => {
    const compactKey = row.symbol.replace("/", "");
    const aiEntry = raw[compactKey];
    if (!aiEntry || typeof aiEntry.bias !== "string") return row;
    return {
      ...row,
      bias: ["bullish", "bearish", "neutral", "mixed"].includes(aiEntry.bias) ? aiEntry.bias : row.bias,
      confidence: typeof aiEntry.confidence === "number" ? Math.max(0, Math.min(100, aiEntry.confidence)) : row.confidence,
      impact: ["low", "medium", "high"].includes(aiEntry.impact) ? aiEntry.impact : row.impact,
      tradeStatus: ["safe", "wait", "avoid"].includes(aiEntry.tradeStatus) ? aiEntry.tradeStatus : row.tradeStatus,
      reason: typeof aiEntry.reason === "string" ? aiEntry.reason : row.reason,
      keyDrivers: Array.isArray(aiEntry.keyDrivers) ? aiEntry.keyDrivers : row.keyDrivers,
      tradeMode: aiEntry.tradeMode && ["favor_buys", "favor_sells", "wait", "avoid"].includes(aiEntry.tradeMode) ? aiEntry.tradeMode : row.tradeMode ?? inferTradeModeFromBias(aiEntry.bias),
      calendarRisk: aiEntry.calendarRisk && ["low", "medium", "high"].includes(aiEntry.calendarRisk) ? aiEntry.calendarRisk : row.calendarRisk ?? (row.impact === "unknown" ? "medium" : row.impact),
      headlineRisk: aiEntry.headlineRisk && ["low", "medium", "high", "unavailable"].includes(aiEntry.headlineRisk) ? aiEntry.headlineRisk : row.headlineRisk,
      timeHorizon: aiEntry.timeHorizon ?? row.timeHorizon,
      decisionSummary: typeof aiEntry.decisionSummary === "string" ? aiEntry.decisionSummary : row.decisionSummary ?? aiEntry.reason,
      fundamentalSummary: typeof aiEntry.fundamentalSummary === "string" ? aiEntry.fundamentalSummary : row.fundamentalSummary ?? aiEntry.reason,
      technicalMacroBridge: typeof aiEntry.technicalMacroBridge === "string" ? aiEntry.technicalMacroBridge : row.technicalMacroBridge,
      macroDrivers: Array.isArray(aiEntry.macroDrivers) ? aiEntry.macroDrivers : row.macroDrivers ?? row.keyDrivers,
      watchEvents: Array.isArray(aiEntry.watchEvents) ? aiEntry.watchEvents : row.watchEvents,
      keyRisks: Array.isArray(aiEntry.keyRisks) ? aiEntry.keyRisks : row.keyRisks,
      invalidationConditions: Array.isArray(aiEntry.invalidationConditions) ? aiEntry.invalidationConditions : row.invalidationConditions,
      whatToDo: Array.isArray(aiEntry.whatToDo) ? aiEntry.whatToDo : row.whatToDo,
      intermarketContext: aiEntry.intermarketContext ?? row.intermarketContext,
      sourceQuality: aiEntry.sourceQuality ?? row.sourceQuality,
      updatedAt: now2
    };
  });
}
async function runPairAnalysis(articles, events) {
  const rulesResults = SUPPORTED_SYMBOLS.map((symbol) => {
    const r = calculateRulesBasedBias({ symbol, articles, events, sourceStale: !memoryStore.lastUpdated });
    const matchedArticles = articles.filter((article) => r.articleIds.includes(article.id));
    const matchedEvents = events.filter((event) => r.eventIds.includes(event.id));
    return {
      id: `pair_${symbol.replace("/", "")}`,
      symbol,
      bias: r.bias,
      confidence: r.confidence,
      impact: r.impact,
      tradeStatus: r.tradeStatus,
      reason: r.reason,
      keyDrivers: r.keyDrivers,
      relatedArticleIds: r.articleIds,
      relatedEventIds: r.eventIds,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      tradeMode: inferTradeModeFromBias(r.bias),
      calendarRisk: r.impact === "unknown" ? "medium" : r.impact,
      headlineRisk: "unavailable",
      decisionSummary: r.reason,
      fundamentalSummary: r.reason,
      macroDrivers: r.keyDrivers,
      watchEvents: [],
      keyRisks: [],
      invalidationConditions: [],
      whatToDo: [],
      sourceQuality: {
        articleCount: matchedArticles.length,
        eventCount: matchedEvents.length,
        dataFreshness: inferDataFreshness(matchedArticles, matchedEvents)
      }
    };
  });
  const aiEnabled = Boolean(process.env.OPENAI_API_KEY);
  const hasContent = rulesResults.some((r) => r.relatedArticleIds.length || r.relatedEventIds.length);
  if (!aiEnabled || !hasContent) {
    return rulesResults;
  }
  if (aiState.cachedBiases && Date.now() < aiState.cacheExpiresAt) {
    console.info("[Fundamentals AI] cache hit \u2014 skipping provider call", { model: getFundamentalsAiModel(), expiresIn: Math.round((aiState.cacheExpiresAt - Date.now()) / 1e3) + "s" });
    aiState.cachedBiases = aiState.cachedBiases.map((cached, i) => ({
      ...cached,
      relatedArticleIds: rulesResults[i]?.relatedArticleIds ?? cached.relatedArticleIds,
      relatedEventIds: rulesResults[i]?.relatedEventIds ?? cached.relatedEventIds
    }));
    return aiState.cachedBiases;
  }
  if (isRateLimited()) {
    const retryIn = aiState.rateLimitedUntil ? Math.round((aiState.rateLimitedUntil - Date.now()) / 1e3) : "?";
    console.warn("[Fundamentals AI] rate-limited \u2014 returning rules-based result", { retryInSeconds: retryIn });
    memoryStore.lastErrors.push(`Fundamentals AI temporarily rate-limited. Retry in ~${retryIn}s.`);
    return aiState.cachedBiases ?? rulesResults;
  }
  if (aiState.inFlight != null) {
    console.info("[Fundamentals AI] dedup \u2014 reusing in-flight batch request");
    return aiState.inFlight;
  }
  const batchPromise = callBatchAI(rulesResults, articles, events).then((enriched) => {
    aiState.cachedBiases = enriched;
    aiState.cacheExpiresAt = Date.now() + AI_CACHE_TTL_MS;
    aiState.lastAiRefresh = (/* @__PURE__ */ new Date()).toISOString();
    aiState.inFlight = null;
    enriched.forEach(
      (row) => console.info(`[fundamentals] pair analysis completed: ${row.symbol} -> ${row.bias} (${row.confidence})`)
    );
    return enriched;
  }).catch((error) => {
    aiState.inFlight = null;
    const message = error instanceof Error ? error.message : String(error);
    const is429 = /429|quota|resource.?exhausted|rate.?limit/i.test(message);
    if (is429) {
      const backoffMs = extractRetryAfterMs(error);
      aiState.rateLimitedUntil = Date.now() + backoffMs;
      aiState.rateLimitRetryAfter = new Date(aiState.rateLimitedUntil).toISOString();
      console.warn("[Fundamentals AI] 429 rate limit hit", {
        model: getFundamentalsAiModel(),
        backoffMs,
        retryAfter: aiState.rateLimitRetryAfter
      });
      memoryStore.lastErrors.push(`Fundamentals AI rate-limited (429). Next retry allowed after ${aiState.rateLimitRetryAfter}.`);
    } else {
      console.warn("[Fundamentals AI] batch request failed", { model: getFundamentalsAiModel(), error: message });
      memoryStore.lastErrors.push(`Fundamentals AI batch failed: ${message}`);
    }
    return aiState.cachedBiases ?? rulesResults;
  });
  aiState.inFlight = batchPromise;
  return batchPromise;
}
async function persistBestEffort() {
  const canUseDb = await ensureTables();
  if (!canUseDb) return;
  try {
    const rows = memoryStore.sourceStatus.map((source) => ({
      id: source.id,
      name: source.name,
      type: source.type,
      url: FUNDAMENTAL_SOURCES.find((c) => c.id === source.id)?.url ?? "",
      enabled: source.enabled,
      categories: source.categories,
      last_fetched_at: source.lastFetchedAt,
      last_status: source.status,
      last_error: source.lastError
    }));
    await supabase.from("fundamental_sources").upsert(rows, { onConflict: "id" });
  } catch (error) {
    logDbUnavailable(error);
  }
  if (memoryStore.pairBiases.length) {
    try {
      const biasRows = memoryStore.pairBiases.map((row) => ({
        id: row.id,
        symbol: row.symbol,
        bias: row.bias,
        confidence: row.confidence,
        impact: row.impact,
        trade_status: row.tradeStatus,
        reason: row.reason,
        key_drivers: row.keyDrivers,
        related_article_ids: row.relatedArticleIds,
        related_event_ids: row.relatedEventIds,
        updated_at: row.updatedAt
      }));
      await supabase.from("pair_fundamental_biases").upsert(biasRows, { onConflict: "id" });
    } catch (error) {
      logDbUnavailable(error);
    }
  }
  if (memoryStore.events.length) {
    try {
      const eventRows = memoryStore.events.map((event) => ({
        id: event.id,
        source: event.source,
        sourceUrl: event.sourceUrl,
        eventName: event.eventName,
        country: event.country,
        currency: event.currency,
        impact: event.impact.toUpperCase(),
        category: event.category,
        eventDate: event.date,
        eventLocalTime: event.time,
        eventDateTimeUtc: event.datetimeUtc,
        eventDateTimeLocal: event.datetimeLocal,
        timezone: event.timezone,
        previous: event.previous,
        forecast: event.forecast,
        actual: event.actual,
        eventTime: event.datetimeUtc,
        fetchedAt: event.fetchedAt,
        description: event.description,
        whyItMatters: event.whyItMatters,
        affectedSymbols: event.affectedSymbols,
        aiInterpretation: event.aiInterpretation,
        status: event.status,
        tradeWarning: event.tradeWarning.toUpperCase(),
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      }));
      await supabase.from("economic_events").upsert(eventRows, { onConflict: "id" });
    } catch (error) {
      logDbUnavailable(error);
    }
  }
}
function getMode() {
  return process.env.OPENAI_API_KEY ? "ai-enhanced" : "rules-based";
}
function buildWarning() {
  const missingApiSources = memoryStore.sourceStatus.filter((source) => source.status === "failed" && source.lastError?.includes("API key missing"));
  const fallbackSourceUsed = memoryStore.sourceStatus.some((source) => source.fallbackUsed);
  if (missingApiSources.length && memoryStore.articles.length) {
    return `${missingApiSources.map((source) => source.name).join(", ")} failed because API key is missing. RSS fallback loaded ${memoryStore.articles.length} articles.`;
  }
  if (!memoryStore.articles.length && !memoryStore.events.length) {
    return "No sources returned data. Check internet connection, source config, or enable Playwright fallback.";
  }
  if (fallbackSourceUsed) {
    return "Some sources failed, but fallback sources were used.";
  }
  return null;
}
function formatMadridTs(date) {
  return date.toLocaleString("en-GB", {
    timeZone: SCHEDULE_TZ,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }) + ` ${SCHEDULE_TZ}`;
}
function getScheduleMetadata() {
  return { ...memoryStore.scheduleMetadata };
}
async function refreshFundamentalsData(options) {
  memoryStore.lastErrors = [];
  memoryStore.lastWarning = null;
  const [rssArticles, apiArticles, politicalArticles, events] = await Promise.all([
    loadRssSources(),
    loadApiSources(),
    loadPoliticalAndCentralBankSources(),
    loadEconomicEvents()
  ]);
  let articles = dedupeAndSortArticles([...rssArticles, ...apiArticles, ...politicalArticles]);
  if (articles.length > 0) {
    await loadPlaywrightFallback(false);
  } else {
    const fallbackArticles = await loadPlaywrightFallback(Boolean(options?.enablePlaywrightFallback));
    articles = dedupeAndSortArticles(fallbackArticles);
  }
  memoryStore.articles = articles.slice(0, 200);
  memoryStore.events = events.slice(0, 100);
  memoryStore.pairBiases = articles.length || events.length ? await runPairAnalysis(memoryStore.articles, memoryStore.events) : SUPPORTED_SYMBOLS.map(buildEmptyPair);
  const now2 = /* @__PURE__ */ new Date();
  memoryStore.lastUpdated = now2.toISOString();
  memoryStore.lastWarning = buildWarning();
  memoryStore.scheduleMetadata = {
    generatedAt: formatMadridTs(now2),
    generatedTimezone: SCHEDULE_TZ,
    nextScheduledRun: memoryStore.scheduleMetadata.nextScheduledRun,
    triggeredBy: options?.triggeredBy ?? memoryStore.scheduleMetadata.triggeredBy ?? "manual"
  };
  await persistBestEffort();
  return getFundamentalsOverview();
}
function getFundamentalsOverview() {
  const now2 = Date.now();
  if (now2 - aiState.requestWindowStart > 6e4) {
    aiState.requestsThisMinute = 0;
    aiState.requestWindowStart = now2;
  }
  const upcomingEvents = memoryStore.events.filter((event) => new Date(event.datetimeUtc).getTime() >= now2).sort((a, b) => +new Date(a.datetimeUtc) - +new Date(b.datetimeUtc)).slice(0, 30);
  const highImpactNext4Hours = upcomingEvents.filter((event) => event.impact === "high" && new Date(event.datetimeUtc).getTime() <= now2 + 4 * 60 * 60 * 1e3);
  return {
    pairs: memoryStore.pairBiases.length ? memoryStore.pairBiases : SUPPORTED_SYMBOLS.map(buildEmptyPair),
    latestNews: memoryStore.articles.slice(0, 50),
    upcomingEvents,
    highImpactNext4Hours,
    sourceStatus: memoryStore.sourceStatus,
    lastUpdated: memoryStore.lastUpdated,
    mode: getMode(),
    warning: memoryStore.lastWarning,
    errors: memoryStore.lastErrors,
    aiDiagnostics: {
      model: getFundamentalsAiModel(),
      cacheHit: aiState.cachedBiases != null && now2 < aiState.cacheExpiresAt,
      lastAiRefresh: aiState.lastAiRefresh,
      rateLimited: aiState.rateLimitedUntil != null && now2 < aiState.rateLimitedUntil,
      rateLimitRetryAfter: aiState.rateLimitRetryAfter,
      requestsThisMinute: aiState.requestsThisMinute
    },
    scheduleMetadata: { ...memoryStore.scheduleMetadata }
  };
}
var NON_PAIR_SYMBOLS = /* @__PURE__ */ new Set(["DXY", "USOIL", "NAS100", "SPX500", "US30", "US100", "GER40"]);
function normalizeFundamentalSymbol(symbol) {
  const compact = symbol.replace("/", "").toUpperCase();
  if (NON_PAIR_SYMBOLS.has(compact)) return compact;
  return `${compact.slice(0, 3)}/${compact.slice(3, 6)}`;
}
function getFundamentalsForSymbol(symbol) {
  const normalized = normalizeFundamentalSymbol(symbol);
  const latestBias = memoryStore.pairBiases.find((row) => row.symbol === normalized) ?? buildEmptyPair(normalized);
  return {
    latestBias,
    biasHistory: memoryStore.pairBiases.filter((row) => row.symbol === normalized),
    relatedArticles: memoryStore.articles.filter((article) => article.affectedSymbols.includes(normalized)).slice(0, 20),
    relatedEvents: memoryStore.events.filter((event) => event.affectedSymbols.includes(normalized)).slice(0, 20)
  };
}
function getFundamentalsNews() {
  return memoryStore.articles;
}
function getFundamentalsEvents() {
  return memoryStore.events;
}
function getFundamentalSourceStatus() {
  return memoryStore.sourceStatus;
}
async function bootstrapFundamentals() {
  await ensureTables();
  if (!memoryStore.lastUpdated) {
    try {
      const nowIso2 = (/* @__PURE__ */ new Date()).toISOString();
      const { data: storedEvents } = await supabase.from("economic_events").select("*").gte("eventTime", new Date(Date.now() - 24 * 60 * 60 * 1e3).toISOString()).order("eventTime", { ascending: true });
      if (storedEvents && storedEvents.length > 0) {
        memoryStore.events = storedEvents.map((row) => enrichEconomicEvent({
          id: row.id,
          source: row.source,
          sourceUrl: row.sourceUrl ?? null,
          eventName: row.eventName,
          country: row.country ?? null,
          currency: row.currency ?? null,
          impact: String(row.impact).toLowerCase(),
          category: row.category ?? categorizeEconomicEvent(row.eventName),
          previous: row.previous ?? null,
          forecast: row.forecast ?? null,
          actual: row.actual ?? null,
          affectedSymbols: Array.isArray(row.affectedSymbols) ? row.affectedSymbols : [],
          tradeWarning: String(row.tradeWarning ?? "wait").toLowerCase(),
          rawData: null
        }, {
          rawDateTime: row.eventTime,
          providerTimezone: "UTC",
          now: new Date(nowIso2)
        })).filter((event) => Boolean(event));
      }
      const { data } = await supabase.from("pair_fundamental_biases").select("*").order("updated_at", { ascending: false });
      if (data && data.length > 0) {
        const seen = /* @__PURE__ */ new Set();
        const rows = [];
        for (const row of data) {
          if (!seen.has(row.symbol)) {
            seen.add(row.symbol);
            rows.push({
              id: row.id,
              symbol: row.symbol,
              bias: row.bias,
              confidence: row.confidence,
              impact: row.impact,
              tradeStatus: row.trade_status,
              reason: row.reason,
              keyDrivers: row.key_drivers ?? [],
              relatedArticleIds: row.related_article_ids ?? [],
              relatedEventIds: row.related_event_ids ?? [],
              updatedAt: row.updated_at
            });
          }
        }
        if (rows.length > 0) {
          memoryStore.pairBiases = rows;
          memoryStore.lastUpdated = rows[0]?.updatedAt ?? null;
          console.info("[Fundamentals] Hydrated from DB", { symbols: rows.map((r) => r.symbol) });
          return;
        }
      }
    } catch (error) {
      console.warn("[Fundamentals] DB hydration failed (non-fatal):", error instanceof Error ? error.message : error);
    }
    memoryStore.pairBiases = SUPPORTED_SYMBOLS.map(buildEmptyPair);
  }
}

// src/server/marketDataService.ts
function validateMarketDataEnv() {
  const url = process.env.MT5_BRIDGE_URL;
  const key = process.env.MT5_BRIDGE_API_KEY;
  if (!url) console.warn("[market-data] MT5_BRIDGE_URL not set \u2014 market data will return null prices");
  if (!key) console.warn("[market-data] MT5_BRIDGE_API_KEY not set \u2014 MT5 bridge calls will be skipped");
}
function startMarketDataScheduler() {
}
async function getLatestMarketPrice(symbol) {
  try {
    const result = await getPreferredMarketPrices([symbol]);
    const entry = result.data[symbol];
    if (!entry) return null;
    return {
      price: entry.price,
      bid: entry.bid,
      ask: entry.ask,
      timestamp: entry.timestamp,
      timestampMs: entry.timestamp ? new Date(entry.timestamp).getTime() : null,
      change: null,
      changePercent: null,
      high: null,
      low: null,
      provider: entry.provider
    };
  } catch (err) {
    console.warn("[market-data] getLatestMarketPrice failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

// src/services/pairs/pairMacroDriverService.ts
function buildTechnicalSummary(_input) {
  return { trend: "unknown", timeframe: "1D", summary: "" };
}
function buildFundamentalSummary(_input) {
  return "";
}
function getCentralBankDriversForSymbol(_symbol, _data) {
  return [];
}
function getLatestNewsForSymbol(_symbol, _allNews) {
  return [];
}
function getPoliticalDriversForSymbol(_symbol, _data) {
  return [];
}
function inferBullishBearishDrivers(_symbol, _data) {
  return { bullishDrivers: [], bearishDrivers: [] };
}

// src/services/intelligence/pairFundamentalDrivers.ts
function isEnabledPair(_symbol) {
  return true;
}
function getMacroFocusForSymbol(_symbol) {
  return [];
}
function getFundamentalDriversForSymbol(_symbol) {
  return [];
}

// src/services/intelligence/newsRelevanceScorer.ts
function scoreNewsRelevanceForPair(_articles, _symbol) {
  return [];
}
function summarizeNewsImpact(_articles) {
  return { direction: "neutral", percentage: 0, summary: "" };
}

// src/services/intelligence/eventRelevanceFilter.ts
function filterEventsForPair(_events, _symbol) {
  return [];
}
function findNextHighImpact(_events) {
  return null;
}

// src/services/intelligence/tradeStatusCalculator.ts
function calculateTradeStatus(_input) {
  return { status: "safe", label: "Safe to trade", reason: "" };
}

// backend/server/services/pairIntelligenceAI.service.ts
var import_zod13 = require("zod");
var import_node_crypto = require("node:crypto");
var BiasDirection = import_zod13.z.enum(["bullish", "bearish", "neutral", "mixed"]);
var TradeStatusEnum = import_zod13.z.enum(["safe", "wait", "high_risk", "no_trade"]);
var PairIntelligenceSchema = import_zod13.z.object({
  symbol: import_zod13.z.string(),
  overallBias: BiasDirection,
  biasPercentage: import_zod13.z.number().int().min(0).max(100),
  technicalBias: import_zod13.z.object({
    direction: BiasDirection,
    percentage: import_zod13.z.number().int().min(0).max(100),
    summary: import_zod13.z.string()
  }),
  fundamentalBias: import_zod13.z.object({
    direction: BiasDirection,
    percentage: import_zod13.z.number().int().min(0).max(100),
    summary: import_zod13.z.string()
  }),
  newsImpact: import_zod13.z.object({
    direction: BiasDirection,
    percentage: import_zod13.z.number().int().min(0).max(100),
    summary: import_zod13.z.string()
  }),
  tradeStatus: TradeStatusEnum,
  summary: import_zod13.z.string(),
  bullishDrivers: import_zod13.z.array(import_zod13.z.string()),
  bearishDrivers: import_zod13.z.array(import_zod13.z.string()),
  risks: import_zod13.z.array(import_zod13.z.string()),
  invalidation: import_zod13.z.string(),
  tradePlan: import_zod13.z.object({
    preferredDirection: import_zod13.z.string(),
    entryConditions: import_zod13.z.array(import_zod13.z.string()),
    avoidConditions: import_zod13.z.array(import_zod13.z.string()),
    riskNotes: import_zod13.z.string()
  })
});
function hashContext(ctx) {
  const lean = {
    symbol: ctx.symbol,
    price: ctx.currentPrice,
    overall: ctx.overallBias,
    confidence: ctx.overallConfidence,
    biases: ctx.timeframeBiases.map((b) => `${b.timeframe}:${b.bias}:${b.confidence}`),
    newsTitles: ctx.topRelevantNews.slice(0, 5).map((n) => n.title),
    events: ctx.upcomingHighImpactEvents.map((e) => `${e.eventName}:${e.eventTime}`)
  };
  return (0, import_node_crypto.createHash)("sha1").update(JSON.stringify(lean)).digest("hex").slice(0, 16);
}
var FAST_MODEL = getOpenAIModel();
var DEEP_MODEL = getOpenAIModel();
var CACHE_TTL_MS2 = Number(process.env.AI_FAST_CACHE_TTL_SECONDS ?? "1200") * 1e3;
var STALE_GRACE_MS = Number(process.env.AI_STALE_GRACE_SECONDS ?? "300") * 1e3;
var SYSTEM_PROMPT = `You are a JSON-only intermarket analyst. You produce STRUCTURED, ACTIONABLE pair intelligence for retail traders across forex, commodities (Gold, Oil), and macro indices (DXY).

Rules you MUST follow:
- Output VALID JSON only. No prose, no markdown, no commentary.
- Do not base analysis on unrelated regional currency headlines (e.g. INR, ZAR, THB) unless they directly affect USD or global risk sentiment.
- Do not overstate confidence. If data is stale, market is closed, timeframes conflict, or news is thin, lower the confidence and use "mixed" or "neutral".
- Separate TECHNICAL and FUNDAMENTAL bias \u2014 they may disagree.
- If a high-impact event is within 60 minutes, tradeStatus MUST be "high_risk" or "wait".
- Keep all text fields tight and trader-focused. No motivational language. No financial advice.
- biasPercentage is the strength of the overall bias 0-100 (50 = balanced).
- INTERMARKET CORRELATION RULES (apply when correlation signals are provided):
  * DXY bullish \u2192 headwind for EURUSD, GBPUSD, XAUUSD, USOIL. Reduce bullish confidence on those instruments unless divergence is justified.
  * DXY bearish \u2192 tailwind for EURUSD, GBPUSD, XAUUSD, USOIL. Increase confidence for bullish setups on those instruments.
  * If DXY is bullish AND EURUSD is bullish \u2192 flag divergence; reduce biasPercentage and add risk noting the conflict.
  * If DXY is bearish AND Gold is bullish \u2192 strong confirmation; increase confidence.
  * USOIL bullish spike \u2192 inflation implications for FX; may weaken rate-cut expectations; note in risks.
  * USOIL and XAUUSD both bullish \u2192 risk-off or inflation macro regime; note this alignment.
  * A "high_conflict" correlation signal MUST appear in the risks array and reduce biasPercentage.
  * A "confirmed" correlation signal may increase biasPercentage modestly.
  * Adjusted biasPercentage = base biasPercentage + correlationConfidenceDelta (clamped 0-100).`;
function buildSingleSymbolBlock(ctx) {
  const trim = (value, max = 220) => value.replace(/\s+/g, " ").trim().slice(0, max);
  const biasLines = ctx.timeframeBiases.slice(0, 6).map((b) => `  ${b.timeframe}: ${b.bias} ${b.confidence}% \u2014 ${trim(b.reason, 90)}`).join("\n");
  const newsLines = ctx.topRelevantNews.length ? ctx.topRelevantNews.slice(0, 4).map((n, i) => `  ${i + 1}. [${n.relevanceScore}% rel \xB7 ${n.biasImpact}] ${trim(n.title, 110)} \u2014 ${trim(n.summary || n.whyItMatters, 140)}`).join("\n") : "  (no high-relevance news in this batch)";
  const eventLines = ctx.upcomingHighImpactEvents.length ? ctx.upcomingHighImpactEvents.slice(0, 4).map((e) => `  ${trim(e.eventName, 90)} (${e.currency ?? "?"}, ${e.impact}) \u2014 in ${e.minutesUntil}m`).join("\n") : "  (no high-impact events in window)";
  const staleNote = ctx.priceStaleMinutes != null && ctx.priceStaleMinutes > 60 ? `
DATA FRESHNESS WARNING: price is ${ctx.priceStaleMinutes} minutes old.` : "";
  let correlationSection = "";
  if (ctx.correlationSignals && ctx.correlationSignals.length > 0) {
    const sigLines = ctx.correlationSignals.slice(0, 4).map((s) => `  [${s.status.toUpperCase()}] ${s.relatedSymbol} (${s.relationship}): ${trim(s.explanation, 120)}`).join("\n");
    correlationSection = `
Cross-market correlation signals:
${sigLines}
Net correlation confidence delta: ${(ctx.correlationConfidenceDelta ?? 0) >= 0 ? "+" : ""}${ctx.correlationConfidenceDelta ?? 0}%
Macro correlation summary: ${ctx.correlationMacroSummary ?? "No cross-market data."}
`;
  }
  return `--- ${ctx.displaySymbol} ---
Price: ${ctx.currentPrice ?? "unavailable"} | Market: ${ctx.marketStatus} | Bias: ${ctx.overallBias} (${ctx.overallConfidence}%)${staleNote}

Multi-timeframe bias:
${biasLines}

Technical: ${trim(ctx.technicalSummary, 220)}
Fundamental: ${trim(ctx.fundamentalSummary, 220)}
${correlationSection}
News (pre-filtered):
${newsLines}

Events:
${eventLines}

Macro focus: ${ctx.macroDrivers.slice(0, 6).join(", ")}
Drivers: ${ctx.fundamentalDrivers.slice(0, 6).join(", ")}`;
}
var BATCH_JSON_SHAPE = `{
  "SYMBOL": {
    "symbol": "SYMBOL",
    "overallBias": "bullish|bearish|neutral|mixed",
    "biasPercentage": 0-100,
    "technicalBias": { "direction": "bullish|bearish|neutral|mixed", "percentage": 0-100, "summary": "<1-2 sentences>" },
    "fundamentalBias": { "direction": "bullish|bearish|neutral|mixed", "percentage": 0-100, "summary": "<1-2 sentences>" },
    "newsImpact": { "direction": "bullish|bearish|neutral|mixed", "percentage": 0-100, "summary": "<1 sentence>" },
    "tradeStatus": "safe|wait|high_risk|no_trade",
    "summary": "<3-4 sentences, trader-language>",
    "bullishDrivers": ["..."],
    "bearishDrivers": ["..."],
    "risks": ["..."],
    "invalidation": "<one clear invalidation level or condition>",
    "tradePlan": {
      "preferredDirection": "long|short|stand aside",
      "entryConditions": ["..."],
      "avoidConditions": ["..."],
      "riskNotes": "<1-2 sentences>"
    }
  }
}`;
function buildBatchUserPrompt(contexts) {
  const blocks = contexts.map(buildSingleSymbolBlock).join("\n\n");
  const symbolKeys = contexts.map((c) => c.symbol).join(", ");
  return `Analyze all instruments below and return a single JSON object keyed by symbol (${symbolKeys}).

${blocks}

Return JSON only with this exact shape (one key per symbol):
${BATCH_JSON_SHAPE.replaceAll("SYMBOL", symbolKeys)}`;
}
function buildSingleUserPrompt(ctx) {
  return `${buildSingleSymbolBlock(ctx)}

Return JSON only with this exact shape:
{
  "symbol": "${ctx.symbol}",
  "overallBias": "bullish|bearish|neutral|mixed",
  "biasPercentage": 0-100,
  "technicalBias": { "direction": "bullish|bearish|neutral|mixed", "percentage": 0-100, "summary": "<1-2 sentences>" },
  "fundamentalBias": { "direction": "bullish|bearish|neutral|mixed", "percentage": 0-100, "summary": "<1-2 sentences>" },
  "newsImpact": { "direction": "bullish|bearish|neutral|mixed", "percentage": 0-100, "summary": "<1 sentence>" },
  "tradeStatus": "safe|wait|high_risk|no_trade",
  "summary": "<3-4 sentences, trader-language>",
  "bullishDrivers": ["..."],
  "bearishDrivers": ["..."],
  "risks": ["..."],
  "invalidation": "<one clear invalidation level or condition>",
  "tradePlan": {
    "preferredDirection": "long|short|stand aside",
    "entryConditions": ["..."],
    "avoidConditions": ["..."],
    "riskNotes": "<1-2 sentences>"
  }
}`;
}
function fallbackPreferredDirection(direction) {
  if (direction === "bullish") return "long";
  if (direction === "bearish") return "short";
  return "stand aside";
}
function fallbackIntelligence(ctx) {
  const direction = ctx.overallBias === "unknown" ? "neutral" : ctx.overallBias;
  return {
    symbol: ctx.symbol,
    overallBias: direction,
    biasPercentage: Math.max(40, Math.min(80, ctx.overallConfidence)),
    technicalBias: {
      direction,
      percentage: ctx.overallConfidence,
      summary: ctx.technicalSummary
    },
    fundamentalBias: {
      direction: "neutral",
      percentage: 50,
      summary: ctx.fundamentalSummary
    },
    newsImpact: {
      direction: "neutral",
      percentage: 50,
      summary: ctx.topRelevantNews.length ? "Some relevant news present but AI not available to weigh impact." : "No relevant news in this batch."
    },
    tradeStatus: ctx.upcomingHighImpactEvents.some((e) => e.minutesUntil <= 60) ? "high_risk" : "wait",
    summary: `${ctx.displaySymbol} overall bias is ${direction} based on weighted multi-timeframe scoring. AI analysis unavailable \u2014 showing rules-based view.`,
    bullishDrivers: ctx.topRelevantNews.filter((n) => n.biasImpact === "bullish").slice(0, 3).map((n) => n.title),
    bearishDrivers: ctx.topRelevantNews.filter((n) => n.biasImpact === "bearish").slice(0, 3).map((n) => n.title),
    risks: ["Headline volatility can reverse short-term bias quickly.", "AI analysis unavailable \u2014 confidence is rules-based only."],
    invalidation: "No clear invalidation level without AI context.",
    tradePlan: {
      preferredDirection: fallbackPreferredDirection(direction),
      entryConditions: ["Wait for AI analysis or confirm with own setup before entry."],
      avoidConditions: ["Avoid trading into high-impact news within 60 minutes."],
      riskNotes: "Use normal risk per trade; this is informational only, not financial advice."
    }
  };
}
function cacheKey(ctx) {
  return `pair-intel-ai:${ctx.symbol}:${hashContext(ctx)}`;
}
async function buildPairIntelligenceAI(ctx, options) {
  const key = cacheKey(ctx);
  const aiEnabled = isOpenAIConfigured();
  logOpenAIConfiguration();
  const fresh = get(key);
  if (fresh) {
    recordCacheHit();
    return fresh;
  }
  const staleResult = getStale(key, STALE_GRACE_MS);
  if (staleResult?.isStale && aiEnabled && canMakeRequest()) {
    recordCacheHit();
    void callSingleSymbolAI(ctx, key, options?.deep ?? false).catch(() => void 0);
    return staleResult.data;
  }
  if (!aiEnabled) {
    const fb = fallbackIntelligence(ctx);
    set(key, fb, CACHE_TTL_MS2);
    return fb;
  }
  return callSingleSymbolAI(ctx, key, options?.deep ?? false);
}
async function callSingleSymbolAI(ctx, key, deep) {
  const model = deep ? DEEP_MODEL : FAST_MODEL;
  recordCacheMiss();
  try {
    const raw = await chatCompleteJSON(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildSingleUserPrompt(ctx) }
      ],
      { maxTokens: 900, temperature: 0.15, model, symbols: [ctx.symbol], feature: "pair_intelligence", operation: "generate_intelligence" }
    );
    const parsed = PairIntelligenceSchema.parse(raw);
    set(key, parsed, CACHE_TTL_MS2);
    return parsed;
  } catch (error) {
    console.warn("[pairIntelligenceAI] AI call failed, using fallback:", error instanceof Error ? error.message : error);
    const fb = fallbackIntelligence(ctx);
    set(key, fb, 6e4);
    return fb;
  }
}
function resolveCachedContext(ctx, forceRefresh, results) {
  if (forceRefresh) return false;
  const fresh = get(cacheKey(ctx));
  if (fresh) {
    recordCacheHit();
    results[ctx.symbol] = fresh;
    return true;
  }
  const stale = getStale(cacheKey(ctx), STALE_GRACE_MS);
  if (stale) {
    recordCacheHit();
    results[ctx.symbol] = stale.data;
    return !stale.isStale;
  }
  return false;
}
function applyBatchAIResult(ctx, raw, results) {
  const entry = raw[ctx.symbol] ?? raw[ctx.displaySymbol];
  if (!entry) {
    results[ctx.symbol] = fallbackIntelligence(ctx);
    return;
  }
  try {
    const parsed = PairIntelligenceSchema.parse(entry);
    set(cacheKey(ctx), parsed, CACHE_TTL_MS2);
    results[ctx.symbol] = parsed;
  } catch {
    results[ctx.symbol] = fallbackIntelligence(ctx);
  }
}
async function buildBatchPairIntelligenceAI(contexts, options) {
  const aiEnabled = isOpenAIConfigured();
  logOpenAIConfiguration();
  const results = {};
  const missing = contexts.filter((ctx) => !resolveCachedContext(ctx, options?.forceRefresh ?? false, results));
  if (!missing.length) return results;
  if (!aiEnabled || !canMakeRequest()) {
    for (const ctx of missing) results[ctx.symbol] = fallbackIntelligence(ctx);
    return results;
  }
  const model = options?.deep ? DEEP_MODEL : FAST_MODEL;
  const symbols = missing.map((c) => c.symbol);
  recordCacheMiss();
  try {
    const raw = await chatCompleteJSON(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildBatchUserPrompt(missing) }
      ],
      { maxTokens: missing.length * 950, temperature: 0.15, model, symbols, feature: "pair_intelligence", operation: "batch_intelligence" }
    );
    for (const ctx of missing) applyBatchAIResult(ctx, raw, results);
  } catch (error) {
    console.warn("[pairIntelligenceAI] batch AI call failed, using fallback:", error instanceof Error ? error.message : error);
    for (const ctx of missing) {
      if (!results[ctx.symbol]) results[ctx.symbol] = fallbackIntelligence(ctx);
    }
  }
  return results;
}

// src/lib/symbolConfig.ts
var DEFAULT_SYMBOLS = ["XAUUSD", "EURUSD", "GBPUSD", "DXY", "USOIL", "USDJPY", "GBPJPY"];

// backend/server/services/aiAnalysisStore.service.ts
var EXTRA_AI_ANALYSIS_SYMBOLS = ["DXY", "USOIL", "NAS100", "SPX500"];
var AI_ANALYSIS_SYMBOLS = [
  .../* @__PURE__ */ new Set([...Object.keys(DEFAULT_SYMBOLS), ...EXTRA_AI_ANALYSIS_SYMBOLS])
];
function normalizeStoredSymbol(symbol) {
  return normalizeApiSymbol(symbol);
}
function uniqueNormalizedSymbols(symbols) {
  return [...new Set(symbols.map((symbol) => normalizeStoredSymbol(symbol)).filter(Boolean))];
}
function fromFlattenedRow(row) {
  const symbol = normalizeStoredSymbol(row.symbol);
  const summary = row.summary?.trim() || row.decision_summary || row.fundamental_summary || row.technical_summary || getDisplayName(symbol);
  return {
    id: row.id,
    analysisRunId: row.ai_analysis_run_id ?? null,
    symbol,
    pairName: row.pair_name || getDisplayName(symbol),
    provider: "openai",
    model: row.model,
    bias: row.bias,
    tradeMode: row.trade_mode,
    confidence: row.confidence,
    calendarRisk: row.calendar_risk,
    decisionSummary: row.decision_summary,
    technicalSummary: row.technical_summary,
    fundamentalSummary: row.fundamental_summary,
    macroDrivers: row.macro_drivers ?? [],
    watchEvents: row.watch_events ?? [],
    riskFactors: row.risk_factors ?? [],
    generatedAt: row.generated_at,
    generatedTimezone: row.generated_timezone,
    sourceDataTimestamp: row.source_data_timestamp,
    triggerSource: row.trigger_source,
    isLatest: row.is_latest,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    summary,
    macroFundamentals: {
      bias: row.bias,
      drivers: row.macro_drivers ?? [],
      reasoning: row.fundamental_summary
    },
    economicCalendarImpact: {
      highImpactEvents: row.watch_events ?? [],
      expectedEffect: row.decision_summary,
      riskLevel: row.calendar_risk
    },
    keyRisks: row.risk_factors ?? []
  };
}
function hydrateSavedAnalysis(row) {
  const base2 = fromFlattenedRow({
    id: row.id,
    ai_analysis_run_id: row.ai_analysis_run_id,
    symbol: row.symbol,
    pair_name: row.pair_name,
    model: row.model,
    bias: row.bias,
    trade_mode: row.trade_mode,
    confidence: row.confidence,
    calendar_risk: row.calendar_risk,
    decision_summary: row.decision_summary,
    technical_summary: row.technical_summary,
    fundamental_summary: row.fundamental_summary,
    macro_drivers: row.macro_drivers,
    watch_events: row.watch_events,
    risk_factors: row.risk_factors,
    generated_at: row.generated_at,
    generated_timezone: row.generated_timezone,
    source_data_timestamp: row.source_data_timestamp,
    trigger_source: row.trigger_source,
    is_latest: row.is_latest,
    created_at: row.created_at,
    updated_at: row.updated_at,
    summary: "summary" in row ? row.summary : row.decision_summary
  });
  if (!("analysis_json" in row) || !row.analysis_json || typeof row.analysis_json !== "object") {
    return base2;
  }
  return {
    ...base2,
    ...row.analysis_json,
    id: row.analysis_json.id ?? base2.id,
    analysisRunId: row.analysis_json.analysisRunId ?? base2.analysisRunId,
    symbol: normalizeStoredSymbol(row.analysis_json.symbol ?? base2.symbol),
    pairName: row.analysis_json.pairName ?? base2.pairName,
    bias: row.analysis_json.bias ?? base2.bias,
    tradeMode: row.analysis_json.tradeMode ?? base2.tradeMode,
    confidence: row.analysis_json.confidence ?? base2.confidence,
    calendarRisk: row.analysis_json.calendarRisk ?? base2.calendarRisk,
    decisionSummary: row.analysis_json.decisionSummary ?? base2.decisionSummary,
    technicalSummary: row.analysis_json.technicalSummary ?? base2.technicalSummary,
    fundamentalSummary: row.analysis_json.fundamentalSummary ?? base2.fundamentalSummary,
    macroDrivers: row.analysis_json.macroDrivers ?? base2.macroDrivers,
    watchEvents: row.analysis_json.watchEvents ?? base2.watchEvents,
    riskFactors: row.analysis_json.riskFactors ?? base2.riskFactors,
    generatedAt: row.analysis_json.generatedAt ?? base2.generatedAt,
    generatedTimezone: row.analysis_json.generatedTimezone ?? base2.generatedTimezone,
    sourceDataTimestamp: row.analysis_json.sourceDataTimestamp ?? base2.sourceDataTimestamp,
    triggerSource: row.analysis_json.triggerSource ?? base2.triggerSource,
    isLatest: row.analysis_json.isLatest ?? base2.isLatest,
    summary: row.analysis_json.summary ?? base2.summary,
    macroFundamentals: {
      bias: row.analysis_json.macroFundamentals?.bias ?? base2.macroFundamentals.bias,
      drivers: row.analysis_json.macroFundamentals?.drivers ?? base2.macroFundamentals.drivers,
      reasoning: row.analysis_json.macroFundamentals?.reasoning ?? base2.macroFundamentals.reasoning
    },
    economicCalendarImpact: {
      highImpactEvents: row.analysis_json.economicCalendarImpact?.highImpactEvents ?? base2.economicCalendarImpact.highImpactEvents,
      expectedEffect: row.analysis_json.economicCalendarImpact?.expectedEffect ?? base2.economicCalendarImpact.expectedEffect,
      riskLevel: row.analysis_json.economicCalendarImpact?.riskLevel ?? base2.economicCalendarImpact.riskLevel
    },
    keyRisks: row.analysis_json.keyRisks ?? base2.keyRisks
  };
}
function toAggregatePayload(rows) {
  if (!rows.length) return null;
  const leader = rows.reduce((latest, row) => new Date(row.generatedAt).getTime() > new Date(latest.generatedAt).getTime() ? row : latest, rows[0]);
  return {
    ok: true,
    provider: "openai",
    model: leader.model,
    generatedAt: leader.generatedAt,
    generatedTimezone: leader.generatedTimezone,
    sourceDataTimestamp: leader.sourceDataTimestamp,
    triggerSource: leader.triggerSource,
    symbols: Object.fromEntries(rows.map((row) => [normalizeStoredSymbol(row.symbol), row]))
  };
}
function logStoreWarning(message, error) {
  const detail = error instanceof Error ? error.message : String(error);
  console.warn(`[ai-analysis-store] ${message}: ${detail}`);
}
function getAiAnalysisSymbols() {
  return [...AI_ANALYSIS_SYMBOLS];
}
async function createAiAnalysisRun(input) {
  if (!isDatabaseConfigured()) return null;
  const { data, error } = await supabase.from("ai_analysis_runs").insert({
    provider: input.provider,
    model: input.model,
    symbols: uniqueNormalizedSymbols(input.symbols ?? getAiAnalysisSymbols()),
    status: "running",
    trigger_source: input.triggerSource
  }).select("*").single();
  if (error) throw new Error(`Failed to create AI analysis run: ${error.message}`);
  return data;
}
async function updateAiAnalysisRun(id, input) {
  if (!isDatabaseConfigured()) return null;
  const patch = input.status === "success" ? {
    status: "success",
    analysis_json: input.analysis,
    generated_at: input.analysis.generatedAt,
    error_message: null
  } : {
    status: "failed",
    error_message: input.errorMessage
  };
  const { data, error } = await supabase.from("ai_analysis_runs").update(patch).eq("id", id).select("*").single();
  if (error) throw new Error(`Failed to update AI analysis run: ${error.message}`);
  return data;
}
async function saveToModernTable(input) {
  const symbols = uniqueNormalizedSymbols(input.items.map((item) => item.symbol));
  console.info("[ai-analysis-store] saving to ai_fundamental_analyses", { symbols, runId: input.runId });
  const { error: latestError } = await supabase.from("ai_fundamental_analyses").update({ is_latest: false }).in("symbol", symbols).eq("is_latest", true);
  if (latestError) throw new Error(latestError.message);
  const rows = input.items.map((item) => {
    const normalizedSymbol = normalizeStoredSymbol(item.symbol);
    const hydratedItem = {
      ...item,
      symbol: normalizedSymbol,
      pairName: item.pairName || getDisplayName(normalizedSymbol),
      isLatest: true
    };
    return {
      ai_analysis_run_id: input.runId,
      symbol: normalizedSymbol,
      pair_name: hydratedItem.pairName,
      provider: input.provider,
      model: input.model,
      status: "completed",
      bias: hydratedItem.bias,
      trade_mode: hydratedItem.tradeMode,
      confidence: hydratedItem.confidence,
      calendar_risk: hydratedItem.calendarRisk,
      summary: hydratedItem.summary,
      decision_summary: hydratedItem.decisionSummary,
      technical_summary: hydratedItem.technicalSummary,
      fundamental_summary: hydratedItem.fundamentalSummary,
      macro_drivers: hydratedItem.macroDrivers,
      watch_events: hydratedItem.watchEvents,
      risk_factors: hydratedItem.riskFactors,
      generated_at: hydratedItem.generatedAt,
      completed_at: hydratedItem.generatedAt,
      generated_timezone: hydratedItem.generatedTimezone,
      source_data_timestamp: hydratedItem.sourceDataTimestamp,
      trigger_source: hydratedItem.triggerSource,
      is_latest: true,
      analysis_json: hydratedItem
    };
  });
  const { data, error } = await supabase.from("ai_fundamental_analyses").insert(rows).select("*");
  if (error) throw new Error(error.message);
  const saved = data ?? [];
  console.info("[ai-analysis-store] saved to ai_fundamental_analyses", {
    count: saved.length,
    ids: saved.map((r) => r.id),
    symbols: saved.map((r) => r.symbol)
  });
  return saved;
}
async function saveToLegacyTable(input) {
  const payload = input.items.map((item) => ({
    symbol: normalizeStoredSymbol(item.symbol),
    pair_name: item.pairName,
    provider: input.provider,
    model: input.model,
    bias: item.bias,
    trade_mode: item.tradeMode,
    confidence: item.confidence,
    calendar_risk: item.calendarRisk,
    decision_summary: item.decisionSummary,
    technical_summary: item.technicalSummary,
    fundamental_summary: item.fundamentalSummary,
    macro_drivers: item.macroDrivers,
    watch_events: item.watchEvents,
    risk_factors: item.riskFactors,
    generated_at: item.generatedAt,
    generated_timezone: item.generatedTimezone,
    source_data_timestamp: item.sourceDataTimestamp,
    trigger_source: item.triggerSource
  }));
  const { data, error } = await supabase.rpc("save_ai_fundamentals_batch", {
    p_ai_analysis_run_id: input.runId,
    p_items: payload
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}
async function saveAiFundamentalsBatch(input) {
  if (!isDatabaseConfigured()) {
    console.warn("[ai-analysis-store] database not configured \u2014 skipping save");
    return [];
  }
  if (!input.items.length) return [];
  const symbols = input.items.map((i) => i.symbol).join(", ");
  console.info("[ai-analysis-store] saving AI fundamentals batch", { symbols, runId: input.runId, generatedAt: input.generatedAt });
  try {
    const result = await saveToModernTable(input);
    console.info("[ai-analysis-store] batch save completed via ai_fundamental_analyses", { count: result.length });
    return result;
  } catch (error) {
    logStoreWarning("modern save failed, falling back to saved_ai_fundamentals", error);
    const result = await saveToLegacyTable(input);
    console.info("[ai-analysis-store] batch save completed via saved_ai_fundamentals (legacy)", { count: result.length });
    return result;
  }
}
async function getLatestSuccessfulAiAnalysisRun() {
  if (!isDatabaseConfigured()) return null;
  const { data, error } = await supabase.from("ai_analysis_runs").select("*").eq("status", "success").order("generated_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
  if (error) {
    logStoreWarning("latest success lookup failed", error);
    return null;
  }
  return data ?? null;
}
async function getLatestModernRows() {
  const { data, error } = await supabase.from("ai_fundamental_analyses").select("*").eq("status", "completed").eq("is_latest", true).order("completed_at", { ascending: false, nullsFirst: false }).order("generated_at", { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(hydrateSavedAnalysis);
}
async function getLatestLegacyRows() {
  const { data, error } = await supabase.from("saved_ai_fundamentals").select("*").eq("is_latest", true).order("generated_at", { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(hydrateSavedAnalysis);
}
async function getLatestSavedAiAnalysis() {
  if (!isDatabaseConfigured()) return null;
  try {
    const modernRows = await getLatestModernRows();
    if (modernRows.length > 0) return toAggregatePayload(modernRows);
  } catch (error) {
    logStoreWarning("modern latest lookup failed, falling back to saved_ai_fundamentals", error);
  }
  return toAggregatePayload(await getLatestLegacyRows());
}
async function getLatestModernSymbol(symbol) {
  const { data, error } = await supabase.from("ai_fundamental_analyses").select("*").eq("symbol", normalizeStoredSymbol(symbol)).eq("status", "completed").eq("is_latest", true).order("completed_at", { ascending: false, nullsFirst: false }).order("generated_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? hydrateSavedAnalysis(data) : null;
}
async function getLatestLegacySymbol(symbol) {
  const { data, error } = await supabase.from("saved_ai_fundamentals").select("*").eq("symbol", normalizeStoredSymbol(symbol)).eq("is_latest", true).order("generated_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? hydrateSavedAnalysis(data) : null;
}
async function getLatestSavedAiAnalysisForSymbol(symbol) {
  if (!isDatabaseConfigured()) return null;
  const normalized = normalizeStoredSymbol(symbol);
  console.info("[ai-analysis-store] loading latest AI fundamentals", { symbol: normalized });
  try {
    const modernRow = await getLatestModernSymbol(symbol);
    if (modernRow) {
      console.info("[ai-analysis-store] found saved analysis in ai_fundamental_analyses", { symbol: normalized, generatedAt: modernRow.generatedAt });
      return modernRow;
    }
  } catch (error) {
    logStoreWarning(`modern latest symbol lookup failed for ${normalized}, falling back to saved_ai_fundamentals`, error);
  }
  const legacyRow = await getLatestLegacySymbol(symbol);
  if (legacyRow) {
    console.info("[ai-analysis-store] found saved analysis in saved_ai_fundamentals (legacy)", { symbol: normalized, generatedAt: legacyRow.generatedAt });
  } else {
    console.info("[ai-analysis-store] no completed saved analysis found", { symbol: normalized });
  }
  return legacyRow;
}

// src/services/intelligence/intermarketCorrelation.ts
function getCorrelatedSymbols(_symbol) {
  return [];
}
function buildCorrelationContext(symbol, _bias, _entries) {
  return { symbol, signals: [], totalConfidenceDelta: 0, macroSummary: "", correlations: [] };
}

// backend/server/services/pairAnalysis.service.ts
var TIMEFRAMES2 = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"];
var TIMEFRAME_WEIGHTS = {
  "1m": 1,
  "5m": 1,
  "15m": 2,
  "30m": 2,
  "1h": 3,
  "4h": 4,
  "1d": 5
};
async function computeSingleTimeframeBias(symbol, tf) {
  return {
    timeframe: tf,
    bias: "unknown",
    confidence: 0,
    latestClose: null,
    lastCandleTime: null,
    reason: "MT5 bridge candle feed unavailable for this timeframe."
  };
}
var TF_BIAS_CACHE_TTL_MS = 3 * 60 * 1e3;
async function computeAllTimeframeBiases(symbol) {
  const cacheKey2 = `tf-bias:${normalizeApiSymbol(symbol)}`;
  const cached = get(cacheKey2);
  if (cached) return cached;
  const result = await Promise.all(TIMEFRAMES2.map((tf) => computeSingleTimeframeBias(symbol, tf)));
  set(cacheKey2, result, TF_BIAS_CACHE_TTL_MS);
  return result;
}
function deriveWeightedBias(biases) {
  let weightedScore = 0;
  let totalWeight = 0;
  let confidenceSum = 0;
  let confidenceCount = 0;
  for (const b of biases) {
    if (b.bias === "unknown") continue;
    const w = TIMEFRAME_WEIGHTS[b.timeframe];
    let score = 0;
    if (b.bias === "bullish") score = 1;
    else if (b.bias === "bearish") score = -1;
    weightedScore += score * w;
    totalWeight += w;
    confidenceSum += b.confidence * w;
    confidenceCount += w;
  }
  if (totalWeight === 0) return { bias: "unknown", confidence: 0 };
  const norm = weightedScore / totalWeight;
  const intradayBiases = biases.filter((b) => ["1m", "5m", "15m", "30m", "1h"].includes(b.timeframe));
  const higherBiases = biases.filter((b) => ["4h", "1d"].includes(b.timeframe));
  const intradayScore = directionalAverage(intradayBiases);
  const higherScore = directionalAverage(higherBiases);
  const conflict = intradayScore !== 0 && higherScore !== 0 && Math.sign(intradayScore) !== Math.sign(higherScore);
  let bias = "neutral";
  if (norm > 0.15) bias = "bullish";
  else if (norm < -0.15) bias = "bearish";
  if (conflict || Math.abs(norm) <= 0.15 && hasDirectionalConflict(biases)) bias = "mixed";
  const confidence = confidenceCount > 0 ? Math.round(confidenceSum / confidenceCount) : 0;
  return { bias, confidence };
}
function directionalAverage(biases) {
  const directional = biases.filter((b) => b.bias === "bullish" || b.bias === "bearish");
  if (!directional.length) return 0;
  return directional.reduce((sum, b) => sum + (b.bias === "bullish" ? 1 : -1), 0) / directional.length;
}
function hasDirectionalConflict(biases) {
  return biases.some((b) => b.bias === "bullish") && biases.some((b) => b.bias === "bearish");
}
function inferMarketStatus(timestamp) {
  if (!timestamp) return "unknown";
  const date = new Date(timestamp);
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return "closed";
  return "open";
}
function computeStaleMinutes(updatedAt) {
  if (!updatedAt) return null;
  const t = new Date(updatedAt).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 6e4));
}
function buildPricePayload(args) {
  const quote = args.quote;
  const current = quote?.mid ?? null;
  const previousClose = quote && quote.change != null ? quote.mid - quote.change : null;
  const change = quote?.change ?? (current != null && previousClose != null ? current - previousClose : null);
  const changePercent = quote?.changePct ?? (change != null && previousClose ? change / previousClose * 100 : null);
  const source = current != null ? args.source ?? "mt5-bridge" : "Unavailable";
  let updatedAt = null;
  if (quote?.timestamp) updatedAt = new Date(quote.timestamp).toISOString();
  return {
    current,
    bid: quote?.bid ?? null,
    ask: quote?.ask ?? null,
    change,
    changePercent,
    previousClose,
    dayHigh: quote?.high ?? null,
    dayLow: quote?.low ?? null,
    marketStatus: inferMarketStatus(quote?.timestamp ?? null),
    source,
    updatedAt,
    staleMinutes: computeStaleMinutes(updatedAt),
    unavailableReason: current == null ? args.unavailableReason ?? "Price unavailable \u2014 check MT5 bridge quote feed." : args.unavailableReason
  };
}
async function fetchPriceContext(symbol) {
  const apiSymbol = normalizeApiSymbol(symbol);
  let quote = null;
  let source = "market-data";
  let unavailableReason;
  try {
    const latest = await getLatestMarketPrice(apiSymbol);
    if (latest.price != null) {
      quote = {
        mid: latest.price,
        bid: latest.bid,
        ask: latest.ask,
        change: latest.change,
        changePct: latest.changePercent,
        high: latest.high,
        low: latest.low,
        timestamp: latest.timestampMs
      };
      source = latest.provider;
    } else {
      unavailableReason = latest.error ?? latest.warning ?? `MT5 bridge quote unavailable for ${apiSymbol}.`;
    }
  } catch (err) {
    console.warn(`[pairAnalysis] unified market quote failed for ${apiSymbol}:`, err instanceof Error ? err.message : err);
    unavailableReason = err instanceof Error ? err.message : `MT5 bridge quote unavailable for ${apiSymbol}.`;
  }
  return buildPricePayload({ quote, source, unavailableReason });
}
function mapScoredArticle(scored) {
  const a = scored.article;
  return {
    id: a.id,
    source: a.source,
    title: a.title,
    summary: a.summary ?? null,
    contentSnippet: a.contentSnippet ?? null,
    impact: a.impact,
    sentiment: a.sentiment,
    affectedCurrencies: a.affectedCurrencies,
    affectedSymbols: a.affectedSymbols,
    aiSummary: a.aiSummary ?? null,
    publishedAt: a.publishedAt,
    relevanceScore: scored.relevanceScore,
    biasImpact: scored.biasImpact,
    whyItMatters: scored.whyItMatters
  };
}
function mapScoredEvent(scored) {
  const e = scored.event;
  return {
    id: e.id,
    eventName: e.eventName,
    currency: e.currency,
    impact: e.impact,
    eventTime: e.eventTime,
    previous: e.previous ?? null,
    forecast: e.forecast ?? null,
    actual: e.actual ?? null,
    tradeWarning: e.tradeWarning ?? "none",
    relevance: scored.relevance,
    minutesUntil: scored.minutesUntil,
    isFuture: scored.isFuture
  };
}
function mapStoredAnalysisToIntelligence(apiSymbol, saved, technicalSummary, fundamentalSummary, hasNearHighImpactEvent) {
  return {
    symbol: apiSymbol,
    overallBias: saved.bias,
    biasPercentage: Math.max(0, Math.min(100, saved.confidence)),
    technicalBias: {
      direction: saved.bias,
      percentage: Math.max(0, Math.min(100, saved.confidence)),
      summary: saved.technicalSummary || technicalSummary
    },
    fundamentalBias: {
      direction: saved.macroFundamentals.bias,
      percentage: Math.max(0, Math.min(100, saved.confidence)),
      summary: saved.fundamentalSummary || saved.macroFundamentals.reasoning || fundamentalSummary
    },
    newsImpact: {
      direction: saved.bias,
      percentage: saved.economicCalendarImpact.riskLevel === "high" ? 80 : saved.economicCalendarImpact.riskLevel === "medium" ? 60 : 40,
      summary: saved.decisionSummary || saved.economicCalendarImpact.expectedEffect
    },
    tradeStatus: hasNearHighImpactEvent || saved.calendarRisk === "high" || saved.tradeMode === "avoid" ? "high_risk" : "wait",
    summary: saved.decisionSummary || saved.summary,
    bullishDrivers: saved.bias === "bullish" ? saved.macroDrivers : [],
    bearishDrivers: saved.bias === "bearish" ? saved.macroDrivers : [],
    risks: saved.riskFactors,
    invalidation: saved.decisionSummary || "Watch the latest macro event slate and invalidate on fresh opposing data.",
    tradePlan: {
      preferredDirection: saved.tradeMode === "favor_buys" ? "long" : saved.tradeMode === "favor_sells" ? "short" : "stand aside",
      entryConditions: ["Wait for price action confirmation around your planned level."],
      avoidConditions: saved.riskFactors.length ? saved.riskFactors.slice(0, 3) : ["Avoid trading into unresolved high-impact events."],
      riskNotes: saved.decisionSummary || saved.summary
    }
  };
}
async function preparePairAnalysisContext(symbol, options) {
  const apiSymbol = normalizeApiSymbol(symbol);
  const displaySymbol = normalizeDisplaySymbol(apiSymbol);
  const enabled = isEnabledPair(apiSymbol);
  await bootstrapFundamentals();
  if (options?.forceRefresh) {
    await refreshFundamentalsData();
  }
  const pairData = getFundamentalsForSymbol(displaySymbol);
  const hasData = pairData.relatedArticles.length > 0 || pairData.relatedEvents.length > 0;
  if (!hasData) {
    await refreshFundamentalsData();
  }
  const refreshedPairData = getFundamentalsForSymbol(displaySymbol);
  const allNews = getFundamentalsNews();
  const allEvents = getFundamentalsEvents();
  const sourceStatus = getFundamentalSourceStatus();
  const price = await fetchPriceContext(apiSymbol);
  const latestNews = getLatestNewsForSymbol(displaySymbol, allNews);
  const centralBankDrivers = getCentralBankDriversForSymbol(displaySymbol, allNews);
  const politicalDrivers = getPoliticalDriversForSymbol(displaySymbol, allNews);
  const scoredArticles = scoreNewsRelevanceForPair(allNews, apiSymbol);
  const topRelevantNews = scoredArticles.slice(0, 8).map(mapScoredArticle);
  const newsImpact = summarizeNewsImpact(scoredArticles.slice(0, 8));
  const scoredEvents = filterEventsForPair(allEvents, apiSymbol);
  const relevantEvents = scoredEvents.slice(0, 8).map(mapScoredEvent);
  const nextHighImpactScored = findNextHighImpact(scoredEvents);
  const nextHighImpactEvent = nextHighImpactScored ? mapScoredEvent(nextHighImpactScored) : null;
  const latestBias = refreshedPairData.latestBias;
  const technical = buildTechnicalSummary({
    symbol: displaySymbol,
    currentPrice: price.current,
    previousClose: price.previousClose,
    dayHigh: price.dayHigh,
    dayLow: price.dayLow,
    fundamentalBias: latestBias?.bias ?? "unknown"
  });
  const { bullishDrivers, bearishDrivers } = inferBullishBearishDrivers(displaySymbol, latestNews);
  const fundamentals = {
    bias: latestBias?.bias ?? "unknown",
    confidence: latestBias?.confidence ?? 0,
    impact: latestBias?.impact ?? "unknown",
    tradeStatus: latestBias?.tradeStatus ?? "unknown",
    summary: buildFundamentalSummary({
      symbol: displaySymbol,
      bias: latestBias?.bias ?? "unknown",
      reason: latestBias?.reason ?? "No saved analysis yet. Click Generate Analysis to fetch current price, latest macro headlines, and create a pair-specific fundamental view.",
      currentPrice: price.current,
      dailyChangePercent: price.changePercent,
      technicalTrend: technical.trend
    }),
    reason: latestBias?.reason ?? "No saved analysis yet. Click Generate Analysis to fetch current price, latest macro headlines, and create a pair-specific fundamental view.",
    keyDrivers: latestBias?.keyDrivers ?? [],
    bullishDrivers,
    bearishDrivers,
    risks: [
      "Headline volatility can reverse short-term bias quickly.",
      "High-impact data and central bank commentary can invalidate the current read.",
      technical.trend === "unknown" ? "Technical confirmation is limited because price context is incomplete." : "Fundamental and technical context should be checked together before acting."
    ],
    lastUpdated: latestBias?.updatedAt ?? null,
    mode: isOpenAIConfigured() ? "ai-enhanced" : "rules-based"
  };
  const timeframeBiases = await computeAllTimeframeBiases(symbol);
  const overall = deriveWeightedBias(timeframeBiases);
  const correlatedSymbols = getCorrelatedSymbols(apiSymbol);
  const correlatedBiasEntries = await Promise.all(
    correlatedSymbols.map(async (sym) => {
      const biases = await computeAllTimeframeBiases(sym);
      const derived = deriveWeightedBias(biases);
      return { symbol: sym, bias: derived.bias, confidence: derived.confidence };
    })
  );
  const correlationCtx = buildCorrelationContext(apiSymbol, overall.bias, correlatedBiasEntries);
  const macroFocus = getMacroFocusForSymbol(apiSymbol);
  const fundamentalDriversList = getFundamentalDriversForSymbol(apiSymbol);
  const intelligenceContext = {
    symbol: apiSymbol,
    displaySymbol,
    currentPrice: price.current,
    marketStatus: price.marketStatus,
    priceStaleMinutes: price.staleMinutes,
    overallBias: overall.bias,
    overallConfidence: overall.confidence,
    timeframeBiases: timeframeBiases.map((b) => ({
      timeframe: b.timeframe,
      bias: b.bias,
      confidence: b.confidence,
      reason: b.reason
    })),
    technicalSummary: technical.summary,
    fundamentalSummary: fundamentals.summary,
    topRelevantNews: topRelevantNews.slice(0, 4).map((n) => ({
      title: n.title.slice(0, 140),
      summary: (n.summary ?? n.contentSnippet ?? n.whyItMatters).slice(0, 220),
      relevanceScore: n.relevanceScore,
      biasImpact: n.biasImpact,
      whyItMatters: n.whyItMatters.slice(0, 160)
    })),
    upcomingHighImpactEvents: scoredEvents.filter((s) => s.isFuture && s.event.impact === "high" && s.relevance !== "low").slice(0, 4).map((s) => ({
      eventName: s.event.eventName,
      currency: s.event.currency,
      impact: s.event.impact,
      eventTime: s.event.eventTime,
      minutesUntil: s.minutesUntil
    })),
    macroDrivers: macroFocus.slice(0, 6),
    fundamentalDrivers: fundamentalDriversList.slice(0, 6),
    correlationSignals: correlationCtx.signals.map((s) => ({
      relatedSymbol: s.relatedSymbol,
      relationship: s.relationship,
      status: s.status,
      confidenceDelta: s.confidenceDelta,
      explanation: s.explanation.slice(0, 180)
    })),
    correlationConfidenceDelta: correlationCtx.totalConfidenceDelta,
    correlationMacroSummary: correlationCtx.macroSummary.slice(0, 220)
  };
  return {
    apiSymbol,
    displaySymbol,
    enabled,
    price,
    fundamentals,
    technical,
    newsImpact: {
      direction: newsImpact.direction === "mixed" ? "mixed" : newsImpact.direction,
      percentage: newsImpact.percentage,
      summary: newsImpact.summary
    },
    topRelevantNews,
    relevantEvents,
    nextHighImpactEvent,
    macroFocus,
    fundamentalDriversList,
    latestNews,
    centralBankDrivers,
    politicalDrivers,
    sourceStatus,
    timeframeBiases,
    overallBias: overall.bias,
    overallConfidence: overall.confidence,
    macroCorrelation: correlationCtx,
    intelligenceContext,
    promptSizeEstimate: JSON.stringify(intelligenceContext).length
  };
}
async function getPairAiDebugSnapshot(symbol, options) {
  logOpenAIConfiguration();
  const prepared = await preparePairAnalysisContext(symbol, options);
  return {
    openaiKeyConfigured: isOpenAIConfigured(),
    model: getOpenAIModel(),
    symbol: prepared.apiSymbol,
    pairContextLoaded: true,
    fundamentalsLoaded: true,
    promptSizeEstimate: prepared.promptSizeEstimate,
    timeoutConfigured: getPairAiTimeoutMs()
  };
}
async function buildPairAnalysis(symbol, options) {
  const startedAt = Date.now();
  const apiSymbol = normalizeApiSymbol(symbol);
  const model = getOpenAIModel();
  logOpenAIConfiguration();
  console.log("[pair-ai] analysis requested", { symbol: apiSymbol });
  options?.onStageChange?.("preparing_pair_snapshot");
  console.log("[pair-ai] loading pair technical context", { symbol: apiSymbol });
  options?.onStageChange?.("loading_fundamentals");
  console.log("[pair-ai] loading fundamentals context", { symbol: apiSymbol });
  const prepared = await preparePairAnalysisContext(symbol, { forceRefresh: options?.forceRefresh });
  let intelligence;
  const savedAnalysis = options?.preferSavedAi === false ? null : await getLatestSavedAiAnalysisForSymbol(prepared.apiSymbol);
  if (savedAnalysis) {
    intelligence = mapStoredAnalysisToIntelligence(
      prepared.apiSymbol,
      savedAnalysis,
      prepared.technical.summary,
      prepared.fundamentals.summary,
      prepared.relevantEvents.some((s) => s.isFuture && s.impact === "high" && s.minutesUntil <= 60)
    );
  } else if (options?.allowLiveAI) {
    options?.onStageChange?.("running_ai_analysis");
    console.log("[pair-ai] calling OpenAI", { model });
    intelligence = await buildPairIntelligenceAI(prepared.intelligenceContext);
    console.log("[pair-ai] OpenAI analysis completed", { symbol: prepared.apiSymbol, durationMs: Date.now() - startedAt });
  } else {
    intelligence = fallbackIntelligence(prepared.intelligenceContext);
  }
  options?.onStageChange?.("finalizing_verdict");
  const tradeStatus = calculateTradeStatus({
    overallBias: prepared.overallBias === "unknown" ? "unknown" : prepared.overallBias,
    technicalBias: intelligence.technicalBias.direction,
    fundamentalBias: intelligence.fundamentalBias.direction,
    marketStatus: prepared.price.marketStatus,
    priceStaleMinutes: prepared.price.staleMinutes,
    highImpactWithinMinutes: prepared.nextHighImpactEvent?.minutesUntil ?? null,
    overallConfidence: prepared.overallConfidence
  });
  return {
    symbol: prepared.apiSymbol,
    displaySymbol: prepared.displaySymbol,
    displayName: getDisplayName(prepared.apiSymbol),
    assetClass: getAssetClass(prepared.apiSymbol),
    enabled: prepared.enabled,
    price: prepared.price,
    fundamentals: prepared.fundamentals,
    technical: prepared.technical,
    intelligence,
    newsImpactSummary: prepared.newsImpact,
    topRelevantNews: prepared.topRelevantNews,
    relevantEvents: prepared.relevantEvents,
    nextHighImpactEvent: prepared.nextHighImpactEvent,
    tradeStatus,
    macroFocus: prepared.macroFocus,
    fundamentalDriversList: prepared.fundamentalDriversList,
    latestNews: prepared.latestNews,
    centralBankDrivers: prepared.centralBankDrivers,
    politicalDrivers: prepared.politicalDrivers,
    sourceStatus: prepared.sourceStatus,
    timeframeBiases: prepared.timeframeBiases,
    overallBias: prepared.overallBias,
    overallConfidence: prepared.overallConfidence,
    macroCorrelation: prepared.macroCorrelation
  };
}

// backend/server/services/fundamentalsAiSchedule.service.ts
var FUNDAMENTALS_AI_TIMEZONE = "Europe/Madrid";
var FUNDAMENTALS_AI_SCHEDULE_HOURS = [7, 13, 15];
function zonedParts(date, timeZone = FUNDAMENTALS_AI_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23"
  }).formatToParts(date);
  const get2 = (type) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const weekdayLabel = parts.find((part) => part.type === "weekday")?.value ?? "Mon";
  const weekdayMap = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7
  };
  return {
    year: get2("year"),
    month: get2("month"),
    day: get2("day"),
    hour: get2("hour"),
    minute: get2("minute"),
    second: get2("second"),
    weekday: weekdayMap[weekdayLabel] ?? 1
  };
}
function utcDateForZonedTime(year, month, day, hour, minute, second = 0, timeZone = FUNDAMENTALS_AI_TIMEZONE) {
  const approximateUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const local = zonedParts(approximateUtc, timeZone);
  const targetMinutes = hour * 60 + minute;
  const actualMinutes = local.hour * 60 + local.minute;
  return new Date(approximateUtc.getTime() + (targetMinutes - actualMinutes) * 6e4);
}
function advanceOneMadridDay(date, timeZone = FUNDAMENTALS_AI_TIMEZONE) {
  const parts = zonedParts(date, timeZone);
  const anchor = utcDateForZonedTime(parts.year, parts.month, parts.day, 23, 59, 59, timeZone);
  return new Date(anchor.getTime() + 1e3);
}
function getFundamentalsAiTimezone() {
  return FUNDAMENTALS_AI_TIMEZONE;
}
function getFundamentalsAiScheduleHours() {
  return [...FUNDAMENTALS_AI_SCHEDULE_HOURS];
}
function getNextFundamentalsAiRun(now2 = /* @__PURE__ */ new Date()) {
  let cursor = now2;
  for (let dayOffset = 0; dayOffset < 8; dayOffset += 1) {
    const parts = zonedParts(cursor);
    const isWeekday = parts.weekday >= 1 && parts.weekday <= 5;
    if (isWeekday) {
      for (const hour of FUNDAMENTALS_AI_SCHEDULE_HOURS) {
        const candidate = utcDateForZonedTime(parts.year, parts.month, parts.day, hour, 0);
        if (candidate.getTime() > now2.getTime()) {
          return candidate;
        }
      }
    }
    cursor = advanceOneMadridDay(cursor);
  }
  return advanceOneMadridDay(now2);
}
function getFundamentalsAiScheduleStatus(now2 = /* @__PURE__ */ new Date()) {
  const parts = zonedParts(now2);
  const madridIso = utcDateForZonedTime(parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second).toISOString();
  const isWeekday = parts.weekday >= 1 && parts.weekday <= 5;
  const matchedHour = FUNDAMENTALS_AI_SCHEDULE_HOURS.find((hour) => hour === parts.hour) ?? null;
  const matchedMinute = parts.minute === 0;
  if (!isWeekday) {
    return {
      allowed: false,
      reason: "Scheduled AI analysis only runs Monday to Friday in Europe/Madrid.",
      currentMadridIso: madridIso,
      currentWeekday: parts.weekday,
      matchedHour: null
    };
  }
  if (matchedHour == null || !matchedMinute) {
    return {
      allowed: false,
      reason: "Scheduled AI analysis only runs at 07:00, 13:00, and 15:00 Europe/Madrid.",
      currentMadridIso: madridIso,
      currentWeekday: parts.weekday,
      matchedHour
    };
  }
  return {
    allowed: true,
    reason: null,
    currentMadridIso: madridIso,
    currentWeekday: parts.weekday,
    matchedHour
  };
}

// backend/server/services/aiAnalysisRuns.service.ts
var PROVIDER = "openai";
var MANUAL_COOLDOWN_MS = 5 * 6e4;
function getAiAnalysisModel() {
  return process.env.OPENAI_MODEL ?? "gpt-4o-mini";
}
function getAiAnalysisTimezone() {
  return process.env.AI_ANALYSIS_TIMEZONE ?? getFundamentalsAiTimezone();
}
var inFlightRun = null;
var inFlightSymbols = [];
var lastManualRunAt = 0;
var lastManualRunBySymbol = /* @__PURE__ */ new Map();
var lastSavedFallback = null;
function uniqueStrings(values) {
  const seen = /* @__PURE__ */ new Set();
  const output = [];
  for (const value of values) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(trimmed);
  }
  return output;
}
function normalizeAnalysisSymbols(symbols) {
  const raw = symbols?.length ? symbols : getAiAnalysisSymbols();
  return [...new Set(raw.map((symbol) => normalizeApiSymbol(symbol)).filter(Boolean))];
}
function toCalendarRiskLevel(payload) {
  if (payload.nextHighImpactEvent || payload.tradeStatus.status === "high_risk") return "high";
  if (payload.relevantEvents.some((event) => event.impact === "high" || event.relevance === "high")) return "medium";
  return "low";
}
function summarizeWatchEvents(payload) {
  return uniqueStrings([
    ...payload.relevantEvents.filter((event) => event.impact === "high").slice(0, 4).map((event) => {
      const when = event.minutesUntil >= 0 ? ` in ${event.minutesUntil}m` : "";
      return `${event.currency ?? "Macro"} ${event.eventName}${when}`;
    }),
    ...payload.topRelevantNews.slice(0, 2).map((item) => item.title)
  ]);
}
function deriveTradeMode(payload) {
  if (payload.fundamentals.tradeStatus === "avoid") return "avoid";
  if (payload.fundamentals.tradeStatus === "wait") return "wait";
  if (payload.tradeStatus.status === "high_risk") return "avoid";
  if (payload.intelligence.overallBias === "bullish") return "favor_buys";
  if (payload.intelligence.overallBias === "bearish") return "favor_sells";
  return "wait";
}
function mapBias(value) {
  return value === "bullish" || value === "bearish" ? value : "neutral";
}
function toSavedSymbolAnalysis(payload, generatedAt, sourceDataTimestamp, triggerSource) {
  const bias = mapBias(payload.intelligence.overallBias);
  const macroBias = mapBias(payload.intelligence.fundamentalBias.direction);
  const calendarRisk = toCalendarRiskLevel(payload);
  const watchEvents = summarizeWatchEvents(payload);
  const macroDrivers = uniqueStrings([
    ...payload.fundamentals.keyDrivers,
    ...payload.macroFocus,
    ...payload.fundamentalDriversList,
    ...payload.intelligence.bullishDrivers,
    ...payload.intelligence.bearishDrivers
  ]).slice(0, 8);
  const riskFactors = uniqueStrings([
    ...payload.intelligence.risks,
    ...payload.fundamentals.risks
  ]).slice(0, 6);
  return {
    symbol: payload.symbol,
    pairName: payload.displayName,
    provider: PROVIDER,
    model: getAiAnalysisModel(),
    bias,
    tradeMode: deriveTradeMode(payload),
    confidence: Math.max(0, Math.min(100, payload.intelligence.biasPercentage)),
    calendarRisk,
    decisionSummary: payload.intelligence.summary || payload.fundamentals.summary,
    technicalSummary: payload.technical.summary,
    fundamentalSummary: payload.fundamentals.summary,
    macroDrivers,
    watchEvents,
    riskFactors,
    generatedAt,
    generatedTimezone: getAiAnalysisTimezone(),
    sourceDataTimestamp,
    triggerSource,
    isLatest: true,
    summary: payload.intelligence.summary || payload.fundamentals.summary,
    macroFundamentals: {
      bias: macroBias,
      drivers: macroDrivers,
      reasoning: payload.intelligence.fundamentalBias.summary || payload.fundamentals.summary
    },
    economicCalendarImpact: {
      highImpactEvents: watchEvents,
      expectedEffect: payload.newsImpactSummary.summary || payload.intelligence.summary,
      riskLevel: calendarRisk
    },
    keyRisks: riskFactors
  };
}
function toSavedPayload(items, generatedAt, sourceDataTimestamp, triggerSource) {
  return {
    ok: true,
    provider: PROVIDER,
    model: getAiAnalysisModel(),
    generatedAt,
    generatedTimezone: getAiAnalysisTimezone(),
    sourceDataTimestamp,
    triggerSource,
    symbols: Object.fromEntries(items.map((item) => [item.symbol, item]))
  };
}
function zonedDateParts(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: getAiAnalysisTimezone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23"
  }).formatToParts(date);
  const get2 = (type) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const weekdayLabel = parts.find((part) => part.type === "weekday")?.value ?? "Mon";
  const weekdayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    year: get2("year"),
    month: get2("month"),
    day: get2("day"),
    hour: get2("hour"),
    minute: get2("minute"),
    second: get2("second"),
    weekday: weekdayMap[weekdayLabel] ?? 1
  };
}
function utcDateForZonedTime2(year, month, day, hour, minute, second = 0) {
  const approximateUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const local = zonedDateParts(approximateUtc);
  const actualMinutes = local.hour * 60 + local.minute;
  const targetMinutes = hour * 60 + minute;
  const diffMinutes = targetMinutes - actualMinutes;
  return new Date(approximateUtc.getTime() + diffMinutes * 6e4);
}
function deriveTriggerSource(trigger, date = /* @__PURE__ */ new Date()) {
  if (trigger === "manual") return "manual";
  if (trigger === "startup") return "startup";
  const parts = zonedDateParts(date);
  if (parts.hour >= 15) return "scheduled_15";
  if (parts.hour >= 13) return "scheduled_13";
  return "scheduled_07";
}
function computeNextScheduledRun(now2 = /* @__PURE__ */ new Date()) {
  return getNextFundamentalsAiRun(now2).toISOString();
}
function computeIsStale(generatedAt, now2 = /* @__PURE__ */ new Date()) {
  if (!generatedAt) return true;
  const generated = new Date(generatedAt);
  if (Number.isNaN(generated.getTime())) return true;
  const currentParts = zonedDateParts(now2);
  const scheduleHours = getFundamentalsAiScheduleHours();
  const latestSlotToday = [...scheduleHours].reverse().find((hour) => currentParts.hour >= hour);
  if (latestSlotToday == null) {
    const previousDay = new Date(now2.getTime() - 24 * 60 * 6e4);
    let cursor = previousDay;
    for (let i = 0; i < 7; i += 1) {
      const prev = zonedDateParts(cursor);
      if (prev.weekday >= 1 && prev.weekday <= 5) {
        const lastHour = scheduleHours[scheduleHours.length - 1] ?? 15;
        const previousExpected = utcDateForZonedTime2(prev.year, prev.month, prev.day, lastHour, 0);
        return generated.getTime() < previousExpected.getTime();
      }
      cursor = new Date(cursor.getTime() - 24 * 60 * 6e4);
    }
    return true;
  }
  const latestExpected = utcDateForZonedTime2(currentParts.year, currentParts.month, currentParts.day, latestSlotToday, 0);
  return generated.getTime() < latestExpected.getTime();
}
async function loadLatestAvailable() {
  const latest = await getLatestSavedAiAnalysis();
  if (latest) lastSavedFallback = latest;
  return latest ?? lastSavedFallback;
}
function isSymbolInFlight(symbol) {
  const normalized = normalizeApiSymbol(symbol);
  return inFlightRun !== null && inFlightSymbols.includes(normalized);
}
function computeStatus(inflight, analysis) {
  if (inflight !== null) return "running";
  if (analysis) return "idle";
  return "missing";
}
function invalidateAnalysisCaches() {
  delByPrefix("pair-intel-ai:");
  delByPrefix("tf-bias:");
}
async function getLatestSavedAnalysisForSymbols(symbols) {
  const rows = await Promise.all(symbols.map((symbol) => getLatestSavedAiAnalysisForSymbol(symbol)));
  return rows.filter((row) => Boolean(row));
}
async function getLatestAiAnalysisResponse() {
  const analysis = await loadLatestAvailable();
  const row = analysis ? null : await getLatestSuccessfulAiAnalysisRun();
  const generatedAt = analysis?.generatedAt ?? row?.generated_at ?? null;
  return {
    analysis,
    generatedAt,
    generatedTimezone: analysis?.generatedTimezone ?? null,
    sourceDataTimestamp: analysis?.sourceDataTimestamp ?? null,
    triggerSource: analysis?.triggerSource ?? null,
    provider: analysis?.provider ?? row?.provider ?? null,
    model: analysis?.model ?? row?.model ?? null,
    isStale: computeIsStale(generatedAt),
    nextScheduledRun: computeNextScheduledRun(),
    status: computeStatus(inFlightRun, analysis)
  };
}
async function getLatestAiAnalysisForSymbolResponse(symbol) {
  const normalized = normalizeApiSymbol(symbol);
  const analysis = await getLatestSavedAiAnalysisForSymbol(normalized);
  return {
    symbol: normalized,
    analysis,
    generatedAt: analysis?.generatedAt ?? null,
    generatedTimezone: analysis?.generatedTimezone ?? null,
    sourceDataTimestamp: analysis?.sourceDataTimestamp ?? null,
    triggerSource: analysis?.triggerSource ?? null,
    provider: analysis?.provider ?? null,
    model: analysis?.model ?? null,
    isStale: computeIsStale(analysis?.generatedAt ?? null),
    nextScheduledRun: computeNextScheduledRun(),
    status: isSymbolInFlight(normalized) ? "running" : analysis ? "idle" : "missing"
  };
}
function getRunJobStatus() {
  return {
    status: computeStatus(inFlightRun, lastSavedFallback),
    latestAvailable: lastSavedFallback,
    generatedAt: lastSavedFallback?.generatedAt ?? null,
    symbols: [...inFlightSymbols]
  };
}
async function getManualCooldownState(symbols) {
  if (symbols.length === 1) {
    const symbol = symbols[0];
    const dbRow2 = await getLatestSavedAiAnalysisForSymbol(symbol).catch(() => null);
    const dbRunTime2 = dbRow2?.generatedAt ? new Date(dbRow2.generatedAt).getTime() : 0;
    const localRunTime = lastManualRunBySymbol.get(symbol) ?? 0;
    const effectiveLastRunAt = Math.max(dbRunTime2, localRunTime);
    return { symbol, effectiveLastRunAt };
  }
  const dbRow = await getLatestSuccessfulAiAnalysisRun().catch(() => null);
  const dbRunTime = dbRow?.generated_at ? new Date(dbRow.generated_at).getTime() : 0;
  return { symbol: null, effectiveLastRunAt: Math.max(lastManualRunAt, dbRunTime) };
}
async function runAiAnalysis(options) {
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  const triggerSource = deriveTriggerSource(options.trigger, new Date(startedAt));
  const symbols = normalizeAnalysisSymbols(options.symbols);
  if (inFlightRun !== null) {
    return {
      ...await inFlightRun,
      reusedExistingRun: true
    };
  }
  if (options.trigger === "manual" && !options.bypassCooldown) {
    const { effectiveLastRunAt } = await getManualCooldownState(symbols);
    const msSinceLastRun = Date.now() - effectiveLastRunAt;
    if (msSinceLastRun < MANUAL_COOLDOWN_MS) {
      const cachedRows = await getLatestSavedAnalysisForSymbols(symbols);
      const cachedAnalysis = cachedRows.length ? toSavedPayload(
        cachedRows,
        cachedRows.reduce((latest, row) => new Date(row.generatedAt).getTime() > new Date(latest).getTime() ? row.generatedAt : latest, cachedRows[0].generatedAt),
        cachedRows[0]?.sourceDataTimestamp ?? null,
        cachedRows[0]?.triggerSource ?? "manual"
      ) : await loadLatestAvailable() ?? null;
      const expiresInSec = Math.round((MANUAL_COOLDOWN_MS - msSinceLastRun) / 1e3);
      console.info("[ai-analysis] cooldown hit", {
        model: getAiAnalysisModel(),
        symbols: symbols.join(", "),
        expiresIn: `${expiresInSec}s`
      });
      return {
        ok: true,
        startedAt,
        finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
        trigger: options.trigger,
        triggerSource,
        provider: PROVIDER,
        model: getAiAnalysisModel(),
        analysis: cachedAnalysis,
        latestAvailable: cachedAnalysis,
        symbols,
        cooldownActive: true,
        reusedExistingRun: true,
        error: "Manual AI analysis cooldown is active. Please wait a few minutes before running it again.",
        timezone: getAiAnalysisTimezone(),
        nextRun: computeNextScheduledRun()
      };
    }
  }
  inFlightSymbols = symbols;
  const runPromise = (async () => {
    const latestAvailable = await loadLatestAvailable();
    const dbRun = await createAiAnalysisRun({
      provider: PROVIDER,
      model: getAiAnalysisModel(),
      triggerSource: options.trigger,
      symbols
    }).catch((error) => {
      console.warn("[ai-analysis] failed to create DB run row:", error instanceof Error ? error.message : String(error));
      return null;
    });
    try {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY is not configured.");
      }
      console.info("[ai-analysis] run started", {
        provider: PROVIDER,
        model: getAiAnalysisModel(),
        trigger: options.trigger,
        triggerSource,
        symbols: symbols.join(", ")
      });
      const cachedOverview = getFundamentalsOverview();
      const overview = options.skipSourceRefresh && cachedOverview.lastUpdated ? cachedOverview : await refreshFundamentalsData({ triggeredBy: triggerSource });
      const results = await Promise.all(
        symbols.map(
          (symbol) => buildPairAnalysis(symbol, {
            preferSavedAi: false,
            allowLiveAI: true
          })
        )
      );
      const generatedAt = (/* @__PURE__ */ new Date()).toISOString();
      const items = results.map(
        (payload) => toSavedSymbolAnalysis(payload, generatedAt, overview.lastUpdated, triggerSource)
      );
      const analysis = toSavedPayload(items, generatedAt, overview.lastUpdated, triggerSource);
      await saveAiFundamentalsBatch({
        runId: dbRun?.id ?? null,
        provider: PROVIDER,
        model: getAiAnalysisModel(),
        generatedAt,
        generatedTimezone: getAiAnalysisTimezone(),
        sourceDataTimestamp: overview.lastUpdated,
        triggerSource,
        items
      });
      const fullLatest = await loadLatestAvailable();
      lastSavedFallback = fullLatest ?? analysis;
      invalidateAnalysisCaches();
      if (dbRun) {
        await updateAiAnalysisRun(dbRun.id, {
          status: "success",
          analysis
        });
      }
      if (options.trigger === "manual") {
        lastManualRunAt = Date.now();
        for (const symbol of symbols) lastManualRunBySymbol.set(symbol, Date.now());
      }
      console.info("[ai-analysis] run completed", {
        provider: PROVIDER,
        model: getAiAnalysisModel(),
        trigger: options.trigger,
        triggerSource,
        generatedAt,
        symbolsProcessed: items.length
      });
      return {
        ok: true,
        startedAt,
        finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
        trigger: options.trigger,
        triggerSource,
        provider: PROVIDER,
        model: getAiAnalysisModel(),
        analysis,
        latestAvailable: fullLatest ?? analysis,
        symbols,
        timezone: getAiAnalysisTimezone(),
        nextRun: computeNextScheduledRun()
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (dbRun) {
        await updateAiAnalysisRun(dbRun.id, {
          status: "failed",
          errorMessage: message
        }).catch(() => void 0);
      }
      console.warn("[ai-analysis] run failed", {
        provider: PROVIDER,
        model: getAiAnalysisModel(),
        trigger: options.trigger,
        triggerSource,
        symbols: symbols.join(", "),
        error: message
      });
      return {
        ok: false,
        startedAt,
        finishedAt: (/* @__PURE__ */ new Date()).toISOString(),
        trigger: options.trigger,
        triggerSource,
        provider: PROVIDER,
        model: getAiAnalysisModel(),
        analysis: null,
        latestAvailable,
        symbols,
        error: message,
        timezone: getAiAnalysisTimezone(),
        nextRun: computeNextScheduledRun()
      };
    } finally {
      inFlightRun = null;
      inFlightSymbols = [];
    }
  })();
  inFlightRun = runPromise;
  return runPromise;
}
function canRunScheduledAiAnalysis(now2 = /* @__PURE__ */ new Date()) {
  return getFundamentalsAiScheduleStatus(now2);
}

// backend/server/routes/fundamentals.ts
function isAuthorizedCron(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
  const headerSecret = req.headers["x-cron-secret"] ?? "";
  return bearer === secret || headerSecret === secret;
}
var fundamentalsRouter = (0, import_express18.Router)();
fundamentalsRouter.get("/", async (_req, res) => {
  try {
    await bootstrapFundamentals();
    res.json(getFundamentalsOverview());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load fundamentals overview";
    res.status(500).json({ error: message, detail: "The fundamentals engine could not build the default overview." });
  }
});
fundamentalsRouter.get("/overview", async (_req, res) => {
  try {
    await bootstrapFundamentals();
    let overview = getFundamentalsOverview();
    if (!overview.lastUpdated && !overview.latestNews.length && !overview.upcomingEvents.length) {
      overview = await refreshFundamentalsData();
    }
    res.json(overview);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load fundamentals overview";
    res.status(500).json({
      error: message,
      detail: "Overview route failed. Check backend logs, source config, and DB connectivity."
    });
  }
});
fundamentalsRouter.post("/refresh", async (req, res) => {
  try {
    const enablePlaywrightFallback = Boolean(req.body?.enablePlaywrightFallback);
    const overview = await refreshFundamentalsData({ enablePlaywrightFallback, triggeredBy: "manual" });
    res.json({
      success: true,
      message: "Source data refreshed. AI analysis updates on the next scheduled run.",
      overview
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to refresh fundamentals";
    res.status(500).json({
      error: message,
      detail: "Manual refresh failed before a valid overview could be built."
    });
  }
});
fundamentalsRouter.get("/news", async (_req, res) => {
  try {
    await bootstrapFundamentals();
    res.json({ items: getFundamentalsNews() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load fundamentals news";
    res.status(500).json({ error: message });
  }
});
fundamentalsRouter.get("/events", async (_req, res) => {
  try {
    await bootstrapFundamentals();
    res.json({ items: getFundamentalsEvents() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load fundamentals events";
    res.status(500).json({ error: message });
  }
});
fundamentalsRouter.get("/sources/status", async (_req, res) => {
  try {
    await bootstrapFundamentals();
    res.json({ items: getFundamentalSourceStatus() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load fundamentals source status";
    res.status(500).json({ error: message });
  }
});
fundamentalsRouter.post("/cron", async (req, res) => {
  if (!isAuthorizedCron(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const scheduleStatus = canRunScheduledAiAnalysis();
  if (!scheduleStatus.allowed) {
    res.json({
      skipped: true,
      reason: scheduleStatus.reason,
      timezone: "Europe/Madrid",
      currentMadridIso: scheduleStatus.currentMadridIso,
      scheduleMetadata: getScheduleMetadata()
    });
    return;
  }
  try {
    console.log("[fundamentals/cron] Scheduled AI fundamentals generation triggered", scheduleStatus);
    const result = await runAiAnalysis({ trigger: "cron", bypassCooldown: true });
    res.json({
      ...result,
      scheduleMetadata: getScheduleMetadata()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cron job failed";
    console.error("[fundamentals/cron] Daily generation failed:", message);
    res.status(500).json({ error: message, scheduleMetadata: getScheduleMetadata() });
  }
});
fundamentalsRouter.get("/:symbol/latest", async (req, res) => {
  try {
    const payload = await getLatestAiAnalysisForSymbolResponse(req.params.symbol);
    console.log("[fundamentals/latest] Loaded saved AI fundamentals", {
      requestedSymbol: req.params.symbol,
      symbol: payload.symbol,
      status: payload.status,
      hasAnalysis: Boolean(payload.analysis),
      generatedAt: payload.generatedAt
    });
    res.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load saved AI fundamentals";
    console.error("[fundamentals/latest] Failed:", message);
    res.status(500).json({ error: message });
  }
});
fundamentalsRouter.post("/:symbol/run", async (req, res) => {
  try {
    const startedAt = (/* @__PURE__ */ new Date()).toISOString();
    const symbol = req.params.symbol;
    const latestAvailable = await getLatestAiAnalysisForSymbolResponse(symbol);
    console.log("[fundamentals/run] Queuing saved AI fundamentals run", {
      requestedSymbol: symbol,
      symbol: latestAvailable.symbol,
      previousGeneratedAt: latestAvailable.generatedAt
    });
    runAiAnalysis({ trigger: "manual", symbols: [symbol] }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[fundamentals/run] background run failed:", msg);
    });
    res.json({
      ok: true,
      status: latestAvailable.status === "running" ? "running" : "queued",
      startedAt,
      symbol: latestAvailable.symbol,
      latestAvailable,
      generatedAt: latestAvailable.generatedAt,
      message: "Saved AI fundamentals refresh started. Poll /api/fundamentals/:symbol/latest for results."
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start AI fundamentals run";
    console.error("[fundamentals/run] Failed:", message);
    res.status(500).json({ error: message });
  }
});
fundamentalsRouter.get("/:symbol", async (req, res) => {
  try {
    await bootstrapFundamentals();
    const payload = getFundamentalsForSymbol(req.params.symbol);
    res.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load pair fundamentals";
    res.status(500).json({ error: message });
  }
});

// backend/server/routes/pairs.ts
var import_express19 = require("express");
var pairsRouter = (0, import_express19.Router)();
pairsRouter.get("/:symbol/analysis", async (req, res) => {
  try {
    const result = await buildPairAnalysis(req.params.symbol);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to build pair analysis";
    res.status(500).json({ error: message });
  }
});
pairsRouter.post("/:symbol/analysis", async (req, res) => {
  const startedAt = Date.now();
  try {
    const result = await buildPairAnalysis(req.params.symbol, {
      forceRefresh: Boolean(req.body?.forceRefresh ?? true),
      allowLiveAI: true,
      preferSavedAi: false
    });
    res.json({
      success: true,
      message: "Analysis updated",
      result
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error("Failed to generate pair analysis");
    const durationMs = Date.now() - startedAt;
    const timedOut = /timeout/i.test(err.name) || /timeout/i.test(err.message);
    console.error("[pair-ai] analysis failed", {
      symbol: req.params.symbol,
      durationMs,
      errorName: err.name,
      errorMessage: err.message
    });
    res.status(timedOut ? 504 : 500).json({
      error: timedOut ? "AI analysis timed out" : err.message,
      details: timedOut ? "OpenAI request exceeded 60 seconds" : err.message,
      diagnostics: {
        openaiKeyConfigured: Boolean(process.env.OPENAI_API_KEY || process.env.OPEN_AI_KEY),
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        symbol: req.params.symbol,
        pairContextLoaded: true,
        fundamentalsLoaded: true
      },
      durationMs
    });
  }
});
pairsRouter.post("/batch-intelligence", async (req, res) => {
  try {
    const { contexts, deep, forceRefresh } = req.body;
    if (!Array.isArray(contexts) || contexts.length === 0) {
      return res.status(400).json({ error: "contexts array required" });
    }
    if (contexts.length > 8) {
      return res.status(400).json({ error: "max 8 contexts per batch" });
    }
    const results = await buildBatchPairIntelligenceAI(contexts, { deep, forceRefresh });
    res.json({ success: true, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Batch intelligence failed";
    res.status(500).json({ error: message });
  }
});

// backend/server/routes/tradingviewWebhook.ts
var import_express20 = require("express");

// backend/server/services/tradingviewBridge.service.ts
var import_node_crypto2 = require("node:crypto");
var import_promises = require("node:fs/promises");
var import_node_path2 = __toESM(require("node:path"));
var YAHOO_BASE2 = "https://query1.finance.yahoo.com/v8/finance/chart";
var SIGNAL_TYPES = /* @__PURE__ */ new Set(["setup_detected", "important_zone", "price_zone_reached"]);
var SYMBOL_ALIASES2 = {
  XAUUSD: "XAUUSD",
  EURUSD: "EURUSD",
  GBPUSD: "GBPUSD",
  USDJPY: "USDJPY",
  USOIL: "USOIL",
  WTI: "WTI",
  DXY: "DXY",
  BTCUSD: "BTCUSD",
  BTCUSDT: "BTCUSD",
  US30: "US30"
};
var PRICE_SPECS = [
  { key: "dxy", label: "US Dollar Index", symbol: process.env.TRADING_DXY_SYMBOL ?? "DX-Y.NYB" },
  { key: "gold", label: "Gold Futures", symbol: process.env.TRADING_GOLD_SYMBOL ?? "GC=F" },
  { key: "wti", label: "WTI Crude", symbol: process.env.TRADING_WTI_SYMBOL ?? "CL=F" },
  { key: "us10y", label: "US 10Y Yield", symbol: process.env.TRADING_US10Y_SYMBOL ?? "^TNX" },
  { key: "us02y", label: "US 02Y Yield", symbol: process.env.TRADING_US02Y_SYMBOL ?? "^UST2Y" }
];
function getConfig2() {
  const riskPercentRaw = Number(process.env.TRADING_RISK_PERCENT ?? 1);
  return {
    accountSize: Number(process.env.TRADING_ACCOUNT_SIZE ?? 1e4),
    riskPercent: Number.isFinite(riskPercentRaw) ? Math.min(riskPercentRaw, 1) : 1,
    minRiskReward: Number(process.env.TRADING_MIN_RR ?? 2),
    duplicateWindowMinutes: Number(process.env.TRADING_DUPLICATE_WINDOW_MINUTES ?? 180),
    blockNewsMinutes: Number(process.env.TRADING_BLOCK_NEWS_MINUTES ?? 30)
  };
}
function getStorageFile() {
  return process.env.TRADING_ALERTS_FILE ?? import_node_path2.default.join(process.cwd(), "backend", "server", "data", "tradingview-alerts.json");
}
async function ensureStorageFile() {
  const filePath = getStorageFile();
  await (0, import_promises.mkdir)(import_node_path2.default.dirname(filePath), { recursive: true });
  try {
    await (0, import_promises.readFile)(filePath, "utf8");
  } catch {
    await (0, import_promises.writeFile)(filePath, "[]", "utf8");
  }
  return filePath;
}
async function readRecords() {
  const filePath = await ensureStorageFile();
  const raw = await (0, import_promises.readFile)(filePath, "utf8");
  return JSON.parse(raw);
}
async function writeRecords(records) {
  const filePath = await ensureStorageFile();
  await (0, import_promises.writeFile)(filePath, JSON.stringify(records, null, 2), "utf8");
}
function toStringValue(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
function toNumberValue(value) {
  if (value === null || value === void 0 || value === "") return null;
  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}
function normalizeSymbol2(raw) {
  const normalized = raw.toUpperCase().replace(/^[A-Z]+:/, "").replace(/[^A-Z0-9]/g, "");
  if (normalized.includes("XAUUSD")) return "XAUUSD";
  if (normalized.includes("EURUSD")) return "EURUSD";
  if (normalized.includes("GBPUSD")) return "GBPUSD";
  if (normalized.includes("USDJPY")) return "USDJPY";
  if (normalized.includes("USOIL")) return "USOIL";
  if (normalized === "WTI") return "WTI";
  if (normalized.includes("DXY")) return "DXY";
  if (normalized.includes("BTCUSD") || normalized.includes("BTCUSDT") || normalized.includes("BITCOIN")) return "BTCUSD";
  if (normalized.includes("US30") || normalized.includes("DOW") || normalized.includes("DJI")) return "US30";
  return SYMBOL_ALIASES2[normalized] ?? null;
}
function normalizeSignalType(value, signal) {
  if (value && SIGNAL_TYPES.has(value)) return value;
  const normalizedSignal = signal?.trim().toUpperCase();
  if (normalizedSignal === "BUY" || normalizedSignal === "SELL") return "setup_detected";
  return "setup_detected";
}
function normalizeDirectionHint(value, signal) {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "buy" || normalized === "sell" || normalized === "neutral") return normalized;
  const signalValue = signal?.trim().toUpperCase();
  if (signalValue === "BUY") return "buy";
  if (signalValue === "SELL") return "sell";
  return "neutral";
}
function normalizeTime(value) {
  if (typeof value === "number") {
    const millis = value > 1e12 ? value : value * 1e3;
    return new Date(millis).toISOString();
  }
  if (typeof value === "string") {
    if (/^\d+$/.test(value.trim())) {
      const numeric = Number(value);
      const millis = value.trim().length > 10 ? numeric : numeric * 1e3;
      return new Date(millis).toISOString();
    }
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return (/* @__PURE__ */ new Date()).toISOString();
}
function fingerprintAlert(input) {
  return (0, import_node_crypto2.createHash)("sha256").update([
    input.symbol,
    input.timeframe,
    input.price.toFixed(5),
    input.eventTimeIso,
    input.signalType,
    input.directionHint,
    input.structure,
    input.candlePattern
  ].join("|")).digest("hex");
}
function parseTradingviewPayload(payload) {
  const secret = toStringValue(payload.secret) ?? "";
  const symbolRaw = toStringValue(payload.symbol);
  const timeframe = toStringValue(payload.timeframe);
  const price = toNumberValue(payload.price);
  const signal = toStringValue(payload.signal);
  const strategy = toStringValue(payload.strategy);
  const message = toStringValue(payload.message);
  if (!symbolRaw) throw new Error("symbol is required");
  if (!timeframe) throw new Error("timeframe is required");
  if (price === null) throw new Error("price must be numeric");
  const symbol = normalizeSymbol2(symbolRaw);
  if (!symbol) throw new Error(`Unsupported symbol "${symbolRaw}"`);
  const signalType = normalizeSignalType(toStringValue(payload.signal_type), signal);
  const eventTimeIso = normalizeTime(payload.time);
  const directionHint = normalizeDirectionHint(toStringValue(payload.direction_hint), signal);
  const trend = toStringValue(payload.trend) ?? "ranging";
  const structure = toStringValue(payload.structure) ?? "none";
  const candlePattern = toStringValue(payload.candle_pattern) ?? "none";
  const liquidityEvent = toStringValue(payload.liquidity_event) ?? "none";
  return {
    receivedAt: (/* @__PURE__ */ new Date()).toISOString(),
    secret,
    symbol,
    originalSymbol: symbolRaw,
    timeframe,
    signal,
    strategy,
    message,
    exchange: toStringValue(payload.exchange) ?? "unknown",
    price,
    eventTimeIso,
    signalType,
    directionHint,
    trend,
    ema50: toNumberValue(payload.ema50),
    ema200: toNumberValue(payload.ema200),
    rsi: toNumberValue(payload.rsi),
    atr: toNumberValue(payload.atr),
    support: toNumberValue(payload.support),
    resistance: toNumberValue(payload.resistance),
    liquidityEvent,
    structure,
    candlePattern,
    session: toStringValue(payload.session),
    marketStructure: toStringValue(payload.market_structure),
    fairValueGap: toStringValue(payload.fair_value_gap),
    note: toStringValue(payload.note),
    fingerprint: fingerprintAlert({
      symbol,
      timeframe,
      price,
      eventTimeIso,
      signalType,
      directionHint,
      structure,
      candlePattern
    })
  };
}
function assertWebhookSecret(secret) {
  const expected = process.env.TRADINGVIEW_WEBHOOK_SECRET;
  if (!expected) return;
  if (secret !== expected) throw new Error("Invalid webhook secret");
}
async function fetchJson(url) {
  const response = await fetch(url, { headers: { "User-Agent": "alphamentals-tradingview-bridge/1.0" } });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}
async function fetchCorrelatedSnapshot(spec) {
  try {
    const data = await fetchJson(`${YAHOO_BASE2}/${encodeURIComponent(spec.symbol)}?range=5d&interval=60m`);
    const result = data.chart?.result?.[0];
    const closes = result?.indicators?.quote?.[0]?.close?.filter((value) => typeof value === "number") ?? [];
    const price = result?.meta?.regularMarketPrice ?? closes.at(-1) ?? null;
    const previousClose = result?.meta?.previousClose ?? (closes.length > 1 ? closes.at(-2) ?? null : null);
    if (price === null) {
      return { key: spec.key, label: spec.label, symbol: spec.symbol, price: null, previousClose: null, changePercent: null, trend: "unknown", available: false, asOf: null, note: "No quote returned" };
    }
    const delta = previousClose && previousClose !== 0 ? (price - previousClose) / previousClose * 100 : null;
    let trend = "unknown";
    if (closes.length >= 4) {
      const start = closes[closes.length - 4];
      const end = closes[closes.length - 1];
      if (start !== void 0 && end !== void 0) {
        const move = end - start;
        trend = Math.abs(move) < Math.max(Math.abs(start) * 5e-4, 0.01) ? "flat" : move > 0 ? "up" : "down";
      }
    }
    return {
      key: spec.key,
      label: spec.label,
      symbol: spec.symbol,
      price: Number(price.toFixed(4)),
      previousClose: previousClose !== null ? Number(previousClose.toFixed(4)) : null,
      changePercent: delta !== null ? Number(delta.toFixed(2)) : null,
      trend,
      available: true,
      asOf: result?.timestamp?.length ? new Date(result.timestamp[result.timestamp.length - 1] * 1e3).toISOString() : (/* @__PURE__ */ new Date()).toISOString()
    };
  } catch (error) {
    return {
      key: spec.key,
      label: spec.label,
      symbol: spec.symbol,
      price: null,
      previousClose: null,
      changePercent: null,
      trend: "unknown",
      available: false,
      asOf: null,
      note: error instanceof Error ? error.message : "Snapshot fetch failed"
    };
  }
}
function detectSession(alert) {
  if (alert.session) return alert.session;
  const hour = new Date(alert.eventTimeIso).getUTCHours();
  if (hour >= 0 && hour < 7) return "Asian session";
  if (hour >= 7 && hour < 13) return "London session";
  if (hour >= 13 && hour < 21) return "New York session";
  return "Off-session";
}
async function fetchUpcomingUsdEvents() {
  const now2 = /* @__PURE__ */ new Date();
  const from = now2.toISOString().split("T")[0];
  const to = new Date(now2.getTime() + 24 * 60 * 60 * 1e3).toISOString().split("T")[0];
  const events = await fetchCalendar(from, to);
  return events.filter((event) => event.currency === "USD" && event.impact === "high").map((event) => {
    const dateTime = /* @__PURE__ */ new Date(`${event.date}T${event.time}:00Z`);
    return {
      title: event.title,
      impact: event.impact,
      currency: event.currency,
      startsAt: dateTime.toISOString(),
      minutesUntil: Math.round((dateTime.getTime() - Date.now()) / 6e4)
    };
  }).filter((event) => event.minutesUntil >= -15 && event.minutesUntil <= 8 * 60).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
async function buildTradingContext(alert) {
  const snapshots = await Promise.all(PRICE_SPECS.map(fetchCorrelatedSnapshot));
  const correlatedMarkets = {
    dxy: snapshots.find((item) => item.key === "dxy"),
    gold: snapshots.find((item) => item.key === "gold"),
    wti: snapshots.find((item) => item.key === "wti"),
    us10y: snapshots.find((item) => item.key === "us10y"),
    us02y: snapshots.find((item) => item.key === "us02y")
  };
  const dataWarnings = snapshots.filter((item) => !item.available && item.note).map((item) => `${item.label}: ${item.note}`);
  const macroNotes = [];
  if (alert.symbol === "XAUUSD") {
    if (correlatedMarkets.dxy.trend === "down") macroNotes.push("DXY is soft, which can support bullish gold setups.");
    if (correlatedMarkets.dxy.trend === "up") macroNotes.push("DXY is firm, which can conflict with bullish gold setups.");
    if (correlatedMarkets.us10y.trend === "down" && correlatedMarkets.us02y.trend === "down") {
      macroNotes.push("US yields are easing, which can help gold longs.");
    }
    if (correlatedMarkets.us10y.trend === "up" || correlatedMarkets.us02y.trend === "up") {
      macroNotes.push("US yields are rising, which can pressure long gold ideas.");
    }
  }
  if (alert.symbol === "EURUSD" || alert.symbol === "GBPUSD") {
    if (correlatedMarkets.dxy.trend === "down") macroNotes.push("A weaker DXY tends to support EURUSD/GBPUSD longs.");
    if (correlatedMarkets.dxy.trend === "up") macroNotes.push("A stronger DXY can weigh on EURUSD/GBPUSD longs.");
  }
  if (alert.symbol === "USDJPY") {
    if (correlatedMarkets.dxy.trend === "up" && correlatedMarkets.us10y.trend === "up") {
      macroNotes.push("DXY and yields are aligned higher, which can support USDJPY strength.");
    }
    if (correlatedMarkets.dxy.trend === "down" || correlatedMarkets.us10y.trend === "down") {
      macroNotes.push("DXY or yields are not confirming USDJPY strength.");
    }
  }
  if (alert.symbol === "BTCUSD") {
    if (correlatedMarkets.dxy.trend === "down") macroNotes.push("A softer dollar can help BTC sustain bullish momentum.");
    if (correlatedMarkets.dxy.trend === "up") macroNotes.push("A firmer dollar can make BTC breakouts less reliable.");
  }
  if (alert.symbol === "US30") {
    if (correlatedMarkets.us10y.trend === "down") macroNotes.push("Falling yields can support US30 upside continuation.");
    if (correlatedMarkets.us10y.trend === "up") macroNotes.push("Rising yields can pressure US30 longs.");
    if (correlatedMarkets.dxy.trend === "up") macroNotes.push("A strong dollar often coincides with a tighter risk backdrop for equities.");
  }
  let upcomingUsdNews = [];
  try {
    upcomingUsdNews = await fetchUpcomingUsdEvents();
  } catch (error) {
    dataWarnings.push(error instanceof Error ? `Economic calendar lookup failed: ${error.message}` : "Economic calendar lookup failed");
  }
  return {
    sessionLabel: detectSession(alert),
    correlatedMarkets,
    macroNotes,
    upcomingUsdNews,
    dataWarnings
  };
}
function buildPrompt(alert, context, config) {
  const system = `You are a conservative professional forex and gold analyst.
Return ONLY valid JSON.
You prefer NO_TRADE whenever evidence is mixed, stop loss placement is unclear, high-impact USD news is close, or risk-to-reward is below 1:2.
Never recommend risking more than 1% of account equity.
JSON shape:
{
  "decision":"BUY|SELL|NO_TRADE",
  "symbol":"XAUUSD|EURUSD|GBPUSD|USDJPY|USOIL|WTI|DXY|BTCUSD|US30",
  "timeframe":"string",
  "confidence":0,
  "entry_zone":{"low":0,"high":0},
  "stop_loss":0,
  "take_profit_1":0,
  "take_profit_2":0,
  "risk_reward":"string",
  "position_size_note":"Risk only 1% or less",
  "reasoning":[""],
  "invalid_if":[""],
  "warnings":[""],
  "bias":"bullish|bearish|neutral"
}`;
  const user = JSON.stringify({
    account: {
      accountSize: config.accountSize,
      maxRiskPercent: config.riskPercent,
      minRiskReward: config.minRiskReward,
      newsBlockMinutes: config.blockNewsMinutes
    },
    chartAlert: {
      symbol: alert.symbol,
      timeframe: alert.timeframe,
      exchange: alert.exchange,
      price: alert.price,
      signalType: alert.signalType,
      directionHint: alert.directionHint,
      trend: alert.trend,
      ema50: alert.ema50,
      ema200: alert.ema200,
      rsi: alert.rsi,
      atr: alert.atr,
      support: alert.support,
      resistance: alert.resistance,
      liquidityEvent: alert.liquidityEvent,
      structure: alert.structure,
      candlePattern: alert.candlePattern,
      session: context.sessionLabel,
      marketStructure: alert.marketStructure,
      fairValueGap: alert.fairValueGap,
      note: alert.note,
      eventTime: alert.eventTimeIso
    },
    context,
    checklist: [
      "Direction bias from EMA 50 and EMA 200",
      "Whether DXY confirms or conflicts",
      "Whether US10Y and US02Y confirm or conflict",
      "Whether WTI adds useful context",
      "Whether price is at support, resistance, or liquidity",
      "Whether stop loss is beyond structure, not arbitrary",
      "Whether RR is at least 1:2",
      "Whether high-impact USD news is too close",
      "Prefer NO_TRADE if unclear"
    ]
  }, null, 2);
  return { system, user };
}
function defaultAtrForSymbol(symbol, price) {
  if (symbol === "XAUUSD") return Math.max(6, price * 25e-4);
  if (symbol === "USDJPY") return Math.max(0.18, price * 12e-4);
  return Math.max(12e-4, price * 9e-4);
}
function roundPrice(symbol, value) {
  const decimals = symbol === "XAUUSD" ? 2 : symbol === "USDJPY" ? 3 : 5;
  return Number(value.toFixed(decimals));
}
function buildHeuristicTradePlan(alert, context, config, fallbackReason) {
  const reasons = [];
  const warnings = [...context.dataWarnings];
  const invalidIf = [];
  let bullishScore = 0;
  let bearishScore = 0;
  if (alert.signal?.toUpperCase() === "BUY") bullishScore += 3;
  if (alert.signal?.toUpperCase() === "SELL") bearishScore += 3;
  if (alert.directionHint === "buy") bullishScore += 2;
  if (alert.directionHint === "sell") bearishScore += 2;
  if (alert.trend === "bullish") bullishScore += 2;
  if (alert.trend === "bearish") bearishScore += 2;
  if (alert.structure === "BOS_up" || alert.structure === "CHoCH_up") bullishScore += 2;
  if (alert.structure === "BOS_down" || alert.structure === "CHoCH_down") bearishScore += 2;
  if (alert.candlePattern === "bullish_engulfing" || alert.candlePattern === "bullish_pin_bar") bullishScore += 1;
  if (alert.candlePattern === "bearish_engulfing" || alert.candlePattern === "bearish_pin_bar") bearishScore += 1;
  if (alert.symbol === "XAUUSD") {
    if (context.correlatedMarkets.dxy.trend === "down") bullishScore += 1;
    if (context.correlatedMarkets.dxy.trend === "up") bearishScore += 1;
    if (context.correlatedMarkets.us10y.trend === "down") bullishScore += 1;
    if (context.correlatedMarkets.us10y.trend === "up") bearishScore += 1;
  }
  if (alert.symbol === "EURUSD" || alert.symbol === "GBPUSD") {
    if (context.correlatedMarkets.dxy.trend === "down") bullishScore += 1;
    if (context.correlatedMarkets.dxy.trend === "up") bearishScore += 1;
  }
  const blockingNews = context.upcomingUsdNews.some(
    (event) => event.impact === "high" && event.minutesUntil >= -5 && event.minutesUntil <= config.blockNewsMinutes
  );
  if (blockingNews) {
    warnings.push(`High-impact USD news is scheduled within ${config.blockNewsMinutes} minutes.`);
    reasons.push("Upcoming high-impact USD news makes the setup too fragile to trade immediately.");
  }
  if (fallbackReason) {
    warnings.push(`AI model unavailable, using local heuristic analysis. ${fallbackReason}`);
  }
  const scoreDelta = bullishScore - bearishScore;
  const bias = scoreDelta > 0 ? "bullish" : scoreDelta < 0 ? "bearish" : "neutral";
  const atr = alert.atr && alert.atr > 0 ? alert.atr : defaultAtrForSymbol(alert.symbol, alert.price);
  const support = alert.support ?? roundPrice(alert.symbol, alert.price - atr * 0.8);
  const resistance = alert.resistance ?? roundPrice(alert.symbol, alert.price + atr * 0.8);
  let decision = "NO_TRADE";
  if (!blockingNews && Math.abs(scoreDelta) >= 2) {
    decision = scoreDelta > 0 ? "BUY" : "SELL";
  }
  if (decision === "BUY") {
    reasons.push("Bullish inputs are aligned across the alert signal, price structure, and macro context.");
    invalidIf.push("DXY turns sharply higher or price closes back below support.");
  } else if (decision === "SELL") {
    reasons.push("Bearish inputs are aligned across the alert signal, price structure, and macro context.");
    invalidIf.push("DXY weakens sharply or price reclaims resistance.");
  } else {
    reasons.push("The setup remains mixed, underconfirmed, or blocked by risk filters.");
    invalidIf.push("Wait for clearer structure, cleaner momentum, or lower event risk.");
  }
  if (alert.strategy) reasons.push(`Strategy tag: ${alert.strategy}.`);
  if (alert.message) reasons.push(`Alert note: ${alert.message}.`);
  if (context.sessionLabel) reasons.push(`Session context: ${context.sessionLabel}.`);
  const baseConfidence = 42 + Math.abs(scoreDelta) * 11 - (blockingNews ? 24 : 0);
  const confidence = Math.max(18, Math.min(82, baseConfidence));
  if (decision === "NO_TRADE") {
    return {
      decision,
      symbol: alert.symbol,
      timeframe: alert.timeframe,
      confidence,
      entry_zone: { low: 0, high: 0 },
      stop_loss: 0,
      take_profit_1: 0,
      take_profit_2: 0,
      risk_reward: "unverified",
      position_size_note: "Risk only 1% or less",
      reasoning: reasons,
      invalid_if: invalidIf,
      warnings,
      bias
    };
  }
  if (decision === "BUY") {
    const entryLow2 = roundPrice(alert.symbol, Math.min(alert.price, support + atr * 0.15));
    const entryHigh2 = roundPrice(alert.symbol, alert.price);
    const stopLoss2 = roundPrice(alert.symbol, Math.min(entryLow2 - atr * 0.6, support - atr * 0.35));
    const takeProfit12 = roundPrice(alert.symbol, Math.max(alert.price + atr * 1.8, resistance));
    const takeProfit22 = roundPrice(alert.symbol, Math.max(takeProfit12 + atr * 1.2, resistance + atr * 1.5));
    return {
      decision,
      symbol: alert.symbol,
      timeframe: alert.timeframe,
      confidence,
      entry_zone: { low: entryLow2, high: entryHigh2 },
      stop_loss: stopLoss2,
      take_profit_1: takeProfit12,
      take_profit_2: takeProfit22,
      risk_reward: "pending validation",
      position_size_note: "Risk only 1% or less",
      reasoning: reasons,
      invalid_if: invalidIf,
      warnings,
      bias
    };
  }
  const entryLow = roundPrice(alert.symbol, alert.price);
  const entryHigh = roundPrice(alert.symbol, Math.max(alert.price, resistance - atr * 0.15));
  const stopLoss = roundPrice(alert.symbol, Math.max(entryHigh + atr * 0.6, resistance + atr * 0.35));
  const takeProfit1 = roundPrice(alert.symbol, Math.min(alert.price - atr * 1.8, support));
  const takeProfit2 = roundPrice(alert.symbol, Math.min(takeProfit1 - atr * 1.2, support - atr * 1.5));
  return {
    decision,
    symbol: alert.symbol,
    timeframe: alert.timeframe,
    confidence,
    entry_zone: { low: entryLow, high: entryHigh },
    stop_loss: stopLoss,
    take_profit_1: takeProfit1,
    take_profit_2: takeProfit2,
    risk_reward: "pending validation",
    position_size_note: "Risk only 1% or less",
    reasoning: reasons,
    invalid_if: invalidIf,
    warnings,
    bias
  };
}
async function completeStructuredTradePlan(alert, context, config) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY must be set before using the TradingView webhook.");
  }
  const { system, user } = buildPrompt(alert, context, config);
  const plan = await chatCompleteJSON(
    [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    { temperature: 0.1, maxTokens: 1800, feature: "tradingview", operation: "generate_trade_plan" }
  );
  return { plan, raw: JSON.stringify(plan) };
}
async function generateTradePlan(alert, context, config) {
  try {
    return await completeStructuredTradePlan(alert, context, config);
  } catch (error) {
    const fallbackReason = error instanceof Error ? error.message : "Unknown AI error";
    const fallbackPlan = buildHeuristicTradePlan(alert, context, config, fallbackReason);
    return {
      plan: fallbackPlan,
      raw: JSON.stringify({
        provider: "heuristic-fallback",
        reason: fallbackReason
      })
    };
  }
}
function normalizeTextArray(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const items = value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean);
  return items.length ? items : fallback;
}
function toNumeric(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function midpoint(low, high) {
  return (low + high) / 2;
}
function computeRiskReward(plan) {
  const entryLow = toNumeric(plan.entry_zone?.low);
  const entryHigh = toNumeric(plan.entry_zone?.high);
  const stop = toNumeric(plan.stop_loss);
  const tp1 = toNumeric(plan.take_profit_1);
  const tp2 = toNumeric(plan.take_profit_2);
  if (entryLow <= 0 || entryHigh <= 0 || stop <= 0 || tp1 <= 0 || tp2 <= 0) return null;
  const entry = midpoint(entryLow, entryHigh);
  const risk = Math.abs(entry - stop);
  if (risk <= 0) return null;
  const reward1 = Math.abs(tp1 - entry);
  const reward2 = Math.abs(tp2 - entry);
  return Math.max(reward1 / risk, reward2 / risk);
}
function alignsWithDirection(plan) {
  const entryLow = toNumeric(plan.entry_zone?.low);
  const entryHigh = toNumeric(plan.entry_zone?.high);
  const stop = toNumeric(plan.stop_loss);
  const tp1 = toNumeric(plan.take_profit_1);
  const tp2 = toNumeric(plan.take_profit_2);
  const entry = midpoint(entryLow, entryHigh);
  if (plan.decision === "BUY") return stop < entryLow && tp1 > entry && tp2 > tp1;
  if (plan.decision === "SELL") return stop > entryHigh && tp1 < entry && tp2 < tp1;
  return true;
}
function enforceRiskGuards(planRaw, alert, context, config) {
  const fallbackBias = normalizedDecisionToBias(planRaw.decision);
  const normalized = {
    decision: planRaw.decision === "BUY" || planRaw.decision === "SELL" || planRaw.decision === "NO_TRADE" ? planRaw.decision : "NO_TRADE",
    symbol: alert.symbol,
    timeframe: alert.timeframe,
    confidence: Math.max(0, Math.min(100, Number(planRaw.confidence ?? 0))),
    entry_zone: {
      low: toNumeric(planRaw.entry_zone?.low),
      high: toNumeric(planRaw.entry_zone?.high)
    },
    stop_loss: toNumeric(planRaw.stop_loss),
    take_profit_1: toNumeric(planRaw.take_profit_1),
    take_profit_2: toNumeric(planRaw.take_profit_2),
    risk_reward: typeof planRaw.risk_reward === "string" ? planRaw.risk_reward : "unverified",
    position_size_note: typeof planRaw.position_size_note === "string" ? planRaw.position_size_note : "Risk only 1% or less",
    reasoning: normalizeTextArray(planRaw.reasoning, ["Wait for clearer confirmation."]),
    invalid_if: normalizeTextArray(planRaw.invalid_if, ["Market structure breaks against the idea."]),
    warnings: normalizeTextArray(planRaw.warnings, []),
    bias: planRaw.bias === "bullish" || planRaw.bias === "bearish" || planRaw.bias === "neutral" ? planRaw.bias : fallbackBias
  };
  const riskAmount = Number((config.accountSize * (config.riskPercent / 100)).toFixed(2));
  normalized.risk_amount = riskAmount;
  normalized.position_size_formula = "position_size = risk_amount / abs(entry_price - stop_loss)";
  normalized.position_size_note = `Risk only ${config.riskPercent}% or less. Example risk on $${config.accountSize}: $${riskAmount}.`;
  const hasBlockingNews = context.upcomingUsdNews.some((event) => event.impact === "high" && event.minutesUntil >= -5 && event.minutesUntil <= config.blockNewsMinutes);
  const rr = computeRiskReward(normalized);
  const directionAligned = alignsWithDirection(normalized);
  if (!directionAligned) normalized.warnings.push("Returned levels do not align with the stated trade direction.");
  if (hasBlockingNews) normalized.warnings.push(`High-impact USD news is scheduled within ${config.blockNewsMinutes} minutes.`);
  if (rr !== null) {
    normalized.risk_reward = `1:${Number(rr.toFixed(2))}`;
  } else {
    normalized.warnings.push("Risk-to-reward could not be verified from the returned levels.");
  }
  if (!directionAligned || rr === null || rr < config.minRiskReward || hasBlockingNews || normalized.decision !== "NO_TRADE" && normalized.stop_loss <= 0) {
    return {
      ...normalized,
      decision: "NO_TRADE",
      confidence: Math.min(normalized.confidence, 45),
      entry_zone: { low: 0, high: 0 },
      stop_loss: 0,
      take_profit_1: 0,
      take_profit_2: 0,
      reasoning: [...normalized.reasoning, "Post-analysis risk guards downgraded the setup to NO_TRADE."]
    };
  }
  return normalized;
}
function normalizedDecisionToBias(decision) {
  if (decision === "BUY") return "bullish";
  if (decision === "SELL") return "bearish";
  return "neutral";
}
function formatNotification(alert, plan, context) {
  return [
    `PAIR: ${plan.symbol}`,
    `DECISION: ${plan.decision}`,
    `BIAS: ${plan.bias ?? "neutral"}`,
    `ENTRY: ${plan.entry_zone.low && plan.entry_zone.high ? `${plan.entry_zone.low} - ${plan.entry_zone.high}` : "WAIT"}`,
    `SL: ${plan.stop_loss || "N/A"}`,
    `TP1: ${plan.take_profit_1 || "N/A"}`,
    `TP2: ${plan.take_profit_2 || "N/A"}`,
    `RR: ${plan.risk_reward}`,
    `CONFIDENCE: ${plan.confidence}`,
    `WHY: ${plan.reasoning.join(" | ")}`,
    `INVALIDATION: ${plan.invalid_if.join(" | ")}`,
    `WARNING: ${[...plan.warnings, ...context.dataWarnings].join(" | ") || "None"}`,
    `SESSION: ${context.sessionLabel}`,
    `SIGNAL: ${alert.signalType}`
  ].join("\n");
}
async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}
async function sendNotifications(alert, plan, context) {
  const message = formatNotification(alert, plan, context);
  const deliveries = [];
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    try {
      await postJson(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: message
      });
      deliveries.push({ channel: "telegram", delivered: true, detail: "Delivered to Telegram" });
    } catch (error) {
      deliveries.push({ channel: "telegram", delivered: false, detail: error instanceof Error ? error.message : "Telegram failed" });
    }
  }
  if (process.env.DISCORD_WEBHOOK_URL) {
    try {
      await postJson(process.env.DISCORD_WEBHOOK_URL, { content: message });
      deliveries.push({ channel: "discord", delivered: true, detail: "Delivered to Discord" });
    } catch (error) {
      deliveries.push({ channel: "discord", delivered: false, detail: error instanceof Error ? error.message : "Discord failed" });
    }
  }
  if (!deliveries.length) {
    deliveries.push({ channel: "dashboard", delivered: true, detail: "Stored for dashboard display only" });
  }
  return deliveries;
}
async function saveRecord(record) {
  const records = await readRecords();
  const next = records.filter((item) => item.id !== record.id);
  next.push(record);
  next.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  await writeRecords(next.slice(0, 500));
}
async function listRecentTradingviewAlerts(limit = 30) {
  const records = await readRecords();
  return records.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, limit);
}
async function processTradingviewWebhook(payload) {
  const config = getConfig2();
  const alert = parseTradingviewPayload(payload);
  assertWebhookSecret(alert.secret);
  const existing = (await readRecords()).find((record) => record.fingerprint === alert.fingerprint);
  if (existing) {
    const ageMs = Date.now() - new Date(existing.receivedAt).getTime();
    if (ageMs <= config.duplicateWindowMinutes * 60 * 1e3) {
      return { duplicate: true, record: existing };
    }
  }
  const baseRecord = {
    id: (0, import_node_crypto2.randomUUID)(),
    fingerprint: alert.fingerprint,
    status: "received",
    symbol: alert.symbol,
    timeframe: alert.timeframe,
    receivedAt: alert.receivedAt,
    alert,
    context: null,
    analysis: null,
    notifications: [],
    response: null,
    error: null
  };
  await saveRecord(baseRecord);
  try {
    const context = await buildTradingContext(alert);
    const { plan: rawPlan, raw } = await generateTradePlan(alert, context, config);
    const finalPlan = enforceRiskGuards(rawPlan, alert, context, config);
    const notifications = await sendNotifications(alert, finalPlan, context);
    const processedRecord = {
      ...baseRecord,
      status: "processed",
      context,
      analysis: finalPlan,
      notifications,
      response: { raw_ai_response: raw }
    };
    await saveRecord(processedRecord);
    return { duplicate: false, record: processedRecord };
  } catch (error) {
    const failedRecord = {
      ...baseRecord,
      status: "failed",
      error: error instanceof Error ? error.message : String(error)
    };
    await saveRecord(failedRecord);
    throw error;
  }
}
async function analyzeTradingSignal(payload) {
  const config = getConfig2();
  const alert = parseTradingviewPayload(payload);
  const context = await buildTradingContext(alert);
  const { plan: rawPlan, raw } = await generateTradePlan(alert, context, config);
  const analysis = enforceRiskGuards(rawPlan, alert, context, config);
  return {
    alert,
    context,
    analysis,
    raw
  };
}

// backend/server/routes/tradingviewWebhook.ts
var tradingviewWebhookRouter = (0, import_express20.Router)();
function toWebhookResponse(record, status = "processed") {
  const analysis = record.analysis;
  const entry = analysis && analysis.entry_zone.low > 0 && analysis.entry_zone.high > 0 ? Number(((analysis.entry_zone.low + analysis.entry_zone.high) / 2).toFixed(record.symbol === "XAUUSD" ? 2 : 5)) : null;
  return {
    status,
    recordId: record.id,
    action: analysis?.decision === "BUY" || analysis?.decision === "SELL" ? "TRADE" : "NO_TRADE",
    tradeDirection: analysis?.decision ?? "NO_TRADE",
    bias: analysis?.bias === "neutral" || !analysis?.bias ? "mixed" : analysis.bias,
    confidence: analysis?.confidence ?? 0,
    entry,
    stopLoss: analysis?.stop_loss || null,
    takeProfit: analysis?.take_profit_1 || null,
    takeProfitSecondary: analysis?.take_profit_2 || null,
    reason: analysis?.reasoning.join(" ") ?? record.error ?? "No analysis returned.",
    riskNotes: [...analysis?.warnings ?? [], ...analysis?.invalid_if ?? []],
    analysis,
    context: record.context,
    notifications: record.notifications
  };
}
tradingviewWebhookRouter.post("/", async (req, res) => {
  try {
    const payload = req.body;
    const result = await processTradingviewWebhook(payload);
    if (result.duplicate) {
      return res.status(409).json({
        ...toWebhookResponse(result.record, "duplicate"),
        message: "Duplicate alert rejected within configured window"
      });
    }
    return res.json(toWebhookResponse(result.record));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown TradingView webhook error";
    const status = message.toLowerCase().includes("secret") ? 401 : 400;
    return res.status(status).json({ error: message });
  }
});
tradingviewWebhookRouter.get("/recent", async (req, res) => {
  const limit = Number(req.query.limit ?? 30);
  const records = await listRecentTradingviewAlerts(Number.isFinite(limit) ? Math.min(limit, 100) : 30);
  res.json(records);
});

// backend/server/routes/telegram.ts
var import_express21 = require("express");
var import_zod14 = require("zod");

// backend/server/services/telegramBridge.service.ts
var import_node_child_process2 = require("node:child_process");
var import_node_path3 = __toESM(require("node:path"));
var import_node_readline = __toESM(require("node:readline"));

// backend/server/config/telegram.ts
var import_node_fs = __toESM(require("node:fs"));
function clean(value) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
function getTelegramEnvConfig() {
  const apiId = clean(process.env.TELEGRAM_API_ID);
  const apiHash = clean(process.env.TELEGRAM_API_HASH);
  const envSession = clean(process.env.TELEGRAM_SESSION_STRING) ?? clean(process.env.TELEGRAM_SESSION);
  const sessionFile = clean(process.env.TELEGRAM_SESSION_FILE);
  const sessionName = clean(process.env.TELEGRAM_SESSION_NAME) ?? (process.env.NODE_ENV === "production" ? "telegram_prod" : "telegram_local");
  const targetChat = clean(process.env.TELEGRAM_TARGET_CHAT);
  let session = envSession;
  let sessionSource = envSession ? "env" : null;
  if (!session && sessionFile) {
    try {
      if (!import_node_fs.default.existsSync(sessionFile)) {
        return {
          apiId,
          apiHash,
          session: null,
          sessionFile,
          sessionName,
          sessionSource: "file",
          targetChat,
          enabled: true,
          configured: false,
          missing: [],
          error: `TELEGRAM_SESSION_FILE does not exist: ${sessionFile}.`
        };
      }
      session = clean(import_node_fs.default.readFileSync(sessionFile, "utf8"));
      sessionSource = session ? "file" : null;
      if (!session) {
        return {
          apiId,
          apiHash,
          session: null,
          sessionFile,
          sessionName,
          sessionSource: "file",
          targetChat,
          enabled: true,
          configured: false,
          missing: [],
          error: `TELEGRAM_SESSION_FILE is empty: ${sessionFile}.`
        };
      }
    } catch (error) {
      return {
        apiId,
        apiHash,
        session: null,
        sessionFile,
        sessionName,
        sessionSource: "file",
        targetChat,
        enabled: true,
        configured: false,
        missing: [],
        error: `Failed to read TELEGRAM_SESSION_FILE: ${error instanceof Error ? error.message : String(error)}.`
      };
    }
  }
  const values = {
    TELEGRAM_API_ID: apiId,
    TELEGRAM_API_HASH: apiHash,
    TELEGRAM_SESSION: session,
    TELEGRAM_TARGET_CHAT: targetChat
  };
  const enabled = Object.values(values).some(Boolean);
  const missing = Object.entries(values).filter(([, value]) => !value).map(([key]) => key);
  if (!enabled) {
    return {
      apiId,
      apiHash,
      session,
      sessionFile,
      sessionName,
      sessionSource,
      targetChat,
      enabled: false,
      configured: false,
      missing: [],
      error: null
    };
  }
  if (missing.length) {
    return {
      apiId,
      apiHash,
      session,
      sessionFile,
      sessionName,
      sessionSource,
      targetChat,
      enabled: true,
      configured: false,
      missing,
      error: `Telegram is partially configured. Missing: ${missing.join(", ")}.`
    };
  }
  if (!/^\d+$/.test(apiId ?? "")) {
    return {
      apiId,
      apiHash,
      session,
      sessionFile,
      sessionName,
      sessionSource,
      targetChat,
      enabled: true,
      configured: false,
      missing: [],
      error: "TELEGRAM_API_ID must be numeric."
    };
  }
  return {
    apiId,
    apiHash,
    session,
    sessionFile,
    sessionName,
    sessionSource,
    targetChat,
    enabled: true,
    configured: true,
    missing: [],
    error: null
  };
}
function getTelegramStartupValidationMessage() {
  const config = getTelegramEnvConfig();
  return config.error;
}

// backend/server/services/telegramBridge.service.ts
var TELEGRAM_BRIDGE_SCRIPT = import_node_path3.default.join(process.cwd(), "scripts", "telegram_bridge.py");
var PYTHON_CANDIDATES = [process.env.TELEGRAM_PYTHON_BIN?.trim(), "python3", "python"].filter(Boolean);
var resolvedPythonExecutable = null;
var monitorProcess = null;
var monitorRestartTimer = null;
var intentionalMonitorStop = false;
var runtimeState = {
  enabled: false,
  configured: false,
  connected: false,
  loggedIn: false,
  targetChatAccessible: false,
  targetChat: getTelegramEnvConfig().targetChat,
  targetChatTitle: null,
  targetChatType: null,
  accountUsername: null,
  account: null,
  targetChatResolved: false,
  canReadMessages: false,
  messagesFetched: 0,
  lastMessageDate: null,
  error: null,
  stack: null,
  code: null,
  currentPhase: null,
  errorPhase: null,
  operation: null,
  hints: [],
  lastSyncAt: null,
  lastProcessedMessageId: null
};
var TelegramBridgeError = class extends Error {
  code;
  details;
  status;
  phase;
  operation;
  targetChat;
  loginOk;
  targetChatResolved;
  canReadMessages;
  account;
  targetChatInfo;
  hints;
  errorName;
  errorCode;
  stackDetails;
  constructor(code, message, details = null, context = {}) {
    super(message);
    this.code = code;
    this.details = details;
    this.status = mapBridgeErrorCodeToHttpStatus(code);
    this.phase = context.phase ?? null;
    this.operation = context.operation ?? null;
    this.targetChat = context.targetChat ?? null;
    this.loginOk = context.loginOk ?? false;
    this.targetChatResolved = context.targetChatResolved ?? false;
    this.canReadMessages = context.canReadMessages ?? false;
    this.account = context.account ?? null;
    this.targetChatInfo = context.targetChatInfo ?? null;
    this.hints = context.hints ?? [];
    this.errorName = context.errorName ?? null;
    this.errorCode = context.errorCode ?? null;
    this.stackDetails = context.stack ?? null;
  }
};
function parseJsonLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}
function mapBridgeErrorCodeToHttpStatus(code) {
  if (code === "MISSING_CREDENTIALS" || code === "INVALID_API_ID" || code === "INVALID_TARGET_CHAT") return 400;
  if (code === "INVALID_API_CREDENTIALS" || code === "INVALID_SESSION") return 401;
  if (code === "TARGET_CHAT_ACCESS_DENIED") return 403;
  if (code === "TELEGRAM_RATE_LIMIT") return 429;
  return 503;
}
function toBridgeError(payload, fallbackMessage) {
  return new TelegramBridgeError(
    payload?.code ?? "TELEGRAM_UNAVAILABLE",
    payload?.message ?? fallbackMessage,
    payload?.details ?? null,
    payload ?? {}
  );
}
async function tryRunPythonCommand(command, args, timeoutMs) {
  return await new Promise((resolve, reject) => {
    const child = (0, import_node_child_process2.spawn)(command, [TELEGRAM_BRIDGE_SCRIPT, ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new TelegramBridgeError("TELEGRAM_TIMEOUT", "Telegram request timed out."));
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timeout);
      if (error.code === "ENOENT") {
        reject(error);
        return;
      }
      reject(new TelegramBridgeError("TELEGRAM_UNAVAILABLE", error.message));
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout, stderr, executable: command });
        return;
      }
      const stdoutLines = stdout.trim().split("\n").filter(Boolean);
      const stderrLines = stderr.trim().split("\n").filter(Boolean);
      const payload = parseJsonLine(stdoutLines.at(-1) ?? "") ?? parseJsonLine(stderrLines.at(-1) ?? "");
      reject(toBridgeError(payload, stderr.trim() || stdout.trim() || "Telegram command failed."));
    });
  });
}
async function runBridgeCommand(args, timeoutMs = 3e4) {
  const executables = resolvedPythonExecutable ? [resolvedPythonExecutable] : PYTHON_CANDIDATES;
  let lastError = null;
  for (const executable of executables) {
    try {
      const result = await tryRunPythonCommand(executable, args, timeoutMs);
      resolvedPythonExecutable = result.executable;
      const payload = parseJsonLine(result.stdout.trim().split("\n").filter(Boolean).at(-1) ?? "");
      if (!payload) {
        throw new TelegramBridgeError("TELEGRAM_UNAVAILABLE", result.stderr.trim() || "Telegram bridge returned invalid JSON.");
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (error?.code === "ENOENT") continue;
      throw error;
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new TelegramBridgeError("PYTHON_NOT_FOUND", "Python was not found. Install Python 3 or set TELEGRAM_PYTHON_BIN.");
}
function applyConnectionFailure(error) {
  runtimeState.connected = false;
  runtimeState.loggedIn = error instanceof TelegramBridgeError ? error.loginOk : false;
  runtimeState.targetChatAccessible = false;
  runtimeState.targetChatResolved = error instanceof TelegramBridgeError ? error.targetChatResolved : false;
  runtimeState.canReadMessages = error instanceof TelegramBridgeError ? error.canReadMessages : false;
  runtimeState.messagesFetched = 0;
  runtimeState.error = error.message;
  runtimeState.stack = error instanceof TelegramBridgeError ? error.stackDetails : error.stack;
  runtimeState.code = error instanceof TelegramBridgeError ? error.code : "TELEGRAM_UNAVAILABLE";
  runtimeState.currentPhase = error instanceof TelegramBridgeError ? error.phase : null;
  runtimeState.errorPhase = error instanceof TelegramBridgeError ? error.phase : null;
  runtimeState.operation = error instanceof TelegramBridgeError ? error.operation : null;
  runtimeState.hints = error instanceof TelegramBridgeError ? error.hints : [];
  runtimeState.account = error instanceof TelegramBridgeError ? error.account : runtimeState.account;
  runtimeState.accountUsername = error instanceof TelegramBridgeError ? error.account?.username ?? error.account?.displayName ?? runtimeState.accountUsername : runtimeState.accountUsername;
  runtimeState.targetChatTitle = error instanceof TelegramBridgeError ? error.targetChatInfo?.title ?? runtimeState.targetChatTitle : runtimeState.targetChatTitle;
  runtimeState.targetChatType = error instanceof TelegramBridgeError ? error.targetChatInfo?.type ?? runtimeState.targetChatType : runtimeState.targetChatType;
}
function updateBaseState() {
  const config = getTelegramEnvConfig();
  runtimeState.enabled = config.enabled;
  runtimeState.configured = config.configured;
  runtimeState.targetChat = config.targetChat;
  if (config.error) {
    runtimeState.error = config.error;
    runtimeState.stack = null;
    runtimeState.code = "MISSING_CREDENTIALS";
    runtimeState.currentPhase = "load_session";
    runtimeState.errorPhase = "load_session";
    runtimeState.hints = ["Configura TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_SESSION o TELEGRAM_SESSION_FILE, y TELEGRAM_TARGET_CHAT."];
  } else if (!config.enabled) {
    runtimeState.error = null;
    runtimeState.stack = null;
    runtimeState.code = null;
    runtimeState.currentPhase = null;
    runtimeState.errorPhase = null;
    runtimeState.hints = [];
  }
}
function logBridgeFailure(prefix, error) {
  const payload = error instanceof TelegramBridgeError ? {
    phase: error.phase,
    operation: error.operation,
    targetChat: error.targetChat,
    loginOk: error.loginOk,
    targetChatResolved: error.targetChatResolved,
    canReadMessages: error.canReadMessages,
    account: error.account,
    targetChatInfo: error.targetChatInfo,
    hints: error.hints,
    name: error.errorName ?? error.name,
    message: error.message,
    code: error.code,
    stack: error.stackDetails ?? error.stack,
    details: error.details
  } : {
    name: error.name,
    message: error.message,
    stack: error.stack
  };
  console.error(prefix, payload);
}
function maskSession(value) {
  if (!value) return null;
  if (value.length <= 10) return "configured";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
async function logTelegramStartupDiagnostics() {
  updateBaseState();
  const config = getTelegramEnvConfig();
  const preferredPython = process.env.TELEGRAM_PYTHON_BIN?.trim() || null;
  console.log("[Telegram] Startup config", {
    enabled: config.enabled,
    configured: config.configured,
    apiIdConfigured: Boolean(config.apiId),
    apiHashConfigured: Boolean(config.apiHash),
    sessionConfigured: Boolean(config.session),
    sessionSource: config.sessionSource,
    sessionFile: config.sessionFile,
    sessionName: config.sessionName,
    targetChatConfigured: Boolean(config.targetChat),
    targetChat: config.targetChat,
    pythonCandidates: PYTHON_CANDIDATES,
    preferredPython,
    workingDirectory: process.cwd(),
    renderService: process.env.RENDER_SERVICE_NAME ?? null,
    renderInstance: process.env.RENDER_INSTANCE_ID ?? null,
    renderUrl: process.env.RENDER_EXTERNAL_URL ?? null,
    sessionPreview: maskSession(config.session)
  });
  try {
    const doctor = await runBridgeCommand(["doctor", "--json"]);
    console.log("[Telegram] Python bridge diagnostics", doctor);
  } catch (error) {
    const bridgeError = error instanceof TelegramBridgeError ? error : new TelegramBridgeError("TELEGRAM_UNAVAILABLE", error instanceof Error ? error.message : "Telegram doctor failed.");
    logBridgeFailure("[Telegram] Python bridge diagnostics failed:", bridgeError);
  }
}
function scheduleMonitorRestart(onMessage) {
  if (intentionalMonitorStop || monitorRestartTimer || !runtimeState.configured) return;
  monitorRestartTimer = setTimeout(() => {
    monitorRestartTimer = null;
    void startTelegramMonitoring(onMessage);
  }, 5e3);
}
function handleMonitorEvent(event, onMessage) {
  if (event.event === "status") {
    runtimeState.currentPhase = event.phase ?? null;
    runtimeState.error = null;
    runtimeState.stack = null;
    runtimeState.code = null;
    if (event.stage === "session_loaded") {
      console.log("[Telegram] Session loaded", {
        source: event.sessionSource ?? "unknown",
        sessionFile: event.sessionFile ?? null
      });
      return;
    }
    if (event.stage === "connecting") {
      console.log("[Telegram] Connecting to Telegram...");
      return;
    }
    if (event.stage === "logged_in") {
      runtimeState.connected = true;
      runtimeState.loggedIn = event.loginOk ?? true;
      runtimeState.accountUsername = event.username ?? event.displayName ?? null;
      runtimeState.account = event.account ?? null;
      console.log("[Telegram] Logged in successfully");
      if (event.username || event.displayName) {
        console.log(`[Telegram] Account: ${event.username ? `@${event.username}` : event.displayName}`);
      }
      return;
    }
    if (event.stage === "resolving_target_chat") {
      console.log(`[Telegram] Resolving target chat: ${event.targetChat ?? runtimeState.targetChat ?? "unknown"}`);
      return;
    }
    if (event.stage === "target_chat_connected") {
      runtimeState.targetChatAccessible = true;
      runtimeState.targetChatResolved = true;
      runtimeState.targetChat = event.chatId ?? runtimeState.targetChat;
      runtimeState.targetChatTitle = event.chatTitle ?? null;
      runtimeState.targetChatType = event.chatType ?? null;
      console.log(`[Telegram] Target chat resolved: ${event.chatTitle ?? event.chatId ?? "Unknown chat"}`);
      if (event.chatType) {
        console.log(`[Telegram] Chat type: ${event.chatType}`);
      }
      if (event.chatId) {
        console.log(`[Telegram] Target chat ID: ${event.chatId}`);
      }
      return;
    }
    if (event.stage === "reading_messages") {
      console.log("[Telegram] Validating channel read access...");
      return;
    }
    if (event.stage === "message_read_test_ok") {
      runtimeState.canReadMessages = event.canReadMessages ?? true;
      runtimeState.lastMessageDate = event.lastMessageDate ?? null;
      console.log(`[Telegram] Permissions: read_messages=${runtimeState.canReadMessages ? "true" : "false"}`);
      console.log("[Telegram] Message read test OK");
      if (event.lastMessageDate) {
        console.log(`[Telegram] Last message date: ${event.lastMessageDate}`);
      }
      return;
    }
    if (event.stage === "monitoring_enabled") {
      console.log("[Telegram] Read-only ingestion enabled");
    }
    return;
  }
  if (event.event === "warning") {
    runtimeState.connected = false;
    runtimeState.loggedIn = event.loginOk ?? false;
    runtimeState.targetChatAccessible = false;
    runtimeState.targetChatResolved = event.targetChatResolved ?? false;
    runtimeState.canReadMessages = event.canReadMessages ?? false;
    runtimeState.currentPhase = event.phase ?? null;
    runtimeState.error = event.message ?? "Telegram monitor warning";
    runtimeState.code = event.code ?? "TELEGRAM_WARNING";
    runtimeState.errorPhase = event.phase ?? null;
    runtimeState.operation = event.operation ?? null;
    runtimeState.hints = event.hints ?? [];
    console.warn("[Telegram] Warning:", {
      phase: event.phase,
      operation: event.operation,
      targetChat: event.targetChat ?? runtimeState.targetChat,
      message: runtimeState.error,
      code: runtimeState.code,
      hints: runtimeState.hints
    });
    return;
  }
  if (event.event === "error") {
    runtimeState.connected = false;
    runtimeState.loggedIn = event.loginOk ?? false;
    runtimeState.targetChatAccessible = false;
    runtimeState.targetChatResolved = event.targetChatResolved ?? false;
    runtimeState.canReadMessages = event.canReadMessages ?? false;
    runtimeState.currentPhase = event.phase ?? null;
    runtimeState.error = event.message ?? "Telegram monitor error";
    runtimeState.code = event.code ?? "TELEGRAM_UNAVAILABLE";
    runtimeState.errorPhase = event.phase ?? null;
    runtimeState.operation = event.operation ?? null;
    runtimeState.hints = event.hints ?? [];
    runtimeState.account = event.account ?? runtimeState.account;
    runtimeState.targetChatTitle = event.targetChatInfo?.title ?? runtimeState.targetChatTitle;
    runtimeState.targetChatType = event.targetChatInfo?.type ?? runtimeState.targetChatType;
    runtimeState.stack = event.stack ?? null;
    console.error("[Telegram] Operation failed:", {
      phase: event.phase,
      operation: event.operation,
      targetChat: event.targetChat ?? runtimeState.targetChat,
      account: event.account,
      resolvedChat: event.targetChatInfo,
      loginOk: event.loginOk,
      targetChatResolved: event.targetChatResolved,
      canReadMessages: event.canReadMessages,
      name: event.errorName,
      message: event.message,
      code: event.code ?? event.errorCode,
      stack: event.stack,
      raw: event.details,
      hints: event.hints
    });
    return;
  }
  if (event.event === "message") {
    runtimeState.lastSyncAt = (/* @__PURE__ */ new Date()).toISOString();
    runtimeState.lastProcessedMessageId = event.message.telegramMessageId;
    runtimeState.messagesFetched += 1;
    void onMessage(event.message).catch((error) => {
      console.error("[Telegram] Failed to persist incoming message:", error instanceof Error ? error.message : "Unknown error");
    });
  }
}
function spawnMonitorProcess(executable, handlers) {
  const child = (0, import_node_child_process2.spawn)(executable, [TELEGRAM_BRIDGE_SCRIPT, "monitor"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const stdoutInterface = import_node_readline.default.createInterface({ input: child.stdout });
  const stderrInterface = import_node_readline.default.createInterface({ input: child.stderr });
  stdoutInterface.on("line", (line) => {
    const event = parseJsonLine(line);
    if (!event) return;
    if ("ok" in event && event.ok === false) {
      handlers.onEvent({
        event: "error",
        code: event.code,
        message: event.message,
        details: event.details ?? null
      });
      return;
    }
    handlers.onEvent(event);
  });
  stderrInterface.on("line", (line) => {
    if (!line.trim()) return;
    console.error(`[Telegram] ${line.trim()}`);
  });
  child.on("error", (error) => {
    if (error.code === "ENOENT") {
      handlers.onEvent({
        event: "error",
        code: "PYTHON_NOT_FOUND",
        message: `Python executable "${executable}" was not found.`,
        details: error.message
      });
      handlers.onExit({ code: 127, signal: null });
      return;
    }
    handlers.onEvent({
      event: "error",
      code: "TELEGRAM_UNAVAILABLE",
      message: error.message,
      details: null
    });
  });
  child.on("close", (code, signal) => {
    stdoutInterface.close();
    stderrInterface.close();
    handlers.onExit({ code, signal });
  });
  return child;
}
function getTelegramRuntimeState() {
  updateBaseState();
  return { ...runtimeState };
}
async function testTelegramConnection() {
  updateBaseState();
  const config = getTelegramEnvConfig();
  if (!config.enabled) {
    return {
      enabled: false,
      connected: false,
      loggedIn: false,
      targetChatAccessible: false,
      targetChatResolved: false,
      canReadMessages: false,
      messagesFetched: 0,
      currentPhase: "load_session",
      lastMessageDate: null,
      account: null,
      targetChat: null,
      error: "Telegram is not configured.",
      code: "MISSING_CREDENTIALS",
      errorPhase: "load_session",
      errorMessage: "Telegram is not configured.",
      stack: null,
      hints: ["Configura TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_SESSION o TELEGRAM_SESSION_FILE, y TELEGRAM_TARGET_CHAT."]
    };
  }
  if (!config.configured) {
    return {
      enabled: true,
      connected: false,
      loggedIn: false,
      targetChatAccessible: false,
      targetChatResolved: false,
      canReadMessages: false,
      messagesFetched: 0,
      currentPhase: "load_session",
      lastMessageDate: null,
      account: null,
      targetChat: null,
      error: config.error,
      code: "MISSING_CREDENTIALS",
      errorPhase: "load_session",
      errorMessage: config.error,
      stack: null,
      hints: ["Revisa las variables de entorno de Telegram."]
    };
  }
  try {
    const result = await runBridgeCommand(["test", "--json"]);
    runtimeState.connected = result.connected;
    runtimeState.loggedIn = result.loggedIn ?? result.connected;
    runtimeState.targetChatAccessible = result.target_chat_accessible;
    runtimeState.targetChatResolved = result.target_chat_resolved ?? result.target_chat_accessible;
    runtimeState.canReadMessages = result.can_read_messages ?? result.target_chat_accessible;
    runtimeState.messagesFetched = 0;
    runtimeState.lastMessageDate = result.last_message_date ?? null;
    runtimeState.targetChatTitle = result.target_chat?.title ?? null;
    runtimeState.targetChatType = result.target_chat?.type ?? null;
    runtimeState.account = result.account ?? null;
    runtimeState.accountUsername = result.account?.username ?? result.account?.displayName ?? null;
    runtimeState.error = null;
    runtimeState.stack = null;
    runtimeState.code = null;
    runtimeState.currentPhase = result.current_phase ?? "frontend_response";
    runtimeState.errorPhase = null;
    runtimeState.operation = null;
    runtimeState.hints = result.hints ?? [];
    return {
      enabled: true,
      connected: result.connected,
      loggedIn: result.loggedIn ?? result.connected,
      targetChatAccessible: result.target_chat_accessible,
      targetChatResolved: result.target_chat_resolved ?? result.target_chat_accessible,
      canReadMessages: result.can_read_messages ?? result.target_chat_accessible,
      messagesFetched: 0,
      currentPhase: result.current_phase ?? "frontend_response",
      lastMessageDate: result.last_message_date ?? null,
      account: {
        id: result.account?.id ?? null,
        username: result.account?.username ?? null,
        displayName: result.account?.displayName ?? null
      },
      targetChat: {
        id: result.target_chat?.id ?? null,
        title: result.target_chat?.title ?? null,
        type: result.target_chat?.type ?? null,
        username: result.target_chat?.username ?? null,
        normalized: result.target_chat?.normalized ?? null
      },
      error: null,
      code: null,
      errorPhase: null,
      errorMessage: null,
      stack: null,
      hints: result.hints ?? []
    };
  } catch (error) {
    const bridgeError = error instanceof TelegramBridgeError ? error : new TelegramBridgeError("TELEGRAM_UNAVAILABLE", error instanceof Error ? error.message : "Telegram unavailable.");
    logBridgeFailure("[Telegram] Connection test failed:", bridgeError);
    applyConnectionFailure(bridgeError);
    return {
      enabled: true,
      connected: false,
      loggedIn: bridgeError.loginOk,
      targetChatAccessible: false,
      targetChatResolved: bridgeError.targetChatResolved,
      canReadMessages: bridgeError.canReadMessages,
      messagesFetched: 0,
      currentPhase: bridgeError.phase,
      lastMessageDate: null,
      account: bridgeError.account ?? null,
      targetChat: {
        id: bridgeError.targetChatInfo?.id ?? null,
        title: bridgeError.targetChatInfo?.title ?? null,
        type: bridgeError.targetChatInfo?.type ?? null,
        username: bridgeError.targetChatInfo?.username ?? null,
        normalized: bridgeError.targetChatInfo?.normalized ?? null
      },
      error: bridgeError.message,
      code: bridgeError.code,
      errorPhase: bridgeError.phase,
      errorMessage: bridgeError.message,
      stack: bridgeError.stackDetails,
      hints: bridgeError.hints
    };
  }
}
async function fetchTelegramHistory(limit, afterId) {
  updateBaseState();
  const args = ["fetch-history", "--json", "--limit", String(limit)];
  if (afterId) args.push("--after-id", afterId);
  runtimeState.currentPhase = "fetch_messages";
  console.log("[Telegram] Fetching latest messages...");
  try {
    const result = await runBridgeCommand(args, 2e4);
    runtimeState.connected = true;
    runtimeState.loggedIn = result.loggedIn ?? runtimeState.loggedIn;
    runtimeState.targetChatResolved = result.target_chat_resolved ?? Boolean(result.chat);
    runtimeState.targetChatAccessible = runtimeState.targetChatResolved;
    runtimeState.canReadMessages = result.can_read_messages ?? runtimeState.canReadMessages;
    runtimeState.targetChatTitle = result.chat?.title ?? runtimeState.targetChatTitle;
    runtimeState.targetChatType = result.chat?.type ?? runtimeState.targetChatType;
    runtimeState.lastMessageDate = result.last_message_date ?? runtimeState.lastMessageDate;
    runtimeState.messagesFetched = result.messages_fetched ?? result.messages?.length ?? 0;
    runtimeState.error = null;
    runtimeState.stack = null;
    runtimeState.code = null;
    runtimeState.errorPhase = null;
    runtimeState.operation = null;
    runtimeState.hints = result.hints ?? [];
    runtimeState.currentPhase = "frontend_response";
    console.log(`[Telegram] Messages fetched: ${runtimeState.messagesFetched}`);
    return result;
  } catch (error) {
    const bridgeError = error instanceof TelegramBridgeError ? error : new TelegramBridgeError("TELEGRAM_UNAVAILABLE", error instanceof Error ? error.message : "Telegram fetch failed.");
    logBridgeFailure("[Telegram] Fetch history failed:", bridgeError);
    applyConnectionFailure(bridgeError);
    throw bridgeError;
  }
}
async function startTelegramMonitoring(onMessage) {
  updateBaseState();
  const config = getTelegramEnvConfig();
  if (!config.enabled) return;
  if (!config.configured) {
    console.warn(`[Telegram] ${config.error}`);
    return;
  }
  if (monitorProcess) return;
  intentionalMonitorStop = false;
  const executables = resolvedPythonExecutable ? [resolvedPythonExecutable] : PYTHON_CANDIDATES;
  let started = false;
  for (const executable of executables) {
    try {
      monitorProcess = spawnMonitorProcess(executable, {
        onEvent: (event) => handleMonitorEvent(event, onMessage),
        onExit: ({ code, signal }) => {
          monitorProcess = null;
          if (intentionalMonitorStop) return;
          runtimeState.connected = false;
          runtimeState.targetChatAccessible = false;
          if (code !== 0) {
            console.warn(`[Telegram] Monitor exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}. Retrying...`);
          }
          scheduleMonitorRestart(onMessage);
        }
      });
      resolvedPythonExecutable = executable;
      started = true;
      break;
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
  }
  if (!started) {
    runtimeState.error = "Python was not found. Install Python 3 or set TELEGRAM_PYTHON_BIN.";
    runtimeState.code = "PYTHON_NOT_FOUND";
    console.error(`[Telegram] ${runtimeState.error}`);
  }
}
async function runTelegramDoctor() {
  const scriptPath = TELEGRAM_BRIDGE_SCRIPT;
  let scriptExists = false;
  try {
    const { existsSync } = await import("node:fs");
    scriptExists = existsSync(scriptPath);
  } catch {
  }
  let pythonFound = false;
  let pythonVersion = null;
  let pythonExecutable = null;
  for (const candidate of PYTHON_CANDIDATES) {
    const result = (0, import_node_child_process2.spawnSync)(candidate, ["--version"], { encoding: "utf8", timeout: 5e3 });
    if (result.error == null && result.status === 0) {
      pythonFound = true;
      pythonVersion = (result.stdout || result.stderr || "").trim().split("\n")[0] ?? null;
      pythonExecutable = candidate;
      break;
    }
  }
  const envVarKeys = ["TELEGRAM_API_ID", "TELEGRAM_API_HASH", "TELEGRAM_SESSION", "TELEGRAM_TARGET_CHAT", "TELEGRAM_SESSION_FILE"];
  const envVars = Object.fromEntries(envVarKeys.map((k) => [k, Boolean(process.env[k]?.trim())]));
  if (!pythonFound || !scriptExists) {
    return {
      python_found: pythonFound,
      python_version: pythonVersion,
      python_executable: pythonExecutable,
      script_exists: scriptExists,
      script_path: scriptPath,
      env_vars: envVars,
      doctor: null,
      doctor_error: pythonFound ? "Bridge script not found" : "Python not found",
      error_code: pythonFound ? "SCRIPT_NOT_FOUND" : "PYTHON_NOT_FOUND",
      raw_stderr: null
    };
  }
  try {
    const result = await tryRunPythonCommand(pythonExecutable ?? "python3", ["doctor", "--json"], 15e3);
    const doctor = parseJsonLine(result.stdout.trim().split("\n").findLast(Boolean) ?? "");
    return {
      python_found: true,
      python_version: pythonVersion,
      python_executable: pythonExecutable,
      script_exists: scriptExists,
      script_path: scriptPath,
      env_vars: envVars,
      doctor,
      doctor_error: null,
      error_code: null,
      raw_stderr: result.stderr.trim() || null
    };
  } catch (error) {
    const bridgeError = error instanceof TelegramBridgeError ? error : null;
    return {
      python_found: true,
      python_version: pythonVersion,
      python_executable: pythonExecutable,
      script_exists: scriptExists,
      script_path: scriptPath,
      env_vars: envVars,
      doctor: null,
      doctor_error: error instanceof Error ? error.message : String(error),
      error_code: bridgeError?.code ?? "DOCTOR_FAILED",
      raw_stderr: null
    };
  }
}

// backend/server/services/telegramMessageStore.service.ts
var import_node_crypto3 = require("node:crypto");
var import_supabase_js2 = require("@supabase/supabase-js");
var import_ws = __toESM(require("ws"));

// backend/server/lib/db.ts
var import_dotenv = __toESM(require("dotenv"));
var import_pg = require("pg");
import_dotenv.default.config();
function isUsableConnectionString(value) {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("[YOUR-PASSWORD]")) return false;
  return trimmed.startsWith("postgresql://") || trimmed.startsWith("postgres://");
}
function buildConnectionStringFromParts() {
  const host = process.env.DB_HOST ?? process.env.POSTGRES_HOST ?? process.env.PGHOST;
  const port = process.env.DB_PORT ?? process.env.POSTGRES_PORT ?? process.env.PGPORT ?? "5432";
  const user = process.env.DB_USER ?? process.env.POSTGRES_USER ?? process.env.PGUSER ?? "postgres";
  const password = process.env.DB_PASSWORD ?? process.env.POSTGRES_PASSWORD ?? process.env.PGPASSWORD ?? process.env.SUPABASE_DB_PASSWORD;
  const database = process.env.DB_NAME ?? process.env.POSTGRES_DB ?? process.env.PGDATABASE ?? "postgres";
  const sslMode = process.env.DB_SSLMODE ?? process.env.PGSSLMODE ?? "require";
  if (!host || !password || password.includes("[YOUR-PASSWORD]")) return null;
  const encodedUser = encodeURIComponent(user);
  const encodedPassword = encodeURIComponent(password);
  const encodedDatabase = encodeURIComponent(database);
  return `postgresql://${encodedUser}:${encodedPassword}@${host}:${port}/${encodedDatabase}?sslmode=${encodeURIComponent(sslMode)}`;
}
function resolveDatabaseUrl() {
  if (isUsableConnectionString(process.env.SUPABASE_DATABASE_URL)) {
    return process.env.SUPABASE_DATABASE_URL.trim();
  }
  if (isUsableConnectionString(process.env.DATABASE_URL)) {
    return process.env.DATABASE_URL.trim();
  }
  if (isUsableConnectionString(process.env.DIRECT_URL)) {
    return process.env.DIRECT_URL.trim();
  }
  return buildConnectionStringFromParts();
}
var resolvedDatabaseUrl = resolveDatabaseUrl();
var globalForDb = globalThis;
function createPool() {
  if (!resolvedDatabaseUrl) {
    console.warn("[db] DATABASE_URL not configured");
    return null;
  }
  console.log("[db] DATABASE_URL configured");
  return new import_pg.Pool({
    connectionString: resolvedDatabaseUrl,
    ssl: resolvedDatabaseUrl.includes("sslmode=disable") ? false : { rejectUnauthorized: false },
    max: 5
  });
}
var db = globalForDb.dbPool ?? createPool();
if (process.env.NODE_ENV !== "production" && db) {
  globalForDb.dbPool = db;
}
function isDatabaseConfigured2() {
  return Boolean(resolvedDatabaseUrl && db);
}
function getDatabaseHost() {
  if (!resolvedDatabaseUrl) return null;
  try {
    return new URL(resolvedDatabaseUrl).hostname;
  } catch {
    return null;
  }
}
var CONNECTION_ERROR_CODES = ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH"];
function isDatabaseConnectionError(error) {
  if (!(error instanceof Error)) return false;
  const code = error.code;
  if (code && CONNECTION_ERROR_CODES.includes(code)) return true;
  const message = error.message ?? "";
  return CONNECTION_ERROR_CODES.some((c) => message.includes(c)) || message.includes("getaddrinfo") || message.includes("Can't reach database server") || message.includes("timeout");
}
async function checkDatabaseConnection(timeoutMs = 5e3) {
  const host = getDatabaseHost();
  if (!db) {
    return { ok: false, configured: false, host, code: "NOT_CONFIGURED", message: "Database is not configured." };
  }
  try {
    const probe = db.query("SELECT 1");
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(Object.assign(new Error(`Database health check timed out after ${timeoutMs}ms`), { code: "ETIMEDOUT" })), timeoutMs);
    });
    await Promise.race([probe, timeout]);
    return { ok: true, configured: true, host, code: null, message: null };
  } catch (error) {
    const err = error;
    return {
      ok: false,
      configured: true,
      host,
      code: err.code ?? "DB_ERROR",
      message: err.message ?? "Database connection failed"
    };
  }
}
async function query(text, values = []) {
  if (!db) throw new Error("Database is not configured.");
  return db.query(text, values);
}
async function execute(text, values = []) {
  await query(text, values);
}

// backend/server/services/telegramMessageStore.service.ts
var TABLE = "telegram_messages";
var supabaseClient;
function getSupabaseClient() {
  if (supabaseClient !== void 0) return supabaseClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    supabaseClient = null;
    return null;
  }
  supabaseClient = (0, import_supabase_js2.createClient)(url, key, { auth: { autoRefreshToken: false, persistSession: false }, realtime: { transport: import_ws.default } });
  return supabaseClient;
}
function isSupabaseConfigured() {
  return Boolean(getSupabaseClient());
}
var cachedStrategy = null;
var STRATEGY_TTL_MS = 3e4;
function logDatabaseDiagnostics() {
  const serviceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY);
  const publishable = Boolean(process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  console.info(`[Database] DATABASE_URL configured: ${isDatabaseConfigured2() ? "yes" : "no"}`);
  console.info(`[Database] SUPABASE_SERVICE_ROLE_KEY configured: ${serviceRole ? "yes" : "no"}`);
  console.info(`[Database] SUPABASE_PUBLISHABLE_KEY configured: ${publishable ? "yes" : "no"}`);
}
async function resolveStorageStrategy(force = false) {
  if (!force && cachedStrategy && Date.now() - cachedStrategy.at < STRATEGY_TTL_MS) return cachedStrategy.value;
  logDatabaseDiagnostics();
  let value = "unavailable";
  if (isDatabaseConfigured2()) {
    const health = await checkDatabaseConnection();
    if (health.ok) {
      console.info("[Database] Using DATABASE_URL");
      value = "postgres_direct";
    } else if (isSupabaseConfigured()) {
      console.warn("[Database] DATABASE_URL failed");
      console.warn("[Database] Falling back to Supabase service role client");
      value = "supabase_client";
    }
  } else if (isSupabaseConfigured()) {
    value = "supabase_client";
  }
  console.info(`[Database] Using database strategy: ${value}`);
  cachedStrategy = { value, at: Date.now() };
  return value;
}
function setStrategy(value) {
  cachedStrategy = { value, at: Date.now() };
}
var tableReady = false;
function toIsoString(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
function mapTelegramRow(row) {
  const attachments = Array.isArray(row.attachments) ? row.attachments : [];
  const replyInfo = row.reply_info && typeof row.reply_info === "object" ? row.reply_info : null;
  const parsedSignal = row.parsed_signal_json && typeof row.parsed_signal_json === "object" ? row.parsed_signal_json : null;
  const takeProfits = Array.isArray(row.take_profits) ? row.take_profits.filter((value) => typeof value === "number" && Number.isFinite(value)) : [];
  return {
    id: row.id,
    telegramMessageId: row.telegram_message_id,
    chatId: row.chat_id,
    chatTitle: row.chat_title,
    senderId: row.sender_id,
    senderName: row.sender_name,
    text: row.text,
    rawText: row.raw_text,
    replyInfo,
    attachments,
    symbol: row.symbol,
    direction: row.direction ?? null,
    entry: row.entry,
    stopLoss: row.stop_loss,
    takeProfit: row.take_profit,
    takeProfits,
    timeframe: row.timeframe,
    messageType: row.message_type,
    telegramDate: toIsoString(row.telegram_date),
    parsedSignal,
    signalHash: row.signal_hash ?? null,
    autoAnalysisStatus: row.auto_analysis_status ?? null,
    autoAnalysisResult: row.auto_analysis_result_json && typeof row.auto_analysis_result_json === "object" ? row.auto_analysis_result_json : null,
    autoAnalysisError: row.auto_analysis_error ?? null,
    autoAnalysisAt: row.auto_analysis_at ? toIsoString(row.auto_analysis_at) : null,
    emailSentAt: row.email_sent_at ? toIsoString(row.email_sent_at) : null,
    emailStatus: row.email_status ?? null,
    emailError: row.email_error ?? null,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}
function buildSignalHash(input) {
  return (0, import_node_crypto3.createHash)("sha256").update(`${input.chatId}|${input.telegramDate}|${input.rawText.trim()}`).digest("hex");
}
async function ensureTelegramMessagesTable() {
  if (tableReady) return;
  if (!isDatabaseConfigured2()) throw new Error("Database is not configured.");
  await execute(`
    CREATE TABLE IF NOT EXISTS "telegram_messages" (
      "id" UUID PRIMARY KEY,
      "telegram_message_id" TEXT NOT NULL,
      "chat_id" TEXT NOT NULL,
      "chat_title" TEXT,
      "sender_id" TEXT,
      "sender_name" TEXT,
      "text" TEXT NOT NULL,
      "raw_text" TEXT NOT NULL,
      "reply_info" JSONB,
      "attachments" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "symbol" TEXT,
      "direction" TEXT,
      "entry" DOUBLE PRECISION,
      "stop_loss" DOUBLE PRECISION,
      "take_profit" DOUBLE PRECISION,
      "parsed_signal_json" JSONB,
      "take_profits" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "signal_hash" TEXT,
      "auto_analysis_status" TEXT,
      "auto_analysis_result_json" JSONB,
      "auto_analysis_error" TEXT,
      "auto_analysis_at" TIMESTAMPTZ,
      "email_sent_at" TIMESTAMPTZ,
      "email_status" TEXT,
      "email_error" TEXT,
      "timeframe" TEXT,
      "message_type" TEXT NOT NULL,
      "telegram_date" TIMESTAMPTZ NOT NULL,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT telegram_messages_chat_message_unique UNIQUE ("chat_id", "telegram_message_id")
    );
  `);
  await execute(`
    ALTER TABLE "telegram_messages"
    ADD COLUMN IF NOT EXISTS "reply_info" JSONB;
  `);
  await execute(`
    ALTER TABLE "telegram_messages"
    ADD COLUMN IF NOT EXISTS "attachments" JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);
  await execute(`
    ALTER TABLE "telegram_messages"
    ADD COLUMN IF NOT EXISTS "parsed_signal_json" JSONB;
  `);
  await execute(`
    ALTER TABLE "telegram_messages"
    ADD COLUMN IF NOT EXISTS "take_profits" JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);
  await execute(`
    ALTER TABLE "telegram_messages"
    ADD COLUMN IF NOT EXISTS "signal_hash" TEXT;
  `);
  await execute(`
    ALTER TABLE "telegram_messages"
    ADD COLUMN IF NOT EXISTS "auto_analysis_status" TEXT;
  `);
  await execute(`
    ALTER TABLE "telegram_messages"
    ADD COLUMN IF NOT EXISTS "auto_analysis_result_json" JSONB;
  `);
  await execute(`
    ALTER TABLE "telegram_messages"
    ADD COLUMN IF NOT EXISTS "auto_analysis_error" TEXT;
  `);
  await execute(`
    ALTER TABLE "telegram_messages"
    ADD COLUMN IF NOT EXISTS "auto_analysis_at" TIMESTAMPTZ;
  `);
  await execute(`
    ALTER TABLE "telegram_messages"
    ADD COLUMN IF NOT EXISTS "email_sent_at" TIMESTAMPTZ;
  `);
  await execute(`
    ALTER TABLE "telegram_messages"
    ADD COLUMN IF NOT EXISTS "email_status" TEXT;
  `);
  await execute(`
    ALTER TABLE "telegram_messages"
    ADD COLUMN IF NOT EXISTS "email_error" TEXT;
  `);
  await execute(`
    CREATE INDEX IF NOT EXISTS "telegram_messages_telegram_date_idx"
    ON "telegram_messages" ("telegram_date" DESC);
  `);
  await execute(`
    CREATE INDEX IF NOT EXISTS "telegram_messages_signal_hash_idx"
    ON "telegram_messages" ("signal_hash");
  `);
  tableReady = true;
}
async function storeTelegramMessage(input, strategy) {
  const chosen = strategy ?? await resolveStorageStrategy();
  if (chosen === "postgres_direct") {
    try {
      return await storeViaPostgres(input);
    } catch (error) {
      if (!isDatabaseConnectionError(error) || !isSupabaseConfigured()) throw error;
      console.warn("[Database] DATABASE_URL failed mid-save, falling back to Supabase client");
      setStrategy("supabase_client");
      return await storeViaSupabase(input);
    }
  }
  if (chosen === "supabase_client") return await storeViaSupabase(input);
  throw new Error("Database is not configured.");
}
async function storeViaSupabase(input) {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase client is not configured.");
  const signalHash = buildSignalHash(input);
  const { data, error } = await client.from(TABLE).upsert(
    {
      id: (0, import_node_crypto3.randomUUID)(),
      telegram_message_id: input.telegramMessageId,
      chat_id: input.chatId,
      chat_title: input.chatTitle,
      sender_id: input.senderId,
      sender_name: input.senderName,
      text: input.text,
      raw_text: input.rawText,
      reply_info: input.replyInfo,
      attachments: input.attachments ?? [],
      symbol: input.parsed.symbol,
      direction: input.parsed.direction,
      entry: input.parsed.entry,
      stop_loss: input.parsed.stopLoss,
      take_profit: input.parsed.takeProfit,
      parsed_signal_json: input.parsed,
      take_profits: input.parsed.takeProfits,
      signal_hash: signalHash,
      timeframe: input.parsed.timeframe,
      message_type: input.parsed.messageType,
      telegram_date: input.telegramDate
    },
    { onConflict: "chat_id,telegram_message_id", ignoreDuplicates: true }
  ).select();
  if (error) throw new Error(`Supabase insert failed: ${error.message}`);
  const inserted = Array.isArray(data) && data.length > 0;
  return { imported: inserted, record: inserted ? mapTelegramRow(data[0]) : null };
}
async function listViaSupabase(filter) {
  const client = getSupabaseClient();
  if (!client) return [];
  const limitN = Math.min(Math.max(filter.limit ?? 30, 1), 100);
  let q = client.from(TABLE).select("*").order("telegram_date", { ascending: false }).limit(limitN);
  if (filter.symbol) q = q.eq("symbol", filter.symbol.toUpperCase());
  if (filter.messageType && filter.messageType !== "ALL") q = q.eq("message_type", filter.messageType.toUpperCase());
  if (filter.direction && filter.direction !== "ALL") q = q.eq("direction", filter.direction.toUpperCase());
  const { data, error } = await q;
  if (error) throw new Error(`Supabase query failed: ${error.message}`);
  return (data ?? []).map((row) => mapTelegramRow(row));
}
async function storeViaPostgres(input) {
  await ensureTelegramMessagesTable();
  const signalHash = buildSignalHash(input);
  const result = await query(`
    INSERT INTO "telegram_messages" (
      "id",
      "telegram_message_id",
      "chat_id",
      "chat_title",
      "sender_id",
      "sender_name",
      "text",
      "raw_text",
      "reply_info",
      "attachments",
      "symbol",
      "direction",
      "entry",
      "stop_loss",
      "take_profit",
      "parsed_signal_json",
      "take_profits",
      "signal_hash",
      "timeframe",
      "message_type",
      "telegram_date"
    )
    VALUES (
      $1::uuid,
      $2,
      $3,
      $4,
      $5,
      $6,
      $7,
      $8,
      $9::jsonb,
      $10::jsonb,
      $11,
      $12,
      $13,
      $14,
      $15,
      $16::jsonb,
      $17::jsonb,
      $18,
      $19,
      $20,
      $21::timestamptz
    )
    ON CONFLICT ("chat_id", "telegram_message_id") DO NOTHING
    RETURNING *;
  `, [
    (0, import_node_crypto3.randomUUID)(),
    input.telegramMessageId,
    input.chatId,
    input.chatTitle,
    input.senderId,
    input.senderName,
    input.text,
    input.rawText,
    input.replyInfo ? JSON.stringify(input.replyInfo) : null,
    JSON.stringify(input.attachments ?? []),
    input.parsed.symbol,
    input.parsed.direction,
    input.parsed.entry,
    input.parsed.stopLoss,
    input.parsed.takeProfit,
    JSON.stringify(input.parsed),
    JSON.stringify(input.parsed.takeProfits ?? []),
    signalHash,
    input.parsed.timeframe,
    input.parsed.messageType,
    input.telegramDate
  ]);
  if (!result.rows.length) return { imported: false, record: null };
  return { imported: true, record: mapTelegramRow(result.rows[0]) };
}
async function listRecentTelegramMessages(filter = {}) {
  if (await resolveStorageStrategy() === "supabase_client") {
    return listViaSupabase(filter);
  }
  await ensureTelegramMessagesTable();
  const values = [];
  const conditions = [];
  if (filter.symbol) {
    values.push(filter.symbol.toUpperCase());
    conditions.push(`"symbol" = $${values.length}`);
  }
  if (filter.messageType && filter.messageType !== "ALL") {
    values.push(filter.messageType.toUpperCase());
    conditions.push(`"message_type" = $${values.length}`);
  }
  if (filter.direction && filter.direction !== "ALL") {
    values.push(filter.direction.toUpperCase());
    conditions.push(`"direction" = $${values.length}`);
  }
  const limit = Math.min(Math.max(filter.limit ?? 30, 1), 100);
  values.push(limit);
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = await query(`
    SELECT *
    FROM "telegram_messages"
    ${whereClause}
    ORDER BY "telegram_date" DESC
    LIMIT $${values.length};
  `, values);
  return rows.rows.map(mapTelegramRow);
}
async function getTelegramMessageById(id) {
  if (await resolveStorageStrategy() === "supabase_client") {
    const client = getSupabaseClient();
    if (!client) return null;
    const { data, error } = await client.from(TABLE).select("*").eq("id", id).limit(1);
    if (error) throw new Error(`Supabase query failed: ${error.message}`);
    return data?.[0] ? mapTelegramRow(data[0]) : null;
  }
  await ensureTelegramMessagesTable();
  const rows = await query(`
    SELECT *
    FROM "telegram_messages"
    WHERE "id" = $1::uuid
    LIMIT 1;
  `, [id]);
  return rows.rows[0] ? mapTelegramRow(rows.rows[0]) : null;
}
async function getTelegramMessageCounts() {
  if (await resolveStorageStrategy() === "supabase_client") {
    const client = getSupabaseClient();
    if (!client) return { total: 0, signals: 0, latestSync: null };
    const totalRes = await client.from(TABLE).select("*", { count: "exact", head: true });
    const signalsRes = await client.from(TABLE).select("*", { count: "exact", head: true }).eq("message_type", "SIGNAL");
    const latestRes = await client.from(TABLE).select("updated_at").order("updated_at", { ascending: false }).limit(1);
    const latest = latestRes.data?.[0]?.updated_at;
    return {
      total: totalRes.count ?? 0,
      signals: signalsRes.count ?? 0,
      latestSync: latest ? toIsoString(latest) : null
    };
  }
  await ensureTelegramMessagesTable();
  const rows = await query(`
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE "message_type" = 'SIGNAL')::bigint AS signals,
      MAX("updated_at") AS latest_sync
    FROM "telegram_messages";
  `);
  const row = rows.rows[0];
  return {
    total: Number(row?.total ?? 0),
    signals: Number(row?.signals ?? 0),
    latestSync: row?.latest_sync ? toIsoString(row.latest_sync) : null
  };
}
async function getLatestTelegramMessageIdForChat(chatId) {
  if (await resolveStorageStrategy() === "supabase_client") return null;
  await ensureTelegramMessagesTable();
  const rows = await query(`
    SELECT "telegram_message_id"
    FROM "telegram_messages"
    WHERE "chat_id" = $1
    ORDER BY ("telegram_message_id")::bigint DESC
    LIMIT 1;
  `, [chatId]);
  return rows.rows[0]?.telegram_message_id ?? null;
}
async function getTelegramMessageBySignalHash(signalHash) {
  if (!signalHash) return null;
  if (await resolveStorageStrategy() === "supabase_client") {
    const client = getSupabaseClient();
    if (!client) return null;
    const { data, error } = await client.from(TABLE).select("*").eq("signal_hash", signalHash).order("telegram_date", { ascending: false }).limit(1);
    if (error) throw new Error(`Supabase query failed: ${error.message}`);
    return data?.[0] ? mapTelegramRow(data[0]) : null;
  }
  await ensureTelegramMessagesTable();
  const rows = await query(`
    SELECT *
    FROM "telegram_messages"
    WHERE "signal_hash" = $1
    ORDER BY "telegram_date" DESC
    LIMIT 1;
  `, [signalHash]);
  return rows.rows[0] ? mapTelegramRow(rows.rows[0]) : null;
}
async function updateTelegramMessageAutomation(id, patch) {
  const payload = {
    updated_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  if ("autoAnalysisStatus" in patch) payload.auto_analysis_status = patch.autoAnalysisStatus ?? null;
  if ("autoAnalysisResult" in patch) payload.auto_analysis_result_json = patch.autoAnalysisResult ?? null;
  if ("autoAnalysisError" in patch) payload.auto_analysis_error = patch.autoAnalysisError ?? null;
  if ("autoAnalysisAt" in patch) payload.auto_analysis_at = patch.autoAnalysisAt ?? null;
  if ("emailSentAt" in patch) payload.email_sent_at = patch.emailSentAt ?? null;
  if ("emailStatus" in patch) payload.email_status = patch.emailStatus ?? null;
  if ("emailError" in patch) payload.email_error = patch.emailError ?? null;
  if (await resolveStorageStrategy() === "supabase_client") {
    const client = getSupabaseClient();
    if (!client) throw new Error("Supabase client is not configured.");
    const { data, error } = await client.from(TABLE).update(payload).eq("id", id).select().limit(1);
    if (error) throw new Error(`Supabase update failed: ${error.message}`);
    return data?.[0] ? mapTelegramRow(data[0]) : null;
  }
  await ensureTelegramMessagesTable();
  const assignments = [];
  const values = [id];
  if ("auto_analysis_status" in payload) {
    values.push(payload.auto_analysis_status ?? null);
    assignments.push(`"auto_analysis_status" = $${values.length}`);
  }
  if ("auto_analysis_result_json" in payload) {
    values.push(JSON.stringify(payload.auto_analysis_result_json ?? null));
    assignments.push(`"auto_analysis_result_json" = $${values.length}::jsonb`);
  }
  if ("auto_analysis_error" in payload) {
    values.push(payload.auto_analysis_error ?? null);
    assignments.push(`"auto_analysis_error" = $${values.length}`);
  }
  if ("auto_analysis_at" in payload) {
    values.push(payload.auto_analysis_at ?? null);
    assignments.push(`"auto_analysis_at" = $${values.length}::timestamptz`);
  }
  if ("email_sent_at" in payload) {
    values.push(payload.email_sent_at ?? null);
    assignments.push(`"email_sent_at" = $${values.length}::timestamptz`);
  }
  if ("email_status" in payload) {
    values.push(payload.email_status ?? null);
    assignments.push(`"email_status" = $${values.length}`);
  }
  if ("email_error" in payload) {
    values.push(payload.email_error ?? null);
    assignments.push(`"email_error" = $${values.length}`);
  }
  values.push(payload.updated_at);
  assignments.push(`"updated_at" = $${values.length}::timestamptz`);
  const result = await query(`
    UPDATE "telegram_messages"
    SET
      ${assignments.join(",\n      ")}
    WHERE "id" = $1::uuid
    RETURNING *;
  `, values);
  return result.rows[0] ? mapTelegramRow(result.rows[0]) : null;
}
function isTelegramStoreUnavailable(error) {
  return isDatabaseConnectionError(error);
}

// src/utils/telegram/parseTelegramSignal.ts
function parseTelegramSignal(text, _context) {
  return {
    messageType: "UNKNOWN",
    type: "unknown",
    direction: "UNKNOWN",
    symbol: null,
    entry: null,
    entryPrice: null,
    stopLoss: null,
    takeProfit: null,
    takeProfits: [],
    orderType: null,
    timeframe: null,
    rawText: text,
    confidence: 0,
    isLimitOrder: false
  };
}
function isTelegramLimitOrderSignal(_textOrSignal, _signal) {
  return false;
}

// src/utils/sessions/sessionTimes.ts
var SESSIONS = [
  { name: "ASIA", displayName: "Asia", start: "00:00", end: "09:00", timezone: "UTC" },
  { name: "LONDON", displayName: "London", start: "08:00", end: "17:00", timezone: "UTC" },
  { name: "NEW_YORK", displayName: "New York", start: "13:00", end: "22:00", timezone: "UTC" },
  { name: "LONDON_NY_OVERLAP", displayName: "London/NY", start: "13:00", end: "17:00", timezone: "UTC" }
];
function getActiveSession(_now) {
  return null;
}
function getNextSession(_now) {
  const next = SESSIONS[1];
  if (!next) return null;
  return { session: next, opensInMinutes: 0, closesInMinutes: 60 };
}

// backend/server/services/pairDecisionContext.service.ts
function deriveCalendarRisk(analysis) {
  if (analysis.intelligence.tradeStatus === "high_risk") return "high";
  const next = analysis.nextHighImpactEvent;
  if (next && next.isFuture) {
    if (next.minutesUntil <= 60) return "high";
    if (next.minutesUntil <= 180) return "medium";
  }
  return "low";
}
function deriveSpreadInfo(bid, ask, price) {
  if (bid == null || ask == null || price == null || price === 0) {
    return { spreadStatus: "unavailable", currentSpread: null };
  }
  const spread = ask - bid;
  const spreadPct = spread / price * 100;
  return {
    spreadStatus: spreadPct > 0.05 ? "wide" : "normal",
    currentSpread: Number(spread.toFixed(5))
  };
}
async function getPairDecisionContext(symbol) {
  const analysis = await buildPairAnalysis(symbol, { preferSavedAi: true });
  const calendarRisk = deriveCalendarRisk(analysis);
  const { spreadStatus, currentSpread } = deriveSpreadInfo(
    analysis.price.bid,
    analysis.price.ask,
    analysis.price.current
  );
  const highImpactEvents = analysis.relevantEvents.filter((e) => e.impact === "high" && e.isFuture).slice(0, 5).map((e) => {
    const currency = e.currency ? ` (${e.currency})` : "";
    return `${e.eventName}${currency} in ${e.minutesUntil}m`;
  });
  let volatility = null;
  if (analysis.price.dayHigh != null && analysis.price.dayLow != null) {
    volatility = Number((analysis.price.dayHigh - analysis.price.dayLow).toFixed(5));
  }
  const activeSession = getActiveSession();
  const nextSess = getNextSession();
  const nextSessionLabel = nextSess ? `${nextSess.session.name} in ${nextSess.opensInMinutes}m` : null;
  return {
    symbol: analysis.symbol,
    displaySymbol: analysis.displaySymbol,
    price: analysis.price.current,
    bid: analysis.price.bid,
    ask: analysis.price.ask,
    priceUpdatedAt: analysis.price.updatedAt,
    dayHigh: analysis.price.dayHigh,
    dayLow: analysis.price.dayLow,
    directionBias: analysis.overallBias,
    directionConfidence: analysis.overallConfidence,
    technicalBias: analysis.intelligence.technicalBias.direction,
    technicalScore: analysis.intelligence.technicalBias.percentage,
    technicalSummary: analysis.intelligence.technicalBias.summary,
    marketStructure: analysis.intelligence.tradePlan.preferredDirection,
    macroBias: analysis.fundamentals.bias,
    macroConfidence: analysis.fundamentals.confidence,
    fundamentalBias: analysis.intelligence.fundamentalBias.direction,
    fundamentalConfidence: analysis.intelligence.fundamentalBias.percentage,
    fundamentalSummary: analysis.intelligence.fundamentalBias.summary,
    fundamentalReason: analysis.fundamentals.reason,
    calendarRisk,
    highImpactEvents,
    topDrivers: analysis.fundamentals.keyDrivers,
    bullishDrivers: analysis.fundamentals.bullishDrivers,
    bearishDrivers: analysis.fundamentals.bearishDrivers,
    spreadStatus,
    currentSpread,
    volatility,
    support: analysis.price.dayLow,
    resistance: analysis.price.dayHigh,
    session: activeSession?.name ?? "Closed",
    nextSession: nextSessionLabel,
    tradeStatus: analysis.intelligence.tradeStatus,
    tradeStatusLabel: analysis.tradeStatus.label,
    verdict: analysis.intelligence.overallBias,
    verdictScore: analysis.intelligence.biasPercentage,
    reasoning: analysis.intelligence.summary,
    risks: analysis.intelligence.risks,
    invalidation: analysis.intelligence.invalidation,
    dataGeneratedAt: analysis.fundamentals.lastUpdated,
    fundamentalsUpdatedAt: analysis.fundamentals.lastUpdated,
    mode: analysis.fundamentals.mode
  };
}

// backend/server/services/telegramSignalAnalyze.service.ts
var SIGNAL_MODEL = "gpt-4o-mini";
var MIN_RR = 1;
function compactSymbol(symbol) {
  return symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function formatPrice(value) {
  if (!isFiniteNumber(value)) return "unavailable";
  if (Math.abs(value) >= 1e3) return value.toFixed(2);
  if (Math.abs(value) >= 10) return value.toFixed(3).replace(/\.?0+$/, "");
  return value.toFixed(5).replace(/\.?0+$/, "");
}
function formatSignedPrice(value) {
  if (!isFiniteNumber(value)) return "unavailable";
  const formatted = formatPrice(value);
  return value > 0 ? `+${formatted}` : formatted;
}
function formatDuration(ms) {
  if (!isFiniteNumber(ms) || ms < 0) return "unknown";
  const totalMinutes = Math.round(ms / 6e4);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}
function computeRR(parsed) {
  const { entry, stopLoss, takeProfits, direction } = parsed;
  if (!entry || !stopLoss || takeProfits.length === 0) return null;
  const isBuy = direction === "BUY" || direction === "LONG";
  const risk = isBuy ? entry - stopLoss : stopLoss - entry;
  if (!Number.isFinite(risk) || risk <= 0) return null;
  const targets = takeProfits.map((price, index) => {
    const reward = isBuy ? price - entry : entry - price;
    if (!Number.isFinite(reward)) return null;
    return {
      targetIndex: index + 1,
      price,
      reward: Number(reward.toFixed(5)),
      ratio: Number((reward / risk).toFixed(2))
    };
  }).filter((target) => Boolean(target));
  const tp1 = targets[0] ?? null;
  const tp2 = targets[1] ?? null;
  const tp3 = targets[2] ?? null;
  return {
    risk: Number(risk.toFixed(5)),
    targets,
    tp1Reward: tp1?.reward ?? null,
    tp1Ratio: tp1?.ratio ?? null,
    tp2Reward: tp2?.reward ?? null,
    tp2Ratio: tp2?.ratio ?? null,
    tp3Reward: tp3?.reward ?? null,
    tp3Ratio: tp3?.ratio ?? null
  };
}
function rrLabel(rr) {
  if (!rr || rr.targets.length === 0) return "invalid";
  const bestRatio = Math.max(...rr.targets.map((target) => target.ratio));
  if (bestRatio >= 1.5) return "good";
  if (bestRatio >= 0.5) return "weak";
  return "invalid";
}
function classifySpread(symbol, spread) {
  if (spread == null) return "unavailable";
  const compact = compactSymbol(symbol);
  const baseline = compact === "XAUUSD" ? 0.35 : compact.endsWith("JPY") ? 0.02 : 2e-4;
  if (spread >= baseline * 2.5) return "high";
  if (spread >= baseline * 1.5) return "elevated";
  return "normal";
}
function classifyVolatility(symbol, currentPrice, high, low) {
  if (!isFiniteNumber(currentPrice) || !isFiniteNumber(high) || !isFiniteNumber(low) || currentPrice <= 0) return "unavailable";
  const rangePct = (high - low) / currentPrice * 100;
  const isGold = compactSymbol(symbol) === "XAUUSD";
  if (rangePct >= (isGold ? 1.35 : 0.9)) return "extreme";
  if (rangePct >= (isGold ? 0.85 : 0.55)) return "high";
  if (rangePct <= (isGold ? 0.2 : 0.12)) return "low";
  return "normal";
}
function mapBiasToTrend(bias) {
  if (bias === "bullish") return "bullish";
  if (bias === "bearish") return "bearish";
  if (bias === "neutral" || bias === "mixed") return "mixed";
  return "unknown";
}
function scoreAlignment(alignment) {
  if (alignment === "aligned") return 80;
  if (alignment === "mixed") return 55;
  if (alignment === "against") return 25;
  return 40;
}
function scoreRiskReward(rr) {
  if (!rr?.targets.length) return 20;
  const tp1 = rr.targets[0]?.ratio ?? null;
  const best = Math.max(...rr.targets.map((target) => target.ratio));
  if (tp1 != null && tp1 < 0.5) return 15;
  if (tp1 != null && tp1 < 1 && best >= 1.5) return 45;
  if (best >= 3) return 85;
  if (best >= 2) return 72;
  if (best >= 1.5) return 60;
  if (best >= 1) return 45;
  return 25;
}
function scoreExecution2(args) {
  if (args.hardReject) return 0;
  let score = 82;
  if (args.spreadStatus === "elevated") score -= 15;
  if (args.spreadStatus === "dangerous") score -= 35;
  if (args.spreadStatus === "unavailable") score -= 10;
  if (args.volatility === "high") score -= 15;
  if (args.volatility === "extreme") score -= 28;
  if (args.volatility === "unavailable") score -= 8;
  if (args.calendarRisk === "medium") score -= 12;
  if (args.calendarRisk === "high") score -= 24;
  if (args.freshnessStatus === "Delayed") score -= 8;
  if (args.freshnessStatus === "Stale") score -= 28;
  if (args.freshnessStatus === "Expired") score -= 45;
  return Math.max(0, Math.min(95, Math.round(score)));
}
function buildConfluence(args) {
  const technicalAlignment = scoreAlignment(args.technicalAlignment);
  const fundamentalAlignment = scoreAlignment(args.fundamentalAlignment);
  const riskRewardQuality = scoreRiskReward(args.rr);
  const executionConditions = scoreExecution2(args);
  const overall = args.hardReject ? 0 : Math.round((technicalAlignment + fundamentalAlignment + riskRewardQuality + executionConditions) / 4);
  return { technicalAlignment, fundamentalAlignment, riskRewardQuality, executionConditions, overall };
}
function buildFundamentalsContext(pairContext) {
  if (!pairContext) {
    return {
      bias: "unavailable",
      confidence: null,
      calendarRisk: "unavailable",
      highImpactEvents: [],
      keyDrivers: [],
      risks: [],
      sourceUpdatedAt: null
    };
  }
  return {
    bias: pairContext.macroBias,
    confidence: pairContext.macroConfidence,
    calendarRisk: pairContext.calendarRisk,
    highImpactEvents: pairContext.highImpactEvents.slice(0, 5),
    keyDrivers: pairContext.topDrivers.slice(0, 6),
    risks: pairContext.risks.slice(0, 6),
    sourceUpdatedAt: pairContext.fundamentalsUpdatedAt ?? pairContext.dataGeneratedAt
  };
}
function buildTechnicalContextFromPair(pairContext, symbol) {
  return {
    currentPrice: pairContext.price,
    trend: mapBiasToTrend(pairContext.directionBias),
    session: pairContext.session,
    nextSession: pairContext.nextSession,
    support: pairContext.support,
    resistance: pairContext.resistance,
    sma20: null,
    sma50: null,
    marketStructure: pairContext.marketStructure,
    technicalScore: pairContext.technicalScore,
    spread: pairContext.currentSpread,
    spreadStatus: classifySpread(symbol, pairContext.currentSpread),
    atr: null,
    volatility: classifyVolatility(symbol, pairContext.price, pairContext.dayHigh, pairContext.dayLow),
    technicalAlignment: "unavailable",
    source: "AlphaMentals Pair Analysis",
    sourcePath: `/pair/${symbol}`,
    lastUpdated: pairContext.priceUpdatedAt,
    entryLocationQuality: "Unavailable until objective validation is computed.",
    liquidityContext: pairContext.session === "Closed" ? "Session is closed." : `${pairContext.session}${pairContext.nextSession ? ` \xB7 Next: ${pairContext.nextSession}` : ""}`,
    confirmationNeeded: [],
    assessment: "Technical pair intelligence loaded."
  };
}
function buildEmptyTechnicalContext(symbol) {
  return {
    currentPrice: null,
    trend: "unknown",
    session: "Unknown",
    nextSession: null,
    support: null,
    resistance: null,
    sma20: null,
    sma50: null,
    marketStructure: null,
    technicalScore: null,
    spread: null,
    spreadStatus: "unavailable",
    atr: null,
    volatility: "unavailable",
    technicalAlignment: "unavailable",
    source: "AlphaMentals Pair Analysis",
    sourcePath: `/pair/${symbol}`,
    lastUpdated: null,
    entryLocationQuality: "Technical pair intelligence unavailable or stale. Technical alignment confidence reduced.",
    liquidityContext: "Technical pair intelligence unavailable or stale. Technical alignment confidence reduced.",
    confirmationNeeded: [],
    assessment: "Technical pair intelligence unavailable or stale. Technical alignment confidence reduced."
  };
}
function deriveOrderTypeValidity(parsed, currentPrice) {
  const direction = parsed.direction ?? "UNKNOWN";
  const orderType = parsed.orderType ?? "MARKET";
  if (currentPrice == null) {
    return {
      status: false,
      reason: "Current price is unavailable, so order type validity cannot be confirmed."
    };
  }
  if (orderType !== "MARKET" && parsed.entry == null) {
    return {
      status: false,
      reason: `Pending ${direction} ${orderType} signal is missing an entry price.`
    };
  }
  if (orderType === "LIMIT") {
    if (direction === "BUY") {
      const valid = (parsed.entry ?? Infinity) < currentPrice;
      return {
        status: valid,
        reason: valid ? `BUY LIMIT entry ${formatPrice(parsed.entry)} is below current price ${formatPrice(currentPrice)}.` : `BUY LIMIT entry ${formatPrice(parsed.entry)} must be below current price ${formatPrice(currentPrice)}.`
      };
    }
    if (direction === "SELL") {
      const valid = (parsed.entry ?? -Infinity) > currentPrice;
      return {
        status: valid,
        reason: valid ? `SELL LIMIT entry ${formatPrice(parsed.entry)} is above current price ${formatPrice(currentPrice)}.` : `SELL LIMIT entry ${formatPrice(parsed.entry)} must be above current price ${formatPrice(currentPrice)}.`
      };
    }
  }
  if (orderType === "STOP") {
    if (direction === "BUY") {
      const valid = (parsed.entry ?? -Infinity) > currentPrice;
      return {
        status: valid,
        reason: valid ? `BUY STOP entry ${formatPrice(parsed.entry)} is above current price ${formatPrice(currentPrice)}.` : `BUY STOP entry ${formatPrice(parsed.entry)} must be above current price ${formatPrice(currentPrice)}.`
      };
    }
    if (direction === "SELL") {
      const valid = (parsed.entry ?? Infinity) < currentPrice;
      return {
        status: valid,
        reason: valid ? `SELL STOP entry ${formatPrice(parsed.entry)} is below current price ${formatPrice(currentPrice)}.` : `SELL STOP entry ${formatPrice(parsed.entry)} must be below current price ${formatPrice(currentPrice)}.`
      };
    }
  }
  if (direction === "BUY" || direction === "SELL") {
    return {
      status: true,
      reason: `${direction} market signal can be evaluated immediately at current price ${formatPrice(currentPrice)}.`
    };
  }
  return {
    status: false,
    reason: `Unsupported direction/order type combination: ${direction} ${orderType}.`
  };
}
function deriveInvalidation(parsed, currentPrice) {
  if (parsed.stopLoss == null || currentPrice == null || !parsed.direction) {
    return { status: false, reason: "Current price or stop loss unavailable, so invalidation cannot be confirmed." };
  }
  if (parsed.direction === "SELL") {
    if (currentPrice > parsed.stopLoss) {
      return {
        status: true,
        reason: `Rejected because current price ${formatPrice(currentPrice)} is already above the SELL stop loss ${formatPrice(parsed.stopLoss)}.`
      };
    }
    return {
      status: false,
      reason: `Current price ${formatPrice(currentPrice)} remains below the SELL stop loss ${formatPrice(parsed.stopLoss)}.`
    };
  }
  if (parsed.direction === "BUY") {
    if (currentPrice < parsed.stopLoss) {
      return {
        status: true,
        reason: `Rejected because current price ${formatPrice(currentPrice)} is already below the BUY stop loss ${formatPrice(parsed.stopLoss)}.`
      };
    }
    return {
      status: false,
      reason: `Current price ${formatPrice(currentPrice)} remains above the BUY stop loss ${formatPrice(parsed.stopLoss)}.`
    };
  }
  return { status: false, reason: "Direction unavailable, so invalidation could not be checked." };
}
function deriveSignalFreshness(symbol, signalTime, currentPrice, parsed, rr, invalidated) {
  if (invalidated) {
    return {
      signalAgeMs: signalTime ? Math.max(0, Date.now() - new Date(signalTime).getTime()) : null,
      freshnessStatus: "Expired",
      signalAgeText: signalTime ? formatDuration(Math.max(0, Date.now() - new Date(signalTime).getTime())) : "unknown"
    };
  }
  const signalAt = signalTime ? new Date(signalTime).getTime() : Number.NaN;
  const signalAgeMs = Number.isFinite(signalAt) ? Math.max(0, Date.now() - signalAt) : null;
  const ageText = formatDuration(signalAgeMs);
  const entryDistance = currentPrice != null && parsed.entry != null ? Math.abs(currentPrice - parsed.entry) : null;
  const distanceR = entryDistance != null && rr?.risk ? entryDistance / rr.risk : null;
  const isGold = compactSymbol(symbol) === "XAUUSD";
  let freshnessStatus = signalTime ? "Fresh" : "Unknown";
  if (signalAgeMs != null) {
    if (signalAgeMs > (isGold ? 6 : 12) * 60 * 6e4) freshnessStatus = "Expired";
    else if (signalAgeMs > (isGold ? 90 : 180) * 6e4) freshnessStatus = "Stale";
    else if (signalAgeMs > (isGold ? 30 : 60) * 6e4) freshnessStatus = "Delayed";
  }
  if (distanceR != null) {
    if (distanceR >= (isGold ? 2 : 2.5)) freshnessStatus = "Expired";
    else if (distanceR >= (isGold ? 1.25 : 1.75) && freshnessStatus === "Fresh") freshnessStatus = "Stale";
    else if (distanceR >= (isGold ? 0.75 : 1.1) && freshnessStatus === "Fresh") freshnessStatus = "Delayed";
  }
  return {
    signalAgeMs,
    freshnessStatus,
    signalAgeText: ageText
  };
}
function deriveSupportResistanceConflict(parsed, pairContext, rr) {
  if (!pairContext || pairContext.support == null || pairContext.resistance == null) {
    return "Support/resistance unavailable from /pair data.";
  }
  if (parsed.entry == null || !parsed.direction) {
    return "Entry or direction unavailable, so support/resistance conflict could not be assessed.";
  }
  const risk = rr?.risk ?? null;
  if (parsed.direction === "SELL") {
    const distanceToSupport = parsed.entry - pairContext.support;
    if (distanceToSupport <= 0) return `SELL setup is already sitting at or below support ${formatPrice(pairContext.support)}.`;
    if (risk && distanceToSupport / risk < 0.75) {
      return `SELL setup is trading into nearby support ${formatPrice(pairContext.support)} only ${formatPrice(distanceToSupport)} away (${(distanceToSupport / risk).toFixed(2)}R).`;
    }
    return `Support at ${formatPrice(pairContext.support)} leaves ${formatPrice(distanceToSupport)} of room below the SELL entry.`;
  }
  const distanceToResistance = pairContext.resistance - parsed.entry;
  if (distanceToResistance <= 0) return `BUY setup is already sitting at or above resistance ${formatPrice(pairContext.resistance)}.`;
  if (risk && distanceToResistance / risk < 0.75) {
    return `BUY setup is trading into nearby resistance ${formatPrice(pairContext.resistance)} only ${formatPrice(distanceToResistance)} away (${(distanceToResistance / risk).toFixed(2)}R).`;
  }
  return `Resistance at ${formatPrice(pairContext.resistance)} leaves ${formatPrice(distanceToResistance)} of room above the BUY entry.`;
}
function deriveExecutionConditions(symbol, pairContext, technicalContext) {
  if (!pairContext) {
    return {
      headlineRisk: "unavailable",
      text: "Pair technical context unavailable, so session/spread/volatility checks are reduced."
    };
  }
  const headlineRisk = pairContext.highImpactEvents.length > 0 ? pairContext.highImpactEvents.some((event) => /in\s([0-5]?\d)m/i.test(event)) ? "high" : "medium" : pairContext.risks.some((risk) => /headline|geopolitic|war|conflict|breaking/i.test(risk)) ? "medium" : "low";
  const spreadText = technicalContext.spreadStatus === "high" ? "dangerous spread" : technicalContext.spreadStatus === "elevated" ? "elevated spread" : technicalContext.spreadStatus === "normal" ? "normal spread" : "spread unavailable";
  const sessionText = pairContext.session === "Closed" ? "session closed" : `active session ${pairContext.session}`;
  const volatilityText = technicalContext.volatility === "unavailable" ? "volatility unavailable" : `${technicalContext.volatility} volatility`;
  return {
    headlineRisk,
    text: `${sessionText}; ${spreadText}; ${volatilityText}.`
  };
}
function buildObjectiveValidationFacts(args) {
  const { symbol, parsed, rr, pairContext, technicalContext, signalTime, analysisTime } = args;
  const currentPrice = pairContext?.price ?? technicalContext.currentPrice ?? null;
  const orderTypeValid = deriveOrderTypeValidity(parsed, currentPrice);
  const alreadyInvalidated = deriveInvalidation(parsed, currentPrice);
  const freshness = deriveSignalFreshness(symbol, signalTime, currentPrice, parsed, rr, alreadyInvalidated.status);
  const entryDistanceValue = currentPrice != null && parsed.entry != null ? Number(Math.abs(currentPrice - parsed.entry).toFixed(5)) : null;
  const entryDistanceRValue = entryDistanceValue != null && rr?.risk ? Number((entryDistanceValue / rr.risk).toFixed(2)) : null;
  const riskSize = rr?.risk ?? (parsed.entry != null && parsed.stopLoss != null ? Number(Math.abs(parsed.entry - parsed.stopLoss).toFixed(5)) : null);
  const priceVsEntry = parsed.entry == null ? "Entry unavailable." : currentPrice == null ? "Current price unavailable." : `Current price ${formatPrice(currentPrice)} vs entry ${formatPrice(parsed.entry)} = ${formatSignedPrice(currentPrice - parsed.entry)}.`;
  const priceVsStopLoss = parsed.stopLoss == null ? "Stop loss unavailable." : currentPrice == null ? "Current price unavailable." : `Current price ${formatPrice(currentPrice)} vs stop loss ${formatPrice(parsed.stopLoss)} = ${formatSignedPrice(currentPrice - parsed.stopLoss)}.`;
  const srConflictText = deriveSupportResistanceConflict(parsed, pairContext, rr);
  const executionCondition = deriveExecutionConditions(symbol, pairContext, technicalContext);
  const missingCriticalData = [
    currentPrice == null ? "current price" : null,
    parsed.stopLoss == null ? "stop loss" : null,
    (parsed.orderType === "LIMIT" || parsed.orderType === "STOP") && parsed.entry == null ? "entry" : null
  ].filter((value) => Boolean(value));
  const hardRejectionReasons = [];
  if (!orderTypeValid.status) hardRejectionReasons.push(orderTypeValid.reason);
  if (alreadyInvalidated.status) hardRejectionReasons.push(alreadyInvalidated.reason);
  if (parsed.stopLoss == null) hardRejectionReasons.push("Stop loss is missing, so invalidation and risk cannot be validated.");
  if ((parsed.orderType === "LIMIT" || parsed.orderType === "STOP") && parsed.entry == null) {
    hardRejectionReasons.push(`Pending ${parsed.direction ?? "UNKNOWN"} ${parsed.orderType} signal is missing an entry price.`);
  }
  if (currentPrice == null) hardRejectionReasons.push("Current price is missing, so execution validity cannot be confirmed.");
  if (freshness.freshnessStatus === "Expired") hardRejectionReasons.push(`Signal is ${freshness.freshnessStatus.toLowerCase()} based on age and/or price drift from entry.`);
  let rejectionCategory = "NONE";
  if (alreadyInvalidated.status) rejectionCategory = "ALREADY_INVALIDATED";
  else if (!orderTypeValid.status) rejectionCategory = "INVALID_ORDER_TYPE";
  else if (parsed.stopLoss == null || (parsed.orderType === "LIMIT" || parsed.orderType === "STOP") && parsed.entry == null || currentPrice == null) rejectionCategory = "INSUFFICIENT_DATA";
  else if (freshness.freshnessStatus === "Stale" || freshness.freshnessStatus === "Expired") rejectionCategory = "STALE_SIGNAL";
  const whatWouldMakeItValid = [
    !orderTypeValid.status ? "Rebuild the order so the pending entry is on the correct side of the live market price." : null,
    alreadyInvalidated.status ? "Wait for a brand-new setup because the current stop-loss has already been breached." : null,
    freshness.freshnessStatus === "Stale" || freshness.freshnessStatus === "Expired" ? "Wait for a fresh signal closer to current market price." : null,
    srConflictText.includes("nearby support") || srConflictText.includes("nearby resistance") ? "Wait for price to clear the nearby support/resistance conflict or improve the RR." : null,
    executionCondition.text.includes("dangerous spread") ? "Wait for spread conditions to normalize before considering execution." : null
  ].filter((value) => Boolean(value));
  return {
    analysisTime,
    signalTime,
    signalAgeMs: freshness.signalAgeMs,
    signalAgeText: freshness.signalAgeText,
    freshnessStatus: freshness.freshnessStatus,
    orderTypeValid,
    alreadyInvalidated,
    currentPrice,
    priceVsEntry,
    priceVsStopLoss,
    entryDistanceValue,
    entryDistanceText: entryDistanceValue == null ? "unavailable" : `${formatPrice(entryDistanceValue)}`,
    entryDistanceRValue,
    entryDistanceRText: entryDistanceRValue == null ? null : `${entryDistanceRValue.toFixed(2)}R`,
    riskSize,
    riskSizeText: riskSize == null ? "unavailable" : formatPrice(riskSize),
    minRR: MIN_RR,
    tpRRText: rr?.targets.length ? rr.targets.map((target) => `TP${target.targetIndex}: ${target.ratio}R`).join(" | ") : "unavailable",
    srConflictText,
    executionConditionText: executionCondition.text,
    missingCriticalData,
    hardRejectionRequired: hardRejectionReasons.length > 0,
    hardRejectionReasons,
    rejectionCategory,
    whatWouldMakeItValid,
    headlineRisk: executionCondition.headlineRisk
  };
}
function buildObjectiveValidationContext(facts) {
  return `Current price: ${formatPrice(facts.currentPrice)}
Order type valid: ${facts.orderTypeValid.status ? "yes" : "no"} \u2014 ${facts.orderTypeValid.reason}
Current price vs entry: ${facts.priceVsEntry}
Current price vs SL: ${facts.priceVsStopLoss}
Already invalidated: ${facts.alreadyInvalidated.status ? "yes" : "no"} \u2014 ${facts.alreadyInvalidated.reason}
Signal time: ${facts.signalTime ?? "unknown"}
Analysis time: ${facts.analysisTime}
Signal age: ${facts.signalAgeText}
Freshness status: ${facts.freshnessStatus}
Entry distance: ${facts.entryDistanceText}
Entry distance in R: ${facts.entryDistanceRText ?? "unavailable"}
Risk size: ${facts.riskSizeText}
Minimum RR required: ${facts.minRR}
TP RR results: ${facts.tpRRText}
Support/resistance conflict: ${facts.srConflictText}
Session/spread/volatility warning: ${facts.executionConditionText}
Missing critical data: ${facts.missingCriticalData.join(", ") || "none"}
Hard rejection required: ${facts.hardRejectionRequired ? "yes" : "no"}
Hard rejection reasons: ${facts.hardRejectionReasons.join("; ") || "none"}`;
}
function buildRiskRewardSummary(rr) {
  if (!rr) {
    return {
      riskSize: null,
      tpAssessments: [],
      overallQuality: "unavailable",
      assessment: "Risk/reward unavailable because entry, stop loss, or take profit values are incomplete."
    };
  }
  const tpAssessments = rr.targets.map((target) => {
    let quality = "acceptable";
    if (target.ratio >= 1.5) quality = "good";
    else if (target.ratio < 0.5) quality = "very_weak";
    else if (target.ratio < 1) quality = "weak";
    const comment = target.ratio >= 1.5 ? `TP${target.targetIndex} offers strong RR at ${target.ratio}R.` : target.ratio >= 1 ? `TP${target.targetIndex} offers acceptable RR at ${target.ratio}R.` : target.ratio >= 0.5 ? `TP${target.targetIndex} is weak at only ${target.ratio}R.` : `TP${target.targetIndex} is very weak at only ${target.ratio}R.`;
    return {
      tp: `TP${target.targetIndex} @ ${formatPrice(target.price)}`,
      rr: target.ratio,
      quality,
      comment
    };
  });
  const tp1 = rr.targets[0]?.ratio ?? null;
  const best = rr.targets.length ? Math.max(...rr.targets.map((target) => target.ratio)) : null;
  let overallQuality = "poor";
  if (best == null) overallQuality = "unavailable";
  else if (tp1 != null && tp1 >= 1 && best >= 1.5) overallQuality = "good";
  else if (best >= 1.5 || tp1 != null && tp1 >= 0.5) overallQuality = "mixed";
  const assessment = best == null ? "Risk/reward unavailable." : tp1 != null && tp1 < 0.5 ? `TP1 is very weak at ${tp1}R, so the reward profile is poor even if later targets are larger.` : tp1 != null && tp1 < 1 && best >= 1.5 ? `TP1 is weak at ${tp1}R while deeper targets improve the profile, so RR is mixed rather than good.` : `Best RR available is ${best}R with TP1 at ${tp1 ?? "unavailable"}R.`;
  return {
    riskSize: rr.risk,
    tpAssessments,
    overallQuality,
    assessment
  };
}
function deriveTechnicalAlignment(parsed, pairContext) {
  if (!pairContext || !parsed.direction) return "unavailable";
  if (pairContext.directionBias === "unknown" || pairContext.directionBias === "neutral") return "mixed";
  if (pairContext.directionBias === "mixed") return "mixed";
  if (parsed.direction === "BUY") return pairContext.directionBias === "bullish" ? "aligned" : "against";
  if (parsed.direction === "SELL") return pairContext.directionBias === "bearish" ? "aligned" : "against";
  return "unavailable";
}
function deriveFundamentalAlignment(parsed, pairContext) {
  if (!pairContext || !parsed.direction) return "unavailable";
  if (pairContext.macroBias === "unknown" || pairContext.macroBias === "neutral") return "mixed";
  if (pairContext.macroBias === "mixed") return "mixed";
  if (parsed.direction === "BUY") return pairContext.macroBias === "bullish" ? "aligned" : "against";
  if (parsed.direction === "SELL") return pairContext.macroBias === "bearish" ? "aligned" : "against";
  return "unavailable";
}
function buildTechnicalPromptContext(pairContext, technicalContext) {
  if (!pairContext) {
    return "Technical pair intelligence unavailable or stale. Technical alignment confidence reduced.";
  }
  return [
    `Current price: ${formatPrice(pairContext.price)}`,
    `Trend: ${pairContext.directionBias} (${pairContext.directionConfidence}%)`,
    `Technical bias: ${pairContext.technicalBias} (${pairContext.technicalScore}%)`,
    `Market structure: ${pairContext.marketStructure}`,
    `Support: ${formatPrice(pairContext.support)}`,
    `Resistance: ${formatPrice(pairContext.resistance)}`,
    `Spread: ${formatPrice(pairContext.currentSpread)} (${technicalContext.spreadStatus})`,
    `Volatility: ${technicalContext.volatility}`,
    `Session: ${pairContext.session}${pairContext.nextSession ? ` \xB7 Next: ${pairContext.nextSession}` : ""}`,
    `Technical summary: ${pairContext.technicalSummary}`,
    `Source updated at: ${pairContext.priceUpdatedAt ?? "unknown"}`
  ].join("\n");
}
function buildFundamentalsPromptContext(pairContext) {
  if (!pairContext) {
    return "Fundamental intelligence unavailable or stale. Macro alignment confidence reduced.";
  }
  return [
    `Macro bias: ${pairContext.macroBias} (${pairContext.macroConfidence}%)`,
    `Fundamental bias: ${pairContext.fundamentalBias} (${pairContext.fundamentalConfidence}%)`,
    `Calendar risk: ${pairContext.calendarRisk}`,
    `High-impact events: ${pairContext.highImpactEvents.join("; ") || "none"}`,
    `Key drivers: ${pairContext.topDrivers.join("; ") || "none"}`,
    `Risks: ${pairContext.risks.join("; ") || "none"}`,
    `Fundamental reason: ${pairContext.fundamentalReason}`,
    `Source updated at: ${pairContext.fundamentalsUpdatedAt ?? "unknown"}`
  ].join("\n");
}
function buildSignalPrompt(args) {
  const { parsed, rr, pairContext, technicalPairContext, fundContext, livePriceContext, objectiveValidationContext, signalTime, sourceMessage } = args;
  const rrLines = rr ? rr.targets.map((t) => `TP${t.targetIndex}: reward ${formatPrice(t.reward)}, RR ${t.ratio}`).join("\n") : "Unavailable \u2014 entry, SL, or TPs were not parsed.";
  const directionConflict = pairContext ? `Signal direction (${parsed.direction}) vs technical bias (${pairContext.directionBias} ${pairContext.directionConfidence}%) and macro bias (${pairContext.macroBias} ${pairContext.macroConfidence}%).` : "Dashboard bias unavailable.";
  return `SIGNAL DETAILS
Symbol: ${parsed.symbol ?? "unknown"}
Direction: ${parsed.direction ?? "unknown"}
Order type: ${parsed.orderType ?? "MARKET"}
Entry: ${parsed.entry ?? "unknown"}
Stop loss: ${parsed.stopLoss ?? "unknown"}
Take profits: ${parsed.takeProfits.length ? parsed.takeProfits.join(", ") : "none"}
Telegram Signal Time: ${signalTime ?? "unknown"}
Analysis Time: ${(/* @__PURE__ */ new Date()).toISOString()}
Original Source Message:
${sourceMessage ?? "unavailable"}

LIVE PRICE DATA
Source: MT5 Bridge / backend market data
${livePriceContext}

OBJECTIVE VALIDATION FACTS
These are backend-calculated facts. Treat them as truth.
${objectiveValidationContext}

RISK/REWARD
${rrLines}

DIRECTION CONFLICT CHECK
${directionConflict}

TECHNICAL PAIR ANALYSIS CONTEXT
Source: /pair/${parsed.symbol ?? "unknown"}
This is the same data source powering:
https://alphamentals-dashboard.vercel.app/pair/${parsed.symbol ?? "unknown"}

Use this technical context only. Do not invent technical values.
${technicalPairContext}

FUNDAMENTALS CONTEXT
Source: /market-intelligence/fundamentals/${parsed.symbol ?? "unknown"}
This is the same data source powering:
https://alphamentals-dashboard.vercel.app/market-intelligence/fundamentals/${parsed.symbol ?? "unknown"}

Use this fundamentals context only. Do not invent macro values.
${fundContext}

VALIDATION TASK
Validate whether this signal is GOOD, RISKY, BAD, or WAIT.

Decision definitions:
- GOOD: valid execution, aligned technicals, aligned fundamentals, acceptable RR, no major execution/news risk.
- RISKY: valid but has one or more important concerns.
- WAIT: setup may become valid but needs confirmation, liquidity, freshness, or news risk resolution.
- BAD: invalid order type, already invalidated, stale/expired, strong macro conflict, strong technical conflict, poor RR, missing SL, dangerous execution conditions, or insufficient critical data.

Required checks:
1. Check order type validity first.
2. Check whether current price has already passed SL.
3. Check signal freshness and distance from entry.
4. Check RR per TP.
5. Check support/resistance conflict using /pair/${parsed.symbol ?? "unknown"} data.
6. Check technical alignment using /pair/${parsed.symbol ?? "unknown"} data.
7. Check AlphaMentals fundamentals alignment using /market-intelligence/fundamentals/${parsed.symbol ?? "unknown"} data.
8. Check news/session/spread/volatility.
9. Return strict JSON only.

Reference actual price levels, RR values, support/resistance, bias percentages, source paths, and timestamps when available.`;
}
function buildLivePriceContext(pairContext) {
  if (!pairContext) return "Live MT5-backed price unavailable.";
  return [
    `Current price: ${formatPrice(pairContext.price)}`,
    `Bid: ${formatPrice(pairContext.bid)}`,
    `Ask: ${formatPrice(pairContext.ask)}`,
    `Day high: ${formatPrice(pairContext.dayHigh)}`,
    `Day low: ${formatPrice(pairContext.dayLow)}`,
    `Price updated at: ${pairContext.priceUpdatedAt ?? "unknown"}`
  ].join("\n");
}
function safeChecklistStatus(condition) {
  if (condition == null) return "unavailable";
  return condition ? "pass" : "fail";
}
function buildLegacyFields(result) {
  return {
    confidence: result.aiVerdictConfidence,
    reasoning: result.primaryReason,
    riskRewardAssessment: result.riskReward.assessment,
    entryAssessment: result.executionValidity.currentPriceVsEntry,
    slAssessment: result.executionValidity.currentPriceVsStopLoss,
    tpAssessment: result.riskReward.assessment,
    keyReasons: [...result.hardRejectionReasons, ...result.positiveFactors],
    keyRisks: [...result.softConcerns, ...result.conflicts]
  };
}
function buildFallbackValidation(args) {
  const { parsed, rr, pairContext, objectiveFacts, technicalContext, fundamentalsContext } = args;
  const technicalAlignment = deriveTechnicalAlignment(parsed, pairContext);
  const fundamentalAlignment = deriveFundamentalAlignment(parsed, pairContext);
  const riskReward = buildRiskRewardSummary(rr);
  const spreadStatus = technicalContext.spreadStatus === "high" ? "dangerous" : technicalContext.spreadStatus === "elevated" ? "elevated" : technicalContext.spreadStatus === "normal" ? "normal" : "unavailable";
  const newsAndSessionRisk = {
    calendarRisk: fundamentalsContext.calendarRisk === "high" || fundamentalsContext.calendarRisk === "medium" || fundamentalsContext.calendarRisk === "low" ? fundamentalsContext.calendarRisk : "unavailable",
    headlineRisk: objectiveFacts.headlineRisk,
    session: technicalContext.session,
    liquidityQuality: technicalContext.session === "Closed" ? "poor" : technicalContext.session === "Unknown" ? "unavailable" : "good",
    spreadStatus,
    volatility: technicalContext.volatility ?? "unavailable",
    assessment: objectiveFacts.executionConditionText
  };
  const hardReject = objectiveFacts.hardRejectionRequired;
  const decisionLabel2 = hardReject ? "REJECTED" : objectiveFacts.freshnessStatus === "Delayed" ? "NEEDS_CONFIRMATION" : objectiveFacts.freshnessStatus === "Stale" ? "WAIT" : "WAIT";
  const verdict = hardReject ? "BAD" : objectiveFacts.freshnessStatus === "Stale" ? "WAIT" : riskReward.overallQuality === "poor" ? "RISKY" : "WAIT";
  const recommendedAction = hardReject ? "avoid" : verdict === "WAIT" ? "wait" : "monitor";
  const primaryReason = hardReject ? objectiveFacts.hardRejectionReasons.join(" ") : `AI validation was unavailable, so the trade was scored conservatively using backend-calculated facts and AlphaMentals context.`;
  const positiveFactors = [
    technicalAlignment === "aligned" ? `Technical alignment supports the ${parsed.direction} direction.` : null,
    fundamentalAlignment === "aligned" ? `Fundamentals support the ${parsed.direction} direction.` : null,
    riskReward.overallQuality === "good" ? "Reward profile is acceptable." : null
  ].filter((value) => Boolean(value));
  const conflicts = [
    technicalAlignment === "against" ? "Technical pair analysis is against the signal direction." : null,
    fundamentalAlignment === "against" ? "AlphaMentals fundamentals are against the signal direction." : null,
    objectiveFacts.srConflictText.includes("nearby") ? objectiveFacts.srConflictText : null
  ].filter((value) => Boolean(value));
  const softConcerns = [
    objectiveFacts.freshnessStatus === "Delayed" || objectiveFacts.freshnessStatus === "Stale" ? `Signal freshness is ${objectiveFacts.freshnessStatus}.` : null,
    newsAndSessionRisk.assessment,
    args.aiValidationUnavailable ? args.aiValidationError ?? "AI validation unavailable." : null
  ].filter((value) => Boolean(value));
  const confluence = buildConfluence({
    technicalAlignment,
    fundamentalAlignment,
    rr,
    spreadStatus: newsAndSessionRisk.spreadStatus,
    volatility: newsAndSessionRisk.volatility,
    calendarRisk: fundamentalsContext.calendarRisk,
    hardReject,
    freshnessStatus: objectiveFacts.freshnessStatus
  });
  const tradeQualityScore = hardReject ? 0 : confluence.overall;
  const executionValidityScore = scoreExecution2({
    hardReject,
    spreadStatus: newsAndSessionRisk.spreadStatus,
    volatility: newsAndSessionRisk.volatility,
    calendarRisk: fundamentalsContext.calendarRisk,
    freshnessStatus: objectiveFacts.freshnessStatus
  });
  const aiVerdictConfidence = hardReject ? 92 : 55;
  const rejectionConfidence = hardReject ? 96 : 30;
  const base2 = {
    ok: true,
    symbol: parsed.symbol ?? "UNKNOWN",
    verdict,
    decisionLabel: decisionLabel2,
    rejectionCategory: hardReject ? objectiveFacts.rejectionCategory : "NONE",
    tradeQualityScore,
    executionValidityScore,
    aiVerdictConfidence,
    rejectionConfidence,
    primaryReason,
    summary: primaryReason,
    reasoning: primaryReason,
    fundamentalAlignment,
    technicalAlignment,
    riskRewardAssessment: riskReward.assessment,
    entryAssessment: objectiveFacts.priceVsEntry,
    slAssessment: objectiveFacts.priceVsStopLoss,
    tpAssessment: riskReward.assessment,
    keyReasons: [],
    keyRisks: [],
    confirmationNeeded: [
      ...technicalContext.confirmationNeeded,
      ...hardReject ? [] : objectiveFacts.whatWouldMakeItValid
    ],
    invalidation: pairContext ? [pairContext.invalidation] : ["Trade becomes invalid if price breaches the stop-loss area."],
    finalAction: recommendedAction,
    recommendedAction,
    macroBias: pairContext?.macroBias ?? "unavailable",
    calendarRisk: fundamentalsContext.calendarRisk,
    parsedSignal: {
      symbol: parsed.symbol ?? "UNKNOWN",
      direction: parsed.direction ?? "UNKNOWN",
      orderType: parsed.orderType,
      entry: parsed.entry,
      sl: parsed.stopLoss,
      tps: parsed.takeProfits
    },
    rr,
    technicalContext: {
      ...technicalContext,
      technicalAlignment,
      entryLocationQuality: objectiveFacts.srConflictText,
      confirmationNeeded: hardReject ? [] : objectiveFacts.whatWouldMakeItValid,
      assessment: technicalAlignment === "against" ? "Technical pair intelligence is against the signal direction." : technicalAlignment === "aligned" ? "Technical pair intelligence supports the signal direction." : technicalContext.assessment
    },
    fundamentalsContext,
    fundamentalContext: {
      fundamentalAlignment,
      source: "AlphaMentals Fundamentals",
      sourcePath: `/market-intelligence/fundamentals/${parsed.symbol ?? "unknown"}`,
      lastUpdated: fundamentalsContext.sourceUpdatedAt,
      macroBias: fundamentalsContext.bias,
      macroConfidence: fundamentalsContext.confidence,
      keyDrivers: fundamentalsContext.keyDrivers,
      assessment: fundamentalAlignment === "against" ? "Fundamental intelligence is against the signal direction." : fundamentalAlignment === "aligned" ? "Fundamental intelligence supports the signal direction." : "Fundamental intelligence is mixed or unavailable."
    },
    executionValidity: {
      orderTypeValid: objectiveFacts.orderTypeValid.status,
      orderTypeAssessment: objectiveFacts.orderTypeValid.reason,
      currentPriceVsEntry: objectiveFacts.priceVsEntry,
      currentPriceVsStopLoss: objectiveFacts.priceVsStopLoss,
      alreadyInvalidated: objectiveFacts.alreadyInvalidated.status,
      entryDistance: objectiveFacts.entryDistanceText,
      entryDistanceR: objectiveFacts.entryDistanceRText,
      freshnessStatus: objectiveFacts.freshnessStatus,
      signalAge: objectiveFacts.signalAgeText,
      executionAssessment: objectiveFacts.executionConditionText
    },
    riskReward,
    newsAndSessionRisk,
    hardRejectionReasons: objectiveFacts.hardRejectionReasons,
    softConcerns,
    positiveFactors,
    conflicts,
    whatWouldMakeItValid: objectiveFacts.whatWouldMakeItValid,
    checklist: [
      {
        item: "Order type validity",
        status: safeChecklistStatus(objectiveFacts.orderTypeValid.status),
        details: objectiveFacts.orderTypeValid.reason
      },
      {
        item: "Stop-loss invalidation",
        status: objectiveFacts.alreadyInvalidated.status ? "fail" : "pass",
        details: objectiveFacts.alreadyInvalidated.reason
      },
      {
        item: "Signal freshness",
        status: objectiveFacts.freshnessStatus === "Fresh" ? "pass" : objectiveFacts.freshnessStatus === "Unknown" ? "unavailable" : objectiveFacts.freshnessStatus === "Delayed" ? "warning" : "fail",
        details: `Signal age ${objectiveFacts.signalAgeText}; freshness ${objectiveFacts.freshnessStatus}.`
      },
      {
        item: "Risk / reward",
        status: riskReward.overallQuality === "good" ? "pass" : riskReward.overallQuality === "mixed" ? "warning" : riskReward.overallQuality === "poor" ? "fail" : "unavailable",
        details: riskReward.assessment
      },
      {
        item: "Technical alignment",
        status: technicalAlignment === "aligned" ? "pass" : technicalAlignment === "mixed" ? "warning" : technicalAlignment === "against" ? "fail" : "unavailable",
        details: technicalContext.assessment
      },
      {
        item: "Fundamental alignment",
        status: fundamentalAlignment === "aligned" ? "pass" : fundamentalAlignment === "mixed" ? "warning" : fundamentalAlignment === "against" ? "fail" : "unavailable",
        details: baseFundamentalAssessment(fundamentalsContext, fundamentalAlignment)
      },
      {
        item: "Critical data completeness",
        status: objectiveFacts.missingCriticalData.length === 0 ? "pass" : "fail",
        details: objectiveFacts.missingCriticalData.length ? `Missing: ${objectiveFacts.missingCriticalData.join(", ")}.` : "No critical data missing."
      }
    ],
    confluence,
    pairContext,
    usedAnalysisGeneratedAt: args.usedAnalysisGeneratedAt ?? null,
    aiValidationUnavailable: args.aiValidationUnavailable,
    aiValidationError: args.aiValidationError ?? null,
    noAnalysisFound: args.noAnalysisFound ?? false
  };
  const legacy = buildLegacyFields(base2);
  return {
    ...base2,
    confidence: legacy.confidence,
    reasoning: legacy.reasoning,
    riskRewardAssessment: legacy.riskRewardAssessment,
    entryAssessment: legacy.entryAssessment,
    slAssessment: legacy.slAssessment,
    tpAssessment: legacy.tpAssessment,
    keyReasons: legacy.keyReasons,
    keyRisks: legacy.keyRisks,
    legacy
  };
}
function baseFundamentalAssessment(fundamentalsContext, alignment) {
  if (alignment === "aligned") return "AlphaMentals fundamentals support the signal direction.";
  if (alignment === "against") return "AlphaMentals fundamentals conflict with the signal direction.";
  if (alignment === "mixed") return "Fundamental intelligence is mixed.";
  return fundamentalsContext.sourceUpdatedAt ? "Fundamental intelligence unavailable or stale. Macro alignment confidence reduced." : "Fundamental intelligence unavailable or stale. Macro alignment confidence reduced.";
}
function applyHardRejectionOverride(candidate, objectiveFacts) {
  if (!objectiveFacts.hardRejectionRequired) return candidate;
  return {
    ...candidate,
    verdict: "BAD",
    decisionLabel: "REJECTED",
    rejectionCategory: objectiveFacts.rejectionCategory === "NONE" ? "INSUFFICIENT_DATA" : objectiveFacts.rejectionCategory,
    tradeQualityScore: 0,
    executionValidityScore: 0,
    aiVerdictConfidence: Math.max(candidate.aiVerdictConfidence ?? 0, 90),
    rejectionConfidence: Math.max(candidate.rejectionConfidence ?? 0, 94),
    primaryReason: objectiveFacts.hardRejectionReasons.join(" "),
    recommendedAction: "avoid",
    finalAction: "avoid",
    hardRejectionReasons: objectiveFacts.hardRejectionReasons
  };
}
function normalizeLlmResponse(args) {
  const { parsed, rr, pairContext, technicalContext, fundamentalsContext, objectiveFacts } = args;
  const response = applyHardRejectionOverride(args.response, objectiveFacts);
  const technicalAlignment = response.technicalContext?.technicalAlignment ?? deriveTechnicalAlignment(parsed, pairContext);
  const fundamentalAlignment = response.fundamentalContext?.fundamentalAlignment ?? deriveFundamentalAlignment(parsed, pairContext);
  const confluence = buildConfluence({
    technicalAlignment,
    fundamentalAlignment,
    rr,
    spreadStatus: response.newsAndSessionRisk.spreadStatus,
    volatility: response.newsAndSessionRisk.volatility,
    calendarRisk: response.newsAndSessionRisk.calendarRisk,
    hardReject: objectiveFacts.hardRejectionRequired,
    freshnessStatus: response.executionValidity.freshnessStatus
  });
  const base2 = {
    ok: true,
    symbol: parsed.symbol ?? "UNKNOWN",
    verdict: response.verdict,
    decisionLabel: response.decisionLabel,
    rejectionCategory: response.rejectionCategory,
    tradeQualityScore: response.tradeQualityScore,
    executionValidityScore: response.executionValidityScore,
    aiVerdictConfidence: response.aiVerdictConfidence,
    rejectionConfidence: response.rejectionConfidence,
    primaryReason: response.primaryReason,
    summary: response.summary,
    reasoning: response.primaryReason,
    fundamentalAlignment,
    technicalAlignment,
    riskRewardAssessment: response.riskReward.assessment,
    entryAssessment: response.executionValidity.currentPriceVsEntry,
    slAssessment: response.executionValidity.currentPriceVsStopLoss,
    tpAssessment: response.riskReward.assessment,
    keyReasons: [],
    keyRisks: [],
    confirmationNeeded: response.technicalContext.confirmationNeeded ?? [],
    invalidation: response.invalidation,
    finalAction: response.finalAction,
    recommendedAction: response.recommendedAction,
    macroBias: fundamentalsContext.bias,
    calendarRisk: response.newsAndSessionRisk.calendarRisk,
    parsedSignal: {
      symbol: parsed.symbol ?? "UNKNOWN",
      direction: parsed.direction ?? "UNKNOWN",
      orderType: parsed.orderType,
      entry: parsed.entry,
      sl: parsed.stopLoss,
      tps: parsed.takeProfits
    },
    rr,
    technicalContext: {
      ...technicalContext,
      technicalAlignment,
      marketStructure: response.technicalContext.marketStructure,
      technicalScore: response.technicalContext.technicalScore ?? technicalContext.technicalScore,
      entryLocationQuality: response.technicalContext.entryLocationQuality,
      liquidityContext: response.technicalContext.liquidityContext,
      confirmationNeeded: response.technicalContext.confirmationNeeded,
      assessment: response.technicalContext.assessment
    },
    fundamentalsContext,
    fundamentalContext: response.fundamentalContext,
    executionValidity: response.executionValidity,
    riskReward: response.riskReward,
    newsAndSessionRisk: response.newsAndSessionRisk,
    hardRejectionReasons: response.hardRejectionReasons,
    softConcerns: response.softConcerns,
    positiveFactors: response.positiveFactors,
    conflicts: response.conflicts,
    whatWouldMakeItValid: response.whatWouldMakeItValid,
    checklist: response.checklist,
    confluence,
    pairContext,
    usedAnalysisGeneratedAt: pairContext?.dataGeneratedAt ?? null,
    noAnalysisFound: !pairContext
  };
  const legacy = buildLegacyFields(base2);
  return {
    ...base2,
    confidence: legacy.confidence,
    reasoning: legacy.reasoning,
    riskRewardAssessment: legacy.riskRewardAssessment,
    entryAssessment: legacy.entryAssessment,
    slAssessment: legacy.slAssessment,
    tpAssessment: legacy.tpAssessment,
    keyReasons: legacy.keyReasons,
    keyRisks: legacy.keyRisks,
    legacy
  };
}
async function validateTelegramTradeSignal(rawText, overrideParsed, meta) {
  const parsed = {
    ...parseTelegramSignal(rawText),
    ...overrideParsed
  };
  if (!parsed.symbol) return { ok: false, error: "Could not detect a trading symbol in this signal." };
  if (!parsed.direction) return { ok: false, error: "Could not detect trade direction (BUY/SELL) in this signal." };
  const signalTime = meta?.signalTime ?? null;
  const sourceMessage = meta?.sourceMessage ?? rawText;
  const rr = computeRR(parsed);
  console.log("[telegram-analysis] loading pair technical context", {
    symbol: parsed.symbol,
    source: `/pair/${parsed.symbol}`
  });
  let pairContext = null;
  try {
    pairContext = await getPairDecisionContext(parsed.symbol);
    console.log("[telegram-analysis] pair technical context loaded", {
      symbol: parsed.symbol,
      currentPrice: pairContext.price,
      trend: pairContext.directionBias,
      marketStructure: pairContext.marketStructure,
      support: pairContext.support,
      resistance: pairContext.resistance,
      technicalScore: pairContext.technicalScore,
      spread: pairContext.currentSpread,
      volatility: pairContext.volatility,
      session: pairContext.session,
      updatedAt: pairContext.priceUpdatedAt
    });
  } catch (error) {
    console.error("[telegram-analysis] pair technical context unavailable", {
      symbol: parsed.symbol,
      error: error instanceof Error ? error.message : String(error)
    });
  }
  console.log("[telegram-analysis] loading fundamentals", {
    symbol: parsed.symbol,
    source: `/market-intelligence/fundamentals/${parsed.symbol}`
  });
  if (pairContext) {
    console.log("[telegram-analysis] fundamentals loaded", {
      symbol: parsed.symbol,
      bias: pairContext.macroBias,
      confidence: pairContext.macroConfidence,
      updatedAt: pairContext.fundamentalsUpdatedAt,
      driverCount: pairContext.topDrivers.length
    });
  } else {
    console.error("[telegram-analysis] fundamentals unavailable", {
      symbol: parsed.symbol,
      error: "Pair decision context unavailable."
    });
  }
  const analysisTime = (/* @__PURE__ */ new Date()).toISOString();
  const technicalContext = pairContext ? buildTechnicalContextFromPair(pairContext, parsed.symbol) : buildEmptyTechnicalContext(parsed.symbol);
  const fundamentalsContext = buildFundamentalsContext(pairContext);
  const objectiveFacts = buildObjectiveValidationFacts({
    symbol: parsed.symbol,
    parsed,
    rr,
    pairContext,
    technicalContext,
    signalTime,
    analysisTime
  });
  const livePriceContext = buildLivePriceContext(pairContext);
  const technicalPairContext = buildTechnicalPromptContext(pairContext, technicalContext);
  const fundContext = buildFundamentalsPromptContext(pairContext);
  const objectiveValidationContext = buildObjectiveValidationContext(objectiveFacts);
  if (!process.env.OPENAI_API_KEY) {
    return buildFallbackValidation({
      parsed,
      rr,
      pairContext,
      objectiveFacts,
      technicalContext,
      fundamentalsContext,
      noAnalysisFound: !pairContext,
      aiValidationUnavailable: true,
      aiValidationError: "OPENAI_API_KEY is not configured.",
      usedAnalysisGeneratedAt: pairContext?.dataGeneratedAt ?? null
    });
  }
  const systemPrompt = `You are a professional XAU/USD and Forex trade validation analyst.

You validate Telegram trading signals using:
1. live MT5 bridge prices,
2. AlphaMentals pair technical analysis from /pair/{symbol},
3. AlphaMentals fundamentals from /market-intelligence/fundamentals/{symbol},
4. backend-calculated objective validation facts.

Your job is NOT to blindly summarize the Telegram signal.
Your job is to decide whether the signal is actually tradable before the user risks money.

Return only valid JSON. Do not include markdown. Do not include text outside JSON.

Use this exact JSON schema:

{
  "verdict": "GOOD | RISKY | BAD | WAIT",
  "decisionLabel": "ACCEPTED | REJECTED | WAIT | NEEDS_CONFIRMATION",
  "rejectionCategory": "NONE | INVALID_ORDER_TYPE | ALREADY_INVALIDATED | STALE_SIGNAL | MACRO_CONFLICT | TECHNICAL_CONFLICT | POOR_RR | BAD_EXECUTION_CONDITIONS | INSUFFICIENT_DATA",
  "tradeQualityScore": 0,
  "executionValidityScore": 0,
  "aiVerdictConfidence": 0,
  "rejectionConfidence": 0,
  "summary": "...",
  "primaryReason": "...",

  "executionValidity": {
    "orderTypeValid": true,
    "orderTypeAssessment": "...",
    "currentPriceVsEntry": "...",
    "currentPriceVsStopLoss": "...",
    "alreadyInvalidated": false,
    "entryDistance": "...",
    "entryDistanceR": null,
    "freshnessStatus": "Fresh | Delayed | Stale | Expired | Unknown",
    "signalAge": "...",
    "executionAssessment": "..."
  },

  "riskReward": {
    "riskSize": null,
    "tpAssessments": [
      {
        "tp": "...",
        "rr": null,
        "quality": "good | acceptable | weak | very_weak | unavailable",
        "comment": "..."
      }
    ],
    "overallQuality": "good | mixed | poor | unavailable",
    "assessment": "..."
  },

  "technicalContext": {
    "technicalAlignment": "aligned | against | mixed | unavailable",
    "source": "AlphaMentals Pair Analysis",
    "sourcePath": "...",
    "lastUpdated": "...",
    "trend": "...",
    "marketStructure": "...",
    "technicalScore": null,
    "support": "...",
    "resistance": "...",
    "entryLocationQuality": "...",
    "liquidityContext": "...",
    "confirmationNeeded": ["..."],
    "assessment": "..."
  },

  "fundamentalContext": {
    "fundamentalAlignment": "aligned | against | mixed | unavailable",
    "source": "AlphaMentals Fundamentals",
    "sourcePath": "...",
    "lastUpdated": "...",
    "macroBias": "...",
    "macroConfidence": null,
    "keyDrivers": ["..."],
    "assessment": "..."
  },

  "newsAndSessionRisk": {
    "calendarRisk": "low | medium | high | unavailable",
    "headlineRisk": "low | medium | high | unavailable",
    "session": "...",
    "liquidityQuality": "good | reduced | poor | unavailable",
    "spreadStatus": "normal | elevated | dangerous | unavailable",
    "volatility": "low | normal | high | extreme | unavailable",
    "assessment": "..."
  },

  "hardRejectionReasons": ["..."],
  "softConcerns": ["..."],
  "positiveFactors": ["..."],
  "conflicts": ["..."],
  "whatWouldMakeItValid": ["..."],
  "checklist": [
    {
      "item": "...",
      "status": "pass | fail | warning | unavailable",
      "details": "..."
    }
  ],
  "recommendedAction": "take | wait | avoid | monitor",
  "finalAction": "take | wait | avoid | monitor",
  "invalidation": ["..."],

  "legacy": {
    "confidence": 0,
    "reasoning": "...",
    "riskRewardAssessment": "...",
    "entryAssessment": "...",
    "slAssessment": "...",
    "tpAssessment": "...",
    "keyReasons": ["..."],
    "keyRisks": ["..."]
  }
}

Critical rules:

1. Respect backend-calculated objective validation facts.
If the backend says a hard rejection is required, do not override it.

2. Order type validity:
- BUY LIMIT must be below current market price.
- SELL LIMIT must be above current market price.
- BUY STOP must be above current market price.
- SELL STOP must be below current market price.
- If this fails, verdict must be BAD, decisionLabel REJECTED, finalAction avoid.

3. Stop loss invalidation:
- SELL is invalid if current price is already above SL.
- BUY is invalid if current price is already below SL.
- If invalidated, verdict must be BAD, decisionLabel REJECTED, finalAction avoid.

4. Signal freshness:
- If signal is old, delayed, or price has moved far from entry, mark Stale or Expired.
- Treat stale XAU/USD signals conservatively.

5. Entry distance:
- Compare current price to entry.
- Show distance in price units.
- Show distance in R when possible.

6. Risk/reward:
- TP1 below 1R is weak.
- TP1 below 0.5R is very weak.
- If TP2 is good but TP1 is poor, classify RR as mixed, not good.

7. Support/resistance:
- Selling into support is negative.
- Buying into resistance is negative.
- If support/resistance is unavailable, say unavailable.

8. Fundamentals:
- Use only AlphaMentals fundamentals context from /market-intelligence/fundamentals/{symbol}.
- Do not invent macro bias.
- SELL vs bullish XAU/USD fundamentals is a macro conflict.
- BUY vs bearish XAU/USD fundamentals is a macro conflict.

9. Technicals:
- Use only AlphaMentals pair analysis context from /pair/{symbol}.
- Do not invent trend, support, resistance, or market structure.
- If technical data is unavailable, say unavailable.

10. XAU/USD macro reasoning:
When data is available, consider USD strength, yields, Fed expectations, inflation, jobs data, CPI/PPI/FOMC, geopolitical risk, safe-haven demand, risk sentiment, and major headlines.

11. News/session/spread:
High-impact news, headline risk, session closed, elevated spread, or extreme volatility reduces trade quality.

12. Confidence logic:
- tradeQualityScore = quality of taking the trade.
- rejectionConfidence = confidence in rejecting the trade.
- aiVerdictConfidence = confidence in the final verdict.
- If rejecting a clearly invalid trade, tradeQualityScore can be 0 while rejectionConfidence should be high.

13. Source transparency:
Every major conclusion must reference the data used.
Example: "Rejected because current price 4505.90 is above sell SL 4496.10."

14. Conservative behavior:
Missing current price = cannot validate execution.
Missing SL = reject.
Missing entry for pending order = reject.
Missing fundamentals = reduce macro confidence.
Missing technicals = reduce technical confidence.
Never hallucinate missing values.

15. Final verdict must respect hard rejection rules.
If invalid order type, already invalidated, missing SL, missing entry, or expired signal is detected, verdict must be BAD and finalAction must be avoid.`;
  const userPrompt = buildSignalPrompt({
    parsed,
    rr,
    pairContext,
    technicalPairContext,
    fundContext,
    livePriceContext,
    objectiveValidationContext,
    signalTime,
    sourceMessage
  });
  try {
    const response = await chatCompleteJSON(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      {
        maxTokens: 1800,
        temperature: 0.1,
        model: SIGNAL_MODEL,
        symbols: [parsed.symbol],
        feature: "telegram",
        operation: "auto_signal_validation"
      }
    );
    return normalizeLlmResponse({
      response,
      parsed,
      rr,
      pairContext,
      technicalContext,
      fundamentalsContext,
      objectiveFacts
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown AI validation error";
    return buildFallbackValidation({
      parsed,
      rr,
      pairContext,
      objectiveFacts,
      technicalContext,
      fundamentalsContext,
      noAnalysisFound: !pairContext,
      aiValidationUnavailable: true,
      aiValidationError: message,
      usedAnalysisGeneratedAt: pairContext?.dataGeneratedAt ?? null
    });
  }
}
async function analyzeSignalWithAI(rawText, overrideParsed, meta) {
  const result = await validateTelegramTradeSignal(rawText, overrideParsed, meta);
  if (result.ok === false) return result;
  return {
    ok: true,
    symbol: result.symbol,
    verdict: result.verdict,
    confidence: result.confidence,
    summary: result.summary,
    alignment: {
      fundamentals: result.fundamentalAlignment,
      technical: result.technicalAlignment,
      riskReward: rrLabel(result.rr)
    },
    parsedSignal: {
      direction: result.parsedSignal.direction,
      orderType: result.parsedSignal.orderType,
      entry: result.parsedSignal.entry,
      sl: result.parsedSignal.sl,
      tps: result.parsedSignal.tps
    },
    rr: result.rr,
    reasoning: result.reasoning,
    warnings: result.keyRisks,
    usedAnalysisGeneratedAt: result.usedAnalysisGeneratedAt,
    details: result
  };
}

// backend/server/services/telegramAutoSignal.service.ts
var TELEGRAM_ALERT_RECIPIENT = "fo.mencuccini@gmail.com";
var AUTO_SIGNAL_TIMEOUT_MS = 12e4;
function supportedAutoSignal(message) {
  return message.messageType === "SIGNAL" && Boolean(message.symbol) && (message.direction === "BUY" || message.direction === "SELL") && Boolean(message.entry) && Boolean(message.stopLoss);
}
function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Automatic Telegram signal workflow timed out after ${timeoutMs}ms`)), timeoutMs);
    })
  ]);
}
function computeEmailSubject(result) {
  return `[${result.decisionLabel}] ${result.symbol} ${result.parsedSignal.orderType ?? "MARKET"} \u2014 Trade Quality ${result.tradeQualityScore}/100 \u2014 ${result.rejectionCategory}`;
}
function appBaseUrl() {
  const explicit = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (explicit?.trim()) return explicit.replace(/\/+$/, "");
  if (process.env.VERCEL_URL?.trim()) return `https://${process.env.VERCEL_URL.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return null;
}
function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function formatDateGmt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
    timeZoneName: "short"
  }).format(date).replace(",", "");
}
function formatNumber(value) {
  if (value == null || !Number.isFinite(value)) return null;
  if (Math.abs(value) >= 1e3) return value.toFixed(2);
  if (Math.abs(value) >= 10) return value.toFixed(3).replace(/\.?0+$/, "");
  return value.toFixed(5).replace(/\.?0+$/, "");
}
function decisionLabel(result) {
  if (result.verdict === "GOOD") return { text: "APPROVED", emoji: "\u{1F7E2}", color: "#34d399", bg: "#052e24", border: "#10b981" };
  if (result.verdict === "BAD") return { text: "REJECTED", emoji: "\u{1F534}", color: "#f87171", bg: "#3f1218", border: "#ef4444" };
  if (result.verdict === "RISKY") return { text: "RISKY", emoji: "\u{1F7E0}", color: "#fb923c", bg: "#431407", border: "#f97316" };
  return { text: "MONITOR", emoji: "\u{1F7E1}", color: "#fde047", bg: "#3a2f08", border: "#eab308" };
}
function actionLabel(result) {
  if (result.finalAction === "take") return "APPROVED";
  if (result.finalAction === "avoid") return "REJECTED";
  return "MONITOR";
}
function statusChip(label, tone = "blue") {
  if (!label) return "";
  const colors = {
    green: ["#064e3b", "#34d399", "#10b981"],
    yellow: ["#3a2f08", "#fde047", "#eab308"],
    red: ["#3f1218", "#f87171", "#ef4444"],
    blue: ["#0f2544", "#93c5fd", "#3b82f6"]
  }[tone];
  return `<span style="display:inline-block;margin:4px 6px 0 0;padding:6px 9px;border-radius:999px;background:${colors[0]};border:1px solid ${colors[2]};color:${colors[1]};font-size:12px;font-weight:700;">${escapeHtml(label)}</span>`;
}
function metric(label, value, icon = "") {
  if (value == null || value === "") return "";
  return `
    <td style="width:50%;padding:8px;">
      <div style="min-height:58px;padding:12px;border:1px solid #223044;border-radius:10px;background:#0d1522;">
        <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8ea0b8;">${icon} ${escapeHtml(label)}</div>
        <div style="margin-top:6px;font-size:18px;line-height:1.2;color:#f8fafc;font-weight:800;">${escapeHtml(value)}</div>
      </div>
    </td>
  `;
}
function metricGrid(items) {
  const cells = items.map(([label, value, icon]) => metric(label, value, icon)).filter(Boolean);
  const rows = [];
  for (let i = 0; i < cells.length; i += 2) {
    rows.push(`<tr>${cells[i]}${cells[i + 1] ?? '<td style="width:50%;padding:8px;"></td>'}</tr>`);
  }
  return `<table role="presentation" style="width:100%;border-collapse:collapse;margin:-8px;">${rows.join("")}</table>`;
}
function bulletList(items, icon = "\u2022") {
  const clean2 = items.filter(Boolean).slice(0, 5);
  if (!clean2.length) return "";
  return clean2.map((item) => `
    <div style="margin:7px 0;color:#dbe4f0;font-size:14px;line-height:1.35;">
      <span style="color:#93c5fd;font-weight:800;">${icon}</span>
      <span>${escapeHtml(item)}</span>
    </div>
  `).join("");
}
function section(title, body, accent = "#1f2937") {
  if (!body.trim()) return "";
  return `
    <div style="margin-top:14px;padding:16px;border:1px solid ${accent};border-radius:14px;background:#101827;">
      <div style="margin:0 0 12px;color:#f8fafc;font-size:14px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;">${title}</div>
      ${body}
    </div>
  `;
}
function buildTelegramSignalEmail(message, result) {
  const linkBase = appBaseUrl();
  const telegramInfoLink = linkBase ? `${linkBase}/telegram-info` : null;
  const fundamentalsLink = linkBase && result.symbol ? `${linkBase}/market-intelligence/fundamentals/${encodeURIComponent(result.symbol)}` : null;
  const pairLink = linkBase && result.symbol ? `${linkBase}/pair/${encodeURIComponent(result.symbol)}` : null;
  const decision = decisionLabel(result);
  const receivedAt = formatDateGmt(message.telegramDate);
  const action = actionLabel(result);
  const fundamentals = result.fundamentalsContext;
  const source = message.chatTitle ?? message.chatId;
  const html = `
    <div style="font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:760px;margin:0 auto;padding:18px;background:#070b12;color:#e5edf7;">
      <div style="border:1px solid #1f2a3a;border-radius:18px;overflow:hidden;background:#0a101a;">
        <div style="padding:22px 20px;background:#0b1220;border-bottom:1px solid #1f2a3a;">
          <div style="font-size:12px;color:#8ea0b8;letter-spacing:.14em;text-transform:uppercase;font-weight:800;">Telegram Trade Validation Report</div>
          <div style="margin-top:8px;font-size:28px;line-height:1.1;font-weight:950;color:#f8fafc;">${decision.emoji} ${escapeHtml(result.symbol)} ${escapeHtml(result.parsedSignal.direction)} ${escapeHtml(result.parsedSignal.orderType ?? "MARKET")}</div>
          <div style="margin-top:10px;color:#b9c7d9;font-size:14px;">${escapeHtml(source)}${receivedAt ? ` \xB7 ${escapeHtml(receivedAt)}` : ""}</div>
          <div style="margin-top:14px;display:flex;flex-wrap:wrap;gap:8px;">
            ${statusChip(`Verdict ${result.verdict}`, result.verdict === "BAD" ? "red" : result.verdict === "GOOD" ? "green" : "yellow")}
            ${statusChip(`Decision ${result.decisionLabel}`, result.decisionLabel === "REJECTED" ? "red" : result.decisionLabel === "ACCEPTED" ? "green" : "yellow")}
            ${statusChip(`Category ${result.rejectionCategory}`, result.rejectionCategory === "NONE" ? "green" : "red")}
            ${statusChip(`Trade Quality ${result.tradeQualityScore}/100`, result.tradeQualityScore >= 70 ? "green" : result.tradeQualityScore >= 45 ? "yellow" : "red")}
            ${statusChip(`Execution ${result.executionValidityScore}/100`, result.executionValidityScore >= 70 ? "green" : result.executionValidityScore >= 45 ? "yellow" : "red")}
          </div>
        </div>

        <div style="padding:18px;">
          ${section("1. Header", metricGrid([
    ["Direction", result.parsedSignal.direction, "\u{1F9ED}"],
    ["Order Type", result.parsedSignal.orderType ?? "MARKET", "\u{1F4CC}"],
    ["AI Verdict Confidence", `${result.aiVerdictConfidence}%`, "\u{1F916}"],
    ["Rejection Confidence", `${result.rejectionConfidence}%`, "\u{1F6E1}\uFE0F"]
  ]), "#2b3b54")}

          ${section("2. Signal Summary", metricGrid([
    ["Entry", formatNumber(result.parsedSignal.entry), "\u{1F3AF}"],
    ["Stop Loss", formatNumber(result.parsedSignal.sl), "\u{1F6D1}"],
    ["Take Profits", result.parsedSignal.tps.map(formatNumber).filter(Boolean).map((tp, index) => `TP${index + 1} ${tp}`).join(" \xB7 "), "\u{1F4B0}"],
    ["Current Price", formatNumber(result.technicalContext.currentPrice), "\u{1F4B2}"],
    ["Signal Time", message.telegramDate, "\u{1F552}"],
    ["Analysis Time", result.usedAnalysisGeneratedAt ?? result.technicalContext.lastUpdated ?? "n/a", "\u23F1\uFE0F"],
    ["Signal Age", result.executionValidity.signalAge, "\u231B"],
    ["Freshness", result.executionValidity.freshnessStatus, "\u{1F9EA}"]
  ]), "#2b3b54")}

          ${section("3. Hard Validation Checks", bulletList([
    `Order Type Validity: ${result.executionValidity.orderTypeAssessment}`,
    `Current Price vs Entry: ${result.executionValidity.currentPriceVsEntry}`,
    `Current Price vs SL: ${result.executionValidity.currentPriceVsStopLoss}`,
    `Already Invalidated: ${result.executionValidity.alreadyInvalidated ? "Yes" : "No"}`,
    `Entry Distance: ${result.executionValidity.entryDistance}`,
    `Entry Distance in R: ${result.executionValidity.entryDistanceR ?? "unavailable"}`,
    `Execution Conditions: ${result.executionValidity.executionAssessment}`
  ]), "#7f1d1d")}

          ${section("4. Risk / Reward", `
            ${metricGrid([
    ["Risk Size", formatNumber(result.riskReward.riskSize), "\u2696\uFE0F"],
    ["Overall RR Quality", result.riskReward.overallQuality, "\u{1F4C8}"]
  ])}
            ${bulletList(result.riskReward.tpAssessments.map((tp) => `${tp.tp}: ${tp.rr ?? "n/a"}R \xB7 ${tp.quality} \xB7 ${tp.comment}`))}
            <div style="margin-top:10px;color:#dbe4f0;font-size:14px;line-height:1.4;">${escapeHtml(result.riskReward.assessment)}</div>
          `, "#2b3b54")}

          ${section("5. Technical Pair Analysis", `
            ${metricGrid([
    ["Source", result.technicalContext.sourcePath, "\u{1F4C9}"],
    ["Last Updated", result.technicalContext.lastUpdated ?? "unknown", "\u{1F552}"],
    ["Trend", result.technicalContext.trend, "\u{1F4CA}"],
    ["Market Structure", result.technicalContext.marketStructure ?? "unavailable", "\u{1F3D7}\uFE0F"],
    ["Technical Score", result.technicalContext.technicalScore != null ? `${result.technicalContext.technicalScore}/100` : "unavailable", "\u{1F3AF}"],
    ["Support", formatNumber(result.technicalContext.support), "\u{1F9F1}"],
    ["Resistance", formatNumber(result.technicalContext.resistance), "\u{1F6A7}"],
    ["Entry Location", result.technicalContext.entryLocationQuality, "\u{1F4CD}"]
  ])}
            <div style="margin-top:10px;color:#dbe4f0;font-size:14px;">Liquidity Context: ${escapeHtml(result.technicalContext.liquidityContext)}</div>
            ${result.technicalContext.confirmationNeeded.length ? `<div style="margin-top:10px;color:#f8fafc;font-weight:800;">Confirmation Needed</div>${bulletList(result.technicalContext.confirmationNeeded)}` : ""}
            <div style="margin-top:10px;color:#dbe4f0;font-size:14px;">${escapeHtml(result.technicalContext.assessment)}</div>
          `, "#253145")}

          ${section("6. Fundamental Intelligence", `
            ${metricGrid([
    ["Source", result.fundamentalContext.sourcePath, "\u{1F4F0}"],
    ["Last Updated", result.fundamentalContext.lastUpdated ?? "unknown", "\u{1F552}"],
    ["Macro Bias", `${result.fundamentalContext.macroBias}${result.fundamentalContext.macroConfidence != null ? ` (${result.fundamentalContext.macroConfidence}%)` : ""}`, "\u{1F30D}"],
    ["Calendar Risk", result.newsAndSessionRisk.calendarRisk, "\u{1F4C5}"]
  ])}
            ${result.fundamentalContext.keyDrivers.length ? `<div style="margin-top:10px;color:#f8fafc;font-weight:800;">Key Drivers</div>${bulletList(result.fundamentalContext.keyDrivers)}` : '<div style="margin-top:10px;color:#fca5a5;">Fundamental intelligence unavailable or stale. Macro alignment confidence reduced.</div>'}
            <div style="margin-top:10px;color:#dbe4f0;font-size:14px;">${escapeHtml(result.fundamentalContext.assessment)}</div>
          `, "#263a2f")}

          ${section("7. News / Session / Volatility", bulletList([
    `Calendar Risk: ${result.newsAndSessionRisk.calendarRisk}`,
    `Headline Risk: ${result.newsAndSessionRisk.headlineRisk}`,
    `Session: ${result.newsAndSessionRisk.session}`,
    `Liquidity Quality: ${result.newsAndSessionRisk.liquidityQuality}`,
    `Spread Status: ${result.newsAndSessionRisk.spreadStatus}`,
    `Volatility: ${result.newsAndSessionRisk.volatility}`,
    `Assessment: ${result.newsAndSessionRisk.assessment}`
  ]), "#5a4218")}

          ${section("8. Conflicts", bulletList(result.conflicts.length ? result.conflicts : ["No major conflicts detected beyond the sections above."]), "#7f1d1d")}

          ${section("9. Final Verdict", `
            <div style="display:inline-block;padding:12px 16px;border-radius:14px;background:${decision.bg};border:1px solid ${decision.border};color:${decision.color};font-size:22px;font-weight:950;">${decision.emoji} ${escapeHtml(result.decisionLabel)}</div>
            <div style="margin-top:12px;color:#dbe4f0;font-size:14px;"><strong>Primary Reason:</strong> ${escapeHtml(result.primaryReason)}</div>
            ${result.hardRejectionReasons.length ? `<div style="margin-top:12px;color:#f8fafc;font-weight:800;">Hard Rejection Reasons</div>${bulletList(result.hardRejectionReasons)}` : ""}
            ${result.softConcerns.length ? `<div style="margin-top:12px;color:#f8fafc;font-weight:800;">Soft Concerns</div>${bulletList(result.softConcerns)}` : ""}
            ${result.positiveFactors.length ? `<div style="margin-top:12px;color:#f8fafc;font-weight:800;">Positive Factors</div>${bulletList(result.positiveFactors)}` : ""}
            <div style="margin-top:12px;color:#dbe4f0;font-size:14px;"><strong>Recommended Action:</strong> ${escapeHtml(result.recommendedAction)}</div>
          `, "#293c5a")}

          ${section("10. What Would Make This Trade Valid", bulletList(result.whatWouldMakeItValid.length ? result.whatWouldMakeItValid : ["No specific path to validity was identified for this setup."]), "#1f513f")}

          ${section("11. Trader Checklist", result.checklist.map((item) => `
            <div style="margin:8px 0;padding:10px 12px;border:1px solid #243041;border-radius:10px;background:#0d1522;">
              <div style="font-size:13px;font-weight:800;color:#f8fafc;">${escapeHtml(item.item)} <span style="color:#8ea0b8;">(${escapeHtml(item.status)})</span></div>
              <div style="margin-top:4px;font-size:13px;color:#dbe4f0;">${escapeHtml(item.details)}</div>
            </div>
          `).join(""), "#2d3344")}

          ${result.aiValidationUnavailable ? `
            <div style="margin-top:14px;padding:14px;border:1px solid #7c2d12;border-radius:12px;background:#431407;color:#fed7aa;">
              <strong>AI validation unavailable</strong>
              <div style="margin-top:6px;">${escapeHtml(result.aiValidationError ?? "The AI validation step failed.")}</div>
            </div>
          ` : ""}

          ${section("12. Source Message", `<div style="color:#cbd5e1;font-size:13px;line-height:1.45;white-space:pre-wrap;">${escapeHtml(message.rawText.slice(0, 1200))}${message.rawText.length > 1200 ? "..." : ""}</div>`, "#1f2937")}

          ${telegramInfoLink || fundamentalsLink || pairLink ? `
            <div style="margin-top:16px;">
              ${telegramInfoLink ? `<a href="${telegramInfoLink}" style="display:inline-block;margin:4px 8px 4px 0;padding:10px 13px;background:#1d4ed8;color:#fff;border-radius:10px;text-decoration:none;font-weight:800;">\u{1F4E1} Telegram Info</a>` : ""}
              ${fundamentalsLink ? `<a href="${fundamentalsLink}" style="display:inline-block;margin:4px 8px 4px 0;padding:10px 13px;background:#047857;color:#fff;border-radius:10px;text-decoration:none;font-weight:800;">\u{1F4F0} Fundamentals</a>` : ""}
              ${pairLink ? `<a href="${pairLink}" style="display:inline-block;margin:4px 8px 4px 0;padding:10px 13px;background:#334155;color:#fff;border-radius:10px;text-decoration:none;font-weight:800;">\u{1F4C9} Pair Page</a>` : ""}
            </div>
          ` : ""}
        </div>
      </div>
    </div>
  `;
  const text = [
    `${decision.emoji} ${result.symbol} ${result.parsedSignal.direction} ${result.parsedSignal.orderType ?? "MARKET"}`,
    `VERDICT: ${result.verdict}`,
    `DECISION LABEL: ${result.decisionLabel}`,
    `REJECTION CATEGORY: ${result.rejectionCategory}`,
    `TRADE QUALITY SCORE: ${result.tradeQualityScore}/100`,
    `EXECUTION VALIDITY SCORE: ${result.executionValidityScore}/100`,
    `AI VERDICT CONFIDENCE: ${result.aiVerdictConfidence}%`,
    `REJECTION CONFIDENCE: ${result.rejectionConfidence}%`,
    `ACTION: ${action}`,
    `Source: ${source}`,
    receivedAt ? `Received: ${receivedAt}` : "",
    "",
    "SIGNAL SUMMARY",
    `Entry: ${formatNumber(result.parsedSignal.entry) ?? ""}`,
    `Stop Loss: ${formatNumber(result.parsedSignal.sl) ?? ""}`,
    `Take Profits: ${result.parsedSignal.tps.map(formatNumber).filter(Boolean).join(" | ")}`,
    `Current Price: ${formatNumber(result.technicalContext.currentPrice)}`,
    `Signal Age: ${result.executionValidity.signalAge}`,
    `Freshness: ${result.executionValidity.freshnessStatus}`,
    "",
    "HARD VALIDATION CHECKS",
    `Order Type Validity: ${result.executionValidity.orderTypeAssessment}`,
    `Current Price vs Entry: ${result.executionValidity.currentPriceVsEntry}`,
    `Current Price vs Stop Loss: ${result.executionValidity.currentPriceVsStopLoss}`,
    `Already Invalidated: ${result.executionValidity.alreadyInvalidated ? "Yes" : "No"}`,
    `Entry Distance: ${result.executionValidity.entryDistance}`,
    `Entry Distance in R: ${result.executionValidity.entryDistanceR ?? "unavailable"}`,
    "",
    "RISK / REWARD",
    `Risk Size: ${formatNumber(result.riskReward.riskSize)}`,
    ...result.riskReward.tpAssessments.map((tp) => `${tp.tp}: ${tp.rr ?? "n/a"}R \xB7 ${tp.quality} \xB7 ${tp.comment}`),
    `Assessment: ${result.riskReward.assessment}`,
    "",
    "TECHNICAL PAIR ANALYSIS",
    `Source: ${result.technicalContext.sourcePath}`,
    `Last Updated: ${result.technicalContext.lastUpdated ?? "unknown"}`,
    `Trend: ${result.technicalContext.trend}`,
    `Market Structure: ${result.technicalContext.marketStructure ?? "unavailable"}`,
    `Technical Score: ${result.technicalContext.technicalScore != null ? `${result.technicalContext.technicalScore}/100` : "unavailable"}`,
    `Support: ${formatNumber(result.technicalContext.support)}`,
    `Resistance: ${formatNumber(result.technicalContext.resistance)}`,
    `Entry Location: ${result.technicalContext.entryLocationQuality}`,
    `Liquidity Context: ${result.technicalContext.liquidityContext}`,
    "",
    "FUNDAMENTAL INTELLIGENCE",
    `Source: ${result.fundamentalContext.sourcePath}`,
    `Last Updated: ${result.fundamentalContext.lastUpdated ?? "unknown"}`,
    `Macro Bias: ${result.fundamentalContext.macroBias}${result.fundamentalContext.macroConfidence != null ? ` (${result.fundamentalContext.macroConfidence}%)` : ""}`,
    `Assessment: ${result.fundamentalContext.assessment}`,
    `Key Drivers: ${result.fundamentalContext.keyDrivers.join(" | ") || "none"}`,
    "",
    "NEWS / SESSION / VOLATILITY",
    `Calendar Risk: ${result.newsAndSessionRisk.calendarRisk}`,
    `Headline Risk: ${result.newsAndSessionRisk.headlineRisk}`,
    `Session: ${result.newsAndSessionRisk.session}`,
    `Liquidity Quality: ${result.newsAndSessionRisk.liquidityQuality}`,
    `Spread Status: ${result.newsAndSessionRisk.spreadStatus}`,
    `Volatility: ${result.newsAndSessionRisk.volatility}`,
    `Assessment: ${result.newsAndSessionRisk.assessment}`,
    "",
    "CONFLICTS",
    result.conflicts.join(" | ") || "none",
    "",
    "FINAL AI DECISION",
    `${decision.emoji} ${result.decisionLabel}`,
    `Primary Reason: ${result.primaryReason}`,
    `Hard Rejection Reasons: ${result.hardRejectionReasons.join(" | ") || "none"}`,
    `Soft Concerns: ${result.softConcerns.join(" | ") || "none"}`,
    `Positive Factors: ${result.positiveFactors.join(" | ") || "none"}`,
    `Recommended Action: ${result.recommendedAction}`,
    "",
    "WHAT WOULD MAKE THIS TRADE VALID",
    result.whatWouldMakeItValid.join(" | ") || "none",
    "",
    "TRADER CHECKLIST",
    ...result.checklist.map((item) => `${item.item}: ${item.status} \u2014 ${item.details}`),
    "",
    "SOURCE MESSAGE",
    message.rawText
  ].filter((line) => line != null && line !== "").join("\n");
  return { html, text };
}
async function sendEmailForMessage(messageId) {
  const message = await getTelegramMessageById(messageId);
  if (!message) return { sent: false, error: "Message not found." };
  if (!message.symbol || !message.rawText) {
    return { sent: false, error: "Message does not contain a tradable signal." };
  }
  let validation = null;
  if (message.autoAnalysisStatus === "completed" || message.autoAnalysisStatus === "fallback") {
    const saved = message.autoAnalysisResult;
    if (saved && typeof saved === "object" && "ok" in saved && saved.ok === true) {
      validation = saved;
    }
  }
  if (!validation) {
    const result = await validateTelegramTradeSignal(message.rawText, message.parsedSignal, {
      signalTime: message.telegramDate,
      sourceMessage: message.rawText
    });
    if (result.ok === false) {
      return { sent: false, error: result.error };
    }
    validation = result;
    const now3 = (/* @__PURE__ */ new Date()).toISOString();
    await updateTelegramMessageAutomation(message.id, {
      autoAnalysisStatus: validation.aiValidationUnavailable ? "fallback" : "completed",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      autoAnalysisResult: validation,
      autoAnalysisError: validation.aiValidationError ?? null,
      autoAnalysisAt: now3
    });
  }
  const prefs = await getPreferences(process.env.DEFAULT_USER_ID ?? "");
  const cc = prefs.emailRecipient && prefs.emailRecipient !== TELEGRAM_ALERT_RECIPIENT ? prefs.emailRecipient : void 0;
  const email = buildTelegramSignalEmail(message, validation);
  const emailResult = await sendMail({
    to: TELEGRAM_ALERT_RECIPIENT,
    cc,
    subject: computeEmailSubject(validation),
    html: email.html,
    text: email.text,
    fromName: "AlphaMentals Telegram",
    context: { signal: validation.symbol, messageId: message.id }
  });
  const now2 = (/* @__PURE__ */ new Date()).toISOString();
  await updateTelegramMessageAutomation(message.id, {
    emailSentAt: emailResult.ok ? now2 : null,
    emailStatus: emailResult.ok ? "sent" : "failed",
    emailError: emailResult.ok ? null : emailResult.error ?? "Unknown email error"
  });
  if (!emailResult.ok) {
    return { sent: false, error: emailResult.error ?? "Email sending failed." };
  }
  return { sent: true, verdict: validation.verdict, confidence: validation.confidence };
}
async function handleNewTelegramSignal(message) {
  if (!supportedAutoSignal(message)) return { skipped: true, reason: "Message is not a supported trading signal." };
  if (message.emailSentAt) return { skipped: true, reason: "Signal email already sent." };
  if (message.autoAnalysisStatus === "running") return { skipped: true, reason: "Signal analysis already running." };
  if (message.autoAnalysisStatus === "failed") return { skipped: true, reason: "Automatic analysis previously failed; manual retry only." };
  if (message.signalHash) {
    const duplicate = await getTelegramMessageBySignalHash(message.signalHash).catch(() => null);
    if (duplicate && duplicate.id !== message.id && duplicate.emailSentAt) {
      await updateTelegramMessageAutomation(message.id, {
        autoAnalysisStatus: "skipped",
        emailStatus: "skipped",
        emailError: "Duplicate signal hash already processed."
      });
      return { skipped: true, reason: "Duplicate signal hash already processed." };
    }
  }
  await updateTelegramMessageAutomation(message.id, {
    autoAnalysisStatus: "running",
    emailStatus: "pending",
    autoAnalysisError: null,
    emailError: null
  });
  try {
    return await withTimeout((async () => {
      const validation = await validateTelegramTradeSignal(message.rawText, message.parsedSignal, {
        signalTime: message.telegramDate,
        sourceMessage: message.rawText
      });
      if (validation.ok === false) {
        await updateTelegramMessageAutomation(message.id, {
          autoAnalysisStatus: "failed",
          autoAnalysisError: validation.error,
          autoAnalysisAt: (/* @__PURE__ */ new Date()).toISOString(),
          emailStatus: "skipped",
          emailError: validation.error
        });
        await createNotification({
          title: "Telegram signal auto-analysis failed",
          message: validation.error,
          category: "telegram_signals",
          severity: "warning",
          symbol: message.symbol ?? void 0,
          metadata: { verdict: "UNAVAILABLE", recipient: TELEGRAM_ALERT_RECIPIENT, messageId: message.telegramMessageId },
          dedupeKey: `telegram-signal-failed:${message.id}`
        });
        return { skipped: true, reason: validation.error };
      }
      const prefs = await getPreferences(process.env.DEFAULT_USER_ID ?? "");
      const cc = prefs.emailRecipient && prefs.emailRecipient !== TELEGRAM_ALERT_RECIPIENT ? prefs.emailRecipient : void 0;
      const email = buildTelegramSignalEmail(message, validation);
      console.log("[auto-signal] Sending signal email", {
        provider: "resend",
        signal: validation.symbol,
        messageId: message.id,
        stage: "sending",
        recipient: TELEGRAM_ALERT_RECIPIENT
      });
      const emailResult = await sendMail({
        to: TELEGRAM_ALERT_RECIPIENT,
        cc,
        subject: computeEmailSubject(validation),
        html: email.html,
        text: email.text,
        fromName: "AlphaMentals Telegram",
        context: { signal: validation.symbol, messageId: message.id }
      });
      if (emailResult.ok) {
        console.log("[auto-signal] Signal email sent", {
          provider: "resend",
          signal: validation.symbol,
          messageId: message.id,
          emailId: emailResult.emailId ?? null,
          stage: "sent",
          recipient: TELEGRAM_ALERT_RECIPIENT
        });
      } else {
        console.error("[auto-signal] Signal email failed", {
          provider: "resend",
          signal: validation.symbol,
          messageId: message.id,
          stage: "failed",
          error: emailResult.error
        });
      }
      const now2 = (/* @__PURE__ */ new Date()).toISOString();
      await updateTelegramMessageAutomation(message.id, {
        autoAnalysisStatus: validation.aiValidationUnavailable ? "fallback" : "completed",
        autoAnalysisResult: validation,
        autoAnalysisError: validation.aiValidationError ?? null,
        autoAnalysisAt: now2,
        emailSentAt: emailResult.ok ? now2 : null,
        emailStatus: emailResult.ok ? "sent" : "failed",
        emailError: emailResult.ok ? null : emailResult.error ?? "Unknown email error"
      });
      await createNotification({
        title: emailResult.ok ? "Telegram signal email sent" : "Telegram signal email failed",
        message: emailResult.ok ? `${validation.symbol} ${validation.parsedSignal.direction} ${validation.parsedSignal.orderType ?? "MARKET"} sent to ${TELEGRAM_ALERT_RECIPIENT} with verdict ${validation.verdict}.` : `${validation.symbol} signal email failed: ${emailResult.error ?? "Unknown error"}`,
        category: "telegram_signals",
        severity: emailResult.ok ? "info" : "warning",
        symbol: validation.symbol,
        metadata: {
          verdict: validation.verdict,
          recipient: TELEGRAM_ALERT_RECIPIENT,
          emailStatus: emailResult.ok ? "sent" : "failed",
          confidence: validation.confidence,
          finalAction: validation.finalAction
        },
        dedupeKey: `telegram-signal-email:${message.id}`
      });
      return { skipped: false, sent: emailResult.ok, validation };
    })(), AUTO_SIGNAL_TIMEOUT_MS);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Unknown automatic signal workflow error";
    await updateTelegramMessageAutomation(message.id, {
      autoAnalysisStatus: "failed",
      autoAnalysisError: messageText,
      autoAnalysisAt: (/* @__PURE__ */ new Date()).toISOString(),
      emailStatus: "failed",
      emailError: messageText
    });
    await createNotification({
      title: "Telegram signal automation failed",
      message: messageText,
      category: "telegram_signals",
      severity: "warning",
      symbol: message.symbol ?? void 0,
      metadata: { recipient: TELEGRAM_ALERT_RECIPIENT, messageId: message.telegramMessageId },
      dedupeKey: `telegram-signal-error:${message.id}`
    });
    return { skipped: true, reason: messageText };
  }
}

// backend/server/services/telegramInfo.service.ts
var syncState = {
  lastSyncAt: null,
  nextSyncAt: null,
  lastError: null,
  isSyncing: false,
  lastCheckedChannels: 0,
  lastNewMessages: 0,
  lastNewSignals: 0,
  lastEmailsSent: 0
};
var syncInFlight = false;
var SYNC_RATE_LIMIT_MS = 3e4;
var lastSyncRequestAt = 0;
function setSyncScheduleMetadata(nextSyncAt) {
  syncState.nextSyncAt = nextSyncAt.toISOString();
}
function buildFallbackAnalysis(message) {
  const symbol = message.symbol ?? "UNKNOWN";
  const hasSignal = message.messageType === "SIGNAL" && message.symbol && message.direction;
  const tradeDirection = hasSignal && (message.direction === "BUY" || message.direction === "LONG") ? "BUY" : hasSignal && (message.direction === "SELL" || message.direction === "SHORT") ? "SELL" : "NO_TRADE";
  const action = tradeDirection === "NO_TRADE" ? "NO_TRADE" : "TRADE";
  const bias = tradeDirection === "BUY" ? "bullish" : tradeDirection === "SELL" ? "bearish" : "mixed";
  const reason = hasSignal ? `Parsed ${symbol} signal from Telegram and prepared it for the Trading OS review flow.` : "Message does not contain a complete structured trade signal, so the system stays on NO_TRADE.";
  return {
    status: "processed",
    action,
    tradeDirection,
    bias,
    confidence: hasSignal ? 58 : 24,
    entry: message.entry,
    stopLoss: message.stopLoss,
    takeProfit: message.takeProfit,
    reason,
    riskNotes: hasSignal ? ["Telegram-originated idea. Validate with market structure, session timing, and macro context before execution."] : ["No complete trade signal was detected."]
  };
}
function enforceSyncRateLimit() {
  const now2 = Date.now();
  if (now2 - lastSyncRequestAt < SYNC_RATE_LIMIT_MS) {
    const retrySeconds = Math.ceil((SYNC_RATE_LIMIT_MS - (now2 - lastSyncRequestAt)) / 1e3);
    throw new Error(`Too many sync requests. Retry in ${retrySeconds} seconds.`);
  }
  lastSyncRequestAt = now2;
}
function acquireSyncLock() {
  if (syncInFlight) return false;
  syncInFlight = true;
  syncState.isSyncing = true;
  return true;
}
function releaseSyncLock(error) {
  syncInFlight = false;
  syncState.isSyncing = false;
  if (error !== void 0) syncState.lastError = error;
}
function updateSyncMetrics(result) {
  syncState.lastSyncAt = result.lastSyncAt;
  syncState.lastError = result.errors[0] ?? null;
  syncState.lastCheckedChannels = result.checkedChannels;
  syncState.lastNewMessages = result.newMessages;
  syncState.lastNewSignals = result.newSignals;
  syncState.lastEmailsSent = result.emailsSent;
}
function logTelegramSyncStep(message, context = {}) {
  const payload = Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== void 0 && value !== null)
  );
  if (Object.keys(payload).length === 0) {
    console.log(`[Telegram] ${message}`);
    return;
  }
  console.log(`[Telegram] ${message}`, payload);
}
async function ingestTelegramMessage(payload, strategy) {
  const parsed = parseTelegramSignal(payload.rawText);
  const stored = await storeTelegramMessage({
    telegramMessageId: payload.telegramMessageId,
    chatId: payload.chatId,
    chatTitle: payload.chatTitle,
    senderId: payload.senderId,
    senderName: payload.senderName,
    text: payload.text,
    rawText: payload.rawText,
    replyInfo: payload.replyInfo,
    attachments: payload.attachments ?? [],
    telegramDate: payload.telegramDate,
    parsed
  }, strategy);
  return {
    ...stored,
    parsed
  };
}
async function getTelegramStatus() {
  const [counts, connection] = await Promise.all([
    getTelegramMessageCounts().catch(() => ({ total: 0, signals: 0, latestSync: null })),
    testTelegramConnection()
  ]);
  const runtime = getTelegramRuntimeState();
  const targetChat = connection.targetChat?.id ?? runtime.targetChat;
  const configured = runtime.configured || Boolean(runtime.targetChat && runtime.enabled);
  const targetChatConfigured = Boolean(targetChat);
  const status = !configured ? "not_configured" : connection.loggedIn && connection.targetChatResolved ? "connected" : connection.loggedIn ? "connected_target_chat_failed" : "configured_login_failed";
  return {
    enabled: connection.enabled,
    configured,
    targetChatConfigured,
    connected: connection.connected,
    loggedIn: connection.loggedIn,
    targetChatAccessible: connection.targetChatAccessible,
    targetChat,
    targetChatTitle: connection.targetChat?.title ?? runtime.targetChatTitle,
    targetChatType: connection.targetChat?.type ?? runtime.targetChatType,
    targetChatResolved: connection.targetChatResolved,
    canReadMessages: connection.canReadMessages,
    messagesFetched: runtime.messagesFetched,
    currentPhase: connection.currentPhase ?? runtime.currentPhase,
    account: connection.account,
    lastMessageDate: connection.lastMessageDate,
    lastSyncAt: syncState.lastSyncAt ?? runtime.lastSyncAt ?? counts.latestSync,
    nextSyncAt: syncState.nextSyncAt,
    syncStatus: syncState.isSyncing ? "syncing" : syncState.lastError ? "error" : "idle",
    lastCheckedChannels: syncState.lastCheckedChannels,
    lastNewMessages: syncState.lastNewMessages,
    lastNewSignals: syncState.lastNewSignals,
    lastEmailsSent: syncState.lastEmailsSent,
    error: connection.error ?? syncState.lastError ?? runtime.error,
    lastError: connection.error ?? syncState.lastError ?? runtime.error,
    errorCode: connection.code ?? runtime.code,
    errorPhase: connection.errorPhase ?? runtime.errorPhase,
    errorMessage: connection.errorMessage ?? connection.error ?? syncState.lastError ?? runtime.error,
    stack: connection.stack ?? runtime.stack,
    hints: connection.hints.length ? connection.hints : runtime.hints,
    status
  };
}
async function getTelegramConnectionTest() {
  return await testTelegramConnection();
}
async function runTelegramSync(limit, source) {
  const clampedLimit = Math.min(Math.max(limit, 1), 10);
  const runtime = getTelegramRuntimeState();
  const config = getTelegramEnvConfig();
  logTelegramSyncStep("Sync started", { messagesRequested: clampedLimit });
  const targetChat = runtime.targetChat ?? config.targetChat;
  const accountLabel = runtime.accountUsername ? `@${runtime.accountUsername}` : null;
  const resolvedChat = runtime.targetChatTitle ?? targetChat;
  const resolvedChatType = runtime.targetChatType ?? null;
  const checkedChannels = targetChat ? 1 : 0;
  logTelegramSyncStep("Sync using cached session state", { accountLabel, targetChat, resolvedChat, resolvedChatType });
  const latestMessageId = targetChat ? await getLatestTelegramMessageIdForChat(targetChat).catch(() => null) : null;
  if (latestMessageId) {
    logTelegramSyncStep(`Stored last processed message ID for channel: ${latestMessageId}`, { targetChat, resolvedChat });
  } else {
    logTelegramSyncStep("No stored message cursor found for channel. Fetching recent history.", { targetChat, resolvedChat });
  }
  const result = await fetchTelegramHistory(clampedLimit, latestMessageId);
  const messages = result.messages ?? [];
  const fetchedCount = result.messages_fetched ?? messages.length;
  const effectiveResolvedChat = result.chat?.title ?? resolvedChat;
  logTelegramSyncStep("Channels checked", { checkedChannels, accountLabel, targetChat, resolvedChat: effectiveResolvedChat });
  logTelegramSyncStep("Messages fetched", {
    accountLabel,
    targetChat,
    resolvedChat: effectiveResolvedChat,
    messagesFetched: fetchedCount
  });
  if (messages.length === 0) {
    const emptyResult = {
      ok: true,
      checkedChannels,
      newMessages: 0,
      newSignals: 0,
      emailsSent: 0,
      duplicatesSkipped: 0,
      imported: 0,
      skipped: 0,
      errors: [],
      messagesFetched: 0,
      lastSyncAt: (/* @__PURE__ */ new Date()).toISOString(),
      source
    };
    updateSyncMetrics(emptyResult);
    return emptyResult;
  }
  const storageStrategy = await resolveStorageStrategy(true);
  if (storageStrategy === "unavailable") {
    throw new TelegramBridgeError(
      "TELEGRAM_UNAVAILABLE",
      "Telegram messages were fetched but could not be saved to the database.",
      "Database unreachable: configure DATABASE_URL or SUPABASE_SERVICE_ROLE_KEY.",
      {
        phase: "database_save",
        operation: "syncTelegramSignals",
        targetChat,
        loginOk: true,
        targetChatResolved: true,
        canReadMessages: true,
        account: runtime.account ?? null,
        targetChatInfo: null,
        hints: [
          "Provide a reachable DATABASE_URL or SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL.",
          "Then retry the Telegram sync."
        ]
      }
    );
  }
  let imported = 0;
  let skipped = 0;
  let duplicatesSkipped = 0;
  let newSignals = 0;
  let emailsSent = 0;
  const errors = [];
  for (const [index, payload] of messages.entries()) {
    logTelegramSyncStep(`Processing message ${index + 1}/${messages.length}`, {
      targetChat,
      resolvedChat: effectiveResolvedChat,
      messagesFetched: fetchedCount,
      messagesSaved: imported,
      messagesSkipped: skipped
    });
    try {
      const stored = await ingestTelegramMessage(payload, storageStrategy);
      const isValidSignal = stored.parsed.messageType === "SIGNAL" && isTelegramLimitOrderSignal(payload.rawText, stored.parsed);
      if (stored.imported) {
        imported += 1;
        if (isValidSignal) {
          newSignals += 1;
          if (stored.record) {
            const signalRecord = stored.record;
            void handleNewTelegramSignal(signalRecord).then((automation) => {
              if (!automation.skipped && "sent" in automation && automation.sent) {
                console.log("[Telegram] Background signal email sent", { messageId: signalRecord.id, symbol: signalRecord.symbol });
              }
            }).catch((err) => {
              console.error("[Telegram] Background signal processing failed", {
                messageId: signalRecord.id,
                symbol: signalRecord.symbol,
                error: err instanceof Error ? err.message : String(err)
              });
            });
          }
        }
        console.log("[Telegram] Message saved", {
          telegramMessageId: payload.telegramMessageId,
          messageType: stored.parsed.messageType,
          isValidSignal,
          targetChat,
          resolvedChat: effectiveResolvedChat
        });
      } else {
        skipped += 1;
        duplicatesSkipped += 1;
        console.log("[Telegram] Duplicate skipped", {
          telegramMessageId: payload.telegramMessageId,
          targetChat,
          resolvedChat: effectiveResolvedChat
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown Telegram message processing error";
      errors.push(errorMessage);
      console.error("[Telegram] Message processing failed", {
        phase: "database_save",
        operation: "syncTelegramSignals",
        telegramMessageId: payload.telegramMessageId,
        targetChat,
        resolvedChat: effectiveResolvedChat,
        error: errorMessage
      });
    }
  }
  const syncResult = {
    ok: true,
    checkedChannels,
    newMessages: imported,
    newSignals,
    emailsSent,
    duplicatesSkipped,
    imported,
    skipped,
    errors,
    messagesFetched: fetchedCount,
    lastSyncAt: (/* @__PURE__ */ new Date()).toISOString(),
    source
  };
  updateSyncMetrics(syncResult);
  logTelegramSyncStep("Sync finished", {
    accountLabel,
    targetChat,
    resolvedChat: effectiveResolvedChat,
    messagesFetched: fetchedCount,
    messagesSaved: imported,
    messagesSkipped: skipped
  });
  logTelegramSyncStep("Valid signals parsed", { targetChat, resolvedChat: effectiveResolvedChat, messagesSaved: newSignals });
  logTelegramSyncStep("Emails sent", { targetChat, resolvedChat: effectiveResolvedChat, messagesSaved: emailsSent });
  return syncResult;
}
async function syncTelegramSignals(limit = 10, options = {}) {
  const source = options.source ?? "manual";
  if (options.enforceRateLimit ?? source === "manual") {
    enforceSyncRateLimit();
  }
  if (!acquireSyncLock()) {
    throw new Error("Sync already in progress. Please wait for the current sync to complete.");
  }
  try {
    const result = await runTelegramSync(limit, source);
    releaseSyncLock(result.errors[0] ?? null);
    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown Telegram sync error";
    releaseSyncLock(msg);
    throw error;
  }
}
async function syncTelegramMessages(limit = 10) {
  const result = await syncTelegramSignals(limit, { source: "manual", enforceRateLimit: true });
  return {
    success: result.ok,
    imported: result.imported,
    skipped: result.skipped,
    errors: result.errors,
    messagesFetched: result.messagesFetched,
    checkedChannels: result.checkedChannels,
    newMessages: result.newMessages,
    newSignals: result.newSignals,
    emailsSent: result.emailsSent
  };
}
async function getRecentTelegramMessages(filter) {
  console.log("[Telegram] UI message query started", {
    phase: "frontend_response",
    operation: "listRecentTelegramMessages",
    filters: filter
  });
  const messages = await listRecentTelegramMessages(filter);
  const limitMessages = messages.filter((message) => isTelegramLimitOrderSignal(message.rawText, {
    messageType: message.messageType,
    direction: message.direction
  }));
  console.log("[Telegram] UI message query result", {
    phase: "frontend_response",
    operation: "listRecentTelegramMessages",
    returned: limitMessages.length,
    fetchedBeforeFilter: messages.length,
    filters: filter
  });
  if (messages.length > 0 && limitMessages.length === 0) {
    console.warn("[Telegram] Messages fetched but filtered out because they are not BUY LIMIT / SELL LIMIT signals.", {
      phase: "frontend_response",
      operation: "listRecentTelegramMessages",
      fetchedBeforeFilter: messages.length,
      returned: 0,
      hint: "Only pending limit order signals are shown in the dashboard."
    });
  }
  if (limitMessages.length === 0) {
    console.warn("[Telegram] UI query returned 0 saved messages.", {
      phase: "frontend_response",
      operation: "listRecentTelegramMessages",
      filters: filter,
      hint: "Messages may have been filtered out because they are not BUY LIMIT / SELL LIMIT signals, skipped as duplicates, not saved, or frontend filters removed them."
    });
  }
  return limitMessages;
}
async function analyzeTelegramMessage(messageId) {
  const message = await getTelegramMessageById(messageId);
  if (!message) throw new Error("Telegram message not found.");
  if (!message.symbol || !message.direction || message.messageType !== "SIGNAL") {
    return buildFallbackAnalysis(message);
  }
  const parsedOverride = {
    symbol: message.symbol ?? void 0,
    direction: message.direction ?? void 0,
    orderType: message.parsedSignal?.orderType ?? void 0,
    entry: message.entry ?? void 0,
    stopLoss: message.stopLoss ?? void 0,
    takeProfits: Array.isArray(message.takeProfits) ? message.takeProfits : void 0,
    timeframe: message.timeframe ?? void 0,
    messageType: message.messageType
  };
  const validated = await validateTelegramTradeSignal(message.rawText, parsedOverride, {
    signalTime: message.telegramDate,
    sourceMessage: message.rawText
  });
  if (validated.ok) {
    const tradeDirection = validated.parsedSignal.direction === "BUY" ? "BUY" : validated.parsedSignal.direction === "SELL" ? "SELL" : "NO_TRADE";
    return {
      status: "processed",
      action: validated.finalAction === "avoid" ? "NO_TRADE" : "TRADE",
      tradeDirection,
      bias: validated.fundamentalAlignment === "aligned" ? tradeDirection === "BUY" ? "bullish" : tradeDirection === "SELL" ? "bearish" : "mixed" : "mixed",
      confidence: validated.confidence,
      entry: validated.parsedSignal.entry,
      stopLoss: validated.parsedSignal.sl,
      takeProfit: validated.parsedSignal.tps[0] ?? null,
      takeProfitSecondary: validated.parsedSignal.tps[1] ?? null,
      reason: validated.summary,
      riskNotes: validated.keyRisks,
      analysis: validated,
      context: {
        technicalContext: validated.technicalContext,
        macroBias: validated.macroBias,
        calendarRisk: validated.calendarRisk,
        usedAnalysisGeneratedAt: validated.usedAnalysisGeneratedAt
      }
    };
  }
  try {
    const response = await analyzeTradingSignal({
      symbol: message.symbol,
      timeframe: message.timeframe ?? "15m",
      signal: message.direction === "LONG" ? "BUY" : message.direction === "SHORT" ? "SELL" : message.direction,
      price: message.entry ?? message.takeProfit ?? message.stopLoss ?? 0,
      strategy: "Telegram imported signal",
      message: message.text,
      signal_type: "setup_detected",
      direction_hint: message.direction === "BUY" || message.direction === "LONG" ? "buy" : "sell",
      support: message.stopLoss ?? void 0,
      resistance: message.takeProfit ?? void 0
    });
    return {
      status: "processed",
      action: response.analysis.decision === "BUY" || response.analysis.decision === "SELL" ? "TRADE" : "NO_TRADE",
      tradeDirection: response.analysis.decision,
      bias: response.analysis.bias === "neutral" ? "mixed" : response.analysis.bias ?? "mixed",
      confidence: response.analysis.confidence,
      entry: response.analysis.entry_zone.low && response.analysis.entry_zone.high ? Number(((response.analysis.entry_zone.low + response.analysis.entry_zone.high) / 2).toFixed(message.symbol === "XAUUSD" ? 2 : 5)) : null,
      stopLoss: response.analysis.stop_loss || null,
      takeProfit: response.analysis.take_profit_1 || null,
      takeProfitSecondary: response.analysis.take_profit_2 || null,
      reason: response.analysis.reasoning.join(" "),
      riskNotes: [...response.analysis.warnings, ...response.analysis.invalid_if],
      analysis: response.analysis,
      context: response.context
    };
  } catch {
    return buildFallbackAnalysis(message);
  }
}
function derivePhaseMessage(args) {
  const { phase, loginOk, targetChatResolved, fallback } = args;
  const p = (phase ?? "").toLowerCase();
  if (p.includes("target_chat") || p.includes("resolve")) return "Target chat could not be resolved";
  if (p.includes("save") || p.includes("database") || p.includes("store")) return "Messages fetched but failed to save to database";
  if (p.includes("fetch") || p.includes("message") || p.includes("read")) {
    return loginOk ? "Telegram login succeeded but message fetching failed" : fallback;
  }
  if (p.includes("login") || p.includes("auth") || p.includes("connect")) {
    return targetChatResolved ? fallback : "Telegram login failed";
  }
  return fallback;
}
function normalizeTelegramRouteError(error) {
  if (error instanceof TelegramBridgeError) {
    return {
      status: error.status,
      message: derivePhaseMessage({
        phase: error.phase,
        loginOk: error.loginOk,
        targetChatResolved: error.targetChatResolved,
        canReadMessages: error.canReadMessages,
        fallback: error.message
      }),
      rawMessage: error.message,
      code: error.code,
      phase: error.phase,
      operation: error.operation,
      stack: error.stackDetails,
      hints: error.hints,
      account: error.account,
      targetChat: error.targetChat,
      targetChatInfo: error.targetChatInfo,
      loginOk: error.loginOk,
      targetChatResolved: error.targetChatResolved,
      canReadMessages: error.canReadMessages,
      telegramError: error.errorName ?? error.errorCode ?? null,
      details: error.details
    };
  }
  if (isTelegramStoreUnavailable(error)) {
    return {
      status: 503,
      message: "Messages fetched but failed to save to database",
      rawMessage: "Telegram storage is unavailable because the database is not reachable.",
      code: "DATABASE_UNAVAILABLE",
      phase: "database_save",
      hints: ["Confirm the database is running and DATABASE_URL is reachable."]
    };
  }
  if (error instanceof Error) return { status: 500, message: error.message, rawMessage: error.message, code: "INTERNAL_ERROR", stack: error.stack, hints: [] };
  return { status: 500, message: "Unknown Telegram error", rawMessage: "Unknown Telegram error", code: "UNKNOWN_ERROR", stack: null, hints: [] };
}

// backend/server/routes/telegram.ts
var telegramRouter = (0, import_express21.Router)();
var SyncSchema = import_zod14.z.object({
  limit: import_zod14.z.number().int().min(1).max(100).optional()
});
function isAuthorizedCron2(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
  const headerSecret = req.headers["x-cron-secret"] ?? "";
  return bearer === secret || headerSecret === secret;
}
function emptyDiagnostic() {
  return {
    enabled: true,
    configured: false,
    targetChatConfigured: false,
    connected: false,
    loggedIn: false,
    targetChatAccessible: false,
    targetChatResolved: false,
    canReadMessages: false,
    messagesFetched: 0,
    currentPhase: null,
    account: null,
    targetChat: null,
    targetChatTitle: null,
    targetChatType: null,
    lastMessageDate: null,
    lastSyncAt: null,
    error: null,
    lastError: null,
    errorCode: null,
    errorPhase: null,
    errorMessage: null,
    stack: null,
    hints: [],
    status: "not_configured"
  };
}
telegramRouter.get("/status", async (_req, res) => {
  try {
    const status = await getTelegramStatus();
    res.json(status);
  } catch (error) {
    const normalized = normalizeTelegramRouteError(error);
    res.status(normalized.status).json({
      ...emptyDiagnostic(),
      error: normalized.message,
      errorCode: "TELEGRAM_UNAVAILABLE"
    });
  }
});
telegramRouter.get("/diagnostics", async (_req, res) => {
  try {
    const status = await getTelegramStatus();
    res.json({
      configured: status.configured,
      connected: status.connected,
      loggedIn: status.loggedIn,
      account: status.account?.username ? `@${status.account.username}` : status.account?.displayName ?? null,
      targetChat: status.targetChat,
      targetChatConfigured: status.targetChatConfigured,
      resolvedChat: status.targetChatResolved ? status.targetChat : null,
      targetChatResolved: status.targetChatResolved,
      resolvedChatTitle: status.targetChatTitle ?? null,
      resolvedChatType: status.targetChatType ?? null,
      canReadMessages: status.canReadMessages,
      readTestPassed: status.canReadMessages,
      messagesFetched: status.messagesFetched,
      lastMessageDate: status.lastMessageDate,
      currentPhase: status.currentPhase,
      lastError: status.lastError,
      errorPhase: status.errorPhase,
      errorMessage: status.errorMessage,
      errorCode: status.errorCode,
      stack: status.stack,
      hints: status.hints,
      status: status.status
    });
  } catch (error) {
    const normalized = normalizeTelegramRouteError(error);
    res.status(normalized.status).json({
      connected: false,
      loggedIn: false,
      configured: false,
      account: null,
      targetChat: null,
      targetChatConfigured: false,
      resolvedChat: null,
      targetChatResolved: false,
      resolvedChatTitle: null,
      resolvedChatType: null,
      canReadMessages: false,
      readTestPassed: false,
      messagesFetched: 0,
      lastMessageDate: null,
      currentPhase: normalized.phase ?? null,
      lastError: normalized.message,
      errorPhase: normalized.phase ?? null,
      errorMessage: normalized.message,
      errorCode: normalized.code ?? "TELEGRAM_UNAVAILABLE",
      stack: normalized.stack ?? null,
      hints: normalized.hints ?? [],
      status: "not_configured"
    });
  }
});
telegramRouter.get("/debug", async (_req, res) => {
  try {
    const result = await runTelegramDoctor();
    res.json({
      backend_alive: true,
      python_found: result.python_found,
      python_version: result.python_version,
      python_executable: result.python_executable,
      script_exists: result.script_exists,
      script_path: result.script_path,
      env_vars_present: result.env_vars,
      telethon_installed: result.doctor?.telethon_installed ?? false,
      dotenv_installed: result.doctor?.dotenv_loaded ?? false,
      session_configured: result.doctor?.session_configured ?? false,
      session_source: result.doctor?.session_source ?? null,
      session_error: result.doctor?.session_error ?? null,
      api_id_configured: result.doctor?.api_id_configured ?? false,
      api_hash_configured: result.doctor?.api_hash_configured ?? false,
      target_chat_configured: result.doctor?.target_chat_configured ?? false,
      working_directory: result.doctor?.working_directory ?? null,
      error_code: result.error_code,
      doctor_error: result.doctor_error,
      raw_stderr: result.raw_stderr
    });
  } catch (error) {
    res.status(500).json({
      backend_alive: true,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});
telegramRouter.get("/test-connection", async (_req, res) => {
  try {
    const result = await getTelegramConnectionTest();
    const statusCode = result.error ? result.code === "MISSING_CREDENTIALS" || result.code === "INVALID_TARGET_CHAT" ? 400 : result.code === "INVALID_API_CREDENTIALS" || result.code === "INVALID_SESSION" ? 401 : result.code === "TARGET_CHAT_ACCESS_DENIED" ? 403 : result.code === "TELEGRAM_RATE_LIMIT" ? 429 : 503 : 200;
    res.status(statusCode).json(result);
  } catch (error) {
    const normalized = normalizeTelegramRouteError(error);
    res.status(normalized.status).json({
      enabled: true,
      connected: false,
      loggedIn: false,
      targetChatAccessible: false,
      targetChatResolved: false,
      canReadMessages: false,
      messagesFetched: 0,
      currentPhase: normalized.phase ?? null,
      lastMessageDate: null,
      account: null,
      targetChat: null,
      error: normalized.message,
      code: normalized.code ?? "TELEGRAM_UNAVAILABLE",
      errorPhase: normalized.phase ?? null,
      errorMessage: normalized.message,
      stack: normalized.stack ?? null,
      hints: normalized.hints ?? []
    });
  }
});
telegramRouter.post("/sync", async (req, res) => {
  try {
    const parsed = SyncSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid sync payload.", details: parsed.error.flatten() });
    }
    console.log("[Telegram] /api/telegram/sync request received", {
      phase: "frontend_request",
      operation: "sync",
      limit: parsed.data.limit ?? 10
    });
    const result = await syncTelegramMessages(parsed.data.limit ?? 10);
    console.log("[Telegram] /api/telegram/sync response ready", {
      phase: "frontend_response",
      operation: "sync",
      success: result.success,
      messagesFetched: result.messagesFetched ?? 0,
      imported: result.imported,
      skipped: result.skipped,
      errorCount: result.errors.length
    });
    return res.json(result);
  } catch (error) {
    const normalized = normalizeTelegramRouteError(error);
    const accountLabel = normalized.account?.username ? `@${normalized.account.username}` : normalized.account?.displayName ?? null;
    console.error("[Telegram] Sync request failed:", {
      phase: normalized.phase ?? "unknown",
      operation: "sync",
      account: accountLabel,
      targetChat: normalized.targetChat ?? null,
      resolvedChat: normalized.targetChatInfo ?? null,
      messagesFetched: null,
      messagesSaved: 0,
      name: normalized.telegramError ?? "TelegramSyncError",
      message: normalized.message,
      code: normalized.code ?? "TELEGRAM_UNAVAILABLE",
      stack: normalized.stack ?? null,
      raw: normalized.rawMessage ?? normalized.details ?? null,
      hints: normalized.hints ?? []
    });
    return res.status(normalized.status).json({
      success: false,
      phase: normalized.phase ?? "unknown",
      message: normalized.message,
      imported: 0,
      skipped: 0,
      errors: [normalized.rawMessage ?? normalized.message],
      error: normalized.message,
      errorCode: normalized.code ?? "TELEGRAM_UNAVAILABLE",
      errorPhase: normalized.phase ?? null,
      httpStatus: normalized.status,
      targetChat: normalized.targetChat ?? null,
      resolvedChat: normalized.targetChatInfo ?? null,
      account: accountLabel,
      telegramError: normalized.telegramError ?? null,
      loginOk: normalized.loginOk ?? false,
      targetChatResolved: normalized.targetChatResolved ?? false,
      canReadMessages: normalized.canReadMessages ?? false,
      details: normalized.details ?? normalized.rawMessage ?? null,
      stack: normalized.stack ?? null,
      hints: normalized.hints ?? []
    });
  }
});
telegramRouter.post("/cron", async (req, res) => {
  if (!isAuthorizedCron2(req)) {
    return res.status(401).json({ error: "Unauthorized cron request" });
  }
  try {
    const parsed = SyncSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid sync payload.", details: parsed.error.flatten() });
    }
    const result = await syncTelegramSignals(parsed.data.limit ?? 10, {
      source: "cron",
      enforceRateLimit: false
    });
    return res.json(result);
  } catch (error) {
    const normalized = normalizeTelegramRouteError(error);
    return res.status(normalized.status).json({
      ok: false,
      checkedChannels: 0,
      newMessages: 0,
      newSignals: 0,
      emailsSent: 0,
      errors: [normalized.message],
      phase: normalized.phase ?? "unknown",
      errorCode: normalized.code ?? "TELEGRAM_UNAVAILABLE",
      details: normalized.details ?? normalized.rawMessage ?? null,
      hints: normalized.hints ?? []
    });
  }
});
telegramRouter.get("/messages/recent", async (req, res) => {
  try {
    const limit = Number(req.query.limit ?? 30);
    const symbol = typeof req.query.symbol === "string" ? req.query.symbol : void 0;
    const messageType = typeof req.query.messageType === "string" ? req.query.messageType : void 0;
    const direction = typeof req.query.direction === "string" ? req.query.direction : void 0;
    console.log("[Telegram] /api/telegram/messages/recent request received", {
      phase: "frontend_request",
      operation: "recent_messages",
      limit: Number.isFinite(limit) ? limit : 30,
      symbol: symbol ?? null,
      messageType: messageType ?? null,
      direction: direction ?? null
    });
    const messages = await getRecentTelegramMessages({
      limit: Number.isFinite(limit) ? limit : 30,
      symbol,
      messageType,
      direction
    });
    console.log("[Telegram] Returning messages to UI...", {
      phase: "frontend_response",
      operation: "recent_messages",
      returned: messages.length
    });
    console.log(`[Telegram] UI payload size: ${messages.length}`);
    return res.json(messages);
  } catch (error) {
    const normalized = normalizeTelegramRouteError(error);
    console.error("[Telegram] Recent messages request failed:", {
      phase: normalized.phase ?? "frontend_response",
      operation: "recent_messages",
      message: normalized.message,
      code: normalized.code ?? null,
      stack: normalized.stack ?? null
    });
    return res.status(normalized.status).json({ error: normalized.message });
  }
});
telegramRouter.post("/messages/:id/analyze", async (req, res) => {
  try {
    const result = await analyzeTelegramMessage(req.params.id);
    return res.json(result);
  } catch (error) {
    const normalized = normalizeTelegramRouteError(error);
    return res.status(normalized.status).json({ error: normalized.message });
  }
});
telegramRouter.post("/messages/:id/send-analysis", async (req, res) => {
  try {
    const result = await sendEmailForMessage(req.params.id);
    if (!result.sent) {
      return res.status(422).json({ success: false, error: result.error });
    }
    return res.json({
      success: true,
      provider: "resend",
      verdict: result.verdict,
      confidence: result.confidence,
      emailId: "emailId" in result ? result.emailId : null
    });
  } catch (error) {
    const normalized = normalizeTelegramRouteError(error);
    return res.status(normalized.status).json({ success: false, error: normalized.message });
  }
});
telegramRouter.get("/email-diagnostics", async (_req, res) => {
  const emailConfigured = isEmailConfigured();
  const mailMode = getMailMode();
  const fromEmail = getSenderEmail();
  let lastEmailSent = null;
  let lastEmailFailed = null;
  const queue = [];
  try {
    const recent = await listRecentTelegramMessages({ limit: 50 });
    for (const msg of recent) {
      const { emailStatus, emailSentAt, emailError, autoAnalysisAt } = msg;
      if (emailStatus === "sent" && emailSentAt && !lastEmailSent) {
        lastEmailSent = { at: emailSentAt, symbol: msg.symbol ?? null, emailId: null };
      }
      if (emailStatus === "failed" && !lastEmailFailed) {
        lastEmailFailed = { at: autoAnalysisAt ?? "", symbol: msg.symbol ?? null, error: emailError ?? null };
      }
      if (emailStatus === "pending" || emailStatus === "failed") {
        queue.push({ messageId: msg.id, symbol: msg.symbol ?? null, status: emailStatus });
      }
    }
  } catch {
  }
  return res.json({
    provider: "resend",
    emailConfigured,
    mailMode,
    fromEmail,
    resendApiKeySet: Boolean(process.env.RESEND_API_KEY),
    lastEmailSent,
    lastEmailFailed,
    queue: queue.slice(0, 10)
  });
});
telegramRouter.post("/test-email", async (_req, res) => {
  const recipient = "fo.mencuccini@gmail.com";
  if (!isEmailConfigured()) {
    return res.status(503).json({
      success: false,
      provider: "resend",
      message: "RESEND_API_KEY is not configured on this server."
    });
  }
  const from = getSenderEmail();
  if (!from) {
    return res.status(503).json({
      success: false,
      provider: "resend",
      message: "RESEND_FROM_EMAIL is not configured."
    });
  }
  console.log("[telegram] Sending test signal email", { provider: "resend", to: recipient, stage: "sending" });
  const result = await sendMail({
    to: recipient,
    subject: "\u2705 AlphaMentals \u2014 Resend Test Email",
    html: `
      <div style="font-family:Inter,system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#070b12;color:#e5edf7;border-radius:12px;">
        <h2 style="color:#34d399;margin:0 0 12px;">\u2705 Resend connection verified</h2>
        <p style="color:#dbe4f0;">This test email confirms that AlphaMentals can deliver Telegram signal emails to <strong>${recipient}</strong> via Resend.</p>
        <p style="margin-top:16px;color:#8ea0b8;font-size:13px;">Provider: <strong>resend</strong> \xB7 From: ${from}</p>
      </div>
    `,
    text: `AlphaMentals Resend test email. Delivered to ${recipient} via Resend.`,
    fromName: "AlphaMentals",
    context: { signal: "TEST" }
  });
  if (result.ok) {
    console.log("[telegram] Test email sent", { provider: "resend", emailId: result.emailId ?? null, to: recipient, stage: "sent" });
    return res.json({
      success: true,
      provider: "resend",
      emailId: result.emailId ?? null,
      message: "Test email delivered"
    });
  }
  console.error("[telegram] Test email failed", { provider: "resend", to: recipient, stage: "failed", error: result.error });
  return res.status(500).json({
    success: false,
    provider: "resend",
    message: result.error ?? "Failed to send test email"
  });
});
var SignalAnalyzeSchema = import_zod14.z.object({
  rawText: import_zod14.z.string().min(1),
  parsedSignal: import_zod14.z.object({
    direction: import_zod14.z.string().optional(),
    orderType: import_zod14.z.string().nullable().optional(),
    entry: import_zod14.z.number().nullable().optional(),
    sl: import_zod14.z.number().nullable().optional(),
    tps: import_zod14.z.array(import_zod14.z.number()).optional()
  }).optional()
});
telegramRouter.post("/signals/analyze", async (req, res) => {
  const parsed = SignalAnalyzeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "Invalid request body.", details: parsed.error.flatten() });
  }
  try {
    const { rawText, parsedSignal } = parsed.data;
    const result = await analyzeSignalWithAI(rawText, parsedSignal);
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Signal analysis failed";
    return res.status(500).json({ ok: false, error: message });
  }
});

// backend/server/routes/cron.ts
var import_express22 = require("express");
var cronRouter = (0, import_express22.Router)();
function isAuthorizedCron3(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
  const headerSecret = req.headers["x-cron-secret"] ?? "";
  return bearer === secret || headerSecret === secret;
}
cronRouter.post("/telegram-sync", async (req, res) => {
  if (!isAuthorizedCron3(req)) {
    return res.status(401).json({ error: "Unauthorized cron request" });
  }
  const limit = typeof req.body?.limit === "number" ? Math.min(Math.max(req.body.limit, 1), 10) : 10;
  try {
    const result = await syncTelegramSignals(limit, {
      source: "cron",
      enforceRateLimit: false
    });
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Telegram cron sync failed";
    console.error("[Telegram cron] Failed:", message);
    return res.status(500).json({
      ok: false,
      checkedChannels: 0,
      newMessages: 0,
      newSignals: 0,
      emailsSent: 0,
      errors: [message]
    });
  }
});
cronRouter.post("/fundamentals-ai", async (req, res) => {
  if (!isAuthorizedCron3(req)) {
    return res.status(401).json({ error: "Unauthorized cron request" });
  }
  try {
    const scheduleStatus = canRunScheduledAiAnalysis();
    const force = req.body?.force === true;
    if (!force && !scheduleStatus.allowed) {
      return res.json({
        success: false,
        skipped: true,
        runType: "scheduled",
        timezone: "Europe/Madrid",
        reason: scheduleStatus.reason,
        currentMadridIso: scheduleStatus.currentMadridIso
      });
    }
    const result = await runAiAnalysis({ trigger: force ? "manual" : "cron", bypassCooldown: true });
    return res.json({
      success: result.ok,
      runType: force ? "manual" : "scheduled",
      timezone: result.timezone ?? "Europe/Madrid",
      symbolsAnalysed: result.symbols,
      generatedAt: result.analysis?.generatedAt ?? null,
      nextRun: result.nextRun ?? null,
      result
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Fundamentals cron AI run failed";
    console.error("[fundamentals cron] Failed:", message);
    return res.status(500).json({
      success: false,
      runType: "scheduled",
      timezone: "Europe/Madrid",
      symbolsAnalysed: [],
      error: message
    });
  }
});

// backend/server/routes/mt5.ts
var import_express23 = require("express");
var import_zod15 = require("zod");

// backend/server/services/mt5Sync.helpers.ts
function toIsoString2(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function positionKey(deal) {
  return deal.positionId || deal.order || deal.ticket;
}
function numericOrZero(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function normalizeOpenPositions(positions) {
  return positions.filter((position) => position.ticket && position.symbol).map((position) => ({
    externalTradeId: position.ticket,
    symbol: position.symbol.toUpperCase(),
    direction: position.type === "buy" ? "LONG" : "SHORT",
    volume: numericOrZero(position.volume),
    entryPrice: numericOrZero(position.openPrice),
    currentPrice: position.currentPrice ?? null,
    openTime: toIsoString2(position.openedAt),
    profit: numericOrZero(position.profit),
    rawPosition: position
  }));
}
function normalizeClosedTrades(history) {
  const grouped = /* @__PURE__ */ new Map();
  history.filter((deal) => deal.symbol && numericOrZero(deal.volume) > 0).forEach((deal) => {
    const key = positionKey(deal);
    const existing = grouped.get(key) ?? [];
    existing.push(deal);
    grouped.set(key, existing);
  });
  return Array.from(grouped.entries()).map(([key, deals]) => {
    const sorted = [...deals].sort((a, b) => {
      const aTime = new Date(a.time ?? 0).getTime();
      const bTime = new Date(b.time ?? 0).getTime();
      return aTime - bTime;
    });
    const entryDeal = sorted.find((deal) => deal.entryType === 0) ?? sorted[0];
    const exitCandidates = sorted.filter((deal) => deal.entryType === 1);
    const exitDeal = exitCandidates.at(-1) ?? null;
    if (!entryDeal || !exitDeal) return null;
    const totalProfit = sorted.reduce((sum, deal) => sum + numericOrZero(deal.profit), 0);
    const totalCommission = sorted.reduce((sum, deal) => sum + numericOrZero(deal.commission), 0);
    const totalSwap = sorted.reduce((sum, deal) => sum + numericOrZero(deal.swap), 0);
    return {
      externalTradeId: key,
      externalOrderId: entryDeal.order ?? null,
      externalPositionId: entryDeal.positionId ?? null,
      symbol: entryDeal.symbol.toUpperCase(),
      direction: entryDeal.type === "buy" ? "LONG" : "SHORT",
      volume: numericOrZero(entryDeal.volume),
      entryPrice: numericOrZero(entryDeal.price),
      closePrice: exitDeal.price ?? null,
      openTime: toIsoString2(entryDeal.time),
      closeTime: toIsoString2(exitDeal.time),
      profit: totalProfit,
      commission: totalCommission,
      swap: totalSwap,
      comment: exitDeal.comment ?? entryDeal.comment ?? null,
      rawDeals: sorted
    };
  }).filter((trade) => Boolean(trade));
}
function inferTradingSession(timestamp) {
  if (!timestamp) return "CUSTOM";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "CUSTOM";
  const hour = date.getUTCHours();
  if (hour >= 7 && hour < 12) return "LONDON";
  if (hour >= 12 && hour < 16) return "LONDON_NY_OVERLAP";
  if (hour >= 16 && hour < 21) return "NEW_YORK";
  return "ASIA";
}
function estimatePips(symbol, direction, entryPrice, closePrice) {
  if (closePrice == null || !Number.isFinite(entryPrice) || !Number.isFinite(closePrice)) return null;
  const move = direction === "LONG" ? closePrice - entryPrice : entryPrice - closePrice;
  const upper = symbol.toUpperCase();
  let pipSize;
  if (upper.endsWith("JPY")) {
    pipSize = 0.01;
  } else if (upper === "XAUUSD") {
    pipSize = 0.1;
  } else if (upper === "BTCUSD" || upper === "US30") {
    pipSize = 1;
  } else {
    pipSize = 1e-4;
  }
  return Number((move / pipSize).toFixed(2));
}
function buildTradeAnalysis(input) {
  const pnl = Number(input.profit.toFixed(2));
  const pnlPercent = input.account?.balance ? Number((pnl / input.account.balance * 100).toFixed(3)) : null;
  const pnlPips = estimatePips(input.symbol, input.direction, input.entryPrice, input.closePrice);
  const risk = input.stopLoss == null ? 0 : Math.abs(input.entryPrice - input.stopLoss);
  const reward = input.closePrice == null ? 0 : Math.abs(input.closePrice - input.entryPrice);
  const rrActual = risk > 0 ? Number((reward / risk).toFixed(2)) : null;
  const durationMinutes = input.openTime && input.closeTime ? Math.max(0, Math.round((new Date(input.closeTime).getTime() - new Date(input.openTime).getTime()) / 6e4)) : null;
  const session = inferTradingSession(input.openTime);
  let result;
  if (pnl > 0) {
    result = "win";
  } else if (pnl < 0) {
    result = "loss";
  } else {
    result = "breakeven";
  }
  const pipsLine = pnlPips == null ? "Pip distance unavailable for this instrument." : `Price moved ${pnlPips} pips.`;
  const durationLine = durationMinutes == null ? "Duration unavailable." : `Trade held for ${durationMinutes} minutes.`;
  const rrLine = rrActual == null ? "R:R unavailable \u2014 no stop loss was synced." : `Realized R:R was ${rrActual}.`;
  const sessionLine = `Session at open: ${session.replace("_", "/")}.`;
  const aiReview = [
    `MT5 trade on ${input.symbol} ${input.direction}.`,
    pipsLine,
    durationLine,
    rrLine,
    sessionLine
  ].join(" ");
  return {
    pnl,
    pnlPercent,
    pnlPips,
    rrActual,
    durationMinutes,
    session,
    result,
    aiReview
  };
}

// backend/server/services/mt5Sync.service.ts
var DEFAULT_USER_ID = process.env.DEFAULT_USER_ID ?? null;
var AUTO_SYNC_INTERVAL_MS = Number(process.env.MT5_AUTO_SYNC_INTERVAL_MS ?? 6e4);
var syncInFlight2 = null;
var lastSyncError = null;
function humanizeMt5SyncError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Can't reach database server")) {
    return "Trade journal database is unavailable. Check your Supabase/DB connection before syncing MT5 trades.";
  }
  if (message.toLowerCase().includes("connection timeout")) {
    return "MT5 connection timed out while fetching account data.";
  }
  return message;
}
function getConfiguredMt5Credentials() {
  const login = process.env.MT5_LOGIN?.trim();
  const password = process.env.MT5_PASSWORD?.trim();
  const server = process.env.MT5_SERVER?.trim();
  if (!login || !password || !server) return null;
  return {
    version: "mt5",
    login,
    password,
    server,
    accountType: process.env.MT5_ACCOUNT_TYPE?.trim() || "demo",
    passwordType: process.env.MT5_PASSWORD_TYPE?.trim() || "investor"
  };
}
async function ensureTradeImportColumns() {
  try {
    await execute(`
      ALTER TABLE trades
        ADD COLUMN IF NOT EXISTS "importSource" TEXT,
        ADD COLUMN IF NOT EXISTS "isAutoImported" BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS "externalTradeId" TEXT,
        ADD COLUMN IF NOT EXISTS "externalOrderId" TEXT,
        ADD COLUMN IF NOT EXISTS "externalPositionId" TEXT,
        ADD COLUMN IF NOT EXISTS "brokerAccountId" TEXT,
        ADD COLUMN IF NOT EXISTS "brokerAccountLogin" TEXT,
        ADD COLUMN IF NOT EXISTS "brokerServer" TEXT,
        ADD COLUMN IF NOT EXISTS "durationMinutes" INT4;
    `);
    await execute(`
      CREATE UNIQUE INDEX IF NOT EXISTS trades_user_source_external_trade_uidx
      ON trades ("userId", "importSource", "externalTradeId")
      WHERE "externalTradeId" IS NOT NULL AND "importSource" IS NOT NULL;
    `);
  } catch (err) {
    console.warn("[MT5 Sync] Could not ensure trade import columns (safe to ignore if table was pre-created by migration):", err instanceof Error ? err.message : String(err));
  }
}
function mapAccountRow(row) {
  return {
    id: String(row.id),
    userId: String(row.userId),
    brokerName: String(row.brokerName),
    accountLogin: String(row.accountLogin),
    serverName: String(row.serverName),
    accountType: String(row.accountType),
    status: String(row.status),
    lastSyncedAt: row.lastSyncedAt ? String(row.lastSyncedAt) : null,
    createdAt: String(row.createdAt)
  };
}
async function getOrCreateLinkedAccount(userId2, account, credentials) {
  const payload = {
    userId: userId2,
    brokerName: account.broker || credentials.server,
    accountLogin: account.login,
    serverName: account.server,
    accountType: credentials.accountType,
    status: "connected",
    lastSyncedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  const { data, error } = await supabase.from("mt5_connected_accounts").upsert(payload, { onConflict: "userId,accountLogin,serverName" }).select("*").single();
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to persist linked MT5 account.");
  }
  return mapAccountRow(data);
}
async function replaceOpenPositions(account, openTrades) {
  await supabase.from("mt5_open_positions").delete().eq("accountId", account.id);
  if (!openTrades.length) return;
  const rows = openTrades.map((trade) => ({
    userId: account.userId,
    accountId: account.id,
    ticket: trade.externalTradeId,
    symbol: trade.symbol,
    type: trade.direction === "LONG" ? "buy" : "sell",
    volume: trade.volume,
    openPrice: trade.entryPrice,
    currentPrice: trade.currentPrice,
    profit: trade.profit,
    openTime: trade.openTime,
    rawPayload: trade.rawPosition
  }));
  const { error } = await supabase.from("mt5_open_positions").insert(rows);
  if (error) throw new Error(error.message);
}
async function upsertMt5TradeRows(account, closedTrades) {
  if (!closedTrades.length) return;
  const rows = closedTrades.map((trade) => ({
    userId: account.userId,
    accountId: account.id,
    ticket: trade.externalTradeId,
    symbol: trade.symbol,
    type: trade.direction === "LONG" ? "buy" : "sell",
    volume: trade.volume,
    openPrice: trade.entryPrice,
    closePrice: trade.closePrice,
    openTime: trade.openTime,
    closeTime: trade.closeTime,
    profit: trade.profit,
    commission: trade.commission,
    swap: trade.swap,
    comment: trade.comment,
    rawPayload: trade.rawDeals
  }));
  const { error } = await supabase.from("mt5_trades").upsert(rows, { onConflict: "accountId,ticket" });
  if (error) throw new Error(error.message);
}
async function insertEquitySnapshot(account, snapshot) {
  const { error } = await supabase.from("mt5_equity_snapshots").insert({
    userId: account.userId,
    accountId: account.id,
    balance: snapshot.balance,
    equity: snapshot.equity,
    drawdown: snapshot.balance > 0 ? Number(((snapshot.balance - snapshot.equity) / snapshot.balance * 100).toFixed(3)) : null
  });
  if (error) throw new Error(error.message);
}
function tradeTags(symbol, status) {
  return ["MT5", "AUTO_IMPORTED", status, symbol].filter(Boolean);
}
async function upsertJournalTrade(params) {
  const isClosedTrade = "closePrice" in params.mt5Trade;
  const closePrice = isClosedTrade ? params.mt5Trade.closePrice : null;
  const closeTime = isClosedTrade ? params.mt5Trade.closeTime : null;
  const analysis = buildTradeAnalysis({
    symbol: params.mt5Trade.symbol,
    direction: params.mt5Trade.direction,
    entryPrice: params.mt5Trade.entryPrice,
    closePrice,
    profit: params.mt5Trade.profit,
    openTime: params.mt5Trade.openTime,
    closeTime,
    account: params.accountSnapshot
  });
  const existingQuery = await supabase.from("trades").select("id").eq("userId", params.account.userId).eq("importSource", "MT5").eq("externalTradeId", params.mt5Trade.externalTradeId).maybeSingle();
  const payload = {
    userId: params.account.userId,
    tradeNumber: 0,
    symbol: params.mt5Trade.symbol,
    direction: params.mt5Trade.direction,
    status: params.status,
    entryPrice: params.mt5Trade.entryPrice,
    stopLoss: params.mt5Trade.entryPrice,
    takeProfit: closePrice ?? params.mt5Trade.entryPrice,
    closePrice,
    positionSize: params.mt5Trade.volume,
    riskPercent: 0,
    rrPlanned: 0,
    rrActual: analysis.rrActual,
    pnl: analysis.pnl,
    pnlPercent: analysis.pnlPercent,
    pnlPips: analysis.pnlPips,
    session: analysis.session,
    timeframe: "MT5_AUTO",
    setupType: "MT5_SYNC",
    confluences: ["MT5_SYNC"],
    tags: tradeTags(params.mt5Trade.symbol, params.status),
    preTradeEmotion: "NEUTRAL",
    confidenceLevel: 5,
    followedPlan: null,
    isRevengeTrade: false,
    isFomo: false,
    tradePlan: "Imported automatically from linked MT5 account.",
    reasonForEntry: `MT5 auto-import from ${params.account.accountLogin}`,
    reasonForExit: params.status === "CLOSED" ? "Closed in MT5 and synced automatically." : null,
    lessonsLearned: null,
    mistakeTags: [],
    mentorNotes: `Source=MT5 | Account=${params.account.accountLogin} | Server=${params.account.serverName}`,
    // Scores are NOT fabricated on import. They stay null until the user
    // completes a post-trade review, which recomputes them deterministically.
    aiReview: analysis.aiReview,
    aiScore: null,
    setupQuality: null,
    executionScore: null,
    psychologyScore: null,
    disciplineScore: null,
    riskScore: null,
    reviewStatus: "NEEDS_REVIEW",
    screenshotUrls: [],
    checklistId: null,
    entryTime: params.mt5Trade.openTime ?? (/* @__PURE__ */ new Date()).toISOString(),
    exitTime: closeTime,
    importSource: "MT5",
    isAutoImported: true,
    externalTradeId: params.mt5Trade.externalTradeId,
    externalOrderId: params.externalOrderId ?? null,
    externalPositionId: params.externalPositionId ?? null,
    brokerAccountId: params.account.id,
    brokerAccountLogin: params.account.accountLogin,
    brokerServer: params.account.serverName,
    durationMinutes: analysis.durationMinutes
  };
  if (existingQuery.data?.id) {
    const marketUpdate = {
      status: payload.status,
      closePrice: payload.closePrice,
      pnl: payload.pnl,
      pnlPercent: payload.pnlPercent,
      pnlPips: payload.pnlPips,
      rrActual: payload.rrActual,
      exitTime: payload.exitTime,
      durationMinutes: payload.durationMinutes
    };
    const { error: error2 } = await supabase.from("trades").update(marketUpdate).eq("id", existingQuery.data.id);
    if (error2) throw new Error(error2.message);
    return "updated";
  }
  const nextTradeNumber = await supabase.from("trades").select("tradeNumber").eq("userId", params.account.userId).order("tradeNumber", { ascending: false }).limit(1).maybeSingle();
  const tradeNumber = Number(nextTradeNumber.data?.tradeNumber ?? 0) + 1;
  const { error } = await supabase.from("trades").insert({
    ...payload,
    tradeNumber
  });
  if (error) throw new Error(error.message);
  return "created";
}
async function syncJournalTrades(account, accountSnapshot, openTrades, closedTrades) {
  let created = 0;
  let updated = 0;
  for (const trade of openTrades) {
    const result = await upsertJournalTrade({
      account,
      mt5Trade: trade,
      accountSnapshot,
      status: "OPEN"
    });
    if (result === "created") created++;
    else updated++;
  }
  for (const trade of closedTrades) {
    const result = await upsertJournalTrade({
      account,
      mt5Trade: trade,
      accountSnapshot,
      status: "CLOSED",
      externalOrderId: trade.externalOrderId,
      externalPositionId: trade.externalPositionId
    });
    if (result === "created") created++;
    else updated++;
  }
  return { created, updated };
}
async function performMt5Sync(credentials) {
  const userId2 = DEFAULT_USER_ID;
  if (!userId2) throw new Error("DEFAULT_USER_ID is not configured. Set DEFAULT_USER_ID in your .env file.");
  if (!process.env.METAAPI_TOKEN) {
    throw new Error("METAAPI_TOKEN is not set. MetaApi cloud connection requires a valid token in your .env file.");
  }
  console.log(`[MT5 Sync] Starting sync for account ${credentials.login} on server ${credentials.server}`);
  await ensureTradeImportColumns();
  const result = await connectMetaTrader(credentials);
  if (!result.success) {
    const errMsg = result.error?.message ?? "MetaApi connection failed without a specific error message.";
    const errCode = result.error?.code ?? "UNKNOWN";
    console.error(`[MT5 Sync] MetaApi connection failed. code=${errCode} message=${errMsg}`);
    throw new Error(`MetaApi sync failed [${errCode}]: ${errMsg}`);
  }
  if (!result.account) throw new Error("MetaApi returned success but no account snapshot \u2014 unexpected response.");
  const linkedAccount = await getOrCreateLinkedAccount(userId2, result.account, credentials);
  const openTrades = normalizeOpenPositions(result.positions ?? []);
  const closedTrades = normalizeClosedTrades(result.history ?? []);
  console.log(`[MT5 Sync] Open positions fetched: ${openTrades.length}`);
  console.log(`[MT5 Sync] Closed trades fetched: ${closedTrades.length}`);
  await Promise.all([
    replaceOpenPositions(linkedAccount, openTrades),
    upsertMt5TradeRows(linkedAccount, closedTrades),
    insertEquitySnapshot(linkedAccount, result.account)
  ]);
  const journal = await syncJournalTrades(linkedAccount, result.account, openTrades, closedTrades);
  console.log(`[MT5 Sync] Journal entries created: ${journal.created}`);
  console.log(`[MT5 Sync] Journal entries updated: ${journal.updated}`);
  const syncTime = (/* @__PURE__ */ new Date()).toISOString();
  const { error: accountUpdateError } = await supabase.from("mt5_connected_accounts").update({ status: "connected", lastSyncedAt: syncTime }).eq("id", linkedAccount.id);
  if (accountUpdateError) {
    throw new Error(accountUpdateError.message);
  }
  const recentTrades = await getRecentTrades(5);
  console.log(`[MT5 Sync] Recent trades available: ${recentTrades.length}`);
  console.log("[MT5 Sync] Completed successfully");
  lastSyncError = null;
  return {
    success: true,
    accountId: linkedAccount.id,
    accountLogin: linkedAccount.accountLogin,
    fetchedOpenPositions: openTrades.length,
    fetchedClosedTrades: closedTrades.length,
    journalEntriesCreated: journal.created,
    journalEntriesUpdated: journal.updated,
    recentTradesAvailable: recentTrades.length,
    lastSyncTime: syncTime,
    errors: []
  };
}
async function syncMt5AccountNow() {
  const credentials = getConfiguredMt5Credentials();
  if (!credentials) {
    return {
      success: false,
      accountId: null,
      accountLogin: null,
      fetchedOpenPositions: 0,
      fetchedClosedTrades: 0,
      journalEntriesCreated: 0,
      journalEntriesUpdated: 0,
      recentTradesAvailable: 0,
      lastSyncTime: null,
      errors: ["MT5 account credentials are not configured server-side."]
    };
  }
  if (syncInFlight2) return syncInFlight2;
  syncInFlight2 = performMt5Sync(credentials).catch((error) => {
    const message = humanizeMt5SyncError(error);
    lastSyncError = message;
    void createNotification({
      title: "MT5 account sync failed",
      message,
      category: "account_sync",
      severity: "critical",
      source: "mt5_sync",
      metadata: { accountLogin: credentials.login },
      dedupeKey: "mt5-sync-failure"
    });
    return {
      success: false,
      accountId: null,
      accountLogin: credentials.login,
      fetchedOpenPositions: 0,
      fetchedClosedTrades: 0,
      journalEntriesCreated: 0,
      journalEntriesUpdated: 0,
      recentTradesAvailable: 0,
      lastSyncTime: null,
      errors: [message]
    };
  }).finally(() => {
    syncInFlight2 = null;
  });
  return syncInFlight2;
}
async function getMt5Status() {
  await ensureTradeImportColumns();
  const userId2 = DEFAULT_USER_ID;
  const credentials = getConfiguredMt5Credentials();
  const bridge = getBridgeStatus();
  const { data: accountRow } = userId2 ? await supabase.from("mt5_connected_accounts").select("*").eq("userId", userId2).order("createdAt", { ascending: false }).limit(1).maybeSingle() : { data: null };
  const account = accountRow ? mapAccountRow(accountRow) : null;
  const openTrades = account ? await supabase.from("mt5_open_positions").select("id", { count: "exact", head: true }).eq("accountId", account.id) : { count: 0 };
  const closedTrades = account ? await supabase.from("mt5_trades").select("id", { count: "exact", head: true }).eq("accountId", account.id) : { count: 0 };
  const journalTrades = userId2 ? await supabase.from("trades").select("id", { count: "exact", head: true }).eq("userId", userId2).eq("importSource", "MT5") : { count: 0 };
  return {
    apiReachable: bridge.configured && bridge.ready && Boolean(credentials),
    linkedAccountExists: Boolean(account),
    lastSyncTime: account?.lastSyncedAt ?? null,
    openTrades: openTrades.count ?? 0,
    closedTradesSynced: closedTrades.count ?? 0,
    journalTradesSynced: journalTrades.count ?? 0,
    lastError: lastSyncError,
    accountLogin: account?.accountLogin ?? credentials?.login ?? null,
    serverName: account?.serverName ?? credentials?.server ?? null
  };
}
async function getRecentTrades(limit = 5) {
  await ensureTradeImportColumns();
  const userId2 = DEFAULT_USER_ID;
  if (!userId2) return [];
  const { data, error } = await supabase.from("trades").select("*").eq("userId", userId2).eq("importSource", "MT5").order("entryTime", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((trade) => ({
    id: trade.id,
    symbol: trade.symbol,
    direction: trade.direction,
    entryPrice: trade.entryPrice,
    lotSize: trade.positionSize,
    positionSize: trade.positionSize,
    riskPercent: trade.riskPercent,
    status: trade.status,
    openTime: trade.entryTime,
    closeTime: trade.exitTime,
    pnl: trade.pnl,
    pips: trade.pnlPips,
    accountName: trade.brokerAccountLogin ? `MT5 ${trade.brokerAccountLogin}` : "MT5 account",
    accountLogin: trade.brokerAccountLogin ?? null,
    source: "MT5",
    setupType: trade.setupType
  }));
}
function scheduleAutomaticMt5Sync() {
  const credentials = getConfiguredMt5Credentials();
  if (!process.env.METAAPI_TOKEN) {
    console.warn("[MT5 Sync] METAAPI_TOKEN not set \u2014 automatic MT5 sync disabled.");
    return;
  }
  if (!DEFAULT_USER_ID) {
    console.warn("[MT5 Sync] DEFAULT_USER_ID not set \u2014 automatic MT5 sync disabled.");
    return;
  }
  if (!credentials) {
    console.warn("[MT5 Sync] MT5_LOGIN / MT5_PASSWORD / MT5_SERVER not set \u2014 automatic MT5 sync disabled.");
    return;
  }
  console.log(`[MT5 Sync] Scheduling automatic sync for account ${credentials.login} every ${AUTO_SYNC_INTERVAL_MS / 1e3}s.`);
  setImmediate(() => {
    void syncMt5AccountNow();
  });
  setInterval(() => {
    void syncMt5AccountNow();
  }, AUTO_SYNC_INTERVAL_MS);
}

// backend/server/routes/mt5.ts
var mt5Router = (0, import_express23.Router)();
var tradesRouter = (0, import_express23.Router)();
function formatMt5RouteError(error) {
  const message = error instanceof Error ? error.message : "Unexpected MT5 route error.";
  if (message.includes("Can't reach database server")) {
    return "Trade journal database is unavailable. Check your Supabase/DB connection.";
  }
  return message;
}
var recentTradesQuerySchema = import_zod15.z.object({
  limit: import_zod15.z.coerce.number().int().min(1).max(50).optional()
});
mt5Router.post("/sync", async (_req, res) => {
  try {
    const result = await syncMt5AccountNow();
    res.status(result.success ? 200 : 503).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: formatMt5RouteError(error)
    });
  }
});
var MT5_STATUS_FALLBACK = { ok: true, data: { connected: false, status: "unavailable", message: "MT5 bridge unavailable" } };
mt5Router.get("/status", async (_req, res) => {
  try {
    const raw = await getMt5Status();
    let bridgeStatus;
    if (!raw.apiReachable) bridgeStatus = "unreachable";
    else if (raw.linkedAccountExists) bridgeStatus = "connected";
    else bridgeStatus = "no_account";
    res.json({
      ok: true,
      data: {
        connected: raw.apiReachable && raw.linkedAccountExists,
        status: bridgeStatus,
        message: raw.lastError ?? (raw.apiReachable ? "MT5 bridge reachable" : "MT5 bridge unreachable"),
        accountLogin: raw.accountLogin,
        serverName: raw.serverName,
        lastSyncTime: raw.lastSyncTime,
        openTrades: raw.openTrades
      }
    });
  } catch (error) {
    console.error("[mt5/status]", formatMt5RouteError(error));
    res.json(MT5_STATUS_FALLBACK);
  }
});
tradesRouter.get("/recent", async (req, res) => {
  const parsed = recentTradesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "Invalid recent trades query.", details: parsed.error.flatten() });
    return;
  }
  try {
    const trades = await getRecentTrades(parsed.data.limit ?? 5);
    res.json({ ok: true, data: trades });
  } catch (error) {
    console.error("[trades/recent]", formatMt5RouteError(error));
    res.json({ ok: true, data: [] });
  }
});

// backend/server/routes/tradesExecution.ts
var import_express24 = require("express");
var import_zod16 = require("zod");

// backend/server/services/tradeExecution.service.ts
var import_node_crypto4 = require("node:crypto");

// src/lib/tradeExecutionRules.ts
var DEFAULT_EXECUTION_SETTINGS = {
  liveExecutionEnabled: false,
  paperMode: true,
  maxRiskPercent: Number(process.env.TRADING_RISK_PERCENT ?? 1),
  maxPositions: 5,
  blockNewsMinutes: Number(process.env.TRADING_BLOCK_NEWS_MINUTES ?? 30),
  duplicateWindowMinutes: Number(process.env.TRADING_DUPLICATE_WINDOW_MINUTES ?? 180),
  minRR: Number(process.env.TRADING_MIN_RR ?? 2)
};
function validateTradeExecutionPlan(_plan, _settings) {
  return {
    allowed: false,
    blockers: ["Live execution disabled"],
    blockingReasons: ["Live execution disabled"],
    warnings: [],
    overrideableWarnings: [],
    tradeHealthScore: 0,
    rr: null,
    riskPercent: null,
    risk: { finalLotSize: 0.01 }
  };
}

// backend/server/services/tradeExecution.service.ts
var completedResponses = /* @__PURE__ */ new Map();
function isLiveExecutionEnabled(plan) {
  return Boolean(
    plan.settings.liveExecutionEnabled && !plan.settings.paperMode && process.env.ENABLE_METAAPI_LIVE_EXECUTION === "true"
  );
}
function toMetaApiActionType(plan) {
  if (plan.orderType === "buy_limit") return "ORDER_TYPE_BUY_LIMIT";
  if (plan.orderType === "sell_limit") return "ORDER_TYPE_SELL_LIMIT";
  if (plan.orderType === "buy_stop") return "ORDER_TYPE_BUY_STOP";
  if (plan.orderType === "sell_stop") return "ORDER_TYPE_SELL_STOP";
  return plan.direction === "LONG" ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL";
}
async function findExistingByIdempotency(userId2, key) {
  if (completedResponses.has(key)) return completedResponses.get(key);
  const { data } = await supabase.from("trade_accountability_logs").select("*").eq("user_id", userId2).eq("idempotency_key", key).maybeSingle();
  if (!data) return null;
  const response = data.response_payload ?? null;
  if (response) completedResponses.set(key, response);
  return response;
}
async function writeAccountabilityLog(params) {
  const id = (0, import_node_crypto4.randomUUID)();
  const { plan, validation } = params;
  const payload = {
    id,
    user_id: plan.userId,
    account_id: plan.account?.id ?? null,
    idempotency_key: plan.idempotencyKey,
    symbol: plan.symbol,
    direction: plan.direction,
    requested_risk_percent: plan.riskPercent,
    setup_grade: plan.setupGrade || null,
    trade_health_score: validation.tradeHealthScore,
    final_status: params.status,
    blocking_reasons: validation.blockingReasons,
    warnings: [...validation.warnings, ...validation.overrideableWarnings],
    override_requested: Boolean(plan.override?.requested),
    override_reason: plan.override?.reason ?? null,
    execution_attempted: params.executionAttempted,
    metaapi_response: params.metaApiResponse ?? null,
    journal_id: params.journalId ?? null,
    plan_payload: plan,
    validation_payload: validation,
    response_payload: params.response ?? null,
    created_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  const { data, error } = await supabase.from("trade_accountability_logs").insert(payload).select("id").single();
  if (error) {
    console.error("[trade-execution] Failed to write accountability log:", error.message);
    return id;
  }
  return data?.id ?? id;
}
async function updateAccountabilityResponse(id, response) {
  if (!id) return;
  const { error } = await supabase.from("trade_accountability_logs").update({ response_payload: response }).eq("id", id);
  if (error) console.error("[trade-execution] Failed to update accountability response:", error.message);
}
async function executeAccountableTrade(plan) {
  const existing = await findExistingByIdempotency(plan.userId, plan.idempotencyKey);
  if (existing) return existing;
  const runtimePlan = {
    ...plan,
    settings: { ...DEFAULT_EXECUTION_SETTINGS, ...plan.settings }
  };
  if (runtimePlan.account?.metaApiAccountId) {
    try {
      const metaStatus = await getMetaApiAccountRuntimeStatus(runtimePlan.account.metaApiAccountId);
      runtimePlan.marketGate = {
        ...runtimePlan.marketGate,
        isMetaApiConnected: runtimePlan.marketGate.isMetaApiConnected && metaStatus.connected,
        isBrokerHealthy: runtimePlan.marketGate.isBrokerHealthy && metaStatus.connected && metaStatus.tradeAllowed !== false
      };
      if (metaStatus.accountInfo) {
        runtimePlan.account = {
          ...runtimePlan.account,
          balance: metaStatus.accountInfo.balance,
          equity: metaStatus.accountInfo.equity,
          currency: metaStatus.accountInfo.currency,
          status: metaStatus.connected ? "connected" : "disconnected"
        };
      }
    } catch (error) {
      console.error("[trade-execution] MetaApi runtime check failed:", error instanceof Error ? error.message : String(error));
      runtimePlan.marketGate = {
        ...runtimePlan.marketGate,
        isMetaApiConnected: false,
        isBrokerHealthy: false
      };
    }
  }
  const validation = validateTradeExecutionPlan(runtimePlan);
  if (!validation.allowed) {
    const response2 = {
      success: false,
      allowed: false,
      status: "BLOCKED",
      blockingReasons: validation.blockingReasons,
      warnings: [...validation.warnings, ...validation.overrideableWarnings],
      validation,
      message: "Trade blocked by AlphaMentals accountability rules."
    };
    const logId2 = await writeAccountabilityLog({
      plan: runtimePlan,
      validation,
      status: "BLOCKED",
      executionAttempted: false,
      response: response2
    });
    response2.accountabilityLogId = logId2;
    await updateAccountabilityResponse(logId2, response2);
    completedResponses.set(plan.idempotencyKey, response2);
    return response2;
  }
  const live = isLiveExecutionEnabled(runtimePlan);
  let metaApiResponse = {
    success: true,
    orderId: `paper-${(0, import_node_crypto4.randomUUID)()}`,
    message: "Paper execution recorded. Live MetaApi execution is disabled."
  };
  if (live) {
    if (!runtimePlan.account?.metaApiAccountId) {
      throw new Error("MetaApi account ID is required for live execution.");
    }
    metaApiResponse = await placeMetaApiTradeOrder({
      accountId: runtimePlan.account.metaApiAccountId,
      symbol: runtimePlan.symbol,
      actionType: toMetaApiActionType(runtimePlan),
      volume: validation.risk.finalLotSize,
      openPrice: runtimePlan.orderType === "market" ? void 0 : runtimePlan.entryPrice,
      stopLoss: runtimePlan.stopLoss,
      takeProfit: runtimePlan.takeProfit,
      comment: "AlphaMentals validated trade",
      clientId: runtimePlan.idempotencyKey
    });
  }
  if (!metaApiResponse.success) {
    const failedValidation = {
      ...validation,
      allowed: false,
      status: "BLOCKED",
      blockingReasons: [`MetaApi execution failed: ${metaApiResponse.message ?? "Unknown error"}`]
    };
    const response2 = {
      success: false,
      allowed: false,
      status: "BLOCKED",
      blockingReasons: failedValidation.blockingReasons,
      warnings: validation.warnings,
      validation: failedValidation,
      message: metaApiResponse.message ?? "MetaApi execution failed."
    };
    const logId2 = await writeAccountabilityLog({
      plan: runtimePlan,
      validation: failedValidation,
      status: "BLOCKED",
      executionAttempted: true,
      metaApiResponse,
      response: response2
    });
    response2.accountabilityLogId = logId2;
    await updateAccountabilityResponse(logId2, response2);
    completedResponses.set(plan.idempotencyKey, response2);
    return response2;
  }
  const journal = await createTrade(runtimePlan.userId, {
    symbol: runtimePlan.symbol,
    direction: runtimePlan.direction,
    entryPrice: runtimePlan.entryPrice,
    stopLoss: runtimePlan.stopLoss,
    takeProfit: runtimePlan.takeProfit,
    positionSize: validation.risk.finalLotSize,
    riskPercent: runtimePlan.riskPercent,
    session: runtimePlan.session === "New York" ? "NEW_YORK" : runtimePlan.session === "Overlap" ? "LONDON_NY_OVERLAP" : runtimePlan.session.toUpperCase(),
    timeframe: "Execution Gate",
    setupType: runtimePlan.setupName || runtimePlan.setupGrade,
    confluences: Object.entries(runtimePlan.playbookChecks).filter(([, value]) => value).map(([key]) => key),
    tags: ["AlphaMentals Execution", live ? "MetaApi Live" : "Paper Mode"],
    preTradeEmotion: "CALM",
    confidenceLevel: Math.max(1, Math.min(10, Math.round(validation.tradeHealthScore / 10))),
    tradePlan: runtimePlan.notes ?? "AlphaMentals validated trade execution.",
    reasonForEntry: `${runtimePlan.setupGrade} setup validated by AlphaMentals. Health score ${validation.tradeHealthScore}/100.`,
    entryTime: (/* @__PURE__ */ new Date()).toISOString(),
    isRevengeTrade: false,
    isFomo: false
  });
  let response = {
    success: true,
    allowed: true,
    status: "EXECUTED",
    tradeId: String(journal.id ?? ""),
    journalId: String(journal.id ?? ""),
    metaApiOrderId: metaApiResponse.orderId,
    blockingReasons: [],
    warnings: validation.warnings,
    validation,
    message: live ? "Trade executed successfully and journal entry created." : "Paper trade validated and journal entry created."
  };
  const logId = await writeAccountabilityLog({
    plan: runtimePlan,
    validation,
    status: "EXECUTED",
    executionAttempted: live,
    metaApiResponse,
    journalId: response.journalId,
    response
  });
  response = { ...response, accountabilityLogId: logId };
  await updateAccountabilityResponse(logId, response);
  completedResponses.set(plan.idempotencyKey, response);
  return response;
}

// backend/server/routes/tradesExecution.ts
var tradeExecutionRouter = (0, import_express24.Router)();
var symbolSchema = import_zod16.z.enum(["XAUUSD", "EURUSD", "GBPUSD"]);
var setupGradeSchema = import_zod16.z.enum(["A+", "A", "B", "C"]);
var executionPlanSchema = import_zod16.z.object({
  userId: import_zod16.z.string().min(1),
  idempotencyKey: import_zod16.z.string().min(8),
  account: import_zod16.z.object({
    id: import_zod16.z.string().min(1),
    name: import_zod16.z.string().min(1),
    broker: import_zod16.z.string().optional().nullable(),
    balance: import_zod16.z.number(),
    equity: import_zod16.z.number().optional().nullable(),
    currency: import_zod16.z.string().default("USD"),
    metaApiAccountId: import_zod16.z.string().optional().nullable(),
    status: import_zod16.z.enum(["connected", "disconnected", "syncing", "failed", "pending", "demo", "unavailable", "invalid_credentials"])
  }).nullable(),
  symbol: symbolSchema,
  direction: import_zod16.z.enum(["LONG", "SHORT"]),
  orderType: import_zod16.z.enum(["market", "buy_limit", "sell_limit", "buy_stop", "sell_stop"]),
  entryPrice: import_zod16.z.number(),
  stopLoss: import_zod16.z.number().nullable(),
  takeProfit: import_zod16.z.number().nullable(),
  riskPercent: import_zod16.z.number(),
  session: import_zod16.z.union([import_zod16.z.enum(["London", "New York", "Asia", "Overlap"]), import_zod16.z.literal("")]),
  marketType: import_zod16.z.union([import_zod16.z.enum(["Trend", "Range", "Consolidation", "Reversal"]), import_zod16.z.literal("")]),
  higherTimeframeBias: import_zod16.z.union([import_zod16.z.enum(["Bullish", "Bearish", "Mixed"]), import_zod16.z.literal("")]),
  liquidityContext: import_zod16.z.union([import_zod16.z.enum(["Sweep", "No sweep", "Liquidity resting", "Unknown"]), import_zod16.z.literal("")]),
  poiType: import_zod16.z.union([import_zod16.z.enum(["Demand", "Supply", "Order block", "FVG", "Support/Resistance", "Other"]), import_zod16.z.literal("")]),
  setupGrade: import_zod16.z.union([setupGradeSchema, import_zod16.z.literal("")]),
  setupName: import_zod16.z.string().optional(),
  playbookChecks: import_zod16.z.object({
    htfBiasAligned: import_zod16.z.boolean(),
    clearPoi: import_zod16.z.boolean(),
    liquiditySweep: import_zod16.z.boolean(),
    confirmationPresent: import_zod16.z.boolean(),
    cleanInvalidation: import_zod16.z.boolean(),
    minimumRrMet: import_zod16.z.boolean(),
    newsClear: import_zod16.z.boolean()
  }),
  psychology: import_zod16.z.object({
    emotionallyCalm: import_zod16.z.boolean(),
    acceptsLoss: import_zod16.z.boolean(),
    noRevengeTrade: import_zod16.z.boolean(),
    maxRiskAccepted: import_zod16.z.boolean(),
    knowsInvalidation: import_zod16.z.boolean(),
    checkedNews: import_zod16.z.boolean(),
    markedPoi: import_zod16.z.boolean(),
    markedSupply: import_zod16.z.boolean(),
    markedDemand: import_zod16.z.boolean(),
    willJournal: import_zod16.z.boolean(),
    willLeaveCharts: import_zod16.z.boolean(),
    followsTradingPlan: import_zod16.z.boolean()
  }),
  marketGate: import_zod16.z.object({
    isMarketOpen: import_zod16.z.boolean(),
    isSymbolTradable: import_zod16.z.boolean(),
    isMetaApiConnected: import_zod16.z.boolean(),
    isBrokerHealthy: import_zod16.z.boolean(),
    spread: import_zod16.z.number().optional().nullable(),
    maxSpread: import_zod16.z.number().optional().nullable(),
    checkedAt: import_zod16.z.string().optional().nullable()
  }),
  newsEvents: import_zod16.z.array(import_zod16.z.object({
    id: import_zod16.z.string(),
    currency: import_zod16.z.string(),
    eventName: import_zod16.z.string(),
    impact: import_zod16.z.enum(["low", "medium", "high"]),
    datetimeUtc: import_zod16.z.string()
  })),
  dailyRisk: import_zod16.z.object({
    riskTakenPercentToday: import_zod16.z.number().optional(),
    tradeCountToday: import_zod16.z.number().optional(),
    consecutiveLosses: import_zod16.z.number().optional(),
    dailyLossLimitHit: import_zod16.z.boolean().optional()
  }),
  settings: import_zod16.z.object({
    liveExecutionEnabled: import_zod16.z.boolean(),
    paperMode: import_zod16.z.boolean(),
    maximumRiskPerTrade: import_zod16.z.number(),
    maximumDailyRisk: import_zod16.z.number(),
    maximumTradesPerDay: import_zod16.z.number(),
    minimumRR: import_zod16.z.number(),
    psychologyMinimumReadiness: import_zod16.z.number(),
    blockHighImpactNewsWindowMinutes: import_zod16.z.number(),
    warnHighImpactNewsWindowMinutes: import_zod16.z.number(),
    overridesEnabled: import_zod16.z.boolean(),
    strictRR: import_zod16.z.boolean(),
    stopAfterConsecutiveLosses: import_zod16.z.number(),
    allowedSymbols: import_zod16.z.array(symbolSchema),
    defaultRiskByGrade: import_zod16.z.object({
      "A+": import_zod16.z.number(),
      A: import_zod16.z.number(),
      B: import_zod16.z.number(),
      C: import_zod16.z.number()
    })
  }),
  brokerSettings: import_zod16.z.object({
    minLot: import_zod16.z.number().optional(),
    lotStep: import_zod16.z.number().optional(),
    maxLot: import_zod16.z.number().nullable().optional(),
    accountCurrency: import_zod16.z.string().optional()
  }).optional(),
  override: import_zod16.z.object({
    requested: import_zod16.z.boolean(),
    reason: import_zod16.z.string().optional()
  }).optional(),
  confirmation: import_zod16.z.object({
    acceptedLiveRisk: import_zod16.z.boolean(),
    typedConfirm: import_zod16.z.string().optional()
  }).optional(),
  notes: import_zod16.z.string().optional()
});
tradeExecutionRouter.post("/execute", async (req, res) => {
  const parsed = executionPlanSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      allowed: false,
      status: "BLOCKED",
      blockingReasons: ["Invalid execution payload."],
      details: parsed.error.flatten()
    });
    return;
  }
  try {
    const result = await executeAccountableTrade(parsed.data);
    res.status(result.success ? 200 : 422).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      allowed: false,
      status: "BLOCKED",
      blockingReasons: [error instanceof Error ? error.message : "Unexpected trade execution failure."]
    });
  }
});

// backend/server/routes/mt5Bridge.ts
var import_express25 = require("express");
var import_zod17 = require("zod");

// backend/server/services/mt5Bridge.service.ts
var import_node_crypto5 = require("node:crypto");
var MT5BridgeService = class {
  isConfigured() {
    return mt5BridgeClient.isConfigured();
  }
  getConfigSummary() {
    return mt5BridgeClient.getConfigSummary();
  }
  async health() {
    return mt5BridgeClient.get("/health");
  }
  async connectAccount(payload) {
    return mt5BridgeClient.post("/accounts/connect", {
      accountId: payload.accountId ?? (0, import_node_crypto5.randomUUID)(),
      login: payload.login,
      password: payload.password ?? "",
      server: payload.server,
      terminalPath: payload.terminalPath ?? null,
      accountType: payload.accountType ?? "demo"
    });
  }
  async disconnectAccount(accountId) {
    return mt5BridgeClient.post("/accounts/disconnect", { accountId });
  }
  async getAccountStatus(accountId) {
    return mt5BridgeClient.get(`/accounts/${encodeURIComponent(accountId)}/status`);
  }
  async getAccountInfo(accountId) {
    return mt5BridgeClient.get(`/accounts/${encodeURIComponent(accountId)}/info`);
  }
  async getPositions(accountId) {
    return mt5BridgeClient.get(`/accounts/${encodeURIComponent(accountId)}/positions`);
  }
  async getOrders(accountId) {
    return mt5BridgeClient.get(`/accounts/${encodeURIComponent(accountId)}/orders`);
  }
  async getHistory(accountId) {
    return mt5BridgeClient.get(`/accounts/${encodeURIComponent(accountId)}/history`);
  }
  async getCandles(accountId, params) {
    const query2 = new URLSearchParams({
      symbol: params.symbol,
      timeframe: params.timeframe
    });
    if (params.limit != null) query2.set("limit", String(params.limit));
    return mt5BridgeClient.get(`/accounts/${encodeURIComponent(accountId)}/candles?${query2.toString()}`);
  }
  async getPrice(accountId, symbol) {
    const query2 = new URLSearchParams({ symbol });
    return mt5BridgeClient.get(`/accounts/${encodeURIComponent(accountId)}/price?${query2.toString()}`);
  }
  async executeTrade(accountId, payload) {
    return mt5BridgeClient.post(`/accounts/${encodeURIComponent(accountId)}/trade`, payload);
  }
  async closePosition(accountId, payload) {
    return mt5BridgeClient.post(`/accounts/${encodeURIComponent(accountId)}/close-position`, payload);
  }
  async closeAll(accountId, payload = {}) {
    return mt5BridgeClient.post(`/accounts/${encodeURIComponent(accountId)}/close-all`, payload);
  }
  async syncAccountSnapshot(accountId, userId2) {
    const [account, positions] = await Promise.all([
      this.getAccountInfo(accountId),
      this.getPositions(accountId)
    ]);
    if (userId2) {
      await this.persistSnapshot({ accountId, userId: userId2, account, positions });
    }
    return {
      ok: true,
      accountId,
      account,
      positions,
      persisted: Boolean(userId2),
      syncedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  async persistSnapshot(params) {
    const { accountId, userId: userId2, account, positions } = params;
    const now2 = (/* @__PURE__ */ new Date()).toISOString();
    const existingResult = await supabase.from("mt5_connected_accounts").select("id").eq("userId", userId2).eq("accountLogin", account.login).eq("serverName", account.server).maybeSingle();
    if (existingResult.error) throw new Error(existingResult.error.message);
    const dbAccountId = String(existingResult.data?.id ?? accountId);
    if (existingResult.data) {
      const updateResult = await supabase.from("mt5_connected_accounts").update({
        brokerName: account.broker || account.company || account.server,
        status: "connected",
        lastSyncedAt: now2
      }).eq("id", dbAccountId);
      if (updateResult.error) throw new Error(updateResult.error.message);
    } else {
      const insertResult = await supabase.from("mt5_connected_accounts").insert({
        id: dbAccountId,
        userId: userId2,
        brokerName: account.broker || account.company || account.server,
        accountLogin: account.login,
        serverName: account.server,
        accountType: "demo",
        status: "connected",
        lastSyncedAt: now2
      });
      if (insertResult.error) throw new Error(insertResult.error.message);
    }
    const equityResult = await supabase.from("mt5_equity_snapshots").insert({
      userId: userId2,
      accountId: dbAccountId,
      balance: account.balance,
      equity: account.equity,
      margin: account.margin,
      freeMargin: account.freeMargin,
      drawdown: account.balance > 0 ? Number(((account.balance - account.equity) / account.balance * 100).toFixed(3)) : null
    });
    if (equityResult.error) throw new Error(equityResult.error.message);
    const deleteResult = await supabase.from("mt5_open_positions").delete().eq("accountId", dbAccountId);
    if (deleteResult.error) throw new Error(deleteResult.error.message);
    if (!positions.length) return;
    const rows = positions.map((position) => ({
      id: (0, import_node_crypto5.randomUUID)(),
      userId: userId2,
      accountId: dbAccountId,
      ticket: position.ticket,
      symbol: position.symbol,
      type: position.type,
      volume: position.volume,
      openPrice: position.openPrice,
      currentPrice: position.currentPrice,
      profit: position.profit,
      openTime: position.openedAt,
      rawPayload: position,
      updatedAt: now2
    }));
    const positionsResult = await supabase.from("mt5_open_positions").insert(rows);
    if (positionsResult.error) throw new Error(positionsResult.error.message);
  }
};
var mt5BridgeService = new MT5BridgeService();

// backend/server/routes/mt5Bridge.ts
var mt5BridgeRouter = (0, import_express25.Router)();
var connectSchema = import_zod17.z.object({
  accountId: import_zod17.z.string().uuid().optional(),
  login: import_zod17.z.string().trim().min(1),
  password: import_zod17.z.string().optional(),
  server: import_zod17.z.string().trim().min(1),
  terminalPath: import_zod17.z.string().trim().min(1).optional(),
  accountType: import_zod17.z.enum(["demo", "live"]).optional()
});
var disconnectSchema = import_zod17.z.object({
  accountId: import_zod17.z.string().trim().min(1)
});
mt5BridgeRouter.get("/health", async (_req, res) => {
  if (!mt5BridgeService.isConfigured()) {
    res.status(503).json({
      ok: false,
      configured: false,
      message: "MT5 bridge is not configured. Set MT5_BRIDGE_URL and MT5_BRIDGE_API_KEY on Render."
    });
    return;
  }
  try {
    const health = await mt5BridgeService.health();
    res.json({
      ok: true,
      configured: true,
      bridge: health,
      config: mt5BridgeService.getConfigSummary()
    });
  } catch (error) {
    res.status(502).json({
      ok: false,
      configured: true,
      message: error instanceof Error ? error.message : "MT5 bridge health check failed."
    });
  }
});
mt5BridgeRouter.post("/accounts/connect", async (req, res) => {
  const parsed = connectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "Invalid connect payload.", details: parsed.error.flatten() });
    return;
  }
  try {
    const response = await mt5BridgeService.connectAccount(parsed.data);
    res.json({ ok: true, ...response });
  } catch (error) {
    res.status(502).json({ ok: false, message: error instanceof Error ? error.message : "Bridge connect failed." });
  }
});
mt5BridgeRouter.post("/accounts/disconnect", async (req, res) => {
  const parsed = disconnectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "Invalid disconnect payload.", details: parsed.error.flatten() });
    return;
  }
  try {
    const response = await mt5BridgeService.disconnectAccount(parsed.data.accountId);
    res.json({ ok: true, ...response });
  } catch (error) {
    res.status(502).json({ ok: false, message: error instanceof Error ? error.message : "Bridge disconnect failed." });
  }
});
mt5BridgeRouter.get("/accounts/:accountId/status", async (req, res) => {
  try {
    const status = await mt5BridgeService.getAccountStatus(req.params.accountId);
    res.json(status);
  } catch (error) {
    res.status(502).json({ ok: false, message: error instanceof Error ? error.message : "Bridge status lookup failed." });
  }
});
mt5BridgeRouter.get("/accounts/:accountId/info", async (req, res) => {
  try {
    const info = await mt5BridgeService.getAccountInfo(req.params.accountId);
    res.json(info);
  } catch (error) {
    res.status(502).json({ ok: false, message: error instanceof Error ? error.message : "Bridge account info lookup failed." });
  }
});
mt5BridgeRouter.get("/accounts/:accountId/positions", async (req, res) => {
  try {
    const positions = await mt5BridgeService.getPositions(req.params.accountId);
    res.json(positions);
  } catch (error) {
    res.status(502).json({ ok: false, message: error instanceof Error ? error.message : "Bridge positions lookup failed." });
  }
});
mt5BridgeRouter.post("/accounts/:accountId/sync", async (req, res) => {
  const parsed = import_zod17.z.object({
    userId: import_zod17.z.string().trim().min(1).optional()
  }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "Invalid sync payload.", details: parsed.error.flatten() });
    return;
  }
  try {
    const sync = await mt5BridgeService.syncAccountSnapshot(req.params.accountId, parsed.data.userId);
    res.json(sync);
  } catch (error) {
    res.status(502).json({ ok: false, message: error instanceof Error ? error.message : "Bridge account sync failed." });
  }
});

// src/jobs/newsFetcherJob.ts
function startNewsFetcherJob() {
}

// backend/server/services/telegramSyncScheduler.service.ts
var TELEGRAM_SYNC_INTERVAL_MS = 5 * 60 * 1e3;
var TELEGRAM_SYNC_LIMIT = 10;
var schedulerStarted = false;
var timer = null;
function computeNextRun(from = Date.now()) {
  return new Date(from + TELEGRAM_SYNC_INTERVAL_MS);
}
async function runScheduledSync(trigger) {
  try {
    console.log(`[Telegram] Automatic sync started (${trigger})`);
    const result = await syncTelegramSignals(TELEGRAM_SYNC_LIMIT, {
      source: "scheduled",
      enforceRateLimit: false
    });
    console.log("[Telegram] Automatic sync finished", result);
  } catch (error) {
    console.error("[Telegram] Automatic sync failed:", error instanceof Error ? error.message : "Unknown error");
  } finally {
    setSyncScheduleMetadata(computeNextRun());
  }
}
function startTelegramSyncScheduler() {
  if (schedulerStarted) return;
  const telegram = getTelegramEnvConfig();
  if (!telegram.configured || !telegram.targetChat) {
    console.warn("[Telegram] Automatic sync scheduler not started because Telegram is not fully configured.");
    return;
  }
  schedulerStarted = true;
  setSyncScheduleMetadata(computeNextRun());
  void runScheduledSync("startup");
  timer = setInterval(() => {
    void runScheduledSync("interval");
  }, TELEGRAM_SYNC_INTERVAL_MS);
  if (typeof timer.unref === "function") {
    timer.unref();
  }
  console.log("[Telegram] Automatic sync scheduler started (every 5 minutes)");
}

// backend/server/routes/notifications.ts
var import_express26 = require("express");
var import_zod18 = require("zod");

// backend/server/services/fundamentalEventNotifications.service.ts
var notificationLogMemory = /* @__PURE__ */ new Set();
async function sendDailyFundamentalEventsEmail(force = false) {
  const now2 = /* @__PURE__ */ new Date();
  const events = await ensureFreshEvents();
  const dateKey = localDateKey(now2);
  const todayEvents = events.filter((event) => event.date === dateKey && event.status !== "past");
  return sendFundamentalEventsEmail("daily", todayEvents, { now: now2, dateKey, force });
}
async function sendWeeklyFundamentalEventsEmail(force = false) {
  const now2 = /* @__PURE__ */ new Date();
  const events = await ensureFreshEvents();
  const week = getWeekWindow(now2, APP_EVENT_TIMEZONE);
  const weeklyEvents = events.filter((event) => event.debug.classification.isThisWeek && event.impact !== "low");
  return sendFundamentalEventsEmail("weekly", weeklyEvents, { now: now2, weekKey: week.weekKey, weekLabel: week.label, force });
}
async function sendFundamentalEventsEmail(type, events, options) {
  const userId2 = process.env.DEFAULT_USER_ID ?? "";
  const prefs = await getPreferences(userId2);
  if (!prefs.notificationsEnabled || !prefs.emailEnabled || !prefs.emailRecipient) {
    return { ok: true, sent: false, type, reason: "Email notifications are not enabled for the configured user.", eventCount: events.length, dateKey: options.dateKey, weekKey: options.weekKey };
  }
  if (!isEmailConfigured()) {
    return { ok: false, sent: false, type, reason: "Server email is not configured.", eventCount: events.length, dateKey: options.dateKey, weekKey: options.weekKey };
  }
  if (type === "daily" && !prefs.dailyFundamentalEventsEmail) {
    return { ok: true, sent: false, type, reason: "Daily fundamental events email is disabled.", eventCount: events.length, dateKey: options.dateKey };
  }
  if (type === "weekly" && !prefs.weeklyFundamentalEventsEmail) {
    return { ok: true, sent: false, type, reason: "Weekly fundamental events email is disabled.", eventCount: events.length, weekKey: options.weekKey };
  }
  if (!events.length) {
    return { ok: true, sent: false, type, reason: `No ${type === "daily" ? "today" : "this week"} fundamental events to send.`, eventCount: 0, dateKey: options.dateKey, weekKey: options.weekKey };
  }
  const dedupeKey2 = `${userId2}:${type}:${options.dateKey ?? options.weekKey ?? "none"}`;
  if (!options.force && await hasNotificationBeenSent(dedupeKey2, type, options.dateKey ?? null, options.weekKey ?? null)) {
    return { ok: true, sent: false, type, reason: `${type} email already sent for this period.`, eventCount: events.length, dateKey: options.dateKey, weekKey: options.weekKey };
  }
  const subject = type === "weekly" ? `AlphaMentals Weekly Fundamental Events \u2014 ${options.weekLabel ?? ""}` : `AlphaMentals Alert \u2014 Today's Fundamental Events`;
  const body = type === "weekly" ? buildWeeklyEmail(events, options.weekLabel ?? "", options.now) : buildDailyEmail(events, options.now);
  const result = await sendMail({
    to: prefs.emailRecipient,
    cc: prefs.emailCc ?? void 0,
    fromName: prefs.emailSenderName,
    subject,
    html: body.html,
    text: body.text
  });
  await writeNotificationLog({
    user_id: userId2,
    notification_type: type,
    event_ids: events.map((event) => event.id),
    date_key: options.dateKey ?? null,
    week_key: options.weekKey ?? null,
    subject,
    status: result.ok ? "sent" : "failed",
    error: result.ok ? null : result.error ?? "Unknown email error",
    sent_at: (/* @__PURE__ */ new Date()).toISOString()
  });
  return {
    ok: result.ok,
    sent: result.ok,
    type,
    reason: result.ok ? void 0 : result.error,
    emailId: result.ok ? result.emailId ?? null : null,
    eventCount: events.length,
    dateKey: options.dateKey,
    weekKey: options.weekKey
  };
}
async function ensureFreshEvents() {
  const events = getFundamentalsEvents();
  const lastUpcoming = events.find((event) => event.status !== "past");
  if (!lastUpcoming) {
    const overview = await refreshFundamentalsData({ triggeredBy: "cron" });
    return overview.upcomingEvents;
  }
  return events;
}
async function hasNotificationBeenSent(dedupeKey2, type, dateKey, weekKey) {
  if (notificationLogMemory.has(dedupeKey2)) return true;
  try {
    const { data } = await supabase.from("fundamental_event_notifications").select("id").eq("user_id", process.env.DEFAULT_USER_ID ?? "").eq("notification_type", type).eq(type === "daily" ? "date_key" : "week_key", type === "daily" ? dateKey : weekKey).eq("status", "sent").limit(1);
    const exists = Boolean(data && data.length > 0);
    if (exists) notificationLogMemory.add(dedupeKey2);
    return exists;
  } catch {
    return false;
  }
}
async function writeNotificationLog(row) {
  const dedupeKey2 = `${row.user_id}:${row.notification_type}:${row.date_key ?? row.week_key ?? "none"}`;
  if (row.status === "sent") notificationLogMemory.add(dedupeKey2);
  try {
    await supabase.from("fundamental_event_notifications").insert(row);
  } catch (error) {
    console.warn("[fundamental-events] Failed to persist notification log:", error instanceof Error ? error.message : String(error));
  }
}
function buildDailyEmail(events, now2) {
  const items = events.sort((a, b) => a.datetimeUtc.localeCompare(b.datetimeUtc)).map((event) => renderEventLine(event, true)).join("");
  const today = formatLocalDate(now2);
  return {
    html: `
      <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;padding:24px;color:#111827;">
        <h2 style="margin:0 0 8px;">AlphaMentals Alert \u2014 Today's Fundamental Events</h2>
        <p style="margin:0 0 20px;color:#6b7280;">Today (${today}) important events in ${APP_EVENT_TIMEZONE}.</p>
        ${items}
      </div>
    `,
    text: [
      `Today's important events (${today})`,
      "",
      ...events.sort((a, b) => a.datetimeUtc.localeCompare(b.datetimeUtc)).map((event) => renderEventText(event, true))
    ].join("\n")
  };
}
function buildWeeklyEmail(events, weekLabel, now2) {
  const grouped = groupByDate(events);
  const sections = Object.entries(grouped).map(([date, dayEvents]) => `
    <h3 style="margin:20px 0 8px;">${dayEvents[0]?.dateLabel ?? date}</h3>
    ${dayEvents.map((event) => renderEventLine(event, false)).join("")}
  `).join("");
  return {
    html: `
      <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;padding:24px;color:#111827;">
        <h2 style="margin:0 0 8px;">AlphaMentals Weekly Fundamental Events \u2014 ${weekLabel}</h2>
        <p style="margin:0 0 20px;color:#6b7280;">This week's important market events. Generated ${formatLocalDateTime(now2)} (${APP_EVENT_TIMEZONE}).</p>
        ${sections}
      </div>
    `,
    text: [
      `AlphaMentals Weekly Fundamental Events \u2014 ${weekLabel}`,
      "",
      ...Object.entries(grouped).flatMap(([date, dayEvents]) => [
        `${dayEvents[0]?.dateLabel ?? date}:`,
        ...dayEvents.map((event) => renderEventText(event, false)),
        ""
      ])
    ].join("\n")
  };
}
function renderEventLine(event, includeWatchlist) {
  const watchlist = includeWatchlist ? `<p style="margin:6px 0 0;color:#374151;"><strong>Watchlist impact:</strong> ${formatSymbols(event.affectedSymbols)}</p>` : "";
  const ai = event.aiInterpretation ? `<p style="margin:6px 0 0;color:#374151;"><strong>Potential impact:</strong> ${event.aiInterpretation}</p>` : "";
  return `
    <div style="padding:12px 0;border-top:1px solid #e5e7eb;">
      <p style="margin:0;font-weight:700;">${event.dateTimeLabel} \u2014 ${event.currency ?? "\u2014"} \u2014 ${event.eventName} \u2014 ${capitalize(event.impact)}</p>
      <p style="margin:6px 0 0;color:#4b5563;">Forecast: ${event.forecast ?? "\u2014"} \xB7 Previous: ${event.previous ?? "\u2014"} \xB7 Actual: ${event.actual ?? "\u2014"}</p>
      ${watchlist}
      ${ai}
    </div>
  `;
}
function renderEventText(event, includeWatchlist) {
  return [
    `- ${event.dateTimeLabel} \u2014 ${event.currency ?? "\u2014"} \u2014 ${event.eventName} \u2014 ${capitalize(event.impact)}`,
    `  Forecast: ${event.forecast ?? "\u2014"}`,
    `  Previous: ${event.previous ?? "\u2014"}`,
    `  Actual: ${event.actual ?? "\u2014"}`,
    includeWatchlist ? `  Watchlist impact: ${formatSymbols(event.affectedSymbols)}` : null,
    event.aiInterpretation ? `  Potential impact: ${event.aiInterpretation}` : null
  ].filter(Boolean).join("\n");
}
function groupByDate(events) {
  return events.reduce((acc, event) => {
    if (!acc[event.date]) acc[event.date] = [];
    acc[event.date].push(event);
    return acc;
  }, {});
}
function formatSymbols(symbols) {
  if (!symbols.length) return "XAUUSD, EURUSD, GBPUSD";
  return symbols.map((symbol) => symbol.replace("/", "")).join(", ");
}
function localDateKey(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_EVENT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  const day = parts.find((part) => part.type === "day")?.value ?? "00";
  return `${year}-${month}-${day}`;
}
function formatLocalDate(date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_EVENT_TIMEZONE,
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
}
function formatLocalDateTime(date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_EVENT_TIMEZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}
function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// backend/server/routes/notifications.ts
var notificationsRouter = (0, import_express26.Router)();
function userId() {
  return process.env.DEFAULT_USER_ID ?? "";
}
var SEVERITIES = ["info", "warning", "critical"];
var PreferencesSchema = import_zod18.z.object({
  notificationsEnabled: import_zod18.z.boolean().optional(),
  emailEnabled: import_zod18.z.boolean().optional(),
  dailyFundamentalEventsEmail: import_zod18.z.boolean().optional(),
  weeklyFundamentalEventsEmail: import_zod18.z.boolean().optional(),
  emailRecipient: import_zod18.z.string().email().nullable().or(import_zod18.z.literal("")).optional(),
  emailCc: import_zod18.z.string().email().nullable().or(import_zod18.z.literal("")).optional(),
  emailSenderName: import_zod18.z.string().max(120).optional(),
  emailFrequency: import_zod18.z.enum(["instant", "daily", "weekly"]).optional(),
  emailMinSeverity: import_zod18.z.enum(SEVERITIES).optional(),
  enabledEmailCategories: import_zod18.z.array(import_zod18.z.string()).optional(),
  webhookEnabled: import_zod18.z.boolean().optional(),
  webhookUrl: import_zod18.z.string().url().nullable().or(import_zod18.z.literal("")).optional(),
  webhookSecret: import_zod18.z.string().max(500).nullable().or(import_zod18.z.literal("")).optional(),
  enabledWebhookCategories: import_zod18.z.array(import_zod18.z.string()).optional()
});
notificationsRouter.get("/config", (_req, res) => {
  const mode = getMailMode();
  res.json({
    emailConfigured: isEmailConfigured(),
    mailMode: mode,
    emailProvider: "resend",
    resendConfigured: mode === "resend",
    fromEmailConfigured: Boolean(process.env.RESEND_FROM_EMAIL),
    categories: NOTIFICATION_CATEGORIES
  });
});
notificationsRouter.get("/preferences", async (_req, res) => {
  try {
    res.json(await getPreferences(userId()));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load preferences" });
  }
});
async function handleSavePreferences(req, res) {
  try {
    const parsed = PreferencesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid preferences", details: parsed.error.flatten() });
      return;
    }
    const patch = Object.fromEntries(
      Object.entries(parsed.data).map(([k, v]) => [k, v === "" ? null : v])
    );
    res.json(await savePreferences(userId(), patch));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to save preferences" });
  }
}
notificationsRouter.put("/preferences", handleSavePreferences);
notificationsRouter.post("/preferences", handleSavePreferences);
notificationsRouter.get("/history", async (req, res) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    res.json(await listNotifications(userId(), limit));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load history" });
  }
});
notificationsRouter.post("/mark-read", async (req, res) => {
  try {
    const id = req.body.id;
    if (!id) {
      res.status(400).json({ error: "id is required" });
      return;
    }
    await markRead(userId(), id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed" });
  }
});
notificationsRouter.post("/mark-all-read", async (_req, res) => {
  try {
    await markAllRead(userId());
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed" });
  }
});
notificationsRouter.post("/clear-history", async (_req, res) => {
  try {
    await clearHistory(userId());
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed" });
  }
});
notificationsRouter.post("/test-email", async (req, res) => {
  const recipient = req.body.recipient;
  const result = await sendTestEmail(userId(), recipient);
  res.status(result.success ? 200 : 400).json(result);
});
notificationsRouter.post("/test-webhook", async (req, res) => {
  const { url, secret } = req.body;
  const result = await sendTestWebhook(userId(), url, secret);
  res.status(result.success ? 200 : 400).json(result);
});
notificationsRouter.post("/fundamental-events/send-daily", async (req, res) => {
  try {
    const result = await sendDailyFundamentalEventsEmail(Boolean(req.body?.force));
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to send daily fundamental events email" });
  }
});
notificationsRouter.post("/fundamental-events/send-weekly", async (req, res) => {
  try {
    const result = await sendWeeklyFundamentalEventsEmail(Boolean(req.body?.force));
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to send weekly fundamental events email" });
  }
});
notificationsRouter.post("/", async (req, res) => {
  try {
    const result = await createNotification({ ...req.body, userId: userId() });
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed" });
  }
});

// backend/server/routes/diagnostics.ts
var import_express27 = require("express");
var diagnosticsRouter = (0, import_express27.Router)();
diagnosticsRouter.get("/", (_req, res) => {
  const ai = getDiagnostics();
  const cache = stats();
  res.json({
    timestamp: Date.now(),
    ai,
    cache: {
      entries: cache.size,
      keys: cache.keys.filter((k) => k.startsWith("pair-intel-ai:"))
    },
    marketData: {
      provider: "mt5-bridge",
      quoteTtlSeconds: 15,
      candleTtlSeconds: { intraday: 0, daily: 0 }
    }
  });
});
diagnosticsRouter.post("/clear-cooldown", (_req, res) => {
  clearCooldown();
  res.json({ success: true, message: "AI cooldown cleared" });
});

// backend/server/routes/debug.ts
var import_express28 = require("express");
var debugRouter = (0, import_express28.Router)();
debugRouter.get("/openai", (_req, res) => {
  logOpenAIConfiguration();
  res.json({
    openaiKeyConfigured: isOpenAIConfigured(),
    model: getOpenAIModel(),
    pairAiTimeoutMs: getPairAiTimeoutMs()
  });
});
debugRouter.get("/pair-ai/:symbol", async (req, res) => {
  try {
    const snapshot = await getPairAiDebugSnapshot(req.params.symbol, { forceRefresh: false });
    res.json(snapshot);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to build pair AI debug snapshot.",
      openaiKeyConfigured: isOpenAIConfigured(),
      model: getOpenAIModel(),
      pairAiTimeoutMs: getPairAiTimeoutMs(),
      symbol: req.params.symbol
    });
  }
});
debugRouter.get("/env", (_req, res) => {
  const diagnostics = getBridgeConfigDiagnostics();
  res.json({
    mt5BridgeUrlPresent: diagnostics.mt5BridgeUrlConfigured,
    mt5BridgeApiKeyPresent: diagnostics.mt5BridgeApiKeyConfigured,
    mt5BridgeUrl: diagnostics.mt5BridgeUrl
  });
});
debugRouter.get("/mt5-env", (_req, res) => {
  const diagnostics = getBridgeConfigDiagnostics();
  res.json({
    mt5BridgeUrlPresent: diagnostics.mt5BridgeUrlConfigured,
    mt5BridgeApiKeyPresent: diagnostics.mt5BridgeApiKeyConfigured,
    mt5BridgeUrl: diagnostics.mt5BridgeUrl
  });
});
debugRouter.get("/mt5-quotes", async (req, res) => {
  const symbolsParam = typeof req.query.symbols === "string" && req.query.symbols.trim() ? req.query.symbols : "XAUUSD,EURUSD,GBPUSD";
  const symbols = symbolsParam.split(",").map((symbol) => symbol.trim()).filter(Boolean);
  const result = await debugMt5BridgeQuotes(symbols);
  res.status(result.ok ? 200 : 502).json(result);
});
debugRouter.get("/market-provider", (_req, res) => {
  const diagnostics = getBridgeConfigDiagnostics();
  res.json({
    provider: "mt5-bridge",
    liveQuotes: {
      provider: "mt5-bridge",
      fallbackEnabled: false,
      twelvedataEnabled: diagnostics.enableTwelveDataQuotes,
      twelvedataUsedForLiveQuotes: false
    },
    bridge: {
      mt5BridgeUrlPresent: diagnostics.mt5BridgeUrlConfigured,
      mt5BridgeApiKeyPresent: diagnostics.mt5BridgeApiKeyConfigured,
      mt5BridgeUrl: diagnostics.mt5BridgeUrl,
      symbolMap: diagnostics.bridgeSymbolMap
    },
    candles: {
      provider: "unavailable",
      message: "Candle and technical routes no longer fall back to TwelveData or Yahoo."
    },
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
});
debugRouter.get("/mt5-bridge-health", async (_req, res) => {
  const bridgeUrl = process.env.MT5_BRIDGE_URL?.replace(/\/$/, "") ?? "";
  const apiKey = process.env.MT5_BRIDGE_API_KEY ?? "";
  const diagnostics = getBridgeConfigDiagnostics();
  if (!bridgeUrl || !apiKey) {
    res.status(503).json({
      ok: false,
      mt5BridgeUrlPresent: diagnostics.mt5BridgeUrlConfigured,
      mt5BridgeApiKeyPresent: diagnostics.mt5BridgeApiKeyConfigured,
      mt5BridgeUrl: diagnostics.mt5BridgeUrl,
      message: "MT5 bridge is not configured. Set MT5_BRIDGE_URL and MT5_BRIDGE_API_KEY."
    });
    return;
  }
  try {
    const endpoint = `${bridgeUrl}/health`;
    const response = await fetch(endpoint, {
      method: "GET",
      cache: "no-store",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json"
      }
    });
    const bodyText = await response.text();
    let body = bodyText;
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = bodyText;
    }
    res.status(response.ok ? 200 : 502).json({
      ok: response.ok,
      mt5BridgeUrlPresent: diagnostics.mt5BridgeUrlConfigured,
      mt5BridgeApiKeyPresent: diagnostics.mt5BridgeApiKeyConfigured,
      mt5BridgeUrl: diagnostics.mt5BridgeUrl,
      status: response.status,
      body
    });
  } catch (error) {
    res.status(502).json({
      ok: false,
      mt5BridgeUrlPresent: diagnostics.mt5BridgeUrlConfigured,
      mt5BridgeApiKeyPresent: diagnostics.mt5BridgeApiKeyConfigured,
      mt5BridgeUrl: diagnostics.mt5BridgeUrl,
      message: error instanceof Error ? error.message : "Failed to reach MT5 bridge health endpoint."
    });
  }
});

// backend/server/routes/aiAnalysis.ts
var import_express29 = require("express");
var aiAnalysisRouter = (0, import_express29.Router)();
function isAuthorizedCron4(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const headerSecret = req.headers["x-cron-secret"];
  return bearer === secret || headerSecret === secret;
}
aiAnalysisRouter.get("/latest", async (_req, res) => {
  try {
    const latest = await getLatestAiAnalysisResponse();
    res.json(latest);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load latest AI analysis";
    res.status(500).json({ error: message });
  }
});
aiAnalysisRouter.get("/status", (_req, res) => {
  res.json(getRunJobStatus());
});
aiAnalysisRouter.post("/run", async (_req, res) => {
  try {
    const startedAt = (/* @__PURE__ */ new Date()).toISOString();
    const { status, latestAvailable, generatedAt } = getRunJobStatus();
    if (status === "running") {
      res.json({ ok: true, status: "running", startedAt, latestAvailable, generatedAt, message: "Analysis already running." });
      return;
    }
    runAiAnalysis({ trigger: "manual" }).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[ai-analysis] background run failed:", msg);
    });
    res.json({ ok: true, status: "queued", startedAt, latestAvailable, generatedAt, message: "Analysis started. Poll /api/ai-analysis/latest for results." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start AI analysis";
    res.status(500).json({ error: message });
  }
});
aiAnalysisRouter.post("/cron", async (req, res) => {
  if (!isAuthorizedCron4(req)) {
    return res.status(401).json({ error: "Unauthorized cron request" });
  }
  const scheduleStatus = canRunScheduledAiAnalysis();
  if (!scheduleStatus.allowed) {
    return res.json({
      skipped: true,
      reason: scheduleStatus.reason,
      timezone: "Europe/Madrid",
      currentMadridIso: scheduleStatus.currentMadridIso
    });
  }
  try {
    const result = await runAiAnalysis({ trigger: "cron", bypassCooldown: true });
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run scheduled AI analysis";
    res.status(500).json({ error: message });
  }
});

// backend/server/routes/cost.ts
var import_express30 = require("express");
var costRouter = (0, import_express30.Router)();
function parseRange(raw) {
  if (raw === "today" || raw === "7d" || raw === "30d" || raw === "month") return raw;
  return "month";
}
function daysInCurrentMonth() {
  const now2 = /* @__PURE__ */ new Date();
  return new Date(now2.getFullYear(), now2.getMonth() + 1, 0).getDate();
}
costRouter.get("/summary", async (req, res) => {
  try {
    const range = parseRange(req.query.range);
    const [openaiAgg, anthropicAgg] = await Promise.all([
      aggregateCosts("openai", range),
      aggregateCosts("anthropic", range)
    ]);
    const ai = {
      totalRequests: openaiAgg.totalRequests + anthropicAgg.totalRequests,
      totalTokens: openaiAgg.totalTokens + anthropicAgg.totalTokens,
      promptTokens: openaiAgg.promptTokens + anthropicAgg.promptTokens,
      completionTokens: openaiAgg.completionTokens + anthropicAgg.completionTokens,
      costUsd: openaiAgg.costUsd + anthropicAgg.costUsd,
      byModel: [...openaiAgg.byModel, ...anthropicAgg.byModel].sort((a, b) => b.costUsd - a.costUsd),
      byFeature: mergeByKey([...openaiAgg.byFeature, ...anthropicAgg.byFeature], "feature")
    };
    const metaApiMonthly = getMonthlyFixedCost("METAAPI_MONTHLY_COST_USD");
    const tdMonthly = getMonthlyFixedCost("TWELVE_DATA_MONTHLY_COST_USD");
    const resendMonthly = getMonthlyFixedCost("RESEND_MONTHLY_COST_USD");
    const days = daysInCurrentMonth();
    const tdCounters = getTwelveDataCounters();
    const resendCounters = getResendCounters();
    const metaApiCounters = getMetaApiCounters();
    const metaApiCost = metaApiMonthly ?? 0;
    const tdCost = tdMonthly ?? 0;
    const resendCost = resendMonthly ?? 0;
    res.json({
      ok: true,
      range,
      totals: {
        aiCostUsd: ai.costUsd,
        metaApiCostUsd: metaApiCost,
        marketDataCostUsd: tdCost,
        emailCostUsd: resendCost,
        totalCostUsd: ai.costUsd + metaApiCost + tdCost + resendCost
      },
      ai,
      metaApi: {
        planName: process.env.METAAPI_PLAN_NAME ?? null,
        monthlyCostUsd: metaApiMonthly,
        dailyEstimateUsd: metaApiMonthly != null ? parseFloat((metaApiMonthly / days).toFixed(4)) : null,
        weeklyEstimateUsd: metaApiMonthly != null ? parseFloat((metaApiMonthly / 4.345).toFixed(4)) : null,
        syncCount: metaApiCounters.requestCount,
        failedSyncCount: metaApiCounters.failedCount,
        lastSyncAt: metaApiCounters.lastActivityAt,
        configured: metaApiMonthly != null
      },
      marketData: {
        provider: "twelvedata",
        planName: process.env.TWELVE_DATA_PLAN_NAME ?? null,
        monthlyCostUsd: tdMonthly,
        requestCount: tdCounters.requestCount,
        symbolCounts: tdCounters.symbolCounts,
        lastActivityAt: tdCounters.lastActivityAt,
        configured: tdMonthly != null
      },
      email: {
        provider: "resend",
        planName: process.env.RESEND_PLAN_NAME ?? null,
        emailsSent: resendCounters.requestCount,
        failedEmails: resendCounters.failedCount,
        lastEmailAt: resendCounters.lastActivityAt,
        monthlyCostUsd: resendMonthly,
        configured: resendMonthly != null
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[cost/summary]", message);
    res.status(500).json({ ok: false, error: message });
  }
});
costRouter.get("/ledger", async (req, res) => {
  try {
    const range = parseRange(req.query.range);
    const provider = typeof req.query.provider === "string" ? req.query.provider : "all";
    const feature = typeof req.query.feature === "string" ? req.query.feature : "all";
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);
    const { rows, total } = await queryLedger({ range, provider, feature, limit, offset });
    res.json({ ok: true, range, total, limit, offset, rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[cost/ledger]", message);
    res.status(500).json({ ok: false, error: message });
  }
});
costRouter.post("/recalculate", async (_req, res) => {
  res.json({ ok: true, message: "Recalculation not yet implemented. Costs are calculated at write time." });
});
function mergeByKey(items, _key) {
  const map = /* @__PURE__ */ new Map();
  for (const item of items) {
    const existing = map.get(item.feature) ?? { costUsd: 0, requests: 0, tokens: 0 };
    existing.costUsd += item.costUsd;
    existing.requests += item.requests;
    existing.tokens += item.tokens;
    map.set(item.feature, existing);
  }
  return Array.from(map.entries()).map(([feature, v]) => ({ feature, ...v })).sort((a, b) => b.costUsd - a.costUsd);
}

// backend/server/routes/marketIntelligence.ts
var import_express31 = require("express");
var marketIntelligenceRouter = (0, import_express31.Router)();
function mapPreviewItem(symbol, analysis) {
  return {
    id: analysis.id ?? `saved-${symbol}`,
    analysisRunId: analysis.analysisRunId ?? null,
    symbol,
    displaySymbol: normalizeDisplaySymbol(symbol),
    action: analysis.tradeMode === "favor_buys" || analysis.tradeMode === "favor_sells" ? "trade_allowed" : analysis.tradeMode,
    tradeStatus: analysis.tradeMode === "avoid" ? "avoid" : analysis.tradeMode === "wait" ? "wait" : "safe",
    bias: analysis.bias,
    confidence: analysis.confidence,
    impact: analysis.calendarRisk,
    reason: analysis.summary,
    summary: analysis.summary,
    keyDrivers: analysis.macroDrivers,
    tradeMode: analysis.tradeMode,
    calendarRisk: analysis.calendarRisk,
    decisionSummary: analysis.decisionSummary,
    fundamentalSummary: analysis.fundamentalSummary,
    macroDrivers: analysis.macroDrivers,
    watchEvents: analysis.watchEvents,
    keyRisks: analysis.keyRisks,
    relatedArticleIds: [],
    relatedEventIds: [],
    macroFundamentals: analysis.macroFundamentals,
    calendarImpact: analysis.economicCalendarImpact,
    topRisks: analysis.keyRisks,
    relatedEvents: analysis.watchEvents,
    relatedNews: analysis.macroDrivers,
    drivers: analysis.macroDrivers,
    generatedAt: analysis.generatedAt,
    sourceDataWindow: analysis.sourceDataTimestamp,
    model: analysis.model,
    aiCost: null,
    createdAt: analysis.generatedAt,
    updatedAt: analysis.generatedAt
  };
}
function filterEventsForSymbol(symbol) {
  const display = normalizeDisplaySymbol(symbol);
  return getFundamentalsEvents().filter((event) => event.affectedSymbols.includes(display)).slice(0, 20);
}
function filterNewsForSymbol(symbol) {
  const display = normalizeDisplaySymbol(symbol);
  return getFundamentalsNews().filter((article) => article.affectedSymbols.includes(display)).slice(0, 20);
}
marketIntelligenceRouter.get("/news", async (_req, res) => {
  try {
    await bootstrapFundamentals();
    res.json({
      items: getFundamentalsNews(),
      lastUpdated: getFundamentalsOverview().lastUpdated
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to load market intelligence news" });
  }
});
marketIntelligenceRouter.get("/events", async (_req, res) => {
  try {
    await bootstrapFundamentals();
    const overview = getFundamentalsOverview();
    res.json({
      items: getFundamentalsEvents(),
      upcoming: overview.upcomingEvents,
      next4Hours: overview.highImpactNext4Hours,
      lastUpdated: overview.lastUpdated,
      timezone: "Europe/Madrid"
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to load market intelligence events" });
  }
});
marketIntelligenceRouter.get("/fundamentals", async (_req, res) => {
  try {
    await bootstrapFundamentals();
    const overview = getFundamentalsOverview();
    const latestAi = await getLatestAiAnalysisResponse();
    const pairs = latestAi.analysis ? Object.entries(latestAi.analysis.symbols).map(([symbol, analysis]) => mapPreviewItem(symbol, analysis)) : [];
    res.json({
      pairs,
      items: pairs,
      latestNews: overview.latestNews ?? [],
      upcomingEvents: overview.upcomingEvents ?? [],
      highImpactNext4Hours: overview.highImpactNext4Hours ?? [],
      sourceStatus: overview.sourceStatus ?? [],
      sources: overview.sourceStatus ?? [],
      diagnostics: {
        ...overview.aiDiagnostics,
        ...overview.scheduleMetadata,
        analysisRunId: pairs[0]?.analysisRunId ?? null
      },
      generatedAt: latestAi.generatedAt,
      generatedTimezone: latestAi.generatedTimezone,
      triggerSource: latestAi.triggerSource,
      nextScheduledRun: latestAi.nextScheduledRun,
      nextRun: latestAi.nextScheduledRun,
      status: latestAi.status,
      lastUpdated: overview.lastUpdated ?? null,
      timezone: "Europe/Madrid"
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load market intelligence fundamentals",
      pairs: [],
      latestNews: [],
      upcomingEvents: [],
      highImpactNext4Hours: [],
      sourceStatus: [],
      sources: [],
      lastUpdated: null,
      nextRun: null,
      timezone: "Europe/Madrid"
    });
  }
});
marketIntelligenceRouter.get("/fundamentals/:symbol", async (req, res) => {
  try {
    await bootstrapFundamentals();
    const symbol = normalizeApiSymbol(req.params.symbol);
    const latestAi = await getLatestAiAnalysisForSymbolResponse(symbol);
    res.json({
      symbol,
      displaySymbol: normalizeDisplaySymbol(symbol),
      analysisRunId: latestAi.analysis?.analysisRunId ?? null,
      analysis: latestAi.analysis ? mapPreviewItem(symbol, latestAi.analysis) : null,
      latestBias: latestAi.analysis ? mapPreviewItem(symbol, latestAi.analysis) : null,
      biasHistory: latestAi.analysis ? [mapPreviewItem(symbol, latestAi.analysis)] : [],
      relatedArticles: filterNewsForSymbol(symbol),
      relatedEvents: filterEventsForSymbol(symbol),
      generatedAt: latestAi.generatedAt,
      generatedTimezone: latestAi.generatedTimezone,
      triggerSource: latestAi.triggerSource,
      nextScheduledRun: latestAi.nextScheduledRun,
      status: latestAi.status,
      isStale: latestAi.isStale,
      timezone: "Europe/Madrid"
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to load pair fundamentals" });
  }
});
marketIntelligenceRouter.post("/refresh", async (req, res) => {
  try {
    console.log("[fundamentals] manual refresh started");
    const overview = await refreshFundamentalsData({
      enablePlaywrightFallback: Boolean(req.body?.enablePlaywrightFallback),
      triggeredBy: "manual"
    });
    console.log("[fundamentals] raw sources refreshed");
    console.log("[fundamentals] AI analysis regeneration started");
    const aiResult = await runAiAnalysis({ trigger: "manual", bypassCooldown: true, skipSourceRefresh: true });
    if (!aiResult.ok) {
      throw new Error(aiResult.error ?? "AI analysis regeneration failed.");
    }
    console.log("[fundamentals] AI analysis regeneration completed", { symbols: aiResult.symbols });
    res.json({
      ok: true,
      lastUpdated: overview.lastUpdated,
      generatedAt: aiResult.generatedAt ?? aiResult.analysis?.generatedAt ?? null,
      timezone: "Europe/Madrid",
      newsCount: overview.latestNews.length,
      eventCount: overview.upcomingEvents.length,
      next4HoursCount: overview.highImpactNext4Hours.length,
      symbols: aiResult.symbols,
      message: "Fundamentals sources refreshed and AI analysis regenerated successfully.",
      overview,
      analysis: aiResult.latestAvailable
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to refresh market intelligence";
    console.error("[fundamentals] manual refresh failed", { error: message });
    res.status(500).json({ error: message });
  }
});
marketIntelligenceRouter.post("/refresh-sources", async (req, res) => {
  try {
    console.log("[fundamentals] manual refresh started");
    const overview = await refreshFundamentalsData({
      enablePlaywrightFallback: Boolean(req.body?.enablePlaywrightFallback),
      triggeredBy: "manual"
    });
    console.log("[fundamentals] raw sources refreshed");
    res.json({
      success: true,
      message: "Sources refreshed successfully.",
      lastUpdated: overview.lastUpdated,
      timezone: "Europe/Madrid",
      newsCount: overview.latestNews.length,
      eventCount: overview.upcomingEvents.length,
      next4HoursCount: overview.highImpactNext4Hours.length
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to refresh source data";
    console.error("[fundamentals] manual refresh failed", { error: message });
    res.status(500).json({ error: message });
  }
});
marketIntelligenceRouter.post("/regenerate-ai", async (_req, res) => {
  try {
    console.log("[fundamentals] AI analysis regeneration started");
    const aiResult = await runAiAnalysis({ trigger: "manual", bypassCooldown: true, skipSourceRefresh: true });
    if (!aiResult.ok) {
      throw new Error(aiResult.error ?? "AI analysis regeneration failed.");
    }
    console.log("[fundamentals] AI analysis regeneration completed", { symbols: aiResult.symbols });
    res.json({
      success: true,
      message: "AI analysis regenerated successfully.",
      generatedAt: aiResult.analysis?.generatedAt ?? null,
      symbols: aiResult.symbols,
      analysis: aiResult.latestAvailable
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to regenerate AI analysis";
    console.error("[fundamentals] manual refresh failed", { error: message });
    res.status(500).json({ error: message });
  }
});

// backend/server/routes/admin.ts
var import_express32 = require("express");
var adminRouter = (0, import_express32.Router)();
function isAdminAuthorized(req) {
  if (process.env.NODE_ENV !== "production") return true;
  const secret = process.env.ADMIN_SECRET ?? process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
  const headerSecret = req.headers["x-admin-secret"] ?? "";
  return bearer === secret || headerSecret === secret;
}
adminRouter.post("/fundamentals-ai/run-now", async (req, res) => {
  if (!isAdminAuthorized(req)) {
    return res.status(401).json({ error: "Unauthorized admin request" });
  }
  try {
    const result = await runAiAnalysis({ trigger: "manual", bypassCooldown: true });
    return res.json({
      success: result.ok,
      runType: "manual",
      timezone: result.timezone ?? "Europe/Madrid",
      symbolsAnalysed: result.symbols,
      generatedAt: result.analysis?.generatedAt ?? null,
      nextRun: result.nextRun ?? null,
      result
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Manual AI analysis failed";
    return res.status(500).json({
      success: false,
      runType: "manual",
      timezone: "Europe/Madrid",
      symbolsAnalysed: [],
      error: message
    });
  }
});

// backend/server/routes/pairAi.ts
var import_express33 = require("express");

// backend/server/services/pairAiJob.service.ts
var import_node_crypto6 = require("node:crypto");
var jobs = /* @__PURE__ */ new Map();
var MAX_JOB_AGE_MS = 30 * 6e4;
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function pruneJobs() {
  const cutoff = Date.now() - MAX_JOB_AGE_MS;
  for (const [jobId, job] of jobs) {
    if (new Date(job.updatedAt).getTime() < cutoff) jobs.delete(jobId);
  }
}
function updateJob(jobId, patch) {
  const current = jobs.get(jobId);
  if (!current) return;
  jobs.set(jobId, {
    ...current,
    ...patch,
    diagnostics: {
      ...current.diagnostics,
      ...patch.diagnostics
    },
    updatedAt: nowIso()
  });
}
function defaultDiagnostics(symbol) {
  return {
    openaiKeyConfigured: isOpenAIConfigured(),
    model: getOpenAIModel(),
    symbol,
    pairContextLoaded: false,
    fundamentalsLoaded: false,
    promptSizeEstimate: null,
    pairAiTimeoutMs: getPairAiTimeoutMs()
  };
}
function formatTimedOutMessage(job) {
  return job.diagnostics.pairContextLoaded && job.diagnostics.fundamentalsLoaded ? "AI analysis timed out while waiting for OpenAI. Pair data and fundamentals loaded successfully, but the model response took too long. Try again or reduce analysis depth." : "AI analysis timed out before the full pair context finished loading. Try again in a moment.";
}
async function createPairAiJob(symbol, forceRefresh = true) {
  pruneJobs();
  const normalizedSymbol = symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const jobId = (0, import_node_crypto6.randomUUID)();
  const initial = {
    jobId,
    symbol: normalizedSymbol,
    status: "processing",
    stage: "preparing_pair_snapshot",
    diagnostics: defaultDiagnostics(normalizedSymbol),
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  jobs.set(jobId, initial);
  void (async () => {
    const startedAt = Date.now();
    try {
      const debug = await getPairAiDebugSnapshot(normalizedSymbol, { forceRefresh: false });
      updateJob(jobId, {
        diagnostics: {
          ...initial.diagnostics,
          pairContextLoaded: debug.pairContextLoaded,
          fundamentalsLoaded: debug.fundamentalsLoaded,
          promptSizeEstimate: debug.promptSizeEstimate
        }
      });
      const analysis = await buildPairAnalysis(normalizedSymbol, {
        forceRefresh,
        allowLiveAI: true,
        preferSavedAi: false,
        onStageChange: (stage) => {
          updateJob(jobId, { stage });
        }
      });
      updateJob(jobId, {
        status: "completed",
        stage: "finalizing_verdict",
        analysis
      });
    } catch (error) {
      const current = jobs.get(jobId) ?? initial;
      const err = error instanceof Error ? error : new Error(String(error));
      const durationMs = Date.now() - startedAt;
      console.error("[pair-ai] analysis failed", {
        symbol: normalizedSymbol,
        durationMs,
        errorName: err.name,
        errorMessage: err.message
      });
      const timedOut = /timeout/i.test(err.name) || /timeout/i.test(err.message);
      updateJob(jobId, {
        status: "failed",
        error: timedOut ? "AI analysis timed out" : "AI analysis failed",
        details: timedOut ? `OpenAI request exceeded ${current.diagnostics.pairAiTimeoutMs / 1e3} seconds` : err.message
      });
    }
  })();
  return initial;
}
function getPairAiJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;
  if (job.status === "failed" && job.error === "AI analysis timed out") {
    return {
      ...job,
      details: job.details ?? `OpenAI request exceeded ${job.diagnostics.pairAiTimeoutMs / 1e3} seconds`,
      error: formatTimedOutMessage(job)
    };
  }
  return job;
}

// backend/server/routes/pairAi.ts
var pairAiRouter = (0, import_express33.Router)();
pairAiRouter.post("/analyze", async (req, res) => {
  const symbol = typeof req.body?.symbol === "string" ? req.body.symbol : "";
  const forceRefresh = Boolean(req.body?.forceRefresh ?? true);
  if (!symbol.trim()) {
    return res.status(400).json({ error: "symbol is required" });
  }
  const job = await createPairAiJob(symbol, forceRefresh);
  return res.json({
    jobId: job.jobId,
    status: job.status,
    stage: job.stage
  });
});
pairAiRouter.get("/analyze/status", (req, res) => {
  const jobId = typeof req.query.jobId === "string" ? req.query.jobId : "";
  if (!jobId.trim()) {
    return res.status(400).json({ error: "jobId is required" });
  }
  const job = getPairAiJob(jobId);
  if (!job) {
    return res.status(404).json({ error: "job not found" });
  }
  if (job.status === "failed") {
    return res.json({
      status: job.status,
      error: job.error,
      details: job.details,
      diagnostics: job.diagnostics
    });
  }
  return res.json({
    jobId: job.jobId,
    status: job.status,
    stage: job.stage,
    analysis: job.analysis,
    diagnostics: job.diagnostics
  });
});

// backend/server/index.ts
import_dotenv2.default.config();
var app = (0, import_express34.default)();
var HOST = process.env.API_HOST ?? "0.0.0.0";
var IS_VERCEL = process.env.VERCEL === "1";
var BACKEND_DISCOVERY_FILE = process.env.ALPHAMENTALS_BACKEND_DISCOVERY_FILE ?? "/tmp/alphamentals-backend-discovery.json";
var DISCOVERY_PORTS = [3001, 3e3, 3002, 3005, 3333, 4e3, 5e3, 8e3, 8080, 8787];
var ALLOWED_ORIGIN_STRINGS = [
  process.env.FRONTEND_ORIGIN,
  process.env.FRONTEND_ORIGIN_ALT,
  "https://alphamentals-dashboard.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001"
].filter(Boolean);
var VERCEL_PREVIEW_PATTERN = /^https:\/\/alphamentals-dashboard-[a-z0-9-]+-[a-z0-9]+\.vercel\.app$/;
app.use((0, import_cors.default)({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGIN_STRINGS.includes(origin) || VERCEL_PREVIEW_PATTERN.test(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  methods: "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  allowedHeaders: "Content-Type, Authorization, X-Requested-With, x-api-key",
  credentials: true
}));
app.use(import_express34.default.json({ limit: "10mb" }));
app.use("/api/market-data", marketDataRouter);
app.use("/api/ai-insights", aiInsightsRouter);
app.use("/api/economic-calendar", economicCalendarRouter);
app.use("/api/macro", macroDataRouter);
app.use("/api/forex-rates", forexRatesRouter);
app.use("/api/journal", journal_default);
app.use("/api/playbook", playbook_default);
app.use("/api/analytics", analytics_default);
app.use("/api/coach", coach_default);
app.use("/api/checklist", checklist_default);
app.use("/api/risk", riskManager_default);
app.use("/api/metatrader", metaTraderRouter);
app.use("/api/ctrader", ctraderRouter);
app.use("/api/saxo", saxoRouter);
app.use("/api/mt5-tracking", mt5TrackingRouter);
app.use("/api/trading-accounts", tradingAccountsRouter);
app.use("/api/account-onboarding", accountOnboardingRouter);
app.use("/api/fundamentals", fundamentalsRouter);
app.use("/api/market-intelligence", marketIntelligenceRouter);
app.use("/api/admin", adminRouter);
app.use("/api/pairs", pairsRouter);
app.use("/api/tradingview-webhook", tradingviewWebhookRouter);
app.use("/api/telegram", telegramRouter);
app.use("/api/cron", cronRouter);
app.use("/telegram", telegramRouter);
app.use("/api/mt5", mt5Router);
app.use("/api/trades", tradeExecutionRouter);
app.use("/api/mt5-bridge", mt5BridgeRouter);
app.use("/api/trades", tradesRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/diagnostics", diagnosticsRouter);
app.use("/api/debug", debugRouter);
app.use("/api/ai-analysis", aiAnalysisRouter);
app.use("/api/pair-ai", pairAiRouter);
app.use("/api/cost", costRouter);
function sendHealth(_req, res) {
  const telegram = getTelegramRuntimeState();
  res.json({
    ok: true,
    service: "alphamentals-api",
    kind: "backend",
    status: "ok",
    timestamp: Date.now(),
    telegram: {
      enabled: telegram.enabled,
      connected: telegram.connected,
      target_chat_accessible: telegram.targetChatAccessible
    }
  });
}
app.get("/api/health", sendHealth);
app.get("/health", sendHealth);
app.get("/api/ping", (_req, res) => res.json({ ok: true }));
app.get("/ping", (_req, res) => res.json({ ok: true }));
app.use("/api", (req, res) => {
  res.status(404).json({
    ok: false,
    error: "NOT_FOUND",
    message: "API route not found",
    path: req.path
  });
});
function canListen(port) {
  return new Promise((resolve) => {
    const probe = import_node_net.default.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => {
      probe.close(() => resolve(true));
    });
    probe.listen(port, HOST);
  });
}
async function resolveListenPort() {
  const envPort = [process.env.PORT, process.env.API_PORT, process.env.SERVER_PORT].map(Number).find((p) => Number.isInteger(p) && p > 0);
  if (envPort) return envPort;
  for (const port of DISCOVERY_PORTS) {
    if (await canListen(port)) return port;
  }
  return 0;
}
async function writeDiscoveryManifest(port) {
  const connectHost = HOST === "0.0.0.0" ? "127.0.0.1" : HOST;
  const payload = {
    origin: `http://${connectHost}:${port}`,
    host: connectHost,
    port,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    pid: process.pid
  };
  try {
    await import_promises2.default.writeFile(
      /* turbopackIgnore: true */
      BACKEND_DISCOVERY_FILE,
      JSON.stringify(payload, null, 2),
      "utf8"
    );
  } catch (error) {
    console.warn("[server] Failed to write backend discovery manifest:", error instanceof Error ? error.message : String(error));
  }
}
var SYNC_INTERVAL_MS = 24 * 60 * 60 * 1e3;
function scheduleMacroSync() {
  if (!process.env.FRED_API_KEY) {
    console.warn("[server] \u26A0\uFE0F  FRED_API_KEY not set \u2014 macro sync disabled");
    return;
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn("[server] \u26A0\uFE0F  SUPABASE_SERVICE_ROLE_KEY not set \u2014 macro sync disabled");
    return;
  }
  setImmediate(async () => {
    try {
      await syncMacroIndicators();
    } catch (err) {
      console.error("[server] Initial macro sync failed:", err.message);
    }
  });
  setInterval(async () => {
    try {
      await syncMacroIndicators();
    } catch (err) {
      console.error("[server] Scheduled macro sync failed:", err.message);
    }
  }, SYNC_INTERVAL_MS);
}
function scheduleFundamentals() {
  setImmediate(() => {
    startNewsFetcherJob();
  });
}
async function bootstrap() {
  const port = await resolveListenPort();
  app.listen(port, HOST, async () => {
    const addressHost = HOST === "0.0.0.0" ? "127.0.0.1" : HOST;
    console.log(`[server] Alphamentals API \u2192 http://${addressHost}:${port}`);
    await writeDiscoveryManifest(port);
    validateMarketDataEnv();
    console.log("[env] MT5_BRIDGE_URL present:", Boolean(process.env.MT5_BRIDGE_URL));
    console.log("[env] MT5_BRIDGE_API_KEY present:", Boolean(process.env.MT5_BRIDGE_API_KEY));
    console.log("[env] MT5_BRIDGE_URL value:", process.env.MT5_BRIDGE_URL ?? null);
    console.log("[server] MT5 bridge config diagnostics", {
      mt5BridgeUrlConfigured: getBridgeConfigDiagnostics().mt5BridgeUrlConfigured,
      mt5BridgeApiKeyConfigured: getBridgeConfigDiagnostics().mt5BridgeApiKeyConfigured
    });
    logOpenAIConfiguration();
    if (!process.env.MYFXBOOK_EMAIL) console.warn("[server] \u26A0\uFE0F  MYFXBOOK_EMAIL not set \u2014 demo calendar data will be used");
    if (IS_VERCEL) {
      console.warn("[server] Vercel detected \u2014 background monitors and scheduled jobs are disabled");
      return;
    }
    const telegramValidation = getTelegramStartupValidationMessage();
    if (telegramValidation) {
      console.warn(`[Telegram] ${telegramValidation}`);
    } else {
      await logTelegramStartupDiagnostics();
      void startTelegramMonitoring(async (message) => {
        await ingestTelegramMessage(message);
      });
      startTelegramSyncScheduler();
    }
    scheduleMacroSync();
    scheduleFundamentals();
    startMarketDataScheduler();
    scheduleAutomaticMt5Sync();
  });
}
void bootstrap();
