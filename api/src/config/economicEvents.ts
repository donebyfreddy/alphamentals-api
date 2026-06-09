export type ManualEventImpact = 'low' | 'medium' | 'high';

export interface ManualEconomicEvent {
  id: string;
  eventName: string;
  title: string;
  source: string;
  currency: string;
  country?: string;
  dateTime: string;
  date: string;
  time: string;
  impact: ManualEventImpact;
  description?: string;
  previous?: string | null;
  forecast?: string | null;
  actual?: string | null;
}

export const MANUAL_ECONOMIC_EVENTS: ManualEconomicEvent[] = [];
