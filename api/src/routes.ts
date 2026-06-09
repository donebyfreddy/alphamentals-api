import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { bridgeConfig } from './config.js';
import {
  getAccountState,
  getLatestQuotes,
  normalizeQuoteSymbol,
  saveAccountState,
  updateAccountSnapshot,
  updateLatestQuotes,
} from './state.js';

export const bridgeRouter = Router();

const candleTimeframes = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'] as const;

const connectSchema = z.object({
  accountId: z.string().uuid().optional(),
  login: z.string().trim().min(1),
  password: z.string().optional(),
  server: z.string().trim().min(1),
  terminalPath: z.string().trim().min(1).nullable().optional(),
  accountType: z.enum(['demo', 'live']).optional(),
});

const disconnectSchema = z.object({
  accountId: z.string().trim().min(1),
});

const accountInfoSchema = z.object({
  login: z.string().trim().min(1),
  server: z.string().trim().min(1),
  broker: z.string().default(''),
  name: z.string().default(''),
  balance: z.number(),
  equity: z.number(),
  margin: z.number(),
  freeMargin: z.number(),
  profit: z.number(),
  currency: z.string().default('USD'),
  leverage: z.number(),
  tradeAllowed: z.boolean(),
  company: z.string().nullable().optional(),
  terminalName: z.string().nullable().optional(),
  updatedAt: z.string().optional(),
});

const positionSchema = z.object({
  ticket: z.string().trim().min(1),
  symbol: z.string().trim().min(1),
  type: z.enum(['buy', 'sell']),
  volume: z.number(),
  profit: z.number(),
  openPrice: z.number(),
  currentPrice: z.number().nullable(),
  stopLoss: z.number().nullable(),
  takeProfit: z.number().nullable(),
  openedAt: z.string().nullable(),
  swap: z.number().nullable().optional(),
  commission: z.number().nullable().optional(),
  magic: z.number().nullable().optional(),
  comment: z.string().nullable().optional(),
});

const quoteSchema = z.object({
  symbol: z.string().trim().min(1),
  bid: z.number().nullable(),
  ask: z.number().nullable(),
  last: z.number().nullable(),
  high: z.number().nullable(),
  low: z.number().nullable(),
  previousClose: z.number().nullable(),
  updatedAt: z.string().trim().min(1),
  source: z.literal('mt5-bridge'),
});

const heartbeatSchema = z.object({
  accountId: z.string().trim().min(1),
  account: accountInfoSchema,
  positions: z.array(positionSchema).default([]),
  quotes: z.array(quoteSchema).default([]),
  error: z.string().nullable().optional(),
});

const priceQuerySchema = z.object({
  symbol: z.string().trim().min(1),
});

const quotesQuerySchema = z.object({
  symbols: z.string().trim().min(1),
});

const candlesQuerySchema = z.object({
  symbol: z.string().trim().min(1),
  timeframe: z.enum(candleTimeframes).default('M5'),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

function logMarketDataRequest(endpoint: string, details: Record<string, unknown>) {
  console.log('[mt5-bridge] market data request', {
    endpoint,
    ...details,
  });
}

function logMarketDataResponse(endpoint: string, status: number, details: Record<string, unknown>) {
  console.log('[mt5-bridge] market data response', {
    endpoint,
    status,
    ...details,
  });
}

function respondPriceSourceNotReady(
  res: Response,
  endpoint: string,
  details: Record<string, unknown>,
) {
  const payload = {
    ok: false,
    error: 'MT5_PRICE_SOURCE_NOT_READY',
    message: 'MT5 price source is not connected yet',
  };

  logMarketDataResponse(endpoint, 503, details);
  res.status(503).json(payload);
}

function toMidPrice(bid: number | null, ask: number | null) {
  if (bid == null || ask == null) return null;
  return Number(((bid + ask) / 2).toFixed(8));
}

bridgeRouter.post('/accounts/connect', (req, res) => {
  const parsed = connectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      error: 'INVALID_PAYLOAD',
      details: parsed.error.flatten(),
    });
    return;
  }

  const now = new Date().toISOString();
  const accountId = parsed.data.accountId ?? randomUUID();
  const state = saveAccountState({
    accountId,
    login: parsed.data.login,
    server: parsed.data.server,
    terminalPath: parsed.data.terminalPath ?? null,
    accountType: parsed.data.accountType ?? 'demo',
    status: 'connected',
    connected: true,
    createdAt: now,
    updatedAt: now,
    lastHeartbeatAt: now,
    lastError: null,
    accountInfo: null,
    positions: [],
  });

  res.json({
    ok: true,
    accountId: state.accountId,
    status: state.status,
    connected: state.connected,
    message: 'Bridge account registered. MT5 handshake stub is ready for Phase 2.',
  });
});

