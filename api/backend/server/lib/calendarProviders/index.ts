import { FinnhubProvider } from './finnhubProvider.js';
import { TradingEconomicsProvider } from './tradingEconomicsProvider.js';
import { ForexFactoryProvider } from './forexFactoryProvider.js';
import { MyfxbookProvider } from './myfxbookProvider.js';
import type { CalendarProvider, NormalizedCalendarEvent } from './types.js';
import { APP_EVENT_TIMEZONE, deriveFundamentalEventTiming } from '../../../../src/lib/fundamentalEvents.js';
import { CalendarProviderError, type CalendarProviderDiagnostics } from './diagnostics.js';
import { PlaywrightScraperService } from '../../services/marketIntelligence/playwrightScraper.service.js';
import { OpenAIExtractionService } from '../../services/marketIntelligence/openaiExtraction.service.js';
import { MANUAL_ECONOMIC_EVENTS } from '../../../../src/config/economicEvents.js';

export type { NormalizedCalendarEvent } from './types.js';

type ExtendedCalendarEvent = NormalizedCalendarEvent & {
  flag: string;
  date: string;
  time: string;
  pairImpacts: string[];
  datetimeUtc: string;
  datetimeLocal: string;
  timezone: string;
  dateTimeLabel: string;
  rawProviderTime: string;
};

interface ProviderState extends CalendarProviderDiagnostics {
  lastLogAtMs: number | null;
  checkedUrl?: string | null;
}

const COOLDOWN_MS = 30 * 60 * 1000;
const scraper = new PlaywrightScraperService();
const openAI = new OpenAIExtractionService();

const LIVE_PROVIDERS: CalendarProvider[] = [
  new TradingEconomicsProvider(),
  new MyfxbookProvider(),
  new FinnhubProvider(),
  new ForexFactoryProvider(),
];

const providerState = new Map<string, ProviderState>();

const CURRENCY_FLAGS: Record<string, string> = {
  USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', JPY: '🇯🇵',
  AUD: '🇦🇺', CAD: '🇨🇦', CHF: '🇨🇭', NZD: '🇳🇿',
  CNY: '🇨🇳', HKD: '🇭🇰', SGD: '🇸🇬', NOK: '🇳🇴',
  SEK: '🇸🇪', DKK: '🇩🇰', MXN: '🇲🇽', ZAR: '🇿🇦',
  XAU: '🥇',
};

function getProviderEnabled(provider: CalendarProvider): boolean {
  if (provider.name === 'finnhub') return Boolean(process.env.FINNHUB_API_KEY?.trim());
  if (provider.name === 'myfxbook') return Boolean(process.env.MYFXBOOK_EMAIL?.trim() && process.env.MYFXBOOK_PASSWORD?.trim());
  return provider.isAvailable();
}

function getProviderState(name: string, enabled = false): ProviderState {
  if (!providerState.has(name)) {
    providerState.set(name, {
      enabled,
      ok: false,
      error: null,
      lastStatus: null,
      lastCheckedAt: null,
      checkedUrl: null,
      cooldownUntil: null,
      provider: name,
      lastLogAtMs: null,
    });
  }
  return providerState.get(name)!;
}

function markProviderSuccess(name: string, enabled: boolean): void {
  providerState.set(name, {
    enabled,
    ok: true,
    error: null,
    lastStatus: 200,
    lastCheckedAt: new Date().toISOString(),
    checkedUrl: getProviderState(name, enabled).checkedUrl ?? null,
    cooldownUntil: null,
    provider: name,
    lastLogAtMs: null,
  });
}

