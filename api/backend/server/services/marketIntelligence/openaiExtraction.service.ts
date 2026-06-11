import { z } from 'zod';
import { chatCompleteJSON } from '../../lib/gemini.js';
import type {
  Bias,
  EconomicEvent,
  FundamentalAnalysisItem,
  NewsArticle,
} from '../../types/marketIntelligence.js';
import { getConfiguredOpenAIApiKey, getOpenAIModel } from '../../lib/openaiConfig.js';

const eventSchema = z.object({
  title: z.string().min(2),
  country: z.string().optional().default(''),
  currency: z.string().min(3).max(6),
  impact: z.enum(['low', 'medium', 'high']),
  date: z.string(),
  time: z.string().optional().default(''),
  datetime: z.string().optional().default(''),
  actual: z.string().nullable().optional(),
  forecast: z.string().nullable().optional(),
  previous: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  aiSummary: z.string().optional().default(''),
  tradingContext: z.object({
    affectedSymbols: z.array(z.string()).default([]),
    riskWindowMinutes: z.number().int().min(0).max(180).default(30),
    bias: z.enum(['bullish', 'bearish', 'neutral', 'mixed']).default('neutral'),
    reason: z.string().default('Awaiting more context'),
  }).optional(),
});

const classifiedArticleSchema = z.object({
  currencies: z.array(z.string()).default([]),
  symbols: z.array(z.string()).default([]),
  impact: z.enum(['low', 'medium', 'high']).default('low'),
  sentiment: z.string().default('neutral'),
  category: z.string().default('macro'),
  relevanceScore: z.number().min(0).max(1).default(0.35),
  summary: z.string().default(''),
});

const fundamentalItemSchema = z.object({
  asset: z.string(),
  bias: z.enum(['bullish', 'bearish', 'neutral', 'mixed']),
  confidence: z.number().min(0).max(1),
  summary: z.string(),
  drivers: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  timeframe: z.enum(['intraday', 'swing']).default('intraday'),
});

const fundamentalsSchema = z.object({
  analysis: z.array(fundamentalItemSchema),
  globalMacro: z.object({
    usdBias: z.enum(['bullish', 'bearish', 'neutral', 'mixed']),
    riskSentiment: z.enum(['risk-on', 'risk-off', 'mixed']),
    goldBias: z.enum(['bullish', 'bearish', 'neutral', 'mixed']),
  }),
});

function hasOpenAI(): boolean {
  return Boolean(getConfiguredOpenAIApiKey());
}

