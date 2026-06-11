import fs from 'node:fs/promises';
import path from 'node:path';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  updatedAt: string;
}

type CacheFileShape = Record<string, CacheEntry<unknown>>;

const CACHE_DIR = path.join(process.cwd(), 'data', 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'market-intelligence-cache.json');
const memory = new Map<string, CacheEntry<unknown>>();

let fileHydrated = false;

async function ensureCacheDir(): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

async function hydrateFileCache(): Promise<void> {
  if (fileHydrated) return;
  fileHydrated = true;
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as CacheFileShape;
    for (const [key, entry] of Object.entries(parsed)) {
      memory.set(key, entry);
    }
  } catch {
    // Ignore missing or invalid cache file.
  }
}

async function flushFileCache(): Promise<void> {
  await ensureCacheDir();
  const serializable = Object.fromEntries(memory.entries());
  await fs.writeFile(CACHE_FILE, JSON.stringify(serializable, null, 2), 'utf8');
}

export async function getCachedValue<T>(key: string): Promise<T | null> {
  await hydrateFileCache();
  const entry = memory.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) return null;
  return entry.value as T;
}

export async function setCachedValue<T>(key: string, value: T, ttlMs: number): Promise<void> {
  await hydrateFileCache();
  memory.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
    updatedAt: new Date().toISOString(),
  });
  await flushFileCache().catch((error) => {
    console.warn('[market-intelligence/cache] file persistence failed:', error instanceof Error ? error.message : String(error));
  });
}

export async function clearCachedValue(key: string): Promise<void> {
  await hydrateFileCache();
  memory.delete(key);
  await flushFileCache().catch(() => undefined);
}
