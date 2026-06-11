import * as cache from '../cache.js';
import type { CalendarProvider, NormalizedCalendarEvent, EventImpact } from './types.js';
import { CalendarProviderError } from './diagnostics.js';

const BASE = 'https://finnhub.io/api/v1';

interface FinnhubEconomicEvent {
  actual: number | null;
  country: string;
  estimate: number | null;
  event: string;
  impact: string;
  prev: number | null;
  time: string;
  unit: string;
}

interface FinnhubCalendarResponse {
  economicCalendar: FinnhubEconomicEvent[];
}

const COUNTRY_TO_CURRENCY: Record<string, string> = {
  US: 'USD', EU: 'EUR', EA: 'EUR', EMU: 'EUR',
  GB: 'GBP', JP: 'JPY', AU: 'AUD', CA: 'CAD',
  CH: 'CHF', NZ: 'NZD', CN: 'CNY', HK: 'HKD',
  SG: 'SGD', NO: 'NOK', SE: 'SEK', DK: 'DKK',
  MX: 'MXN', ZA: 'ZAR', TR: 'TRY', BR: 'BRL',
  IN: 'INR', KR: 'KRW', RU: 'RUB', DE: 'EUR',
  FR: 'EUR', IT: 'EUR', ES: 'EUR', PT: 'EUR',
};

const CURRENCY_FLAGS: Record<string, string> = {
  USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', JPY: '🇯🇵',
  AUD: '🇦🇺', CAD: '🇨🇦', CHF: '🇨🇭', NZD: '🇳🇿',
  CNY: '🇨🇳', HKD: '🇭🇰', SGD: '🇸🇬', NOK: '🇳🇴',
  SEK: '🇸🇪', DKK: '🇩🇰', MXN: '🇲🇽', ZAR: '🇿🇦',
  TRY: '🇹🇷', BRL: '🇧🇷', INR: '🇮🇳', KRW: '🇰🇷',
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

function formatValue(v: number | null, unit: string): string | null {
  if (v === null || v === undefined) return null;
  return `${v}${unit ?? ''}`;
}

function normalizeImpact(impact: string): EventImpact {
  const i = (impact ?? '').toLowerCase();
  if (i === 'high') return 'high';
  if (i === 'medium' || i === 'moderate') return 'medium';
  return 'low';
}

export class FinnhubProvider implements CalendarProvider {
  name = 'finnhub';

  isAvailable(): boolean {
    return Boolean(process.env.FINNHUB_API_KEY);
  }

  async fetchEvents(from: string, to: string): Promise<NormalizedCalendarEvent[]> {
    const apiKey = process.env.FINNHUB_API_KEY;
    if (!apiKey || !apiKey.trim()) {
      throw new CalendarProviderError('FINNHUB_FORBIDDEN_OR_INVALID_KEY', {
        code: 'FINNHUB_FORBIDDEN_OR_INVALID_KEY',
        status: 403,
        checkedUrl: null,
      });
    }

    const cacheKey = `finnhub:calendar:${from}:${to}`;
    const cached = cache.get<NormalizedCalendarEvent[]>(cacheKey);
    if (cached) return cached;

    const url = `${BASE}/calendar/economic?from=${from}&to=${to}&token=${apiKey}`;
    const res = await fetch(url, { headers: { 'X-Finnhub-Token': apiKey } });
    if (!res.ok) {
      if (res.status === 403 || res.status === 401) {
        throw new CalendarProviderError('FINNHUB_FORBIDDEN_OR_INVALID_KEY', {
          code: 'FINNHUB_FORBIDDEN_OR_INVALID_KEY',
          status: res.status,
          checkedUrl: url.replace(/token=[^&]+/, 'token=REDACTED'),
        });
      }
      throw new CalendarProviderError(`Finnhub error: ${res.status} ${res.statusText}`, {
        code: 'FINNHUB_CALENDAR_FETCH_FAILED',
        status: res.status,
        checkedUrl: url.replace(/token=[^&]+/, 'token=REDACTED'),
      });
    }

    const data = (await res.json()) as FinnhubCalendarResponse;
    const raw = data.economicCalendar ?? [];

    const events: NormalizedCalendarEvent[] = raw.map((e, i) => {
      const currency = COUNTRY_TO_CURRENCY[e.country?.toUpperCase()] ?? e.country;
      const [datePart, timePart] = (e.time ?? '').split(' ');
      const time = timePart ? timePart.slice(0, 5) : '00:00';

      return {
        id: `fh-${datePart}-${i}-${e.event.slice(0, 8).replace(/\s/g, '')}`,
        source: 'finnhub',
        timeUtc: datePart && time ? `${datePart}T${time}:00Z` : '',
        localTime: null,
        currency,
        country: e.country ?? '',
        title: e.event,
        impact: normalizeImpact(e.impact),
        forecast: formatValue(e.estimate, e.unit),
        previous: formatValue(e.prev, e.unit),
        actual: formatValue(e.actual, e.unit),
        unit: e.unit ?? null,
        affectedPairs: CURRENCY_PAIR_MAP[currency] ?? [],
        category: null,
        sourceUrl: null,
        raw: e,
        // Legacy compat fields consumed by the route mapper
        flag: CURRENCY_FLAGS[currency] ?? '🌍',
        date: datePart ?? '',
        time,
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