function safeJsonDate(date: string | undefined): string {
  if (!date) return new Date().toISOString();
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

export class OpenAIExtractionService {
  async extractEconomicEventsFromText(text: string, sourceName: string): Promise<EconomicEvent[]> {
    if (!hasOpenAI() || !text.trim()) return [];

    try {
      const payload = await chatCompleteJSON<{ events: Array<z.infer<typeof eventSchema>> }>([
        {
          role: 'system',
          content: 'Extract economic calendar events from raw webpage text. Return JSON only.',
        },
        {
          role: 'user',
          content: `Source: ${sourceName}

Return only valid JSON with shape {"events":[...]}.
Normalize impact to low|medium|high.
If the text is not a calendar, return {"events":[]}.
Text:
${text.slice(0, 18_000)}`,
        },
      ], {
        model: getOpenAIModel(),
        temperature: 0,
        maxTokens: 1600,
        feature: 'fundamentals',
        operation: 'extract_economic_events_from_text',
      });

      const parsed = z.object({ events: z.array(eventSchema).default([]) }).safeParse(payload);
      if (!parsed.success) return [];

      return parsed.data.events.map((event) => {
        const datetime = event.datetime || (event.date && event.time ? `${event.date}T${event.time}:00` : event.date);
        return {
          id: `ai_evt_${Buffer.from(`${sourceName}|${event.title}|${datetime}`).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24)}`,
          source: sourceName,
          title: event.title,
          country: event.country || undefined,
          currency: event.currency.toUpperCase(),
          impact: event.impact,
          date: event.date,
          time: event.time || undefined,
          datetime: datetime || undefined,
          actual: event.actual ?? null,
          forecast: event.forecast ?? null,
          previous: event.previous ?? null,
          unit: event.unit ?? null,
          url: event.url ?? null,
          aiSummary: event.aiSummary,
          tradingContext: {
            affectedSymbols: event.tradingContext?.affectedSymbols ?? [],
            riskWindowMinutes: event.tradingContext?.riskWindowMinutes ?? 30,
            bias: event.tradingContext?.bias ?? 'neutral',
            reason: event.tradingContext?.reason ?? 'Awaiting more context',
          },
        };
      });
    } catch (error) {
      console.warn('[openai] economic event extraction failed:', error instanceof Error ? error.message : String(error));
      return [];
    }
  }

  async classifyNewsArticle(article: Pick<NewsArticle, 'title' | 'summary' | 'source' | 'url' | 'publishedAt'>): Promise<{
    currencies: string[];
    symbols: string[];
    impact: 'low' | 'medium' | 'high';
    sentiment: string;
    category: string;
    relevanceScore: number;
    summary: string;
  }> {
    if (!hasOpenAI()) {
      throw new Error('OpenAI not configured');
    }

    const payload = await chatCompleteJSON<z.infer<typeof classifiedArticleSchema>>([
      {
        role: 'system',
        content: 'Classify trading news. Return only JSON.',
      },
      {
        role: 'user',
        content: `Return only JSON with keys currencies, symbols, impact, sentiment, category, relevanceScore, summary.

Article source: ${article.source}
Title: ${article.title}
PublishedAt: ${article.publishedAt ?? 'unknown'}
URL: ${article.url}
Body: ${article.summary}`,
      },
    ], {
      model: getOpenAIModel(),
      temperature: 0,
      maxTokens: 600,
      feature: 'fundamentals',
      operation: 'classify_news_article',
    });

    const parsed = classifiedArticleSchema.parse(payload);
    return {
      currencies: parsed.currencies.map((item) => item.toUpperCase()),
      symbols: parsed.symbols.map((item) => item.toUpperCase()),
      impact: parsed.impact,
      sentiment: parsed.sentiment,
      category: parsed.category,
      relevanceScore: parsed.relevanceScore,
      summary: parsed.summary,
    };
  }

  async generateFundamentalAnalysis(input: {
    articles: NewsArticle[];
    events: EconomicEvent[];
    assets: string[];
  }): Promise<{
    analysis: FundamentalAnalysisItem[];
    globalMacro: {
      usdBias: Bias;
      riskSentiment: 'risk-on' | 'risk-off' | 'mixed';
      goldBias: Bias;
    };
  } | null> {
    if (!hasOpenAI()) return null;

    try {
      const payload = await chatCompleteJSON<z.infer<typeof fundamentalsSchema>>([
        {
          role: 'system',
          content: 'You are a macro trading analyst. Return only JSON. Use only the provided inputs.',
        },
        {
          role: 'user',
          content: `Build fundamentals for these assets: ${input.assets.join(', ')}.

News:
${JSON.stringify(input.articles.slice(0, 20), null, 2)}

Calendar:
${JSON.stringify(input.events.filter((event) => event.impact !== 'low').slice(0, 12), null, 2)}`,
        },
      ], {
        model: getOpenAIModel(),
        temperature: 0.1,
        maxTokens: 1800,
        feature: 'fundamentals',
        operation: 'generate_fundamental_analysis',
      });

      const parsed = fundamentalsSchema.parse(payload);
      return {
        analysis: parsed.analysis.map((item) => ({
          asset: item.asset,
          bias: item.bias,
          confidence: Number(item.confidence.toFixed(2)),
          summary: item.summary,
          drivers: item.drivers,
          risks: item.risks,
          timeframe: item.timeframe,
          updatedAt: safeJsonDate(new Date().toISOString()),
        })),
        globalMacro: {
          usdBias: parsed.globalMacro.usdBias,
          riskSentiment: parsed.globalMacro.riskSentiment,
          goldBias: parsed.globalMacro.goldBias,
        },
      };
    } catch (error) {
      console.warn('[openai] fundamental analysis failed:', error instanceof Error ? error.message : String(error));
      return null;
    }
  }
}
