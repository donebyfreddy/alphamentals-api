import * as cache from '../cache.js';
import type { CalendarProvider, NormalizedCalendarEvent, EventImpact } from './types.js';

// Trading Economics free tier: https://api.tradingeconomics.com/calendar
// Requires TRADING_ECONOMICS_API_KEY in .env

const BASE = 'https://api.tradingeconomics.com';

interface TECalendarEvent {
  CalendarId: string;
  Date: string;         // "2026-06-02T13:30:00"
  Country: string;
  Category: string;
  Event: string;
  Reference: string;
  Source: string;
  Actual: string | null;
  Previous: string | null;
  Forecast: string | null;
  TEForecast: string | null;
  URL: string;
  DateSpan: string;
  Importance: number;  // 1=low, 2=medium, 3=high
  LastUpdate: string;
  Revised: string | null;
  Currency: string | null;
  Unit: string | null;
  Ticker: string | null;
  Symbol: string | null;
}

const COUNTRY_TO_CURRENCY: Record<string, string> = {
  'united states': 'USD', 'euro area': 'EUR', 'united kingdom': 'GBP',
  'japan': 'JPY', 'australia': 'AUD', 'canada': 'CAD', 'switzerland': 'CHF',
  'new zealand': 'NZD', 'china': 'CNY', 'germany': 'EUR', 'france': 'EUR',
  'italy': 'EUR', 'spain': 'EUR',
};

const CURRENCY_PAIR_MAP: Record<string, string[]> = {
  USD: ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD', 'XAUUSD', 'DXY', 'USOIL'],
  EUR: ['EURUSD', 'EURJPY', 'EURGBP'],
  GBP: ['GBPUSD', 'GBPJPY', 'EURGBP'],
  JPY: ['USDJPY', 'EURJPY', 'GBPJPY'],
  AUD: ['AUDUSD'],
  CAD: ['USDCAD', 'USOIL'],
  CHF: ['USDCHF'],
  NZD: ['NZDUSD'],
  XAU: ['XAUUSD'],
};

function importanceToImpact(importance: number): EventImpact {
  if (importance >= 3) return 'high';
  if (importance === 2) return 'medium';
  return 'low';
}

function resolveCurrency(event: TECalendarEvent): string {
  if (event.Currency) return event.Currency.toUpperCase();
  return COUNTRY_TO_CURRENCY[event.Country?.toLowerCase()] ?? event.Country?.slice(0, 3).toUpperCase() ?? 'UNK';
}

export class TradingEconomicsProvider implements CalendarProvider {
  name = 'trading-economics';

  isAvailable(): boolean {
    return Boolean(process.env.TRADING_ECONOMICS_API_KEY);
  }

  async fetchEvents(from: string, to: string): Promise<NormalizedCalendarEvent[]> {
    const apiKey = process.env.TRADING_ECONOMICS_API_KEY;
    if (!apiKey) throw new Error('TRADING_ECONOMICS_API_KEY not set');

    const cacheKey = `te:calendar:${from}:${to}`;
    const cached = cache.get<NormalizedCalendarEvent[]>(cacheKey);
    if (cached) return cached;

    const url = `${BASE}/calendar?c=${apiKey}&d1=${from}&d2=${to}&f=json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Trading Economics error: ${res.status} ${res.statusText}`);

    const raw: TECalendarEvent[] = await res.json();

    const events: NormalizedCalendarEvent[] = raw.map((e, i) => {
      const currency = resolveCurrency(e);
      const dateStr = e.Date.split('T')[0];
      const timeStr = e.Date.includes('T') ? e.Date.split('T')[1].slice(0, 5) : '00:00';
      const timeUtc = `${dateStr}T${timeStr}:00Z`;

      return {
        id: `te-${dateStr}-${i}-${e.CalendarId}`,
        source: 'trading-economics',
        timeUtc,
        localTime: null,
        currency,
        country: e.Country ?? '',
        title: e.Event,
        impact: importanceToImpact(e.Importance),
        forecast: e.Forecast ?? e.TEForecast ?? null,
        previous: e.Previous ?? null,
        actual: e.Actual ?? null,
        unit: e.Unit ?? null,
        affectedPairs: CURRENCY_PAIR_MAP[currency] ?? [],
        category: e.Category ?? null,
        sourceUrl: e.URL ? `https://tradingeconomics.com${e.URL}` : null,
        raw: e,
        // Legacy compat
        flag: '',
        date: dateStr,
        time: timeStr,
        pairImpacts: CURRENCY_PAIR_MAP[currency] ?? [],
      } as NormalizedCalendarEvent & { flag: string; date: string; time: string; pairImpacts: string[] };
    });

    const sorted = events
      .filter((e) => e.timeUtc)
      .sort((a, b) => a.timeUtc.localeCompare(b.timeUtc));

    cache.set(cacheKey, sorted, 5 * 60 * 1000);
    return sorted;
  }
}
