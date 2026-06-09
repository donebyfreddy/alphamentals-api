export type EventImpact = 'high' | 'medium' | 'low';

export interface NormalizedCalendarEvent {
  id: string;
  source: string;
  timeUtc: string;       // ISO-8601 UTC e.g. "2026-06-02T13:30:00Z"
  localTime: string | null;
  currency: string;
  country: string;
  title: string;
  impact: EventImpact;
  forecast: string | null;
  previous: string | null;
  actual: string | null;
  unit: string | null;
  affectedPairs: string[];
  category: string | null;
  sourceUrl: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw?: unknown;
}

export interface CalendarProvider {
  name: string;
  fetchEvents(from: string, to: string): Promise<NormalizedCalendarEvent[]>;
  isAvailable(): boolean;
}
