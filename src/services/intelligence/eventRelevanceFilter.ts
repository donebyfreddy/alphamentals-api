export type EventImpact = 'low' | 'medium' | 'high';
export type EventRelevance = 'high' | 'medium' | 'low';
export type TradeWarning = 'none' | 'wait' | 'avoid';

export interface ScoredEventData {
  id: string;
  eventName: string;
  currency: string | null;
  impact: EventImpact;
  eventTime: string;
  previous?: string | null;
  forecast?: string | null;
  actual?: string | null;
  tradeWarning?: TradeWarning | null;
}

export interface ScoredEvent {
  event: ScoredEventData;
  relevance: EventRelevance;
  minutesUntil: number;
  isFuture: boolean;
}

export function filterEventsForPair(_events: unknown[], _symbol: string): ScoredEvent[] {
  return [];
}

export function findNextHighImpact(_events: ScoredEvent[]): ScoredEvent | null {
  return null;
}
