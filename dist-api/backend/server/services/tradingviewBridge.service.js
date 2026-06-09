"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseTradingviewPayload = parseTradingviewPayload;
exports.listRecentTradingviewAlerts = listRecentTradingviewAlerts;
exports.processTradingviewWebhook = processTradingviewWebhook;
exports.analyzeTradingSignal = analyzeTradingSignal;
const gemini_js_1 = require("../lib/gemini.js");
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
const finnhub_js_1 = require("../lib/finnhub.js");
const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const SIGNAL_TYPES = new Set(['setup_detected', 'important_zone', 'price_zone_reached']);
const SYMBOL_ALIASES = {
    XAUUSD: 'XAUUSD',
    EURUSD: 'EURUSD',
    GBPUSD: 'GBPUSD',
    USDJPY: 'USDJPY',
    USOIL: 'USOIL',
    WTI: 'WTI',
    DXY: 'DXY',
    BTCUSD: 'BTCUSD',
    BTCUSDT: 'BTCUSD',
    US30: 'US30',
};
const PRICE_SPECS = [
    { key: 'dxy', label: 'US Dollar Index', symbol: process.env.TRADING_DXY_SYMBOL ?? 'DX-Y.NYB' },
    { key: 'gold', label: 'Gold Futures', symbol: process.env.TRADING_GOLD_SYMBOL ?? 'GC=F' },
    { key: 'wti', label: 'WTI Crude', symbol: process.env.TRADING_WTI_SYMBOL ?? 'CL=F' },
    { key: 'us10y', label: 'US 10Y Yield', symbol: process.env.TRADING_US10Y_SYMBOL ?? '^TNX' },
    { key: 'us02y', label: 'US 02Y Yield', symbol: process.env.TRADING_US02Y_SYMBOL ?? '^UST2Y' },
];
function getConfig() {
    const riskPercentRaw = Number(process.env.TRADING_RISK_PERCENT ?? 1);
    return {
        accountSize: Number(process.env.TRADING_ACCOUNT_SIZE ?? 10000),
        riskPercent: Number.isFinite(riskPercentRaw) ? Math.min(riskPercentRaw, 1) : 1,
        minRiskReward: Number(process.env.TRADING_MIN_RR ?? 2),
        duplicateWindowMinutes: Number(process.env.TRADING_DUPLICATE_WINDOW_MINUTES ?? 180),
        blockNewsMinutes: Number(process.env.TRADING_BLOCK_NEWS_MINUTES ?? 30),
    };
}
function getStorageFile() {
    return process.env.TRADING_ALERTS_FILE ?? node_path_1.default.join(process.cwd(), 'backend', 'server', 'data', 'tradingview-alerts.json');
}
async function ensureStorageFile() {
    const filePath = getStorageFile();
    await (0, promises_1.mkdir)(node_path_1.default.dirname(filePath), { recursive: true });
    try {
        await (0, promises_1.readFile)(filePath, 'utf8');
    }
    catch {
        await (0, promises_1.writeFile)(filePath, '[]', 'utf8');
    }
    return filePath;
}
async function readRecords() {
    const filePath = await ensureStorageFile();
    const raw = await (0, promises_1.readFile)(filePath, 'utf8');
    return JSON.parse(raw);
}
async function writeRecords(records) {
    const filePath = await ensureStorageFile();
    await (0, promises_1.writeFile)(filePath, JSON.stringify(records, null, 2), 'utf8');
}
function toStringValue(value) {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}
function toNumberValue(value) {
    if (value === null || value === undefined || value === '')
        return null;
    const parsed = Number(String(value).replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : null;
}
function normalizeSymbol(raw) {
    const normalized = raw.toUpperCase().replace(/^[A-Z]+:/, '').replace(/[^A-Z0-9]/g, '');
    if (normalized.includes('XAUUSD'))
        return 'XAUUSD';
    if (normalized.includes('EURUSD'))
        return 'EURUSD';
    if (normalized.includes('GBPUSD'))
        return 'GBPUSD';
    if (normalized.includes('USDJPY'))
        return 'USDJPY';
    if (normalized.includes('USOIL'))
        return 'USOIL';
    if (normalized === 'WTI')
        return 'WTI';
    if (normalized.includes('DXY'))
        return 'DXY';
    if (normalized.includes('BTCUSD') || normalized.includes('BTCUSDT') || normalized.includes('BITCOIN'))
        return 'BTCUSD';
    if (normalized.includes('US30') || normalized.includes('DOW') || normalized.includes('DJI'))
        return 'US30';
    return SYMBOL_ALIASES[normalized] ?? null;
}
function normalizeSignalType(value, signal) {
    if (value && SIGNAL_TYPES.has(value))
        return value;
    const normalizedSignal = signal?.trim().toUpperCase();
    if (normalizedSignal === 'BUY' || normalizedSignal === 'SELL')
        return 'setup_detected';
    return 'setup_detected';
}
function normalizeDirectionHint(value, signal) {
    const normalized = value?.trim().toLowerCase();
    if (normalized === 'buy' || normalized === 'sell' || normalized === 'neutral')
        return normalized;
    const signalValue = signal?.trim().toUpperCase();
    if (signalValue === 'BUY')
        return 'buy';
    if (signalValue === 'SELL')
        return 'sell';
    return 'neutral';
}
function normalizeTime(value) {
    if (typeof value === 'number') {
        const millis = value > 1_000_000_000_000 ? value : value * 1000;
        return new Date(millis).toISOString();
    }
    if (typeof value === 'string') {
        if (/^\d+$/.test(value.trim())) {
            const numeric = Number(value);
            const millis = value.trim().length > 10 ? numeric : numeric * 1000;
            return new Date(millis).toISOString();
        }
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime()))
            return parsed.toISOString();
    }
    return new Date().toISOString();
}
function fingerprintAlert(input) {
    return (0, node_crypto_1.createHash)('sha256')
        .update([
        input.symbol,
        input.timeframe,
        input.price.toFixed(5),
        input.eventTimeIso,
        input.signalType,
        input.directionHint,
        input.structure,
        input.candlePattern,
    ].join('|'))
        .digest('hex');
}
function parseTradingviewPayload(payload) {
    const secret = toStringValue(payload.secret) ?? '';
    const symbolRaw = toStringValue(payload.symbol);
    const timeframe = toStringValue(payload.timeframe);
    const price = toNumberValue(payload.price);
    const signal = toStringValue(payload.signal);
    const strategy = toStringValue(payload.strategy);
    const message = toStringValue(payload.message);
    if (!symbolRaw)
        throw new Error('symbol is required');
    if (!timeframe)
        throw new Error('timeframe is required');
    if (price === null)
        throw new Error('price must be numeric');
    const symbol = normalizeSymbol(symbolRaw);
    if (!symbol)
        throw new Error(`Unsupported symbol "${symbolRaw}"`);
    const signalType = normalizeSignalType(toStringValue(payload.signal_type), signal);
    const eventTimeIso = normalizeTime(payload.time);
    const directionHint = normalizeDirectionHint(toStringValue(payload.direction_hint), signal);
    const trend = (toStringValue(payload.trend) ?? 'ranging');
    const structure = (toStringValue(payload.structure) ?? 'none');
    const candlePattern = (toStringValue(payload.candle_pattern) ?? 'none');
    const liquidityEvent = (toStringValue(payload.liquidity_event) ?? 'none');
    return {
        receivedAt: new Date().toISOString(),
        secret,
        symbol,
        originalSymbol: symbolRaw,
        timeframe,
        signal,
        strategy,
        message,
        exchange: toStringValue(payload.exchange) ?? 'unknown',
        price,
        eventTimeIso,
        signalType: signalType,
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
            candlePattern,
        }),
    };
}
function assertWebhookSecret(secret) {
    const expected = process.env.TRADINGVIEW_WEBHOOK_SECRET;
    if (!expected)
        return;
    if (secret !== expected)
        throw new Error('Invalid webhook secret');
}
async function fetchJson(url) {
    const response = await fetch(url, { headers: { 'User-Agent': 'alphamentals-tradingview-bridge/1.0' } });
    if (!response.ok)
        throw new Error(`HTTP ${response.status} for ${url}`);
    return response.json();
}
async function fetchCorrelatedSnapshot(spec) {
    try {
        const data = await fetchJson(`${YAHOO_BASE}/${encodeURIComponent(spec.symbol)}?range=5d&interval=60m`);
        const result = data.chart?.result?.[0];
        const closes = result?.indicators?.quote?.[0]?.close?.filter((value) => typeof value === 'number') ?? [];
        const price = result?.meta?.regularMarketPrice ?? closes.at(-1) ?? null;
        const previousClose = result?.meta?.previousClose ?? (closes.length > 1 ? closes.at(-2) ?? null : null);
        if (price === null) {
            return { key: spec.key, label: spec.label, symbol: spec.symbol, price: null, previousClose: null, changePercent: null, trend: 'unknown', available: false, asOf: null, note: 'No quote returned' };
        }
        const delta = previousClose && previousClose !== 0 ? ((price - previousClose) / previousClose) * 100 : null;
        let trend = 'unknown';
        if (closes.length >= 4) {
            const start = closes[closes.length - 4];
            const end = closes[closes.length - 1];
            if (start !== undefined && end !== undefined) {
                const move = end - start;
                trend = Math.abs(move) < Math.max(Math.abs(start) * 0.0005, 0.01) ? 'flat' : move > 0 ? 'up' : 'down';
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
            asOf: result?.timestamp?.length ? new Date(result.timestamp[result.timestamp.length - 1] * 1000).toISOString() : new Date().toISOString(),
        };
    }
    catch (error) {
        return {
            key: spec.key,
            label: spec.label,
            symbol: spec.symbol,
            price: null,
            previousClose: null,
            changePercent: null,
            trend: 'unknown',
            available: false,
            asOf: null,
            note: error instanceof Error ? error.message : 'Snapshot fetch failed',
        };
    }
}
function detectSession(alert) {
    if (alert.session)
        return alert.session;
    const hour = new Date(alert.eventTimeIso).getUTCHours();
    if (hour >= 0 && hour < 7)
        return 'Asian session';
    if (hour >= 7 && hour < 13)
        return 'London session';
    if (hour >= 13 && hour < 21)
        return 'New York session';
    return 'Off-session';
}
async function fetchUpcomingUsdEvents() {
    const now = new Date();
    const from = now.toISOString().split('T')[0];
    const to = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const events = await (0, finnhub_js_1.fetchCalendar)(from, to);
    return events
        .filter((event) => event.currency === 'USD' && event.impact === 'high')
        .map((event) => {
        const dateTime = new Date(`${event.date}T${event.time}:00Z`);
        return {
            title: event.title,
            impact: event.impact,
            currency: event.currency,
            startsAt: dateTime.toISOString(),
            minutesUntil: Math.round((dateTime.getTime() - Date.now()) / 60000),
        };
    })
        .filter((event) => event.minutesUntil >= -15 && event.minutesUntil <= 8 * 60)
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
async function buildTradingContext(alert) {
    const snapshots = await Promise.all(PRICE_SPECS.map(fetchCorrelatedSnapshot));
    const correlatedMarkets = {
        dxy: snapshots.find((item) => item.key === 'dxy'),
        gold: snapshots.find((item) => item.key === 'gold'),
        wti: snapshots.find((item) => item.key === 'wti'),
        us10y: snapshots.find((item) => item.key === 'us10y'),
        us02y: snapshots.find((item) => item.key === 'us02y'),
    };
    const dataWarnings = snapshots.filter((item) => !item.available && item.note).map((item) => `${item.label}: ${item.note}`);
    const macroNotes = [];
    if (alert.symbol === 'XAUUSD') {
        if (correlatedMarkets.dxy.trend === 'down')
            macroNotes.push('DXY is soft, which can support bullish gold setups.');
        if (correlatedMarkets.dxy.trend === 'up')
            macroNotes.push('DXY is firm, which can conflict with bullish gold setups.');
        if (correlatedMarkets.us10y.trend === 'down' && correlatedMarkets.us02y.trend === 'down') {
            macroNotes.push('US yields are easing, which can help gold longs.');
        }
        if (correlatedMarkets.us10y.trend === 'up' || correlatedMarkets.us02y.trend === 'up') {
            macroNotes.push('US yields are rising, which can pressure long gold ideas.');
        }
    }
    if (alert.symbol === 'EURUSD' || alert.symbol === 'GBPUSD') {
        if (correlatedMarkets.dxy.trend === 'down')
            macroNotes.push('A weaker DXY tends to support EURUSD/GBPUSD longs.');
        if (correlatedMarkets.dxy.trend === 'up')
            macroNotes.push('A stronger DXY can weigh on EURUSD/GBPUSD longs.');
    }
    if (alert.symbol === 'USDJPY') {
        if (correlatedMarkets.dxy.trend === 'up' && correlatedMarkets.us10y.trend === 'up') {
            macroNotes.push('DXY and yields are aligned higher, which can support USDJPY strength.');
        }
        if (correlatedMarkets.dxy.trend === 'down' || correlatedMarkets.us10y.trend === 'down') {
            macroNotes.push('DXY or yields are not confirming USDJPY strength.');
        }
    }
    if (alert.symbol === 'BTCUSD') {
        if (correlatedMarkets.dxy.trend === 'down')
            macroNotes.push('A softer dollar can help BTC sustain bullish momentum.');
        if (correlatedMarkets.dxy.trend === 'up')
            macroNotes.push('A firmer dollar can make BTC breakouts less reliable.');
    }
    if (alert.symbol === 'US30') {
        if (correlatedMarkets.us10y.trend === 'down')
            macroNotes.push('Falling yields can support US30 upside continuation.');
        if (correlatedMarkets.us10y.trend === 'up')
            macroNotes.push('Rising yields can pressure US30 longs.');
        if (correlatedMarkets.dxy.trend === 'up')
            macroNotes.push('A strong dollar often coincides with a tighter risk backdrop for equities.');
    }
    let upcomingUsdNews = [];
    try {
        upcomingUsdNews = await fetchUpcomingUsdEvents();
    }
    catch (error) {
        dataWarnings.push(error instanceof Error ? `Economic calendar lookup failed: ${error.message}` : 'Economic calendar lookup failed');
    }
    return {
        sessionLabel: detectSession(alert),
        correlatedMarkets,
        macroNotes,
        upcomingUsdNews,
        dataWarnings,
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
            newsBlockMinutes: config.blockNewsMinutes,
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
            eventTime: alert.eventTimeIso,
        },
        context,
        checklist: [
            'Direction bias from EMA 50 and EMA 200',
            'Whether DXY confirms or conflicts',
            'Whether US10Y and US02Y confirm or conflict',
            'Whether WTI adds useful context',
            'Whether price is at support, resistance, or liquidity',
            'Whether stop loss is beyond structure, not arbitrary',
            'Whether RR is at least 1:2',
            'Whether high-impact USD news is too close',
            'Prefer NO_TRADE if unclear',
        ],
    }, null, 2);
    return { system, user };
}
function defaultAtrForSymbol(symbol, price) {
    if (symbol === 'XAUUSD')
        return Math.max(6, price * 0.0025);
    if (symbol === 'USDJPY')
        return Math.max(0.18, price * 0.0012);
    return Math.max(0.0012, price * 0.0009);
}
function roundPrice(symbol, value) {
    const decimals = symbol === 'XAUUSD' ? 2 : symbol === 'USDJPY' ? 3 : 5;
    return Number(value.toFixed(decimals));
}
function buildHeuristicTradePlan(alert, context, config, fallbackReason) {
    const reasons = [];
    const warnings = [...context.dataWarnings];
    const invalidIf = [];
    let bullishScore = 0;
    let bearishScore = 0;
    if (alert.signal?.toUpperCase() === 'BUY')
        bullishScore += 3;
    if (alert.signal?.toUpperCase() === 'SELL')
        bearishScore += 3;
    if (alert.directionHint === 'buy')
        bullishScore += 2;
    if (alert.directionHint === 'sell')
        bearishScore += 2;
    if (alert.trend === 'bullish')
        bullishScore += 2;
    if (alert.trend === 'bearish')
        bearishScore += 2;
    if (alert.structure === 'BOS_up' || alert.structure === 'CHoCH_up')
        bullishScore += 2;
    if (alert.structure === 'BOS_down' || alert.structure === 'CHoCH_down')
        bearishScore += 2;
    if (alert.candlePattern === 'bullish_engulfing' || alert.candlePattern === 'bullish_pin_bar')
        bullishScore += 1;
    if (alert.candlePattern === 'bearish_engulfing' || alert.candlePattern === 'bearish_pin_bar')
        bearishScore += 1;
    if (alert.symbol === 'XAUUSD') {
        if (context.correlatedMarkets.dxy.trend === 'down')
            bullishScore += 1;
        if (context.correlatedMarkets.dxy.trend === 'up')
            bearishScore += 1;
        if (context.correlatedMarkets.us10y.trend === 'down')
            bullishScore += 1;
        if (context.correlatedMarkets.us10y.trend === 'up')
            bearishScore += 1;
    }
    if (alert.symbol === 'EURUSD' || alert.symbol === 'GBPUSD') {
        if (context.correlatedMarkets.dxy.trend === 'down')
            bullishScore += 1;
        if (context.correlatedMarkets.dxy.trend === 'up')
            bearishScore += 1;
    }
    const blockingNews = context.upcomingUsdNews.some((event) => event.impact === 'high' && event.minutesUntil >= -5 && event.minutesUntil <= config.blockNewsMinutes);
    if (blockingNews) {
        warnings.push(`High-impact USD news is scheduled within ${config.blockNewsMinutes} minutes.`);
        reasons.push('Upcoming high-impact USD news makes the setup too fragile to trade immediately.');
    }
    if (fallbackReason) {
        warnings.push(`AI model unavailable, using local heuristic analysis. ${fallbackReason}`);
    }
    const scoreDelta = bullishScore - bearishScore;
    const bias = scoreDelta > 0 ? 'bullish' : scoreDelta < 0 ? 'bearish' : 'neutral';
    const atr = alert.atr && alert.atr > 0 ? alert.atr : defaultAtrForSymbol(alert.symbol, alert.price);
    const support = alert.support ?? roundPrice(alert.symbol, alert.price - atr * 0.8);
    const resistance = alert.resistance ?? roundPrice(alert.symbol, alert.price + atr * 0.8);
    let decision = 'NO_TRADE';
    if (!blockingNews && Math.abs(scoreDelta) >= 2) {
        decision = scoreDelta > 0 ? 'BUY' : 'SELL';
    }
    if (decision === 'BUY') {
        reasons.push('Bullish inputs are aligned across the alert signal, price structure, and macro context.');
        invalidIf.push('DXY turns sharply higher or price closes back below support.');
    }
    else if (decision === 'SELL') {
        reasons.push('Bearish inputs are aligned across the alert signal, price structure, and macro context.');
        invalidIf.push('DXY weakens sharply or price reclaims resistance.');
    }
    else {
        reasons.push('The setup remains mixed, underconfirmed, or blocked by risk filters.');
        invalidIf.push('Wait for clearer structure, cleaner momentum, or lower event risk.');
    }
    if (alert.strategy)
        reasons.push(`Strategy tag: ${alert.strategy}.`);
    if (alert.message)
        reasons.push(`Alert note: ${alert.message}.`);
    if (context.sessionLabel)
        reasons.push(`Session context: ${context.sessionLabel}.`);
    const baseConfidence = 42 + Math.abs(scoreDelta) * 11 - (blockingNews ? 24 : 0);
    const confidence = Math.max(18, Math.min(82, baseConfidence));
    if (decision === 'NO_TRADE') {
        return {
            decision,
            symbol: alert.symbol,
            timeframe: alert.timeframe,
            confidence,
            entry_zone: { low: 0, high: 0 },
            stop_loss: 0,
            take_profit_1: 0,
            take_profit_2: 0,
            risk_reward: 'unverified',
            position_size_note: 'Risk only 1% or less',
            reasoning: reasons,
            invalid_if: invalidIf,
            warnings,
            bias,
        };
    }
    if (decision === 'BUY') {
        const entryLow = roundPrice(alert.symbol, Math.min(alert.price, support + atr * 0.15));
        const entryHigh = roundPrice(alert.symbol, alert.price);
        const stopLoss = roundPrice(alert.symbol, Math.min(entryLow - atr * 0.6, support - atr * 0.35));
        const takeProfit1 = roundPrice(alert.symbol, Math.max(alert.price + atr * 1.8, resistance));
        const takeProfit2 = roundPrice(alert.symbol, Math.max(takeProfit1 + atr * 1.2, resistance + atr * 1.5));
        return {
            decision,
            symbol: alert.symbol,
            timeframe: alert.timeframe,
            confidence,
            entry_zone: { low: entryLow, high: entryHigh },
            stop_loss: stopLoss,
            take_profit_1: takeProfit1,
            take_profit_2: takeProfit2,
            risk_reward: 'pending validation',
            position_size_note: 'Risk only 1% or less',
            reasoning: reasons,
            invalid_if: invalidIf,
            warnings,
            bias,
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
        risk_reward: 'pending validation',
        position_size_note: 'Risk only 1% or less',
        reasoning: reasons,
        invalid_if: invalidIf,
        warnings,
        bias,
    };
}
async function completeStructuredTradePlan(alert, context, config) {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY must be set before using the TradingView webhook.');
    }
    const { system, user } = buildPrompt(alert, context, config);
    const plan = await (0, gemini_js_1.chatCompleteJSON)([
        { role: 'system', content: system },
        { role: 'user', content: user },
    ], { temperature: 0.1, maxTokens: 1800, feature: 'tradingview', operation: 'generate_trade_plan' });
    return { plan, raw: JSON.stringify(plan) };
}
async function generateTradePlan(alert, context, config) {
    try {
        return await completeStructuredTradePlan(alert, context, config);
    }
    catch (error) {
        const fallbackReason = error instanceof Error ? error.message : 'Unknown AI error';
        const fallbackPlan = buildHeuristicTradePlan(alert, context, config, fallbackReason);
        return {
            plan: fallbackPlan,
            raw: JSON.stringify({
                provider: 'heuristic-fallback',
                reason: fallbackReason,
            }),
        };
    }
}
function normalizeTextArray(value, fallback) {
    if (!Array.isArray(value))
        return fallback;
    const items = value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
    return items.length ? items : fallback;
}
function toNumeric(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
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
    if (entryLow <= 0 || entryHigh <= 0 || stop <= 0 || tp1 <= 0 || tp2 <= 0)
        return null;
    const entry = midpoint(entryLow, entryHigh);
    const risk = Math.abs(entry - stop);
    if (risk <= 0)
        return null;
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
    if (plan.decision === 'BUY')
        return stop < entryLow && tp1 > entry && tp2 > tp1;
    if (plan.decision === 'SELL')
        return stop > entryHigh && tp1 < entry && tp2 < tp1;
    return true;
}
function enforceRiskGuards(planRaw, alert, context, config) {
    const fallbackBias = normalizedDecisionToBias(planRaw.decision);
    const normalized = {
        decision: planRaw.decision === 'BUY' || planRaw.decision === 'SELL' || planRaw.decision === 'NO_TRADE' ? planRaw.decision : 'NO_TRADE',
        symbol: alert.symbol,
        timeframe: alert.timeframe,
        confidence: Math.max(0, Math.min(100, Number(planRaw.confidence ?? 0))),
        entry_zone: {
            low: toNumeric(planRaw.entry_zone?.low),
            high: toNumeric(planRaw.entry_zone?.high),
        },
        stop_loss: toNumeric(planRaw.stop_loss),
        take_profit_1: toNumeric(planRaw.take_profit_1),
        take_profit_2: toNumeric(planRaw.take_profit_2),
        risk_reward: typeof planRaw.risk_reward === 'string' ? planRaw.risk_reward : 'unverified',
        position_size_note: typeof planRaw.position_size_note === 'string' ? planRaw.position_size_note : 'Risk only 1% or less',
        reasoning: normalizeTextArray(planRaw.reasoning, ['Wait for clearer confirmation.']),
        invalid_if: normalizeTextArray(planRaw.invalid_if, ['Market structure breaks against the idea.']),
        warnings: normalizeTextArray(planRaw.warnings, []),
        bias: planRaw.bias === 'bullish' || planRaw.bias === 'bearish' || planRaw.bias === 'neutral' ? planRaw.bias : fallbackBias,
    };
    const riskAmount = Number((config.accountSize * (config.riskPercent / 100)).toFixed(2));
    normalized.risk_amount = riskAmount;
    normalized.position_size_formula = 'position_size = risk_amount / abs(entry_price - stop_loss)';
    normalized.position_size_note = `Risk only ${config.riskPercent}% or less. Example risk on $${config.accountSize}: $${riskAmount}.`;
    const hasBlockingNews = context.upcomingUsdNews.some((event) => event.impact === 'high' && event.minutesUntil >= -5 && event.minutesUntil <= config.blockNewsMinutes);
    const rr = computeRiskReward(normalized);
    const directionAligned = alignsWithDirection(normalized);
    if (!directionAligned)
        normalized.warnings.push('Returned levels do not align with the stated trade direction.');
    if (hasBlockingNews)
        normalized.warnings.push(`High-impact USD news is scheduled within ${config.blockNewsMinutes} minutes.`);
    if (rr !== null) {
        normalized.risk_reward = `1:${Number(rr.toFixed(2))}`;
    }
    else {
        normalized.warnings.push('Risk-to-reward could not be verified from the returned levels.');
    }
    if (!directionAligned || rr === null || rr < config.minRiskReward || hasBlockingNews || (normalized.decision !== 'NO_TRADE' && normalized.stop_loss <= 0)) {
        return {
            ...normalized,
            decision: 'NO_TRADE',
            confidence: Math.min(normalized.confidence, 45),
            entry_zone: { low: 0, high: 0 },
            stop_loss: 0,
            take_profit_1: 0,
            take_profit_2: 0,
            reasoning: [...normalized.reasoning, 'Post-analysis risk guards downgraded the setup to NO_TRADE.'],
        };
    }
    return normalized;
}
function normalizedDecisionToBias(decision) {
    if (decision === 'BUY')
        return 'bullish';
    if (decision === 'SELL')
        return 'bearish';
    return 'neutral';
}
function formatNotification(alert, plan, context) {
    return [
        `PAIR: ${plan.symbol}`,
        `DECISION: ${plan.decision}`,
        `BIAS: ${plan.bias ?? 'neutral'}`,
        `ENTRY: ${plan.entry_zone.low && plan.entry_zone.high ? `${plan.entry_zone.low} - ${plan.entry_zone.high}` : 'WAIT'}`,
        `SL: ${plan.stop_loss || 'N/A'}`,
        `TP1: ${plan.take_profit_1 || 'N/A'}`,
        `TP2: ${plan.take_profit_2 || 'N/A'}`,
        `RR: ${plan.risk_reward}`,
        `CONFIDENCE: ${plan.confidence}`,
        `WHY: ${plan.reasoning.join(' | ')}`,
        `INVALIDATION: ${plan.invalid_if.join(' | ')}`,
        `WARNING: ${[...plan.warnings, ...context.dataWarnings].join(' | ') || 'None'}`,
        `SESSION: ${context.sessionLabel}`,
        `SIGNAL: ${alert.signalType}`,
    ].join('\n');
}
async function postJson(url, body) {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!response.ok)
        throw new Error(`HTTP ${response.status}`);
}
async function sendNotifications(alert, plan, context) {
    const message = formatNotification(alert, plan, context);
    const deliveries = [];
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
        try {
            await postJson(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                chat_id: process.env.TELEGRAM_CHAT_ID,
                text: message,
            });
            deliveries.push({ channel: 'telegram', delivered: true, detail: 'Delivered to Telegram' });
        }
        catch (error) {
            deliveries.push({ channel: 'telegram', delivered: false, detail: error instanceof Error ? error.message : 'Telegram failed' });
        }
    }
    if (process.env.DISCORD_WEBHOOK_URL) {
        try {
            await postJson(process.env.DISCORD_WEBHOOK_URL, { content: message });
            deliveries.push({ channel: 'discord', delivered: true, detail: 'Delivered to Discord' });
        }
        catch (error) {
            deliveries.push({ channel: 'discord', delivered: false, detail: error instanceof Error ? error.message : 'Discord failed' });
        }
    }
    if (!deliveries.length) {
        deliveries.push({ channel: 'dashboard', delivered: true, detail: 'Stored for dashboard display only' });
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
    const config = getConfig();
    const alert = parseTradingviewPayload(payload);
    assertWebhookSecret(alert.secret);
    const existing = (await readRecords()).find((record) => record.fingerprint === alert.fingerprint);
    if (existing) {
        const ageMs = Date.now() - new Date(existing.receivedAt).getTime();
        if (ageMs <= config.duplicateWindowMinutes * 60 * 1000) {
            return { duplicate: true, record: existing };
        }
    }
    const baseRecord = {
        id: (0, node_crypto_1.randomUUID)(),
        fingerprint: alert.fingerprint,
        status: 'received',
        symbol: alert.symbol,
        timeframe: alert.timeframe,
        receivedAt: alert.receivedAt,
        alert,
        context: null,
        analysis: null,
        notifications: [],
        response: null,
        error: null,
    };
    await saveRecord(baseRecord);
    try {
        const context = await buildTradingContext(alert);
        const { plan: rawPlan, raw } = await generateTradePlan(alert, context, config);
        const finalPlan = enforceRiskGuards(rawPlan, alert, context, config);
        const notifications = await sendNotifications(alert, finalPlan, context);
        const processedRecord = {
            ...baseRecord,
            status: 'processed',
            context,
            analysis: finalPlan,
            notifications,
            response: { raw_ai_response: raw },
        };
        await saveRecord(processedRecord);
        return { duplicate: false, record: processedRecord };
    }
    catch (error) {
        const failedRecord = {
            ...baseRecord,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
        };
        await saveRecord(failedRecord);
        throw error;
    }
}
async function analyzeTradingSignal(payload) {
    const config = getConfig();
    const alert = parseTradingviewPayload(payload);
    const context = await buildTradingContext(alert);
    const { plan: rawPlan, raw } = await generateTradePlan(alert, context, config);
    const analysis = enforceRiskGuards(rawPlan, alert, context, config);
    return {
        alert,
        context,
        analysis,
        raw,
    };
}
