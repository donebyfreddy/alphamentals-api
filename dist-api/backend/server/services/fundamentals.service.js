"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setScheduleNextRun = setScheduleNextRun;
exports.getScheduleMetadata = getScheduleMetadata;
exports.refreshFundamentalsData = refreshFundamentalsData;
exports.fetchAndStoreNews = fetchAndStoreNews;
exports.fetchAndStoreEconomicEvents = fetchAndStoreEconomicEvents;
exports.runFundamentalAnalysis = runFundamentalAnalysis;
exports.getFundamentalsOverview = getFundamentalsOverview;
exports.getFundamentalsForSymbol = getFundamentalsForSymbol;
exports.getFundamentalsNews = getFundamentalsNews;
exports.getFundamentalsEvents = getFundamentalsEvents;
exports.getFundamentalSourceStatus = getFundamentalSourceStatus;
exports.bootstrapFundamentals = bootstrapFundamentals;
const finnhub_js_1 = require("../lib/finnhub.js");
const gemini_js_1 = require("../lib/gemini.js");
const supabase_js_1 = require("../lib/supabase.js");
const fundamentalSources_js_1 = require("../../../src/config/fundamentalSources.js");
const economicEvents_js_1 = require("../../../src/config/economicEvents.js");
const fmpNewsService_js_1 = require("../../../src/services/news/fmpNewsService.js");
const rssNewsService_js_1 = require("../../../src/services/news/rssNewsService.js");
const playwrightNewsScraper_js_1 = require("../../../src/services/news/playwrightNewsScraper.js");
const newsDeduplicator_js_1 = require("../../../src/services/news/newsDeduplicator.js");
const politicalInfluenceService_js_1 = require("../../../src/services/fundamentals/politicalInfluenceService.js");
const centralBankService_js_1 = require("../../../src/services/fundamentals/centralBankService.js");
const currencyImpactMapper_js_1 = require("../../../src/services/fundamentals/currencyImpactMapper.js");
const fundamentalEvents_js_1 = require("../../../src/lib/fundamentalEvents.js");
// fundamentalAnalysisService exports are no longer used here; batch prompt is built inline.
const rulesBasedBiasEngine_js_1 = require("../../../src/services/fundamentals/rulesBasedBiasEngine.js");
const tradeWarningService_js_1 = require("../../../src/services/fundamentals/tradeWarningService.js");
function getFundamentalsAiModel() {
    return process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
}
const SUPPORTED_SYMBOLS = [
    'XAU/USD', 'XAG/USD',
    'EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'NZD/USD',
    'USD/CAD', 'USD/CHF', 'GBP/JPY', 'EUR/JPY', 'EUR/GBP',
    'DXY', 'USOIL',
    'NAS100', 'SPX500', 'US30', 'US100', 'GER40',
    'BTC/USD', 'ETH/USD',
];
const SCHEDULE_TZ = fundamentalEvents_js_1.APP_EVENT_TIMEZONE;
const memoryStore = {
    articles: [],
    events: [],
    pairBiases: [],
    sourceStatus: fundamentalSources_js_1.FUNDAMENTAL_SOURCES.map((source) => ({
        id: source.id,
        name: source.name,
        type: source.type,
        enabled: source.enabled,
        categories: source.categories,
        status: 'idle',
        articleCount: 0,
        lastFetchedAt: null,
        lastError: null,
        fallbackUsed: false,
    })),
    lastUpdated: null,
    lastWarning: null,
    lastErrors: [],
    scheduleMetadata: {
        generatedAt: null,
        generatedTimezone: SCHEDULE_TZ,
        nextScheduledRun: null,
        triggeredBy: null,
    },
};
let dbUnavailableLogged = false;
function isDbConnectionError(error) {
    if (!(0, supabase_js_1.isDatabaseConfigured)())
        return true;
    if (!(error instanceof Error))
        return false;
    const msg = error.message ?? '';
    return msg.includes('ECONNREFUSED') || msg.includes('fetch failed') || msg.includes('network');
}
function logDbUnavailable(error) {
    if (dbUnavailableLogged)
        return;
    dbUnavailableLogged = true;
    console.warn('[fundamentals] DB unavailable, using in-memory store only:', error instanceof Error ? error.message : error);
}
async function ensureTables() {
    if (!(0, supabase_js_1.isDatabaseConfigured)()) {
        logDbUnavailable('Supabase not configured');
        return false;
    }
    try {
        // Ping the DB — tables are created via supabase-schema.sql
        const { error } = await supabase_js_1.supabase.from('news_articles').select('id').limit(1);
        if (error) {
            logDbUnavailable(error.message);
            return false;
        }
        dbUnavailableLogged = false;
        return true;
    }
    catch (error) {
        logDbUnavailable(error);
        return false;
    }
}
function updateSourceStatus(id, patch) {
    const index = memoryStore.sourceStatus.findIndex((row) => row.id === id);
    if (index === -1)
        return;
    memoryStore.sourceStatus[index] = { ...memoryStore.sourceStatus[index], ...patch };
}
function logSourceStart(source) {
    console.info(`[fundamentals] source started: ${source.name}`);
    updateSourceStatus(source.id, { status: 'idle', lastError: null, fallbackUsed: false });
}
function logSourceSuccess(source, count) {
    console.info(`[fundamentals] source succeeded: ${source.name} (${count} articles/items)`);
    updateSourceStatus(source.id, {
        status: 'ok',
        articleCount: count,
        lastFetchedAt: new Date().toISOString(),
        lastError: null,
    });
}
function toErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function logSourceFailed(source, error, fallbackUsed = false) {
    const message = toErrorMessage(error);
    console.warn(`[fundamentals] source failed: ${source.name} -> ${message}`);
    updateSourceStatus(source.id, {
        status: fallbackUsed ? 'ok' : 'failed',
        articleCount: 0,
        lastFetchedAt: new Date().toISOString(),
        lastError: message,
        fallbackUsed,
    });
    memoryStore.lastErrors.push(`${source.name}: ${message}`);
}
function makeArticleId(article) {
    const raw = article.url ?? [article.title, article.publishedAt].join('|');
    return `news_${Buffer.from(raw).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24)}`;
}
function inferTopicTags(article) {
    const text = [article.title, article.summary, article.contentSnippet].filter(Boolean).join(' ').toLowerCase();
    const tags = [];
    if (text.includes('powell') || text.includes('federal reserve') || text.includes('fomc'))
        tags.push('fed');
    if (text.includes('hawkish'))
        tags.push('hawkish-fed');
    if (text.includes('dovish'))
        tags.push('dovish-fed');
    if (text.includes('treasury yields') || text.includes('yield'))
        tags.push('rising-yields');
    if (text.includes('geopolitical') || text.includes('war') || text.includes('sanctions'))
        tags.push('geopolitical', 'risk-off');
    if (text.includes('tariff') || text.includes('trade war') || text.includes('donald trump') || text.includes('trump'))
        tags.push('politics');
    if (article.affectedCurrencies.includes('XAU'))
        tags.push('gold');
    return Array.from(new Set(tags));
}
function computeRelevanceScore(article) {
    let impactWeight;
    if (article.impact === 'high') {
        impactWeight = 100;
    }
    else if (article.impact === 'medium') {
        impactWeight = 60;
    }
    else {
        impactWeight = 20;
    }
    const ageMs = Date.now() - new Date(article.publishedAt).getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    let recencyFactor;
    if (ageHours <= 6) {
        recencyFactor = 1;
    }
    else if (ageHours <= 24) {
        recencyFactor = 0.7;
    }
    else if (ageHours <= 72) {
        recencyFactor = 0.3;
    }
    else {
        recencyFactor = 0.05;
    }
    const macroBonus = article.macroCategory.length * 5;
    return Math.round(impactWeight * recencyFactor + macroBonus);
}
function normalizeArticle(article) {
    const affectedSymbols = article.affectedSymbols.filter((item) => SUPPORTED_SYMBOLS.includes(item));
    const macroCategory = (0, currencyImpactMapper_js_1.detectMacroCategories)({
        title: article.title,
        summary: article.summary,
        contentSnippet: article.contentSnippet,
    });
    const marketImpactExplanation = (0, currencyImpactMapper_js_1.generateMarketImpactExplanation)(macroCategory, affectedSymbols);
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
        rawData: article.rawData,
    };
    normalized.topicTags = inferTopicTags(normalized);
    normalized.relevanceScore = computeRelevanceScore(normalized);
    return normalized;
}
const FRESHNESS_CUTOFF_MS = 72 * 60 * 60 * 1000; // 72h default
const HIGH_IMPACT_FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000; // 7 days for high-impact
function dedupeAndSortArticles(articles) {
    const deduped = (0, newsDeduplicator_js_1.deduplicateArticles)(articles).map((article) => normalizeArticle(article));
    const byId = new Map();
    for (const article of deduped) {
        byId.set(article.id, article);
    }
    const now = Date.now();
    const fresh = Array.from(byId.values()).filter((article) => {
        const ageMs = now - new Date(article.publishedAt).getTime();
        const cutoff = article.impact === 'high' ? HIGH_IMPACT_FRESHNESS_MS : FRESHNESS_CUTOFF_MS;
        return ageMs <= cutoff;
    });
    // Sort by relevance score DESC (combines impact + recency + macro depth)
    return fresh.sort((a, b) => b.relevanceScore - a.relevanceScore);
}
function dedupeAndClassifyEvents(events) {
    const byId = new Map();
    for (const event of events) {
        if (!event.datetimeUtc)
            continue;
        byId.set(event.id, event);
    }
    return Array.from(byId.values())
        .sort((a, b) => +new Date(a.datetimeUtc) - +new Date(b.datetimeUtc));
}
function categorizeEconomicEvent(name) {
    const text = name.toLowerCase();
    if (/(cpi|ppi|inflation|pce)/.test(text))
        return 'inflation';
    if (/(employment|payroll|jobless|unemployment|wage|labor)/.test(text))
        return 'employment';
    if (/(fed|ecb|boe|boj|rba|boc|speech|minutes|rate decision|central bank)/.test(text))
        return 'central bank';
    if (/pmi/.test(text))
        return 'PMI';
    if (/gdp/.test(text))
        return 'GDP';
    if (/retail sales/.test(text))
        return 'retail sales';
    if (/(housing|home sales|building permits|starts)/.test(text))
        return 'housing';
    if (/(sentiment|confidence)/.test(text))
        return 'sentiment';
    return 'other';
}
function describeEconomicEvent(eventName, category) {
    const name = eventName.trim();
    const defaults = {
        inflation: {
            description: `${name} tracks inflation pressure and price growth trends.`,
            why: 'Inflation surprises can quickly change rate expectations, yields, and the USD or local currency.',
            impact: 'Higher-than-expected inflation can support the currency if markets expect tighter policy. Softer data can pressure yields and the currency.',
            volatility: 'Typically medium to high volatility, especially for USD pairs and gold.',
        },
        employment: {
            description: `${name} measures labour-market conditions, hiring strength, or wage pressure.`,
            why: 'Employment data is a core central-bank input and can reshape growth and rate expectations.',
            impact: 'Strong labour data can strengthen the local currency and pressure gold if yields rise. Weak data can do the opposite.',
            volatility: 'Often high volatility for major FX pairs around the release.',
        },
        'central bank': {
            description: `${name} reflects central-bank communication or policy direction.`,
            why: 'Central-bank speeches, minutes, and decisions can directly move rate expectations, yields, indices, and FX.',
            impact: 'Watch for comments on inflation, rates, liquidity, banking conditions, and economic outlook.',
            volatility: 'Can trigger sharp intraday volatility in the affected currency, gold, and risk assets.',
        },
        PMI: {
            description: `${name} measures business activity and momentum in manufacturing or services.`,
            why: 'PMI data helps traders gauge growth momentum before harder macro data is released.',
            impact: 'A strong surprise can lift the currency and risk sentiment. A weak print can hurt growth-sensitive assets.',
            volatility: 'Usually medium volatility, but can rise when growth is a dominant market theme.',
        },
        GDP: {
            description: `${name} measures the pace of economic growth.`,
            why: 'GDP releases shape macro growth expectations and can influence monetary policy expectations.',
            impact: 'Stronger GDP can support the currency and yields. Weak GDP can increase easing expectations.',
            volatility: 'Usually medium to high volatility depending on the surprise size.',
        },
        'retail sales': {
            description: `${name} measures consumer spending momentum.`,
            why: 'Consumer demand is a major driver of growth and inflation persistence.',
            impact: 'Strong retail sales can support the currency and risk sentiment; weak sales can weigh on growth expectations.',
            volatility: 'Usually medium volatility.',
        },
        housing: {
            description: `${name} tracks housing-market activity or construction demand.`,
            why: 'Housing is sensitive to rates and can signal how restrictive financial conditions are becoming.',
            impact: 'Stronger housing data can support growth expectations; weak housing data can reinforce slowdown concerns.',
            volatility: 'Usually low to medium volatility.',
        },
        sentiment: {
            description: `${name} measures confidence among consumers or businesses.`,
            why: 'Confidence data helps frame spending and investment appetite before harder data arrives.',
            impact: 'Strong sentiment can support growth-sensitive assets; weak sentiment can hurt risk appetite.',
            volatility: 'Usually low to medium volatility unless sentiment is a key macro focus.',
        },
        other: {
            description: `${name} is a scheduled macro event that can influence the related currency and correlated assets.`,
            why: 'Unexpected macro outcomes can affect rate expectations, relative growth, and short-term risk sentiment.',
            impact: 'Watch how the result changes expectations for the currency, yields, and correlated instruments.',
            volatility: 'Volatility impact depends on the size of the surprise and the current macro theme.',
        },
    };
    return defaults[category];
}
function formatTimeUntil(datetimeUtc, now = new Date()) {
    const diffMs = new Date(datetimeUtc).getTime() - now.getTime();
    if (diffMs <= 0)
        return 'expired';
    const minutes = Math.floor(diffMs / 60_000);
    if (minutes < 1)
        return 'today';
    if (minutes < 60)
        return `in ${minutes}m`;
    if (minutes < 24 * 60)
        return `in ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
    if (minutes < 48 * 60)
        return 'tomorrow';
    return `in ${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
}
function normalizeManualEvent(event) {
    const affectedSymbols = (0, currencyImpactMapper_js_1.detectAffectedSymbols)({
        eventName: event.eventName,
        currency: event.currency,
        impact: event.impact,
        title: event.eventName,
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
        date: '',
        time: '',
        timezone: SCHEDULE_TZ,
        providerTimezone: 'UTC',
        datetimeUtc: event.dateTime,
        datetimeLocal: event.dateTime,
        dateLabel: '',
        dateTimeLabel: '',
        previous: event.previous ?? null,
        forecast: event.forecast ?? null,
        actual: event.actual ?? null,
        eventTime: event.dateTime,
        fetchedAt: new Date().toISOString(),
        description: null,
        whyItMatters: null,
        potentialImpact: null,
        volatilityImpact: null,
        aiInterpretation: null,
        status: 'upcoming',
        affectedSymbols,
        timeUntil: 'today',
        blocksTrading: event.impact === 'high',
        blockWindow: event.impact === 'high' ? '30 minutes before/after' : null,
        tradeWarning: (0, tradeWarningService_js_1.deriveTradeStatus)({
            bias: 'neutral',
            confidence: 50,
            impact: event.impact,
            events: [{ impact: event.impact, eventTime: event.dateTime }],
        }) === 'avoid' ? 'avoid' : 'wait',
        rawData: { source: 'manual' },
        debug: {
            rawDateTime: event.dateTime,
            rawDate: null,
            rawTime: null,
            parsedDateTimeUtc: event.dateTime,
            appTimezone: SCHEDULE_TZ,
            nowUtc: new Date().toISOString(),
            classification: {
                status: 'upcoming',
                isToday: false,
                isThisWeek: false,
                isUpcoming: true,
                isPast: false,
                isNext4Hours: false,
            },
        },
    };
}
function enrichEconomicEvent(base, timingInput) {
    const now = timingInput.now ?? new Date();
    const timing = (0, fundamentalEvents_js_1.deriveFundamentalEventTiming)({
        rawDateTime: timingInput.rawDateTime,
        rawDate: timingInput.rawDate,
        rawTime: timingInput.rawTime,
        providerTimezone: timingInput.providerTimezone ?? 'UTC',
        appTimezone: SCHEDULE_TZ,
        now,
    });
    if (!timing)
        return null;
    const description = describeEconomicEvent(base.eventName, base.category);
    const released = timing.isPast && Boolean(base.actual);
    const event = {
        ...base,
        date: timing.date,
        time: timing.time,
        timezone: timing.timezone,
        providerTimezone: timing.providerTimezone,
        datetimeUtc: timing.datetimeUtc,
        datetimeLocal: timing.datetimeLocal,
        dateLabel: timing.dateLabel,
        dateTimeLabel: timing.dateTimeLabel,
        eventTime: timing.datetimeUtc,
        fetchedAt: now.toISOString(),
        description: description.description,
        whyItMatters: description.why,
        potentialImpact: description.impact,
        volatilityImpact: description.volatility,
        aiInterpretation: description.impact,
        status: released ? 'released' : timing.status,
        timeUntil: formatTimeUntil(timing.datetimeUtc, now),
        blocksTrading: base.impact === 'high',
        blockWindow: base.impact === 'high' ? '30 minutes before/after' : null,
        debug: {
            rawDateTime: timing.rawDateTime,
            rawDate: timing.rawDate,
            rawTime: timing.rawTime,
            parsedDateTimeUtc: timing.datetimeUtc,
            appTimezone: timing.timezone,
            nowUtc: now.toISOString(),
            classification: {
                status: released ? 'released' : timing.status,
                isToday: timing.isToday,
                isThisWeek: timing.isThisWeek,
                isUpcoming: timing.isUpcoming,
                isPast: timing.isPast,
                isNext4Hours: timing.isNext4Hours,
            },
        },
    };
    console.log('[fundamentals/events] classified', {
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
        isNext4Hours: event.debug.classification.isNext4Hours,
    });
    return event;
}
async function loadRssSources() {
    const rssSources = fundamentalSources_js_1.FUNDAMENTAL_SOURCES.filter((source) => source.enabled && source.type === 'rss');
    const results = [];
    for (const source of rssSources) {
        logSourceStart(source);
        try {
            const articles = await (0, rssNewsService_js_1.fetchRssArticles)([source]);
            const normalized = articles.map((article) => normalizeArticle(article));
            results.push(...normalized);
            logSourceSuccess(source, normalized.length);
        }
        catch (error) {
            logSourceFailed(source, error);
        }
    }
    return results;
}
async function loadApiSources() {
    const apiResults = [];
    const fmpSource = fundamentalSources_js_1.FUNDAMENTAL_SOURCES.find((source) => source.id === 'fmp-forex-news');
    if (fmpSource) {
        logSourceStart(fmpSource);
        if (process.env.FMP_API_KEY) {
            try {
                const [forex, general] = await Promise.all([(0, fmpNewsService_js_1.fetchForexNews)(), (0, fmpNewsService_js_1.fetchGeneralMarketNews)()]);
                const normalized = [...forex, ...general].map(normalizeArticle);
                apiResults.push(...normalized);
                logSourceSuccess(fmpSource, normalized.length);
            }
            catch (error) {
                logSourceFailed(fmpSource, error, true);
            }
        }
    }
    return apiResults;
}
async function loadPoliticalAndCentralBankSources() {
    const results = [];
    const political = await (0, politicalInfluenceService_js_1.fetchPoliticalHeadlines)().catch(() => []);
    const fed = await (0, centralBankService_js_1.fetchFedNews)().catch(() => []);
    const ecb = await (0, centralBankService_js_1.fetchEcbNews)().catch(() => []);
    const boe = await (0, centralBankService_js_1.fetchBoeNews)().catch(() => []);
    for (const article of [...political, ...fed, ...ecb, ...boe]) {
        results.push(normalizeArticle(article));
    }
    return results;
}
async function loadPlaywrightFallback(enable) {
    const source = fundamentalSources_js_1.FUNDAMENTAL_SOURCES.find((item) => item.id === 'playwright-fallback');
    if (!source)
        return [];
    if (!enable) {
        updateSourceStatus(source.id, { status: 'skipped', lastError: 'Disabled by settings', articleCount: 0 });
        return [];
    }
    logSourceStart(source);
    try {
        const articles = await (0, playwrightNewsScraper_js_1.scrapeFallbackNews)({ enabled: true });
        const normalized = articles.map((article) => normalizeArticle(article));
        logSourceSuccess(source, normalized.length);
        return normalized;
    }
    catch (error) {
        logSourceFailed(source, error);
        return [];
    }
}
async function loadEconomicEvents() {
    const manualSource = fundamentalSources_js_1.FUNDAMENTAL_SOURCES.find((source) => source.id === 'manual-economic-events');
    const events = [];
    const shouldUseManualEvents = process.env.ENABLE_MANUAL_ECONOMIC_EVENTS === 'true' && !process.env.FINNHUB_API_KEY;
    if (manualSource) {
        logSourceStart(manualSource);
        if (shouldUseManualEvents) {
            const manualEvents = economicEvents_js_1.MANUAL_ECONOMIC_EVENTS
                .map(normalizeManualEvent)
                .map((event) => enrichEconomicEvent(event, { rawDateTime: event.eventTime, providerTimezone: 'UTC' }))
                .filter((event) => Boolean(event));
            events.push(...manualEvents);
            logSourceSuccess(manualSource, manualEvents.length);
        }
        else {
            updateSourceStatus(manualSource.id, {
                status: 'skipped',
                articleCount: 0,
                lastFetchedAt: new Date().toISOString(),
                lastError: shouldUseManualEvents ? null : 'Manual economic events disabled when live provider data is available.',
            });
        }
    }
    try {
        const from = new Date(Date.now() - 6 * 60 * 60_000).toISOString().slice(0, 10);
        const to = new Date(Date.now() + 3 * 24 * 60 * 60_000).toISOString().slice(0, 10);
        const finnhubEvents = await (0, finnhub_js_1.fetchCalendar)(from, to);
        for (const event of finnhubEvents) {
            const affectedSymbols = (0, currencyImpactMapper_js_1.detectAffectedSymbols)({
                title: event.title,
                eventName: event.title,
                currency: event.currency,
                impact: event.impact,
            }).filter((symbol) => SUPPORTED_SYMBOLS.includes(symbol));
            const normalized = enrichEconomicEvent({
                id: `finnhub_${Buffer.from([event.title, event.date, event.time].join('|')).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24)}`,
                source: 'Finnhub',
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
                tradeWarning: (0, tradeWarningService_js_1.deriveTradeStatus)({
                    bias: 'neutral',
                    confidence: 50,
                    impact: (0, currencyImpactMapper_js_1.detectImpactLevel)({ title: event.title, currency: event.currency, impact: event.impact }),
                    events: [{ impact: event.impact, eventTime: `${event.date}T${event.time}:00Z` }],
                }) === 'avoid' ? 'avoid' : 'wait',
                rawData: event,
            }, {
                rawDate: event.date,
                rawTime: event.time,
                providerTimezone: 'UTC',
            });
            if (normalized)
                events.push(normalized);
        }
    }
    catch (error) {
        memoryStore.lastErrors.push(`Finnhub calendar: ${error instanceof Error ? error.message : String(error)}`);
    }
    return dedupeAndClassifyEvents(events);
}
function buildEmptyPair(symbol) {
    return {
        id: `pair_${symbol.replace('/', '')}`,
        symbol,
        bias: 'unknown',
        confidence: 0,
        impact: 'unknown',
        tradeStatus: 'unknown',
        reason: `No fundamentals data yet for ${symbol}. Click Refresh Fundamentals to fetch latest news.`,
        keyDrivers: [],
        relatedArticleIds: [],
        relatedEventIds: [],
        updatedAt: new Date().toISOString(),
    };
}
function inferTradeModeFromBias(bias) {
    if (bias === 'bullish')
        return 'favor_buys';
    if (bias === 'bearish')
        return 'favor_sells';
    return 'wait';
}
function inferDataFreshness(articles, events) {
    const timestamps = [
        ...articles.map((article) => article.publishedAt || article.fetchedAt),
        ...events.map((event) => event.datetimeUtc || event.fetchedAt),
    ]
        .map((value) => new Date(value).getTime())
        .filter((value) => Number.isFinite(value));
    if (!timestamps.length)
        return 'unknown';
    const newest = Math.max(...timestamps);
    const ageHours = (Date.now() - newest) / (1000 * 60 * 60);
    if (ageHours <= 6)
        return 'fresh';
    if (ageHours <= 24)
        return 'aging';
    return 'stale';
}
// ── AI batch cache & rate-limit state ────────────────────────────────────────
const AI_CACHE_TTL_MS = process.env.NODE_ENV === 'production' ? 12 * 60_000 : 5 * 60_000;
const aiState = {
    cachedBiases: null,
    cacheExpiresAt: 0,
    lastAiRefresh: null,
    inFlight: null,
    rateLimitedUntil: null,
    rateLimitRetryAfter: null,
    requestsThisMinute: 0,
    requestWindowStart: Date.now(),
};
function tickRequestCounter() {
    const now = Date.now();
    if (now - aiState.requestWindowStart > 60_000) {
        aiState.requestsThisMinute = 0;
        aiState.requestWindowStart = now;
    }
    aiState.requestsThisMinute += 1;
}
function isRateLimited() {
    if (aiState.rateLimitedUntil == null)
        return false;
    if (Date.now() < aiState.rateLimitedUntil)
        return true;
    aiState.rateLimitedUntil = null;
    aiState.rateLimitRetryAfter = null;
    return false;
}
function extractRetryAfterMs(error) {
    const msg = toErrorMessage(error);
    const match = /retry.*?after[^\d]*(\d+)/i.exec(msg) ?? /(\d+)\s*second/i.exec(msg);
    if (match)
        return Number.parseInt(match[1], 10) * 1000;
    return 60_000; // default 1 minute backoff
}
/** Build one batched prompt for all symbols at once. */
function buildBatchPrompt(rulesResults, articles, events) {
    const INSTRUMENT_CONTEXT = {
        'EUR/USD': 'Professional focus: ECB vs Fed divergence, Eurozone inflation/PMI/growth, US CPI/NFP, DXY direction, yield spreads, and risk sentiment. Separate intraday catalyst risk from swing bias.',
        'GBP/USD': 'Professional focus: BoE vs Fed divergence, UK inflation/jobs/GDP, US macro surprise risk, DXY direction, gilt vs Treasury yield spread, and political headlines.',
        'XAU/USD': 'Professional focus: US real yields, nominal yields, DXY direction, Fed expectations, inflation, labor data, safe-haven demand, and geopolitical headline risk. Treat stale macro narratives conservatively.',
        'DXY': 'Professional focus: Fed path, US CPI/NFP/GDP, Treasury yields, positioning, and global risk sentiment. Explain inverse or confirming pressure on EUR, GBP, Gold, and Oil.',
        'USOIL': 'Professional focus: OPEC+ supply discipline, EIA/API inventory flow, China/global demand, USD strength, inflation transmission, and geopolitical supply risk.',
    };
    const symbolBlocks = rulesResults.map((r) => {
        const compactKey = r.symbol.replace('/', '');
        const matchedArticles = articles.filter((a) => r.articleIds.includes(a.id));
        const matchedEvents = events.filter((e) => r.eventIds.includes(e.id));
        const relArticles = matchedArticles
            .slice(0, 6)
            .map((a) => ({
            title: a.title,
            sentiment: a.sentiment,
            impact: a.impact,
            publishedAt: a.publishedAt,
            source: a.source,
        }));
        const relEvents = matchedEvents
            .slice(0, 5)
            .map((e) => ({
            eventName: e.eventName,
            impact: e.impact,
            currency: e.currency,
            date: e.date,
            time: e.time,
            actual: e.actual,
            forecast: e.forecast,
            previous: e.previous,
        }));
        const sourceQuality = {
            articleCount: matchedArticles.length,
            eventCount: matchedEvents.length,
            dataFreshness: inferDataFreshness(matchedArticles, matchedEvents),
        };
        return `### ${compactKey} (${r.symbol})
Instrument context: ${INSTRUMENT_CONTEXT[r.symbol] ?? 'Macro instrument.'}
Rules-based context: ${r.reason}
Source quality baseline: ${JSON.stringify(sourceQuality)}
Related articles: ${JSON.stringify(relArticles)}
Related events: ${JSON.stringify(relEvents)}`;
    }).join('\n\n');
    const keyShape = rulesResults.map((r) => `"${r.symbol.replace('/', '')}": {
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
  }`).join(',\n  ');
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
    console.info('[Fundamentals AI] batch request start', {
        provider: 'openai',
        model: getFundamentalsAiModel(),
        symbols: rulesResults.map((r) => r.symbol).join(', '),
        requestsThisMinute: aiState.requestsThisMinute,
    });
    const prompt = buildBatchPrompt(rulesResults.map((r) => ({ symbol: r.symbol, reason: r.reason, articleIds: r.relatedArticleIds, eventIds: r.relatedEventIds })), articles, events);
    const raw = await (0, gemini_js_1.chatCompleteJSON)([
        {
            role: 'system',
            content: 'You are the AlphaMentals professional macro/fundamental analyst. Return JSON only. Use only the provided rules-based context, related articles, related events, and instrument context. Do not invent macro drivers, events, headlines, or technical structure. Lower confidence when source quality is weak, mixed, or stale. Separate intraday and swing thinking, include intermarket context when supported, and keep trader guidance practical but not promotional.',
        },
        { role: 'user', content: prompt },
    ], { temperature: 0.1, maxTokens: 1500, model: getFundamentalsAiModel(), feature: 'fundamentals', operation: 'generate_pair_fundamentals' });
    const durationMs = Date.now() - startMs;
    console.info('[Fundamentals AI] batch request success', { provider: 'openai', model: getFundamentalsAiModel(), durationMs, status: 'success' });
    // Merge AI results back over rules-based rows
    const now = new Date().toISOString();
    return rulesResults.map((row) => {
        const compactKey = row.symbol.replace('/', '');
        const aiEntry = raw[compactKey];
        if (!aiEntry || typeof aiEntry.bias !== 'string')
            return row;
        return {
            ...row,
            bias: ['bullish', 'bearish', 'neutral', 'mixed'].includes(aiEntry.bias) ? aiEntry.bias : row.bias,
            confidence: typeof aiEntry.confidence === 'number' ? Math.max(0, Math.min(100, aiEntry.confidence)) : row.confidence,
            impact: ['low', 'medium', 'high'].includes(aiEntry.impact) ? aiEntry.impact : row.impact,
            tradeStatus: ['safe', 'wait', 'avoid'].includes(aiEntry.tradeStatus) ? aiEntry.tradeStatus : row.tradeStatus,
            reason: typeof aiEntry.reason === 'string' ? aiEntry.reason : row.reason,
            keyDrivers: Array.isArray(aiEntry.keyDrivers) ? aiEntry.keyDrivers : row.keyDrivers,
            tradeMode: aiEntry.tradeMode && ['favor_buys', 'favor_sells', 'wait', 'avoid'].includes(aiEntry.tradeMode)
                ? aiEntry.tradeMode
                : row.tradeMode ?? inferTradeModeFromBias(aiEntry.bias),
            calendarRisk: aiEntry.calendarRisk && ['low', 'medium', 'high'].includes(aiEntry.calendarRisk)
                ? aiEntry.calendarRisk
                : row.calendarRisk ?? (row.impact === 'unknown' ? 'medium' : row.impact),
            headlineRisk: aiEntry.headlineRisk && ['low', 'medium', 'high', 'unavailable'].includes(aiEntry.headlineRisk)
                ? aiEntry.headlineRisk
                : row.headlineRisk,
            timeHorizon: aiEntry.timeHorizon ?? row.timeHorizon,
            decisionSummary: typeof aiEntry.decisionSummary === 'string' ? aiEntry.decisionSummary : row.decisionSummary ?? aiEntry.reason,
            fundamentalSummary: typeof aiEntry.fundamentalSummary === 'string' ? aiEntry.fundamentalSummary : row.fundamentalSummary ?? aiEntry.reason,
            technicalMacroBridge: typeof aiEntry.technicalMacroBridge === 'string' ? aiEntry.technicalMacroBridge : row.technicalMacroBridge,
            macroDrivers: Array.isArray(aiEntry.macroDrivers) ? aiEntry.macroDrivers : row.macroDrivers ?? row.keyDrivers,
            watchEvents: Array.isArray(aiEntry.watchEvents) ? aiEntry.watchEvents : row.watchEvents,
            keyRisks: Array.isArray(aiEntry.keyRisks) ? aiEntry.keyRisks : row.keyRisks,
            invalidationConditions: Array.isArray(aiEntry.invalidationConditions) ? aiEntry.invalidationConditions : row.invalidationConditions,
            whatToDo: Array.isArray(aiEntry.whatToDo) ? aiEntry.whatToDo : row.whatToDo,
            intermarketContext: aiEntry.intermarketContext ?? row.intermarketContext,
            sourceQuality: aiEntry.sourceQuality ?? row.sourceQuality,
            updatedAt: now,
        };
    });
}
async function runPairAnalysis(articles, events) {
    // Build rules-based baseline for all symbols
    const rulesResults = SUPPORTED_SYMBOLS.map((symbol) => {
        const r = (0, rulesBasedBiasEngine_js_1.calculateRulesBasedBias)({ symbol, articles, events, sourceStale: !memoryStore.lastUpdated });
        const matchedArticles = articles.filter((article) => r.articleIds.includes(article.id));
        const matchedEvents = events.filter((event) => r.eventIds.includes(event.id));
        return {
            id: `pair_${symbol.replace('/', '')}`,
            symbol,
            bias: r.bias,
            confidence: r.confidence,
            impact: r.impact,
            tradeStatus: r.tradeStatus,
            reason: r.reason,
            keyDrivers: r.keyDrivers,
            relatedArticleIds: r.articleIds,
            relatedEventIds: r.eventIds,
            updatedAt: new Date().toISOString(),
            tradeMode: inferTradeModeFromBias(r.bias),
            calendarRisk: r.impact === 'unknown' ? 'medium' : r.impact,
            headlineRisk: 'unavailable',
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
                dataFreshness: inferDataFreshness(matchedArticles, matchedEvents),
            },
        };
    });
    const aiEnabled = Boolean(process.env.OPENAI_API_KEY);
    const hasContent = rulesResults.some((r) => r.relatedArticleIds.length || r.relatedEventIds.length);
    if (!aiEnabled || !hasContent) {
        return rulesResults;
    }
    // Return cached AI result if still valid
    if (aiState.cachedBiases && Date.now() < aiState.cacheExpiresAt) {
        console.info('[Fundamentals AI] cache hit — skipping provider call', { model: getFundamentalsAiModel(), expiresIn: Math.round((aiState.cacheExpiresAt - Date.now()) / 1000) + 's' });
        aiState.cachedBiases = aiState.cachedBiases.map((cached, i) => ({
            ...cached,
            relatedArticleIds: rulesResults[i]?.relatedArticleIds ?? cached.relatedArticleIds,
            relatedEventIds: rulesResults[i]?.relatedEventIds ?? cached.relatedEventIds,
        }));
        return aiState.cachedBiases;
    }
    // Rate-limited — return rules-based, warn
    if (isRateLimited()) {
        const retryIn = aiState.rateLimitedUntil ? Math.round((aiState.rateLimitedUntil - Date.now()) / 1000) : '?';
        console.warn('[Fundamentals AI] rate-limited — returning rules-based result', { retryInSeconds: retryIn });
        memoryStore.lastErrors.push(`Fundamentals AI temporarily rate-limited. Retry in ~${retryIn}s.`);
        return aiState.cachedBiases ?? rulesResults;
    }
    // Deduplicate: if a batch call is already in flight, reuse it
    if (aiState.inFlight != null) {
        console.info('[Fundamentals AI] dedup — reusing in-flight batch request');
        return aiState.inFlight;
    }
    const batchPromise = callBatchAI(rulesResults, articles, events)
        .then((enriched) => {
        aiState.cachedBiases = enriched;
        aiState.cacheExpiresAt = Date.now() + AI_CACHE_TTL_MS;
        aiState.lastAiRefresh = new Date().toISOString();
        aiState.inFlight = null;
        enriched.forEach((row) => console.info(`[fundamentals] pair analysis completed: ${row.symbol} -> ${row.bias} (${row.confidence})`));
        return enriched;
    })
        .catch((error) => {
        aiState.inFlight = null;
        const message = error instanceof Error ? error.message : String(error);
        const is429 = /429|quota|resource.?exhausted|rate.?limit/i.test(message);
        if (is429) {
            const backoffMs = extractRetryAfterMs(error);
            aiState.rateLimitedUntil = Date.now() + backoffMs;
            aiState.rateLimitRetryAfter = new Date(aiState.rateLimitedUntil).toISOString();
            console.warn('[Fundamentals AI] 429 rate limit hit', {
                model: getFundamentalsAiModel(),
                backoffMs,
                retryAfter: aiState.rateLimitRetryAfter,
            });
            memoryStore.lastErrors.push(`Fundamentals AI rate-limited (429). Next retry allowed after ${aiState.rateLimitRetryAfter}.`);
        }
        else {
            console.warn('[Fundamentals AI] batch request failed', { model: getFundamentalsAiModel(), error: message });
            memoryStore.lastErrors.push(`Fundamentals AI batch failed: ${message}`);
        }
        // Return cached biases if available, else fall back to rules-based
        return aiState.cachedBiases ?? rulesResults;
    });
    aiState.inFlight = batchPromise;
    return batchPromise;
}
async function persistBestEffort() {
    const canUseDb = await ensureTables();
    if (!canUseDb)
        return;
    try {
        const rows = memoryStore.sourceStatus.map((source) => ({
            id: source.id,
            name: source.name,
            type: source.type,
            url: fundamentalSources_js_1.FUNDAMENTAL_SOURCES.find((c) => c.id === source.id)?.url ?? '',
            enabled: source.enabled,
            categories: source.categories,
            last_fetched_at: source.lastFetchedAt,
            last_status: source.status,
            last_error: source.lastError,
        }));
        await supabase_js_1.supabase.from('fundamental_sources').upsert(rows, { onConflict: 'id' });
    }
    catch (error) {
        logDbUnavailable(error);
    }
    // Persist per-symbol biases so they survive Render restarts.
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
                updated_at: row.updatedAt,
            }));
            await supabase_js_1.supabase.from('pair_fundamental_biases').upsert(biasRows, { onConflict: 'id' });
        }
        catch (error) {
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
                updatedAt: new Date().toISOString(),
            }));
            await supabase_js_1.supabase.from('economic_events').upsert(eventRows, { onConflict: 'id' });
        }
        catch (error) {
            logDbUnavailable(error);
        }
    }
}
function getMode() {
    return process.env.OPENAI_API_KEY ? 'ai-enhanced' : 'rules-based';
}
function buildWarning() {
    const missingApiSources = memoryStore.sourceStatus.filter((source) => source.status === 'failed' && source.lastError?.includes('API key missing'));
    const fallbackSourceUsed = memoryStore.sourceStatus.some((source) => source.fallbackUsed);
    if (missingApiSources.length && memoryStore.articles.length) {
        return `${missingApiSources.map((source) => source.name).join(', ')} failed because API key is missing. RSS fallback loaded ${memoryStore.articles.length} articles.`;
    }
    if (!memoryStore.articles.length && !memoryStore.events.length) {
        return 'No sources returned data. Check internet connection, source config, or enable Playwright fallback.';
    }
    if (fallbackSourceUsed) {
        return 'Some sources failed, but fallback sources were used.';
    }
    return null;
}
function formatMadridTs(date) {
    return date.toLocaleString('en-GB', {
        timeZone: SCHEDULE_TZ,
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
        hour12: false,
    }) + ` ${SCHEDULE_TZ}`;
}
function setScheduleNextRun(nextRunAt) {
    memoryStore.scheduleMetadata.nextScheduledRun = formatMadridTs(nextRunAt);
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
        loadEconomicEvents(),
    ]);
    let articles = dedupeAndSortArticles([...rssArticles, ...apiArticles, ...politicalArticles]);
    if (articles.length > 0) {
        await loadPlaywrightFallback(false);
    }
    else {
        const fallbackArticles = await loadPlaywrightFallback(Boolean(options?.enablePlaywrightFallback));
        articles = dedupeAndSortArticles(fallbackArticles);
    }
    memoryStore.articles = articles.slice(0, 200);
    memoryStore.events = events.slice(0, 100);
    memoryStore.pairBiases = articles.length || events.length
        ? await runPairAnalysis(memoryStore.articles, memoryStore.events)
        : SUPPORTED_SYMBOLS.map(buildEmptyPair);
    const now = new Date();
    memoryStore.lastUpdated = now.toISOString();
    memoryStore.lastWarning = buildWarning();
    memoryStore.scheduleMetadata = {
        generatedAt: formatMadridTs(now),
        generatedTimezone: SCHEDULE_TZ,
        nextScheduledRun: memoryStore.scheduleMetadata.nextScheduledRun,
        triggeredBy: options?.triggeredBy ?? memoryStore.scheduleMetadata.triggeredBy ?? 'manual',
    };
    await persistBestEffort();
    return getFundamentalsOverview();
}
async function fetchAndStoreNews(options) {
    const overview = await refreshFundamentalsData(options);
    return { stored: overview.latestNews.length };
}
async function fetchAndStoreEconomicEvents() {
    memoryStore.events = await loadEconomicEvents();
    return { stored: memoryStore.events.length };
}
async function runFundamentalAnalysis(symbols = SUPPORTED_SYMBOLS) {
    const filteredSymbols = new Set(symbols.map(normalizeFundamentalSymbol));
    const fresh = memoryStore.articles.length || memoryStore.events.length
        ? await runPairAnalysis(memoryStore.articles, memoryStore.events)
        : SUPPORTED_SYMBOLS.map(buildEmptyPair);
    // MERGE: update only the requested symbols, preserve others already in memory.
    // Replacing the whole array was wiping every other symbol whenever a single-symbol
    // on-demand analysis ran (e.g. cold page load for XAUUSD erased EURUSD, etc.).
    const updated = fresh.filter((row) => filteredSymbols.has(row.symbol));
    const kept = memoryStore.pairBiases.filter((row) => !filteredSymbols.has(row.symbol));
    memoryStore.pairBiases = [...kept, ...updated];
    return updated;
}
function getFundamentalsOverview() {
    const now = Date.now();
    // Sync per-minute request counter so diagnostics reflect current window
    if (now - aiState.requestWindowStart > 60_000) {
        aiState.requestsThisMinute = 0;
        aiState.requestWindowStart = now;
    }
    const upcomingEvents = memoryStore.events
        .filter((event) => new Date(event.datetimeUtc).getTime() >= now)
        .sort((a, b) => +new Date(a.datetimeUtc) - +new Date(b.datetimeUtc))
        .slice(0, 30);
    const highImpactNext4Hours = upcomingEvents
        .filter((event) => event.impact === 'high' && new Date(event.datetimeUtc).getTime() <= now + (4 * 60 * 60 * 1000));
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
            cacheHit: aiState.cachedBiases != null && now < aiState.cacheExpiresAt,
            lastAiRefresh: aiState.lastAiRefresh,
            rateLimited: aiState.rateLimitedUntil != null && now < aiState.rateLimitedUntil,
            rateLimitRetryAfter: aiState.rateLimitRetryAfter,
            requestsThisMinute: aiState.requestsThisMinute,
        },
        scheduleMetadata: { ...memoryStore.scheduleMetadata },
    };
}
const NON_PAIR_SYMBOLS = new Set(['DXY', 'USOIL', 'NAS100', 'SPX500', 'US30', 'US100', 'GER40']);
function normalizeFundamentalSymbol(symbol) {
    const compact = symbol.replace('/', '').toUpperCase();
    if (NON_PAIR_SYMBOLS.has(compact))
        return compact;
    return `${compact.slice(0, 3)}/${compact.slice(3, 6)}`;
}
function getFundamentalsForSymbol(symbol) {
    const normalized = normalizeFundamentalSymbol(symbol);
    const latestBias = memoryStore.pairBiases.find((row) => row.symbol === normalized) ?? buildEmptyPair(normalized);
    return {
        latestBias,
        biasHistory: memoryStore.pairBiases.filter((row) => row.symbol === normalized),
        relatedArticles: memoryStore.articles.filter((article) => article.affectedSymbols.includes(normalized)).slice(0, 20),
        relatedEvents: memoryStore.events.filter((event) => event.affectedSymbols.includes(normalized)).slice(0, 20),
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
        // Attempt to hydrate from DB so a Render restart doesn't serve empty data
        // until the next scheduled job run.
        try {
            const nowIso = new Date().toISOString();
            const { data: storedEvents } = await supabase_js_1.supabase
                .from('economic_events')
                .select('*')
                .gte('eventTime', new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString())
                .order('eventTime', { ascending: true });
            if (storedEvents && storedEvents.length > 0) {
                memoryStore.events = storedEvents
                    .map((row) => enrichEconomicEvent({
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
                    tradeWarning: String(row.tradeWarning ?? 'wait').toLowerCase(),
                    rawData: null,
                }, {
                    rawDateTime: row.eventTime,
                    providerTimezone: 'UTC',
                    now: new Date(nowIso),
                }))
                    .filter((event) => Boolean(event));
            }
            const { data } = await supabase_js_1.supabase
                .from('pair_fundamental_biases')
                .select('*')
                .order('updated_at', { ascending: false });
            if (data && data.length > 0) {
                // Keep only the freshest row per symbol (the query orders by updated_at DESC).
                const seen = new Set();
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
                            updatedAt: row.updated_at,
                        });
                    }
                }
                if (rows.length > 0) {
                    memoryStore.pairBiases = rows;
                    memoryStore.lastUpdated = rows[0]?.updatedAt ?? null;
                    console.info('[Fundamentals] Hydrated from DB', { symbols: rows.map((r) => r.symbol) });
                    return;
                }
            }
        }
        catch (error) {
            console.warn('[Fundamentals] DB hydration failed (non-fatal):', error instanceof Error ? error.message : error);
        }
        memoryStore.pairBiases = SUPPORTED_SYMBOLS.map(buildEmptyPair);
    }
}
