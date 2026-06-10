/**
 * Local JSON persistence for per-symbol pair intelligence.
 * Fallback store that survives Supabase/DB outages.
 *
 *   data/pair-intelligence/<SYMBOL>/latest.json
 *   data/pair-intelligence/<SYMBOL>/runs/<timestamp>.json
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const BASE_DIR = path.join(process.cwd(), 'data', 'pair-intelligence');

function symbolDir(symbol: string): string {
  return path.join(BASE_DIR, symbol.replace(/[/\s]/g, '').toUpperCase());
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.warn(`[pair-persistence] write failed (${filePath}):`, err instanceof Error ? err.message : err);
  }
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

export async function savePairIntelligence(symbol: string, payload: unknown): Promise<void> {
  const dir = symbolDir(symbol);
  await writeJson(path.join(dir, 'latest.json'), payload);
  // Timestamped run (use generatedAt from payload if present, else a counter-free label)
  const stamp = (payload as { generatedAt?: string })?.generatedAt?.replace(/[:.]/g, '-') ?? `run-${(payload as { _seq?: number })?._seq ?? ''}`;
  await writeJson(path.join(dir, 'runs', `${stamp || 'run'}.json`), payload);
}

export async function loadPairIntelligence<T>(symbol: string): Promise<T | null> {
  return readJson<T>(path.join(symbolDir(symbol), 'latest.json'));
}

export async function getPairPersistedAt(symbol: string): Promise<string | null> {
  const data = await readJson<{ generatedAt?: string }>(path.join(symbolDir(symbol), 'latest.json'));
  return data?.generatedAt ?? null;
}