function markProviderFailure(name: string, enabled: boolean, error: CalendarProviderError | Error | unknown): void {
  const now = Date.now();
  const current = getProviderState(name, enabled);
  const normalized = error instanceof CalendarProviderError
    ? error
    : new CalendarProviderError(error instanceof Error ? error.message : String(error), {
        code: 'CALENDAR_PROVIDER_FAILED',
        status: null,
        checkedUrl: null,
      });

  providerState.set(name, {
    enabled: name === 'finnhub' && normalized.code === 'FINNHUB_FORBIDDEN_OR_INVALID_KEY' ? false : enabled,
    ok: false,
    error: normalized.code,
    lastStatus: normalized.status,
    lastCheckedAt: new Date(now).toISOString(),
    checkedUrl: normalized.checkedUrl ?? current.checkedUrl ?? null,
    cooldownUntil: new Date(now + COOLDOWN_MS).toISOString(),
    provider: name,
    lastLogAtMs: current.lastLogAtMs,
  });

  const updated = providerState.get(name)!;
  if (!updated.lastLogAtMs || now - updated.lastLogAtMs >= COOLDOWN_MS) {
    console.warn(`[calendar] ${name} failed: ${normalized.code}`, {
      status: normalized.status,
      checkedUrl: normalized.checkedUrl ?? null,
    });
    updated.lastLogAtMs = now;
    providerState.set(name, updated);
  }
}

function isInCooldown(name: string): boolean {
  const state = providerState.get(name);
  if (!state?.cooldownUntil) return false;
  return Date.now() < new Date(state.cooldownUntil).getTime();
}

function dedupeKey(e: NormalizedCalendarEvent): string {
  const minute = e.timeUtc.slice(0, 16);
  const titleKey = e.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
  return `${e.currency}:${minute}:${titleKey}`;
}

function attachFlag(e: NormalizedCalendarEvent): NormalizedCalendarEvent & { flag: string } {
  return { ...e, flag: CURRENCY_FLAGS[e.currency] ?? '🌍' };
}

