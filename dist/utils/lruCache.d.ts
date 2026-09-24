/**
 * High-performance, bounded In-Memory LRU Cache with TTL.
 * Avoids memory leaks by evicting oldest entries when maxSize is reached.
 */
export declare class LruCache<K, V> {
    private cache;
    private readonly maxSize;
    private readonly ttlMs;
    constructor(maxSize?: number, ttlMs?: number);
    get(key: K): V | undefined;
    set(key: K, value: V): void;
    delete(key: K): boolean;
    clear(): void;
    get size(): number;
}
//# sourceMappingURL=lruCache.d.ts.map