"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startClickSyncWorker = exports.syncClicksToDatabase = exports.flushLocalClicksToRedis = exports.recordClick = void 0;
const redis_1 = require("../db/redis");
const pool_1 = require("../db/pool");
// In-memory buffer to aggregate clicks and eliminate thousands of Redis TCP calls per second
let localClickBuffer = new Map();
let flushTimer = null;
let dbSyncTimer = null;
let isSyncingToDb = false;
/**
 * Record a click in Node.js local memory buffer (nanoseconds, 0 network overhead).
 */
const recordClick = (code) => {
    localClickBuffer.set(code, (localClickBuffer.get(code) || 0) + 1);
};
exports.recordClick = recordClick;
/**
 * Flushes accumulated in-memory click counts to Redis in a single batch pipeline.
 * Atomically swaps the Map reference to ensure no concurrent clicks are lost.
 */
const flushLocalClicksToRedis = async () => {
    if (localClickBuffer.size === 0)
        return;
    // 1. FLUSH ATOMICITY: Swap the Map reference synchronously.
    // Any clicks arriving during the async Redis call will go into the fresh new Map.
    const batch = localClickBuffer;
    localClickBuffer = new Map();
    try {
        const pipeline = redis_1.redis.pipeline();
        for (const [code, count] of batch) {
            pipeline.incrby(`clicks:${code}`, count);
            pipeline.sadd('dirty:clicks', code);
        }
        await pipeline.exec();
    }
    catch (err) {
        console.error('Failed to flush local clicks to Redis, merging batch back:', err);
        // 2. FAILED FLUSH: Merge batch counts back into localClickBuffer so no clicks are dropped
        for (const [code, count] of batch) {
            localClickBuffer.set(code, (localClickBuffer.get(code) || 0) + count);
        }
    }
};
exports.flushLocalClicksToRedis = flushLocalClicksToRedis;
/**
 * Batch-syncs buffered click counts from Redis into PostgreSQL.
 * Uses atomic GETDEL to retrieve and reset accumulated clicks without race conditions or double-counting.
 */
const syncClicksToDatabase = async () => {
    if (isSyncingToDb)
        return;
    isSyncingToDb = true;
    try {
        // Flush any pending memory clicks to Redis first
        await (0, exports.flushLocalClicksToRedis)();
        // Process up to 500 dirty codes per cycle in batches of 100
        let batchesProcessed = 0;
        while (batchesProcessed < 5) {
            const rawDirtyCodes = (await redis_1.redis.spop('dirty:clicks', 100));
            const codes = Array.isArray(rawDirtyCodes)
                ? rawDirtyCodes
                : rawDirtyCodes ? [rawDirtyCodes] : [];
            if (codes.length === 0)
                break;
            for (const code of codes) {
                // Atomic GETDEL: atomically retrieves current count and deletes key in Redis.
                // Prevents double-counting: increments arriving after this GETDEL start a new counter.
                const clicksStr = await redis_1.redis.getdel(`clicks:${code}`);
                const clicks = Number(clicksStr) || 0;
                if (clicks > 0) {
                    try {
                        await pool_1.pool.query('UPDATE urls SET click_cnt = click_cnt + $1 WHERE short_code = $2', [clicks, code]);
                    }
                    catch (dbErr) {
                        console.error(`Failed to sync clicks for ${code} to DB, restoring counts in Redis:`, dbErr);
                        // Restore counts in Redis and mark dirty so no clicks are lost if the database update fails
                        redis_1.redis.incrby(`clicks:${code}`, clicks).catch(() => { });
                        redis_1.redis.sadd('dirty:clicks', code).catch(() => { });
                    }
                }
            }
            if (codes.length < 100)
                break;
            batchesProcessed++;
        }
    }
    catch (err) {
        console.error('Error in syncClicksToDatabase:', err);
    }
    finally {
        isSyncingToDb = false;
    }
};
exports.syncClicksToDatabase = syncClicksToDatabase;
/**
 * Starts background workers:
 * 1. Fast memory-to-Redis flush (every 1s)
 * 2. Redis-to-PostgreSQL persistent batch sync (every 5s)
 * Registers graceful shutdown handlers on SIGINT and SIGTERM to flush remaining clicks before exiting.
 */
const startClickSyncWorker = (flushIntervalMs = 1000, dbSyncIntervalMs = 5000) => {
    if (flushTimer || dbSyncTimer)
        return;
    flushTimer = setInterval(() => {
        (0, exports.flushLocalClicksToRedis)().catch((err) => {
            console.error('Error flushing clicks to Redis:', err);
        });
    }, flushIntervalMs);
    dbSyncTimer = setInterval(() => {
        (0, exports.syncClicksToDatabase)().catch((err) => {
            console.error('Error syncing clicks to PostgreSQL:', err);
        });
    }, dbSyncIntervalMs);
    // Graceful shutdown handling on SIGINT/SIGTERM
    let isShuttingDown = false;
    const gracefulShutdown = async (signal) => {
        if (isShuttingDown)
            return;
        isShuttingDown = true;
        console.log(`Received ${signal}. Flushing remaining clicks before process exit...`);
        if (flushTimer) {
            clearInterval(flushTimer);
            flushTimer = null;
        }
        if (dbSyncTimer) {
            clearInterval(dbSyncTimer);
            dbSyncTimer = null;
        }
        try {
            await (0, exports.flushLocalClicksToRedis)();
            await (0, exports.syncClicksToDatabase)();
            console.log('Graceful click flush completed successfully.');
        }
        catch (err) {
            console.error('Error during shutdown click flush:', err);
        }
        finally {
            process.exit(0);
        }
    };
    process.once('SIGINT', () => gracefulShutdown('SIGINT'));
    process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
};
exports.startClickSyncWorker = startClickSyncWorker;
//# sourceMappingURL=clickSync.service.js.map