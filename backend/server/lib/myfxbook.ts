import * as cache from './cache.js';

const BASE = 'https://www.myfxbook.com/api';

let sessionToken: string | null = null;
let sessionExpiresAt = 0;

async function login(): Promise<string> {
  if (sessionToken && Date.now() < sessionExpiresAt) return sessionToken;

  const email = process.env.MYFXBOOK_EMAIL;
  const password = process.env.MYFXBOOK_PASSWORD;

  if (!email || !password) {
    throw new Error('MYFXBOOK_EMAIL and MYFXBOOK_PASSWORD must be set in .env');
  }

  const url = `${BASE}/login.json?email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Myfxbook login failed: ${res.status}`);

  const data = (await res.json()) as { error: boolean; message?: string; session?: string };
  if (data.error || !data.session) {
    throw new Error(`Myfxbook login error: ${data.message ?? 'unknown'}`);
  }

  sessionToken = data.session;
  sessionExpiresAt = Date.now() + 3 * 60 * 60 * 1000; // 3 hours
  console.log('[myfxbook] Session acquired');
  return sessionToken;
}

export interface RawCalendarEvent {
  title: string;
  country: string;
  date: string;
  time: string;
  impact: string;
  forecast: string;
  previous: string;
  actual: string;
}

export async function fetchCalendar(
  start: string,
  end: string
): Promise<RawCalendarEvent[]> {
  const cacheKey = `myfxbook:calendar:${start}:${end}`;
  const cached = cache.get<RawCalendarEvent[]>(cacheKey);
  if (cached) return cached;

  const session = await login();
  const url = `${BASE}/get-economic-calendar.json?session=${session}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Myfxbook calendar fetch failed: ${res.status}`);

  const data = (await res.json()) as { error: boolean; message?: string; calendar?: RawCalendarEvent[] };

  if (data.error) {
    // Session may have expired — clear and retry once
    if (data.message?.toLowerCase().includes('session')) {
      sessionToken = null;
      sessionExpiresAt = 0;
    }
    throw new Error(`Myfxbook API error: ${data.message ?? 'unknown'}`);
  }

  const events = data.calendar ?? [];
  cache.set(cacheKey, events, 5 * 60 * 1000); // 5 min
  return events;
}
