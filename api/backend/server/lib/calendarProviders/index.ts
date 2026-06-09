/**
 * Calendar provider orchestrator.
 *
 * Priority order: Trading Economics > Finnhub > Forex Factory
 * Events from multiple providers are merged and deduplicated.
 * Higher-priority provider data wins on duplicates.
 */

import { FinnhubProvider } from './finnhubProvider.js';
import { TradingEconomicsProvider } from './tradingEconomicsProvider.js';
import { ForexFactoryProvider } from './forexFactoryProvider.js';
import type { NormalizedCalendarEvent } from './types.js';
import { APP_EVENT_TIMEZONE, deriveFundamentalEventTiming } from '../../../../src/lib/fundamentalEvents.js';

export type { NormalizedCalendarEvent } from './types.js';

const PROVIDERS = [
  new TradingEconomicsProvider(),
  new FinnhubProvider(),
  new ForexFactoryProvider(),
];

const CURRENCY_FLAGS: Record<string, string> = {
  USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', JPY: '🇯🇵',
  AUD: '🇦🇺', CAD: '🇨🇦', CHF: '🇨🇭', NZD: '🇳🇿',
  CNY: '🇨🇳', HKD: '🇭🇰', SGD: '🇸🇬', NOK: '🇳🇴',
  SEK: '🇸🇪', DKK: '🇩🇰', MXN: '🇲🇽', ZAR: '🇿🇦',
  XAU: '🥇',
};

/**
 * Deduplication key: same currency + same UTC minute + similar title.
 * Allows a small title mismatch since providers name events differently.
 */
function dedupeKey(e: NormalizedCalendarEvent): string {
  const minute = e.timeUtc.slice(0, 16); // "2026-06-02T13:30"
  const titleKey = e.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
  return `${e.currency}:${minute}:${titleKey}`;
}

function attachFlag(e: NormalizedCalendarEvent): NormalizedCalendarEvent & { flag: string } {
  return { ...e, flag: CURRENCY_FLAGS[e.currency] ?? '🌍' };
}

export async function fetchCalendarFromProviders(
  from: string,
  to: string,
): Promise<(NormalizedCalendarEvent & {
  flag: string;
  date: string;
  time: string;
  pairImpacts: string[];
  datetimeUtc: string;
  datetimeLocal: string;
  timezone: string;
  dateTimeLabel: string;
  rawProviderTime: string;
})[]> {
  const available = PROVIDERS.filter((p) => p.isAvailable());

  if (available.length === 0) {
    throw new Error('No calendar providers configured. Set FINNHUB_API_KEY, TRADING_ECONOMICS_API_KEY, or FOREX_FACTORY_ENABLED=true.');
  }

  const results = await Promise.allSettled(
    available.map((p) =>
      p.fetchEvents(from, to).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[calendar] ${p.name} failed: ${msg}`);
        return [] as NormalizedCalendarEvent[];
      }),
    ),
  );

  // Merge: higher-priority provider wins on duplicates (first-write-wins)
  const seen = new Map<string, NormalizedCalendarEvent>();
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const event of result.value) {
      const key = dedupeKey(event);
      if (!seen.has(key)) seen.set(key, event);
    }
  }

  return Array.from(seen.values())
    .filter((e) => e.timeUtc)
    .sort((a, b) => a.timeUtc.localeCompare(b.timeUtc))
    .map((e) => {
      const withFlag = attachFlag(e);
      const ext = e as NormalizedCalendarEvent & { date?: string; time?: string; pairImpacts?: string[] };
      const [rawDatePart, rawTimeFull] = e.timeUtc.split('T');
      const rawTime = rawTimeFull ? rawTimeFull.slice(0, 5) : '00:00';
      const timing = deriveFundamentalEventTiming({
        rawDateTime: e.timeUtc,
        providerTimezone: 'UTC',
        appTimezone: APP_EVENT_TIMEZONE,
      });
      const date = timing?.date ?? ext.date ?? rawDatePart ?? '';
      const time = timing?.time ?? ext.time ?? rawTime;
      const debugPayload = {
        source: e.source,
        title: e.title,
        rawProviderTime: e.timeUtc,
        parsedUtcTime: timing?.datetimeUtc ?? e.timeUtc,
        displayedMadridTime: timing ? `${timing.dateTimeLabel} ${timing.timezone}` : `${date} ${time} ${APP_EVENT_TIMEZONE}`,
      };
      console.debug('[economic-calendar:timezone]', debugPayload);
      return {
        ...withFlag,
        date,
        time,
        pairImpacts: ext.pairImpacts ?? e.affectedPairs,
        datetimeUtc: timing?.datetimeUtc ?? e.timeUtc,
        datetimeLocal: timing?.datetimeLocal ?? `${date}T${time}:00`,
        timezone: timing?.timezone ?? APP_EVENT_TIMEZONE,
        dateTimeLabel: timing?.dateTimeLabel ?? `${date}, ${time}`,
        rawProviderTime: e.timeUtc,
      };
    });
}

export function getActiveProviders(): { name: string; available: boolean }[] {
  return PROVIDERS.map((p) => ({ name: p.name, available: p.isAvailable() }));
}