bridgeRouter.post('/accounts/disconnect', (req, res) => {
  const parsed = disconnectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      error: 'INVALID_PAYLOAD',
      details: parsed.error.flatten(),
    });
    return;
  }

  const state = getAccountState(parsed.data.accountId);
  if (!state) {
    res.status(404).json({
      ok: false,
      error: 'ACCOUNT_NOT_FOUND',
      message: 'Account is not registered in the bridge.',
    });
    return;
  }

  saveAccountState({
    ...state,
    connected: false,
    status: 'disconnected',
    updatedAt: new Date().toISOString(),
    lastHeartbeatAt: null,
  });

  res.json({
    ok: true,
    accountId: state.accountId,
    status: 'disconnected',
    message: 'Bridge account disconnected.',
  });
});

bridgeRouter.get('/accounts/:accountId/status', (req, res) => {
  const state = getAccountState(req.params.accountId);
  if (!state) {
    res.status(404).json({
      ok: false,
      error: 'ACCOUNT_NOT_FOUND',
      message: 'Account is not registered in the bridge.',
    });
    return;
  }

  res.json({
    accountId: state.accountId,
    status: state.status,
    connected: state.connected,
    login: state.login,
    server: state.server,
    lastHeartbeatAt: state.lastHeartbeatAt,
    lastError: state.lastError,
  });
});

bridgeRouter.get('/accounts/:accountId/info', (req, res) => {
  const state = getAccountState(req.params.accountId);
  if (!state?.accountInfo) {
    res.status(404).json({
      ok: false,
      error: 'ACCOUNT_INFO_NOT_AVAILABLE',
      message: 'No MT5 account snapshot has been received yet.',
    });
    return;
  }

  res.json(state.accountInfo);
});

bridgeRouter.get('/accounts/:accountId/positions', (req, res) => {
  const state = getAccountState(req.params.accountId);
  if (!state) {
    res.status(404).json({
      ok: false,
      error: 'ACCOUNT_NOT_FOUND',
      message: 'Account is not registered in the bridge.',
    });
    return;
  }

  res.json(state.positions);
});

bridgeRouter.get('/market-data/price', (req, res) => {
  const parsed = priceQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      error: 'INVALID_QUERY',
      details: parsed.error.flatten(),
    });
    return;
  }

  const endpoint = '/market-data/price';
  const symbol = normalizeQuoteSymbol(parsed.data.symbol);
  logMarketDataRequest(endpoint, {
    bridgeUrl: `http://0.0.0.0:${bridgeConfig.port}`,
    symbol,
  });

  const quote = getLatestQuotes([symbol])[symbol];
  if (!quote) {
    respondPriceSourceNotReady(res, endpoint, { symbol });
    return;
  }

  const payload = {
    ok: true,
    symbol,
    bid: quote.bid,
    ask: quote.ask,
    mid: toMidPrice(quote.bid, quote.ask),
    timestamp: quote.updatedAt,
    source: 'mt5',
  };

  logMarketDataResponse(endpoint, 200, { symbol });
  res.json(payload);
});

