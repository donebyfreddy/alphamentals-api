"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.get = get;
exports.getStale = getStale;
exports.set = set;
exports.del = del;
exports.delByPrefix = delByPrefix;
exports.stats = stats;
const store = new Map();
function get(key) {
    const entry = store.get(key);
    if (!entry)
        return null;
    if (Date.now() > entry.expiresAt) {
        store.delete(key);
        return null;
    }
    return entry.data;
}
/** Returns stale data even after TTL expiry (up to gracePeriodMs additional ms). */
function getStale(key, gracePeriodMs = 0) {
    const entry = store.get(key);
    if (!entry)
        return null;
    const now = Date.now();
    if (now > entry.expiresAt + gracePeriodMs)
        return null;
    return { data: entry.data, isStale: now > entry.expiresAt };
}
function set(key, data, ttlMs) {
    store.set(key, { data, expiresAt: Date.now() + ttlMs, setAt: Date.now() });
}
function del(key) {
    store.delete(key);
}
function delByPrefix(prefix) {
    for (const key of store.keys()) {
        if (key.startsWith(prefix))
            store.delete(key);
    }
}
function stats() {
    const now = Date.now();
    // Evict expired before reporting
    for (const [k, v] of store) {
        if (now > v.expiresAt)
            store.delete(k);
    }
    return { size: store.size, keys: Array.from(store.keys()) };
}
