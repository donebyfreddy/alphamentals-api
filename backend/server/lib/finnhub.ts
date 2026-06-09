import * as cache from './cache.js';

const BASE = 'https://finnhub.io/api/v1';

interface FinnhubEconomicEvent {
  actual: number | null;
  country: string;
  estimate: number | null;
  event: string;
  impact: string;
  prev: number | null;
  time: string; // "2024-05-09 13:30:00"
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

// Currency → pairs it directly affects
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
  // Oil-producing / commodity countries
  OIL: ['USOIL', 'USDCAD'],
};

function formatValue(v: number | null, unit: string): string | null {
  if (v === null || v === undefined) return null;
  const suffix = unit && unit !== '' ? unit : '';
  return `${v}${suffix}`;
}

function normalizeImpact(impact: string): 'low' | 'medium' | 'high' {
  const i = (impact ?? '').toLowerCase();
  if (i === 'high') return 'high';
  if (i === 'medium' || i === 'moderate') return 'medium';
  return 'low';
}

export interface NormalizedEvent {
  id: string;
  title: string;
  country: string;
  currency: string;
  flag: string;
  date: string;
  time: string;
  impact: 'low' | 'medium' | 'high';
  forecast: string | null;
  previous: string | null;
  actual: string | null;
  pairImpacts: string[];
}

export async function fetchCalendar(from: string, to: string): Promise<NormalizedEvent[]> {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) throw new Error('FINNHUB_API_KEY not set in .env');

  const cacheKey = `finnhub:calendar:${from}:${to}`;
  const cached = cache.get<NormalizedEvent[]>(cacheKey);
  if (cached) return cached;

  const url = `${BASE}/calendar/economic?from=${from}&to=${to}&token=${apiKey}`;
  const res = await fetch(url, { headers: { 'X-Finnhub-Token': apiKey } });
  if (!res.ok) throw new Error(`Finnhub error: ${res.status} ${res.statusText}`);

  const data = (await res.json()) as FinnhubCalendarResponse;
  const raw = data.economicCalendar ?? [];

  const events: NormalizedEvent[] = raw.map((e, i) => {
    const currency = COUNTRY_TO_CURRENCY[e.country?.toUpperCase()] ?? e.country;
    const [datePart, timePart] = (e.time ?? '').split(' ');
    const pairImpacts = CURRENCY_PAIR_MAP[currency] ?? [];

    return {
      id: `fh-${datePart}-${i}-${e.event.slice(0, 8).replace(/\s/g, '')}`,
      title: e.event,
      country: e.country,
      currency,
      flag: CURRENCY_FLAGS[currency] ?? '🌍',
      date: datePart ?? '',
      time: timePart ? timePart.slice(0, 5) : '00:00',
      impact: normalizeImpact(e.impact),
      forecast: formatValue(e.estimate, e.unit),
      previous: formatValue(e.prev, e.unit),
      actual: formatValue(e.actual, e.unit),
      pairImpacts,
    };
  });

  // Sort chronologically, filter out events with no date
  const sorted = events
    .filter((e) => e.date)
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));

  cache.set(cacheKey, sorted, 5 * 60 * 1000);
  return sorted;
}
