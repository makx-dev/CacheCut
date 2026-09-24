"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LruCache = void 0;
/**
 * High-performance, bounded In-Memory LRU Cache with TTL.
 * Avoids memory leaks by evicting oldest entries when maxSize is reached.
 */
class LruCache {
    cache = new Map();
    maxSize;
    ttlMs;
    constructor(maxSize = 10000, ttlMs = 30000) {
        this.maxSize = maxSize;
        this.ttlMs = ttlMs;
    }
    get(key) {
        const entry = this.cache.get(key);
        if (!entry)
            return undefined;
        // Check expiration
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return undefined;
        }
        // Refresh LRU order: delete and re-insert at end of Map
        this.cache.delete(key);
        this.cache.set(key, entry);
        return entry.value;
    }
    set(key, value) {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        }
        else if (this.cache.size >= this.maxSize) {
            // Evict least-recently-used (first key in insertion order)
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey !== undefined) {
                this.cache.delete(oldestKey);
            }
        }
        this.cache.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    }
    delete(key) {
        return this.cache.delete(key);
    }
    clear() {
        this.cache.clear();
    }
    get size() {
        return this.cache.size;
    }
}
exports.LruCache = LruCache;
//# sourceMappingURL=lruCache.js.map