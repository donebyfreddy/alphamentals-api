import type { EconomicEvent } from '../../types/marketIntelligence.js';
import { MyfxbookProvider } from '../../lib/calendarProviders/myfxbookProvider.js';
import { getCachedValue, setCachedValue } from './cacheStore.service.js';
import { PlaywrightScraperService } from './playwrightScraper.service.js';
import { OpenAIExtractionService } from './openaiExtraction.service.js';
import { setSourceStatus } from './sourceRegistry.service.js';

const scraper = new PlaywrightScraperService();
const openAI = new OpenAIExtractionService();

const manualFallbackEvents: EconomicEvent[] = [];

function envTrue(value: string | undefined, fallback = false): boolean {
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function toTitleCase(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeCalendarEvent(event: Awaited<ReturnType<MyfxbookProvider['fetchEvents']>>[number]): EconomicEvent {
  const datetime = event.timeUtc;
  const iso = new Date(datetime);
  const date = iso.toISOString().slice(0, 10);
  const time = iso.toISOString().slice(11, 16);
  return {
    id: event.id,
    source: 'myfxbook',
    title: event.title,
    country: toTitleCase(event.country),
    currency: event.currency?.toUpperCase() || 'USD',
    impact: event.impact,
    date,
    time,
    datetime,
    actual: event.actual ?? null,
    forecast: event.forecast ?? null,
    previous: event.previous ?? null,
    unit: event.unit ?? null,
    url: event.sourceUrl ?? 'https://www.myfxbook.com/forex-economic-calendar',
    aiSummary: `${event.impact.toUpperCase()} impact ${event.currency} event.`,
    tradingContext: {
      affectedSymbols: event.affectedPairs ?? [],
      riskWindowMinutes: event.impact === 'high' ? 30 : 15,
      bias: 'neutral',
      reason: 'Await actual versus forecast for direction.',
    },
  };
}

function dedupeEvents(events: EconomicEvent[]): EconomicEvent[] {
  const map = new Map<string, EconomicEvent>();
  for (const event of events) {
    const key = `${event.currency}|${event.datetime ?? `${event.date}T${event.time}`}|${event.title.toLowerCase()}`;
    if (!map.has(key)) map.set(key, event);
  }
  return Array.from(map.values()).sort((a, b) => (a.datetime ?? '').localeCompare(b.datetime ?? ''));
}

async function fetchMyfxbookCalendar(): Promise<EconomicEvent[]> {
  const provider = new MyfxbookProvider();
  if (!envTrue(process.env.MYFXBOOK_ENABLED, true) || !provider.isAvailable()) {
    setSourceStatus('myfxbook', {
      active: false,
      lastFetch: new Date().toISOString(),
      items: 0,
      error: 'MYFXBOOK credentials missing or disabled',
    });
    return [];
  }

  const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const to = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const events = (await provider.fetchEvents(from, to)).map(normalizeCalendarEvent);
  setSourceStatus('myfxbook', {
    active: events.length > 0,
    lastFetch: new Date().toISOString(),
    items: events.length,
    error: events.length ? null : 'No valid items returned',
  });
  return events;
}

async function fetchScrapedCalendar(): Promise<EconomicEvent[]> {
  try {
    const scraped = await scraper.scrapePage('https://www.myfxbook.com/forex-economic-calendar');
    const events = await openAI.extractEconomicEventsFromText(scraped.text, 'calendar-playwright');
    setSourceStatus('calendar-playwright', {
      active: events.length > 0,
      lastFetch: new Date().toISOString(),
      items: events.length,
      error: events.length ? null : 'No valid items returned',
    });
    return events;
  } catch (error) {
    setSourceStatus('calendar-playwright', {
      active: false,
      lastFetch: new Date().toISOString(),
      items: 0,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export async function fetchNormalizedCalendar(): Promise<EconomicEvent[]> {
  const ttlMinutes = Number(process.env.CALENDAR_CACHE_TTL_MINUTES ?? process.env.CACHE_TTL_MINUTES ?? '15');
  const cached = await getCachedValue<EconomicEvent[]>('economic-calendar');
  if (cached) return cached;

  console.info('[calendar] Myfxbook credentials detected:', Boolean(process.env.MYFXBOOK_EMAIL && process.env.MYFXBOOK_PASSWORD));
  let events = await fetchMyfxbookCalendar().catch((error) => {
    setSourceStatus('myfxbook', {
      active: false,
      lastFetch: new Date().toISOString(),
      items: 0,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  });

  if (!events.length && envTrue(process.env.SCRAPING_ENABLED, true)) {
    events = await fetchScrapedCalendar();
  }

  if (!events.length) {
    setSourceStatus('calendar-manual', {
      active: manualFallbackEvents.length > 0,
      lastFetch: new Date().toISOString(),
      items: manualFallbackEvents.length,
      error: manualFallbackEvents.length ? null : 'No valid items returned',
    });
    events = manualFallbackEvents;
  } else {
    setSourceStatus('calendar-manual', {
      active: false,
      lastFetch: new Date().toISOString(),
      items: 0,
      error: 'Live providers available',
    });
  }

  const normalized = dedupeEvents(events);
  await setCachedValue('economic-calendar', normalized, ttlMinutes * 60 * 1000);
  return normalized;
}