bridgeRouter.get('/market-data/quotes', (req, res) => {
  const parsed = quotesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      error: 'INVALID_QUERY',
      details: parsed.error.flatten(),
    });
    return;
  }

  const endpoint = '/market-data/quotes';
  const symbols = parsed.data.symbols
    .split(',')
    .map((symbol) => normalizeQuoteSymbol(symbol))
    .filter(Boolean);

  logMarketDataRequest(endpoint, {
    bridgeUrl: `http://0.0.0.0:${bridgeConfig.port}`,
    symbols,
  });

  const latestQuotes = getLatestQuotes(symbols);
  const quotes = symbols
    .map((symbol) => latestQuotes[symbol])
    .filter((quote): quote is NonNullable<typeof latestQuotes[string]> => Boolean(quote))
    .map((quote) => ({
      symbol: quote.symbol,
      bid: quote.bid,
      ask: quote.ask,
      mid: toMidPrice(quote.bid, quote.ask),
      timestamp: quote.updatedAt,
      source: 'mt5' as const,
    }));

  if (!quotes.length) {
    respondPriceSourceNotReady(res, endpoint, { symbols });
    return;
  }

  logMarketDataResponse(endpoint, 200, {
    symbols,
    quoteCount: quotes.length,
  });
  res.json({
    ok: true,
    quotes,
  });
});

bridgeRouter.get('/market-data/candles', (req, res) => {
  const parsed = candlesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      error: 'INVALID_QUERY',
      details: parsed.error.flatten(),
    });
    return;
  }

  const endpoint = '/market-data/candles';
  const symbol = normalizeQuoteSymbol(parsed.data.symbol);
  logMarketDataRequest(endpoint, {
    bridgeUrl: `http://0.0.0.0:${bridgeConfig.port}`,
    symbol,
    timeframe: parsed.data.timeframe,
    limit: parsed.data.limit,
  });

  respondPriceSourceNotReady(res, endpoint, {
    symbol,
    timeframe: parsed.data.timeframe,
    limit: parsed.data.limit,
  });
});

bridgeRouter.get('/quotes', (req, res) => {
  const symbolsParam = typeof req.query.symbols === 'string' ? req.query.symbols : '';
  const requestedSymbols = symbolsParam
    .split(',')
    .map((symbol) => symbol.trim())
    .filter(Boolean);

  const latestQuotes = getLatestQuotes(requestedSymbols);
  const data: Record<string, unknown> = requestedSymbols.length ? {} : latestQuotes;
  const errors: Record<string, string> = {};

  if (requestedSymbols.length) {
    for (const symbol of requestedSymbols) {
      const normalized = normalizeQuoteSymbol(symbol);
      const quote = latestQuotes[normalized];

      if (quote) {
        data[normalized] = quote;
        continue;
      }

      errors[normalized] = 'Quote not available from the latest MT5 heartbeat.';
    }
  }

  res.json({
    ok: true,
    data,
    errors,
    timestamp: new Date().toISOString(),
  });
});

bridgeRouter.post('/ea/heartbeat', (req, res) => {
  const parsed = heartbeatSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      error: 'INVALID_HEARTBEAT',
      details: parsed.error.flatten(),
    });
    return;
  }

  const accountInfo = {
    ...parsed.data.account,
    updatedAt: parsed.data.account.updatedAt ?? new Date().toISOString(),
  };

  updateLatestQuotes(parsed.data.quotes);

  const state = updateAccountSnapshot({
    accountId: parsed.data.accountId,
    accountInfo,
    positions: parsed.data.positions,
    lastError: parsed.data.error ?? null,
  });

  res.json({
    ok: true,
    accountId: state.accountId,
    status: state.status,
    positions: state.positions.length,
    tradingEnabled: bridgeConfig.tradingEnabled,
    message: state.lastError ? 'Heartbeat stored with MT5 error.' : 'Heartbeat stored.',
  });
});
