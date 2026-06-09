/**
 * Forex Factory Provider
 *
 * Forex Factory does not offer a public API. The weekly XML feed at
 * https://cdn-nfs.faireconomy.media/ff_calendar_thisweek.xml is used by
 * many trading tools and is publicly accessible without authentication.
 *
 * Enable this provider by setting FOREX_FACTORY_ENABLED=true in .env.
 * It is only available for the current week (the feed does not support
 * arbitrary date ranges). For next-week data, the provider returns an
 * empty array and falls back to other providers.
 */

import * as cache from '../cache.js';
import type { CalendarProvider, NormalizedCalendarEvent, EventImpact } from './types.js';

const FF_FEED_URL = 'https://cdn-nfs.faireconomy.media/ff_calendar_thisweek.xml';

interface FFEvent {
  title: string;
  country: string;
  date: string;
  time: string;
  impact: string;
  forecast: string;
  previous: string;
}

const COUNTRY_TO_CURRENCY: Record<string, string> = {
  USD: 'USD', EUR: 'EUR', GBP: 'GBP', JPY: 'JPY',
  AUD: 'AUD', CAD: 'CAD', CHF: 'CHF', NZD: 'NZD',
  CNY: 'CNY',
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

const FF_IMPACT_MAP: Record<string, EventImpact> = {
  High:   'high',
  Medium: 'medium',
  Low:    'low',
  Holiday:'low',
};

function parseXmlText(xml: string, tag: string): string {
  const m = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}[^>]*>([^<]*)</${tag}>`).exec(xml);
  return m ? (m[1] ?? m[2] ?? '').trim() : '';
}

function parseFFXml(xml: string): FFEvent[] {
  const events: FFEvent[] = [];
  const itemRegex = /<event>([\s\S]*?)<\/event>/g;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    events.push({
      title:    parseXmlText(block, 'title'),
      country:  parseXmlText(block, 'country'),
      date:     parseXmlText(block, 'date'),
      time:     parseXmlText(block, 'time'),
      impact:   parseXmlText(block, 'impact'),
      forecast: parseXmlText(block, 'forecast'),
      previous: parseXmlText(block, 'previous'),
    });
  }

  return events;
}

function parseFFDate(date: string, time: string): { dateStr: string; timeStr: string; timeUtc: string } {
  // FF date format: "01-06-2026", time: "8:30am" or "Tentative" / "All Day"
  const [month, day, year] = date.split('-');
  const dateStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

  let timeStr = '00:00';
  if (time && !['tentative', 'all day', 'all-day'].includes(time.toLowerCase())) {
    const m = /(\d+):(\d+)(am|pm)/i.exec(time);
    if (m) {
      let h = parseInt(m[1], 10);
      const min = m[2];
      if (m[3].toLowerCase() === 'pm' && h !== 12) h += 12;
      if (m[3].toLowerCase() === 'am' && h === 12) h = 0;
      timeStr = `${String(h).padStart(2, '0')}:${min}`;
    }
  }

  return { dateStr, timeStr, timeUtc: `${dateStr}T${timeStr}:00Z` };
}

export class ForexFactoryProvider implements CalendarProvider {
  name = 'forex-factory';

  isAvailable(): boolean {
    return process.env.FOREX_FACTORY_ENABLED === 'true';
  }

  async fetchEvents(from: string, to: string): Promise<NormalizedCalendarEvent[]> {
    if (!this.isAvailable()) return [];

    // FF feed is current week only — skip if range is clearly future/past
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);

    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (toDate < weekStart || fromDate > weekEnd) return [];

    const cacheKey = `ff:calendar:this-week`;
    const cached = cache.get<NormalizedCalendarEvent[]>(cacheKey);
    if (cached) return cached;

    const res = await fetch(FF_FEED_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AlphaMentals/1.0)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Forex Factory feed error: ${res.status}`);

    const xml = await res.text();
    const raw = parseFFXml(xml);

    const events: NormalizedCalendarEvent[] = raw
      .filter((e) => e.title && e.country)
      .map((e, i) => {
        const currency = COUNTRY_TO_CURRENCY[e.country.toUpperCase()] ?? e.country.toUpperCase().slice(0, 3);
        const { dateStr, timeStr, timeUtc } = parseFFDate(e.date, e.time);
        const impact = FF_IMPACT_MAP[e.impact] ?? 'low';

        return {
          id: `ff-${dateStr}-${i}-${e.title.slice(0, 8).replace(/\s/g, '')}`,
          source: 'forex-factory',
          timeUtc,
          localTime: null,
          currency,
          country: e.country,
          title: e.title,
          impact,
          forecast: e.forecast || null,
          previous: e.previous || null,
          actual: null,
          unit: null,
          affectedPairs: CURRENCY_PAIR_MAP[currency] ?? [],
          category: null,
          sourceUrl: 'https://www.forexfactory.com/calendar',
          raw: e,
          // Legacy compat
          flag: '',
          date: dateStr,
          time: timeStr,
          pairImpacts: CURRENCY_PAIR_MAP[currency] ?? [],
        } as NormalizedCalendarEvent & { flag: string; date: string; time: string; pairImpacts: string[] };
      })
      .sort((a, b) => a.timeUtc.localeCompare(b.timeUtc));

    // Cache for 30 minutes — FF feed updates infrequently
    cache.set(cacheKey, events, 30 * 60 * 1000);
    return events;
  }
}
