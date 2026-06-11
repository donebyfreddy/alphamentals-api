import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

type CalendarPeriod = 'today' | 'week';
type Impact = 'low' | 'medium' | 'high';

export interface MyfxbookCalendarEvent {
  id: string;
  date: string;
  time: string | null;
  datetime: string | null;
  currency: string | null;
  country: string | null;
  impact: Impact;
  event_name: string;
  actual: string | null;
  forecast: string | null;
  previous: string | null;
  source: string;
  url: string;
}

export interface MyfxbookCalendarSummary {
  period: CalendarPeriod;
  high_impact_events: MyfxbookCalendarEvent[];
  medium_impact_events: MyfxbookCalendarEvent[];
  currencies_affected: string[];
  risk_summary: string;
  trading_warning: string;
  last_updated: string;
}

export interface MyfxbookCalendarPayload {
  ok: boolean;
  period: CalendarPeriod;
  events: MyfxbookCalendarEvent[];
  summary: MyfxbookCalendarSummary;
  last_updated: string | null;
  source: 'live' | 'cache' | 'cache_fallback';
  error: string | null;
}

interface BundlePeriod {
  period: CalendarPeriod;
  last_updated: string;
  source: string;
  count: number;
  error: string | null;
  events: MyfxbookCalendarEvent[];
}

interface CalendarBundleResult {
  ok: boolean;
  source: 'live' | 'cache' | 'cache_fallback';
  generated_at: string;
  today: BundlePeriod;
  week: BundlePeriod;
  error: string | null;
}

interface TradingCalendarContext {
  period: CalendarPeriod;
  riskLevel: Impact;
  elevated: boolean;
  warning: string | null;
  upcomingHighImpactEvents: string[];
  currenciesAffected: string[];
  summary: MyfxbookCalendarSummary;
}

const ROOT_DIR = path.resolve(process.cwd());
const DATA_DIR = path.join(ROOT_DIR, 'data');
const TODAY_CACHE = path.join(DATA_DIR, 'economic_calendar_today.json');
const WEEK_CACHE = path.join(DATA_DIR, 'economic_calendar_week.json');
const MEMORY_TTL_MS = 5 * 60_000;

let memoryCache: { bundle: CalendarBundleResult; expiresAt: number } | null = null;

function getPythonCandidates() {
  return [
    { cmd: path.join(ROOT_DIR, 'mt5bridge', '.venv', 'Scripts', 'python.exe'), args: [], label: 'mt5bridge\\.venv\\Scripts\\python.exe' },
    { cmd: path.join(ROOT_DIR, 'mt5bridge', '.venv', 'bin', 'python'), args: [], label: 'mt5bridge/.venv/bin/python' },
    { cmd: 'py', args: ['-3.11'], label: 'py -3.11' },
    { cmd: 'py', args: [], label: 'py' },
    { cmd: 'python3', args: [], label: 'python3' },
    { cmd: 'python', args: [], label: 'python' },
  ];
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function parseLastJsonLine<T>(text: string): T {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]) as T;
    } catch {
      continue;
    }
  }
  throw new Error('MyFXBook Python scraper did not output valid JSON.');
}

async function readBundleFromCache(error: string | null = null): Promise<CalendarBundleResult | null> {
  const [today, week] = await Promise.all([
    readJsonFile<BundlePeriod>(TODAY_CACHE),
    readJsonFile<BundlePeriod>(WEEK_CACHE),
  ]);
  if (!today && !week) return null;
  const generatedAt = week?.last_updated ?? today?.last_updated ?? new Date().toISOString();
  return {
    ok: Boolean(today || week),
    source: 'cache_fallback',
    generated_at: generatedAt,
    today: today ?? { period: 'today', last_updated: generatedAt, source: 'cache', count: 0, error, events: [] },
    week: week ?? { period: 'week', last_updated: generatedAt, source: 'cache', count: 0, error, events: [] },
    error,
  };
}

async function runPythonBundle(forceRefresh: boolean): Promise<CalendarBundleResult> {
  const moduleArgs = ['-m', 'mt5bridge.services.myfxbook_calendar', ...(forceRefresh ? ['--refresh'] : [])];
  let lastError: Error | null = null;

  for (const candidate of getPythonCandidates()) {
    try {
      const result = await new Promise<CalendarBundleResult>((resolve, reject) => {
        const child = spawn(candidate.cmd, [...candidate.args, ...moduleArgs], {
          cwd: ROOT_DIR,
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        const timeout = setTimeout(() => {
          child.kill('SIGTERM');
          reject(new Error(`MyFXBook scraper timed out using ${candidate.label}.`));
        }, 60_000);

        child.stdout.on('data', (chunk) => {
          stdout += String(chunk);
        });
        child.stderr.on('data', (chunk) => {
          stderr += String(chunk);
        });

        child.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });

        child.on('close', (code) => {
          clearTimeout(timeout);
          if (code !== 0) {
            reject(new Error(stderr.trim() || stdout.trim() || `MyFXBook scraper exited with code ${code}.`));
            return;
          }
          try {
            resolve(parseLastJsonLine<CalendarBundleResult>(stdout));
          } catch (error) {
            reject(error);
          }
        });
      });

      console.log('[myfxbook-calendar] python scraper completed', {
        python: candidate.label,
        source: result.source,
        todayItems: result.today?.events?.length ?? 0,
        weekItems: result.week?.events?.length ?? 0,
      });
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn('[myfxbook-calendar] python candidate failed', {
        python: candidate.label,
        error: lastError.message,
      });
    }
  }

  const fallback = await readBundleFromCache(lastError?.message ?? 'MyFXBook Python scraper unavailable.');
  if (fallback) return fallback;
  throw lastError ?? new Error('Unable to execute MyFXBook Python scraper.');
}

