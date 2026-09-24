/**
 * Record a click in Node.js local memory buffer (nanoseconds, 0 network overhead).
 */
export declare const recordClick: (code: string) => void;
/**
 * Flushes accumulated in-memory click counts to Redis in a single batch pipeline.
 * Atomically swaps the Map reference to ensure no concurrent clicks are lost.
 */
export declare const flushLocalClicksToRedis: () => Promise<void>;
/**
 * Batch-syncs buffered click counts from Redis into PostgreSQL.
 * Uses atomic GETDEL to retrieve and reset accumulated clicks without race conditions or double-counting.
 */
export declare const syncClicksToDatabase: () => Promise<void>;
/**
 * Starts background workers:
 * 1. Fast memory-to-Redis flush (every 1s)
 * 2. Redis-to-PostgreSQL persistent batch sync (every 5s)
 * Registers graceful shutdown handlers on SIGINT and SIGTERM to flush remaining clicks before exiting.
 */
export declare const startClickSyncWorker: (flushIntervalMs?: number, dbSyncIntervalMs?: number) => void;
//# sourceMappingURL=clickSync.service.d.ts.map