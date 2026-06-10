import type { CalendarProvider, NormalizedCalendarEvent, EventImpact } from './types.js';
import { fetchCalendar as fetchMyfxbookCalendar } from '../myfxbook.js';
import * as cache from '../cache.js';

const COUNTRY_TO_CURRENCY: Record<string, string> = {
  United_States: 'USD', 'United States': 'USD', USA: 'USD', US: 'USD',
  Eurozone: 'EUR', EU: 'EUR', Germany: 'EUR', France: 'EUR', Italy: 'EUR',
  'United Kingdom': 'GBP', UK: 'GBP', GB: 'GBP',
  Japan: 'JPY', JP: 'JPY',
  Australia: 'AUD', AU: 'AUD',
  Canada: 'CAD', CA: 'CAD',
  Switzerland: 'CHF', CH: 'CHF',
  'New Zealand': 'NZD', NZ: 'NZD',
  China: 'CNY', CN: 'CNY',
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
};

function normalizeImpact(impact: string): EventImpact {
  const i = (impact ?? '').toLowerCase();
  if (i === 'high' || i === '3' || i === 'red') return 'high';
  if (i === 'medium' || i === 'moderate' || i === '2' || i === 'orange') return 'medium';
  return 'low';
}

function parseMyfxbookDateTime(date: string, time: string): string {
  // MyFXBook uses various date formats; try to produce a UTC ISO string
  if (!date) return new Date().toISOString();
  const dateClean = date.trim();
  const timeClean = time?.trim() || '00:00';
  try {
    // Format: "2026-06-10" or "06/10/2026"
    let isoDate = dateClean;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateClean)) {
      const [m, d, y] = dateClean.split('/');
      isoDate = `${y}-${m}-${d}`;
    }
    return new Date(`${isoDate}T${timeClean}:00Z`).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function makeId(country: string, date: string, time: string, title: string): string {
  const raw = `mfx-${country}-${date}-${time}-${title}`.slice(0, 80);
  return Buffer.from(raw).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 28);
}

export class MyfxbookProvider implements CalendarProvider {
  name = 'myfxbook';

  isAvailable(): boolean {
    return Boolean(process.env.MYFXBOOK_EMAIL && process.env.MYFXBOOK_PASSWORD);
  }

  async fetchEvents(from: string, to: string): Promise<NormalizedCalendarEvent[]> {
    const cacheKey = `mfxcal:${from}:${to}`;
    const cached = cache.get<NormalizedCalendarEvent[]>(cacheKey);
    if (cached) return cached;

    const raw = await fetchMyfxbookCalendar(from, to);

    const events: NormalizedCalendarEvent[] = raw.map((e) => {
      const currency = COUNTRY_TO_CURRENCY[e.country] ?? e.country?.slice(0, 3).toUpperCase() ?? 'USD';
      const timeUtc = parseMyfxbookDateTime(e.date, e.time);

      return {
        id: makeId(e.country, e.date, e.time, e.title),
        source: 'myfxbook',
        timeUtc,
        localTime: null,
        currency,
        country: e.country,
        title: e.title,
        impact: normalizeImpact(e.impact),
        forecast: e.forecast || null,
        previous: e.previous || null,
        actual: e.actual || null,
        unit: null,
        affectedPairs: CURRENCY_PAIR_MAP[currency] ?? [],
        category: null,
        sourceUrl: null,
        raw: e,
      };
    });

    const sorted = events
      .filter((e) => e.timeUtc)
      .sort((a, b) => a.timeUtc.localeCompare(b.timeUtc));

    cache.set(cacheKey, sorted, 5 * 60 * 1000);
    return sorted;
  }
}
