/**
 * Local JSON file persistence for market intelligence data.
 * Primary store is Supabase; this is the fallback that survives DB outages.
 *
 * Files written under <cwd>/data/market-intelligence/
 *   latest-analysis.json
 *   latest-sources.json
 *   latest-calendar.json
 *   latest-news.json
 *   runs/<runId>.json
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'data', 'market-intelligence');
const RUNS_DIR = path.join(DATA_DIR, 'runs');

const FILES = {
  analysis: path.join(DATA_DIR, 'latest-analysis.json'),
  sources:  path.join(DATA_DIR, 'latest-sources.json'),
  calendar: path.join(DATA_DIR, 'latest-calendar.json'),
  news:     path.join(DATA_DIR, 'latest-news.json'),
};

export interface PersistedAnalysis {
  runId: string;
  generatedAt: string;
  generatedTimezone: string;
  triggerSource: string | null;
  model: string | null;
  symbols: Record<string, unknown>;
  activeSources: number;
  failedSources: number;
}

let dirReady = false;

async function ensureDir(): Promise<void> {
  if (dirReady) return;
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.mkdir(RUNS_DIR, { recursive: true });
    dirReady = true;
  } catch (err) {
    console.warn('[persistence] could not create data directory:', err instanceof Error ? err.message : err);
  }
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await ensureDir();
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.warn(`[persistence] write failed (${path.basename(filePath)}):`, err instanceof Error ? err.message : err);
  }
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function saveLatestAnalysis(analysis: PersistedAnalysis): Promise<void> {
  await writeJson(FILES.analysis, { ...analysis, savedAt: new Date().toISOString() });
}

export async function loadLatestAnalysis(): Promise<PersistedAnalysis | null> {
  return readJson<PersistedAnalysis>(FILES.analysis);
}

export async function saveLatestSources(sources: unknown[]): Promise<void> {
  await writeJson(FILES.sources, { sources, savedAt: new Date().toISOString() });
}

export async function loadLatestSources(): Promise<unknown[] | null> {
  const data = await readJson<{ sources: unknown[] }>(FILES.sources);
  return data?.sources ?? null;
}

export async function saveLatestCalendar(events: unknown[]): Promise<void> {
  await writeJson(FILES.calendar, { events, savedAt: new Date().toISOString() });
}

export async function loadLatestCalendar(): Promise<unknown[] | null> {
  const data = await readJson<{ events: unknown[] }>(FILES.calendar);
  return data?.events ?? null;
}

export async function saveLatestNews(articles: unknown[]): Promise<void> {
  await writeJson(FILES.news, { articles, savedAt: new Date().toISOString() });
}

export async function loadLatestNews(): Promise<unknown[] | null> {
  const data = await readJson<{ articles: unknown[] }>(FILES.news);
  return data?.articles ?? null;
}

export async function saveMarketIntelligenceRun(runId: string, payload: unknown): Promise<void> {
  const filePath = path.join(RUNS_DIR, `${runId}.json`);
  await writeJson(filePath, { runId, savedAt: new Date().toISOString(), payload });
}

/** Returns ISO timestamp of the latest saved analysis, or null. */
export async function getLastSavedAt(): Promise<string | null> {
  const a = await loadLatestAnalysis();
  return a?.generatedAt ?? null;
}

/** Diagnostic summary for the /diagnostics endpoint. */
export async function getPersistenceStatus(): Promise<{
  hasAnalysis: boolean;
  hasCalendar: boolean;
  hasNews: boolean;
  lastAnalysisAt: string | null;
  dataDir: string;
}> {
  const analysis = await loadLatestAnalysis();
  const [calData, newsData] = await Promise.all([
    readJson<{ events: unknown[] }>(FILES.calendar),
    readJson<{ articles: unknown[] }>(FILES.news),
  ]);
  return {
    hasAnalysis: analysis !== null,
    hasCalendar: (calData?.events?.length ?? 0) > 0,
    hasNews: (newsData?.articles?.length ?? 0) > 0,
    lastAnalysisAt: analysis?.generatedAt ?? null,
    dataDir: DATA_DIR,
  };
}
