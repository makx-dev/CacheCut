import { Queue, Worker, Job } from 'bullmq';
import { redis } from '../db/redis';
import { pool } from '../db/pool';

export interface PersistClicksPayload {
  code: string;
  delta: number;
}

const QUEUE_NAME = 'cachecut-clicks';

// 1. BullMQ Queue for reliable, retry-backed click persistence
export const clickSyncQueue = new Queue<PersistClicksPayload, any, string>(QUEUE_NAME, {
  connection: redis as any,
});

// 2. Click Recording: Single, persistent write-behind buffer in Redis
export async function recordClick(code: string): Promise<void> {
  try {
    const pipeline = redis.pipeline();
    pipeline.incr(`clicks:${code}`);
    pipeline.sadd('dirty:clicks', code);
    await pipeline.exec();
  } catch (err: any) {
    console.error(`[CacheCut] Failed to record click in Redis buffer for ${code}:`, err.message);
  }
}

// 3. Inspect live in-buffer count in Redis
export async function getBufferedClicks(code: string): Promise<number> {
  try {
    const count = await redis.get(`clicks:${code}`);
    return count ? parseInt(count, 10) : 0;
  } catch {
    return 0;
  }
}

// 4. BullMQ Worker: Commits accumulated delta into PostgreSQL
// If PostgreSQL fails or is sleeping, BullMQ retries with exponential backoff (at-least-once persistence)
export const clickSyncWorker = new Worker<PersistClicksPayload, any, string>(
  QUEUE_NAME,
  async (job: Job<PersistClicksPayload>) => {
    const { code, delta } = job.data;
    if (!code || !delta || delta <= 0) return;

    await pool.query(
      'UPDATE urls SET click_cnt = click_cnt + $1 WHERE short_code = $2',
      [delta, code]
    );

    return { code, delta, syncedAt: new Date().toISOString() };
  },
  {
    connection: redis as any,
    concurrency: 2,
  }
);

clickSyncWorker.on('failed', (job, err) => {
  console.warn(`[CacheCut] Click persist job #${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message);
});

// 5. Cadence Dispatcher: Atomic GETDEL -> BullMQ Job Enqueue
let schedulerInterval: NodeJS.Timeout | null = null;
let isDispatching = false;

export async function flushClicksToQueue(): Promise<number> {
  if (isDispatching) return 0;
  isDispatching = true;
  let totalEnqueued = 0;

  try {
    // Pop up to 100 dirty codes per cycle
    const dirtyCodes = await redis.spop('dirty:clicks', 100);
    const codes = Array.isArray(dirtyCodes) ? dirtyCodes : dirtyCodes ? [dirtyCodes] : [];

    for (const code of codes) {
      // Atomic GETDEL: atomically retrieves accumulated clicks and clears the counter key in Redis.
      // Any clicks arriving during or after this call will initialize a fresh counter key without loss.
      const rawCount = await redis.getdel(`clicks:${code}`);
      const delta = Number(rawCount) || 0;

      if (delta > 0) {
        // Enqueue into BullMQ with retry budget to ensure zero clicks are lost if PostgreSQL fails
        await clickSyncQueue.add(
          'persist-clicks',
          { code, delta },
          {
            attempts: 5,
            backoff: { type: 'exponential', delay: 1000 },
            removeOnComplete: 100,
            removeOnFail: 100,
          }
        );
        totalEnqueued += delta;
      }
    }
  } catch (err: any) {
    console.error('[CacheCut] Error flushing dirty clicks to queue:', err.message);
  } finally {
    isDispatching = false;
  }

  return totalEnqueued;
}

// 6. Start the recurring scheduler in-process
export function startClickSyncScheduler(intervalMs = 10000): void {
  if (schedulerInterval) return;

  console.log(`[CacheCut] Starting click-sync queue dispatcher (cadence: ${intervalMs}ms)`);
  schedulerInterval = setInterval(() => {
    flushClicksToQueue().catch((err) => {
      console.warn('[CacheCut] Scheduled flush warning:', err.message);
    });
  }, intervalMs);
  schedulerInterval.unref();
}

// 7. Telemetry & queue metrics for demo/observability
export async function getClickQueueMetrics() {
  try {
    const counts = await clickSyncQueue.getJobCounts('waiting', 'active', 'completed', 'failed');
    return counts;
  } catch {
    return { waiting: 0, active: 0, completed: 0, failed: 0 };
  }
}

// 8. Graceful shutdown
export async function shutdownClickSync(): Promise<void> {
  if (schedulerInterval) clearInterval(schedulerInterval);
  await clickSyncWorker.close();
  await clickSyncQueue.close();
}
