import { z } from 'zod';
import { chatCompleteJSON } from '../../lib/gemini.js';
import type {
  Bias,
  EconomicEvent,
  FundamentalAnalysisItem,
  NewsArticle,
} from '../../types/marketIntelligence.js';
import { getConfiguredOpenAIApiKey, getOpenAIModel } from '../../lib/openaiConfig.js';

const eventExtractionSummarySchema = z.object({
  highImpactCount: z.number().int().min(0).default(0),
  currenciesAffected: z.array(z.string()).default([]),
  riskWarning: z.string().default(''),
});

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

const eventExtractionPayloadSchema = z.object({
  events: z.array(eventSchema).default([]),
  summary: eventExtractionSummarySchema.default({
    highImpactCount: 0,
    currenciesAffected: [],
    riskWarning: '',
  }),
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
      const payload = await chatCompleteJSON<z.infer<typeof eventExtractionPayloadSchema>>([
        {
          role: 'system',
          content: 'Extract economic calendar events from raw webpage text. Return strict JSON only. Never return markdown.',
        },
        {
          role: 'user',
          content: `Source: ${sourceName}

Return only valid JSON with this exact shape:
{
  "events": [
    {
      "date": "YYYY-MM-DD",
      "time": "HH:mm or empty string",
      "currency": "USD/EUR/GBP/JPY/XAU/CAD/AUD/NZD/CHF/etc",
      "impact": "low|medium|high",
      "title": "string",
      "country": "string",
      "datetime": "ISO string or empty string",
      "actual": "string|null",
      "forecast": "string|null",
      "previous": "string|null",
      "unit": "string|null",
      "url": "string|null",
      "aiSummary": "string",
      "tradingContext": {
        "affectedSymbols": ["string"],
        "riskWindowMinutes": 30,
        "bias": "bullish|bearish|neutral|mixed",
        "reason": "string"
      }
    }
  ],
  "summary": {
    "highImpactCount": 0,
    "currenciesAffected": [],
    "riskWarning": "string"
  }
}

If the text is not a calendar, return {"events":[],"summary":{"highImpactCount":0,"currenciesAffected":[],"riskWarning":"No economic calendar events found."}}.
Text:
${text.slice(0, 18_000)}`,
        },
      ], {
        model: getOpenAIModel(),
        temperature: 0,
        maxTokens: 1600,
        feature: 'fundamentals',
        operation: 'extract_economic_events_from_text',
        jsonSchema: {
          name: 'economic_event_extraction',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['events', 'summary'],
            properties: {
              events: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['date', 'time', 'currency', 'impact', 'title', 'actual', 'forecast', 'previous', 'source'],
                  properties: {
                    date: { type: 'string' },
                    time: { type: 'string' },
                    currency: { type: 'string' },
                    impact: { type: 'string', enum: ['low', 'medium', 'high'] },
                    title: { type: 'string' },
                    country: { type: 'string' },
                    datetime: { type: 'string' },
                    actual: { type: ['string', 'null'] },
                    forecast: { type: ['string', 'null'] },
                    previous: { type: ['string', 'null'] },
                    unit: { type: ['string', 'null'] },
                    url: { type: ['string', 'null'] },
                    aiSummary: { type: 'string' },
                    source: { type: 'string' },
                    tradingContext: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['affectedSymbols', 'riskWindowMinutes', 'bias', 'reason'],
                      properties: {
                        affectedSymbols: { type: 'array', items: { type: 'string' } },
                        riskWindowMinutes: { type: 'integer' },
                        bias: { type: 'string', enum: ['bullish', 'bearish', 'neutral', 'mixed'] },
                        reason: { type: 'string' },
                      },
                    },
                  },
                },
              },
              summary: {
                type: 'object',
                additionalProperties: false,
                required: ['highImpactCount', 'currenciesAffected', 'riskWarning'],
                properties: {
                  highImpactCount: { type: 'integer' },
                  currenciesAffected: { type: 'array', items: { type: 'string' } },
                  riskWarning: { type: 'string' },
                },
              },
            },
          },
        },
      });

      const parsed = eventExtractionPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        console.warn('[openai] economic event extraction schema validation failed', {
          source: sourceName,
          issueCount: parsed.error.issues.length,
        });
        return [];
      }

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
      const rawPreview = error instanceof Error && 'rawPreview' in error ? String((error as { rawPreview?: string }).rawPreview ?? '') : '';
      console.warn('[openai] economic event extraction failed:', {
        source: sourceName,
        code: error instanceof Error && 'code' in error ? String((error as { code?: string }).code ?? 'UNKNOWN') : 'UNKNOWN',
        message: error instanceof Error ? error.message : String(error),
        rawPreview,
      });
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