function normalizeEvents(events: NormalizedCalendarEvent[]): ExtendedCalendarEvent[] {
  return events
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

async function fetchPlaywrightFallbackCalendar(from: string, to: string): Promise<NormalizedCalendarEvent[]> {
  const urls = [
    'https://www.myfxbook.com/forex-economic-calendar',
    'https://www.investing.com/economic-calendar/',
    'https://www.fxstreet.com/economic-calendar',
  ];

  for (const url of urls) {
    try {
      const scraped = await scraper.scrapePage(url);
      const aiEvents = await openAI.extractEconomicEventsFromText(scraped.text, 'playwright-calendar-fallback');
      if (!aiEvents.length) continue;

      return aiEvents.map((event, index) => ({
        id: event.id || `playwright-${index}`,
        source: 'playwright-calendar-fallback',
        timeUtc: event.datetime
          ? new Date(event.datetime).toISOString()
          : `${event.date}T${event.time ?? '00:00'}:00Z`,
        localTime: null,
        currency: event.currency,
        country: event.country ?? '',
        title: event.title,
        impact: event.impact,
        forecast: event.forecast ?? null,
        previous: event.previous ?? null,
        actual: event.actual ?? null,
        unit: event.unit ?? null,
        affectedPairs: event.tradingContext?.affectedSymbols ?? [],
        category: null,
        sourceUrl: event.url ?? url,
        raw: event,
      }));
    } catch {
      // Best-effort fallback only.
    }
  }
  return [];
}

function buildStaticFallbackCalendar(): NormalizedCalendarEvent[] {
  return MANUAL_ECONOMIC_EVENTS.map((event) => ({
    id: event.id,
    source: 'static-calendar-fallback',
    timeUtc: event.dateTime,
    localTime: null,
    currency: event.currency,
    country: event.country ?? '',
    title: event.title || event.eventName,
    impact: event.impact,
    forecast: event.forecast ?? null,
    previous: event.previous ?? null,
    actual: event.actual ?? null,
    unit: null,
    affectedPairs: [],
    category: null,
    sourceUrl: null,
    raw: event,
  }));
}

export async function fetchCalendarFromProviders(from: string, to: string): Promise<ExtendedCalendarEvent[]> {
  const seen = new Map<string, NormalizedCalendarEvent>();

  for (const provider of LIVE_PROVIDERS) {
    const enabled = getProviderEnabled(provider);
    const state = getProviderState(provider.name, enabled);
    state.enabled = enabled;
    providerState.set(provider.name, state);

    if (!enabled) continue;
    if (isInCooldown(provider.name)) continue;

    try {
      const events = await provider.fetchEvents(from, to);
      if (events.length) {
        for (const event of events) {
          const key = dedupeKey(event);
          if (!seen.has(key)) seen.set(key, event);
        }
        markProviderSuccess(provider.name, enabled);
      } else {
        markProviderSuccess(provider.name, enabled);
      }
    } catch (error) {
      markProviderFailure(provider.name, enabled, error);
    }
  }

  if (!seen.size) {
    const fallbackEvents = await fetchPlaywrightFallbackCalendar(from, to);
    if (fallbackEvents.length) {
      providerState.set('fallback', {
        enabled: true,
        ok: true,
        error: null,
        lastStatus: 200,
        lastCheckedAt: new Date().toISOString(),
        checkedUrl: null,
        cooldownUntil: null,
        provider: 'playwright-calendar-fallback',
        lastLogAtMs: null,
      });
      for (const event of fallbackEvents) {
        const key = dedupeKey(event);
        if (!seen.has(key)) seen.set(key, event);
      }
    } else {
      const staticFallback = buildStaticFallbackCalendar();
      if (staticFallback.length) {
        providerState.set('fallback', {
          enabled: true,
          ok: true,
          error: null,
          lastStatus: 200,
          lastCheckedAt: new Date().toISOString(),
          checkedUrl: null,
          cooldownUntil: null,
          provider: 'static-calendar-fallback',
          lastLogAtMs: null,
        });
        for (const event of staticFallback) {
          const key = dedupeKey(event);
          if (!seen.has(key)) seen.set(key, event);
        }
      } else {
        providerState.set('fallback', {
          enabled: true,
          ok: false,
          error: 'NO_CALENDAR_SOURCE_AVAILABLE',
          lastStatus: null,
          lastCheckedAt: new Date().toISOString(),
          checkedUrl: null,
          cooldownUntil: null,
          provider: 'fallback',
          lastLogAtMs: null,
        });
      }
    }
  }

  return normalizeEvents(Array.from(seen.values()));
}

export function getActiveProviders(): { name: string; available: boolean }[] {
  return LIVE_PROVIDERS.map((provider) => ({ name: provider.name, available: getProviderEnabled(provider) }));
}

export function getCalendarProviderDiagnostics(): {
  ok: true;
  sources: Record<string, CalendarProviderDiagnostics>;
} {
  const result: Record<string, CalendarProviderDiagnostics> = {};

  for (const provider of LIVE_PROVIDERS) {
    const enabled = getProviderEnabled(provider);
    const state = getProviderState(provider.name, enabled);
    const error = provider.name === 'finnhub' && !enabled && !state.error
      ? 'FINNHUB_FORBIDDEN_OR_INVALID_KEY'
      : state.error;
    const lastStatus = provider.name === 'finnhub' && !enabled && state.lastStatus == null
      ? 403
      : state.lastStatus;
    result[provider.name === 'trading-economics' ? 'tradingEconomics' : provider.name] = {
      enabled: state.enabled,
      ok: state.ok,
      error,
      lastStatus,
      lastCheckedAt: state.lastCheckedAt,
      checkedUrl: state.checkedUrl ?? null,
      cooldownUntil: state.cooldownUntil ?? null,
      provider: provider.name,
    };
  }

  const fallback = providerState.get('fallback');
  result.fallback = fallback
    ? {
        enabled: fallback.enabled,
        ok: fallback.ok,
        error: fallback.error,
        lastStatus: fallback.lastStatus,
        lastCheckedAt: fallback.lastCheckedAt,
        provider: fallback.provider,
      }
    : {
        enabled: true,
        ok: false,
        error: null,
        lastStatus: null,
        lastCheckedAt: null,
      };

  return { ok: true, sources: result };
}
