interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  setAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

export function get<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.data as T;
}

/** Returns stale data even after TTL expiry (up to gracePeriodMs additional ms). */
export function getStale<T>(key: string, gracePeriodMs = 0): { data: T; isStale: boolean } | null {
  const entry = store.get(key);
  if (!entry) return null;
  const now = Date.now();
  if (now > entry.expiresAt + gracePeriodMs) return null;
  return { data: entry.data as T, isStale: now > entry.expiresAt };
}

export function set<T>(key: string, data: T, ttlMs: number): void {
  store.set(key, { data, expiresAt: Date.now() + ttlMs, setAt: Date.now() });
}

export function del(key: string): void {
  store.delete(key);
}

export function delByPrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

export function stats(): { size: number; keys: string[] } {
  const now = Date.now();
  // Evict expired before reporting
  for (const [k, v] of store) {
    if (now > v.expiresAt) store.delete(k);
  }
  return { size: store.size, keys: Array.from(store.keys()) };
}
