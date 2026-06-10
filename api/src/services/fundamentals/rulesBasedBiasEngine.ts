export type BiasDirection = 'bullish' | 'bearish' | 'neutral' | 'mixed' | 'unknown';
export type BiasImpact = 'low' | 'medium' | 'high' | 'unknown';
export type BiasTradeStatus = 'safe' | 'wait' | 'avoid' | 'unknown';

export interface BiasResult {
  symbol: string;
  bias: BiasDirection;
  confidence: number;
  impact: BiasImpact;
  tradeStatus: BiasTradeStatus;
  reason: string;
  reasons: string[];
  keyDrivers: string[];
  articleIds: string[];
  eventIds: string[];
}

export interface BiasInput {
  symbol: string;
  articles?: unknown[];
  events?: unknown[];
  sourceStale?: boolean;
}

interface ArticleLike {
  id: string;
  affectedSymbols?: string[];
  sentiment?: string;
  impact?: string;
  publishedAt?: string;
  title?: string;
}

interface EventLike {
  id: string;
  affectedSymbols?: string[];
  impact?: string;
  datetimeUtc?: string;
  eventName?: string;
  status?: string;
}

export function calculateRulesBasedBias(input: BiasInput): BiasResult {
  const { symbol, articles = [], events = [], sourceStale = false } = input;

  const typedArticles = articles as ArticleLike[];
  const typedEvents = events as EventLike[];

  // Match articles and events to this symbol
  const matchedArticles = typedArticles.filter(
    (a) => Array.isArray(a.affectedSymbols) && a.affectedSymbols.includes(symbol),
  );
  const matchedEvents = typedEvents.filter(
    (e) => Array.isArray(e.affectedSymbols) && e.affectedSymbols.includes(symbol),
  );

  const matchedArticleIds = matchedArticles.map((a) => a.id);
  const matchedEventIds = matchedEvents.map((e) => e.id);

  if (!matchedArticleIds.length && !matchedEventIds.length) {
    return {
      symbol,
      bias: 'neutral',
      confidence: 0,
      impact: 'unknown',
      tradeStatus: 'wait',
      reason: sourceStale
        ? 'Source data is stale — no recent news found for this instrument.'
        : 'No recent articles or calendar events found for this instrument.',
      reasons: [],
      keyDrivers: [],
      articleIds: [],
      eventIds: [],
    };
  }

  // Count sentiments
  let bullish = 0;
  let bearish = 0;
  let highImpactArticles = 0;

  for (const a of matchedArticles) {
    if (a.sentiment === 'bullish') bullish++;
    else if (a.sentiment === 'bearish') bearish++;
    if (a.impact === 'high') highImpactArticles++;
  }

  // Calculate bias direction and confidence
  let bias: BiasDirection = 'neutral';
  let confidence = 0;
  const total = bullish + bearish;

  if (total > 0) {
    const bullRatio = bullish / total;
    const bearRatio = bearish / total;

    if (bullRatio >= 0.65) {
      bias = 'bullish';
      confidence = Math.round(30 + bullRatio * 55);
    } else if (bearRatio >= 0.65) {
      bias = 'bearish';
      confidence = Math.round(30 + bearRatio * 55);
    } else if (bullish > 0 && bearish > 0) {
      bias = 'mixed';
      confidence = 25;
    } else {
      confidence = 15;
    }
  }

  // Confidence boost for high-impact articles
  if (highImpactArticles > 0) {
    confidence = Math.min(88, confidence + highImpactArticles * 8);
  }

  // Calendar risk from upcoming events
  const upcomingHighImpactEvents = matchedEvents.filter(
    (e) => e.impact === 'high' && e.status !== 'released' && e.status !== 'past',
  );
  const calendarRisk: BiasImpact = upcomingHighImpactEvents.length > 0
    ? 'high'
    : matchedEvents.length > 0
      ? 'medium'
      : 'low';

  // Trade status
  let tradeStatus: BiasTradeStatus = 'safe';
  if (upcomingHighImpactEvents.length > 0) tradeStatus = 'avoid';
  else if (calendarRisk === 'medium') tradeStatus = 'wait';
  else if (bias === 'neutral' || bias === 'mixed' || confidence < 30) tradeStatus = 'wait';

  // Build readable summary
  const keyDrivers: string[] = [];
  if (bullish > 0) keyDrivers.push(`${bullish} bullish signal${bullish > 1 ? 's' : ''}`);
  if (bearish > 0) keyDrivers.push(`${bearish} bearish signal${bearish > 1 ? 's' : ''}`);
  if (upcomingHighImpactEvents.length > 0) {
    keyDrivers.push(`${upcomingHighImpactEvents.length} upcoming high-impact event${upcomingHighImpactEvents.length > 1 ? 's' : ''}`);
  }

  const articleSummary = matchedArticles.length === 1
    ? '1 article analysed'
    : `${matchedArticles.length} articles analysed`;

  const reason = [
    `${articleSummary}: ${bullish} bullish, ${bearish} bearish, ${matchedArticles.length - bullish - bearish} neutral.`,
    upcomingHighImpactEvents.length > 0
      ? `${upcomingHighImpactEvents.length} high-impact event${upcomingHighImpactEvents.length > 1 ? 's' : ''} upcoming — trading caution advised.`
      : '',
  ].filter(Boolean).join(' ');

  return {
    symbol,
    bias,
    confidence: Math.min(90, Math.max(0, confidence)),
    impact: calendarRisk,
    tradeStatus,
    reason,
    reasons: keyDrivers,
    keyDrivers,
    articleIds: matchedArticleIds,
    eventIds: matchedEventIds,
  };
}