function buildSummary(period: CalendarPeriod, events: MyfxbookCalendarEvent[], lastUpdated: string): MyfxbookCalendarSummary {
  const highImpactEvents = events.filter((event) => event.impact === 'high');
  const mediumImpactEvents = events.filter((event) => event.impact === 'medium');
  const currencies = Array.from(new Set(events.map((event) => event.currency).filter((value): value is string => Boolean(value))));
  const riskSummary = highImpactEvents.length
    ? `${highImpactEvents.length} high-impact event(s) and ${mediumImpactEvents.length} medium-impact event(s) are on the MyFXBook calendar for ${period}.`
    : mediumImpactEvents.length
      ? `No high-impact events detected, but ${mediumImpactEvents.length} medium-impact event(s) are scheduled for ${period}.`
      : `No medium or high-impact events were parsed for ${period}.`;
  const tradingWarning = highImpactEvents.length
    ? 'High-impact events detected. Review timing before opening new positions.'
    : mediumImpactEvents.length
      ? 'Medium-impact macro events scheduled. Keep sizing conservative around releases.'
      : 'No elevated macro warning detected from the cached MyFXBook calendar.';

  return {
    period,
    high_impact_events: highImpactEvents,
    medium_impact_events: mediumImpactEvents,
    currencies_affected: currencies,
    risk_summary: riskSummary,
    trading_warning: tradingWarning,
    last_updated: lastUpdated,
  };
}

async function getBundle(forceRefresh = false): Promise<CalendarBundleResult> {
  if (!forceRefresh && memoryCache && memoryCache.expiresAt > Date.now()) {
    return memoryCache.bundle;
  }

  const bundle = await runPythonBundle(forceRefresh);
  memoryCache = {
    bundle,
    expiresAt: Date.now() + MEMORY_TTL_MS,
  };
  return bundle;
}

export async function getMyfxbookCalendar(period: CalendarPeriod, options?: { forceRefresh?: boolean }): Promise<MyfxbookCalendarPayload> {
  const bundle = await getBundle(Boolean(options?.forceRefresh));
  const periodPayload = period === 'today' ? bundle.today : bundle.week;
  const summary = buildSummary(period, periodPayload.events ?? [], periodPayload.last_updated ?? bundle.generated_at);

  return {
    ok: bundle.ok,
    period,
    events: periodPayload.events ?? [],
    summary,
    last_updated: periodPayload.last_updated ?? null,
    source: bundle.source,
    error: bundle.error ?? periodPayload.error ?? null,
  };
}

function relevantCurrenciesForSymbol(symbol: string): string[] {
  const normalized = symbol.replace(/[/\s]/g, '').toUpperCase();
  if (normalized === 'XAUUSD' || normalized === 'GOLD') return ['USD', 'XAU'];
  if (normalized === 'EURUSD') return ['EUR', 'USD'];
  if (normalized === 'GBPUSD') return ['GBP', 'USD'];
  if (normalized === 'USDJPY') return ['USD', 'JPY'];
  if (normalized === 'AUDUSD') return ['AUD', 'USD'];
  if (normalized === 'NZDUSD') return ['NZD', 'USD'];
  if (normalized === 'USDCAD') return ['USD', 'CAD'];
  if (normalized === 'USDCHF') return ['USD', 'CHF'];
  return ['USD'];
}

function buildUpcomingEventLabel(event: MyfxbookCalendarEvent) {
  const currency = event.currency ? ` (${event.currency})` : '';
  const at = event.time ? ` at ${event.time}` : '';
  return `${event.event_name}${currency}${at}`;
}

export async function getTradingCalendarContext(symbol: string, options?: { forceRefresh?: boolean; period?: CalendarPeriod }): Promise<TradingCalendarContext> {
  const period = options?.period ?? 'today';
  const payload = await getMyfxbookCalendar(period, { forceRefresh: options?.forceRefresh });
  const relevantCurrencies = relevantCurrenciesForSymbol(symbol);
  const now = Date.now();

  const relevantHighImpactEvents = payload.events.filter((event) => {
    if (event.impact !== 'high') return false;
    const currency = event.currency?.toUpperCase() ?? '';
    if (symbol.replace(/[/\s]/g, '').toUpperCase() === 'XAUUSD' && currency === 'USD') return true;
    return relevantCurrencies.includes(currency);
  });

  const activeWindow = relevantHighImpactEvents.some((event) => {
    if (!event.datetime) return false;
    const eventTs = new Date(event.datetime).getTime();
    return Math.abs(eventTs - now) <= 30 * 60_000;
  });

  const nearWindow = relevantHighImpactEvents.some((event) => {
    if (!event.datetime) return false;
    const eventTs = new Date(event.datetime).getTime();
    return eventTs >= now && eventTs - now <= 3 * 60_000 * 60;
  });

  const riskLevel: Impact = activeWindow ? 'high' : nearWindow ? 'medium' : relevantHighImpactEvents.length ? 'medium' : 'low';
  const warning = activeWindow
    ? 'High-impact news window active. Avoid new trades or reduce risk.'
    : nearWindow
      ? 'High-impact economic releases are approaching. Consider reducing risk and waiting for confirmation.'
      : payload.summary.trading_warning;

  return {
    period,
    riskLevel,
    elevated: activeWindow || nearWindow,
    warning,
    upcomingHighImpactEvents: relevantHighImpactEvents.slice(0, 5).map(buildUpcomingEventLabel),
    currenciesAffected: payload.summary.currencies_affected,
    summary: payload.summary,
  };
}

export async function refreshMyfxbookCalendar() {
  return getBundle(true);
}
