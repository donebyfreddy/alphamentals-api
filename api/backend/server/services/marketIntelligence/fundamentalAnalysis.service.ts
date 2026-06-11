import type {
  Bias,
  EconomicEvent,
  FundamentalAnalysisItem,
  FundamentalAnalysisResponse,
  NewsArticle,
} from '../../types/marketIntelligence.js';
import { getCachedValue, setCachedValue } from './cacheStore.service.js';
import { OpenAIExtractionService } from './openaiExtraction.service.js';
import { listSourceStatuses, setSourceStatus } from './sourceRegistry.service.js';

const openAI = new OpenAIExtractionService();
const DEFAULT_ASSETS = ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'BTCUSD', 'US30', 'NAS100'];

function deriveBiasForAsset(asset: string, articles: NewsArticle[], events: EconomicEvent[]): {
  bias: Bias;
  confidence: number;
  summary: string;
  drivers: string[];
  risks: string[];
} {
  const relatedArticles = articles.filter((article) => article.symbols.includes(asset));
  const relatedEvents = events.filter((event) => event.tradingContext?.affectedSymbols.includes(asset));

  const bullish = relatedArticles.filter((article) => /bullish|support|strong/i.test(article.sentiment)).length;
  const bearish = relatedArticles.filter((article) => /bearish|pressure|weak/i.test(article.sentiment)).length;
  const highImpactEvents = relatedEvents.filter((event) => event.impact === 'high').length;

  let bias: Bias = 'neutral';
  if (bullish > bearish + 1) bias = 'bullish';
  else if (bearish > bullish + 1) bias = 'bearish';
  else if (bullish > 0 && bearish > 0) bias = 'mixed';

  const confidence = Math.max(0.3, Math.min(0.78, 0.35 + (relatedArticles.length * 0.04) + (highImpactEvents * 0.05)));
  const drivers = relatedArticles.slice(0, 3).map((article) => article.title);
  const risks = relatedEvents.slice(0, 3).map((event) => `${event.title} (${event.date}${event.time ? ` ${event.time}` : ''})`);

  return {
    bias,
    confidence: Number(confidence.toFixed(2)),
    summary: relatedArticles.length || relatedEvents.length
      ? `${asset} is ${bias} on recent macro/news balance, with ${relatedArticles.length} relevant articles and ${relatedEvents.length} relevant events in scope.`
      : `${asset} is neutral because recent macro/news coverage is thin. Keep risk small until fresh catalysts arrive.`,
    drivers: drivers.length ? drivers : ['Insufficient recent data, using neutral fallback'],
    risks: risks.length ? risks : ['Limited source depth can change the view quickly'],
  };
}

function buildFallbackFundamentals(articles: NewsArticle[], events: EconomicEvent[]): FundamentalAnalysisResponse {
  const analysis: FundamentalAnalysisItem[] = DEFAULT_ASSETS.map((asset) => {
    const derived = deriveBiasForAsset(asset, articles, events);
    return {
      asset,
      bias: derived.bias,
      confidence: derived.confidence,
      summary: derived.summary,
      drivers: derived.drivers,
      risks: derived.risks,
      timeframe: 'intraday',
      updatedAt: new Date().toISOString(),
    };
  });

  setSourceStatus('rules-fundamentals', {
    active: analysis.length > 0,
    lastFetch: new Date().toISOString(),
    items: analysis.length,
    error: null,
  });

  return {
    analysis,
    globalMacro: {
      usdBias: analysis.find((item) => item.asset === 'USDJPY')?.bias ?? 'neutral',
      riskSentiment: 'mixed',
      goldBias: analysis.find((item) => item.asset === 'XAUUSD')?.bias ?? 'neutral',
    },
    sources: listSourceStatuses(),
    generatedAt: new Date().toISOString(),
  };
}

export async function generateFundamentalAnalysis(articles: NewsArticle[], events: EconomicEvent[]): Promise<FundamentalAnalysisResponse> {
  const ttlMinutes = Number(process.env.FUNDAMENTALS_CACHE_TTL_MINUTES ?? process.env.CACHE_TTL_MINUTES ?? '30');
  const cached = await getCachedValue<FundamentalAnalysisResponse>('fundamental-analysis');
  if (cached) return cached;

  const aiResponse = await openAI.generateFundamentalAnalysis({
    articles,
    events,
    assets: DEFAULT_ASSETS,
  });

  if (aiResponse && aiResponse.analysis.length) {
    setSourceStatus('openai-fundamentals', {
      active: true,
      lastFetch: new Date().toISOString(),
      items: aiResponse.analysis.length,
      error: null,
    });
    setSourceStatus('rules-fundamentals', {
      active: true,
      lastFetch: new Date().toISOString(),
      items: aiResponse.analysis.length,
      error: null,
    });

    const response: FundamentalAnalysisResponse = {
      analysis: aiResponse.analysis,
      globalMacro: aiResponse.globalMacro,
      sources: listSourceStatuses(),
      generatedAt: new Date().toISOString(),
    };
    await setCachedValue('fundamental-analysis', response, ttlMinutes * 60 * 1000);
    return response;
  }

  setSourceStatus('openai-fundamentals', {
    active: false,
    lastFetch: new Date().toISOString(),
    items: 0,
    error: 'OpenAI unavailable or returned invalid JSON',
  });

  const fallback = buildFallbackFundamentals(articles, events);
  await setCachedValue('fundamental-analysis', fallback, ttlMinutes * 60 * 1000);
  return fallback;
}
